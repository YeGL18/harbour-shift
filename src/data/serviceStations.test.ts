/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { ENERGY_PROFILE_DEFAULTS, getCompatibleStations, SERVICE_STATIONS } from './serviceStations';
import { getVehicleRoadGraph, isCoordinateAllowed, isPlaceAllowed, isRoadEdgeAllowed } from './vehicleAccess';
import { LANDMARKS } from './landmarks';
import { findRoute, routeLength } from '../game/routing';
import type { RoadGraph, VehicleId } from '../game/types';
import { advanceGame, createInitialState, getVehiclePosition, getPhaseRemainingMinutes, stationQueueApproachDetails, navigateToStation, requestEnergyRecovery, setAcceptingOrders } from '../game/engine';

test('official LPG station IDs and dated ceilings are complete without inventing unknown tariffs', () => {
  const lpg=SERVICE_STATIONS.filter(station=>station.kind==='lpg');
  assert.equal(lpg.length,66);
  assert.equal(new Set(SERVICE_STATIONS.map(station=>station.id)).size,SERVICE_STATIONS.length);
  const dedicated=lpg.filter(station=>station.dedicated);
  assert.equal(dedicated.length,12);
  for(const station of dedicated) {
    assert.equal(station.priceBasis,'official-ceiling');assert.equal(station.priceAsOf,'2026-11');
    assert.ok(station.unitPrice!>=4.19 && station.unitPrice!<=5.13);
    assert.ok(station.priceSourceUrl?.startsWith('https://www.info.gov.hk/'));
  }
  for(const station of lpg.filter(station=>!station.dedicated)) {
    assert.equal(station.unitPrice,undefined);assert.equal(station.priceBasis,'unverified');
  }
  assert.equal(getCompatibleStations('kam-fung').length,63);
  for(const blocked of ['emsd-lpg-10','emsd-lpg-26','emsd-lpg-66']) assert.ok(!getCompatibleStations('kam-fung').some(station=>station.id===blocked));
});

test('real trial swap sites are distinct from future planned stations and have no invented regular price', () => {
  const swaps=getCompatibleStations('red-flag');assert.equal(swaps.length,2);
  assert.deepEqual(swaps.map(station=>[station.lat,station.lon]),[[22.5222229,114.161551],[22.339061,114.111324]]);
  for(const station of swaps) {assert.equal(station.unitPrice,undefined);assert.equal(station.priceBasis,'unverified');assert.ok(station.sourceUrl?.includes('dragonrise.hk'));}
});

test('each compatible service point has a reachable non-restricted road anchor', () => {
  for(const id of ['kam-fung','little-treasure','red-flag','private'] as VehicleId[]) {
    const graph=getVehicleRoadGraph(id),origin=LANDMARKS.find(place=>place.id==='harbour-city')!;
    assert.equal(getVehicleRoadGraph(id,graph),graph,'already-filtered graphs retain their cached identity');
    const kind=ENERGY_PROFILE_DEFAULTS[id].kind;
    for(const station of getCompatibleStations(id)) {
      assert.equal(station.kind,kind);assert.ok(station.available!==false);assert.ok(station.name.trim());
      assert.ok(station.sourceRecordId);assert.ok(station.snapDistanceM!<=120);
      assert.ok(graph.nodes[station.nodeId]);assert.ok(graph.outgoing[station.nodeId]?.length);
      assert.ok(findRoute(origin.nodeId!,station.nodeId,graph)?.length,`${id} cannot reach ${station.id}`);
    }
  }
});

test('user shift observation is calibration and cheaper LPG station really supplies a different price', () => {
  const hybrid=ENERGY_PROFILE_DEFAULTS['little-treasure'];
  assert.ok(Math.abs(400*hybrid.consumptionPerKm*hybrid.unitPrice-120)<1e-9);
  const candidates=getCompatibleStations('kam-fung').filter(station=>station.unitPrice!==undefined);
  const cheapest=candidates.reduce((a,b)=>a.unitPrice!<b.unitPrice! ? a:b);
  assert.equal(cheapest.id,'emsd-lpg-46');assert.equal(cheapest.unitPrice,4.19);
  assert.ok(cheapest.unitPrice!<hybrid.unitPrice);
  for(const station of getCompatibleStations('private')) {assert.equal(station.unitPrice,16);assert.equal(station.priceBasis,'game-reference');}
});

test('restricted areas preserve airport, Disney and Tung Chung while respecting DB North taxi exception', () => {
  const cases=[
    ['Airport',22.3158,113.9185,true,true],['Tung Chung',22.289,113.941,true,true],['Disney',22.3127,114.0419,true,true],
    ['Tai O',22.255,113.862,false,false],['Mui Wo',22.265,114.000,false,false],['Ngong Ping',22.255,113.905,false,false],
    ['DB South',22.296,114.016,false,false],['DB North hotel',22.3071707,114.017038,true,false],
  ] as const;
  for(const [name,lat,lon,taxi,privateCar] of cases) {
    assert.equal(isCoordinateAllowed({lat,lon},'kam-fung'),taxi,name);
    assert.equal(isCoordinateAllowed({lat,lon},'private'),privateCar,name);
  }
  const hotel=LANDMARKS.find(place=>place.name==='香港愉景灣酒店')!,origin=LANDMARKS.find(place=>place.id==='harbour-city')!;
  assert.ok(isPlaceAllowed(hotel,'kam-fung'));assert.ok(!isPlaceAllowed(hotel,'private'));
  assert.ok(findRoute(origin.nodeId!,hotel.nodeId!,getVehicleRoadGraph('kam-fung'))?.length);
  assert.equal(getVehicleRoadGraph('private').nodes[hotel.nodeId!],undefined);
});

