import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import {MULTIPLAYER_LIMITS as L,type RoomAction,type RoomSession} from '../shared/protocol';

async function fixture(version:'0.5'|'0.6'='0.6'){
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Host',featureVersion:version,rules:{speed:60,density:'busy'},setup:{vehicleId:'kam-fung',startPlaceId:'harbour-city',autoAcceptOrders:true}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:version});const sessions=[host,guest],sequences=new Map<string,number>();
  const send=async(player:RoomSession,action:RoomAction,timing?:{receivedAt:number})=>{const seq=(sequences.get(player.playerId)||0)+1;const snapshot=await authority.handleCommand(host.roomCode,player.resumeToken,{seq,action},timing);sequences.set(player.playerId,seq);return snapshot;};
  const add=(ms:number,heartbeat=true)=>{now+=ms;if(heartbeat)authority.applyPresence(host.roomCode,sessions.map(player=>({playerId:player.playerId,lastSeen:now,forfeitedAt:null})),now);};
  const start=async()=>{for(const player of sessions)await send(player,{type:'ready',ready:true});return send(host,{type:'start'});};
  const read=(player=host)=>authority.readSnapshot(host.roomCode,player.resumeToken);
  return{authority,host,guest,sessions,sequences,send,add,start,read,now:()=>now};
}

test('0.6 start exposes frozen map states with no offers, autoaccept, costs spent or clock before acknowledgements',async()=>{
  const match=await fixture();let snapshot=await match.start();assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.room.startsAt,undefined);assert.ok(snapshot.room.loading?.epoch);assert.equal(snapshot.room.loading!.deadlineAt,match.now()+L.mapLoadingTimeoutMilliseconds);assert.deepEqual(snapshot.room.loading!.readyPlayerIds,[]);
  const initial=snapshot.ownState!;match.add(20000);snapshot=await match.read();assert.equal(snapshot.room.clockMinutes,0);assert.equal(snapshot.ownState!.clockMinutes,0);assert.equal(snapshot.ownState!.operatingCost,initial.operatingCost);assert.equal(snapshot.ownState!.energy.remaining,initial.energy.remaining);assert.equal(snapshot.ownState!.currentOffer,null);assert.equal(snapshot.ownState!.acceptedOffers,0);assert.equal(snapshot.ownState!.presentedOffers,0);assert.equal(snapshot.room.competition,undefined);assert.equal((await match.authority.sessionInfo(match.host.roomCode,match.host.resumeToken)).canForfeit,false);
  const epoch=snapshot.room.loading!.epoch;snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:true});assert.equal(snapshot.room.startsAt,undefined);match.add(10000);snapshot=await match.read();assert.equal(snapshot.room.clockMinutes,0);assert.equal(snapshot.room.loading!.readyPlayerIds.length,1);assert.equal(snapshot.ownState!.acceptedOffers,0);
});

test('all current maps ready starts one common countdown and offers begin only after running',async()=>{
  const match=await fixture();const initial=await match.start(),epoch=initial.room.loading!.epoch;
  await match.send(match.host,{type:'map-ready',epoch,ready:true});let snapshot=await match.send(match.guest,{type:'map-ready',epoch,ready:true});const startsAt=match.now()+L.countdownMilliseconds;assert.equal(snapshot.room.startsAt,startsAt);assert.equal(snapshot.ownState!.currentOffer,null);assert.equal(snapshot.ownState!.acceptedOffers,0);
  match.add(L.countdownMilliseconds-1);snapshot=await match.read();assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.room.loading!.readyPlayerIds.length,2);assert.equal(snapshot.room.clockMinutes,0);assert.ok(snapshot.room.players.every(player=>player.clockMinutes===0));
  match.add(1);snapshot=await match.read();assert.equal(snapshot.room.status,'running');assert.equal(snapshot.room.loading,undefined);assert.equal(snapshot.room.clockMinutes,0);assert.equal(snapshot.room.startsAt,startsAt);assert.ok(snapshot.room.competition,'The real dispatch coordinator is activated only after the barrier; natural demand need not produce an immediate offer');
  match.add(1000);snapshot=await match.read();assert.equal(snapshot.room.clockMinutes,1);snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:false});assert.equal(snapshot.room.status,'running');assert.equal(snapshot.room.loading,undefined);assert.equal(snapshot.room.clockMinutes,1,'A late unmount callback never pauses a running match');
});

