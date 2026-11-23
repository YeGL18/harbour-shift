import type { RoomSnapshot } from '../../shared/protocol';

/** Cached frames retain their real sample time; they do not grant extra time. */
export function offerDeadlineFromSnapshot(snapshot: RoomSnapshot & {stateSampledAt?:number}, receivedAt:number):number|null {
  const state=snapshot.ownState,offer=state?.currentOffer;
  if(!state||!offer)return null;
  const sampleAge=Math.max(0,snapshot.serverTime-(snapshot.stateSampledAt??snapshot.serverTime));
  const remaining=(offer.expiresAt-state.clockMinutes)*60_000/snapshot.room.speed;
  return receivedAt+Math.max(0,remaining-sampleAge);
}
