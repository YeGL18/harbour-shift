import {conditionsFromSupplyDemand, demandConditions} from './demandField';
import {cellFor} from './spatial';
import type {Coordinate, GameState, SurgeArea} from './types';

export const MAP_DEMAND_REFRESH_MS = 120_000;
const REQUEST_LIFETIME_MINUTES = 10;
const MAX_REQUESTS = 160;
const AREA_METRES = 2200;

export interface MapDemandRequest {
  id: string;
  pickup: Coordinate;
  requestedAt: number;
}

export interface MapDemandSnapshot {
  sampledAt: number;
  areas: SurgeArea[];
}

export function mergeMapDemandRequests(previous: readonly MapDemandRequest[] | undefined, incoming: readonly MapDemandRequest[], clock: number): MapDemandRequest[] {
  const fresh = new Map<string, MapDemandRequest>();
  for (const request of [...(previous ?? []), ...incoming]) {
    if (request.requestedAt <= clock + .001 && request.requestedAt > clock - REQUEST_LIFETIME_MINUTES
      && Number.isFinite(request.pickup.lat) && Number.isFinite(request.pickup.lon)) {
      fresh.set(request.id, request);
    }
  }
  return [...fresh.values()].sort((a, b) => b.requestedAt - a.requestedAt || a.id.localeCompare(b.id)).slice(0, MAX_REQUESTS);
}

type DemandWorld = Pick<GameState, 'seed' | 'startTimeMinutes' | 'clockMinutes' | 'demandSupply'>;

export function sampleMapDemand(world: DemandWorld, requests: readonly MapDemandRequest[]): SurgeArea[] {
  const cells = new Map<string, {center: Coordinate; requests: MapDemandRequest[]}>();
  for (const request of mergeMapDemandRequests(undefined, requests, world.clockMinutes)) {
    const {key, x, y} = cellFor(request.pickup, AREA_METRES);
    let area = cells.get(key);
    if (!area) {
      area = {center: {lat: (y + .5) * AREA_METRES / 111195, lon: (x + .5) * AREA_METRES / 102980}, requests: []};
      cells.set(key, area);
    }
    area.requests.push(request);
  }
  const minute = world.startTimeMinutes + world.clockMinutes;
  const hour = ((minute % 1440) + 1440) % 1440 / 60;
  const peak = hour >= 7 && hour < 10 || hour >= 17 && hour < 20;
  return [...cells].map(([id, {center, requests: waiting}]) => {
    const supply = demandConditions(world.seed, minute, id, {position: center, supply: world.demandSupply}).availableDrivers;
    const demand = conditionsFromSupplyDemand(waiting.length, supply, peak);
    const level = waiting.length === 1 ? 'quiet' : demand.level;
    return {
      ...demand, id, name: id, center, level, radiusM: level === 'quiet' ? 950 : 1450,
      intensity: level === 'quiet' ? Math.max(.36, demand.intensity) : demand.intensity,
      pickupDot: level === 'quiet' ? waiting[0].pickup : undefined,
    };
  });
}

/** Hold one official map view and refresh it on wall time; dispatch still advances every tick. */
export function refreshMapDemand(previous: MapDemandSnapshot | undefined, world: DemandWorld, requests: readonly MapDemandRequest[], now: number): MapDemandSnapshot | undefined {
  if (previous && now - previous.sampledAt < MAP_DEMAND_REFRESH_MS) return previous;
  const areas = sampleMapDemand(world, requests);
  if (!previous && !areas.length) return undefined;
  return {sampledAt: now, areas};
}
