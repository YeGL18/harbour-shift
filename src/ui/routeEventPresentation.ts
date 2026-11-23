import type {GameState,RouteEvent} from '../game/types';

type RouteDisplayState=Pick<GameState,'phase'|'parking'|'energyRecovery'|'navigation'|'movement'|'clockMinutes'>;
/** Queuing/servicing is not road driving, even if the last road event is retained. */
export function showsDrivingTraffic(state:RouteDisplayState):boolean {
  return ['cruising','pickup','dropoff','service-route','safe-dropoff'].includes(state.phase)
    && !state.parking && !state.energyRecovery && state.navigation?.stage!=='servicing';
}
/** A passed or bypassed event must not return when service finishes. */
export function showsRouteEvent(state:RouteDisplayState,event:RouteEvent|null):boolean {
  if(!event||!showsDrivingTraffic(state)||event.expiresAt<=state.clockMinutes)return false;
  if(event.resolved&&(event.choice!=='stay'||event.blockingUntil===undefined))return false;
  if(event.blockingUntil!==undefined&&event.blockingUntil<=state.clockMinutes)return false;
  return event.affectedEdgeId===state.movement.edgeId||state.movement.nextEdgeIds.includes(event.affectedEdgeId);
}
