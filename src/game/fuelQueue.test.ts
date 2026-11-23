/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptNextOffer, acceptOffer, cancelTrip, advanceGame, applyFuelQueueAssignment, canCompleteOfferBeforeHandover, configureSharedFuelQueues, configureLegacyGameRules, createInitialState, getFuelQueueEstimate, getHandoverPlan, getNearbyCandidates, getPhaseRemainingMinutes, getRouteEventOptions, getVehiclePosition, navigateToHandover, navigateToStation, quoteWorldOffer, resolveRouteEvent, resumeDriving, setAcceptingOrders, setDispatchOffer } from './engine';
import { allocateFuelQueue, fuelQueueBaseline, stationQueueApproach, stationQueueApproachDetails } from './fuelQueue';
import {getCompatibleStations} from '../data/serviceStations';
import {getVehicleRoadGraph} from '../data/vehicleAccess';
import type { EnergyStation, GameState, Landmark, RoadGraph } from './types';

const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
for(const [id,lat,lon] of [['a',22.30,114.16],['b',22.302,114.16],['c',22.304,114.16],['d',22.302,114.162],['e',22.304,114.162]] as const)graph.nodes[id]={id,lat,lon};
for(const [from,to] of [['a','b'],['b','c'],['c','e'],['e','d'],['d','a'],['b','d'],['d','c']] as const){const id=`${from}-${to}`;graph.edges[id]={id,from,to,lengthM:250,speedKph:24,roadClass:'local',name:'測試街',safeStop:true};(graph.outgoing[from]||=[]).push(id);}
const landmarks:Landmark[]=[{...graph.nodes.a,id:'harbour-city',nodeId:'a',name:'海港城',district:'油尖旺區',kind:'shopping'},{...graph.nodes.c,id:'megabox',nodeId:'c',name:'MegaBox',district:'觀塘區',kind:'shopping'},{...graph.nodes.d,id:'third',nodeId:'d',name:'第三地點',district:'油尖旺區',kind:'shopping'}];
const station:EnergyStation={...graph.nodes.c,id:'queue-station',name:'氣站',kind:'lpg',nodeId:'c',dedicated:true,serviceMinutes:4,unitPrice:4};
const fresh=()=>createInitialState({graph,landmarks,seed:42,startNodeId:'a',startTimeMinutes:270,handoverPlace:landmarks[0]});

test('turnover queue rises from 04/16 and reaches twenty minutes by 04:30/16:30',()=>{
  for(const offset of [0,720]){
    assert.ok(fuelQueueBaseline(station,240+offset).waitMinutes>fuelQueueBaseline(station,239+offset).waitMinutes);
    assert.ok(fuelQueueBaseline(station,270+offset).waitMinutes>=20);
    assert.ok(fuelQueueBaseline(station,300+offset).waitMinutes>=20);
  }
  assert.equal(fuelQueueBaseline({...station,kind:'petrol'},270).waitMinutes,0);
});

test('canonical queue approach follows safe connected incoming road direction',()=>{
  const ids=stationQueueApproach(station,graph);assert.ok(ids.length>0);
  ids.forEach((id,index)=>{assert.equal(graph.edges[id].safeStop,true);if(index)assert.equal(graph.edges[ids[index-1]].to,graph.edges[id].from);});
  assert.equal(graph.edges[ids.at(-1)!].to,station.nodeId);
});

test('single-player queue physically creeps forward then spends actual service time',()=>{
  const initial=fresh();let state=navigateToStation(initial,station,graph);
  assert.deepEqual(getVehiclePosition(state,graph),getVehiclePosition(initial,graph));
  for(let i=0;i<80&&state.phase==='service-route';i++)state=advanceGame(state,.25,graph);
  assert.equal(state.phase,'fuel-queue');const joined=state.fuelQueue!;const before=state.totalDistanceM;
  const early=advanceGame(state,2,graph);assert.equal(early.phase,'fuel-queue');assert.ok(early.totalDistanceM>before);
  assert.ok(early.fuelQueue!.distanceToStationM<joined.distanceToStationM);assert.equal(early.energy.remaining<initial.energy.remaining,true);
  state=advanceGame(early,Math.max(0,joined.serviceStartsAt-early.clockMinutes)+.3,graph);
  assert.equal(state.phase,'servicing');assert.ok(getPhaseRemainingMinutes(state)>3.5);
  state=advanceGame(state,getPhaseRemainingMinutes(state),graph);assert.equal(state.fuelQueue,null);assert.equal(state.energy.remaining,state.energy.capacity);
});

