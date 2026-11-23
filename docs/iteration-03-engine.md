# 第三輪引擎：規則、API 與驗證

版本 0.3，2026-11-18。引擎為 deterministic TypeScript；相同 seed、世界時間、車種及操作會產生相同行為。需求、停權、停車、救援及等單估計屬遊戲規則，不是 Uber 政策或即時營運數據。能源與通行來源另見 [資料說明](iteration-03-energy-access.md)。

## 需求與計價

- 900m 空間索引及共享絕對世界時鐘提供附近需求。內部每 0.25 模擬分鐘查詢世界，區域 seeded gate、8 分鐘需求時段及地點權重產生突發多單與靜市，並非每次查詢都派單。開更保留一張附近具名起終點的初始單。
- `getSurgeAreas()` 與 `getLocalDemandConditions()` 使用同一 seed／地區／時段條件，提供 quiet、normal、busy、surge 四級、倍率及 2–10 分鐘等單估計。估計不是保證下一張單的倒數；局部地點密度及車種資格亦影響可接單量。區域查詢快取 cell 對最近真實 POI 地區，不逐 frame 掃全目錄。
- 的士與私家車兩種 upfront 單套遊戲需求倍率，報價已包含倍率；咪錶及 85 折咪錶不套。官方的士預定價資料列明可按供求動態加乘，但本遊戲數值並非官方區域或實時價格。[Uber 香港的士費率來源](https://www.uber.com/hk/zh-hk/blog/driver-fare-taxi/)
- Upfront 接受後鎖合約價；咪錶按實際載客距離結算，接客距離不收費。取消不賺已走部分車資。
- 移除原路 counterfactual 模擬；相容存檔欄位 `ghost`／`ghostOffer` 固定 null，`ghostOffers` 固定空陣列。`observedOffers` 現為附近需求，不計收入；只在上客點距車超過 2.5km 才移除，不受舊 24 筆或時間上限限制。
- 取消完成後有 seeded 3–8 模擬分鐘冷卻。拒單／逾時亦有短冷卻，避免相同節奏連續彈單。

## 接單、等候、取消與遊戲平台紀錄

普通等候加上車合共 3 秒至 3 分鐘模擬時間；明確 `waitingProfile='saikung'` 的鄉郊點偶爾延至 3–10 分鐘。明確 ordinary 的將軍澳等市區點不因西貢區名稱而變長。總時間分 80% waiting、20% boarding。

未載客可立即 `cancelTrip()`。載客後呼叫則先進 `safe-dropoff`，沿合法連接道路駛到保守安全停車代理；隧道、快速路、主要幹道及高架路不作停車位置。到達後 `navigation.stage='servicing'` 停 0.4 模擬分鐘落客，再完成取消。這不是路邊合法停車位置認證。已用時間、距離及成本保留，不能透過反覆取消收車資。

`getPlatformStats()` 回傳 offered、accepted、cancelled、acceptanceRate、cancellationRate。只有實際提供給玩家的 live offer 計入派單樣本；附近資訊不計。暫停接單撤回未回覆單，不算拒單或損害接單率。

遊戲停權使用自上次處分後的樣本：至少 20 次派單且接單率低於 30%，或至少 10 次接單且取消率高於 35%，才處分。重複違規依次停權 60／180／360／720 模擬分鐘。停權不強行中斷已接受行程。這些門檻及時長完全是遊戲設定。

## 停車、補給與交更

| API | 行為 |
|---|---|
| `setAcceptingOrders(state, bool)` | 只切換接單，時間及行車繼續。 |
| `parkTemporarily(state, graph?)` | 安全處最多停 5 模擬分鐘，可提前開車或接單；危險路段先導航離開。 |
| `parkForRest(state, graph?)` | 長停並暫停接單，時間照行，需手動離開。 |
| `resumeDriving(state, graph?)` | 離開停車或取消未到站的服務導航；不自動開接單開關，不中止正在補給或安全落客。 |
| `navigateToStation(state, station, graph?)` | 相容燃料、可達站點才導航，到站自動進 servicing。 |
| `getEnergyServiceEstimate(state, station?)` | 補充量、參考金額、遊戲服務分鐘。 |
| `requestEnergyRecovery(state)` | 能量不高於 10% 可原地召喚遊戲救援：$250 服務費、30 模擬分鐘、補 20% 容量，不傳送車輛。 |
| `navigateToHandover(state, graph?)` | 前往具名交更點，到達收更。 |

`energy.kind` 為 lpg／petrol／swap。容量及消耗見資料檔。初始 `unitPricePaid` 使用車輛遊戲參考價；開更 `energyUnitPriceOverride` 可明確覆蓋整更能源價，包括 0。沒有覆蓋時，已核實的站價優先，未知站價用明示遊戲參考。

補充後的單價為 `(剩餘量 × 舊均價 + 補入量 × 新站價) / 容量`。行駛按消耗量乘該均價計營運成本；補滿時不再重複扣整缸價。因此較平站會實際減低之後耗用成本。救援服務費另計。小露寶按使用者約 $120／更觀察，以 400km 設計更校準為 $0.30/km；不是宣稱每個真實更份均固定 $120。私家車節能／折扣遊戲設定為 $0.88/km。

載客中能量救援保留行程與位置。救援中提出取消仍須完成補給後安全落客；未載客取消不會在救援結束後錯誤復原已取消的行程。

`InitialGameOptions.handoverPlace` 正常預設開更點，可另選。660 分鐘提醒；720 分鐘後不再派單，完成現有行程後返回交更點，到達才收更。正淨收入分數按 `net × 720 / max(720, elapsed)` 計，虧損不因超時改善。

## 介面與存檔

新增 state 欄位包括 `parking`、`acceptingOrders`、`navigation`、`energy`、`energyRecovery`、`platform`、`demandCooldownUntil`、`handoverPlace`。`getPhaseRemainingMinutes()` 覆蓋等候、上車、安全落客、補給、救援及臨停倒數。

`getVehicleGraph()` 與所有派單／路由／分支使用同一車種過濾道路網。禁止地點原地排除，不能移到禁區另一邊變可接。`getUpcomingBranches()` 最多三個合法且幾何不同方向，保留已選方向；分支選擇不傳送車輛。`getRemainingTripRouteCoordinates()` 供上客後一次全程概覽，正常 lookahead 仍為約 1km。

`normalizeGameState(saved, graph?)` 升級 v2／v3，保留時間、收入及可用位置，補新系統預設及移除原路灰單。只壞未來路線時重設前方路線，保留更份；當前車輛已位於不再可行的道路則回傳 null。自動存檔仍省略大 POI 目錄，恢復後重接共享資料及過濾快取。

## 驗證

凍結 runtime 時 `npx tsc --noEmit` 通過，`npm test` **65／65 通過**。涵蓋 seeded 突發與靜市、相同絕對時間共享世界、附近需求距離保留、停車／休息、取消冷卻、安全落客停頓、樣本門檻與四級停權、真實站點價格與加權成本、四車自訂零價、耗盡救援及救援中取消、交更提醒與抵達、v2 升級、咪錶與 upfront 差異、車種禁區、路口幾何及大 POI 目錄共用。這些是 Node 行為測試，不是裝置 FPS 或原生視覺驗證。
