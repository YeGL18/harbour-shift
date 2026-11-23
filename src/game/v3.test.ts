/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptOffer, advanceGame, cancelTrip, createInitialState, declineOffer, getEnergyServiceEstimate, getLocalDemandConditions, getPhaseRemainingMinutes, getPlatformStats, getRemainingTripRouteCoordinates, getSurgeAreas, getUpcomingBranches, getVehicleGraph, getVehiclePosition, navigateToHandover, navigateToStation, normalizeGameState, parkForRest, parkTemporarily, requestEnergyRecovery, resumeDriving, setAcceptingOrders } from './engine';
import { estimateDriverPayout } from '../data/fares';
import { VEHICLE_BY_ID } from '../data/vehicles';
import { demandConditions, isSafeStoppingEdge } from './systems';
import type { EnergyStation, GameState, InitialGameOptions, Landmark, RoadGraph } from './types';

const graph: RoadGraph = { nodes: {}, edges: {}, outgoing: {} };
for (const [id, lat, lon] of [['a',22.30,114.16],['b',22.305,114.16],['c',22.31,114.16],['d',22.305,114.165],['e',22.31,114.165]] as const) graph.nodes[id] = { id, lat, lon };
for (const [a,b] of [['a','b'],['b','c'],['b','d'],['c','e'],['d','e']]) for (const [from,to] of [[a,b],[b,a]]) {
  const id = `${from}-${to}`; graph.edges[id] = { id, from, to, lengthM: 500, speedKph: 24, roadClass: 'local', name: `${from}${to}道` }; (graph.outgoing[from] ||= []).push(id);
}
const places: Landmark[] = [
  { ...graph.nodes.a, id:'harbour-city',name:'海港城',district:'油尖旺區',kind:'transport',nodeId:'a',waitingProfile:'ordinary' },
  { ...graph.nodes.c, id:'megabox',name:'MegaBox',district:'觀塘區',kind:'transport',nodeId:'c' },
  { ...graph.nodes.d, id:'sorrento',name:'擎天半島',district:'油尖旺區',kind:'residential',nodeId:'d' },
];
const fresh = (options: InitialGameOptions = {}) => createInitialState({ graph, landmarks: places, seed: 42, startNodeId:'a', ...options });
// A genuine designated parking-road fixture; normal safe streets no longer authorize long rest.
const parkingGraph:RoadGraph={...graph,edges:{...graph.edges,'a-b':{...graph.edges['a-b'],roadClass:'parking',name:'測試公共停車場通道'}}};
const dropoff = (road = graph): GameState => {
  let state = acceptOffer(fresh({ graph: road }), road);
  return advanceGame(state, state.activeTrip!.waitMinutes + state.activeTrip!.boardingMinutes + .1, road);
};
const station: EnergyStation = { ...graph.nodes.a, id:'test-station',name:'測試氣站',kind:'lpg',nodeId:'a',unitPrice:4,serviceMinutes:.25 };
const reachedService=(state:GameState):GameState=>{for(let i=0;i<2000&&state.phase!=='servicing';i++)state=advanceGame(state,.05,graph);assert.equal(state.phase,'servicing');return state;};

test('temporary parking holds the car for at most five game minutes and resumes automatically', () => {
  const parked = parkTemporarily(fresh(), graph);
  assert.equal(parked.parking?.kind, 'temporary');
  const waiting = advanceGame(parked, 4.9, graph);
  assert.equal(waiting.totalDistanceM, 0);
  assert.equal(waiting.clockMinutes, 4.9);
  const resumed = advanceGame(waiting, .2, graph);
  assert.equal(resumed.parking, null);
  assert.ok(resumed.totalDistanceM > 0);
});

