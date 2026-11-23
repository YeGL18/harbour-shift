/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { RoomAuthority, ProtocolFailure } from './authority';
import { MULTIPLAYER_LIMITS, ROOM_SPEEDS, type ActionEnvelope, type RoomSession, type RoomSpeed, type RoomAction } from '../shared/protocol';
import { decodeState, encodeState } from './codec';
import { createInitialState,getVehicleGraph } from '../src/game';
import { getCompatibleStations } from '../src/data/serviceStations';

async function pair(mode:'highest-net'|'lowest-net'='highest-net',speed:RoomSpeed=60){
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'房主',rules:{speed,mode}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'朋友'});
  const sent=new Map<string,ActionEnvelope>();
  const command=async(session:RoomSession,seq:number,action:RoomAction|{type:'accept'|'decline'|'cancel'})=>{
    const key=`${session.playerId}:${seq}`;
    let pending=sent.get(key);
    if(!pending){
      let intent=action as RoomAction;
      const offerId=session.snapshot.ownState?.currentOffer?.id||session.snapshot.ownState?.activeTrip?.offer.id||'TEST-STALE-OFFER';
      if(action.type==='accept'&&!('offerId'in action))intent={type:'accept',offerId};
      if(action.type==='decline'&&!('offerId'in action))intent={type:'decline',offerId};
      if(action.type==='cancel'&&!('tripId'in action))intent={type:'cancel',tripId:session.snapshot.ownState?.activeTrip?.offer.id||'TEST-STALE-TRIP'};
      pending={seq,action:intent};sent.set(key,pending);
    }
    try{const result=await authority.handleCommand(session.roomCode,session.resumeToken,pending);session.snapshot=result;return result;}catch(error){sent.delete(key);throw error;}
  };
  const start=async()=>{await command(host,1,{type:'ready',ready:true});await command(guest,1,{type:'ready',ready:true});await command(host,2,{type:'start'});now+=3000;host.snapshot=await authority.readSnapshot(host.roomCode,host.resumeToken);guest.snapshot=await authority.readSnapshot(guest.roomCode,guest.resumeToken);};
  return{authority,host,guest,command,start,add:(ms:number)=>{now+=ms;},now:()=>now};
}

test('real two-player authority shares seed, fixed clock and full HK simulation without client state',async()=>{
  const match=await pair();await match.start();match.add(1000);
  const a=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const b=await match.authority.readSnapshot(match.guest.roomCode,match.guest.resumeToken);
  assert.equal(a.room.status,'running');assert.equal(a.room.seed,b.room.seed);
  assert.equal(a.room.clockMinutes,1);assert.equal(a.ownState?.clockMinutes,1);assert.equal(b.ownState?.clockMinutes,1);
  assert.equal(a.ownState?.currentOffer?.expiresAt,5,'60x offers last exactly five real seconds without slowing the world');
  assert.ok(a.room.players.every(player=>player.position&&player.route&&player.route.length<=100));
  assert.equal('landmarks' in a.ownState!,false);
  assert.ok(!JSON.stringify(a).includes(match.host.resumeToken));
  await assert.rejects(()=>match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:3,action:{type:'accept',netIncome:1e9}} as unknown as ActionEnvelope),(error:any)=>error.code==='unexpected_field');
  await assert.rejects(()=>match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:3,clockMinutes:720,action:{type:'accept'}} as unknown as ActionEnvelope),(error:any)=>error.code==='unexpected_field');
});

