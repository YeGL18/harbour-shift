export interface SoloOfferWindow {id:string;deadline:number;pausedAt:number|null}
/** A pause preserves the remainder of this same five-second window. */
export function syncSoloOfferWindow(previous:SoloOfferWindow|null,id:string|undefined,now:number,paused:boolean):SoloOfferWindow|null {
  if(!id)return null;
  if(!previous||previous.id!==id)return {id,deadline:now+5000,pausedAt:paused?now:null};
  if(paused)return previous.pausedAt===null?{...previous,pausedAt:now}:previous;
  return previous.pausedAt===null?previous:{...previous,deadline:previous.deadline+Math.max(0,now-previous.pausedAt),pausedAt:null};
}
export const isSoloOfferExpired=(window:SoloOfferWindow|null,now:number)=>!!window&&(window.pausedAt??now)>=window.deadline;
