import {ORDER_PRICING_TYPES,readOrderPreferences,type OrderPreferences} from '../../shared/orderPolicy';
import type {GameState,Offer,PricingType,VehicleId} from './types';
import {VEHICLE_BY_ID} from '../data/vehicles';
import {isOfferEligibleForVehicle,pricingTypesForVehicle} from '../data/fares';
export function allowedOrderPricingTypes(vehicleId:VehicleId,eliteCertified=false):PricingType[]{return pricingTypesForVehicle(VEHICLE_BY_ID[vehicleId]).filter(type=>type!=='private-elite'||eliteCertified);}
export function defaultOrderPreferences(vehicleId:VehicleId):OrderPreferences{return{enabledPricingTypes:allowedOrderPricingTypes(vehicleId).filter(type=>type!=='private-elite')};}
/** Called only at creation/restore, never by an in-shift control. Missing means legacy rules. */
export function normalizeOrderPreferences(value:unknown,vehicleId:VehicleId,eliteCertified=false):OrderPreferences|undefined {
 if(value===undefined)return undefined;const parsed=readOrderPreferences(value),allowed=allowedOrderPricingTypes(vehicleId,eliteCertified);
 return{enabledPricingTypes:parsed?.enabledPricingTypes.filter(type=>allowed.includes(type))??[]};
}
export function isOrderTypeEnabled(state:Pick<GameState,'orderPreferences'>,type:PricingType):boolean{return state.orderPreferences===undefined||state.orderPreferences.enabledPricingTypes.includes(type);}
export function hasOrdinaryOrderTypes(state:Pick<GameState,'orderPreferences'>):boolean{return state.orderPreferences===undefined||state.orderPreferences.enabledPricingTypes.some(type=>type!=='private-elite');}
export function isPreferredOffer(state:Pick<GameState,'orderPreferences'|'vehicleId'|'xlOrdersEnabled'|'eliteCertified'>,offer:Pick<Offer,'pricingType'|'serviceType'|'passengerCount'>):boolean{return isOrderTypeEnabled(state,offer.pricingType)&&isOfferEligibleForVehicle(VEHICLE_BY_ID[state.vehicleId],offer,state.xlOrdersEnabled===true,state.eliteCertified===true);}
/** UI selection is explicit: Elite replaces ordinary choices; selecting ordinary leaves Elite. */
export function toggleOrderType(value:OrderPreferences,type:PricingType,on:boolean):OrderPreferences {
 const current=readOrderPreferences(value)?.enabledPricingTypes??[];
 const selected=on?type==='private-elite'?['private-elite']:[...current.filter(item=>item!=='private-elite'),type]:current.filter(item=>item!==type);
 return{enabledPricingTypes:ORDER_PRICING_TYPES.filter(item=>selected.includes(item))};
}
