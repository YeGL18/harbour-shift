/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptOffer, advanceGame, chooseBranch, createInitialState, declineOffer, getLookahead, getSummary, getUpcomingBranches, getVehiclePosition } from './engine';
import { findRoute, routeLength } from './routing';
import { estimateDriverPayout, progressiveDistanceFare, PRIVATE_UPFRONT_RATES } from '../data/fares';
import { VEHICLE_BY_ID } from '../data/vehicles';
import { ROAD_GRAPH } from '../map/roadGraph';
import type { GameState, Landmark, RoadGraph } from './types';

const nodes = {
  a: { id: 'a', lat: 22.30, lon: 114.16 },
  b: { id: 'b', lat: 22.305, lon: 114.16 },
  c: { id: 'c', lat: 22.310, lon: 114.16 },
  d: { id: 'd', lat: 22.305, lon: 114.165 },
  e: { id: 'e', lat: 22.310, lon: 114.165 },
};
const graph: RoadGraph = { nodes, edges: {}, outgoing: {} };
for (const [from, to] of [['a', 'b'], ['b', 'c'], ['b', 'd'], ['c', 'e'], ['d', 'e']]) {
  for (const [start, end] of [[from, to], [to, from]]) {
    const id = `${start}-${end}`;
    graph.edges[id] = { id, from: start, to: end, lengthM: 500, name: `${start}${end}道`, speedKph: 24 };
    (graph.outgoing[start] ||= []).push(id);
  }
}
const places: Landmark[] = [
  { ...nodes.a, id: 'harbour-city', name: '海港城', district: '尖沙咀', kind: 'shopping', nodeId: 'a' },
  { ...nodes.c, id: 'megabox', name: 'MegaBox', district: '九龍灣', kind: 'shopping', nodeId: 'c' },
  { ...nodes.d, id: 'sorrento', name: '擎天半島', district: '佐敦', kind: 'residential', nodeId: 'd' },
];
const fresh = () => createInitialState({ seed: 42, graph, landmarks: places, startNodeId: 'a' });

test('same seed and actions produce identical state, and advance is immutable', () => {
  const initial = fresh();
  const a = advanceGame(acceptOffer(initial, graph), 15, graph);
  const b = advanceGame(acceptOffer(fresh(), graph), 15, graph);
  assert.deepEqual(a, b);
  assert.equal(initial.clockMinutes, 0);
  assert.equal(initial.acceptedOffers, 0);
  assert.equal(initial.movement.distanceOnEdgeM, 0);
});

test('tap upcoming branch changes connected itinerary without teleporting', () => {
  const state = fresh();
  const branch = getUpcomingBranches(state, graph)[0];
  assert.equal(branch.junctionNodeId, 'b');
  const turned = chooseBranch(state, 'b', 'b-d', graph);
  assert.deepEqual(getVehiclePosition(turned, graph), getVehiclePosition(state, graph));
  assert.equal(turned.movement.nextEdgeIds[0], 'b-d');
  const travelled = advanceGame(turned, 1.5, graph);
  assert.equal(travelled.movement.edgeId, 'b-d');
  assert.ok(travelled.movement.distanceOnEdgeM > 0);
  assert.equal(chooseBranch(state, 'e', 'e-d', graph), state, 'a remote or past junction is not selectable');
});

test('lookahead is clipped to one kilometre and tapers', () => {
  const segments = getLookahead(fresh(), 1000, graph);
  assert.equal(segments.reduce((sum, segment) => sum + segment.lengthM, 0), 1000);
  assert.ok(segments.at(-1)!.opacity < segments[0].opacity);
});

test('accepting a moving offer preserves position, locks dispatch, and finishes a paid trip', () => {
  const moving = advanceGame(fresh(), 0.5, graph);
  const before = getVehiclePosition(moving, graph);
  const accepted = acceptOffer(moving, graph);
  assert.deepEqual(getVehiclePosition(accepted, graph), before);
  assert.equal(accepted.phase, 'pickup');
  assert.equal(accepted.currentOffer, null);
  assert.equal(advanceGame(accepted, 0.5, graph).currentOffer, null);
  const finished = advanceGame(accepted, 10, graph);
  assert.equal(finished.completedTrips, 1);
  assert.ok(finished.grossIncome > 0);
  assert.equal(finished.activeTrip, null);
  assert.ok(finished.operatingCost > 0);
});

test('declining keeps the cruising itinerary and removes only the offer', () => {
  const state = fresh();
  const declined = declineOffer(state);
  assert.equal(declined.currentOffer, null);
  assert.equal(declined.declinedOffers, 1);
  assert.deepEqual(declined.movement, state.movement);
});

