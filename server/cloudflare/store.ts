import type { DurablePresence, PublishedSnapshot, SessionInfo } from '../authority';
import type { WireGameState } from '../../shared/protocol';
import { decodeState } from '../codec';
import {ProStore,type ProClaim} from './pro';
import {DriverStore,type DriverDelta} from './drivers';
import type {DriverProfile} from '../../shared/protocol';
/** Small D1 surface so the portable authority has no Cloudflare dependency. */
export interface D1Result<T = Record<string, unknown>> { results?: T[]; meta?: { changes?: number;duration?:number;timings?:{sql_duration_ms?:number};total_attempts?:number;served_by_region?:string } }
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database { prepare(sql: string): D1Statement;batch<T=Record<string,unknown>>(statements:D1Statement[]):Promise<D1Result<T>[]> }
export interface PersistableRoom {
  serializeRoomMetadata(code: string): string | null;
  deserializeRoomMetadata(json: string): void;
  getPlayerIds(code: string): string[];
  serializePlayerState(code: string, playerId: string): string | null;
  deserializePlayerState(code: string, playerId: string, json: string): void;
  presenceSeeds(code:string):DurablePresence[];
  applyPresence(code:string,records:DurablePresence[],now?:number):void;
  publishedSnapshot(code:string):PublishedSnapshot;
  driverIds?(code:string):string[];
  applyDriverProfiles?(code:string,profiles:DriverProfile[]):void;
  applyProPasses?(passes:Map<string,import('../../shared/pro').ProPass>):void;
  prepareProClaims?(code:string):ProClaim[];
  prepareDriverDeltas?(code:string):DriverDelta[];
}
export interface RoomRow { metadata: string; generation: string; version: number; expires_at: number }
interface PlayerRow { state: ArrayBuffer | number[] | Uint8Array }
export interface RoomLease extends RoomRow { code: string; token: string; presenceIds?:Set<string>;committed?:boolean }
export interface StoredRoom {schema:number;authority:string;gamePlayerIds:string[];publishedAt?:number;publicSnapshot?:PublishedSnapshot}
interface PresenceRow {player_id:string;last_seen:number;forfeited_at:number|null}
export class StoreFailure extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterMilliseconds?: number) { super(message); }
}
const LEASE_MS = 15_000;
const MAX_COMPRESSED_PLAYER = 1_800_000;

