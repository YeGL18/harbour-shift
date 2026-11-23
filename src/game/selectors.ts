import { ROAD_GRAPH } from '../map/roadGraph';
import { defaultNextEdge, distanceMetres, edgeShape, findRoute, partialShape, pointOnEdge } from './routing';
import { getVehicleGraph } from './access';
import type { Coordinate, GameState, LookaheadSegment, RoadEdge, RoadGraph, UpcomingBranch } from './types';
const LOOKAHEAD_METRES = 1000;
const EPSILON = 0.000001;

/** Merge duplicate centreline records, never genuinely distinct same-name roads. */
function sameOutgoingGeometry(a: RoadEdge, b: RoadEdge, graph: RoadGraph): boolean {
  if (a.to !== b.to || Math.abs(a.lengthM - b.lengthM) > 3) return false;
  return [0, .25, .5, .75, 1].every(fraction => distanceMetres(pointOnEdge(a, fraction, graph), pointOnEdge(b, fraction, graph)) <= 2);
}

function bearing(a: Coordinate, b: Coordinate): number {
  return Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI;
}

function turnAngle(incoming: RoadEdge, outgoing: RoadEdge, graph: RoadGraph): number {
  const before = pointOnEdge(incoming, Math.max(0, 1 - 15 / incoming.lengthM), graph);
  const junction = pointOnEdge(incoming, 1, graph);
  const ahead = pointOnEdge(outgoing, Math.min(1, 25 / outgoing.lengthM), graph);
  return ((bearing(junction, ahead) - bearing(before, junction) + 540) % 360) - 180;
}

function directionName(angle: number): string {
  return Math.abs(angle) > 150 ? '迴轉' : angle < -25 ? '左轉' : angle > 25 ? '右轉' : '直行';
}

export function getVehiclePosition(state: GameState, graph: RoadGraph = ROAD_GRAPH): Coordinate & { heading: number } {
  const edge = graph.edges[state.movement.edgeId];
  const fraction = Math.min(1, state.movement.distanceOnEdgeM / edge.lengthM);
  const point = pointOnEdge(edge, fraction, graph);
  const ahead = pointOnEdge(edge, Math.min(1, fraction + 0.02), graph);
  const behind = pointOnEdge(edge, Math.max(0, fraction - 0.02), graph);
  const heading = Math.atan2((ahead.lon - behind.lon) * Math.cos(point.lat * Math.PI / 180), ahead.lat - behind.lat) * 180 / Math.PI;
  return { ...point, heading };
}

export function getLookahead(state: GameState, horizonM = LOOKAHEAD_METRES, graph: RoadGraph = ROAD_GRAPH): LookaheadSegment[] {
  const segments: LookaheadSegment[] = [];
  let remaining = Math.max(0, horizonM);
  let distance = 0;
  for (const [index, id] of [state.movement.edgeId, ...state.movement.nextEdgeIds].entries()) {
    const edge = graph.edges[id];
    if (!edge || remaining <= EPSILON) break;
    const offset = index === 0 ? state.movement.distanceOnEdgeM : 0;
    const length = Math.min(edge.lengthM - offset, remaining);
    if (length <= EPSILON) continue;
    segments.push({ edgeId: id, name: edge.name || '連接道路', coordinates: partialShape(edge, offset / edge.lengthM, (offset + length) / edge.lengthM, graph), distanceFromCarM: distance, lengthM: length, opacity: Math.max(0.12, 1 - (distance + length / 2) / horizonM * 0.88) });
    remaining -= length;
    distance += length;
  }
  return segments;
}

