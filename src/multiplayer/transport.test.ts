import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MultiplayerError, request,isAuthorityResponseError,isTerminalMultiplayerError,defaultFallbacksForBase } from './transport';
import {resetEndpointCache} from './endpointSelector';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch;resetEndpointCache(); });

test('bearer stays in headers; actions serialize once without URL credentials', async () => {
  let seenUrl = '', seenOptions: RequestInit | undefined;
  globalThis.fetch = async (url, options) => { seenUrl = String(url); seenOptions = options; return Response.json({ revision: 4 }); };
  const action = { seq: 7, action: { type: 'accept' } };
  assert.deepEqual(await request('https://example.test/', '/v1/rooms/ABC123/actions', action, 'secret'), { revision: 4 });
  assert.equal(seenUrl, 'https://example.test/v1/rooms/ABC123/actions');
  assert.equal((seenOptions?.headers as Record<string, string>).Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(seenOptions!.body as string), action);
});

test('D1 lease contention retries identical sequence; does not duplicate action', async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(options!.body as string);
    return bodies.length === 1 ? Response.json({ error: { code: 'room_busy', message: 'busy', retryAfterMilliseconds: 1 } }, { status: 409 }) : Response.json({ revision: 5 });
  };
  await request('https://example.test', '/v1/rooms/ABC123/actions', { seq: 8, action: { type: 'cancel' } }, 'secret');
  assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
});

test('business conflicts surface without retry; network ambiguity is not blindly replayed', async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ error: { code: 'offer_taken', message: '已被接走' } }, { status: 409 }); };
  await assert.rejects(request('https://example.test', '/x', {}), (error: unknown) => error instanceof MultiplayerError && error.code === 'offer_taken' && error.status === 409);
  assert.equal(count, 1);
  globalThis.fetch = async () => { count++; throw new TypeError('network'); };
  await assert.rejects(request('https://example.test', '/x', {}), (error: unknown) => error instanceof MultiplayerError && error.code === 'NETWORK');
  assert.equal(count, 2);
});

