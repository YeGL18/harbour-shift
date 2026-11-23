import assert from 'node:assert/strict';
import test from 'node:test';
import { combineDriverCounts, emptySoloLedger, readSoloLedger, recordSoloSession } from './ledger';
test('solo history counts deltas across shifts and ignores replayed or older snapshots', () => {
  let ledger = recordSoloSession(emptySoloLedger(), 'first', { offered: 5, accepted: 3, cancelled: 1, completedTrips: 2 });
  assert.equal(recordSoloSession(ledger, 'first', { offered: 5, accepted: 3, cancelled: 1, completedTrips: 2 }), ledger);
  ledger = recordSoloSession(ledger, 'second', { offered: 2, accepted: 1, cancelled: 0, completedTrips: 1 });
  ledger = recordSoloSession(ledger, 'first', { offered: 6, accepted: 4, cancelled: 1, completedTrips: 3 });
  ledger = recordSoloSession(ledger, 'first', { offered: 1, accepted: 1, cancelled: 0, completedTrips: 0 });
  assert.deepEqual(ledger.totals, { offered: 8, accepted: 5, cancelled: 1, completedTrips: 4 });
  assert.deepEqual(readSoloLedger(JSON.parse(JSON.stringify(ledger))), ledger);
});
test('solo and verified totals combine for display without mutating either source', () => {
  const solo = { offered: 10, accepted: 5, cancelled: 1, completedTrips: 4 };
  const verified = { offered: 10, accepted: 10, cancelled: 2, completedTrips: 8 };
  assert.deepEqual(combineDriverCounts(solo, verified), { offered: 20, accepted: 15, cancelled: 3, completedTrips: 12, acceptanceRate: .75, cancellationRate: .2 });
  assert.equal(solo.accepted, 5);
  assert.deepEqual(readSoloLedger({ version: 1, totals: { offered: -1, accepted: Infinity }, sessions: { x: null } }).totals, { offered: 0, accepted: 0, cancelled: 0, completedTrips: 0 });
});
