import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptOffer,advanceGame,applyFuelQueueAssignment,cancelHandover,canReceiveOffer,configureLegacyGameRules,configureSharedFuelQueues,createInitialState,declineOffer,getHandoverPlan,getVehicleGraph,getVehiclePosition,isShiftSettlementPending,MAX_SHIFT_END_MINUTE,navigateToHandover,navigateToStation,normalizeGameState,parkForRest,quoteWorldOffer,resumeDriving,setAcceptingOrders,setAutoAcceptOrders,setDispatchOffer,stationQueueApproach} from './engine';
import {nextTripEligibility,shouldDispatchNextTrip} from './demandField';
import {getCompatibleStations} from '../data/serviceStations';
import type {EnergyStation,GameState,Landmark,RoadGraph} from './types';

const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
for(const[id,lat,lon]of [['a',22.30,114.16],['b',22.302,114.16],['c',22.304,114.16],['d',22.302,114.162]]as const)graph.nodes[id]={id,lat,lon};
for(const[from,to]of [['a','b'],['b','c'],['c','d'],['d','a'],['b','d']]as const)for(const[start,end]of [[from,to],[to,from]]){const id=`${start}-${end}`;graph.edges[id]={id,from:start,to:end,lengthM:250,speedKph:24,roadClass:'local',name:'測試街',safeStop:true};(graph.outgoing[start]||=[]).push(id);}
const places:Landmark[]=[{...graph.nodes.a,id:'harbour-city',name:'海港城',district:'油尖旺區',kind:'shopping',nodeId:'a'},{...graph.nodes.c,id:'megabox',name:'MegaBox',district:'觀塘區',kind:'shopping',nodeId:'c'},{...graph.nodes.d,id:'third',name:'第三地點',district:'東區',kind:'shopping',nodeId:'d'}];
const station:EnergyStation={...graph.nodes.c,id:'late-fuel',name:'補給站',nodeId:'c',kind:'lpg',serviceMinutes:4,unitPrice:4};
const fresh=(options:Partial<Parameters<typeof createInitialState>[0]>={})=>createInitialState({graph,landmarks:places,seed:42,startNodeId:'a',startTimeMinutes:270,handoverPlace:places[0],...options});
const quiet=(state:GameState):GameState=>({...state,currentOffer:null,nextDemandMinute:100000,nextEventMinute:100000,nextHandoverReviewMinute:100000});
const parkingGraph:RoadGraph={...graph,edges:{...graph.edges,'a-b':{...graph.edges['a-b'],roadClass:'parking',name:'測試公共停車場通道'}}};
function queue(shared=false):GameState{const approach=stationQueueApproach(station,graph),edge=graph.edges[approach[0]];let state=quiet(fresh({startNodeId:edge.from,initialEnergyFraction:.2}));state={...state,clockMinutes:719,movement:{edgeId:edge.id,distanceOnEdgeM:0,nextEdgeIds:[]}};if(shared)state=configureSharedFuelQueues(state,'late-driver');return navigateToStation(state,station,graph);}
function filling():GameState{return{...quiet(fresh()),clockMinutes:719.5,phase:'servicing',movement:{edgeId:'b-c',distanceOnEdgeM:250,nextEdgeIds:[]},navigation:{kind:'refuel',target:station,stage:'servicing',endsAt:724,handoverAfterService:true},handoverIntent:'requested',energy:{...fresh().energy,remaining:20,unitPricePaid:4.57},operatingCost:12.34};}

