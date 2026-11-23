import { RoomAuthority, ProtocolFailure } from '../authority';
import { MULTIPLAYER_API, PROTOCOL_VERSION, type ActionEnvelope, type CreateRoomRequest, type JoinRoomRequest } from '../../shared/protocol';
import { D1RoomStore, StoreFailure, type D1Database } from './store';
import { streamedJson } from './json';
import { prepareServerData } from './data-bootstrap';
import {newTiming,timed,timingHeader,traceDatabase} from './timing';
import {ProStore} from './pro';
import {DriverStore} from './drivers';
import {object} from '../validation';
import {acquireActionLease} from './actionLease';
import {TrainingStore} from './training';
import {EliteStore} from './elite';
import {VEHICLE_CATALOG_HEADER} from '../../src/game/vehicleCapabilities';
import {ORDER_POLICY_HEADER} from '../../shared/orderPolicy';
import {ADVANCED_RULES_HEADER} from '../../shared/pro';
import { operatorBlindOrders, projectBlindSnapshot } from '../../shared/blindOrders';

interface Environment { DB: D1Database; HARBOUR_PRO_TRIAL?:string; HARBOUR_BLIND_ORDERS?:string;HARBOUR_EXTENDED_VEHICLES?:string;HARBOUR_ADVANCED_RULES?:string }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Harbour-Vehicle-Catalog, X-Harbour-Advanced-Rules, X-Harbour-Order-Policy',
  'Access-Control-Max-Age': '3600',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const admission = new Map<string, { count: number; reset: number }>();
