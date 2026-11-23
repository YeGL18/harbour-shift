import type { RoomPlayer } from '../../shared/protocol';
/** Status is derived from the server snapshot; there is no local driving simulation. */
export function roomPlayerStatus(player:RoomPlayer,lobby=false):string {
  if(player.forfeited)return '失去資格';
  if(!player.connected)return '暫時斷線';
  if(player.status==='finished')return player.late?'遲到交更':'已交更';
  if(player.status==='left')return '已離開';
  if(lobby)return player.ready?'已準備':'未準備';
  const phase=player.phase??player.order?.phase;
  return phase?({pickup:'前往上客',waiting:'等緊乘客',boarding:'乘客上車',alighting:'乘客落車中',dropoff:'送客途中','safe-dropoff':'安排落客','service-route':'前往補給／交更','fuel-queue':'排隊輪候補給','airport-queue':'機場輪候中',servicing:'補給中',cruising:'巡遊中',ended:'已收更'} as Record<string,string>)[phase]??'行車中':'巡遊中';
}
