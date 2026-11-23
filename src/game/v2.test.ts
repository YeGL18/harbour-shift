/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { acceptOffer, advanceGame, cancelTrip, chooseTripRoute, createInitialState, declineOffer, formatClock, getNearbyCandidates, getPhaseRemainingMinutes, getSummary, getUpcomingBranches, getVehiclePosition, normalizeGameState, pickupTiming } from './engine';
import { calculateMeteredFare, estimateDriverPayout, isPricingTypeEligible, pricingTypesForVehicle } from '../data/fares';
import { getRentalCost, VEHICLE_BY_ID } from '../data/vehicles';
import { LANDMARKS } from '../data/landmarks';
import { ROAD_GRAPH } from '../map/roadGraph';
import type { GameState, InitialGameOptions, Landmark, PricingType, RoadGraph } from './types';

const graph: RoadGraph = { nodes: {}, edges: {}, outgoing: {} };
for (const [id, lat, lon] of [['a', 22.300, 114.160], ['b', 22.305, 114.160], ['c', 22.310, 114.160], ['d', 22.305, 114.165], ['e', 22.310, 114.165]] as const) graph.nodes[id] = { id, lat, lon };
for (const [a, b] of [['a','b'], ['b','c'], ['b','d'], ['c','e'], ['d','e']]) for (const [from, to] of [[a,b],[b,a]]) {
  const id = `${from}-${to}`; graph.edges[id] = { id, from, to, lengthM: 500, speedKph: 24, name: `${from}${to}道` }; (graph.outgoing[from] ||= []).push(id);
}
const places: Landmark[] = [
  { ...graph.nodes.a, id: 'harbour-city', name: '海港城', district: '尖沙咀', kind: 'transport', nodeId: 'a', waitingProfile: 'ordinary' },
  { ...graph.nodes.c, id: 'megabox', name: 'MegaBox', district: '九龍灣', kind: 'transport', nodeId: 'c' },
  { ...graph.nodes.d, id: 'sorrento', name: '擎天半島', district: '佐敦', kind: 'residential', nodeId: 'd' },
];
const fresh = (options: InitialGameOptions = {}) => createInitialState({ graph, landmarks: places, seed: 42, startNodeId: 'a', ...options });

function inPhase(phase: 'pickup' | 'waiting' | 'boarding' | 'dropoff'): GameState {
  let state = fresh();
  if (phase === 'pickup') return acceptOffer(advanceGame(state, 0.3, graph), graph);
  state = acceptOffer(state, graph);
  if (phase === 'waiting') return state;
  if (phase === 'boarding') return advanceGame(state, state.activeTrip!.waitMinutes + 0.00001, graph);
  return advanceGame(state, state.activeTrip!.waitMinutes + state.activeTrip!.boardingMinutes + 0.1, graph);
}

test('v2 supports custom named start, clock, shifts and exact supplied rentals', () => {
  assert.equal(getRentalCost('kam-fung','day'), 480);
  assert.equal(getRentalCost('kam-fung','night'), 370);
  assert.equal(getRentalCost('little-treasure','day'), 560);
  assert.equal(getRentalCost('little-treasure','night'), 490);
  assert.equal(getRentalCost('red-flag','day'), 560);
  assert.equal(getRentalCost('red-flag','night'), 490);
  assert.equal(getRentalCost('red-flag','night', 625), 625);
  const state = createInitialState({ graph, landmarks: places, startPlaceId: 'sorrento', shift: 'night', startTimeMinutes: 1305, rentalOverride: 123.45 });
  assert.equal(state.version, 3);
  assert.equal(state.rentalCostApplied, 123.45);
  assert.equal(state.netIncome, -123.45);
  assert.equal(formatClock(state), '21:45');
  assert.equal(getVehiclePosition(state, graph).lat, graph.nodes.d.lat);
  assert.equal(getSummary(state).expenses, 123.45);
});