function softAdmissionLimit(request: Request,category='room'): void {
  const now = Date.now(), key = `${category}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  const prior = admission.get(key), bucket = prior && prior.reset > now ? prior : { count: 0, reset: now + 60_000 };
  if (++bucket.count > 20) throw new ProtocolFailure(429, 'rate_limited', '建立或加入房間太頻密，請稍後再試', bucket.reset - now);
  if (admission.size >= 1024 && !admission.has(key)) admission.delete(admission.keys().next().value!);
  admission.set(key, bucket);
}
function expiry(authority: RoomAuthority, code: string): number {
  const metadata = authority.serializeRoomMetadata(code);
  if (!metadata) throw new StoreFailure(404, 'room_not_found', '房間不存在或已到期');
  return JSON.parse(metadata).room.expiresAt;
}
function bearer(request: Request): string {
  const token = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) throw new ProtocolFailure(401, 'unauthorized', '請提供有效的房間重連憑證');
  return token;
}
async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ProtocolFailure(400, 'invalid_request', '請傳送有效資料');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8_192) { await reader.cancel(); throw new ProtocolFailure(413, 'request_too_large', '操作資料過大'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof ProtocolFailure) throw error;
    throw new ProtocolFailure(400, 'invalid_request', '請傳送有效 JSON 資料');
  } finally { reader.releaseLock(); }
}
function isKnown(error: unknown): error is Error & { status: number; code: string; retryAfterMilliseconds?: number } {
  return error instanceof ProtocolFailure || error instanceof StoreFailure || (error instanceof Error && typeof (error as any).code === 'string' && (error as any).status >= 400 && (error as any).status < 500);
}

export default {
  async fetch(request: Request, env: Environment, ctx: ExecutionContext, ingressAt?:number): Promise<Response> {
    const receivedAt=ingressAt??Date.now();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const timing=newTiming();
    const json = (value: unknown, init?: ResponseInit): Response => {
      // Commit/compression work takes real time. Report response construction
      // time separately from the authoritative state's original sample time.
      if(value&&typeof value==='object'){
        const entry=value as {protocolVersion?:number;snapshot?:unknown};
        if(entry.protocolVersion)value={...entry,serverTime:Date.now()};
        else if(entry.snapshot&&typeof entry.snapshot==='object')value={...entry,snapshot:{...entry.snapshot,serverTime:Date.now()}};
      }
      const responseHeaders=new Headers(init?.headers);responseHeaders.set('Server-Timing',timingHeader(timing));
      return streamedJson(value, {...init,headers:responseHeaders}, request.headers.get('Accept-Encoding'));
    };
    try {
      const url = new URL(request.url), path = url.pathname.replace(/\/$/, '') || '/';
      if (!env.DB) throw new StoreFailure(503, 'storage_unavailable', '伺服器儲存暫時未就緒');
      const db=traceDatabase(env.DB,timing);
      const dataStarted=performance.now(),prepared=prepareServerData();
      // Cloudflare clocks advance after I/O, so yield once to include the
      // first request's synchronous graph preparation in its wall-time trace.
      if(prepared)await new Promise(resolve=>setTimeout(resolve,1));
      timing.phases.data=performance.now()-dataStarted;
      if (request.method === 'GET' && (path === '/' || path === MULTIPLAYER_API.health)) {
        await db.prepare('SELECT code FROM rooms LIMIT 1').first();
        return json({ ok: true, service: 'harbour-shift-authority', protocolVersion: PROTOCOL_VERSION, persistence: 'd1', transport: 'https-polling' }, { headers });
      }
      const drivers=new DriverStore(db);
      if(path===MULTIPLAYER_API.createDriver&&request.method==='POST'){softAdmissionLimit(request,'driver');return json(await drivers.create(await body(request)),{status:201,headers});}
      if(path===MULTIPLAYER_API.driverMe&&request.method==='GET')return json(await drivers.me(bearer(request)),{headers});
      if(path==='/v1/drivers/training'||path.startsWith('/v1/drivers/training/')){
        if(request.method==='POST')softAdmissionLimit(request,'training');
        return json(await new TrainingStore(db).handle(path,request.method,bearer(request),request.method==='POST'?await body(request):undefined),{headers});
      }
      if(path==='/v1/drivers/elite'||path.startsWith('/v1/drivers/elite/')){
        if(request.method==='POST')softAdmissionLimit(request,'elite');
        return json(await new EliteStore(db).handle(path,request.method,bearer(request),request.method==='POST'?await body(request):undefined),{headers});
      }
      if(path==='/v1/drivers/pro'||path.startsWith('/v1/drivers/pro/')){
        if(request.method==='POST')softAdmissionLimit(request,'training');
        return json(await new ProStore(db).handle(path,request.method,bearer(request),request.method==='POST'?await body(request):undefined,env.HARBOUR_PRO_TRIAL==='1'),{headers});
      }
      let now = Date.now();
      const store = new D1RoomStore(db,Date.now,promise=>ctx.waitUntil(promise),timing), authority = new RoomAuthority({ now: () => now, blindOrders:operatorBlindOrders(env.HARBOUR_BLIND_ORDERS),allowExtendedRooms:env.HARBOUR_EXTENDED_VEHICLES!=='0',allowAdvancedRooms:env.HARBOUR_ADVANCED_RULES!=='0' });
      if (request.method === 'POST' && path === MULTIPLAYER_API.create) {
        softAdmissionLimit(request);
        const raw=object(await body(request));const profile=raw.driverCredential?await drivers.authenticate(raw.driverCredential):undefined;const{driverCredential,...input}=raw;
        for (let attempt = 0; attempt < 4; attempt++) {
          const session = await authority.createRoom(input as unknown as CreateRoomRequest);
          if(profile){authority.attachDriver(session.roomCode,session.playerId,profile);session.snapshot=await authority.readSnapshot(session.roomCode,session.resumeToken);}
          if (await store.create(session.roomCode, authority, session.snapshot.room.expiresAt)) {
            ctx.waitUntil(store.pruneExpired().catch(() => {}));
            return json(session, { status: 201, headers });
          }
        }
        throw new ProtocolFailure(503, 'capacity', '請稍後再建立房間');
      }
      const match = /^\/v1\/rooms\/([A-Z0-9]{6})(?:\/(join|actions|heartbeat|horn))?$/i.exec(path);
      if (!match) throw new ProtocolFailure(404, 'not_found', '找不到此 API');
      const code = match[1].toUpperCase(), operation = match[2]?.toLowerCase();
      const join = operation === 'join' && request.method === 'POST';
      const read = (!operation && request.method === 'GET') || (operation === 'heartbeat' && request.method === 'POST');
      const action = operation === 'actions' && request.method === 'POST';
      const horn = operation === 'horn' && request.method === 'POST';
      if (!join && !read && !action && !horn) throw new ProtocolFailure(405, 'method_not_allowed', '不支援此操作方式');
      if (join) softAdmissionLimit(request);
      const token = join ? '' : bearer(request);
      const rawInput = join || action || horn ? await body(request) : undefined;
      const profile=join&&object(rawInput).driverCredential?await drivers.authenticate(object(rawInput).driverCredential):undefined;
      const input=join?(({driverCredential,...rest})=>rest)(object(rawInput)):rawInput;
      if(!join){
        const metadata=await store.readMetadata(code);
        authority.deserializeRoomMetadata(store.parse(metadata).authority);
        const session=await authority.sessionInfo(code,token);
        authority.requireVehicleCatalog(code,request.headers.get(VEHICLE_CATALOG_HEADER)==='1'?1:undefined);
        authority.requireAdvancedRules(code,request.headers.get(ADVANCED_RULES_HEADER)==='1'?1:undefined);
        authority.requireOrderPolicy(code,request.headers.get(ORDER_POLICY_HEADER)==='1'?1:undefined);
        await store.recordPresence(code,session);
        if(read){
          const prior=store.parse(metadata);
          const lease=(!prior.publicSnapshot||Date.now()-(prior.publishedAt||0)>=750)?await timed(timing,'lease',()=>store.acquire(code,Date.now()-750)):null;
          if(lease){
            try{
              await timed(timing,'hydrate',()=>store.hydrate(lease,authority,()=>authority.authorizeSession(code,token)));now=Date.now();
              const result=await timed(timing,'tick',()=>authority.readSnapshot(code,token));
              await timed(timing,'commit',()=>store.commit(lease,authority,expiry(authority,code)));
              return json(result,{headers});
            }finally{await store.release(lease).catch(()=>{});}
          }
          // A single joined SELECT prevents a writer's generation switch and
          // old-shard cleanup from mixing private and public revisions.
          const committed=await store.readCommittedPlayer(code,session.playerId),stored=store.parse(committed);
          authority.deserializeRoomMetadata(stored.authority);
          const current=await authority.sessionInfo(code,token);
          authority.requireAdvancedRules(code,request.headers.get(ADVANCED_RULES_HEADER)==='1'?1:undefined);
        authority.requireOrderPolicy(code,request.headers.get(ORDER_POLICY_HEADER)==='1'?1:undefined);
          if(!stored.publicSnapshot)throw new StoreFailure(409,'room_busy','房間正在更新，請稍候重試',100);
          const ownState=await store.decodeOwnState(committed,current.playerId);
          return json(projectBlindSnapshot({...stored.publicSnapshot,serverTime:Date.now(),you:{playerId:current.playerId,lastInputSeq:current.lastInputSeq,driverId:current.driverId,driverStats:current.driverStats,nearbyDrivers:current.nearbyDrivers,horn:current.horn},ownState}),{headers});
        }
      }
      const lease = await timed(timing,'lease',()=>action?acquireActionLease(()=>store.acquire(code,undefined,true)):store.acquire(code));
      if(!lease)throw new StoreFailure(409,'room_busy','房間正在更新，請稍候重試',180);
      try {
        await timed(timing,'hydrate',()=>store.hydrate(lease, authority, join ? undefined : () => authority.authorizeSession(code, token)));
        now = Date.now();
        if(action&&(input as ActionEnvelope)?.action?.type==='start') await store.loadProPasses(lease,authority);
        let result: unknown;
        try {
          if(join&&profile)authority.assertDriverAvailable(code,profile.driverId);
          result = await timed<unknown>(timing,'tick',()=>join ? authority.joinRoom(code, input as JoinRoomRequest)
            : action ? authority.handleCommand(code, token, input as ActionEnvelope,{receivedAt})
              : horn ? authority.handleHorn(code,token,input,{receivedAt})
              : authority.readSnapshot(code, token));
          if(join&&profile){const session=result as Awaited<ReturnType<RoomAuthority['joinRoom']>>;authority.attachDriver(code,session.playerId,profile);session.snapshot=await authority.readSnapshot(code,session.resumeToken);}
        } catch (error) {
          // Core errors may follow a clock tick or rate-token consumption. Keep
          // the same authoritative side effects as the portable Node adapter.
          if (isKnown(error) && !(error instanceof StoreFailure) && error.code !== 'unauthorized') await timed(timing,'commit',()=>store.commit(lease, authority, expiry(authority, code)));
          throw error;
        }
        await timed(timing,'commit',()=>store.commit(lease, authority, expiry(authority, code)));
        return json(result, { status: join ? 201 : 200, headers });
      } finally { await store.release(lease).catch(() => {}); }
    } catch (error) {
      if (isKnown(error)) {
        const retryAfter = error.retryAfterMilliseconds;
        return json({ error: { code: error.code, message: error.message, ...(retryAfter ? { retryAfterMilliseconds: retryAfter } : {}) } }, {
          status: error.status, headers: { ...headers, ...(retryAfter ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter / 1000))) } : {}) },
        });
      }
      // No bearer tokens, request bodies, names or room state enter logs.
      console.error('Multiplayer request failed', error instanceof Error ? error.name : 'UnknownError');
      return json({ error: { code: 'server_error', message: '伺服器暫時未能處理，請稍後再試' } }, { status: 503, headers });
    }
  },
};
