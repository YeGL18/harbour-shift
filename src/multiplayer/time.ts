import type { RoomRules } from '../../shared/protocol';
import type { ShiftType } from '../game/types';
export const defaultShiftStart=(shift:ShiftType)=>shift==='night'?1020:300;
export function parseShiftTime(hour:string,minute:string):number|undefined {
  if(!/^\d{1,2}$/u.test(hour)||!/^\d{1,2}$/u.test(minute))return undefined;
  const hours=Number(hour),minutes=Number(minute);
  return hours<24&&minutes<60?hours*60+minutes:undefined;
}
export function clockFields(value:number):{hour:string;minute:string} {
  return {hour:String(Math.floor(value/60)).padStart(2,'0'),minute:String(value%60).padStart(2,'0')};
}
export const clockLabel=(value:number)=>{const {hour,minute}=clockFields(value);return hour+':'+minute;};
export function roomStartTime(room:Pick<RoomRules,'shift'|'startTimeMinutes'>):number {
  return Number.isInteger(room.startTimeMinutes)&&room.startTimeMinutes!>=0&&room.startTimeMinutes!<1440?room.startTimeMinutes!:defaultShiftStart(room.shift);
}
export function shiftTimeRange(start:number,shiftDurationMinutes:360|720|1440=720){return {start:clockLabel(start),finish:clockLabel((start+shiftDurationMinutes)%1440),nextDay:start+shiftDurationMinutes>=1440};}