test('waiting and boarding hold the car at pickup and expose exact countdowns', () => {
  const state = inPhase('waiting');
  assert.equal(state.phase, 'waiting');
  const position = getVehiclePosition(state, graph);
  const half = advanceGame(state, state.activeTrip!.waitMinutes / 2, graph);
  assert.equal(half.phase, 'waiting');
  assert.deepEqual(getVehiclePosition(half, graph), position);
  assert.equal(half.totalDistanceM, state.totalDistanceM);
  assert.ok(getPhaseRemainingMinutes(half) > 0);
  const boarding = inPhase('boarding');
  assert.equal(boarding.phase, 'boarding');
  assert.deepEqual(getVehiclePosition(boarding, graph), position);
  assert.ok(getPhaseRemainingMinutes(boarding) > 0);
  const moving = inPhase('dropoff');
  assert.equal(moving.phase, 'dropoff');
  assert.equal(getPhaseRemainingMinutes(moving), 0);
});

test('a custom map start never becomes a synthetic POI and reuses the cached legal catalog', () => {
  const anchor = LANDMARKS[0];
  const custom: Landmark = { ...anchor, id: 'custom-map-pin', name: '自選路口' };
  const state = createInitialState({ startPlace: custom, seed: 123 });
  assert.ok(state.landmarks === createInitialState({ seed: 123 }).landmarks);
  const sourcePlaces = new Set(LANDMARKS);
  assert.ok(state.landmarks.every(place => sourcePlaces.has(place)));
  assert.equal(state.startLabel, '自選路口');
  assert.ok(!state.landmarks.some(place => place.id === custom.id));
  assert.notEqual(state.currentOffer?.pickup.id, custom.id);
  const restored = normalizeGameState({ ...state, landmarks: LANDMARKS })!;
  assert.deepEqual(getVehiclePosition(restored), getVehiclePosition(state));
});

for (const phase of ['pickup','waiting','boarding'] as const) test(`cancelling ${phase} pays zero and retains sunk time, distance and cost`, () => {
  const state = inPhase(phase);
  assert.equal(state.phase, phase);
  const cancelled = cancelTrip(state, graph);
  assert.equal(cancelled.activeTrip, null);
  assert.equal(cancelled.phase, 'cruising');
  assert.equal(cancelled.clockMinutes, state.clockMinutes);
  assert.equal(cancelled.operatingCost, state.operatingCost);
  assert.equal(cancelled.totalDistanceM, state.totalDistanceM);
  assert.equal(cancelled.grossIncome, 0);
  assert.equal(cancelled.completedTrips, 0);
  assert.equal(cancelled.cancelledTrips, 1);
  assert.deepEqual(getVehiclePosition(cancelled, graph), getVehiclePosition(state, graph));
  assert.equal(cancelTrip(cancelled, graph), cancelled);
});

test('nearby observations survive age and the old 24-row cap while within 2.5km', () => {
  const initial = fresh();
  const old = { ...initial.currentOffer!, createdAt: -100, expiresAt: -96, feedKind: 'along-route' as const, routeEstimated: true };
  initial.observedOffers = Array.from({ length: 30 }, (_, index) => ({ ...old, id: `nearby-${index}` }));
  initial.parking = { kind: 'rest', startedAt: 0 };
  const state = advanceGame(initial, 1, graph);
  assert.ok(state.observedOffers.length >= 30);
  assert.ok(state.observedOffers.some(offer => offer.id === 'nearby-0'));
  assert.equal(state.grossIncome, 0);
  assert.equal(state.ghost, null);
});

test('route choices cannot revive the removed counterfactual feed', () => {
  const initial = acceptOffer(fresh(), graph);
  const alternate = { ...initial, movement: { ...initial.movement, nextEdgeIds: ['b-d','d-e','e-c'] } };
  const a = advanceGame(initial, 1.5, graph);
  const b = advanceGame(alternate, 1.5, graph);
  assert.deepEqual(a.ghostOffers, []);
  assert.deepEqual(b.ghostOffers, []);
});

