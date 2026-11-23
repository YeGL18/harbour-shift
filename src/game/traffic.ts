import type {Coordinate,GameState,RoadEdge,RoadGraph,ShiftDurationMinutes,VehicleId,WorldEvent} from './types';
import {seededRandom,stringHash} from './random';
import {cellFor,flatDistanceM} from './spatial';
import {defaultNextEdge,pointOnEdge,speedKph} from './routing';
import {getWorldEventSchedule} from '../../shared/worldEvents';
import {getShiftDurationMinutes} from './shiftDuration';

/** Simulated background traffic: never a live traffic feed or a room player. */
export interface TrafficWorld {seed:number;startTimeMinutes:number;clockMinutes:number;worldEvent?:WorldEvent;shiftDurationMinutes?:ShiftDurationMinutes}
export interface TrafficConditions {level:'free'|'building'|'congested';density:number;speedFactor:number}
export interface NpcTrafficVehicle {id:string;vehicleId:VehicleId;edgeId:string;distanceOnEdgeM:number;position:Coordinate&{heading:number};opacity:number}
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(n:number)=>{const x=clamp(n);return x*x*(3-2*x);};
const absoluteMinute=(world:TrafficWorld)=>world.startTimeMinutes+world.clockMinutes;
const inBox=(p:Coordinate,s:number,n:number,w:number,e:number)=>p.lat>=s&&p.lat<=n&&p.lon>=w&&p.lon<=e;
function urbanity(p:Coordinate):number {
  if(inBox(p,22.274,22.298,114.125,114.245)||inBox(p,22.286,22.353,114.135,114.245))return 1;
  if(inBox(p,22.35,22.425,114.09,114.22)||inBox(p,22.38,22.49,113.96,114.075)||inBox(p,22.42,22.49,114.14,114.20))return .7;
  return .25;
}
function temporalNoise(world:TrafficWorld,salt:number):number {
  const minute=absoluteMinute(world),slot=Math.floor(minute/30),t=smooth(minute/30-slot);
  return seededRandom(world.seed,slot,salt)*(1-t)+seededRandom(world.seed,slot+1,salt)*t;
}
/** Same seed, coordinate and shared virtual time => same congestion on every client/server. */
export function getTrafficConditions(world:TrafficWorld,p:Coordinate):TrafficConditions {
  const minute=absoluteMinute(world),hour=((minute%1440)+1440)%1440/60;
  const rush=Math.max(Math.exp(-Math.pow((hour-8.5)/1.25,2)),Math.exp(-Math.pow((hour-18)/1.6,2)));
  const urban=urbanity(p),cell=cellFor(p,4000);
  // Interpolate spatially too: crossing a grid boundary cannot instantaneously brake.
  const fx=p.lon*102980/4000-cell.x,fy=p.lat*111195/4000-cell.y;
  const noise=(x:number,y:number)=>temporalNoise(world,stringHash(`traffic:${x}:${y}`));
  const south=noise(cell.x,cell.y)*(1-smooth(fx))+noise(cell.x+1,cell.y)*smooth(fx);
  const north=noise(cell.x,cell.y+1)*(1-smooth(fx))+noise(cell.x+1,cell.y+1)*smooth(fx);
  const event=world.worldEvent,active=event&&world.clockMinutes>=event.startsAt&&world.clockMinutes<event.endsAt;
  const localEvent=active?Math.max(0,1-flatDistanceM(p,event.center)/Math.max(300,event.radiusM))*.48:0;
  const density=clamp(.04+.13*urban+(.2+.38*urban)*rush+.12*(south*(1-smooth(fy))+north*smooth(fy))+localEvent);
  const speedFactor=1-.54*smooth((density-.34)/.5);
  return {level:density>=.68?'congested':density>=.36?'building':'free',density,speedFactor};
}