const health=()=>Response.json({ok:true,service:'harbour-shift-authority',protocolVersion:2,persistence:'d1'});
test('an explicit development origin never inherits a configured production fallback',async()=>{
  const release='https://release.test',fallbacks=['https://release-backup.test'];
  assert.deepEqual(defaultFallbacksForBase('https://dev.test',release,fallbacks),[]);assert.deepEqual(defaultFallbacksForBase(release,release,fallbacks),fallbacks);
  const calls:string[]=[];globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json({revision:1});};
  assert.deepEqual(await request('https://dev.test','/v1/rooms/ABC123/actions',{seq:1,action:{type:'drive'}},'dev-only-token'),{revision:1});
  assert.deepEqual(calls,['https://dev.test/v1/rooms/ABC123/actions']);
});
test('HTML/challenges preserve actual HTTP status and safe metadata without becoming terminal authority errors',async()=>{
  for(const status of [401,403,502]){
    globalThis.fetch=async()=>new Response('<html>secret-body</html>',{status,headers:{'content-type':'text/html','cf-ray':'sample-HKG','cf-mitigated':'challenge','set-cookie':'secret-cookie','authorization':'secret-token'}});
    await assert.rejects(request('https://example.test','/v1/rooms/ABC123/actions',{seq:1,action:{type:'drive'}},'secret-token'),(error:unknown)=>{
      assert.ok(error instanceof MultiplayerError);assert.equal(error.status,status);assert.equal(error.code,'EDGE_BLOCKED');assert.equal(isAuthorityResponseError(error),false);assert.equal(isTerminalMultiplayerError(error),false);assert.equal(error.diagnostic!.cfRay,'sample-HKG');assert.equal(error.diagnostic!.path,'/v1/rooms/:room/actions');
      const saved=JSON.stringify(error);assert.ok(!saved.includes('secret-body'));assert.ok(!saved.includes('secret-cookie'));assert.ok(!saved.includes('secret-token'));return true;
    });
  }
});
test('malformed/non-JSON responses stay distinct from true JSON business errors and transient limits',async()=>{
  for(const response of [new Response('not-json',{status:200,headers:{'content-type':'application/json'}}),new Response('bad gateway',{status:502,headers:{'content-type':'text/plain'}})]){
    globalThis.fetch=async()=>response;await assert.rejects(request('https://example.test','/read'),(error:unknown)=>error instanceof MultiplayerError&&error.status===response.status&&error.code==='INVALID_RESPONSE'&&!isTerminalMultiplayerError(error));
  }
  for(const [status,code,terminal]of [[401,'unauthorized',true],[409,'offer_expired',true],[429,'rate_limited',false],[409,'room_busy',false]]as const){
    const error=new MultiplayerError('business',status,code,{kind:'authority'});assert.equal(isAuthorityResponseError(error),true);assert.equal(isTerminalMultiplayerError(error),terminal);
  }
  assert.equal(isTerminalMultiplayerError(new MultiplayerError('legacy mocked conflict',409)),true);
});
test('a sequenced room action may retry an ambiguous failure only on approved healthy origins with identical body/token',async()=>{
  const primary='https://primary.test',fallback='https://fallback.test',actions:Array<{url:string;options:RequestInit}>=[];
  globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/health')){assert.equal((options!.headers as Record<string,string>).Authorization,undefined);return health();}actions.push({url:String(url),options:options!});if(String(url).startsWith(primary))throw new TypeError('lost acknowledgement');return Response.json({revision:8});};
  const intent={seq:12,action:{type:'accept',offerId:'real-request'}};assert.deepEqual(await request(primary,'/v1/rooms/ABC123/actions',intent,'same-token',[fallback]),{revision:8});
  assert.equal(actions.length,2);assert.equal(actions[0].url,primary+'/v1/rooms/ABC123/actions');assert.equal(actions[1].url,fallback+'/v1/rooms/ABC123/actions');assert.equal(actions[0].options.body,actions[1].options.body);assert.equal((actions[1].options.headers as Record<string,string>).Authorization,'Bearer same-token');assert.ok(actions.every(entry=>entry.options.redirect==='manual'));
});
test('create/join/driver POSTs never replay across origins after an ambiguous mutation',async()=>{
  for(const path of ['/v1/rooms','/v1/rooms/ABC123/join','/v1/drivers']){
    resetEndpointCache();const mutations:string[]=[];globalThis.fetch=async(url)=>{if(String(url).endsWith('/health'))return health();mutations.push(String(url));throw new TypeError('response lost after possible commit');};
    await assert.rejects(request('https://primary.test',path,{nickname:'Private name'},undefined,['https://fallback.test']),(error:unknown)=>error instanceof MultiplayerError&&error.code==='NETWORK');assert.deepEqual(mutations,['https://primary.test'+path]);
  }
});
test('an authenticated GET can recover from an edge HTML block through another approved authority origin',async()=>{
  const reads:Array<{url:string;authorization?:string}>=[];
  globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/health'))return health();reads.push({url:String(url),authorization:(options!.headers as Record<string,string>).Authorization});return String(url).startsWith('https://primary.test')?new Response('blocked',{status:403,headers:{'content-type':'text/html'}}):Response.json({revision:10});};
  assert.deepEqual(await request('https://primary.test','/v1/rooms/ABC123',undefined,'same-token',['https://fallback.test']),{revision:10});
  assert.deepEqual(reads,[{url:'https://primary.test/v1/rooms/ABC123',authorization:'Bearer same-token'},{url:'https://fallback.test/v1/rooms/ABC123',authorization:'Bearer same-token'}]);
});
test('unavailable discovery makes no mutation and keeps safe real HTTP failure observations',async()=>{
  let mutation=0;globalThis.fetch=async(url)=>{if(!String(url).endsWith('/health'))mutation++;return new Response('blocked secret body',{status:403,headers:{'content-type':'text/html','cf-ray':'probe-HKG','set-cookie':'secret-cookie'}});};
  await assert.rejects(request('https://primary.test','/v1/rooms',{nickname:'Private name'},undefined,['https://fallback.test']),(error:unknown)=>{
    assert.ok(error instanceof MultiplayerError);assert.equal(error.code,'ENDPOINT_UNAVAILABLE');assert.equal(isTerminalMultiplayerError(error),false);assert.ok(error.diagnostic!.observations!.every(item=>item.status===403&&item.cfRay==='probe-HKG'));assert.ok(!JSON.stringify(error).includes('secret'));assert.ok(!JSON.stringify(error).includes('Private name'));return true;
  });assert.equal(mutation,0);
});
test('parallel public discovery picks a working origin before the first non-replayable create',async()=>{
  const mutations:string[]=[];globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/health'))return String(url).startsWith('https://blocked.test')?new Response('blocked',{status:403,headers:{'content-type':'text/html'}}):health();mutations.push(String(url));assert.equal((options!.headers as Record<string,string>).Authorization,undefined);return Response.json({roomCode:'ABC123'});};
  assert.deepEqual(await request('https://blocked.test','/v1/rooms',{nickname:'Driver'},undefined,['https://working.test']),{roomCode:'ABC123'});assert.deepEqual(mutations,['https://working.test/v1/rooms']);
});
test('authority conflicts are not cross-origin replayed and Location cannot authorize another host',async()=>{
  let mutations=0;globalThis.fetch=async(url)=>{if(String(url).endsWith('/health'))return health();mutations++;return Response.json({error:{code:'offer_taken',message:'taken'}},{status:409});};
  await assert.rejects(request('https://primary.test','/v1/rooms/ABC123/actions',{seq:1,action:{type:'drive'}},'secret',['https://fallback.test']),(error:unknown)=>isTerminalMultiplayerError(error));assert.equal(mutations,1);
  resetEndpointCache();const calls:string[]=[];globalThis.fetch=async(url)=>{calls.push(String(url));return String(url).endsWith('/health')?health():new Response(null,{status:307,headers:{Location:'https://unapproved.test/steal'}});};
  await assert.rejects(request('https://primary.test','/v1/rooms',{},'secret',['https://fallback.test']),(error:unknown)=>error instanceof MultiplayerError&&error.status===307&&!isTerminalMultiplayerError(error));assert.equal(calls.some(url=>url.startsWith('https://unapproved.test')),false);assert.equal(calls.filter(url=>!url.endsWith('/health')).length,1);
});
test('the entire request keeps one fifteen-second budget and exposes a nonterminal timeout',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
  const pending=request('https://example.test','/read');const rejected=assert.rejects(pending,(error:unknown)=>error instanceof MultiplayerError&&error.code==='TIMEOUT'&&!isTerminalMultiplayerError(error));
  await Promise.resolve();t.mock.timers.tick(15_000);await rejected;
});
test('ephemeral horn drops a busy lease without retrying or consuming a game sequence',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{code:'room_busy',message:'busy',retryAfterMilliseconds:1}},{status:409});};
  await assert.rejects(request('https://example.test','/v1/rooms/ABC123/horn',{actions:[{pressId:'p',pressed:true}]},'secret'),(error:unknown)=>error instanceof MultiplayerError&&error.code==='room_busy');assert.equal(calls,1);
});
test('ephemeral horn has a bounded1.8second budget while normal requests retain fifteen seconds',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  const pending=request('https://example.test','/v1/rooms/ABC123/horn',{actions:[{pressId:'p',pressed:true}]},'secret');const rejected=assert.rejects(pending,(error:unknown)=>error instanceof MultiplayerError&&error.code==='TIMEOUT');
  await Promise.resolve();t.mock.timers.tick(1800);await rejected;
});
test('advanced room capability accompanies every private room operation, never public/account probes',async()=>{
 const captured:Array<{url:string;headers:Record<string,string>}>=[];globalThis.fetch=async(url,options)=>{captured.push({url:String(url),headers:options!.headers as Record<string,string>});return Response.json({ok:true});};
 for(const suffix of['','/heartbeat','/actions','/horn'])await request('https://example.test',`/v1/rooms/ABC123${suffix}`,suffix?{seq:1,action:{type:'drive'}}:undefined,'secret');
 await request('https://example.test','/v1/drivers/me',undefined,'driver-secret');await request('https://example.test','/health');
 assert.ok(captured.slice(0,4).every(value=>value.headers['X-Harbour-Advanced-Rules']==='1'&&value.headers['X-Harbour-Vehicle-Catalog']==='1'&&value.headers['X-Harbour-Order-Policy']==='1'));
 assert.ok(captured.slice(4).every(value=>value.headers['X-Harbour-Advanced-Rules']===undefined));
});
