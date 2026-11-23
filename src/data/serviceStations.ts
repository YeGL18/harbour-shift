import type { Coordinate, VehicleId, EnergyProfile, ChargeConnector, ChargingOption } from '../game/types';
export type { EnergyKind, ChargeConnector, ChargingOption } from '../game/types';
import source from '../../assets/services/stations.json';
import chargingSource from '../../assets/services/charging.json';
import {selectChargingOption} from '../game/charging';
import { isPlaceAllowed } from './vehicleAccess';

import type { EnergyKind } from '../game/types';
export interface EnergyStation extends Coordinate {
  id: string;
  name: string;
  nameEn?: string;
  nodeId: string;
  kind: EnergyKind;
  district?: string;
  unitPrice?: number;
  serviceMinutes?: number;
  dedicated?: boolean;
  priceAsOf?: string;
  priceBasis?: 'official-ceiling' | 'official-reference' | 'game-reference' | 'operator-promotion' | 'unverified';
  sourceUrl?: string;
  sourceRecordId?: string;
  snapDistanceM?: number;
  available?: boolean;
  priceNote?: string;
  priceSourceUrl?: string;
  statusNote?: string;
  fuelAvailabilitySource?: string;
  connectorTypes?: ChargeConnector[];
  chargingOptions?: ChargingOption[];
  chargePowerKw?: number;
  address?: string;
  openingHours?: string;
  powerNote?: string;
  officialCarParkId?: string;
}

