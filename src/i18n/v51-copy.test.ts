import assert from 'node:assert/strict';
import test from 'node:test';
import {translateEnglish} from './en';
import {translateForLocale} from './translate';
import {roomPlayerStatus} from '../multiplayer/playerStatus';
import type {RoomPlayer} from '../../shared/protocol';

test('peer acceptance copy composes with an untranslated nickname',()=>{
 assert.equal(`Bob ${translateForLocale('接到附近一單','en')}`,'Bob accepted a nearby request');
});

test('room costs preserve both actual amounts and energy units in English and written Chinese',()=>{
 const source='車租 HK$560 · 能源 HK$4.19/L';
 assert.equal(translateForLocale(source,'en'),'Rental HK$560 · Energy HK$4.19/L');
 assert.equal(translateForLocale(source,'zh-Hant'),source);
 assert.equal(translateForLocale(source,'zh-Hans'),'车租 HK$560 · 能源 HK$4.19/L');
 assert.equal(translateForLocale('車租 HK$0','en'),'Rental HK$0');
 assert.equal(translateForLocale('留空使用所選車輛預設；輸入 0 代表免費。','zh-Hant'),'留空使用所選車輛的預設值；輸入 0 代表免費。');
 assert.equal(translateForLocale('儲存後會取消你嘅準備狀態。車租及能源設定會計入今場淨收入，房內玩家可以查看。','en'),'Saving resets your ready status. Rental and energy settings affect this match’s net income and are visible to the room.');
});
test('multiline room summaries translate each real label without losing line breaks or placeholders',()=>{
 const source='最高淨收入勝出\n日更 · 30× · 2–8位玩家';
 assert.equal(translateForLocale(source,'en'),'Highest net income wins\nDay shift · 30× · 2–8 players');
 assert.equal(translateForLocale(source,'zh-Hans'),'最高净收入胜出\n日更 · 30× · 2–8 位玩家');
 assert.equal(translateForLocale('1–7 分鐘','en'),'1–7 min');
 assert.equal(translateForLocale('1–7 分鐘','zh-Hans'),'1–7 分钟');
 assert.equal(translateForLocale('餘 02:45','en'),'02:45 remaining');
 assert.equal(translateForLocale('逾時 00:35','en'),'Overdue 00:35');
 assert.equal(translateForLocale('07:35 · 共通60×','en'),'07:35 · Shared 60×');
});
test('dynamic handover reminders retain the estimate and use an official English handover name',()=>{
 const source='交更安排提醒 · 預計需 83 分鐘，請預留前往補給、輪候及回程時間';
 assert.equal(translateForLocale(source,'en'),'Handover reminder · About 83 min needed; allow time for refuelling, queues and the return journey');
 assert.equal(translateForLocale(source,'zh-Hans'),'交更安排提醒 · 预计需 83 分钟，请预留前往补给、轮候及回程时间');
 assert.equal(translateForLocale('距交更時間一小時，交更點：海港城','en'),'One hour to handover · Harbour City');
 assert.equal(translateForLocale('已取消交更安排；現有補給及乘客行程保持不變','en'),'Handover cancelled. Your current station visit and passenger trip are unchanged.');
});
test('auto acceptance, independent resting and each late finish outcome have complete English copy',()=>{
 const cases=[
 ['自動接單','Auto-accept requests'],
 ['自動接受訂單中…','Accepting requests automatically…'],
 ['已完成補給，遲到交更','Energy replenished · Late handover'],
 ['已取消補給，逾時收更','Station visit cancelled · Shift ended late'],
 ['補給逾時，未完成交更','Energy stop timed out · Handover incomplete'],
 ['交更限時已到，保留現有補給次序，完成後按逾時交更收更','Handover deadline reached. Your current queue or service continues; the shift ends late afterward.'],
 ];
 for(const[source,target]of cases){assert.equal(translateForLocale(source,'en'),target);assert.equal(translateForLocale(source,'zh-HK'),source);}
 const rest='停車時遊戲時間照行。休息期間暫停派單，開車後沿用原本接單設定；停止接單唔會停止行車或交更導航。';
 assert.equal(translateForLocale(rest,'zh-Hant'),'停車時遊戲時間仍會繼續。休息期間暫停派單，繼續行車後沿用原有接單設定；停止接單不會停止行車或交更導航。');
 assert.ok(!/[\u3400-\u9fff]/u.test(translateForLocale(rest,'en')));
 assert.equal(translateEnglish('這是一條尚未審閱的新錯誤訊息'),undefined,'Missing copy must remain visible to the strict audit');
});
test('the authoritative late player status has distinct labels in all four locales',()=>{
 const player:RoomPlayer={id:'late-player',nickname:'銅鑼灣',vehicleId:'kam-fung',connected:true,ready:false,status:'finished',joinedAt:0,late:true};const source=roomPlayerStatus(player);
 assert.equal(source,'遲到交更');assert.equal(translateForLocale(source,'zh-HK'),'遲到交更');assert.equal(translateForLocale(source,'zh-Hant'),'逾時交更');assert.equal(translateForLocale(source,'zh-Hans'),'逾时交更');assert.equal(translateForLocale(source,'en'),'Late handover');
});
test('connection diagnostics preserve distinct actionable failures without exposing HTTP metadata',()=>{
 const rows=[
 ['多人服務入口拒絕此連線，請稍後再試。','The multiplayer service rejected this connection. Try again later.'],
 ['多人服務傳回非預期回應，請稍後再試。','The multiplayer service returned an unexpected response. Try again later.'],
 ['暫時搵唔到可連線嘅多人服務入口，請稍後再試。','No multiplayer service is reachable right now. Try again later.'],
 ];
 for(const[source,english]of rows){assert.equal(translateForLocale(source,'en'),english);assert.equal(translateForLocale(source,'zh-HK'),source);assert.ok(!/[\u3400-\u9fff]/u.test(english));}
 assert.equal(translateForLocale(rows[2][0],'zh-Hant'),'暫時找不到可連線的多人服務入口，請稍後再試。');assert.equal(translateForLocale(rows[2][0],'zh-Hans'),'暂时找不到可连线的多人服务入口，请稍后再试。');
});
