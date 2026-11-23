export const SOUND_CUES = ['tap','select','open','pause','resume','park','rest','service','complete','cancel','error','event'] as const;
export type SoundCue = typeof SOUND_CUES[number];
export const isSoundCue=(value:unknown):value is SoundCue=>typeof value==='string'&&(SOUND_CUES as readonly string[]).includes(value);

const IN_PLAY_MENUS=new Set(['Settings','Stations','Operations','OrderFeed']);
/** Only screens opened from the current driving session inherit its pause UI. */
export function isInPlayRoute(hasGame:boolean,routeName:string,previousInPlay:boolean):boolean {
  return hasGame&&(routeName==='Shift'||previousInPlay&&IN_PLAY_MENUS.has(routeName));
}
export function isActualSoloPause(input:{hasGame:boolean;phase:string;inPlay:boolean;online:boolean;loadingGate:boolean;paused:boolean;planning:boolean;shiftVisible:boolean}):boolean {
  return input.hasGame&&input.phase!=='ended'&&input.inPlay&&!input.online&&!input.loadingGate&&(input.paused||input.planning||!input.shiftVisible);
}

export interface EffectState {
  session:string; inPlay:boolean; paused:boolean; phase:string;
  parking?:'temporary'|'rest'; servicing:boolean; completedTrips:number; worldEventId?:string;
}
/** Actual state changes only; hydration and repeated snapshots stay silent. */
export function effectCue(previous:EffectState|null,current:EffectState):SoundCue|undefined {
  if(!previous||previous.session!==current.session||!current.inPlay)return;
  if(current.phase==='ended'&&previous.phase!=='ended')return 'complete';
  if(current.paused!==previous.paused)return current.paused?'pause':'resume';
  if(current.paused)return;
  if(current.completedTrips>previous.completedTrips)return 'complete';
  if(current.parking&&current.parking!==previous.parking)return current.parking==='rest'?'rest':'park';
  if(current.servicing&&!previous.servicing)return 'service';
  if(current.worldEventId&&current.worldEventId!==previous.worldEventId)return 'event';
}
