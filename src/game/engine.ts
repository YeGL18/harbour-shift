import {proDestinationAllowance} from '../../shared/pro';
import { ROAD_GRAPH } from '../map/roadGraph';
import { getCompatibleStations } from '../data/serviceStations';
import { LANDMARKS } from '../data/landmarks';
import { getRentalCost, VEHICLE_BY_ID } from '../data/vehicles';
import { estimateDriverPayout, isPricingTypeEligible, isOfferEligibleForVehicle, XL_GAME_RULES, PRICING_LABELS } from '../data/fares';
import { distanceMetres, extendItinerary, findRoute, nearestNode, pointOnEdge, recordDrivenEdge, routeLength, routeMinutes, speedKph } from './routing';
import { cellFor, flatDistanceM, SpatialIndex } from './spatial';
import { getUpcomingBranches, getVehiclePosition } from './selectors';
import { getVehicleGraph } from './access';
import { isCoordinateAllowed, isPlaceAllowed } from '../data/vehicleAccess';
import { demandConditions, energyProfileFor, initialEnergy, initialPlatformStats, isSafeStoppingEdge, refreshPlatformStats, safeStopRoute, shouldDispatchNextTrip, seededRandom as random, stringHash as hash, surgeAreasFor } from './systems';
import { approachJunction, crossedJunction, getDrivingSpeedFactor } from './driving';
import { FUEL_QUEUE_CREEP_KPH, FUEL_QUEUE_HEADWAY_MINUTES, fuelQueueBaseline, queueDistanceTarget, queuePoint, stationQueueApproach, stationQueueApproachDetails } from './fuelQueue';
import {getShiftDurationMinutes,getShiftEndMinute} from './shiftDuration';
import {normalizeWorldEvent} from './worldEvents';
import {findRestParking,REST_PARKING_SETTLE_MINUTES} from './restParking';
import {getTrafficConditions} from './traffic';
import {roadHazardOnEdge,routeEventSpeedFactor} from './roadHazards';
import {mergeMapDemandRequests} from './mapDemand';
import {commuteIntensity,commuteDestinationWeight} from './commute';
import {airportEnabled,airportPlaces,airportJourney,atAirportWaitingPoint,canNavigateToAirport,airportQueueStillEligible,newAirportQueueTicket,airportWorldOffers,prepareAirportOffer} from './airport';
import {CHARGING_GAME_MODEL,chargeAfterMinutes,chargingMinutes,selectChargingOption} from './charging';
import {vehicleSupportsXL} from './vehicleCapabilities';
import {hasOrdinaryOrderTypes,isOrderTypeEnabled,isPreferredOffer,normalizeOrderPreferences} from './orderPreferences';
import {activeEliteReservation,canCommitEliteReservation,canSeekEliteReservation,createEliteReservation,ELITE_GAME_RULES,eliteAllowsOrdinaryOffer,eliteEnabled,eliteWindow,isEliteOnlyShift,routeToElitePickup} from './elite';
import type {EliteBookingChoice,EliteReservation} from '../../shared/elite';
import type { ActiveTrip, FuelQueueAssignment, Coordinate, DemandDensity, EnergyStation, GameLog, GameState, GameSummary, InitialGameOptions, Landmark, Movement, Offer, PlatformStats, PricingType, RoadGraph, VehicleId, WorldEvent } from './types';
export { getVehiclePosition, getLookahead, getUpcomingBranches, getRemainingTripRouteCoordinates, getOfferPreviewRoutes } from './selectors';
export { getVehicleGraph } from './access';
export { PLATFORM_GAME_RULES, demandConditions, isSafeStoppingEdge } from './systems';
export const getSurgeAreas = surgeAreasFor;
export { fuelQueueBaseline, allocateFuelQueue, stationQueueApproach,stationQueueApproachDetails } from './fuelQueue';
export {getShiftDurationMinutes,getShiftEndMinute,getShiftOvertimeLimit} from './shiftDuration';
export {worldEventDemandBoost} from './worldEvents';
export {findRestParking,isStrictRestApproach,isDesignatedParkingRoad,REST_PARKING_SETTLE_MINUTES} from './restParking';
export {getTrafficConditions,getNearbyNpcTraffic,getLocalTrafficConditions} from './traffic';
export {ROAD_HAZARD_RULES,routeEventSpeedFactor} from './roadHazards';
export {hasCommittedEliteReservation,activeEliteReservation,eliteEnabled,ELITE_GAME_RULES} from './elite';

/** Legacy full-shift defaults; state-specific logic uses the duration helpers. */
export const SHIFT_MINUTES = 720;
export const MAX_SHIFT_OVERTIME_MINUTES = 240;
export const MAX_SHIFT_END_MINUTE = SHIFT_MINUTES + MAX_SHIFT_OVERTIME_MINUTES;
export const LOOKAHEAD_METRES = 1000;
export const GHOST_HORIZON_MINUTES = 20;
export const OFFER_LIFETIME_MINUTES = 4;
export const LOCAL_DEMAND_RADIUS_M = 1800;
export const NEARBY_RETENTION_RADIUS_M = 2500;
export const DEMAND_INTERVAL_MINUTES = 0.25;
export const INFORMATIONAL_FEED_LIMIT = 24;
const EPSILON = 0.000001;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

interface Catalog { index: SpatialIndex<Landmark>; byId: Map<string, Landmark>; destinationCells: Map<string, Array<{ key: string; entries: Landmark[] }>>; districtByCell: Map<string, string>; hazardPlaces:WeakMap<RoadGraph,Map<string,Landmark|undefined>> }
const catalogs = new WeakMap<Landmark[], Catalog>();
const preparedCatalogs = new WeakMap<Landmark[], WeakMap<RoadGraph, Landmark[]>>();
function catalogFor(landmarks: Landmark[]): Catalog {
  let catalog = catalogs.get(landmarks);
  if (!catalog) { catalog = { index: new SpatialIndex(landmarks), byId: new Map(landmarks.map(place => [place.id, place])), destinationCells: new Map(), districtByCell: new Map(),hazardPlaces:new WeakMap() }; catalogs.set(landmarks, catalog); }
  return catalog;
}
function prepareLandmarks(landmarks: Landmark[], graph: RoadGraph, vehicleId: VehicleId): Landmark[] {
  let cache = preparedCatalogs.get(landmarks);
  if (!cache) { cache = new WeakMap(); preparedCatalogs.set(landmarks, cache); }
  const existing = cache.get(graph);
  if (existing) return existing;
  const valid = (place: Landmark) => !!(place.nodeId && graph.nodes[place.nodeId] && graph.outgoing[place.nodeId]?.length && isPlaceAllowed(place, vehicleId, graph));
  const prepared = landmarks.every(valid) ? landmarks : landmarks.filter(place => isCoordinateAllowed(place, vehicleId) && (!place.nodeId || valid(place))).map(place => valid(place) ? place : { ...place, nodeId: nearestNode(place, graph).id });
  cache.set(graph, prepared);
  return prepared;
}
function cloneState(state: GameState): GameState {
  return { ...state, movement: { ...state.movement, nextEdgeIds: [...state.movement.nextEdgeIds],...(state.movement.recentEdgeIds?{recentEdgeIds:[...state.movement.recentEdgeIds]}:{}) }, activeTrip: state.activeTrip ? { ...state.activeTrip } : null, queuedTrip: state.queuedTrip ? {...state.queuedTrip} : null, fuelQueue: state.fuelQueue ? {...state.fuelQueue,approachEdgeIds:[...state.fuelQueue.approachEdgeIds]} : null,
    ghost: null, ghostOffer: null, ghostOffers: [], observedOffers: [...state.observedOffers],airportQueue:state.airportQueue?{...state.airportQueue}:null,airportOfferHistory:state.airportOfferHistory?[...state.airportOfferHistory]:undefined,eliteReservations:state.eliteReservations?.map(booking=>({...booking})),eliteReviewedWindows:state.eliteReviewedWindows?[...state.eliteReviewedWindows]:undefined,
    parking: state.parking ? { ...state.parking } : null, navigation: state.navigation ? { ...state.navigation,queueApproach:state.navigation.queueApproach?[...state.navigation.queueApproach]:undefined } : null,
    drivingAssist: state.drivingAssist ? { ...state.drivingAssist } : undefined,
    energy: { ...state.energy },chargingSession:state.chargingSession?{...state.chargingSession}:null,lastChargeReceipt:state.lastChargeReceipt?{...state.lastChargeReceipt}:null, energyRecovery: state.energyRecovery ? { ...state.energyRecovery } : null, deadlineSettlement:state.deadlineSettlement?{...state.deadlineSettlement}:undefined, platform: { ...state.platform }, routeEvent: state.routeEvent ? { ...state.routeEvent } : null, logs: [...state.logs] };
}
function addLog(state: GameState, kind: GameLog['kind'], text: string, amount?: number): void {
  state.logs.unshift({ id: `${state.clockMinutes.toFixed(5)}-${kind}-${state.acceptedOffers}-${state.demandIndex}-${state.logs.length}`, minute: state.clockMinutes, kind, text, amount });
  state.logs = state.logs.slice(0, 100);
}
function updateBalance(state: GameState): void {
  state.netIncome = roundMoney(state.grossIncome - state.operatingCost - state.rentalCostApplied); state.wallet = state.netIncome;
}

export function createInitialState(options: InitialGameOptions = {}): GameState {
  const graph = getVehicleGraph(options.vehicleId || 'kam-fung', options.graph);
  const landmarks = prepareLandmarks(options.landmarks || LANDMARKS, graph, options.vehicleId || 'kam-fung');
  if (!landmarks.length) throw new Error('No named pickup places are reachable by this vehicle.');
  const catalog = catalogFor(landmarks);
  const startPlace = catalog.byId.get(options.startPlace?.id || options.startPlaceId || 'harbour-city') || landmarks[0];
  if (options.startPlace && !isCoordinateAllowed(options.startPlace, options.vehicleId || 'kam-fung')) throw new Error('This vehicle cannot start in the selected restricted area.');
  const customNodeId = options.startPlace ? options.startPlace.nodeId && graph.outgoing[options.startPlace.nodeId]?.length ? options.startPlace.nodeId : nearestNode(options.startPlace, graph).id : undefined;
  const startNodeId = options.startNodeId || customNodeId || startPlace?.nodeId || Object.keys(graph.outgoing)[0];
  const firstEdge = graph.outgoing[startNodeId]?.[0];
  if (!firstEdge) throw new Error('The starting node must have a drivable outgoing road.');
  const pickup = options.startNodeId || options.startPlace && !catalog.byId.has(options.startPlace.id) ? catalog.index.nearest(graph.nodes[startNodeId]) : startPlace;
  const vehicleId = options.vehicleId || 'kam-fung';
  const shift = options.shift || 'day';
  const startTimeMinutes = Number.isFinite(options.startTimeMinutes) ? ((options.startTimeMinutes! % 1440) + 1440) % 1440 : shift === 'night' ? 1020 : 300;
  const shiftDurationMinutes = getShiftDurationMinutes(options);
  const rentalCostApplied = getRentalCost(vehicleId, shift, options.rentalOverride, shiftDurationMinutes);
  if (options.handoverPlace && !isPlaceAllowed(options.handoverPlace, vehicleId, graph)) throw new Error('The handover point must be reachable by this vehicle.');
  const state: GameState = {
    orderPreferences:normalizeOrderPreferences(options.orderPreferences,vehicleId,options.advancedRulesVersion===1&&options.eliteCertified===true),blindOrders:typeof options.blindOrders==='boolean'?options.blindOrders:undefined,
    version: 3, seed: options.seed ?? 18112026, landmarks, vehicleId, xlOrdersEnabled:options.xlOrdersEnabled??vehicleSupportsXL(vehicleId), shift, shiftDurationMinutes, startTimeMinutes,worldEvent:normalizeWorldEvent(options.worldEvent),
    driverSessionId:options.driverSessionId,platformHistory:options.platformHistory?{...options.platformHistory}:undefined,fuelQueueMode:options.fuelQueueMode||'solo',nextTripEnabled:options.nextTripEnabled??true,dispatchManaged:options.dispatchManaged??false,fuelQueueOwnerId:options.fuelQueueOwnerId,fuelQueue:null,queuedTrip:null,handoverStatus:'pending',
    advancedRulesVersion:options.advancedRulesVersion,proTier:options.advancedRulesVersion===1?(options.proPass?.tier??options.proTier??'blue'):'blue',proPass:options.advancedRulesVersion===1?options.proPass:undefined,proDestinationsUsed:0,airportQueue:null,airportOfferHistory:[],airportJoinCounter:0,eliteCertified:options.advancedRulesVersion===1&&options.eliteCertified===true,eliteReservations:[],eliteReviewedWindows:[],
    startPlaceId: pickup?.id,
    startLabel: options.startPlace?.name || pickup?.name || graph.nodes[startNodeId].name,
    rentalCostApplied, rentalOverride: options.rentalOverride, density: options.density || 'busy', phase: 'cruising', clockMinutes: 0,idleMinutes:0,
    offerResponseWindowMinutes:Number.isFinite(options.offerResponseWindowMinutes)&&options.offerResponseWindowMinutes!>0?options.offerResponseWindowMinutes:undefined,
    acceptingOrders: true, autoAcceptOrders:options.autoAcceptOrders??false, parking: null, navigation: null, energy: initialEnergy(vehicleId, options.initialEnergyFraction, options.energyUnitPriceOverride), energyRecovery: null, platform: initialPlatformStats(), demandCooldownUntil: 0,
    handoverPlace: options.handoverPlace === null ? null : options.handoverPlace || pickup || null, handoverReminderShown: false, handoverIntent:'none',nextHandoverReviewMinute:0,
    movement: { edgeId: firstEdge, distanceOnEdgeM: 0, nextEdgeIds: [] }, currentOffer: null, activeTrip: null, ghost: null, ghostOffer: null, ghostOffers: [], observedOffers: [], routeEvent: null,
    grossIncome: 0, operatingCost: 0, netIncome: -rentalCostApplied, wallet: -rentalCostApplied, completedTrips: 0, presentedOffers:0, acceptedOffers: 0, declinedOffers: 0, cancelledTrips: 0, totalDistanceM: 0,
    nextDemandMinute: DEMAND_INTERVAL_MINUTES, demandIndex: 1, nextEventMinute: 72, eventIndex: 0, logs: [], summary: null,
  };
  extendItinerary(state.movement, graph);
  addLog(state, 'shift', `${formatClock(state)} ${shift === 'night' ? '夜更' : '日更'}開更 · 車租 $${rentalCostApplied}`);
  if (!state.dispatchManaged && pickup && flatDistanceM(pickup, graph.nodes[startNodeId]) <= LOCAL_DEMAND_RADIUS_M) {
    const openingSlot = Math.floor(startTimeMinutes / DEMAND_INTERVAL_MINUTES);
    const destination = pickup.id === 'harbour-city' ? catalog.byId.get('megabox') || chooseDestination(state, pickup, openingSlot, 71) : chooseDestination(state, pickup, openingSlot, 71);
    if (destination) state.currentOffer = offerForMovement({ id: `opening-${state.seed}-${pickup.id}`, pickup, destination, requestedAt: 0, surge: demandConditions(state.seed, startTimeMinutes, pickup.district,{position:pickup,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:0}).multiplier, pricingType: VEHICLE_BY_ID[vehicleId].type === 'private' ? 'private-upfront' : 'taxi-upfront' }, state.movement, state, graph, 'live');
    if(state.currentOffer&&!canCompleteOfferBeforeHandover(state,state.currentOffer,graph))state.currentOffer=null;
    if (state.currentOffer) {state.platform.offered = 1;state.presentedOffers=1;}
  }
  return autoAcceptCurrent(state,graph);
}
export function chooseVehicle(state: GameState, vehicleId: VehicleId, graph?: RoadGraph): GameState {
  if (state.clockMinutes > 0 || state.acceptedOffers > 0) return state;
  const source = graph || ROAD_GRAPH;
  return createInitialState({ seed: state.seed, vehicleId, orderPreferences:state.orderPreferences,blindOrders:state.blindOrders,xlOrdersEnabled:state.xlOrdersEnabled,advancedRulesVersion:state.advancedRulesVersion,proTier:state.proTier,proPass:state.proPass,eliteCertified:state.eliteCertified, graph: source, landmarks: state.landmarks, startNodeId: source.edges[state.movement.edgeId].from, shift: state.shift, shiftDurationMinutes:getShiftDurationMinutes(state), startTimeMinutes: state.startTimeMinutes, rentalOverride:state.rentalOverride,energyUnitPriceOverride:state.energy.unitPriceOverride,worldEvent:state.worldEvent,density: state.density, handoverPlace: state.handoverPlace,driverSessionId:state.driverSessionId,platformHistory:state.platformHistory,fuelQueueMode:state.fuelQueueMode,nextTripEnabled:state.nextTripEnabled,dispatchManaged:state.dispatchManaged,autoAcceptOrders:state.autoAcceptOrders });
}
export function setDemandDensity(state: GameState, density: DemandDensity): GameState { return density === state.density ? state : { ...state, density }; }
export function setWorldEvent(state:GameState,event:WorldEvent|undefined):GameState {
  const next=normalizeWorldEvent(event),current=state.worldEvent;
  if(!next&&!current||next&&current&&next.id===current.id&&next.title===current.title&&next.titleEn===current.titleEn&&next.pickupPlaceId===current.pickupPlaceId&&next.startsAt===current.startsAt&&next.endsAt===current.endsAt&&next.radiusM===current.radiusM&&next.demandBoost===current.demandBoost&&next.center.lat===current.center.lat&&next.center.lon===current.center.lon)return state;
  return {...state,worldEvent:next};
}
export function getWorldEventTarget(state:GameState,event:WorldEvent,graph?:RoadGraph):Landmark|undefined {
  graph=getVehicleGraph(state.vehicleId,graph);const place=catalogFor(state.landmarks).byId.get(event.pickupPlaceId);
  return place&&isPlaceAllowed(place,state.vehicleId,graph)?place:undefined;
}
export function canCruiseToWorldEvent(state:GameState,event:WorldEvent,graph?:RoadGraph):boolean {
  return !!normalizeWorldEvent(event)&&state.phase==='cruising'&&!state.activeTrip&&!state.queuedTrip&&!state.currentOffer&&!state.navigation&&!state.parking&&!state.energyRecovery&&!state.deadlineSettlement&&state.energy.remaining>EPSILON&&state.clockMinutes<getShiftDurationMinutes(state)&&state.clockMinutes<event.endsAt&&!!getWorldEventTarget(state,event,graph);
}
export function cruiseToWorldEvent(state:GameState,event:WorldEvent,graph?:RoadGraph):GameState {
  return canCruiseToWorldEvent(state,event,graph)?cruiseToNode(state,getWorldEventTarget(state,event,graph)!.nodeId!,graph):state;
}
export function chooseBranch(state: GameState, junctionNodeId: string, edgeId: string, graph?: RoadGraph): GameState {
  graph = getVehicleGraph(state.vehicleId, graph);
  const branch = getUpcomingBranches(state, graph).find(item => item.junctionNodeId === junctionNodeId);
  if (!branch?.options.some(option => option.edgeId === edgeId)) return state;
  const next = cloneState(state);
  next.cruiseTarget=undefined;
  const itinerary = [next.movement.edgeId, ...next.movement.nextEdgeIds];
  const incomingIndex = itinerary.findIndex(id => graph.edges[id].to === junctionNodeId);
  next.movement.nextEdgeIds = [...itinerary.slice(1, incomingIndex + 1), edgeId];
  next.movement.committedEdgeCount=next.movement.nextEdgeIds.length;
  extendItinerary(next.movement, graph); addLog(next, 'route', `下個路口轉往${graph.edges[edgeId].name || '已選道路'}`);
  return next;
}
export function cruiseToNode(state:GameState,nodeId:string,graph?:RoadGraph):GameState {
  graph=getVehicleGraph(state.vehicleId,graph);
  const node=graph.nodes[nodeId];
  if(state.phase!=='cruising'||state.activeTrip||state.navigation||!node||!graph.outgoing[nodeId]?.length)return state;
  const current=graph.edges[state.movement.edgeId];
  const alreadyThere=state.movement.distanceOnEdgeM<=EPSILON&&current.from===nodeId;
  const route=alreadyThere?[]:findRoute(current.to,nodeId,graph);
  if(!route)return state;
  const next=cloneState(state);next.parking=null;
  const nearby=catalogFor(state.landmarks).index.nearest(node);
  next.cruiseTarget=alreadyThere?undefined:{...node,id:`cruise-${nodeId}`,nodeId,name:nearby&&flatDistanceM(nearby,node)<=120?nearby.name:'地圖位置',district:nearby?.district||'',kind:'transport'};
  next.movement.nextEdgeIds=route;
  if(alreadyThere)extendItinerary(next.movement,graph);
  addLog(next,'route',alreadyThere?'已到達地圖位置，繼續巡遊':`巡遊前往${next.cruiseTarget!.name}`);
  return next;
}

