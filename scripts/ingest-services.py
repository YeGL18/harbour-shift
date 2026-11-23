#!/usr/bin/env python3
"""Build sourced LPG/swap sites and petrol sites with documented availability.

Run from the project root with --download to refresh public source snapshots;
without --download the task-local work/services-v3 cache is reused.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import urllib.request

PROJECT=Path(__file__).resolve().parents[1]
WORK=PROJECT.parents[1]/'work/services-v3'
OUT=PROJECT/'assets/services'
LPG_URL='https://www.emsd.gov.hk/filemanager/en/content_268/dataset/lpg_filling_station.csv'
SWAP_URL='https://www.dragonrise.hk/ch_t/battery_swapping_station.html'
PRICE_URL='https://www.info.gov.hk/gia/general/202610/23/P2026102300262p.htm'
SINOPEC_URL='https://www.sinopechongkong.com/retail_hk/driver_oil_network'
SHELL_URL='https://www.shell.com.hk/en_hk/motorists/shell-station-locator.html'
# Published ceiling prices, effective November 1–30, 2026. These are ceilings,
# not a claim about live pump prices or individual driver discounts.
CEILING_BY_EMSD_SEQUENCE={2:5.13,3:4.57,9:4.59,12:4.36,13:4.25,20:4.31,
                        21:4.35,28:4.69,45:4.42,46:4.19,47:4.53,48:4.56}

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')))
    temporary.replace(path)

def closest_node(lat,lon,nodes):
    scale=111320*math.cos(math.radians(lat))
    node=min(nodes,key=lambda n:((n['lat']-lat)*111132)**2+((n['lon']-lon)*scale)**2)
    distance=math.hypot((node['lat']-lat)*111132,(node['lon']-lon)*scale)
    return node['id'],round(distance,1)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--download',action='store_true');args=parser.parse_args()
    WORK.mkdir(parents=True,exist_ok=True)
    sources={'lpg-stations.csv':LPG_URL,'dragonrise-stations.html':SWAP_URL}
    if args.download:
        for filename,url in sources.items():
            request=urllib.request.Request(url,headers={'User-Agent':'HarbourShift-public-data-research/0.3'})
            with urllib.request.urlopen(request,timeout=60) as response:(WORK/filename).write_bytes(response.read())
    rows=list(csv.DictReader((WORK/'lpg-stations.csv').open(encoding='utf-8-sig')))
    nodes=[n for n in json.loads((PROJECT/'assets/map/road-nodes.json').read_text()) if n.get('pickupEligible')]
    stations=[];excluded=[]
    for row in rows:
        sequence=int(row['Sequence No.']);lat=float(row['Latitude']);lon=float(row['Longitude'])
        node_id,distance=closest_node(lat,lon,nodes)
        location=row['Location (Traditional Chinese)'];company=row['Company (Traditional Chinese)']
        dedicated=row['Dedicated Site (English)']=='Yes'
        reason='maintenance' if '維修' in location else 'reinspection' if '覆檢' in location else 'restricted-airport-vehicles-only' if '禁區' in location else None
        if distance>120:reason='no-eligible-road-within-120m'
        station={'id':f'emsd-lpg-{sequence}','name':f'{company} {location}','nameEn':f"{row['Company (English)']} {row['Location (English)']}",
            'lat':lat,'lon':lon,'nodeId':node_id,'snapDistanceM':distance,'kind':'lpg','district':row['District (Traditional Chinese)'],
            'dedicated':dedicated,'sourceUrl':LPG_URL,'sourceRecordId':str(sequence),'available':not reason,
            'serviceMinutes':4,'priceBasis':'official-ceiling' if dedicated else 'unverified',
            'priceNote':'2026年11月專用站上限價；非即時泵價' if dedicated else '個別站泵價未核實；結算採遊戲參考價',
            'statusNote':reason or 'listed-in-operation','fuelAvailabilitySource':LPG_URL}
        if sequence in CEILING_BY_EMSD_SEQUENCE:station.update(unitPrice=CEILING_BY_EMSD_SEQUENCE[sequence],priceAsOf='2026-11',priceSourceUrl=PRICE_URL)
        stations.append(station)
        if reason:excluded.append({'id':station['id'],'reason':reason})
        # Conventional Shell service stations and Sinopec's operator-described
        # 油(氣)站 sell petrol as well as LPG. Dedicated LPG-only sites are not
        # silently turned into petrol sites. Operators are separate evidence
        # for fuel availability; the government CSV remains coordinate source.
        company_en=row['Company (English)']
        if not dedicated and company_en in ['Shell','Sinopec']:
            petrol={**station,'id':f'emsd-site-petrol-{sequence}','kind':'petrol','dedicated':False,
                'priceBasis':'game-reference','unitPrice':16,'priceAsOf':'2026-11-18',
                'priceNote':'遊戲汽油參考價，非個別站即時牌價或折扣價',
                'priceSourceUrl':'game-config:v0.3-user-cost-calibration',
                'fuelAvailabilitySource':SHELL_URL if company_en=='Shell' else SINOPEC_URL}
            stations.append(petrol)
    html=(WORK/'dragonrise-stations.html').read_text()
    # Only the two 2026 stations; 2027+ planned site coordinates are not made
    # into currently operating service points.
    pattern=r"\{ no: ([12]), zh: '([^']+)', zhHans: '[^']+', en: '([^']+)', lat: ([\d.]+), lng: ([\d.]+) \}"
    swaps=re.findall(pattern,html)
    if len(swaps)!=2:raise RuntimeError('Operator station page changed: re-check live/trial vs planned stations')
    for number,tc,en,latitude,longitude in swaps:
        lat=float(latitude);lon=float(longitude);node_id,distance=closest_node(lat,lon,nodes)
        if distance>120:raise RuntimeError(f'Swap site {tc} cannot be snapped to ordinary road')
        stations.append({'id':f'dragonrise-swap-{number}','name':f'巧克力換電站・{tc}','nameEn':f'Choco Swap {en}',
            'lat':lat,'lon':lon,'nodeId':node_id,'snapDistanceM':distance,'kind':'swap','available':True,
            'district':'北區' if number=='1' else '葵青區','serviceMinutes':3,'sourceUrl':SWAP_URL,'sourceRecordId':number,
            'priceBasis':'unverified','statusNote':'operator-trial-operation-2026-07',
            'priceNote':'常規換電電費未核實；遊戲使用獨立參考值，不假設免費推廣資格'})
    save(OUT/'stations.json',{'schemaVersion':1,'attribution':'© HKSAR Government / EMSD; operator site facts attributed to Shell, Sinopec and Dragon Rise.','stations':stations})
    save(OUT/'provenance.json',{'generatedAt':datetime.now(timezone.utc).isoformat(),'retrievedDate':'2026-11-18',
        'governmentLpgCount':len(rows),'dedicatedLpgCount':sum(s['kind']=='lpg' and s['dedicated'] for s in stations),
        'counts':{kind:sum(s['kind']==kind for s in stations) for kind in ['lpg','petrol','swap']},'unavailable':excluded,
        'sources':{**sources,'novemberLpgCeilings':PRICE_URL,'petrolAvailabilityShell':SHELL_URL,'petrolAvailabilitySinopec':SINOPEC_URL},
        'sourceHashes':{name:hashlib.sha256((WORK/name).read_bytes()).hexdigest() for name in sources},
        'roadNodesSha256':hashlib.sha256((PROJECT/'assets/map/road-nodes.json').read_bytes()).hexdigest(),
        'coordinateWarning':'Source station points plus nearest ordinary-road proxies <=120m; entrances/direction of access not field-verified.',
        'pricingWarning':'12 dedicated LPG prices are dated official monthly ceilings. Non-dedicated LPG and swap regular prices unknown. Petrol16 is an explicitly shared game reference, not per-station market data.',
        'serviceTimingWarning':'LPG/petrol 4min, swap3min are game settings; operator99sec swap excludes travel/queue/handling.',
        'governmentTerms':'https://portal.csdi.gov.hk/csdi-webpage/doc/TNC'})
    print('Published',len(stations),'service entries;',len(rows),'LPG including',len(CEILING_BY_EMSD_SEQUENCE),'dated official ceiling prices;',len(swaps),'operator trial swap sites')

if __name__=='__main__':main()