test('a route crossing a restricted polygon is rejected even when both endpoints are permitted', () => {
  const graph:RoadGraph={nodes:{a:{id:'a',lat:22.296,lon:113.99},b:{id:'b',lat:22.296,lon:114.04}},edges:{},outgoing:{a:['ab'],b:[]}};
  const edge={id:'ab',from:'a',to:'b',lengthM:5000};graph.edges.ab=edge;
  for(const id of ['kam-fung','private'] as VehicleId[]) {
    assert.ok(isCoordinateAllowed(graph.nodes.a,id));assert.ok(isCoordinateAllowed(graph.nodes.b,id));
    assert.ok(!isRoadEdgeAllowed(edge,graph,id),'endpoint-only filtering would miss the prohibited crossing');
  }
});

test('station prices change subsequent real movement cost through weighted fuel without double charging', () => {
  const stations=getCompatibleStations('kam-fung');
  const cheap=stations.find(station=>station.id==='emsd-lpg-46')!,expensive=stations.find(station=>station.id==='emsd-lpg-2')!;
  const rates:number[]=[];
  for(const station of [cheap,expensive]) {
    let state=createInitialState({vehicleId:'kam-fung',seed:42,startNodeId:station.nodeId,initialEnergyFraction:.25,handoverPlace:null});
    state=setAcceptingOrders(state,false);
    state=navigateToStation(state,station);
    for(let i=0;i<1200&&state.phase!=='servicing';i++)state=advanceGame(state,.1);
    assert.equal(state.phase,'servicing');
    const initialPrice=state.energy.unitPricePaid,remainingBefore=state.energy.remaining,costBefore=state.operatingCost;
    const expectedPrice=(remainingBefore*initialPrice+(state.energy.capacity-remainingBefore)*station.unitPrice!)/state.energy.capacity;
    state=advanceGame(state,getPhaseRemainingMinutes(state));
    assert.equal(state.energy.remaining,state.energy.capacity);
    assert.ok(Math.abs(state.energy.unitPricePaid-expectedPrice)<1e-10);
    assert.equal(state.operatingCost,costBefore,'approach fuel is charged, refill itself must not charge fuel a second time');
    const moved=advanceGame(state,.03),km=(moved.totalDistanceM-state.totalDistanceM)/1000;
    assert.ok(km>0);
    const rate=(moved.operatingCost-state.operatingCost)/km;
    assert.ok(Math.abs(rate-ENERGY_PROFILE_DEFAULTS['kam-fung'].consumptionPerKm*state.energy.unitPricePaid)<1e-8);
    rates.push(rate);
  }
  assert.ok(rates[0]<rates[1],'cheaper supplied fuel must reduce the cost of driving');
});

test('zero-energy service recovery preserves location and restores the ability to drive', () => {
  let state=createInitialState({vehicleId:'kam-fung',seed:42,initialEnergyFraction:0,handoverPlace:null});
  state=setAcceptingOrders(state,false);
  const position=getVehiclePosition(state);
  state=requestEnergyRecovery(state);
  assert.equal(state.phase,'servicing');assert.equal(state.operatingCost,250);
  state=advanceGame(state,30);
  assert.equal(state.energyRecovery,null);
  assert.deepEqual(getVehiclePosition(state),position,'game recovery does not teleport the taxi');
  assert.ok(Math.abs(state.energy.remaining-state.energy.capacity*.2)<1e-9);
  const moved=advanceGame(state,.1);
  assert.ok(moved.totalDistanceM>state.totalDistanceM);
});

test('an explicit zero game energy-price override remains zero for each vehicle', () => {
  for(const vehicleId of ['kam-fung','little-treasure','red-flag','private'] as VehicleId[]) {
    let state=createInitialState({vehicleId,seed:42,energyUnitPriceOverride:0,handoverPlace:null});
    assert.equal(state.energy.unitPriceOverride,0);assert.equal(state.energy.unitPricePaid,0);
    state=setAcceptingOrders(state,false);
    const moved=advanceGame(state,.03);
    assert.ok(moved.totalDistanceM>0);assert.equal(moved.operatingCost,0);
  }
});


test('every compatible LPG station has a connected safe waiting prefix with directed drive-through connector',()=>{
  const graph=getVehicleRoadGraph('kam-fung');
  for(const station of getCompatibleStations('kam-fung')){
    const details=stationQueueApproachDetails(station,graph),prefix=details.edgeIds.slice(0,details.edgeIds.length-details.connectorEdgeIds.length);
    assert.ok(prefix.length,station.id);assert.ok(routeLength(prefix,graph)>=56,`${station.id} needs road space for eight real players`);
    prefix.forEach(id=>assert.equal(graph.edges[id].safeStop,true,`${station.id}: waiting must remain on safe local edges`));
    details.edgeIds.forEach((id,index)=>{if(index)assert.equal(graph.edges[details.edgeIds[index-1]].to,graph.edges[id].from,station.id);});
    assert.equal(graph.edges[details.edgeIds.at(-1)!].to,station.nodeId,station.id);
  }
});
