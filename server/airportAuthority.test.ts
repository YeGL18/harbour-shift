import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import type {RoomAction,RoomSession} from '../shared/protocol';
import {HKG_AIRPORT} from '../shared/airport';
test('real authority persists airport FIFO, publishes aggregate counts only, and claims one normal five-second request',async()=>{
 let now=1800000000000,authority=new RoomAuthority({now:()=>now});
 const setup={vehicleId:'private' as const,startPlaceId:HKG_AIRPORT.waitingPlaceId,handoverPlaceId:HKG_AIRPORT.waitingPlaceId};
 const host=await authority.createRoom({nickname:'Airport A',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1,rules:{speed:60,shiftDurationMinutes:360},setup});
 const guest=await authority.joinRoom(host.roomCode,{nickname:'Airport B',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1,setup});
 const saved=JSON.parse(authority.serializeRoom(host.roomCode)!);saved.metadata.room.seed=1;authority=new RoomAuthority({now:()=>now});authority.deserializeRoom(JSON.stringify(saved));
 const seq=new Map<string,number>(),send=(session:RoomSession,action:RoomAction)=>authority.handleCommand(session.roomCode,session.resumeToken,{seq:(seq.set(session.playerId,(seq.get(session.playerId)||0)+1),seq.get(session.playerId)!),action});
 await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});const starting=await send(host,{type:'start'});const epoch=starting.room.loading!.epoch;await send(host,{type:'map-ready',epoch,ready:true});await send(guest,{type:'map-ready',epoch,ready:true});now+=3000;await authority.readSnapshot(host.roomCode,host.resumeToken);
 const a=await send(host,{type:'airport',choice:'join'}),b=await send(guest,{type:'airport',choice:'join'});
 assert.equal(a.ownState!.airportQueue!.position,1);assert.equal(b.ownState!.airportQueue!.position,2);assert.equal(b.room.airport!.pools.find(p=>p.pool==='standard')!.total,2);assert.ok(!('tickets' in b.room.airport!));assert.equal(b.ownState!.airportQueue!.total,2);
 const cold=new RoomAuthority({now:()=>now});cold.deserializeRoom(authority.serializeRoom(host.roomCode)!);authority=cold;
 const restored=await authority.readSnapshot(host.roomCode,guest.resumeToken);assert.equal(restored.ownState!.airportQueue!.id,b.ownState!.airportQueue!.id);assert.equal(restored.ownState!.airportQueue!.position,2);
 let offered=await authority.readSnapshot(host.roomCode,host.resumeToken);
 for(let i=0;i<24&&!offered.ownState!.currentOffer;i++){now+=1000;offered=await authority.readSnapshot(host.roomCode,host.resumeToken);await authority.readSnapshot(host.roomCode,guest.resumeToken);}
 assert.ok(offered.ownState!.currentOffer?.id.startsWith('airport-'));const offer=offered.ownState!.currentOffer!;assert.equal(offer.expiresAt-offer.createdAt,5);assert.ok(offer.estimatedFare>0);assert.equal(offered.ownState!.airportQueue,null);
 const accepted=await send(host,{type:'accept',offerId:offer.id});assert.equal(accepted.ownState!.acceptedOffers,1);const retry=await authority.handleCommand(host.roomCode,host.resumeToken,{seq:seq.get(host.playerId)!,action:{type:'accept',offerId:offer.id}});assert.equal(retry.ownState!.acceptedOffers,1);
 const other=await authority.readSnapshot(host.roomCode,guest.resumeToken);assert.notEqual(other.ownState!.currentOffer?.id,offer.id);assert.equal(other.ownState!.airportQueue!.position,1);assert.equal(other.ownState!.acceptedOffers,0);
 await send(host,{type:'leave'});await send(guest,{type:'leave'});
});
test('loading timeout discards airport ordinals and tickets before a fresh round, without duplicating metadata initialization',async()=>{
 let now=1800000000000;let authority=new RoomAuthority({now:()=>now});
 const request={featureVersion:'0.6' as const,vehicleCatalogVersion:1 as const,advancedRulesVersion:1 as const};
 const a=await authority.createRoom({...request,nickname:'Load A'}),b=await authority.joinRoom(a.roomCode,{...request,nickname:'Load B'});
 await authority.handleCommand(a.roomCode,a.resumeToken,{seq:1,action:{type:'ready',ready:true}});await authority.handleCommand(a.roomCode,b.resumeToken,{seq:1,action:{type:'ready',ready:true}});await authority.handleCommand(a.roomCode,a.resumeToken,{seq:2,action:{type:'start'}});
 const saved=JSON.parse(authority.serializeRoom(a.roomCode)!);saved.metadata.airportTickets=[{id:'prior-ticket',playerId:a.playerId,sequence:7,pool:'standard',priority:false,zoneId:'hkg',joinedAt:0}];saved.metadata.airportNextSequence=7;saved.metadata.room.airport={zoneId:'hkg',pools:[]};
 authority=new RoomAuthority({now:()=>now});authority.deserializeRoom(JSON.stringify(saved));now+=61000;const returned=await authority.readSnapshot(a.roomCode,a.resumeToken);assert.equal(returned.room.status,'lobby');
 const metadata=JSON.parse(authority.serializeRoomMetadata(a.roomCode)!);assert.deepEqual(metadata.airportTickets,[]);assert.equal(metadata.airportNextSequence,0);assert.equal(metadata.room.airport,undefined);assert.ok(returned.room.players.every(player=>!player.ready));
});
test('a legacy room discards stray advanced airport metadata instead of exposing a new queue to old clients',async()=>{
 const authority=new RoomAuthority(),session=await authority.createRoom({nickname:'Legacy'}),stored=JSON.parse(authority.serializeRoom(session.roomCode)!);stored.metadata.airportTickets=[{id:'unsupported'}];stored.metadata.airportNextSequence=9;stored.metadata.room.airport={zoneId:'hkg'};
 const cold=new RoomAuthority();cold.deserializeRoom(JSON.stringify(stored));const metadata=JSON.parse(cold.serializeRoomMetadata(session.roomCode)!);assert.deepEqual(metadata.airportTickets,[]);assert.equal(metadata.airportNextSequence,0);assert.equal(metadata.room.airport,undefined);
});
