# Fine locality names

© HKSAR Government / Lands Department / Home Affairs Department. Source: CSDI Portal. Government and relevant organisations retain intellectual-property ownership. Distributed subject to the [full CSDI Terms and Conditions of Use](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC); no Government endorsement or affiliation is implied.

Source snapshot18 November2026: [LandsD Geographic Name](https://portal.csdi.gov.hk/geoportal/?lang=en&datasetId=landsd_rcd_1648571595120_89752) and [HAD administrative boundaries](https://data.gov.hk/en-data/dataset/hk-had-json1-hong-kong-administrative-boundaries).

319 official name-and-coordinate anchors are retained:300 Settlement Areas,13 Towns and6 selected inhabited/airport Islands. The broad region name Kowloon is excluded. Each anchor preserves GEO_NAME_ID and the official name-table PLACE_NAME_ID. These anchors do not increase the passenger POI count.

Locality coverage is inferred deterministically from the nearest same-administrative-district anchor, within4km for Areas and6km for Towns/selected Islands. These are not official neighbourhood boundary polygons. Where no suitable anchor exists, the original administrative district is retained. Unknown coordinates are not assigned invented neighbourhood names. This display helper is independent of passenger demand, pricing and any assumptions about residents' travel preferences.

Rebuild using `python3 scripts/ingest-localities.py` after the official raw snapshot is downloaded by `ingest-places.py`. Source hashes and selection rules are recorded in `provenance.json`.
