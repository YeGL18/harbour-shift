import type {Coordinate} from '../src/game/types';

export type AirportPool='taxi'|'standard'|'xl';
export const AIRPORT_POOLS:AirportPool[]=['taxi','standard','xl'];
/** Hand-traced GAME demand outline, not an official geofence or airport permit. */
export const HKG_DEMAND_BOUNDARY:Coordinate[]=[
  {lon:113.9288,lat:22.3094},{lon:113.9428,lat:22.3094},{lon:113.9485,lat:22.3152},
  {lon:113.9485,lat:22.3251},{lon:113.9381,lat:22.3265},{lon:113.9292,lat:22.3228},{lon:113.9288,lat:22.3094},
];
export const HKG_AIRPORT={id:'hkg' as const,name:'香港國際機場',nameEn:'Hong Kong International Airport',
  center:{lat:22.3178,lon:113.9383},waitingPlaceId:'building-1910240212',pickupPlaceId:'building-1103043661',
  waitingNodeId:'113.933949,22.317696',pickupNodeId:'113.933849,22.317944'};
export interface AirportQueueTicket {
  id:string;zoneId:'hkg';pool:AirportPool;priority:boolean;joinedAt:number;
  sequence?:number;position?:number;ahead?:number;total?:number;assignmentPending?:boolean;
}
export interface SharedAirportTicket extends AirportQueueTicket {playerId:string;sequence:number}
export interface AirportDemandEstimate {level:'quiet'|'normal'|'busy';multiplier:number;requestChance:number;sampledAtMinute:number;estimatedWaitMin:number;estimatedWaitMax:number}
export interface AirportPoolView {pool:AirportPool;ordinary:number;diamond:number;total:number;estimatedWaitMin:number;estimatedWaitMax:number}
export interface AirportRoomView {zoneId:'hkg';sampledAtMinute:number;demand:AirportDemandEstimate;pools:AirportPoolView[]}