interface Demand { serviceType?:Offer['serviceType']; passengerCount?:number; id: string; pickup: Landmark; destination: Landmark; requestedAt: number; surge: number; pricingType: PricingType }
function chooseDestination(state: GameState, pickup: Landmark, slot: number, salt: number): Landmark | undefined {
  const roll = random(state.seed, slot, salt);
  const radius = roll < 0.45 ? 5500 : roll < 0.82 ? 18000 : 65000;
  const catalog = catalogFor(state.landmarks);
  const key = `${cellFor(pickup).key}:${radius}`;
  let cells = catalog.destinationCells.get(key);
  if (!cells) { cells = radius === 65000 ? [] : catalog.index.nearbyCells(pickup, radius); catalog.destinationCells.set(key, cells); }
  const hour = slot * DEMAND_INTERVAL_MINUTES / 60 % 24;
  const commute=commuteIntensity(slot*DEMAND_INTERVAL_MINUTES);
  const commuteCeiling=commuteDestinationWeight(pickup,{kind:'business'},slot*DEMAND_INTERVAL_MINUTES);
  for (let attempt = 0; attempt < 18 && cells.length; attempt += 1) {
    const cell = cells[Math.floor(random(state.seed, slot, salt + attempt * 2 + 1) * cells.length)];
    const place = cell.entries[Math.floor(random(state.seed, slot, salt + attempt * 2 + 2) * cell.entries.length)];
    if (place.nodeId === pickup.nodeId || flatDistanceM(pickup, place) > radius) continue;
    const desired = hour >= 16 && pickup.kind === 'business' ? 'residential' : undefined;
    if (desired && place.kind !== desired && attempt < 5) continue;
    if(commute>0&&random(state.seed,slot,salt+509+attempt)>commuteDestinationWeight(pickup,place,slot*DEMAND_INTERVAL_MINUTES)/commuteCeiling)continue;
    return place;
  }
  let fallback:Landmark|undefined;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const place = state.landmarks[Math.floor(random(state.seed, slot, salt + 100 + attempt) * state.landmarks.length)];
    if (place?.nodeId !== pickup.nodeId){fallback??=place;if(commute<=0||random(state.seed,slot,salt+809+attempt)<=commuteDestinationWeight(pickup,place,slot*DEMAND_INTERVAL_MINUTES)/commuteCeiling)return place;}
  }
  return fallback;
}
function demandIntensity(place: Landmark, state: GameState, slot: number): number {
  const hour = slot * DEMAND_INTERVAL_MINUTES / 60 % 24;
  let rate = place.kind === 'transport' ? 0.82 : place.kind === 'shopping' ? (hour >= 10 && hour < 23 ? 0.8 : 0.32) : place.kind === 'business' ? (hour >= 7 && hour < 20 ? 0.78 : 0.32) : (hour >= 6 && hour < 11 || hour >= 17 && hour < 23 ? 0.78 : 0.52);
  rate *= Math.max(0.2, Math.min(2, place.demandWeight || 1));
  if(place.kind==='residential')rate*=1+.35*commuteIntensity(slot*DEMAND_INTERVAL_MINUTES);
  const conditions = demandConditions(state.seed, slot * DEMAND_INTERVAL_MINUTES, place.district,{position:place,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:slot*DEMAND_INTERVAL_MINUTES-state.startTimeMinutes});
  return Math.min(0.98, rate * (state.density === 'busy' ? 1.55 : 1) * conditions.arrivalWeight);
}
function movementPosition(movement: Movement, graph: RoadGraph): Coordinate {
  const edge = graph.edges[movement.edgeId]; return pointOnEdge(edge, Math.min(1, movement.distanceOnEdgeM / edge.lengthM), graph);
}
function districtAt(state: GameState, position: Coordinate): string {
  const catalog = catalogFor(state.landmarks);
  const cell = cellFor(position);
  let district = catalog.districtByCell.get(cell.key);
  if (district === undefined) {
    // Deterministic cell center makes the cached district independent of which
    // route first queried this cell, while avoiding a catalog scan each frame.
    const center = { lat: (cell.y + .5) * 900 / 111195, lon: (cell.x + .5) * 900 / 102980 };
    district = catalog.index.nearest(center)?.district || '附近地區';
    catalog.districtByCell.set(cell.key, district);
  }
  return district;
}
export function getLocalDemandConditions(state: GameState, graph?: RoadGraph): ReturnType<typeof demandConditions> & { district: string } {
  const district = districtAt(state, movementPosition(state.movement, getVehicleGraph(state.vehicleId, graph)));
  return { district, ...demandConditions(state.seed, state.startTimeMinutes + state.clockMinutes, district,{position:movementPosition(state.movement,getVehicleGraph(state.vehicleId,graph)),landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:state.clockMinutes}) };
}
function localDemands(state: GameState, movement: Movement, requestedAt: number, slot: number, graph: RoadGraph): Demand[] {
  const position = movementPosition(movement, graph);
  const demands: Demand[] = [];
  // A shared regional arrival gate creates seeded bursts and quiet gaps. Polling
  // the world clock is regular; passenger arrivals are not a dispatch metronome.
  const region = cellFor(position, 6000).key;
  const regional = demandConditions(state.seed, slot * DEMAND_INTERVAL_MINUTES, districtAt(state, position),{position,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:requestedAt});
  const expectedWait = regional.requestIntervalMinutes;
  if (random(state.seed, slot, hash(region) + 313) > DEMAND_INTERVAL_MINUTES / expectedWait) return demands;
  for (const cell of catalogFor(state.landmarks).index.nearbyCells(position, LOCAL_DEMAND_RADIUS_M)) {
    for (let channel = 0; channel < (regional.demandPerMinute>=4?4:2); channel += 1) {
      const salt = hash(cell.key) + channel * 7919;
      const pickup = cell.entries[Math.floor(random(state.seed, slot, salt) * cell.entries.length)];
      if (flatDistanceM(position, pickup) > LOCAL_DEMAND_RADIUS_M || random(state.seed, slot, salt + 1) > demandIntensity(pickup, state, slot)) continue;
      const xl=state.xlOrdersEnabled===true&&channel%2===0&&random(state.seed,slot,salt+913)<XL_GAME_RULES.requestShare;
      const serviceType=xl?'xl':'standard',passengerCount=xl?5+Math.floor(random(state.seed,slot,salt+914)*2):1+Math.floor(random(state.seed,slot,salt+914)*4);
      const pricingType: PricingType = xl?'private-xl':channel % 2 === 0 ? 'private-upfront' : (['taxi-metered', 'taxi-discount85', 'taxi-upfront'] as const)[Math.floor(random(state.seed, slot, salt + 2) * 3)];
      if (!isPricingTypeEligible(VEHICLE_BY_ID[state.vehicleId], pricingType)) continue;
      const destination = chooseDestination(state, pickup, slot, salt + 3);
      const conditions = demandConditions(state.seed, slot * DEMAND_INTERVAL_MINUTES, pickup.district,{position:pickup,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:requestedAt});
      if (destination) demands.push({ id: `world-${state.seed}-${slot}-${cell.key}-${channel}`, pickup, destination, requestedAt, pricingType, serviceType, passengerCount, surge: pricingType === 'private-upfront' || pricingType === 'private-xl' || pricingType === 'taxi-upfront' ? conditions.multiplier : 1 });
    }
  }
  return demands.sort((a, b) => flatDistanceM(position, a.pickup) - flatDistanceM(position, b.pickup) || random(state.seed, slot, hash(a.id)) - random(state.seed, slot, hash(b.id)) || a.id.localeCompare(b.id));
}
/** A destination setting limits dispatch, without moving the car or generating passengers. */
export function setProDestination(state: GameState, placeId?: string, graph?: RoadGraph): GameState {
  if (state.advancedRulesVersion!==1 || state.phase==='ended') return state;
  if (!placeId) return state.proDestination?{...state,proDestination:undefined}:state;
  if (state.proDestination?.placeId===placeId && state.proDestination.expiresAt>state.clockMinutes) return state;
  if ((state.proDestinationsUsed??0)>=proDestinationAllowance(state.proTier)) return state;
  const place=catalogFor(state.landmarks).byId.get(placeId);
  if (!place || !isPlaceAllowed(place,state.vehicleId,getVehicleGraph(state.vehicleId,graph))) return state;
  return {...state,proDestinationsUsed:(state.proDestinationsUsed??0)+1,
    proDestination:{placeId,expiresAt:Math.min(getShiftDurationMinutes(state),state.clockMinutes+45)}};
}

