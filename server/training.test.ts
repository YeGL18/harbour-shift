import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import type {D1Database,D1Statement} from './cloudflare/store';
import {TrainingStore} from './cloudflare/training';
import {DriverStore} from './cloudflare/drivers';
import {dispatchHistoryWeight} from './driverStats';
import {RESET_COURSE_VERSION,RESET_QUESTIONS} from '../shared/trainingCourse';

class SqlD1 implements D1Database{
 db=new DatabaseSync(':memory:');
 constructor(training=true){this.db.exec('PRAGMA foreign_keys=ON');for(const name of['0000_multiplayer_rooms','0001_player_presence','0002_driver_accounts','0003_migration_write_fence',...(training?['0004_driver_training']:[])])this.db.exec(readFileSync(new URL(`./cloudflare/owned/schema/${name}.sql`,import.meta.url),'utf8'));this.db.exec('INSERT INTO __harbour_migration_control(id,frozen) VALUES(1,0)');}
 prepare(sql:string):D1Statement{const make=(values:any[]):D1Statement=>({bind:(...args)=>make(args),first:async<T>()=>(this.db.prepare(sql).get(...values)||null)as T|null,all:async<T>()=>({results:this.db.prepare(sql).all(...values)as T[]}),run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...values).changes)}})});return make([]);}
 async batch<T>():Promise<any[]>{return[];}
}
const answers=RESET_QUESTIONS.map(question=>question.correct);
async function fixture(){let now=1_800_000_000_000;const db=new SqlD1(),drivers=new DriverStore(db,()=>now),profile=await drivers.create({}),store=new TrainingStore(db,()=>now);return{db,drivers,profile,store,add:()=>{now++;},pass:async()=>{const attempt=await store.start(profile.driverToken,{courseVersion:RESET_COURSE_VERSION});await store.submit(profile.driverToken,{assessmentId:attempt.assessmentId,answers});return attempt;}};}
test('server verifies answers, requires explicit confirmation, preserves lifetime and resets only the verified dispatch period',async()=>{
 const f=await fixture(),token=f.profile.driverToken;f.db.db.prepare('UPDATE driver_accounts SET offered=40,accepted=12,cancelled=5,completed_trips=7 WHERE id=?').run(f.profile.driverId);const before=(await f.drivers.me(token)).stats;
 const attempt=await f.pass();assert.equal((await f.store.status(token)).activePeriod.periodId,'lifetime');
 await assert.rejects(()=>f.store.confirm(token,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:false}),(error:any)=>error.code==='invalid_training');
 const confirmed=await f.store.confirm(token,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true});assert.equal(confirmed.alreadyApplied,false);assert.deepEqual(confirmed.status.lifetime,{offered:40,accepted:12,cancelled:5,completedTrips:7});assert.equal(confirmed.status.activePeriod.acceptanceRate,null);assert.equal(confirmed.status.activePeriod.cancellationRate,null);
 const after=(await f.drivers.me(token)).stats;for(const key of['offered','accepted','cancelled','completedTrips']as const)assert.equal(after[key],before[key]);assert.equal(dispatchHistoryWeight(after),1);
 f.db.db.prepare('UPDATE driver_accounts SET offered=offered+10,accepted=accepted+4,cancelled=cancelled+1 WHERE id=?').run(f.profile.driverId);
 const retried=await f.store.confirm(token,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true});assert.equal(retried.alreadyApplied,true);assert.deepEqual(retried.status.activePeriod.counts,{offered:10,accepted:4,cancelled:1,completedTrips:0});
 const restored=await new TrainingStore(f.db).status(token);assert.equal(restored.activePeriod.periodId,attempt.assessmentId);assert.equal(restored.activePeriod.cancellationRate,.25);assert.equal(restored.history[0].counts.offered,40);
});
test('failed, malformed, forged-score, foreign and changed-answer submissions cannot alter any period',async()=>{
 const f=await fixture(),token=f.profile.driverToken,attempt=await f.store.start(token,{courseVersion:RESET_COURSE_VERSION});
 await assert.rejects(()=>f.store.submit(token,{assessmentId:attempt.assessmentId,answers,score:10}),(error:any)=>error.code==='unexpected_field');
 await assert.rejects(()=>f.store.submit(token,{assessmentId:attempt.assessmentId,answers:[0]}),(error:any)=>error.code==='invalid_training');
 const wrong=answers.map(answer=>(answer+1)%3);assert.equal((await f.store.submit(token,{assessmentId:attempt.assessmentId,answers:wrong})).passed,false);
 await assert.rejects(()=>f.store.confirm(token,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true}),(error:any)=>error.code==='training_not_passed');
 await assert.rejects(()=>f.store.submit(token,{assessmentId:attempt.assessmentId,answers}),(error:any)=>error.code==='training_submitted');
 const other=await f.drivers.create({});await assert.rejects(()=>f.store.submit(other.driverToken,{assessmentId:attempt.assessmentId,answers}),(error:any)=>error.status===404);assert.equal((await f.store.status(token)).history.length,0);
});
test('any authoritative active room blocks reset, including another room/device, until actual participant completion',async()=>{
 const f=await fixture(),token=f.profile.driverToken,attempt=await f.pass();
 const metadata=(status:string,finished=false)=>JSON.stringify({authority:JSON.stringify({room:{status},players:[{driverId:f.profile.driverId,left:false,forfeited:false,...(finished?{finishedAt:123}:{})}]})});
 f.db.db.prepare('INSERT INTO rooms(code,metadata,generation,version,expires_at,lease_until,updated_at) VALUES(?,?,?,1,?,0,0)').run('ABCDEF',metadata('countdown'),'g',Date.now()+1e12);
 for(const status of['countdown','running']){f.db.db.prepare('UPDATE rooms SET metadata=?').run(metadata(status));assert.equal((await f.store.status(token)).canReset,false);await assert.rejects(()=>f.store.confirm(token,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true}),(error:any)=>error.code==='training_active_match');}
 f.db.db.prepare('UPDATE rooms SET metadata=?').run(metadata('running',true));assert.equal((await f.store.confirm(token,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true})).alreadyApplied,false);
});
test('concurrent different confirmations have one atomic period winner; same-ID retries remain idempotent',async()=>{
 const f=await fixture(),a=await f.pass(),b=await f.pass();const results=await Promise.allSettled([a,b].map(attempt=>f.store.confirm(f.profile.driverToken,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal((f.db.db.prepare('SELECT count(*) AS n FROM driver_review_periods').get()as any).n,1);assert.ok(results.some(result=>result.status==='rejected'&&result.reason.code==='training_period_changed'));
});
test('schema-before-old-code and code-before-schema preserve ordinary driver APIs, while unavailable training fails honestly',async()=>{
 const db=new SqlD1(false),drivers=new DriverStore(db),profile=await drivers.create({});assert.equal((await drivers.me(profile.driverToken)).stats.offered,0);assert.equal((await drivers.histories([profile.driverId])).length,1);
 await assert.rejects(()=>new TrainingStore(db).handle('/v1/drivers/training','GET',profile.driverToken),(error:any)=>error.code==='training_unavailable'&&error.status===503);
 db.db.exec(readFileSync(new URL('./cloudflare/owned/schema/0004_driver_training.sql',import.meta.url),'utf8'));assert.equal((await new TrainingStore(db).status(profile.driverToken)).activePeriod.acceptanceRate,null);
 const legacy=db.db.prepare('SELECT id,offered,accepted,cancelled,completed_trips,updated_at FROM driver_accounts WHERE id=?').get(profile.driverId);assert.ok(legacy);assert.throws(()=>db.db.exec(readFileSync(new URL('./cloudflare/owned/schema/0004_driver_training.sql',import.meta.url),'utf8')),/already exists/);
});
test('the appended training tables obey the same permanent migration freeze as the original ledger',async()=>{
 const f=await fixture(),attempt=await f.pass();f.db.db.exec('UPDATE __harbour_migration_control SET frozen=1 WHERE id=1');
 await assert.rejects(()=>f.store.start(f.profile.driverToken,{courseVersion:RESET_COURSE_VERSION}),/harbour_migration_frozen/);
 await assert.rejects(()=>f.store.confirm(f.profile.driverToken,{assessmentId:attempt.assessmentId,expectedPeriodId:'lifetime',confirm:true}),/harbour_migration_frozen/);
 assert.equal((f.db.db.prepare('SELECT count(*) AS n FROM driver_review_periods').get()as any).n,0);
});
