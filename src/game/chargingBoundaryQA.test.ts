import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceGame,cancelCharging,cancelHandover,createInitialState,getEnergyServiceEstimate,navigateToHandover,navigateToStation,normalizeGameState,setAcceptingOrders} from './engine';
import {CHARGING_GAME_MODEL,chargeAfterMinutes} from './charging';
import type {EnergyStation,GameState,Landmark,RoadGraph} from './types';
const graph:RoadGraph={nodes:{a:{id:'a',lat:22.30,lon:114.16},b:{id:'b',lat:22.301,lon:114.16}},edges:{ab:{id:'ab',from:'a',to:'b',lengthM:100,speedKph:20,name:'測試街',safeStop:true},ba:{id:'ba',from:'b',to:'a',lengthM:100,speedKph:20,name:'測試街',safeStop:true}},outgoing:{a:['ab'],b:['ba']}};
const place:Landmark={...graph.nodes.a,id:'harbour-city',name:'測試交更點',nodeId:'a',district:'油尖旺區',kind:'transport'};
const station:EnergyStation={...place,id:'boundary-charge',name:'測試充電站',nodeId:'a',kind:'charge',unitPrice:3,chargingOptions:[{connector:'ccs2',powerKw:50,powerBasis:'game-reference',unitPrice:3}]};
const fresh=(fraction=.95,minute=359.8):GameState=>({...setAcceptingOrders(createInitialState({graph,landmarks:[place],vehicleId:'tesla-model-3',shiftDurationMinutes:360,seed:28,startPlace:place,handoverPlace:place,initialEnergyFraction:fraction,dispatchManaged:true}),false),clockMinutes:minute});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} versus ${b}`);

test('unplugging after the deadline keeps partial paid energy, ends late once, and cannot award a successful-full-charge result',()=>{
 const initial=navigateToHandover(navigateToStation(fresh(),station,graph),graph),partial=advanceGame(initial,.4,graph);assert.ok(partial.deadlineSettlement);assert.equal(partial.phase,'servicing');
 const restored=normalizeGameState(JSON.parse(JSON.stringify(partial)),graph)!;const cost=restored.operatingCost,energy=restored.energy.remaining;
 const stopped=cancelCharging(restored,graph);assert.equal(stopped.phase,'ended');assert.equal(stopped.shiftEndReason,'fuel-cancelled-late');assert.equal(stopped.handoverStatus,'missed');assert.equal(stopped.handoverIntent,'cancelled');assert.equal(stopped.lastChargeReceipt!.completed,false);
 near(stopped.energy.remaining,energy);near(stopped.operatingCost,cost);near(stopped.lastChargeReceipt!.billedCost,Math.round(cost*100)/100);assert.ok(energy<stopped.energy.capacity);assert.equal(stopped.summary!.overtimeMinutes,stopped.clockMinutes-360);
 assert.equal(cancelCharging(stopped,graph),stopped);assert.equal(advanceGame(stopped,10,graph),stopped);
});

test('a slow AC charge has a finite overdue cutoff and bills only energy actually delivered before the bound',()=>{
 const ac={...station,chargingOptions:[{connector:'type2' as const,powerKw:1,powerBasis:'game-reference' as const,unitPrice:3}]};
 const base=createInitialState({graph,landmarks:[place],vehicleId:'tesla-model-s',shiftDurationMinutes:360,startPlace:place,handoverPlace:place,initialEnergyFraction:.1,dispatchManaged:true});
 const initial=navigateToStation({...base,clockMinutes:359.8,acceptingOrders:false},ac,graph);assert.ok(getEnergyServiceEstimate(initial).minutes>120);
 const ended=advanceGame(initial,1000,graph),expected=chargeAfterMinutes(90,9,90,1,480-359.8);
 assert.equal(ended.phase,'ended');assert.equal(ended.clockMinutes,480);assert.equal(ended.shiftEndReason,'fuel-timeout');assert.equal(ended.lastChargeReceipt!.completed,false);assert.equal(ended.handoverFailureReason,'fuel');assert.equal(ended.summary!.overtimeMinutes,120);
 near(ended.energy.remaining,expected.remaining);near(ended.operatingCost,expected.gridKWh*3);assert.ok(ended.energy.remaining<90);near(ended.lastChargeReceipt!.deliveredKWh,expected.deliveredKWh);assert.equal(ended.chargingSession,null);
});

test('cancelling handover while charging survives restore and completion without abandoning the port or auto-returning',()=>{
 const charging=navigateToStation(fresh(.95,20),station,graph),linked=navigateToHandover(charging,graph);const session=structuredClone(linked.chargingSession);
 const unlinked=cancelHandover(linked,graph);assert.equal(unlinked.phase,'servicing');assert.deepEqual(unlinked.chargingSession,session);assert.equal(unlinked.navigation!.handoverAfterService,false);
 const restored=normalizeGameState(JSON.parse(JSON.stringify(unlinked)),graph)!;const finished=advanceGame(restored,getEnergyServiceEstimate(restored).minutes+.2,graph);
 assert.equal(finished.phase,'cruising');assert.equal(finished.handoverIntent,'cancelled');assert.equal(finished.navigation,null);assert.equal(finished.lastChargeReceipt!.completed,true);assert.equal(finished.completedTrips,0);near(finished.operatingCost,3/CHARGING_GAME_MODEL.efficiency*3);
});

test('a full charge finishing exactly at the deadline is paid once and settles on time at the handover point',()=>{
 const base=fresh(.95,0),minutes=getEnergyServiceEstimate(base,station).minutes;const initial=navigateToStation({...base,clockMinutes:360-minutes},station,graph);
 const ended=advanceGame(initial,minutes,graph);assert.equal(ended.phase,'ended');near(ended.clockMinutes,360);assert.equal(ended.handoverStatus,'on-time');assert.equal(ended.shiftEndReason,'deadline');assert.equal(ended.lastChargeReceipt!.completed,true);near(ended.energy.remaining,60);near(ended.operatingCost,3/.92*3);
});
