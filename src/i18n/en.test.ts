/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { EN_STRINGS,translateEnglish } from './en';
import { LANDMARK_BY_ID } from '../data/landmarks';
import { ORDER_RULE_NOTES,PRIVATE_FARE_SOURCE,TAXI_FARE_SOURCE,TAXI_METER_SOURCE } from '../data/fares';
import { VEHICLES } from '../data/vehicles';
const cjk=/[\u3400-\u9fff]/u;

test('English covers complete fare explanations and vehicle names, rather than only navigation labels',()=>{
  for(const text of [ORDER_RULE_NOTES,TAXI_FARE_SOURCE.assumption,PRIVATE_FARE_SOURCE.assumption,TAXI_METER_SOURCE.assumption,...VEHICLES.flatMap(vehicle=>[vehicle.name,vehicle.subtitle])]){
    const translated=cjk.test(text)?translateEnglish(text):text;
    assert.ok(translated,`missing ${text}`);assert.ok(!cjk.test(translated));
  }
  assert.ok(Object.keys(EN_STRINGS).length>=490);
  for(const value of Object.values(EN_STRINGS))assert.ok(!cjk.test(value),value);
});
test('dynamic order logs use the official English names of the actual POI records',()=>{
  const pickup=LANDMARK_BY_ID.get('harbour-city')!,destination=LANDMARK_BY_ID.get('megabox')!;
  assert.ok(pickup.nameEn&&destination.nameEn);
  assert.equal(translateEnglish(`接單 · 前往${pickup.name}`),`Request accepted · Go to ${pickup.nameEn}`);
  assert.equal(translateEnglish(`附近需求 · ${pickup.name} → ${destination.name}`),`Nearby request · ${pickup.nameEn} → ${destination.nameEn}`);
  assert.equal(translateEnglish(`的士平台預報單 · ${pickup.name} → ${destination.name}`),`Taxi upfront fare · ${pickup.nameEn} → ${destination.nameEn}`);
  assert.equal(translateEnglish('下個路口轉往彌敦道'),'At the next junction, take Nathan Road');
  assert.equal(translateEnglish('彌敦道 · 左轉'),'Nathan Road · Turn left');
});
test('specific dynamic phases take precedence over short unit and generic in-progress patterns',()=>{
  assert.equal(translateEnglish('海港城 · 已停車，乘客落車中'),'Harbour City · Stopped; passenger alighting');
  assert.equal(translateEnglish('西貢 · 模擬需求 1.6× · 約 2–3 分鐘派單'),'Sai Kung · Game demand 1.6× · Requests in about 2–3 min');
  assert.equal(translateEnglish('3 分鐘 · 1.2 公里接客'),'3 min · Pickup 1.2 km away');
  assert.equal(translateEnglish('已收更 · 完成 1 單'),'Shift ended · 1 trip');
  assert.equal(translateEnglish('已收更 · 完成 2 單'),'Shift ended · 2 trips');
});
test('English numeric and currency templates preserve values and translate every surrounding clause',()=>{
  assert.equal(translateEnglish('06:00 日更開更 · 車租 $480'),'06:00 Day shift started · Rental HK$480');
  assert.equal(translateEnglish('2–10 分鐘'),'2–10 min');
  assert.equal(translateEnglish('接受訂單，餘下5秒'),'Accept request; 5 seconds remaining');
  assert.equal(translateEnglish('接受 · 5 秒'),'Accept · 5 sec');
  assert.equal(translateEnglish('補充完成 · 30.0 L，參考補充金額 $137.1（耗用成本已入帳，不重複扣）'),'Refill complete · 30.0 L, reference cost HK$137.1 (usage is already accounted for; no second charge)');
  assert.equal(translateEnglish('遊戲平台規則：接單／取消紀錄觸發停權 3 小時；完成中的行程可繼續。'),'Game rule: acceptance or cancellation history triggered a 3-hour request suspension. The current trip can continue.');
});
test('nicknames remain verbatim even if they happen to match a translated Hong Kong place',()=>{
  assert.equal(translateEnglish('房主已轉交畀旺角。'),'旺角 is now the host.');
  assert.equal(translateEnglish('房主已轉交畀'),'Host transferred to ');
});
test('unknown messages are reported as untranslated and unknown proper names are not invented',()=>{
  assert.equal(translateEnglish('尚未加入字典的全新訊息'),undefined);
  assert.equal(translateEnglish('Already English'),undefined);
  assert.equal(translateEnglish('接單 · 前往未有官方英文名稱的測試屋'),'Request accepted · Go to 未有官方英文名稱的測試屋');
});
