import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import test from 'node:test';
import {DriverStore} from './cloudflare/drivers';
import {ProStore,type ProClaim} from './cloudflare/pro';
import type {D1Database,D1Statement} from './cloudflare/store';
import {PRO_API,proRequestWeight} from '../shared/pro';

function database(singleActive=true) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0000_multiplayer_rooms','0001_player_presence','0002_driver_accounts',
    '0003_migration_write_fence','0004_driver_training','0005_driver_pro','0006_driver_elite',...(singleActive?['0007_pro_single_active']:[])]){
    sqlite.exec(readFileSync(new URL(`./cloudflare/owned/schema/${name}.sql`,import.meta.url),'utf8'));
  }
  sqlite.exec("INSERT INTO __harbour_migration_control(id,frozen) VALUES(1,0)");
  sqlite.exec("INSERT INTO rooms(code, metadata, generation, version, expires_at, updated_at) VALUES ('ABC123','{}','committed',1,2000000000000,0)");
  const d1:D1Database={
    prepare(sql){
      const statement=(values:SQLInputValue[]):D1Statement=>({
        bind:(...args)=>statement(args as typeof values),
        first:async<T>()=>(sqlite.prepare(sql).get(...values)??null) as T|null,
        all:async<T>()=>({results:sqlite.prepare(sql).all(...values) as T[]}),
        run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}),
      });
      return statement([]);
    },
    async batch(){throw new Error('Batch is not used by this fixture.');},
  };
  return {sqlite,d1};
}

test('seven practice shift credits are held, spent once, and released on forfeiture',async()=>{
  const {sqlite,d1}=database();
  const now=()=>1_800_000_000_000;
  const account=await new DriverStore(d1,now).create({});
  const store=new ProStore(d1,now);
  const trial={tier:'diamond',requestId:'practice-test-unique'};
  const grant=await store.handle(PRO_API.trial,'POST',account.driverToken,trial,true);
  const [pack]=grant.packs;
  assert.equal(pack.remaining,7);
  assert.deepEqual(await store.handle(PRO_API.trial,'POST',account.driverToken,trial,true),grant);

  const claim=(shiftKey:string,state:ProClaim['state'],generation='committed')=>
    store.claimStatements('ABC123',generation,1,now()+5000,[{shiftKey,state,driverId:account.driverId,packId:pack.id,tier:'diamond'}])[0].run();
  await claim('aborted','held');
  await claim('aborted','released');
  for(let i=0;i<7;i++){
    assert.equal((await store.bestPasses([account.driverId])).get(account.driverId)?.packId,pack.id);
    await claim(`shift-${i}`,'held');
    if(i===6){
      assert.equal((await store.bestPasses([account.driverId])).size,0);
      await assert.rejects(claim('eighth','held'),/harbour_pro_pack_unavailable/);
      assert.equal((await store.handle(PRO_API.status,'GET',account.driverToken,undefined,true)).packs[0].remaining,1);
    }
    await claim(`shift-${i}`,'consumed');
    await claim(`shift-${i}`,'consumed');
  }
  await claim('expired-room-writer','held','stale-generation');
  assert.deepEqual((await store.handle(PRO_API.status,'GET',account.driverToken,undefined,true)).packs,[]);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM driver_pro_claims WHERE state='consumed'").get() as {n:number}).n,7);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM driver_pro_claims WHERE shift_key='expired-room-writer'").get() as {n:number}).n,0);
  assert.ok(proRequestWeight('platinum')>proRequestWeight('gold'));
  sqlite.close();
});

