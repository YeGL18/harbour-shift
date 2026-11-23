import test from 'node:test';
import assert from 'node:assert/strict';
import {syncSoloOfferWindow,isSoloOfferExpired} from './soloOfferWindow';
test('pause/planning freezes the remaining window and resume never grants a fresh five seconds',()=>{
  let window=syncSoloOfferWindow(null,'offer',1000,false);
  window=syncSoloOfferWindow(window,'offer',4000,true);
  window=syncSoloOfferWindow(window,'offer',14000,true);
  assert.equal(isSoloOfferExpired(window,14000),false);
  window=syncSoloOfferWindow(window,'offer',24000,false);
  assert.equal(window!.deadline,26000);assert.equal(isSoloOfferExpired(window,25999),false);assert.equal(isSoloOfferExpired(window,26000),true);
  assert.equal(syncSoloOfferWindow(window,'offer',25000,false),window);
});
test('pausing an already expired card cannot revive it and only a new offer gets a new window',()=>{
  let window=syncSoloOfferWindow(null,'old',0,false);window=syncSoloOfferWindow(window,'old',5100,true);window=syncSoloOfferWindow(window,'old',15100,false);
  assert.equal(isSoloOfferExpired(window,15100),true);
  assert.equal(syncSoloOfferWindow(window,'new',15100,false)!.deadline,20100);
  assert.equal(syncSoloOfferWindow(window,undefined,15100,false),null);
});
test('a restored offer first shown while paused keeps its untouched remainder across repeated toggles',()=>{
  let window=syncSoloOfferWindow(null,'saved',1000,true);window=syncSoloOfferWindow(window,'saved',11000,false);
  assert.equal(window!.deadline,16000);window=syncSoloOfferWindow(window,'saved',12000,true);window=syncSoloOfferWindow(window,'saved',22000,false);
  assert.equal(window!.deadline-22000,4000);
});
