import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Pressable,StyleSheet,type StyleProp,type ViewStyle} from 'react-native';
import * as Haptics from 'expo-haptics';
import {LocalizedText as Text,t} from '../i18n';
import {Icon} from './components';
import type {Palette} from './theme';
import {sounds} from '../audio/sounds';
import {HornPlayback} from '../audio/horns';
import {HORN_LIMITS,type HornAction,type HornView} from '../../shared/horns';

export interface MultiplayerHornButtonProps {
  view?:HornView;selfId:string;sessionKey:string;serverTime:number;receivedAt:number;
  enabled:boolean;soundEnabled:boolean;colors:Palette;style?:StyleProp<ViewStyle>;
  onHorn:(action:HornAction)=>void|Promise<void>;
}
/** The visual control and receiver live together, outside the map's native view. */
export function MultiplayerHornButton(props:MultiplayerHornButtonProps){
  const {view,selfId,sessionKey,serverTime,receivedAt,enabled,soundEnabled,colors:c,onHorn}=props;
  const [held,setHeld]=useState(false),current=useRef<string|null>(null),renew=useRef<ReturnType<typeof setInterval>|null>(null),lastRelease=useRef(0),sequence=useRef(0);
  const playback=useRef<HornPlayback|null>(null);if(!playback.current)playback.current=new HornPlayback(sounds);
  const latest=useRef(props);latest.current=props;
  const send=useCallback((action:HornAction)=>{try{void Promise.resolve(latest.current.onHorn(action)).catch(()=>{});}catch{/* Ephemeral horn failure never changes a trip or reconnect queue. */}},[]);
  const release=useCallback(()=>{const id=current.current;if(!id)return;current.current=null;lastRelease.current=Date.now();if(renew.current)clearInterval(renew.current);renew.current=null;sounds.stopHorn(`local:${id}`);send({pressId:id,pressed:false});setHeld(false);},[send]);
  const press=useCallback(()=>{
    if(current.current||!latest.current.enabled||!latest.current.view?.available)return;
    const id=`h-${Date.now().toString(36)}-${(++sequence.current).toString(36)}`;current.current=id;setHeld(true);sounds.startHorn(`local:${id}`,1);send({pressId:id,pressed:true});void Haptics.selectionAsync();
    renew.current=setInterval(()=>{if(current.current!==id)return;sounds.startHorn(`local:${id}`,1);send({pressId:id,pressed:true});},HORN_LIMITS.refreshMs);
  },[send]);
  useEffect(()=>{
    const update=()=>{const p=latest.current;if(!p.enabled||!p.soundEnabled||AppState.currentState!=='active'){playback.current!.stop();return;}playback.current!.sync(p.view,p.selfId,p.serverTime,p.receivedAt,Date.now());};
    update();const timer=setInterval(update,100);return()=>clearInterval(timer);
  },[]);
  useEffect(()=>{if(!enabled||!view?.available)release();},[enabled,view?.available,release]);
  useEffect(()=>{playback.current!.reset();return()=>{release();playback.current!.reset();sounds.stopAllHorns();};},[sessionKey,release]);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state!=='active'){release();playback.current!.stop();sounds.stopAllHorns();}});return()=>sub.remove();},[release]);
  if(!enabled||!view?.available)return null;
  return <Pressable testID="multiplayer-horn" accessibilityRole="button" accessibilityLabel={t('響號')} accessibilityHint={t('長按持續響號，鬆手停止')} accessibilityState={{selected:held}}
    onPressIn={press} onPressOut={release} onPress={()=>{if(!current.current&&Date.now()-lastRelease.current>500){press();setTimeout(release,HORN_LIMITS.minimumMs);}}}
    style={({pressed})=>[s.button,{backgroundColor:held?c.blue:c.surface,opacity:pressed ? .8 : 1},props.style]}>
    <Icon name={{ios:'speaker.wave.2.fill',android:'campaign'}} size={22} color={held?'#FFFFFF':c.text}/>
    <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={{fontSize:11,fontWeight:'600',color:held?'#FFFFFF':c.text}}>{t('響號')}</Text>
  </Pressable>;
}
const s=StyleSheet.create({button:{minWidth:56,minHeight:56,padding:7,borderRadius:28,borderCurve:'continuous',alignItems:'center',justifyContent:'center',gap:1}});
