import {proRequestWeight,type ProTier} from '../shared/pro';
import {refreshMapDemand, type MapDemandSnapshot} from '../src/game/mapDemand';
import type {Coordinate,FuelQueueAssignment,GameState,Offer} from '../src/game/types';
import type {DriverCounters,SharedDispatchAssignment} from '../shared/protocol';
import {getVehicleGraph,getVehiclePosition,getWorldDemandCandidates,quoteWorldOffer,setDispatchOffer,applyFuelQueueAssignment,getEnergyServiceEstimate,getPhaseRemainingMinutes,canReceiveOffer} from '../src/game';
import {shouldDispatchNextTrip} from '../src/game/systems';
import {flatDistanceM} from '../src/game/spatial';
import {seededRandom,stringHash} from '../src/game/random';
import {SERVICE_STATION_BY_ID} from '../src/data/serviceStations';
import {allocateFuelQueue,fuelQueueBaseline,FUEL_QUEUE_HEADWAY_MINUTES} from '../src/game/fuelQueue';
import {dispatchHistoryWeight} from './driverStats';
import {getLocalityDetails} from '../src/data/localities';
import {routeMinutes,speedKph} from '../src/game/routing';
import {isOfferEligibleForVehicle} from '../src/data/fares';
import {VEHICLE_BY_ID} from '../src/data/vehicles';
import {isPreferredOffer} from '../src/game/orderPreferences';
import {airportWorldOffers,airportOfferPool,airportQueueStillEligible,airportQueueOrder,prepareAirportOffer} from '../src/game/airport';

export interface DispatchDriver {id:string;nickname:string;game:GameState;connected:boolean;left:boolean;forfeited:boolean;stats?:DriverCounters}
interface Assignment extends SharedDispatchAssignment {declinedPlayerIds:string[]}
export interface DispatchState {assignments:Assignment[];lastAssigned:Record<string,number>;mapDemandDisplay?:MapDemandSnapshot}
export interface SharedFuelTicket extends FuelQueueAssignment {playerId:string}
export const initialDispatchState=():DispatchState=>({assignments:[],lastAssigned:{}});
const ACCEPTED_NOTICE_RETENTION_MS=10_000,MAX_PUBLIC_ASSIGNMENTS=64;
const recentAcceptance=(entry:Assignment,now:number):boolean=>entry.status==='accepted'&&typeof entry.acceptedAt==='number'&&now>=entry.acceptedAt&&now-entry.acceptedAt<=ACCEPTED_NOTICE_RETENTION_MS;
function free(driver:DispatchDriver):boolean {const s=driver.game;return driver.connected&&!driver.left&&!driver.forfeited&&!s.currentOffer&&canReceiveOffer(s);}
function nextEligible(driver:DispatchDriver):boolean {if(!driver.connected||driver.left||driver.forfeited)return false;const s=driver.game,graph=getVehicleGraph(s.vehicleId),edge=graph.edges[s.movement.edgeId];const distance=Math.max(0,edge.lengthM-s.movement.distanceOnEdgeM);const remaining=s.phase==='alighting'?0:distance+s.movement.nextEdgeIds.reduce((sum,id)=>sum+(graph.edges[id]?.lengthM||0),0);const minutes=s.phase==='alighting'?getPhaseRemainingMinutes(s):distance/(speedKph(edge)*1000/60)+routeMinutes(s.movement.nextEdgeIds,graph);return shouldDispatchNextTrip(s,remaining,minutes);}
const positionOf=(state:GameState)=>getVehiclePosition(state,getVehicleGraph(state.vehicleId));
export function availableSupply(drivers:DispatchDriver[]):{position:Coordinate;availableDrivers:number}[]{return drivers.filter(free).map(driver=>({position:positionOf(driver.game),availableDrivers:1}));}

/** Exponential weighted lottery: distance and modest verified history, with a positive chance for every eligible driver. */
export function dispatchLotteryScore(seed:number,offerId:string,driverId:string,distanceM:number,history?:DriverCounters,idleMinutes=0,reservation=false,tier?:ProTier):number {const weight=Math.exp(-Math.max(0,distanceM)/1400)*dispatchHistoryWeight(history)*(1+Math.min(2,Math.max(0,idleMinutes)*.08))*(reservation?.65:1)*proRequestWeight(tier);const u=Math.max(1e-9,seededRandom(seed,stringHash(offerId),stringHash(driverId)));return-Math.log(u)/Math.max(.001,weight);}

