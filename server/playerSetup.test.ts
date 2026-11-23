import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import {setup} from './validation';
import {defaultSimulation} from './simulation';
import {getRentalCost} from '../src/data/vehicles';
import {energyProfileFor} from '../src/game/systems';
import type {RoomAction,RoomSession} from '../shared/protocol';

test('public player cost preferences accept zero and bounded finite numbers, with omitted defaults unchanged',()=>{
  assert.deepEqual(setup({vehicleId:'private'}),{vehicleId:'private'});
  for(const [key,maximum]of [['rentalOverride',100_000],['energyUnitPriceOverride',1_000]]as const){
    for(const value of [0,1.25,maximum])assert.equal(setup({vehicleId:'kam-fung',[key]:value})[key],value);
    for(const value of [-.01,maximum+.01,NaN,Infinity,-Infinity,null,'0',true,{},[]])assert.throws(()=>setup({vehicleId:'kam-fung',[key]:value}),(error:any)=>error.code==='invalid_cost'&&error.status===400);
  }
  assert.throws(()=>setup({vehicleId:'kam-fung',initialEnergyFraction:1}),(error:any)=>error.code==='unexpected_field');
});

test('simulation starts the selected vehicle with exact zero or custom public costs, and keeps omitted vehicle defaults',()=>{
  const rules={mode:'highest-net' as const,shift:'night' as const,speed:30 as const,density:'normal' as const};
  const zero=defaultSimulation.create({vehicleId:'private',rentalOverride:0,energyUnitPriceOverride:0},rules,42);
  assert.equal(zero.rentalCostApplied,0);assert.equal(zero.energy.unitPricePaid,0);assert.equal(zero.energy.unitPriceOverride,0);assert.equal(Math.abs(zero.netIncome),0);
  const custom=defaultSimulation.create({vehicleId:'little-treasure',rentalOverride:543.21,energyUnitPriceOverride:3.25},rules,42);
  assert.equal(custom.rentalCostApplied,543.21);assert.equal(custom.energy.unitPriceOverride,3.25);assert.equal(custom.energy.unitPricePaid,3.25);assert.equal(custom.netIncome,-543.21);
  const legacy=defaultSimulation.create({vehicleId:'kam-fung'},rules,42);
  assert.equal(legacy.rentalCostApplied,getRentalCost('kam-fung','night'));assert.equal(legacy.energy.unitPricePaid,energyProfileFor('kam-fung').unitPrice);assert.equal(legacy.energy.unitPriceOverride,undefined);
});

test('lobby create/join/edit publishes each player costs, resets only the editor ready, and locks after start',async()=>{
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Host',featureVersion:'0.5',setup:{vehicleId:'private',rentalOverride:0,energyUnitPriceOverride:0}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:'0.5',setup:{vehicleId:'little-treasure',rentalOverride:777,energyUnitPriceOverride:3.25}});
  const sequences=new Map<string,number>();
  const send=async(session:RoomSession,action:RoomAction)=>{const seq=(sequences.get(session.playerId)||0)+1;const value=await authority.handleCommand(session.roomCode,session.resumeToken,{seq,action});sequences.set(session.playerId,seq);return value;};
  await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});
  const edited=await send(host,{type:'setup',setup:{vehicleId:'kam-fung',rentalOverride:500,energyUnitPriceOverride:4.5}});
  const hostPlayer=edited.room.players.find(player=>player.id===host.playerId)!;const guestPlayer=edited.room.players.find(player=>player.id===guest.playerId)!;
  assert.equal(hostPlayer.vehicleId,'kam-fung');assert.equal(hostPlayer.rentalOverride,500);assert.equal(hostPlayer.energyUnitPriceOverride,4.5);assert.equal(hostPlayer.ready,false);
  assert.equal(guestPlayer.rentalOverride,777);assert.equal(guestPlayer.energyUnitPriceOverride,3.25);assert.equal(guestPlayer.ready,true);
  const cleared=await send(host,{type:'setup',setup:{vehicleId:'private'}});
  assert.equal(cleared.room.players.find(player=>player.id===host.playerId)!.rentalOverride,undefined);assert.equal(cleared.room.players.find(player=>player.id===host.playerId)!.energyUnitPriceOverride,undefined);
  await send(host,{type:'ready',ready:true});const started=await send(host,{type:'start'});
  assert.equal(started.ownState!.rentalCostApplied,getRentalCost('private','day'));assert.equal(started.ownState!.energy.unitPricePaid,energyProfileFor('private').unitPrice);
  for(const session of [host,guest])await assert.rejects(()=>send(session,{type:'setup',setup:{vehicleId:'private',rentalOverride:0,energyUnitPriceOverride:0}}),(error:any)=>error.code==='rules_locked');
  now+=3000;const peer=await authority.readSnapshot(host.roomCode,guest.resumeToken);
  assert.equal(peer.ownState!.rentalCostApplied,777);assert.equal(peer.ownState!.energy.unitPricePaid,3.25);assert.equal(peer.room.players.find(player=>player.id===guest.playerId)!.rentalOverride,777);
  await assert.rejects(()=>send(guest,{type:'setup',setup:{vehicleId:'private',rentalOverride:0}}),(error:any)=>error.code==='rules_locked');
});
