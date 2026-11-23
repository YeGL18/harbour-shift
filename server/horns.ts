import type {RoadGraph} from '../src/game/types';
import {HORN_LIMITS,hornCorridorDistance,hornGain,validHornPressId,type HornAction,type HornEvent,type HornRoadPosition,type HornView} from '../shared/horns';
import {fail,keys,object} from './validation';
export interface HornRecord {id:string;senderId:string;pressId:string;startedAt:number;activeUntil:number;endedAt?:number}
export interface HornParticipant {id:string;position?:HornRoadPosition;eligible:boolean}
export function parseHornActions(input:unknown):HornAction[] {
  const body=object(input);keys(body,['actions']);
  if(!Array.isArray(body.actions)||body.actions.length<1||body.actions.length>12)fail('invalid_horn','響號請求無效。');
  return body.actions.map((raw:unknown)=>{const entry=object(raw);keys(entry,['pressId','pressed']);if(!validHornPressId(entry.pressId)||typeof entry.pressed!=='boolean')fail('invalid_horn','響號請求無效。');return{pressId:entry.pressId as string,pressed:entry.pressed as boolean};});
}
export function pruneHorns(records:readonly HornRecord[]|undefined,now:number):HornRecord[] {return(records||[]).filter(r=>Number.isFinite(r.startedAt)&&Number.isFinite(r.activeUntil)&&r.startedAt<=now&&Math.max(r.endedAt??r.activeUntil,r.startedAt)+HORN_LIMITS.retentionMs>now).slice(-HORN_LIMITS.maxRecords);}
/** Idempotent press/renew/release; no driver statistics, claims or coordinates. */
export function applyHornAction(records:readonly HornRecord[]|undefined,senderId:string,action:HornAction,now:number):HornRecord[] {
  if(!validHornPressId(action.pressId)||typeof action.pressed!=='boolean'||!Number.isSafeInteger(now)||now<=0)return pruneHorns(records,now);
  const next=pruneHorns(records,now).map(record=>({...record})),existing=next.find(record=>record.senderId===senderId&&record.pressId===action.pressId);
  if(action.pressed){
    if(existing){if(existing.endedAt===undefined)existing.activeUntil=now+HORN_LIMITS.leaseMs;return next;}
    next.push({id:`${senderId}:${action.pressId}`,senderId,pressId:action.pressId,startedAt:now,activeUntil:now+HORN_LIMITS.leaseMs});
  }else if(existing&&existing.endedAt===undefined){existing.endedAt=Math.max(existing.startedAt+HORN_LIMITS.minimumMs,now);existing.activeUntil=existing.endedAt;}
  return next.slice(-HORN_LIMITS.maxRecords);
}
export function hornView(records:readonly HornRecord[]|undefined,recipientId:string,participants:readonly HornParticipant[],graph:RoadGraph,now:number,wasVisible=false):HornView {
  const recipient=participants.find(p=>p.id===recipientId);if(!recipient?.eligible||!recipient.position)return{available:false,events:[]};
  const distances=new Map<string,number>();
  for(const player of participants)if(player.id!==recipientId&&player.eligible&&player.position)distances.set(player.id,hornCorridorDistance(recipient.position,player.position,graph));
  const available=[...distances.values()].some(distance=>distance<=(wasVisible?HORN_LIMITS.hideM:HORN_LIMITS.showM));
  const events:HornEvent[]=pruneHorns(records,now).flatMap(({pressId,...record})=>{const gain=hornGain(distances.get(record.senderId)??Infinity);return gain>0?[{...record,gain}]:[];});
  return{available,events};
}
