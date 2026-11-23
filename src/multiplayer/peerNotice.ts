import type { SharedDispatchAssignment } from '../../shared/protocol';

export const PEER_NOTICE_DURATION_MS=3000;
export const PEER_NOTICE_MAX_AGE_MS=10_000;
export const PEER_NOTICE_SEEN_LIMIT=128;
export interface PeerNoticeEvent {
  namespace:string;
  key:string;
  assignment:SharedDispatchAssignment;
  acceptedAt:number;
  firstSeenAt:number;
  expiresAt:number;
}
export interface PeerNoticeState {
  namespace:string;
  seen:string[];
  current:PeerNoticeEvent|null;
  latestAcceptedAt:number;
  latestKey:string;
}
export const peerNoticeNamespace=(roomCode:string,ownPlayerId:string)=>JSON.stringify([roomCode.trim().toUpperCase(),ownPlayerId]);
export const createPeerNoticeState=(namespace:string):PeerNoticeState=>({namespace,seen:[],current:null,latestAcceptedAt:0,latestKey:''});
const eventKey=(assignment:SharedDispatchAssignment)=>JSON.stringify([assignment.playerId,assignment.offerId]);
const acceptedTime=(assignment:SharedDispatchAssignment)=>assignment.acceptedAt??assignment.assignedAt;
const compare=(a:{at:number;key:string},b:{at:number;key:string})=>a.at-b.at||(a.key<b.key?-1:a.key>b.key?1:0);

/**
 * `now` is a monotonic real-millisecond clock, independent of game speed.
 * `serverTime` is used only to reject old events, never to extend the display.
 * A burst selects its newest event; older unseen events are consumed, not queued.
 */
export function selectPeerNotice(previous:PeerNoticeState,assignments:readonly SharedDispatchAssignment[],options:{namespace:string;ownPlayerId:string;serverTime:number;now:number;foreground?:boolean}):PeerNoticeState {
  const {namespace,ownPlayerId,serverTime,now,foreground=true}=options;
  const state=previous.namespace===namespace?previous:createPeerNoticeState(namespace);
  if(!Number.isFinite(now)||!Number.isFinite(serverTime))return {...state,current:null};
  const seen=new Set(state.seen);
  let current=foreground&&state.current&&now<state.current.expiresAt?state.current:null;
  let latest={at:state.latestAcceptedAt,key:state.latestKey};
  const accepted=assignments.filter(assignment=>assignment.status==='accepted'&&assignment.playerId!==ownPlayerId&&assignment.offerId&&assignment.playerId&&Number.isFinite(acceptedTime(assignment)))
    .map(assignment=>({assignment,key:eventKey(assignment),at:acceptedTime(assignment)}))
    .sort(compare);
  let selected:typeof accepted[number]|undefined;
  for(const event of accepted){
    if(seen.has(event.key))continue;
    seen.add(event.key);
    const age=serverTime-event.at;
    if(!foreground||age>PEER_NOTICE_MAX_AGE_MS||age< -1000||compare(event,latest)<=0)continue;
    selected=event;
    latest={at:event.at,key:event.key};
  }
  if(selected)current={namespace,key:selected.key,assignment:selected.assignment,acceptedAt:selected.at,firstSeenAt:now,expiresAt:now+PEER_NOTICE_DURATION_MS};
  return {namespace,seen:[...seen].slice(-PEER_NOTICE_SEEN_LIMIT),current,latestAcceptedAt:latest.at,latestKey:latest.key};
}

/** Small process-memory cache: route remounts retain deadlines, not a replay. */
export function createPeerNoticeCache(maxNamespaces=8){
  const limit=Math.max(1,Math.min(8,Number.isFinite(maxNamespaces)?Math.floor(maxNamespaces):8)),states=new Map<string,PeerNoticeState>();
  return {
    read(namespace:string){return states.get(namespace)??createPeerNoticeState(namespace);},
    write(state:PeerNoticeState){states.delete(state.namespace);states.set(state.namespace,state);while(states.size>limit)states.delete(states.keys().next().value!);},
    get size(){return states.size;},
  };
}