test('all fixed room speeds give offers exactly five real seconds without slowing the shared clock',async()=>{
  for(const speed of ROOM_SPEEDS){
    const match=await pair('highest-net',speed);await match.start();match.add(1000);
    const snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
    const offer=snapshot.ownState!.currentOffer!;assert.ok(offer);
    assert.ok(Math.abs((offer.expiresAt-offer.createdAt)*60/speed-5)<1e-8);
    assert.ok(Math.abs(snapshot.room.clockMinutes-speed/60)<1e-8);
    assert.equal(snapshot.room.clockMinutes,snapshot.ownState?.clockMinutes);
  }
});
test('a room returning after twenty seconds without polling never exposes an expired live offer',async()=>{
  for(const speed of ROOM_SPEEDS){
    const match=await pair('highest-net',speed);await match.start();match.add(20_000);
    const snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
    const state=snapshot.ownState!;assert.equal(state.offerResponseWindowMinutes,speed*5/60);
    assert.ok(!state.currentOffer||state.currentOffer.expiresAt>state.clockMinutes);
    assert.ok(Math.abs(snapshot.room.clockMinutes-20*speed/60)<1e-8);assert.equal(state.clockMinutes,snapshot.room.clockMinutes);
    for(const offer of state.observedOffers)assert.ok(Math.abs((offer.expiresAt-offer.createdAt)*60/speed-5)<1e-8);
  }
});
test('a host can select 1× before start and a cold room survives the base four-hour expiry',async()=>{
  let now=1_800_000_000_000;
  const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Host',featureVersion:'0.6',rules:{speed:60,shiftDurationMinutes:1440}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:'0.6'});
  const send=(player:RoomSession,seq:number,action:RoomAction)=>authority.handleCommand(host.roomCode,player.resumeToken,{seq,action});
  for(const speed of [0,2,'1',null])await assert.rejects(()=>send(host,1,{type:'rules',rules:{speed}as any}),(error:any)=>error.code==='invalid_rules');
  const lobby=await send(host,1,{type:'rules',rules:{speed:1}});
  assert.equal(lobby.room.speed,1);
  await send(host,2,{type:'ready',ready:true});await send(guest,1,{type:'ready',ready:true});
  const starting=await send(host,3,{type:'start'});
  assert.equal(starting.room.speed,1);
  assert.ok(starting.room.expiresAt>now+MULTIPLAYER_LIMITS.mapLoadingTimeoutMilliseconds+MULTIPLAYER_LIMITS.countdownMilliseconds+(1440+240)*60_000);
  const epoch=starting.room.loading!.epoch;
  await send(host,4,{type:'map-ready',epoch,ready:true});
  await send(guest,2,{type:'map-ready',epoch,ready:true});
  now+=MULTIPLAYER_LIMITS.countdownMilliseconds;
  assert.equal((await authority.readSnapshot(host.roomCode,host.resumeToken)).room.status,'running');
  const stored=authority.serializeRoom(host.roomCode)!;
  await assert.rejects(()=>send(host,5,{type:'rules',rules:{speed:10}}),(error:any)=>error.code==='rules_locked');
  now+=MULTIPLAYER_LIMITS.runningTtlMilliseconds+1;
  const restored=new RoomAuthority({now:()=>now});restored.deserializeRoom(stored);
  restored.applyPresence(host.roomCode,[host,guest].map(player=>({playerId:player.playerId,lastSeen:now,forfeitedAt:null})));
  const snapshot=await restored.readSnapshot(host.roomCode,guest.resumeToken);
  assert.equal(snapshot.room.status,'running');
  assert.equal(snapshot.room.speed,1);
  assert.equal(snapshot.room.expiresAt,starting.room.expiresAt);
  assert.ok(Math.abs(snapshot.room.clockMinutes-240)<.01);
});
test('room start time is normalized, host-controlled and shared by every engine state',async()=>{
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Host',rules:{shift:'night'}});assert.equal(host.snapshot.room.startTimeMinutes,1020);
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest'});
  const command=(session:RoomSession,seq:number,action:ActionEnvelope['action'])=>authority.handleCommand(session.roomCode,session.resumeToken,{seq,action});
  let state=await command(host,1,{type:'rules',rules:{startTimeMinutes:425}});assert.equal(state.room.startTimeMinutes,425);
  state=await command(host,2,{type:'rules',rules:{density:'busy'}});assert.equal(state.room.startTimeMinutes,425,'unrelated rules retain custom time');
  state=await command(host,3,{type:'rules',rules:{shift:'day'}});assert.equal(state.room.startTimeMinutes,300);
  state=await command(host,4,{type:'rules',rules:{shift:'night',startTimeMinutes:60}});assert.equal(state.room.startTimeMinutes,60,'an explicit common time takes precedence');
  await command(host,5,{type:'ready',ready:true});await command(guest,1,{type:'ready',ready:true});state=await command(host,6,{type:'start'});
  assert.equal(state.ownState?.startTimeMinutes,60);now+=3000;
  const peer=await authority.readSnapshot(host.roomCode,guest.resumeToken);assert.equal(peer.ownState?.startTimeMinutes,60);assert.equal(peer.room.startTimeMinutes,60);
  await assert.rejects(()=>command(host,7,{type:'rules',rules:{startTimeMinutes:500}}),(error:any)=>error.code==='rules_locked');
  await assert.rejects(()=>command(guest,2,{type:'setup',setup:{vehicleId:'private',startTimeMinutes:999}} as any),(error:any)=>error.code==='rules_locked'||error.code==='unexpected_field');
});
test('common start time accepts integer boundaries and rejects invalid values or per-player clock injection',async()=>{
  const authority=new RoomAuthority();
  for(const value of [0,1439])assert.equal((await authority.createRoom({nickname:'Boundary',rules:{startTimeMinutes:value}})).snapshot.room.startTimeMinutes,value);
  for(const value of [-1,1440,300.5,null,'300'])await assert.rejects(()=>authority.createRoom({nickname:'Invalid',rules:{startTimeMinutes:value}as any}),(error:any)=>error.code==='invalid_rules');
  const host=await authority.createRoom({nickname:'PrivateTime'});
  await assert.rejects(()=>authority.handleCommand(host.roomCode,host.resumeToken,{seq:1,action:{type:'setup',setup:{vehicleId:'private',startTimeMinutes:700}}}as any),(error:any)=>error.code==='unexpected_field');
});
test('persisted rooms predating common time retain the actual saved shared time rather than adopting new defaults',async()=>{
  const match=await pair();await match.start();
  const metadata=JSON.parse(match.authority.serializeRoomMetadata(match.host.roomCode)!);delete metadata.room.startTimeMinutes;
  const restored=new RoomAuthority({now:match.now});restored.deserializeRoomMetadata(JSON.stringify(metadata));
  for(const id of match.authority.getPlayerIds(match.host.roomCode)){const state=decodeState(match.authority.serializePlayerState(match.host.roomCode,id)!)as any;state.startTimeMinutes=425;restored.deserializePlayerState(match.host.roomCode,id,encodeState(state));}
  const snapshot=await restored.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(snapshot.room.startTimeMinutes,425);assert.equal(snapshot.ownState?.startTimeMinutes,425);
});

