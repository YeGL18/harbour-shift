import {VEHICLES,VEHICLE_BY_ID} from '../data/vehicles';
import {isLegacyVehicleId,passengerCapacity,vehicleSupportsXL} from '../game/vehicleCapabilities';
import type {Vehicle,VehicleId} from '../game/types';
export type VehicleGroupId='taxi'|'private'|'seven-seat';
export const VEHICLE_GROUPS=[{id:'taxi',label:'的士'},{id:'private',label:'私家車'},{id:'seven-seat',label:'七座車'}] as const;
export function vehicleGroup(vehicle:Vehicle):VehicleGroupId{return vehicle.type==='taxi'?'taxi':passengerCapacity(vehicle)>=6?'seven-seat':'private';}
export function roomCatalogVehicles(catalogVersion?:number):Vehicle[]{return catalogVersion===1?VEHICLES:VEHICLES.filter(vehicle=>isLegacyVehicleId(vehicle.id));}
export function groupedVehicles(vehicles:readonly Vehicle[]){return VEHICLE_GROUPS.map(group=>({...group,vehicles:vehicles.filter(vehicle=>vehicleGroup(vehicle)===group.id)})).filter(group=>group.vehicles.length);}
export function vehicleEnergyLabel(vehicle:Vehicle):string {
 const energy=vehicle.energyProfile;if(energy?.kind==='charge')return vehicle.id==='tesla-model-s'?'交流充電':'充電';
 if(energy?.kind==='swap')return'換電';if(energy?.kind==='lpg')return'石油氣';
 return vehicle.id==='alphard-hybrid'||vehicle.id==='vellfire-hybrid'?'汽油混能':'汽油';
}
export function vehiclePickerDetails(vehicle:Vehicle){return{capacity:passengerCapacity(vehicle),energyLabel:vehicleEnergyLabel(vehicle),xl:vehicleSupportsXL(vehicle)};}
export type VehicleBodyStyle='sedan'|'fastback'|'crossover'|'hatchback'|'mpv';
/** Original silhouettes: badges/roof lights represent taxi capability, not a guessed ID prefix. */
export function vehicleArtwork(id:VehicleId){
 const vehicle=VEHICLE_BY_ID[id],taxi=vehicle?.type==='taxi';
 const style:VehicleBodyStyle=id==='little-treasure'||id==='alphard-hybrid'||id==='vellfire-hybrid'?'mpv':id==='tesla-model-y'||id.startsWith('aion-y-')?'crossover':id==='mg4-trophy'?'hatchback':id==='red-flag'||id==='tesla-model-3'||id==='tesla-model-s'?'fastback':'sedan';
 return{taxi,style,electric:vehicle?.energyProfile?.kind==='charge'||id==='red-flag',long:id==='tesla-model-s'||id==='alphard-hybrid'||id==='vellfire-hybrid',body:taxi?'#B94743':style==='mpv'?'#4A515E':style==='crossover'?'#697782':'#4E5966'};
}