test('shared FIFO assignment holds for authority and gives earlier arrival earlier service',()=>{
  let state=navigateToStation(configureSharedFuelQueues(fresh(),'first-player'),station,graph);
  for(let i=0;i<80&&state.phase==='service-route';i++)state=advanceGame(state,.25,graph);
  assert.equal(state.fuelQueue?.assignmentPending,true);
  const distance=state.totalDistanceM;const frozen=advanceGame(state,1,graph);assert.equal(frozen.totalDistanceM,distance);
  const ticket=state.fuelQueue!;
  const assignments=allocateFuelQueue([{id:'later-player',stationId:station.id,joinedAt:ticket.joinedAt+1,serviceMinutes:4,initialWaitMinutes:20},{id:ticket.id,stationId:station.id,joinedAt:ticket.joinedAt,serviceMinutes:4,initialWaitMinutes:20}]);
  assert.equal(assignments[0].id,ticket.id);assert.ok(assignments[1].serviceStartsAt>=assignments[0].serviceEndsAt);
  state=applyFuelQueueAssignment(frozen,assignments[0]);assert.equal(state.fuelQueue?.assignmentPending,false);
  assert.equal(applyFuelQueueAssignment(state,{...assignments[0],id:'stale-ticket'}),state);
  assert.equal(resumeDriving(state,graph).fuelQueue,null);
});

test('handover planning includes queue plus fuel and does not allow late return or impossible offer',()=>{
  let state=fresh();state={...state,startTimeMinutes:300,clockMinutes:705,currentOffer:null};
  const plan=getHandoverPlan(state,graph,station);assert.ok(plan.queueMinutes!>=20);assert.equal(plan.canFinishRefuelAndReturn,false);
  const offer={...fresh().currentOffer!,createdAt:719,expiresAt:724};state={...state,clockMinutes:719,currentOffer:offer};
  assert.equal(canCompleteOfferBeforeHandover(state,offer,graph),false);assert.equal(acceptOffer(state,graph),state);
  const ended=advanceGame({...state,movement:{...state.movement,distanceOnEdgeM:100},energy:{...state.energy,remaining:0}},10,graph);assert.equal(ended.clockMinutes,720);assert.equal(ended.phase,'ended');assert.equal(ended.handoverStatus,'missed');assert.equal(ended.summary?.overtimeMinutes,0);
  const ontime=advanceGame(navigateToHandover({...fresh(),clockMinutes:710},graph),10,graph);assert.equal(ontime.handoverStatus,'on-time');assert.ok(ontime.clockMinutes<=720);
});

test('next-trip acceptance keeps current passenger and route until alighting completes',()=>{
  let state=acceptOffer(fresh(),graph);state=advanceGame(state,state.activeTrip!.waitMinutes+state.activeTrip!.boardingMinutes+.05,graph);
  assert.equal(state.phase,'dropoff');
  const oldTrip=state.activeTrip!;const before=[state.movement.edgeId,...state.movement.nextEdgeIds];
  const source={...oldTrip.offer,id:'next-request',pickup:landmarks[1],destination:landmarks[2],tripRoute:['c-e','e-d'],createdAt:state.clockMinutes,expiresAt:state.clockMinutes+4};
  const offer=quoteWorldOffer(state,source,{reservation:'next-trip'},graph);assert.ok(offer);
  state=setDispatchOffer(state,offer);state=acceptNextOffer(state,'next-request',graph);
  assert.equal(state.activeTrip?.offer.id,oldTrip.offer.id);assert.equal(state.queuedTrip?.offer.id,'next-request');assert.deepEqual([state.movement.edgeId,...state.movement.nextEdgeIds],before);
  for(let i=0;i<100&&state.phase!=='alighting';i++)state=advanceGame(state,.05,graph);
  assert.equal(state.phase,'alighting');assert.equal(state.activeTrip?.offer.id,oldTrip.offer.id);assert.equal(state.completedTrips,0);
  state=advanceGame(state,getPhaseRemainingMinutes(state),graph);
  assert.equal(state.completedTrips,1);assert.equal(state.queuedTrip,null);assert.equal(state.activeTrip?.offer.id,'next-request');assert.ok(['pickup','waiting'].includes(state.phase));
});

