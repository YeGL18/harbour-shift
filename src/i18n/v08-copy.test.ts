import test from'node:test';import assert from'node:assert/strict';
import{translateEnglish}from'./en';import{ELITE_QUESTIONS}from'../../shared/eliteCourse';import{toSimplified}from'./translate';
const cjk=/[\u3400-\u9fff]/u;
test('the explicitly localized Elite course has ten original complete questions in all four locale paths',()=>{
 assert.equal(ELITE_QUESTIONS.length,10);assert.equal(new Set(ELITE_QUESTIONS.map(item=>item.id)).size,10);
 for(const item of ELITE_QUESTIONS){assert.equal(item.choices.length,3);for(const text of[item.prompt,...item.choices,item.explanation]){assert.ok(text.hk.trim());assert.ok(text.zh.trim());assert.ok(toSimplified(text.zh).trim());assert.ok(text.en.trim());assert.equal(cjk.test(text.en),false);}}
});
test('complete airport and premium-booking labels take precedence over generic go-to and minute patterns',()=>{
 assert.equal(translateEnglish('前往並加入隊列'),'Go and join the queue');assert.equal(translateEnglish('前往預約上客點'),'Go to booked pickup');assert.equal(translateEnglish('前往機場'),'Go to airport');
 assert.equal(translateEnglish('估計輪候 2–6 分鐘遊戲時間；實際派單或有不同。'),'Estimated queue: 2–6 game min. Actual dispatch may differ.');assert.equal(translateEnglish('位置 · 約 1.8 公里／7 分鐘'),'位置 · About 1.8 km / 7 min');
 assert.equal(translateEnglish('尚餘 1 更'),'Shifts remaining: 1');assert.equal(translateEnglish('目前第 2 位 · 共 4 位'),'Queue position 2 of 4');
});
test('game qualifications, next-shift benefits and booking privacy remain explicit in English',()=>{
 for(const source of['本遊戲商務資格；不等於真實平台認證。合資格 Alphard／Vellfire 偶爾獲邀，不保證派單或收入。','新資格由下一更起生效；本機資格不會上傳成線上認證。生涯紀錄與觀察期保持不變。','每包適用七個完成更次；半更、全更及特更每更只扣一次。第七更全程有效。','目的地上車後顯示；車資完成後顯示。預約不會自動接受。']){const text=translateEnglish(source);assert.ok(text);assert.equal(cjk.test(text),false);}
 assert.equal(translateEnglish('已保留尊尚預約 · Harbour City'),'Premium booking reserved · Harbour City');assert.equal(translateEnglish('前往尊尚預約上客點 · Harbour City'),'Go to booked pickup · Harbour City');
});
