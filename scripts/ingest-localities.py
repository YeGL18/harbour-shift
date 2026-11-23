#!/usr/bin/env python3
"""Derive named locality anchors from the existing official LandsD snapshot.

These are name+point anchors, not invented legal neighbourhood polygons.
Uses the raw cache downloaded by ingest-places.py; no per-POI web requests.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
sys.dont_write_bytecode=True

PROJECT=Path(__file__).resolve().parents[1]
WORK=PROJECT.parents[1]/'work/places-v2'
OUT=PROJECT/'assets/localities'
spec=importlib.util.spec_from_file_location('place_ingestion',PROJECT/'scripts/ingest-places.py')
places=importlib.util.module_from_spec(spec);spec.loader.exec_module(places)

names={}
for feature in places.load_features('geographic-names'):
    a=feature['attributes'];names.setdefault(a['GEO_NAME_ID'],[]).append(a)
districts=places.district_lookup()
major_islands={'青衣','赤鱲角','馬灣','南丫島','長洲','坪洲'}
anchors=[];excluded=[]
for feature in places.load_features('geographic-points'):
    a=feature['attributes'];g=feature.get('geometry',{});options=names.get(a['GEO_NAME_ID'],[])
    official=next((n for n in options if n.get('NAME_STATUS')=='Official'),None)
    if not official or 'x' not in g:continue
    name=official.get('NAME_TC') or official.get('NAME_EN')
    settlement=a.get('PLACE_CLASS')=='Settlement' and a.get('PLACE_TYPE') in ['Area','Town']
    island=a.get('PLACE_CLASS')=='Topographic' and a.get('PLACE_TYPE')=='Island' and name in major_islands
    if not settlement and not island:continue
    if name in {'九龍','香港','新界','大嶼山'}:
        excluded.append({'id':a['GEO_NAME_ID'],'name':name,'reason':'region-too-broad-for-locality'});continue
    district=places.district_for(districts,g['x'],g['y'])
    if not district:
        district=next(((code,cn) for code,cn,_ in districts if code==a.get('DISTRICT')),None)
    if not district:
        excluded.append({'id':a['GEO_NAME_ID'],'name':name,'reason':'district-could-not-be-resolved'});continue
    code,cn=district
    anchors.append({'id':a['GEO_NAME_ID'],'name':name,'nameEn':official.get('NAME_EN') or '',
        'lat':g['y'],'lon':g['x'],'district':cn,'districtCode':code,'kind':'Island' if island else a['PLACE_TYPE'],
        'sourceRecordId':a['GEO_NAME_ID'],'sourceNameRecordId':official['PLACE_NAME_ID']})
anchors.sort(key=lambda item:(item['districtCode'],item['name'],item['id']))
OUT.mkdir(parents=True,exist_ok=True)
places.dump(OUT/'anchors.json',{'schemaVersion':1,'attribution':'© HKSAR Government / Lands Department. Source: CSDI Portal.',
    'termsUrl':'https://portal.csdi.gov.hk/csdi-webpage/doc/TNC','anchors':anchors})
places.dump(OUT/'provenance.json',{'snapshotDate':'2026-11-18','anchorCount':len(anchors),
    'byType':{kind:sum(a['kind']==kind for a in anchors) for kind in ['Area','Town','Island']},
    'source':'https://portal.csdi.gov.hk/geoportal/?lang=en&datasetId=landsd_rcd_1648571595120_89752',
    'areaSelection':'Official-name Settlement Area/Town points, plus six specified inhabited/airport island names. Broad region Kowloon excluded.',
    'boundarySource':'https://data.gov.hk/en-data/dataset/hk-had-json1-hong-kong-administrative-boundaries',
    'methodWarning':'Same-administrative-district nearest named anchor within a distance limit. Inferred locality coverage, not official neighbourhood boundaries or passenger demand evidence.',
    'excluded':excluded,'rawHashes':{name:hashlib.sha256((WORK/name/'000000.json').read_bytes()).hexdigest() for name in ['geographic-points','geographic-names','districts']}})
print('Published',len(anchors),'official locality name anchors',[(kind,sum(a['kind']==kind for a in anchors)) for kind in ['Area','Town','Island']])
