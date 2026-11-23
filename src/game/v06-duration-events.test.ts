import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptOffer,advanceGame,advanceGameWithWorldEvents,canCruiseToWorldEvent,canReceiveOffer,chooseVehicle,createInitialState,cruiseToWorldEvent,formatClock,getHandoverPlan,getLocalDemandConditions,getShiftDurationMinutes,getShiftEndMinute,getShiftOvertimeLimit,getSummary,getVehiclePosition,getWorldDemandCandidates,getWorldEventTarget,navigateToHandover,normalizeGameState,setWorldEvent,worldEventDemandBoost} from './engine';
import {demandConditions} from './demandField';
import {getRentalCost} from '../data/vehicles';
import type {EnergyStation,GameState,InitialGameOptions,Landmark,RoadGraph,WorldEvent} from './types';
const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
for(const[id,lat,lon]of [['a',22.30,114.16],['b',22.302,114.16],['c',22.304,114.16],['d',22.302,114.162]]as const)graph.nodes[id]={id,lat,lon};
for(const[from,to]of [['a','b'],['b','c'],['c','d'],['d','a'],['b','d']]as const)for(const[start,end]of [[from,to],[to,from]]){const id=`${start}-${end}`;graph.edges[id]={id,from:start,to:end,lengthM:250,speedKph:24,roadClass:'local',name:'測試街',safeStop:true};(graph.outgoing[start]||=[]).push(id);}
const places:Landmark[]=[{...graph.nodes.a,id:'harbour-city',name:'海港城',district:'油尖旺區',kind:'shopping',nodeId:'a'},{...graph.nodes.c,id:'megabox',name:'MegaBox',district:'觀塘區',kind:'shopping',nodeId:'c'},{...graph.nodes.d,id:'third',name:'第三地點',district:'東區',kind:'transport',nodeId:'d'}];
const station:EnergyStation={...graph.nodes.c,id:'half-fuel',name:'補給站',nodeId:'c',kind:'lpg',serviceMinutes:4,unitPrice:4};
const fresh=(options:InitialGameOptions={})=>createInitialState({graph,landmarks:places,seed:42,startNodeId:'a',handoverPlace:null,...options});
const quiet=(state:GameState):GameState=>({...state,currentOffer:null,nextDemandMinute:100000,nextEventMinute:100000,nextHandoverReviewMinute:100000});
const event:WorldEvent={id:'test-concert',title:'場館散場',titleEn:'Venue dispersal',pickupPlaceId:'harbour-city',center:places[0],radiusM:2000,startsAt:100,endsAt:160,demandBoost:3};
function filling(endsAt=364):GameState{const state=quiet(fresh({shiftDurationMinutes:360}));return{...state,clockMinutes:359.5,phase:'servicing',movement:{edgeId:'b-c',distanceOnEdgeM:250,nextEdgeIds:[]},navigation:{kind:'refuel',target:station,stage:'servicing',endsAt,handoverAfterService:true},energy:{...state.energy,remaining:20,unitPricePaid:4.57},operatingCost:12.34};}

