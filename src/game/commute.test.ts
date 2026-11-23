import test from 'node:test';
import assert from 'node:assert/strict';
import {commuteDestinationWeight,commuteIntensity} from './commute';
import {LANDMARK_BY_ID} from '../data/landmarks';
import {WORLD_EVENT_RESIDENTIAL_ANCHORS,getWorldEventSchedule} from '../../shared/worldEvents';

test('commute intensity peaks from 08 to 09 and tapers smoothly across the broad morning window',()=>{
  for(const minute of [0,389,390,630,800,NaN,Infinity])assert.equal(commuteIntensity(minute),0);
  for(const minute of [480,510,540])assert.equal(commuteIntensity(minute),1);
  assert.ok(commuteIntensity(435)>0&&commuteIntensity(435)<1);
  assert.ok(commuteIntensity(585)>0&&commuteIntensity(585)<1);
  assert.ok(Math.abs(commuteIntensity(479.999)-commuteIntensity(480))<1e-8);
  assert.ok(Math.abs(commuteIntensity(540.001)-commuteIntensity(540))<1e-8);
  assert.equal(commuteIntensity(510+1440),1);assert.equal(commuteIntensity(510-1440),1);
});
test('home to business gets a relative preference, transport a smaller feeder option, other choices stay possible',()=>{
  const residential={kind:'residential' as const};
  assert.equal(commuteDestinationWeight(residential,{kind:'business'},510),2.2);
  assert.equal(commuteDestinationWeight(residential,{kind:'transport'},510),1.3);
  assert.equal(commuteDestinationWeight(residential,{kind:'shopping'},510),1);
  assert.equal(commuteDestinationWeight({kind:'business'},{kind:'residential'},510),1);
  assert.equal(commuteDestinationWeight(residential,{kind:'business'},720),1);
});
test('every broad estate anchor is an existing authentic residential catalog record with its exact coordinate and a routing proxy',()=>{
  assert.equal(WORLD_EVENT_RESIDENTIAL_ANCHORS.length,6);
  for(const anchor of WORLD_EVENT_RESIDENTIAL_ANCHORS){
    const place=LANDMARK_BY_ID.get(anchor.id);assert.ok(place,anchor.id);assert.equal(place.kind,'residential');
    assert.equal(place.lat,anchor.lat);assert.equal(place.lon,anchor.lon);assert.ok(place.nodeId);
    assert.match(anchor.name,/一帶$/);assert.match(anchor.en,/area$/);
  }
});
test('morning events select genuine residential anchors deterministically without changing the common clock contract',()=>{
  const ids=new Set(WORLD_EVENT_RESIDENTIAL_ANCHORS.map(anchor=>anchor.id));let count=0;
  for(const start of [300,1020,0])for(const duration of [360,720,1440]as const){
    const events=getWorldEventSchedule(617,duration,start);assert.deepEqual(events,getWorldEventSchedule(617,duration,start));
    for(const event of events){if(!event.title.endsWith('通勤人潮'))continue;count++;assert.ok(ids.has(event.pickupPlaceId as any));
      const clock=((start+event.startsAt)%1440+1440)%1440;assert.ok(clock>=390&&clock<630);
      assert.ok(event.startsAt>=0&&event.endsAt<=duration);assert.ok(event.demandBoost>=1);
    }
  }
  assert.ok(count>0);
});