export const CHARGING_STATIONS = chargingSource.stations as EnergyStation[];
export const CHARGING_DATA_PROVENANCE = chargingSource.provenance;
export const SERVICE_STATIONS = [...source.stations,...CHARGING_STATIONS] as EnergyStation[];
export const SERVICE_DATA_AS_OF = '2026-11-18';
export const LPG_PRICE_AS_OF = '2026-11';
export const LPG_REFERENCE_PRICE = 4.57;
/** User-cost calibration for the game; never a published pump-price claim. */
export const PETROL_REFERENCE_PRICE = 16;
export const SWAP_REFERENCE_PRICE = 2.4;
export const CHARGE_REFERENCE_PRICE = 3;
/** EV capacities/power caps below are explicit editable game calibrations, not a model-year guarantee. */
const chargeProfile=(capacity:number,consumptionPerKm:number,maxChargePowerKw:number):EnergyProfile=>({kind:'charge',capacity,consumptionPerKm,unitPrice:CHARGE_REFERENCE_PRICE,initialFraction:1,chargingConnectors:['type2','ccs2'],maxChargePowerKw,maxACChargePowerKw:11,calibrationNote:'遊戲容量／能耗／充電功率校準；並非個別年份車輛實測。'});
export const ENERGY_PROFILE_DEFAULTS = {
  'kam-fung': {kind:'lpg',capacity:75.2,consumptionPerKm:1/9.8,unitPrice:LPG_REFERENCE_PRICE,initialFraction:1,serviceMinutes:4},
  'little-treasure': {kind:'lpg',capacity:41.6,consumptionPerKm:120/(400*LPG_REFERENCE_PRICE),unitPrice:LPG_REFERENCE_PRICE,initialFraction:1,serviceMinutes:4},
  'red-flag': {kind:'swap',capacity:56,consumptionPerKm:56/400,unitPrice:SWAP_REFERENCE_PRICE,initialFraction:1,serviceMinutes:3},
  'private': {kind:'petrol',capacity:50,consumptionPerKm:.055,unitPrice:PETROL_REFERENCE_PRICE,initialFraction:1,serviceMinutes:4},
  'tesla-model-3':chargeProfile(60,.16,170),
  'tesla-model-y':chargeProfile(60,.18,170),
  'tesla-model-s':{...chargeProfile(90,.20,11),chargingConnectors:['type2'] as ChargeConnector[]},
  'aion-y-plus-standard':chargeProfile(63.2,.16,80),
  'aion-y-plus-premium':chargeProfile(63.2,.16,80),
  'mg4-trophy':chargeProfile(64,.17,140),
  'alphard-hybrid':{kind:'petrol',capacity:50,consumptionPerKm:.07,unitPrice:PETROL_REFERENCE_PRICE,initialFraction:1,serviceMinutes:4},
  'vellfire-hybrid':{kind:'petrol',capacity:50,consumptionPerKm:.07,unitPrice:PETROL_REFERENCE_PRICE,initialFraction:1,serviceMinutes:4},
} satisfies Record<string,EnergyProfile>;
export const ENERGY_REFERENCE_NOTES = {
  'kam-fung': {
    capacityBasis:'Japanese Toyota Comfort 2016 reference: 94L nominal; game usable capacity uses80%=75.2L. Not a verified uniform HK model specification.',
    consumptionBasis:'Japanese reference AT test9.8km/L; real HK consumption varies. Used as a game calibration.',
    sources:['https://toyota.jp/pages/contents/comfort/001_b_013/pdf/spec/comfort_spec_201604.pdf'],
  },
  'little-treasure': {
    capacityBasis:'Older Japanese NTP10 reference52L nominal,75–80%fillable; game uses41.6L. Current Japanese model58L and HK year/model differences exist.',
    consumptionBasis:'User observation~HK$120/shift; game400km shift at4.57/L gives0.06565L/km. Not a universal measured shift cost.',
    sources:['https://toyota.jp/pages/contents/jpntaxi/001_b_001/pdf/spec/jpntaxi_spec_202402.pdf','https://www.toyota.com.hk/en/our-vehicles/taxi'],
  },
  'red-flag': {
    capacityBasis:'HK distributor E-QM5 specification56kWh,500km CLTC. Capacity is sourced;500km is a test rating, not real service range.',
    consumptionBasis:'Game400km usable-range calibration=0.14kWh/km.2.4HKD/kWh is an editable game price; regular swap tariff unverified.2026 promotional free swaps are conditional and not assumed.',
    sources:['https://www.dragonrise.hk/images/%E7%B4%85%E6%97%97E-QM5%E5%96%AE%E9%A0%81.pdf','https://www.dragonrise.hk/ch_t/battery_swapping_station.html'],
  },
  'private': {
    capacityBasis:'Generic game car:50L, not an identified model specification.',
    consumptionBasis:'User-requested lower-cost game calibration0.055L/km×16HKD/L=0.88HKD/km. Neither figure is an asserted current station tariff or measured real vehicle consumption.',
    sources:[],
  },
  'tesla-model-3':{capacityBasis:'60kWh editable game capacity; not an official Tesla HK model-year specification.',consumptionBasis:'0.16kWh/km and170kW DC/11kW AC caps are game calibrations. Type2/CCS2 model compatibility must match the selected HK vehicle.',sources:['https://www.tesla.com/zh_hk/model3?redirect=no']},
  'tesla-model-y':{capacityBasis:'60kWh editable game capacity; not an official Tesla HK model-year specification.',consumptionBasis:'0.18kWh/km and170kW DC/11kW AC caps are game calibrations.',sources:['https://www.tesla.com/zh_HK/modely']},
  'tesla-model-s':{capacityBasis:'90kWh editable game capacity; no asserted current HK new-car variant.',consumptionBasis:'0.20kWh/km and11kW Type2 AC cap are game calibrations. Conservative AC-only until exact model-year/CCS2 retrofit is verified; no adapter or DC compatibility is assumed.',sources:['https://www.tesla.com/zh_hk/models']},
  'aion-y-plus-standard':{capacityBasis:'HK dealer lists63.2kWh Y Plus battery; confirm selected model-year.',consumptionBasis:'0.16kWh/km and80kW DC/11kW AC caps are game calibrations, not a measured charging curve.',sources:['https://gacaionhk.com/zh/aion-y-plus-ch/']},
  'aion-y-plus-premium':{capacityBasis:'HK dealer lists63.2kWh Y Plus battery; Premium denotes equipment trim.',consumptionBasis:'0.16kWh/km and80kW DC/11kW AC caps are game calibrations, not a measured charging curve.',sources:['https://gacaionhk.com/zh/aion-y-plus-ch/']},
  'mg4-trophy':{capacityBasis:'HK MG4 Trophy reference64kWh battery; other MG models differ.',consumptionBasis:'0.17kWh/km and140kW DC/11kW AC caps are game calibrations, not a measured charging curve.',sources:['https://mg.richburgmotors.com/mg4/']},
  'alphard-hybrid':{capacityBasis:'Game usable petrol tank50L for the chosen HEV profile; not an asserted HK tank specification.',consumptionBasis:'0.07L/km and16HKD/L are editable game calibrations. This HEV takes petrol and is not plug-in charged.',sources:['https://www.toyota.com.hk/en/our-vehicles/alphard']},
  'vellfire-hybrid':{capacityBasis:'Game usable petrol tank50L for the chosen HEV profile; not an asserted HK tank specification.',consumptionBasis:'0.07L/km and16HKD/L are editable game calibrations. This HEV takes petrol and is not plug-in charged.',sources:['https://www.toyota.com.hk/en/our-vehicles/vellfire']},
} as const;
export const SERVICE_STATION_BY_ID = new Map(SERVICE_STATIONS.map(station => [station.id,station]));
const compatible = new Map<VehicleId,EnergyStation[]>();
export function getCompatibleStations(vehicleId: VehicleId): EnergyStation[] {
  const existing=compatible.get(vehicleId);if (existing) return existing;
  const profile=ENERGY_PROFILE_DEFAULTS[vehicleId];
  const result=SERVICE_STATIONS.filter(station => station.kind === profile.kind && station.available !== false
    && isPlaceAllowed({...station,district:station.district ?? '',kind:'transport'},vehicleId)).flatMap(station=>{
      if(profile.kind!=='charge')return[station];
      const option=selectChargingOption(profile,station,vehicleId);return option?[{...station,chargingOptions:[option],connectorTypes:[option.connector],chargePowerKw:option.powerKw,unitPrice:option.unitPrice??CHARGE_REFERENCE_PRICE,priceBasis:option.priceBasis??'game-reference',priceNote:option.priceNote}]:[];
    });
  compatible.set(vehicleId,result);return result;
}