async function gzip(json: string): Promise<ArrayBuffer> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  if (bytes.byteLength > MAX_COMPRESSED_PLAYER) throw new StoreFailure(413, 'state_too_large', '本更資料超出儲存上限，請結算後重新開更');
  return bytes;
}
async function gunzip(data: PlayerRow['state']): Promise<string> {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/**
 * A room commits by changing one metadata pointer. Player blobs are staged in
 * separate generations, so a crash or an expired lease cannot publish half a
 * room. Compression/decompression is sequential to bound Worker peak memory.
 */
export class D1RoomStore {
  constructor(private db: D1Database, private now: () => number = Date.now,private defer?:(promise:Promise<unknown>)=>void,private metrics?:{gzipMilliseconds:number}) {}

  async acquire(code: string, staleBefore?:number,busyReturnsNull=false): Promise<RoomLease|null> {
    const now = this.now(), token = crypto.randomUUID();
    const row = await this.db.prepare(`UPDATE rooms SET lease_token = ?, lease_until = ?
      WHERE code = ? AND expires_at > ? AND (lease_token IS NULL OR lease_until <= ?)
      AND (? IS NULL OR COALESCE(json_extract(metadata,'$.publishedAt'),0) <= ?)
      RETURNING metadata, generation, version, expires_at`).bind(token, now + LEASE_MS, code, now, now,staleBefore??null,staleBefore??null).first<RoomRow>();
    if (row) return { ...row, code, token };
    // Authenticated actions already read room metadata. A busy retry therefore
    // needs only the guarded UPDATE, not another existence SELECT on each try.
    if(staleBefore!==undefined||busyReturnsNull)return null;
    const existing = await this.db.prepare('SELECT expires_at FROM rooms WHERE code = ?').bind(code).first<{ expires_at: number }>();
    if (!existing || existing.expires_at <= now) throw new StoreFailure(404, 'room_not_found', '房間不存在或已到期');
    throw new StoreFailure(409, 'room_busy', '房間正在更新，請稍候重試', 180);
  }

  async hydrate(lease: RoomLease, authority: PersistableRoom, beforePlayers?: () => Promise<void>): Promise<void> {
    const stored = this.parse(lease);
    authority.deserializeRoomMetadata(stored.authority);
    await beforePlayers?.();
    // One D1 round trip; inflate each compressed player sequentially. The
    // compressed rows are small POI-reference blobs, not expanded snapshots.
    const rows=await this.db.prepare('SELECT player_id,state FROM player_states WHERE room_code=? AND generation=?').bind(lease.code,lease.generation).all<PlayerRow&{player_id:string}>();
    for (const playerId of stored.gamePlayerIds) {
      const row=(rows.results||[]).find(entry=>entry.player_id===playerId);
      if (!row) throw new StoreFailure(503, 'room_unavailable', '房間資料暫時無法載入');
      authority.deserializePlayerState(lease.code, playerId, await gunzip(row.state));
    }
    const presence=await this.db.prepare('SELECT player_id,last_seen,forfeited_at FROM player_presence WHERE room_code=?').bind(lease.code).all<PresenceRow>();
    lease.presenceIds=new Set((presence.results||[]).map(row=>row.player_id));
    authority.applyPresence(lease.code,(presence.results||[]).map(row=>({playerId:row.player_id,lastSeen:row.last_seen,forfeitedAt:row.forfeited_at})),this.now());
    const ids=authority.driverIds?.(lease.code)||[];if(ids.length&&authority.applyDriverProfiles)authority.applyDriverProfiles(lease.code,await new DriverStore(this.db,this.now).histories(ids));
  }

  parse(row:RoomRow):StoredRoom {const stored=JSON.parse(row.metadata) as StoredRoom;if(![1,2].includes(stored.schema)||!Array.isArray(stored.gamePlayerIds)||stored.gamePlayerIds.length>8)throw new StoreFailure(503,'room_unavailable','房間資料暫時無法載入');return stored;}
  async readMetadata(code:string):Promise<RoomRow>{const row=await this.db.prepare('SELECT metadata,generation,version,expires_at FROM rooms WHERE code=?').bind(code).first<RoomRow>();if(!row||row.expires_at<=this.now())throw new StoreFailure(404,'room_not_found','房間不存在或已到期');return row;}
  /** The generation pointer and this player's blob are read in one SQL snapshot. */
  async readCommittedPlayer(code:string,playerId:string):Promise<RoomRow&{state:PlayerRow['state']|null}>{const row=await this.db.prepare(`SELECT r.metadata,r.generation,r.version,r.expires_at,p.state FROM rooms r
    LEFT JOIN player_states p ON p.room_code=r.code AND p.generation=r.generation AND p.player_id=? WHERE r.code=?`).bind(playerId,code).first<RoomRow&{state:PlayerRow['state']|null}>();if(!row||row.expires_at<=this.now())throw new StoreFailure(404,'room_not_found','房間不存在或已到期');return row;}
  async decodeOwnState(row:RoomRow&{state:PlayerRow['state']|null},playerId:string):Promise<WireGameState|null>{const stored=this.parse(row);if(!stored.gamePlayerIds.includes(playerId))return null;if(!row.state)throw new StoreFailure(503,'room_unavailable','房間資料暫時無法載入');return decodeState(await gunzip(row.state)) as WireGameState;}
  /** Atomic expiry latch prevents concurrent late heartbeats from reviving a driver. */
  async recordPresence(code:string,session:SessionInfo):Promise<void>{const now=this.now(),deadline=135000;
    await this.db.prepare(`INSERT INTO player_presence(room_code,player_id,last_seen,forfeited_at)
      VALUES(?,?,?,CASE WHEN ? AND ?-?>? THEN ?+? ELSE NULL END)
      ON CONFLICT(room_code,player_id) DO UPDATE SET
        forfeited_at=COALESCE(player_presence.forfeited_at,CASE WHEN ? AND ?-MAX(player_presence.last_seen,?)>? THEN MAX(player_presence.last_seen,?)+? ELSE NULL END),
        last_seen=MAX(player_presence.last_seen,excluded.last_seen)`)
      .bind(code,session.playerId,now,session.canForfeit?1:0,now,session.lastSeen,deadline,session.lastSeen,deadline,session.canForfeit?1:0,now,session.lastSeen,deadline,session.lastSeen,deadline).run();
  }

  async create(code: string, authority: PersistableRoom, expiresAt: number): Promise<boolean> {
    const token = crypto.randomUUID(), now = this.now();
    const metadata = JSON.stringify({ schema: 1, authority: authority.serializeRoomMetadata(code), gamePlayerIds: [] });
    const inserted = await this.db.prepare(`INSERT OR IGNORE INTO rooms
      (code, metadata, generation, version, expires_at, lease_token, lease_until, updated_at)
      VALUES (?, ?, '', 0, ?, ?, ?, ?)`).bind(code, metadata, expiresAt, token, now + LEASE_MS, now).run();
    if (!inserted.meta?.changes) return false;
    const lease: RoomLease = { code, metadata, generation: '', version: 0, expires_at: expiresAt, token };
    try { await this.commit(lease, authority, expiresAt); return true; }
    catch (error) {
      await this.db.prepare('DELETE FROM rooms WHERE code = ? AND version = 0 AND lease_token = ?').bind(code, token).run();
      throw error;
    }
  }

  async loadProPasses(lease: RoomLease, authority: PersistableRoom):Promise<void>{
    const ids=authority.driverIds?.(lease.code)||[];
    authority.applyProPasses?.(await new ProStore(this.db,this.now).bestPasses(ids));
  }

  async commit(lease: RoomLease, authority: PersistableRoom, expiresAt: number): Promise<void> {
    const driverDeltas=authority.prepareDriverDeltas?.(lease.code)||[];
    const publicSnapshot=authority.publishedSnapshot(lease.code),publishedAt=this.now();
    for(const presence of authority.presenceSeeds(lease.code)){if(lease.presenceIds?.has(presence.playerId))continue;await this.db.prepare('INSERT OR IGNORE INTO player_presence(room_code,player_id,last_seen,forfeited_at) VALUES(?,?,?,?)').bind(lease.code,presence.playerId,presence.lastSeen,presence.forfeitedAt).run();}
    const gamePlayerIds: string[] = [];
    const staged:D1Statement[]=[];
    for (const playerId of authority.getPlayerIds(lease.code)) {
      const json = authority.serializePlayerState(lease.code, playerId);
      if (json === null) continue;
      const started=performance.now(),compressed = await gzip(json);
      if(this.metrics)this.metrics.gzipMilliseconds+=performance.now()-started;
      staged.push(this.db.prepare(`INSERT INTO player_states (room_code, generation, player_id, state)
        SELECT ?, ?, ?, ? WHERE EXISTS
          (SELECT 1 FROM rooms WHERE code = ? AND lease_token = ? AND version = ? AND lease_until > ?)`)
        .bind(lease.code, lease.token, playerId, compressed, lease.code, lease.token, lease.version, this.now()));
      gamePlayerIds.push(playerId);
    }
    const metadata = JSON.stringify({ schema: 2, authority: authority.serializeRoomMetadata(lease.code), gamePlayerIds,publishedAt,publicSnapshot });
    if (new TextEncoder().encode(metadata).byteLength > 1_800_000) throw new StoreFailure(413, 'room_too_large', '房間資料超出儲存上限');
    const publish=this.db.prepare(`UPDATE rooms SET metadata = ?, generation = ?, version = version + 1,
      expires_at = ?, lease_token = NULL, lease_until = 0, updated_at = ?
      WHERE code = ? AND lease_token = ? AND version = ? AND lease_until > ?
      AND (SELECT count(*) FROM player_states WHERE room_code=? AND generation=?)=?`)
      .bind(metadata, lease.token, expiresAt, this.now(), lease.code, lease.token, lease.version, this.now(),lease.code,lease.token,gamePlayerIds.length);
    const profileStatements=new DriverStore(this.db,this.now).deltaStatements(lease.code,lease.token,lease.version+1,driverDeltas);
    const proStatements=new ProStore(this.db,this.now).claimStatements(lease.code,lease.token,lease.version+1,expiresAt,authority.prepareProClaims?.(lease.code)||[]);
    let results;
    try{results=await this.db.batch([...staged,publish,...profileStatements,...proStatements]);}
    catch(error){
      if(error instanceof Error&&error.message.includes('harbour_pro_pack_unavailable'))
        throw new StoreFailure(409,'pro_pack_changed','Pro 更次已更新，請再試開更。');
      throw error;
    }
    // A conditional statement affecting zero rows is not a SQL exception;
    // explicitly fence every stage and the final metadata publication.
    if(results.length!==staged.length+1+profileStatements.length+proStatements.length||results.slice(0,staged.length+1).some(result=>!result.meta?.changes))throw new StoreFailure(409,'room_busy','房間更新已逾時，請重試',180);
    lease.committed=true;
    // Only delete the known previous generation, never another writer's stage.
    if (lease.generation){const cleanup=this.db.prepare('DELETE FROM player_states WHERE room_code = ? AND generation = ?').bind(lease.code, lease.generation).run().catch(() => {});if(this.defer)this.defer(cleanup);else await cleanup;}
  }

  async release(lease: RoomLease): Promise<void> {
    if(lease.committed)return;
    await this.db.prepare('UPDATE rooms SET lease_token = NULL, lease_until = 0 WHERE code = ? AND lease_token = ?')
      .bind(lease.code, lease.token).run();
    await this.db.prepare(`DELETE FROM player_states WHERE room_code = ? AND generation = ?
      AND NOT EXISTS (SELECT 1 FROM rooms WHERE code = ? AND generation = ?)`)
      .bind(lease.code, lease.token, lease.code, lease.token).run();
  }

  async pruneExpired(): Promise<void> {
    await this.db.prepare('DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE expires_at <= ? LIMIT 20)').bind(this.now()).run();
  }
}