test('online upgrades retire the old pack atomically but preserve held claims and idempotent old receipts',async()=>{
 const {sqlite,d1}=database(),now=()=>1_800_000_000_000,account=await new DriverStore(d1,now).create({}),store=new ProStore(d1,now);
 const goldRequest={tier:'gold',requestId:'gold-first-request'},gold=(await store.handle(PRO_API.trial,'POST',account.driverToken,goldRequest,true)).packs[0];
 const claim=(state:ProClaim['state'])=>store.claimStatements('ABC123','committed',1,now()+5000,[{shiftKey:'frozen-old-shift',driverId:account.driverId,packId:gold.id,tier:'gold',state}])[0].run();
 await claim('held');
 const next=await store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'diamond',requestId:'diamond-upgrade-request'},true);
 assert.equal(next.packs.length,1);assert.equal(next.packs[0].tier,'diamond');assert.equal(next.packs[0].remaining,7);
 assert.equal((sqlite.prepare('SELECT revoked_at FROM driver_pro_packs WHERE id=?').get(gold.id)as any).revoked_at,now());
 await claim('held');await claim('consumed');await claim('consumed');
 assert.equal((await store.handle(PRO_API.status,'GET',account.driverToken,null,true)).packs[0].remaining,7,'old room completion never debits replacement');
 assert.deepEqual(await store.handle(PRO_API.trial,'POST',account.driverToken,goldRequest,true),next,'old retry cannot revive the old tier');
 await assert.rejects(store.handle(PRO_API.trial,'POST',account.driverToken,{...goldRequest,tier:'platinum'},true),(e:any)=>e.code==='pro_intent_changed');
 assert.equal((await store.bestPasses([account.driverId])).get(account.driverId)?.tier,'diamond');
 assert.equal((sqlite.prepare('SELECT count(*) AS n FROM driver_pro_packs').get()as any).n,2,'history is retained');
 sqlite.close();
});

test('same and lower online tiers fail, including direct old-style inserts; retries do not stack',async()=>{
 const {sqlite,d1}=database(),now=()=>1_800_000_000_000,account=await new DriverStore(d1,now).create({}),store=new ProStore(d1,now);
 const first={tier:'platinum',requestId:'original-platinum'};await store.handle(PRO_API.trial,'POST',account.driverToken,first,true);
 await assert.rejects(store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'platinum',requestId:'another-platinum'},true),(e:any)=>e.code==='pro_same_tier_active');
 await assert.rejects(store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'gold',requestId:'lower-gold-request'},true),(e:any)=>e.code==='pro_downgrade_active');
 assert.throws(()=>sqlite.prepare("INSERT OR IGNORE INTO driver_pro_packs(id,driver_id,tier,source,transaction_id,created_at) VALUES('legacy',?,'gold','trial','legacy-direct',?)").run(account.driverId,now()),/harbour_pro_same_or_lower_active/);
 await Promise.all([store.handle(PRO_API.trial,'POST',account.driverToken,first,true),store.handle(PRO_API.trial,'POST',account.driverToken,first,true)]);
 assert.equal((sqlite.prepare('SELECT count(*) AS n FROM driver_pro_packs').get()as any).n,1);
 sqlite.close();
});

test('append migration normalizes legacy packs without changing claims, room bytes, or other driver records',async()=>{
 const {sqlite,d1}=database(false),now=()=>1_800_000_000_000,account=await new DriverStore(d1,now).create({}),store=new ProStore(d1,now);
 const insert=sqlite.prepare("INSERT INTO driver_pro_packs(id,driver_id,tier,source,transaction_id,created_at) VALUES(?,?,?,'trial',?,100)");
 for(const [id,tier]of[['gold','gold'],['diamond-z','diamond'],['diamond-a','diamond']])insert.run(id,account.driverId,tier,id);
 await store.claimStatements('ABC123','committed',1,now()+5000,[{shiftKey:'old-held',packId:'gold',tier:'gold',driverId:account.driverId,state:'held'}])[0].run();
 const claims=sqlite.prepare('SELECT * FROM driver_pro_claims').all(),room=sqlite.prepare('SELECT * FROM rooms').all(),driver=sqlite.prepare('SELECT * FROM driver_accounts').all();
 sqlite.exec(readFileSync(new URL('./cloudflare/owned/schema/0007_pro_single_active.sql',import.meta.url),'utf8'));
 assert.deepEqual(sqlite.prepare('SELECT id FROM driver_pro_packs WHERE revoked_at IS NULL').all().map(row=>row.id),['diamond-a']);
 assert.deepEqual(sqlite.prepare('SELECT * FROM driver_pro_claims').all(),claims);assert.deepEqual(sqlite.prepare('SELECT * FROM rooms').all(),room);assert.deepEqual(sqlite.prepare('SELECT * FROM driver_accounts').all(),driver);
 assert.equal((await store.handle(PRO_API.status,'GET',account.driverToken,null,true)).packs[0].id,'diamond-a');
 for(let i=0;i<7;i++)await store.claimStatements('ABC123','committed',1,now()+5000,[{shiftKey:`modern-${i}`,packId:'diamond-a',tier:'diamond',driverId:account.driverId,state:'consumed'}])[0].run();
 assert.deepEqual((await new ProStore(d1,now).handle(PRO_API.status,'GET',account.driverToken,null,true)).packs,[]);
 assert.equal((await store.bestPasses([account.driverId])).size,0,'legacy gold must never return');
 sqlite.close();
});

