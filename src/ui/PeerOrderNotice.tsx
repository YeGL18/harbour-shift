import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { SharedDispatchAssignment } from '../../shared/protocol';
import { LocalizedText as Text, getLocalizedPlaceName, useLocale } from '../i18n';
import { createPeerNoticeCache, peerNoticeNamespace, selectPeerNotice, type PeerNoticeEvent } from '../multiplayer/peerNotice';
import { money, type Palette } from './theme';
import { PRICING_LABEL } from './pricing';

export interface PeerOrderNoticeProps {
  assignments:SharedDispatchAssignment[];
  ownPlayerId:string;
  roomCode:string;
  serverTime:number;
  colors:Palette;
}
const memory=createPeerNoticeCache();
const realNow=()=>typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();

/** Informational only: peer events never replace or intercept the player's offer. */
export function PeerOrderNotice({assignments,ownPlayerId,roomCode,serverTime,colors:c}:PeerOrderNoticeProps){
  useLocale();
  const [visible,setVisible]=useState<PeerNoticeEvent|null>(null);
  const foreground=useRef(AppState.currentState!=='background'&&AppState.currentState!=='inactive');
  const refresh=useRef<(()=>void)|null>(null);
  useEffect(()=>{
    const listener=AppState.addEventListener('change',state=>{foreground.current=state==='active';refresh.current?.();});
    return()=>listener.remove();
  },[]);
  useEffect(()=>{
    let mounted=true,timer:ReturnType<typeof setTimeout>|undefined;
    const namespace=peerNoticeNamespace(roomCode,ownPlayerId);
    const update=()=>{
      if(timer)clearTimeout(timer);
      if(!mounted)return;
      if(!roomCode||!ownPlayerId){setVisible(null);return;}
      const now=realNow();
      const state=selectPeerNotice(memory.read(namespace),assignments,{namespace,ownPlayerId,serverTime,now,foreground:foreground.current});
      memory.write(state);setVisible(state.current);
      if(state.current)timer=setTimeout(update,Math.max(1,state.current.expiresAt-now));
    };
    refresh.current=update;update();
    return()=>{mounted=false;if(timer)clearTimeout(timer);if(refresh.current===update)refresh.current=null;};
  },[assignments,ownPlayerId,roomCode,serverTime]);
  if(!visible||visible.namespace!==peerNoticeNamespace(roomCode,ownPlayerId))return null;
  const assignment=visible.assignment;
  const pickup=getLocalizedPlaceName({name:assignment.pickupName,nameEn:assignment.pickupNameEn});
  const destination=getLocalizedPlaceName({name:assignment.destinationName,nameEn:assignment.destinationNameEn});
  const pickupLocality=assignment.pickupLocality?getLocalizedPlaceName({name:assignment.pickupLocality,nameEn:assignment.pickupLocalityEn}):null;
  const destinationLocality=assignment.destinationLocality?getLocalizedPlaceName({name:assignment.destinationLocality,nameEn:assignment.destinationLocalityEn}):null;
  const fare=Number.isFinite(assignment.estimatedFare)&&assignment.estimatedFare!>=0?`HK$${money(assignment.estimatedFare!,2)}`:'—';
  return <View testID="peer-order-notice" pointerEvents="none" accessibilityLiveRegion="polite" style={[s.card,{backgroundColor:c.surface,borderColor:c.line}]}>
    <View style={s.header}>
      <View style={{flex:1,gap:3}}><Text numberOfLines={2} style={{color:c.text,fontSize:13,lineHeight:18,fontWeight:'600'}}><Text translate={false}>{assignment.nickname}</Text><Text> 接到附近一單</Text></Text>{assignment.pricingType?<Text style={{color:c.secondary,fontSize:11}}>{PRICING_LABEL[assignment.pricingType]}</Text>:null}</View>
      <Text translate={false} numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit minimumFontScale={.7} style={{maxWidth:'43%',color:c.text,fontSize:18,fontWeight:'600',fontVariant:['tabular-nums']}}>{fare}</Text>
    </View>
    <View style={{gap:7}}>{[
      {key:'pickup',name:pickup,locality:pickupLocality,color:'#009EA4'},
      {key:'destination',name:destination,locality:destinationLocality,color:c.blue},
    ].map(place=><View key={place.key} style={s.placeRow}><View style={[s.point,{borderColor:place.color,borderRadius:place.key==='pickup'?4:1}]}/><Text translate={false} numberOfLines={1} style={{flex:1,color:c.text,fontSize:13,fontWeight:'500'}}>{place.name}</Text>{place.locality?<View style={[s.locality,{backgroundColor:c.muted}]}><Text translate={false} numberOfLines={1} style={{color:c.secondary,fontSize:11}}>{place.locality}</Text></View>:null}</View>)}</View>
  </View>;
}
const s=StyleSheet.create({card:{borderWidth:StyleSheet.hairlineWidth,borderRadius:16,borderCurve:'continuous',padding:12,gap:9},header:{flexDirection:'row',alignItems:'flex-start',gap:10},placeRow:{flexDirection:'row',alignItems:'center',gap:7},point:{width:8,height:8,borderWidth:2},locality:{maxWidth:'42%',borderRadius:5,borderCurve:'continuous',paddingHorizontal:6,paddingVertical:3}});
