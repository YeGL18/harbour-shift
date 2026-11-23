import assert from 'node:assert/strict';
import {afterEach,test} from 'node:test';
import {approvedEndpoints,EndpointSelectionError,markEndpointUnhealthy,resetEndpointCache,selectEndpoint} from './endpointSelector';
afterEach(resetEndpointCache);
const health=()=>Response.json({ok:true,service:'harbour-shift-authority',protocolVersion:2,persistence:'d1'});
test('only configured origins survive normalization; embedded credentials and remote HTTP are excluded',()=>{
  assert.deepEqual(approvedEndpoints('https://primary.test/',['https://primary.test','https://backup.test','https://secret@evil.test','https://bad.test/path','https://bad.test?token=secret','http://remote.test','ftp://bad.test','//evil.test']),['https://primary.test','https://backup.test']);
  assert.deepEqual(approvedEndpoints('http://127.0.0.1:8787'),['http://127.0.0.1:8787']);
});
test('parallel anonymous health selects the first compatible approved origin and caches it without credentials',async()=>{
  let now=1000;const seen:Array<{url:string;options?:RequestInit}>=[];const bases=['https://blocked.test','https://working.test'];
  const fetcher:typeof fetch=async(url,options)=>{seen.push({url:String(url),options});return String(url).startsWith(bases[0])?new Response('<html>blocked secret body</html>',{status:403,headers:{'content-type':'text/html','set-cookie':'must-not-retain'}}):health();};
  assert.equal(await selectEndpoint(bases,{fetcher,now:()=>now}),bases[1]);assert.equal(seen.length,2);
  for(const entry of seen){assert.equal(entry.options!.method,'GET');assert.equal(entry.options!.body,undefined);assert.equal((entry.options!.headers as Record<string,string>).Authorization,undefined);assert.equal(entry.options!.redirect,'manual');}
  assert.equal(await selectEndpoint(bases,{fetcher,now:()=>now}),bases[1]);assert.equal(seen.length,2);
  now+=60_001;await selectEndpoint(bases,{fetcher,now:()=>now});assert.equal(seen.length,4);
  markEndpointUnhealthy(bases[1],bases);await selectEndpoint(bases,{fetcher,now:()=>now});assert.equal(seen.length,6);
});
test('health does not accept another service, incompatible protocol, HTML or a redirect as an authority',async()=>{
  const responses=[Response.json({ok:true,service:'another-service',protocolVersion:2,persistence:'d1'}),Response.json({ok:true,service:'harbour-shift-authority',protocolVersion:99,persistence:'d1'}),new Response('private body',{headers:{'content-type':'text/html'}}),new Response(null,{status:302,headers:{location:'https://unapproved.test','set-cookie':'secret'}})];
  let index=0;await assert.rejects(()=>selectEndpoint(responses.map((_,i)=>`https://host${i}.test`),{fetcher:async()=>responses[index++]}),(error:unknown)=>{
    assert.ok(error instanceof EndpointSelectionError);assert.deepEqual(error.observations.map(item=>item.reason),['protocol','protocol','format','redirect']);assert.ok(!JSON.stringify(error.observations).includes('secret'));assert.ok(!JSON.stringify(error.observations).includes('private body'));return true;
  });
});
test('a stalled health probe has its own bounded budget while another approved origin remains usable',async()=>{
  const bases=['https://stalled.test','https://working.test'];let aborted=false;
  const fetcher:typeof fetch=async(url,options)=>String(url).startsWith(bases[1])?health():new Promise((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});});
  assert.equal(await selectEndpoint(bases,{fetcher,timeoutMilliseconds:5}),bases[1]);assert.equal(aborted,true);
});
test('a fast validated primary resolves before a deferred hanging backup and aborts the loser',async()=>{
  let releasePrimary!:(response:Response)=>void,backupAborted=false;
  const primary=new Promise<Response>(resolve=>{releasePrimary=resolve;});const seen:Array<{url:string;options?:RequestInit}>=[];
  const fetcher:typeof fetch=async(url,options)=>{seen.push({url:String(url),options});if(String(url).startsWith('https://primary.test'))return primary;return new Promise((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>{backupAborted=true;reject(new Error('cancelled loser'));},{once:true});});};
  const selected=selectEndpoint(['https://primary.test','https://hanging.test'],{fetcher,timeoutMilliseconds:4500});
  assert.equal(seen.length,2,'both anonymous health checks start together');releasePrimary(health());
  let limit:ReturnType<typeof setTimeout>|undefined;
  try{assert.equal(await Promise.race([selected,new Promise((_,reject)=>{limit=setTimeout(()=>reject(new Error('working primary waited for its hanging backup')),200);})]),'https://primary.test');}
  finally{clearTimeout(limit);}
  assert.equal(backupAborted,true);
  for(const call of seen){assert.equal(call.options!.method,'GET');assert.equal(call.options!.body,undefined);assert.equal((call.options!.headers as Record<string,string>).Authorization,undefined);}
});
