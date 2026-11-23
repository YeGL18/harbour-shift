import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildOwned } from './build.mjs';

test('builder refuses unpinned core inputs without running the core builder', async () => {
  await assert.rejects(buildOwned(), /Choose/);
  await assert.rejects(buildOwned({ coreInput: '/nonexistent', expectedCoreSha256: 'not-a-hash' }), /SHA-256/);
});

test('owned wrapper bundles a digest-pinned synthetic core without temporary admin code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harbour-owned-build-'));
  try {
    const core = 'export default {fetch(){return new Response("synthetic original authority");}};\n';
    const input = join(directory, 'approved.mjs'), output = join(directory, 'index.js');
    await writeFile(input, core);
    const hash = createHash('sha256').update(core).digest('hex');
    await assert.rejects(buildOwned({ coreInput: input, expectedCoreSha256: hash, output: input }), /cannot replace the approved core/);
    assert.equal(await readFile(input, 'utf8'), core);
    await assert.rejects(buildOwned({ coreInput: input, expectedCoreSha256: '0'.repeat(64), output }), /digest mismatch/);
    const receipt = await buildOwned({ coreInput: input, expectedCoreSha256: hash, output });
    const artifact = await readFile(output, 'utf8');
    assert.equal(receipt.coreSha256, hash); assert.equal(receipt.coreRebuilt, false); assert.equal(receipt.remoteOperations, 0);
    assert.equal(createHash('sha256').update(await readFile(input)).digest('hex'), hash);
    assert.match(artifact, /synthetic original authority/);
    for (const forbidden of ['HARBOUR_MIGRATION_ADMIN_', 'HARBOUR_MIGRATION_EXPIRES_', 'createMigrationWorker', '/initialize', '/manifest', '/preflight', 'wrangler', 'v51-migration']) assert.equal(artifact.includes(forbidden), false, forbidden);
    assert.equal(artifact.includes('SELECT frozen FROM __harbour_migration_control'), true);
    assert.equal((await readFile(join(directory, 'owned-build-receipt.json'), 'utf8')).includes('coreSha256'), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
