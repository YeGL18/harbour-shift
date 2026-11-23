import type {Vehicle,VehicleId} from './types';

export const VEHICLE_CATALOG_VERSION = 1 as const;
export const VEHICLE_CATALOG_HEADER = 'X-Harbour-Vehicle-Catalog';
export const LEGACY_VEHICLE_IDS = ['kam-fung','little-treasure','red-flag','private'] as const;
export const EXTENDED_VEHICLE_IDS = ['tesla-model-3','tesla-model-y','tesla-model-s','aion-y-plus-standard','aion-y-plus-premium','mg4-trophy','alphard-hybrid','vellfire-hybrid'] as const;
export const ALL_VEHICLE_IDS:readonly VehicleId[]=[...LEGACY_VEHICLE_IDS,...EXTENDED_VEHICLE_IDS];
export function isKnownVehicleId(value:unknown):value is VehicleId{return typeof value==='string'&&(ALL_VEHICLE_IDS as readonly string[]).includes(value);}
export function isLegacyVehicleId(value:unknown):boolean{return typeof value==='string'&&(LEGACY_VEHICLE_IDS as readonly string[]).includes(value);}
/** No new private model inherits taxi-only road access or a closed-road permit. */
export function vehicleAccessProfile(vehicleId:VehicleId):'urban-taxi'|'private'{return vehicleId==='kam-fung'||vehicleId==='little-treasure'||vehicleId==='red-flag'?'urban-taxi':'private';}
export function passengerCapacity(vehicle:Vehicle|VehicleId):number {
 if(typeof vehicle!=='string'&&Number.isInteger(vehicle.passengerCapacity)&&vehicle.passengerCapacity!>0)return vehicle.passengerCapacity!;
 const id=typeof vehicle==='string'?vehicle:vehicle.id;return id==='alphard-hybrid'||id==='vellfire-hybrid'?6:4;
}
export function vehicleSupportsXL(vehicle:Vehicle|VehicleId):boolean {
 const id=typeof vehicle==='string'?vehicle:vehicle.id;
 return (id==='alphard-hybrid'||id==='vellfire-hybrid')&&passengerCapacity(vehicle)>=6&&(typeof vehicle==='string'||vehicle.xlEligible!==false);
}
