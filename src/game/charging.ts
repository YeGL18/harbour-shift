import type {ChargingOption,EnergyProfile,EnergyStation} from './types';

/** Explicit game curve, not a manufacturer's charging promise or a live tariff. */
export const CHARGING_GAME_MODEL={efficiency:.92,bands:[{until:.8,factor:1},{until:.95,factor:.55},{until:1,factor:.25}]} as const;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
export function selectChargingOption(profile:EnergyProfile,station:EnergyStation,vehicleId?:string):ChargingOption|null {
  if(profile.kind!=='charge'||station.kind!=='charge')return null;
  const choices=(station.chargingOptions||[]).filter(option=>profile.chargingConnectors?.includes(option.connector)&&Number.isFinite(option.powerKw)&&option.powerKw>0&&(!option.vehicleRestriction||vehicleId?.startsWith('tesla-'))).map(option=>{
    const ac=option.connector==='type2'||option.connector==='gbt-ac';
    return {...option,powerKw:Math.min(option.powerKw,profile.maxChargePowerKw||50,ac?profile.maxACChargePowerKw||7:Infinity)};
  });
  return choices.sort((a,b)=>b.powerKw-a.powerKw||(a.unitPrice??Infinity)-(b.unitPrice??Infinity)||a.connector.localeCompare(b.connector))[0]||null;
}
function inputs(capacity:number,remaining:number,target:number,powerKw:number){
  if(!Number.isFinite(capacity)||capacity<=0||!Number.isFinite(remaining)||!Number.isFinite(target)||!Number.isFinite(powerKw)||powerKw<=0)return null;
  const start=clamp(remaining,0,capacity);return{capacity,start,target:clamp(target,start,capacity),powerKw};
}
export function chargingMinutes(capacity:number,remaining:number,target:number,powerKw:number):number {
  const values=inputs(capacity,remaining,target,powerKw);if(!values)return Infinity;
  let at=values.start,minutes=0;
  for(const band of CHARGING_GAME_MODEL.bands){const end=Math.min(values.target,capacity*band.until);if(end>at){minutes+=(end-at)/(powerKw*CHARGING_GAME_MODEL.efficiency*band.factor)*60;at=end;}}
  return minutes;
}
export function chargeAfterMinutes(capacity:number,remaining:number,target:number,powerKw:number,minutes:number):{remaining:number;deliveredKWh:number;gridKWh:number} {
  const values=inputs(capacity,remaining,target,powerKw);if(!values||!Number.isFinite(minutes)||minutes<=0)return{remaining,deliveredKWh:0,gridKWh:0};
  let at=values.start,left=minutes;
  for(const band of CHARGING_GAME_MODEL.bands){const end=Math.min(values.target,capacity*band.until);if(end<=at)continue;const perMinute=powerKw*CHARGING_GAME_MODEL.efficiency*band.factor/60;const added=Math.min(end-at,left*perMinute);at+=added;left-=added/perMinute;if(left<=1e-9)break;}
  const deliveredKWh=at-values.start;return{remaining:at,deliveredKWh,gridKWh:deliveredKWh/CHARGING_GAME_MODEL.efficiency};
}
