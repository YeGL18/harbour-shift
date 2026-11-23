import type { Offer, PricingType, Vehicle } from '../game/types';
import {passengerCapacity,vehicleSupportsXL} from '../game/vehicleCapabilities';

export const PRICING_LABELS: Record<PricingType, string> = {
  'taxi-metered': '咪錶單',
  'taxi-discount85': '85折咪錶單',
  'taxi-upfront': '的士平台預報單',
  'private-upfront': '私家車價平台單',
  'private-xl': 'XL 六客平台單',
  'private-elite': '尊尚預約遊戲合約',
};

export const TAXI_METER_SOURCE = {
  title: '運輸署・香港的士收費（市區的士）',
  url: 'https://www.td.gov.hk/tc/transport_in_hong_kong/public_transport/taxi/taxi_fare_of_hong_kong/',
  label: '公開市區咪錶距離費校準',
  assumption: '首2公里29元，其後每200米或部分按2.1／1.4元跳錶。全程行車時間不另當等候。附加費與平台佣金未模擬，85折只作用於咪錶費。',
} as const;

export const ORDER_RULE_NOTES = '的士可接四種標準計價、私家車可接私家車價單，合資格七座遊戲車款另可接5–6客XL單，屬本遊戲合約規則，並非真實平台車輛資格聲明。預報單在遊戲中鎖定合約價；實際平台可按實際時間與距離調整。取消一律不收車資；等候門檻屬遊戲設定。';

export function pricingTypesForVehicle(vehicle: Vehicle): PricingType[] {
  return vehicle.type === 'private' ? vehicleSupportsXL(vehicle)?['private-upfront','private-xl','private-elite']:['private-upfront'] : ['taxi-metered', 'taxi-discount85', 'taxi-upfront', 'private-upfront'];
}

export function isPricingTypeEligible(vehicle: Vehicle, pricingType: PricingType): boolean {
  return pricingTypesForVehicle(vehicle).includes(pricingType);
}

/** Game balancing only: this is not an official UberXL driver net-rate card. */
export const XL_GAME_RULES={netPayoutMultiplier:1.30,minimumPassengers:5,maximumPassengers:6,requestShare:.13} as const;
export const XL_FARE_SOURCE={title:'XL遊戲合約規則',url:'game-config:xl-v1',label:'遊戲XL淨報價・非官方XL費率',assumption:'5–6名乘客，只配對合資格7座遊戲車款；同程私家車價淨報價乘1.30，沒有額外佣金。座位數包括司機，不推斷行李容量或現實平台逐車批准。'} as const;
export function isOfferEligibleForVehicle(vehicle:Vehicle,offer:Pick<Offer,'pricingType'|'serviceType'|'passengerCount'>,xlEnabled=true,eliteCertified=false):boolean {
 if(!isPricingTypeEligible(vehicle,offer.pricingType)||offer.serviceType!==undefined&&!['standard','xl','elite'].includes(offer.serviceType))return false;
 if(offer.pricingType==='private-elite'||offer.serviceType==='elite')return eliteCertified&&vehicleSupportsXL(vehicle)&&offer.pricingType==='private-elite'&&offer.serviceType==='elite'&&Number.isInteger(offer.passengerCount)&&offer.passengerCount!>=1&&offer.passengerCount!<=4;
 const xl=offer.pricingType==='private-xl'||offer.serviceType==='xl';
 const count=offer.passengerCount??(xl?XL_GAME_RULES.minimumPassengers:1);
 if(!Number.isInteger(count)||count<1||count>passengerCapacity(vehicle))return false;
 return xl?xlEnabled&&offer.pricingType==='private-xl'&&offer.serviceType!=='standard'&&count>=5&&count<=6:offer.serviceType!=='xl'&&count<=4;
}

export function calculateMeteredFare(distanceM: number, waitingMinutes = 0): number {
  const ticks = Math.ceil(Math.max(0, distanceM - 2000) / 200 - 0.0000001) + Math.ceil(Math.max(0, waitingMinutes) - 0.0000001);
  return Math.round((29 + Math.min(35, ticks) * 2.1 + Math.max(0, ticks - 35) * 1.4) * 100) / 100;
}

export const TAXI_FARE_SOURCE = {
  title: 'Uber 香港司機的士預報車資表',
  url: 'https://www.uber.com/hk/zh-hk/blog/driver-fare-taxi/',
  updatedAt: '2026-10-22',
  label: '官方司機淨費率校準・非實時報價',
  assumption: '採用分段累計距離費；官方表格未公開完整演算法。已扣服務費，不另扣平台佣金。官方說明預定價錢可按供求動態加乘；本遊戲區域倍率由seed產生，不是平台實時倍率。',
} as const;

export const TAXI_UPFRONT_RATES = {
  minimum: 35.06,
  base: 12.70,
  perMinute: 1.85,
  waitingPerMinute: 1.80,
  distanceBands: [
    { upToKm: 5, perKm: 4.69 },
    { upToKm: 10, perKm: 5.75 },
    { upToKm: 15, perKm: 5.39 },
    { upToKm: Infinity, perKm: 4.47 },
  ],
} as const;

export const PRIVATE_FARE_SOURCE = {
  title: 'Uber 香港 UberX 司機預報車資表',
  url: 'https://www.uber.com/hk/zh-hk/blog/driver-fare/',
  updatedAt: '2026-10-22',
  label: '官方 UberX 司機淨費率校準・非實時報價',
  assumption: '採用分段累計距離費；已扣服務費。遊戲需求加成並非官方即時報價。',
} as const;

export const PRIVATE_UPFRONT_RATES = {
  minimum: 29.89,
  base: 13.14,
  perMinute: 1.49,
  waitingPerMinute: 1.46,
  distanceBands: [
    { upToKm: 5, perKm: 4.15 },
    { upToKm: 10, perKm: 4.32 },
    { upToKm: 15, perKm: 4.11 },
    { upToKm: Infinity, perKm: 3.56 },
  ],
} as const;

export function progressiveDistanceFare(distanceKm: number, bands: ReadonlyArray<{ upToKm: number; perKm: number }> = TAXI_UPFRONT_RATES.distanceBands): number {
  let previous = 0;
  let total = 0;
  for (const band of bands) {
    const distance = Math.max(0, Math.min(distanceKm, band.upToKm) - previous);
    total += distance * band.perKm;
    previous = band.upToKm;
  }
  return total;
}

export function estimateDriverPayout(vehicle: Vehicle, distanceM: number, minutes: number, surge = 1, pricingType: PricingType = vehicle.type === 'taxi' ? 'taxi-upfront' : 'private-upfront'): number {
  if (pricingType === 'taxi-metered' || pricingType === 'taxi-discount85') {
    const meter = calculateMeteredFare(distanceM);
    return Math.round(meter * (pricingType === 'taxi-discount85' ? 0.85 : 1) * 100) / 100;
  }
  const distanceKm = Math.max(0, distanceM) / 1000;
  const rates = pricingType === 'taxi-upfront' ? TAXI_UPFRONT_RATES : PRIVATE_UPFRONT_RATES;
  const fare = Math.max(rates.minimum, rates.base + progressiveDistanceFare(distanceKm, rates.distanceBands) + Math.max(0, minutes) * rates.perMinute) * Math.max(1, surge);
  const standardNet=Math.round(fare*100)/100;
  return pricingType==='private-elite'?Math.round(Math.max(200,standardNet*1.8)*100)/100:Math.round(standardNet * (pricingType==='private-xl'?XL_GAME_RULES.netPayoutMultiplier:1) * 100) / 100;
}
