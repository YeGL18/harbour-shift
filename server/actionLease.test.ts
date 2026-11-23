import assert from 'node:assert/strict';
import test from 'node:test';
import {acquireActionLease} from './cloudflare/actionLease';

test('an action obtains the publisher lease when its commit releases it during the same HTTP wait',async()=>{
 let now=0,attempts=0;const lease={generation:'committed-generation',token:'exclusive-action'};
 const value=await acquireActionLease(async()=>{attempts++;now+=75;return now>=400?lease:null;},{now:()=>now,sleep:async milliseconds=>{now+=milliseconds;}});
 assert.equal(value,lease);assert.ok(attempts>1&&attempts<=8);assert.ok(now<=750);
});
test('a competing request that wins the release cannot be bypassed; the loser waits for another real lease',async()=>{
 let now=0,heldUntil=200,owner:'publisher'|'other-action'|null='publisher',actionAcquisitions=0;
 const value=await acquireActionLease(async()=>{now+=50;if(now>=heldUntil&&owner==='publisher'){owner='other-action';heldUntil=450;return null;}if(now<heldUntil)return null;owner=null;actionAcquisitions++;return{token:'our-action'};},{now:()=>now,sleep:async milliseconds=>{now+=milliseconds;}});
 assert.equal(value?.token,'our-action');assert.equal(actionAcquisitions,1);assert.ok(now>=450&&now<750);
});
test('a lock that remains held stops at the bounded deadline and returns busy without applying an action',async()=>{
 let now=0,attempts=0;const value=await acquireActionLease(async()=>{attempts++;now+=200;return null;},{now:()=>now,sleep:async milliseconds=>{now+=milliseconds;}});
 assert.equal(value,null);assert.equal(now,750);assert.equal(attempts,3);
});
test('storage or authorization failures propagate immediately and never become an acquired lease',async()=>{
 let attempts=0;const unauthorized=Object.assign(new Error('unauthorized'),{status:401});await assert.rejects(()=>acquireActionLease(async()=>{attempts++;throw unauthorized;}),error=>error===unauthorized);assert.equal(attempts,1);
});
