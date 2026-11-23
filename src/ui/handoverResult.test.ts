import assert from 'node:assert/strict';
import test from 'node:test';
import { handoverResultLabel } from './handoverResult';

test('a completed late refill has a late marker instead of the old unprepared-fuel result',()=>{
  assert.equal(handoverResultLabel({handoverStatus:'missed',handoverFailureReason:'deadline',shiftEndReason:'fuel-completed-late'}),'已完成補給，遲到交更');
  assert.equal(handoverResultLabel({handoverStatus:'missed',handoverFailureReason:'fuel'}),'未完成交更前補給');
  assert.equal(handoverResultLabel({handoverStatus:'on-time'}),'已準時交更');
});

test('voluntary queue exit and bounded timeout are distinguished from completed fuel',()=>{
  assert.equal(handoverResultLabel({shiftEndReason:'fuel-cancelled-late'}),'已取消補給，逾時收更');
  assert.equal(handoverResultLabel({shiftEndReason:'fuel-timeout'}),'補給逾時，未完成交更');
});
