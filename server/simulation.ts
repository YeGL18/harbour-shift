import {setProDestination} from '../src/game/engine';
import { acceptOffer, acceptNextOffer, advanceGame, cancelTrip,cancelQueuedTrip,cancelHandover,cancelCharging, configureSharedFuelQueues,configureLegacyGameRules, chooseBranch, chooseTripRoute, createInitialState, cruiseToNode, declineOffer, getLookahead, getSummary, getUpcomingBranches, getVehicleGraph, getVehiclePosition, navigateToHandover, navigateToStation, normalizeGameState, parkForRest, parkTemporarily, requestEnergyRecovery, resolveRouteEvent, resumeDriving, setAcceptingOrders,setAutoAcceptOrders,setOfferResponseWindow, startEnergyService } from '../src/game';
import { LANDMARKS, LANDMARK_BY_ID } from '../src/data/landmarks';
import {applyAirportAction} from '../src/game/engine';
import { getCompatibleStations } from '../src/data/serviceStations';
import { isPlaceAllowed } from '../src/data/vehicleAccess';
import type { GameState, Landmark, RoadGraph } from '../src/game/types';
import type { PlayerGameAction, PlayerSetup, RoomFeatureVersion, RoomPlayer, RoomRules } from '../shared/protocol';
import { fail } from './validation';
import {applyEliteBookingAction} from '../src/game';
export interface GameSimulation {
  validateSetup(setup:PlayerSetup):PlayerSetup;
  create(setup:PlayerSetup,rules:RoomRules,seed:number):GameState;
  advance(state:GameState,minutes:number):GameState;
  apply(state:GameState,action:PlayerGameAction):GameState;
  peer(state:GameState):Pick<RoomPlayer,'position'|'route'|'order'|'phase'|'netIncome'|'score'|'completedTrips'|'clockMinutes'>;
  restore(state:unknown):GameState;
  junction(state:GameState):{id:string;distanceM:number}|undefined;
  configureOfferWindow?(state:GameState,minutes:number):GameState;
  configurePlayer?(state:GameState,playerId:string,featureVersion?:RoomFeatureVersion,vehicleCatalogVersion?:1):GameState;
}
function customPlace(nodeId:string,graph:RoadGraph):Landmark {
  const node=graph.nodes[nodeId];if(!node||!graph.outgoing[nodeId]?.length) fail('invalid_place','所選道路不在車輛可行範圍。');
  return {...node,id:`mp-node-${nodeId}`,nodeId,name:node.name||'自選道路',district:'',kind:'transport'};
}
function place(setup:PlayerSetup,which:'start'|'handover'):Landmark {
  const graph=getVehicleGraph(setup.vehicleId);
  const node=which==='start'?setup.startNodeId:setup.handoverNodeId;
  if(node) return customPlace(node,graph);
  const id=which==='start'?setup.startPlaceId:setup.handoverPlaceId;
  if(which==='handover'&&!id) return place(setup,'start');
  const value=LANDMARK_BY_ID.get(id||'harbour-city');
  if(!value||!isPlaceAllowed(value,setup.vehicleId,graph)) fail('invalid_place','所選地點不在車輛可行範圍。');
  return value;
}
export const defaultSimulation:GameSimulation={
  validateSetup(input){place(input,'start');place(input,'handover');return {...input};},
  create(input,rules,seed){const version=(rules as RoomRules&{featureVersion?:RoomFeatureVersion}).featureVersion;const modern=version==='0.5'||version==='0.6';return createInitialState({seed,vehicleId:input.vehicleId,blindOrders:rules.blindOrders,xlOrdersEnabled:(rules as RoomRules&{vehicleCatalogVersion?:1}).vehicleCatalogVersion===1,startPlace:place(input,'start'),handoverPlace:place(input,'handover'),rentalOverride:input.rentalOverride,energyUnitPriceOverride:input.energyUnitPriceOverride,autoAcceptOrders:modern&&input.autoAcceptOrders===true,shift:rules.shift,shiftDurationMinutes:version==='0.6'?rules.shiftDurationMinutes||360:720,density:rules.density,startTimeMinutes:rules.startTimeMinutes,offerResponseWindowMinutes:rules.speed*5/60,dispatchManaged:modern});},
  configureOfferWindow:setOfferResponseWindow,
  configurePlayer:(state,id,version,catalog)=>version==='0.5'||version==='0.6'?{...configureSharedFuelQueues(state,id),dispatchManaged:true,xlOrdersEnabled:catalog===1}:{...configureLegacyGameRules(state),autoAcceptOrders:false},
  advance:advanceGame,
  restore(value){const state=normalizeGameState({...value as object,landmarks:LANDMARKS});if(!state) fail('invalid_saved_state','伺服器更份無法恢復。',500);return state;},
  junction(state){const branch=getUpcomingBranches(state)[0];return branch?{id:branch.junctionNodeId,distanceM:branch.distanceM}:undefined;},
  apply(state,action){
    switch(action.type){
      case'airport':return applyAirportAction(state,action.choice);
      case'pro-destination':return setProDestination(state,action.placeId);
      case'elite-booking':return applyEliteBookingAction(state,action.bookingId,action.choice);
      case'accept':return state.currentOffer?.reservation?acceptNextOffer(state,action.offerId):acceptOffer(state);case'decline':return declineOffer(state);case'cancel':return cancelTrip(state);case'cancel-queued':return cancelQueuedTrip(state,action.tripId);
      case'branch':return chooseBranch(state,action.junctionNodeId,action.edgeId);case'route':return chooseTripRoute(state,action.policy);case'event':return resolveRouteEvent(state,action.choice);
      case'cruise-to':{const graph=getVehicleGraph(state.vehicleId);if(!graph.nodes[action.nodeId]||!graph.outgoing[action.nodeId]?.length)fail('invalid_place','巡遊位置不在車輛可行範圍。');return cruiseToNode(state,action.nodeId,graph);}
      case'accepting':return setAcceptingOrders(state,action.value);case'auto-accept':return setAutoAcceptOrders(state,action.value);case'park':return parkTemporarily(state);case'rest':return parkForRest(state);case'drive':return resumeDriving(state);
      case'service':return startEnergyService(state);
      case'cancel-charge':return cancelCharging(state);
      case'handover':return navigateToHandover(state);case'cancel-handover':return cancelHandover(state);case'recover-energy':return requestEnergyRecovery(state);
      case'station':{const station=getCompatibleStations(state.vehicleId).find(item=>item.id===action.stationId);if(!station) fail('invalid_station','車輛不可使用所選服務站。');return navigateToStation(state,station);}
    }
  },
  peer(state){
    const graph=getVehicleGraph(state.vehicleId);const coordinates=getLookahead(state,1000,graph).flatMap((segment,index)=>index?segment.coordinates.slice(1):segment.coordinates);
    const route=coordinates.length<=100?coordinates:Array.from({length:100},(_,index)=>coordinates[Math.round(index*(coordinates.length-1)/99)]);
    return {phase:state.phase,position:getVehiclePosition(state,graph),route,order:state.activeTrip?{serviceType:state.activeTrip.offer.serviceType,passengerCount:state.activeTrip.offer.passengerCount,pickupName:state.activeTrip.offer.pickup.name,destinationName:state.activeTrip.offer.destination.name,pickupNameEn:state.activeTrip.offer.pickup.nameEn,destinationNameEn:state.activeTrip.offer.destination.nameEn,phase:state.phase}:undefined,netIncome:state.netIncome,score:getSummary(state).score,completedTrips:state.completedTrips,clockMinutes:state.clockMinutes};
  },
};
