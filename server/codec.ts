import { LANDMARK_BY_ID } from '../src/data/landmarks';
import type { GameState } from '../src/game/types';
/** Compact persistence only. The authenticated own-state wire response stays ordinary GameState. */
export function encodeState(state:GameState):string {
  return JSON.stringify(state,(key,value)=>{
    if(key==='landmarks') return undefined;
    if((key==='pickup'||key==='destination'||key==='handoverPlace')&&value&&LANDMARK_BY_ID.has(value.id)) return {$poi:value.id};
    return value;
  });
}
export function decodeState(json:string):unknown {
  return JSON.parse(json,(_key,value)=>{
    if(value&&typeof value==='object'&&typeof value.$poi==='string'&&Object.keys(value).length===1){const place=LANDMARK_BY_ID.get(value.$poi);if(!place)throw new Error('Unknown persisted POI');return place;}
    return value;
  });
}
