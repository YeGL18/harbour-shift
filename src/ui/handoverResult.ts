import type { GameState } from '../game/types';
export function handoverResultLabel(game:Pick<GameState,'handoverStatus'|'handoverFailureReason'|'shiftEndReason'>):string {
  if(game.shiftEndReason==='fuel-completed-late')return '已完成補給，遲到交更';
  if(game.shiftEndReason==='fuel-cancelled-late')return '已取消補給，逾時收更';
  if(game.shiftEndReason==='fuel-timeout')return '補給逾時，未完成交更';
  if(game.handoverStatus==='missed')return game.handoverFailureReason==='fuel'?'未完成交更前補給':'未能準時返回交更點';
  return game.handoverStatus==='on-time'?'已準時交更':'已收更';
}
