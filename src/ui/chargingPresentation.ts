import {ENERGY_PROFILE_DEFAULTS,type EnergyStation} from '../data/serviceStations';
import {selectChargingOption} from '../game/charging';
import type {ChargeConnector,VehicleId} from '../game/types';

const CONNECTOR_LABEL:Record<ChargeConnector,string>={type2:'Type2 AC',ccs2:'CCS2 DC',chademo:'CHAdeMO DC','gbt-ac':'GB/T AC','gbt-dc':'GB/T DC'};
export function chargingStationPresentation(vehicleId:VehicleId,station:EnergyStation,override?:number){
  const profile=ENERGY_PROFILE_DEFAULTS[vehicleId],port=selectChargingOption(profile,station,vehicleId);
  if(!port)return null;
  const custom=override!==undefined&&Number.isFinite(override)&&override>=0;
  const basis=port.priceBasis??station.priceBasis;
  return{connector:CONNECTOR_LABEL[port.connector],powerKw:port.powerKw,modelledPower:port.powerBasis!=='official',unitPrice:custom?override:port.unitPrice??station.unitPrice??profile.unitPrice,priceSource:custom?'custom' as const:basis==='official-reference'?'official-reference' as const:'game-reference' as const,priceAsOf:station.priceAsOf};
}
