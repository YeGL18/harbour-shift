/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptOffer,advanceGame,chooseBranch,createInitialState,cruiseToNode,getOfferPreviewRoutes,getUpcomingBranches,getVehiclePosition,parkForRest,parkTemporarily,resumeDriving,setAcceptingOrders,setOfferResponseWindow } from './engine';
import { approachJunction,crossedJunction,getDrivingSpeedFactor } from './driving';
import type { GameState,Landmark,RoadGraph } from './types';

const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
for(const[id,lat,lon]of[['a',22.3,114.16],['b',22.305,114.16],['c',22.31,114.16],['d',22.305,114.165],['e',22.31,114.165]]as const)graph.nodes[id]={id,lat,lon};
for(const[a,b]of[['a','b'],['b','c'],['b','d'],['c','e'],['d','e']])for(const[from,to]of[[a,b],[b,a]]){const id=`${from}-${to}`;graph.edges[id]={id,from,to,lengthM:500,speedKph:24,name:`${from}${to}道`,roadClass:'local'};(graph.outgoing[from]||=[]).push(id);}
const places:Landmark[]=[{...graph.nodes.a,id:'harbour-city',nodeId:'a',name:'海港城',district:'油尖旺區',kind:'transport'},{...graph.nodes.c,id:'megabox',nodeId:'c',name:'MegaBox',district:'觀塘區',kind:'transport'}];
const fresh=()=>createInitialState({graph,landmarks:places,startNodeId:'a',seed:42});
const parkingGraph:RoadGraph={...graph,edges:{...graph.edges,'a-b':{...graph.edges['a-b'],roadClass:'parking',name:'測試公共停車場通道'}}};

