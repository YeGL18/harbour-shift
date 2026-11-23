import assert from 'node:assert/strict';
import test from 'node:test';
import {HornPlayback} from './horns';
import type {HornEvent,HornView} from '../../shared/horns';
const pulse=(id:string,senderId=id):HornEvent=>({id,senderId,startedAt:1000,activeUntil:4500,gain:.5});
function fixture(){const started:Array<{id:string;gain:number}>=[],stopped:string[]=[];return{started,stopped,playback:new HornPlayback({startHorn:(id,gain)=>started.push({id,gain}),stopHorn:id=>stopped.push(id)})};}
const view=(events:HornEvent[]):HornView=>({available:true,events});
test('separate simultaneous senders overlap and stopping one leaves the other audible',()=>{
 const f=fixture();f.playback.sync(view([pulse('a'),pulse('b')]),'self',1000,1000,1000);assert.equal(f.started.length,2);
 f.playback.sync(view([{...pulse('a'),endedAt:1500},pulse('b')]),'self',1500,1500,1500);assert.deepEqual(f.stopped,['remote:a']);assert.ok(!f.stopped.includes('remote:b'));
});
test('short completed pulses play once, own echo is silent and expired old pulses never replay',()=>{
 const f=fixture(),ended={...pulse('tap'),endedAt:1300};f.playback.sync(view([ended,pulse('own','self')]),'self',1400,1400,1400);assert.equal(f.started.length,1);
 f.playback.sync(view([ended]),'self',1800,1800,1800);assert.deepEqual(f.stopped,['remote:tap']);f.playback.sync(view([ended]),'self',1900,1900,1900);assert.equal(f.started.length,1);
 f.playback.sync(view([{...pulse('old'),endedAt:1100}]),'self',5000,5000,5000);assert.equal(f.started.length,1);
});
test('holds renew without restarting on every animation tick, update falloff, expire and reset cleanly',()=>{
 const f=fixture();f.playback.sync(view([pulse('hold')]),'self',1000,1000,1000);f.playback.sync(view([pulse('hold')]),'self',1000,1000,1100);assert.equal(f.started.length,1);
 f.playback.sync(view([{...pulse('hold'),gain:.2}]),'self',1500,1500,1500);assert.equal(f.started.length,2);assert.equal(f.started.at(-1)!.gain,.2);
 f.playback.sync(view([pulse('hold')]),'self',5000,5000,5000);assert.ok(f.stopped.includes('remote:hold'));f.playback.reset();
 f.playback.sync(view([{...pulse('new'),startedAt:5000,activeUntil:8500}]),'self',5000,5000,5000);f.playback.stop();assert.equal(f.stopped.at(-1),'remote:new');
});
test('a still-held horn resumes on range re-entry or unmute without replaying completed pulses',()=>{
 const f=fixture(),held=pulse('held');f.playback.sync(view([held]),'self',1000,1000,1000);
 f.playback.sync(view([]),'self',1200,1200,1200);assert.deepEqual(f.stopped,['remote:held']);
 f.playback.sync(view([held]),'self',1300,1300,1300);assert.equal(f.started.length,2,'returning within audible range restores an active hold');
 f.playback.stop();f.playback.sync(view([held]),'self',1400,1400,1400);assert.equal(f.started.length,3,'unmuting restores the active voice');
 f.playback.sync(view([{...held,endedAt:1500}]),'self',1500,1500,1500);
 f.playback.sync(view([{...held,endedAt:1500}]),'self',1600,1600,1600);assert.equal(f.started.length,3,'release never becomes a fresh short pulse');
});