export function getUpcomingBranches(state: GameState, graph?: RoadGraph): UpcomingBranch[] {
  graph = getVehicleGraph(state.vehicleId, graph);
  if (state.phase !== 'cruising') return [];
  const itinerary = [state.movement.edgeId, ...state.movement.nextEdgeIds];
  const branches: UpcomingBranch[] = [];
  const seen = new Set<string>();
  let distance = -state.movement.distanceOnEdgeM;
  for (const [index, id] of itinerary.entries()) {
    const incoming = graph.edges[id];
    distance += incoming.lengthM;
    if (distance > LOOKAHEAD_METRES || branches.length >= 3) break;
    if (distance < 1 || seen.has(incoming.to)) continue;
    seen.add(incoming.to);
    const candidates = (graph.outgoing[incoming.to] || []).filter(edgeId => graph.edges[edgeId].to !== incoming.from).sort();
    const history=[...(state.movement.recentEdgeIds||[])];
    for(const passed of itinerary.slice(0,index+1))if(history.at(-1)!==passed)history.push(passed);
    const selectedEdgeId = itinerary[index + 1] || defaultNextEdge(id, graph,history) || candidates[0];
    const outgoing: string[] = [];
    for (const candidate of candidates) {
      const duplicate = outgoing.findIndex(existing => sameOutgoingGeometry(graph.edges[existing], graph.edges[candidate], graph));
      if (duplicate < 0) outgoing.push(candidate);
      else if (candidate === selectedEdgeId) outgoing[duplicate] = candidate;
    }
    if (outgoing.length < 2) continue;
    if (outgoing.length > 3) {
      const ranked = [...outgoing].sort((a, b) => Number(b === selectedEdgeId) - Number(a === selectedEdgeId) || Math.abs(turnAngle(incoming, graph!.edges[a], graph!)) - Math.abs(turnAngle(incoming, graph!.edges[b], graph!)) || a.localeCompare(b));
      outgoing.splice(0, outgoing.length, ...ranked.slice(0, 3));
    }
    const names = outgoing.map(edgeId => graph.edges[edgeId].name || '連接道路');
    const angles = outgoing.map(edgeId => turnAngle(incoming, graph.edges[edgeId], graph));
    branches.push({ junctionNodeId: incoming.to, distanceM: distance, coordinate: graph.nodes[incoming.to], selectedEdgeId, options: outgoing.map(edgeId => {
      const edge = graph.edges[edgeId];
      const position = outgoing.indexOf(edgeId);
      const baseName = names[position];
      const siblings = outgoing.map((_, index) => index).filter(index => names[index] === baseName);
      let suffix = directionName(angles[position]);
      if (siblings.length > 1 && siblings.filter(index => directionName(angles[index]) === suffix).length > 1) {
        const ranked = [...siblings].sort((a, b) => angles[a] - angles[b]);
        suffix = position === ranked[0] ? '靠左' : position === ranked[ranked.length - 1] ? '靠右' : '中間';
      }
      return { edgeId, name: siblings.length > 1 ? `${baseName} · ${suffix}` : baseName, coordinate: pointOnEdge(edge, Math.min(1, 70 / edge.lengthM), graph), selected: edgeId === selectedEdgeId };
    }) });
  }
  return branches;
}

/** Capture once when the passenger boards; coordinates follow connected road geometry. */
export function getRemainingTripRouteCoordinates(state: GameState, graph?: RoadGraph): Coordinate[] {
  if (!state.activeTrip || state.phase !== 'dropoff') return [];
  graph = getVehicleGraph(state.vehicleId, graph);
  return getLookahead(state, Infinity, graph).flatMap((segment, index) => index ? segment.coordinates.slice(1) : segment.coordinates);
}

/** Capture by offer ID: includes the current road remainder and a fresh legal pickup route. */
export function getOfferPreviewRoutes(state:GameState,graph?:RoadGraph):{id:string;pickup:Coordinate;destination:Coordinate;pickupRoute:Coordinate[];tripRoute:Coordinate[]}|null {
  const offer=state.currentOffer;if(!offer)return null;
  graph=getVehicleGraph(state.vehicleId,graph);
  const current=graph.edges[state.movement.edgeId];
  const reservationNode=offer.reservation==='next-trip'?state.activeTrip?.offer.destination.nodeId:undefined;
  const atPickup=reservationNode?reservationNode===offer.pickup.nodeId:state.movement.distanceOnEdgeM<.000001&&current.from===offer.pickup.nodeId;
  const pickupIds=atPickup?[]:findRoute(reservationNode||current.to,offer.pickup.nodeId!,graph);
  const tripIds=offer.tripRoute.length&&offer.tripRoute.every(id=>graph!.edges[id])?offer.tripRoute:findRoute(offer.pickup.nodeId!,offer.destination.nodeId!,graph);
  if(!pickupIds||!tripIds)return null;
  const append=(coordinates:Coordinate[],ids:string[])=>{for(const id of ids){const shape=edgeShape(graph!.edges[id],graph!);coordinates.push(...(coordinates.length?shape.slice(1):shape));}return coordinates;};
  const pickupRoute=append(reservationNode?[graph.nodes[reservationNode]]:atPickup?[getVehiclePosition(state,graph)]:partialShape(current,state.movement.distanceOnEdgeM/current.lengthM,1,graph),pickupIds);
  return{id:offer.id,pickup:{lat:offer.pickup.lat,lon:offer.pickup.lon},destination:{lat:offer.destination.lat,lon:offer.destination.lon},pickupRoute,tripRoute:append([],tripIds)};
}