test('accepting never starts the removed counterfactual route or earns informational income', () => {
  const accepted = acceptOffer(fresh(), graph);
  const watched = advanceGame(accepted, 1.5, graph);
  assert.equal(watched.ghost, null);
  assert.deepEqual(watched.ghostOffers, []);
  assert.equal(watched.ghostOffer, null);
  assert.equal(watched.grossIncome, 0);
  const later = advanceGame(watched, 20, graph);
  assert.equal(later.ghost, null);
  assert.deepEqual(later.ghostOffers, []);
});

test('a cruising shift ends exactly at 720 minutes, with no extra dispatch', () => {
  const ended = advanceGame({ ...fresh(), handoverPlace: null }, 900, graph);
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.clockMinutes, 720);
  assert.equal(ended.currentOffer, null);
  assert.equal(ended.summary?.overtimeMinutes, 0);
  assert.equal(advanceGame(ended, 30, graph), ended);
});

test('a request which cannot finish and return before handover is rejected without overtime', () => {
  const state=fresh();state.clockMinutes=719;state.nextDemandMinute=721;state.nextEventMinute=800;
  state.currentOffer={...state.currentOffer!,createdAt:719,expiresAt:723};
  assert.equal(acceptOffer(state,graph),state);
  const ended=advanceGame(state,30,graph);
  assert.equal(ended.phase,'ended');assert.equal(ended.completedTrips,0);
  assert.ok(ended.clockMinutes<=720);assert.equal(ended.summary?.overtimeMinutes,0);assert.equal(ended.currentOffer,null);
});

test('canonical upfront payout does not increase when the driven route is longer', () => {
  let accepted = acceptOffer(fresh(), graph);
  const quoted = accepted.activeTrip!.offer.estimatedFare;
  accepted.movement.nextEdgeIds = ['b-d', 'd-e', 'e-c'];
  const ended = advanceGame(accepted, 20, graph);
  assert.equal(ended.grossIncome, quoted);
  assert.equal(ended.completedTrips, 1);
});

test('driver net-rate tiers are continuous and no second commission is charged', () => {
  assert.ok(Math.abs(progressiveDistanceFare(5) - 23.45) < 0.00001);
  assert.ok(Math.abs(progressiveDistanceFare(10) - 52.2) < 0.00001);
  assert.ok(Math.abs(progressiveDistanceFare(5.00001) - progressiveDistanceFare(5)) < 0.001);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID['kam-fung'], 10000, 20), 101.9);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID.private, 0, 0), 29.89);
  assert.equal(estimateDriverPayout(VEHICLE_BY_ID['red-flag'], 0, 0), 35.06);
  assert.equal(progressiveDistanceFare(5, PRIVATE_UPFRONT_RATES.distanceBands), 20.75);
});

test('directed shortest paths never invent a disconnected segment', () => {
  const route = findRoute('a', 'e', graph)!;
  assert.equal(routeLength(route, graph), 1500);
  let node = 'a';
  for (const edgeId of route) { assert.equal(graph.edges[edgeId].from, node); node = graph.edges[edgeId].to; }
  assert.equal(node, 'e');
});

test('income summary includes fixed vehicle cost once', () => {
  const state: GameState = { ...fresh(), grossIncome: 1000, operatingCost: 100, netIncome: 420 };
  assert.equal(getSummary(state).expenses, 580); // 100 operating + user-provided 480 day rental, once.
  assert.equal(getSummary(state).netIncome, 420);
});

test('overtime never makes a loss look better on the leaderboard', () => {
  const state: GameState = { ...fresh(), clockMinutes: 800, netIncome: -200 };
  assert.equal(getSummary(state).score, -200);
});

test('all bundled named HK places have connected directed road routes', () => {
  const state = createInitialState();
  assert.ok(state.landmarks.length >= 12);
  const sample = [...new Map(state.landmarks.map(place => [place.district, place])).values()].slice(0, 18);
  for (const origin of sample) {
    for (const destination of sample.slice(0, 2)) {
      if (origin.id === destination.id) continue;
      const route = findRoute(origin.nodeId!, destination.nodeId!, ROAD_GRAPH);
      assert.ok(route?.length, `${origin.name} → ${destination.name} must have a real road route`);
      let node = origin.nodeId!;
      for (const id of route!) {
        assert.equal(ROAD_GRAPH.edges[id].from, node);
        node = ROAD_GRAPH.edges[id].to;
      }
      assert.equal(node, destination.nodeId);
    }
  }
});
