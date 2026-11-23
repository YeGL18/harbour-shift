import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { D1Database, D1Statement } from './cloudflare/store';
import { DriverStore } from './cloudflare/drivers';
import { EliteStore } from './cloudflare/elite';
import { ELITE_COURSE_VERSION, ELITE_QUESTIONS } from '../shared/eliteCourse';
class SqlD1 implements D1Database {
    db = new DatabaseSync(':memory:');
    constructor(elite = true) { this.db.exec('PRAGMA foreign_keys=ON'); for (const name of ['0000_multiplayer_rooms', '0001_player_presence', '0002_driver_accounts', '0003_migration_write_fence', '0004_driver_training', ...(elite ? ['0006_driver_elite'] : [])])
        this.db.exec(readFileSync(new URL(`./cloudflare/owned/schema/${name}.sql`, import.meta.url), 'utf8')); this.db.exec('INSERT INTO __harbour_migration_control(id,frozen) VALUES(1,0)'); }
    prepare(sql: string): D1Statement { const make = (values: any[]): D1Statement => ({ bind: (...args) => make(args), first: async <T>() => (this.db.prepare(sql).get(...values) || null) as T | null, all: async <T>() => ({ results: this.db.prepare(sql).all(...values) as T[] }), run: async () => ({ meta: { changes: Number(this.db.prepare(sql).run(...values).changes) } }) }); return make([]); }
    async batch<T>(statements: D1Statement[]): Promise<any[]> { this.db.exec('BEGIN'); try {
        const results = [];
        for (const statement of statements)
            results.push(await statement.run());
        this.db.exec('COMMIT');
        return results;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
}
const answers = ELITE_QUESTIONS.map(item => item.correct);
async function fixture() { const db = new SqlD1(), drivers = new DriverStore(db, () => 1800000000000), profile = await drivers.create({}), store = new EliteStore(db, () => 1800000000001); return { db, drivers, profile, store, start: () => store.start(profile.driverToken, { courseVersion: ELITE_COURSE_VERSION }) }; }
test('verified Elite qualification is durable, idempotent and never changes lifetime counters', async () => { const f = await fixture(), a = await f.start(); const before = (await f.drivers.me(f.profile.driverToken)).stats; const passed = await f.store.submit(f.profile.driverToken, { assessmentId: a.assessmentId, answers }); assert.equal(passed.score, 10); assert.equal(passed.passed, true); assert.equal(passed.certification?.assessmentId, a.assessmentId); assert.deepEqual(await f.store.submit(f.profile.driverToken, { assessmentId: a.assessmentId, answers }), passed); const restored = await new EliteStore(f.db).status(f.profile.driverToken); assert.deepEqual(restored.certification, passed.certification); assert.equal((f.db.db.prepare('SELECT count(*) AS n FROM driver_elite_certifications').get() as any).n, 1); assert.deepEqual((await f.drivers.me(f.profile.driverToken)).stats, before); });
test('forged scores, wrong versions, foreign attempts and changed answers cannot qualify', async () => { const f = await fixture(), a = await f.start(); await assert.rejects(() => f.store.submit(f.profile.driverToken, { assessmentId: a.assessmentId, answers, score: 10 }), (e: any) => e.code === 'unexpected_field'); await assert.rejects(() => f.store.start(f.profile.driverToken, { courseVersion: 'wrong' }), (e: any) => e.code === 'elite_version'); const other = await f.drivers.create({}); await assert.rejects(() => f.store.submit(other.driverToken, { assessmentId: a.assessmentId, answers }), (e: any) => e.status === 404); const failed = await f.store.submit(f.profile.driverToken, { assessmentId: a.assessmentId, answers: answers.map(v => (v + 1) % 3) }); assert.equal(failed.passed, false); assert.equal(failed.certification, undefined); await assert.rejects(() => f.store.submit(f.profile.driverToken, { assessmentId: a.assessmentId, answers }), (e: any) => e.code === 'elite_submitted'); assert.equal((await f.store.status(f.profile.driverToken)).certification, undefined); });
test('qualification transaction rolls back attempt and certificate together when the permanent fence rejects writes', async () => { const f = await fixture(), a = await f.start(); f.db.db.exec('UPDATE __harbour_migration_control SET frozen=1'); await assert.rejects(() => f.store.submit(f.profile.driverToken, { assessmentId: a.assessmentId, answers }), /harbour_migration_frozen/); assert.equal((f.db.db.prepare('SELECT submitted_at FROM driver_elite_attempts').get() as any).submitted_at, null); assert.equal((f.db.db.prepare('SELECT count(*) AS n FROM driver_elite_certifications').get() as any).n, 0); });
test('code before Elite schema leaves ordinary driver APIs operational and returns explicit unavailable course', async () => { const db = new SqlD1(false), drivers = new DriverStore(db), profile = await drivers.create({}); assert.equal((await drivers.me(profile.driverToken)).driverId, profile.driverId); await assert.rejects(() => new EliteStore(db).handle('/v1/drivers/elite', 'GET', profile.driverToken), (e: any) => e.code === 'elite_unavailable' && e.status === 503); });
