#!/usr/bin/env python3
"""Build a traceable named-POI catalogue from official HK open geospatial data.

Uses Python's standard library only. Network requests are batched, never one per
POI. Building anchors are derived footprint centroids, not verified entrances.
Run --download --normalize, then --snap after the whole-HK road graph is ready.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROJECT = Path(__file__).resolve().parents[1]
WORK = PROJECT.parents[1] / 'work' / 'places-v2'
OUT = PROJECT / 'assets' / 'places'
BASE = 'https://portal.csdi.gov.hk/server/rest/services/common/'
SERVICES = {
    'buildings': 'landsd_rcd_1637211194312_35158/MapServer/0',
    'geographic-points': 'landsd_rcd_1648571595120_89752/MapServer/0',
    'geographic-names': 'landsd_rcd_1648571595120_89752/MapServer/1000',
    'districts': 'had_rcd_1634523272907_75218/MapServer/0',
}
BUILDING_WHERE = "Status = 'Active' AND ((BuildingNameTC IS NOT NULL AND BuildingNameTC <> '') OR (BuildingNameEN IS NOT NULL AND BuildingNameEN <> ''))"
BUILDING_FIELDS = 'OBJECTID,GeoRefNo,BuildingCSUID,BuildingID,BuildingNameTC,BuildingNameEN,BuildingBlockType,Status,DateStamp'
SOURCES = ['landsd-building', 'landsd-geographic-name']
KINDS = ['residential', 'shopping', 'business', 'transport']
X_SCALE = 111320 * math.cos(math.radians(22.35))
Y_SCALE = 111132


def dump(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


def request_json(url: str, params: dict):
    full = url + '?' + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            req = urllib.request.Request(full, headers={'User-Agent': 'HarbourShift-data-ingestion/0.2 (public open-data batch client)'})
            with urllib.request.urlopen(req, timeout=100) as response:
                value = json.load(response)
            if 'error' in value:
                raise RuntimeError(str(value['error']))
            return value
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def download_layer(name: str):
    folder = WORK / name
    folder.mkdir(parents=True, exist_ok=True)
    endpoint = BASE + SERVICES[name] + '/query'
    where = BUILDING_WHERE if name == 'buildings' else '1=1'
    count = request_json(endpoint, {'f': 'json', 'where': where, 'returnCountOnly': 'true'})['count']
    items, seen, pages = [], set(), []
    for offset in range(0, count, 3000):
        path = folder / f'{offset:06d}.json'
        params = {'f': 'json', 'where': where, 'outFields': BUILDING_FIELDS if name == 'buildings' else '*',
                  'outSR': '4326', 'returnGeometry': 'false' if name == 'geographic-names' else 'true',
                  'orderByFields': 'OBJECTID ASC', 'resultOffset': offset, 'resultRecordCount': 3000,
                  'geometryPrecision': 7}
        if name == 'buildings':
            params['maxAllowableOffset'] = 0.00001
        if path.exists():
            page = json.loads(path.read_text())
        else:
            page = request_json(endpoint, params)
            dump(path, page)
            time.sleep(0.2)
        for feature in page.get('features', []):
            oid = feature['attributes']['OBJECTID']
            if oid in seen:
                raise RuntimeError(f'Duplicate official OBJECTID in paged response: {name}/{oid}')
            seen.add(oid)
            items.append(feature)
        pages.append({'file': str(path.relative_to(WORK)), 'rows': len(page.get('features', [])),
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        print(f'{name}: {min(offset + 3000, count)}/{count}', flush=True)
    if len(items) != count:
        raise RuntimeError(f'Incomplete download: {name} got {len(items)}, official count {count}')
    dump(folder / 'manifest.json', {'retrievedAt': datetime.now(timezone.utc).isoformat(),
         'endpoint': endpoint, 'where': where, 'officialCount': count, 'downloadedCount': len(items), 'pages': pages})


def load_features(name: str):
    manifest = json.loads((WORK / name / 'manifest.json').read_text())
    return [f for page in manifest['pages'] for f in json.loads((WORK / page['file']).read_text()).get('features', [])]


def ring_centroid(ring):
    # Translate coordinates first to avoid cancellation with small footprints.
    ox, oy = ring[0]
    twice_area = cx = cy = 0.0
    for p, q in zip(ring, ring[1:] + ring[:1]):
        x, y, u, v = p[0] - ox, p[1] - oy, q[0] - ox, q[1] - oy
        a = x * v - u * y
        twice_area += a
        cx += (x + u) * a
        cy += (y + v) * a
    if abs(twice_area) < 1e-17:
        return abs(twice_area), sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    return abs(twice_area), ox + cx / (3 * twice_area), oy + cy / (3 * twice_area)


def contains(ring, x, y):
    inside = False
    previous = ring[-1]
    for point in ring:
        ax, ay = previous[0], previous[1]
        bx, by = point[0], point[1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
        previous = point
    return inside


def district_lookup():
    result = []
    for f in load_features('districts'):
        a = f['attributes']
        code = a.get('AREA_CODE') or a.get('DISTRICT') or str(a.get('OBJECTID'))
        name = a.get('NAME_TC') or a.get('地區') or a.get('District') or code
        rings = []
        for ring in f['geometry']['rings']:
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            rings.append((min(xs), min(ys), max(xs), max(ys), ring))
        result.append((code, name, rings))
    return result


def district_for(districts, lon, lat):
    for code, name, rings in districts:
        inside = False
        for xmin, ymin, xmax, ymax, ring in rings:
            if xmin <= lon <= xmax and ymin <= lat <= ymax and contains(ring, lon, lat):
                inside = not inside
        if inside:
            return code, name
    return None


def classify(name, english):
    text = name + ' ' + english
    if re.search(r'機場|碼頭|車站|轉車站|鐵路站|巴士總站|鐵站|港鐵.*站|Airport|Ferry Pier|Bus Terminus|Railway Station|MTR.*Station', text, re.I):
        return 'transport'
    if re.search(r'商場|購物|街市|百貨|Mall|Shopping|Plaza|MegaBox|Market', text, re.I):
        return 'shopping'
    if re.search(r'工業|商業|商務|寫字|企業|金融|銀行|科技|工廠|商貿|醫院|醫療|學校|中學|小學|大學|政府|警署|消防|體育|會所|圖書館|酒店|旅館|公園|教堂|寺|廟|博物館|球場|泳池|Industrial|Commercial|Office|Hospital|School|University|Hotel|Library|Government|Sports|Enterprise|Financial Cent|Business Cent|Ocean Park|Disney', text, re.I):
        return 'business'
    return 'residential'


def normalize():
    districts = district_lookup()
    candidates, excluded, building_ids = [], [], set()
    generic = re.compile(r'^(?:第?[一二三四五六七八九十百\dA-Z]+[座幢號]?|[A-Z\d]+|BLOCK\s*[A-Z\d]+|TOWER\s*[A-Z\d]+)$', re.I)
    infrastructure = re.compile(r'泵房|泵站|公廁|廁所|變電站|配電室|電力分站|垃圾收集|污水處理|Pump House|Pumping Station|Public Toilet|Substation|Refuse Collection', re.I)
    street_only = re.compile(r'^[^\d０-９]{1,50}(?:道|街|路|徑|里|坊|巷)$|^[^\d]+\s(?:Road|Street|Lane|Avenue|Drive|Path|Terrace|Way)$', re.I)
    for f in load_features('buildings'):
        a = f['attributes']
        record_id = str(a.get('BuildingID') or a.get('BuildingCSUID') or a['OBJECTID'])
        tc, en = (a.get('BuildingNameTC') or '').strip(), (a.get('BuildingNameEN') or '').strip()
        name = tc or en
        reason = None
        if record_id in building_ids:
            reason = 'duplicate-building-id'
        elif not name:
            reason = 'unnamed'
        elif not re.search(r'[A-Za-z\u3400-\u9fff]', unicodedata.normalize('NFKC', name)) or name.casefold() in ['nil', 'n/a', 'unknown', 'tbc']:
            reason = 'placeholder-name'
        elif generic.fullmatch(unicodedata.normalize('NFKC', name)):
            reason = 'unqualified-block-label'
        elif street_only.fullmatch(name):
            reason = 'street-label-without-building-or-address-identifier'
        elif infrastructure.search(name + ' ' + en):
            reason = 'non-passenger-infrastructure'
        rings = (f.get('geometry') or {}).get('rings') or []
        if not rings:
            reason = reason or 'missing-footprint'
        if reason:
            excluded.append([SOURCES[0], record_id, name, reason])
            continue
        building_ids.add(record_id)
        _, lon, lat = max((ring_centroid(r) for r in rings if len(r) >= 3), key=lambda x: x[0])
        district = district_for(districts, lon, lat)
        if not district:
            excluded.append([SOURCES[0], record_id, name, 'outside-official-district-boundaries'])
            continue
        code, district_name = district
        candidates.append({'id': f'building-{record_id}', 'name': name, 'nameEn': en, 'district': district_name,
            'districtCode': code, 'kind': classify(name, en), 'lat': round(lat, 7), 'lon': round(lon, 7),
            'sourceId': SOURCES[0], 'sourceRecordId': record_id, 'geoRefNo': a.get('GeoRefNo') or '',
            'coordinateBasis': 'footprint-centroid'})
    names = {}
    for f in load_features('geographic-names'):
        a = f['attributes']
        names.setdefault(a['GEO_NAME_ID'], []).append(a)
    place_classes = {}
    for f in load_features('geographic-points'):
        a, g = f['attributes'], f.get('geometry') or {}
        place_classes[str((a.get('PLACE_CLASS'), a.get('PLACE_TYPE')))] = place_classes.get(str((a.get('PLACE_CLASS'), a.get('PLACE_TYPE'))), 0) + 1
        ns = names.get(a.get('GEO_NAME_ID'), [])
        if not ns or 'x' not in g:
            continue
        n = next((n for n in ns if n.get('NAME_STATUS') in ['E', 'Current', 'Adopted', 'A', '1']), ns[0])
        tc, en = (n.get('NAME_TC') or '').strip(), (n.get('NAME_EN') or '').strip()
        name = tc or en
        # Only settlement names belong in a pickup catalogue; hydrographic and
        # relief records remain in the raw download, never synthetic pickups.
        cls = str(a.get('PLACE_CLASS') or '').upper()
        if cls not in ['SETTLEMENT', 'SETTLEMENTS', 'S', '1', 'PL', 'PLACE', 'SET']:
            excluded.append([SOURCES[1], a.get('GEO_NAME_ID'), name, f'non-settlement-class:{cls}'])
            continue
        district = district_for(districts, g['x'], g['y'])
        if not district or not name:
            continue
        code, district_name = district
        candidates.append({'id': 'place-' + a['GEO_NAME_ID'], 'name': name, 'nameEn': en, 'district': district_name,
            'districtCode': code, 'kind': 'residential', 'lat': round(g['y'], 7), 'lon': round(g['x'], 7),
            'sourceId': SOURCES[1], 'sourceRecordId': a['GEO_NAME_ID'], 'geoRefNo': '', 'coordinateBasis': 'official-point'})
    # Same named footprint repeated by multiple source representations is one POI.
    unique, names_at_point = [], set()
    for p in sorted(candidates, key=lambda p: p['id']):
        key = (unicodedata.normalize('NFKC', p['name']).casefold(), round(p['lat'], 5), round(p['lon'], 5))
        if key in names_at_point:
            excluded.append([p['sourceId'], p['sourceRecordId'], p['name'], 'duplicate-name-coordinate'])
        else:
            names_at_point.add(key)
            unique.append(p)
    dump(WORK / 'candidates.json', unique)
    dump(WORK / 'normalization-exclusions.json', excluded)
    dump(WORK / 'place-class-counts.json', place_classes)
    print(f'Normalized {len(unique)} genuine named candidates; {len(excluded)} exclusions; classes={place_classes}', flush=True)


def snap(max_snap: float):
    graph_path = PROJECT / 'assets/map/road-nodes.json'
    nodes = json.loads(graph_path.read_text())
    if isinstance(nodes, dict):
        nodes = nodes['nodes']
    eligible = [n for n in nodes if n.get('pickupEligible', True)]
    if len(eligible) < 1000:
        raise RuntimeError('Whole-HK pickup-eligible SCC road anchors are required before snapping')
    grid = {}
    for n in eligible:
        x, y = n['lon'] * X_SCALE, n['lat'] * Y_SCALE
        grid.setdefault((math.floor(x / 200), math.floor(y / 200)), []).append((x, y, n['id']))
    accepted, excluded = [], json.loads((WORK / 'normalization-exclusions.json').read_text())
    for p in json.loads((WORK / 'candidates.json').read_text()):
        x, y = p['lon'] * X_SCALE, p['lat'] * Y_SCALE
        ix, iy = math.floor(x / 200), math.floor(y / 200)
        best, node_id = max_snap + 1, None
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                for nx, ny, nid in grid.get((ix + dx, iy + dy), []):
                    distance = math.hypot(nx - x, ny - y)
                    if distance < best:
                        best, node_id = distance, nid
        if best > max_snap or node_id is None:
            excluded.append([p['sourceId'], p['sourceRecordId'], p['name'], 'no-eligible-scc-road-node-within-limit'])
            continue
        p['nodeId'], p['snapDistanceM'] = node_id, round(best, 1)
        # Design geofence, not an empirical claim about Uber arrival rates.
        p['waitingProfile'] = 'saikung' if p['districtCode'] == 'SK' and (p['lat'] >= 22.35 or p['lon'] >= 114.29) else 'ordinary'
        accepted.append(p)
    # Campus/site names repeat on many official footprint records (e.g. Ocean
    # Park). Publish one representative per actual name+district, not hundreds
    # of same-labelled source structures masquerading as distinct venues.
    venue_names, unique_venues = set(), []
    for p in sorted(accepted, key=lambda p: (p['snapDistanceM'], p['id'])):
        key = (unicodedata.normalize('NFKC', p['name']).casefold(), p['districtCode'])
        if key in venue_names:
            excluded.append([p['sourceId'], p['sourceRecordId'], p['name'], 'same-official-name-and-district-represented-once'])
        else:
            venue_names.add(key)
            unique_venues.append(p)
    accepted = unique_venues
    enrichment_path = OUT / 'retail-aliases.json'
    retail_aliases = json.loads(enrichment_path.read_text()) if enrichment_path.exists() else []
    for alias in retail_aliases:
        p = next((p for p in accepted if p['sourceRecordId'] == alias['buildingId']), None)
        if p:
            p['name'], p['nameEn'], p['kind'] = alias['displayName'], alias['displayNameEn'], 'shopping'
    if len(accepted) < 10000:
        raise RuntimeError(f'Only {len(accepted)} genuine eligible records: investigate coverage before publishing')
    # Keep the familiar introductory destination IDs when the corresponding
    # official record is available; names/coordinates remain source-derived.
    aliases = [('harbour-city', '海港城'), ('megabox', 'MegaBox'), ('sorrento', '擎天半島'),
               ('elements', '圓方'), ('langham', '朗豪坊'), ('olympian', '奧海城'),
               ('west-kowloon', '西九龍站'), ('sham-shui-po', '深水埗站'),
               ('cheung-sha-wan', '長沙灣廣場'), ('kowloon-bay', '德福廣場'),
               ('central', '國際金融中心'), ('admiralty', '金鐘站')]
    aliases_found = {}
    curated_kinds = {'harbour-city': 'shopping', 'megabox': 'shopping', 'sorrento': 'residential',
        'elements': 'shopping', 'langham': 'shopping', 'olympian': 'shopping', 'west-kowloon': 'transport',
        'sham-shui-po': 'transport', 'cheung-sha-wan': 'shopping', 'kowloon-bay': 'shopping',
        'central': 'business', 'admiralty': 'transport'}
    for alias, term in aliases:
        matches = [p for p in accepted if term.casefold() in (p['name'] + ' ' + p['nameEn']).casefold()]
        if matches:
            selected = min(matches, key=lambda p: (0 if p['name'] == term or p['nameEn'] == term else 1, p['snapDistanceM']))
            aliases_found[alias] = selected['sourceRecordId']
            selected['id'] = alias
            selected['kind'] = curated_kinds[alias]
    accepted.sort(key=lambda p: (p['districtCode'], p['id']))
    columns = ['id', 'name', 'nameEn', 'district', 'districtCode', 'kind', 'lat', 'lon', 'nodeId',
               'snapDistanceM', 'waitingProfile', 'sourceId', 'sourceRecordId', 'geoRefNo', 'coordinateBasis']
    dump(OUT / 'catalog.json', {'schemaVersion': 2,
         'attribution': '© HKSAR Government / Lands Department / Home Affairs Department. Source: CSDI Portal.',
         'termsUrl': 'https://portal.csdi.gov.hk/csdi-webpage/doc/TNC',
         'columns': columns, 'rows': [[p[k] for k in columns] for p in accepted]})
    index = {}
    for i, p in enumerate(accepted):
        cell = f"{math.floor(p['lon'] / 0.004)},{math.floor(p['lat'] / 0.004)}"
        index.setdefault(cell, []).append(i)
    dump(OUT / 'spatial-index.json', {'cellSizeDegrees': 0.004, 'rowIndicesByCell': index})
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / 'excluded-records.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream)
        writer.writerow(['source', 'sourceRecordId', 'officialName', 'reason'])
        writer.writerows(excluded)
    def counts(key):
        return {v: sum(p[key] == v for p in accepted) for v in sorted(set(p[key] for p in accepted))}
    manifests = {name: json.loads((WORK / name / 'manifest.json').read_text()) for name in SERVICES}
    dump(OUT / 'provenance.json', {'schemaVersion': 2, 'generatedAt': datetime.now(timezone.utc).isoformat(),
         'attribution': '© HKSAR Government / Lands Department / Home Affairs Department. Source: CSDI Portal.',
         'termsUrl': 'https://portal.csdi.gov.hk/csdi-webpage/doc/TNC', 'notGovernmentEndorsed': True,
         'coordinateWarning': 'Building coordinates are derived footprint centroids; road snaps are game pickup proxies, not verified legal entrances.',
         'classificationWarning': 'Place kind and rural waitingProfile are game design inferences, not government land-use or real Uber-demand statistics.',
         'maxSnapDistanceM': max_snap, 'roadNodeCount': len(nodes), 'pickupEligibleNodeCount': len(eligible),
         'roadNodesSha256': hashlib.sha256(graph_path.read_bytes()).hexdigest(), 'retainedCount': len(accepted),
         'excludedCount': len(excluded), 'byDistrict': counts('district'), 'byKind': counts('kind'),
         'bySource': counts('sourceId'), 'byWaitingProfile': counts('waitingProfile'), 'introAliases': aliases_found,
         'retailAliasEnrichments': retail_aliases, 'distinctNameDistrictCount': len(accepted),
         'downloads': manifests})
    print(f'Published {len(accepted)} source-record POIs. Districts={counts("district")}; waiting={counts("waitingProfile")}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--normalize', action='store_true')
    parser.add_argument('--snap', action='store_true')
    parser.add_argument('--max-snap-m', type=float, default=120)
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    if args.download:
        for source in SERVICES:
            download_layer(source)
    if args.normalize:
        normalize()
    if args.snap:
        snap(args.max_snap_m)
