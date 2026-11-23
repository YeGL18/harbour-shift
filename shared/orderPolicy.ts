import type {PricingType} from '../src/game/types';
export const ORDER_POLICY_VERSION=1 as const;
export const ORDER_POLICY_HEADER='X-Harbour-Order-Policy';
export const ORDER_PRICING_TYPES:readonly PricingType[]=['private-upfront','private-xl','taxi-metered','taxi-discount85','taxi-upfront','private-elite'];
export interface OrderPreferences {enabledPricingTypes:PricingType[]}
/** Strict input shape; duplicate/unknown prices and mixed Elite commitments fail closed. */
export function readOrderPreferences(value:unknown):OrderPreferences|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='enabledPricingTypes'))return undefined;
 const list=(value as OrderPreferences).enabledPricingTypes;
 if(!Array.isArray(list)||list.length>6||list.some(type=>!ORDER_PRICING_TYPES.includes(type))||new Set(list).size!==list.length||list.includes('private-elite')&&list.length!==1)return undefined;
 return{enabledPricingTypes:ORDER_PRICING_TYPES.filter(type=>list.includes(type))};
}