test('a temporary stop can end immediately by driving or accepting an order', () => {
  const parked = parkTemporarily(fresh(), graph);
  const resumed = resumeDriving(parked, graph);
  assert.equal(resumed.parking, null);
  assert.deepEqual(getVehiclePosition(resumed, graph), getVehiclePosition(parked, graph));
  const accepted = acceptOffer(parked, graph);
  assert.ok(accepted.activeTrip);
  assert.equal(accepted.parking, null);
});

test('long rest advances time without fuel use or offers; disabling dispatch is not a rejection', () => {
  const initial = fresh({graph:parkingGraph});
  const resting = parkForRest(initial, parkingGraph);
  assert.equal(resting.acceptingOrders, initial.acceptingOrders);
  assert.equal(resting.declinedOffers, 0);
  assert.equal(resting.platform.offered, 0);
  const later = advanceGame(resting, 30, parkingGraph);
  assert.equal(later.clockMinutes, 30);
  assert.equal(later.currentOffer, null);
  assert.equal(later.totalDistanceM, 0);
  assert.equal(later.operatingCost, 0);
  const driving = resumeDriving(later, parkingGraph);
  assert.equal(driving.acceptingOrders, initial.acceptingOrders);
  const stopped=setAcceptingOrders(driving,false);
  assert.equal(stopped.declinedOffers,driving.declinedOffers);
  assert.equal(resumeDriving(parkForRest(stopped,parkingGraph),parkingGraph).acceptingOrders,false);
});

test('cancelling before pickup leaves a seeded cooling-off gap instead of immediate dispatch', () => {
  const accepted = acceptOffer(fresh(), graph);
  const cancelled = cancelTrip(accepted, graph);
  assert.ok(cancelled.demandCooldownUntil - cancelled.clockMinutes >= 3);
  const before = advanceGame(cancelled, 2.9, graph);
  assert.equal(before.currentOffer, null);
  assert.equal(before.cancelledTrips, 1);
  assert.equal(before.grossIncome, 0);
});

test('seeded demand produces both quiet gaps and simultaneous nearby arrivals', () => {
  let simultaneous=false; let variedGaps=false;
  for(let seed=0;seed<8;seed++) {
    const state=advanceGame(parkForRest(fresh({seed,graph:parkingGraph}),parkingGraph),120,parkingGraph);
    const counts=new Map<number,number>();
    for(const offer of state.observedOffers) counts.set(offer.createdAt,(counts.get(offer.createdAt)||0)+1);
    if([...counts.values()].some(count=>count>=2)) simultaneous=true;
    const times=[...counts.keys()].sort((a,b)=>a-b);
    const gaps=times.slice(1).map((time,index)=>time-times[index]);
    if(new Set(gaps).size>1 && gaps.some(gap=>gap>=4)) variedGaps=true;
  }
  assert.ok(simultaneous,'a local burst can contain several separate requests');
  assert.ok(variedGaps,'requests do not follow a fixed interval');
});

test('passenger cancellation exits the tunnel, stops visibly for alighting, then pays zero', () => {
  const road: RoadGraph = { ...graph, edges: { ...graph.edges, 'a-b': { ...graph.edges['a-b'], roadClass:'tunnel' }, 'b-c': { ...graph.edges['b-c'], roadClass:'motorway' } } };
  const moving = dropoff(road);
  assert.equal(moving.phase, 'dropoff');
  let state = cancelTrip(moving, road);
  assert.equal(state.phase, 'safe-dropoff');
  assert.equal(state.cancelledTrips, 0);
  assert.equal(state.navigation?.target.nodeId, 'd');
  assert.ok(state.activeTrip);
  assert.equal(cancelTrip(state, road), state);
  for (let index=0; index<100 && state.navigation?.stage !== 'servicing'; index++) state=advanceGame(state,.05,road);
  assert.equal(state.navigation?.stage, 'servicing');
  assert.equal(state.phase, 'safe-dropoff');
  assert.ok(getPhaseRemainingMinutes(state)>0);
  const stopped = getVehiclePosition(state, road);
  state=advanceGame(state,.1,road);
  assert.deepEqual(getVehiclePosition(state,road),stopped);
  assert.ok(state.activeTrip);
  state=advanceGame(state,.5,road);
  assert.equal(state.activeTrip,null);
  assert.equal(state.cancelledTrips,1);
  assert.equal(state.completedTrips,0);
  assert.equal(state.grossIncome,0);
  assert.ok(state.operatingCost>moving.operatingCost);
});

