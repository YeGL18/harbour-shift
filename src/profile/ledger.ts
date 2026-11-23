import {gradeResetAnswers} from '../../shared/trainingCourse';
import {reviewCounts,reviewPeriod,type ReviewBaseline,type SoloTrainingSubmission} from '../../shared/training';
/** On-device solo history. It is never submitted as multiplayer reputation. */
export interface DriverCounts { offered: number; accepted: number; cancelled: number; completedTrips: number }
export interface SoloLedger { version: 1; totals: DriverCounts; sessions: Record<string, DriverCounts>; reviewPeriods?:ReviewBaseline[] }
export const emptyCounts = (): DriverCounts => ({ offered: 0, accepted: 0, cancelled: 0, completedTrips: 0 });
export const emptySoloLedger = (): SoloLedger => ({ version: 1, totals: emptyCounts(), sessions: {} });
const keys = ['offered', 'accepted', 'cancelled', 'completedTrips'] as const;
function counts(value: unknown): DriverCounts {
  const input = value && typeof value === 'object' ? value as Partial<DriverCounts> : {};
  const result = emptyCounts();
  for (const key of keys) result[key] = typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key]! >= 0 ? input[key]! : 0;
  return result;
}
export function readSoloLedger(value: unknown): SoloLedger {
  if (!value || typeof value !== 'object' || (value as SoloLedger).version !== 1) return emptySoloLedger();
  const input = value as SoloLedger;
  const sessions = Object.fromEntries(Object.entries(input.sessions ?? {}).filter(([key]) => key.length > 0 && key.length <= 160).map(([key, entry]) => [key, counts(entry)]));
  const reviewPeriods=Array.isArray(input.reviewPeriods)?input.reviewPeriods.filter(period=>period&&typeof period==='object'&&typeof period.periodId==='string'&&period.periodId.length>0&&period.periodId.length<=160&&Number.isSafeInteger(period.startedAt)&&period.startedAt>0).map(period=>({periodId:period.periodId,startedAt:period.startedAt,counters:counts(period.counters)})):undefined;
  return { version: 1, totals: counts(input.totals), sessions,...(reviewPeriods?{reviewPeriods}:{}) };
}
/** Monotone high-water marks prevent snapshots, reconnects and autosaves counting twice. */
export function recordSoloSession(ledger: SoloLedger, sessionId: string, snapshot: DriverCounts): SoloLedger {
  if (!sessionId || sessionId.length > 160) return ledger;
  const previous = ledger.sessions[sessionId] ?? emptyCounts(), next = counts(snapshot), totals = { ...ledger.totals };
  let changed = false;
  for (const key of keys) { next[key] = Math.max(previous[key], next[key]); const delta = next[key] - previous[key]; if (delta) { totals[key] += delta; changed = true; } }
  if (!changed && ledger.sessions[sessionId]) return ledger;
  // Keep receipts: old saves can be restored much later and must not recount.
  return { ...ledger,version: 1, totals, sessions: { ...ledger.sessions, [sessionId]: next } };
}
export function soloReviewStatus(ledger:SoloLedger){
  const periods=ledger.reviewPeriods||[],latest=periods.at(-1),baseline=latest?.counters;
  const history=[{periodId:'lifetime',startedAt:0,counters:emptyCounts()},...periods].slice(0,-1).map((period,index)=>reviewPeriod(period.periodId,period.startedAt,reviewCounts(periods[index].counters,period.counters),periods[index].startedAt));
  return{activePeriod:reviewPeriod(latest?.periodId||'lifetime',latest?.startedAt||0,reviewCounts(ledger.totals,baseline)),history};
}
export function applySoloTrainingReset(ledger:SoloLedger,submission:SoloTrainingSubmission,now:number):SoloLedger {
  if(typeof submission.assessmentId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(submission.assessmentId)||!Number.isSafeInteger(now)||now<=0)throw new Error('invalid_training_answers');
  if(ledger.reviewPeriods?.some(period=>period.periodId===submission.assessmentId))return ledger;
  if(!gradeResetAnswers(submission.courseVersion,submission.answers).passed)throw new Error('training_not_passed');
  return{...ledger,reviewPeriods:[...(ledger.reviewPeriods||[]),{periodId:submission.assessmentId,startedAt:now,counters:{...ledger.totals}}]};
}
export function combineDriverCounts(solo: DriverCounts, verified?: DriverCounts | null) {
  const result = emptyCounts(); for (const key of keys) result[key] = solo[key] + (verified?.[key] ?? 0);
  return { ...result, acceptanceRate: result.offered ? result.accepted / result.offered : 0, cancellationRate: result.accepted ? result.cancelled / result.accepted : 0 };
}
