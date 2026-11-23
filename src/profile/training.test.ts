import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySoloLedger,recordSoloSession,readSoloLedger,soloReviewStatus,applySoloTrainingReset} from './ledger';
import {RESET_COURSE_VERSION,RESET_QUESTIONS} from '../../shared/trainingCourse';
const answers=RESET_QUESTIONS.map(question=>question.correct),submission={assessmentId:'local-assessment-1',courseVersion:RESET_COURSE_VERSION,answers};
test('local training preserves lifetime and old-save high-water receipts, starts zero-sample period and retries exactly once',()=>{
  const before=recordSoloSession(emptySoloLedger(),'old-session',{offered:20,accepted:12,cancelled:3,completedTrips:9});
  const reset=applySoloTrainingReset(before,submission,1000);assert.deepEqual(reset.totals,before.totals);assert.deepEqual(reset.sessions,before.sessions);
  const view=soloReviewStatus(reset);assert.equal(view.activePeriod.acceptanceRate,null);assert.equal(view.activePeriod.cancellationRate,null);assert.equal(view.history[0].acceptanceRate,.6);assert.equal(view.history[0].cancellationRate,.25);
  let after=recordSoloSession(reset,'new-session',{offered:5,accepted:3,cancelled:1,completedTrips:2});
  assert.equal(soloReviewStatus(after).activePeriod.counts.accepted,3);assert.equal(applySoloTrainingReset(after,submission,2000),after);
  after=readSoloLedger(JSON.parse(JSON.stringify(after)));assert.equal(soloReviewStatus(after).activePeriod.counts.accepted,3);
  assert.equal(recordSoloSession(after,'old-session',{offered:10,accepted:5,cancelled:1,completedTrips:4}),after);
  const twice=applySoloTrainingReset(after,{...submission,assessmentId:'local-assessment-2'},3000);assert.equal(soloReviewStatus(twice).history.length,2);assert.deepEqual(twice.totals,after.totals);
});
test('invalid or failed offline answers cannot open a period and old ledgers remain compatible',()=>{
  const before=emptySoloLedger();assert.deepEqual(readSoloLedger(before),before);
  assert.throws(()=>applySoloTrainingReset(before,{...submission,answers:Array(10).fill(-1)},1000));
  assert.throws(()=>applySoloTrainingReset(before,{...submission,answers:answers.map(answer=>(answer+1)%3)},1000));
  assert.equal(before.reviewPeriods,undefined);
});
test('a malformed optional review record cannot discard previously persisted lifetime or session receipts',()=>{
  const before=recordSoloSession(emptySoloLedger(),'historic-session',{offered:30,accepted:12,cancelled:2,completedTrips:9});
  const restored=readSoloLedger({...before,reviewPeriods:[null,{periodId:'broken'},7]});
  assert.deepEqual(restored.totals,before.totals);assert.deepEqual(restored.sessions,before.sessions);assert.equal(soloReviewStatus(restored).activePeriod.counts.offered,30);
});
