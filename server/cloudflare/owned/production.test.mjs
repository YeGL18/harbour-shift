import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createProductionCompute } from './production.mjs';
import { computeActorName } from './compute-adapter.mjs';

const START = 1_795_000_000_123;
const req = (path, init) => new Request('https://authority.test' + path, init);
class DummyBase { constructor() {} }
function fixture({ control = { frozen: 0 }, failControl = false, onControl = () => {}, core } = {}) {
  const calls = [], queries = [], actors = [], pending = [];
  const db = { prepare(sql) { return { async first() { queries.push(sql); onControl(); if (failControl) throw new Error('unavailable'); return control; } }; } };
  const authority = { fetch(...args) { calls.push(args); return core ? core(...args) : new Response('original'); } };
  const production = createProductionCompute(DummyBase, authority);
  const env = { DB: db };
  const ctx = { get storage() { throw new Error('DO storage forbidden'); }, waitUntil(promise) { assert.equal(this, ctx); pending.push(promise); } };
  const instance = new production.HarbourCompute(ctx, env);
  env.HARBOUR_COMPUTE = {
    idFromName(name) { actors.push(name); return name; },
    get(id, options) { assert.equal(id, actors.at(-1)); assert.deepEqual(options, { locationHint: 'apac' }); return instance; },
  };
  return { ...production, instance, env, ctx, calls, queries, actors, pending };
}

test('composition stays lazy and selects stable room/registry actors', () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
  for (const path of ['/v1/rooms/abc123', '/V1/ROOMS/aBc123/actions/', '/v1/rooms/ABC123/join', '/v1/rooms/ABC123/horn']) assert.equal(computeActorName(req(path)), 'room:ABC123');
  for (const path of ['/health', '/v1/drivers', '/v1/rooms', '/v1/rooms/ABCDEFG', '/v1/rooms/ABC123/unknown', '/v1/rooms?actor=ABC123']) assert.equal(computeActorName(req(path)), 'registry');
  assert.throws(() => createProductionCompute(DummyBase, null), TypeError);
});

