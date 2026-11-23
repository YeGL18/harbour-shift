import assert from 'node:assert/strict';
import test from 'node:test';
import type {RoadGraph} from '../src/game/types';
import {HORN_LIMITS,hornCorridorDistance,hornGain} from '../shared/horns';
import {applyHornAction,hornView,parseHornActions,pruneHorns} from './horns';
import {RoomAuthority} from './authority';

const graph:RoadGraph={nodes:{a:{id:'a',lat:22,lon:114},b:{id:'b',lat:22,lon:114.001},c:{id:'c',lat:22,lon:114.002},x:{id:'x',lat:22,lon:114},y:{id:'y',lat:22,lon:114.001}},outgoing:{a:['td-1-f'],b:['td-1-r','td-2-f'],c:[],x:['td-3-f'],y:[]},edges:{
  'td-1-f':{id:'td-1-f',from:'a',to:'b',lengthM:120,name:'測試街'},'td-1-r':{id:'td-1-r',from:'b',to:'a',lengthM:120,name:'測試街'},'td-2-f':{id:'td-2-f',from:'b',to:'c',lengthM:120,name:'測試街'},'td-3-f':{id:'td-3-f',from:'x',to:'y',lengthM:120,name:'測試街'},
}};
const at=(distance:number)=>distance<=120?{edgeId:'td-1-f',distanceOnEdgeM:distance}:{edgeId:'td-2-f',distanceOnEdgeM:distance-120};
test('horn proximity follows connected corridor, including opposite lane, never a 2D bridge crossing',()=>{
  assert.equal(hornCorridorDistance(at(10),at(190),graph),180);
  assert.equal(hornCorridorDistance(at(10),{edgeId:'td-1-r',distanceOnEdgeM:100},graph),10);
  assert.equal(hornCorridorDistance(at(10),{edgeId:'td-3-f',distanceOnEdgeM:10},graph),Infinity,'same names and identical 2D positions do not join disconnected roads');
  const bridge:RoadGraph={...graph,edges:{...graph.edges,'td-3-f':{...graph.edges['td-3-f'],from:'a',to:'b',elevation:1}}};
  assert.equal(hornCorridorDistance(at(10),{edgeId:'td-3-f',distanceOnEdgeM:10},bridge),Infinity,'source elevation prevents a bridge/surface false match even when rounded node keys coincide');
  assert.equal(hornCorridorDistance(at(0),at(240),graph),Infinity);
});
test('button precedes audible range and has a separate departure buffer',()=>{
  const participants=[{id:'a',eligible:true,position:at(0)},{id:'b',eligible:true,position:at(190)}];
  const records=applyHornAction([], 'b',{pressId:'press',pressed:true},1000);
  assert.deepEqual(hornView(records,'a',participants,graph,1000),{available:true,events:[]});
  participants[1].position=at(225);assert.equal(hornView(records,'a',participants,graph,1000,false).available,false);assert.equal(hornView(records,'a',participants,graph,1000,true).available,true);
  participants[1].position=at(231);assert.equal(hornView(records,'a',participants,graph,1000,true).available,false);
  assert.equal(hornGain(150),0);assert.ok(hornGain(20)>hornGain(100));
});
test('each press is distinct, holds renew, releases cannot restart, records are bounded and coordinate-free',()=>{
  let records=applyHornAction([], 'a',{pressId:'one',pressed:true},1000);
  records=applyHornAction(records,'a',{pressId:'one',pressed:true},2200);assert.equal(records.length,1);assert.equal(records[0].activeUntil,5700);
  records=applyHornAction(records,'a',{pressId:'one',pressed:false},2210);assert.equal(records[0].endedAt,2210);
  records=applyHornAction(records,'a',{pressId:'one',pressed:true},2300);assert.equal(records[0].endedAt,2210);
  records=applyHornAction(records,'a',{pressId:'two',pressed:true},2400);records=applyHornAction(records,'b',{pressId:'one',pressed:true},2400);assert.equal(records.length,3);
  for(let i=0;i<40;i++)records=applyHornAction(records,'a',{pressId:`more-${i}`,pressed:true},2500+i);assert.equal(records.length,HORN_LIMITS.maxRecords);
  assert.equal(pruneHorns(records,14000).length,0);
  const views=hornView(records,'receiver',[{id:'receiver',eligible:true,position:at(10)},{id:'a',eligible:true,position:at(20)}],graph,2600);
  assert.ok(views.events.length);assert.ok(!JSON.stringify(views).includes('edgeId'));assert.ok(!JSON.stringify(views).includes('pressId'));
});
test('short release has minimum sound duration and rejects forged sender/coordinates/times',()=>{
  const started=applyHornAction([],'a',{pressId:'short',pressed:true},1000);const stopped=applyHornAction(started,'a',{pressId:'short',pressed:false},1010);assert.equal(stopped[0].endedAt,1300);
  assert.deepEqual(parseHornActions({actions:[{pressId:'one',pressed:true},{pressId:'one',pressed:false}]}).length,2);
  for(const input of [{actions:[]},{actions:[{pressId:'x',pressed:true,senderId:'other'}]},{actions:[{pressId:'x',pressed:true,receivedAt:1}]},{actions:[{pressId:'../bad',pressed:true}]}])assert.throws(()=>parseHornActions(input));
});
test('authority horns authenticate, survive restore and never consume a game sequence or career event',async()=>{
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now});
  const host=await authority.createRoom({nickname:'Horn A',featureVersion:'0.6'}),guest=await authority.joinRoom(host.roomCode,{nickname:'Horn B',featureVersion:'0.6'});
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:1,action:{type:'ready',ready:true}});await authority.handleCommand(host.roomCode,guest.resumeToken,{seq:1,action:{type:'ready',ready:true}});
  const starting=await authority.handleCommand(host.roomCode,host.resumeToken,{seq:2,action:{type:'start'}}),epoch=starting.room.loading!.epoch;
  await authority.handleCommand(host.roomCode,host.resumeToken,{seq:3,action:{type:'map-ready',epoch,ready:true}});await authority.handleCommand(host.roomCode,guest.resumeToken,{seq:2,action:{type:'map-ready',epoch,ready:true}});now+=3000;
  const before=await authority.readSnapshot(host.roomCode,host.resumeToken);assert.equal(before.you.horn?.available,true);
  await assert.rejects(()=>authority.handleHorn(host.roomCode,'wrong',{actions:[{pressId:'p',pressed:true}]}),(e:any)=>e.status===401);
  const after=await authority.handleHorn(host.roomCode,host.resumeToken,{actions:[{pressId:'p',pressed:true},{pressId:'p',pressed:false}]});assert.equal(after.you.lastInputSeq,before.you.lastInputSeq);assert.equal(after.ownState?.acceptedOffers,before.ownState?.acceptedOffers);assert.equal(after.ownState?.presentedOffers,before.ownState?.presentedOffers);
  const received=await authority.readSnapshot(host.roomCode,guest.resumeToken);assert.equal(received.you.horn!.events.length,1);assert.equal(received.you.horn!.events[0].senderId,host.playerId);assert.equal('position'in received.you.horn!.events[0],false);
  await authority.handleHorn(host.roomCode,host.resumeToken,{actions:[{pressId:'stale',pressed:true}]},{receivedAt:now-2001});
  await authority.handleHorn(host.roomCode,host.resumeToken,{actions:[{pressId:'future',pressed:true}]},{receivedAt:now+1});
  assert.equal(JSON.parse(authority.serializeRoomMetadata(host.roomCode)!).horns.length,1,'delayed or future internal timing cannot create a late horn');
  const restored=new RoomAuthority({now:()=>now});restored.deserializeRoom(authority.serializeRoom(host.roomCode)!);const repeated=await restored.handleHorn(host.roomCode,host.resumeToken,{actions:[{pressId:'p',pressed:true}]});assert.equal(repeated.you.lastInputSeq,3);assert.equal(JSON.parse(restored.serializeRoomMetadata(host.roomCode)!).horns.length,1);
  const metadataOnly=new RoomAuthority({now:()=>now});metadataOnly.deserializeRoomMetadata(restored.serializeRoomMetadata(host.roomCode)!);const info=await metadataOnly.sessionInfo(host.roomCode,guest.resumeToken);assert.equal(info.horn!.events.length,1,'fast GET retains private recipient horn view without inflating game states');
});