test('map false revokes a scheduled countdown, duplicate seq is idempotent, and re-ready gets a fresh countdown',async()=>{
  const match=await fixture();const initial=await match.start(),epoch=initial.room.loading!.epoch;await match.send(match.host,{type:'map-ready',epoch,ready:true});const ready=await match.send(match.guest,{type:'map-ready',epoch,ready:true});match.add(1000);
  let snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:false});assert.equal(snapshot.room.startsAt,undefined);assert.deepEqual(snapshot.room.loading!.readyPlayerIds,[match.guest.playerId]);const seq=match.sequences.get(match.host.playerId)!;const duplicate=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq,action:{type:'map-ready',epoch,ready:true}});assert.deepEqual(duplicate.room.loading!.readyPlayerIds,snapshot.room.loading!.readyPlayerIds);
  match.add(500);snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:true});assert.equal(snapshot.room.startsAt,match.now()+3000);assert.ok(snapshot.room.startsAt!>ready.room.startsAt!);match.add(1500);snapshot=await match.read();assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.room.clockMinutes,0);
});

test('trusted ready-false ingress before countdown end survives its own lease delay without rewinding a running commit',async()=>{
  const match=await fixture();const initial=await match.start(),epoch=initial.room.loading!.epoch;await match.send(match.host,{type:'map-ready',epoch,ready:true});const ready=await match.send(match.guest,{type:'map-ready',epoch,ready:true});const receivedAt=ready.room.startsAt!-10;match.add(4000);let snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:false},{receivedAt});assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.room.startsAt,undefined);assert.equal(snapshot.room.clockMinutes,0);
  snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:true});match.add(3000);await match.read();snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:false},{receivedAt});assert.equal(snapshot.room.status,'running');assert.equal(snapshot.room.loading,undefined);
});

test('a disconnected map acknowledgement is removed and reconnection requires the current renderer to acknowledge again',async()=>{
  const match=await fixture();const initial=await match.start(),epoch=initial.room.loading!.epoch;await match.send(match.host,{type:'map-ready',epoch,ready:true});await match.send(match.guest,{type:'map-ready',epoch,ready:true});match.add(16000,false);match.authority.applyPresence(match.host.roomCode,[{playerId:match.host.playerId,lastSeen:match.now(),forfeitedAt:null}],match.now());let snapshot=await match.read();assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.room.startsAt,undefined);assert.deepEqual(snapshot.room.loading!.readyPlayerIds,[match.host.playerId]);assert.equal(snapshot.room.players.find(player=>player.id===match.guest.playerId)!.forfeited,false);
  snapshot=await match.read(match.guest);assert.equal(snapshot.room.startsAt,undefined);snapshot=await match.send(match.guest,{type:'map-ready',epoch,ready:true});assert.equal(snapshot.room.startsAt,match.now()+3000);
});

test('timeout returns to a clean lobby, requires ready again, and stale epochs cannot unlock the next attempt',async()=>{
  const match=await fixture();const initial=await match.start(),oldEpoch=initial.room.loading!.epoch;await match.send(match.host,{type:'map-ready',epoch:oldEpoch,ready:true});match.add(60001,false);let snapshot=await match.read();assert.equal(snapshot.room.status,'lobby');assert.equal(snapshot.room.loading,undefined);assert.equal(snapshot.room.startsAt,undefined);assert.equal(snapshot.ownState,null);assert.equal(snapshot.room.clockMinutes,0);assert.ok(snapshot.room.players.every(player=>!player.ready&&!player.forfeited));assert.ok(match.authority.getPlayerIds(match.host.roomCode).every(id=>match.authority.serializePlayerState(match.host.roomCode,id)===null));assert.deepEqual(match.authority.prepareDriverDeltas(match.host.roomCode),[]);
  snapshot=await match.send(match.host,{type:'map-ready',epoch:oldEpoch,ready:true});assert.equal(snapshot.room.status,'lobby');match.add(1);const next=await match.start(),epoch=next.room.loading!.epoch;assert.notEqual(epoch,oldEpoch);await assert.rejects(()=>match.send(match.guest,{type:'map-ready',epoch:oldEpoch,ready:true}),(error:any)=>error.code==='loading_changed');snapshot=await match.read();assert.deepEqual(snapshot.room.loading!.readyPlayerIds,[]);assert.equal(snapshot.room.startsAt,undefined);
});