test('different shift start times query the same world cell at the same absolute virtual time', () => {
  let early = fresh({ startTimeMinutes: 360 });
  let late = fresh({ startTimeMinutes: 420 });
  early = { ...early, clockMinutes: 60, nextDemandMinute: 60.25, demandIndex: 241, currentOffer: null, parking: { kind: 'rest', startedAt: 60 }, acceptingOrders: false };
  late = { ...late, nextDemandMinute: .25, demandIndex: 1, currentOffer: null, parking: { kind: 'rest', startedAt: 0 }, acceptingOrders: false };
  early = advanceGame(early, 32, graph);
  late = advanceGame(late, 32, graph);
  assert.ok(early.observedOffers.length > 0);
  assert.deepEqual(early.observedOffers.map(offer => offer.id), late.observedOffers.map(offer => offer.id));
});

test('nearby observations are removed only when their pickup is more than 2.5km away', () => {
  const initial = fresh();
  initial.observedOffers = [{ ...initial.currentOffer!, id: 'far-info', pickup: { ...places[0], lat: places[0].lat + .03 } }, { ...initial.currentOffer!, id: 'near-info' }];
  initial.parking = { kind: 'rest', startedAt: 0 };
  const state = advanceGame(initial, .1, graph);
  assert.ok(!state.observedOffers.some(offer => offer.id === 'far-info'));
  assert.ok(state.observedOffers.some(offer => offer.id === 'near-info'));
});

test('rural wait profile is explicit: urban Sai Kung places stay ordinary', () => {
  let sawLongRuralWait = false;
  const urban = { ...places[0], district: '西貢區', waitingProfile: 'ordinary' as const };
  const rural = { ...urban, waitingProfile: 'saikung' as const };
  for (let seed = 0; seed < 300; seed += 1) {
    const ordinary = pickupTiming(seed, `offer-${seed}`, urban);
    const long = pickupTiming(seed, `offer-${seed}`, rural);
    assert.ok(ordinary.totalMinutes >= 0.05 && ordinary.totalMinutes <= 3);
    assert.ok(long.totalMinutes >= 0.05 && long.totalMinutes <= 10);
    assert.ok(Math.abs(ordinary.waitMinutes + ordinary.boardingMinutes - ordinary.totalMinutes) < 0.000001);
    if (long.totalMinutes > 3) sawLongRuralWait = true;
  }
  assert.ok(sawLongRuralWait);
});

test('taxi pricing is independent of vehicle, private cars only receive their eligible type', () => {
  assert.equal(pricingTypesForVehicle(VEHICLE_BY_ID['kam-fung']).length, 4);
  assert.deepEqual(pricingTypesForVehicle(VEHICLE_BY_ID.private), ['private-upfront']);
  const seen = new Set<PricingType>();
  for (const vehicleId of ['kam-fung','private'] as const) {
    let state = fresh({ vehicleId,startTimeMinutes:360 });
    for (let tick = 0; tick < 100; tick += 1) {
      if (state.currentOffer) {
        assert.ok(isPricingTypeEligible(VEHICLE_BY_ID[vehicleId], state.currentOffer.pricingType));
        if (vehicleId === 'kam-fung') seen.add(state.currentOffer.pricingType);
        else assert.equal(state.currentOffer.pricingType, 'private-upfront');
        state = declineOffer(state);
      }
      state = advanceGame(state, 0.5, graph);
    }
  }
  assert.equal(seen.size, 4);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'], 10000, 20, 1, 'private-upfront'), estimateDriverPayout(VEHICLE_BY_ID.private, 10000, 20, 1, 'private-upfront'));
  const invalid = fresh({ vehicleId: 'private' });
  invalid.currentOffer = { ...invalid.currentOffer!, pricingType: 'taxi-metered' };
  assert.equal(acceptOffer(invalid, graph), invalid);
});

test('metered and 85 percent prices use distance ticks, not normal driving minutes or surge', () => {
  assert.equal(calculateMeteredFare(2000), 29);
  assert.equal(calculateMeteredFare(2001), 31.1);
  assert.equal(calculateMeteredFare(9000), 102.5);
  assert.equal(calculateMeteredFare(9200), 103.9);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'], 2000, 100, 3, 'taxi-metered'), 29);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'], 2000, 100, 3, 'taxi-discount85'), 24.65);
});

