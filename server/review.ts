import type { Coordinate, GameState } from '../src/game/types';
import type { PlayerGameAction, PlayerMatchReview, ReviewTimelineEvent, TeamId } from '../shared/protocol';

export const REVIEW_SAMPLE_MINUTES=15;
export function reviewSampleMinutes(duration?:number):number{return duration===1440?30:REVIEW_SAMPLE_MINUTES;}
export const REVIEW_MAX_ROUTE_POINTS=65;
export const REVIEW_MAX_EVENTS=96;
export interface ReviewRecorder {
  route:Array<Coordinate&{minute:number}>;
  timeline:ReviewTimelineEvent[];
  timelineTruncated:boolean;
}
export function createReviewRecorder():ReviewRecorder{return{route:[],timeline:[],timelineTruncated:false};}
export function restoreReviewRecorder(value:ReviewRecorder|undefined):ReviewRecorder {
  if(!value)return createReviewRecorder();
  return{route:Array.isArray(value.route)?value.route.filter(point=>[point.lat,point.lon,point.minute].every(Number.isFinite)).slice(-REVIEW_MAX_ROUTE_POINTS):[],timeline:Array.isArray(value.timeline)?value.timeline.filter(event=>Number.isFinite(event.minute)&&typeof event.type==='string').slice(-REVIEW_MAX_EVENTS).map(event=>({...event,label:event.label?.slice(0,160)})):[],timelineTruncated:!!value.timelineTruncated||value.timeline?.length>REVIEW_MAX_EVENTS};
}
export function sampleReviewRoute(recorder:ReviewRecorder,state:GameState,position:Coordinate|undefined,force=false):void {
  if(!position||![position.lat,position.lon,state.clockMinutes].every(Number.isFinite))return;
  const last=recorder.route.at(-1);
  if(last&&Math.abs(last.minute-state.clockMinutes)<1e-7)return;
  if(last&&!force&&state.clockMinutes-last.minute<reviewSampleMinutes(state.shiftDurationMinutes)-1e-7)return;
  const point={lat:position.lat,lon:position.lon,minute:state.clockMinutes};
  if(recorder.route.length<REVIEW_MAX_ROUTE_POINTS)recorder.route.push(point);
  else recorder.route[REVIEW_MAX_ROUTE_POINTS-1]=point;
}
function append(recorder:ReviewRecorder,event:ReviewTimelineEvent):void {
  recorder.timeline.push({...event,label:event.label?.slice(0,160)});
  if(recorder.timeline.length>REVIEW_MAX_EVENTS){recorder.timeline.shift();recorder.timelineTruncated=true;}
}
/** Called only for a successfully executed, new command sequence. */
export function recordReviewAction(recorder:ReviewRecorder,before:GameState,after:GameState,action:PlayerGameAction):void {
  // A validated command can still be a canonical engine no-op (e.g. a passed fork).
  if(after===before)return;
  const previous=new Set(before.logs.map(entry=>entry.id));const log=after.logs.find(entry=>!previous.has(entry.id));
  const fare=(action.type==='accept'?before.currentOffer?.estimatedFare:undefined);
  append(recorder,{minute:after.clockMinutes,type:action.type,label:log?.text,amount:fare});
}
/** Exact engine completion logs retain their own event time within a bulk tick. */
export function recordReviewAdvance(recorder:ReviewRecorder,before:GameState,after:GameState):void {
  const previous=new Set(before.logs.map(log=>log.id));
  let acceptCount=Math.max(0,after.acceptedOffers-before.acceptedOffers);
  for(const log of [...after.logs].reverse()){
    if(previous.has(log.id))continue;
    if(log.kind==='dropoff')append(recorder,{minute:log.minute,type:'trip-completed',label:log.text,amount:log.amount});
    // Automatic acceptance is an engine decision; continuing a preaccepted trip
    // also emits an accept log, so only record an actual counter increase.
    if(log.kind==='accept'&&acceptCount>0){append(recorder,{minute:log.minute,type:'accept',label:log.text});acceptCount--;}
  }
  if(before.fuelQueue?.id!==after.fuelQueue?.id&&after.fuelQueue)append(recorder,{minute:after.fuelQueue.joinedAt,type:'queue-joined',label:after.navigation?.target.name});
  if(before.phase!=='servicing'&&after.phase==='servicing')append(recorder,{minute:after.clockMinutes,type:'service-started',label:after.navigation?.target.name});
  if(before.phase!=='ended'&&after.phase==='ended')append(recorder,{minute:after.clockMinutes,type:'shift-ended',label:after.shiftEndReason});
}
export function playerMatchReview(player:{id:string;nickname:string;teamId?:TeamId;forfeited:boolean;game:GameState|null;review?:ReviewRecorder}):PlayerMatchReview {
  const state=player.game;const review=restoreReviewRecorder(player.review);
  return{playerId:player.id,nickname:player.nickname,teamId:player.teamId,netIncome:state?.netIncome||0,grossIncome:state?.grossIncome||0,operatingCost:state?.operatingCost||0,rentalCost:state?.rentalCostApplied||0,idleMinutes:state?.idleMinutes||0,completedTrips:state?.completedTrips||0,acceptedOffers:state?.acceptedOffers||0,declinedOffers:state?.declinedOffers||0,cancelledTrips:state?.cancelledTrips||0,totalDistanceM:state?.totalDistanceM||0,forfeited:player.forfeited,route:review.route,timeline:review.timeline,timelineTruncated:review.timelineTruncated};
}
