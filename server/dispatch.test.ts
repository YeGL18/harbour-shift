import assert from 'node:assert/strict';
import test from 'node:test';
import {createInitialState,setDispatchOffer,getVehicleGraph,getVehiclePosition,configureSharedFuelQueues,acceptOffer,quoteWorldOffer} from '../src/game';
import type {GameState,Offer} from '../src/game/types';
import {availableSupply,coordinateDispatch,coordinateFuelQueues,dispatchLotteryScore,initialDispatchState,type DispatchDriver} from './dispatch';
import {dispatchHistoryWeight} from './driverStats';
import {getCompatibleStations} from '../src/data/serviceStations';
import {stationQueueApproach} from '../src/game/fuelQueue';
import {routeLength} from '../src/game/routing';
import {ROAD_GRAPH} from '../src/map/roadGraph';

const base=createInitialState({seed:20261118,startPlaceId:'harbour-city',density:'busy'});const source:Offer={...base.currentOffer!,pricingType:'private-upfront',requestedAt:0};
function driver(id:string,offer:Offer=source,clock=0):DispatchDriver{return{id,nickname:id,connected:true,left:false,forfeited:false,game:{...base,clockMinutes:clock,dispatchManaged:true,currentOffer:null,observedOffers:[offer],platform:{...base.platform,offered:0},presentedOffers:0,acceptedOffers:0,declinedOffers:0,cancelledTrips:0,logs:[]}};}