test('tokens authenticate only their room and raw credentials never enter durable room data',async()=>{
  const match=await pair();
  await assert.rejects(()=>match.authority.readSnapshot(match.host.roomCode,'0'.repeat(64)),(error:any)=>error.code==='unauthorized'&&error.status===401);
  const other=await match.authority.createRoom({nickname:'另一房'});
  await assert.rejects(()=>match.authority.readSnapshot(other.roomCode,match.host.resumeToken),(error:any)=>error.code==='unauthorized');
  assert.equal(match.host.resumeToken.length,64);
  const data=match.authority.serializeRoom(match.host.roomCode)!;
  assert.ok(!data.includes(match.host.resumeToken));assert.ok(!data.includes(match.guest.resumeToken));
});

test('starting needs two ready players and host permissions; match rules become immutable',async()=>{
  const match=await pair();
  await assert.rejects(()=>match.command(match.guest,1,{type:'start'}),(error:any)=>error.code==='host_only');
  await assert.rejects(()=>match.command(match.host,1,{type:'start'}),(error:any)=>error.code==='not_ready');
  await match.start();
  await assert.rejects(()=>match.command(match.host,3,{type:'rules',rules:{speed:10}}),(error:any)=>error.code==='rules_locked');
  await assert.rejects(()=>match.command(match.host,3,{type:'setup',setup:{vehicleId:'private'}}),(error:any)=>error.code==='rules_locked');
  await assert.rejects(()=>match.authority.joinRoom(match.host.roomCode,{nickname:'遲到'}),(error:any)=>error.code==='match_started');
});

