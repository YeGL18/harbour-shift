import assert from 'node:assert/strict';
import test from 'node:test';
import {conditionsFromSupplyDemand,demandConditions,surgeAreasFor} from './demandField';
import type {GameState,Landmark} from './types';

const places:Landmark[]=Array.from({length:80},(_,i)=>({id:`p${i}`,name:`地點${i}`,district:'測試區',kind:i%3?'residential':'transport',lat:22.30+(i%8)*.0003,lon:114.16+Math.floor(i/8)*.0003}));
test('surge follows demand relative to supply; no demand cannot create surge',()=>{
 assert.equal(conditionsFromSupplyDemand(0,0).multiplier,1);assert.equal(conditionsFromSupplyDemand(0,0).arrivalWeight,0);
 const multipliers=[1,3,6,12,24].map(supply=>conditionsFromSupplyDemand(10,supply).multiplier);
 for(let i=1;i<multipliers.length;i++)assert.ok(multipliers[i]<=multipliers[i-1]);assert.ok(multipliers[0]>multipliers.at(-1)!);
 assert.equal(conditionsFromSupplyDemand(4,3).waitMinutesMin,1);assert.equal(conditionsFromSupplyDemand(10,2).waitMinutesMin,1);
});
test('extra available drivers reduce price pressure without erasing seeded passenger arrivals',()=>{
 const position=places[0],context={position,landmarks:places};
 for(let minute=0;minute<180;minute+=3){const a=demandConditions(123,minute,'測試區',context),b=demandConditions(123,minute,'測試區',{...context,supply:[{position,availableDrivers:20}]});
  assert.equal(a.demandPerMinute,b.demandPerMinute);assert.equal(a.arrivalWeight,b.arrivalWeight);assert.equal(a.requestIntervalMinutes,b.requestIntervalMinutes);assert.ok(b.multiplier<=a.multiplier);assert.ok(b.availableDrivers>a.availableDrivers);
 }
});
test('broad demand anchors stay in place across time and remain deterministic',()=>{
 const state={landmarks:places,seed:411,startTimeMinutes:455,clockMinutes:0}as GameState;
 const a=surgeAreasFor(state),again=surgeAreasFor({...state});assert.deepEqual(a,again);assert.ok(a.length);
 const b=surgeAreasFor({...state,clockMinutes:1});assert.equal(a[0].id,b[0].id);assert.deepEqual(a.map(area=>area.center),b.map(area=>area.center));
 for(const area of [...a,...b]){assert.ok(area.radiusM!>=900);assert.ok(area.radiusM!<=4500);assert.ok(area.waitMinutesMin>=1&&area.waitMinutesMax<=10);assert.ok(area.intensity!>0&&area.intensity!<=1);}
});
test('identical seed, district, time and supply give identical shared demand conditions',()=>{
 for(let seed=0;seed<20;seed++)for(const minute of [0,455,718,1000])assert.deepEqual(demandConditions(seed,minute,'油尖旺區'),demandConditions(seed,minute,'油尖旺區'));
});
