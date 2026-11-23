import test from 'node:test';
import assert from 'node:assert/strict';
import { newShiftDurationPreference,newRoomSpeed,nextGameSpeed,estimatedRealMinutes,competitionModeLabel } from './shiftPresentation';
import { shiftTimeRange } from '../multiplayer/time';

test('new setup defaults to half/60 while explicit old preferences retain full/30',()=>{
  assert.equal(newShiftDurationPreference(undefined),360);assert.equal(newRoomSpeed(undefined),60);
  assert.equal(newShiftDurationPreference(720),720);assert.equal(newRoomSpeed(30),30);assert.equal(newRoomSpeed(10),10);
});
test('1× survives preference hydration and is reachable from the driving speed cycle',()=>{
  assert.equal(newRoomSpeed(1),1);
  assert.equal(newRoomSpeed('1'),60);
  assert.deepEqual([60,1,10,30].map(speed=>nextGameSpeed(newRoomSpeed(speed))),[1,10,30,60]);
  for(const minutes of [360,720,1440] as const)assert.equal(estimatedRealMinutes(minutes,1),minutes);
});
test('displayed estimated minutes and handover clock describe the selected duration',()=>{
  assert.equal(estimatedRealMinutes(360,60),6);assert.equal(estimatedRealMinutes(720,60),12);
  assert.equal(estimatedRealMinutes(360,30),12);assert.equal(estimatedRealMinutes(720,30),24);
  assert.equal(estimatedRealMinutes(1440,60),24);assert.equal(estimatedRealMinutes(1440,30),48);
  assert.equal(newShiftDurationPreference(1440),1440);
  assert.deepEqual(shiftTimeRange(1020,360),{start:'17:00',finish:'23:00',nextDay:false});
  assert.deepEqual(shiftTimeRange(1020,720),{start:'17:00',finish:'05:00',nextDay:true});
  assert.deepEqual(shiftTimeRange(300,1440),{start:'05:00',finish:'05:00',nextDay:true});
});
test('team mode has its own presentation rather than falling through to lowest-income mode',()=>{
  assert.equal(competitionModeLabel('team-net'),'2v2 隊伍淨收入');assert.equal(competitionModeLabel('lowest-net'),'最低淨收入勝出');
});
