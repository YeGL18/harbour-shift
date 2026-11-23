import type { PlayerSetup, RoomPlayer } from '../../shared/protocol';
import type { Landmark, VehicleId } from '../game/types';
import { LANDMARK_BY_ID } from '../data/landmarks';

export interface GaragePlayerSetup {vehicleId:VehicleId;startPlace:Landmark;handoverPlace:Landmark|null;rentalOverride?:number;energyUnitPriceOverride?:number;autoAcceptEnabled?:boolean;autoAcceptPreference?:boolean}
/** Places travel as canonical IDs; the server validates each player's costs. */
export function buildPlayerSetup({vehicleId,startPlace,handoverPlace,rentalOverride,energyUnitPriceOverride,autoAcceptEnabled,autoAcceptPreference}:GaragePlayerSetup):PlayerSetup {
  const handover=handoverPlace??startPlace;
  return {
    vehicleId,
    ...(LANDMARK_BY_ID.has(startPlace.id)?{startPlaceId:startPlace.id}:{startNodeId:startPlace.nodeId}),
    ...(LANDMARK_BY_ID.has(handover.id)?{handoverPlaceId:handover.id}:{handoverNodeId:handover.nodeId}),
    ...(rentalOverride===undefined?{}:{rentalOverride}),
    ...(energyUnitPriceOverride===undefined?{}:{energyUnitPriceOverride}),
    ...(autoAcceptPreference===undefined&&autoAcceptEnabled===undefined?{}:{autoAcceptOrders:autoAcceptPreference??autoAcceptEnabled}),
  };
}
export function playerSetupMatches(player:RoomPlayer,setup:PlayerSetup):boolean {
  return player.vehicleId===setup.vehicleId
    && (!setup.startPlaceId || player.startPlaceId===setup.startPlaceId)
    && (!setup.startNodeId || player.startNodeId===setup.startNodeId)
    && (!setup.handoverPlaceId || player.handoverPlaceId===setup.handoverPlaceId)
    && (!setup.handoverNodeId || player.handoverNodeId===setup.handoverNodeId)
    && player.rentalOverride===setup.rentalOverride
    && player.energyUnitPriceOverride===setup.energyUnitPriceOverride;
}

/** Empty restores the vehicle default; zero is an intentional free cost. */
export function parseRoomCost(value:string,maximum:number):number|undefined {
  if(!value.trim())return undefined;
  if(!/^\d+(?:\.\d+)?$/.test(value.trim()))throw new Error('成本設定無效。');
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0||amount>maximum)throw new Error('成本設定無效。');
  return amount;
}
