# 第二輪：全港地點資料與香港派單規則

核對日期：2026-11-18。本文記錄 v0.2 的資料實作、可確認的官方規則，以及仍屬遊戲設定的部分。

## 已交付的地點資料

`LANDMARKS` 已由 12 個手設地點擴充至 **37,925 個真實命名地點**：37,253 個地政總署建築物紀錄、672 個地理名稱聚落紀錄；35,968 個有英文名稱。所有紀錄保留官方 BuildingID 或 GEO_NAME_ID、WGS84 原始位置、所屬行政區，以及預先計算的可達道路節點。

數量按「正規化名稱＋行政區」保守去重，並非把同一商場、校園或公園的數百座同名建築物都當成不同景點。這亦可能合併區內真正同名的不同建築物，是避免誇大獨立場地數量的保守取捨。沒有透過增加路面格點、插值地址或虛構名字增加 POI 數量。

| 分區 | 地點數 | 分區 | 地點數 |
|---|---:|---|---:|
| 中西區 | 2,704 | 九龍城區 | 2,626 |
| 元朗區 | 4,883 | 北區 | 1,601 |
| 南區 | 2,494 | 大埔區 | 2,484 |
| 屯門區 | 2,485 | 東區 | 1,718 |
| 沙田區 | 2,750 | 油尖旺區 | 2,298 |
| 深水埗區 | 1,747 | 灣仔區 | 1,874 |
| 荃灣區 | 1,270 | 葵青區 | 1,138 |
| 西貢區 | 2,480 | 觀塘區 | 1,589 |
| 離島區 | 895 | 黃大仙區 | 889 |

西貢區中 1,058 個紀錄帶 `saikung` 等候設定，其他 36,867 個用 `ordinary`。地理圍欄是「西貢區且緯度≥22.35 或經度≥114.29」的遊戲近似，用來區分郊區長時間候客，並非官方需求或真實平台到單統計。

## 原始資料及處理方法

官方 [Building 資料集](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-landsd-building)按月更新，提供建築物輪廓及名稱等屬性。本次以 `Status = 'Active'` 及中／英文名稱非空為條件，下載 **68,189** 個來源紀錄，並取面積最大的 footprint ring 計算代表中心。中心點未必落在大門，不能當作測量過的入口。

以下公開 ArcGIS REST layer 是實際批次來源：

