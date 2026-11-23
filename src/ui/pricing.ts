import type { PricingType } from '../game';
export const PRICING_LABEL: Record<PricingType, string> = { 'taxi-metered': '的士・咪表', 'taxi-discount85': '的士・咪表 85 折', 'taxi-upfront': '的士・預定價', 'private-upfront': 'UberX・預定價', 'private-xl': 'XL・預定價', 'private-elite':'尊尚預約' };
export const isMetered = (type: PricingType) => type === 'taxi-metered' || type === 'taxi-discount85';