test('normal destination arrival stops 10–20 seconds before payment and cannot be cancelled after delivery',()=>{
  const accepted=acceptOffer(fresh(),graph);
  const travelMinutes=accepted.activeTrip!.waitMinutes+accepted.activeTrip!.boardingMinutes+2.5;
  const arrived=advanceGame(accepted,travelMinutes,graph);
  assert.equal(arrived.phase,'alighting');assert.equal(arrived.grossIncome,0);assert.equal(arrived.completedTrips,0);
  const remaining=getPhaseRemainingMinutes(arrived);assert.ok(remaining>=10/60 && remaining<=20/60);
  assert.equal(cancelTrip(arrived,graph),arrived,'delivered passengers cannot be converted to an unpaid cancellation');
  const position=getVehiclePosition(arrived,graph);const waiting=advanceGame(arrived,remaining/2,graph);
  assert.deepEqual(getVehiclePosition(waiting,graph),position);assert.equal(waiting.grossIncome,0);
  const complete=advanceGame(waiting,remaining/2,graph);
  assert.equal(complete.completedTrips,1);assert.equal(complete.grossIncome,accepted.activeTrip!.fareOnCompletion);assert.equal(complete.activeTrip,null);assert.equal(complete.cancelledTrips,0);
});

test('requesting a stop on a motorway navigates to a safe local road first', () => {
  const road: RoadGraph = { ...graph, edges: { ...graph.edges, 'a-b': { ...graph.edges['a-b'], roadClass:'motorway' } } };
  const state=parkTemporarily(fresh({graph:road}),road);
  assert.equal(state.parking,null);
  assert.equal(state.phase,'service-route');
  const parked=advanceGame(state,3,road);
  assert.equal(parked.parking?.kind,'temporary');
  assert.equal(parked.phase,'cruising');
});

test('Chinese expressways and low-model-speed arterial roads cannot become safe stops', () => {
  for(const name of ['北大嶼山公路','吐露港公路','青馬大橋','東區走廊','港深西部公路','西九龍幹線','油麻地天橋']) assert.equal(isSafeStoppingEdge({...graph.edges['a-b'],name,speedKph:38}),false,name);
  assert.equal(isSafeStoppingEdge({...graph.edges['a-b'],roadClass:'arterial',name:'主要道路',speedKph:38}),false);
  assert.equal(isSafeStoppingEdge(graph.edges['b-d']),true);
});

test('platform rate penalties require enough samples and escalate by 1, 3, 6 and 12 hours', () => {
  let state=fresh();
  const offer=state.currentOffer!;
  state={...state,currentOffer:null,platform:{...state.platform,offered:0}};
  for (const duration of [60,180,360,720]) {
    const start=state.clockMinutes;
    for(let count=0;count<20;count++) {
      state={...state,currentOffer:{...offer,id:`sample-${state.platform.offered}`,createdAt:start,expiresAt:start+4},platform:{...state.platform,offered:state.platform.offered+1}};
      state=declineOffer(state);
      if(count<19) assert.ok(state.platform.suspendedUntil<=start);
    }
    assert.equal(state.platform.suspendedUntil-start,duration);
    assert.equal(getPlatformStats(state).acceptanceRate,0);
    const suspended=advanceGame(state,1,graph);
    assert.equal(suspended.currentOffer,null);
    state={...state,clockMinutes:state.platform.suspendedUntil+.01,nextDemandMinute:state.platform.suspendedUntil+.25};
  }
});

