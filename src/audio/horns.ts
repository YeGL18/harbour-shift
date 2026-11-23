import {HORN_LIMITS,type HornView} from '../../shared/horns';
export interface HornPlayer {startHorn(id:string,gain:number):void;stopHorn(id:string):void}
/** Snapshot receipt time converts server leases without trusting a client clock. */
export class HornPlayback {
  private seen=new Map<string,number>();
  private playing=new Map<string,{until:number;oneShot:boolean;nativeAt:number;gain:number}>();
  constructor(private readonly player:HornPlayer){}
  sync(view:HornView|undefined,selfId:string,serverTime:number,receivedAt:number,now:number):void {
    const serverNow=serverTime+Math.max(0,now-receivedAt),present=new Set<string>();
    for(const event of view?.events||[]){
      if(event.senderId===selfId||!Number.isFinite(event.gain)||event.gain<=0)continue;
      const id=`remote:${event.id}`;present.add(id);const existing=this.playing.get(id);
      if(event.endedAt!==undefined){
        if(existing){if(!existing.oneShot){this.player.stopHorn(id);this.playing.delete(id);}continue;}
        if(this.seen.has(id)||serverNow-event.endedAt>2000)continue;
        const duration=Math.max(HORN_LIMITS.minimumMs,Math.min(700,event.endedAt-event.startedAt));
        this.player.startHorn(id,event.gain);this.playing.set(id,{until:now+duration,oneShot:true,nativeAt:now,gain:event.gain});this.seen.set(id,now);
      }else if(event.activeUntil>serverNow){
        // A still-held voice may become audible again after leaving the
        // proximity range or temporarily muting. Only completed pulses use
        // seen-ID suppression; the trusted active lease bounds this restart.
        const renew=!existing||now-existing.nativeAt>=1000||Math.abs(existing.gain-event.gain)>.02;
        if(renew)this.player.startHorn(id,event.gain);
        this.playing.set(id,{until:now+event.activeUntil-serverNow,oneShot:false,nativeAt:renew?now:existing!.nativeAt,gain:event.gain});this.seen.set(id,now);
      }
    }
    for(const[id,entry]of this.playing)if(entry.until<=now||!entry.oneShot&&!present.has(id)){this.player.stopHorn(id);this.playing.delete(id);}
    for(const[id,at]of this.seen)if(now-at>HORN_LIMITS.retentionMs+4000)this.seen.delete(id);
    while(this.seen.size>64)this.seen.delete(this.seen.keys().next().value!);
  }
  stop():void {for(const id of this.playing.keys())this.player.stopHorn(id);this.playing.clear();}
  reset():void {this.stop();this.seen.clear();}
}