test('permanent administration routes are 404 at Edge and DO regardless of supplied authorization', async () => {
  const f = fixture();
  // A credential-shaped public fixture is never a real deployment credential.
  const authorization = 'Bearer ' + '1'.repeat(64);
  for (const path of ['/__ops', '/__ops/harbour-migration/initialize', '/__ops/harbour-migration/control', '/__ops/harbour-migration/manifest', '/__ops/harbour-migration/page', '/__OPS/HARBOUR-MIGRATION/PREFLIGHT/']) {
    for (const method of ['GET', 'POST']) {
      assert.equal((await f.worker.fetch(req(path, { method, headers: { Authorization: authorization } }), f.env, {})).status, 404);
      assert.equal((await f.instance.forward(req(path, { method }), START)).status, 404);
    }
  }
  assert.equal(f.actors.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
});

test('all core health aliases fail closed for missing/frozen/invalid/unavailable control', async () => {
  for (const options of [{ control: null }, { control: { frozen: 1 } }, { control: { frozen: null } }, { control: { frozen: 2 } }, { failControl: true }]) {
    const f = fixture(options);
    for (const path of ['/', '/health', '/health/', '/HEALTH/']) {
      const response = await f.worker.fetch(req(path), f.env, {});
      assert.equal(response.status, 503); assert.equal((await response.json()).ok, false);
    }
    assert.equal(f.calls.length, 0);
  }
});

test('case and trailing-slash API aliases cannot bypass missing/frozen maintenance', async () => {
  for (const control of [null, { frozen: 1 }]) {
    const f = fixture({ control });
    for (const path of ['/v1/rooms', '/V1/ROOMS/ABC123', '/v1/rooms/ABC123/', '/v1/drivers/me', '/V1/DRIVERS/ME/']) {
      for (const method of ['GET', 'POST']) {
        const response = await f.worker.fetch(req(path, { method }), f.env, {});
        assert.equal(response.status, 503); assert.equal(typeof (await response.json()).error.message, 'string');
      }
    }
    assert.equal(f.calls.length, 0);
    assert.ok(f.queries.every(sql => sql === 'SELECT frozen FROM __harbour_migration_control WHERE id=1'));
  }
});

test('open health reaches the actual core D1 check and preserves its response', async () => {
  const original = Response.json({ ok: true, persistence: 'd1' });
  const f = fixture({ core: async (_request, env) => { await env.DB.prepare('SELECT code FROM rooms LIMIT 1').first(); return original; } });
  assert.equal(await f.worker.fetch(req('/health'), f.env, {}), original);
  assert.deepEqual(f.queries, ['SELECT frozen FROM __harbour_migration_control WHERE id=1', 'SELECT code FROM rooms LIMIT 1']);
});

test('business Bearer, method, body, URL and original authentication conflict are unchanged', async () => {
  const body = '{"seq":7,"action":{"type":"decline","offerId":"original-offer"}}';
  const original = Response.json({ error: { code: 'unauthorized', message: 'original authority denial' } }, { status: 401 });
  const f = fixture({ core: async (request, env, _ctx, ingress) => {
    assert.equal(request.headers.get('Authorization'), 'Bearer opaque-room-credential');
    assert.equal(request.url, 'https://authority.test/V1/ROOMS/ABC123/actions/'); assert.equal(request.method, 'POST'); assert.equal(await request.text(), body);
    assert.equal(env, f.env); assert.ok(Number.isSafeInteger(ingress)); return original;
  } });
  assert.equal(await f.worker.fetch(req('/V1/ROOMS/ABC123/actions/', { method: 'POST', headers: { Authorization: 'Bearer opaque-room-credential' }, body }), f.env, {}), original);
});

test('first Edge clock survives delayed fence reads and ignores every HTTP or fourth-argument timestamp', async () => {
  const oldNow = Date.now; let clock = START;
  try {
    Date.now = () => clock;
    const f = fixture({ onControl() { clock += 5_000; }, core: (_request, _env, ctx, ingress) => {
      assert.equal(ingress, START); assert.equal(Date.now(), START + 5_000); ctx.waitUntil(Promise.resolve()); return new Response('original');
    } });
    await f.worker.fetch(req('/v1/rooms', { method: 'POST', headers: { 'X-Harbour-Received-At': String(START - 99_000) }, body: '{"receivedAt":1}' }), f.env, {}, START - 999_999);
    assert.equal(f.pending.length, 1); assert.equal(f.calls[0][3], START);
  } finally { Date.now = oldNow; }
});

test('invalid private RPC ingress and HTTP DO access cannot reach core', async () => {
  const f = fixture();
  for (const value of [undefined, null, 0, -1, Infinity, NaN, 1.5, String(START), Number.MAX_SAFE_INTEGER]) assert.equal((await f.instance.forward(req('/v1/rooms/ABC123'), value)).status, 503);
  assert.equal((await f.instance.fetch(req('/health'))).status, 503);
  assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
});

test('missing namespace or RPC stub has no direct core/network fallback', async () => {
  const f = fixture(), oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('Network fallback forbidden'); };
    for (const env of [{}, { HARBOUR_COMPUTE: {} }, { HARBOUR_COMPUTE: { idFromName() { return 'id'; }, get() { return { fetch() { throw new Error('HTTP stub forbidden'); } }; } } }]) assert.equal((await f.worker.fetch(req('/health'), env, {})).status, 503);
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(f.calls.length, 0);
});

test('gzip bytes and the original Response cross gate/RPC without re-encoding', async () => {
  const plain = Buffer.from('{"original":true}'), bytes = gzipSync(plain);
  const original = new Response(bytes, { headers: { 'Content-Encoding': 'gzip', 'Content-Type': 'application/json', Vary: 'Accept-Encoding' } });
  const f = fixture({ core: () => original });
  const response = await f.worker.fetch(req('/v1/rooms/ABC123'), f.env, {});
  assert.equal(response, original); assert.equal(response.headers.get('Content-Encoding'), 'gzip');
  const actual = Buffer.from(await response.arrayBuffer()); assert.deepEqual(actual, bytes); assert.deepEqual(gunzipSync(actual), plain);
});

test('core and RPC exceptions are not rewritten as different business outcomes', async () => {
  const sentinel = new Error('original exception'), f = fixture({ core: () => { throw sentinel; } });
  await assert.rejects(f.worker.fetch(req('/health'), f.env, {}), error => error === sentinel);
});
