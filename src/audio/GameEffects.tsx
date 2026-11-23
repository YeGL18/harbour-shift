import React,{useEffect,useRef} from 'react';
import {AppState,StyleSheet,View} from 'react-native';
import {useGame} from '../GameProvider';
import {useMultiplayer} from '../MultiplayerProvider';
import {useScreenCorners} from '../map/useScreenCorners';
import {effectCue,isInPlayRoute,isActualSoloPause,type EffectState} from './cues';
import {sounds} from './sounds';

/** A decorative frame never consumes map, sheet or system-back interaction. */
export function GameEffects({routeName}:{routeName:string}) {
  const {game,online,paused,planning,shiftVisible,hydrated,soundEnabled,mapReady}=useGame();
  const mp=useMultiplayer(),corners=useScreenCorners();
  const previous=useRef<EffectState|null>(null),wasInPlay=useRef(false),lastError=useRef<string|null|undefined>(undefined);
  const session=online?`room:${mp.snapshot?.room.code}:${mp.snapshot?.you.playerId}`:`solo:${game?.driverSessionId??game?.seed??'none'}`;
  const inPlay=isInPlayRoute(!!game,routeName,wasInPlay.current);
  const loadingGate=!mapReady||online&&mp.snapshot?.room.status==='countdown'&&!!mp.snapshot.room.loading;
  const actuallyPaused=isActualSoloPause({hasGame:!!game,phase:game?.phase??'none',inPlay,online,loadingGate,paused,planning,shiftVisible});
  const state:EffectState={session,inPlay,paused:actuallyPaused,phase:game?.phase??'none',parking:game?.parking?.kind,servicing:game?.phase==='servicing'&&game.navigation?.kind!=='parking',completedTrips:game?.completedTrips??0,worldEventId:game?.worldEvent?.id};
  useEffect(()=>{
    wasInPlay.current=inPlay&&game?.phase!=='ended';
    if(loadingGate){previous.current=null;return;}
    const cue=effectCue(previous.current,state);
    if(hydrated&&soundEnabled&&AppState.currentState==='active'&&cue)sounds.playCue(cue);
    previous.current=state;
  },[session,inPlay,actuallyPaused,state.phase,state.parking,state.servicing,state.completedTrips,state.worldEventId,routeName,hydrated,soundEnabled,loadingGate]);
  useEffect(()=>{if(mp.error&&lastError.current!==undefined&&mp.error!==lastError.current&&inPlay&&soundEnabled)sounds.playCue('error');lastError.current=mp.error;},[mp.error,inPlay,soundEnabled]);
  if(!actuallyPaused)return null;
  return <View testID="game-paused-screen-border" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill,{zIndex:9999,borderWidth:2,borderColor:'#E43D38',borderCurve:'continuous',borderTopLeftRadius:corners.topLeft,borderTopRightRadius:corners.topRight,borderBottomLeftRadius:corners.bottomLeft,borderBottomRightRadius:corners.bottomRight}]}/>;
}
