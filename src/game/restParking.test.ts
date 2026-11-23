import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptOffer,advanceGame,canReceiveOffer,createInitialState,findRestParking,getVehicleGraph,getVehiclePosition,isStrictRestApproach,normalizeGameState,parkForRest,parkTemporarily,resumeDriving,REST_PARKING_SETTLE_MINUTES} from './engine';
import type {GameState,Landmark,RoadGraph} from './types';
function fixture(start:'local'|'motorway'|'roundabout'='local'){
 const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
 for(const[id,lat]of [['a',22.30],['b',22.301],['c',22.302],['d',22.303],['e',22.304]]as const)graph.nodes[id]={id,lat,lon:114.16};
 for(const[from,to]of [['a','b'],['b','c'],['c','d'],['d','e']]as const)for(const[a,b]of [[from,to],[to,from]]){const id=`${a}-${b}`,kind=from==='a'?start:from==='b'?'roundabout':'local';graph.edges[id]={id,from:a,to:b,lengthM:120,speedKph:kind==='motorway'?55:24,roadClass:kind,safeStop:true,name:kind==='roundabout'?'測試迴旋處':kind==='motorway'?'測試快速公路':'普通通道'};(graph.outgoing[a]||=[]).push(id);}
 const places:Landmark[]=[{...graph.nodes.a,id:'harbour-city',nodeId:'a',name:'起點',district:'測試區',kind:'transport'},{...graph.nodes.e,id:'public-parking',nodeId:'e',name:'測試公共停車場',nameEn:'Test Public Car Park',district:'測試區',kind:'transport',snapDistanceM:20}];
 const state=createInitialState({graph,landmarks:places,startNodeId:start==='roundabout'?'b':'a',seed:42,handoverPlace:null});
 return{graph,places,state:{...state,nextDemandMinute:100000,nextEventMinute:100000,nextHandoverReviewMinute:100000}};
}
function reachRest(state:GameState,graph:RoadGraph):GameState{for(let i=0;i<200&&!state.parking;i++)state=advanceGame(state,.1,graph);assert.equal(state.parking?.kind,'rest');return state;}
test('P uses the current normal safe road but rest actively drives into a named parking location before stopping',()=>{
 const{state,graph}=fixture();assert.equal(parkTemporarily(state,graph).parking?.kind,'temporary');
 const requested=parkForRest(state,graph);assert.equal(requested.parking,null);assert.equal(requested.phase,'service-route');assert.equal(requested.navigation!.kind,'parking');assert.equal(requested.navigation!.parkingKind,'rest');assert.equal(requested.navigation!.target.name,'測試公共停車場');assert.deepEqual(getVehiclePosition(requested,graph),getVehiclePosition(state,graph));
 let node=graph.edges[state.movement.edgeId].to;for(const id of requested.movement.nextEdgeIds){assert.equal(graph.edges[id].from,node);node=graph.edges[id].to;}assert.equal(node,'e');assert.equal(isStrictRestApproach(graph.edges[requested.movement.nextEdgeIds.at(-1)!]),true);
 const parked=reachRest(requested,graph);assert.ok(parked.totalDistanceM>=480);assert.deepEqual({lat:getVehiclePosition(parked,graph).lat,lon:getVehiclePosition(parked,graph).lon},{lat:graph.nodes.e.lat,lon:graph.nodes.e.lon});assert.ok(parked.energy.remaining<parked.energy.capacity,'parking stabilization is not a fuel refill');
 const later=advanceGame(parked,10,graph);assert.equal(later.clockMinutes,parked.clockMinutes+10);assert.equal(later.operatingCost,parked.operatingCost);assert.deepEqual(getVehiclePosition(later,graph),getVehiclePosition(parked,graph));assert.equal(later.acceptingOrders,state.acceptingOrders);
});
test('motorway and roundabout safeStop overrides cannot authorize long rest at the current location',()=>{
 for(const kind of ['motorway','roundabout']as const){const{state,graph}=fixture(kind);assert.equal(isStrictRestApproach(graph.edges[state.movement.edgeId]),false);const next=parkForRest(state,graph);assert.equal(next.parking,null);assert.equal(next.navigation!.stage,'routing');assert.equal(next.movement.edgeId,state.movement.edgeId);assert.equal(reachRest(next,graph).navigation,null);}
});
test('already inside a designated parking road still settles before entering rest, without teleporting',()=>{
 const{state,graph}=fixture();graph.edges['a-b']={...graph.edges['a-b'],roadClass:'parking',name:'公共停車場通道',speedKph:12};
 const next=parkForRest(state,graph);assert.equal(next.navigation!.stage,'servicing');assert.equal(next.parking,null);assert.equal(next.navigation!.endsAt,REST_PARKING_SETTLE_MINUTES);assert.equal(advanceGame(next,.14,graph).parking,null);
 const parked=advanceGame(next,.16,graph);assert.equal(parked.parking!.kind,'rest');assert.equal(parked.totalDistanceM,0);assert.equal(parked.operatingCost,0);assert.deepEqual(getVehiclePosition(parked,graph),getVehiclePosition(state,graph));
});
test('cancelling parking approach or leaving rest preserves actual position and the dispatch preference',()=>{
 for(const preference of [true,false]){const{state,graph}=fixture();const initial={...state,acceptingOrders:preference};const enRoute=advanceGame(parkForRest(initial,graph),.2,graph);assert.equal(canReceiveOffer(enRoute),false);const point=getVehiclePosition(enRoute,graph),cancelled=resumeDriving(enRoute,graph);assert.equal(cancelled.navigation,null);assert.equal(cancelled.parking,null);assert.equal(cancelled.phase,'cruising');assert.deepEqual(getVehiclePosition(cancelled,graph),point);assert.equal(cancelled.acceptingOrders,preference);
  const parked=reachRest(parkForRest(initial,graph),graph),restored=normalizeGameState(JSON.parse(JSON.stringify(parked)),graph)!;const departed=resumeDriving(restored,graph);assert.equal(departed.acceptingOrders,preference);assert.deepEqual(getVehiclePosition(departed,graph),getVehiclePosition(parked,graph));}
});
test('no suitable public parking, unsafe final road, insufficient range or a passenger never produces an unsafe rest',()=>{
 const{state,graph,places}=fixture();
 const restricted={...state,landmarks:places.map(place=>place.id==='public-parking'?{...place,name:'私人專用停車場',nameEn:'Reserved Private Carpark'}:place)};const refused=parkForRest(restricted,graph);assert.equal(refused.parking,null);assert.equal(refused.navigation,null);assert.equal(refused.currentOffer?.id,state.currentOffer?.id);assert.deepEqual(refused.movement,state.movement);assert.match(refused.logs[0].text,/沒有可安全/);
 const unsafe=structuredClone(graph);unsafe.edges['d-e'].roadClass='primary';assert.equal(findRestParking(state,unsafe),null);assert.equal(parkForRest(state,unsafe).parking,null);
 const empty={...state,energy:{...state.energy,remaining:0}};assert.equal(parkForRest(empty,graph).navigation,null);
 const accepted=acceptOffer(state,graph);assert.ok(accepted.activeTrip);assert.equal(parkForRest(accepted,graph),accepted);
});
test('the bundled Hong Kong catalog finds a real named car park with a connected strict approach from Harbour City',()=>{
 const state=createInitialState({shiftDurationMinutes:360}),graph=getVehicleGraph(state.vehicleId),plan=findRestParking(state,graph);assert.ok(plan);assert.equal(plan.alreadyInside,false);assert.ok(plan.distanceM>0&&plan.distanceM<=8000);assert.ok(state.landmarks.some(place=>place.id===plan.target.id&&place.name===plan.target.name));
 let node=graph.edges[state.movement.edgeId].to;for(const id of plan.route){assert.equal(graph.edges[id].from,node);node=graph.edges[id].to;}assert.equal(node,plan.target.nodeId);assert.ok(isStrictRestApproach(graph.edges[plan.route.at(-1)!]));
});
