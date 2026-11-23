import type {Coordinate,GameState,Landmark,SurgeArea,WorldEvent} from './types';
import {seededRandom,stringHash} from './random';
import {cellFor,flatDistanceM} from './spatial';
import {getShiftDurationMinutes} from './shiftDuration';
import {worldEventDemandBoost} from './worldEvents';

export interface DemandContext {position?:Coordinate;landmarks?:readonly Landmark[];supply?:readonly{position:Coordinate;availableDrivers:number}[];demandPerMinute?:number;availableDrivers?:number;worldEvent?:WorldEvent;eventMinute?:number}
export interface DemandConditions {level:'quiet'|'normal'|'busy'|'surge';multiplier:number;arrivalWeight:number;requestIntervalMinutes:number;waitMinutesMin:number;waitMinutesMax:number;demandPerMinute:number;availableDrivers:number;intensity:number}
interface Anchor {id:string;name:string;center:Coordinate;density:number}
const anchorCache=new WeakMap<readonly Landmark[],Anchor[]>();
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const smooth=(value:number)=>{const x=clamp(value,0,1);return x*x*(3-2*x);};
function noise(seed:number,minute:number,salt:number):number {const period=Math.floor(minute/6),t=smooth(minute/6-period);return seededRandom(seed,period,salt)*(1-t)+seededRandom(seed,period+1,salt)*t;}

function anchorsFor(places:readonly Landmark[]):Anchor[]{let known=anchorCache.get(places);if(known)return known;
 const districts=new Map<string,Map<string,{lat:number;lon:number;weight:number;count:number}>>();
 for(const place of places){let cells=districts.get(place.district);if(!cells){cells=new Map();districts.set(place.district,cells);}const key=cellFor(place,3000).key;const cell=cells.get(key)||{lat:0,lon:0,weight:0,count:0};const w=place.kind==='transport'?2:place.kind==='shopping'?1.7:1;cell.lat+=place.lat*w;cell.lon+=place.lon*w;cell.weight+=w;cell.count++;cells.set(key,cell);}
 known=[];for(const[name,cells]of districts){const sorted=[...cells].sort((a,b)=>b[1].weight-a[1].weight||a[0].localeCompare(b[0]));let primary:Coordinate|undefined;let included=0;for(const[key,cell]of sorted){const center={lat:cell.lat/cell.weight,lon:cell.lon/cell.weight};if(primary&&flatDistanceM(primary,center)<4500)continue;if(primary&&cell.weight<sorted[0][1].weight*.12)continue;known.push({id:`demand-${name}-${key}`,name,center,density:clamp(Math.log2(cell.count+2)/8,.7,1.25)});primary??=center;if(++included>=2)break;}}
 anchorCache.set(places,known);return known;
}
function rawField(seed:number,minute:number,id:string,density=1):{demand:number;supply:number;peak:boolean}{const hour=((minute/60)%24+24)%24,peak=hour>=7&&hour<10||hour>=17&&hour<20,late=hour<6;const salt=stringHash(id);return{demand:Math.max(.35,(1+8.5*noise(seed,minute,salt+7)+(peak?2:0)-(late?1:0))*density),supply:1+7*noise(seed,minute,salt+19),peak};}

/** Game supply/demand model. These are simulated values, never live Uber data. */
export function conditionsFromSupplyDemand(demand:number,supply:number,peak=false):DemandConditions {demand=Math.max(0,demand);supply=Math.max(.25,supply);const ratio=demand/supply;
 const level=ratio<.65?'quiet':ratio<1.05?'normal':ratio<1.75?'busy':'surge';
 return{level,multiplier:level==='surge'?(peak?1.6:1.35):level==='busy'?1.15:1,arrivalWeight:demand<=0?0:clamp(.16+demand*.075,.16,.98),requestIntervalMinutes:demand<=0?Infinity:.75+4/(1+demand),
  waitMinutesMin:level==='quiet'?6:level==='normal'?3:1,waitMinutesMax:level==='quiet'?10:level==='normal'?7:level==='busy'?3:2,demandPerMinute:demand,availableDrivers:supply,intensity:clamp(ratio/2.4,.12,1)};
}
export function demandConditions(seed:number,absoluteMinute:number,district:string,context:DemandContext={}):DemandConditions {
 let id=district,density=1,falloff=1;
 if(context.position&&context.landmarks){let nearest:Anchor|undefined,distance=Infinity;for(const anchor of anchorsFor(context.landmarks)){if(anchor.name!==district)continue;const d=flatDistanceM(context.position,anchor.center);if(d<distance){nearest=anchor;distance=d;}}if(nearest){id=nearest.id;density=nearest.density;falloff=.45+.55*Math.exp(-Math.pow(distance/3800,2));}}
 const raw=rawField(seed,absoluteMinute,id,density);let supply=raw.supply;
 if(context.supply&&context.position)for(const driver of context.supply){const distance=flatDistanceM(context.position,driver.position);if(distance<4000)supply+=Math.max(0,driver.availableDrivers)*(1-smooth(distance/4000));}
 return conditionsFromSupplyDemand((context.demandPerMinute??raw.demand*falloff)*worldEventDemandBoost(context.worldEvent,context.position,context.eventMinute),context.availableDrivers??supply,raw.peak);
}
export function surgeAreasFor(state:GameState):SurgeArea[]{const minute=state.startTimeMinutes+state.clockMinutes;return anchorsFor(state.landmarks).map(anchor=>{const center=anchor.center;const c=demandConditions(state.seed,minute,anchor.name,{position:center,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:state.clockMinutes});return{id:anchor.id,name:anchor.name,center,...c,radiusM:Math.round((c.level==='surge'?3600:c.level==='busy'?2800:c.level==='normal'?2000:1400)*anchor.density),sampledAtMinute:minute};});}

export function nextTripEligibility(seed:number,tripId:string,district:string):boolean {
 const island=['中西區','灣仔區','東區','南區','Central and Western','Wan Chai','Eastern','Southern'].includes(district);
 return seededRandom(seed,stringHash(tripId),8331)<(island?.22:.04);
}
export function shouldDispatchNextTrip(state:GameState,remainingDistanceM:number,remainingMinutes=remainingDistanceM/250):boolean {if(state.phase!=='dropoff'&&state.phase!=='alighting'||!state.activeTrip||state.queuedTrip||state.currentOffer||!state.acceptingOrders||state.navigation||state.energyRecovery||state.energy.remaining<=0||state.platform.suspendedUntil>state.clockMinutes||state.clockMinutes>=getShiftDurationMinutes(state)||remainingDistanceM>700||remainingMinutes>3||state.nextTripOfferForTripId===state.activeTrip.offer.id||(state.nextTripOfferCooldownUntil??0)>state.clockMinutes)return false;const destination=state.activeTrip.offer.destination;if(!nextTripEligibility(state.seed,state.activeTrip.offer.id,destination.district))return false;const c=demandConditions(state.seed,state.startTimeMinutes+state.clockMinutes,destination.district,{position:destination,landmarks:state.landmarks,supply:state.demandSupply,worldEvent:state.worldEvent,eventMinute:state.clockMinutes});return c.level==='busy'||c.level==='surge';}
