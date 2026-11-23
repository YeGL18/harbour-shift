import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROOM_SPEEDS, type RoomSnapshot, type RoomSpeed } from '../../shared/protocol';
import { offerDeadlineFromSnapshot } from './offerClock';

const frame=(speed:RoomSpeed,age:number):RoomSnapshot&{stateSampledAt?:number}=>({
  serverTime:100_000+age,stateSampledAt:100_000,room:{speed},
  ownState:{clockMinutes:12,currentOffer:{expiresAt:12+speed*5/60}},
} as RoomSnapshot&{stateSampledAt?:number});

test('cached frames consume their age rather than restarting the five-second offer window',()=>{
  for(const speed of ROOM_SPEEDS){
    assert.ok(Math.abs(offerDeadlineFromSnapshot(frame(speed,750),200_000)!-204_250)<.001);
    assert.equal(offerDeadlineFromSnapshot(frame(speed,6000),200_000),200_000);
  }
});
test('fresh action acknowledgements and legacy unsampled frames preserve the window',()=>{
  const value=frame(30,0);delete value.stateSampledAt;
  assert.equal(offerDeadlineFromSnapshot(value,200_000),205_000);
  assert.equal(offerDeadlineFromSnapshot({...value,ownState:null},200_000),null);
});