function fareFixture(pricingType: PricingType) {
  const road: RoadGraph = { nodes: {}, edges: {}, outgoing: {} };
  for (const [id, lat, lon] of [['p',22.29,114.16],['a',22.30,114.16],['b',22.31,114.16],['c',22.32,114.17],['d',22.33,114.16]] as const) road.nodes[id] = { id, lat, lon };
  for (const [from,to,lengthM,speed] of [['p','a',1000,24],['a','b',1000,40],['b','c',3000,120],['c','d',3000,120],['b','d',2500,10],['d','p',5000,40]] as const) {
    const id = `${from}-${to}`; road.edges[id] = { id, from, to, lengthM, speedKph: speed }; (road.outgoing[from] ||= []).push(id);
  }
  const catalog: Landmark[] = [
    { ...road.nodes.a, id: 'harbour-city', name: '上客點', district: '測試', kind: 'transport', nodeId: 'a' },
    { ...road.nodes.d, id: 'megabox', name: '落客點', district: '測試', kind: 'transport', nodeId: 'd' },
  ];
  let state = createInitialState({ graph: road, landmarks: catalog, startNodeId: 'p', seed: 7 });
  state.currentOffer = { ...state.currentOffer!, pricingType, estimatedFare: estimateDriverPayout(VEHICLE_BY_ID['kam-fung'], 7000, 4.5, 1, pricingType) };
  state = acceptOffer(state, road);
  return { state, road };
}

test('pickup distance is never added to the passenger meter', () => {
  let { state, road } = fareFixture('taxi-metered');
  state = advanceGame(state, 2.5, road);
  assert.equal(state.phase, 'waiting');
  assert.equal(state.activeTrip?.paidDistanceM, 0);
  assert.equal(state.activeTrip?.actualDistanceM, 1000);
  state = advanceGame(state, 20, road);
  assert.equal(state.completedTrips, 1);
  assert.equal(state.grossIncome, calculateMeteredFare(7000));
});

test('a shorter passenger route changes the final meter and 85 percent meter fare', () => {
  for (const pricingType of ['taxi-metered','taxi-discount85'] as const) {
    let { state, road } = fareFixture(pricingType);
    state = advanceGame(state, 2.5, road);
    state = chooseTripRoute(state, 'economy', road);
    state = advanceGame(state, 30, road);
    assert.equal(state.completedTrips, 1);
    assert.equal(state.grossIncome, Math.round(calculateMeteredFare(3500) * (pricingType === 'taxi-discount85' ? 0.85 : 1) * 100) / 100);
  }
});

test('upfront contract stays locked after a shorter route and cannot pay after cancellation', () => {
  let { state, road } = fareFixture('taxi-upfront');
  const quoted = state.activeTrip!.offer.estimatedFare;
  state = advanceGame(state, 2.5, road);
  state = chooseTripRoute(state, 'economy', road);
  state = advanceGame(state, 30, road);
  assert.equal(state.grossIncome, quoted);
  assert.equal(cancelTrip(state, road), state);
});

test('seeded local demand has quiet gaps and never imports remote pickup points', () => {
  const remote = Array.from({ length: 1000 }, (_, index): Landmark => ({ ...places[1], id: `remote-${index}`, name: `遠方地點${index}`, lat: 23, lon: 115 }));
  let state = fresh({ landmarks: [...places, ...remote] });
  let offers = 0;
  const arrivalTimes: number[] = [];
  for (let tick = 0; tick < 240; tick += 1) {
    if (state.currentOffer) { assert.ok(!state.currentOffer.pickup.id.startsWith('remote')); offers += 1; arrivalTimes.push(state.clockMinutes); state = declineOffer(state); }
    state = advanceGame(state, .5, graph);
  }
  assert.ok(offers >= 2);
  assert.ok(arrivalTimes.some((time, index) => index > 0 && time - arrivalTimes[index - 1] > 2));
  assert.ok(getNearbyCandidates(state, 1800, 30, graph).every(place => !place.id.startsWith('remote')));
});

