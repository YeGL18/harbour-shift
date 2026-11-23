import type { ShiftDurationMinutes, ShiftType, Vehicle, VehicleId } from '../game/types';
import {getShiftDurationMinutes} from '../game/shiftDuration';
import { ENERGY_PROFILE_DEFAULTS } from './serviceStations';
import {passengerCapacity,vehicleAccessProfile,vehicleSupportsXL} from '../game/vehicleCapabilities';

// Gold/Hybrid shift rentals are user-provided. Red Flag/private rentals and
// energy costs remain editable game configuration, not market quotations.
// Taxi payouts use the separate,
// source-labelled driver net-rate card in fares.ts, with no second commission.
const LEGACY_VEHICLES: Vehicle[] = [
  { id: 'kam-fung', name: '金豐的士', subtitle: '經典房車・日更 $480／夜更 $370', type: 'taxi', color: '#C64F48', rentalCost: 480, rentalDay: 480, rentalNight: 370, rentalSource: 'user-provided', fuelCostPerKm: 4.57 / 9.8, energyProfile: ENERGY_PROFILE_DEFAULTS['kam-fung'], commissionRate: 0, baseFare: 12.7, farePerKm: 4.69, farePerMinute: 1.85 },
  { id: 'little-treasure', name: '小露寶', subtitle: '混能高身・日更 $560／夜更 $490', type: 'taxi', color: '#51A59A', rentalCost: 560, rentalDay: 560, rentalNight: 490, rentalSource: 'user-provided', fuelCostPerKm: .30, energyProfile: ENERGY_PROFILE_DEFAULTS['little-treasure'], commissionRate: 0, baseFare: 12.7, farePerKm: 4.69, farePerMinute: 1.85 },
  { id: 'red-flag', name: '紅旗的士', subtitle: '暫定早 $560／晚 $490・可修改', type: 'taxi', color: '#B84750', rentalCost: 560, rentalDay: 560, rentalNight: 490, rentalSource: 'game-config', fuelCostPerKm: .336, energyProfile: ENERGY_PROFILE_DEFAULTS['red-flag'], commissionRate: 0, baseFare: 12.7, farePerKm: 4.69, farePerMinute: 1.85 },
  { id: 'private', name: '私家車', subtitle: '節能車遊戲設定・可輸入本更成本', type: 'private', color: '#6D7BA7', rentalCost: 0, rentalDay: 0, rentalNight: 0, rentalSource: 'game-config', fuelCostPerKm: .88, energyProfile: ENERGY_PROFILE_DEFAULTS.private, commissionRate: 0, baseFare: 13.14, farePerKm: 4.15, farePerMinute: 1.49 },
];

