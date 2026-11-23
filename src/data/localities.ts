import source from '../../assets/localities/anchors.json';
import districtSource from '../../assets/map/districts.json';
import type { Coordinate } from '../game/types';

export interface LocalityPoint extends Coordinate {district?:string}
export interface LocalityAnchor extends Coordinate {
  id:string;name:string;nameEn:string;district:string;districtCode:string;kind:'Area'|'Town'|'Island';sourceRecordId:string;sourceNameRecordId:number;
}
export interface LocalityDetails {
  name:string;
  nameEn?:string;
  district:string;
  method:'official-area-anchor'|'official-town-anchor'|'official-island-anchor'|'district-fallback';
  sourceRecordId?:string;
  distanceM?:number;
  /** Names/points are official; nearest-anchor coverage is a game approximation. */
  approximate:boolean;
}
export const LOCALITY_ANCHORS=source.anchors as LocalityAnchor[];
export const LOCALITY_SOURCE_URL='https://portal.csdi.gov.hk/geoportal/?lang=en&datasetId=landsd_rcd_1648571595120_89752';
export const LOCALITY_ATTRIBUTION=source.attribution;
type Polygon=number[][][];
type DistrictFeature={properties:{name:string;code:string};geometry:{type:'Polygon'|'MultiPolygon';coordinates:Polygon|Polygon[]}};
const districts=(districtSource.features as unknown as DistrictFeature[]).map(feature=>{
  const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates as Polygon[]:[feature.geometry.coordinates as Polygon];
  const points=polygons.flat(2);
  return {name:feature.properties.name,polygons,minLon:Math.min(...points.map(p=>p[0])),maxLon:Math.max(...points.map(p=>p[0])),minLat:Math.min(...points.map(p=>p[1])),maxLat:Math.max(...points.map(p=>p[1]))};
});
const districtNames=new Map(districts.flatMap(district=>[[district.name,district.name],[district.name.replace(/區$/,''),district.name]] as Array<[string,string]>));
const byDistrict=new Map<string,LocalityAnchor[]>();
for(const anchor of LOCALITY_ANCHORS){const group=byDistrict.get(anchor.district)??[];group.push(anchor);byDistrict.set(anchor.district,group);}

function inRing(point:Coordinate,ring:number[][]):boolean {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>point.lat)!==(b[1]>point.lat)&&point.lon<(b[0]-a[0])*(point.lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function districtAt(point:Coordinate):string|undefined {
  return districts.find(district=>point.lon>=district.minLon&&point.lon<=district.maxLon&&point.lat>=district.minLat&&point.lat<=district.maxLat
    && district.polygons.some(rings=>inRing(point,rings[0])&&!rings.slice(1).some(hole=>inRing(point,hole))))?.name;
}
function distance(a:Coordinate,b:Coordinate):number {
  const radians=Math.PI/180;
  return Math.hypot((a.lon-b.lon)*radians*Math.cos((a.lat+b.lat)*radians/2),(a.lat-b.lat)*radians)*6371000;
}
const cache=new Map<string,LocalityDetails>();
/** Deterministic fine-place label with explicit administrative-district fallback. */
export function getLocalityDetails(place:LocalityPoint,districtHint?:string):LocalityDetails {
  const hint=(districtHint??place.district??'').trim();
  if(!Number.isFinite(place.lat)||!Number.isFinite(place.lon))return{name:hint||'附近',district:hint,method:'district-fallback',approximate:false};
  const key=`${place.lat.toFixed(6)},${place.lon.toFixed(6)}:${hint}`;
  const existing=cache.get(key);if(existing)return existing;
  const district=districtNames.get(hint)||districtAt(place)||hint;
  let selected:LocalityAnchor|undefined,nearest=Infinity;
  for(const anchor of byDistrict.get(district)??[]){
    const metres=distance(place,anchor);
    const limit=anchor.kind==='Area'?4000:6000;
    if(metres>limit)continue;
    if(metres<nearest-.01||Math.abs(metres-nearest)<.01&&anchor.id<(selected?.id??'~')){selected=anchor;nearest=metres;}
  }
  const result:LocalityDetails=selected?{
    name:selected.name,nameEn:selected.nameEn,district,sourceRecordId:selected.sourceRecordId,distanceM:Math.round(nearest),
    method:selected.kind==='Town'?'official-town-anchor':selected.kind==='Island'?'official-island-anchor':'official-area-anchor',approximate:true,
  }:{name:district||hint||'附近',district:district||hint,method:'district-fallback',approximate:false};
  if(cache.size>=8192)cache.delete(cache.keys().next().value!);
  cache.set(key,result);return result;
}
export function getPlaceLocality(place:LocalityPoint,districtHint?:string):string {return getLocalityDetails(place,districtHint).name;}
