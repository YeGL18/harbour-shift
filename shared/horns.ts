import type {RoadGraph} from '../src/game/types';

/** Game acoustic distances, not a real-world sound propagation measurement. */
export const HORN_LIMITS={audibleM:150,showM:200,hideM:230,leaseMs:3500,retentionMs:6000,minimumMs:300,maxRecords:32,refreshMs:1200} as const;
export interface HornAction {pressId:string;pressed:boolean}
export interface HornEvent {id:string;senderId:string;startedAt:number;activeUntil:number;endedAt?:number;gain:number}
export interface HornView {available:boolean;events:HornEvent[]}
export interface HornRoadPosition {edgeId:string;distanceOnEdgeM:number}
export const validHornPressId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id);
const roadName=(value?:string)=>value?.trim().replace(/\s+/g,'')||'';
const generic=(name:string)=>!name||name==='連接路'||name==='未命名道路';
const physicalEdge=(a:string,b:string)=>a.replace(/-[fr]$/,'')===b.replace(/-[fr]$/,'');
type Link={to:string;length:number};
const indices=new WeakMap<RoadGraph,Map<string,Map<string,Link[]>>>();
function corridorIndex(graph:RoadGraph,name:string,elevation:number):Map<string,Link[]> {
  const key=`${name}:${elevation}`;
  let byName=indices.get(graph);if(!byName){byName=new Map();indices.set(graph,byName);}let result=byName.get(key);if(result)return result;
  result=new Map();
  // Sound can travel in both directions, but only along connected geometry of
  // this named corridor. A two-dimensional crossing is not a connection.
  for(const edge of Object.values(graph.edges))if(roadName(edge.name)===name&&(edge.elevation??0)===elevation){for(const [from,to]of[[edge.from,edge.to],[edge.to,edge.from]]){const links=result.get(from)||[];links.push({to,length:edge.lengthM});result.set(from,links);}}
  byName.set(key,result);return result;
}
/** Conservative topology distance: no sound through an unconnected flyover. */
export function hornCorridorDistance(a:HornRoadPosition,b:HornRoadPosition,graph:RoadGraph,limit=HORN_LIMITS.hideM):number {
  const left=graph.edges[a.edgeId],right=graph.edges[b.edgeId];if(!left||!right)return Infinity;
  if((left.elevation??0)!==(right.elevation??0))return Infinity;
  const da=Math.max(0,Math.min(left.lengthM,a.distanceOnEdgeM)),db=Math.max(0,Math.min(right.lengthM,b.distanceOnEdgeM));
  if(left.id===right.id)return Math.abs(da-db);
  if(physicalEdge(left.id,right.id)&&left.from===right.to&&left.to===right.from)return Math.abs(da-(right.lengthM-db));
  const name=roadName(left.name);if(generic(name)||name!==roadName(right.name))return Infinity;
  const links=corridorIndex(graph,name,left.elevation??0),distances=new Map<string,number>([[left.from,da],[left.to,left.lengthM-da]]),pending=[left.from,left.to];let best=Infinity,visited=0;
  while(pending.length&&visited++<160){let at=0;for(let i=1;i<pending.length;i++)if(distances.get(pending[i])!<distances.get(pending[at])!)at=i;const node=pending.splice(at,1)[0],distance=distances.get(node)!;if(distance>limit||distance>=best)continue;
    if(node===right.from)best=Math.min(best,distance+db);if(node===right.to)best=Math.min(best,distance+right.lengthM-db);
    for(const link of links.get(node)||[]){const next=distance+link.length;if(next<=limit&&next<(distances.get(link.to)??Infinity)){distances.set(link.to,next);pending.push(link.to);}}
  }
  return best<=limit?best:Infinity;
}
export function hornGain(distanceM:number):number {return Number.isFinite(distanceM)&&distanceM<HORN_LIMITS.audibleM?Math.max(0,(1-distanceM/HORN_LIMITS.audibleM)**1.5):0;}
