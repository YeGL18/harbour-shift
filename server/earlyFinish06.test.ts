import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import type {RoomAction,RoomSession} from '../shared/protocol';

async function fixture(version:'0.5'|'0.6'='0.6') {
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const setup={vehicleId:'kam-fung' as const,startPlaceId:'harbour-city',handoverPlaceId:'harbour-city',autoAcceptOrders:false};
  const host=await authority.createRoom({nickname:'Host',featureVersion:version,rules:{speed:60,density:'busy'},setup});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:version,setup:{...setup,rentalOverride:321.5}});
  const sessions=[host,guest],seq=new Map<string,number>();
  const send=async(player:RoomSession,action:RoomAction)=>{const next=(seq.get(player.playerId)||0)+1;const snapshot=await authority.handleCommand(host.roomCode,player.resumeToken,{seq:next,action});seq.set(player.playerId,next);return snapshot;};
  const add=(ms:number,keepAlive=true)=>{now+=ms;if(keepAlive)authority.applyPresence(host.roomCode,sessions.map(player=>({playerId:player.playerId,lastSeen:now,forfeitedAt:null})),now);};
  const read=(player=host)=>authority.readSnapshot(host.roomCode,player.resumeToken);
  for(const player of sessions)await send(player,{type:'ready',ready:true});const started=await send(host,{type:'start'});
  if(started.room.loading)for(const player of sessions)await send(player,{type:'map-ready',epoch:started.room.loading.epoch,ready:true});
  add(3000);await read();
  return{authority,host,guest,sessions,send,add,read,seq,now:()=>now};
}

test('two normal early handover actions settle a 0.6 half shift immediately with actual unchanged costs and review',async()=>{
  const match=await fixture();const initial=await Promise.all(match.sessions.map(match.read));assert.ok(initial.every(value=>value.ownState!.energy.remaining===value.ownState!.energy.capacity));
  let snapshot=await match.send(match.host,{type:'handover'});assert.equal(snapshot.ownState!.phase,'ended');assert.equal(snapshot.room.status,'running','One driver still driving keeps the match active');assert.equal(snapshot.review,undefined);
  snapshot=await match.send(match.guest,{type:'handover'});assert.equal(snapshot.ownState!.phase,'ended');assert.equal(snapshot.room.status,'finished');assert.equal(snapshot.room.clockMinutes,0);assert.equal(snapshot.review!.finalClockMinutes,0);assert.equal(snapshot.review!.shiftDurationMinutes,360);
  for(const [index,session]of match.sessions.entries()){const player=snapshot.review!.players.find(player=>player.playerId===session.playerId)!;assert.equal(player.grossIncome,0);assert.equal(player.operatingCost,0);assert.equal(player.rentalCost,initial[index].ownState!.rentalCostApplied);assert.equal(player.netIncome,-player.rentalCost);assert.equal(player.acceptedOffers,0);assert.equal(player.completedTrips,0);assert.equal(player.route.length,1);assert.equal(player.route[0].minute,0);assert.equal(player.forfeited,false);assert.ok(player.timeline.some(event=>event.type==='handover'));}
  const before=JSON.stringify(snapshot.review),restored=new RoomAuthority({now:match.now});restored.deserializeRoom(match.authority.serializeRoom(match.host.roomCode)!);const durable=await restored.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(JSON.stringify(durable.review),before);assert.equal(durable.room.clockMinutes,0);
  const retry=await restored.handleCommand(match.host.roomCode,match.guest.resumeToken,{seq:match.seq.get(match.guest.playerId)!,action:{type:'handover'}});assert.equal(JSON.stringify(retry.review),before);assert.equal(retry.ownState!.netIncome,snapshot.ownState!.netIncome);
});

test('one ended and one driving remains live; a delayed poll freezes completion at actual route time, not its wall target',async()=>{
  const match=await fixture();await match.send(match.host,{type:'handover'});match.add(2000);let snapshot=await match.read(match.guest);assert.equal(snapshot.room.status,'running');assert.equal(snapshot.room.clockMinutes,2);assert.equal(snapshot.review,undefined);const initialRental=snapshot.ownState!.rentalCostApplied;
  snapshot=await match.send(match.guest,{type:'handover'});assert.ok(['service-route','ended'].includes(snapshot.ownState!.phase));match.add(30000);snapshot=await match.read(match.guest);assert.equal(snapshot.room.status,'finished');assert.ok(snapshot.room.clockMinutes<32&&snapshot.room.clockMinutes>=2);assert.equal(snapshot.room.clockMinutes,snapshot.ownState!.clockMinutes);
  const review=snapshot.review!,guest=review.players.find(player=>player.playerId===match.guest.playerId)!,host=review.players.find(player=>player.playerId===match.host.playerId)!;assert.equal(review.finalClockMinutes,snapshot.ownState!.clockMinutes);assert.equal(guest.route.at(-1)!.minute,snapshot.ownState!.clockMinutes);assert.equal(guest.rentalCost,initialRental);assert.equal(guest.grossIncome,0);assert.equal(guest.netIncome,snapshot.ownState!.netIncome);assert.equal(guest.operatingCost,snapshot.ownState!.operatingCost);assert.equal(host.idleMinutes,0);assert.equal(host.totalDistanceM,0);assert.equal(host.route.at(-1)!.minute,0);assert.ok(review.players.every(player=>!player.forfeited));
});

test('a finished remaining driver can settle after another driver leaves, but an empty or all-forfeit roster cannot finish early',async()=>{
  const mixed=await fixture();await mixed.send(mixed.host,{type:'handover'});mixed.add(2000);let snapshot=await mixed.send(mixed.guest,{type:'leave'});assert.equal(snapshot.room.status,'finished');assert.equal(snapshot.room.clockMinutes,2);assert.equal(snapshot.leaderboard.find(player=>player.playerId===mixed.host.playerId)!.rank,1);assert.equal(snapshot.leaderboard.find(player=>player.playerId===mixed.guest.playerId)!.rank,null);assert.equal(snapshot.review!.players.find(player=>player.playerId===mixed.guest.playerId)!.forfeited,true);
  const empty=await fixture();await empty.send(empty.host,{type:'leave'});snapshot=await empty.send(empty.guest,{type:'leave'});assert.equal(snapshot.room.status,'running');assert.equal(snapshot.review,undefined);assert.ok(snapshot.room.players.every(player=>player.forfeited));
  const disconnected=await fixture();disconnected.add(136000,false);snapshot=await disconnected.read();assert.equal(snapshot.room.status,'running');assert.equal(snapshot.review,undefined);assert.ok(snapshot.room.players.every(player=>player.forfeited));
});

test('0.5 keeps its original full-shift room deadline after both drivers hand over early',async()=>{
  const match=await fixture('0.5');await match.send(match.host,{type:'handover'});let snapshot=await match.send(match.guest,{type:'handover'});assert.ok(snapshot.room.players.every(player=>player.phase==='ended'));assert.equal(snapshot.room.status,'running');assert.equal(snapshot.room.shiftDurationMinutes,720);assert.equal(snapshot.review,undefined);match.add(1000);snapshot=await match.read();assert.equal(snapshot.room.status,'running');assert.equal(snapshot.room.clockMinutes,1);
});