test('one shared order can be accepted once and retried sequences never duplicate fares or actions',async()=>{
  const match=await pair();await match.start();
  const accepted=await match.command(match.host,3,{type:'accept'});
  assert.equal(accepted.ownState?.acceptedOffers,1);
  const duplicate=await match.command(match.host,3,{type:'accept'});
  assert.equal(duplicate.ownState?.acceptedOffers,1);
  await assert.rejects(()=>match.command(match.guest,2,{type:'accept'}),(error:any)=>error.code==='offer_expired');
  const guest=await match.authority.readSnapshot(match.guest.roomCode,match.guest.resumeToken);
  assert.equal(guest.ownState?.acceptedOffers,0);assert.equal(guest.ownState?.currentOffer,null);
  assert.equal(guest.ownState?.declinedOffers,0,'another driver taking the request is not a rejection');
  assert.equal(guest.room.players.find(player=>player.id===match.host.playerId)?.order?.phase,'waiting');
  const peerOrder=guest.room.players.find(player=>player.id===match.host.playerId)!.order!;
  assert.equal(peerOrder.pickupNameEn,accepted.ownState!.activeTrip!.offer.pickup.nameEn);
  assert.equal(peerOrder.destinationNameEn,accepted.ownState!.activeTrip!.offer.destination.nameEn);
  assert.equal(peerOrder.pickupName,accepted.ownState!.activeTrip!.offer.pickup.name);
});
test('a never-delivered old accept or decline cannot affect the replacement offer after its deadline',async()=>{
  const match=await pair();await match.start();const old=match.host.snapshot.ownState!.currentOffer!;
  match.add(7100);const advanced=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const replacement={...old,id:'replacement-live-offer',createdAt:advanced.ownState!.clockMinutes,expiresAt:advanced.ownState!.clockMinutes+5};
  match.authority.deserializePlayerState(match.host.roomCode,match.host.playerId,JSON.stringify({...advanced.ownState,currentOffer:replacement}));
  const before=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  for(const type of ['accept','decline']as const)await assert.rejects(()=>match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:3,action:{type,offerId:old.id}}),(error:any)=>error.status===409&&error.code==='offer_expired');
  const after=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(after.ownState?.currentOffer?.id,replacement.id);assert.equal(after.ownState?.acceptedOffers,before.ownState?.acceptedOffers);assert.equal(after.ownState?.declinedOffers,before.ownState?.declinedOffers);assert.equal(after.you.lastInputSeq,2);
});
test('an executed accept retry is acknowledged before comparing IDs against a later offer',async()=>{
  const match=await pair();await match.start();const oldId=match.host.snapshot.ownState!.currentOffer!.id;
  const accepted=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:3,action:{type:'accept',offerId:oldId}});
  const replacement={...accepted.ownState!.activeTrip!.offer,id:'later-live-offer',createdAt:0,expiresAt:5};
  match.authority.deserializePlayerState(match.host.roomCode,match.host.playerId,JSON.stringify({...accepted.ownState,phase:'cruising',activeTrip:null,currentOffer:replacement}));
  const retried=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:3,action:{type:'accept',offerId:oldId}});
  assert.equal(retried.ownState?.acceptedOffers,1);assert.equal(retried.ownState?.currentOffer?.id,replacement.id);assert.equal(retried.you.lastInputSeq,3);
});
test('late cancellation targets one trip and an executed cancellation retry cannot cancel a later trip',async()=>{
  const match=await pair();await match.start();const accepted=await match.command(match.host,3,{type:'accept'});const old=accepted.ownState!.activeTrip!;
  const replacement={...old,offer:{...old.offer,id:'later-active-trip'}};
  match.authority.deserializePlayerState(match.host.roomCode,match.host.playerId,JSON.stringify({...accepted.ownState,activeTrip:replacement}));
  await assert.rejects(()=>match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:4,action:{type:'cancel',tripId:old.offer.id}}),(error:any)=>error.status===409&&error.code==='trip_changed');
  let state=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(state.ownState?.activeTrip?.offer.id,replacement.offer.id);assert.equal(state.ownState?.cancelledTrips,0);
  const cancelled=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:4,action:{type:'cancel',tripId:replacement.offer.id}});assert.equal(cancelled.ownState?.cancelledTrips,1);
  match.authority.deserializePlayerState(match.host.roomCode,match.host.playerId,JSON.stringify({...cancelled.ownState,phase:'waiting',activeTrip:{...replacement,offer:{...replacement.offer,id:'third-active-trip'}}}));
  state=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:4,action:{type:'cancel',tripId:replacement.offer.id}});
  assert.equal(state.ownState?.activeTrip?.offer.id,'third-active-trip');assert.equal(state.ownState?.cancelledTrips,1);
});
test('protocol v2 requires concrete offer and trip IDs rather than an unbound action',async()=>{
  const match=await pair();await match.start();assert.equal(match.host.snapshot.protocolVersion,2);
  for(const type of ['accept','decline','cancel'])await assert.rejects(()=>match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:3,action:{type}}as any),(error:any)=>error.code==='invalid_action');
});

