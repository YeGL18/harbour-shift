import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import {defaultSimulation} from './simulation';
import {driverStats} from './driverStats';
import {createInitialState,getVehicleGraph,setDispatchOffer} from '../src/game';
import {getCompatibleStations} from '../src/data/serviceStations';
import {decodeState} from './codec';
import type {GameState} from '../src/game/types';
import type {ActionEnvelope,RoomSession} from '../shared/protocol';
import type {SharedFuelTicket} from './dispatch';

async function room(modern=true){
  let now=1_800_000_000_000;
  const authority=new RoomAuthority({now:()=>now});
  const featureVersion=modern?'0.5':undefined;
  const host=await authority.createRoom({nickname:'Host',featureVersion,rules:{speed:60,density:'busy'}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion});
  const seq=new Map<string,number>();
  const send=async(session:RoomSession,action:ActionEnvelope['action'])=>{
    const next=(seq.get(session.playerId)||0)+1;
    const snapshot=await authority.handleCommand(session.roomCode,session.resumeToken,{seq:next,action});
    seq.set(session.playerId,next);return snapshot;
  };
  await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});await send(host,{type:'start'});
  now+=3000;await authority.readSnapshot(host.roomCode,host.resumeToken);
  return{authority,host,guest,send,now:()=>now,add:(ms:number)=>{now+=ms;}};
}

/** Genuine official station/graph and engine states; only the clock/ticket fixture is controlled. */
function atTurnover(m:Awaited<ReturnType<typeof room>>,servicing=true){
  const stored=JSON.parse(m.authority.serializeRoom(m.host.roomCode)!);
  const graph=getVehicleGraph('kam-fung');
  const station=getCompatibleStations('kam-fung').find(item=>item.kind==='lpg'&&item.unitPrice!==undefined)!;
  const edge=Object.values(graph.edges).find(item=>item.to===station.nodeId)!;
  assert.ok(station&&edge);
  stored.metadata.room.clockMinutes=719.5;stored.metadata.lastTickAt=m.now();
  const tickets:SharedFuelTicket[]=[];
  for(const [index,entry]of stored.states.entries()){
    const game=decodeState(entry.state)as GameState;
    const ticket={id:`turnover-${entry.id}`,playerId:entry.id,stationId:station.id,joinedAt:718+index*.1,serviceStartsAt:719.5+index*4,serviceEndsAt:723.5+index*4,aheadCount:index};
    const state:GameState={...game,clockMinutes:719.5,phase:servicing&&index===0?'servicing':'fuel-queue',currentOffer:null,activeTrip:null,queuedTrip:null,acceptingOrders:false,parking:null,
      movement:{edgeId:edge.id,distanceOnEdgeM:edge.lengthM,nextEdgeIds:[]},
      navigation:{kind:'refuel',target:station,stage:servicing&&index===0?'servicing':'routing',endsAt:servicing&&index===0?ticket.serviceEndsAt:undefined,handoverAfterService:true},
      fuelQueue:{...ticket,approachEdgeIds:[],distanceToStationM:0,assignmentPending:false,shared:true},
      energy:{...game.energy,remaining:10,unitPricePaid:4.57},
      grossIncome:321,operatingCost:40,presentedOffers:5,acceptedOffers:4,cancelledTrips:1,completedTrips:3,handoverStatus:'pending'};
    entry.state=JSON.stringify(state);tickets.push(ticket);
  }
  stored.metadata.fuelTickets=tickets;
  const restored=new RoomAuthority({now:m.now});restored.deserializeRoom(JSON.stringify(stored));
  return{authority:restored,station,tickets};
}