test('large pre-snapped catalog stays shared and never scans all road nodes per POI', () => {
  const large: Landmark[] = Array.from({ length: 40000 }, (_, index) => ({ ...places[index % places.length], id: `large-${index}`, name: `測試樓宇${index}` }));
  let nodeEnumerations = 0;
  const nodes = new Proxy(graph.nodes, { ownKeys(target) { nodeEnumerations += 1; return Reflect.ownKeys(target); } });
  const instrumented = { ...graph, nodes };
  const start = performance.now();
  let state = createInitialState({ graph: instrumented, landmarks: large, startNodeId: 'a', seed: 2 });
  const initializationMs = performance.now() - start;
  assert.equal(state.landmarks, large);
  assert.ok(nodeEnumerations <= 2, `enumerated the entire node map ${nodeEnumerations} times`);
  assert.ok(initializationMs < 2000, `initialization took ${initializationMs.toFixed(1)} ms`);
  state = advanceGame(state, 3, instrumented);
  assert.equal(state.landmarks, large);
  assert.ok(getNearbyCandidates(state, 1800, 25, instrumented).length <= 25);
});

test('duplicate outgoing geometry is merged while a true same-name fork remains', () => {
  const duplicateGraph: RoadGraph = { ...graph, edges: { ...graph.edges, 'b-c-copy': { ...graph.edges['b-c'], id: 'b-c-copy' } }, outgoing: { ...graph.outgoing, b: [...graph.outgoing.b, 'b-c-copy'] } };
  let state = fresh({ graph: duplicateGraph });
  state.movement.nextEdgeIds[0] = 'b-c-copy';
  const branch = getUpcomingBranches(state, duplicateGraph)[0];
  assert.equal(branch.options.filter(option => duplicateGraph.edges[option.edgeId].to === 'c').length, 1);
  assert.ok(branch.options.some(option => option.edgeId === 'b-c-copy' && option.selected));
  const divergent: RoadGraph = { ...duplicateGraph, edges: { ...duplicateGraph.edges, 'b-c-copy': { ...duplicateGraph.edges['b-c-copy'], shape: [graph.nodes.b, { lat: 22.307, lon: 114.163 }, graph.nodes.c] } } };
  state = fresh({ graph: divergent });
  const realFork = getUpcomingBranches(state, divergent)[0];
  assert.equal(realFork.options.filter(option => divergent.edges[option.edgeId].to === 'c').length, 2, 'same destination alone does not merge different curves');
  assert.equal(new Set(realFork.options.map(option => option.name)).size, realFork.options.length);
});

test('a junction with only duplicate choices is skipped for the next real fork', () => {
  const road: RoadGraph = { ...graph, edges: { ...graph.edges, 'b-c-copy': { ...graph.edges['b-c'], id: 'b-c-copy' } }, outgoing: { ...graph.outgoing, b: ['b-a','b-c','b-c-copy'], c: ['c-b','c-e','c-d'] } };
  road.edges['c-d'] = { id: 'c-d', from: 'c', to: 'd', lengthM: 500, speedKph: 24 };
  const state = fresh({ graph: road });
  state.movement.nextEdgeIds = ['b-c','c-e','e-d'];
  assert.equal(getUpcomingBranches(state, road)[0].junctionNodeId, 'c');
});

test('Sai Kung Fuk Man Road keeps its genuine northwest and southeast alternatives', () => {
  const incoming = ROAD_GRAPH.edges['td-60804-f'];
  assert.ok(incoming);
  const state = createInitialState({ startNodeId: incoming.from, seed: 20261118 });
  state.movement = { edgeId: incoming.id, distanceOnEdgeM: 0, nextEdgeIds: ['td-61846-f'] };
  const options = getUpcomingBranches(state)[0].options;
  assert.ok(options.some(option => option.edgeId === 'td-61846-f'));
  assert.ok(options.some(option => option.edgeId === 'td-62383-f'));
  assert.equal(new Set(options.map(option => option.name)).size, options.length);
});
