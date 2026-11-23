import type { GameState, Landmark, Offer, RoadGraph } from './types';
import type { EliteReservation } from '../../shared/elite';
import { VEHICLE_BY_ID } from '../data/vehicles';
import { estimateDriverPayout, PRICING_LABELS } from '../data/fares';
import { vehicleSupportsXL } from './vehicleCapabilities';
import { seededRandom, stringHash } from './random';
import { findRoute, pointOnEdge, routeLength, routeMinutes, speedKph } from './routing';
import { isSafeStoppingEdge, energyProfileFor } from './systems';
import { getShiftDurationMinutes } from './shiftDuration';
import {isOrderTypeEnabled} from './orderPreferences';
export const ELITE_GAME_RULES = { windowMinutes: 360, windowProbability: .25, noticeMinutes: 120, responseLeadMinutes: 30, pickupGraceMinutes: 10, minimumNetFare: 200, netMultiplier: 1.8, maxPassengers: 4, maxLargeLuggage: 2, commitBufferMinutes: 10, openingSearchMinute: 3, openingNoticeMinutes: 65, openingResponseLeadMinutes: 20 } as const;
const ANCHORS = ['harbour-city', 'elements', 'megabox', 'west-kowloon', 'admiralty', 'central-business', 'olympian'] as const;
const places = new WeakMap<readonly Landmark[], Map<string, Landmark>>();
type SafePickup = Landmark & {
    eliteApproachEdgeId: string;
};
const safeCache = new WeakMap<RoadGraph, Map<string, SafePickup | null>>();
const committed = new Set(['accepted', 'travelling', 'waiting', 'in-trip']);
export function eliteEnabled(state: GameState): boolean { return (state as GameState & {
    advancedRulesVersion?: 1;
}).advancedRulesVersion === 1 && state.eliteCertified === true && vehicleSupportsXL(state.vehicleId) && isOrderTypeEnabled(state,'private-elite'); }
export function isEliteOnlyShift(state: Pick<GameState, 'orderPreferences'>): boolean {
    const types = state.orderPreferences?.enabledPricingTypes;
    return types?.length === 1 && types[0] === 'private-elite';
}
export function hasCommittedEliteReservation(state: Pick<GameState, 'eliteReservations'>): boolean { return !!state.eliteReservations?.some(booking => committed.has(booking.status)); }
export function activeEliteReservation(state: Pick<GameState, 'eliteReservations'>): EliteReservation | undefined { return state.eliteReservations?.find(booking => committed.has(booking.status)); }
export function eliteWindow(seed: number, window: number, eliteOnly = false) {
    const opening = eliteOnly && window === 0;
    if (!opening && seededRandom(seed, window, 1860) >= ELITE_GAME_RULES.windowProbability) return null;
    const pickupAt = opening
        ? ELITE_GAME_RULES.openingSearchMinute + ELITE_GAME_RULES.openingNoticeMinutes
        : window * ELITE_GAME_RULES.windowMinutes + 150 + Math.floor(seededRandom(seed, window, 1861) * 91);
    return {
        pickupAt,
        announcedAt: pickupAt - (opening ? ELITE_GAME_RULES.openingNoticeMinutes : ELITE_GAME_RULES.noticeMinutes),
        respondBy: pickupAt - (opening ? ELITE_GAME_RULES.openingResponseLeadMinutes : ELITE_GAME_RULES.responseLeadMinutes),
        graceEndsAt: pickupAt + ELITE_GAME_RULES.pickupGraceMinutes,
        pickupIndex: Math.floor(seededRandom(seed, window, 1862) * ANCHORS.length),
        destinationIndex: Math.floor(seededRandom(seed, window, 1863) * (ANCHORS.length - 1)),
        passengerCount: 1 + Math.floor(seededRandom(seed, window, 1864) * ELITE_GAME_RULES.maxPassengers),
        largeLuggageCount: Math.floor(seededRandom(seed, window, 1865) * (ELITE_GAME_RULES.maxLargeLuggage + 1)),
    };
}
function safePlace(place: Landmark, graph: RoadGraph): SafePickup | null {
    let cache = safeCache.get(graph);
    if (!cache) {
        cache = new Map();
        safeCache.set(graph, cache);
    }
    if (cache.has(place.id))
        return cache.get(place.id)!;
    if (!place.nodeId || !graph.nodes[place.nodeId])
        return null;
    const frontier = [{ node: place.nodeId, cost: 0 }], seen = new Set<string>();
    let chosen: string | undefined, approach: string | undefined;
    for (let guard = 0; frontier.length && guard < 300; guard++) {
        frontier.sort((a, b) => a.cost - b.cost || a.node.localeCompare(b.node));
        const item = frontier.shift()!;
        if (seen.has(item.node) || item.cost > 400)
            continue;
        seen.add(item.node);
        const safe = (graph.outgoing[item.node] || []).map(id => graph.edges[id]).find(edge => edge && isSafeStoppingEdge(edge));
        if (safe && item.cost + safe.lengthM <= 400) {
            chosen = safe.to;
            approach = safe.id;
            break;
        }
        for (const id of graph.outgoing[item.node] || []) {
            const edge = graph.edges[id];
            if (edge && !seen.has(edge.to))
                frontier.push({ node: edge.to, cost: item.cost + edge.lengthM });
        }
    }
    const node = chosen ? graph.nodes[chosen] : undefined;
    const result = node && approach ? { ...place, ...node, id: `elite-pickup-${place.id}`, nodeId: node.id, name: place.name, nameEn: place.nameEn, waitingProfile: 'ordinary' as const, eliteApproachEdgeId: approach } : null;
    cache.set(place.id, result);
    return result;
}
export function routeToElitePickup(state: GameState, booking: EliteReservation, graph: RoadGraph) { const current = graph.edges[state.movement.edgeId], approach = graph.edges[booking.offer.eliteApproachEdgeId || '']; if (!current || !booking.offer.pickup.nodeId || !approach || approach.to !== booking.offer.pickup.nodeId || !isSafeStoppingEdge(approach))
    return null; const atPickup = state.movement.distanceOnEdgeM <= 1e-6 && current.from === booking.offer.pickup.nodeId || current.id === approach.id && state.movement.distanceOnEdgeM >= current.lengthM - 1e-6; const prefix = atPickup ? [] : current.id === approach.id ? [] : findRoute(current.to, approach.from, graph); if (!prefix)
    return null; const route = atPickup ? [] : current.id === approach.id ? [] : [...prefix, approach.id]; const remainder = atPickup ? 0 : Math.max(0, current.lengthM - state.movement.distanceOnEdgeM); return { route, distanceM: remainder + routeLength(route, graph), minutes: remainder / (speedKph(current) * 1000 / 60) + routeMinutes(route, graph) }; }
