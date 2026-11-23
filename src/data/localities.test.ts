/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalityDetails,getPlaceLocality,LOCALITY_ANCHORS } from './localities';
import { LANDMARKS,LANDMARK_BY_ID } from './landmarks';

test('fine locality anchors retain official IDs and include requested urban/new-town names',()=>{
  assert.equal(LOCALITY_ANCHORS.length,319);
  assert.equal(new Set(LOCALITY_ANCHORS.map(anchor=>anchor.id)).size,319);
  for(const name of ['尖沙咀','馬鞍山','荃灣','銅鑼灣','九龍灣','青衣','赤鱲角']){
    const anchor=LOCALITY_ANCHORS.find(anchor=>anchor.name===name)!;assert.ok(anchor,name);
    assert.equal(getPlaceLocality(anchor),name);assert.equal(getLocalityDetails(anchor).sourceRecordId,anchor.sourceRecordId);
  }
  assert.ok(!LOCALITY_ANCHORS.some(anchor=>anchor.name==='九龍'),'broad region is not a fine locality');
});

test('real introductory pickup/destination labels use fine official names instead of just administrative districts',()=>{
  assert.equal(getPlaceLocality(LANDMARK_BY_ID.get('harbour-city')!),'尖沙咀');
  assert.equal(getPlaceLocality(LANDMARK_BY_ID.get('megabox')!),'九龍灣');
  assert.equal(getPlaceLocality(LANDMARK_BY_ID.get('central')!),'中環');
});

test('administrative district constraint avoids using an across-harbour locality anchor',()=>{
  const hk={lat:22.2805,lon:114.184,district:'灣仔區'};
  assert.equal(getPlaceLocality(hk),'銅鑼灣');
  assert.equal(getLocalityDetails(hk).district,'灣仔區');
  const inferred=getLocalityDetails({lat:22.4191964,lon:114.2312569});
  assert.equal(inferred.name,'馬鞍山');assert.equal(inferred.district,'沙田區');
});

test('uncovered/invalid coordinates retain a deterministic district fallback and never invent place names',()=>{
  assert.equal(getPlaceLocality({lat:0,lon:0,district:'西貢區'}),'西貢區');
  assert.equal(getLocalityDetails({lat:0,lon:0,district:'西貢區'}).method,'district-fallback');
  assert.equal(getPlaceLocality({lat:NaN,lon:NaN,district:'荃灣區'}),'荃灣區');
  const names=new Set(LOCALITY_ANCHORS.map(anchor=>anchor.name));
  for(const place of LANDMARKS){const result=getLocalityDetails(place);assert.ok(result.method==='district-fallback'||names.has(result.name));assert.equal(result.district,place.district);}
});