test('explicit half shifts scale default day/night rental but never an actual override or an old missing duration',()=>{
 for(const vehicle of ['kam-fung','little-treasure','red-flag','private']as const)for(const shift of ['day','night']as const){assert.equal(getRentalCost(vehicle,shift,undefined,360),getRentalCost(vehicle,shift)/2);assert.equal(getRentalCost(vehicle,shift,321.5,360),321.5);assert.equal(getRentalCost(vehicle,shift,0,360),0);}
 const half=fresh({shiftDurationMinutes:360,startTimeMinutes:455});assert.equal(half.rentalCostApplied,240);assert.equal(getShiftDurationMinutes(half),360);assert.equal(getShiftOvertimeLimit(half),120);assert.equal(getShiftEndMinute(half),480);assert.equal(formatClock(360,455),'13:35');
 const full=fresh();assert.equal(full.rentalCostApplied,480);assert.equal(getShiftDurationMinutes(),720);assert.equal(getShiftOvertimeLimit({}),240);assert.equal(getShiftEndMinute(full),960);
 const changed=chooseVehicle(fresh({shiftDurationMinutes:360,rentalOverride:321.5}),'little-treasure',graph);assert.equal(changed.shiftDurationMinutes,360);assert.equal(changed.rentalCostApplied,321.5);
});
test('half shift dispatch and movement end at 360, while a full shift at that time continues',()=>{
 const half={...quiet(fresh({shiftDurationMinutes:360})),clockMinutes:359.8};const ended=advanceGame(half,1,graph);assert.equal(ended.phase,'ended');assert.equal(ended.clockMinutes,360);assert.equal(ended.currentOffer,null);assert.equal(ended.presentedOffers,half.presentedOffers);assert.equal(ended.summary!.overtimeMinutes,0);assert.equal(ended.summary!.shiftDurationMinutes,360);assert.equal(canReceiveOffer(ended),false);assert.deepEqual(getWorldDemandCandidates(half,places[0],360,363,graph),[]);
 const full=advanceGame({...quiet(fresh()),clockMinutes:359.8},1,graph);assert.equal(full.phase,'cruising');assert.ok(Math.abs(full.clockMinutes-360.8)<1e-8);
});
test('special 24-hour rental is day plus night for either starting shift, while an override is the actual chosen rent',()=>{
 for(const vehicle of ['kam-fung','little-treasure','red-flag','private']as const)for(const shift of ['day','night']as const){const expected=getRentalCost(vehicle,'day')+getRentalCost(vehicle,'night');assert.equal(getRentalCost(vehicle,shift,undefined,1440),expected);assert.equal(getRentalCost(vehicle,shift,321.5,1440),321.5);assert.equal(getRentalCost(vehicle,shift,0,1440),0);}
 const special=fresh({shiftDurationMinutes:1440,shift:'night'});assert.equal(special.rentalCostApplied,850);assert.equal(getShiftDurationMinutes(special),1440);assert.equal(getShiftOvertimeLimit(special),240);assert.equal(getShiftEndMinute(special),1680);
});
test('24-hour shifts cross midnight and the normal 12-hour boundary without forced rest, ending exactly at 1440',()=>{
 const special=quiet(fresh({shiftDurationMinutes:1440,shift:'night'}));assert.equal(formatClock(420,special.startTimeMinutes),'00:00');assert.equal(formatClock(1440,special.startTimeMinutes),'17:00');
 const continued=advanceGame({...special,clockMinutes:719.8},.4,graph);assert.equal(continued.phase,'cruising');assert.equal(continued.parking,null);assert.equal(continued.navigation,null);assert.ok(Math.abs(continued.clockMinutes-720.2)<1e-8);
 const ended=advanceGame({...special,clockMinutes:1439.8},1,graph);assert.equal(ended.phase,'ended');assert.equal(ended.clockMinutes,1440);assert.equal(ended.summary!.overtimeMinutes,0);assert.equal(ended.summary!.shiftDurationMinutes,1440);assert.equal(getHandoverPlan(special,graph).deadlineMinute,1440);
});
test('24-hour committed fuel gets at most 240 extra minutes and restores the same special-shift bound',()=>{
 const initial={...filling(1444),shiftDurationMinutes:1440 as const,rentalCostApplied:850,clockMinutes:1439.5};const pending=advanceGame(initial,1.5,graph);assert.equal(pending.clockMinutes,1441);assert.equal(pending.deadlineSettlement!.startedAt,1440);assert.equal(pending.deadlineSettlement!.expiresAt,1680);
 const restored=normalizeGameState(JSON.parse(JSON.stringify(pending)),graph)!;assert.equal(restored.shiftDurationMinutes,1440);assert.equal(restored.deadlineSettlement!.expiresAt,1680);const ended=advanceGame(restored,20,graph);assert.equal(ended.clockMinutes,1444);assert.equal(ended.shiftEndReason,'fuel-completed-late');assert.equal(ended.summary!.overtimeMinutes,4);assert.equal(ended.summary!.expenses,862.34);
 const timeout=advanceGame({...initial,navigation:{...initial.navigation!,endsAt:10000}},1000,graph);assert.equal(timeout.clockMinutes,1680);assert.equal(timeout.summary!.overtimeMinutes,240);assert.equal(timeout.shiftEndReason,'fuel-timeout');assert.equal(getSummary({...ended,netIncome:800,clockMinutes:1600}).score,720);
});
test('half-shift handover and reminders use the six-hour deadline, including early on-time return',()=>{
 const initial=quiet(fresh({shiftDurationMinutes:360,handoverPlace:places[0]}));const plan=getHandoverPlan({...initial,clockMinutes:300},graph);assert.equal(plan.deadlineMinute,360);assert.equal(plan.remainingMinutes,60);assert.ok(plan.reminderAtMinute<=300);
 const reminded=advanceGame({...initial,clockMinutes:299.9,nextHandoverReviewMinute:299.9},.2,graph);assert.equal(reminded.handoverReminderShown,true);
 const ended=navigateToHandover({...initial,clockMinutes:359},graph);assert.equal(ended.phase,'ended');assert.equal(ended.handoverStatus,'on-time');assert.equal(ended.clockMinutes,359);assert.equal(ended.summary!.overtimeMinutes,0);
});
test('already-started half-shift fuel survives deadline/restore, finishes once, and is bounded at 480',()=>{
 const pending=advanceGame(filling(),1.5,graph);assert.equal(pending.phase,'servicing');assert.equal(pending.clockMinutes,361);assert.deepEqual(pending.deadlineSettlement,{kind:'fuel',startedAt:360,expiresAt:480,stationId:station.id});
 const restored=normalizeGameState(JSON.parse(JSON.stringify(pending)),graph)!;assert.deepEqual(restored.deadlineSettlement,pending.deadlineSettlement);
 const ended=advanceGame(restored,20,graph);assert.equal(ended.phase,'ended');assert.equal(ended.clockMinutes,364);assert.equal(ended.shiftEndReason,'fuel-completed-late');assert.equal(ended.summary!.overtimeMinutes,4);assert.equal(ended.summary!.expenses,252.34);assert.equal(ended.operatingCost,12.34);assert.equal(ended.energy.remaining,ended.energy.capacity);
 const timeout=advanceGame(filling(10000),1000,graph);assert.equal(timeout.clockMinutes,480);assert.equal(timeout.shiftEndReason,'fuel-timeout');assert.equal(timeout.summary!.overtimeMinutes,120);
 const positive=getSummary({...ended,netIncome:800,clockMinutes:400});assert.equal(positive.score,720);assert.equal(positive.overtimeMinutes,40);
});
test('legacy missing/invalid duration restores as full without changing paid rent or career counters',()=>{
 const original=fresh({rentalOverride:321.5});const saved=JSON.parse(JSON.stringify({...original,clockMinutes:721,phase:'servicing',navigation:{kind:'refuel',target:station,stage:'servicing',endsAt:724},deadlineSettlement:{kind:'fuel',startedAt:720,expiresAt:960,stationId:station.id}}));delete saved.shiftDurationMinutes;
 const restored=normalizeGameState(saved,graph)!;assert.equal(restored.shiftDurationMinutes,720);assert.equal(restored.rentalCostApplied,321.5);assert.deepEqual(restored.platform,original.platform);assert.deepEqual(restored.deadlineSettlement,{kind:'fuel',startedAt:720,expiresAt:960,stationId:station.id});assert.equal(normalizeGameState({...saved,shiftDurationMinutes:480},graph)!.shiftDurationMinutes,720);
});
test('world events change geographically bounded demand only while active, independently from driver supply',()=>{
 assert.equal(worldEventDemandBoost(event,event.center,99.9),1);assert.equal(worldEventDemandBoost(event,event.center,100),3);assert.equal(worldEventDemandBoost(event,event.center,160),1);assert.equal(worldEventDemandBoost(event,{lat:23,lon:115},120),1);
 const position=places[0],context={position,landmarks:places,worldEvent:event,eventMinute:120};const normal=demandConditions(42,420,position.district,{position,landmarks:places}),boosted=demandConditions(42,420,position.district,context),supply=demandConditions(42,420,position.district,{...context,supply:[{position,availableDrivers:50}]});assert.ok(Math.abs(boosted.demandPerMinute/normal.demandPerMinute-3)<1e-10);assert.ok(boosted.requestIntervalMinutes<normal.requestIntervalMinutes);assert.equal(supply.demandPerMinute,boosted.demandPerMinute);assert.equal(supply.arrivalWeight,boosted.arrivalWeight);assert.ok(supply.multiplier<=boosted.multiplier);
 const state=setWorldEvent({...fresh(),clockMinutes:120},event);assert.equal(getLocalDemandConditions(state,graph).demandPerMinute,getLocalDemandConditions({...state,worldEvent:undefined},graph).demandPerMinute*3);
});
test('event demand uses the existing named passenger pool and creates no free income or fake places',()=>{
 const plain={...fresh(),clockMinutes:100},boosted=setWorldEvent(plain,event);let normalCount=0,eventCount=0;
 for(let minute=100;minute<145;minute+=3){const a=getWorldDemandCandidates(plain,places[0],minute,minute+2.75,graph),b=getWorldDemandCandidates(boosted,places[0],minute,minute+2.75,graph);normalCount+=a.length;eventCount+=b.length;for(const offer of b){assert.ok(places.some(place=>place.id===offer.pickup.id));assert.ok(places.some(place=>place.id===offer.destination.id));assert.match(offer.id,/^world-/);}}
 assert.ok(eventCount>normalCount,`event=${eventCount}, baseline=${normalCount}`);
 assert.deepEqual(getWorldDemandCandidates(plain,places[0],161,163,graph),getWorldDemandCandidates(boosted,places[0],161,163,graph));
 const parked={...quiet(boosted),acceptingOrders:false,parking:{kind:'rest' as const,startedAt:100}},advanced=advanceGame(parked,10,graph);assert.equal(advanced.grossIncome,0);assert.equal(advanced.completedTrips,0);assert.equal(advanced.netIncome,parked.netIncome);
});
test('the thin schedule adapter activates and clears events across a large delta without mutating the input',()=>{
 const start=quiet(fresh()),short={...event,startsAt:1,endsAt:3};const mid=advanceGameWithWorldEvents(start,2,[short],graph);assert.equal(mid.clockMinutes,2);assert.equal(mid.worldEvent!.id,event.id);assert.equal(start.worldEvent,undefined);
 const later=advanceGameWithWorldEvents(mid,2,[short],graph);assert.equal(later.clockMinutes,4);assert.equal(later.worldEvent,undefined);assert.equal(later.grossIncome,0);assert.ok(Math.abs(later.idleMinutes!-4)<1e-8);
});
test('event navigation targets the real accessible POI and remains disabled during an offer, rest or a trip',()=>{
 const targetEvent={...event,pickupPlaceId:'megabox',center:places[1]},state=quiet(fresh());assert.equal(getWorldEventTarget(state,targetEvent,graph)!.nodeId,'c');assert.equal(canCruiseToWorldEvent(state,targetEvent,graph),true);const moved=cruiseToWorldEvent(state,targetEvent,graph);assert.equal(moved.cruiseTarget!.nodeId,'c');assert.deepEqual(getVehiclePosition(moved,graph),getVehiclePosition(state,graph));
 for(const busy of [fresh(),{...state,parking:{kind:'rest' as const,startedAt:0}},acceptOffer(fresh(),graph),{...state,clockMinutes:160}]){assert.equal(canCruiseToWorldEvent(busy,targetEvent,graph),false);assert.equal(cruiseToWorldEvent(busy,targetEvent,graph),busy);}
 assert.equal(canCruiseToWorldEvent(state,{...targetEvent,pickupPlaceId:'unknown-place'},graph),false);
});
test('idle minutes count actual empty cruising and parking time, excluding an accepted pickup and operations',()=>{
 const start=quiet(fresh()),cruising=advanceGame(start,2,graph),parked=advanceGame({...cruising,parking:{kind:'rest',startedAt:2}},3,graph);assert.equal(cruising.idleMinutes,2);assert.equal(parked.idleMinutes,5);
 const accepted=acceptOffer(fresh(),graph),busy=advanceGame(accepted,.01,graph);assert.equal(busy.idleMinutes,0);assert.equal(advanceGame(filling(),.25,graph).idleMinutes,0);
});
