import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShiftStart,parseShiftTime,roomStartTime,shiftTimeRange,clockFields}from './time';
test('new shared shifts default to 05:00/17:00 and all ranges stay twelve hours across midnight',()=>{
  assert.equal(defaultShiftStart('day'),300);assert.equal(defaultShiftStart('night'),1020);
  assert.deepEqual(shiftTimeRange(300),{start:'05:00',finish:'17:00',nextDay:false});
  assert.deepEqual(shiftTimeRange(1020),{start:'17:00',finish:'05:00',nextDay:true});
  assert.deepEqual(shiftTimeRange(455),{start:'07:35',finish:'19:35',nextDay:false});
  assert.deepEqual(shiftTimeRange(1439),{start:'23:59',finish:'11:59',nextDay:true});
});
test('clock input accepts midnight and one-digit components but rejects invalid ranges and partial input',()=>{
  assert.equal(parseShiftTime('00','00'),0);assert.equal(parseShiftTime('7','5'),425);
  for(const [hour,minute]of [['24','00'],['23','60'],['-1','20'],['7.5','00'],['','00'],['05',''],['005','00']])assert.equal(parseShiftTime(hour,minute),undefined);
  assert.deepEqual(clockFields(455),{hour:'07',minute:'35'});
});
test('half shifts finish after six hours, including a midnight crossing',()=>{
  assert.deepEqual(shiftTimeRange(300,360),{start:'05:00',finish:'11:00',nextDay:false});
  assert.deepEqual(shiftTimeRange(1260,360),{start:'21:00',finish:'03:00',nextDay:true});
});
test('room display takes the authoritative common time rather than an individual garage preference',()=>{
  assert.equal(roomStartTime({shift:'night',startTimeMinutes:455}),455);
  assert.equal(roomStartTime({shift:'day',startTimeMinutes:0}),0);
  assert.equal(roomStartTime({shift:'day'}),300);
  assert.equal(roomStartTime({shift:'night'}),1020);
  assert.equal(roomStartTime({shift:'day',startTimeMinutes:1440}),300);
});