export function createEliteReservation(state: GameState, window: number, graph: RoadGraph, canOffer?: (booking: EliteReservation) => boolean): EliteReservation | null {
    const spec = eliteWindow(state.seed, window, isEliteOnlyShift(state));
    if (!spec || spec.pickupAt >= getShiftDurationMinutes(state) - 20)
        return null;
    let byId = places.get(state.landmarks);
    if (!byId) {
        byId = new Map(state.landmarks.map(place => [place.id, place]));
        places.set(state.landmarks, byId);
    }
    const candidates = ANCHORS.map(id => byId!.get(id)).filter((place): place is Landmark => !!place).map(place => safePlace(place, graph)).filter((place): place is SafePickup => !!place);
    if (candidates.length < 2)
        return null;
    const first = spec.pickupIndex % candidates.length;
    const pickupCandidates = canOffer ? [...candidates.slice(first), ...candidates.slice(0, first)] : [candidates[first]];
    for (const pickup of pickupCandidates) {
        const destinations = candidates.filter(place => place.nodeId !== pickup.nodeId);
        if (!destinations.length) continue;
        const index = spec.destinationIndex % destinations.length;
        const booking = buildEliteReservation(state, window, spec, pickup, destinations[index], graph, !!canOffer);
        if (booking && (!canOffer || canOffer(booking))) return booking;
    }
    return null;
}

