# Service location data

© HKSAR Government / Electrical and Mechanical Services Department. LPG site locations and the dedicated/non-dedicated classification are from [LPG Filling Stations in Operation](https://data.gov.hk/en-data/dataset/hk-emsd-emsd1-lpg-filling-station). Government/CSDI data and intellectual-property acknowledgements are retained subject to the [full CSDI terms](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC). No Government endorsement is implied.

Snapshot retrieved 18 November 2026: 66 LPG records, including 12 dedicated sites. A maintenance site, a reinspection site and an airport-restricted site are retained with unavailable flags. Ordinary-road snaps within120m are game proxies; station entrances, access direction and legal stopping space have not been surveyed.

Dedicated LPG prices are the [official November2026 ceiling prices](https://www.info.gov.hk/gia/general/202610/23/P2026102300262p.htm), effective November1–30. They are dated ceilings, not live pump prices or promised discounts. Non-dedicated LPG regular prices are unverified. Shared petrol16HKD/L and swap2.4HKD/kWh references are editable game settings, not real individual station quotations.

Petrol availability for the selected conventional Shell/Sinopec oil-and-gas sites is cross-checked against their public [Shell station directory](https://www.shell.com.hk/en_hk/motorists/shell-station-locator.html) and [Sinopec station network](https://www.sinopechongkong.com/retail_hk/driver_oil_network). Dedicated LPG sites are not classified as petrol stations. Site coordinate facts retain the EMSD source IDs.

Two battery-swap site names and coordinate facts are attributed to [Dragon Rise's official station page](https://www.dragonrise.hk/ch_t/battery_swapping_station.html), which describes Fanling/TsingYi trial operation in July2026. Future planned sites are omitted. No operator logos, maps or photography are reproduced. Regular swap pricing has not been verified; conditional2026 promotional free swapping is not assumed for every player.

`provenance.json` records source URLs, hashes, exclusions and modelling limits. `stations.json` retains source IDs, dates and price provenance per entry. Service durations are game parameters; the operator's99second swap headline is not a guarantee of total arrival/queue/handling time.

## Public EV charging data —20November2026 snapshot

© HKSAR Government / Environmental Protection Department. Real charger names, addresses, positions, connector counts and published tariff facts are from [Electric Vehicle Chargers for Public Access](https://data.gov.hk/en-data/dataset/hk-epd-evcpateam-evc-1), its [CSDI FeatureServer](https://portal.csdi.gov.hk/server/rest/services/common/epd_rcd_1631080339740_69941/FeatureServer/0) and the [EPD detailfeed linked from those records](https://ev-charger.epd.gov.hk/resource/ev_charger_avail/evca_ver_1_0.json), subject to the same [CSDI terms](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC). No endorsement is implied.

`sources/` retains only these public raw charging datasets; `charging.json` includes source hashes/URLs and893normalized named24hour venues. `charging-excluded.json` retains97excluded records/reasons. Coordinates are real source points; road anchors≤120m are game entrance proxies, not surveyed driveways. Private-car restrictions are applied again at runtime. No operator logos, photographs or private account data are included.

Connector compatibility, operator-network restrictions, dated reference tariffs, unpriced-game tariffs, category-derived GAME power and the taper/efficiency/partial-billing model are explained in `docs/charging-data-and-model.md`. Power categories are not exact per-charger kW. Prices are snapshots, not live promises; parking, idle fees, membership and real-time bay availability are not simulated. Existing LPG/petrol/swap facts and pricing remain separately labelled.