| 用途 | 官方端點 | 本次來源數 |
|---|---|---:|
| 建築物名稱及輪廓 | [Building layer 0](https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637211194312_35158/MapServer/0) | 68,189 |
| 地理名稱位置及分類 | [Geographic Name layer 0](https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1648571595120_89752/MapServer/0) | 2,706 |
| 中英地理名稱關聯表 | [Geographic Name table 1000](https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1648571595120_89752/MapServer/1000) | 2,826 |
| 行政區界 | [District layer 0](https://portal.csdi.gov.hk/server/rest/services/common/had_rcd_1634523272907_75218/MapServer/0) | 18 |

地理名稱只保留 Settlement 類，沒有把山、河、海灣或礁石當作可接客目的地。行政區由官方區界 polygon 作 point-in-polygon 判斷。

流程先排除空泛座號、純街名、placeholder、泵房等基建紀錄，再以真實座標找最近道路。道路代理只從全港最大可達分量的 **36,518 個 pickupEligible 節點**中選取，上限 **120m**；不把高速公路、隧道及高架道路節點當作普通上落客代理。整個可達道路網有 44,340 個節點。地圖道路來源與圖論細節另見 map 資料及其 provenance。

本次保留 37,925，排除 32,970；其中 15,891 為重複名稱＋行政區代表、11,165 為沒有足夠近的可達普通道路、2,340 為非乘客基建、1,469 為純街名。所有排除原因及來源 ID 留在 `assets/places/excluded-records.csv`。近路並不證明存在入口、車路連接或合法上落客空間；目前是可玩的名義上落客代理，未宣稱全數經實地核實。

海港城與 MegaBox 是既有 BuildingID 的顯示別名增補，沒有新增虛構官方 ID：[官方 Location Search API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/LocationSearchAPI)搜尋結果把海洋中心地址列於海港城、把 MegaBox 地址列於企業廣場第五期。遊戲以「海港城（海洋中心）」及「MegaBox（企業廣場第五期）」表達，保持原有建築物中心與來源 ID。原始 API 回應及查核資料留在工作快取；別名證據留在 `retail-aliases.json`。此 API 有避免短時間大量查詢的要求，因此整批資料使用分頁 layer，而非逐 POI 搜尋。

## 資料重建及驗證

在專案根目錄執行：

```sh
python3 scripts/ingest-places.py --download --normalize
python3 scripts/ingest-places.py --snap
npx tsc --noEmit
```

下載每頁 3,000 筆，按 `OBJECTID ASC` 分頁，核對官方總數及唯一 OBJECTID；頁面、query、時間和 SHA256 都記入 manifest。標準函式庫腳本不需要額外 Python package。`work/places-v2` 是重用快取；要重新抓取新版本，先另存／清走這個任務的舊快取，再重新執行。道路節點更新後須重新 snap。`catalog.json` 以原子替換寫入，避免 build 讀到半份 JSON。

`assets/places/catalog.json` 是離線 compact rows，`src/data/landmarks.ts` 只做一次薄轉換；`spatial-index.json` 是 0.004° 格網至 row index 的對照。這個索引不產生地點。引擎可直接用預先 snap 的 nodeId，毋須每次逐個 POI 掃描整個道路網。

最終 audit 通過：37,925 個唯一 runtime ID／官方 source ID／名稱＋區組合、全18區、所有節點存在且 pickupEligible、全部距離≤120m、索引恰好覆蓋每筆一次、道路 hash 相符。TypeScript typecheck 通過。

凍結的 catalog 為 8.57MB，SHA256：

```text
04db2e27b4ddf52a50288f3f351a0794186cecddac05fccab47d84696aec8dd7
```

## 香港 Uber 單型及收入

已確認要分清三種產品：的士（預定價錢）、咪錶的士，以及乘客要求85折咪錶車資的獨立選項；UberX 類私家車用另一收入表。2024 年 [行程雷達公告](https://www.uber.com/hk/zh/blog/uber-taxi-meter-tripradar/)記錄咪錶可同時瀏覽多張單／目的地，預定價錢則使用逐張自動派單。因此遊戲「接單後鎖住一切」是主玩法簡化，不能描述成所有現行產品的同一行為。2024 文章的5%推廣／10%標準抽成亦不能直接宣稱已核實為2026現價。

[2026-08-27 的85折公告](https://www.uber.com/hk/zh-hk/blog/metertaxi15off/)確認這是司機自行接受的綜合要求。折扣只套用咪錶車資，隧道、行李及寵物附加費不打折；符合條件、經紅隧／東隧／西隧的過海行程只收指定單程隧道費。應以單型標籤呈現，不能把所有的士單自動打85折。

[2026-10-22 的士司機收入公告](https://www.uber.com/hk/zh-hk/blog/driver-fare-taxi/)及[同日私家車公告](https://www.uber.com/hk/zh-hk/blog/driver-fare/)列出的收入已扣平台服務費。服務費會逐單不同，不能再統一扣20%。已完成行程收入按實際時間、距離及適用項目計算；接單預估與最終收入不能視作同一保證數額。

一般非機場、非 Reserve 的官方司機淨收入表讀數：

| 港元 | 的士預定價錢 | UberX |
|---|---:|---:|
| 最低 | 35.06 | 29.89 |
| 基本 | 12.70 | 13.14 |
| 每km：0–5 | 4.69 | 4.15 |
| 每km：5–10 | 5.75 | 4.32 |
| 每km：10–15 | 5.39 | 4.11 |
| 每km：15以上 | 4.47 | 3.56 |
| 每分鐘行程 | 1.85 | 1.49 |
| 每分鐘接載等候 | 1.80 | 1.46 |

原始官方圖：[的士](https://tb-static.uber.com/prod/udam-assets/43ecf0f6-d802-45aa-a206-296217d0d9f7.png)、[私家車](https://tb-static.uber.com/prod/udam-assets/f5a07f90-6c2f-470e-b399-91e328788593.png)。公式的逐段累計、四捨五入及所有例外並未完整公開；目前 progressive 距離分段及接單時鎖定預定價合約是明示的遊戲近似；咪錶單另按實際載客里程結算。機場及提前預訂另有費率，不能直接沿用這張一般表。

[運輸署咪錶表](https://www.td.gov.hk/tc/transport_in_hong_kong/public_transport/taxi/taxi_fare_of_hong_kong/)現頁列 2024-07-14 生效的市區的士：首2km $29，其後每200m或部分／每分鐘等候或部分，至$102.5前每格$2.1，其後$1.4。不能把全程每分鐘再加在每200m上，否則會雙重計算正常移動。遊戲使用實際載客里程計算咪錶；接客前里程不計車資。未建模的交通停車等候跳錶及附加費保持0並明示省略；85折只作用於咪錶部分。

## 取消、等候與到單的不確定性

官方[2020-11-26 取消及等候文章](https://www.uber.com/hk/zh-hk/blog/cancellation-waittime-fee-multidestination/)年代太舊，不能把其3／5分鐘門檻或乘客$2/min直接當成2026司機規則。2026司機收入表有每分鐘等候淨額，但本次未核實各即時單型現行免收門檻及取消淨收入公式。因此目前 cancel payout=0、乘客耐性及候客門檻屬可調遊戲參數，不宣稱完全複製平台。

[2026-10-22 Reserve 說明](https://www.uber.com/hk/zh-hk/blog/uberreserve/)有獨立提前上線、已含等待時間及60分鐘內取消安排，並列明不同產品／機場流程。這些不能移植成普通即時單的規則；目前不把 Reserve 加進一般隨機派單池。

[運輸署交通習慣調查2025版本](https://www.td.gov.hk/tc/publications_and_press_releases/publications/free_publications/tcsfr/index.html)可供地區／時間／出行目的輪廓校準；不是屋苑到屋苑 Uber 派單紀錄。公開地圖、官方道路及上述費率並不能還原平台的私有需求、供應、排序、個人化派單、動態價格或取消風險。「擎天半島居民偏好過海」等說法仍是待司機訪談／實測的假說。灰色可能單是同一 seeded 世界、依位置與可接資格重算的遊戲反事實，不代表真實未接 Uber 單。

## 車租及資料權利

金豐日更$480／夜更$370、小露寶日更$560／夜更$490是使用者提供設定，未作市場統一租金認證。紅旗未有已確認車租；使用者其後指定先用早更$560／晚更$490，遊戲按暫定值顯示並容許修改，並非已核實市場報價。

地點資料隨附 [NOTICE](../assets/places/NOTICE.md) 及[CSDI完整條款](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC)。條款容許附條件的商業與非商業再利用，要求辨識政府／CSDI來源並承認相關知識產權；資料按現狀提供。catalog 本身保留 attribution 及 termsUrl，所有再分發副本均須保存來源聲明，並避免暗示政府認可本遊戲。
