import assert from 'node:assert/strict';
import test from 'node:test';
import {MAP_DEMAND_REFRESH_MS, mergeMapDemandRequests, refreshMapDemand, sampleMapDemand, type MapDemandRequest} from './mapDemand';

const dawn = {seed: 17, startTimeMinutes: 60, clockMinutes: 14};
const first: MapDemandRequest = {id: 'one', pickup: {lat: 22.319, lon: 114.174}, requestedAt: 13};
const second: MapDemandRequest = {id: 'two', pickup: {lat: 22.3191, lon: 114.1741}, requestedAt: 14};

test('a single active pickup colours a fixed area and places its yellow dot at the pickup', () => {
  assert.deepEqual(sampleMapDemand(dawn, []), []);
  const [a] = sampleMapDemand(dawn, [first]);
  const [b] = sampleMapDemand(dawn, [second]);
  assert.equal(a.level, 'quiet');
  assert.deepEqual(a.pickupDot, first.pickup);
  assert.deepEqual(b.pickupDot, second.pickup);
  assert.equal(a.id, b.id);
  assert.deepEqual(a.center, b.center);
  assert.deepEqual(mergeMapDemandRequests([first], [first], dawn.clockMinutes), [first]);
  assert.deepEqual(sampleMapDemand({...dawn,clockMinutes: 24}, [first]), []);
});

test('requests keep dispatch timestamps while map samples hold for two real minutes', () => {
  const origin = 100_000;
  const initial = refreshMapDemand(undefined, dawn, [first], origin);
  assert.ok(initial?.areas.length);
  const nextWorld = {...dawn,clockMinutes: 134};
  assert.equal(refreshMapDemand(initial, nextWorld, [], origin + MAP_DEMAND_REFRESH_MS - 1), initial);
  const expired = refreshMapDemand(initial, nextWorld, [], origin + MAP_DEMAND_REFRESH_MS);
  assert.deepEqual(expired?.areas, []);
  assert.notEqual(expired, initial);
});
