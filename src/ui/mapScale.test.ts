import test from 'node:test';
import assert from 'node:assert/strict';
import { insetScreenCornerRadius, queueVehicleScale, vehicleMarkerScale } from '../map/mapScale';
import { makeSurgeLayers, surgeSignature } from '../map/surgeLayers';
import type { SurgeArea } from '../game/types';

test('vehicle detail increases monotonically with zoom and remains visible at overview altitude', () => {
  let previous = 0;
  for (let zoom = 8; zoom < 19; zoom += .025) {
    const scale = vehicleMarkerScale(zoom);
    assert.ok(scale >= .64 && scale <= 1 && scale >= previous);
    previous = scale;
  }
  assert.ok(68 * vehicleMarkerScale(8) > 40);
  assert.equal(vehicleMarkerScale(16), 1);
  assert.equal(vehicleMarkerScale(Number.NaN), vehicleMarkerScale(14.8));
});

test('hardware corners account for card margins and retain normal card shape when unavailable', () => {
  assert.equal(insetScreenCornerRadius(52, 12, 12), 40);
  assert.equal(insetScreenCornerRadius(52, 12, 24), 28);
  assert.equal(insetScreenCornerRadius(52, 12, 60), 22);
  assert.equal(insetScreenCornerRadius(0, 12, 24), 22);
  assert.equal(insetScreenCornerRadius(Number.NaN, 12, 24), 22);
});

test('queue models represent real car length close up and remain compact in distant views', () => {
  const metresPerPoint = 78271.51696 * Math.cos(22.3 * Math.PI / 180) / 2 ** 18.5;
  assert.ok(Math.abs(queueVehicleScale(18.5, 22.3) * 68 * metresPerPoint - 6.5) < .01);
  assert.ok(queueVehicleScale(8, 22.3) * 68 >= 3.5);
  assert.ok(queueVehicleScale(14.8, 22.3) < vehicleMarkerScale(14.8) / 4);
});

const area: SurgeArea = { id: 'field', name: 'Test field', center: { lat: 22.3, lon: 114.17 }, level: 'busy', multiplier: 1.2, waitMinutesMin: 2, waitMinutesMax: 4, radiusM: 2000, intensity: .5, sampledAtMinute: 10 };
test('heat footprint follows authority radius and intensity without reshuffling the cloud', () => {
  const first = JSON.parse(makeSurgeLayers([area]).heat);
  const resized = JSON.parse(makeSurgeLayers([{ ...area, radiusM: 4000 }]).heat);
  const stronger = JSON.parse(makeSurgeLayers([{ ...area, intensity: 1 }]).heat);
  assert.equal(first.features.length, 9);
  assert.equal(resized.features[0].properties.radiusAtZoom14, first.features[0].properties.radiusAtZoom14 * 2);
  for (let i = 0; i < first.features.length; i++) {
    assert.deepEqual(stronger.features[i].geometry, first.features[i].geometry);
    assert.equal(stronger.features[i].properties.weight, first.features[i].properties.weight * 2);
  }
  assert.equal(JSON.parse(makeSurgeLayers([{ ...area, level: 'quiet' }]).heat).features.length, 9);
});

test('field memo invalidates for real movement, footprint changes and each thirty game seconds', () => {
  const signature = surgeSignature([area]);
  assert.notEqual(surgeSignature([{ ...area, center: { ...area.center, lat: area.center.lat + .001 } }]), signature);
  assert.notEqual(surgeSignature([{ ...area, radiusM: 2400 }]), signature);
  assert.notEqual(surgeSignature([{ ...area, sampledAtMinute: 10.5 }]), signature);
  assert.equal(surgeSignature([{ ...area, sampledAtMinute: 10.1 }]), signature);
});
