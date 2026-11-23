import type {ErrorResponse} from '../../shared/protocol';
import {VEHICLE_CATALOG_HEADER,VEHICLE_CATALOG_VERSION} from '../game/vehicleCapabilities';
import {ORDER_POLICY_HEADER,ORDER_POLICY_VERSION} from '../../shared/orderPolicy';
import {ADVANCED_RULES_HEADER,ADVANCED_RULES_VERSION} from '../../shared/pro';
import {MULTIPLAYER_BASE_URL,MULTIPLAYER_FALLBACK_URLS} from './config';
import {approvedEndpoints,EndpointSelectionError,markEndpointUnhealthy,selectEndpoint,type EndpointHealth} from './endpointSelector';
export interface MultiplayerDiagnostic {kind:'authority'|'network'|'timeout'|'edge-blocked'|'invalid-response'|'discovery';origin?:string;path?:string;elapsedMilliseconds?:number;contentType?:string;cfRay?:string;mitigated?:string;build?:string;observations?:EndpointHealth[]}
export class MultiplayerError extends Error {
  readonly authorityResponse:boolean;
  constructor(message:string,public status=0,public code='NETWORK',public diagnostic?:MultiplayerDiagnostic){super(message);this.name='MultiplayerError';this.authorityResponse=diagnostic?diagnostic.kind==='authority':status>=400;}
}
export function isAuthorityResponseError(error:unknown):error is MultiplayerError{return error instanceof MultiplayerError&&error.authorityResponse;}
export function isTerminalMultiplayerError(error:unknown):error is MultiplayerError{return isAuthorityResponseError(error)&&error.status>=400&&error.status<500&&![408,429].includes(error.status)&&error.code!=='room_busy';}
/** Explicit local/test origins never inherit release credentials or routing. */
export function defaultFallbacksForBase(base:string,configuredBase=MULTIPLAYER_BASE_URL,fallbacks:readonly string[]=MULTIPLAYER_FALLBACK_URLS):readonly string[]{return base===configuredBase?fallbacks:[];}
const safePath=(path:string)=>path.split(/[?#]/,1)[0].replace(/\/rooms\/[^/]+/g,'/rooms/:room');
const field=(response:Response,name:string)=>response.headers.get(name)?.slice(0,256)||undefined;
function diagnostic(kind:MultiplayerDiagnostic['kind'],base:string,path:string,started:number,response?:Response):MultiplayerDiagnostic{return{kind,origin:base,path:safePath(path),elapsedMilliseconds:Math.max(0,Date.now()-started),...(response?{contentType:field(response,'content-type'),cfRay:field(response,'cf-ray'),mitigated:field(response,'cf-mitigated'),build:field(response,'x-harbour-build')}:{} )};}
function replayable(path:string,body:unknown,token?:string):boolean{if(body===undefined)return true;if(!token||!/^\/v1\/rooms\/[A-Z0-9]{6}\/actions$/i.test(path)||!body||typeof body!=='object')return false;const envelope=body as{seq?:unknown;action?:unknown};return Number.isSafeInteger(envelope.seq)&&(envelope.seq as number)>0&&!!envelope.action&&typeof envelope.action==='object';}
function unexpectedOrigin(response:Response,base:string):boolean{if(!response.url)return false;try{return new URL(response.url).origin!==base;}catch{return true;}}
/** One 15-second budget. Creation/join/account POSTs are never automatically replayed. */
export async function request<T>(base:string,path:string,body?:unknown,token?:string,fallbackBases:readonly string[]=defaultFallbacksForBase(base)):Promise<T>{
  const bases=approvedEndpoints(base,fallbackBases);
  if(!bases.length||!path.startsWith('/')||path.startsWith('//')||path.includes('://'))throw new MultiplayerError('多人服務未設定，請更新遊戲。',0,'UNCONFIGURED');
  const serialized=body===undefined?undefined:JSON.stringify(body),canReplay=replayable(path,body,token),attempted=new Set<string>();
  const roomReadOrAction=!!token&&/^\/v1\/rooms\/[A-Z0-9]{6}(?:\/(?:actions|heartbeat|horn))?$/i.test(path);
  const ephemeralHorn=!!token&&/^\/v1\/rooms\/[A-Z0-9]{6}\/horn$/i.test(path);
  const abort=new AbortController(),started=Date.now(),timeout=setTimeout(()=>abort.abort(),ephemeralHorn?1800:15_000);let selected=bases[0];
  try{
    while(true){
      try{selected=await selectEndpoint(bases,{signal:abort.signal,exclude:attempted});}
      catch(error){if(error instanceof EndpointSelectionError)throw new MultiplayerError('暫時搵唔到可連線嘅多人服務入口，請稍後再試。',0,'ENDPOINT_UNAVAILABLE',{kind:'discovery',elapsedMilliseconds:Date.now()-started,observations:error.observations});throw error;}
      try{
        for(let attempt=0;;attempt++){
          const response=await fetch(`${selected}${path}`,{method:body===undefined?'GET':'POST',signal:abort.signal,redirect:'manual',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{ }),...(roomReadOrAction?{[VEHICLE_CATALOG_HEADER]:String(VEHICLE_CATALOG_VERSION),[ADVANCED_RULES_HEADER]:String(ADVANCED_RULES_VERSION),[ORDER_POLICY_HEADER]:String(ORDER_POLICY_VERSION)}:{})},...(serialized===undefined?{}:{body:serialized})});
          const contentType=field(response,'content-type')??'',challenge=field(response,'cf-mitigated')==='challenge';
          if(unexpectedOrigin(response,selected)||response.status>=300&&response.status<400)throw new MultiplayerError('多人服務傳回非預期回應，請稍後再試。',response.status,'UNEXPECTED_REDIRECT',diagnostic('invalid-response',selected,path,started,response));
          if(challenge||response.status===403&&!/\bjson\b/i.test(contentType))throw new MultiplayerError('多人服務入口拒絕此連線，請稍後再試。',response.status,'EDGE_BLOCKED',diagnostic('edge-blocked',selected,path,started,response));
          if(!/\bjson\b/i.test(contentType))throw new MultiplayerError('多人服務傳回非預期回應，請稍後再試。',response.status,'INVALID_RESPONSE',diagnostic('invalid-response',selected,path,started,response));
          let data:T|ErrorResponse;try{data=await response.json();}catch{throw new MultiplayerError('多人服務傳回非預期回應，請稍後再試。',response.status,'INVALID_RESPONSE',diagnostic('invalid-response',selected,path,started,response));}
          if(!response.ok){
            const error=(data as ErrorResponse)?.error;
            if(!error||typeof error.code!=='string'||typeof error.message!=='string')throw new MultiplayerError('多人服務傳回非預期回應，請稍後再試。',response.status,'INVALID_RESPONSE',diagnostic('invalid-response',selected,path,started,response));
            if(!ephemeralHorn&&error.code==='room_busy'&&attempt<9){await new Promise<void>((resolve,reject)=>{const done=()=>{abort.signal.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(done,Math.min(800,Math.max(0,error.retryAfterMilliseconds??180))+Math.random()*140);const cancel=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);reject(new Error('Aborted'));};if(abort.signal.aborted)cancel();else abort.signal.addEventListener('abort',cancel,{once:true});});continue;}
            throw new MultiplayerError(error.message,response.status,error.code,diagnostic('authority',selected,path,started,response));
          }
          return data as T;
        }
      }catch(error){
        const failure=error instanceof MultiplayerError?error:new MultiplayerError(abort.signal.aborted?'連線逾時，正在嘗試恢復房間。':'暫時連唔到多人服務，請檢查網絡。',0,abort.signal.aborted?'TIMEOUT':'NETWORK',diagnostic(abort.signal.aborted?'timeout':'network',selected,path,started));
        const retryOrigin=!failure.authorityResponse&&!abort.signal.aborted&&canReplay;
        if(!ephemeralHorn&&!failure.authorityResponse)markEndpointUnhealthy(selected,bases);attempted.add(selected);
        if(retryOrigin&&attempted.size<bases.length)continue;throw failure;
      }
    }
  }catch(error){if(abort.signal.aborted)throw new MultiplayerError('連線逾時，正在嘗試恢復房間。',0,'TIMEOUT',diagnostic('timeout',selected,path,started));if(error instanceof MultiplayerError)throw error;throw new MultiplayerError('暫時連唔到多人服務，請檢查網絡。',0,'NETWORK',diagnostic('network',selected,path,started));}
  finally{clearTimeout(timeout);}
}