test('rerouting replaces passenger or handover path and excludes affected edge; impossible choice is unavailable',()=>{
  let state=acceptOffer(fresh(),graph);state=advanceGame(state,state.activeTrip!.waitMinutes+state.activeTrip!.boardingMinutes+.05,graph);
  state.routeEvent={id:'blocked',title:'工程',description:'',roadName:'測試街',affectedEdgeId:'b-c',startedAt:state.clockMinutes,expiresAt:state.clockMinutes+12,resolved:false};
  assert.equal(getRouteEventOptions(state,graph).reroute,true);
  const changed=resolveRouteEvent(state,'reroute',graph);assert.equal(changed.routeEvent?.choice,'reroute');assert.equal(changed.movement.nextEdgeIds.includes('b-c'),false);assert.ok(changed.movement.nextEdgeIds.includes('b-d'));
  const currentBlocked={...state,routeEvent:{...state.routeEvent,affectedEdgeId:state.movement.edgeId}};
  assert.equal(getRouteEventOptions(currentBlocked,graph).reroute,false);assert.deepEqual(resolveRouteEvent(currentBlocked,'reroute',graph).movement,state.movement);
});


test('upstream holding road is safe and a final arterial connector is driven without queue stops',()=>{
  const road:RoadGraph={...graph,edges:{...graph.edges,'b-c':{...graph.edges['b-c'],safeStop:false,roadClass:'arterial'},'d-c':{...graph.edges['d-c'],safeStop:false,roadClass:'arterial'}}};
  const details=stationQueueApproachDetails(station,road);assert.ok(details.connectorDistanceM>0);assert.ok(details.edgeIds.length>details.connectorEdgeIds.length);
  let state=navigateToStation(createInitialState({graph:road,landmarks,seed:42,startNodeId:'a',startTimeMinutes:270}),station,road);
  for(let n=0;n<700&&state.phase!=='servicing';n++){
    const before=state;state=advanceGame(state,.05,road);
    if(state.phase==='fuel-queue'&&state.fuelQueue&&!state.fuelQueue.assignmentPending&&state.fuelQueue.serviceStartsAt-state.clockMinutes>(state.fuelQueue.connectorMinutes||0)+.05)assert.equal(road.edges[state.movement.edgeId].safeStop,true);
    if(before.phase==='fuel-queue'&&road.edges[before.movement.edgeId].safeStop===false&&state.phase==='fuel-queue')assert.ok(state.totalDistanceM>before.totalDistanceM,'no waiting on connector');
  }
  assert.equal(state.phase,'servicing');
});

test('legacy rooms retain supported servicing phase and never accept queued trips',()=>{
  const legacy=configureLegacyGameRules(fresh());assert.equal(legacy.nextTripEnabled,false);
  const atStation={...station,...graph.nodes.a,nodeId:'a'};
  assert.equal(navigateToStation(legacy,atStation,graph).phase,'servicing');
});


test('lifetime presented-offer count never decreases when cards are withdrawn and reissued',()=>{
  let state=fresh();const offer=state.currentOffer!;assert.equal(state.presentedOffers,1);
  state=setAcceptingOrders(state,false);assert.equal(state.platform.offered,0);assert.equal(state.presentedOffers,1);
  state=setAcceptingOrders(state,true);state=setDispatchOffer(state,{...offer,id:'second-card'});assert.equal(state.presentedOffers,2);
  state=setAcceptingOrders(state,false);assert.equal(state.presentedOffers,2);
  state=setAcceptingOrders(state,true);state=setDispatchOffer(state,{...offer,id:'third-card'});assert.equal(state.presentedOffers,3);
});


