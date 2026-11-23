import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import type {RoomAction,RoomSession} from '../shared/protocol';

test('a running/loading room keeps its frozen Pro tier and original claim after account upgrade and cold restore',async()=>{
 let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
 const capabilities={featureVersion:'0.6' as const,vehicleCatalogVersion:1 as const,advancedRulesVersion:1 as const};
 const host=await authority.createRoom({nickname:'Frozen Pro',...capabilities});
 const guest=await authority.joinRoom(host.roomCode,{nickname:'Other driver',...capabilities});
 authority.attachDriver(host.roomCode,host.playerId,{driverId:'pro-driver',stats:{offered:0,accepted:0,cancelled:0,completedTrips:0,acceptanceRate:0,cancellationRate:0,updatedAt:now}});
 authority.applyProPasses(new Map([['pro-driver',{packId:'old-gold',tier:'gold'}]]));
 const seq=new Map<string,number>();
 const send=(session:RoomSession,action:RoomAction)=>authority.handleCommand(session.roomCode,session.resumeToken,{seq:(seq.set(session.playerId,(seq.get(session.playerId)||0)+1),seq.get(session.playerId)!),action});
 await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});
 const starting=await send(host,{type:'start'});assert.equal(starting.ownState!.proTier,'gold');
 const epoch=starting.room.loading!.epoch;await send(host,{type:'map-ready',epoch,ready:true});await send(guest,{type:'map-ready',epoch,ready:true});now+=3000;
 assert.equal((await authority.readSnapshot(host.roomCode,host.resumeToken)).room.status,'running');
 const original=authority.prepareProClaims(host.roomCode).find(claim=>claim.driverId==='pro-driver')!;assert.equal(original.packId,'old-gold');
 const cold=new RoomAuthority({now:()=>now});cold.deserializeRoom(authority.serializeRoom(host.roomCode)!);
 cold.applyProPasses(new Map([['pro-driver',{packId:'new-diamond',tier:'diamond'}]]));
 const restored=await cold.readSnapshot(host.roomCode,host.resumeToken);
 assert.equal(restored.ownState!.proTier,'gold');assert.deepEqual(cold.prepareProClaims(host.roomCode).find(claim=>claim.driverId==='pro-driver'),original);
});
