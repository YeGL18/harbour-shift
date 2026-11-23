import type { Coordinate, Landmark, RoadEdge, RoadGraph, VehicleId } from '../game/types';
import { ROAD_GRAPH } from '../map/roadGraph';
import {vehicleAccessProfile} from '../game/vehicleCapabilities';

/** No closed-road/private-estate permit is assumed for the player's vehicle. */
export const VEHICLE_ACCESS_AS_OF = '2026-11-18';
export const VEHICLE_ACCESS_SOURCES = [
  'https://www.td.gov.hk/en/transport_in_hong_kong/public_transport/taxi/details_of_taxi_operating_areas_/',
  'https://driveonlantau1.td.gov.hk/lcrp/application/clientLogging.do?country=HK&language=en&method=jumpToAppElcrp',
  'https://www.districtcouncils.gov.hk/island/doc/2024_2027/en/committee_meetings_doc/TTC/31505/TTC_2026_14_EN.pdf',
];
export interface RestrictedArea {
  id: string;
  name: string;
  /** Hand-traced conservative gameplay boundary, never a legal cadastral limit. */
  polygon: Coordinate[];
  vehicles: 'all' | 'private';
  sourceUrl: string;
}
export const RESTRICTED_AREAS: RestrictedArea[] = [
  {
    id: 'south-lantau-closed-roads', name: '嶼南封閉道路（無許可證）', vehicles: 'all',
    // The actual gateway is Tung Chung Road / Shek Mun Kap Road at
    // 113.9344193,22.269725 in the official road graph. Broad rural bounds
    // plus the gateway road test below avoid routing through the closed area.
    polygon: [[113.82,22.19],[114.035,22.19],[114.035,22.282],
      [113.973,22.269725],[113.9345,22.269725],[113.930,22.272],
      [113.925,22.287],[113.900,22.305],[113.820,22.305]].map(([lon,lat]) => ({lon,lat})),
    sourceUrl: VEHICLE_ACCESS_SOURCES[1],
  },
  {
    id: 'discovery-bay-private', name: '愉景灣（無私家車通行許可）', vehicles: 'private',
    polygon: [[114.008,22.276],[114.028,22.276],[114.033,22.300],
      [114.024,22.314],[114.010,22.314],[114.005,22.3105],
      [114.002,22.3105],[114.002,22.307],[114.009,22.305],
      [113.999,22.297]].map(([lon,lat]) => ({lon,lat})),
    sourceUrl: 'https://www.info.gov.hk/gia/general/200705/30/P200705300113.htm',
  },
  {
    id: 'discovery-bay-south-taxi', name: '愉景灣南部的士禁區（保守近似）', vehicles: 'all',
    // DB North Plaza / Auberge at roughly 22.307N remain reachable by taxi.
    // The 2026 consultation to extend access is a proposal, not an assumed
    // enacted change. This polygon is explicitly not a legal gazette boundary.
    polygon: [[113.998,22.276],[113.998,22.3055],[114.033,22.3055],
      [114.033,22.276]].map(([lon,lat]) => ({lon,lat})),
    sourceUrl: VEHICLE_ACCESS_SOURCES[2],
  },
];

const applies = (area: RestrictedArea, vehicleId: VehicleId) => area.vehicles === 'all' || vehicleAccessProfile(vehicleId) === 'private';
const bounds = RESTRICTED_AREAS.map(area => ({
  minLat: Math.min(...area.polygon.map(p => p.lat)), maxLat: Math.max(...area.polygon.map(p => p.lat)),
  minLon: Math.min(...area.polygon.map(p => p.lon)), maxLon: Math.max(...area.polygon.map(p => p.lon)),
}));
const withinBounds = (point: Coordinate, index: number) => {
  const box = bounds[index];
  return point.lat >= box.minLat && point.lat <= box.maxLat && point.lon >= box.minLon && point.lon <= box.maxLon;
};
const cross = (a: Coordinate, b: Coordinate, c: Coordinate) => (b.lon-a.lon)*(c.lat-a.lat)-(b.lat-a.lat)*(c.lon-a.lon);
function onSegment(point: Coordinate, a: Coordinate, b: Coordinate): boolean {
  return Math.abs(cross(a,b,point)) < 1e-12 && point.lat >= Math.min(a.lat,b.lat)-1e-10 && point.lat <= Math.max(a.lat,b.lat)+1e-10
    && point.lon >= Math.min(a.lon,b.lon)-1e-10 && point.lon <= Math.max(a.lon,b.lon)+1e-10;
}
function intersects(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const x = cross(a,b,c), y = cross(a,b,d), u = cross(c,d,a), v = cross(c,d,b);
  return x*y < 0 && u*v < 0 || onSegment(c,a,b) || onSegment(d,a,b) || onSegment(a,c,d) || onSegment(b,c,d);
}

