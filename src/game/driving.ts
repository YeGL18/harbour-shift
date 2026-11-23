import type { DrivingAssist, GameState } from './types';

export const DRIVING_ASSIST = { approachMetres: 300, recoveryMetres: 200, minimumFactor: .72 } as const;
const smoothstep=(value:number)=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};

/** Smooth motion only: never changes the world clock, pauses, or holds a car. */
export function getDrivingSpeedFactor(state:Pick<GameState,'phase'|'totalDistanceM'|'drivingAssist'>):number {
  if(state.phase!=='cruising')return 1;
  const assist=state.drivingAssist; if(!assist)return 1;
  const minimum=DRIVING_ASSIST.minimumFactor;
  const approach=assist.approachingJunctionNodeId&&assist.approachDistanceM!==undefined?minimum+(1-minimum)*smoothstep(assist.approachDistanceM/DRIVING_ASSIST.approachMetres):1;
  const recovery=assist.crossedAtDistanceM!==undefined?minimum+(1-minimum)*smoothstep((state.totalDistanceM-assist.crossedAtDistanceM)/DRIVING_ASSIST.recoveryMetres):1;
  return Math.min(approach,recovery);
}
export function approachJunction(assist:DrivingAssist|undefined,junction?:{id:string;distanceM:number}):DrivingAssist {
  return {...assist,approachingJunctionNodeId:junction?.id,approachDistanceM:junction?.distanceM};
}
/** Call only when the movement actually reaches the selected junction node. */
export function crossedJunction(assist:DrivingAssist|undefined,nodeId:string,totalDistanceM:number):DrivingAssist {
  return {...assist,approachingJunctionNodeId:undefined,approachDistanceM:undefined,crossedJunctionNodeId:nodeId,crossedAtDistanceM:totalDistanceM};
}
