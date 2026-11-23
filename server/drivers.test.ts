import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {DriverStore} from './cloudflare/drivers';
import {D1RoomStore,type D1Database,type D1Statement,type PersistableRoom} from './cloudflare/store';
import type {DriverCounters} from '../shared/protocol';

class SqlD1 implements D1Database {
 db=new DatabaseSync(':memory:');queries=new WeakMap<D1Statement,{sql:string;values:any[]}>();beforeBatch?:()=>void;failAt?:number;
 constructor(){this.db.exec('PRAGMA foreign_keys=ON');for(const name of ['0000_multiplayer_rooms','0001_player_presence','0002_driver_accounts'])this.db.exec(readFileSync(new URL(`./cloudflare/owned/schema/${name}.sql`,import.meta.url),'utf8'));}
 prepare(sql:string):D1Statement {const make=(values:any[]):D1Statement=>{const statement:D1Statement={bind:(...args)=>make(args.map(value=>value instanceof ArrayBuffer?Buffer.from(value):value)),first:async<T>()=>(this.db.prepare(sql).get(...values)||null)as T|null,all:async<T>()=>({results:this.db.prepare(sql).all(...values)as T[]}),run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...values).changes)}})};this.queries.set(statement,{sql,values});return statement;};return make([]);}
 async batch<T>(statements:D1Statement[]){this.beforeBatch?.();this.db.exec('BEGIN');try{const results=statements.map((statement,index)=>{if(index===this.failAt)throw new Error('Injected SQL failure');const q=this.queries.get(statement)!;return{meta:{changes:Number(this.db.prepare(q.sql).run(...q.values).changes)}};});this.db.exec('COMMIT');return results as any;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 room(code:string,generation:string,version=1){this.db.prepare('INSERT INTO rooms(code,metadata,generation,version,expires_at,lease_until,updated_at) VALUES(?,?,?,?,?,0,0)').run(code,'{}',generation,version,1_900_000_000_000);}
}
const counts=(offered=0,accepted=0,cancelled=0,completedTrips=0):DriverCounters=>({offered,accepted,cancelled,completedTrips});

test('guest credentials remain opaque and room clients cannot submit lifetime totals',async()=>{
 const db=new SqlD1(),drivers=new DriverStore(db,()=>1_800_000_000_000),a=await drivers.create({}),b=await drivers.create({});assert.equal(a.driverToken.length,64);assert.equal(a.stats.offered,0);
 assert.deepEqual(await drivers.me(a.driverToken),{driverId:a.driverId,stats:a.stats});await assert.rejects(()=>drivers.authenticate({driverId:a.driverId,driverToken:b.driverToken}),(e:any)=>e.status===401);
 await assert.rejects(()=>drivers.create({offered:999,accepted:999}),(e:any)=>e.code==='unexpected_field');await assert.rejects(()=>drivers.authenticate({...a,offered:100}),(e:any)=>e.code==='unexpected_field');
 const persisted=JSON.stringify(db.db.prepare('SELECT * FROM driver_accounts').all());assert.ok(!persisted.includes(a.driverToken));assert.ok(!persisted.includes(b.driverToken));
});
test('same and changed replay payloads credit one immutable ledger event exactly once',async()=>{
 const db=new SqlD1(),drivers=new DriverStore(db),account=await drivers.create({});db.room('AAAAAA','generation-a');
 await db.batch(drivers.deltaStatements('AAAAAA','generation-a',1,[{driverId:account.driverId,counters:counts(3,2,1,1)}]));
 await db.batch(drivers.deltaStatements('AAAAAA','generation-a',1,[{driverId:account.driverId,counters:counts(999,999,999,999)}]));
 const stats=(await drivers.me(account.driverToken)).stats;assert.equal(stats.offered,3);assert.equal(stats.accepted,2);assert.equal(stats.cancelled,1);assert.equal(stats.completedTrips,1);assert.equal((db.db.prepare('SELECT count(*) AS n FROM driver_stat_events').get()as any).n,1);
});
test('two rooms credit the same account additively and pruning a room preserves career totals',async()=>{
 const db=new SqlD1(),drivers=new DriverStore(db),account=await drivers.create({});db.room('AAAAAA','ga');db.room('BBBBBB','gb');
 await Promise.all([db.batch(drivers.deltaStatements('AAAAAA','ga',1,[{driverId:account.driverId,counters:counts(4,2,1,1)}])),db.batch(drivers.deltaStatements('BBBBBB','gb',1,[{driverId:account.driverId,counters:counts(6,4,1,3)}]))]);
 let stats=(await drivers.me(account.driverToken)).stats;assert.deepEqual([stats.offered,stats.accepted,stats.cancelled,stats.completedTrips],[10,6,2,4]);db.db.prepare('DELETE FROM rooms WHERE code=?').run('AAAAAA');stats=(await drivers.me(account.driverToken)).stats;assert.equal(stats.offered,10);assert.equal((db.db.prepare('SELECT count(*) AS n FROM driver_stat_events').get()as any).n,1);
});
function fakeRoom(driverId:string):PersistableRoom&{current:DriverCounters;applied:DriverCounters}{return{
 current:counts(),applied:counts(),serializeRoomMetadata(){return JSON.stringify({counters:this.applied});},deserializeRoomMetadata(){},getPlayerIds:()=>['player-a'],serializePlayerState:()=>JSON.stringify({clockMinutes:0}),deserializePlayerState(){},presenceSeeds:()=>[{playerId:'player-a',lastSeen:1_800_000_000_000,forfeitedAt:null}],applyPresence(){},publishedSnapshot:()=>({protocolVersion:2,revision:1,room:{code:'ABCDEF',status:'running'},leaderboard:[]})as any,
 prepareDriverDeltas(){const delta={...this.current};for(const key of Object.keys(delta)as Array<keyof DriverCounters>)delta[key]=Math.max(0,delta[key]-this.applied[key]);this.applied={...this.current};return[{driverId,counters:delta}];},
};}
test('failed room CAS cannot credit account events or delete the previous published generation',async()=>{
 const db=new SqlD1(),drivers=new DriverStore(db),account=await drivers.create({}),store=new D1RoomStore(db,()=>1_800_000_000_000),room=fakeRoom(account.driverId);await store.create('ABCDEF',room,1_800_003_600_000);const before=db.db.prepare('SELECT metadata,generation FROM rooms').get();const lease=(await store.acquire('ABCDEF'))!;room.current=counts(1,1);
 db.beforeBatch=()=>{db.db.prepare('UPDATE rooms SET lease_token=?,version=version+1').run('new-writer');db.beforeBatch=undefined;};await assert.rejects(()=>store.commit(lease,room,1_800_003_600_000),(e:any)=>e.code==='room_busy');await store.release(lease);
 assert.deepEqual(db.db.prepare('SELECT metadata,generation FROM rooms').get(),before);assert.equal((await drivers.me(account.driverToken)).stats.accepted,0);assert.equal((db.db.prepare('SELECT count(*) AS n FROM driver_stat_events').get()as any).n,0);assert.equal((db.db.prepare('SELECT count(*) AS n FROM player_states').get()as any).n,1);
});
test('a SQL failure after room publication and account increment rolls the entire transaction back',async()=>{
 const db=new SqlD1(),drivers=new DriverStore(db),account=await drivers.create({}),store=new D1RoomStore(db,()=>1_800_000_000_000),room=fakeRoom(account.driverId);await store.create('ABCDEF',room,1_800_003_600_000);const before=db.db.prepare('SELECT metadata,generation FROM rooms').get();const lease=(await store.acquire('ABCDEF'))!;room.current=counts(1,1,1);db.failAt=4;
 await assert.rejects(()=>store.commit(lease,room,1_800_003_600_000),/Injected SQL failure/);db.failAt=undefined;await store.release(lease);assert.deepEqual(db.db.prepare('SELECT metadata,generation FROM rooms').get(),before);assert.equal((await drivers.me(account.driverToken)).stats.accepted,0);assert.equal((db.db.prepare('SELECT count(*) AS n FROM driver_stat_events').get()as any).n,0);
});
test('authenticated action retries use only a guarded lease UPDATE on a busy room',async()=>{
 const db=new SqlD1(),store=new D1RoomStore(db,()=>1_800_000_000_000);db.room('ABCDEF','initial');await store.acquire('ABCDEF');const original=db.prepare.bind(db),queries:string[]=[];db.prepare=sql=>{queries.push(sql);return original(sql);};assert.equal(await store.acquire('ABCDEF',undefined,true),null);assert.equal(queries.length,1);assert.match(queries[0],/^UPDATE rooms SET lease_token/u);assert.equal(await store.acquire('ABCDEF',1_800_000_000_000),null);assert.equal(queries.length,2);
});
