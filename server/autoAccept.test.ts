import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import {setup,envelope} from './validation';
import {coordinateDispatch,type DispatchDriver} from './dispatch';
import {driverStats} from './driverStats';
import {decodeState} from './codec';
import {createInitialState,setDispatchOffer} from '../src/game';
import type {GameState} from '../src/game/types';
import type {RoomSession,RoomAction} from '../shared/protocol';

test('automatic acceptance is an optional boolean preference and a validated policy action, not a client fare or claim',()=>{
  for(const value of [true,false]){assert.equal(setup({vehicleId:'kam-fung',autoAcceptOrders:value}).autoAcceptOrders,value);assert.deepEqual(envelope({seq:1,action:{type:'auto-accept',value}}).action,{type:'auto-accept',value});}
  assert.equal(setup({vehicleId:'kam-fung'}).autoAcceptOrders,undefined);
  for(const value of [0,1,'true',null,{},[]]){
    assert.throws(()=>setup({vehicleId:'kam-fung',autoAcceptOrders:value}),(error:any)=>error.code==='invalid_action');
    assert.throws(()=>envelope({seq:1,action:{type:'auto-accept',value}}),(error:any)=>error.code==='invalid_action');
  }
  assert.throws(()=>envelope({seq:1,action:{type:'auto-accept',value:true,estimatedFare:9999}}),(error:any)=>error.code==='unexpected_field');
});

test('automatic natural dispatch commits one winning trip, exclusive claim and authoritative accepted banner',()=>{
  const base=createInitialState({seed:20261118,dispatchManaged:true});
  const source={...createInitialState({seed:20261118}).currentOffer!,id:'natural-auto-passenger',requestedAt:0};
  const drivers:DispatchDriver[]=['driver-a','driver-b'].map(id=>({id,nickname:id,connected:true,left:false,forfeited:false,game:{...base,autoAcceptOrders:true,currentOffer:null,observedOffers:[source]}}));
  const claims=new Map<string,string>();const wallTime=1_800_000_000_123;
  const first=coordinateDispatch(drivers,42,0,claims,undefined,wallTime);
  assert.equal(first.acceptedClaims.length,1);const claim=first.acceptedClaims[0];
  const winner=first.games.get(claim.playerId)!;assert.equal(winner.activeTrip!.offer.id,source.id);assert.equal(winner.acceptedOffers,1);assert.equal(winner.currentOffer,null);
  assert.equal([...first.games.values()].reduce((sum,state)=>sum+state.acceptedOffers,0),1);
  const accepted=first.assignments.find(entry=>entry.offerId===source.id)!;
  assert.equal(accepted.status,'accepted');assert.equal(accepted.acceptedAt,wallTime);assert.equal(accepted.estimatedFare,winner.activeTrip!.offer.estimatedFare);assert.equal(accepted.pricingType,winner.activeTrip!.offer.pricingType);
  assert.ok(accepted.pickupLocality&&accepted.destinationLocality);assert.equal(accepted.pickupName,source.pickup.name);assert.equal(accepted.destinationNameEn,source.destination.nameEn);
  claims.set(claim.offerId,claim.playerId);
  const second=coordinateDispatch(drivers.map(driver=>({...driver,game:first.games.get(driver.id)!})),42,0,claims,first.state,wallTime+1000);
  assert.equal(second.acceptedClaims.length,0);assert.equal([...second.games.values()].reduce((sum,state)=>sum+state.acceptedOffers,0),1);
  assert.equal(second.assignments.find(entry=>entry.offerId===source.id)!.acceptedAt,wallTime);
});

async function room(){
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Host',featureVersion:'0.5',rules:{speed:60,density:'busy'}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Guest',featureVersion:'0.5'});
  const counters=new Map<string,number>();
  const send=async(session:RoomSession,action:RoomAction)=>{const seq=(counters.get(session.playerId)||0)+1;const result=await authority.handleCommand(session.roomCode,session.resumeToken,{seq,action});counters.set(session.playerId,seq);return result;};
  authority.attachDriver(host.roomCode,host.playerId,{driverId:'auto-driver',stats:driverStats({offered:0,accepted:0,cancelled:0,completedTrips:0},now)});
  await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});await send(host,{type:'start'});now+=3000;await authority.readSnapshot(host.roomCode,host.resumeToken);
  return{authority,host,guest,send,now:()=>now,add:(milliseconds:number)=>{now+=milliseconds;}};
}

