import assert from 'node:assert/strict';
import test from 'node:test';
import {releaseHighlights} from './releaseNotes';
import {version} from '../../package.json';

test('current-version release notes are shown once independently of an older build', () => {
  const current = releaseHighlights(version, null);
  assert.ok(current.length > 0);
  assert.deepEqual(releaseHighlights(version, '0.8.0'), current);
  assert.deepEqual(releaseHighlights(version, version), []);
  assert.deepEqual(releaseHighlights('unknown', null), []);
});