test('modern shared fuel service and FIFO queue continue after twelve hours, survive restore, then settle once',async()=>{
  const m=await room();const fixture=atTurnover(m);let authority=fixture.authority;
  const profile=driverStats({offered:20,accepted:15,cancelled:2,completedTrips:12},m.now());
  authority.attachDriver(m.host.roomCode,m.host.playerId,{driverId:'turnover-driver',stats:profile});
  assert.deepEqual(authority.prepareDriverDeltas(m.host.roomCode)[0].counters,{offered:5,accepted:4,cancelled:1,completedTrips:3});
  m.add(1000);
  let host=await authority.readSnapshot(m.host.roomCode,m.host.resumeToken);
  let guest=await authority.readSnapshot(m.guest.roomCode,m.guest.resumeToken);
  assert.equal(host.room.clockMinutes,720.5);assert.equal(host.room.status,'running');
  assert.equal(host.ownState!.phase,'servicing');assert.equal(guest.ownState!.phase,'fuel-queue');
  assert.equal(host.room.players.find(player=>player.id===m.host.playerId)!.forfeited,false);
  assert.equal(guest.room.players.find(player=>player.id===m.guest.playerId)!.forfeited,false);
  assert.equal(host.ownState!.fuelQueue!.id,fixture.tickets[0].id);
  assert.equal(guest.ownState!.fuelQueue!.serviceStartsAt,fixture.tickets[1].serviceStartsAt);
  const saved=authority.serializeRoom(m.host.roomCode)!;
  authority=new RoomAuthority({now:m.now});authority.deserializeRoom(saved);
  for(let minute=0;minute<9;minute++){
    m.add(1000);host=await authority.readSnapshot(m.host.roomCode,m.host.resumeToken);guest=await authority.readSnapshot(m.guest.roomCode,m.guest.resumeToken);
    if((host.ownState!.phase as GameState['phase'])==='ended'&&(guest.ownState!.phase as GameState['phase'])!=='ended'){
      assert.equal(host.room.status,'running','one late finisher must not truncate the next FIFO service');
      assert.equal(guest.ownState!.fuelQueue!.id,fixture.tickets[1].id);
    }
  }
  assert.equal(host.room.status,'finished');assert.ok(host.room.clockMinutes>720&&host.room.clockMinutes<730);
  for(const snapshot of [host,guest]){
    const state=snapshot.ownState!;assert.equal(state.phase,'ended');assert.equal(state.energy.remaining,state.energy.capacity);
    assert.equal(state.handoverStatus,'missed');assert.equal(state.summary!.overtimeMinutes,state.clockMinutes-720);
    assert.equal(state.grossIncome,321);assert.equal(state.operatingCost,40,'refilling must not charge consumed fuel twice');
    assert.equal(state.netIncome,321-40-state.rentalCostApplied);
    assert.equal(state.logs.filter(log=>log.text.startsWith('補充完成')).length,1);
    const expectedPrice=(10*4.57+(state.energy.capacity-10)*fixture.station.unitPrice!)/state.energy.capacity;
    assert.ok(Math.abs(state.energy.unitPricePaid-expectedPrice)<1e-8);
    assert.equal(state.shiftEndReason,'fuel-completed-late');
    assert.notEqual(snapshot.leaderboard.find(player=>player.playerId===snapshot.you.playerId)!.rank,null);
    assert.equal(snapshot.leaderboard.find(player=>player.playerId===snapshot.you.playerId)!.late,true);
    assert.equal(snapshot.room.players.find(player=>player.id===snapshot.you.playerId)!.forfeited,false);
    assert.equal(snapshot.room.players.find(player=>player.id===snapshot.you.playerId)!.late,true);
  }
  assert.ok(authority.prepareDriverDeltas(m.host.roomCode).every(delta=>Object.values(delta.counters).every(value=>value===0)),'fuel settlement is not another offer, acceptance or passenger completion');
  const duplicate=await authority.readSnapshot(m.host.roomCode,m.host.resumeToken);
  assert.equal(duplicate.ownState!.netIncome,host.ownState!.netIncome);assert.equal(duplicate.ownState!.logs.length,host.ownState!.logs.length);
});

