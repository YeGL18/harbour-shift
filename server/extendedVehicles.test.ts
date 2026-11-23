/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomAuthority} from './authority';
import {setup} from './validation';
import {coordinateDispatch,type DispatchDriver} from './dispatch';
import {acceptOffer,createInitialState,quoteWorldOffer} from '../src/game';
import {VEHICLE_BY_ID} from '../src/data/vehicles';
import {estimateDriverPayout} from '../src/data/fares';
import type {Offer,VehicleId} from '../src/game/types';
import type {RoomSession,RoomAction} from '../shared/protocol';

const failure=(code:string)=>(error:any)=>error.code===code;

test('room-latched catalog capability gates create, join, lobby setup and downgraded-session reads',async()=>{
 let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
 const old=await authority.createRoom({nickname:'舊房',featureVersion:'0.6'});
 assert.equal(old.snapshot.room.vehicleCatalogVersion,undefined);
 await assert.rejects(()=>authority.createRoom({nickname:'無能力新車',featureVersion:'0.6',setup:{vehicleId:'tesla-model-3'}}),failure('room_version'));
 await assert.rejects(()=>authority.createRoom({nickname:'舊規則新車',featureVersion:'0.5',vehicleCatalogVersion:1,setup:{vehicleId:'tesla-model-3'}}),failure('room_version'));
 await assert.rejects(()=>authority.joinRoom(old.roomCode,{nickname:'新app舊房',featureVersion:'0.6',vehicleCatalogVersion:1,setup:{vehicleId:'alphard-hybrid'}}),failure('room_version'));
 await assert.rejects(()=>authority.handleCommand(old.roomCode,old.resumeToken,{seq:1,action:{type:'setup',setup:{vehicleId:'mg4-trophy'}}}),failure('room_version'));
 const host=await authority.createRoom({nickname:'新房',featureVersion:'0.6',vehicleCatalogVersion:1,setup:{vehicleId:'alphard-hybrid'}});
 assert.equal(host.snapshot.room.vehicleCatalogVersion,1);
 await assert.rejects(()=>authority.joinRoom(host.roomCode,{nickname:'舊客戶',featureVersion:'0.6'}),failure('room_version'));
 await assert.rejects(()=>authority.joinRoom(host.roomCode,{nickname:'未知版本',featureVersion:'0.6',vehicleCatalogVersion:2 as any}),failure('room_version'));
 const guest=await authority.joinRoom(host.roomCode,{nickname:'新客戶',featureVersion:'0.6',vehicleCatalogVersion:1,setup:{vehicleId:'tesla-model-y'}});
 const seq=new Map<string,number>();const send=(session:RoomSession,action:RoomAction)=>authority.handleCommand(session.roomCode,session.resumeToken,{seq:(seq.set(session.playerId,(seq.get(session.playerId)||0)+1),seq.get(session.playerId)!),action});
 await send(host,{type:'ready',ready:true});await send(guest,{type:'ready',ready:true});const loading=await send(host,{type:'start'});const epoch=loading.room.loading!.epoch;
 await send(host,{type:'map-ready',epoch,ready:true});await send(guest,{type:'map-ready',epoch,ready:true});now+=3001;
 const started=await authority.readSnapshot(host.roomCode,host.resumeToken);assert.equal(started.room.status,'running');assert.equal(started.ownState?.xlOrdersEnabled,true);assert.equal(started.ownState?.vehicleId,'alphard-hybrid');
 assert.throws(()=>authority.requireVehicleCatalog(host.roomCode,undefined),failure('room_version'));assert.doesNotThrow(()=>authority.requireVehicleCatalog(host.roomCode,1));assert.doesNotThrow(()=>authority.requireVehicleCatalog(old.roomCode,undefined));
 const serialized=authority.serializeRoom(host.roomCode)!;const restored=new RoomAuthority({now:()=>now});restored.deserializeRoom(serialized);const snapshot=await restored.readSnapshot(host.roomCode,host.resumeToken);assert.equal(snapshot.room.vehicleCatalogVersion,1);assert.equal(snapshot.ownState?.xlOrdersEnabled,true);assert.equal(snapshot.room.players.find(player=>player.id===guest.playerId)?.vehicleId,'tesla-model-y');
 const forged=JSON.parse(serialized);delete forged.metadata.room.vehicleCatalogVersion;assert.throws(()=>new RoomAuthority({now:()=>now}).deserializeRoom(JSON.stringify(forged)),failure('invalid_saved_room'));
});