test('before the append migration, old Pro reads/claims survive but new activation fails closed',async()=>{
 const {sqlite,d1}=database(false),now=()=>1_800_000_000_000,account=await new DriverStore(d1,now).create({}),store=new ProStore(d1,now);
 sqlite.prepare("INSERT INTO driver_pro_packs(id,driver_id,tier,source,transaction_id,created_at) VALUES('old',?,'gold','trial','old',100)").run(account.driverId);
 assert.equal((await store.handle(PRO_API.status,'GET',account.driverToken,null,true)).packs[0].tier,'gold');
 assert.equal((await store.bestPasses([account.driverId])).get(account.driverId)?.packId,'old');
 await assert.rejects(store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'diamond',requestId:'not-migrated-yet'},true),(e:any)=>e.status===503&&e.code==='pro_unavailable');
 await store.claimStatements('ABC123','committed',1,now()+5000,[{shiftKey:'still-active',packId:'old',tier:'gold',driverId:account.driverId,state:'consumed'}])[0].run();
 assert.equal((await store.handle(PRO_API.status,'GET',account.driverToken,null,true)).packs[0].remaining,6);
 sqlite.close();
});

test('concurrent upgrades leave only the higher pack and an exhausted idempotent receipt never grants again',async()=>{
 const {sqlite,d1}=database(),now=()=>1_800_000_000_000,account=await new DriverStore(d1,now).create({}),store=new ProStore(d1,now);
 await store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'gold',requestId:'starting-gold-request'},true);
 const requests=[{tier:'diamond',requestId:'concurrent-diamond'},{tier:'platinum',requestId:'concurrent-platinum'}];
 const results=await Promise.allSettled(requests.map(request=>store.handle(PRO_API.trial,'POST',account.driverToken,request,true)));
 assert.equal(results[0].status,'fulfilled');
 const [selected]=(await store.handle(PRO_API.status,'GET',account.driverToken,null,true)).packs;
 assert.equal(selected.tier,'diamond');assert.equal((sqlite.prepare('SELECT count(*) AS n FROM driver_pro_packs WHERE revoked_at IS NULL').get()as any).n,1);
 for(let i=0;i<7;i++)await store.claimStatements('ABC123','committed',1,now()+5000,[{shiftKey:`spent-${i}`,packId:selected.id,tier:'diamond',driverId:account.driverId,state:'consumed'}])[0].run();
 assert.deepEqual((await store.handle(PRO_API.trial,'POST',account.driverToken,requests[0],true)).packs,[]);
 assert.equal((await store.bestPasses([account.driverId])).size,0);
 const fresh=await store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'gold',requestId:'fresh-after-expiration'},true);
 assert.equal(fresh.packs[0].tier,'gold');assert.equal(fresh.packs[0].remaining,7);
 sqlite.close();
});

test('partial migration and the existing frozen fence both refuse new grants without clearing entitlements',async()=>{
 const {sqlite,d1}=database(),now=()=>1_800_000_000_000,account=await new DriverStore(d1,now).create({}),store=new ProStore(d1,now);
 await store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'gold',requestId:'before-partial-migration'},true);
 sqlite.exec('DROP TRIGGER driver_pro_replace_previous');
 await assert.rejects(store.handle(PRO_API.trial,'POST',account.driverToken,{tier:'diamond',requestId:'partial-migration'},true),(e:any)=>e.status===503);
 assert.equal((await store.handle(PRO_API.status,'GET',account.driverToken,null,true)).packs[0].tier,'gold');
 sqlite.exec("UPDATE __harbour_migration_control SET frozen=1 WHERE id=1");
 assert.throws(()=>sqlite.prepare("INSERT INTO driver_pro_packs(id,driver_id,tier,source,transaction_id,created_at) VALUES('fenced',?,'diamond','trial','fenced',100)").run(account.driverId),/harbour_migration_frozen/);
 assert.equal((sqlite.prepare('SELECT count(*) AS n FROM driver_pro_packs').get()as any).n,1);
 sqlite.close();
});