test('eight real HK drivers receive exclusive orders and all get opportunities over a long shared sample',()=>{
 let world=initialDispatchState();const counts=new Map(Array.from({length:8},(_,i)=>[`driver-${i}`,0]));
 for(let i=0;i<320;i++){const clock=i*.5,offer={...source,id:`fair-world-${i}`,createdAt:clock,requestedAt:clock,expiresAt:clock+5};const drivers=[...counts.keys()].map(id=>driver(id,offer,clock));const result=coordinateDispatch(drivers,12345,clock,new Map(),world);world=result.state;
  const owners=[...result.games].filter(([,game])=>game.currentOffer?.id===offer.id);assert.equal(owners.length,1);counts.set(owners[0][0],counts.get(owners[0][0])!+1);assert.equal(result.assignments[0].competitors,8);
  for(const[,game]of result.games)assert.ok(game.observedOffers.some(item=>item.id===offer.id),'informational shared demand remains visible');
 }
 for(const count of counts.values())assert.ok(count>=20&&count<=65,JSON.stringify([...counts]));
});
test('a declined or expired assignment goes to another nearby driver with a fresh response window',()=>{
 const offer={...source,id:'shared-request',createdAt:0,requestedAt:0,expiresAt:5};const drivers=[driver('a',offer),driver('b',offer)];
 const first=coordinateDispatch(drivers,22,0,new Map());const owner=[...first.games].find(([,game])=>game.currentOffer?.id===offer.id)![0];
 const next=drivers.map(d=>({...d,game:{...setDispatchOffer(first.games.get(d.id)!,null),clockMinutes:6}}));
 const reassigned=coordinateDispatch(next,22,6,new Map(),first.state);const second=[...reassigned.games].find(([,game])=>game.currentOffer?.id===offer.id)!;assert.notEqual(second[0],owner);assert.equal(second[1].currentOffer!.createdAt,6);assert.equal(second[1].currentOffer!.expiresAt,6+(second[1].offerResponseWindowMinutes??4));
 const claimed=coordinateDispatch(next,22,6,new Map([[offer.id,second[0]]]),reassigned.state);assert.ok([...claimed.games.values()].every(game=>game.currentOffer?.id!==offer.id));
});
test('distance and verified rates affect odds mildly; new and poor-record drivers never have zero chance',()=>{
 const good={offered:100,accepted:90,cancelled:0,completedTrips:80},bad={offered:100,accepted:15,cancelled:10,completedTrips:5};assert.equal(dispatchHistoryWeight(undefined),1);assert.equal(dispatchHistoryWeight({offered:1,accepted:0,cancelled:0,completedTrips:0}),1);assert.ok(dispatchHistoryWeight(bad)>0);
 let near=0,goodWins=0,badWins=0;for(let i=0;i<1000;i++){if(dispatchLotteryScore(88,`d${i}`,'near',0)<dispatchLotteryScore(88,`d${i}`,'far',1500))near++;if(dispatchLotteryScore(44,`r${i}`,'good',0,good)<dispatchLotteryScore(44,`r${i}`,'bad',0,bad))goodWins++;else badWins++;}
 assert.ok(near>600&&near<900);assert.ok(goodWins>badWins);assert.ok(badWins>250);
});
test('private cars cannot win taxi-only fare types, and a sole eligible new driver still receives work',()=>{
 const offer={...source,id:'meter-only',pricingType:'taxi-metered' as const};const taxi=driver('taxi',offer),privateCar=driver('private',offer);privateCar.game={...privateCar.game,vehicleId:'private'};
 const result=coordinateDispatch([privateCar,taxi],11,0,new Map());assert.equal(result.games.get('private')!.currentOffer,null);assert.equal(result.games.get('taxi')!.currentOffer?.id,offer.id);
});
test('drivers whose legal graph excludes a shared destination cannot crowd out a legally eligible taxi',()=>{
 const taxiGraph=getVehicleGraph('kam-fung'),privateGraph=getVehicleGraph('private');const node=Object.values(taxiGraph.nodes).find(n=>!privateGraph.nodes[n.id]&&n.lon>114&&n.lon<114.03)!;assert.ok(node,'Real Discovery Bay north taxi-access graph differs from the private profile');const offer={...source,id:'taxi-legal-destination',destination:{...source.destination,...node,nodeId:node.id,name:'合法的士終點'}};
 const drivers=[...Array.from({length:3},(_,i)=>{const d=driver(`private-${i}`,offer);d.game={...d.game,vehicleId:'private' as const};return d;}),driver('taxi',offer)];const result=coordinateDispatch(drivers,11,0,new Map());assert.equal(result.games.get('taxi')!.currentOffer?.id,offer.id);assert.equal(result.assignments[0].competitors,1);
});
test('eight LPG arrivals share durable FIFO service slots without moving or teleporting a vehicle',()=>{
 const graph=getVehicleGraph('kam-fung'),station=getCompatibleStations('kam-fung').find(s=>s.kind==='lpg'&&stationQueueApproach(s,graph).length)!;const approach=stationQueueApproach(station,graph);
 const drivers=Array.from({length:8},(_,i)=>{const d=driver(`queue-${i}`);d.game=configureSharedFuelQueues({...d.game,startTimeMinutes:270,phase:'fuel-queue',currentOffer:null,movement:{edgeId:approach[0],distanceOnEdgeM:0,nextEdgeIds:approach.slice(1)},navigation:{kind:'refuel',target:station,stage:'routing'},fuelQueue:{id:`ticket-${i}`,stationId:station.id,joinedAt:i*.01,serviceStartsAt:0,serviceEndsAt:0,aheadCount:0,approachEdgeIds:approach,distanceToStationM:routeLength(approach,graph),shared:true,assignmentPending:true},energy:{...d.game.energy,remaining:10}},d.id);return d;});
 const positions=drivers.map(d=>getVehiclePosition(d.game));const result=coordinateFuelQueues(drivers,[],.1);assert.equal(result.tickets.length,8);
 for(let i=0;i<8;i++){assert.equal(result.tickets[i].id,`ticket-${i}`);if(i)assert.ok(result.tickets[i].serviceStartsAt>=result.tickets[i-1].serviceEndsAt);assert.deepEqual(getVehiclePosition(result.games.get(drivers[i].id)!),positions[i]);assert.equal(result.games.get(drivers[i].id)!.fuelQueue!.assignmentPending,false);}
 const restored=JSON.parse(JSON.stringify(result.tickets));const again=coordinateFuelQueues(drivers.map(d=>({...d,game:result.games.get(d.id)!})),restored,.2);assert.equal(new Set(again.tickets.map(t=>t.id)).size,8);
 const first=again.tickets[0];const delayed=drivers.map((d,i)=>{const game=again.games.get(d.id)!;return{...d,game:i?game:{...game,phase:'servicing' as const,navigation:{...game.navigation!,stage:'servicing' as const,endsAt:first.serviceEndsAt+2},fuelQueue:{...game.fuelQueue!,distanceToStationM:0}}};});const extended=coordinateFuelQueues(delayed,again.tickets,first.serviceStartsAt+.1);assert.equal(extended.tickets[0].serviceEndsAt,first.serviceEndsAt+2);for(let i=1;i<8;i++)assert.ok(extended.tickets[i].serviceStartsAt>=extended.tickets[i-1].serviceEndsAt,'Actual late service must delay every following driver');
});
test('dispatch uses legal cached profiles after the Worker releases redundant base graph indexes',()=>{
 getVehicleGraph('kam-fung');getVehicleGraph('private');const original={nodes:ROAD_GRAPH.nodes,edges:ROAD_GRAPH.edges,outgoing:ROAD_GRAPH.outgoing};try{ROAD_GRAPH.nodes={};ROAD_GRAPH.edges={};ROAD_GRAPH.outgoing={};const drivers=[driver('a'),driver('b')];assert.equal(availableSupply(drivers).length,2);const result=coordinateDispatch(drivers,11,0,new Map());assert.equal([...result.games.values()].filter(game=>game.currentOffer).length,1);assert.ok(result.nearby.size===2);}finally{Object.assign(ROAD_GRAPH,original);}
});

