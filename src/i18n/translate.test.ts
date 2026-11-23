import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTranslationTemplate, translateForLocale, toSimplified, normalizeSearchText } from './translate';
import zh from './zh.json';
import templates from './zh-templates.json';
import { VEHICLES } from '../data/vehicles';
import { roomPlayerStatus } from '../multiplayer/playerStatus';
import type { RoomPlayer } from '../../shared/protocol';

test('Cantonese remains the original text while written Chinese uses reviewed formal wording',()=>{
  const source='今更，喺邊出發？';
  assert.equal(translateForLocale(source,'zh-HK'),source);
  assert.equal(translateForLocale(source,'zh-Hant'),'本更從哪裡出發？');
  assert.equal(translateForLocale(source,'zh-Hans'),'本更从哪里出发？');
  assert.equal(translateForLocale('計價點樣計？','zh-Hant'),'如何計算車資？');
  assert.equal(translateForLocale('計價點樣計？','zh-Hans'),'如何计算车资？');
});

test('dynamic UI strings translate the complete sentence and recursively translate inserted labels',()=>{
  assert.equal(translateForLocale('5秒後一齊開更','zh-Hant'),'5秒後一起開更');
  assert.equal(translateForLocale('5秒後一齊開更','zh-Hans'),'5秒后一起开更');
  assert.equal(translateForLocale('前往銅鑼灣','zh-Hans'),'前往铜锣湾');
  assert.equal(translateForLocale('巡航前往 銅鑼灣 · 途中繼續接單','zh-Hans'),'巡航前往 铜锣湾 · 途中继续接单');
  assert.equal(translateForLocale('取車：尖沙咀\n交更：銅鑼灣','zh-Hans'),'取车：尖沙咀\n交更：铜锣湾');
});

test('template compilation escapes money and punctuation and preserves each actual inserted value',()=>{
  const pattern=compileTranslationTemplate('預設 HK$${0} · ${1}×');
  assert.deepEqual('預設 HK$12.30 · 10×'.match(pattern)?.slice(1),['12.30','10']);
  assert.equal(pattern.test('預設 HKX12.30 · 10×'),false);
  for(const entry of templates){
    const slots=[...entry.source.matchAll(/\$\{(\d+)\}/gu)].map(match=>Number(match[1]));
    for(const locale of ['zh-Hant','zh-Hans'] as const){
      assert.deepEqual([...entry[locale].matchAll(/\$\{(\d+)\}/gu)].map(match=>Number(match[1])).sort(),[...slots].sort(),entry.source);
    }
  }
});

test('written dictionaries contain actual simplified UI and named places rather than only language names',()=>{
  assert.ok(Object.keys(zh).length>450);
  assert.ok(templates.length>80);
  assert.equal(translateForLocale('車輛未能到達所選地點','zh-Hans'),'车辆未能到达所选地点');
  assert.equal(toSimplified('銅鑼灣、荃灣、馬鞍山、擎天半島'),'铜锣湾、荃湾、马鞍山、擎天半岛');
  assert.equal(translateForLocale('未有官方英文名的地方','en'),'未有官方英文名的地方');
  assert.equal(translateForLocale('ROOM42','zh-Hans'),'ROOM42');
});


test('place search accepts Simplified and Traditional names as well as full-width Latin input',()=>{
  assert.equal(normalizeSearchText('銅鑼灣'),normalizeSearchText('铜锣湾'));
  assert.equal(normalizeSearchText('馬鞍山'),normalizeSearchText('马鞍山'));
  assert.equal(normalizeSearchText('ＭｅｇａＢｏｘ'),normalizeSearchText('Mega Box'));
});


test('shared start-time summaries translate actual Chinese labels and preserve custom clock values',()=>{
  assert.equal(translateForLocale('十二小時交更：19:35 · 未計加時','en'),'12-hour handover: 19:35 · Excludes overtime');
  assert.equal(translateForLocale('十二小時交更：05:00（翌日） · 未計加時','en'),'12-hour handover: 05:00 (next day) · Excludes overtime');
  assert.equal(translateForLocale('全房晚更 · 07:35 · 房主設定','en'),'Night shift for everyone · 07:35 · Host’s rules');
  assert.equal(translateForLocale('最高淨收入勝出 · 日更 · 07:35 · 共通30×','en'),'Highest net income wins · Day shift · 07:35 · Shared 30×');
  assert.equal(translateForLocale('請輸入有效時間：小時 00–23、分鐘 00–59。','zh-Hans'),'请输入有效时间：小时 00–23、分钟 00–59。');
});


test('stale protocol intents and room changes have actionable messages in all written locales',()=>{
  assert.equal(translateForLocale('此訂單已過期，請查看最新派單。','en'),'This request has expired. Check the latest offer.');
  assert.equal(translateForLocale('行程已更改或已結束，請查看最新狀態。','en'),'The trip has changed or ended. Check the latest status.');
  assert.equal(translateForLocale('房間已更改，請重新操作。','en'),'The room has changed. Please try the action again.');
  assert.equal(translateForLocale('此訂單已過期，請查看最新派單。','zh-Hans'),'此订单已过期，请查看最新派单。');
});


