import type {DriverCounters} from './protocol';
export const TRAINING_API={status:'/v1/drivers/training',start:'/v1/drivers/training/attempts',submit:'/v1/drivers/training/submit',confirm:'/v1/drivers/training/confirm'} as const;
export interface ReviewBaseline {periodId:string;startedAt:number;counters:DriverCounters}
export interface ReviewPeriod {periodId:string;startedAt:number;endedAt?:number;counts:DriverCounters;acceptanceRate:number|null;cancellationRate:number|null}
export interface TrainingStatus {courseVersion:string;activePeriod:ReviewPeriod;lifetime:DriverCounters;history:ReviewPeriod[];canReset:boolean}
export interface TrainingAttempt {assessmentId:string;courseVersion:string;createdAt:number;submittedAt?:number;score?:number;passed?:boolean;correct?:boolean[]}
export interface TrainingConfirmation {appliedPeriodId:string;alreadyApplied:boolean;status:TrainingStatus}
export interface SoloTrainingSubmission {assessmentId:string;courseVersion:string;answers:number[]}
export function reviewCounts(lifetime:DriverCounters,baseline?:DriverCounters):DriverCounters {
  return{offered:Math.max(0,lifetime.offered-(baseline?.offered||0)),accepted:Math.max(0,lifetime.accepted-(baseline?.accepted||0)),cancelled:Math.max(0,lifetime.cancelled-(baseline?.cancelled||0)),completedTrips:Math.max(0,lifetime.completedTrips-(baseline?.completedTrips||0))};
}
export function reviewPeriod(periodId:string,startedAt:number,counts:DriverCounters,endedAt?:number):ReviewPeriod {
  return{periodId,startedAt,counts,acceptanceRate:counts.offered?Math.min(1,counts.accepted/counts.offered):null,cancellationRate:counts.accepted?Math.min(1,counts.cancelled/counts.accepted):null,...(endedAt===undefined?{}:{endedAt})};
}
