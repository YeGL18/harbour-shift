import test from 'node:test';
import assert from 'node:assert/strict';
import { translateForLocale } from './translate';
import { reviewTimelineTitle } from '../ui/reviewPresentation';

test('duration labels and composed estimates preserve real values in all written locales',()=>{
  assert.equal(translateForLocale('基準約 24 分鐘（60×）','en'),'About 24 real min at 60×');
  assert.equal(translateForLocale('特更 · 24 小時 · 基準約 48 分鐘','en'),'Special · 24 hours · About 48 min at baseline speed');
  assert.equal(translateForLocale('二十四小時交更：','en'),'24-hour handover: ');
  assert.equal(translateForLocale('半更預設車租五折；自訂車租按所填金額，唔會再折半。','zh-Hant'),'半更預設車租減半；自訂車租按所填金額，不會再作折扣。');
  assert.match(translateForLocale('更份長度','zh-Hans'),/长度/);
});
test('team membership, actual standings and unchanged custom rental amounts compose completely',()=>{
  assert.equal(translateForLocale('A 隊 · 3/2','en'),'Team A · 3/2');
  assert.equal(translateForLocale('B 隊 · 第 1','en'),'Team B · Rank 1');
  assert.equal(translateForLocale('本更預設車租 HK$425','en'),'Default shift rental HK$425');
  assert.equal(translateForLocale('隊員失去資格，全隊不列名次','en'),'A member forfeited; the team is unranked');
  assert.equal(translateForLocale('隊際模式需要四名玩家，每隊兩人。','zh-Hans'),'队际模式需要四名玩家，每队两人。');
});
test('safe rest routing and actual review events have complete English without leaking a raw log',()=>{
  assert.equal(translateForLocale('前往海港城，駛入泊位後休息','en'),'Driving to Harbour City; resting once parked');
  assert.equal(translateForLocale('已駛入海港城，停定後開始休息','en'),'Entered Harbour City; resting once parked');
  for(const type of ['accept','decline','rest','cancel-handover','trip-completed','shift-ended'] as const){
    assert.doesNotMatch(translateForLocale(reviewTimelineTitle(type),'en'),/[\u3400-\u9fff]/u);
  }
  assert.match(translateForLocale('只比較實際紀錄，唔推算冇接嘅單可以賺幾多。','en'),/actual records only/);
  assert.match(translateForLocale('遊戲模擬活動，唔係即時活動資訊；附近需求增加仍不保證派單。','en'),/does not guarantee/);
});

test('map-loading gates distinguish a stopped solo clock from a continuing online match',()=>{
  assert.equal(translateForLocale('地圖已準備 3/4 · 全員就緒先開始計時及派單。','en'),'Maps ready 3/4 · Time and dispatch start when everyone is ready.');
  assert.equal(translateForLocale('比賽時間繼續，地圖載好後恢復操作。','en'),'The match clock continues. Controls return once the map loads.');
  assert.equal(translateForLocale('地圖載好先開始計時及派單；現有接單倒數會保留。','zh-Hant'),'地圖載入後才開始計時及派單；現有接單倒數會保留。');
  assert.equal(translateForLocale('重新載入地圖','zh-Hans'),'重新载入地图');
});
