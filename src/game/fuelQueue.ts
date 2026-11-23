import { pointOnEdge, routeLength } from './routing';
import { isSafeStoppingEdge } from './systems';
import type { EnergyStation, FuelQueueAssignment, RoadEdge, RoadGraph } from './types';

/** Gameplay calibration, not live station occupancy or a legal kerbside survey. */
export const FUEL_QUEUE_CAR_SPACING_M = 7;
export const FUEL_QUEUE_HEADWAY_MINUTES = .8;
export const FUEL_QUEUE_APPROACH_M = 650;
export const FUEL_QUEUE_CREEP_KPH = 12;
const incomingIndexes = new WeakMap<RoadGraph, Map<string, RoadEdge[]>>();
export interface StationQueueApproach { edgeIds:string[]; connectorEdgeIds:string[]; connectorDistanceM:number; connectorMinutes:number }
const approaches = new WeakMap<RoadGraph, Map<string, StationQueueApproach>>();

export function fuelQueueBaseline(station: EnergyStation, absoluteMinute: number): { waitMinutes: number; aheadCount: number; peakTurnover: boolean } {
  const minute = ((absoluteMinute % 720) + 720) % 720;
  const untilTurnover = (300 - minute + 720) % 720;
  const eligible = station.kind === 'lpg';
  const peakTurnover = eligible && (untilTurnover <= 60 || untilTurnover >= 705);
  // 04:00/16:00 starts building; 04:30/16:30 reaches at least 20 minutes.
  const waitMinutes = !eligible ? 0 : !peakTurnover ? (station.dedicated ? 1.6 : .8)
    : untilTurnover > 60 ? 20 : untilTurnover > 30 ? 4 + (60 - untilTurnover) * 16 / 30 : 20 + (30 - untilTurnover) * .25;
  return { waitMinutes, aheadCount: Math.ceil(waitMinutes / FUEL_QUEUE_HEADWAY_MINUTES), peakTurnover };
}

/** The queue waits on safe local roads; a final main-road connector is driven without queue stops. */
export function stationQueueApproachDetails(station:EnergyStation,graph:RoadGraph):StationQueueApproach {
  let cache=approaches.get(graph);if(!cache){cache=new Map();approaches.set(graph,cache);}
  const known=cache.get(station.nodeId);if(known)return known;
  let incoming=incomingIndexes.get(graph);
  if(!incoming){incoming=new Map();for(const edge of Object.values(graph.edges)){const entries=incoming.get(edge.to)||[];entries.push(edge);incoming.set(edge.to,entries);}incomingIndexes.set(graph,incoming);}
  const buildPrefix=(front:RoadEdge,connector:string[]):string[]=>{
    const reversed=[front.id];const seen=new Set([station.nodeId,front.to,front.from,...connector.flatMap(id=>[graph.edges[id].from,graph.edges[id].to])]);
    let node=front.from,distance=front.lengthM,next=front;
    const continues=(edge:RoadEdge)=>Number((incoming!.get(edge.from)||[]).some(previous=>isSafeStoppingEdge(previous)&&!seen.has(previous.from)));
    while(distance<FUEL_QUEUE_APPROACH_M&&reversed.length<80){
      const edge=(incoming!.get(node)||[]).filter(edge=>isSafeStoppingEdge(edge)&&!seen.has(edge.from)).sort((a,b)=>continues(b)-continues(a)||Number(b.name===next.name)-Number(a.name===next.name)||a.id.localeCompare(b.id))[0];
      if(!edge)break;reversed.push(edge.id);distance+=edge.lengthM;seen.add(edge.from);node=edge.from;next=edge;
    }
    return reversed.reverse();
  };
  const frontier:Array<{node:string;suffix:string[];distance:number}>=[{node:station.nodeId,suffix:[],distance:0}];
  const visited=new Set<string>();let prefix:string[]=[],connector:string[]=[];let bestLength=0;
  search:while(frontier.length){
    frontier.sort((a,b)=>a.distance-b.distance||a.node.localeCompare(b.node));const current=frontier.shift()!;
    if(visited.has(current.node))continue;visited.add(current.node);
    const edges=[...(incoming.get(current.node)||[])].sort((a,b)=>a.id.localeCompare(b.id));
    for(const edge of edges)if(isSafeStoppingEdge(edge)&&!current.suffix.some(id=>graph.edges[id].from===edge.from)){
      const candidate=buildPrefix(edge,current.suffix),length=routeLength(candidate,graph);
      if(length>bestLength){bestLength=length;prefix=candidate;connector=current.suffix;}
      // Enough actual road space for an eight-player queue and background traffic.
      if(length>=200){prefix=candidate;connector=current.suffix;break search;}
    }
    for(const edge of edges)if(current.distance+edge.lengthM<=3000&&!visited.has(edge.from))frontier.push({node:edge.from,suffix:[edge.id,...current.suffix],distance:current.distance+edge.lengthM});
  }
  const edgeIds=[...prefix,...connector];const connectorDistanceM=routeLength(connector,graph);
  const result={edgeIds,connectorEdgeIds:connector,connectorDistanceM,connectorMinutes:connectorDistanceM/(FUEL_QUEUE_CREEP_KPH*1000/60)};cache.set(station.nodeId,result);return result;
}
export function stationQueueApproach(station:EnergyStation,graph:RoadGraph):string[]{return stationQueueApproachDetails(station,graph).edgeIds;}