function acceptedDetails(offer:Offer,now:number):Pick<SharedDispatchAssignment,'estimatedFare'|'pricingType'|'pickupLocality'|'pickupLocalityEn'|'destinationLocality'|'destinationLocalityEn'|'acceptedAt'>{
 const pickup=getLocalityDetails(offer.pickup),destination=getLocalityDetails(offer.destination);
 return{estimatedFare:offer.estimatedFare,pricingType:offer.pricingType,pickupLocality:pickup.name,pickupLocalityEn:pickup.nameEn,destinationLocality:destination.name,destinationLocalityEn:destination.nameEn,acceptedAt:now};
}
/** Only an authoritative accepted trip supplies banner details and its wall-clock event time. */
export function recordDispatchAcceptance(state:DispatchState|undefined,offer:Offer,playerId:string,now:number):DispatchState|undefined {
 if(!state)return state;
 return{...state,assignments:state.assignments.map(entry=>entry.offerId===offer.id&&entry.playerId===playerId&&entry.status!=='accepted'?{...entry,status:'accepted',...acceptedDetails(offer,now)}:entry)};
}

export function coordinateDispatch(drivers:DispatchDriver[],seed:number,clock:number,claims:ReadonlyMap<string,string>,previous:DispatchState=initialDispatchState(),now=Date.now()):{state:DispatchState;games:Map<string,GameState>;nearby:Map<string,number>;availableDrivers:number;assignments:SharedDispatchAssignment[];acceptedClaims:Array<{offerId:string;playerId:string}>}{
 const world:DispatchState={assignments:previous.assignments.filter(a=>a.expiresAt>clock-12||recentAcceptance(a,now)).map(a=>({...a,declinedPlayerIds:[...a.declinedPlayerIds]})),lastAssigned:{...previous.lastAssigned},mapDemandDisplay:previous.mapDemandDisplay};
 const acceptedClaims:Array<{offerId:string;playerId:string}>=[];
 const games=new Map(drivers.map(driver=>[driver.id,driver.game]));const records=new Map(world.assignments.map(a=>[a.offerId,a]));const candidates=new Map<string,Offer>();
 for(const assignment of world.assignments){if(claims.has(assignment.offerId)){assignment.status='accepted';continue;}const owner=drivers.find(driver=>driver.id===assignment.playerId);if(assignment.status==='offered'&&(assignment.expiresAt<=clock||!owner||owner.game.currentOffer?.id!==assignment.offerId)){assignment.status='expired';if(!assignment.declinedPlayerIds.includes(assignment.playerId))assignment.declinedPlayerIds.push(assignment.playerId);}}
 for(const driver of drivers){let state=games.get(driver.id)!;
  const source=[...(state.currentOffer?[state.currentOffer]:[]),...state.observedOffers.slice(0,24)];
  if(state.airportQueue)source.push(...airportWorldOffers(state));
  if(free({...driver,game:state})&&!source.length)source.push(...getWorldDemandCandidates(state,positionOf(state),Math.max(0,clock-.5),clock));
  if(nextEligible({...driver,game:state})){source.push(...getWorldDemandCandidates(state,state.activeTrip!.offer.destination,Math.max(0,clock-.5),clock));}
  for(const offer of source){const requested=offer.requestedAt??offer.createdAt;if(claims.has(offer.id)||requested>clock+.001||requested<clock-10)continue;const prior=candidates.get(offer.id);if(!prior||offer.id.startsWith('opening-')&&offer.pricingType==='private-upfront')candidates.set(offer.id,offer);}
  if(state.currentOffer){const assignment=records.get(state.currentOffer.id);if(!assignment||assignment.playerId!==driver.id||assignment.status!=='offered')state=setDispatchOffer(state,null);}
  games.set(driver.id,state);
 }
 const ordered=[...candidates.values()].sort((a,b)=>(a.requestedAt??a.createdAt)-(b.requestedAt??b.createdAt)||a.id.localeCompare(b.id));
 for(const source of ordered){const record=records.get(source.id);if(record?.status==='offered'||record?.status==='accepted')continue;
  const airportPool=airportOfferPool(source);
  const eligible=drivers.flatMap(driver=>{
    const original=games.get(driver.id)!;if(original.currentOffer||record?.declinedPlayerIds.includes(driver.id)||!isPreferredOffer(original,source))return[];
    const graph=getVehicleGraph(original.vehicleId);if(!source.pickup.nodeId||!source.destination.nodeId||!graph.nodes[source.pickup.nodeId]||!graph.nodes[source.destination.nodeId])return[];
    const queue=original.airportQueue;
    if(airportPool&&(!driver.connected||driver.left||driver.forfeited||!queue||queue.pool!==airportPool||queue.assignmentPending||!Number.isSafeInteger(queue.sequence)||(source.requestedAt??source.createdAt)<=queue.joinedAt||!airportQueueStillEligible(original,graph)))return[];
    const state=airportPool?prepareAirportOffer(original,source):original,d={...driver,game:state},reservation=!airportPool&&!free(d)&&nextEligible(d);
    if(!airportPool&&!free(d)&&!reservation)return[];
    const center=reservation?state.activeTrip!.offer.destination:positionOf(state),distance=flatDistanceM(center,source.pickup);if(distance>1800)return[];
    return[{driver,state,reservation,distance,queue:airportPool?queue:undefined,score:airportPool?0:dispatchLotteryScore(seed,source.id,driver.id,distance,driver.stats,clock-(world.lastAssigned[driver.id]??0),reservation,state.advancedRulesVersion===1?state.proTier:undefined)}];
  }).sort((a,b)=>a.queue&&b.queue?airportQueueOrder({...a.queue,sequence:a.queue.sequence!},{...b.queue,sequence:b.queue.sequence!}):a.score-b.score||a.driver.id.localeCompare(b.driver.id));
  for(const candidate of eligible.slice(0,airportPool?8:3)){const quote=quoteWorldOffer(candidate.state,source,candidate.reservation?{reservation:'next-trip'}:{});if(!quote)continue;const assigned=setDispatchOffer(candidate.state,quote);const autoAccepted=assigned.acceptedOffers>candidate.state.acceptedOffers&&(assigned.activeTrip?.offer.id===source.id||assigned.queuedTrip?.offer.id===source.id);if(assigned.currentOffer?.id!==source.id&&!autoAccepted)continue;games.set(candidate.driver.id,assigned);world.lastAssigned[candidate.driver.id]=clock;
   if(autoAccepted)acceptedClaims.push({offerId:source.id,playerId:candidate.driver.id});
   const entry:Assignment={serviceType:quote.serviceType,passengerCount:quote.passengerCount,offerId:source.id,pickupName:quote.pickup.name,pickupNameEn:quote.pickup.nameEn,destinationName:quote.destination.name,destinationNameEn:quote.destination.nameEn,playerId:candidate.driver.id,nickname:candidate.driver.nickname,assignedAt:clock,expiresAt:quote.expiresAt,status:autoAccepted?'accepted':'offered',reservation:quote.reservation,competitors:eligible.length,declinedPlayerIds:record?.declinedPlayerIds||[],...(autoAccepted?acceptedDetails(quote,now):{})};records.set(source.id,entry);const index=world.assignments.findIndex(a=>a.offerId===source.id);if(index>=0)world.assignments[index]=entry;else world.assignments.push(entry);break;
  }
 }
 const reference=drivers[0]?.game;
 if(reference){
  const requests=ordered.filter(offer=>!claims.has(offer.id)&&!acceptedClaims.some(claim=>claim.offerId===offer.id)&&records.get(offer.id)?.status!=='accepted').map(offer=>({id:offer.id,pickup:{lat:offer.pickup.lat,lon:offer.pickup.lon},requestedAt:offer.requestedAt??offer.createdAt}));
  const supply=availableSupply(drivers.map(driver=>({...driver,game:games.get(driver.id)!})));
  world.mapDemandDisplay=refreshMapDemand(previous.mapDemandDisplay,{...reference,clockMinutes:clock,demandSupply:supply},requests,now);
  for(const [id,game] of games)if(game.mapDemandDisplay!==world.mapDemandDisplay)games.set(id,{...game,mapDemandDisplay:world.mapDemandDisplay});
 }
 const positions=drivers.map(driver=>({driver,position:positionOf(games.get(driver.id)!)}));const nearby=new Map(positions.map(({driver,position})=>[driver.id,positions.filter(other=>other.driver.id!==driver.id&&free({...other.driver,game:games.get(other.driver.id)!})&&flatDistanceM(position,other.position)<=2500).length]));
 // The latest twelve offers are an information feed, not an acceptance-event
 // guarantee. Keep fresh accepted events separately so busy-room offer churn
 // cannot evict a peer notice before another player's next poll. This changes
 // only public history; request expiry, ownership and claims remain untouched.
 const accepted=world.assignments.filter(entry=>recentAcceptance(entry,now)).sort((a,b)=>b.acceptedAt!-a.acceptedAt!||a.offerId.localeCompare(b.offerId));
 const publicRecords=new Map<string,Assignment>();
 for(const entry of [...accepted,...world.assignments.slice(-12).reverse()]){if(!publicRecords.has(entry.offerId))publicRecords.set(entry.offerId,entry);if(publicRecords.size>=MAX_PUBLIC_ASSIGNMENTS)break;}
 const assignments=[...publicRecords.values()].map(({declinedPlayerIds,...assignment})=>assignment);
 return{state:world,games,nearby,availableDrivers:drivers.filter(driver=>free({...driver,game:games.get(driver.id)!})).length,assignments,acceptedClaims};
}