test('heading for fuel/handover and waiting in a fuel queue remain dispatchable, while rest/service/manual-stop do not',()=>{
 const station=getCompatibleStations('kam-fung')[0];
 for(const phase of ['service-route','fuel-queue']as const){
  const d=driver(`heading-${phase}`,{...source,id:`offer-${phase}`});d.game={...d.game,phase,autoAcceptOrders:true,handoverIntent:'requested',navigation:{kind:'refuel',target:station,stage:'routing',handoverAfterService:true},fuelQueue:phase==='fuel-queue'?{id:'waiting-ticket',stationId:station.id,joinedAt:0,serviceStartsAt:20,serviceEndsAt:24,aheadCount:20,approachEdgeIds:[],distanceToStationM:0}:null};
  const position=getVehiclePosition(d.game);assert.equal(availableSupply([d]).length,1);
  const result=coordinateDispatch([d],42,0,new Map());const accepted=result.games.get(d.id)!;
  assert.equal(accepted.activeTrip!.offer.id,`offer-${phase}`);assert.equal(accepted.navigation,null);assert.equal(accepted.fuelQueue,null);assert.equal(accepted.handoverIntent,'cancelled');const after=getVehiclePosition(accepted);assert.equal(after.lat,position.lat);assert.equal(after.lon,position.lon);
 }
 for(const mode of ['rest','servicing','manual-stop','deadline']as const){
  const d=driver(mode);d.game={...d.game,autoAcceptOrders:true,navigation:{kind:'refuel',target:station,stage:'routing'},phase:'service-route'};
  if(mode==='rest')d.game={...d.game,phase:'cruising',navigation:null,parking:{kind:'rest',startedAt:0}};
  if(mode==='servicing')d.game={...d.game,phase:'servicing',navigation:{...d.game.navigation!,stage:'servicing',endsAt:4}};
  if(mode==='manual-stop')d.game.acceptingOrders=false;if(mode==='deadline')d.game.clockMinutes=720;
  assert.equal(availableSupply([d]).length,0,mode);const result=coordinateDispatch([d],42,d.game.clockMinutes,new Map()).games.get(d.id)!;
  assert.equal(result.activeTrip,null,mode);assert.equal(result.currentOffer,null,mode);assert.deepEqual(result.movement,d.game.movement,mode);assert.deepEqual(result.navigation,d.game.navigation,mode);
 }
});

