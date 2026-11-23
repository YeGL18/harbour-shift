#!/usr/bin/env python3
"""Normalize downloaded PUBLIC EPD feeds; no network, invented places or live-bay claims."""
import argparse,collections,hashlib,json,math,pathlib,re

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--details',type=pathlib.Path,required=True);ap.add_argument('--geotags',type=pathlib.Path,required=True);args=ap.parse_args()
    root=pathlib.Path(__file__).resolve().parents[1]
    feed=json.loads(args.details.read_text()); geo=json.loads(args.geotags.read_text())
    districts={f['properties']['OBJECTID']:f['properties'] for f in geo['features']}
    nodes=json.loads((root/'assets/map/road-nodes.json').read_text())
    cells=collections.defaultdict(list)
    for n in nodes:
        if n.get('pickupEligible'):cells[(math.floor(n['lat']/.002),math.floor(n['lon']/.002))].append(n)
    def snap(lat,lon):
        cy,cx=math.floor(lat/.002),math.floor(lon/.002); candidates=[]
        for dy in range(-1,2):
            for dx in range(-1,2):
                for n in cells.get((cy+dy,cx+dx),[]):
                    m=math.hypot((lat-n['lat'])*111320,(lon-n['lon'])*111320*math.cos(math.radians(lat)))
                    if m<=120:candidates.append((m,n['id']))
        return min(candidates) if candidates else None
    # These IDs/names are recorded by the EPD feed, not guessed from plug photographs.
    standards={22:'type2',31:'ccs2',28:'chademo'}
    power={6:7,5:50,22:100} # GAME category representatives; actual per-point kW is unpublished.
    operators={}
    for venue in feed['data']:
        ids=[x for x in venue.get('chargerOperatorIDAll','').split(';') if x]
        if len(ids)==1:operators[int(ids[0])]=venue.get('chargerOperatorAll','')
    excluded=[];stations=[]
    for venue in feed['data']:
        ident=venue['id']; name=venue.get('carParkCName','').strip(); location=venue.get('location') or {};lat=location.get('lat');lon=location.get('lng')
        reason=None
        # isEnable belongs to the status feed; no published definition establishes
        # that false means a public venue is closed, so do not invent that claim.
        if not name or not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)):reason='missing-real-location'
        elif venue.get('openingHoursEn')!='24-hour':reason='not-published-24hour'
        options=[]
        for raw in venue.get('chargerTotalByCombinations',[]):
            typ=raw.get('chargerTypeID');standard=raw.get('chargingStandardID');op=raw.get('chargerOperatorID')
            if typ not in power or raw.get('numOfCharger',0)<=0 or op in (124,130):continue # unverified BMW/Mercedes access excluded
            connector=standards.get(standard)
            if standard==16:connector='gbt-ac' if typ==6 else 'gbt-dc'
            if not connector:continue # No portable13A/unknown adapter assumption.
            priceText=str(raw.get('chargingFeeByEnergy') or '')
            simple=bool(re.fullmatch(r'\d+(?:\.\d+)?',priceText)) and raw.get('chargingFeeByEnergyUnit')==1000 and raw.get('chargingFeeByTime') is None and raw.get('chargingFeeCombination') is None
            option={'connector':connector,'powerKw':power[typ],'powerBasis':'game-reference','unitPrice':float(priceText) if simple else 3,'priceBasis':'official-reference' if simple else 'game-reference','priceNote':'環保署每度電收費快照；泊車費另計。' if simple else '未有單一公開每度電價；遊戲參考價，並非現價。','operator':operators.get(op,f'EPD operator {op}'),'count':raw['numOfCharger'],'sourceStandardId':standard,'sourceChargerTypeId':typ,'sourceOperatorId':op}
            if op==4:option['vehicleRestriction']='tesla-only'
            options.append(option)
        if not options and not reason:reason='no-supported-connector-or-verified-operator-access'
        nearest=snap(lat,lon) if not reason else None
        if not nearest and not reason:reason='more-than120m-from-reachable-safe-road-anchor'
        if reason:excluded.append({'sourceRecordId':str(ident),'name':name,'reason':reason});continue
        properties=districts.get(ident,{})
        # A changed/re-indexed geotag must not silently attach the wrong district.
        if properties.get('LOCATION_TC')!=name:properties={}
        selected=max(options,key=lambda x:(x['powerKw'],-x['unitPrice']))
        stations.append({'id':f'charge-epd-{ident}','name':name,'nameEn':venue.get('carParkEName'),'lat':lat,'lon':lon,'nodeId':nearest[1],'kind':'charge','district':properties.get('NAME_OF_DISTRICT_COUNCIL_DISTRICT_TC',''),'address':venue.get('carParkCAddress'),'connectorTypes':sorted({o['connector'] for o in options}),'chargingOptions':options,'chargePowerKw':selected['powerKw'],'unitPrice':selected['unitPrice'],'priceBasis':selected['priceBasis'],'priceAsOf':'2026-11-20','priceNote':selected['priceNote'],'sourceUrl':'https://ev-charger.epd.gov.hk/resource/ev_charger_avail/evca_ver_1_0.json','sourceRecordId':str(ident),'officialCarParkId':venue.get('carParkId'),'snapDistanceM':round(nearest[0],2),'available':True,'openingHours':'24-hour','statusNote':'遊戲假設有空位；未模擬現實泊車費、會員或即時空位。','powerNote':'功率按公開速度分類作遊戲估算，並非個別充電器實際額定值。'})
    out=root/'assets/services/charging.json'
    provenance={'provider':'Hong Kong Environmental Protection Department','dataset':'Electric Vehicle Chargers for Public Access','retrievedAt':'2026-11-20','detailLastUpdateDate':feed.get('lastUpdateDate'),'detailURL':'https://ev-charger.epd.gov.hk/resource/ev_charger_avail/evca_ver_1_0.json','geotagURL':'https://portal.csdi.gov.hk/server/rest/services/common/epd_rcd_1631080339740_69941/FeatureServer/0','catalogURL':'https://data.gov.hk/en-data/dataset/hk-epd-evcpateam-evc-1','rawDetailSHA256':hashlib.sha256(args.details.read_bytes()).hexdigest(),'rawGeotagsSHA256':hashlib.sha256(args.geotags.read_bytes()).hexdigest(),'rawDetailCount':len(feed['data']),'rawGeotagCount':len(geo['features']),'includedCount':len(stations),'excludedCounts':dict(collections.Counter(x['reason'] for x in excluded)),'roadSnap':'<=120m to pickupEligible node of largest reachable road SCC; road entrance proxy, not surveyed carpark driveway','powerModelKw':power,'publishedTariff':'Only unambiguous energy-only HKD/1000Wh values; other prices use explicit game3HKD/kWh. Parking/membership/idle fees are not represented.'}
    out.write_text(json.dumps({'provenance':provenance,'stations':stations},ensure_ascii=False,separators=(',',':'))+'\n')
    (root/'assets/services/charging-excluded.json').write_text(json.dumps(excluded,ensure_ascii=False,indent=2)+'\n')
    archive=root/'assets/services/sources';archive.mkdir(exist_ok=True)
    (archive/'epd-chargers-2026-11-20.json').write_bytes(args.details.read_bytes())
    (archive/'epd-chargers-geotags-2026-11-20.geojson').write_bytes(args.geotags.read_bytes())
    print(json.dumps(provenance,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
