import {flatDistanceM} from './spatial';
import type {Coordinate,WorldEvent} from './types';
/** Seeded authority input only; no direct payout or event completion bonus. */
export function normalizeWorldEvent(value:unknown):WorldEvent|undefined {
  if(!value||typeof value!=='object')return undefined;
  const event=value as WorldEvent;
  if(!['id','title','titleEn','pickupPlaceId'].every(key=>typeof event[key as keyof WorldEvent]==='string'&&String(event[key as keyof WorldEvent]).length>0&&String(event[key as keyof WorldEvent]).length<=240)||!event.center||!Number.isFinite(event.center.lat)||!Number.isFinite(event.center.lon)||Math.abs(event.center.lat)>90||Math.abs(event.center.lon)>180||!Number.isFinite(event.radiusM)||event.radiusM<=0||event.radiusM>20000||!Number.isFinite(event.startsAt)||!Number.isFinite(event.endsAt)||event.startsAt<0||event.endsAt<=event.startsAt||!Number.isFinite(event.demandBoost)||event.demandBoost<1)return undefined;
  return {id:event.id,title:event.title,titleEn:event.titleEn,pickupPlaceId:event.pickupPlaceId,center:{lat:event.center.lat,lon:event.center.lon},radiusM:event.radiusM,startsAt:event.startsAt,endsAt:event.endsAt,demandBoost:Math.min(5,event.demandBoost)};
}
/** Smooth bounded local demand weight, active only in relative shift minutes. */
export function worldEventDemandBoost(event:WorldEvent|undefined,position:Coordinate|undefined,clockMinutes:number|undefined):number {
  if(!event||!position||!event.center||!Number.isFinite(event.center.lat)||!Number.isFinite(event.center.lon)||!Number.isFinite(event.startsAt)||!Number.isFinite(event.endsAt)||clockMinutes===undefined||!Number.isFinite(clockMinutes)||clockMinutes<event.startsAt||clockMinutes>=event.endsAt||!Number.isFinite(event.radiusM)||event.radiusM<=0||!Number.isFinite(event.demandBoost))return 1;
  const fraction=flatDistanceM(position,event.center)/event.radiusM;
  if(!Number.isFinite(fraction)||fraction>=1)return 1;
  const x=Math.max(0,fraction),falloff=1-x*x*(3-2*x);
  return 1+(Math.max(1,Math.min(5,event.demandBoost))-1)*falloff;
}