test('legacy rooms keep their hard twelve-hour finish even if a stored fuel service crosses turnover',async()=>{
  const m=await room(false);const fixture=atTurnover(m);
  m.add(1000);const snapshot=await fixture.authority.readSnapshot(m.host.roomCode,m.host.resumeToken);
  assert.equal(snapshot.room.clockMinutes,720);assert.equal(snapshot.room.status,'finished');assert.equal(snapshot.ownState!.phase,'ended');
  assert.equal(snapshot.ownState!.energy.remaining,10);assert.equal(snapshot.ownState!.fuelQueueMode,'legacy');
});

test('late cancellation, timeout and an unfilled completion cannot claim the successful-fuel ranking exception',async()=>{
  for(const reason of ['fuel-cancelled-late','fuel-timeout','fuel-completed-late']as const){
    const m=await room();const fixture=atTurnover(m);const stored=JSON.parse(fixture.authority.serializeRoom(m.host.roomCode)!);
    stored.metadata.room.clockMinutes=721;stored.metadata.lastTickAt=m.now();
    for(const entry of stored.states){const game=decodeState(entry.state)as GameState;entry.state=JSON.stringify({...game,phase:'ended',clockMinutes:721,shiftEndReason:reason,handoverStatus:'missed',navigation:null,fuelQueue:null});}
    const authority=new RoomAuthority({now:m.now});authority.deserializeRoom(JSON.stringify(stored));m.add(1);
    const snapshot=await authority.readSnapshot(m.host.roomCode,m.host.resumeToken);
    assert.equal(snapshot.room.players.find(player=>player.id===m.host.playerId)!.forfeited,true,reason);
    assert.notEqual(snapshot.room.players.find(player=>player.id===m.host.playerId)!.late,true,reason);
    assert.equal(snapshot.leaderboard.find(player=>player.playerId===m.host.playerId)!.rank,null,reason);assert.equal(snapshot.ownState!.grossIncome,321);
  }
});

test('explicit cancel-handover keeps the shared fuel ticket and service, and a route cancellation stays cancelled',async()=>{
  const m=await room();const fixture=atTurnover(m);
  const before=decodeState(fixture.authority.serializePlayerState(m.host.roomCode,m.host.playerId)!)as GameState;
  const cancelled=await fixture.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'cancel-handover'}});
  assert.equal(cancelled.ownState!.navigation!.handoverAfterService,false);
  assert.equal(cancelled.ownState!.handoverIntent,'cancelled');assert.equal(cancelled.ownState!.phase,'servicing');
  for(const key of ['id','stationId','joinedAt','serviceStartsAt','serviceEndsAt']as const)assert.equal(cancelled.ownState!.fuelQueue![key],before.fuelQueue![key]);
  assert.equal(cancelled.ownState!.navigation!.endsAt,before.navigation!.endsAt);
  assert.deepEqual(cancelled.ownState!.movement,before.movement);
  await assert.rejects(()=>fixture.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:4,action:{type:'cancel-handover',stationId:'untrusted'}}as any),(error:any)=>error.code==='unexpected_field');

  const route=await room();const stored=JSON.parse(route.authority.serializeRoom(route.host.roomCode)!);
  stored.metadata.room.clockMinutes=719;stored.metadata.lastTickAt=route.now();
  for(const entry of stored.states){
    const game=decodeState(entry.state)as GameState;
    entry.state=JSON.stringify({...game,clockMinutes:719,currentOffer:null,phase:'service-route',acceptingOrders:false,handoverIntent:'requested',navigation:{kind:'handover',target:game.handoverPlace,stage:'routing'}});
  }
  const authority=new RoomAuthority({now:route.now});authority.deserializeRoom(JSON.stringify(stored));
  await authority.handleCommand(route.host.roomCode,route.host.resumeToken,{seq:3,action:{type:'cancel-handover'}});
  route.add(200);const later=await authority.readSnapshot(route.host.roomCode,route.host.resumeToken);
  assert.equal(later.ownState!.phase,'cruising');assert.equal(later.ownState!.navigation,null);assert.equal(later.ownState!.handoverIntent,'cancelled');
});

