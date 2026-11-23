# Bundled Hong Kong map data

Copyright © Government of the Hong Kong Special Administrative Region.
Data providers: Transport Department and Lands Department.
Retrieved through CSDI Portal / DATA.GOV.HK on 18 November 2026.

## Road network

- [Transport Department Road Network, CSDI metadata](https://portal.csdi.gov.hk/csdi-webpage/metadata/td_rcd_1638949160594_2844/html)
- [Official feature service, CENTERLINE layer 10](https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/FeatureServer/10)
- [Official data specification](https://static.data.gov.hk/td/road-network/dataspec/rdnet_dataspec.pdf)

Version 0.2 uses the complete full-territory extract of **36,534 official centerline features**. It preserves source polylines, simplified by approximately 1.5 metres and rounded to seven decimal places, rather than drawing straight routes between landmarks. Loop roads are split at an existing vertex; endpoints within roughly 0.1 m join. A proper depth-first strongly-connected-component analysis retains the main road-connected territory (Hong Kong Island, Kowloon, New Territories, Sai Kung and road-connected Lantau); isolated road components remain visual context and are excluded from gameplay.

The main source component has 27,091 nodes and 36,229 physical segments. Same-name, same-direction, same-class segments without a junction are combined, then cut along their real polylines to provide routing/service anchors at most approximately 120 metres apart. The final graph has **44,340 nodes and 53,478 physical segments**; a bidirectional physical segment creates two directed edges. `graph-stats.json` records the exact counts and a measured maximum segment length of 120.10 m. `road-nodes.json` supplies 36,518 conservative pickup-eligible road proxies for the separately sourced place catalogue; these are not assertions of legal building entrances or taxi ranks.

Official TRAVEL_DIRECTION values are respected: 1 = both directions, 2 = against digitized geometry, 3 = along digitized geometry, 4 = restricted and excluded. Road elevation and strategic route number inform visual classification. Junction turn-restriction and vehicle-specific restrictions are not yet loaded, so this is a game graph, not a navigation product. Speeds of 25/38/45 km/h are explicit game assumptions, not official measured speeds. Some restricted roads that taxis could use are conservatively excluded to keep the shared taxi/private-car graph consistent.

## Land, harbour, parks and buildings

- [Lands Department 1:50 000 Topographic Map of Hong Kong, CSDI metadata](https://portal.csdi.gov.hk/csdi-webpage/metadata/landsd_rcd_1637221775627_85634/html)
- [Official topographic feature service](https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637221775627_85634/FeatureServer)

`base.json` derives from complete full-territory HYDRPOLY (layer 7, 631 source records), LANDPOLY (2, 4,258 records), FACIPOLY (3, 717 records) and BLDGPOLY (12, 45,541 records). The display extent is longitude 113.79–114.52, latitude 22.12–22.58. Water polygons preserve interior rings so islands remain land; breakwaters are excluded from water fill. Vegetation, parks and sports grounds form the green layer. Geometry is generalized by approximately 3–4 metres for a phone map; the source is a 1:50 000 map, not street-level survey geometry. This topographic building layer is separate from the place catalogue's named-building source.

`context-roads.json` includes source-derived restricted/disconnected background roads omitted from the gameplay component. These display segments are not added to saved itineraries. Road-name labels come from official road fields, and the place catalogue provides additional named locations.

## Native renderer

The app uses the stable `@maplibre/maplibre-react-native` 11.5.1 renderer. Compact bundled arrays are converted into local GeoJSON sources; no map tiles, styles, glyphs or route geometry are requested from a live service. iOS uses platform local-font fallback; Android uses the bundled OFL font described below. Neither requests remote glyphs. Pinch zoom, pan, pitch and camera easing run in the native renderer. Car coordinates use a Reanimated native marker. The selected route is one continuous line with a distance gradient; every offered branch has a short preview following actual road geometry. MapLibre and its native SDK retain their respective open-source licences: https://github.com/maplibre/maplibre-react-native/blob/v11.5.1/LICENSE.md

## Reuse terms and attribution

- [CSDI Portal Terms and Conditions of Use](https://static.csdi.gov.hk/csdi-webpage/doc/TNC)
- [DATA.GOV.HK Terms and Conditions](https://data.gov.hk/en/terms-and-conditions)

These terms permit commercial and non-commercial reuse subject to their conditions, including source and intellectual-property acknowledgement. The app retains a visible map attribution to the Government, providers, DATA.GOV.HK and CSDI. The geometry is locally bundled; the app makes no runtime calls to these map services and uses no public OpenStreetMap tile service.

This prototype is independent of the Government and of Uber. It does not reproduce Uber's dispatch data or proprietary map styling.

### Bundled offline Android map font

`harbour-sans-hk.otf` is a character subset of Noto Sans CJK HK Regular,
renamed Harbour Sans HK. Upstream: https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/TraditionalChineseHK
(font file `NotoSansCJKhk-Regular.otf`). The subset includes ASCII and the
characters present in the bundled official road and place catalog. The SIL
Open Font License is reproduced in `OFL-NotoSansHK.txt`. Font bytes are bundled;
MapLibre Native reads a local file through `font-faces`, without a glyph server.


Final runtime notes: Android writes the immutable full-territory source style to a local file before C++ loads it. This avoids Java JSONObject expansion and large GeoJsonSource finalizers. The reproducible `scripts/patch-maplibre-android.cjs` guards repeated identical Fabric style requests. GL children attach only after style readiness. iOS uses a small native fill polygon for its themed land base. Static source data is never stringified on each vehicle tick.

### 0.3 demand district shading

`districts.json` contains all 18 official HAD district boundaries, downloaded
2026-11-18 from CSDI's `had_rcd_1634523272907_75218/MapServer/0` service:
https://portal.csdi.gov.hk/server/rest/services/common/had_rcd_1634523272907_75218/MapServer/0
The WGS84 ArcGIS rings were grouped into exterior/hole polygons, rounded to six
decimals and generalized by approximately 20 metres for visual shading. These
polygons do not define vehicle access permissions. Multipliers, demand tiers
and waiting estimates come from the deterministic game engine, not live fares
or traffic. Native font coverage also includes the map's demand-label symbols.

### 0.4 local demand pockets and bilingual labels

The demand overlay uses localized soft heatmap lobes and wait badges, derived
from the same deterministic demand tiers as dispatch. It is a gameplay model,
not a live Uber heatmap. District boundary polygons no longer tint the map.

`road-names-en.json` contains 3,354 Chinese/English road-name pairs extracted
from the existing full-territory official Transport Department CENTERLINE
snapshot (`STREET_CNAME` / `STREET_ENAME`). The most frequent official pairing
is retained when a Chinese label has multiple records. English casing is
normalized for map typography; unnamed sentinel `-99` records are omitted.
POI English names use the bundled Lands Department catalogue. Neighbourhood
labels use official locality anchors where available. Static native sources
include both names once; language changes only the label expression.
