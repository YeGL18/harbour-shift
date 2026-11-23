import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkTaskRunner}from './networkTask';
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness(){const busy:Array<string|null>=[],errors:Array<string|null>=[];return{busy,errors,runner:createNetworkTaskRunner({busy:key=>busy.push(key),error:value=>errors.push(value)})};}
test('a request resolving after screen unmount never navigates or updates React state',async()=>{
  const h=harness(),pending=deferred<number>();let navigations=0;
  const result=h.runner.run('ready',()=>pending.promise,()=>navigations++);h.runner.dispose();pending.resolve(42);
  assert.deepEqual(await result,{ok:true,value:42});assert.equal(navigations,0);assert.deepEqual(h.busy,['ready']);assert.deepEqual(h.errors,[null]);assert.equal(h.runner.isBusy(),false);
});
test('a late failure remains available to the caller without updating an unmounted screen',async()=>{
  const h=harness(),pending=deferred<void>(),error=new Error('offline');const result=h.runner.run('ready',()=>pending.promise);h.runner.dispose();pending.reject(error);
  assert.deepEqual(await result,{ok:false,reason:'error',error});assert.deepEqual(h.errors,[null]);assert.deepEqual(h.busy,['ready']);
});
test('old alert callbacks after unmount do not send a new leave and rapid duplicate taps send only once',async()=>{
  const h=harness(),pending=deferred<void>();let calls=0;
  const first=h.runner.run('leave',()=>{calls++;return pending.promise;});
  assert.deepEqual(await h.runner.run('leave',async()=>{calls++;}),{ok:false,reason:'busy'});
  h.runner.dispose();assert.deepEqual(await h.runner.run('leave',async()=>{calls++;}),{ok:false,reason:'unmounted'});
  pending.resolve();await first;assert.equal(calls,1);
});
test('offline exit has an independent lock while an ordinary room operation is unresolved',async()=>{
  const normal=harness(),exit=harness(),pending=deferred<void>();let left=0,navigated=0,lateNavigation=0;
  const operation=normal.runner.run('rules',()=>pending.promise,()=>lateNavigation++);
  assert.equal(normal.runner.isBusy(),true);
  await exit.runner.run('leave',async()=>{left++;},()=>{navigated++;normal.runner.dispose();exit.runner.dispose();});
  pending.resolve();await operation;assert.equal(left,1);assert.equal(navigated,1);assert.equal(lateNavigation,0);
});