test('an existing handover route may switch to an allowed station through the normal authenticated action',async()=>{
  const m=await room();const state=decodeState(m.authority.serializePlayerState(m.host.roomCode,m.host.playerId)!)as GameState;
  const station=getCompatibleStations(state.vehicleId)[0];
  m.authority.deserializePlayerState(m.host.roomCode,m.host.playerId,JSON.stringify({...state,currentOffer:null,phase:'service-route',handoverIntent:'requested',navigation:{kind:'handover',target:state.handoverPlace,stage:'routing'}}));
  const switched=await m.send(m.host,{type:'station',stationId:station.id});
  assert.equal(switched.ownState!.navigation!.target.id,station.id);assert.equal(switched.ownState!.navigation!.kind,'refuel');
  assert.equal(switched.ownState!.handoverIntent,'cancelled');assert.ok(switched.ownState!.movement.nextEdgeIds.length||switched.ownState!.fuelQueue);
  await assert.rejects(()=>m.send(m.host,{type:'station',stationId:'not-an-official-station'}),(error:any)=>error.code==='invalid_station');
});

test('a broken modern continuation cannot keep a room running past the existing overtime safety limit',async()=>{
  const m=await room();const fixture=atTurnover(m);
  const authority=new RoomAuthority({now:m.now,simulation:{...defaultSimulation,advance:(state,minutes)=>({...state,clockMinutes:state.clockMinutes+minutes})}});
  const stored=JSON.parse(fixture.authority.serializeRoom(m.host.roomCode)!);stored.metadata.room.clockMinutes=959.5;
  for(const entry of stored.states){const game=decodeState(entry.state)as GameState;entry.state=JSON.stringify({...game,clockMinutes:959.5});}
  authority.deserializeRoom(JSON.stringify(stored));m.add(1000);
  const snapshot=await authority.readSnapshot(m.host.roomCode,m.host.resumeToken);
  assert.equal(snapshot.room.clockMinutes,960);assert.equal(snapshot.room.status,'finished');assert.ok(snapshot.room.players.every(player=>player.forfeited));
});

test('automatic acceptance uses the same modern request ID, deadline, exclusive claim and idempotent sequence',async()=>{
  const m=await room();const base=createInitialState({seed:20261118});const offer={...base.currentOffer!,id:'auto-accept-server-offer',createdAt:0,requestedAt:0,expiresAt:5};
  for(const session of [m.host,m.guest]){
    const state=decodeState(m.authority.serializePlayerState(session.roomCode,session.playerId)!)as GameState;
    m.authority.deserializePlayerState(session.roomCode,session.playerId,JSON.stringify(setDispatchOffer(setDispatchOffer(state,null),offer)));
  }
  const accepted=await m.send(m.host,{type:'accept',offerId:offer.id});assert.equal(accepted.ownState!.acceptedOffers,1);
  const duplicate=await m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'accept',offerId:offer.id}});
  assert.equal(duplicate.ownState!.acceptedOffers,1);
  await assert.rejects(()=>m.send(m.guest,{type:'accept',offerId:offer.id}),(error:any)=>error.code==='offer_expired'||error.code==='offer_taken');
  const claimed=JSON.parse(m.authority.serializeRoomMetadata(m.host.roomCode)!).claims;
  assert.deepEqual(claimed.filter(([id]:string[])=>id===offer.id),[[offer.id,m.host.playerId]]);
  const late=await room();const state=decodeState(late.authority.serializePlayerState(late.host.roomCode,late.host.playerId)!)as GameState;
  late.authority.deserializePlayerState(late.host.roomCode,late.host.playerId,JSON.stringify(setDispatchOffer(setDispatchOffer(state,null),offer)));
  late.add(5001);
  await assert.rejects(()=>late.send(late.host,{type:'accept',offerId:offer.id}),(error:any)=>error.code==='offer_expired');
  const snapshot=await late.authority.readSnapshot(late.host.roomCode,late.host.resumeToken);
  assert.equal(snapshot.ownState!.acceptedOffers,0);assert.equal(snapshot.you.lastInputSeq,2);
});
