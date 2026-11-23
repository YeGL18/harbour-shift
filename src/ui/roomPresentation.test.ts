import test from 'node:test';
import assert from 'node:assert/strict';
import type { Room, RoomPlayer } from '../../shared/protocol';
import { getRoomReadiness } from './roomPresentation';

const player=(id:string,extra:Partial<RoomPlayer>={}):RoomPlayer=>({id,nickname:id,vehicleId:'kam-fung',startPlaceId:'start',handoverPlaceId:'finish',connected:true,ready:true,status:'lobby',joinedAt:0,...extra});
const room=(players=[player('host'),player('guest')],extra:Partial<Room>={}):Room=>({code:'ABC234',hostPlayerId:'host',mode:'highest-net',shift:'day',speed:30,density:'busy',startTimeMinutes:300,status:'lobby',seed:7,clockMinutes:0,players,createdAt:0,expiresAt:10000,...extra});

test('start follows the current server host and current connected readiness',()=>{
  assert.equal(getRoomReadiness(room(),'host').canStart,true);
  assert.equal(getRoomReadiness(room(),'guest').canStart,false);
  const transferred=room(undefined,{hostPlayerId:'guest'});
  assert.equal(getRoomReadiness(transferred,'host').canStart,false);
  assert.equal(getRoomReadiness(transferred,'guest').canStart,true);
  assert.equal(getRoomReadiness(room([player('host'),player('guest',{connected:false})]),'host').canStart,false);
  assert.equal(getRoomReadiness(room([player('host'),player('guest',{ready:false})]),'host').readyCount,1);
});

test('departed and forfeited roster entries do not count as waiting participants',()=>{
  const snapshot=room([player('host'),player('left',{status:'left'}),player('forfeit',{forfeited:true})]);
  const result=getRoomReadiness(snapshot,'host');
  assert.deepEqual(result.participants.map(item=>item.id),['host']);
  assert.equal(result.readyCount,1);
  assert.equal(result.canStart,false);
});

test('an unsaved or invalid host time cannot enable start, even when everyone is ready',()=>{
  assert.equal(getRoomReadiness(room(),'host',{timeChanged:true}).canStart,false);
  assert.equal(getRoomReadiness(room(),'host',{draftValid:false}).canStart,false);
  assert.equal(getRoomReadiness(room(),'host',{timeChanged:false,draftValid:true}).canStart,true);
});

test('countdown, running and finished rooms never expose another enabled start',()=>{
  for(const status of ['countdown','running','finished']as const){
    assert.equal(getRoomReadiness(room(undefined,{status}),'host').canStart,false);
  }
});

test('an eight-player lobby stays valid without deriving readiness optimistically',()=>{
  const players=Array.from({length:8},(_,index)=>player(index?'guest-'+index:'host'));
  assert.equal(getRoomReadiness(room(players),'host').canStart,true);
  players[7]={...players[7],ready:false};
  const result=getRoomReadiness(room(players),'host');
  assert.equal(result.readyCount,7);
  assert.equal(result.canStart,false);
});
