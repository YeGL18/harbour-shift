import type { PlayerMatchReview, ReviewTimelineEvent } from '../../shared/protocol';

export function comparisonPlayers(players:PlayerMatchReview[],primaryId:string,secondaryId:string,selfId:string) {
  const primary=players.find(player=>player.playerId===primaryId)??players.find(player=>player.playerId===selfId)??players[0];
  const secondary=players.find(player=>player.playerId===secondaryId&&player.playerId!==primary?.playerId)??players.find(player=>player.playerId!==primary?.playerId);
  return {primary,secondary};
}
/** Sampled actual positions only. No inferred roads, fares or missed requests. */
export function projectReviewRoutes(routes:Array<PlayerMatchReview['route']>,width:number,height:number):Array<Array<{x:number;y:number;minute:number}>> {
  const valid=routes.map(route=>route.filter(point=>Number.isFinite(point.lat)&&Math.abs(point.lat)<=90&&Number.isFinite(point.lon)&&Math.abs(point.lon)<=180));
  const points=valid.flat();if(!points.length)return routes.map(()=>[]);
  const cosine=Math.cos(points.reduce((sum,p)=>sum+p.lat,0)/points.length*Math.PI/180);
  const xs=points.map(p=>p.lon*cosine),ys=points.map(p=>p.lat),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.max((maxX-minX)/Math.max(1,width-24),(maxY-minY)/Math.max(1,height-24),.0000001);
  const insetX=(width-(maxX-minX)/scale)/2,insetY=(height-(maxY-minY)/scale)/2;
  return valid.map(route=>route.map(p=>({x:insetX+(p.lon*cosine-minX)/scale,y:height-insetY-(p.lat-minY)/scale,minute:p.minute})));
}
export function timelinePage(events:ReviewTimelineEvent[],page:number,size=8) {
  const pages=Math.max(1,Math.ceil(events.length/size)),index=Math.max(0,Math.min(pages-1,Math.trunc(page)));
  return {index,pages,events:events.slice(index*size,(index+1)*size),start:events.length?index*size+1:0,end:Math.min(events.length,(index+1)*size)};
}
export function reviewTimelineTitle(type:ReviewTimelineEvent['type']):string {
  const labels:Record<ReviewTimelineEvent['type'],string>={accept:'接受訂單',decline:'略過及過期',cancel:'取消行程','cancel-queued':'取消下一單',branch:'選擇路口方向','cruise-to':'設定巡遊方向',route:'選擇行程路線',event:'處理道路狀況',accepting:'更改接單設定','auto-accept':'更改自動接單',park:'臨時停車',rest:'停車休息',drive:'繼續行車',service:'開始能源補給','cancel-charge':'停止充電',airport:'處理機場輪候','elite-booking':'處理尊尚預約','pro-destination':'更改目的地方向',station:'前往補給站',handover:'前往交更','cancel-handover':'取消交更導航','recover-energy':'呼叫能源救援','trip-completed':'完成行程','queue-joined':'加入補給隊列','service-started':'開始能源補給','shift-ended':'本更結束'};
  return labels[type]??'行車紀錄';
}
