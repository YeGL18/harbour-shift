import test from 'node:test';
import assert from 'node:assert/strict';
import {effectCue,isSoundCue,isInPlayRoute,isActualSoloPause,type EffectState} from './cues';
const driving:EffectState={session:'solo:fixture',inPlay:true,paused:false,phase:'cruising',servicing:false,completedTrips:0};
test('pausing a running game and continuing it produce distinct cues without poll repeats',()=>{
 const paused={...driving,paused:true};assert.equal(effectCue(driving,paused),'pause');assert.equal(effectCue(paused,{...paused}),undefined);assert.equal(effectCue(paused,driving),'resume');
 assert.equal(effectCue(null,paused),undefined);assert.equal(effectCue(paused,{...paused,session:'solo:different'}),undefined);
});
test('parking/rest and real service signal confirmed transitions without implying a paused clock',()=>{
 const rest={...driving,parking:'rest' as const};assert.equal(effectCue(driving,rest),'rest');assert.equal(rest.paused,false);assert.equal(effectCue(rest,{...rest}),undefined);
 assert.equal(effectCue(driving,{...driving,parking:'temporary'}),'park');assert.equal(effectCue(driving,{...driving,servicing:true,phase:'servicing'}),'service');
});
test('completion wins over a pause flag disappearing at settlement; replayed snapshots remain quiet',()=>{
 assert.equal(effectCue({...driving,paused:true},{...driving,phase:'ended'}),'complete');assert.equal(effectCue(driving,{...driving,completedTrips:1}),'complete');
 assert.equal(effectCue({...driving,completedTrips:1},{...driving,completedTrips:1}),undefined);
 assert.equal(effectCue(driving,{...driving,inPlay:false,paused:true}),undefined);
});
test('only new active events sound and arbitrary resource names are refused',()=>{
 assert.equal(effectCue(driving,{...driving,worldEventId:'concert-1'}),'event');assert.equal(effectCue({...driving,worldEventId:'concert-1'},{...driving,worldEventId:'concert-1'}),undefined);
 assert.equal(isSoundCue('../private-recording'),false);assert.equal(isSoundCue('pause'),true);
});
test('a solo menu pauses through the same visibility gate even without an explicit paused/planning flag',()=>{
 const flags={hasGame:true,phase:'cruising',online:false,loadingGate:false,paused:false,planning:false,shiftVisible:false};
 for(const route of ['Settings','Stations','Operations','OrderFeed']){
  const inPlay=isInPlayRoute(true,route,true);assert.equal(inPlay,true);
  const menu={...driving,inPlay,paused:isActualSoloPause({...flags,inPlay})};assert.equal(menu.paused,true);assert.equal(effectCue(driving,menu),'pause');assert.equal(effectCue(menu,{...menu}),undefined);assert.equal(effectCue(menu,driving),'resume');
 }
});
test('rooms, off-shift routes and menus opened from the garage never inherit a stale solo pause',()=>{
 for(const route of ['Garage','Summary','Room','RoomSetup','MultiplayerLobby','Leaderboard','Profile'])assert.equal(isInPlayRoute(true,route,true),false,route);
 assert.equal(isInPlayRoute(true,'Settings',false),false);assert.equal(isInPlayRoute(false,'Shift',true),false);
});
test('multiplayer menus, map loading, finished shifts and ordinary rest do not show the pause treatment',()=>{
 const flags={hasGame:true,phase:'cruising',inPlay:true,online:false,loadingGate:false,paused:false,planning:false,shiftVisible:false};
 assert.equal(isActualSoloPause({...flags,online:true}),false);assert.equal(isActualSoloPause({...flags,loadingGate:true}),false);assert.equal(isActualSoloPause({...flags,phase:'ended'}),false);
 assert.equal(isActualSoloPause({...flags,shiftVisible:true}),false,'Parking/rest does not itself pause game time');
 assert.equal(isActualSoloPause({...flags,shiftVisible:true,planning:true}),true);
});
