import test from 'node:test';
import assert from 'node:assert/strict';
import type { Room, RoomPlayer } from '../../shared/protocol';
import { getRoomReadiness } from './roomPresentation';
const player=(id:string,teamId?:'A'|'B'):RoomPlayer=>({id,nickname:id,vehicleId:'kam-fung',ready:true,connected:true,status:'lobby',joinedAt:0,teamId});
const room=(players:RoomPlayer[]):Room=>({code:'ABC234',hostPlayerId:'a',mode:'team-net',shift:'day',speed:60,density:'busy',shiftDurationMinutes:360,startTimeMinutes:300,status:'lobby',seed:1,clockMinutes:0,players,createdAt:0,expiresAt:1e9});
test('team start requires exactly four connected/ready players split two and two',()=>{
  assert.equal(getRoomReadiness(room([player('a','A'),player('b','A'),player('c','B'),player('d','B')]),'a').canStart,true);
  for(const players of [[player('a','A'),player('b','B')],[player('a','A'),player('b','A'),player('c','A'),player('d','B')],[player('a','A'),player('b','A'),player('c','B'),player('d')]])assert.equal(getRoomReadiness(room(players),'a').canStart,false);
});
test('team selection cannot conceal the existing pending-time/connection readiness constraints',()=>{
  const value=room([player('a','A'),player('b','A'),player('c','B'),player('d','B')]);
  assert.equal(getRoomReadiness(value,'a',{timeChanged:true}).canStart,false);
  value.players[1].connected=false;assert.equal(getRoomReadiness(value,'a').canStart,false);
});