test('a long-delayed first poll cannot turn an unstarted loading room into a disconnect forfeit',async()=>{
  const match=await fixture();await match.start();assert.equal((await match.authority.sessionInfo(match.host.roomCode,match.host.resumeToken)).canForfeit,false);match.add(200000,false);match.authority.applyPresence(match.host.roomCode,match.sessions.map(player=>({playerId:player.playerId,lastSeen:match.now()-200000,forfeitedAt:match.now()-65000})),match.now());const snapshot=await match.read();assert.equal(snapshot.room.status,'lobby');assert.ok(snapshot.room.players.every(player=>!player.forfeited));assert.equal(snapshot.ownState,null);assert.equal(snapshot.room.clockMinutes,0);
});

test('loading acknowledgements are strictly typed, caller-scoped, and retain a full countdown when ready near timeout',async()=>{
  const match=await fixture();const initial=await match.start(),epoch=initial.room.loading!.epoch;
  await assert.rejects(()=>match.send(match.host,{type:'map-ready',epoch,ready:'true'}as any),(error:any)=>error.code==='invalid_action');
  await assert.rejects(()=>match.send(match.host,{type:'map-ready',epoch,ready:true,playerId:match.guest.playerId}as any),(error:any)=>error.code==='unexpected_field');
  match.add(59000);let snapshot=await match.send(match.host,{type:'map-ready',epoch,ready:true});assert.deepEqual(snapshot.room.loading!.readyPlayerIds,[match.host.playerId]);snapshot=await match.send(match.guest,{type:'map-ready',epoch,ready:true});assert.equal(snapshot.room.startsAt,match.now()+3000);match.add(2000);snapshot=await match.read();assert.equal(snapshot.room.status,'countdown');assert.equal(snapshot.room.clockMinutes,0);match.add(1000);assert.equal((await match.read()).room.status,'running');
});

test('a player leaving during loading cancels the attempt without a forfeit or stuck team countdown',async()=>{
  const match=await fixture();const initial=await match.start();await match.send(match.host,{type:'map-ready',epoch:initial.room.loading!.epoch,ready:true});let snapshot=await match.send(match.host,{type:'leave'});assert.equal(snapshot.room.status,'lobby');assert.equal(snapshot.room.players.length,1);assert.equal(snapshot.room.hostPlayerId,match.guest.playerId);assert.equal(snapshot.room.players[0].ready,false);assert.equal(snapshot.room.players[0].forfeited,false);assert.equal(snapshot.room.loading,undefined);snapshot=await match.read(match.guest);assert.equal(snapshot.ownState,null);
});

test('partial loading and scheduled countdown persist across metadata plus per-player shard restoration',async()=>{
  const match=await fixture();const initial=await match.start(),epoch=initial.room.loading!.epoch;await match.send(match.host,{type:'map-ready',epoch,ready:true});const restored=new RoomAuthority({now:match.now});restored.deserializeRoom(match.authority.serializeRoom(match.host.roomCode)!);let snapshot=await restored.readSnapshot(match.host.roomCode,match.guest.resumeToken);assert.equal(snapshot.room.loading!.epoch,epoch);assert.deepEqual(snapshot.room.loading!.readyPlayerIds,[match.host.playerId]);assert.equal(snapshot.ownState!.currentOffer,null);assert.equal(snapshot.room.clockMinutes,0);
  snapshot=await restored.handleCommand(match.host.roomCode,match.guest.resumeToken,{seq:2,action:{type:'map-ready',epoch,ready:true}});assert.equal(snapshot.room.startsAt,match.now()+3000);const again=new RoomAuthority({now:match.now});again.deserializeRoom(restored.serializeRoom(match.host.roomCode)!);snapshot=await again.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:4,action:{type:'map-ready',epoch,ready:false}});assert.equal(snapshot.room.startsAt,undefined);assert.equal(snapshot.room.loading!.epoch,epoch);assert.equal(snapshot.room.clockMinutes,0);
});

test('legacy 0.5 retains its original immediate countdown and does not acquire the map barrier',async()=>{
  const match=await fixture('0.5');const snapshot=await match.start();assert.equal(snapshot.room.loading,undefined);assert.equal(snapshot.room.startsAt,match.now()+3000);assert.ok(snapshot.room.competition);await assert.rejects(()=>match.send(match.host,{type:'map-ready',epoch:'unavailable',ready:true}),(error:any)=>error.code==='room_version');match.add(3000);assert.equal((await match.read()).room.status,'running');
});
