import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import {acquireActionLease} from './cloudflare/actionLease';
import {driverStats} from './driverStats';
import {decodeState} from './codec';
import {createInitialState,setDispatchOffer} from '../src/game';
import type {GameState} from '../src/game/types';

async function room(){
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Host',featureVersion:'0.5',rules:{speed:60,density:'busy'}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:'0.5'});
  authority.attachDriver(host.roomCode,host.playerId,{driverId:'ingress-driver',stats:driverStats({offered:0,accepted:0,cancelled:0,completedTrips:0},now)});
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:1,action:{type:'ready',ready:true}});
  await authority.handleCommand(guest.roomCode,guest.resumeToken,{seq:1,action:{type:'ready',ready:true}});
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:2,action:{type:'start'}});
  now+=3000;await authority.readSnapshot(host.roomCode,host.resumeToken);
  const offer={...createInitialState({seed:20261118}).currentOffer!,id:'ingress-request',createdAt:0,requestedAt:0,expiresAt:5};
  const state=decodeState(authority.serializePlayerState(host.roomCode,host.playerId)!)as GameState;
  authority.deserializePlayerState(host.roomCode,host.playerId,JSON.stringify(setDispatchOffer(setDispatchOffer(state,null),offer)));
  const stored=JSON.parse(authority.serializeRoom(host.roomCode)!);
  stored.metadata.dispatchState.assignments=[{offerId:offer.id,pickupName:offer.pickup.name,destinationName:offer.destination.name,playerId:host.playerId,nickname:'Host',assignedAt:0,expiresAt:5,status:'offered',competitors:2,declinedPlayerIds:[]}];
  authority.deserializeRoom(JSON.stringify(stored));authority.prepareDriverDeltas(host.roomCode);
  return{authority,host,guest,offer,now:()=>now,add:(milliseconds:number)=>{now+=milliseconds;}};
}

test('an authenticated accept received within five seconds survives its own publisher lease/hydration delay and credits once',async()=>{
  const m=await room();m.add(4500);const receivedAt=m.now();let attempts=0;
  // Deterministic mock I/O delay around the real lease helper and authority.
  const lease=await acquireActionLease(async()=>{m.add(200);return++attempts===3?{token:'exclusive-lease'}:null;},{now:m.now,sleep:async milliseconds=>{m.add(milliseconds);}});
  assert.ok(lease);m.add(1000);assert.equal(m.now()-receivedAt,1700);
  const snapshot=await m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'accept',offerId:m.offer.id}},{receivedAt});
  assert.equal(snapshot.ownState!.acceptedOffers,1);assert.equal(snapshot.ownState!.activeTrip!.offer.id,m.offer.id);
  assert.equal(snapshot.ownState!.activeTrip!.offer.expiresAt,5,'the original visible five-second deadline is never extended');
  assert.ok(Math.abs(snapshot.room.clockMinutes-6.2)<1e-8);assert.equal(snapshot.ownState!.clockMinutes,snapshot.room.clockMinutes);assert.equal(snapshot.stateSampledAt,m.now());
  const event=snapshot.room.competition!.assignments.find(entry=>entry.offerId===m.offer.id)!;assert.equal(event.status,'accepted');assert.equal(event.acceptedAt,m.now());
  const duplicate=await m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'accept',offerId:m.offer.id}},{receivedAt});
  assert.equal(duplicate.ownState!.acceptedOffers,1);assert.equal(duplicate.room.competition!.assignments.find(entry=>entry.offerId===m.offer.id)!.acceptedAt,event.acceptedAt);
  const delta=m.authority.prepareDriverDeltas(m.host.roomCode).find(entry=>entry.driverId==='ingress-driver')!;assert.equal(delta.counters.accepted,1);
  assert.ok(m.authority.prepareDriverDeltas(m.host.roomCode).every(entry=>Object.values(entry.counters).every(value=>value===0)));
  await assert.rejects(()=>m.authority.handleCommand(m.guest.roomCode,m.guest.resumeToken,{seq:2,action:{type:'accept',offerId:m.offer.id}},{receivedAt}),(error:any)=>error.code==='offer_expired'||error.code==='offer_taken');
});

test('ingress after expiry is rejected and its rejected action still catches the shared world up to processing time',async()=>{
  const m=await room();m.add(5100);const receivedAt=m.now();m.add(1200);
  await assert.rejects(()=>m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'accept',offerId:m.offer.id}},{receivedAt}),(error:any)=>error.code==='offer_expired');
  const snapshot=await m.authority.readSnapshot(m.host.roomCode,m.host.resumeToken);assert.equal(snapshot.ownState!.acceptedOffers,0);assert.ok(Math.abs(snapshot.room.clockMinutes-6.3)<1e-8);assert.equal(snapshot.you.lastInputSeq,2);
});

test('an earlier server ingress cannot rewind a later committed expiry/reassignment or steal its request',async()=>{
  const m=await room();m.add(4500);const receivedAt=m.now();m.add(1500);
  await m.authority.readSnapshot(m.host.roomCode,m.host.resumeToken);
  const state=decodeState(m.authority.serializePlayerState(m.host.roomCode,m.host.playerId)!)as GameState;
  const replacement={...m.offer,id:'replacement-after-commit',createdAt:6,requestedAt:6,expiresAt:11};
  m.authority.deserializePlayerState(m.host.roomCode,m.host.playerId,JSON.stringify(setDispatchOffer({...setDispatchOffer(state,null),demandCooldownUntil:0},replacement)));
  const stored=JSON.parse(m.authority.serializeRoom(m.host.roomCode)!);stored.metadata.claims.push([m.offer.id,m.guest.playerId]);
  stored.metadata.dispatchState.assignments.push({offerId:replacement.id,pickupName:replacement.pickup.name,destinationName:replacement.destination.name,playerId:m.host.playerId,nickname:'Host',assignedAt:6,expiresAt:11,status:'offered',competitors:1,declinedPlayerIds:[]});
  m.authority.deserializeRoom(JSON.stringify(stored));m.add(100);
  await assert.rejects(()=>m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'accept',offerId:m.offer.id}},{receivedAt}),(error:any)=>error.code==='offer_expired'||error.code==='offer_taken');
  const snapshot=await m.authority.readSnapshot(m.host.roomCode,m.host.resumeToken);assert.equal(snapshot.ownState!.acceptedOffers,0);assert.equal(snapshot.ownState!.currentOffer!.id,replacement.id);assert.ok(snapshot.room.clockMinutes>=6);
  assert.equal(JSON.parse(m.authority.serializeRoomMetadata(m.host.roomCode)!).claims.find(([id]:string[])=>id===m.offer.id)[1],m.guest.playerId);
  await assert.rejects(()=>m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,receivedAt,action:{type:'accept',offerId:replacement.id}}as any),(error:any)=>error.code==='unexpected_field');
});
