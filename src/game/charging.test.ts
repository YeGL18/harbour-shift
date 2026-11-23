import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceGame,cancelCharging,cancelHandover,createInitialState,getEnergyServiceEstimate,getHandoverPlan,navigateToHandover,navigateToStation,normalizeGameState,setAcceptingOrders} from './engine';
import {CHARGING_GAME_MODEL,chargeAfterMinutes,chargingMinutes,selectChargingOption} from './charging';
import {ENERGY_PROFILE_DEFAULTS} from '../data/serviceStations';
import type {EnergyStation,Landmark,RoadGraph} from './types';

const graph:RoadGraph={nodes:{a:{id:'a',lat:22.3,lon:114.16},b:{id:'b',lat:22.301,lon:114.16},c:{id:'c',lat:22.302,lon:114.16}},edges:{},outgoing:{}};
for(const [from,to]of [['a','b'],['b','c'],['c','a']])for(const [f,t]of [[from,to],[to,from]]){const id=f+t;graph.edges[id]={id,from:f,to:t,lengthM:100,speedKph:20,name:'測試街',safeStop:true};(graph.outgoing[f]??=[]).push(id);}
const place:Landmark={...graph.nodes.a,id:'harbour-city',name:'海港城',nodeId:'a',kind:'shopping',district:'油尖旺區'};
const station:EnergyStation={...graph.nodes.a,id:'test-charge',name:'測試充電站',nodeId:'a',kind:'charge',unitPrice:3,chargingOptions:[{connector:'ccs2',powerKw:50,powerBasis:'game-reference',unitPrice:3}]};
const fresh=(fraction=0)=>setAcceptingOrders(createInitialState({vehicleId:'tesla-model-3',seed:42,graph,landmarks:[place],startPlace:place,handoverPlace:null,initialEnergyFraction:fraction,dispatchManaged:true}),false);
const begin=(fraction=0)=>navigateToStation(fresh(fraction),station,graph);
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('charging taper has measurable80/95percent bands and finite exact ETA',()=>{
 const c=100,p=100,e=CHARGING_GAME_MODEL.efficiency;
 near(chargingMinutes(c,0,80,p),80/(p*e)*60);
 near(chargingMinutes(c,80,95,p),15/(p*e*.55)*60);
 near(chargingMinutes(c,95,100,p),5/(p*e*.25)*60);
 assert.ok(chargingMinutes(c,95,100,p)>chargingMinutes(c,0,5,p));
 assert.equal(chargingMinutes(c,0,c,0),Infinity);
 const result=chargeAfterMinutes(c,0,c,p,chargingMinutes(c,0,c,p));near(result.remaining,c);near(result.gridKWh,c/e);
});
test('compatible connectors, OEM access and vehicle AC/DC caps are applied without adapters',()=>{
 const options:EnergyStation={...station,chargingOptions:[{connector:'gbt-dc',powerKw:250,powerBasis:'official'},{connector:'type2',powerKw:22,powerBasis:'official'},{connector:'ccs2',powerKw:250,powerBasis:'official',vehicleRestriction:'tesla-only'}]};
 assert.equal(selectChargingOption(ENERGY_PROFILE_DEFAULTS['tesla-model-3'],options,'tesla-model-3')!.powerKw,170);
 assert.equal(selectChargingOption(ENERGY_PROFILE_DEFAULTS['mg4-trophy'],options,'mg4-trophy')!.powerKw,11);
 assert.equal(selectChargingOption(ENERGY_PROFILE_DEFAULTS.private,options,'private'),null);
 const state=fresh();assert.equal(navigateToStation(state,{...station,chargingOptions:[{connector:'gbt-dc',powerKw:100,powerBasis:'official'}]},graph),state,'incompatible connector never starts navigation');
});
test('partial charging bills delivered grid energy once and explicit unplug preserves energy/receipt',()=>{
 const initial=begin();assert.equal(initial.phase,'servicing');assert.equal(initial.navigation?.kind,'charge');
 const state=advanceGame(initial,10,graph),battery=50*.92*10/60;
 near(state.energy.remaining,battery);near(state.chargingSession!.deliveredKWh,battery);near(state.operatingCost,25);
 assert.equal(initial.energy.remaining,0);assert.equal(initial.chargingSession!.deliveredKWh,0,'advance remains immutable');
 const cancelled=cancelCharging(state,graph);assert.equal(cancelled.phase,'cruising');assert.equal(cancelled.chargingSession,null);assert.equal(cancelled.lastChargeReceipt!.completed,false);near(cancelled.energy.remaining,battery);near(cancelled.operatingCost,25);
 const driving=advanceGame(cancelled,.05,graph);assert.ok(driving.totalDistanceM>0);near(driving.operatingCost,25);assert.ok(driving.energy.prepaidRemaining!<battery,'purchased energy burns without a second bill');
});
test('charging billing and SOC are invariant to step partition and receipt cost matches estimate',()=>{
 const initial=begin(),bulk=advanceGame(initial,10,graph);let split=initial;
 for(let i=0;i<40;i++)split=advanceGame(split,.25,graph);
 near(split.energy.remaining,bulk.energy.remaining);near(split.operatingCost,bulk.operatingCost);
 const estimate=getEnergyServiceEstimate(initial,station),finished=advanceGame(initial,estimate.minutes,graph);
 near(finished.energy.remaining,finished.energy.capacity);assert.equal(finished.chargingSession,null);assert.equal(finished.lastChargeReceipt!.completed,true);assert.equal(finished.lastChargeReceipt!.billedCost,estimate.cost);near(finished.operatingCost,finished.energy.capacity/.92*3);
});
test('supplied initial battery is not expensed twice when replacement energy is purchased',()=>{
 let state=advanceGame(fresh(1),.1,graph);assert.ok(state.energy.remaining<state.energy.capacity);near(state.operatingCost,0);
 state=navigateToStation(state,station,graph);for(let i=0;i<80&&state.phase!=='servicing';i++)state=advanceGame(state,.1,graph);
 assert.equal(state.phase,'servicing');const missing=state.energy.capacity-state.energy.remaining;
 state=advanceGame(state,getEnergyServiceEstimate(state).minutes,graph);near(state.operatingCost,missing/.92*3);assert.equal(state.lastChargeReceipt!.completed,true);
});
test('explicit zero charging price remains zero through delivery and partial cancellation',()=>{
 const initial=setAcceptingOrders(createInitialState({vehicleId:'mg4-trophy',graph,landmarks:[place],startPlace:place,handoverPlace:null,initialEnergyFraction:0,energyUnitPriceOverride:0,dispatchManaged:true}),false);
 const charged=advanceGame(navigateToStation(initial,station,graph),5,graph);assert.ok(charged.energy.remaining>0);assert.equal(charged.chargingSession!.unitPrice,0);assert.equal(charged.operatingCost,0);assert.equal(cancelCharging(charged,graph).lastChargeReceipt!.billedCost,0);
});
test('cold restore retains partial charge and paid-energy accounting without free fill or duplicate bill',()=>{
 const partial=advanceGame(begin(.2),8,graph),restored=normalizeGameState(JSON.parse(JSON.stringify(partial)),graph)!;
 assert.ok(restored);near(restored.energy.remaining,partial.energy.remaining);near(restored.chargingSession!.billedCost,partial.chargingSession!.billedCost);
 const a=advanceGame(partial,3,graph),b=advanceGame(restored,3,graph);near(a.energy.remaining,b.energy.remaining);near(a.operatingCost,b.operatingCost);
 const old=createInitialState({vehicleId:'kam-fung',graph,landmarks:[place],handoverPlace:null});delete old.chargingSession;delete old.energy.prepaidRemaining;
 assert.equal(normalizeGameState(old,graph)!.energy.kind,'lpg');assert.equal(normalizeGameState(old,graph)!.energy.prepaidRemaining,0);
});
test('handover preview includes taper and retains current charge when attaching/cancelling return',()=>{
 const initial=begin(.5);initial.handoverPlace=place;
 const plan=getHandoverPlan(initial,graph);assert.ok(plan.serviceMinutes!>30,'a50kW half-fill is not a fixed4minute service');
 const linked=navigateToHandover(initial,graph);assert.equal(linked.navigation!.handoverAfterService,true);assert.deepEqual(linked.chargingSession,initial.chargingSession);
 const unlinked=cancelHandover(linked,graph);assert.equal(unlinked.navigation!.handoverAfterService,false);assert.deepEqual(unlinked.chargingSession,initial.chargingSession);
});
test('handover charging ETA includes energy burned on the directed approach',()=>{
 const state=fresh(.5);state.handoverPlace=place;const distant={...station,...graph.nodes.c,nodeId:'c'};
 const before=getEnergyServiceEstimate(state,distant),plan=getHandoverPlan(state,graph,distant);assert.ok(plan.stationDetourMinutes!>0);assert.ok(plan.serviceMinutes!>before.minutes,'outbound consumption must be replaced as well');
});
test('a charge committed before half-shift cutoff finishes late and retains actual cost',()=>{
 const initial=fresh(.95);initial.shiftDurationMinutes=360;initial.clockMinutes=359.9;initial.handoverPlace=place;
 const charging=navigateToStation(initial,station,graph),remaining=getEnergyServiceEstimate(charging).minutes;
 const overdue=advanceGame(charging,.2,graph);assert.equal(overdue.phase,'servicing');assert.ok(overdue.deadlineSettlement);
 const ended=advanceGame(overdue,remaining,graph);assert.equal(ended.phase,'ended');assert.equal(ended.shiftEndReason,'fuel-completed-late');assert.ok(ended.clockMinutes>360);near(ended.energy.remaining,ended.energy.capacity);near(ended.operatingCost,(60-57)/.92*3);
});
