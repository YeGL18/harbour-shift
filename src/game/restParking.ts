import {findRoute,pointOnEdge,routeLength,routeMinutes,speedKph} from './routing';
import {SpatialIndex} from './spatial';
import {isSafeStoppingEdge} from './systems';
import type {GameState,Landmark,RoadEdge,RoadGraph} from './types';
const parkingName=/停車場|停车场|car\s*park|carpark|parking/i;
const restrictedName=/專用|专用|私人|私家|住客|居民|員工|员工|保留|貨車|货车|貨櫃|货柜|巴士|電單車|电单车|單車|单车|reserved|private|residents?|staff|goods|lorry|truck|container|\bbus\b|motor\s*cycle|\bbike\b/i;
const dangerous=/tunnel|motorway|expressway|trunk|arterial|primary|secondary|collector|roundabout|快速|隧道|highway|公路|幹線|大橋|走廊|天橋|高架|迴旋|回旋|交匯|環島|圓環/i;
const indexes=new WeakMap<Landmark[],SpatialIndex<Landmark>>();
const roadIndexes=new WeakMap<RoadGraph,{incoming:Map<string,RoadEdge[]>;designated:SpatialIndex<Landmark>}>();
export const REST_PARKING_SEARCH_METRES=8000;
export const REST_PARKING_SETTLE_MINUTES=.15;
export function isStrictRestApproach(edge:RoadEdge):boolean {
  return !dangerous.test(`${edge.roadClass||''} ${edge.name||''}`)&&isSafeStoppingEdge(edge)&&speedKph(edge)<=35&&(!edge.roadClass||/^(local|residential|service|access|parking|unclassified|tertiary)$/i.test(edge.roadClass));
}
export function isDesignatedParkingRoad(edge:RoadEdge):boolean {
  return isStrictRestApproach(edge)&&!restrictedName.test(edge.name||'')&&(edge.roadClass==='parking'||parkingName.test(edge.name||''));
}
function parkingPlaces(places:Landmark[]):SpatialIndex<Landmark>{let index=indexes.get(places);if(!index){index=new SpatialIndex(places.filter(place=>parkingName.test(`${place.name} ${place.nameEn||''}`)&&!restrictedName.test(`${place.name} ${place.nameEn||''}`)));indexes.set(places,index);}return index;}
function roads(graph:RoadGraph){let index=roadIndexes.get(graph);if(index)return index;const incoming=new Map<string,RoadEdge[]>(),designated:Landmark[]=[];for(const edge of Object.values(graph.edges)){if(isStrictRestApproach(edge)){const entries=incoming.get(edge.to)||[];entries.push(edge);incoming.set(edge.to,entries);}if(isDesignatedParkingRoad(edge))designated.push({...graph.nodes[edge.to],id:`parking-road-${edge.id}`,nodeId:edge.to,name:edge.name||'停車場',district:'',kind:'transport'});}index={incoming,designated:new SpatialIndex(designated)};roadIndexes.set(graph,index);return index;}
export interface RestParkingPlan {target:Landmark;route:string[];distanceM:number;minutes:number;alreadyInside:boolean}
/** Named official car-park road snaps are gameplay entrances, not a certification
 * of real-world admission, parking permission, vacancies, or building geometry. */
export function findRestParking(state:GameState,graph:RoadGraph,maxDistanceM=REST_PARKING_SEARCH_METRES):RestParkingPlan|null {
  const current=graph.edges[state.movement.edgeId];if(!current||maxDistanceM<=0)return null;
  const position=pointOnEdge(current,state.movement.distanceOnEdgeM/current.lengthM,graph);
  if(isDesignatedParkingRoad(current))return{target:{...position,id:`parking-current-${current.id}`,nodeId:current.to,name:current.name||'停車場',district:'',kind:'transport'},route:[],distanceM:0,minutes:0,alreadyInside:true};
  const index=roads(graph),remainder=Math.max(0,current.lengthM-state.movement.distanceOnEdgeM),limit=Math.min(REST_PARKING_SEARCH_METRES,maxDistanceM);
  if(remainder>limit)return null;
  const candidates=[...parkingPlaces(state.landmarks).nearby(position,limit,12),...index.designated.nearby(position,limit,4)];
  let best:RestParkingPlan|null=null;
  for(const place of candidates){if(!place.nodeId||!graph.nodes[place.nodeId]||!graph.outgoing[place.nodeId]?.some(id=>isStrictRestApproach(graph.edges[id])))continue;
    for(const edge of [...(index.incoming.get(place.nodeId)||[])].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,3)){
      const path=findRoute(current.to,edge.from,graph,'economy',undefined,{maxCost:Math.max(0,limit-remainder-edge.lengthM)});if(!path)continue;
      const route=[...path,edge.id],distanceM=remainder+routeLength(route,graph);if(distanceM>limit||best&&distanceM>=best.distanceM)continue;
      best={target:{...place,...graph.nodes[place.nodeId],id:place.id,nodeId:place.nodeId,name:place.name},route,distanceM,minutes:remainder/(speedKph(current)*1000/60)+routeMinutes(route,graph),alreadyInside:false};
    }
  }
  return best;
}
