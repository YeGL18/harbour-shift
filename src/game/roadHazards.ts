import type {Landmark,RoadEdge,RoadGraph,RouteEvent} from './types';
import type {TrafficWorld} from './traffic';
import {seededRandom,stringHash} from './random';
import {flatDistanceM} from './spatial';
import {pointOnEdge} from './routing';

export const ROAD_HAZARD_RULES={worldSlotMinutes:45,warningMinutes:5,ruralProbability:.0025,commercialProbability:.0015}as const;
/** Same physical road and shared time produce one shared precautionary event. */
export function roadHazardOnEdge(world:TrafficWorld,edge:RoadEdge,graph:RoadGraph,place?:Landmark):RouteEvent|null {
 if(edge.roadClass==='tunnel'||/隧道|高速|快速|motorway|tunnel/i.test(edge.name||'')||edge.lengthM<5)return null;
 const coordinate=pointOnEdge(edge,.5,graph);
 const rural=place?.waitingProfile?place.waitingProfile==='saikung':!!place?.district.includes('西貢')&&coordinate.lat>.345&&coordinate.lon>.25;
 const commercial=!!place&&(place.kind==='business'||place.kind==='shopping')&&flatDistanceM(place,coordinate)<450;
 if(!rural&&!commercial)return null;
 const absolute=world.startTimeMinutes+world.clockMinutes,slot=Math.floor(absolute/ROAD_HAZARD_RULES.worldSlotMinutes);
 const physical=edge.id.replace(/-(?:f|r)$/,''),salt=stringHash(`hazard:${physical}`);
 if(seededRandom(world.seed,slot,salt)> (rural?ROAD_HAZARD_RULES.ruralProbability:ROAD_HAZARD_RULES.commercialProbability))return null;
 const kind=rural?(seededRandom(world.seed,slot,salt+1)<.55?'cattle':'dog'):'pedestrian';
 const lingering=kind!=='pedestrian'&&seededRandom(world.seed,slot,salt+4)<(kind==='cattle'?.6:.35);
 const blockAt=slot*ROAD_HAZARD_RULES.worldSlotMinutes+8+seededRandom(world.seed,slot,salt+2)*20;
 const duration=lingering?(kind==='cattle'?4+seededRandom(world.seed,slot,salt+3)*5:1+seededRandom(world.seed,slot,salt+3)*3):.5+seededRandom(world.seed,slot,salt+3);
 const startsAt=blockAt-ROAD_HAZARD_RULES.warningMinutes,endsAt=blockAt+duration;
 if(absolute<startsAt||absolute>=endsAt)return null;
 const title=kind==='cattle'?'前方牛隻停留，請減速':kind==='dog'?'前方有狗隻，請減速':'前方行人較多，請慢行';
 return {id:`hazard-${world.seed}-${slot}-${physical}`,kind,title,description:kind==='pedestrian'?'自動慢行禮讓行人，亦可經合法路口改道。':lingering?'會自動減速及停車等候，待動物離開先通過；可選合法改道。':'自動減速，待動物離開路面後通過。',roadName:edge.name||'前方道路',affectedEdgeId:edge.id,coordinate,startedAt:startsAt-world.startTimeMinutes,expiresAt:endsAt-world.startTimeMinutes,resolved:false,speedFactor:kind==='pedestrian'?.22:.3,blockingStartsAt:lingering?blockAt-world.startTimeMinutes:undefined,blockingUntil:lingering?endsAt-world.startTimeMinutes:undefined};
}
/** Missing the card never causes a collision. A resolved stay choice still obeys the road. */
export function routeEventSpeedFactor(event:RouteEvent|null,edgeId:string,minute:number):number {
 if(!event||event.affectedEdgeId!==edgeId||event.expiresAt<=minute)return 1;
 if(event.blockingStartsAt!==undefined&&event.blockingUntil!==undefined&&minute>=event.blockingStartsAt&&minute<event.blockingUntil)return 0;
 return Math.max(.05,Math.min(1,event.speedFactor??.5));
}
