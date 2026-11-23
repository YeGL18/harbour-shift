import {reviewCounts} from '../shared/training';
import type {DriverCounters,DriverStats} from '../shared/protocol';
export const ZERO_COUNTERS:DriverCounters={offered:0,accepted:0,cancelled:0,completedTrips:0};
export function driverStats(counters:DriverCounters=ZERO_COUNTERS,updatedAt=0):DriverStats{return{...counters,acceptanceRate:counters.offered?Math.min(1,counters.accepted/counters.offered):1,cancellationRate:counters.accepted?Math.min(1,counters.cancelled/counters.accepted):0,updatedAt};}
/** New drivers are neutral; established records change odds mildly, never eligibility. */
export function dispatchHistoryWeight(input?:(DriverCounters&Pick<DriverStats,'reviewBaseline'>)):number {const stats=input?.reviewBaseline?reviewCounts(input,input.reviewBaseline.counters):input;if(!stats||stats.offered<20)return 1;const acceptance=(stats.accepted+12)/(stats.offered+20),cancellation=stats.accepted>=10?(stats.cancelled+1)/(stats.accepted+10):.05;return Math.max(.75,Math.min(1.2,1+(acceptance-.6)*.4-cancellation*.45));}
