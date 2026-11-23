import test from 'node:test';
import assert from 'node:assert/strict';
import {isCurrentMapReady,reportMapReadiness,soloMayRun,type MapReadiness} from './mapReadiness';
import {syncSoloOfferWindow,isSoloOfferExpired} from './soloOfferWindow';

test('only the current session and map instance can release readiness; an error requires a new retry',()=>{
  const current:MapReadiness={session:'shift-b',instance:'map-2',status:'loading'};
  assert.equal(reportMapReadiness(current,'shift-a','map-2','ready'),current);
  assert.equal(reportMapReadiness(current,'shift-b','map-1','ready'),current);
  const ready=reportMapReadiness(current,'shift-b','map-2','ready');
  assert.equal(isCurrentMapReady(ready,'shift-b'),true);assert.equal(isCurrentMapReady(ready,'shift-a'),false);
  const error=reportMapReadiness(ready,'shift-b','map-2','error');
  assert.equal(reportMapReadiness(error,'shift-b','map-2','ready'),error);
  assert.equal(reportMapReadiness(error,'shift-b','map-2','loading'),error);
  assert.equal(isCurrentMapReady({session:'shift-b',instance:'map-3',status:'loading'},'shift-b'),false);
});
test('solo movement requires actual map readiness, foreground, visible Shift and no user pause',()=>{
  const active={online:false,paused:false,planning:false,foreground:true,visible:true,mapReady:true,startupPending:false};
  assert.equal(soloMayRun(active),true);
  for(const key of ['paused','planning','online','startupPending']as const)assert.equal(soloMayRun({...active,[key]:true}),false,key);
  for(const key of ['foreground','visible','mapReady']as const)assert.equal(soloMayRun({...active,[key]:false}),false,key);
});
test('loading, background and retry share the original offer remainder rather than refreshing it',()=>{
  let window=syncSoloOfferWindow(null,'offer-1',0,false);
  window=syncSoloOfferWindow(window,'offer-1',1200,true);
  window=syncSoloOfferWindow(window,'offer-1',26_000,true); // native error / retry
  window=syncSoloOfferWindow(window,'offer-1',31_000,false);
  assert.equal(window!.deadline,34_800);assert.equal(window!.deadline-31_000,3800);
  assert.equal(isSoloOfferExpired(window,34_799),false);assert.equal(isSoloOfferExpired(window,34_800),true);
});
