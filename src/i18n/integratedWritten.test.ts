import test from 'node:test';
import assert from 'node:assert/strict';
import {translateForLocale,toSimplified} from './translate';
import written from './zh.json';
import templates from './zh-templates.json';

test('new Pro, airport and Elite written translations retain their scope, eligibility and no-cash meaning',()=>{
 const source='以下是遊戲練習權益，不收真錢，亦不會開啟訂閱。商店購買尚未開放。';
 assert.equal(translateForLocale(source,'zh-HK'),source);
 assert.equal(translateForLocale(source,'zh-Hant'),'以下為遊戲練習權益，不收取真實款項，也不會啟用訂閱。應用程式商店購買尚未開放。');
 assert.equal(translateForLocale(source,'zh-Hans'),toSimplified(translateForLocale(source,'zh-Hant')));
 assert.equal(translateForLocale('完成目前訂單、預約或操作後，先可前往機場輪候。','zh-Hant'),'完成目前訂單、預約或操作後，才可前往機場輪候。');
 assert.equal(translateForLocale('新資格由下一更起生效；本機資格不會上傳成線上認證。生涯紀錄與觀察期保持不變。','zh-Hant'),'新資格由下一更起生效；本機資格不會轉為線上認證。生涯紀錄與觀察期保持不變。');
 for(const key of['司機 Pro','尊尚預約','機場輪候中','權益使用紀錄尚未儲存，請重試。'])for(const locale of['zh-Hant','zh-Hans']as const)assert.ok((written as Record<string,Record<string,string>>)[key]?.[locale]);
});

test('queue ranks, wait ranges and practice-shift counts preserve complete dynamic values in both written locales',()=>{
 assert.equal(translateForLocale('目前第 3 位 · 共 12 位','zh-Hant'),'目前第 3 位 · 共 12 位');
 assert.equal(translateForLocale('本房間有 6 位輪候司機','zh-Hans'),'本房间有 6 位轮候司机');
 assert.equal(translateForLocale('估計輪候 2–10 分鐘遊戲時間；實際派單或有不同。','zh-Hant'),'預計輪候 2–10 分鐘遊戲時間；實際派單或有不同。');
 assert.equal(translateForLocale('尚餘 7 更','zh-Hans'),'尚余 7 更');
 assert.equal(translateForLocale('前往尊尚預約上客點 · MegaBox','zh-Hans'),'前往尊尚预约上客点 · MegaBox');
 assert.equal(translateForLocale('MegaBox · 約 18.3 公里／24 分鐘','zh-Hans'),'MegaBox · 约 18.3 公里／24 分钟');
});

test('every written template retains exactly the original numbered slots, including currency and interval values',()=>{
 const slots=(value:string)=>[...value.matchAll(/\$\{\d+\}/gu)].map(match=>match[0]).sort();
 for(const entry of templates)for(const locale of['zh-Hant','zh-Hans']as const)assert.deepEqual(slots(entry[locale]),slots(entry.source),`${locale}: ${entry.source}`);
});
