import {AIRPORT_POOLS,HKG_AIRPORT,HKG_DEMAND_BOUNDARY,type AirportDemandEstimate,type AirportPool,type AirportQueueTicket,type AirportRoomView,type SharedAirportTicket} from '../../shared/airport';
import type {Coordinate,GameState,Landmark,Offer,RoadGraph} from './types';
import {LANDMARK_BY_ID} from '../data/landmarks';
import {VEHICLE_BY_ID} from '../data/vehicles';
import {vehicleSupportsXL} from './vehicleCapabilities';
import {getVehicleGraph} from './access';
import {getVehiclePosition} from './selectors';
import {distanceMetres,findRoute,partialShape,edgeShape,routeLength,routeMinutes,speedKph} from './routing';
import {isPlaceAllowed} from '../data/vehicleAccess';
import {isSafeStoppingEdge} from './systems';
import {getShiftDurationMinutes} from './shiftDuration';
import {isOrderTypeEnabled} from './orderPreferences';
import {seededRandom,stringHash} from './random';

export function airportEnabled(state:GameState):boolean{return state.advancedRulesVersion===1;}
export function airportPoolForVehicle(state:Pick<GameState,'vehicleId'|'xlOrdersEnabled'|'orderPreferences'>):AirportPool{return VEHICLE_BY_ID[state.vehicleId].type==='taxi'?(isOrderTypeEnabled(state,'taxi-upfront')?'taxi':isOrderTypeEnabled(state,'private-upfront')?'standard':'taxi'):state.xlOrdersEnabled&&vehicleSupportsXL(state.vehicleId)&&isOrderTypeEnabled(state,'private-xl')?'xl':'standard';}
export function insideAirportDemand(point:Coordinate):boolean{
 let inside=false;const p=HKG_DEMAND_BOUNDARY;
 for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i].lat>point.lat)!==(p[j].lat>point.lat)&&point.lon<(p[j].lon-p[i].lon)*(point.lat-p[i].lat)/(p[j].lat-p[i].lat)+p[i].lon)inside=!inside;
 return inside;
}
export function airportPlaces(state:Pick<GameState,'vehicleId'>,graph:RoadGraph=getVehicleGraph(state.vehicleId)):{waiting:Landmark;pickup:Landmark}|null {
 const waiting=LANDMARK_BY_ID.get(HKG_AIRPORT.waitingPlaceId),pickup=LANDMARK_BY_ID.get(HKG_AIRPORT.pickupPlaceId);
 if(!waiting||!pickup||waiting.nodeId!==HKG_AIRPORT.waitingNodeId||pickup.nodeId!==HKG_AIRPORT.pickupNodeId||![waiting,pickup].every(p=>!!graph.nodes[p.nodeId!]&&!!graph.outgoing[p.nodeId!]?.length&&isPlaceAllowed(p,state.vehicleId,graph)))return null;
 return{waiting:{...waiting,kind:'transport'},pickup:{...pickup,kind:'transport'}};
}
export function hasAirportOrderType(state:GameState):boolean{const pool=airportPoolForVehicle(state);return isOrderTypeEnabled(state,pool==='taxi'?'taxi-upfront':pool==='xl'?'private-xl':'private-upfront');}
function committedBooking(state:GameState){return state.eliteReservations?.some(r=>['accepted','travelling','waiting','in-trip'].includes(r.status))===true;}
export function canNavigateToAirport(state:GameState):boolean{return airportEnabled(state)&&hasAirportOrderType(state)&&['cruising','service-route'].includes(state.phase)&&(!state.navigation||state.navigation.kind==='airport')&&!state.activeTrip&&!state.queuedTrip&&!state.currentOffer&&!state.energyRecovery&&!state.deadlineSettlement&&!committedBooking(state)&&state.parking?.kind!=='rest'&&state.energy.remaining>0&&state.clockMinutes<getShiftDurationMinutes(state);}
export function atAirportWaitingPoint(state:GameState,graph:RoadGraph):boolean {
 const places=airportPlaces(state,graph),edge=graph.edges[state.movement.edgeId];
 return !!places&&!!edge&&isSafeStoppingEdge(edge)&&distanceMetres(getVehiclePosition(state,graph),graph.nodes[places.waiting.nodeId!])<=1;
}
export function airportQueueStillEligible(state:GameState,graph:RoadGraph):boolean{return airportEnabled(state)&&hasAirportOrderType(state)&&state.phase==='airport-queue'&&!!state.airportQueue&&state.acceptingOrders&&state.platform.suspendedUntil<=state.clockMinutes&&!state.activeTrip&&!state.queuedTrip&&!state.energyRecovery&&!committedBooking(state)&&!state.deadlineSettlement&&state.energy.remaining>0&&state.clockMinutes<getShiftDurationMinutes(state)&&atAirportWaitingPoint(state,graph);}
export function newAirportQueueTicket(state:GameState):AirportQueueTicket {
 const sequence=(state.airportJoinCounter??0)+1,shared=state.fuelQueueMode==='shared';
 return{id:`hkg-${state.fuelQueueOwnerId||state.driverSessionId||state.seed}-${sequence}`,zoneId:'hkg',pool:airportPoolForVehicle(state),priority:state.proTier==='diamond',joinedAt:state.clockMinutes,...(shared?{assignmentPending:true}:{sequence,position:1,ahead:0,total:1,assignmentPending:false})};
}
/** Original seeded GAME arrival profile; never live flight/airport/Uber demand. */
export function airportDemand(seed:number,clock:number,startTimeMinutes=300):AirportDemandEstimate {
 const hour=Math.floor(((startTimeMinutes+clock)%1440+1440)%1440/60),bucket=Math.floor((startTimeMinutes+clock)/15);
 const base=hour>=6&&hour<10||hour>=16&&hour<23?'busy':hour>=10&&hour<16?'normal':'quiet';
 const variation=seededRandom(seed,bucket,4981),level=base==='normal'&&variation>.8?'busy':base;
 return{level,multiplier:level==='busy'?1.35:level==='normal'?1.15:1,requestChance:level==='busy'?.8:level==='normal'?.55:.3,sampledAtMinute:clock,estimatedWaitMin:0,estimatedWaitMax:level==='busy'?6:level==='normal'?10:18};
}
export function airportQueueOrder(a:Pick<SharedAirportTicket,'priority'|'sequence'|'id'>,b:Pick<SharedAirportTicket,'priority'|'sequence'|'id'>):number{return Number(b.priority)-Number(a.priority)||a.sequence-b.sequence||a.id.localeCompare(b.id);}
export function airportRoomView(tickets:readonly AirportQueueTicket[],seed:number,clock:number,startTime=300):AirportRoomView {
 const demand=airportDemand(seed,clock,startTime);
 return{zoneId:'hkg',sampledAtMinute:clock,demand,pools:AIRPORT_POOLS.map(pool=>{const entries=tickets.filter(t=>t.pool===pool),diamond=entries.filter(t=>t.priority).length;return{pool,ordinary:entries.length-diamond,diamond,total:entries.length,estimatedWaitMin:Math.max(0,entries.length-1)*2,estimatedWaitMax:demand.estimatedWaitMax+entries.length*4};})};
}
export function airportJourney(state:GameState,graph:RoadGraph=getVehicleGraph(state.vehicleId)):{target:Landmark;route:string[];distanceM:number;minutes:number;coordinates:Coordinate[]}|null {
 const places=airportPlaces(state,graph),edge=graph.edges[state.movement.edgeId];if(!places||!edge)return null;
 const at=atAirportWaitingPoint(state,graph),route=at?[]:findRoute(edge.to,places.waiting.nodeId!,graph);if(!route)return null;
 if(!at&&!isSafeStoppingEdge(graph.edges[route.at(-1)??edge.id]))return null;
 const remainder=at?0:Math.max(0,edge.lengthM-state.movement.distanceOnEdgeM),coordinates=at?[getVehiclePosition(state,graph)]:[...partialShape(edge,state.movement.distanceOnEdgeM/edge.lengthM,1,graph),...route.flatMap(id=>edgeShape(graph.edges[id],graph).slice(1))];
 return{target:places.waiting,route,distanceM:remainder+routeLength(route,graph),minutes:remainder/(speedKph(edge)*1000/60)+routeMinutes(route,graph),coordinates};
}
const DESTINATIONS=['harbour-city','megabox','admiralty','central','elements','olympian','sorrento','west-kowloon'];
/** Bounded named passenger pool, identical seed/slot/pool IDs in solo and multiplayer. */
export function airportWorldOffers(state:GameState,graph:RoadGraph=getVehicleGraph(state.vehicleId)):Offer[] {
 if(!airportEnabled(state)||!state.airportQueue||state.clockMinutes>=getShiftDurationMinutes(state))return[];
 const places=airportPlaces(state,graph);if(!places)return[];
 const pool=state.airportQueue.pool,first=Math.max(0,Math.floor((state.clockMinutes-10)/2)),last=Math.floor(state.clockMinutes/2),result:Offer[]=[];
 const destinations=DESTINATIONS.map(id=>LANDMARK_BY_ID.get(id)).filter((p):p is Landmark=>!!p&&isPlaceAllowed(p,state.vehicleId,graph));if(!destinations.length)return[];
 for(let slot=first;slot<=last;slot++){
  const minute=slot*2;if(minute<=state.airportQueue.joinedAt+1e-6)continue;
  const model=airportDemand(state.seed,minute,state.startTimeMinutes);if(seededRandom(state.seed,slot,stringHash(`airport-${pool}`))>model.requestChance)continue;
  const destination=destinations[Math.floor(seededRandom(state.seed,slot,stringHash(`airport-destination-${pool}`))*destinations.length)],pricingType=pool==='taxi'?'taxi-upfront':pool==='xl'?'private-xl':'private-upfront';
  result.push({id:`airport-${state.seed}-${pool}-${slot}`,createdAt:minute,requestedAt:minute,expiresAt:minute+10,pickup:places.pickup,destination,pickupDistanceM:0,tripDistanceM:distanceMetres(places.pickup,destination),pickupMinutes:0,tripMinutes:0,estimatedFare:0,estimatedNet:0,surge:pool==='taxi'?1:model.multiplier,pickupRoute:[],tripRoute:[],pricingType,pricingLabel:'',feedKind:'live',serviceType:pool==='xl'?'xl':'standard',passengerCount:pool==='xl'?5+Math.floor(seededRandom(state.seed,slot,4910)*2):1+Math.floor(seededRandom(state.seed,slot,4911)*4)});
 }
 return result;
}
export function airportOfferPool(offer:Offer):AirportPool|null {
 if(!offer.id.startsWith('airport-')||offer.pickup.id!==HKG_AIRPORT.pickupPlaceId)return null;
 return offer.pricingType==='taxi-upfront'?'taxi':offer.pricingType==='private-xl'?'xl':'standard';
}
/** A real card removes the ticket; a temporary stop holds position during its original5second lease. */
export function prepareAirportOffer(state:GameState,offer:Offer):GameState {
 if(state.phase!=='airport-queue'||!state.airportQueue||airportOfferPool(offer)!==state.airportQueue.pool)return state;
 return{...state,phase:'cruising',airportQueue:null,parking:{kind:'temporary',startedAt:state.clockMinutes,endsAt:state.clockMinutes+(state.offerResponseWindowMinutes??4)},airportOfferHistory:[...(state.airportOfferHistory||[]).filter(id=>id!==offer.id),offer.id].slice(-64)};
}