test('compatible forward rollback disables only new extended rooms, retaining reads of already issued catalog sessions',async()=>{
 const authority=new RoomAuthority();const host=await authority.createRoom({nickname:'新款既有房',featureVersion:'0.6',vehicleCatalogVersion:1,setup:{vehicleId:'vellfire-hybrid'}});const saved=authority.serializeRoom(host.roomCode)!;
 const rollback=new RoomAuthority({allowExtendedRooms:false});rollback.deserializeRoom(saved);assert.equal((await rollback.readSnapshot(host.roomCode,host.resumeToken)).room.players[0].vehicleId,'vellfire-hybrid');
 await assert.rejects(()=>rollback.createRoom({nickname:'暫停新款房',featureVersion:'0.6',vehicleCatalogVersion:1}),failure('room_version'));
 assert.equal((await rollback.createRoom({nickname:'舊制仍可開',featureVersion:'0.6'})).snapshot.room.vehicleCatalogVersion,undefined);
});

test('server accepts known model IDs but never trusts client-supplied capacity, eligibility or XL price',()=>{
 assert.equal(setup({vehicleId:'aion-y-plus-standard'}).vehicleId,'aion-y-plus-standard');
 for(const field of ['passengerCapacity','totalSeats','xlEligible','xlOrdersEnabled','estimatedFare','fareMultiplier'])assert.throws(()=>setup({vehicleId:'alphard-hybrid',[field]:999}),failure('unexpected_field'));
 assert.throws(()=>setup({vehicleId:'unverified-model'}),failure('invalid_vehicle'));
});

const base=createInitialState({seed:20261118,vehicleId:'alphard-hybrid',xlOrdersEnabled:true,startPlaceId:'harbour-city',handoverPlace:null,density:'busy'});
const source:Offer={...base.currentOffer!,id:'shared-xl-six',serviceType:'xl',passengerCount:6,pricingType:'private-xl',pricingLabel:'XL 六客平台單',requestedAt:0,estimatedFare:1};
function driver(id:string,vehicleId:VehicleId):DispatchDriver {
 const state=createInitialState({seed:20261118,vehicleId,xlOrdersEnabled:true,startPlaceId:'harbour-city',handoverPlace:null,dispatchManaged:true,density:'busy'});
 return{id,nickname:id,connected:true,left:false,forfeited:false,game:{...state,observedOffers:[source]}};
}

test('shared XL dispatch has only six-passenger vehicles in its eligible pool, one owner and authoritative payout',()=>{
 const drivers=[driver('taxi','kam-fung'),driver('tesla','tesla-model-y'),driver('aion','aion-y-plus-premium'),driver('alphard','alphard-hybrid'),driver('vellfire','vellfire-hybrid')];
 const result=coordinateDispatch(drivers,99,0,new Map());const owners=[...result.games].filter(([,game])=>game.currentOffer?.id===source.id);assert.equal(owners.length,1);assert.ok(['alphard','vellfire'].includes(owners[0][0]));
 const assignment=result.assignments.find(assignment=>assignment.offerId===source.id)!;assert.equal(assignment.competitors,2);assert.equal(assignment.passengerCount,6);assert.equal(assignment.serviceType,'xl');
 const quoted=owners[0][1].currentOffer!;const standard=estimateDriverPayout(VEHICLE_BY_ID[owners[0][1].vehicleId],quoted.tripDistanceM,quoted.tripMinutes,quoted.surge,'private-upfront');assert.equal(quoted.estimatedFare,Math.round(standard*1.3*100)/100);assert.notEqual(quoted.estimatedFare,source.estimatedFare);
 const accepted=acceptOffer(owners[0][1]);assert.equal(accepted.activeTrip?.offer.id,source.id);assert.equal(accepted.acceptedOffers,1);
 const claimed=coordinateDispatch(drivers,99,0,new Map([[source.id,owners[0][0]]]),result.state);assert.ok([...claimed.games.values()].every(game=>game.currentOffer?.id!==source.id));
 const tooMany={...source,passengerCount:7};assert.equal(quoteWorldOffer(drivers[3].game,tooMany),null);
 const legacy=driver('legacy-van','alphard-hybrid');legacy.game={...legacy.game,xlOrdersEnabled:false};assert.equal(coordinateDispatch([legacy],99,0,new Map()).games.get('legacy-van')!.currentOffer,null);
});

test('both newly eligible XL drivers retain a positive opportunity across a shared request queue',()=>{
 const entrants=[driver('alphard','alphard-hybrid'),driver('vellfire','vellfire-hybrid'),driver('four-seat','tesla-model-3')];
 const counts={alphard:0,vellfire:0};let previous;
 for(let index=0;index<100;index++){
  const clock=index*.5,offer={...source,id:`xl-queue-${index}`,requestedAt:clock,createdAt:clock,expiresAt:clock+4};
  const current=entrants.map(entry=>({...entry,game:{...entry.game,clockMinutes:clock,observedOffers:[offer]}}));
  const result=coordinateDispatch(current,2211,clock,new Map(),previous);previous=result.state;
  const owners=[...result.games].filter(([,game])=>game.currentOffer?.id===offer.id);assert.equal(owners.length,1);assert.notEqual(owners[0][0],'four-seat');counts[owners[0][0] as keyof typeof counts]++;
 }
 assert.ok(counts.alphard>25&&counts.vellfire>25,JSON.stringify(counts));
});