test('cruising copy distinguishes requests paused and keeps place names and accessibility text localized',()=>{
  assert.equal(translateForLocale('巡航前往 銅鑼灣 · 已暫停接單','en'),'Cruising to Causeway Bay · Requests paused');
  assert.equal(translateForLocale('巡航前往 銅鑼灣 · 已暫停接單','zh-Hans'),'巡航前往 铜锣湾 · 已暂停接单');
  assert.equal(translateForLocale('取消巡航，繼續巡遊','en'),'Cancel destination and keep cruising');
  assert.equal(translateForLocale('巡航目的地，銅鑼灣','en'),'Cruising destination, Causeway Bay');
  assert.equal(translateForLocale('巡遊','en'),'Cruising');
});


test('offer income with a surge suffix translates the actual composed native label',()=>{
  assert.equal(translateForLocale('預計司機收入 · 1.15×','en'),'Estimated driver income · 1.15×');
  assert.equal(translateForLocale('預計司機收入 · 1.15×','zh-Hans'),'预计司机收入 · 1.15×');
  assert.equal(translateForLocale('預計司機收入 · 1.15×','zh-Hant'),'預計司機收入 · 1.15×');
  assert.equal(translateForLocale('選路','en'),'Route');
});


test('native multiplayer section headings translate their actual composed clock and player-count strings',()=>{
  assert.equal(translateForLocale('建立房間 · 2–8位玩家','en'),'Create room · 2–8 players');
  assert.equal(translateForLocale('建立房間 · 2–8位玩家','zh-Hans'),'建立房间 · 2–8 位玩家');
  assert.equal(translateForLocale('即時名次 · 07:38','en'),'Live standings · 07:38');
  assert.equal(translateForLocale('即時名次 · 07:38','zh-Hans'),'即时名次 · 07:38');
  assert.equal(translateForLocale('今場成績 · 19:35','en'),'Match results · 19:35');
  assert.equal(translateForLocale('今場成績 · 19:35','zh-Hant'),'本場成績 · 19:35');
});


test('multiplayer custom section wrappers have complete written and English labels',()=>{
  for(const [source,english,hans] of [
    ['本機車房設定','Local garage setup','本机车房设定'],
    ['房主設定','Host settings','房主设定'],
    ['加入朋友房間','Join a friend’s room','加入朋友房间'],
  ]){
    assert.equal(translateForLocale(source,'zh-HK'),source);
    assert.equal(translateForLocale(source,'zh-Hant'),source);
    assert.equal(translateForLocale(source,'zh-Hans'),hans);
    assert.equal(translateForLocale(source,'en'),english);
  }
});

test('room player counts translate the actual host/non-host composition without swallowing numeric values',()=>{
  for(const count of [1,2,8])for(const host of [false,true]){
    const source=`玩家 ${count} / 8${host?' · 你係房主':''}`;
    assert.equal(translateForLocale(source,'zh-HK'),source);
    assert.equal(translateForLocale(source,'zh-Hant'),`玩家 ${count} / 8${host?' · 你是房主':''}`);
    assert.equal(translateForLocale(source,'zh-Hans'),`玩家 ${count} / 8${host?' · 你是房主':''}`);
    assert.equal(translateForLocale(source,'en'),`Players ${count} / 8${host?' · You are the host':''}`);
  }
});

test('actual server lobby status and all vehicle records compose translated player rows',()=>{
  const cases:Array<{patch:Partial<RoomPlayer>;en:string;hans:string}>=[
    {patch:{ready:false},en:'Not ready',hans:'未准备'},
    {patch:{ready:true},en:'Ready',hans:'已准备'},
    {patch:{connected:false},en:'Disconnected',hans:'暂时断线'},
    {patch:{status:'finished'},en:'Handed over',hans:'已交更'},
    {patch:{status:'left'},en:'Left',hans:'已离开'},
    {patch:{forfeited:true},en:'Forfeited',hans:'失去资格'},
  ];
  const names:Record<string,{en:string;hans:string}>={
    'kam-fung':{en:'Kam Fung taxi',hans:'金丰的士'},
    'little-treasure':{en:'Little Treasure',hans:'小露宝'},
    'red-flag':{en:'Red Flag taxi',hans:'红旗的士'},
    private:{en:'Private car',hans:'私家车'},
  };
  for(const vehicle of VEHICLES)for(const scenario of cases){
    const player:RoomPlayer={id:'qa-player',nickname:'尖沙咀',joinedAt:0,connected:true,ready:false,status:'lobby',vehicleId:vehicle.id,...scenario.patch};
    const status=roomPlayerStatus(player,true),source=`${vehicle.name} · ${status}`;
    assert.equal(translateForLocale(source,'zh-HK'),source);
    assert.equal(translateForLocale(source,'zh-Hant'),source);
    const name=names[vehicle.id]??{hans:vehicle.name,en:vehicle.name};
    assert.equal(translateForLocale(source,'zh-Hans'),`${name.hans} · ${scenario.hans}`);
    assert.equal(translateForLocale(source,'en'),`${name.en} · ${scenario.en}`);
  }
  assert.equal(translateForLocale('未揀車 · 未準備','en'),'No vehicle selected · Not ready');
  assert.equal(translateForLocale('未揀車 · 未準備','zh-Hant'),'未選車 · 未準備');
  assert.equal(translateForLocale('已選車 · 已準備','en'),'Selected vehicle · Ready');
});
