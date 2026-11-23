# 公開充電站與充電模型

今次資料及邏輯為新版本候選；未在本工作中部署服務、購買服務或進行新原生編譯。現有 LPG、汽油及紅旗換電流程維持原有計價方式。

## 官方資料

來源為環保署的[供公眾使用的電動車充電器](https://data.gov.hk/en-data/dataset/hk-epd-evcpateam-evc-1)。其 [CSDI FeatureServer](https://portal.csdi.gov.hk/server/rest/services/common/epd_rcd_1631080339740_69941/FeatureServer/0)提供中英站名、地址、地區、WGS84點及各標準數量，並在 `DATA_PATH` 指向[環保署公開詳細資料](https://ev-charger.epd.gov.hk/resource/ev_charger_avail/evca_ver_1_0.json)。原始公開檔案保存在 `assets/services/sources/`，日期、網址、SHA-256及排除原因保存在 `charging.json`／`charging-excluded.json`。

2026-11-20下載：CSDI991筆，詳細資料990筆。兩檔更新時間不同，沒有強行補出缺少的地點。採用詳細資料的真實名稱、座標及紀錄ID；與CSDI名稱一致時才接上地區。正規化後893個場址；排除10個未列明24小時、24個離可達普通道路錨點超過120m、63個沒有支援接頭或未核實品牌網絡通行的場址。私家車禁區及可達路網再由每款車的通行圖篩選。

詳細資料明列 `CCS Combo Type 2`、`IEC 62196`、CHAdeMO及GB/T；遊戲將IEC62196類別對應香港Type2 AC，CCS明確對應CCS2，GB/T依AC／DC速度分類分開。[運輸署接頭說明](https://www.td.gov.hk/filemanager/en/content_4808/item%204.31.pdf)說明香港Type2／CCS2與國標並不直接相容。本遊戲不假設轉接器；Tesla網絡選項保守限制Tesla車，未核實BMW／Mercedes網絡選項不納入。未鎖定年份的Model S保守只開Type2 AC，並不假設CCS2改裝或舊款Tesla DC相容。這不構成任何真車、會員或車站准入保證。

只有單一數值、單位1000Wh、沒有混合按時費用的公開能源價，才作 `official-reference`，標記快照日2026-11-20。範圍價、缺價或複合收費使用清楚標記的遊戲$3/kWh；並非宣稱免費或現價。環保署[政府停車場收費資料](https://www.epd.gov.hk/epd/sites/default/files/epd/english/environmentinhk/air/promotion_ev/files/evpower_table_eng.pdf)及[2026–27答覆](https://www.epd.gov.hk/epd/sites/default/files/epd/english/news_events/legco/files/fc_26-27_eng.pdf)可交叉核對每kWh計價及另有按時／市場安排。泊車、會員、閒置費及即時空位未模擬；`available`是遊戲選用旗標，不是現場空位。未定義的來源 `isEnable` 不被擅自解釋為場址關閉。

道路錨點是遊戲入口代理，並非實測車場閘口。原始座標仍保留，路線必須沿該車可行的有向路網前往；不瞬移，不把高速公路或隧道當充電泊位。

## 明確遊戲設定

官方速度分類沒有逐樁額定kW；遊戲分別用中速7、快速50、高速100kW作代表值，全部標記 `powerBasis: game-reference`，再受車輛AC／DC功率上限限制。不是把分類當成精確額定值。Tesla容量、車款能耗及功率上限屬可調遊戲設定；AION Y Plus63.2kWh及MG4 Trophy64kWh有香港車款參考，仍須分清指定年款，詳見 `ENERGY_REFERENCE_NOTES`。

充電曲線也是遊戲模型：SOC低於80%用峰值、80–95%用55%、95–100%用25%；效率92%。預估時間與實際逐步推進使用同一計算器。電池增加量與供電量分列，費用按供電kWh乘本次鎖定單價；本次自訂價（包括0）優先，途中不換價。

新充電車採實際補電支出的遊戲帳目：初始電量隨車提供，不先按耗用再扣一次；充電期間按已交付供電量入帳。`prepaidRemaining`確保已付電量行車時不重複扣；交更前補足能源會結清使用了的初始電量。LPG／汽油／換電維持原先按耗用成本入帳，沒有改成重複扣補給費。

中途停止保留已增加電量及費用，留下 `lastChargeReceipt`。冷恢復保留進度，沒有一鍵免費補滿。充電中不接單；前往充電站仍可接單，接單會安全取消未開始的導航。交更預算包括途中耗電、分段充電及回程；已在限時前開始的充電可完成後按既有逾時規則收更。充電泊位暫不模擬實時排隊；原LPG共享FIFO不受影響。

## 驗證範圍

23項針對測試通過：10項新充電機制、3項官方資料整合、10項原補給回歸。涵蓋接頭／品牌限制、AC/DC上限、曲線及步長一致性、部分停止與零價、費用不重扣、冷恢復、交更途中耗電及半更逾時。完整遊戲／伺服器回歸由整合方另跑；本文件不把單元測試當成原生或已部署多人驗證。