test('a queue already joined at twelve hours keeps its ticket and completes fuel before late summary',()=>{
 const initial=queue(),ticket=initial.fuelQueue!;assert.ok(ticket);
 const pending=advanceGame(initial,2,graph);assert.equal(pending.phase,'fuel-queue');assert.equal(pending.clockMinutes,721);assert.equal(pending.fuelQueue!.id,ticket.id);assert.equal(pending.fuelQueue!.joinedAt,ticket.joinedAt);assert.equal(pending.summary,null);assert.equal(isShiftSettlementPending(pending),true);assert.equal(pending.acceptingOrders,false);
 const ended=advanceGame(pending,100,graph);assert.equal(ended.phase,'ended');assert.equal(ended.shiftEndReason,'fuel-completed-late');assert.equal(ended.handoverStatus,'missed');assert.ok(ended.clockMinutes>720&&ended.clockMinutes<MAX_SHIFT_END_MINUTE);assert.equal(ended.energy.remaining,ended.energy.capacity);assert.ok(ended.operatingCost>initial.operatingCost);assert.equal(ended.grossIncome,0);assert.equal(ended.summary!.overtimeMinutes,ended.clockMinutes-720);
});
test('servicing survives restart, applies refill pricing before summary, and never charges consumption twice',()=>{
 const initial=filling(),pending=advanceGame(initial,1.5,graph);assert.equal(pending.clockMinutes,721);assert.equal(pending.phase,'servicing');
 const saved=JSON.parse(JSON.stringify(pending));const restored=normalizeGameState(saved,graph)!;assert.ok(restored);assert.deepEqual(restored.deadlineSettlement,pending.deadlineSettlement);assert.notEqual(restored.deadlineSettlement,pending.deadlineSettlement);
 const ended=advanceGame(restored,20,graph);assert.equal(ended.clockMinutes,724);assert.equal(ended.phase,'ended');assert.equal(ended.navigation,null);assert.equal(ended.shiftEndReason,'fuel-completed-late');assert.equal(ended.summary!.overtimeMinutes,4);assert.equal(ended.energy.remaining,ended.energy.capacity);assert.equal(ended.operatingCost,12.34);assert.equal(ended.summary!.expenses,492.34);
 const expected=(20*4.57+(ended.energy.capacity-20)*4)/ended.energy.capacity;assert.ok(Math.abs(ended.energy.unitPricePaid-expected)<1e-10);assert.equal(ended.summary!.shiftEndReason,'fuel-completed-late');assert.equal(advanceGame(ended,20,graph),ended);
});
test('a shared pending ticket survives the deadline and restore before a real authority assignment',()=>{
 let state=advanceGame(queue(true),2,graph);const ticket=state.fuelQueue!;assert.equal(ticket.assignmentPending,true);const point=getVehiclePosition(state,graph);state=normalizeGameState(JSON.parse(JSON.stringify(state)),graph)!;
 const assigned=applyFuelQueueAssignment(state,{id:ticket.id,stationId:ticket.stationId,joinedAt:ticket.joinedAt,serviceStartsAt:725,serviceEndsAt:729,aheadCount:0});assert.deepEqual(getVehiclePosition(assigned,graph),point);assert.equal(assigned.fuelQueue!.id,ticket.id);
 const ended=advanceGame(assigned,30,graph);assert.equal(ended.phase,'ended');assert.equal(ended.shiftEndReason,'fuel-completed-late');assert.ok(ended.clockMinutes>=729);assert.equal(ended.energy.remaining,ended.energy.capacity);
});
test('explicitly leaving an overdue queue ends late immediately without a refill or re-entry',()=>{
 const waiting=advanceGame(queue(),2,graph),energy=waiting.energy.remaining;const left=resumeDriving(waiting,graph);assert.equal(left.phase,'ended');assert.equal(left.clockMinutes,waiting.clockMinutes);assert.equal(left.shiftEndReason,'fuel-cancelled-late');assert.equal(left.energy.remaining,energy);assert.equal(left.navigation,null);assert.equal(left.fuelQueue,null);assert.equal(advanceGame(left,10,graph),left);
});
test('an unavailable shared assignment has a finite deadline and cannot freeze a shift forever',()=>{
 const pending=queue(true);const ended=advanceGame(pending,1000,graph);assert.equal(ended.phase,'ended');assert.equal(ended.clockMinutes,960);assert.equal(ended.shiftEndReason,'fuel-timeout');assert.equal(ended.summary!.overtimeMinutes,240);assert.ok(ended.energy.remaining<ended.energy.capacity);
 const legacy=advanceGame(configureLegacyGameRules(filling()),100,graph);assert.equal(legacy.clockMinutes,720);assert.equal(legacy.phase,'ended');assert.equal(legacy.deadlineSettlement,undefined);
});
test('cancelling handover remains cancelled across ticks and restore even when the plan is urgent',()=>{
 let state={...quiet(fresh({handoverPlace:places[1]})),clockMinutes:719};state=navigateToHandover(state,graph);assert.equal(state.navigation!.kind,'handover');state=cancelHandover(state,graph);assert.equal(state.handoverIntent,'cancelled');assert.equal(state.navigation,null);
 state=advanceGame(state,.2,graph);assert.equal(state.navigation,null);state=normalizeGameState(JSON.parse(JSON.stringify(state)),graph)!;state=advanceGame(state,.2,graph);assert.equal(state.navigation,null);assert.equal(state.handoverIntent,'cancelled');assert.equal(state.phase,'cruising');
});
test('cancelling fuel-followed-by-handover preserves queue/service; switching route to a station is explicit',()=>{
 let waiting=navigateToHandover({...queue(),clockMinutes:690},graph);const ticket=waiting.fuelQueue!,movement=waiting.movement;const cancelled=cancelHandover(waiting,graph);assert.deepEqual(cancelled.fuelQueue,ticket);assert.deepEqual(cancelled.movement,movement);assert.equal(cancelled.navigation!.handoverAfterService,false);assert.equal(cancelled.handoverIntent,'cancelled');
 const service=filling(),stopped=cancelHandover(service,graph);assert.equal(stopped.navigation!.endsAt,724);assert.equal(stopped.phase,'servicing');assert.equal(stopped.navigation!.handoverAfterService,false);
 const before=navigateToHandover({...quiet(fresh({handoverPlace:places[1]})),clockMinutes:690},graph),switched=navigateToStation(before,station,graph);assert.equal(switched.navigation!.target.id,station.id);assert.equal(switched.handoverIntent,'cancelled');assert.equal(switched.navigation!.handoverAfterService,undefined);assert.deepEqual(getVehiclePosition(switched,graph),getVehiclePosition(before,graph));
});
test('real handover reminder budgets the station approach, queue, service and return before one hour',()=>{
 const road=getVehicleGraph('kam-fung'),target=getCompatibleStations('kam-fung').filter(s=>s.lon<114&&!!road.nodes[s.nodeId]).sort((a,b)=>a.lon-b.lon)[0];assert.ok(target);
 const place:Landmark={...target,id:'reminder-handover',district:target.district||'',kind:'transport'};let state=quiet(createInitialState({seed:42,initialEnergyFraction:.3,handoverPlace:place,startTimeMinutes:300}));state={...state,clockMinutes:600,nextHandoverReviewMinute:600,parking:{kind:'rest',startedAt:600},acceptingOrders:false};
 const plan=getHandoverPlan(state,road);assert.equal(plan.needsRefuel,true);assert.ok(plan.refuelStation);assert.ok(plan.reminderLeadMinutes>60);assert.ok(plan.reminderAtMinute<660);assert.ok(Math.abs(plan.totalRequiredMinutes-(plan.stationDetourMinutes!+plan.queueMinutes!+plan.serviceMinutes!+2))<1e-8);
 for(let n=0;n<240&&!state.handoverReminderShown;n++)state=advanceGame(state,.25,road);assert.equal(state.handoverReminderShown,true);assert.ok(state.logs.some(log=>log.kind==='shift'&&log.text.includes('交更安排提醒')&&log.minute<660));assert.equal(state.navigation,null,'a reminder is advisory');
});
test('automatic acceptance handles an existing card and the initial card exactly once',()=>{
 const manual=fresh(),offer=manual.currentOffer!;assert.ok(offer);const enabled=setAutoAcceptOrders(manual,true,graph);assert.equal(enabled.acceptedOffers,1);assert.equal(enabled.currentOffer,null);assert.equal(enabled.activeTrip!.offer.id,offer.id);assert.equal(enabled.activeTrip!.fareOnCompletion,offer.estimatedFare);assert.equal(setAutoAcceptOrders(enabled,true,graph),enabled);
 const initial=fresh({autoAcceptOrders:true});assert.equal(initial.acceptedOffers,1);assert.equal(initial.presentedOffers,1);assert.equal(initial.currentOffer,null);assert.equal(initial.grossIncome,0);assert.equal(manual.acceptedOffers,0);
});
test('automatic acceptance handles generated solo and published shared cards inside the engine state',()=>{
 let solo:GameState={...fresh({autoAcceptOrders:true,dispatchManaged:true,handoverPlace:null}),dispatchManaged:false,nextDemandMinute:.25,currentOffer:null,autoAcceptOrders:true};for(let n=0;n<240&&!solo.acceptedOffers;n++)solo=advanceGame(solo,.25,graph);assert.equal(solo.acceptedOffers,1);assert.ok(solo.activeTrip);assert.equal(solo.currentOffer,null);
 const managed=fresh({dispatchManaged:true,autoAcceptOrders:true});const shared=setDispatchOffer(managed,{...fresh().currentOffer!,id:'published-shared'},graph);assert.equal(shared.activeTrip!.offer.id,'published-shared');assert.equal(shared.acceptedOffers,1);assert.equal(shared.presentedOffers,1);assert.equal(shared.currentOffer,null);
});
test('auto mode cannot resurrect an expired, offline, suspended, ended or deadline offer',()=>{
 const original=fresh();for(const state of [{...original,clockMinutes:10},{...original,acceptingOrders:false},{...original,platform:{...original.platform,suspendedUntil:60}},{...original,clockMinutes:720}]){const next=setAutoAcceptOrders(state,true,graph);assert.equal(next.acceptedOffers,0);assert.equal(next.activeTrip,null);}
 const ended=advanceGame({...quiet(original),handoverPlace:null},800,graph);assert.equal(setAutoAcceptOrders(ended,true,graph),ended);
});
test('an automatically accepted next trip preserves its current passenger, pricing and reservation counter',()=>{
 let state=acceptOffer(fresh(),graph);state=advanceGame(state,state.activeTrip!.waitMinutes+state.activeTrip!.boardingMinutes+.01,graph);const original=state.activeTrip!,route=[state.movement.edgeId,...state.movement.nextEdgeIds];const source={...original.offer,id:'auto-next',pickup:places[1],destination:places[2]};const offer=quoteWorldOffer(state,source,{reservation:'next-trip'},graph);assert.ok(offer);
 state=setAutoAcceptOrders(state,true,graph);const accepted=setDispatchOffer(state,offer,graph);assert.equal(accepted.activeTrip!.offer.id,original.offer.id);assert.equal(accepted.queuedTrip!.offer.id,'auto-next');assert.equal(accepted.queuedTrip!.fareOnCompletion,offer.estimatedFare);assert.deepEqual([accepted.movement.edgeId,...accepted.movement.nextEdgeIds],route);assert.equal(accepted.acceptedOffers,2);assert.equal(accepted.currentOffer,null);assert.equal(accepted.nextTripOfferForTripId,original.offer.id);assert.ok(accepted.nextTripOfferCooldownUntil!>accepted.clockMinutes);
});
test('next-trip eligibility is regional and reproducible rather than rerolled on each tick',()=>{
 let island=0,other=0;for(let n=0;n<5000;n++){const id=`regional-trip-${n}`;if(nextTripEligibility(42,id,'東區'))island++;if(nextTripEligibility(42,id,'觀塘區'))other++;assert.equal(nextTripEligibility(42,id,'東區'),nextTripEligibility(42,id,'東區'));}assert.ok(island>950&&island<1250);assert.ok(other>140&&other<270);
 const rejected=Array.from({length:100},(_,n)=>`rejected-${n}`).find(id=>!nextTripEligibility(42,id,'東區'))!;let state=acceptOffer(fresh(),graph);state={...state,phase:'dropoff',activeTrip:{...state.activeTrip!,offer:{...state.activeTrip!.offer,id:rejected,destination:places[2]}}};for(let n=0;n<100;n++)assert.equal(shouldDispatchNextTrip({...state,clockMinutes:n/10},500,2),false);
});
test('a published next-card attempt is remembered through decline and restore, without blocking its manual acceptance',()=>{
 let state=acceptOffer(fresh(),graph);state=advanceGame(state,state.activeTrip!.waitMinutes+state.activeTrip!.boardingMinutes+.01,graph);const source={...state.activeTrip!.offer,id:'one-next-card',pickup:places[1],destination:places[2]};const offer=quoteWorldOffer(state,source,{reservation:'next-trip'},graph);assert.ok(offer);state=setDispatchOffer(state,offer,graph);assert.equal(shouldDispatchNextTrip(state,500,2),false);assert.equal(acceptOffer(state,graph).queuedTrip!.offer.id,offer.id);
 const declined=normalizeGameState(JSON.parse(JSON.stringify(declineOffer(state))),graph)!;assert.equal(declined.nextTripOfferForTripId,state.activeTrip!.offer.id);assert.equal(shouldDispatchNextTrip({...declined,clockMinutes:declined.clockMinutes+40},500,2),false);assert.equal(shouldDispatchNextTrip({...declined,nextTripOfferForTripId:undefined,nextTripOfferCooldownUntil:undefined},701,2),false);assert.equal(shouldDispatchNextTrip({...declined,nextTripOfferForTripId:undefined,nextTripOfferCooldownUntil:undefined},500,3.1),false);
});
test('handover and station routes keep the dispatch preference; accepting safely replaces navigation',()=>{
 const initial=quiet(fresh({handoverPlace:places[1]})),source=fresh().currentOffer!;
 for(const state of [navigateToHandover(initial,graph),navigateToStation(initial,station,graph)]){
  assert.equal(state.acceptingOrders,true);assert.equal(canReceiveOffer(state),true);const point=getVehiclePosition(state,graph);const offered=setDispatchOffer(state,{...source,id:`route-offer-${state.navigation!.kind}`},graph);const accepted=acceptOffer(offered,graph);assert.equal(accepted.acceptedOffers,1);assert.equal(accepted.navigation,null);assert.equal(accepted.fuelQueue,null);assert.deepEqual(getVehiclePosition(accepted,graph),point);if(state.navigation!.kind==='handover')assert.equal(accepted.handoverIntent,'cancelled');
  const stopped=setAcceptingOrders(state,false),moved=advanceGame(stopped,.2,graph);assert.equal(stopped.parking,null);assert.ok(moved.totalDistanceM>stopped.totalDistanceM);assert.equal(moved.acceptingOrders,false);
 }
});
test('a pre-deadline queue can accept and release its ticket, while a pump and settlement remain busy',()=>{
 const queued={...queue(),clockMinutes:10,handoverPlace:null};assert.equal(canReceiveOffer(queued),true);const source={...fresh().currentOffer!,id:'leave-queue-order',createdAt:10,expiresAt:14};const offered=setDispatchOffer(queued,source,graph),accepted=acceptOffer(offered,graph);assert.equal(accepted.acceptedOffers,1);assert.equal(accepted.fuelQueue,null);assert.equal(accepted.navigation,null);assert.deepEqual(getVehiclePosition(accepted,graph),getVehiclePosition(queued,graph));assert.equal(canReceiveOffer(filling()),false);assert.equal(canReceiveOffer(advanceGame(queue(),2,graph)),false);
});
test('rest blocks dispatch independently and resuming preserves the prior dispatch preference',()=>{
 for(const preference of [true,false]){const state=setAcceptingOrders(quiet(fresh({graph:parkingGraph})),preference),rest=advanceGame(parkForRest(state,parkingGraph),.15,parkingGraph);assert.equal(rest.parking!.kind,'rest');assert.equal(rest.acceptingOrders,preference);assert.equal(canReceiveOffer(rest),false);const next=setAutoAcceptOrders(rest,true,graph);assert.equal(next.acceptedOffers,0);const resumed=resumeDriving(next,parkingGraph);assert.equal(resumed.acceptingOrders,preference);assert.equal(canReceiveOffer(resumed),preference);}
});
