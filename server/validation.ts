import { isRoomSpeed, type ActionEnvelope, type PlayerSetup, type RoomRules } from '../shared/protocol';
import {readOrderPreferences} from '../shared/orderPolicy';
import {allowedOrderPricingTypes} from '../src/game/orderPreferences';
import {isKnownVehicleId} from '../src/game/vehicleCapabilities';

export class ProtocolFailure extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterMilliseconds?: number) { super(message); this.name='ProtocolFailure'; }
}
export function fail(code:string,message:string,status=400):never { throw new ProtocolFailure(status,code,message); }
export function object(value:unknown):Record<string,unknown> { if(!value||typeof value!=='object'||Array.isArray(value)) fail('invalid_request','請傳送有效資料。'); return value as Record<string,unknown>; }
export function keys(value:Record<string,unknown>,allowed:string[]):void { if(Object.keys(value).some(key=>!allowed.includes(key))) fail('unexpected_field','操作含有不受信任或不支援的欄位。'); }
export function nickname(value:unknown):string {
  if(typeof value!=='string') fail('invalid_nickname','請輸入玩家名稱。');
  const name=value.normalize('NFKC').trim();
  if(!name||Array.from(name).length>20||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) fail('invalid_nickname','名稱須為1至20個可顯示字元。');
  return name;
}
export function rules(value:unknown,base:RoomRules):RoomRules {
  const input=object(value);keys(input,['mode','shift','speed','density','startTimeMinutes','shiftDurationMinutes','blindOrders']);const result={...base,...input};
  if(!['highest-net','lowest-net','team-net'].includes(result.mode)||!['day','night'].includes(result.shift)||!isRoomSpeed(result.speed)||!['normal','busy'].includes(result.density)||(result.shiftDurationMinutes!==undefined&&![360,720,1440].includes(result.shiftDurationMinutes as number))) fail('invalid_rules','房間規則無效。');
  if(input.blindOrders!==undefined&&typeof input.blindOrders!=='boolean')fail('invalid_rules','盲單設定無效。');
  const shiftChanged=input.shift!==undefined&&input.shift!==base.shift;
  const start=input.startTimeMinutes!==undefined?input.startTimeMinutes:shiftChanged?undefined:base.startTimeMinutes;
  if(start!==undefined&&(typeof start!=='number'||!Number.isInteger(start)||start<0||start>1439))fail('invalid_rules','房間規則無效。');
  result.startTimeMinutes=typeof start==='number'?start:result.shift==='night'?1020:300;
  return result as RoomRules;
}
export function setup(value:unknown):PlayerSetup {
  const input=object(value);keys(input,['vehicleId','startPlaceId','startNodeId','handoverPlaceId','handoverNodeId','rentalOverride','energyUnitPriceOverride','autoAcceptOrders','orderPreferences']);
  if(!isKnownVehicleId(input.vehicleId)) fail('invalid_vehicle','車種無效。');
  if(input.orderPreferences!==undefined){const preferences=readOrderPreferences(input.orderPreferences);if(!preferences)fail('invalid_order_preferences','接單類型設定無效。');const allowed=allowedOrderPricingTypes(input.vehicleId,true);if(preferences.enabledPricingTypes.some(type=>!allowed.includes(type)))fail('invalid_order_preferences','所選車款唔支援呢種訂單。');input.orderPreferences=preferences;}
  for(const key of ['startPlaceId','startNodeId','handoverPlaceId','handoverNodeId']) if(input[key]!==undefined&&(typeof input[key]!=='string'||(input[key] as string).length>120||!(input[key] as string).length)) fail('invalid_place','起點或交更點無效。');
  if(input.startPlaceId&&input.startNodeId||input.handoverPlaceId&&input.handoverNodeId) fail('invalid_place','每個起點或交更點只可用一個地點。');
  for(const [key,maximum]of [['rentalOverride',100_000],['energyUnitPriceOverride',1_000]]as const){const value=input[key];if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>maximum))fail('invalid_cost','成本設定無效。');}
  if(input.autoAcceptOrders!==undefined&&typeof input.autoAcceptOrders!=='boolean')fail('invalid_action','開關操作無效。');
  return input as unknown as PlayerSetup;
}
export function envelope(value:unknown):ActionEnvelope {
  const input=object(value);keys(input,['seq','action']);
  if(!Number.isSafeInteger(input.seq)||(input.seq as number)<1) fail('invalid_sequence','操作序號無效。');
  const action=object(input.action);if(typeof action.type!=='string') fail('invalid_action','操作無效。');
  const fields:Record<string,string[]>={accept:['offerId'],decline:['offerId'],cancel:['tripId'],'cancel-queued':['tripId'],park:[],rest:[],drive:[],service:[],'cancel-charge':[],handover:[],'cancel-handover':[],'recover-energy':[],start:[],leave:[],branch:['junctionNodeId','edgeId'],'cruise-to':['nodeId'],route:['policy'],event:['choice'],accepting:['value'],'auto-accept':['value'],profile:['nickname'],setup:['setup'],ready:['ready'],rules:['rules'],team:['teamId'],'map-ready':['epoch','ready'],station:['stationId']};
  fields['pro-destination']=['placeId'];
  fields['elite-booking']=['bookingId','choice'];
  fields.airport=['choice'];
  if(action.type==='airport'&&!['go','join','leave'].includes(String(action.choice)))fail('invalid_action','機場隊列操作無效。');
  if(action.type==='pro-destination'&&action.placeId!==undefined&&!validId(action.placeId))fail('invalid_action','目的地資料無效。');
  if(action.type==='elite-booking'&&(!validId(action.bookingId)||!['accept','decline','depart','cancel'].includes(String(action.choice))))fail('invalid_action','預約操作無效。');
  if(!fields[action.type]) fail('invalid_action','操作未支援。'); keys(action,['type',...fields[action.type]]);
  if(action.type==='branch'&&(!validId(action.junctionNodeId)||!validId(action.edgeId))||action.type==='station'&&!validId(action.stationId)) fail('invalid_action','道路或服務站ID無效。');
  if(action.type==='cruise-to'&&!validId(action.nodeId))fail('invalid_action','巡遊位置無效。');
  if((action.type==='accept'||action.type==='decline')&&!validId(action.offerId)||(action.type==='cancel'||action.type==='cancel-queued')&&!validId(action.tripId))fail('invalid_action','操作無效。');
  if(action.type==='route'&&!['fastest','economy'].includes(String(action.policy))||action.type==='event'&&!['stay','reroute'].includes(String(action.choice))) fail('invalid_action','路線操作無效。');
  if((action.type==='accepting'||action.type==='auto-accept')&&typeof action.value!=='boolean'||action.type==='ready'&&typeof action.ready!=='boolean') fail('invalid_action','開關操作無效。');
  if(action.type==='team'&&!['A','B'].includes(String(action.teamId)))fail('invalid_action','隊伍設定無效。');
  if(action.type==='map-ready'&&(!validId(action.epoch)||typeof action.ready!=='boolean'))fail('invalid_action','地圖就緒資料無效。');
  return input as unknown as ActionEnvelope;
}
const validId=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=120;

export function randomToken():string { const bytes=crypto.getRandomValues(new Uint8Array(32));return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join(''); }
export async function tokenHash(token:string):Promise<string> {
  if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token)) fail('unauthorized','重連憑證無效。',401);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}
export function roomCode():string { const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(crypto.getRandomValues(new Uint8Array(6)),byte=>alphabet[byte%alphabet.length]).join(''); }