test('high cancellations trigger only after ten accepted trips and preserve sunk expenses', () => {
  let state=acceptOffer(fresh(),graph);
  state={...state,acceptedOffers:9,cancelledTrips:7,platform:{...state.platform,offered:9}};
  state=cancelTrip(state,graph);
  assert.equal(state.platform.penaltyLevel,0);
  state=acceptOffer(fresh(),graph);
  state={...state,acceptedOffers:10,cancelledTrips:3,platform:{...state.platform,offered:12},operatingCost:19};
  state=cancelTrip(state,graph);
  assert.equal(state.platform.penaltyLevel,1);
  assert.equal(state.platform.suspendedUntil,60);
  assert.equal(state.operatingCost,19);
  assert.equal(getPlatformStats(state).cancellationRate,.4);
});

test('cheap station fuel changes subsequent expense without charging the tank twice', () => {
  const initial=fresh({vehicleId:'little-treasure',initialEnergyFraction:.4});
  initial.energy.unitPricePaid=10;
  const cheap=reachedService(navigateToStation(initial,station,graph));
  assert.equal(cheap.phase,'servicing');
  const beforeCost=cheap.operatingCost;
  const filled=advanceGame(cheap,getPhaseRemainingMinutes(cheap),graph);
  assert.equal(filled.energy.remaining,filled.energy.capacity);
  const expectedPrice=(cheap.energy.remaining*10+(cheap.energy.capacity-cheap.energy.remaining)*4)/cheap.energy.capacity;
  assert.ok(Math.abs(filled.energy.unitPricePaid-expectedPrice)<1e-8);
  assert.equal(filled.operatingCost,beforeCost);
  const expensiveService=reachedService(navigateToStation(initial,{...station,unitPrice:12},graph));
  const expensive=advanceGame(expensiveService,getPhaseRemainingMinutes(expensiveService),graph);
  const cheapDriven=advanceGame(setAcceptingOrders(filled,false),1,graph);
  const expensiveDriven=advanceGame(setAcceptingOrders(expensive,false),1,graph);
  assert.equal(cheapDriven.totalDistanceM,expensiveDriven.totalDistanceM);
  assert.ok(cheapDriven.operatingCost<expensiveDriven.operatingCost);
  assert.equal(initial.energy.unitPricePaid,10);
});

test('custom energy price overrides station prices and services are vehicle compatible', () => {
  const custom=fresh({energyUnitPriceOverride:3,initialEnergyFraction:.5});
  assert.equal(custom.energy.unitPricePaid,3);
  assert.equal(getEnergyServiceEstimate(custom,{...station,unitPrice:12}).cost,Math.round(custom.energy.capacity*.5*3*100)/100);
  const filling=reachedService(navigateToStation(custom,station,graph));
  const filled=advanceGame(filling,getPhaseRemainingMinutes(filling),graph);
  assert.equal(filled.energy.unitPricePaid,3);
  assert.equal(navigateToStation(custom,{...station,kind:'swap'},graph),custom);
  const free=fresh({energyUnitPriceOverride:0});
  assert.equal(free.energy.unitPricePaid,0);
  assert.equal(advanceGame(free,1,graph).operatingCost,0);
});

test('station navigation follows the road and can be cancelled before service starts', () => {
  const initial=fresh({initialEnergyFraction:.5});
  const target={...station,...graph.nodes.d,id:'remote-station',nodeId:'d'};
  const routed=navigateToStation(initial,target,graph);
  assert.ok(routed.phase==='service-route'||routed.phase==='fuel-queue');
  assert.deepEqual(getVehiclePosition(routed,graph),getVehiclePosition(initial,graph));
  const resumed=resumeDriving(routed,graph);
  assert.equal(resumed.phase,'cruising');
  assert.equal(resumed.navigation,null);
  const service=reachedService(routed);
  assert.equal(service.phase,'servicing');
  assert.equal(resumeDriving(service,graph),service);
});