function buildEliteReservation(state: GameState, window: number, spec: NonNullable<ReturnType<typeof eliteWindow>>,
    pickup: SafePickup, destination: SafePickup, graph: RoadGraph, separateRoutes: boolean): EliteReservation | null {
    const tripRoute = findRoute(pickup.nodeId!, destination.nodeId!, graph);
    if (!tripRoute?.length)
        return null;
    const tripDistanceM = routeLength(tripRoute, graph), tripMinutes = routeMinutes(tripRoute, graph);
    // A driver who can reach only a different pickup is offering a different trip.
    const id = `elite-${state.seed}-${window}${separateRoutes ? `-${pickup.id}-${destination.id}` : ''}`;
    const offer: Offer = { id, eliteBookingId: id, eliteApproachEdgeId: pickup.eliteApproachEdgeId, scheduledPickupMinute: spec.pickupAt, serviceType: 'elite', passengerCount: spec.passengerCount, createdAt: state.clockMinutes, requestedAt: spec.announcedAt, expiresAt: spec.respondBy, pickup, destination, pickupDistanceM: 0, pickupMinutes: 0, tripDistanceM, tripMinutes, pickupRoute: [], tripRoute, estimatedFare: estimateDriverPayout(VEHICLE_BY_ID[state.vehicleId], tripDistanceM, tripMinutes, 1, 'private-elite'), estimatedNet: 0, surge: 1, pricingType: 'private-elite', pricingLabel: PRICING_LABELS['private-elite'], feedKind: 'live' };
    const result: EliteReservation = { id, window, offer, announcedAt: spec.announcedAt, pickupAt: spec.pickupAt, respondBy: spec.respondBy, graceEndsAt: spec.graceEndsAt, passengerCount: spec.passengerCount, largeLuggageCount: spec.largeLuggageCount, status: 'available' };
    const approach = routeToElitePickup(state, result, graph);
    if (!approach)
        return null;
    offer.pickupDistanceM = approach.distanceM;
    offer.pickupMinutes = approach.minutes;
    offer.pickupRoute = approach.route;
    offer.estimatedNet = Math.round((offer.estimatedFare - (offer.tripDistanceM + approach.distanceM) / 1000 * energyProfileFor(state.vehicleId).consumptionPerKm * state.energy.unitPricePaid) * 100) / 100;
    return result;
}
export function canSeekEliteReservation(state: GameState): boolean {
    return state.phase === 'cruising' && !state.navigation && state.parking?.kind !== 'rest'
        && state.acceptingOrders && state.platform.suspendedUntil <= state.clockMinutes
        && !state.activeTrip && !state.queuedTrip && !state.energyRecovery && !state.deadlineSettlement
        && !state.airportQueue && !hasCommittedEliteReservation(state);
}
export function canCommitEliteReservation(state: GameState, booking: EliteReservation, graph: RoadGraph): boolean {
    if (!eliteEnabled(state) || !canSeekEliteReservation(state) || booking.status !== 'available' || state.clockMinutes >= booking.respondBy) return false;
    const route = routeToElitePickup(state, booking, graph);
    return !!route && state.clockMinutes + route.minutes * 1.35 + ELITE_GAME_RULES.commitBufferMinutes <= booking.pickupAt && state.energy.remaining >= (route.distanceM + booking.offer.tripDistanceM) / 1000 * energyProfileFor(state.vehicleId).consumptionPerKm;
}
/** Accepted bookings constrain the actual feasible ordinary pool, not just the map route. */
export function eliteAllowsOrdinaryOffer(state: GameState, offer: Offer, graph: RoadGraph): boolean {
    const booking = activeEliteReservation(state);
    if (!booking || offer.eliteBookingId === booking.id)
        return true;
    if (booking.status !== 'accepted')
        return false;
    const current = graph.edges[state.movement.edgeId];
    const pendingDistance = offer.reservation && state.activeTrip && state.phase !== 'alighting' ? Math.max(0, current.lengthM - state.movement.distanceOnEdgeM) + routeLength(state.movement.nextEdgeIds, graph) : 0;
    const pending = offer.reservation && state.activeTrip ? Math.max(0, current.lengthM - state.movement.distanceOnEdgeM) / (speedKph(current) * 1000 / 60) + routeMinutes(state.movement.nextEdgeIds, graph) + 3 : 0;
    const back = findRoute(offer.destination.nodeId!, booking.offer.pickup.nodeId!, graph);
    if (!back)
        return false;
    return state.clockMinutes + (pending + offer.pickupMinutes + offer.tripMinutes + 3 + routeMinutes(back, graph)) * 1.35 + 10 <= booking.pickupAt && state.energy.remaining >= (pendingDistance + offer.pickupDistanceM + offer.tripDistanceM + routeLength(back, graph) + booking.offer.tripDistanceM) / 1000 * energyProfileFor(state.vehicleId).consumptionPerKm;
}
export function withdrawClaimedEliteReservations(state: GameState, claims: ReadonlyMap<string, string>, playerId: string): GameState {
    if (!state.eliteReservations?.some(booking => booking.status === 'available' && claims.has(booking.id) && claims.get(booking.id) !== playerId))
        return state;
    let withdrawn = 0;
    const eliteReservations = state.eliteReservations.map(booking => booking.status === 'available' && claims.has(booking.id) && claims.get(booking.id) !== playerId ? (withdrawn++, { ...booking, status: 'unavailable' as const }) : booking);
    return { ...state, eliteReservations, platform: { ...state.platform, offered: Math.max(state.acceptedOffers, state.platform.offered - withdrawn) } };
}