test('disconnect transfers host and reconnect within grace resumes the same car and time',async()=>{
  const match=await pair();await match.start();await match.command(match.host,3,{type:'accept'});
  match.add(16_000);const guest=await match.authority.readSnapshot(match.guest.roomCode,match.guest.resumeToken);
  assert.equal(guest.room.hostPlayerId,match.guest.playerId);
  assert.equal(guest.room.players.find(player=>player.id===match.host.playerId)?.connected,false);
  match.add(1000);const resumed=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(resumed.you.playerId,match.host.playerId);assert.equal(resumed.ownState?.acceptedOffers,1);
  assert.equal(resumed.room.clockMinutes,17);assert.equal(resumed.room.hostPlayerId,match.guest.playerId);
  assert.equal(resumed.room.players.find(player=>player.id===match.host.playerId)?.forfeited,false);
});

test('disconnect beyond grace forfeits instead of winning the lowest-income room',async()=>{
  const match=await pair('lowest-net');await match.start();
  for(let count=0;count<14;count++){match.add(10_000);await match.authority.readSnapshot(match.guest.roomCode,match.guest.resumeToken);}
  const snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const host=snapshot.room.players.find(player=>player.id===match.host.playerId)!;
  assert.equal(host.forfeited,true);assert.equal(snapshot.leaderboard.find(row=>row.playerId===host.id)?.rank,null);
  await assert.rejects(()=>match.command(match.host,3,{type:'accept'}),(error:any)=>error.code==='player_left');
  const left=await match.command(match.host,4,{type:'leave'});assert.equal(left.room.players.find(player=>player.id===host.id)?.status,'left','forfeited players can still leave and join another room');
});

test('eight-player capacity, profile validation and bounded competition costs are enforced',async()=>{
  const match=await pair();
  for(let number=2;number<8;number++)await match.authority.joinRoom(match.host.roomCode,{nickname:`玩家${number}`});
  await assert.rejects(()=>match.authority.joinRoom(match.host.roomCode,{nickname:'第九位'}),(error:any)=>error.code==='room_full');
  await assert.rejects(()=>match.command(match.host,1,{type:'profile',nickname:'\u202e冒充'}),(error:any)=>error.code==='invalid_nickname');
  await assert.rejects(()=>match.command(match.host,1,{type:'setup',setup:{vehicleId:'kam-fung',rentalOverride:999999}} as any),(error:any)=>error.code==='invalid_cost');
  const fresh=await pair();
  await assert.rejects(()=>fresh.authority.joinRoom(fresh.host.roomCode,{nickname:'房主'}),(error:any)=>error.code==='nickname_taken');
});

test('concurrent authenticated joins cannot race past eight players or duplicate nicknames',async()=>{
  const authority=new RoomAuthority();const host=await authority.createRoom({nickname:'Host'});
  const joins=await Promise.allSettled(Array.from({length:10},(_,index)=>authority.joinRoom(host.roomCode,{nickname:`Peer${index}`})));
  assert.equal(joins.filter(result=>result.status==='fulfilled').length,7);
  assert.equal((await authority.readSnapshot(host.roomCode,host.resumeToken)).room.players.length,8);
  const other=await authority.createRoom({nickname:'Host'});
  const duplicate=await Promise.allSettled([authority.joinRoom(other.roomCode,{nickname:'Same'}),authority.joinRoom(other.roomCode,{nickname:'Same'})]);
  assert.equal(duplicate.filter(result=>result.status==='fulfilled').length,1);
});

