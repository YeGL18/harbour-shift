import { MULTIPLAYER_LIMITS, type Room } from '../../shared/protocol';

/** Presentation only; the server remains the authority for starting a room. */
export function getRoomReadiness(room:Room,selfId:string,{timeChanged=false,draftValid=true}:{timeChanged?:boolean;draftValid?:boolean}={}) {
  const participants=room.players.filter(player=>player.status!=='left'&&!player.forfeited);
  const readyCount=participants.filter(player=>player.ready&&player.connected).length;
  const teamCounts={A:participants.filter(player=>player.teamId==='A').length,B:participants.filter(player=>player.teamId==='B').length};
  const teamReady=room.mode!=='team-net'||participants.length===4&&teamCounts.A===2&&teamCounts.B===2;
  return {participants,readyCount,teamCounts,teamReady,canStart:room.hostPlayerId===selfId&&room.status==='lobby'&&!timeChanged&&draftValid&&participants.length>=MULTIPLAYER_LIMITS.minPlayers&&teamReady&&readyCount===participants.length};
}