/** Vehicle size/trim facts are separate from unverified real-platform admission. */
export const VEHICLE_SPECIFICATIONS = [
  {id:'tesla-model-3',name:'Tesla Model 3',nameEn:'Tesla Model 3',modelVariant:'5座遊戲參考版本',specificationSource:'https://www.tesla.com/zh_hk/model3?redirect=no',gameAssumptions:'5座包括司機；電池容量及耗電為遊戲校準值，非指定香港年款官方容量。'},
  {id:'tesla-model-y',name:'Tesla Model Y',nameEn:'Tesla Model Y',modelVariant:'Premium・5座',specificationSource:'https://www.tesla.com/zh_HK/modely',gameAssumptions:'採一般5座版本，並非三排Model Y L；不能接5–6客XL單。容量及耗電為遊戲校準值。'},
  {id:'tesla-model-s',name:'Tesla Model S',nameEn:'Tesla Model S',modelVariant:'既有5座遊戲參考版本',specificationSource:'https://www.tesla.com/zh_hk/models',gameAssumptions:'參考既有5座車型，不聲稱現時香港新車現售或平台批准；只設Type2交流充電，不假設CCS2改裝或轉接器。電池容量、耗電及11kW交流上限屬遊戲設定。'},
  {id:'aion-y-plus-standard',name:'AION Y Plus Standard',nameEn:'AION Y Plus Standard',modelVariant:'香港Standard・5座',specificationSource:'https://gacaionhk.com/zh/aion-y-plus-ch/',gameAssumptions:'AION Y簡稱採香港Y Plus Standard；63.2kWh為公開規格，遊戲耗電及有效充電速度另作校準。'},
  {id:'aion-y-plus-premium',name:'AION Y Plus Premium',nameEn:'AION Y Plus Premium',modelVariant:'香港Premium・5座',specificationSource:'https://gacaionhk.com/zh/aion-y-plus-ch/',gameAssumptions:'Premium是配備版本，仍只可載4客，不自動取得商務或真實平台資格；耗電及充電速度為遊戲校準。'},
  {id:'mg4-trophy',name:'MG4 Trophy',nameEn:'MG4 Trophy',modelVariant:'香港Trophy・5座',specificationSource:'https://mg.richburgmotors.com/mg4/',gameAssumptions:'採MG4 Trophy而非其他MG EV；64kWh為公開規格，遊戲耗電及全程充電曲線另作校準。'},
  {id:'alphard-hybrid',name:'Toyota Alphard Hybrid',nameEn:'Toyota Alphard Hybrid',modelVariant:'7座汽油混能遊戲參考版本',specificationSource:'https://www.toyota.com.hk/en/our-vehicles/alphard',gameAssumptions:'7總座位包括司機，最多6客；遊戲XL資格不等同真實平台逐車批准，亦不保證6客加6件大行李。油箱與耗油是遊戲設定。'},
  {id:'vellfire-hybrid',name:'Toyota Vellfire Hybrid',nameEn:'Toyota Vellfire Hybrid',modelVariant:'7座汽油混能遊戲參考版本',specificationSource:'https://www.toyota.com.hk/en/our-vehicles/vellfire',gameAssumptions:'7總座位包括司機，最多6客；混能仍使用汽油，不能純電充電。遊戲XL資格不等同真實平台批准。油箱與耗油是遊戲設定。'},
] as const;
const EXTENDED_VEHICLES:Vehicle[]=VEHICLE_SPECIFICATIONS.map(spec=>{
 const energyProfile=ENERGY_PROFILE_DEFAULTS[spec.id],capacity=passengerCapacity(spec.id);
 return {...spec,subtitle:spec.modelVariant,type:'private',color:capacity===6?'#645C77':'#5C7484',totalSeats:capacity+1,passengerCapacity:capacity,accessProfile:'private',xlEligible:vehicleSupportsXL(spec.id),rentalCost:0,rentalDay:0,rentalNight:0,rentalSource:'game-config',fuelCostPerKm:energyProfile?energyProfile.consumptionPerKm*energyProfile.unitPrice:0,energyProfile,commissionRate:0,baseFare:13.14,farePerKm:4.15,farePerMinute:1.49};
});
export const VEHICLES:Vehicle[]=[...LEGACY_VEHICLES.map(vehicle=>({...vehicle,totalSeats:5,passengerCapacity:4,accessProfile:vehicleAccessProfile(vehicle.id),xlEligible:false})),...EXTENDED_VEHICLES];

export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map(vehicle => [vehicle.id, vehicle])) as Record<VehicleId, Vehicle>;

export function getRentalCost(vehicleId: VehicleId, shift: ShiftType = 'day', override?: number, duration: ShiftDurationMinutes = 720): number {
  if (override !== undefined && Number.isFinite(override) && override >= 0) return Math.round(override * 100) / 100;
  const vehicle = VEHICLE_BY_ID[vehicleId];
  if(getShiftDurationMinutes(duration)===1440)return Math.round((vehicle.rentalDay+vehicle.rentalNight)*100)/100;
  return Math.round((shift === 'night' ? vehicle.rentalNight : vehicle.rentalDay) * getShiftDurationMinutes(duration) / 720 * 100) / 100;
}
