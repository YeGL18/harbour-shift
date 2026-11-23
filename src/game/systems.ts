import { VEHICLE_BY_ID } from '../data/vehicles';
import type { EnergyProfile, EnergyState, GameState, Landmark, PlatformStats, RoadEdge, RoadGraph, VehicleId } from './types';

export {seededRandom,stringHash} from './random';
export {demandConditions,surgeAreasFor,shouldDispatchNextTrip,conditionsFromSupplyDemand} from './demandField';
export type {DemandConditions,DemandContext} from './demandField';

/** These thresholds and penalties are game rules, not any real platform's policy. */
export const PLATFORM_GAME_RULES = {
  minimumOfferedSample: 20, minimumAcceptedSample: 10,
  minimumAcceptanceRate: 0.30, maximumCancellationRate: 0.35,
  suspensionMinutes: [60, 180, 360, 720] as readonly number[],
};
export function initialPlatformStats(): PlatformStats {
  return { offered: 0, accepted: 0, cancelled: 0, acceptanceRate: 1, cancellationRate: 0, suspendedUntil: 0, penaltyLevel: 0, reviewOffered: 0, reviewAccepted: 0, reviewCancelled: 0 };
}
export function refreshPlatformStats(state: GameState): boolean {
  const stats = state.platform;
  stats.accepted = state.acceptedOffers; stats.cancelled = state.cancelledTrips;
  stats.acceptanceRate = stats.offered ? Math.min(1, stats.accepted / stats.offered) : 1;
  stats.cancellationRate = stats.accepted ? stats.cancelled / stats.accepted : 0;
  if (stats.suspendedUntil > state.clockMinutes) return false;
  const offered = stats.offered - stats.reviewOffered;
  const accepted = stats.accepted - stats.reviewAccepted;
  const cancelled = stats.cancelled - stats.reviewCancelled;
  const lowAcceptance = offered >= PLATFORM_GAME_RULES.minimumOfferedSample && accepted / offered < PLATFORM_GAME_RULES.minimumAcceptanceRate;
  const highCancellation = accepted >= PLATFORM_GAME_RULES.minimumAcceptedSample && cancelled / accepted > PLATFORM_GAME_RULES.maximumCancellationRate;
  if (!lowAcceptance && !highCancellation) return false;
  const duration = PLATFORM_GAME_RULES.suspensionMinutes[Math.min(stats.penaltyLevel, 3)];
  stats.penaltyLevel += 1; stats.suspendedUntil = state.clockMinutes + duration;
  stats.reviewOffered = stats.offered; stats.reviewAccepted = stats.accepted; stats.reviewCancelled = stats.cancelled;
  return true;
}

export function energyProfileFor(vehicleId: VehicleId): EnergyProfile {
  return VEHICLE_BY_ID[vehicleId].energyProfile || {
    kind: vehicleId === 'red-flag' ? 'swap' : vehicleId === 'private' ? 'petrol' : 'lpg',
    capacity: 50, consumptionPerKm: 0.1, unitPrice: VEHICLE_BY_ID[vehicleId].fuelCostPerKm / 0.1,
    calibrationNote: '尚待車輛資料的遊戲後備設定',
  };
}
export function initialEnergy(vehicleId: VehicleId, fraction?: number, priceOverride?: number): EnergyState {
  const profile = energyProfileFor(vehicleId);
  const override = priceOverride !== undefined && Number.isFinite(priceOverride) && priceOverride >= 0 ? priceOverride : undefined;
  const remaining=profile.capacity * Math.max(0, Math.min(1, fraction ?? profile.initialFraction ?? 1));
  return { kind: profile.kind, capacity: profile.capacity, remaining, consumed: 0, costAdded: 0, unitPricePaid: override ?? profile.unitPrice, unitPriceOverride: override,...(profile.kind==='charge'?{prepaidRemaining:remaining}:{}) };
}

export function isSafeStoppingEdge(edge: RoadEdge): boolean {
  if (edge.safeStop !== undefined) return edge.safeStop;
  return !/tunnel|motorway|expressway|trunk|arterial|快速|隧道|highway|公路|幹線|大橋|走廊|天橋|高架/i.test(`${edge.roadClass || ''} ${edge.name || ''}`) && (edge.speedKph || 0) < 65;
}

/** Find the nearest reachable safe edge end without teleporting or stopping in a tunnel. */
export function safeStopRoute(state: GameState, graph: RoadGraph): { route: string[]; target: Landmark } | null {
  const current = graph.edges[state.movement.edgeId];
  const make = (nodeId: string, route: string[], name: string) => ({ route, target: { ...graph.nodes[nodeId], id: `safe-stop-${nodeId}`, nodeId, name: `${name || '支路'}安全停車點`, district: '', kind: 'transport' as const } });
  if (isSafeStoppingEdge(current) && (graph.outgoing[current.to] || []).some(id => isSafeStoppingEdge(graph.edges[id]))) return make(current.to, [], current.name || '前方');
  const costs = new Map<string, number>([[current.to, 0]]);
  const previous = new Map<string, string>();
  const frontier: Array<{ node: string; cost: number; via?: string }> = [{ node: current.to, cost: 0 }];
  for (let guard = 0; frontier.length && guard < 12000; guard += 1) {
    frontier.sort((a, b) => b.cost - a.cost);
    const entry = frontier.pop()!;
    if (entry.cost !== costs.get(entry.node)) continue;
    if (entry.via && isSafeStoppingEdge(graph.edges[entry.via]) && (graph.outgoing[entry.node] || []).some(id => isSafeStoppingEdge(graph.edges[id]))) {
      const route: string[] = []; let node = entry.node;
      while (node !== current.to) { const id = previous.get(node)!; route.unshift(id); node = graph.edges[id].from; }
      return make(entry.node, route, graph.edges[entry.via].name || '前方');
    }
    for (const id of graph.outgoing[entry.node] || []) {
      const edge = graph.edges[id]; const cost = entry.cost + edge.lengthM;
      if (cost < (costs.get(edge.to) ?? Infinity)) { costs.set(edge.to, cost); previous.set(edge.to, id); frontier.push({ node: edge.to, cost, via: id }); }
    }
  }
  return null;
}

