import assert from 'node:assert/strict';
import test from 'node:test';
import {chargingStationPresentation} from './chargingPresentation';
import type {EnergyStation} from '../data/serviceStations';
const station:EnergyStation={id:'charge',name:'測試充電站',nodeId:'n',lat:22.3,lon:114.16,kind:'charge',unitPrice:2,priceAsOf:'2026-11-20',chargingOptions:[{connector:'type2',powerKw:22,powerBasis:'game-reference',unitPrice:2,priceBasis:'official-reference'},{connector:'ccs2',powerKw:100,powerBasis:'game-reference',unitPrice:3.5,priceBasis:'official-reference'}]};
test('charging UI quotes the selected compatible port instead of a different cheaper socket',()=>{
 const view=chargingStationPresentation('tesla-model-3',station)!;assert.equal(view.connector,'CCS2 DC');assert.equal(view.powerKw,100);assert.equal(view.unitPrice,3.5);assert.equal(view.priceSource,'official-reference');assert.equal(view.priceAsOf,'2026-11-20');assert.equal(view.modelledPower,true);
 const modelS=chargingStationPresentation('tesla-model-s',station)!;assert.equal(modelS.connector,'Type2 AC');assert.equal(modelS.powerKw,11);assert.equal(modelS.unitPrice,2);
});
test('zero custom price is retained and unknown prices remain game references',()=>{
 assert.equal(chargingStationPresentation('mg4-trophy',station,0)!.unitPrice,0);assert.equal(chargingStationPresentation('mg4-trophy',station,0)!.priceSource,'custom');
 const unknown={...station,priceBasis:'game-reference' as const,chargingOptions:[{connector:'ccs2' as const,powerKw:50,powerBasis:'game-reference' as const}]};assert.equal(chargingStationPresentation('mg4-trophy',unknown)!.priceSource,'game-reference');assert.equal(chargingStationPresentation('private',station),null);
 const mixed={...station,priceBasis:'official-reference' as const,chargingOptions:[{connector:'ccs2' as const,powerKw:50,powerBasis:'game-reference' as const,unitPrice:3,priceBasis:'game-reference' as const}]};assert.equal(chargingStationPresentation('mg4-trophy',mixed)!.priceSource,'game-reference','another socket reference must not relabel the selected game-priced port');
});
