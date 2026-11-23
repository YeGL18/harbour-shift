import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomAuthority} from './authority';

test('blind rooms require a supported redacted client and cannot be enabled by a player',async()=>{
  const authority=new RoomAuthority({blindOrders:true});
  await assert.rejects(()=>authority.createRoom({nickname:'Old',featureVersion:'0.6'}),(error:any)=>error.code==='room_version');
  const host=await authority.createRoom({nickname:'Host',featureVersion:'0.6',blindOrdersVersion:1});
  assert.deepEqual(host.snapshot.room.orderVisibility,{blindOrders:true});
  await assert.rejects(()=>authority.joinRoom(host.roomCode,{nickname:'Old',featureVersion:'0.6'}),(error:any)=>error.code==='room_version');
  const normal=new RoomAuthority();await assert.rejects(()=>normal.createRoom({nickname:'Forged',orderVisibility:{blindOrders:true}}as any),(error:any)=>error.code==='unexpected_field');
  assert.equal((await normal.createRoom({nickname:'Normal'})).snapshot.room.orderVisibility,undefined);
});
test('operator policy remains authoritative through loading, cached publication and cold metadata/shard restore',async()=>{
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now,blindOrders:true});
  const host=await authority.createRoom({nickname:'Host',featureVersion:'0.6',blindOrdersVersion:1});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:'0.6',blindOrdersVersion:1});
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:1,action:{type:'ready',ready:true}});await authority.handleCommand(host.roomCode,guest.resumeToken,{seq:1,action:{type:'ready',ready:true}});
  let snapshot=await authority.handleCommand(host.roomCode,host.resumeToken,{seq:2,action:{type:'start'}});
  assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.orderVisibility?.blindOrders,true);assert.equal(snapshot.room.clockMinutes,0);
  const restored=new RoomAuthority({now:()=>now,blindOrders:false});restored.deserializeRoomMetadata(authority.serializeRoomMetadata(host.roomCode)!);
  for(const id of authority.getPlayerIds(host.roomCode))restored.deserializePlayerState(host.roomCode,id,authority.serializePlayerState(host.roomCode,id)!);
  snapshot=await restored.readSnapshot(host.roomCode,host.resumeToken);assert.equal(snapshot.orderVisibility?.blindOrders,true);assert.equal(restored.publishedSnapshot(host.roomCode).orderVisibility?.blindOrders,true);
  const epoch=snapshot.room.loading!.epoch;await restored.handleCommand(host.roomCode,host.resumeToken,{seq:3,action:{type:'map-ready',epoch,ready:true}});await restored.handleCommand(host.roomCode,guest.resumeToken,{seq:2,action:{type:'map-ready',epoch,ready:true}});now+=3000;snapshot=await restored.readSnapshot(host.roomCode,host.resumeToken);
  assert.equal(snapshot.room.status,'running');assert.equal(snapshot.orderVisibility?.blindOrders,true);
  assert.equal((await restored.createRoom({nickname:'New normal',featureVersion:'0.6'})).snapshot.orderVisibility,undefined,'later operator setting only affects later rooms');
});
