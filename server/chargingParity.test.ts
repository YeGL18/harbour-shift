import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomAuthority} from './authority';
import {createInitialState,navigateToHandover,navigateToStation,configureSharedFuelQueues} from '../src/game';
import {getCompatibleStations} from '../src/data/serviceStations';
import {selectChargingOption} from '../src/game/charging';
import {ENERGY_PROFILE_DEFAULTS} from '../src/data/serviceStations';
import type {GameState,Landmark} from '../src/game/types';
import type {ActionEnvelope,RoomSession} from '../shared/protocol';
async function fixture(){
 let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
 const host=await authority.createRoom({nickname:'Charge host',featureVersion:'0.6',vehicleCatalogVersion:1,setup:{vehicleId:'tesla-model-3'},rules:{speed:60,shiftDurationMinutes:360}}),guest=await authority.joinRoom(host.roomCode,{nickname:'Legacy car guest',featureVersion:'0.6',vehicleCatalogVersion:1});
 const seq=new Map<string,number>();const send=async(session:RoomSession,action:ActionEnvelope['action'])=>{const number=(seq.get(session.playerId)||0)+1,snapshot=await authority.handleCommand(session.roomCode,session.resumeToken,{seq:number,action});seq.set(session.playerId,number);return snapshot;};
 await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});const loading=await send(host,{type:'start'});await send(host,{type:'map-ready',epoch:loading.room.loading!.epoch,ready:true});await send(guest,{type:'map-ready',epoch:loading.room.loading!.epoch,ready:true});now+=3000;await authority.readSnapshot(host.roomCode,host.resumeToken);
 const station=getCompatibleStations('tesla-model-3').find(station=>(selectChargingOption(ENERGY_PROFILE_DEFAULTS['tesla-model-3'],station,'tesla-model-3')?.powerKw||0)>=50)!;assert.ok(station);
 const place:Landmark={...station,kind:'transport',district:station.district||'',nodeId:station.nodeId};
 const hostBase=createInitialState({vehicleId:'tesla-model-3',startNodeId:station.nodeId,handoverPlace:place,initialEnergyFraction:.95,dispatchManaged:true,xlOrdersEnabled:true,shiftDurationMinutes:360,seed:28});
 const hostCharging=configureSharedFuelQueues(navigateToStation({...hostBase,clockMinutes:359.8,acceptingOrders:false},station),host.playerId);assert.equal(hostCharging.phase,'servicing');
 const guestBase=createInitialState({vehicleId:'kam-fung',dispatchManaged:true,shiftDurationMinutes:360});const guestFinished=navigateToHandover(guestBase);assert.equal(guestFinished.phase,'ended');
 const stored=JSON.parse(authority.serializeRoom(host.roomCode)!);stored.metadata.room.clockMinutes=359.8;stored.metadata.lastTickAt=now;
 for(const entry of stored.states)entry.state=JSON.stringify(entry.id===host.playerId?hostCharging:guestFinished);
 let restored=new RoomAuthority({now:()=>now});restored.deserializeRoom(JSON.stringify(stored));
 return{host,guest,station,now:()=>now,add:(ms:number)=>{now+=ms;},get authority(){return restored;},restart(){const saved=restored.serializeRoom(host.roomCode)!;restored=new RoomAuthority({now:()=>now});restored.deserializeRoom(saved);}};
}

test('shared partial charge after cutoff survives restart, cancellation is seq-idempotent and cannot receive a late-full ranking',async()=>{
 const match=await fixture();match.add(400);let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(snapshot.room.status,'running');assert.ok(snapshot.ownState!.deadlineSettlement);assert.equal(snapshot.ownState!.phase,'servicing');const paid=snapshot.ownState!.operatingCost;
 match.restart();snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);const envelope:ActionEnvelope={seq:snapshot.you.lastInputSeq+1,action:{type:'cancel-charge'}};
 const cancelled=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,envelope);assert.equal(cancelled.room.status,'finished');assert.equal(cancelled.ownState!.shiftEndReason,'fuel-cancelled-late');assert.equal(cancelled.ownState!.lastChargeReceipt!.completed,false);assert.equal(cancelled.ownState!.operatingCost,paid);assert.equal(cancelled.leaderboard.find(player=>player.playerId===match.host.playerId)!.rank,null);assert.equal(cancelled.room.players.find(player=>player.id===match.host.playerId)!.forfeited,true);
 const duplicate=await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,envelope);assert.equal(duplicate.ownState!.operatingCost,paid);assert.deepEqual(duplicate.ownState!.lastChargeReceipt,cancelled.ownState!.lastChargeReceipt);
});

test('shared late completed charging keeps actual net, full SOC, one receipt and late-qualified ranking across restoration',async()=>{
 const match=await fixture();let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
 for(let tick=0;tick<25&&snapshot.ownState!.phase!=='ended';tick++){match.add(1000);snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);if(tick===1)match.restart();}
 const state=snapshot.ownState!;assert.equal(state.phase,'ended');assert.equal(snapshot.room.status,'finished');assert.equal(state.shiftEndReason,'fuel-completed-late');assert.equal(state.lastChargeReceipt!.completed,true);assert.ok(Math.abs(state.energy.remaining-state.energy.capacity)<1e-8,'SOC reaches100% within floating-point tolerance');assert.ok(state.operatingCost>0);assert.equal(Math.round(state.operatingCost*100)/100,state.lastChargeReceipt!.billedCost);assert.equal(state.netIncome,Math.round((state.grossIncome-state.rentalCostApplied-state.operatingCost)*100)/100);
 const player=snapshot.room.players.find(player=>player.id===match.host.playerId)!;assert.equal(player.forfeited,false);assert.equal(player.late,true);assert.notEqual(snapshot.leaderboard.find(player=>player.playerId===match.host.playerId)!.rank,null);assert.equal(state.logs.filter(log=>log.text.startsWith('充電完成')).length,1);
 match.restart();const restored=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.deepEqual(restored.ownState!.lastChargeReceipt,state.lastChargeReceipt);assert.equal(restored.ownState!.operatingCost,state.operatingCost);
});
