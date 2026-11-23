import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import roadData from '../../assets/map/roads.json';
import contextData from '../../assets/map/context-roads.json';
import baseData from '../../assets/map/base.json';
import { LANDMARKS } from '../data/landmarks';
import roadEnglish from '../../assets/map/road-names-en.json';
import localityAnchors from '../../assets/localities/anchors.json';

type Row = [string, string, number, number, number, number[][]];
const rows = [...roadData.roads, ...contextData.roads] as unknown as Row[];
const roadName=(name:string)=>!name || /^[–－−-]?[９9]{2}$/.test(name) ? '連接路' : name;
const roads: FeatureCollection<LineString> = {
  type: 'FeatureCollection', features: rows.map(([id, name, , elevation, routeNumber, coordinates]) => ({
    type: 'Feature', id, properties: { name:roadName(name), class: elevation < 0 || name.includes('隧道') ? 'tunnel' : routeNumber ? 'arterial' : 'local' },
    geometry: { type: 'LineString', coordinates },
  })),
};
// GeoJSONSource stringifies object data on every render. Its children change as
// React reconciles the map, so serialize static territory data once, not per tick.
export const nativeRoads = JSON.stringify(roads);
const polygons = (polys: number[][][][]): FeatureCollection<Polygon> => ({
  type: 'FeatureCollection', features: polys.map((coordinates, id) => ({ type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates } })),
});
export const nativeWater = JSON.stringify(polygons(baseData.water));
export const nativeGreen = JSON.stringify(polygons(baseData.green));
export const nativeBuildings = JSON.stringify(polygons(baseData.buildings));
const grid = new Map<string, { name: string; coordinates: number[]; weight: number }>();
for (const [, name, , , routeNumber, cs] of rows) {
  if (roadName(name) === '連接路' || cs.length < 2) continue;
  const coordinates = cs[Math.floor(cs.length / 2)];
  const weight = Math.hypot((cs[cs.length - 1][0] - cs[0][0]) * .92, cs[cs.length - 1][1] - cs[0][1]) * (routeNumber ? 2 : 1);
  const key = `${name}-${Math.floor(coordinates[0] * 170)}-${Math.floor(coordinates[1] * 170)}`;
  if (!grid.has(key) || grid.get(key)!.weight < weight) grid.set(key, { name, coordinates, weight });
}
const roadNames: FeatureCollection<Point> = {
  type: 'FeatureCollection', features: [...grid.values()].map((p, id) => ({ type: 'Feature', id, properties: { name: p.name, nameEn:(roadEnglish as Record<string,string>)[p.name]||p.name, rank: -p.weight }, geometry: { type: 'Point', coordinates: p.coordinates } })),
};
export const nativeRoadNames = JSON.stringify(roadNames);
const districts: Array<[string, number, number]> = [
  ['尖沙咀',22.298,114.174],['佐敦',22.3077,114.1717],['油麻地',22.3131,114.1739],['旺角',22.3199,114.1715],['深水埗',22.3301,114.161],['長沙灣',22.3382,114.1491],['荔枝角',22.3402,114.1378],['紅磡',22.3083,114.1872],['九龍城',22.329,114.1905],['九龍灣',22.3238,114.2138],['觀塘',22.3127,114.2254],['中環',22.2815,114.1552],['金鐘',22.2796,114.1656],['灣仔',22.2784,114.1756],['銅鑼灣',22.2798,114.1847],['北角',22.2911,114.2007],['香港仔',22.248,114.155],['赤柱',22.219,114.211],['維多利亞港',22.2892,114.176],['荃灣',22.37,114.114],['葵涌',22.365,114.133],['沙田',22.382,114.189],['大埔',22.45,114.168],['馬鞍山',22.425,114.231],['粉嶺',22.495,114.14],['上水',22.502,114.128],['元朗',22.444,114.026],['天水圍',22.456,114.004],['屯門',22.392,113.973],['西貢',22.382,114.272],['將軍澳',22.309,114.259],['東涌',22.289,113.941],['香港國際機場',22.31,113.918],['大澳',22.255,113.863],['昂坪',22.256,113.905],
];
const districtFeatures: FeatureCollection<Point> = {
  type: 'FeatureCollection', features: districts.map(([name, lat, lon], id) => ({ type: 'Feature', id, properties: { name, nameEn:localityAnchors.anchors.find(anchor=>anchor.name===name)?.nameEn||({ '佐敦':'Jordan','香港國際機場':'Hong Kong International Airport','維多利亞港':'Victoria Harbour','金鐘':'Admiralty' } as Record<string,string>)[name]||name }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
};
export const nativeDistricts = JSON.stringify(districtFeatures);
const places: FeatureCollection<Point> = {
  type: 'FeatureCollection', features: LANDMARKS.map(p => ({ type: 'Feature', id: p.id, properties: { name: p.name, nameEn:p.nameEn||p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
};
export const nativePlaces = JSON.stringify(places);

// Keep the large static Android sources owned by the C++ style, rather than
// Java GeoJsonSource wrappers whose finalizers can block under heavy parsing.
// This is assembled once from already serialized data, never per game tick.
const staticSources = {water:nativeWater,green:nativeGreen,buildings:nativeBuildings,roads:nativeRoads,'road-names':nativeRoadNames,places:nativePlaces,districts:nativeDistricts};
export const nativeAndroidStyle = process.env.EXPO_OS==='android' ? '{"version":8,"sources":{'+Object.entries(staticSources).map(([id,data])=>`${JSON.stringify(id)}:{"type":"geojson","maxzoom":14,"tolerance":1,"data":${data}}`).join(',')+'},"layers":[{"id":"background","type":"background","paint":{"background-color":"#F0F0ED"}}]}' : '';