export interface SharedFuelArrival { id: string; stationId: string; joinedAt: number; serviceMinutes: number; initialWaitMinutes?: number }
/** Persistent server FIFO helper. Existing assignments never move backwards. */
export function allocateFuelQueue(arrivals: SharedFuelArrival[], existing: FuelQueueAssignment[] = []): FuelQueueAssignment[] {
  const byId = new Map(existing.map(ticket => [ticket.id, { ...ticket }]));
  const tails = new Map<string, number>();
  for (const ticket of existing) tails.set(ticket.stationId, Math.max(tails.get(ticket.stationId) ?? -Infinity, ticket.serviceEndsAt));
  for (const arrival of [...arrivals].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))) {
    if (byId.has(arrival.id)) continue;
    const start = Math.max(arrival.joinedAt + Math.max(0, arrival.initialWaitMinutes ?? 0), tails.get(arrival.stationId) ?? arrival.joinedAt);
    const aheadCount = [...byId.values()].filter(ticket => ticket.stationId === arrival.stationId && ticket.serviceEndsAt > arrival.joinedAt).length;
    const ticket = { id: arrival.id, stationId: arrival.stationId, joinedAt: arrival.joinedAt, serviceStartsAt: start, serviceEndsAt: start + Math.max(.05, arrival.serviceMinutes), aheadCount:Math.max(aheadCount,Math.ceil((start-arrival.joinedAt)/FUEL_QUEUE_HEADWAY_MINUTES)) };
    byId.set(ticket.id, ticket); tails.set(ticket.stationId, ticket.serviceEndsAt);
  }
  return [...byId.values()].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

export function queueDistanceTarget(waitMinutes: number, approachLengthM: number, connectorDistanceM=0,connectorMinutes=0,metresPerMinute=FUEL_QUEUE_CAR_SPACING_M/FUEL_QUEUE_HEADWAY_MINUTES): number {
  if(waitMinutes<=connectorMinutes)return 0;
  return Math.min(Math.max(0, approachLengthM), connectorDistanceM+Math.max(0, waitMinutes-connectorMinutes) * metresPerMinute);
}

export function queuePoint(approach: string[], distanceBackM: number, graph: RoadGraph): ReturnType<typeof pointOnEdge> | undefined {
  let remaining = Math.max(0, Math.min(routeLength(approach, graph), distanceBackM));
  for (const id of [...approach].reverse()) {
    const edge = graph.edges[id];
    if (remaining <= edge.lengthM) return pointOnEdge(edge, 1 - remaining / edge.lengthM, graph);
    remaining -= edge.lengthM;
  }
  return undefined;
}
