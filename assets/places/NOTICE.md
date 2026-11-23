# Hong Kong named-place data

© Government of the Hong Kong Special Administrative Region / Lands Department / Home Affairs Department. Source: CSDI Portal. The Government and relevant data providers retain their intellectual property rights in the source data.

This derived catalogue is distributed under the [CSDI Portal Terms and Conditions of Use](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC). Those terms permit commercial and non-commercial reuse subject to their conditions, including source identification, intellectual-property acknowledgement and indemnification. The linked terms apply in full. The source data are provided as is. This game is not endorsed by or affiliated with the Government.

Snapshot: 18 November 2026. Sources:

- [Lands Department Building](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-landsd-building), CSDI dataset `landsd_rcd_1637211194312_35158`.
- [Lands Department Geographic Name](https://portal.csdi.gov.hk/geoportal/?lang=en&datasetId=landsd_rcd_1648571595120_89752), dataset `landsd_rcd_1648571595120_89752`.
- [Home Affairs Department administrative boundaries](https://data.gov.hk/en-data/dataset/hk-had-json1-hong-kong-administrative-boundaries), dataset `had_rcd_1634523272907_75218`.
- [Lands Department Location Search API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/LocationSearchAPI), for the two documented retail display aliases only.

The catalogue retains 37,925 real named records after filtering, conservative same-name/same-district deduplication and road proximity screening. Each record retains its official BuildingID or GEO_NAME_ID. Chinese and English names are preserved when supplied. Two composite retail labels enrich existing building records; their source names, evidence and unchanged coordinates are recorded in `retail-aliases.json` and `provenance.json`.

Building positions are derived centroids of source footprint polygons; settlement positions are source points. Nearest reachable ordinary-road nodes within 120 metres are game pickup proxies. These are not surveyed entrances or a guarantee of legal vehicle access. Remote or disconnected records are excluded; a named building is not proof that passengers can be collected there. Place classifications and the rural waiting profile are game design inferences, not official land-use classifications or measured Uber demand.

`provenance.json` records counts, source endpoints, query filters, download-page hashes and the road-node hash. `excluded-records.csv` records omitted source IDs and reasons. `spatial-index.json` indexes catalogue row numbers without adding synthetic places. Rebuild instructions are in `docs/iteration-02-research.md`.
