import assert from 'node:assert/strict';
import test from 'node:test';
import raw from '../../assets/services/sources/epd-chargers-2026-11-20.json';
import {CHARGING_DATA_PROVENANCE,CHARGING_STATIONS,ENERGY_PROFILE_DEFAULTS,getCompatibleStations} from './serviceStations';
import {getVehicleRoadGraph,isCoordinateAllowed} from './vehicleAccess';
import {selectChargingOption} from '../game/charging';

test('charging catalog preserves real EPD names/coordinates/record IDs and bounded road proxies',()=>{
 assert.equal(CHARGING_DATA_PROVENANCE.rawDetailCount,990);assert.equal(CHARGING_DATA_PROVENANCE.rawGeotagCount,991);
 assert.equal(CHARGING_STATIONS.length,893);assert.equal(new Set(CHARGING_STATIONS.map(s=>s.id)).size,893);
 const byId=new Map(raw.data.map(s=>[String(s.id),s]));
 for(const station of CHARGING_STATIONS){const source=byId.get(station.sourceRecordId!)!;assert.ok(source);assert.equal(station.name,source.carParkCName);assert.equal(station.nameEn,source.carParkEName);assert.equal(station.lat,source.location.lat);assert.equal(station.lon,source.location.lng);assert.ok(station.snapDistanceM!<=120);assert.equal(source.openingHoursEn,'24-hour');assert.equal(station.kind,'charge');assert.ok(station.sourceUrl?.startsWith('https://ev-charger.epd.gov.hk/'));assert.ok(station.chargingOptions!.length);station.chargingOptions!.forEach(o=>assert.equal(o.powerBasis,'game-reference','speed category is never relabelled as actual rated kW'));}
});
test('each EV receives legal compatible stations and selectedport prices/power match the actual service choice',()=>{
 assert.deepEqual(ENERGY_PROFILE_DEFAULTS['tesla-model-s'].chargingConnectors,['type2'],'unverified older ModelS cannot assume CCS2 retrofit');
 for(const vehicleId of ['tesla-model-3','tesla-model-y','tesla-model-s','aion-y-plus-standard','aion-y-plus-premium','mg4-trophy'] as const){
  const graph=getVehicleRoadGraph(vehicleId),stations=getCompatibleStations(vehicleId);assert.ok(stations.length>600);
  for(const station of stations){assert.ok(graph.nodes[station.nodeId]);assert.ok(graph.outgoing[station.nodeId]?.length);assert.ok(isCoordinateAllowed(station,vehicleId));const option=selectChargingOption(ENERGY_PROFILE_DEFAULTS[vehicleId],station,vehicleId)!;assert.ok(option);assert.equal(station.unitPrice,option.unitPrice);assert.equal(station.chargePowerKw,option.powerKw);if(!vehicleId.startsWith('tesla-'))assert.notEqual(option.vehicleRestriction,'tesla-only');}
 }
 assert.equal(getCompatibleStations('kam-fung').length,63);assert.equal(getCompatibleStations('red-flag').length,2);assert.ok(getCompatibleStations('alphard-hybrid').every(s=>s.kind==='petrol'));
});
test('published tariffs and unknown tariff calibrations stay distinct and retain reference date',()=>{
 let published=0,modelled=0;
 for(const station of CHARGING_STATIONS)for(const option of station.chargingOptions!){assert.ok(Number.isFinite(option.unitPrice)&&option.unitPrice!>=0);assert.equal(station.priceAsOf,'2026-11-20');if(option.priceBasis==='official-reference')published++;else{modelled++;assert.equal(option.unitPrice,3);assert.equal(option.priceBasis,'game-reference');}}
 assert.ok(published>100);assert.ok(modelled>100);
});