test('per-session action limits survive persistence and prevent input floods',async()=>{
  const match=await pair();
  for(let index=1;index<=20;index++)await match.command(match.host,index,{type:'profile',nickname:`房主${index}`});
  await assert.rejects(()=>match.command(match.host,21,{type:'profile',nickname:'爆量'}),(error:any)=>error instanceof ProtocolFailure&&error.status===429);
  const restored=new RoomAuthority({now:match.now});restored.deserializeRoom(match.authority.serializeRoom(match.host.roomCode)!);
  await assert.rejects(()=>restored.handleCommand(match.host.roomCode,match.host.resumeToken,{seq:21,action:{type:'profile',nickname:'仍爆量'}}),(error:any)=>error.status===429);
});

test('sharded compact state restores real POIs, accepted trip, tokens and idempotent sequence',async()=>{
  const match=await pair();await match.start();await match.command(match.host,3,{type:'accept'});match.add(500);
  const original=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const restored=new RoomAuthority({now:match.now});
  const metadata=match.authority.serializeRoomMetadata(match.host.roomCode)!;
  assert.ok(!metadata.includes('landmarks'));assert.ok(!metadata.includes('activeTrip'));
  restored.deserializeRoomMetadata(metadata);
  await restored.authorizeSession(match.host.roomCode,match.host.resumeToken);
  await assert.rejects(()=>restored.authorizeSession(match.host.roomCode,'0'.repeat(64)),(error:any)=>error.status===401);
  for(const id of match.authority.getPlayerIds(match.host.roomCode)){const json=match.authority.serializePlayerState(match.host.roomCode,id)!;assert.ok(json.includes('"$poi"'));restored.deserializePlayerState(match.host.roomCode,id,json);}
  const next=await restored.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(next.you.lastInputSeq,3);assert.equal(next.ownState?.activeTrip?.offer.pickup.name,original.ownState?.activeTrip?.offer.pickup.name);
  assert.deepEqual(next.ownState?.movement,original.ownState?.movement);assert.equal(next.room.clockMinutes,original.room.clockMinutes);
});

test('service action starts stationary energy service instead of clearing navigation like drive',async()=>{
  const match=await pair();await match.start();const snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const station=getCompatibleStations('kam-fung')[0],graph=getVehicleGraph('kam-fung');
  const state={...snapshot.ownState!,phase:'service-route',currentOffer:null,activeTrip:null,movement:{edgeId:graph.outgoing[station.nodeId][0],distanceOnEdgeM:0,nextEdgeIds:[]},navigation:{kind:'refuel',target:station,stage:'routing'}};
  match.authority.deserializePlayerState(match.host.roomCode,match.host.playerId,JSON.stringify(state));
  const service=await match.command(match.host,3,{type:'service'});
  assert.equal(service.ownState?.phase,'servicing');assert.equal(service.ownState?.navigation?.stage,'servicing');assert.equal(service.ownState?.navigation?.target.id,station.id);
  assert.equal(service.ownState?.clockMinutes,0);assert.ok(service.ownState?.navigation?.endsAt);
});

test('cruise-to only accepts legal node IDs and the server computes route and preserves offer income',async()=>{
  const match=await pair();await match.start();const graph=getVehicleGraph('kam-fung');const node=getCompatibleStations('kam-fung')[0].nodeId;
  const routed=await match.command(match.host,3,{type:'cruise-to',nodeId:node});
  assert.equal(routed.ownState?.phase,'cruising');assert.equal(routed.ownState?.cruiseTarget?.nodeId,node);assert.equal(routed.ownState?.grossIncome,0);
  let previous=graph.edges[routed.ownState!.movement.edgeId].to;for(const id of routed.ownState!.movement.nextEdgeIds){assert.equal(graph.edges[id].from,previous);previous=graph.edges[id].to;}assert.equal(previous,node);
  await assert.rejects(()=>match.command(match.host,4,{type:'cruise-to',nodeId:'invalid'}),(error:any)=>error.code==='invalid_place');
  await assert.rejects(()=>match.command(match.host,4,{type:'cruise-to',nodeId:node,coordinates:[1,2]} as any),(error:any)=>error.code==='unexpected_field');
});