test('empty energy never teleports or softlocks: paid timed recovery restores the original trip', () => {
  let state=dropoff(); state.energy.remaining=0;
  const position=getVehiclePosition(state,graph);
  const stalled=advanceGame(state,1,graph);
  assert.deepEqual(getVehiclePosition(stalled,graph),position);
  state=requestEnergyRecovery(stalled);
  assert.equal(state.phase,'servicing');
  assert.equal(state.operatingCost,stalled.operatingCost+250);
  const waiting=advanceGame(state,29.9,graph);
  assert.equal(waiting.phase,'servicing');
  assert.deepEqual(getVehiclePosition(waiting,graph),position);
  const recovered=advanceGame(waiting,.1,graph);
  assert.equal(recovered.phase,'dropoff');
  assert.ok(recovered.activeTrip);
  assert.ok(Math.abs(recovered.energy.remaining-recovered.energy.capacity*.2)<1e-8);
  assert.deepEqual(getVehiclePosition(recovered,graph),position);
  assert.ok(advanceGame(recovered,.1,graph).totalDistanceM>recovered.totalDistanceM);
});

test('cancelling during energy recovery preserves rescue and passenger-safe alighting', () => {
  let passenger=dropoff(); passenger.energy.remaining=0;
  passenger=cancelTrip(requestEnergyRecovery(passenger),graph);
  assert.equal(passenger.phase,'servicing');
  assert.ok(passenger.activeTrip);
  assert.equal(passenger.energyRecovery?.previousPhase,'safe-dropoff');
  passenger=advanceGame(passenger,30,graph);
  assert.equal(passenger.phase,'safe-dropoff');
  passenger=advanceGame(passenger,3,graph);
  assert.equal(passenger.activeTrip,null);
  assert.equal(passenger.cancelledTrips,1);
  let pickup=acceptOffer(fresh(),graph); pickup.energy.remaining=0;
  pickup=cancelTrip(requestEnergyRecovery(pickup),graph);
  assert.equal(pickup.activeTrip,null);
  assert.equal(pickup.phase,'servicing');
  pickup=advanceGame(pickup,30,graph);
  assert.equal(pickup.phase,'cruising');
  assert.equal(pickup.energyRecovery,null);
});

test('Little Treasure is calibrated to $120 for 400km and private default is explicitly cheaper', () => {
  const little=VEHICLE_BY_ID['little-treasure'].energyProfile!;
  assert.ok(Math.abs(little.consumptionPerKm*little.unitPrice*400-120)<1e-8);
  const privateCar=VEHICLE_BY_ID.private.energyProfile!;
  assert.ok(privateCar.consumptionPerKm*privateCar.unitPrice<1);
});

test('handover uses the selected named endpoint and ends only upon reaching it', () => {
  const initial=fresh({handoverPlace:places[1]});
  const routed=navigateToHandover(initial,graph);
  assert.equal(routed.phase,'service-route');
  assert.deepEqual(getVehiclePosition(routed,graph),getVehiclePosition(initial,graph));
  const ended=advanceGame(routed,5,graph);
  assert.equal(ended.phase,'ended');
  assert.equal(ended.clockMinutes,2.5);
  assert.ok(ended.totalDistanceM>=1000);
  assert.equal(ended.navigation,null);
});

test('one-hour reminder and deadline reject late handover without extending game time', () => {
  let state=fresh({handoverPlace:places[1]});
  state={...state,currentOffer:null,clockMinutes:659.9,nextDemandMinute:660.25,parking:{kind:'rest',startedAt:659.9},acceptingOrders:false};
  state=advanceGame(state,.1,graph);
  assert.equal(state.handoverReminderShown,true);
  assert.ok(state.logs.some(log=>log.kind==='shift' && log.text.includes('一小時')));
  state={...state,clockMinutes:719.9,nextDemandMinute:720.25};
  state=advanceGame(state,.1,graph);
  assert.equal(state.phase,'ended');
  assert.equal(state.handoverStatus,'missed');
  const ended=advanceGame(state,10,graph);
  assert.equal(ended.phase,'ended');
  assert.equal(ended.clockMinutes,720);
  assert.equal(ended.currentOffer,null);
});