test('the rare-next marker does not withdraw or re-quote an already assigned next-trip card',()=>{
 let game=acceptOffer(createInitialState({seed:20261118}));const graph=getVehicleGraph(game.vehicleId),edge=graph.edges[game.activeTrip!.offer.tripRoute.at(-1)!];
 game={...game,phase:'alighting',clockMinutes:0,currentOffer:null,movement:{edgeId:edge.id,distanceOnEdgeM:edge.lengthM,nextEdgeIds:[]},activeTrip:{...game.activeTrip!,phaseEndsAt:1},dispatchManaged:true};
 const source={...game.activeTrip!.offer,id:'already-assigned-next',pickup:game.activeTrip!.offer.destination,destination:game.activeTrip!.offer.pickup,createdAt:0,requestedAt:0};
 const offer=quoteWorldOffer(game,source,{reservation:'next-trip'});assert.ok(offer);game=setDispatchOffer(game,offer);
 const driver:DispatchDriver={id:'next-driver',nickname:'Next',connected:true,left:false,forfeited:false,game};
 const previous={lastAssigned:{'next-driver':0},assignments:[{offerId:offer.id,pickupName:offer.pickup.name,destinationName:offer.destination.name,playerId:driver.id,nickname:driver.nickname,assignedAt:0,expiresAt:offer.expiresAt,status:'offered' as const,reservation:'next-trip' as const,competitors:1,declinedPlayerIds:[]}]};
 const result=coordinateDispatch([driver],42,0,new Map(),previous).games.get(driver.id)!;
 assert.equal(result.currentOffer!.id,offer.id);assert.equal(result.currentOffer!.expiresAt,offer.expiresAt);assert.equal(result.presentedOffers,game.presentedOffers);assert.equal(result.nextTripOfferForTripId,game.activeTrip!.offer.id);
});

test('recent accepted notices survive thirteen newer offered or expired records in the public view',()=>{
 const now=100000,clock=101;
 const accepted={offerId:'recent-accepted-notice',pickupName:'A',destinationName:'B',playerId:'owner',nickname:'Owner',assignedAt:100,expiresAt:105,status:'accepted' as const,acceptedAt:now-1000,competitors:8,declinedPlayerIds:[]};
 const others=Array.from({length:13},(_,index)=>({...accepted,offerId:`newer-offered-${index}`,playerId:`other-${index}`,status:'offered' as const,acceptedAt:undefined}));
 const result=coordinateDispatch([],123,clock,new Map([[accepted.offerId,accepted.playerId]]),{assignments:[accepted,...others],lastAssigned:{}},now);
 assert.ok(result.state.assignments.some(entry=>entry.offerId===accepted.offerId),'Authority history still owns the record');
 const notice=result.assignments.find(entry=>entry.offerId===accepted.offerId);
 assert.equal(notice?.status,'accepted','A one-second-old acceptance must reach another player even in a busy room');assert.equal(notice?.acceptedAt,accepted.acceptedAt);assert.equal(notice?.expiresAt,105,'Retaining a notice cannot extend its acceptance deadline');
});

test('accepted notice retention follows ten wall-clock seconds without retaining unbounded old history',()=>{
 const now=100000;
 const accepted={offerId:'at-boundary',pickupName:'A',destinationName:'B',playerId:'owner',nickname:'Owner',assignedAt:0,expiresAt:5,status:'accepted' as const,acceptedAt:now-10000,competitors:8,declinedPlayerIds:[]};
 const expired={...accepted,offerId:'outside-window',acceptedAt:now-10001};
 const future={...accepted,offerId:'invalid-future-time',acceptedAt:now+1};
 const result=coordinateDispatch([],123,1000,new Map(),{assignments:[accepted,expired,future],lastAssigned:{}},now);
 assert.deepEqual(result.assignments.map(entry=>entry.offerId),['at-boundary']);assert.equal(result.assignments[0].expiresAt,5);
});

test('public accepted notice history is deduplicated and bounded to 64 with newest events first',()=>{
 const now=100000;
 const entries=Array.from({length:90},(_,index)=>({offerId:`accepted-${index}`,pickupName:'A',destinationName:'B',playerId:`owner-${index}`,nickname:'Owner',assignedAt:100,expiresAt:105,status:'accepted' as const,acceptedAt:now-9000+index*50,competitors:8,declinedPlayerIds:[]}));
 const result=coordinateDispatch([],123,101,new Map(),{assignments:entries,lastAssigned:{}},now);
 assert.equal(result.assignments.length,64);assert.equal(new Set(result.assignments.map(entry=>entry.offerId)).size,64);assert.equal(result.assignments[0].offerId,'accepted-89');
 assert.ok(result.assignments.every(entry=>entry.acceptedAt!==undefined&&now-entry.acceptedAt<=10000));
});