function contains(point: Coordinate, polygon: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onSegment(point,a,b)) return true;
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
export function isCoordinateAllowed(coordinate: Coordinate, vehicleId: VehicleId): boolean {
  return Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lon)
    && !RESTRICTED_AREAS.some((area,index) => applies(area,vehicleId) && withinBounds(coordinate,index) && contains(coordinate, area.polygon));
}
export function isPlaceAllowed(place: Landmark, vehicleId: VehicleId, graph: RoadGraph = ROAD_GRAPH): boolean {
  if (!isCoordinateAllowed(place, vehicleId)) return false;
  const allowed = getVehicleAccessGraph(graph,vehicleId);
  // Never "repair" a forbidden/disconnected POI by snapping it across a gate.
  return !!(place.nodeId && allowed.nodes[place.nodeId] && allowed.outgoing[place.nodeId]?.length);
}
export function isRoadEdgeAllowed(edge: RoadEdge, graph: RoadGraph, vehicleId: VehicleId): boolean {
  const points = edge.shape ?? [graph.nodes[edge.from], graph.nodes[edge.to]];
  if (!points.every(point => !!point && isCoordinateAllowed(point, vehicleId))) return false;
  // TD defines the closed section south of the Shek Mun Kap junction. Taxi
  // operation is also excluded there; the game issues no LCRP to private cars.
  if (/東涌道|Tung Chung Road/i.test(edge.name ?? '') && points.some(p => p.lat < 22.2697251)) return false;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    for (const [index,area] of RESTRICTED_AREAS.entries()) {
      if (!applies(area,vehicleId)) continue;
      const box=bounds[index];
      if (Math.max(a.lat,b.lat)<box.minLat || Math.min(a.lat,b.lat)>box.maxLat || Math.max(a.lon,b.lon)<box.minLon || Math.min(a.lon,b.lon)>box.maxLon) continue;
      for (let j=0;j<area.polygon.length;j++) if (intersects(a,b,area.polygon[j],area.polygon[(j+1)%area.polygon.length])) return false;
    }
  }
  return true;
}

/** Keep one mutually reachable driving world after access gates cut the graph. */
function largestComponent(graph: RoadGraph): Set<string> {
  const visited=new Set<string>(),order:string[]=[];
  const reverse:Record<string,string[]>={};
  for (const id of Object.keys(graph.nodes)) reverse[id]=[];
  for (const edge of Object.values(graph.edges)) reverse[edge.to]?.push(edge.from);
  for (const start of Object.keys(graph.nodes)) {
    if (visited.has(start)) continue;
    visited.add(start);const stack:Array<{id:string;index:number}>=[{id:start,index:0}];
    while (stack.length) {
      const top=stack[stack.length-1],out=graph.outgoing[top.id] ?? [];
      if (top.index>=out.length) {order.push(top.id);stack.pop();continue;}
      const edge=graph.edges[out[top.index++]];
      if (edge && !visited.has(edge.to)) {visited.add(edge.to);stack.push({id:edge.to,index:0});}
    }
  }
  visited.clear();let largest:string[]=[];
  for (let i=order.length-1;i>=0;i--) {
    const start=order[i];if (visited.has(start)) continue;
    visited.add(start);const component:string[]=[],stack=[start];
    while (stack.length) {const id=stack.pop()!;component.push(id);for (const next of reverse[id] ?? []) if (!visited.has(next)) {visited.add(next);stack.push(next);}}
    if (component.length>largest.length) largest=component;
  }
  return new Set(largest);
}
const graphCache = new WeakMap<RoadGraph, Map<string, RoadGraph>>();
export function getVehicleAccessGraph(graph: RoadGraph, vehicleId: VehicleId): RoadGraph {
  let cache = graphCache.get(graph);
  if (!cache) { cache = new Map(); graphCache.set(graph, cache); }
  const key = vehicleAccessProfile(vehicleId);
  let result = cache.get(key);
  if (!result) {
    const edges = Object.fromEntries(Object.entries(graph.edges).filter(([, edge]) => isRoadEdgeAllowed(edge, graph, vehicleId)));
    if (Object.keys(edges).length===Object.keys(graph.edges).length) {cache.set(key,graph);return graph;}
    const outgoing = Object.fromEntries(Object.keys(graph.nodes).map(id => [id, (graph.outgoing[id] ?? []).filter(edgeId => !!edges[edgeId])]));
    const keep=largestComponent({nodes:graph.nodes,edges,outgoing});
    result = {
      nodes:Object.fromEntries(Object.entries(graph.nodes).filter(([id])=>keep.has(id))),
      edges:Object.fromEntries(Object.entries(edges).filter(([,edge])=>keep.has(edge.from)&&keep.has(edge.to))),
      outgoing:Object.fromEntries([...keep].map(id=>[id,outgoing[id].filter(edgeId=>keep.has(edges[edgeId].to))])),
    };
    // Engine entry points may receive an already-filtered graph. It is a fixed
    // point for this profile; do not scan every edge again during catalogue prep.
    graphCache.set(result,new Map([[key,result]]));
    cache.set(key, result);
  }
  return result;
}
export function getVehicleRoadGraph(vehicleId: VehicleId, graph: RoadGraph = ROAD_GRAPH): RoadGraph {
  return getVehicleAccessGraph(graph, vehicleId);
}