test('server-managed dispatch counts only explicitly published cards',()=>{
  let state=createInitialState({graph,landmarks,seed:42,startNodeId:'a',dispatchManaged:true});
  assert.equal(state.currentOffer,null);assert.equal(state.presentedOffers,0);
  state=advanceGame(state,10,graph);assert.equal(state.currentOffer,null);assert.equal(state.presentedOffers,0);
  const quoted=quoteWorldOffer(state,fresh().currentOffer!,{},graph);assert.ok(quoted);
  state=setDispatchOffer(state,quoted);assert.equal(state.presentedOffers,1);assert.equal(state.currentOffer?.id,quoted.id);
});


test('an underfilled driver refuels before automatic handover and never reports unprepared arrival as complete',()=>{
  const road=getVehicleRoadGraph('kam-fung'),target=getCompatibleStations('kam-fung').find(station=>station.id==='emsd-lpg-27')!;
  const place:Landmark={...target,id:'qa-real-station-handover',name:target.name,district:target.district||'',kind:'transport'};
  const approach=stationQueueApproachDetails(target,road),entry=road.edges[approach.edgeIds[0]];
  let state=createInitialState({graph:road,vehicleId:'kam-fung',startNodeId:entry.from,startTimeMinutes:270,initialEnergyFraction:.2,handoverPlace:place});
  state={...state,movement:{edgeId:entry.id,distanceOnEdgeM:0,nextEdgeIds:[]},currentOffer:null,nextDemandMinute:100000,nextEventMinute:100000};
  const plan=getHandoverPlan(state,road);assert.equal(plan.needsRefuel,true);assert.equal(plan.handoverReady,false);assert.ok(plan.refuelStation);assert.ok(plan.totalRequiredMinutes>=24);
  state=navigateToHandover(state,road);assert.equal(state.navigation?.handoverAfterService,true);assert.notEqual(state.phase,'ended');
  for(let n=0;n<600&&state.phase!=='ended';n++)state=advanceGame(state,.1,road);
  assert.equal(state.phase,'ended');assert.equal(state.handoverStatus,'on-time');assert.ok(state.energy.remaining/state.energy.capacity>=getHandoverPlan(state,road).requiredEnergyFraction-1e-8);
  const atStation=createInitialState({graph:road,vehicleId:'kam-fung',startNodeId:target.nodeId,initialEnergyFraction:.2,handoverPlace:place});
  const unfinished={...atStation,clockMinutes:719.9,phase:'servicing' as const,currentOffer:null,nextDemandMinute:100000,nextEventMinute:100000,navigation:{kind:'refuel' as const,target,stage:'servicing' as const,endsAt:724}};
  const expired=advanceGame(unfinished,1,road);assert.equal(expired.handoverStatus,'missed');assert.equal(expired.phase,'servicing');assert.equal(expired.summary,null);assert.ok(Math.abs(expired.clockMinutes-720.9)<1e-8);
  const settled=advanceGame(expired,10,road);assert.equal(settled.phase,'ended');assert.equal(settled.shiftEndReason,'fuel-completed-late');assert.equal(settled.handoverStatus,'missed');assert.equal(settled.clockMinutes,724);assert.equal(settled.energy.remaining,settled.energy.capacity);assert.equal(settled.summary?.overtimeMinutes,4);
});