test('enabling autoaccept on an existing assigned card claims it and credits the career ledger exactly once',async()=>{
  const m=await room();const offer={...createInitialState({seed:20261118}).currentOffer!,id:'toggle-auto-passenger',createdAt:0,requestedAt:0,expiresAt:5};
  const state=decodeState(m.authority.serializePlayerState(m.host.roomCode,m.host.playerId)!)as GameState;
  m.authority.deserializePlayerState(m.host.roomCode,m.host.playerId,JSON.stringify(setDispatchOffer(setDispatchOffer(state,null),offer)));
  const stored=JSON.parse(m.authority.serializeRoom(m.host.roomCode)!);
  stored.metadata.dispatchState.assignments=[{offerId:offer.id,pickupName:offer.pickup.name,destinationName:offer.destination.name,playerId:m.host.playerId,nickname:'Host',assignedAt:0,expiresAt:5,status:'offered',competitors:2,declinedPlayerIds:[]}];
  m.authority.deserializeRoom(JSON.stringify(stored));m.authority.prepareDriverDeltas(m.host.roomCode);
  const accepted=await m.send(m.host,{type:'auto-accept',value:true});
  assert.equal(accepted.ownState!.autoAcceptOrders,true);assert.equal(accepted.ownState!.activeTrip!.offer.id,offer.id);assert.equal(accepted.ownState!.acceptedOffers,1);
  const event=accepted.room.competition!.assignments.find(entry=>entry.offerId===offer.id)!;assert.equal(event.status,'accepted');assert.equal(event.acceptedAt,m.now());assert.equal(event.estimatedFare,offer.estimatedFare);
  const retry=await m.authority.handleCommand(m.host.roomCode,m.host.resumeToken,{seq:3,action:{type:'auto-accept',value:true}});
  assert.equal(retry.ownState!.acceptedOffers,1);assert.equal(retry.room.competition!.assignments.find(entry=>entry.offerId===offer.id)!.acceptedAt,event.acceptedAt);
  const deltas=m.authority.prepareDriverDeltas(m.host.roomCode);assert.equal(deltas.find(delta=>delta.driverId==='auto-driver')!.counters.accepted,1);
  assert.ok(m.authority.prepareDriverDeltas(m.host.roomCode).every(delta=>Object.values(delta.counters).every(value=>value===0)));
  const disabled=await m.send(m.host,{type:'auto-accept',value:false});assert.equal(disabled.ownState!.autoAcceptOrders,false);assert.equal(disabled.ownState!.activeTrip!.offer.id,offer.id);assert.equal(disabled.ownState!.acceptedOffers,1);
});

test('old feature rooms retain manual shared claims and do not silently enable the new automatic policy',async()=>{
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Legacy Host',setup:{vehicleId:'kam-fung',autoAcceptOrders:true}});
  const guest=await authority.joinRoom(host.roomCode,{nickname:'Legacy Guest',setup:{vehicleId:'kam-fung',autoAcceptOrders:true}});
  assert.ok(guest.snapshot.room.players.every(player=>player.autoAcceptOrders===false));
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:1,action:{type:'ready',ready:true}});await authority.handleCommand(guest.roomCode,guest.resumeToken,{seq:1,action:{type:'ready',ready:true}});
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:2,action:{type:'start'}});now+=3000;
  const snapshot=await authority.readSnapshot(host.roomCode,host.resumeToken);assert.equal(snapshot.ownState!.autoAcceptOrders,false);assert.equal(snapshot.ownState!.acceptedOffers,0);
  await assert.rejects(()=>authority.handleCommand(host.roomCode,host.resumeToken,{seq:3,action:{type:'auto-accept',value:true}}),(error:any)=>error.code==='room_version');
  const accepted=await authority.handleCommand(host.roomCode,host.resumeToken,{seq:3,action:{type:'accept',offerId:snapshot.ownState!.currentOffer!.id}});assert.equal(accepted.ownState!.acceptedOffers,1);
});