test('junction approach is a deterministic smooth factor from 1 to .72, without any timer',()=>{
  const state=fresh();const factors=[600,300,225,150,75,.5,0].map(distanceM=>getDrivingSpeedFactor({...state,drivingAssist:approachJunction(undefined,{id:'b',distanceM})}));
  assert.equal(factors[0],1);assert.equal(factors[1],1);assert.equal(factors.at(-1),.72);
  for(let index=1;index<factors.length;index++)assert.ok(factors[index]<=factors[index-1]&&factors[index]>=.72);
  assert.equal(getDrivingSpeedFactor({...state,phase:'pickup',drivingAssist:approachJunction(undefined,{id:'b',distanceM:0})}),1);
});
test('recovery begins only after physical crossing and ramps over 200 metres; a new approach takes the minimum',()=>{
  const state=fresh();const assist=crossedJunction(undefined,'b',500);
  const at=(distance:number)=>getDrivingSpeedFactor({...state,totalDistanceM:distance,drivingAssist:assist});
  assert.equal(at(500),.72);assert.ok(at(600)>.72&&at(600)<1);assert.equal(at(700),1);assert.equal(at(1000),1);
  const next=approachJunction(assist,{id:'e',distanceM:25});
  assert.ok(getDrivingSpeedFactor({...state,totalDistanceM:600,drivingAssist:next})<at(600));
});
test('the final metre never restores speed early and crossing records actual distance without changing time',()=>{
  const state=fresh();state.movement.distanceOnEdgeM=499.5;state.totalDistanceM=499.5;state.drivingAssist=approachJunction(undefined,{id:'b',distanceM:.5});
  const before=advanceGame(state,.001,graph);
  assert.equal(before.drivingAssist?.crossedAtDistanceM,undefined);assert.ok(getDrivingSpeedFactor(before)<.721);
  const after=advanceGame(before,.001,graph);
  assert.equal(after.drivingAssist?.crossedJunctionNodeId,'b');assert.equal(after.drivingAssist?.crossedAtDistanceM,500);
  assert.ok(after.totalDistanceM>500);assert.equal(after.clockMinutes,.002);assert.ok(getDrivingSpeedFactor(after)<.721);
  assert.equal(state.totalDistanceM,499.5,'advancing is immutable');
});
test('map cruise targets use connected legal routes, retain dispatch and clear on arrival',()=>{
  const initial=fresh();const target=cruiseToNode(initial,'e',graph);
  assert.equal(target.phase,'cruising');assert.equal(target.cruiseTarget?.nodeId,'e');assert.equal(target.cruiseTarget?.name,'地圖位置');
  assert.equal(target.currentOffer?.id,initial.currentOffer?.id);assert.equal(target.landmarks,initial.landmarks);
  assert.deepEqual(getVehiclePosition(target,graph),getVehiclePosition(initial,graph));
  let node=graph.edges[target.movement.edgeId].to;for(const id of target.movement.nextEdgeIds){assert.equal(graph.edges[id].from,node);node=graph.edges[id].to;}assert.equal(node,'e');
  const arrived=advanceGame(target,10,graph);assert.equal(arrived.cruiseTarget,undefined);assert.equal(arrived.phase,'cruising');assert.ok(arrived.totalDistanceM>1500);
  assert.ok(arrived.logs.some(log=>log.text.includes('已到達地圖位置')));assert.equal(cruiseToNode(initial,'forbidden-node',graph),initial);
});
test('accepted work, a manual branch, parking and departure each supersede a cruise target',()=>{
  const target=cruiseToNode(fresh(),'e',graph);
  assert.equal(acceptOffer(target,graph).cruiseTarget,undefined);
  const branch=getUpcomingBranches(target,graph)[0];const alternative=branch.options.find(option=>!option.selected)!;
  assert.equal(chooseBranch(target,branch.junctionNodeId,alternative.edgeId,graph).cruiseTarget,undefined);
  assert.equal(parkTemporarily(target,graph).cruiseTarget,undefined);
  assert.equal(resumeDriving(target,graph).cruiseTarget,undefined);
});
test('offer preview starts at the actual moving car, includes remaining road and ends at the named destination',()=>{
  const state=advanceGame(fresh(),.1,graph);const preview=getOfferPreviewRoutes(state,graph)!;const position=getVehiclePosition(state,graph);
  assert.ok(preview);assert.equal(preview.pickupRoute[0].lat,position.lat);assert.equal(preview.pickupRoute[0].lon,position.lon);
  assert.deepEqual(preview.pickupRoute.at(-1),graph.nodes.a);assert.deepEqual(preview.tripRoute.at(-1),graph.nodes.c);
  assert.equal(preview.id,state.currentOffer!.id);assert.equal(preview.destination.lat,places[1].lat);
  assert.equal(getOfferPreviewRoutes({...state,currentOffer:null},graph),null);
});
test('five-real-second offers are generated correctly throughout a 20-second no-poll catch-up at every room speed',()=>{
  let generated=0;
  for(const speed of [10,30,60])for(let seed=0;seed<12;seed++){
    const window=speed*5/60,elapsed=speed*20/60;
    const initial=createInitialState({graph:parkingGraph,landmarks:places,startNodeId:'a',startTimeMinutes:480,density:'busy',seed,offerResponseWindowMinutes:window});
    assert.equal(initial.currentOffer!.expiresAt-initial.currentOffer!.createdAt,window);
    const resting=setAcceptingOrders(parkForRest(initial,parkingGraph),true);
    const bulk=advanceGame(resting,elapsed,parkingGraph);let sliced=resting;
    for(let tick=0;tick<80;tick++)sliced=advanceGame(sliced,elapsed/80,parkingGraph);
    assert.equal(bulk.platform.offered,sliced.platform.offered);assert.equal(bulk.declinedOffers,sliced.declinedOffers);assert.equal(bulk.currentOffer?.id,sliced.currentOffer?.id);
    assert.deepEqual(bulk.observedOffers.map(offer=>offer.id),sliced.observedOffers.map(offer=>offer.id));
    assert.ok(!bulk.currentOffer||bulk.currentOffer.expiresAt>bulk.clockMinutes);
    for(const offer of [...bulk.observedOffers,...(bulk.currentOffer?[bulk.currentOffer]:[])]){assert.ok(Math.abs((offer.expiresAt-offer.createdAt)*60/speed-5)<1e-8);if(offer.createdAt>0)generated++;}
  }
  assert.ok(generated>0,'the assertion covers newly generated demand, not only the initial request');
  assert.equal(fresh().currentOffer!.expiresAt,4,'solo games retain the existing internal fallback');
});
test('configuring an older server save expires its stale offer through the engine without advancing time twice',()=>{
  const old=fresh();old.clockMinutes=2;old.nextDemandMinute=3;
  const configured=setOfferResponseWindow(old,10*5/60,graph);
  assert.equal(configured.clockMinutes,2);assert.equal(configured.currentOffer,null);assert.equal(configured.declinedOffers,1);
  assert.equal(setOfferResponseWindow(configured,10*5/60,graph).declinedOffers,1);
  assert.ok(old.currentOffer);assert.equal(old.offerResponseWindowMinutes,undefined);
});
