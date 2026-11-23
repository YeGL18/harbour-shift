import type { Coordinate, Movement, RoadEdge, RoadGraph, RoadNode } from './types';
import { flatDistanceM, SpatialIndex } from './spatial';

const nodeIndexes = new WeakMap<RoadGraph, SpatialIndex<RoadNode>>();
const routeCaches = new WeakMap<RoadGraph, Map<string, string[] | null>>();
const graphMetrics = new WeakMap<RoadGraph, { distanceScale: number; maxSpeed: number }>();

export function distanceMetres(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const x = (b.lon - a.lon) * radians * Math.cos((a.lat + b.lat) * radians / 2);
  const y = (b.lat - a.lat) * radians;
  return Math.hypot(x, y) * 6371000;
}

export function nearestNode(point: Coordinate, graph: RoadGraph): RoadNode {
  let index = nodeIndexes.get(graph);
  if (!index) { index = new SpatialIndex(Object.values(graph.nodes).filter(node => graph.outgoing[node.id]?.length)); nodeIndexes.set(graph, index); }
  const closest = index.nearest(point);
  if (!closest) throw new Error('The road graph must contain at least one drivable edge.');
  return closest;
}

export function edgeShape(edge: RoadEdge, graph: RoadGraph): Coordinate[] {
  if (edge.shape && edge.shape.length > 1) return edge.shape;
  return [graph.nodes[edge.from], graph.nodes[edge.to]];
}

export function pointOnEdge(edge: RoadEdge, fraction: number, graph: RoadGraph): Coordinate {
  const points = edgeShape(edge, graph);
  const lengths = points.slice(1).map((point, index) => distanceMetres(points[index], point));
  let remaining = Math.max(0, Math.min(1, fraction)) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] ? Math.min(1, remaining / lengths[index]) : 0;
      return { lat: points[index].lat + (points[index + 1].lat - points[index].lat) * ratio, lon: points[index].lon + (points[index + 1].lon - points[index].lon) * ratio };
    }
    remaining -= lengths[index];
  }
  return points[points.length - 1];
}

export function partialShape(edge: RoadEdge, start: number, end: number, graph: RoadGraph): Coordinate[] {
  const points = edgeShape(edge, graph);
  const total = points.slice(1).reduce((sum, point, index) => sum + distanceMetres(points[index], point), 0);
  const result = [pointOnEdge(edge, start, graph)];
  let travelled = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    travelled += distanceMetres(points[index - 1], points[index]);
    const ratio = total ? travelled / total : 0;
    if (ratio > start && ratio < end) result.push(points[index]);
  }
  result.push(pointOnEdge(edge, end, graph));
  return result;
}

export function speedKph(edge: RoadEdge): number {
  if (edge.speedKph) return edge.speedKph;
  if (/motorway|trunk/.test(edge.roadClass || '')) return 48;
  if (/primary|secondary/.test(edge.roadClass || '')) return 32;
  return 24;
}

