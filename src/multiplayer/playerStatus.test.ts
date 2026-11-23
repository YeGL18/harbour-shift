import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomPlayer } from '../../shared/protocol';
import { roomPlayerStatus } from './playerStatus';
const player:RoomPlayer={id:'a',nickname:'甲',connected:true,ready:false,status:'driving',joinedAt:0,vehicleId:'private'};
test('room driving status includes actual alighting phase and gives disconnection/forfeit precedence',()=>{
  const alighting={...player,order:{pickupName:'海港城',destinationName:'MegaBox',phase:'alighting' as const}};
  assert.equal(roomPlayerStatus(alighting),'乘客落車中');
  assert.equal(roomPlayerStatus({...alighting,connected:false}),'暫時斷線');
  assert.equal(roomPlayerStatus({...alighting,forfeited:true}),'失去資格');
  assert.equal(roomPlayerStatus({...alighting,status:'finished'}),'已交更');
  assert.equal(roomPlayerStatus({...player,phase:'fuel-queue'}),'排隊輪候補給');
});