test('near-deadline offer budget includes required queue, full service and return fuel readiness',()=>{
  const road=getVehicleRoadGraph('kam-fung'),target=getCompatibleStations('kam-fung').find(station=>station.id==='emsd-lpg-27')!;
  const place:Landmark={...target,id:'qa-fuel-budget-pickup',name:target.name,district:target.district||'',kind:'transport'};
  let full=createInitialState({graph:road,vehicleId:'kam-fung',startNodeId:target.nodeId,handoverPlace:place,startTimeMinutes:300});
  full={...full,clockMinutes:695,currentOffer:null,nextDemandMinute:100000,nextEventMinute:100000};
  const source=fresh().currentOffer!;let found=false;
  for(const destination of getNearbyCandidates(full,1200,30,road)){
    if(destination.nodeId===target.nodeId)continue;
    const offer=quoteWorldOffer(full,{...source,id:'fuel-budget-test',pickup:place,destination,tripRoute:[]},{},road);
    if(!offer)continue;
    assert.equal(canCompleteOfferBeforeHandover(full,offer,road),true);
    const low={...full,energy:{...full.energy,remaining:full.energy.capacity*.3}};
    assert.equal(canCompleteOfferBeforeHandover(low,offer,road),false,'twenty-minute turnover queue plus service leaves too little time');found=true;break;
  }
  assert.ok(found,'at least one short real nearby trip fits with an already prepared tank');
});

test('legacy low-tank handover remains supported without the new preparation requirement',()=>{
  let state=configureLegacyGameRules(fresh());state={...state,energy:{...state.energy,remaining:state.energy.capacity*.2}};
  const ended=navigateToHandover(state,graph);assert.equal(ended.phase,'ended');assert.equal(ended.handoverStatus,'on-time');
});


test('asking for handover while queueing or filling preserves the existing FIFO ticket and service',()=>{
  let state=navigateToStation(fresh(),station,graph);for(let n=0;n<80&&state.phase==='service-route';n++)state=advanceGame(state,.05,graph);
  assert.equal(state.phase,'fuel-queue');const before=state;
  state=navigateToHandover(state,graph);assert.deepEqual(state.fuelQueue,before.fuelQueue);assert.deepEqual(state.movement,before.movement);assert.equal(state.navigation?.handoverAfterService,true);assert.equal(navigateToHandover(state,graph),state);
  const filling={...before,phase:'servicing' as const,navigation:{...before.navigation!,stage:'servicing' as const,endsAt:24}};
  const attached=navigateToHandover(filling,graph);assert.equal(attached.navigation?.endsAt,24);assert.deepEqual(attached.fuelQueue,filling.fuelQueue);assert.equal(attached.navigation?.handoverAfterService,true);
});


test('cancelling the current passenger retracts an unaccepted next card without a false decline',()=>{
  let state=acceptOffer(fresh(),graph);state=advanceGame(state,state.activeTrip!.waitMinutes+state.activeTrip!.boardingMinutes+.05,graph);
  const source={...state.activeTrip!.offer,id:'unaccepted-next-card',pickup:landmarks[1],destination:landmarks[2],tripRoute:['c-e','e-d']};
  const offer=quoteWorldOffer(state,source,{reservation:'next-trip'},graph);assert.ok(offer);state=setDispatchOffer(state,offer);const shown=state.presentedOffers,declined=state.declinedOffers,offered=state.platform.offered;
  const cancelled=cancelTrip(state,graph);assert.equal(cancelled.phase,'safe-dropoff');assert.equal(cancelled.currentOffer,null);assert.equal(cancelled.declinedOffers,declined);assert.equal(cancelled.presentedOffers,shown);assert.equal(cancelled.platform.offered,offered-1);
});


test('a new driver already near the forecourt must join via the queue entrance rather than cut ahead',()=>{
  const approach=stationQueueApproachDetails(station,graph);const safePrefix=approach.edgeIds.slice(0,approach.edgeIds.length-approach.connectorEdgeIds.length),edge=graph.edges[safePrefix.at(-1)!];
  const before={...fresh(),movement:{edgeId:edge.id,distanceOnEdgeM:edge.lengthM*.8,nextEdgeIds:[]}};
  const routed=navigateToStation(before,station,graph);assert.equal(routed.phase,'service-route');assert.equal(routed.fuelQueue,null);assert.deepEqual(getVehiclePosition(routed,graph),getVehiclePosition(before,graph));assert.ok(routed.movement.nextEdgeIds.includes(approach.edgeIds[0]));
});
