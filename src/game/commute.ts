import type { Landmark } from './types';

type CommutePlace = Pick<Landmark, 'kind'>;
const smooth = (value:number) => {const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};

/** Absolute local game-clock minute, not elapsed shift time or device wall time.
 * Broad all-mode commute evidence informs this game curve; it is not an estate
 * demographic model or a measured taxi/app OD probability. */
export function commuteIntensity(absoluteMinute:number):number {
  if(!Number.isFinite(absoluteMinute))return 0;
  const minute=((absoluteMinute%1440)+1440)%1440;
  if(minute<=390||minute>=630)return 0;
  if(minute<480)return smooth((minute-390)/90);
  if(minute<=540)return 1;
  return 1-smooth((minute-540)/90);
}

/** Relative sampling weights only. Other legal destinations keep positive
 * probability. Transport feeders are a smaller possibility, never a claim
 * that an observed taxi trip involved interchange. */
export function commuteDestinationWeight(pickup:CommutePlace,destination:CommutePlace,absoluteMinute:number):number {
  if(pickup.kind!=='residential')return 1;
  const intensity=commuteIntensity(absoluteMinute);
  return 1+intensity*(destination.kind==='business'?1.2:destination.kind==='transport'?.3:0);
}