const CELL_METRES=1000,LIFE_MINUTES=6,ROUTE_METRES=2600,MAX_NPCS=18,MAX_CACHED_ROUTES=2048;
interface TimedEdge {edgeId:string;start:number;end:number;speed:number}
interface TrafficIndex {cells:Map<string,RoadEdge[]>;routes:Map<string,string[]>;timings:Map<string,TimedEdge[]>}
const indexes=new WeakMap<RoadGraph,TrafficIndex>();
function indexFor(graph:RoadGraph):TrafficIndex {
  let index=indexes.get(graph);if(index)return index;
  index={cells:new Map(),routes:new Map(),timings:new Map()};
  for(const edge of Object.values(graph.edges)){
    if(!graph.nodes[edge.from]||!graph.nodes[edge.to]||edge.lengthM<2)continue;
    const a=graph.nodes[edge.from],b=graph.nodes[edge.to],key=cellFor({lat:(a.lat+b.lat)/2,lon:(a.lon+b.lon)/2},CELL_METRES).key;
    const entries=index.cells.get(key);if(entries)entries.push(edge);else index.cells.set(key,[edge]);
  }
  indexes.set(graph,index);return index;
}
function npcRoute(seed:number,first:RoadEdge,epoch:number,graph:RoadGraph,index:TrafficIndex):string[]{
  const key=`${seed}:${first.id}:${epoch}`;const known=index.routes.get(key);if(known)return known;
  const route=[first.id];let edge=first,length=first.lengthM;
  for(let i=0;i<48&&length<ROUTE_METRES;i++){
    const nextId=defaultNextEdge(edge.id,graph,route);if(!nextId)break;
    const exits=(graph.outgoing[edge.to]||[]).filter(id=>graph.edges[id]&&graph.edges[id].to!==edge.from&&!route.includes(id));
    const chosen=exits.length>1&&seededRandom(seed,epoch,stringHash(edge.id)+i)<.3?exits[Math.floor(seededRandom(seed,epoch,stringHash(edge.id)+i+71)*exits.length)]:nextId;
    edge=graph.edges[chosen];if(!edge||edge.from!==graph.edges[route.at(-1)!].to)break;
    route.push(edge.id);length+=edge.lengthM;
  }
  index.routes.set(key,route);if(index.routes.size>MAX_CACHED_ROUTES)index.routes.delete(index.routes.keys().next().value!);return route;
}
function npcPosition(world:TrafficWorld,spawn:number,route:string[],graph:RoadGraph,index:TrafficIndex,key:string,events:readonly WorldEvent[]):Pick<NpcTrafficVehicle,'edgeId'|'distanceOnEdgeM'|'position'>|undefined {
  let timing=index.timings.get(key);
  if(!timing){
    timing=[];let elapsed=0;
    for(const id of route){
      const edge=graph.edges[id],at=spawn-world.startTimeMinutes+elapsed;
      const event=events.find(event=>event.startsAt<=at&&event.endsAt>at);
      const speed=speedKph(edge)*1000/60*getTrafficConditions({...world,clockMinutes:at,worldEvent:event},graph.nodes[edge.from]).speedFactor;
      const end=elapsed+edge.lengthM/speed;timing.push({edgeId:id,start:elapsed,end,speed});elapsed=end;if(elapsed>LIFE_MINUTES)break;
    }
    index.timings.set(key,timing);if(index.timings.size>MAX_CACHED_ROUTES)index.timings.delete(index.timings.keys().next().value!);
  }
  const age=absoluteMinute(world)-spawn,entry=timing.find(entry=>entry.start<=age&&entry.end>age);if(!entry)return undefined;
  const edge=graph.edges[entry.edgeId],distance=(age-entry.start)*entry.speed,p=pointOnEdge(edge,distance/edge.lengthM,graph),ahead=pointOnEdge(edge,Math.min(edge.lengthM,distance+5)/edge.lengthM,graph),behind=pointOnEdge(edge,Math.max(0,distance-5)/edge.lengthM,graph);
  const heading=Math.atan2((ahead.lon-behind.lon)*Math.cos(p.lat*Math.PI/180),ahead.lat-behind.lat)*180/Math.PI;
  return {edgeId:edge.id,distanceOnEdgeM:distance,position:{...p,heading:Number.isFinite(heading)?heading:0}};
}
/** Local projection only; no NPC arrays/timers are stored in GameState or room JSON. */
export function getNearbyNpcTraffic(world:TrafficWorld,center:Coordinate,graph:RoadGraph,options:{radiusM?:number;limit?:number}={}):NpcTrafficVehicle[]{
  const radius=clamp(options.radiusM??1100,200,1600),limit=Math.floor(clamp(options.limit??MAX_NPCS,0,MAX_NPCS));if(!limit)return [];
  const index=indexFor(graph),cell=cellFor(center,CELL_METRES),reach=Math.ceil((radius+ROUTE_METRES)/CELL_METRES),minute=absoluteMinute(world),vehicles:NpcTrafficVehicle[]=[];
  const duration=getShiftDurationMinutes(world),schedule=getWorldEventSchedule(world.seed,duration,world.startTimeMinutes),custom=world.worldEvent&&!schedule.some(event=>event.id===world.worldEvent!.id)?world.worldEvent:undefined,events=custom?[...schedule,custom]:schedule;
  for(let x=cell.x-reach;x<=cell.x+reach;x++)for(let y=cell.y-reach;y<=cell.y+reach;y++)for(const edge of index.cells.get(`${x}:${y}`)||[]){
    const point=graph.nodes[edge.from];if(flatDistanceM(point,center)>radius+ROUTE_METRES)continue;
    const salt=stringHash(edge.id),offset=seededRandom(world.seed,salt,122)*LIFE_MINUTES,epoch=Math.floor((minute+offset)/LIFE_MINUTES),spawn=epoch*LIFE_MINUTES-offset;
    // Stable per-road trials: another vehicle/profile cannot alter this car's identity or path.
    const trial=seededRandom(world.seed,epoch,salt+817);if(trial>.067)continue;
    const bornAt=spawn-world.startTimeMinutes,birthEvent=events.find(event=>event.startsAt<=bornAt&&event.endsAt>bornAt);
    if(trial>.012+getTrafficConditions({...world,clockMinutes:bornAt,worldEvent:birthEvent},point).density*.055)continue;
    const route=npcRoute(world.seed,edge,epoch,graph,index),key=`${world.seed}:${edge.id}:${epoch}:${duration}:${world.startTimeMinutes}:${custom?.id||''}`,current=npcPosition(world,spawn,route,graph,index,key,events);if(!current||flatDistanceM(current.position,center)>radius)continue;
    const age=minute-spawn;
    vehicles.push({id:`npc-${world.seed}-${edge.id}-${epoch}`,vehicleId:(['kam-fung','little-treasure','red-flag']as const)[Math.floor(seededRandom(world.seed,epoch,salt+33)*3)],...current,opacity:Math.min(1,age/.2,(LIFE_MINUTES-age)/.2)});
  }
  return vehicles.sort((a,b)=>flatDistanceM(a.position,center)-flatDistanceM(b.position,center)||a.id.localeCompare(b.id)).slice(0,limit);
}
export function getLocalTrafficConditions(state:Pick<GameState,'seed'|'startTimeMinutes'|'clockMinutes'|'worldEvent'>,position:Coordinate):TrafficConditions{return getTrafficConditions(state,position);}
