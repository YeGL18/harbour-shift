import {PROTOCOL_VERSION} from '../../shared/protocol';
export interface EndpointHealth {base:string;healthy:boolean;reason?:'http'|'format'|'protocol'|'network'|'timeout'|'redirect';status?:number;contentType?:string;cfRay?:string;mitigated?:string;build?:string}
export class EndpointSelectionError extends Error {constructor(public observations:EndpointHealth[]){super('No approved multiplayer endpoint passed its public health check');}}
interface SelectionOptions {signal?:AbortSignal;fetcher?:typeof fetch;now?:()=>number;timeoutMilliseconds?:number;cacheMilliseconds?:number;exclude?:ReadonlySet<string>}
interface CachedHealth {expiresAt:number;observations:EndpointHealth[]}
const cache=new Map<string,CachedHealth>();
const cacheKey=(bases:readonly string[])=>bases.join('|');
/** Only configured HTTPS origins or local development loopback can receive credentials. */
export function approvedEndpoints(primary:string,fallbacks:readonly string[]=[]):string[]{
  const result:string[]=[];
  for(const input of [primary,...fallbacks]){try{const url=new URL(input),local=url.protocol==='http:'&&['localhost','127.0.0.1','10.0.2.2','[::1]'].includes(url.hostname);if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash||url.pathname!=='/')continue;if(!result.includes(url.origin))result.push(url.origin);}catch{}}
  return result;
}
function field(response:Response,name:string):string|undefined{return response.headers.get(name)?.slice(0,256)||undefined;}
async function probe(base:string,options:SelectionOptions):Promise<EndpointHealth>{
  const controller=new AbortController(),onAbort=()=>controller.abort();
  if(options.signal?.aborted)controller.abort();else options.signal?.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(),options.timeoutMilliseconds??4500);
  try{
    const response=await(options.fetcher??fetch)(`${base}/health`,{method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal:controller.signal});
    const observation:EndpointHealth={base,healthy:false,status:response.status,contentType:field(response,'content-type'),cfRay:field(response,'cf-ray'),mitigated:field(response,'cf-mitigated'),build:field(response,'x-harbour-build')};
    if(response.url&&new URL(response.url).origin!==base||response.status>=300&&response.status<400)return{...observation,reason:'redirect'};
    if(!response.ok)return{...observation,reason:'http'};
    if(!/\bjson\b/i.test(observation.contentType??''))return{...observation,reason:'format'};
    let value;try{value=await response.json();}catch{return{...observation,reason:'format'};}
    if(!value||value.ok!==true||value.service!=='harbour-shift-authority'||value.protocolVersion!==PROTOCOL_VERSION||value.persistence!=='d1')return{...observation,reason:'protocol'};
    return{...observation,healthy:true};
  }catch{return{base,healthy:false,reason:controller.signal.aborted?'timeout':'network'};}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);}
}
/** Probes are anonymous; approved deployment configuration, not health alone, establishes shared authority/DB. */
export async function selectEndpoint(bases:readonly string[],options:SelectionOptions={}):Promise<string>{
  if(!bases.length)throw new EndpointSelectionError([]);
  const allowed=bases.filter(base=>!options.exclude?.has(base));if(!allowed.length)throw new EndpointSelectionError([]);
  if(bases.length===1)return allowed[0];
  const now=options.now??Date.now,key=cacheKey(bases),previous=cache.get(key);
  if(previous&&previous.expiresAt>now()){const selected=allowed.find(base=>previous.observations.some(item=>item.base===base&&item.healthy));if(selected)return selected;}
  const controller=new AbortController(),onAbort=()=>controller.abort();
  if(options.signal?.aborted)controller.abort();else options.signal?.addEventListener('abort',onAbort,{once:true});
  // Resolve as soon as one anonymous probe validates the authority. A broken
  // backup must not consume the working endpoint's action window.
  const {selected,observations}=await new Promise<{selected?:string;observations:EndpointHealth[]}>(resolve=>{
    const observations:EndpointHealth[]=[];let remaining=allowed.length,settled=false;
    const finish=(selected?:string)=>{if(settled)return;settled=true;options.signal?.removeEventListener('abort',onAbort);if(selected)controller.abort();resolve({selected,observations:[...observations].sort((a,b)=>allowed.indexOf(a.base)-allowed.indexOf(b.base))});};
    for(const base of allowed)void probe(base,{...options,signal:controller.signal}).then(observation=>{
      if(settled)return;observations.push(observation);remaining--;
      if(observation.healthy)finish(base);else if(!remaining)finish();
    });
  });
  cache.set(key,{expiresAt:now()+(options.cacheMilliseconds??60_000),observations});if(cache.size>16)cache.delete(cache.keys().next().value!);
  if(!selected)throw new EndpointSelectionError(observations);return selected;
}
export function markEndpointUnhealthy(base:string,bases:readonly string[]):void{const entry=cache.get(cacheKey(bases));if(entry)entry.observations=entry.observations.map(item=>item.base===base?{...item,healthy:false}:item);}
/** Test/reset support; no endpoint credentials are cached or persisted. */
export function resetEndpointCache():void{cache.clear();}
