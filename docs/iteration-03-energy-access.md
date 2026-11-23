# 第三輪：補能、車輛成本與可行駛範圍

資料核對日期2026-11-18。此版本保留真實站名、坐標與可追溯來源；未知的實付價格及香港實際消耗，不以遊戲參數冒充。

## 可用服務站

[機電署官方LPG清單](https://www.emsd.gov.hk/filemanager/en/content_268/dataset/lpg_filling_station.csv)及其[DATA.GOV.HK說明](https://data.gov.hk/en-data/dataset/hk-emsd-emsd1-lpg-filling-station)提供66個站、坐標、營運商、專用站標記及電話。資料更新頻率為季度，並非即時營業狀態保證。當中12個專用站；柴灣創富道維修、青衣西路171號覆檢及機場禁區專用站不供普通玩家選取，留下63個可選LPG站。

另有30個常規Shell/Sinopec油氣站的petrol服務項目，其中28個可選。這是不同燃料的服務選項，不代表另外新增30個獨立場地；位置沿用EMSD真實站點，汽油供應另對照[Shell油站目錄](https://www.shell.com.hk/en_hk/motorists/shell-station-locator.html)及[Sinopec油／氣網絡](https://www.sinopechongkong.com/retail_hk/driver_oil_network)。不把12個專用LPG站默認變成汽油站。

[龍昇官方布局頁](https://www.dragonrise.hk/ch_t/battery_swapping_station.html)的2026站點資料列出粉嶺22.5222229,114.161551及青衣22.339061,114.111324，頁面里程碑寫2026年7月兩站試營運。粉嶺地址為坪輋路77號。這證實兩個有來源的試營運站，不是將2027／2028規劃站當成已開。青衣未找到同等清楚的街號，保留營運商公開坐標，不虛構地址。

合共98個燃料服務項目；`getCompatibleStations()`按車種、站點可用狀態及同一限制道路網篩選，LPG車63、私家車28、紅旗2。全部位置吸附至120m內普通道路代理，並可由同一可達分量駛到。代理不代表經實地確認的入口或正確入站方向。

## 價格的日期與性質

[政府2026-10-23公布](https://www.info.gov.hk/gia/general/202610/23/P2026102300262p.htm)的11月專用LPG上限價有效期為2026-11-01至11-30：

| 專用站位置 | HK$/L上限 | 專用站位置 | HK$/L上限 |
|---|---:|---|---:|
| 葵涌葵安道 | 4.19 | 美孚深旺道 | 4.25 |
| 觀塘偉樂街 | 4.31 | 九龍灣祥業街 | 4.35 |
| 西九龍翱翔道 | 4.36 | 大埔元洲仔 | 4.42 |
| 元朗德業街 | 4.53 | 馬鞍山恆耀街 | 4.56 |
| 灣仔馬師道 | 4.57 | 上環豐物道 | 4.59 |
| 屯門業旺路 | 4.69 | 柴灣豐業街 | 5.13 |

這些是有月份的合約上限，不宣稱任何時刻的真實泵價、會員價或司機折扣。非專用LPG站沒有已核實統一逐站實付價，`unitPrice`留空、`priceBasis='unverified'`；遊戲結算採獨立標示的參考價。不能把某月專用站上限直接標成另一非專用站現價。

私家車汽油使用16HKD/L共同遊戲參考、0.055L/km作使用者要求的較低成本校準（0.88HKD/km），並非聲稱真實油站售價。紅旗一般換電價尚未核實，2.4HKD/kWh為遊戲值。香港代理有附條件的2026免費換電宣傳，不能推定所有司機或未來年份均免費。UI須保留priceBasis／priceNote，避免只有日期而讓人誤認為市場報價。

同一來源的專用站價格差異應進入實際遊戲成本：以補入能源及新價更新油缸／電池的加權已付單價，行駛時只按消耗量及該單價計一次成本；不應只展示最平站、卻仍固定扣舊版fuelCostPerKm。若使用者明確自訂本更能源價，顯示為覆蓋站價的遊戲設定。

## 容量與消耗：原廠參考及遊戲值

| 車種 | 遊戲可用容量 | 遊戲消耗 | 價格參考性質 |
|---|---:|---:|---|
| 傳統金豐 | 75.2L | 1/9.8L/km | LPG4.57/L參考 |
| 小露寶 | 41.6L | 120/(400×4.57)L/km | 使用者約$120/更校準 |
| 紅旗E-QM5 | 56kWh | 0.14kWh/km | 2.4/kWh遊戲值 |
| 私家車 | 50L | 0.055L/km | 16/L遊戲值 |

[Toyota日本2016 Comfort規格](https://toyota.jp/pages/contents/comfort/001_b_013/pdf/spec/comfort_spec_201604.pdf)列94L名義缸及AT測試9.8km/L，並註約80–85%可充。遊戲取80%=75.2L；這是日本型號參考，不宣稱全部香港傳統金豐均相同。

[Toyota日本2024 NTP10規格](https://toyota.jp/pages/contents/jpntaxi/001_b_001/pdf/spec/jpntaxi_spec_202402.pdf)列52L名義缸、約75–80%可充及16.8km/L測試值；遊戲取41.6L。日本新版已有58L，香港年款亦有差異，不能把52L冒充所有2026香港新車規格。[Toyota香港頁](https://www.toyota.com.hk/en/our-vehicles/taxi)確認LPG混能類型。使用者所述小露寶約$120/更沒有一同給固定里程；以400km及4.57/L反推0.06565L/km，是遊戲校準而非新實測。

[香港代理E-QM5官方規格PDF](https://www.dragonrise.hk/images/%E7%B4%85%E6%97%97E-QM5%E5%96%AE%E9%A0%81.pdf)列56kWh、500km CLTC及20–80%快充約27.4分鐘。56kWh有香港版來源；500km是測試續航，實際空調、塞車及負載會不同。遊戲用400km即0.14kWh/km，不標成廠方保證。LPG／汽油服務4分鐘、換電3分鐘亦為遊戲時間；99秒機械換電宣傳不包括駛去、排隊及處理。

## 車輛範圍及完整路由

[運輸署市區的士範圍](https://www.td.gov.hk/en/transport_in_hong_kong/public_transport/taxi/details_of_taxi_operating_areas_/)排除東涌道及嶼南道路；[LCRP申請說明](https://driveonlantau1.td.gov.hk/lcrp/application/clientLogging.do?country=HK&language=en&method=jumpToAppElcrp)明確封閉段為石門甲道交界以南的東涌道，以及全部嶼南道路。私家車需有效LCRP及遵守其條件；本遊戲不自動給許可證。官方道路圖中東涌道／石門甲道交界約113.9344193,22.269725，用作入口校準。

[2026年4月運輸署區議會文件](https://www.districtcouncils.gov.hk/island/doc/2024_2027/en/committee_meetings_doc/TTC/31505/TTC_2026_14_EN.pdf)確認2014起紅的及藍的可入愉景灣北部二白；擴大至南部仍屬該文件的建議，不能當作已生效。[政府愉景灣車種說明](https://www.info.gov.hk/gia/general/200705/30/P200705300113.htm)記錄許可制度；較舊內容涉及的士時須結合2014後變動閱讀。遊戲採無特殊許可私家車禁入、的士北部例外及南部限制。

`vehicleAccess.ts`的多邊形是根據官方規則、真實道路入口及地點校準的保守遊戲近似，不是完整法定圖則或全港所有臨時／車種交通限制。沒有將全部大嶼山禁用，保留機場、東涌、迪士尼及的士往愉景灣酒店。一般無許可車種的大澳、梅窩、昂坪等被排除。

API固定：

```ts
getVehicleAccessGraph(graph, vehicleId) // filtered edges + largest SCC, cached
getVehicleRoadGraph(vehicleId, graph?) // 同一結果的方便入口
isCoordinateAllowed(coordinate, vehicleId)
isPlaceAllowed(place, vehicleId, graph?) // 原座標與原node同時檢查
isRoadEdgeAllowed(edge, graph, vehicleId)
```

每段polyline及其與限制區邊界的交叉均檢查，不能只驗兩端。刪除不合資格edge後保留最大互相可達分量，阻止被截斷地區產生單。巡遊、接客、送客、ghost、分支預覽、補能、交更、開工選點及autosave恢復必須使用同一車種道路網。禁區POI應原地排除，不能重新吸附到禁區另一邊假裝可接。

測試保留機場／東涌／迪士尼，限制大澳／梅窩／昂坪、愉景灣南部，確認紅的可由海港城到愉景灣酒店而私家車不可。凍結本次geometry時紅的43,464節點／68,412edges，私家43,429／68,345；對應可用named POI為37,389及37,355。首次建立每類約0.3秒，之後同reference快取。

## 重建與資料聲明

```sh
python3 scripts/ingest-services.py --download
node --import tsx --test src/data/serviceStations.test.ts
```

資料輸出在`assets/services/stations.json`、`provenance.json`及`NOTICE.md`；raw公開CSV／營運商頁快取在`work/services-v3`。下載器只抓所需少量來源；每次官方費率或站點更新，應核對有日期的價目表、維修標記、真實坐標及重新snap，再跑測試。多人伺服器及公開排行榜不在本輪實作。