/** Dijkstra on directed edges, using time or distance as the route weight. */
export function findRoute(from: string, to: string, graph: RoadGraph, policy: 'fastest' | 'economy' = 'fastest', avoidEdgeId?: string, options: { maxCost?: number } = {}): string[] | null {
  if (!graph.nodes[from] || !graph.nodes[to]) return null;
  if (from === to) return [];
  let cache = routeCaches.get(graph);
  if (!cache) { cache = new Map(); routeCaches.set(graph, cache); }
  const cacheKey = `${from}|${to}|${policy}|${avoidEdgeId || ''}|${options.maxCost || ''}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)!;
    cache.delete(cacheKey); cache.set(cacheKey, cached);
    return cached ? [...cached] : null;
  }
  let metric = graphMetrics.get(graph);
  if (!metric) {
    let distanceScale = 1;
    let maxSpeed = 1;
    for (const edge of Object.values(graph.edges)) {
      const direct = flatDistanceM(graph.nodes[edge.from], graph.nodes[edge.to]);
      if (direct > 0.1) distanceScale = Math.min(distanceScale, edge.lengthM / direct);
      maxSpeed = Math.max(maxSpeed, speedKph(edge));
    }
    metric = { distanceScale: distanceScale * 0.98, maxSpeed };
    graphMetrics.set(graph, metric);
  }
  const heuristic = (node: string) => flatDistanceM(graph.nodes[node], graph.nodes[to]) * metric!.distanceScale / (policy === 'fastest' ? metric!.maxSpeed : 1);
  const cost = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  type Entry = { node: string; cost: number; priority: number; order: number };
  const frontier: Entry[] = [];
  let order = 0;
  const earlier = (a: Entry, b: Entry) => a.priority < b.priority || (a.priority === b.priority && a.order > b.order);
  const push = (entry: Entry) => {
    frontier.push(entry);
    let index = frontier.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!earlier(frontier[index], frontier[parent])) break;
      [frontier[index], frontier[parent]] = [frontier[parent], frontier[index]];
      index = parent;
    }
  };
  const pop = (): Entry => {
    const first = frontier[0];
    const last = frontier.pop()!;
    if (frontier.length) {
      frontier[0] = last;
      let index = 0;
      while (index * 2 + 1 < frontier.length) {
        const left = index * 2 + 1;
        const right = left + 1;
        const child = right < frontier.length && earlier(frontier[right], frontier[left]) ? right : left;
        if (!earlier(frontier[child], frontier[index])) break;
        [frontier[index], frontier[child]] = [frontier[child], frontier[index]];
        index = child;
      }
    }
    return first;
  };
  push({ node: from, cost: 0, priority: heuristic(from), order: order++ });
  while (frontier.length) {
    const current = pop();
    if (current.cost !== cost.get(current.node)) continue;
    if (current.node === to) break;
    for (const id of graph.outgoing[current.node] || []) {
      if (id === avoidEdgeId) continue;
      const edge = graph.edges[id];
      if (!edge || edge.lengthM <= 0) continue;
      const weight = policy === 'economy' ? edge.lengthM : edge.lengthM / speedKph(edge);
      const nextCost = current.cost + weight;
      if (options.maxCost !== undefined && nextCost > options.maxCost) continue;
      if (nextCost < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, nextCost);
        previous.set(edge.to, id);
        push({ node: edge.to, cost: nextCost, priority: nextCost + heuristic(edge.to), order: order++ });
      }
    }
  }
  if (!previous.has(to)) { cache.set(cacheKey, null); if (cache.size > 512) cache.delete(cache.keys().next().value!); return null; }
  const route: string[] = [];
  let cursor = to;
  while (cursor !== from) {
    const id = previous.get(cursor);
    if (!id) return null;
    route.push(id);
    cursor = graph.edges[id].from;
  }
  route.reverse();
  cache.set(cacheKey, [...route]);
  if (cache.size > 512) cache.delete(cache.keys().next().value!);
  return route;
}

export function routeLength(route: string[], graph: RoadGraph): number {
  return route.reduce((sum, id) => sum + (graph.edges[id]?.lengthM || 0), 0);
}

export function routeMinutes(route: string[], graph: RoadGraph): number {
  return route.reduce((sum, id) => sum + graph.edges[id].lengthM / (speedKph(graph.edges[id]) * 1000 / 60), 0);
}

export const RECENT_EDGE_LIMIT = 96;
export function recordDrivenEdge(movement:Movement,edgeId:string):void {
  if(movement.recentEdgeIds?.at(-1)!==edgeId)movement.recentEdgeIds=[...(movement.recentEdgeIds||[]),edgeId].slice(-RECENT_EDGE_LIMIT);
}

/** Prefer unexplored legal exits over short loops, then the gentlest turn. */
export function defaultNextEdge(incomingId: string, graph: RoadGraph, recentEdgeIds:readonly string[]=[]): string | undefined {
  const incoming = graph.edges[incomingId];
  if (!incoming) return undefined;
  const options = (graph.outgoing[incoming.to] || []).filter(id => graph.edges[id]);
  const forward = options.filter(id => graph.edges[id].to !== incoming.from);
  const candidates = forward.length ? forward : options;
  const recent=recentEdgeIds.slice(-RECENT_EDGE_LIMIT);
  const edges=new Map<string,number>(),nodes=new Map<string,number>();
  for(const [index,id]of recent.entries()) {const edge=graph.edges[id];if(!edge)continue;edges.set(id,(edges.get(id)||0)+1);nodes.set(edge.from,index+1);nodes.set(edge.to,index+1);}
  const repeatPenalty=(id:string)=>{const edge=graph.edges[id];return(edges.get(id)||0)*10000+(nodes.has(edge.to)?3000+(nodes.get(edge.to)||0):0);};
  const shape = edgeShape(incoming, graph);
  const a = shape[Math.max(0, shape.length - 2)];
  const b = shape[shape.length - 1];
  const angle = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * Math.cos(b.lat * Math.PI / 180));
  return [...candidates].sort((left, right) => {
    const turn = (id: string) => {
      const outgoing = edgeShape(graph.edges[id], graph);
      const c = outgoing[0];
      const d = outgoing[1];
      const next = Math.atan2(d.lat - c.lat, (d.lon - c.lon) * Math.cos(c.lat * Math.PI / 180));
      return Math.abs(Math.atan2(Math.sin(next - angle), Math.cos(next - angle)));
    };
    return repeatPenalty(left)-repeatPenalty(right)||turn(left) - turn(right) || left.localeCompare(right);
  })[0];
}

export function extendItinerary(movement: Movement, graph: RoadGraph, horizonM = 1400): void {
  const current = graph.edges[movement.edgeId];
  if (!current) return;
  const context=[...(movement.recentEdgeIds||[]).slice(-RECENT_EDGE_LIMIT)];
  if(context.at(-1)!==movement.edgeId)context.push(movement.edgeId);
  const committed=Math.min(Math.max(0,movement.committedEdgeCount||0),movement.nextEdgeIds.length);
  const kept:string[]=[];let last=movement.edgeId;
  // Validate the automatic tail even when an old save already contains 1.4km
  // of prefilled circles. A player's selected prefix is never re-selected.
  for(const [index,id]of movement.nextEdgeIds.entries()) {
    const edge=graph.edges[id];if(!edge||edge.from!==graph.edges[last].to)break;
    if(index>=committed&&id!==defaultNextEdge(last,graph,context))break;
    kept.push(id);context.push(id);last=id;
  }
  movement.nextEdgeIds=kept;movement.committedEdgeCount=Math.min(committed,kept.length);
  let length = current.lengthM - movement.distanceOnEdgeM + routeLength(kept, graph);
  let guard = 0;
  while (length < horizonM && guard++ < 100) {
    const next = defaultNextEdge(last, graph,context);
    if (!next) break;
    movement.nextEdgeIds.push(next);
    context.push(next);
    length += graph.edges[next].lengthM;
    last = next;
  }
}