test('per-player codec preserves all 5760 nearby records and gzip stays below D1 row limit',()=>{
  const state=createInitialState({seed:20261118});const offer=state.currentOffer!;
  state.observedOffers=Array.from({length:5760},(_,index)=>({...offer,id:`persisted-nearby-${index}`,createdAt:index,expiresAt:index+4,tripRoute:[],feedKind:'along-route',routeEstimated:true}));
  const json=encodeState(state);const restored=decodeState(json) as any;
  assert.equal(restored.observedOffers.length,5760);assert.equal(restored.observedOffers[0].pickup.name,offer.pickup.name);
  assert.ok(!json.includes('"landmarks"'));assert.ok(gzipSync(json).length<2*1024*1024);
});

test('published room summaries contain no private game or credentials and expose the sample time',async()=>{
  const match=await pair();await match.start();match.add(500);const snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const published=match.authority.publishedSnapshot(match.host.roomCode);
  assert.equal(published.stateSampledAt,match.now());assert.equal(snapshot.stateSampledAt,match.now());
  assert.equal(published.room.clockMinutes,snapshot.ownState!.clockMinutes);assert.equal('ownState'in published,false);assert.equal('you'in published,false);
  assert.ok(!JSON.stringify(published).includes(match.host.resumeToken));assert.ok(!JSON.stringify(published).includes('tokenHash'));
});
test('the final lobby participant can leave and publish an empty roster safely',async()=>{
  const authority=new RoomAuthority();const host=await authority.createRoom({nickname:'OnlyHost'});
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:1,action:{type:'leave'}});
  assert.deepEqual(authority.publishedSnapshot(host.roomCode).room.players,[]);
});

test('durable heartbeats merge before a delayed tick, while an expiry latch survives fresh concurrent heartbeats',async()=>{
  const match=await pair('lowest-net');await match.start();const previous=match.now();match.add(140000);
  match.authority.applyPresence(match.host.roomCode,[{playerId:match.host.playerId,lastSeen:match.now(),forfeitedAt:previous+135000},{playerId:match.guest.playerId,lastSeen:match.now(),forfeitedAt:null}]);
  const snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(snapshot.room.players.find(p=>p.id===match.host.playerId)!.forfeited,true);
  assert.equal(snapshot.room.players.find(p=>p.id===match.guest.playerId)!.forfeited,false);
  assert.equal(snapshot.room.players.find(p=>p.id===match.guest.playerId)!.connected,true);
  match.authority.applyPresence(match.host.roomCode,[{playerId:match.host.playerId,lastSeen:match.now(),forfeitedAt:null}]);
  assert.equal(match.authority.publishedSnapshot(match.host.roomCode).leaderboard.find(p=>p.playerId===match.host.playerId)!.rank,null);
});

test('finished drivers and lobby visitors cannot lose eligibility from a later presence gap',async()=>{
  const match=await pair();await match.start();
  match.authority.deserializePlayerState(match.host.roomCode,match.host.playerId,JSON.stringify({...match.host.snapshot.ownState,phase:'ended',currentOffer:null,activeTrip:null}));
  match.add(1);await match.authority.readSnapshot(match.guest.roomCode,match.guest.resumeToken);match.add(140000);
  match.authority.applyPresence(match.host.roomCode,[{playerId:match.host.playerId,lastSeen:match.now(),forfeitedAt:match.now()-1},{playerId:match.guest.playerId,lastSeen:match.now(),forfeitedAt:null}]);
  const result=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(result.room.players.find(p=>p.id===match.host.playerId)!.status,'finished');assert.equal(result.room.players.find(p=>p.id===match.host.playerId)!.forfeited,false);
  const lobby=await pair();lobby.add(140000);lobby.authority.applyPresence(lobby.host.roomCode,[{playerId:lobby.host.playerId,lastSeen:lobby.now(),forfeitedAt:null}]);assert.equal((await lobby.authority.readSnapshot(lobby.host.roomCode,lobby.host.resumeToken)).room.players[0].forfeited,false);
});