export function coordinateFuelQueues(drivers:DispatchDriver[],existing:SharedFuelTicket[],clock:number):{tickets:SharedFuelTicket[];games:Map<string,GameState>}{
 const games=new Map(drivers.map(driver=>[driver.id,driver.game]));const active=new Map(drivers.filter(d=>!d.left&&!d.forfeited&&d.game.fuelQueue).map(d=>[d.game.fuelQueue!.id,d]));
 const kept=existing.filter(ticket=>active.has(ticket.id)).map(ticket=>({...ticket})).sort((a,b)=>a.joinedAt-b.joinedAt||a.id.localeCompare(b.id));
 const tails=new Map<string,number>();for(const ticket of kept){const driver=active.get(ticket.id)!;const duration=ticket.serviceEndsAt-ticket.serviceStartsAt;const tail=tails.get(ticket.stationId)??-Infinity;if(ticket.serviceStartsAt<tail){ticket.serviceStartsAt=tail;ticket.serviceEndsAt=tail+duration;}
  const actual=driver.game.navigation?.stage==='servicing'?driver.game.navigation.endsAt:undefined;if(actual&&actual>ticket.serviceEndsAt)ticket.serviceEndsAt=actual;
  if(clock>=ticket.serviceStartsAt&&driver.game.phase==='fuel-queue'&&(driver.game.fuelQueue?.distanceToStationM||0)>1){const earliest=Math.max(clock,driver.game.energyRecovery?.endsAt||clock)+(driver.game.fuelQueue!.distanceToStationM/200);ticket.serviceEndsAt=Math.max(ticket.serviceEndsAt,earliest+duration);}
  tails.set(ticket.stationId,ticket.serviceEndsAt);}
 const arrivals=drivers.flatMap(driver=>{const queue=driver.game.fuelQueue;if(!queue?.assignmentPending||driver.left||driver.forfeited)return[];const station=SERVICE_STATION_BY_ID.get(queue.stationId);if(!station)return[];const baseline=fuelQueueBaseline(station,driver.game.startTimeMinutes+queue.joinedAt);return[{id:queue.id,stationId:queue.stationId,joinedAt:queue.joinedAt,serviceMinutes:getEnergyServiceEstimate(driver.game,station).minutes,initialWaitMinutes:Math.max(baseline.waitMinutes,clock-queue.joinedAt)}];});
 const allocated=allocateFuelQueue(arrivals,kept);const tickets:SharedFuelTicket[]=[];
 for(const assignment of allocated){const driver=active.get(assignment.id);if(!driver)continue;const station=SERVICE_STATION_BY_ID.get(assignment.stationId)!;const npc=fuelQueueBaseline(station,driver.game.startTimeMinutes+assignment.joinedAt);assignment.aheadCount=Math.ceil(Math.max(0,npc.waitMinutes-(clock-assignment.joinedAt))/FUEL_QUEUE_HEADWAY_MINUTES)+allocated.filter(other=>other.id!==assignment.id&&other.stationId===assignment.stationId&&other.joinedAt<=assignment.joinedAt&&other.serviceEndsAt>clock&&other.serviceStartsAt<assignment.serviceStartsAt).length;tickets.push({...assignment,playerId:driver.id});games.set(driver.id,applyFuelQueueAssignment(driver.game,assignment));}
 return{tickets,games};
}