test('shared district demand drives multiplier, four levels and bounded 1–10 minute estimates', () => {
  const levels=new Set<string>();
  for(let minute=0;minute<1440;minute+=8) {
    const conditions=demandConditions(42,minute,'油尖旺區');
    levels.add(conditions.level);
    assert.ok(conditions.waitMinutesMin>=1 && conditions.waitMinutesMax<=10);
    assert.ok(conditions.waitMinutesMax>=conditions.waitMinutesMin);
  }
  assert.equal(levels.size,4);
  const state=fresh();
  const local=getLocalDemandConditions(state,graph);
  assert.deepEqual(local,{district:local.district,...demandConditions(state.seed,state.startTimeMinutes,local.district,{position:getVehiclePosition(state,graph),landmarks:state.landmarks,supply:state.demandSupply})});
  assert.deepEqual(getSurgeAreas(state),getSurgeAreas(fresh()));
  assert.ok(getSurgeAreas(state).every(area=>area.level && area.center.lat && area.center.lon));
  for(const type of ['taxi-upfront','private-upfront'] as const) assert.equal(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'],8000,20,1.6,type),Math.round(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'],8000,20,1,type)*1.6*100)/100);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'],8000,20,1.6,'taxi-metered'),estimateDriverPayout(VEHICLE_BY_ID['kam-fung'],8000,20,1,'taxi-metered'));
});

test('v2 save upgrade preserves income, time and location while clearing removed ghosts', () => {
  const state=advanceGame(fresh(),.3,graph);
  const {energy,energyRecovery,platform,parking,navigation,acceptingOrders,demandCooldownUntil,handoverPlace,handoverReminderShown,...old}=state;
  const restored=normalizeGameState({...old,version:2,ghostOffers:[state.currentOffer],grossIncome:123,netIncome:-357},graph)!;
  assert.ok(restored);
  assert.equal(restored.version,3);
  assert.equal(restored.grossIncome,123);
  assert.equal(restored.clockMinutes,state.clockMinutes);
  assert.deepEqual(getVehiclePosition(restored,graph),getVehiclePosition(state,graph));
  assert.deepEqual(restored.ghostOffers,[]);
  assert.ok(restored.energy.remaining>0);
  assert.equal(normalizeGameState({...old,version:2,movement:{...old.movement,edgeId:'missing'}},graph),null);
  const repaired=normalizeGameState({...old,version:2,movement:{...old.movement,nextEdgeIds:['removed-future-edge']}},graph)!;
  assert.ok(repaired);
  assert.equal(repaired.clockMinutes,old.clockMinutes);
  assert.ok(repaired.movement.nextEdgeIds.every(id=>graph.edges[id]));
});

test('legal vehicle graph is cached and branch options remain connected with at most three choices', () => {
  const state=fresh();
  assert.equal(getVehicleGraph(state.vehicleId,graph),getVehicleGraph(state.vehicleId,graph));
  const branches=getUpcomingBranches(state,graph);
  for(const branch of branches) { assert.ok(branch.options.length<=3); assert.ok(branch.options.some(option=>option.selected)); for(const option of branch.options) assert.equal(graph.edges[option.edgeId].from,branch.junctionNodeId); }
  const trip=dropoff();
  const coordinates=getRemainingTripRouteCoordinates(trip,graph);
  assert.ok(coordinates.length>=2);
  const current=getVehiclePosition(trip,graph);
  assert.equal(coordinates[0].lat,current.lat);
  assert.equal(coordinates[0].lon,current.lon);
  assert.equal(coordinates.at(-1)!.lat,graph.nodes.c.lat);
});