function offerForMovement(demand: Demand, movement: Movement, state: GameState, graph: RoadGraph, feedKind: Offer['feedKind']): Offer | null {
  const filter=state.advancedRulesVersion===1&&state.proDestination;
  if (feedKind==='live' && filter && filter.expiresAt>state.clockMinutes
      && demand.serviceType!=='elite' && !demand.id.startsWith('airport-')) {
    const target=catalogFor(state.landmarks).byId.get(filter.placeId);
    if (target) {
      const before=flatDistanceM(movementPosition(movement,graph),target);
      const after=flatDistanceM(demand.destination,target);
      if (after>1500 && before-after<500) return null;
    }
  }
  if (!isPreferredOffer(state,demand)) return null;
  const current = graph.edges[movement.edgeId];
  const atPickup = movement.distanceOnEdgeM <= EPSILON && current.from === demand.pickup.nodeId;
  const remainder = atPickup ? 0 : Math.max(0, current.lengthM - movement.distanceOnEdgeM);
  const pickupRoute = atPickup ? [] : findRoute(current.to, demand.pickup.nodeId!, graph, 'economy', undefined, { maxCost: Math.max(0, 3800 - remainder) });
  if (!pickupRoute) return null;
  const pickupDistanceM = remainder + routeLength(pickupRoute, graph);
  const pickupMinutes = remainder / (speedKph(current) * 1000 / 60) + routeMinutes(pickupRoute, graph);
  if (pickupDistanceM > 3800 || pickupMinutes > 13) return null;
  const exact = feedKind === 'live';
  const tripRoute = exact ? findRoute(demand.pickup.nodeId!, demand.destination.nodeId!, graph) : [];
  if (!tripRoute || exact && tripRoute.length === 0) return null;
  const tripDistanceM = exact ? routeLength(tripRoute, graph) : Math.max(350, flatDistanceM(demand.pickup, demand.destination) * 1.3);
  const tripMinutes = exact ? routeMinutes(tripRoute, graph) : tripDistanceM / 500;
  const vehicle = VEHICLE_BY_ID[state.vehicleId];
  const estimatedFare = estimateDriverPayout(vehicle, tripDistanceM, tripMinutes, demand.surge, demand.pricingType);
  const conditions = demandConditions(state.seed, state.startTimeMinutes + demand.requestedAt, demand.pickup.district,{position:demand.pickup,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:demand.requestedAt});
  return { serviceType:demand.serviceType??(demand.pricingType==='private-xl'?'xl':'standard'),passengerCount:demand.passengerCount??(demand.pricingType==='private-xl'?5:1),id: demand.id, requestedAt:demand.requestedAt,createdAt: state.clockMinutes, expiresAt: state.clockMinutes + (state.offerResponseWindowMinutes??OFFER_LIFETIME_MINUTES), pickup: demand.pickup, destination: demand.destination, pickupDistanceM, tripDistanceM, pickupMinutes, tripMinutes, estimatedFare, estimatedNet: roundMoney(estimatedFare - (pickupDistanceM + tripDistanceM) / 1000 * energyProfileFor(state.vehicleId).consumptionPerKm * state.energy.unitPricePaid), surge: demand.surge, pickupRoute, tripRoute, pricingType: demand.pricingType, pricingLabel: PRICING_LABELS[demand.pricingType], feedKind, routeEstimated: !exact,
    demandLevel: conditions.level, estimatedWaitMinutes: (conditions.waitMinutesMin + conditions.waitMinutesMax) / 2,
    surgeDescription: demand.pricingType === 'private-upfront' || demand.pricingType === 'private-xl' || demand.pricingType === 'taxi-upfront' ? `遊戲區域需求加成 ${demand.surge.toFixed(2)}×，已包含報價` : '咪錶不乘區域加成' };
}
function stopGhost(state: GameState): void { state.ghost = null; state.ghostOffer = null; state.ghostOffers = []; }
function reviewPlatform(state: GameState): void {
  if (refreshPlatformStats(state)) { state.currentOffer = null; addLog(state, 'platform', `遊戲平台規則：接單／取消紀錄觸發停權 ${Math.round((state.platform.suspendedUntil - state.clockMinutes) / 60)} 小時；完成中的行程可繼續。`); }
}
export function canReceiveOffer(state: GameState): boolean {
  const heading=!!state.navigation&&['refuel','swap','charge','handover','airport'].includes(state.navigation.kind)&&state.navigation.stage==='routing';
  const phase=state.phase==='cruising'&&!state.navigation||(state.phase==='service-route'||state.phase==='fuel-queue')&&heading;
  return hasOrdinaryOrderTypes(state)&&phase&&!state.activeTrip&&!state.queuedTrip&&state.parking?.kind!=='rest'&&state.acceptingOrders&&state.platform.suspendedUntil<=state.clockMinutes&&state.demandCooldownUntil<=state.clockMinutes&&state.energy.remaining>EPSILON&&state.clockMinutes<getShiftDurationMinutes(state)&&!state.deadlineSettlement;
}
function canReserveNext(state:GameState):boolean {
  return hasOrdinaryOrderTypes(state)&&state.nextTripEnabled!==false&&(state.phase==='dropoff'||state.phase==='alighting')&&!!state.activeTrip&&!state.queuedTrip&&state.acceptingOrders&&!state.navigation&&state.platform.suspendedUntil<=state.clockMinutes&&state.energy.remaining>EPSILON&&state.clockMinutes<getShiftDurationMinutes(state);
}
function destinationMovement(state:GameState,graph:RoadGraph):Movement|null {
  const node=state.activeTrip?.offer.destination.nodeId;const edgeId=node?graph.outgoing[node]?.[0]:undefined;
  return edgeId?{edgeId,distanceOnEdgeM:0,nextEdgeIds:[]}:null;
}
/** Bounded local world query. Dispatch/coordinator code never scans the whole POI catalogue. */
export function getWorldDemandCandidates(state:GameState,center:Coordinate,fromMinute:number,toMinute:number,graph?:RoadGraph):Offer[] {
  if(!Number.isFinite(fromMinute)||!Number.isFinite(toMinute)||toMinute<fromMinute||toMinute<0||fromMinute>=getShiftDurationMinutes(state))return [];
  graph=getVehicleGraph(state.vehicleId,graph);const node=nearestNode(center,graph);const edgeId=graph.outgoing[node.id]?.[0];if(!edgeId)return [];
  const movement={edgeId,distanceOnEdgeM:0,nextEdgeIds:[]};const offers:Offer[]=[];
  const first=Math.max(0,Math.floor(fromMinute/DEMAND_INTERVAL_MINUTES));const last=Math.min(first+11,Math.floor(Math.min(toMinute,getShiftDurationMinutes(state)-EPSILON)/DEMAND_INTERVAL_MINUTES));
  for(let n=first;n<=last&&offers.length<6;n++){
    const minute=n*DEMAND_INTERVAL_MINUTES;const slot=Math.floor((state.startTimeMinutes+minute)/DEMAND_INTERVAL_MINUTES);
    for(const demand of localDemands(state,movement,minute,slot,graph).slice(0,3)){
      const offer=offerForMovement(demand,movement,state,graph,'live');if(offer)offers.push(offer);
    }
  }
  return offers;
}
export function quoteWorldOffer(state:GameState,source:Offer,options:{reservation?:'next-trip'}={},graph?:RoadGraph):Offer|null {
  graph=getVehicleGraph(state.vehicleId,graph);
  const movement=options.reservation?destinationMovement(state,graph):state.movement;if(!movement)return null;
  const offer=offerForMovement({id:source.id,pickup:source.pickup,destination:source.destination,requestedAt:source.requestedAt??source.createdAt,surge:source.surge,pricingType:source.pricingType,serviceType:source.serviceType,passengerCount:source.passengerCount},movement,state,graph,'live');
  if(!offer)return null;offer.reservation=options.reservation;
  return canCompleteOfferBeforeHandover(state,offer,graph)?offer:null;
}
export function setDispatchOffer(state:GameState,offer:Offer|null,graph?:RoadGraph):GameState {
  if(!offer){const next=cloneState(state);withdrawOffer(next);return next;}
  if(offer.serviceType==='elite')return state; // Scheduled contracts require an explicit separate commitment.
  if(state.currentOffer||!isPreferredOffer(state,offer)||!(offer.reservation?canReserveNext(state):canReceiveOffer(state)))return state;
  const next=cloneState(state);next.currentOffer=offer;next.platform.offered+=1;next.presentedOffers=(next.presentedOffers??next.acceptedOffers+next.declinedOffers)+1;if(offer.reservation&&next.activeTrip){next.nextTripOfferForTripId=next.activeTrip.offer.id;next.nextTripOfferCooldownUntil=next.clockMinutes+30;}addLog(next,'offer',`${offer.reservation?'預接下一單 · ':''}${offer.pricingLabel} · ${offer.pickup.name} → ${offer.destination.name}`);return autoAcceptCurrent(next,graph);
}
/** Publish each scheduled opportunity once, checking an ELITE-only shift for a feasible opening booking. */
function processEliteReservations(state:GameState,graph:RoadGraph):void {
  if(!eliteEnabled(state))return;
  const eliteOnly = isEliteOnlyShift(state);
  state.eliteReservations??=[];state.eliteReviewedWindows??=[];
  for(let window=0;window<Math.ceil(getShiftDurationMinutes(state)/ELITE_GAME_RULES.windowMinutes);window++){
    if(state.eliteReviewedWindows.includes(window))continue;
    const spec=eliteWindow(state.seed,window,eliteOnly);
    if (!spec || state.clockMinutes >= spec.respondBy) {
      state.eliteReviewedWindows.push(window);
      continue;
    }
    if(state.clockMinutes+EPSILON<spec.announcedAt)continue;
    let booking: EliteReservation | null;
    if(eliteOnly){
      if(!canSeekEliteReservation(state))continue;
      const minute=Math.floor(state.clockMinutes+EPSILON);
      if(state.eliteLastSearchMinute===minute)continue;
      state.eliteLastSearchMinute=minute;
      booking=createEliteReservation(state,window,graph,candidate=>canConfirmEliteReservation(state,candidate,graph));
      if(!booking)continue;
    }else{
      if(!state.acceptingOrders||state.parking?.kind==='rest'||state.platform.suspendedUntil>state.clockMinutes){
        state.eliteReviewedWindows.push(window);
        continue;
      }
      booking=createEliteReservation(state,window,graph);
    }
    state.eliteReviewedWindows.push(window);
    if(!booking)continue;
    state.eliteReservations.push(booking);state.platform.offered+=1;state.presentedOffers=(state.presentedOffers??0)+1;
    addLog(state,'platform',`尊尚預約邀請 · ${booking.offer.pickup.name}`);
  }
  for(const booking of state.eliteReservations){
    if(booking.status==='available'&&state.clockMinutes>=booking.respondBy){booking.status='expired';booking.finishedAt=state.clockMinutes;state.declinedOffers+=1;reviewPlatform(state);}
    if(['accepted','travelling'].includes(booking.status)&&state.clockMinutes>booking.graceEndsAt+EPSILON){
      booking.status='missed';booking.finishedAt=state.clockMinutes;
      if(state.activeTrip?.offer.eliteBookingId===booking.id)finishCancellation(state,graph);else{state.cancelledTrips+=1;reviewPlatform(state);}
      addLog(state,'cancel','未能按時到達預約上客點 · 車資 $0');
    }
  }
}
export function canAcceptEliteReservation(state:GameState,bookingId:string,graph?:RoadGraph):boolean {
  graph=getVehicleGraph(state.vehicleId,graph);const booking=state.eliteReservations?.find(item=>item.id===bookingId);
  return !!booking&&canConfirmEliteReservation(state,booking,graph);
}
function canConfirmEliteReservation(state:GameState,booking:EliteReservation,graph:RoadGraph):boolean {
  if(!canCommitEliteReservation(state,booking,graph))return false;
  const approach=routeToElitePickup(state,booking,graph);if(!approach)return false;
  return canCompleteOfferBeforeHandover(state,{...booking.offer,pickupMinutes:approach.minutes,pickupDistanceM:approach.distanceM,pickupRoute:approach.route},graph);
}
/** Explicit booking actions never auto-accept, reprice, teleport, or interrupt an existing passenger. */
export function applyEliteBookingAction(state:GameState,bookingId:string,choice:EliteBookingChoice,graph?:RoadGraph):GameState {
  graph=getVehicleGraph(state.vehicleId,graph);const source=state.eliteReservations?.find(item=>item.id===bookingId);
  if(!source||state.phase==='ended'||!eliteEnabled(state))return state;
  if(choice==='accept'){
    if(!canAcceptEliteReservation(state,bookingId,graph))return state;
    const next=cloneState(state),booking=next.eliteReservations!.find(item=>item.id===bookingId)!;
    booking.status='accepted';booking.acceptedAt=next.clockMinutes;next.acceptedOffers+=1;withdrawOffer(next);reviewPlatform(next);
    addLog(next,'platform',`已保留尊尚預約 · ${booking.offer.pickup.name}`);return next;
  }
  if(choice==='decline'){
    if(source.status!=='available')return state;const next=cloneState(state),booking=next.eliteReservations!.find(item=>item.id===bookingId)!;
    booking.status='declined';booking.finishedAt=next.clockMinutes;next.declinedOffers+=1;reviewPlatform(next);return next;
  }
  if(choice==='cancel'){
    if(!['accepted','travelling','waiting','in-trip'].includes(source.status))return state;
    if(state.activeTrip?.offer.eliteBookingId===source.id)return cancelTrip(state,graph);
    const next=cloneState(state),booking=next.eliteReservations!.find(item=>item.id===bookingId)!;booking.status='cancelled';booking.finishedAt=next.clockMinutes;next.cancelledTrips+=1;reviewPlatform(next);addLog(next,'cancel','已取消尊尚預約 · 車資 $0');return next;
  }
  if(choice!=='depart'||source.status!=='accepted'||state.activeTrip||state.queuedTrip||state.energyRecovery||state.deadlineSettlement||state.phase==='servicing'||state.phase==='fuel-queue'||state.phase==='airport-queue'||state.clockMinutes>source.graceEndsAt)return state;
  const route=routeToElitePickup(state,source,graph);if(!route||state.clockMinutes+route.minutes>source.graceEndsAt)return state;
  if(state.energy.remaining<(route.distanceM+source.offer.tripDistanceM)/1000*energyProfileFor(state.vehicleId).consumptionPerKm)return state;
  const trip=buildActiveTrip(state,{...source.offer,pickupMinutes:route.minutes,pickupDistanceM:route.distanceM,pickupRoute:route.route},graph);if(!trip)return state;
  trip.acceptedAt=source.acceptedAt??state.clockMinutes;
  const next=cloneState(state);withdrawOffer(next);next.parking=null;next.navigation=null;next.fuelQueue=null;next.cruiseTarget=undefined;
  if(state.navigation?.kind==='handover'||state.navigation?.handoverAfterService)next.handoverIntent='cancelled';
  next.activeTrip=trip;next.phase='pickup';next.movement.nextEdgeIds=route.route;next.movement.committedEdgeCount=0;next.eliteReservations!.find(item=>item.id===bookingId)!.status='travelling';
  addLog(next,'platform',`前往尊尚預約上客點 · ${source.offer.pickup.name}`);if(route.distanceM<=EPSILON)beginWaiting(next,graph,next.clockMinutes);return next;
}
function processScheduled(state: GameState, graph: RoadGraph): void {
  if (state.phase === 'ended') return;
  if(state.phase==='airport-queue'&&!state.airportQueue||state.airportQueue&&!airportQueueStillEligible(state,graph))Object.assign(state,leaveAirportQueue(state,graph));
  if(state.airportQueue&&!state.dispatchManaged){
    for(const source of airportWorldOffers(state,graph)){
      if(state.airportOfferHistory?.includes(source.id))continue;
      const prepared=prepareAirportOffer(state,source),quote=quoteWorldOffer(prepared,source,{},graph);if(!quote)continue;
      const assigned=setDispatchOffer(prepared,quote,graph);
      if(assigned.currentOffer?.id===source.id||assigned.acceptedOffers>state.acceptedOffers){Object.assign(state,assigned);break;}
    }
  }
  processEliteReservations(state,graph);
  if (!state.energy.lowWarningShown && state.energy.remaining / state.energy.capacity <= .15) { state.energy.lowWarningShown = true; addLog(state, 'energy', '能量低於15%，請前往入氣／補給／換電站；耗盡時可召喚遊戲救援'); }
  if (state.currentOffer && state.currentOffer.expiresAt <= state.clockMinutes + EPSILON) { state.declinedOffers += 1; state.currentOffer = null; state.demandCooldownUntil = state.clockMinutes + .5 + random(state.seed, state.declinedOffers, 404); reviewPlatform(state); }
  if (state.parking?.endsAt !== undefined && state.parking.endsAt <= state.clockMinutes + EPSILON) { state.parking = null; addLog(state, 'parking', '臨停已達五分鐘，自動開車'); }
  if(state.handoverPlace&&state.clockMinutes<getShiftDurationMinutes(state)&&state.clockMinutes+EPSILON>=(state.nextHandoverReviewMinute??0)){
    const plan=getHandoverPlan(state,graph);
    state.nextHandoverReviewMinute=Math.min(state.clockMinutes+5,plan.reminderAtMinute>state.clockMinutes+EPSILON?plan.reminderAtMinute:state.clockMinutes+5);
    if(!state.handoverReminderShown&&state.clockMinutes+EPSILON>=plan.reminderAtMinute){state.handoverReminderShown=true;addLog(state,'shift',plan.reminderLeadMinutes<=60?`距交更時間一小時，交更點：${state.handoverPlace.name}`:Number.isFinite(plan.totalRequiredMinutes)?`交更安排提醒 · 預計需 ${Math.ceil(plan.totalRequiredMinutes)} 分鐘，請預留前往補給、輪候及回程時間`:plan.warning||'請預留返回交更點時間');}
    if(!state.handoverReturnWarningShown&&(plan.shouldReturnNow||!plan.energyEnough)){state.handoverReturnWarningShown=true;addLog(state,'shift',plan.warning||'請預留返回交更點時間');}
  }
  const position = getVehiclePosition(state, graph);
  state.observedOffers = state.observedOffers.filter(offer => flatDistanceM(position, offer.pickup) <= NEARBY_RETENTION_RADIUS_M);
  if (state.routeEvent && state.routeEvent.expiresAt <= state.clockMinutes) state.routeEvent = null;
  while (state.nextDemandMinute <= state.clockMinutes + EPSILON && state.nextDemandMinute < getShiftDurationMinutes(state)) {
    const requestedAt = state.nextDemandMinute;
    state.demandIndex += 1;
    const slot = Math.floor((state.startTimeMinutes + requestedAt) / DEMAND_INTERVAL_MINUTES);
    state.nextDemandMinute += DEMAND_INTERVAL_MINUTES;
    const actual = localDemands(state, state.movement, requestedAt, slot, graph);
    if(!state.dispatchManaged){const taken=new Set([state.activeTrip?.offer.id,state.queuedTrip?.offer.id]);state.mapDemandRequests=mergeMapDemandRequests(state.mapDemandRequests,actual.filter(demand=>!taken.has(demand.id)).map(({id,pickup,requestedAt})=>({id,pickup:{lat:pickup.lat,lon:pickup.lon},requestedAt})),state.clockMinutes);}
    if (!state.dispatchManaged && canReceiveOffer(state) && !state.currentOffer) {
      for (const demand of actual.slice(0, 3)) {
        const offer = offerForMovement(demand, state.movement, state, graph, 'live');
        if (offer && canCompleteOfferBeforeHandover(state,offer,graph)) { state.currentOffer = offer; state.platform.offered += 1;state.presentedOffers=(state.presentedOffers??state.acceptedOffers+state.declinedOffers)+1; addLog(state, 'offer', `${offer.pricingLabel} · ${offer.pickup.name} → ${offer.destination.name}`); break; }
      }
    }
    if(!state.dispatchManaged&&!state.currentOffer&&canReserveNext(state)&&shouldDispatchNextTrip(state,remainingRouteMetrics(state,graph).distanceM,remainingRouteMetrics(state,graph).minutes)){
      const movement=destinationMovement(state,graph);
      if(movement)for(const demand of localDemands(state,movement,requestedAt,slot,graph).slice(0,3)){
        const offer=offerForMovement(demand,movement,state,graph,'live');if(!offer)continue;offer.reservation='next-trip';
        if(canCompleteOfferBeforeHandover(state,offer,graph)){state.currentOffer=offer;state.nextTripOfferForTripId=state.activeTrip!.offer.id;state.nextTripOfferCooldownUntil=state.clockMinutes+30;state.platform.offered+=1;state.presentedOffers=(state.presentedOffers??state.acceptedOffers+state.declinedOffers)+1;addLog(state,'offer',`預接下一單 · ${offer.pickup.name} → ${offer.destination.name}`);break;}
      }
    }
    for (const demand of actual.slice(0, state.density === 'busy' ? 4 : 2)) {
        if (demand.id === state.currentOffer?.id) continue;
        const offer = offerForMovement(demand, state.movement, state, graph, 'along-route');
        if (offer && !state.observedOffers.some(item => item.id === offer.id)) { state.observedOffers.unshift(offer); addLog(state, 'observed', `附近需求 · ${offer.pickup.name} → ${offer.destination.name}`); }
    }
  }
  if(!state.routeEvent&&!state.parking&&!state.energyRecovery&&['cruising','pickup','dropoff','service-route'].includes(state.phase)){
    const catalog=catalogFor(state.landmarks);let cached=catalog.hazardPlaces.get(graph);if(!cached){cached=new Map();catalog.hazardPlaces.set(graph,cached);}
    let distance=0;
    for(const id of [state.movement.edgeId,...state.movement.nextEdgeIds].slice(0,15)){
      const edge=graph.edges[id];if(!edge)break;if(distance>900)break;
      if(!cached.has(id)){const center=pointOnEdge(edge,.5,graph);cached.set(id,catalog.index.nearby(center,700,1)[0]);}
      const hazard=roadHazardOnEdge(state,edge,graph,cached.get(id));
      if(hazard){state.routeEvent=hazard;state.routeEvent.rerouteAvailable=getRouteEventOptions(state,graph).reroute;addLog(state,'event',`${hazard.title} · ${hazard.roadName}`);break;}
      distance+=id===state.movement.edgeId?Math.max(0,edge.lengthM-state.movement.distanceOnEdgeM):edge.lengthM;
    }
  }
  if(state.routeEvent&&state.clockMinutes>=state.nextEventMinute)state.nextEventMinute=Math.max(state.nextEventMinute,state.routeEvent.expiresAt+.25);
  if (state.clockMinutes >= state.nextEventMinute && state.clockMinutes < getShiftDurationMinutes(state)) {
    const index = state.eventIndex++;
    state.nextEventMinute += 105 + random(state.seed, index, 6) * 18;
    const edgeId = state.movement.nextEdgeIds[0] || state.movement.edgeId;
    state.routeEvent = { id: `event-${index}`, kind:index%2?'roadworks':'traffic',title: index % 2 ? '前方臨時工程' : '前方車流轉慢', description: '可以保留路線，或喺下一個合法路口改道。', roadName: graph.edges[edgeId].name || '前方道路', affectedEdgeId: edgeId, startedAt: state.clockMinutes, expiresAt: state.clockMinutes + 12, resolved: false };
    state.routeEvent.rerouteAvailable=getRouteEventOptions(state,graph).reroute;
  }
  const accepted=autoAcceptCurrent(state,graph);if(accepted!==state)Object.assign(state,accepted);
}
/** Server configuration, never a client action. Keeps old saved offers and future generation consistent. */
export function setOfferResponseWindow(state:GameState,minutes:number,graph?:RoadGraph):GameState {
  if(!Number.isFinite(minutes)||minutes<=0)return state;
  const offer=state.currentOffer;const expiry=offer?offer.createdAt+minutes:undefined;
  if(state.offerResponseWindowMinutes===minutes&&(!offer||offer.expiresAt===expiry))return state;
  const next=cloneState(state);next.offerResponseWindowMinutes=minutes;
  if(offer)next.currentOffer={...offer,expiresAt:expiry!};
  processScheduled(next,getVehicleGraph(state.vehicleId,graph));
  return next;
}
function remainingRouteMetrics(state:GameState,graph:RoadGraph):{distanceM:number;minutes:number} {
  const edge=graph.edges[state.movement.edgeId];
  const remainder=Math.max(0,edge.lengthM-state.movement.distanceOnEdgeM);
  return {distanceM:remainder+routeLength(state.movement.nextEdgeIds,graph),minutes:remainder/(speedKph(edge)*1000/60)+routeMinutes(state.movement.nextEdgeIds,graph)};
}
function routeFromPosition(state:GameState,nodeId:string,graph:RoadGraph):{route:string[];distanceM:number;minutes:number}|null {
  const edge=graph.edges[state.movement.edgeId];
  const at=state.movement.distanceOnEdgeM<=EPSILON&&edge.from===nodeId||state.movement.distanceOnEdgeM>=edge.lengthM-EPSILON&&edge.to===nodeId;
  const route=at?[]:findRoute(edge.to,nodeId,graph);
  if(!route)return null;
  const remainder=at?0:Math.max(0,edge.lengthM-state.movement.distanceOnEdgeM);
  return {route,distanceM:remainder+routeLength(route,graph),minutes:remainder/(speedKph(edge)*1000/60)+routeMinutes(route,graph)};
}
function stationTravelMetrics(state:GameState,station:EnergyStation,graph:RoadGraph):{distanceM:number;minutes:number}|null {
  if(state.fuelQueueMode==='legacy'||station.kind!=='lpg')return routeFromPosition(state,station.nodeId,graph);
  const approach=stationQueueApproach(station,graph);if(!approach.length)return routeFromPosition(state,station.nodeId,graph);
  const current=graph.edges[state.movement.edgeId],entry=graph.edges[approach[0]].from;
  const atEntry=state.movement.distanceOnEdgeM<=EPSILON&&current.from===entry;
  const toEntry=atEntry?[]:findRoute(current.to,entry,graph);if(!toEntry)return null;
  const ids=[...toEntry,...approach];
  const remainder=atEntry?0:Math.max(0,current.lengthM-state.movement.distanceOnEdgeM);
  return {distanceM:remainder+routeLength(ids,graph),minutes:remainder/(speedKph(current)*1000/60)+routeMinutes(ids,graph)};
}
export function getFuelQueueEstimate(state:GameState,station:EnergyStation,graph?:RoadGraph):{waitMinutes:number;aheadCount:number;serviceMinutes:number;totalMinutes:number;peakTurnover:boolean} {
  graph=getVehicleGraph(state.vehicleId,graph);
  const outward=stationTravelMetrics(state,station,graph),travel=outward?.minutes||0;
  const baseline=fuelQueueBaseline(station,state.startTimeMinutes+state.clockMinutes+travel);
  const waitMinutes=state.fuelQueue?.stationId===station.id?Math.max(0,state.fuelQueue.serviceStartsAt-state.clockMinutes):baseline.waitMinutes;
  const atService=state.navigation?.target.id===station.id&&state.navigation.stage==='servicing';
  const serviceState=atService?state:{...state,chargingSession:null,energy:{...state.energy,remaining:Math.max(0,state.energy.remaining-(outward?.distanceM??0)/1000*energyProfileFor(state.vehicleId).consumptionPerKm)}};
  const serviceMinutes=getEnergyServiceEstimate(serviceState,station).minutes;
  return {...baseline,waitMinutes,aheadCount:state.fuelQueue?.stationId===station.id?Math.ceil(waitMinutes/FUEL_QUEUE_HEADWAY_MINUTES):baseline.aheadCount,serviceMinutes,totalMinutes:waitMinutes+serviceMinutes};
}
/** Background traffic for a visible solo station queue. Real multiplayer peers remain separate. */
export function getFuelQueueVehicles(state:GameState,graph?:RoadGraph,occupiedPositions:Coordinate[]=[]):Array<{id:string;position:Coordinate&{heading:number};vehicleId:VehicleId}> {
  graph=getVehicleGraph(state.vehicleId,graph);const queue=state.fuelQueue;if(!queue||!queue.approachEdgeIds.length)return [];
  const ownBack=remainingRouteMetrics(state,graph).distanceM;
  const background=Math.max(0,(queue.backgroundAheadCount??0)-Math.floor((state.clockMinutes-queue.joinedAt)/FUEL_QUEUE_HEADWAY_MINUTES));
  const count=Math.min(40,background,Math.max(0,Math.floor((ownBack-(queue.connectorDistanceM||0))/7)-1));
  const result:Array<{id:string;position:Coordinate&{heading:number};vehicleId:VehicleId}>=[];
  for(let index=0;index<count;index++){
    const distance=(queue.connectorDistanceM||0)+(index+1)*7;const point=queuePoint(queue.approachEdgeIds,distance,graph),ahead=queuePoint(queue.approachEdgeIds,Math.max(0,distance-1),graph);if(!point||!ahead||occupiedPositions.some(position=>distanceMetres(position,point)<7))continue;
    const heading=Math.atan2((ahead.lon-point.lon)*Math.cos(point.lat*Math.PI/180),ahead.lat-point.lat)*180/Math.PI;
    result.push({id:`${queue.stationId}-background-${index}`,position:{...point,heading},vehicleId:state.vehicleId});
  }
  return result;
}
export const HANDOVER_READY_FRACTION=.9;
interface HandoverStation {station:EnergyStation;returnRoute:string[];distanceM:number;minutes:number}
const handoverStations=new WeakMap<RoadGraph,Map<string,HandoverStation|null>>();
function stationForHandover(state:GameState,graph:RoadGraph):HandoverStation|null {
  const target=state.handoverPlace;if(!target?.nodeId)return null;
  let cache=handoverStations.get(graph);if(!cache){cache=new Map();handoverStations.set(graph,cache);}
  const key=`${state.vehicleId}|${target.nodeId}`;if(cache.has(key))return cache.get(key)!;
  let selected:HandoverStation|null=null;
  const candidates=getCompatibleStations(state.vehicleId).filter(station=>!!graph.nodes[station.nodeId]).sort((a,b)=>flatDistanceM(a,target)-flatDistanceM(b,target)).slice(0,8);
  for(const station of candidates){const route=findRoute(station.nodeId,target.nodeId,graph);if(!route)continue;const distanceM=routeLength(route,graph);if(!selected||distanceM<selected.distanceM)selected={station,returnRoute:route,distanceM,minutes:routeMinutes(route,graph)};}
  cache.set(key,selected);return selected;
}
function requiredHandoverEnergy(state:GameState,graph:RoadGraph):number {
  if(state.fuelQueueMode==='legacy'||!state.handoverPlace)return 0;
  const nearest=stationForHandover(state,graph),profile=energyProfileFor(state.vehicleId);
  // A full tank at the nearest usable station must remain sufficient after the
  // actual directed return, including a 15% travel allowance and 200 metres.
  const returnAllowance=nearest?(nearest.distanceM/1000*1.15+.2)*profile.consumptionPerKm:0;
  return Math.min(state.energy.capacity*HANDOVER_READY_FRACTION,Math.max(state.energy.capacity*.5,state.energy.capacity-returnAllowance));
}
const arrivalEdgeIndexes=new WeakMap<RoadGraph,Map<string,string>>();
function projectedArrivalState(state:GameState,nodeId:string,remainingEnergy:number,graph:RoadGraph):GameState|null {
  const last=state.activeTrip?.offer.tripRoute.at(-1);
  let incoming=arrivalEdgeIndexes.get(graph);if(!incoming){incoming=new Map();for(const edge of Object.values(graph.edges))if(!incoming.has(edge.to))incoming.set(edge.to,edge.id);arrivalEdgeIndexes.set(graph,incoming);}
  const edge=last&&graph.edges[last]?.to===nodeId?graph.edges[last]:graph.edges[incoming.get(nodeId)||''];
  return edge?{...state,phase:'cruising',activeTrip:null,queuedTrip:null,navigation:null,fuelQueue:null,movement:{edgeId:edge.id,distanceOnEdgeM:edge.lengthM,nextEdgeIds:[]},energy:{...state.energy,remaining:remainingEnergy}}:null;
}
export interface HandoverPlan {
  deadlineMinute:number;remainingMinutes:number;returnMinutes:number;energyEnough:boolean;latestDepartureMinute:number;shouldReturnNow:boolean;canFinishRefuelAndReturn:boolean;
  stationDetourMinutes?:number;queueMinutes?:number;serviceMinutes?:number;warning?:string;
  needsRefuel:boolean;handoverReady:boolean;refuelStation?:EnergyStation;totalRequiredMinutes:number;requiredEnergyFraction:number;fuelRequiredUnits:number;
  reminderLeadMinutes:number;reminderAtMinute:number;
}
export function getHandoverPlan(state:GameState,graph?:RoadGraph,station?:EnergyStation):HandoverPlan {
  graph=getVehicleGraph(state.vehicleId,graph);const profile=energyProfileFor(state.vehicleId);
  const remainingMinutes=Math.max(0,getShiftDurationMinutes(state)-state.clockMinutes),target=state.handoverPlace;
  let positionState=state,outstandingMinutes=0,outstandingDistanceM=0;
  if(state.activeTrip){
    const trip=state.activeTrip,moving=remainingRouteMetrics(state,graph);
    outstandingMinutes=state.phase==='alighting'?getPhaseRemainingMinutes(state):state.phase==='dropoff'?moving.minutes+.34:state.phase==='waiting'||state.phase==='boarding'?getPhaseRemainingMinutes(state)+(state.phase==='waiting'?trip.boardingMinutes:0)+moving.minutes+.34:moving.minutes+trip.waitMinutes+trip.boardingMinutes+trip.canonicalMinutes+.34;
    outstandingDistanceM=state.phase==='alighting'?0:state.phase==='pickup'?moving.distanceM+trip.canonicalDistanceM:moving.distanceM;
    positionState=projectedArrivalState(state,trip.offer.destination.nodeId!,Math.max(0,state.energy.remaining-outstandingDistanceM/1000*profile.consumptionPerKm),graph)||state;
  }
  const direct=target?.nodeId?routeFromPosition(positionState,target.nodeId,graph):{route:[],distanceM:0,minutes:0};
  const returnMinutes=direct?.minutes??Infinity,requiredEnergy=requiredHandoverEnergy(state,graph);
  const predictedEnergy=positionState.energy.remaining-(direct?.distanceM??Infinity)/1000*profile.consumptionPerKm;
  const fuelRequiredUnits=Math.max(0,requiredEnergy-predictedEnergy);
  const needsRefuel=!!target&&state.fuelQueueMode!=='legacy'&&fuelRequiredUnits>EPSILON;
  const currentStation=state.navigation&&['refuel','swap','charge'].includes(state.navigation.kind)?state.navigation.target as EnergyStation:undefined;
  const chosen=station||currentStation||((needsRefuel?stationForHandover(state,graph):null)?.station);
  let totalRequiredMinutes=outstandingMinutes*1.25+returnMinutes*1.25+2;
  let energyEnough=positionState.energy.remaining+EPSILON>=(direct?.distanceM??Infinity)/1000*profile.consumptionPerKm;
  let stationDetourMinutes:number|undefined,queueMinutes:number|undefined,serviceMinutes:number|undefined;
  if(chosen){
    const sameService=state.navigation?.target.id===chosen.id&&state.navigation.stage==='servicing';
    const outward=sameService?{distanceM:0,minutes:0}:state.fuelQueue?.stationId===chosen.id?remainingRouteMetrics(state,graph):stationTravelMetrics(positionState,chosen,graph);
    const back=target?.nodeId?findRoute(chosen.nodeId,target.nodeId,graph):[];
    const baseline=fuelQueueBaseline(chosen,state.startTimeMinutes+state.clockMinutes+outstandingMinutes*1.25+(outward?.minutes||0));
    queueMinutes=sameService?0:state.fuelQueue?.stationId===chosen.id?Math.max(0,state.fuelQueue.serviceStartsAt-state.clockMinutes):state.fuelQueueMode==='legacy'?0:baseline.waitMinutes;
    const serviceArrival={...positionState,chargingSession:null,energy:{...positionState.energy,remaining:Math.max(0,positionState.energy.remaining-(outward?.distanceM??0)/1000*profile.consumptionPerKm)}};
    serviceMinutes=sameService?getPhaseRemainingMinutes(state):getEnergyServiceEstimate(serviceArrival,chosen).minutes;
    stationDetourMinutes=outward&&back?outward.minutes*1.25+routeMinutes(back,graph)*1.25:Infinity;
    totalRequiredMinutes=outstandingMinutes*1.25+stationDetourMinutes+queueMinutes+serviceMinutes+2;
    energyEnough=!!outward&&positionState.energy.remaining+EPSILON>=outward.distanceM/1000*profile.consumptionPerKm;
  }
  const canFinishRefuelAndReturn=energyEnough&&remainingMinutes+EPSILON>=totalRequiredMinutes&&(!needsRefuel||!!chosen);
  if(needsRefuel&&!chosen)totalRequiredMinutes=Infinity;
  const shouldReturnNow=!!target&&remainingMinutes<=totalRequiredMinutes;
  const warning=!energyEnough?'現有能量不足以到達補給或交更點':needsRefuel&&!chosen?'找不到可通行的交更前補給站':shouldReturnNow?'請立即補給並返回交更點，交更時間不會延後':needsRefuel?'交更前需要補充能源，請預留輪候及回程時間':station&&!canFinishRefuelAndReturn?'入氣、排隊及返回交更點可能超時':undefined;
  const reminderLeadMinutes=Math.min(getShiftDurationMinutes(state),Math.max(60,totalRequiredMinutes+15));
  return {deadlineMinute:getShiftDurationMinutes(state),remainingMinutes,returnMinutes,energyEnough,latestDepartureMinute:getShiftDurationMinutes(state)-totalRequiredMinutes,shouldReturnNow,canFinishRefuelAndReturn,stationDetourMinutes,queueMinutes,serviceMinutes,warning,needsRefuel,handoverReady:!needsRefuel,refuelStation:chosen,totalRequiredMinutes,requiredEnergyFraction:state.energy.capacity?requiredEnergy/state.energy.capacity:0,fuelRequiredUnits,reminderLeadMinutes,reminderAtMinute:Math.max(0,getShiftDurationMinutes(state)-reminderLeadMinutes)};
}
export function canCompleteOfferBeforeHandover(state:GameState,offer:Offer,graph?:RoadGraph):boolean {
  graph=getVehicleGraph(state.vehicleId,graph);
  if(!eliteAllowsOrdinaryOffer(state,offer,graph))return false;
  const timing=pickupTiming(state.seed,offer.id,offer.pickup);
  const pending=offer.reservation&&state.activeTrip?(state.phase==='alighting'?getPhaseRemainingMinutes(state):remainingRouteMetrics(state,graph).minutes+.34):0;
  const pendingDistance=offer.reservation?remainingRouteMetrics(state,graph).distanceM:0;
  const appointmentWait=offer.scheduledPickupMinute===undefined?0:Math.max(0,offer.scheduledPickupMinute-state.clockMinutes-offer.pickupMinutes);
  const tripMinutes=appointmentWait+(pending+offer.pickupMinutes+timing.totalMinutes+offer.tripMinutes)*1.25+.34;
  const fuel=state.energy.remaining-(pendingDistance+offer.pickupDistanceM+offer.tripDistanceM)/1000*energyProfileFor(state.vehicleId).consumptionPerKm;
  if(fuel<0)return false;
  const commitment=activeEliteReservation(state);
  if(commitment&&commitment.id!==offer.eliteBookingId){
    const back=findRoute(offer.destination.nodeId!,commitment.offer.pickup.nodeId!,graph);if(!back)return false;
    const afterFuel=fuel-(routeLength(back,graph)+commitment.offer.tripDistanceM)/1000*energyProfileFor(state.vehicleId).consumptionPerKm;
    if(afterFuel<0)return false;
    const afterBooking=projectedArrivalState(state,commitment.offer.destination.nodeId!,afterFuel,graph);if(!afterBooking)return false;
    afterBooking.clockMinutes=commitment.pickupAt+pickupTiming(state.seed,commitment.id,commitment.offer.pickup).totalMinutes+commitment.offer.tripMinutes*1.25+.34;
    const afterPlan=getHandoverPlan(afterBooking,graph);
    if(!afterPlan.energyEnough||afterPlan.needsRefuel&&!afterPlan.refuelStation||afterBooking.clockMinutes+afterPlan.totalRequiredMinutes>getShiftDurationMinutes(state)+EPSILON)return false;
  }
  const projected=projectedArrivalState(state,offer.destination.nodeId!,fuel,graph);if(!projected)return false;
  projected.clockMinutes=state.clockMinutes+tripMinutes;
  const plan=getHandoverPlan(projected,graph);
  return plan.energyEnough&&(!plan.needsRefuel||!!plan.refuelStation)&&projected.clockMinutes+plan.totalRequiredMinutes<=getShiftDurationMinutes(state)+EPSILON;
}
export function getNearbyCandidates(state: GameState, radiusM = LOCAL_DEMAND_RADIUS_M, limit = 30, graph?: RoadGraph): Landmark[] { return catalogFor(state.landmarks).index.nearby(getVehiclePosition(state, getVehicleGraph(state.vehicleId, graph)), radiusM, limit); }
export function pickupTiming(seed: number, offerId: string, pickup: Landmark): { waitMinutes: number; boardingMinutes: number; totalMinutes: number } {
  const salt = hash(offerId);
  const rural = pickup.waitingProfile !== undefined ? pickup.waitingProfile === 'saikung' : pickup.district.includes('西貢');
  const longWait = rural && random(seed, salt, 122) > 0.85;
  const totalMinutes = longWait ? 3 + random(seed, salt, 123) * 7 : 0.05 + Math.pow(random(seed, salt, 124), 2) * 2.95;
  return { waitMinutes: totalMinutes * 0.8, boardingMinutes: totalMinutes * 0.2, totalMinutes };
}
function beginWaiting(state: GameState, graph: RoadGraph, now: number): void {
  const trip = state.activeTrip!;
  const scheduled=state.eliteReservations?.find(item=>item.id===trip.offer.eliteBookingId);
  if(scheduled&&now>scheduled.graceEndsAt+EPSILON){scheduled.status='missed';scheduled.finishedAt=now;finishCancellation(state,graph);return;}
  state.phase = 'waiting'; trip.arrivedAt = now; trip.phaseEndsAt = Math.max(now,trip.offer.scheduledPickupMinute??now) + trip.waitMinutes;
  const booking=state.eliteReservations?.find(item=>item.id===trip.offer.eliteBookingId);if(booking)booking.status='waiting';
  const route = findRoute(trip.offer.pickup.nodeId!, trip.offer.destination.nodeId!, graph, trip.routePolicy) || trip.offer.tripRoute;
  if (route.length) state.movement = { ...state.movement,edgeId: route[0], distanceOnEdgeM: 0, nextEdgeIds: route.slice(1),committedEdgeCount:0 };
  addLog(state, 'wait', `${trip.offer.pickup.name} · 等候乘客`);
}
function buildActiveTrip(state:GameState,offer:Offer,graph:RoadGraph):ActiveTrip|null {
  const tripRoute=offer.tripRoute.length&&offer.tripRoute.every(id=>graph.edges[id])?offer.tripRoute:findRoute(offer.pickup.nodeId!,offer.destination.nodeId!,graph);
  if(!tripRoute?.length)return null;
  const timing=pickupTiming(state.seed,offer.id,offer.pickup);const canonicalDistanceM=routeLength(tripRoute,graph);const canonicalMinutes=routeMinutes(tripRoute,graph);
  const fareOnCompletion=offer.pricingType==='taxi-metered'||offer.pricingType==='taxi-discount85'?estimateDriverPayout(VEHICLE_BY_ID[state.vehicleId],canonicalDistanceM,canonicalMinutes,1,offer.pricingType):offer.estimatedFare;
  return {offer:{...offer,tripRoute},acceptedAt:state.clockMinutes,actualDistanceM:0,paidDistanceM:0,routePolicy:'fastest',waitMinutes:timing.waitMinutes,boardingMinutes:timing.boardingMinutes,fareOnCompletion,canonicalDistanceM,canonicalMinutes};
}
function activateQueuedTrip(state:GameState,graph:RoadGraph):void {
  const trip=state.queuedTrip;if(!trip||state.phase==='ended'||state.energyRecovery)return;
  const route=routeFromPosition(state,trip.offer.pickup.nodeId!,graph);
  state.queuedTrip=null;
  if(!route||!canCompleteOfferBeforeHandover(state,{...trip.offer,reservation:undefined,pickupMinutes:route.minutes,pickupDistanceM:route.distanceM},graph)){
    state.cancelledTrips+=1;addLog(state,'cancel','預接行程無法於交更前完成，已取消，車資 $0');return;
  }
  state.activeTrip=trip;state.phase='pickup';state.movement.nextEdgeIds=route.route;state.movement.committedEdgeCount=0;
  addLog(state,'accept',`上一位乘客已落車 · 前往下一單${trip.offer.pickup.name}`);
  if(route.distanceM<=EPSILON)beginWaiting(state,graph,state.clockMinutes);
}
export function acceptOffer(state: GameState, graph?: RoadGraph): GameState {
  graph=getVehicleGraph(state.vehicleId,graph);const offer=state.currentOffer;
  if(!offer||!(offer.reservation?canReserveNext(state):canReceiveOffer(state))||offer.expiresAt<=state.clockMinutes||!isPreferredOffer(state,offer)||!isPlaceAllowed(offer.pickup,state.vehicleId,graph)||!isPlaceAllowed(offer.destination,state.vehicleId,graph))return state;
  const actualPickup=offer.reservation?null:routeFromPosition(state,offer.pickup.nodeId!,graph);
  if(!offer.reservation&&!actualPickup)return state;
  const freshOffer=actualPickup?{...offer,pickupMinutes:actualPickup.minutes,pickupDistanceM:actualPickup.distanceM,pickupRoute:actualPickup.route}:offer;
  if(!canCompleteOfferBeforeHandover(state,freshOffer,graph))return state;
  const trip=buildActiveTrip(state,freshOffer,graph);if(!trip)return state;
  if(offer.reservation){const next=cloneState(state);next.mapDemandRequests=next.mapDemandRequests?.filter(request=>request.id!==offer.id);next.queuedTrip=trip;next.currentOffer=null;next.acceptedOffers+=1;addLog(next,'accept',`已預接下一單 · 完成現有行程及落客後前往${offer.pickup.name}`);reviewPlatform(next);return next;}
  const route=routeFromPosition(state,offer.pickup.nodeId!,graph);if(!route)return state;
  const next=cloneState(state);stopGhost(next);next.parking=null;next.cruiseTarget=undefined;
  next.mapDemandRequests=next.mapDemandRequests?.filter(request=>request.id!==offer.id);
  if(next.navigation?.kind==='handover'||next.navigation?.handoverAfterService)next.handoverIntent='cancelled';
  next.navigation=null;next.fuelQueue=null;
  next.activeTrip=trip;next.currentOffer=null;next.phase='pickup';next.acceptedOffers+=1;next.movement.nextEdgeIds=route.route;next.movement.committedEdgeCount=0;
  addLog(next,'accept',`接單 · 前往${offer.pickup.name}`);reviewPlatform(next);
  if(route.distanceM<=EPSILON)beginWaiting(next,graph,next.clockMinutes);return next;
}
export function acceptNextOffer(state:GameState,offerId:string,graph?:RoadGraph):GameState {
  return state.currentOffer?.id===offerId&&state.currentOffer.reservation==='next-trip'?acceptOffer(state,graph):state;
}
function autoAcceptCurrent(state:GameState,graph?:RoadGraph):GameState {return state.autoAcceptOrders&&state.currentOffer?acceptOffer(state,graph):state;}
export function setAutoAcceptOrders(state:GameState,value:boolean,graph?:RoadGraph):GameState {
  if(state.phase==='ended')return state;
  const next=state.autoAcceptOrders===value?state:{...cloneState(state),autoAcceptOrders:value};
  return value?autoAcceptCurrent(next,graph):next;
}
export function declineOffer(state: GameState): GameState {
  if (!state.currentOffer) return state;
  const next = cloneState(state); addLog(next, 'decline', `略過 ${next.currentOffer!.pickup.name} → ${next.currentOffer!.destination.name}`);
  next.currentOffer = null; next.declinedOffers += 1; next.demandCooldownUntil = state.clockMinutes + .4 + random(state.seed, next.declinedOffers, 405) * 1.2; reviewPlatform(next); return next;
}
function finishCancellation(next: GameState, graph: RoadGraph): void {
  const booking=next.eliteReservations?.find(item=>item.id===next.activeTrip?.offer.eliteBookingId);if(booking&&booking.status!=='missed'){booking.status='cancelled';booking.finishedAt=next.clockMinutes;}
  addLog(next, 'cancel', '取消行程 · 車資 $0 · 已用時間及成本保留');
  withdrawOffer(next);next.activeTrip = null; next.currentOffer = null; next.phase = 'cruising'; next.cancelledTrips += 1; next.movement.nextEdgeIds = []; next.navigation = null;
  if (next.energyRecovery) { next.energyRecovery.previousPhase = 'cruising'; next.phase = 'servicing'; }
  next.demandCooldownUntil = next.clockMinutes + 3 + random(next.seed, next.cancelledTrips, 406) * 5;
  extendItinerary(next.movement, graph); stopGhost(next); updateBalance(next); reviewPlatform(next);activateQueuedTrip(next,graph);
}
export function cancelQueuedTrip(state:GameState,tripId?:string):GameState {
  if(tripId&&state.queuedTrip?.offer.id!==tripId)return state;
  if(!state.queuedTrip||state.phase==='ended')return state;const next=cloneState(state);next.queuedTrip=null;next.cancelledTrips+=1;addLog(next,'cancel','取消預接下一單 · 車資 $0');reviewPlatform(next);return next;
}
export function cancelTrip(state: GameState, graph?: RoadGraph): GameState {
  graph = getVehicleGraph(state.vehicleId, graph);
  if (!state.activeTrip || state.phase === 'ended' || state.phase === 'alighting') return state;
  if (state.phase === 'safe-dropoff' || state.activeTrip.cancellationRequestedAt !== undefined) return state;
  const next = cloneState(state);
  next.cruiseTarget=undefined;
  if (state.phase === 'dropoff' || state.activeTrip.pickedUpAt !== undefined) {
    const safe = safeStopRoute(next, graph);
    if (!safe) { addLog(next, 'cancel', '未找到安全落客位置，請繼續行車後再試'); return next; }
    if (next.energyRecovery) next.energyRecovery.previousPhase = 'safe-dropoff'; else next.phase = 'safe-dropoff';
    withdrawOffer(next);next.activeTrip!.cancellationRequestedAt = next.clockMinutes;
    next.navigation = { kind: 'safe-dropoff', target: safe.target, stage: 'routing' }; next.movement.nextEdgeIds = safe.route;
    addLog(next, 'cancel', '已要求取消：先駛往非隧道／快速路安全位置落客，車資 $0');
  } else finishCancellation(next, graph);
  return next;
}
export function getPlatformStats(state: GameState): PlatformStats {
  return { ...state.platform, accepted: state.acceptedOffers, cancelled: state.cancelledTrips, acceptanceRate: state.platform.offered ? Math.min(1, state.acceptedOffers / state.platform.offered) : 1, cancellationRate: state.acceptedOffers ? state.cancelledTrips / state.acceptedOffers : 0 };
}
export function getLifetimePlatformStats(state:GameState):Pick<PlatformStats,'offered'|'accepted'|'cancelled'|'acceptanceRate'|'cancellationRate'> {
  const offered=(state.platformHistory?.offered||0)+(state.presentedOffers??state.platform.offered),accepted=(state.platformHistory?.accepted||0)+state.acceptedOffers,cancelled=(state.platformHistory?.cancelled||0)+state.cancelledTrips;
  return {offered,accepted,cancelled,acceptanceRate:offered?Math.min(1,accepted/offered):1,cancellationRate:accepted?cancelled/accepted:0};
}
function withdrawOffer(state: GameState): void {
  if (state.currentOffer) { state.currentOffer = null; state.platform.offered = Math.max(state.acceptedOffers + state.declinedOffers, state.platform.offered - 1); }
}
export function setAcceptingOrders(state: GameState, accepting: boolean): GameState {
  if (state.acceptingOrders === accepting || state.phase === 'ended') return state;
  const next = cloneState(state); next.acceptingOrders = accepting;
  if (!accepting) withdrawOffer(next);
  addLog(next, 'platform', accepting ? '恢復接單（遊戲停權期間仍不能接單）' : '暫停接單；時間及行車繼續，撤回未回應單不算拒單');
  return next;
}
function beginParking(state: GameState, kind: 'temporary' | 'rest'): void {
  state.phase = 'cruising'; state.navigation = null;
  state.parking = { kind, startedAt: state.clockMinutes, endsAt: kind === 'temporary' ? state.clockMinutes + 5 : undefined };
  if (kind === 'rest') withdrawOffer(state);
  addLog(state, 'parking', kind === 'temporary' ? '臨停最多五分鐘；可隨時開車或接單' : '停車休息並暫停接單；遊戲時間繼續');
}
function park(state: GameState, kind: 'temporary' | 'rest', graph: RoadGraph): GameState {
  if (state.phase !== 'cruising' || state.activeTrip || state.navigation) return state;
  const next = cloneState(state);
  next.cruiseTarget=undefined;next.movement.nextEdgeIds=[];extendItinerary(next.movement,graph);
  if (isSafeStoppingEdge(graph.edges[next.movement.edgeId])) beginParking(next, kind);
  else {
    const safe = safeStopRoute(next, graph); if (!safe) return state;
    next.navigation = { kind: 'parking', target: safe.target, stage: 'routing', parkingKind: kind }; next.phase = 'service-route'; next.movement.nextEdgeIds = safe.route; withdrawOffer(next);
    addLog(next, 'parking', '先離開隧道／快速路，前往安全停車點');
  }
  return next;
}
export function parkTemporarily(state: GameState, graph?: RoadGraph): GameState { return park(state, 'temporary', getVehicleGraph(state.vehicleId, graph)); }
export function parkForRest(state: GameState, graph?: RoadGraph): GameState {
  if(state.phase!=='cruising'||state.activeTrip||state.queuedTrip||state.navigation||state.energyRecovery||state.deadlineSettlement||state.parking?.kind==='rest'||state.clockMinutes>=getShiftDurationMinutes(state))return state;
  graph=getVehicleGraph(state.vehicleId,graph);
  const range=state.energy.remaining/energyProfileFor(state.vehicleId).consumptionPerKm*1000;
  const plan=findRestParking(state,graph,range);
  const next=cloneState(state);
  if(!plan){addLog(next,'parking','附近沒有可安全駛入的長停泊位，請繼續行車後再試');return next;}
  next.parking=null;next.cruiseTarget=undefined;next.phase='service-route';next.movement.nextEdgeIds=plan.route;next.movement.committedEdgeCount=0;
  next.navigation={kind:'parking',target:plan.target,stage:plan.alreadyInside?'servicing':'routing',parkingKind:'rest',...(plan.alreadyInside?{endsAt:next.clockMinutes+REST_PARKING_SETTLE_MINUTES}:{})};
  withdrawOffer(next);
  addLog(next,'parking',plan.alreadyInside?`已駛入${plan.target.name}，停定後開始休息`:`前往${plan.target.name}，駛入泊位後休息`);
  return next;
}
export function resumeDriving(state: GameState, graph?: RoadGraph): GameState {
  if(state.airportQueue||state.navigation?.kind==='airport')return leaveAirportQueue(state,graph);
  if(state.phase==='servicing'&&state.navigation?.kind==='charge')return cancelCharging(state,graph);
  if(state.phase==='servicing')return state.navigation?.handoverAfterService?cancelHandover(state,graph):state;
  if (state.phase === 'ended' || state.phase === 'safe-dropoff' || !state.parking && !state.navigation&&!state.cruiseTarget) return state;
  const next = cloneState(state); next.parking = null;
  if(next.navigation?.kind==='handover'||next.navigation?.handoverAfterService)next.handoverIntent='cancelled';
  if(next.cruiseTarget){next.cruiseTarget=undefined;next.movement.nextEdgeIds=[];}
  if (next.navigation) { next.navigation = null;next.fuelQueue=null; next.phase = 'cruising'; next.movement.nextEdgeIds = []; }
  if(next.deadlineSettlement){next.handoverIntent='cancelled';finishShift(next,'fuel-cancelled-late');return next;}
  extendItinerary(next.movement, getVehicleGraph(next.vehicleId, graph)); addLog(next, 'parking', '繼續行駛'); return next;
}
/** Cancel handover intent without abandoning an existing queue or interrupting fuel service. */
export function cancelHandover(state:GameState,graph?:RoadGraph):GameState {
  if(state.phase==='ended'||state.navigation?.kind!=='handover'&&!state.navigation?.handoverAfterService&&state.handoverIntent!=='requested')return state;
  const next=cloneState(state);next.handoverIntent='cancelled';
  if(next.navigation?.kind==='handover'){
    next.navigation=null;next.phase='cruising';next.movement.nextEdgeIds=[];next.movement.committedEdgeCount=0;
    extendItinerary(next.movement,getVehicleGraph(next.vehicleId,graph));
  }else if(next.navigation)next.navigation.handoverAfterService=false;
  addLog(next,'shift','已取消交更安排；現有補給及乘客行程保持不變');return next;
}
export function getEnergyServiceEstimate(state: GameState, station?: EnergyStation): { units: number; cost: number; minutes: number } {
  const profile = energyProfileFor(state.vehicleId);
  const target = station || (state.navigation && ['refuel','swap','charge'].includes(state.navigation.kind) ? state.navigation.target as EnergyStation : undefined);
  if(profile.kind==='charge'){
    const option=target?selectChargingOption(profile,target,state.vehicleId):null;
    const session=state.chargingSession&&state.chargingSession.stationId===target?.id?state.chargingSession:null;
    const targetKWh=session?.targetKWh??state.energy.capacity*(state.navigation?.target.id===target?.id?state.navigation?.chargeTargetFraction??1:1);
    const units=Math.max(0,targetKWh-state.energy.remaining),price=state.energy.unitPriceOverride??session?.unitPrice??option?.unitPrice??target?.unitPrice??profile.unitPrice;
    return{units,cost:roundMoney(units/CHARGING_GAME_MODEL.efficiency*price),minutes:chargingMinutes(state.energy.capacity,state.energy.remaining,targetKWh,session?.powerKw??option?.powerKw??0)};
  }
  const units = Math.max(0, state.energy.capacity - state.energy.remaining);
  return { units, cost: roundMoney(units * (state.energy.unitPriceOverride ?? target?.unitPrice ?? profile.unitPrice)), minutes: target?.serviceMinutes ?? profile.serviceMinutes ?? (profile.kind === 'swap' ? 3 : 5) };
}
/** Compatibility for installed 0.4 clients: no new queue phase or queued-order UI. */
export function configureLegacyGameRules(state:GameState):GameState {
  if(state.fuelQueueMode==='legacy'&&state.nextTripEnabled===false)return state;
  return {...state,fuelQueueMode:'legacy',nextTripEnabled:false,dispatchManaged:false};
}
export function configureSharedFuelQueues(state:GameState,ownerId?:string):GameState {
  if(state.fuelQueueMode==='shared'&&(!ownerId||state.fuelQueueOwnerId===ownerId))return state;
  return {...state,fuelQueueMode:'shared',fuelQueueOwnerId:ownerId||state.fuelQueueOwnerId};
}
export function applyFuelQueueAssignment(state:GameState,assignment:FuelQueueAssignment):GameState {
  if(!state.fuelQueue||state.fuelQueue.stationId!==assignment.stationId||state.phase==='ended'||state.fuelQueue.id!==assignment.id||Math.abs(state.fuelQueue.joinedAt-assignment.joinedAt)>EPSILON||!Number.isFinite(assignment.serviceStartsAt)||!Number.isFinite(assignment.serviceEndsAt)||assignment.serviceEndsAt<assignment.serviceStartsAt)return state;
  const next=cloneState(state);next.fuelQueue={...next.fuelQueue!,...assignment,assignmentPending:false};return next;
}
function beginFuelQueue(state:GameState,graph:RoadGraph):void {
  const navigation=state.navigation;if(!navigation||state.fuelQueue||!navigation.queueApproach)return;
  const station=navigation.target as EnergyStation;const metrics=navigation.queueApproach.length?remainingRouteMetrics(state,graph):{distanceM:0,minutes:0};
  const baseline=fuelQueueBaseline(station,state.startTimeMinutes+state.clockMinutes);
  const estimate=getEnergyServiceEstimate(state,station);
  const approachTravel=metrics.distanceM/(FUEL_QUEUE_CREEP_KPH*1000/60);
  const wait=Math.max(baseline.waitMinutes,approachTravel);
  state.fuelQueue={id:`fuel-${state.fuelQueueOwnerId||state.driverSessionId||state.seed}-${station.id}-${state.clockMinutes.toFixed(6)}`,stationId:station.id,joinedAt:state.clockMinutes,serviceStartsAt:state.clockMinutes+wait,serviceEndsAt:state.clockMinutes+wait+estimate.minutes,aheadCount:baseline.aheadCount,backgroundAheadCount:baseline.aheadCount,approachEdgeIds:[...navigation.queueApproach],distanceToStationM:metrics.distanceM,connectorDistanceM:navigation.queueConnectorDistanceM,connectorMinutes:navigation.queueConnectorMinutes,metresPerWaitMinute:Math.min(7/FUEL_QUEUE_HEADWAY_MINUTES,Math.max(1,routeLength(navigation.queueApproach,graph)-(navigation.queueConnectorDistanceM||0))/Math.max(40,baseline.waitMinutes+7*estimate.minutes+4)),shared:state.fuelQueueMode==='shared',assignmentPending:state.fuelQueueMode==='shared'};
  state.phase='fuel-queue';
  addLog(state,'energy',`${station.name} · 加入入氣隊列，前方約${baseline.aheadCount}架車，預計等候${Math.ceil(wait)}分鐘`);
}
function beginEnergyService(state: GameState): void {
  const estimate = getEnergyServiceEstimate(state);
  if(state.navigation?.kind==='charge'){
    const option=selectChargingOption(energyProfileFor(state.vehicleId),state.navigation.target as EnergyStation,state.vehicleId);
    if(!option||!Number.isFinite(estimate.minutes))return;
    state.chargingSession={stationId:state.navigation.target.id,startedAt:state.clockMinutes,lastUpdatedAt:state.clockMinutes,initialRemainingKWh:state.energy.remaining,deliveredKWh:0,gridKWh:0,billedCost:0,unitPrice:state.energy.unitPriceOverride??option.unitPrice??(state.navigation.target as EnergyStation).unitPrice??energyProfileFor(state.vehicleId).unitPrice,targetKWh:state.energy.capacity*(state.navigation.chargeTargetFraction??1),powerKw:option.powerKw,connector:option.connector};
  }
  withdrawOffer(state);
  state.phase = 'servicing'; state.navigation!.stage = 'servicing'; state.navigation!.endsAt = state.fuelQueue?Math.max(state.clockMinutes+Math.max(.05,estimate.minutes),state.fuelQueue.serviceEndsAt):state.clockMinutes + Math.max(.05, estimate.minutes);
  addLog(state, 'energy', `${state.navigation!.target.name} · ${state.energy.kind === 'charge' ? '充電' : state.energy.kind === 'swap' ? '換電' : '補充燃料'}中`);
}
function advanceCharging(state:GameState,until:number):void {
  const session=state.chargingSession;if(!session||state.navigation?.kind!=='charge'||state.navigation.stage!=='servicing')return;
  const elapsed=Math.max(0,until-session.lastUpdatedAt);if(elapsed<=0)return;
  const delivery=chargeAfterMinutes(state.energy.capacity,state.energy.remaining,session.targetKWh,session.powerKw,elapsed);
  const cost=delivery.gridKWh*session.unitPrice;
  session.lastUpdatedAt=until;session.deliveredKWh+=delivery.deliveredKWh;session.gridKWh+=delivery.gridKWh;session.billedCost+=cost;
  state.energy.remaining=delivery.remaining;state.energy.prepaidRemaining=Math.min(state.energy.remaining,(state.energy.prepaidRemaining??0)+delivery.deliveredKWh);
  state.energy.costAdded+=cost;state.operatingCost+=cost;state.energy.lowWarningShown=false;state.energy.emptyWarningShown=false;
}
function keepChargeReceipt(state:GameState,completed:boolean):void {
  const session=state.chargingSession;if(!session)return;
  state.lastChargeReceipt={stationId:session.stationId,stationName:state.navigation?.target.name||session.stationId,endedAt:state.clockMinutes,deliveredKWh:session.deliveredKWh,gridKWh:session.gridKWh,billedCost:roundMoney(session.billedCost),completed};
  state.chargingSession=null;
}
/** An explicit unplug keeps every delivered kWh and its already-booked charge. */
export function cancelCharging(state:GameState,graph?:RoadGraph):GameState {
  if(state.phase==='ended'||state.navigation?.kind!=='charge'||state.navigation.stage!=='servicing'||!state.chargingSession)return state;
  const next=cloneState(state);keepChargeReceipt(next,false);next.handoverIntent=next.navigation?.handoverAfterService?'cancelled':next.handoverIntent;
  next.navigation=null;next.fuelQueue=null;next.phase='cruising';next.movement.nextEdgeIds=[];next.movement.committedEdgeCount=0;
  addLog(next,'energy',`已停止充電 · 保留 ${next.lastChargeReceipt!.deliveredKWh.toFixed(1)} kWh，已付 $${next.lastChargeReceipt!.billedCost.toFixed(2)}`);
  if(next.deadlineSettlement)finishShift(next,'fuel-cancelled-late');else{extendItinerary(next.movement,getVehicleGraph(next.vehicleId,graph));updateBalance(next);}
  return next;
}
function arriveNavigation(state: GameState, graph: RoadGraph): void {
  const navigation = state.navigation; if (!navigation) return;
  if (navigation.kind === 'safe-dropoff') { navigation.stage = 'servicing'; navigation.endsAt = state.clockMinutes + .4; addLog(state, 'cancel', '已在安全位置停車，等候乘客落車'); }
  else if (navigation.kind === 'handover') {
    if(state.energy.remaining+EPSILON<requiredHandoverEnergy(state,graph)){
      state.navigation=null;state.phase='cruising';
      addLog(state,'shift','交更前需要補充能源，現在前往補給站');
      const returning=navigateToHandover(state,graph);if(returning!==state)Object.assign(state,returning);else extendItinerary(state.movement,graph);
    }else {state.handoverStatus=state.clockMinutes<=getShiftDurationMinutes(state)+EPSILON?'on-time':'missed';state.handoverFailureReason=state.handoverStatus==='missed'?'deadline':undefined;finishShift(state);}
  }
  else if(navigation.kind==='airport'){
    const join=navigation.joinAirportQueue;
    state.navigation=null;state.movement.nextEdgeIds=[];
    if(join&&state.acceptingOrders&&!state.currentOffer&&state.platform.suspendedUntil<=state.clockMinutes&&atAirportWaitingPoint(state,graph)){
      state.airportQueue=newAirportQueueTicket(state);state.airportJoinCounter=(state.airportJoinCounter??0)+1;state.phase='airport-queue';state.parking=null;
      addLog(state,'wait',state.airportQueue.priority?'已到機場遊戲輪候入口 · 加入鑽石優先隊列':'已到機場遊戲輪候入口 · 按到達次序輪候');
    }else{state.phase='cruising';state.parking={kind:'temporary',startedAt:state.clockMinutes,endsAt:state.clockMinutes+5};addLog(state,'route','已到機場遊戲入口，可選擇加入隊列；暫停接單時不會自動入隊');}
  }
  else if (navigation.kind === 'parking') {if(navigation.parkingKind==='rest'){navigation.stage='servicing';navigation.endsAt=state.clockMinutes+REST_PARKING_SETTLE_MINUTES;addLog(state,'parking',`已駛入${navigation.target.name}，停定後開始休息`);}else beginParking(state,'temporary');}
  else {if(state.fuelQueue&&(state.fuelQueue.assignmentPending||state.fuelQueue.serviceStartsAt>state.clockMinutes+EPSILON))state.phase='fuel-queue';else beginEnergyService(state);}
}
function navigate(state: GameState, target: Landmark | EnergyStation, kind: 'refuel' | 'swap' | 'charge' | 'handover', graph: RoadGraph): GameState {
  if (state.activeTrip || state.queuedTrip || state.phase === 'ended' || state.phase === 'servicing' || !target.nodeId || !graph.outgoing[target.nodeId]?.length || !isCoordinateAllowed(target, state.vehicleId)) return state;
  const current = graph.edges[state.movement.edgeId];
  let atTarget = state.movement.distanceOnEdgeM <= EPSILON && current.from === target.nodeId || state.movement.distanceOnEdgeM >= current.lengthM-EPSILON && current.to===target.nodeId;
  const approachDetails=state.fuelQueueMode!=='legacy'&&kind==='refuel'&&(target as EnergyStation).kind==='lpg'?stationQueueApproachDetails(target as EnergyStation,graph):undefined;
  let approach=approachDetails?.edgeIds||[];
  if(atTarget&&approach.length)atTarget=false;
  let route = atTarget ? [] : findRoute(current.to, target.nodeId, graph);
  if (!route) return state;
  const atQueueEntry=approach.length>0&&state.movement.distanceOnEdgeM<=EPSILON&&current.from===graph.edges[approach[0]].from;
  if(!atTarget&&approach.length){
    if(atQueueEntry)route=approach.slice(1);
    else {const entry=graph.edges[approach[0]].from;const entryRoute=findRoute(current.to,entry,graph);if(entryRoute)route=[...entryRoute,...approach];else approach=[];}
  }
  const next = cloneState(state); next.parking = null;next.cruiseTarget=undefined;next.fuelQueue=null;next.airportQueue=null;
  next.navigation = { kind, target, stage: 'routing',queueApproach:approach.length?approach:undefined,queueConnectorDistanceM:approachDetails?.connectorDistanceM,queueConnectorMinutes:approachDetails?.connectorMinutes }; next.phase = 'service-route'; next.movement.nextEdgeIds = route;next.movement.committedEdgeCount=0;
  addLog(next, kind === 'handover' ? 'shift' : 'energy', `前往${target.name}`);
  if(atTarget&&state.fuelQueueMode!=='legacy'&&kind==='refuel'&&(target as EnergyStation).kind==='lpg'&&fuelQueueBaseline(target as EnergyStation,next.startTimeMinutes+next.clockMinutes).waitMinutes>0){next.navigation.queueApproach=[];beginFuelQueue(next,graph);}
  else if (atTarget) arriveNavigation(next, graph);
  else if(atQueueEntry&&approach.length){next.movement.edgeId=approach[0];next.movement.distanceOnEdgeM=0;beginFuelQueue(next,graph);}
  return next;
}
export function navigateToStation(state: GameState, station: EnergyStation, graph?: RoadGraph): GameState {
  if (station.kind !== state.energy.kind||state.clockMinutes>=getShiftDurationMinutes(state)&&!state.deadlineSettlement) return state;
  if(station.kind==='charge'&&!selectChargingOption(energyProfileFor(state.vehicleId),station,state.vehicleId))return state;
  if(state.navigation?.target.id===station.id&&['refuel','swap','charge'].includes(state.navigation.kind)&&(state.fuelQueue||state.navigation.stage==='servicing'))return state.navigation.handoverAfterService?cancelHandover(state,graph):state;
  if(state.deadlineSettlement)return state;
  const next=navigate(state, station, station.kind === 'charge' ? 'charge' : station.kind === 'swap' ? 'swap' : 'refuel', getVehicleGraph(state.vehicleId, graph));
  if(next!==state&&(state.handoverIntent==='requested'||state.navigation?.kind==='handover'||state.navigation?.handoverAfterService))next.handoverIntent='cancelled';
  return next;
}
/** Start a directed journey; optional queue admission happens only at the actual waiting proxy. */
export function navigateToAirport(state:GameState,joinQueue=false,graph?:RoadGraph):GameState {
  if(!canNavigateToAirport(state))return state;
  graph=getVehicleGraph(state.vehicleId,graph);const plan=airportJourney(state,graph);if(!plan)return state;
  const next=cloneState(state);next.parking=null;next.cruiseTarget=undefined;next.fuelQueue=null;next.airportQueue=null;next.phase='service-route';
  next.navigation={kind:'airport',target:plan.target,stage:'routing',joinAirportQueue:joinQueue};next.movement.nextEdgeIds=plan.route;next.movement.committedEdgeCount=0;
  addLog(next,'route',joinQueue?'前往機場遊戲輪候入口，抵達後先取得輪候票':'前往機場遊戲入口；未加入隊列');
  if(atAirportWaitingPoint(next,graph))arriveNavigation(next,graph);
  return next;
}
export function leaveAirportQueue(state:GameState,graph?:RoadGraph):GameState {
  if(state.phase==='ended'||!state.airportQueue&&state.navigation?.kind!=='airport'&&state.phase!=='airport-queue')return state;
  if(state.phase!=='airport-queue'&&state.navigation?.kind!=='airport')return{...state,airportQueue:null};
  const next=cloneState(state);next.airportQueue=null;next.navigation=null;next.parking=null;next.phase='cruising';next.movement.nextEdgeIds=[];next.movement.committedEdgeCount=0;
  extendItinerary(next.movement,getVehicleGraph(next.vehicleId,graph));addLog(next,'route','已離開機場隊列，繼續巡遊');return next;
}
export function applyAirportAction(state:GameState,choice:'go'|'join'|'leave',graph?:RoadGraph):GameState {
  return choice==='leave'?leaveAirportQueue(state,graph):navigateToAirport(state,choice==='join',graph);
}
export function navigateToHandover(state: GameState, graph?: RoadGraph): GameState {
  graph=getVehicleGraph(state.vehicleId,graph);if(!state.handoverPlace||state.activeTrip||state.queuedTrip||state.phase==='ended'||state.deadlineSettlement||state.clockMinutes>=getShiftDurationMinutes(state))return state;
  if(state.fuelQueueMode!=='legacy'&&state.navigation&&['refuel','swap','charge'].includes(state.navigation.kind)){
    if(state.navigation.handoverAfterService)return state;
    const next=cloneState(state);next.navigation!.handoverAfterService=true;next.handoverIntent='requested';
    addLog(next,'shift','保留現有補給次序，完成後自動前往交更點');return next;
  }
  if(state.phase==='servicing')return state;
  const plan=getHandoverPlan(state,graph);
  if(plan.needsRefuel){
    if(!plan.refuelStation){const next=cloneState(state);addLog(next,'shift','找不到可通行的交更前補給站，未能完成交更');return next;}
    const next=navigateToStation(state,plan.refuelStation,graph);if(next===state)return state;
    next.navigation!.handoverAfterService=true;next.handoverIntent='requested';
    addLog(next,'shift','先補充能源，再自動前往交更點');return next;
  }
  const next=navigate(state,state.handoverPlace,'handover',graph);if(next!==state)next.handoverIntent='requested';return next;
}
export function startEnergyService(state: GameState, graph?: RoadGraph): GameState {
  if (!state.navigation || !['refuel','swap','charge'].includes(state.navigation.kind) || state.phase !== 'service-route') return state;
  graph = getVehicleGraph(state.vehicleId, graph);
  const node = graph.nodes[state.navigation.target.nodeId!];
  if (!node || flatDistanceM(getVehiclePosition(state, graph), node) > 1) return state;
  if(state.fuelQueue&&(state.fuelQueue.assignmentPending||state.fuelQueue.serviceStartsAt>state.clockMinutes+EPSILON))return state;
  const next = cloneState(state); beginEnergyService(next); return next;
}
/** Explicit game recovery: no teleport, thirty minutes, $250 fee, add 20% energy. */
export function requestEnergyRecovery(state: GameState): GameState {
  if (state.phase === 'ended' || state.phase === 'servicing' || state.phase === 'alighting' || state.energyRecovery || state.energy.remaining / state.energy.capacity > .10) return state;
  const next = cloneState(state.airportQueue||state.navigation?.kind==='airport'?leaveAirportQueue(state):state); next.energyRecovery = { endsAt: next.clockMinutes + 30, previousPhase: next.phase }; next.phase = 'servicing';
  withdrawOffer(next); next.operatingCost += 250; updateBalance(next);
  addLog(next, 'energy', '遊戲救援已召喚：原地等候30分鐘，服務費 $250，補充20%能量'); return next;
}
export function normalizeGameState(saved: unknown, graph: RoadGraph = ROAD_GRAPH): GameState | null {
  if (!saved || typeof saved !== 'object') return null;
  const old = saved as GameState;
  if (![2,3].includes(old.version) || !VEHICLE_BY_ID[old.vehicleId] || !old.movement || !Number.isFinite(old.clockMinutes)) return null;
  graph = getVehicleGraph(old.vehicleId, graph);
  if (!graph.edges[old.movement.edgeId] || !Array.isArray(old.movement.nextEdgeIds)) return null;
  const landmarks = prepareLandmarks(old.landmarks?.length ? old.landmarks : LANDMARKS, graph, old.vehicleId);
  const platform = { ...initialPlatformStats(), ...old.platform };
  platform.offered = old.platform?.offered ?? old.acceptedOffers + old.declinedOffers + (old.currentOffer ? 1 : 0);
  const next: GameState = { ...old, version: 3, shiftDurationMinutes:getShiftDurationMinutes(old),worldEvent:normalizeWorldEvent(old.worldEvent),xlOrdersEnabled:old.xlOrdersEnabled===true,idleMinutes:Number.isFinite(old.idleMinutes)?Math.max(0,Math.min(old.clockMinutes,old.idleMinutes!)):0, landmarks, acceptingOrders: old.acceptingOrders ?? true, parking: old.parking || null, navigation: old.navigation || null, energy: { ...initialEnergy(old.vehicleId), ...old.energy }, energyRecovery: old.energyRecovery || null, platform, demandCooldownUntil: old.demandCooldownUntil || 0, handoverPlace: old.handoverPlace === null ? null : old.handoverPlace || landmarks.find(place => place.id === old.startPlaceId) || null, handoverReminderShown: old.handoverReminderShown ?? old.clockMinutes >= getShiftDurationMinutes(old)-60, ghost: null, ghostOffer: null, ghostOffers: [], observedOffers: old.observedOffers || [] };
  if (!old.platform) { next.platform.accepted = next.acceptedOffers; next.platform.cancelled = next.cancelledTrips; }
  const restored = cloneState(next);
  restored.advancedRulesVersion=old.advancedRulesVersion===1?1:undefined;
  restored.proPass=restored.advancedRulesVersion===1&&old.proPass?.tier===old.proTier&&typeof old.proPass?.packId==='string'?old.proPass:undefined;
  restored.proDestinationsUsed=restored.advancedRulesVersion===1&&Number.isSafeInteger(old.proDestinationsUsed)?Math.max(0,Math.min(2,old.proDestinationsUsed!)):0;
  restored.proDestination=restored.advancedRulesVersion===1&&old.proDestination&&Number.isFinite(old.proDestination.expiresAt)&&catalogFor(restored.landmarks).byId.has(old.proDestination.placeId)?old.proDestination:undefined;
  restored.proTier=['blue','gold','platinum','diamond'].includes(old.proTier||'')?old.proTier:'blue';
  restored.airportOfferHistory=Array.isArray(old.airportOfferHistory)?old.airportOfferHistory.filter(id=>typeof id==='string'&&id.startsWith('airport-')).slice(-64):[];
  restored.airportJoinCounter=Number.isSafeInteger(old.airportJoinCounter)&&old.airportJoinCounter!>=0?old.airportJoinCounter:0;
  if(!airportEnabled(restored)){restored.airportQueue=null;if(restored.navigation?.kind==='airport'){restored.navigation=null;restored.phase='cruising';}if(restored.phase==='airport-queue')restored.phase='cruising';}
  else if(restored.airportQueue&&(!Number.isFinite(restored.airportQueue.joinedAt)||restored.airportQueue.joinedAt>restored.clockMinutes||!airportQueueStillEligible(restored,graph)))Object.assign(restored,leaveAirportQueue(restored,graph));
  restored.eliteCertified=old.advancedRulesVersion===1&&old.eliteCertified===true;
  restored.orderPreferences=normalizeOrderPreferences(old.orderPreferences,restored.vehicleId,restored.eliteCertified);restored.blindOrders=typeof old.blindOrders==='boolean'?old.blindOrders:undefined;
  restored.eliteReviewedWindows=Array.isArray(old.eliteReviewedWindows)?old.eliteReviewedWindows.filter(value=>Number.isInteger(value)&&value>=0&&value<4):[];
  restored.eliteLastSearchMinute=typeof old.eliteLastSearchMinute==='number'&&Number.isInteger(old.eliteLastSearchMinute)
    &&old.eliteLastSearchMinute>=0&&old.eliteLastSearchMinute<=Math.floor(restored.clockMinutes+EPSILON)?old.eliteLastSearchMinute:undefined;
  restored.eliteReservations=restored.eliteCertified&&Array.isArray(old.eliteReservations)?old.eliteReservations.filter(booking=>booking&&typeof booking.id==='string'&&booking.offer?.id===booking.id&&booking.offer.eliteBookingId===booking.id&&booking.offer.serviceType==='elite'&&[booking.announcedAt,booking.pickupAt,booking.respondBy,booking.graceEndsAt].every(Number.isFinite)&&isPlaceAllowed(booking.offer.pickup,restored.vehicleId,graph)&&isPlaceAllowed(booking.offer.destination,restored.vehicleId,graph)).slice(0,4).map(booking=>({...booking})):[];
  restored.energy.prepaidRemaining=Math.max(0,Math.min(restored.energy.remaining,Number.isFinite(old.energy?.prepaidRemaining)?old.energy.prepaidRemaining!:restored.energy.kind==='charge'?restored.energy.remaining:0));
  if(restored.navigation?.kind==='charge'&&restored.navigation.stage==='servicing'){
    const session=restored.chargingSession;
    if(!session||session.stationId!==restored.navigation.target.id||![session.startedAt,session.lastUpdatedAt,session.deliveredKWh,session.gridKWh,session.billedCost,session.unitPrice,session.targetKWh,session.powerKw].every(Number.isFinite)||session.powerKw<=0||session.unitPrice<0||session.lastUpdatedAt>restored.clockMinutes+EPSILON){
      restored.chargingSession=null;restored.navigation=null;restored.phase='cruising';
    }
  }else restored.chargingSession=null;
  restored.presentedOffers=Number.isFinite(old.presentedOffers)?Math.max(0,old.presentedOffers!):Math.max(platform.offered,old.acceptedOffers+old.declinedOffers);
  restored.handoverStatus=old.handoverStatus||'pending';restored.fuelQueueMode=old.fuelQueueMode||'solo';
  restored.autoAcceptOrders=old.autoAcceptOrders===true;
  restored.handoverIntent=['none','requested','cancelled'].includes(old.handoverIntent||'')?old.handoverIntent:restored.navigation?.kind==='handover'||restored.navigation?.handoverAfterService?'requested':'none';
  restored.nextHandoverReviewMinute=Number.isFinite(old.nextHandoverReviewMinute)?Math.max(restored.clockMinutes,Math.min(old.nextHandoverReviewMinute!,restored.clockMinutes+5)):restored.clockMinutes;
  const pending=old.deadlineSettlement;
  restored.deadlineSettlement=restored.phase!=='ended'&&pending?.kind==='fuel'&&typeof pending.stationId==='string'?{...pending,startedAt:getShiftDurationMinutes(restored),expiresAt:getShiftEndMinute(restored)}:undefined;
  if(restored.deadlineSettlement){restored.handoverStatus='missed';restored.handoverFailureReason='deadline';restored.acceptingOrders=false;}
  if(restored.fuelQueue&&(!restored.navigation||restored.fuelQueue.approachEdgeIds.some(id=>!graph.edges[id]))){restored.fuelQueue=null;if(restored.phase==='fuel-queue')restored.phase='service-route';}
  if(restored.queuedTrip&&(!isPlaceAllowed(restored.queuedTrip.offer.pickup,restored.vehicleId,graph)||!isPlaceAllowed(restored.queuedTrip.offer.destination,restored.vehicleId,graph)))restored.queuedTrip=null;
  if (restored.handoverPlace && !isPlaceAllowed(restored.handoverPlace, restored.vehicleId, graph)) restored.handoverPlace = landmarks.find(place => place.id === restored.startPlaceId) || landmarks[0] || null;
  if (restored.movement.nextEdgeIds.some(id => !graph.edges[id])) {
    const target = restored.navigation?.target || restored.cruiseTarget || (restored.phase === 'pickup' ? restored.activeTrip?.offer.pickup : restored.activeTrip?.offer.destination);
    const route = target?.nodeId ? findRoute(graph.edges[restored.movement.edgeId].to, target.nodeId, graph) : null;
    if (route) restored.movement.nextEdgeIds = route;
    else {
      restored.movement.nextEdgeIds = []; restored.navigation = null; restored.activeTrip = null;restored.cruiseTarget=undefined; restored.phase = 'cruising';
      extendItinerary(restored.movement, graph); addLog(restored, 'route', '已保留更份進度，並按更新的車輛通行規則重設前方路線');
    }
  }
  // Old greedy cruising saves may already contain many legal but repeated laps.
  // Explicit passenger/service/map-target routes retain their exact itinerary.
  if(restored.phase==='cruising'&&!restored.activeTrip&&!restored.navigation&&!restored.cruiseTarget)extendItinerary(restored.movement,graph);
  return restored;
}
export function getPhaseRemainingMinutes(state: GameState): number {
  const endsAt = state.energyRecovery?.endsAt ?? (state.phase==='fuel-queue'?state.fuelQueue?.serviceStartsAt:undefined) ?? (state.phase === 'waiting' || state.phase === 'boarding' || state.phase === 'alighting' ? state.activeTrip?.phaseEndsAt : state.navigation?.stage === 'servicing' ? state.navigation.endsAt : state.parking?.endsAt);
  return Math.max(0, (endsAt ?? state.clockMinutes) - state.clockMinutes);
}
export function chooseTripRoute(state: GameState, policy: 'fastest' | 'economy', graph?: RoadGraph): GameState {
  graph = getVehicleGraph(state.vehicleId, graph);
  if (!state.activeTrip || state.phase === 'safe-dropoff' || state.phase === 'alighting') return state;
  const parked = state.phase === 'waiting' || state.phase === 'boarding';
  const target = state.phase === 'pickup' ? state.activeTrip.offer.pickup : state.activeTrip.offer.destination;
  const route = findRoute(parked ? state.activeTrip.offer.pickup.nodeId! : graph.edges[state.movement.edgeId].to, target.nodeId!, graph, policy);
  if (!route) return state;
  const next = cloneState(state);
  if (parked && route.length) next.movement = { ...next.movement,edgeId: route[0], distanceOnEdgeM: 0, nextEdgeIds: route.slice(1),committedEdgeCount:0 }; else next.movement.nextEdgeIds = route;
  next.activeTrip!.routePolicy = policy; addLog(next, 'route', `${policy === 'economy' ? '較短' : '較快'}路線 · ${next.activeTrip!.offer.pricingType === 'taxi-metered' || next.activeTrip!.offer.pricingType === 'taxi-discount85' ? '咪錶按實際載客距離' : '預報合約價維持不變'}`); return next;
}
function routeEventAlternative(state:GameState,graph:RoadGraph):string[]|null {
  const event=state.routeEvent;if(!event||event.expiresAt<=state.clockMinutes||event.affectedEdgeId===state.movement.edgeId||state.phase==='fuel-queue'||state.phase==='servicing'||state.phase==='alighting'||state.phase==='waiting'||state.phase==='boarding')return null;
  if((event.kind==='cattle'||event.kind==='dog')&&event.blockingUntil===undefined)return null;
  const ids=state.movement.nextEdgeIds;const affectedIndex=ids.indexOf(event.affectedEdgeId);if(affectedIndex<0)return null;
  const target=state.navigation?.target||state.cruiseTarget||(state.activeTrip?(state.phase==='pickup'?state.activeTrip.offer.pickup:state.activeTrip.offer.destination):undefined);
  const to=target?.nodeId||graph.edges[ids[Math.min(ids.length-1,affectedIndex+3)]]?.to;if(!to)return null;
  const route=findRoute(graph.edges[state.movement.edgeId].to,to,graph,state.activeTrip?.routePolicy||'fastest',event.affectedEdgeId);
  if(route&&event.blockingUntil!==undefined){const physical=event.affectedEdgeId.replace(/-(?:f|r)$/,'');if(route.some(id=>id.replace(/-(?:f|r)$/,'')===physical))return null;}
  return route&&!route.includes(event.affectedEdgeId)?route:null;
}
export function getRouteEventOptions(state:GameState,graph?:RoadGraph):{stay:true;reroute:boolean} {
  return {stay:true,reroute:!!routeEventAlternative(state,getVehicleGraph(state.vehicleId,graph))};
}
export function resolveRouteEvent(state: GameState, choice: 'stay' | 'reroute', graph?: RoadGraph): GameState {
  graph=getVehicleGraph(state.vehicleId,graph);if(!state.routeEvent||state.routeEvent.resolved)return state;
  const route=choice==='reroute'?routeEventAlternative(state,graph):null;
  const next=cloneState(state);next.routeEvent!.rerouteAvailable=!!route;
  if(choice==='reroute'&&!route){addLog(next,'event','目前沒有可避開受影響路段的合法改道，保留原線');return next;}
  next.routeEvent!.resolved=true;next.routeEvent!.choice=choice;
  if(route){next.movement.nextEdgeIds=route;next.movement.committedEdgeCount=route.length;}
  addLog(next,'event',choice==='stay'?(next.routeEvent?.blockingUntil?'保留原線，等前方路面安全後通過':'保留原線，經過受影響路段時會減速'):'已改道，避開受影響路段');return next;
}
function movementSpeed(movement: Movement, state: GameState, graph: RoadGraph): number {
  const edge = graph.edges[movement.edgeId];const parkingApproach=state.navigation?.kind==='parking'&&state.navigation.parkingKind==='rest'&&movement.nextEdgeIds.length===0;
  const speed=parkingApproach?Math.min(speedKph(edge),6+18*Math.min(1,Math.max(0,edge.lengthM-movement.distanceOnEdgeM)/60)):speedKph(edge);
  return speed * 1000 / 60 * getDrivingSpeedFactor(state) * getTrafficConditions(state,pointOnEdge(edge,state.movement.distanceOnEdgeM/edge.lengthM,graph)).speedFactor * routeEventSpeedFactor(state.routeEvent,edge.id,state.clockMinutes);
}
function processServiceTransitions(state: GameState, graph: RoadGraph): void {
  if(state.phase==='fuel-queue'&&state.fuelQueue&&!state.fuelQueue.assignmentPending&&state.fuelQueue.serviceStartsAt<=state.clockMinutes+EPSILON&&(!state.fuelQueue.approachEdgeIds.length||remainingRouteMetrics(state,graph).distanceM<=EPSILON))beginEnergyService(state);
  if (state.energyRecovery) {
    if (state.energyRecovery.endsAt > state.clockMinutes + EPSILON) return;
    const units = Math.min(state.energy.capacity - state.energy.remaining, state.energy.capacity * .2);
    const total = state.energy.remaining + units;
    const unpaid=Math.max(0,state.energy.remaining-(state.energy.prepaidRemaining??0));
    state.energy.unitPricePaid = (unpaid * state.energy.unitPricePaid + units * (state.energy.unitPriceOverride ?? energyProfileFor(state.vehicleId).unitPrice)) / Math.max(EPSILON,unpaid+units);
    state.energy.remaining = total; state.energy.emptyWarningShown = false;
    if(state.energy.kind==='charge')state.energy.prepaidRemaining=total; // The fixed-price game rescue supplies this energy.
    state.phase = state.energyRecovery.previousPhase; state.energyRecovery = null; addLog(state, 'energy', '遊戲救援完成，可繼續行駛');
    if(!state.activeTrip&&state.queuedTrip)activateQueuedTrip(state,graph);
  }
  if (state.navigation?.stage === 'servicing' && state.navigation.endsAt !== undefined && state.navigation.endsAt <= state.clockMinutes + EPSILON) {
    if (state.navigation.kind === 'safe-dropoff') { finishCancellation(state, graph); addLog(state, 'cancel', '乘客已落車，取消完成'); }
    else if(state.navigation.kind==='parking')beginParking(state,state.navigation.parkingKind||'temporary');
    else if(state.navigation.kind==='charge'){
      const returnAfterService=state.navigation.handoverAfterService;
      keepChargeReceipt(state,true);
      addLog(state,'energy',`充電完成 · ${state.lastChargeReceipt?.deliveredKWh.toFixed(1)??'0.0'} kWh，已付 $${state.lastChargeReceipt?.billedCost.toFixed(2)??'0.00'}`);
      state.navigation=null;state.phase='cruising';state.movement.nextEdgeIds=[];extendItinerary(state.movement,graph);
      if(state.deadlineSettlement){finishShift(state,'fuel-completed-late');return;}
      if(returnAfterService)Object.assign(state,navigateToHandover(state,graph));
    }
    else {
      const estimate = getEnergyServiceEstimate(state);
      const target = state.navigation.target as EnergyStation;
      const price = state.energy.unitPriceOverride ?? target.unitPrice ?? energyProfileFor(state.vehicleId).unitPrice;
      state.energy.unitPricePaid = (state.energy.remaining * state.energy.unitPricePaid + estimate.units * price) / state.energy.capacity;
      state.energy.remaining = state.energy.capacity;
      state.energy.lowWarningShown = false; state.energy.emptyWarningShown = false;
      addLog(state, 'energy', `補充完成 · ${estimate.units.toFixed(1)} ${state.energy.kind === 'swap' ? 'kWh' : 'L'}，參考補充金額 $${estimate.cost}（耗用成本已入帳，不重複扣）`);
      const returnAfterService=state.navigation.handoverAfterService;
      state.navigation = null;state.fuelQueue=null; state.phase = 'cruising'; state.movement.nextEdgeIds = []; extendItinerary(state.movement, graph);
      if(state.deadlineSettlement){addLog(state,'shift','現有補給已完成，按逾時交更收更');finishShift(state,'fuel-completed-late');return;}
      if(returnAfterService)Object.assign(state,navigateToHandover(state,graph));
    }
  }
  const trip = state.activeTrip;
  if (!trip || trip.phaseEndsAt === undefined || trip.phaseEndsAt > state.clockMinutes + EPSILON) return;
  if (state.phase === 'waiting') { state.phase = 'boarding'; trip.phaseEndsAt += trip.boardingMinutes; addLog(state, 'wait', `${trip.offer.pickup.name} · 乘客上車中`); }
  else if (state.phase === 'boarding') { state.phase = 'dropoff'; trip.pickedUpAt = state.clockMinutes; trip.phaseEndsAt = undefined; const booking=state.eliteReservations?.find(item=>item.id===trip.offer.eliteBookingId);if(booking)booking.status='in-trip';addLog(state, 'pickup', `${trip.offer.pickup.name} · 乘客已上車`); }
  else if (state.phase === 'alighting') completeTrip(state, graph);
}
function beginAlighting(state:GameState):void {
  const trip=state.activeTrip!;
  state.phase='alighting';trip.phaseEndsAt=state.clockMinutes+(10+random(state.seed,hash(trip.offer.id),507)*10)/60;
  addLog(state,'wait',`${trip.offer.destination.name} · 已停車，乘客落車中`);
}
function completeTrip(state: GameState, graph:RoadGraph): void {
  const trip = state.activeTrip!;
  if (trip.offer.pricingType === 'taxi-metered' || trip.offer.pricingType === 'taxi-discount85') trip.fareOnCompletion = estimateDriverPayout(VEHICLE_BY_ID[state.vehicleId], trip.paidDistanceM, 0, 1, trip.offer.pricingType);
  state.grossIncome = roundMoney(state.grossIncome + trip.fareOnCompletion); state.completedTrips += 1;
  const booking=state.eliteReservations?.find(item=>item.id===trip.offer.eliteBookingId);if(booking){booking.status='completed';booking.finishedAt=state.clockMinutes;}
  addLog(state, 'dropoff', `${trip.offer.destination.name} · 完成行程`, trip.fareOnCompletion);
  state.activeTrip = null; state.phase = 'cruising'; stopGhost(state); updateBalance(state);
  state.demandCooldownUntil = state.clockMinutes + .5 + random(state.seed, state.completedTrips, 407);
  if(state.currentOffer?.reservation==='next-trip')state.currentOffer={...state.currentOffer,reservation:undefined};
  activateQueuedTrip(state,graph);
}
function moveActual(state: GameState, minutes: number, graph: RoadGraph): number {
  if (state.phase === 'waiting' || state.phase === 'boarding' || state.phase === 'alighting' || state.phase === 'servicing' || state.phase==='airport-queue' || state.parking || state.navigation?.stage === 'servicing') return minutes;
  if(state.phase==='fuel-queue'&&state.fuelQueue?.assignmentPending)return minutes;
  let remaining = minutes;
  const forkDistanceAtStart=state.totalDistanceM;
  const forks=state.phase==='cruising'?getUpcomingBranches(state,graph).map(branch=>({id:branch.junctionNodeId,distanceM:branch.distanceM})):[];
  // The selector commits a branch in the final metre. Keep its slowdown until
  // the car physically crosses, rather than accelerating half a metre early.
  const approaching=state.drivingAssist?.approachingJunctionNodeId;
  const incoming=graph.edges[state.movement.edgeId];
  if(state.phase==='cruising'&&approaching===incoming.to&&!forks.some(fork=>fork.id===approaching))forks.unshift({id:approaching,distanceM:Math.max(0,incoming.lengthM-state.movement.distanceOnEdgeM)});
  for (let guard = 0; remaining > EPSILON && guard < 200; guard += 1) {
    const edge = graph.edges[state.movement.edgeId];
    if(state.phase==='cruising'){
      const travelled=state.totalDistanceM-forkDistanceAtStart;
      const nextFork=forks.find(fork=>fork.distanceM>travelled+EPSILON);
      state.drivingAssist=approachJunction(state.drivingAssist,nextFork?{id:nextFork.id,distanceM:nextFork.distanceM-travelled}:undefined);
    }
    const queue=state.phase==='fuel-queue'?state.fuelQueue:null;
    const queuedRemaining=queue?(queue.approachEdgeIds.length?remainingRouteMetrics(state,graph).distanceM:0):Infinity;
    const targetDistance=queue?queueDistanceTarget(queue.serviceStartsAt-(state.clockMinutes+minutes-remaining),routeLength(queue.approachEdgeIds,graph),queue.connectorDistanceM,queue.connectorMinutes,queue.metresPerWaitMinute):0;
    if(queue){queue.distanceToStationM=queuedRemaining;queue.aheadCount=Math.max(0,Math.ceil((queue.serviceStartsAt-state.clockMinutes)/FUEL_QUEUE_HEADWAY_MINUTES));if(queuedRemaining<=targetDistance+EPSILON)return minutes;}
    const speed = queue?Math.min(movementSpeed(state.movement,state,graph),FUEL_QUEUE_CREEP_KPH*1000/60):movementSpeed(state.movement, state, graph);
    if(speed<=EPSILON)return minutes;
    const profile = energyProfileFor(state.vehicleId);
    const availableDistance = profile.consumptionPerKm > 0 ? state.energy.remaining / profile.consumptionPerKm * 1000 : Infinity;
    const distance = Math.min(Math.max(0, edge.lengthM - state.movement.distanceOnEdgeM), speed * remaining, availableDistance,queue?Math.max(0,queuedRemaining-targetDistance):Infinity);
    if (distance <= EPSILON && state.energy.remaining <= EPSILON) { if (!state.energy.emptyWarningShown) { state.energy.emptyWarningShown = true; addLog(state, 'energy', '能量耗盡，已停止行車；請召喚遊戲救援'); } return minutes; }
    const consumed = distance / 1000 * profile.consumptionPerKm;
    const prepaidUsed=state.energy.remaining>EPSILON?consumed*Math.min(state.energy.remaining,state.energy.prepaidRemaining??0)/state.energy.remaining:0;
    const cost = Math.max(0,consumed-prepaidUsed) * state.energy.unitPricePaid;
    if(state.energy.prepaidRemaining!==undefined)state.energy.prepaidRemaining=Math.max(0,state.energy.prepaidRemaining-prepaidUsed);
    state.energy.remaining = Math.max(0, state.energy.remaining - consumed); state.energy.consumed += consumed; state.energy.costAdded += cost;
    state.movement.distanceOnEdgeM += distance; state.totalDistanceM += distance; state.operatingCost += cost;
    if(queue)queue.distanceToStationM=Math.max(0,queuedRemaining-distance);
    if(state.drivingAssist?.approachDistanceM!==undefined)state.drivingAssist={...state.drivingAssist,approachDistanceM:Math.max(0,state.drivingAssist.approachDistanceM-distance)};
    if (state.activeTrip) state.activeTrip.actualDistanceM += distance;
    if (state.activeTrip && (state.phase === 'dropoff' || state.phase === 'safe-dropoff')) state.activeTrip.paidDistanceM += distance;
    remaining -= distance / speed;
    if (state.movement.distanceOnEdgeM < edge.lengthM - EPSILON) break;
    recordDrivenEdge(state.movement,edge.id);
    if(state.phase==='cruising'&&forks.some(fork=>fork.id===edge.to))state.drivingAssist=crossedJunction(state.drivingAssist,edge.to,state.totalDistanceM);
    if(state.phase==='cruising'&&state.cruiseTarget?.nodeId===edge.to){addLog(state,'route',`已到達${state.cruiseTarget.name}，繼續巡遊`);state.cruiseTarget=undefined;}
    if ((state.activeTrip || state.navigation) && state.movement.nextEdgeIds.length === 0) {
      const used = minutes - remaining;
      const beforeClock = state.clockMinutes; state.clockMinutes += used;
      if (state.navigation) arriveNavigation(state, graph);
      else if (state.phase === 'pickup') beginWaiting(state, graph, state.clockMinutes);
      else beginAlighting(state);
      state.clockMinutes = beforeClock;
      return used;
    }
    if (!state.activeTrip && !state.navigation&&!state.cruiseTarget) extendItinerary(state.movement, graph);
    const next = state.movement.nextEdgeIds.shift();
    if (!next) return minutes;
    state.movement.committedEdgeCount=Math.max(0,(state.movement.committedEdgeCount||0)-1);
    state.movement.edgeId = next; state.movement.distanceOnEdgeM = 0;
    if(state.navigation?.queueApproach?.[0]===next&&!state.fuelQueue){const beforeClock=state.clockMinutes;state.clockMinutes+=minutes-remaining;beginFuelQueue(state,graph);state.clockMinutes=beforeClock;if((state as GameState).fuelQueue?.assignmentPending)return minutes-remaining;}
  }
  return minutes;
}
export function getSummary(state: GameState): GameSummary {
  const score = state.netIncome > 0 ? state.netIncome * getShiftDurationMinutes(state) / Math.max(getShiftDurationMinutes(state), state.clockMinutes) : state.netIncome;
  return { shiftDurationMinutes:getShiftDurationMinutes(state),idleMinutes:state.idleMinutes??0, grossIncome: roundMoney(state.grossIncome), expenses: roundMoney(state.operatingCost + state.rentalCostApplied), netIncome: roundMoney(state.netIncome), score: roundMoney(score), completedTrips: state.completedTrips, overtimeMinutes: Math.max(0, state.clockMinutes - getShiftDurationMinutes(state)), totalDistanceKm: state.totalDistanceM / 1000, cancelledTrips: state.cancelledTrips,handoverFailureReason:state.handoverFailureReason,handoverStatus:state.handoverStatus==='on-time'?'on-time':state.handoverStatus==='missed'?'missed':undefined,shiftEndReason:state.shiftEndReason };
}
function handoverStatusAtDeadline(state:GameState,graph:RoadGraph):'on-time'|'missed' {
  if(state.handoverStatus==='on-time'||!state.handoverPlace)return 'on-time';
  const node=graph.nodes[state.handoverPlace.nodeId!],atPoint=node&&distanceMetres(getVehiclePosition(state,graph),node)<=1;
  const fuelReady=state.energy.remaining+EPSILON>=requiredHandoverEnergy(state,graph);
  if(atPoint&&!fuelReady){state.handoverFailureReason='fuel';return 'missed';}
  if(state.activeTrip||state.queuedTrip||state.energyRecovery||state.navigation&&state.navigation.kind!=='handover'||!atPoint){state.handoverFailureReason='deadline';return 'missed';}
  state.handoverFailureReason=undefined;return 'on-time';
}
export function isShiftSettlementPending(state:GameState):boolean {return state.phase!=='ended'&&!!state.deadlineSettlement;}
function committedFuelAtDeadline(state:GameState):boolean {
  return state.fuelQueueMode!=='legacy'&&!state.activeTrip&&!state.queuedTrip&&!!state.navigation&&['refuel','swap','charge'].includes(state.navigation.kind)&&!!(state.fuelQueue||state.navigation.stage==='servicing');
}
/** Preserve only the already-joined fuel operation, with a finite absolute bound. */
function processShiftDeadline(state:GameState,graph:RoadGraph):boolean {
  if(state.clockMinutes<getShiftDurationMinutes(state)-EPSILON)return false;
  state.clockMinutes=Math.max(getShiftDurationMinutes(state),state.clockMinutes);
  if(!state.deadlineSettlement&&committedFuelAtDeadline(state)){
    state.deadlineSettlement={kind:'fuel',startedAt:getShiftDurationMinutes(state),expiresAt:getShiftEndMinute(state),stationId:state.navigation!.target.id,...(state.fuelQueue?{ticketId:state.fuelQueue.id}:{})};
    state.handoverStatus='missed';state.handoverFailureReason='deadline';state.acceptingOrders=false;withdrawOffer(state);
    addLog(state,'shift','交更限時已到，保留現有補給次序，完成後按逾時交更收更');
  }
  const pending=state.deadlineSettlement;
  if(pending){
    if(state.clockMinutes>=pending.expiresAt-EPSILON){state.clockMinutes=pending.expiresAt;state.handoverFailureReason='fuel';addLog(state,'shift','現有補給超出延後上限，以未完成交更收更');finishShift(state,'fuel-timeout');return true;}
    if(!committedFuelAtDeadline(state)||state.navigation?.target.id!==pending.stationId||pending.ticketId&&state.fuelQueue?.id!==pending.ticketId){finishShift(state,'fuel-cancelled-late');return true;}
    return false;
  }
  state.clockMinutes=state.fuelQueueMode==='legacy'?getShiftDurationMinutes(state):Math.min(getShiftEndMinute(state),state.clockMinutes);
  state.handoverStatus=handoverStatusAtDeadline(state,graph);
  if(state.handoverStatus==='missed')addLog(state,'shift',state.handoverFailureReason==='fuel'?'交更限時已到，能源未補好，未完成交更':'交更限時已到，未能準時返回交更點；未完成行程不計車資');
  finishShift(state,'deadline');return true;
}
function finishShift(state: GameState,reason?:GameState['shiftEndReason']): void {
  state.airportQueue=null;
  for(const booking of state.eliteReservations||[])if(['accepted','travelling','waiting','in-trip'].includes(booking.status)){if(booking.id!==state.activeTrip?.offer.eliteBookingId)state.cancelledTrips+=1;booking.status='cancelled';booking.finishedAt=state.clockMinutes;}
  if(state.chargingSession)keepChargeReceipt(state,false);
  if(state.activeTrip){state.cancelledTrips+=1;state.activeTrip=null;}if(state.queuedTrip){state.cancelledTrips+=1;}
  state.shiftEndReason=reason||(state.handoverStatus==='on-time'?'handover':'deadline');state.deadlineSettlement=undefined;
  state.phase = 'ended';state.fuelQueue=null;state.queuedTrip=null; state.currentOffer = null; state.navigation = null; state.parking = null;state.cruiseTarget=undefined;state.energyRecovery=null; stopGhost(state); updateBalance(state); state.summary = getSummary(state); addLog(state, 'shift', `已收更 · 完成 ${state.completedTrips} 單`, state.netIncome);
}
export function advanceGame(state: GameState, deltaMinutes: number, graph?: RoadGraph): GameState {
  graph = getVehicleGraph(state.vehicleId, graph);
  if (state.phase === 'ended' || !Number.isFinite(deltaMinutes) || deltaMinutes <= 0) return state;
  const next = cloneState(state);
  let remaining = Math.min(deltaMinutes, 1440);
  for (let guard = 0; remaining > EPSILON && next.phase !== 'ended' && guard < 30000; guard += 1) {
    processServiceTransitions(next, graph); processScheduled(next, graph);
    if ((next as GameState).phase === 'ended') break;
    if(processShiftDeadline(next,graph))break;
    const boundaries = [next.nextDemandMinute, next.currentOffer?.expiresAt, next.activeTrip?.phaseEndsAt, next.navigation?.endsAt, next.energyRecovery?.endsAt, next.parking?.endsAt, next.fuelQueue?.assignmentPending?undefined:next.fuelQueue?.serviceStartsAt, next.fuelQueue?.assignmentPending?undefined:next.fuelQueue?next.fuelQueue.serviceStartsAt-(next.fuelQueue.connectorMinutes||0):undefined, next.nextEventMinute,next.nextHandoverReviewMinute,next.routeEvent?.blockingStartsAt,next.routeEvent?.blockingUntil,next.routeEvent?.expiresAt, next.clockMinutes < getShiftDurationMinutes(next) ? getShiftDurationMinutes(next) : undefined,next.deadlineSettlement?.expiresAt].filter((value): value is number => value !== undefined && value > next.clockMinutes + EPSILON);
    const step = Math.min(remaining, 0.25, boundaries.length ? Math.min(...boundaries) - next.clockMinutes : Infinity);
    const beforePhase = next.phase;
    const emptyCruising=(next.phase==='cruising'||next.phase==='airport-queue')&&!next.activeTrip&&!next.navigation&&!next.energyRecovery;
    const used = moveActual(next, step, graph);
    if(emptyCruising)next.idleMinutes=(next.idleMinutes??0)+used;
    advanceCharging(next,next.clockMinutes+used);
    next.clockMinutes += used; remaining -= used; updateBalance(next);
    if (used <= EPSILON && beforePhase === next.phase) break;
  }
  processServiceTransitions(next, graph); processScheduled(next, graph);
  if(next.phase!=='ended')processShiftDeadline(next,graph);
  return next;
}
/** Shared solo/server schedule adapter. No wall time, bonus, or extra dispatch. */
export function advanceGameWithWorldEvents(state:GameState,deltaMinutes:number,events:readonly WorldEvent[],graph?:RoadGraph):GameState {
  if(state.phase==='ended'||!Number.isFinite(deltaMinutes)||deltaMinutes<=0)return state;
  const schedule=events.slice(0,16).map(normalizeWorldEvent).filter((event):event is WorldEvent=>!!event).sort((a,b)=>a.startsAt-b.startsAt||a.id.localeCompare(b.id));
  const active=(minute:number)=>schedule.find(event=>event.startsAt<=minute&&minute<event.endsAt);
  let next=state,remaining=Math.min(deltaMinutes,1440);
  for(let guard=0;remaining>EPSILON&&next.phase!=='ended'&&guard<40;guard++){
    next=setWorldEvent(next,active(next.clockMinutes));
    const boundaries=schedule.flatMap(event=>[event.startsAt,event.endsAt]).filter(minute=>minute>next.clockMinutes+EPSILON);
    const step=Math.min(remaining,boundaries.length?Math.min(...boundaries)-next.clockMinutes:remaining),before=next.clockMinutes;
    next=advanceGame(next,step,graph);const used=next.clockMinutes-before;remaining-=used;if(used<=EPSILON)break;
  }
  return setWorldEvent(next,active(next.clockMinutes));
}
export function formatClock(value: number | Pick<GameState, 'clockMinutes' | 'startTimeMinutes'>, startTimeMinutes = 300): string {
  const total = Math.floor(typeof value === 'number' ? value + startTimeMinutes : value.clockMinutes + value.startTimeMinutes);
  return `${String((Math.floor(total / 60) % 24 + 24) % 24).padStart(2, '0')}:${String((total % 60 + 60) % 60).padStart(2, '0')}`;
}
export function distanceToLandmark(state: GameState, landmark: Landmark, graph?: RoadGraph): number { return distanceMetres(getVehiclePosition(state, getVehicleGraph(state.vehicleId, graph)), landmark); }
