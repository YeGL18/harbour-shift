import test from 'node:test';
import assert from 'node:assert/strict';
import type { SharedDispatchAssignment } from '../../shared/protocol';
import { createPeerNoticeCache, createPeerNoticeState, peerNoticeNamespace, PEER_NOTICE_SEEN_LIMIT, selectPeerNotice } from './peerNotice';

const namespace=peerNoticeNamespace('ABC234','self');
const event=(offerId='offer',extra:Partial<SharedDispatchAssignment>={}):SharedDispatchAssignment=>({offerId,playerId:'peer',nickname:'Other driver',pickupName:'海港城',pickupNameEn:'Harbour City',destinationName:'MegaBox',assignedAt:99_000,acceptedAt:100_000,expiresAt:104_000,status:'accepted',competitors:2,estimatedFare:99.5,...extra});
const select=(previous=createPeerNoticeState(namespace),assignments=[event()],now=1000,serverTime=100_500,foreground=true)=>selectPeerNotice(previous,assignments,{namespace,ownPlayerId:'self',now,serverTime,foreground});

test('a new peer acceptance receives three real seconds regardless of repeat or server-clock progress',()=>{
  const first=select();
  assert.equal(first.current?.firstSeenAt,1000);
  assert.equal(first.current?.expiresAt,4000);
  const repeat=select(first,[event()],2500,100_900);
  assert.equal(repeat.current,first.current);
  const laterServer=select(repeat,[event()],3999,300_000);
  assert.equal(laterServer.current?.expiresAt,4000);
  assert.equal(select(laterServer,[event()],4000,300_001).current,null);
  assert.equal(select(first,[event()],9000,101_000).current,null);
});

test('own, unaccepted, stale and malformed events do not become peer notices',()=>{
  assert.equal(select(undefined,[event('own',{playerId:'self'})]).current,null);
  assert.equal(select(undefined,[event('pending',{status:'offered'})]).current,null);
  assert.equal(select(undefined,[event('expired',{status:'expired'})]).current,null);
  assert.equal(select(undefined,[event('stale',{acceptedAt:90_000})],1000,100_001).current,null);
  assert.equal(select(undefined,[event('broken',{acceptedAt:NaN})]).current,null);
  assert.ok(select(undefined,[event('boundary',{acceptedAt:90_000})],1000,100_000).current);
  const pending=select(undefined,[event('transition',{status:'offered'})]);
  assert.ok(select(pending,[event('transition')]).current);
});

test('legacy assignments fall back to their real assigned time without inventing fare fields',()=>{
  const legacy=event('legacy',{acceptedAt:undefined,estimatedFare:undefined});
  const result=select(undefined,[legacy]);
  assert.equal(result.current?.acceptedAt,99_000);
  assert.equal(result.current?.assignment.estimatedFare,undefined);
  assert.equal(select(undefined,[{...legacy,assignedAt:50_000}]).current,null);
});

test('a burst deterministically selects only the newest event and new accepts replace the visible one',()=>{
  const older=event('older',{acceptedAt:99_000}),newer=event('newer',{acceptedAt:100_000});
  assert.equal(select(undefined,[older,newer]).current?.assignment.offerId,'newer');
  assert.equal(select(undefined,[newer,older]).current?.assignment.offerId,'newer');
  const first=select(undefined,[older]);
  const replaced=select(first,[newer,older],2000);
  assert.equal(replaced.current?.assignment.offerId,'newer');
  assert.equal(replaced.current?.expiresAt,5000);
  assert.equal(select(replaced,[newer,older],5000).current,null);
  const a=event('a'),z=event('z');
  assert.equal(select(undefined,[z,a]).current?.key,select(undefined,[a,z]).current?.key);
});

test('late out-of-order events cannot replace a more recent notice or replay after its expiry',()=>{
  const current=select(undefined,[event('newer')]);
  const delayed=event('older',{acceptedAt:99_500});
  assert.equal(select(current,[delayed],2000).current?.assignment.offerId,'newer');
  assert.equal(select(current,[delayed],5000).current,null);
});

test('backgrounding clears the card and consumes background events without foreground replay',()=>{
  const first=select();
  const background=select(first,[event(),event('background',{acceptedAt:100_400})],1500,100_500,false);
  assert.equal(background.current,null);
  assert.equal(select(background,[event(),event('background',{acceptedAt:100_400})],1800).current,null);
  assert.ok(select(background,[event('fresh',{acceptedAt:100_500})],2000,100_600).current);
});

test('brief route remounts retain the original deadline and room/player namespaces stay separate',()=>{
  const cache=createPeerNoticeCache(2),first=select();cache.write(first);
  const remount=select(cache.read(namespace),[event()],2000);
  assert.equal(remount.current?.expiresAt,4000);
  assert.equal(select(remount,[event()],4000).current,null);
  const another=peerNoticeNamespace('OTHER2','self'),differentPlayer=peerNoticeNamespace('ABC234','another-self');
  assert.notEqual(namespace,another);assert.notEqual(namespace,differentPlayer);
  assert.equal(namespace,peerNoticeNamespace(' abc234 ','self'));
  cache.write(createPeerNoticeState(another));cache.write(createPeerNoticeState(differentPlayer));
  assert.equal(cache.size,2);
  assert.equal(cache.read(namespace).current,null);
});

test('large snapshots keep bounded seen memory without replaying the newest or discarded burst',()=>{
  const events=Array.from({length:300},(_,index)=>event('offer-'+index,{acceptedAt:100_000+index}));
  const first=select(undefined,events,1000,100_500);
  assert.equal(first.seen.length,PEER_NOTICE_SEEN_LIMIT);
  assert.equal(first.current?.assignment.offerId,'offer-299');
  const expired=select(first,events,5000,100_800);
  assert.equal(expired.current,null);
  assert.equal(expired.seen.length,PEER_NOTICE_SEEN_LIMIT);
  assert.equal(select(expired,[...events].reverse(),6000,100_900).current,null);
});
