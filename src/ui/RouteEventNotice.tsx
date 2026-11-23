import React from 'react';
import {View} from 'react-native';
import {LocalizedText as Text,LocalizedPressable as Pressable,getLocalizedPlaceName} from '../i18n';
import type {RouteEvent} from '../game/types';
import type {Palette} from './theme';
import {Icon} from './components';
import {sounds} from '../audio/sounds';

/** Precaution only: ignored cards still slow/stop safely in the engine. */
export function RouteEventNotice({event,clockMinutes,rerouteAvailable,onChoice,colors:c}:{event:RouteEvent;clockMinutes:number;rerouteAvailable:boolean;onChoice:(choice:'stay'|'reroute')=>void;colors:Palette}){
 if(event.expiresAt<=clockMinutes||event.resolved&&event.choice!=='stay'||event.resolved&&!event.blockingUntil)return null;
 const blocked=event.blockingStartsAt!==undefined&&clockMinutes>=event.blockingStartsAt&&event.blockingUntil!==undefined&&clockMinutes<event.blockingUntil;
 return <View testID="route-event-notice" style={{backgroundColor:c.surface,borderRadius:14,borderCurve:'continuous',padding:12,gap:8}}>
   <View style={{flexDirection:'row',gap:8,alignItems:'center'}}><Icon name={{ios:'exclamationmark.triangle',android:'warning'}} color={c.secondary} size={18}/><View style={{flex:1,gap:3}}><Text maxFontSizeMultiplier={1.3} style={{color:c.text,fontSize:14,fontWeight:'600'}}>{event.title}</Text><Text translate={false} numberOfLines={1} style={{color:c.secondary,fontSize:12}}>{getLocalizedPlaceName({name:event.roadName})}</Text></View></View>
   <Text maxFontSizeMultiplier={1.3} style={{color:c.secondary,fontSize:12,lineHeight:18}}>{blocked?'自動等候路面暢通':event.description}</Text>
   {!event.resolved&&<View style={{flexDirection:'row',gap:8}}>{(['stay',...(rerouteAvailable?['reroute']as const:[])]as const).map(choice=><Pressable key={choice} testID={`route-event-${choice}`} accessibilityRole="button" onPress={()=>{sounds.playCue('select');onChoice(choice);}} style={{minHeight:44,flex:1,justifyContent:'center',alignItems:'center',backgroundColor:c.muted,borderRadius:10,borderCurve:'continuous',paddingHorizontal:10}}><Text maxFontSizeMultiplier={1.3} style={{color:c.text,fontSize:14,fontWeight:'500'}}>{choice==='stay'?(event.kind==='cattle'||event.kind==='dog'?'減速等候':'沿路行'):'改道'}</Text></Pressable>)}</View>}
 </View>;
}
