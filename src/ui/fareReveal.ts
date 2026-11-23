import type { FareReveal } from '../../shared/protocol';
export interface VisibleFareReveal { reveal:FareReveal; expiresAt:number }
/** Prefer the latest actual completion. Mark the whole received batch so old
 * receipts cannot produce a backlog after reconnecting. */
export function selectFareReveal(reveals:readonly FareReveal[],seen:Set<string>,now:number):VisibleFareReveal|null {
  const fresh=reveals.filter(reveal=>!seen.has(reveal.id)&&Number.isFinite(reveal.amount)&&reveal.amount>=0);
  for(const reveal of reveals)seen.add(reveal.id);
  while(seen.size>256)seen.delete(seen.values().next().value!);
  const reveal=fresh.sort((a,b)=>b.minute-a.minute||b.id.localeCompare(a.id))[0];
  return reveal?{reveal,expiresAt:now+6000}:null;
}
