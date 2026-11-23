import type { Coordinate, RoadGraph } from '../game/types';
import source from '../../assets/map/roads.json';

type RoadRow = [string, string, number, number, number, number[][]];
const rows = source.roads as RoadRow[];
const nodeKey = (p: number[]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
export function distanceMetres(a: Coordinate, b: Coordinate): number {
  const r = Math.PI / 180;
  const y = (b.lat - a.lat) * r;
  const x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) * .5 * r);
  return Math.hypot(x, y) * 6371000;
}
const graph: RoadGraph = { nodes: {}, edges: {}, outgoing: {} };
for (const [id, rawName, direction, elevation, routeNumber, coordinates] of rows) {
  const name=!rawName || /^[–－−-]?[９9]{2}$/.test(rawName) ? '連接路' : rawName;
  const from = nodeKey(coordinates[0]);
  const to = nodeKey(coordinates[coordinates.length - 1]);
  const points = coordinates.map(([lon, lat]) => ({ lat, lon }));
  for (const [key, p] of [[from, points[0]], [to, points[points.length - 1]]] as const) {
    if (!graph.nodes[key]) {
      graph.nodes[key] = { id: key, ...p, name };
      graph.outgoing[key] = [];
    }
  }
  let lengthM = 0;
  for (let i = 1; i < points.length; i++) lengthM += distanceMetres(points[i - 1], points[i]);
  const roadClass = elevation < 0 || name.includes('隧道') ? 'tunnel' : routeNumber ? 'arterial' : 'local';
  const add = (reversed: boolean) => {
    const edgeId = `td-${id}${reversed ? '-r' : '-f'}`;
    const a = reversed ? to : from, b = reversed ? from : to;
    graph.edges[edgeId] = {
      id: edgeId, from: a, to: b, lengthM: Math.max(.1, lengthM), name, roadClass,elevation,
      // Conservative gameplay proxy; this does not certify a legal roadside stop.
      safeStop: elevation === 0 && routeNumber === 0 && !/公路|大橋|天橋|幹線|走廊|隧道|交流道|高架|快速/.test(name),
      speedKph: roadClass === 'tunnel' ? 45 : roadClass === 'arterial' ? 38 : 25,
      shape: reversed ? [...points].reverse() : points,
    };
    graph.outgoing[a].push(edgeId);
  };
  if (direction === 1 || direction === 3) add(false);
  if (direction === 1 || direction === 2) add(true);
}

/** Official TD geometry, directions respected; largest strongly connected component. */
export const ROAD_GRAPH = graph;
export const MAP_BOUNDS = source.bounds;
export const MAP_DATA_CREDIT = '© 香港政府｜運輸署・地政總署｜DATA.GOV.HK・CSDI';
export const MAP_SOURCE_URL = 'https://portal.csdi.gov.hk/geoportal/?datasetId=td_rcd_1638949160594_2844&lang=en';
export function nearestRoadNode(position: Coordinate): string {
  let best = '', nearest = Infinity;
  for (const n of Object.values(graph.nodes)) {
    const d = distanceMetres(n, position);
    if (d < nearest) { nearest = d; best = n.id; }
  }
  return best;
}
