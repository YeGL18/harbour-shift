import { NativeModules } from 'react-native';
import {isSoundCue,type SoundCue} from './cues';
export type {SoundCue} from './cues';
type SoundModule = {playOffer():void;stopOffer():void;playAccepted():void;playCue?(name:SoundCue):void;setEnabled(value:boolean):void;startHorn?(id:string,gain:number):void;stopHorn?(id:string):void;stopAllHorns?():void};
const native=NativeModules.HarbourSound as SoundModule|undefined;
let enabled=true,lastTapAt=0;
export const sounds={
  playOffer:()=>{if(enabled)native?.playOffer();},stopOffer:()=>native?.stopOffer(),playAccepted:()=>{if(enabled)native?.playAccepted();},
  playCue:(name:SoundCue)=>{if(!enabled||!isSoundCue(name))return;const now=Date.now();if((name==='tap'||name==='select')&&now-lastTapAt<55)return;lastTapAt=now;native?.playCue?.(name);},
  setEnabled:(value:boolean)=>{enabled=value;native?.setEnabled(value);},
  startHorn:(id:string,gain:number)=>{if(enabled)native?.startHorn?.(id,gain);},stopHorn:(id:string)=>native?.stopHorn?.(id),stopAllHorns:()=>native?.stopAllHorns?.(),
};
