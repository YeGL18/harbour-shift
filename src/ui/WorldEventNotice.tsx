import React from 'react';
import {View} from 'react-native';
import {sounds} from '../audio/sounds';
import type {RoomWorldEvent} from '../../shared/protocol';
import type {GameState} from '../game/types';
import {canCruiseToWorldEvent,getWorldEventTarget} from '../game';
import {LocalizedText as Text,LocalizedPressable as Pressable,getLocalizedPlaceName,t,useLocale} from '../i18n';
import {gameTime,type Palette} from './theme';
import {Icon} from './components';

export function WorldEventNotice({events,clockMinutes,startTimeMinutes,game,onCruise,colors:c,compact=false,busy=false}:{events:RoomWorldEvent[];clockMinutes:number;startTimeMinutes:number;game?:GameState|null;onCruise?:(nodeId:string)=>void;colors:Palette;compact?:boolean;busy?:boolean}) {
  useLocale();
  const visible=events.filter(event=>event.endsAt>clockMinutes).slice(0,compact?1:2);
  if(!visible.length)return null;
  return <View testID="world-event-notice" style={{padding:compact?0:12,gap:8,borderRadius:12,borderCurve:'continuous',backgroundColor:c.surface}}>
    {visible.map((event,index)=>{
      const nodeId=game?getWorldEventTarget(game,event)?.nodeId:undefined;
      const canGo=!!game&&!!nodeId&&!!onCruise&&canCruiseToWorldEvent(game,event)&&!busy;
      const cruise=()=>{if(!canGo)return;sounds.playCue('select');onCruise!(nodeId!);};
      const title=getLocalizedPlaceName({name:event.title,nameEn:event.titleEn});
      const status=event.status==='active'?t('活動進行中'):t('活動預報');
      const start=gameTime(event.startsAt,startTimeMinutes),end=gameTime(event.endsAt,startTimeMinutes);
      if(compact)return <Pressable key={event.id} testID={canGo?'cruise-to-world-event':undefined} accessibilityRole={canGo?'button':undefined} accessibilityLabel={`${title} · ${status} · ${start}–${end}`} accessibilityHint={canGo?'巡遊去活動附近':undefined} disabled={!canGo} onPress={cruise} style={({pressed})=>({minHeight:44,paddingHorizontal:10,gap:6,flexDirection:'row',alignItems:'center',opacity:pressed?.7:1})}>
        <Icon name={{ios:'calendar',android:'event'}} color={c.blue} size={15}/>
        <Text translate={false} numberOfLines={1} style={{flex:1,color:c.text,fontSize:13,fontWeight:'600'}}>{title}</Text>
        <Text translate={false} style={{color:c.secondary,fontSize:11,fontVariant:['tabular-nums']}}>{event.status==='active'?end:start}</Text>
        {canGo?<Icon name={{ios:'chevron.right',android:'chevron_right'}} color={c.blue} size={15}/>:null}
      </Pressable>;
      return <View key={event.id} style={{gap:7,paddingTop:index?8:0,borderTopWidth:index?.5:0,borderColor:c.line}}>
        <View style={{flexDirection:'row',gap:8,alignItems:'center'}}><Icon name={{ios:'calendar',android:'event'}} color={c.blue} size={18}/><View style={{flex:1,gap:3}}><Text translate={false} numberOfLines={2} style={{color:c.text,fontSize:14,fontWeight:'600'}}>{title}</Text><Text translate={false} style={{color:c.secondary,fontSize:12}}>{status} · {start}–{end}</Text></View></View>
        <Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>遊戲模擬活動，唔係即時活動資訊；附近需求增加仍不保證派單。</Text>
        {canGo?<Pressable testID="cruise-to-world-event" accessibilityRole="button" onPress={cruise} style={({pressed})=>({minHeight:44,paddingHorizontal:12,borderRadius:10,borderCurve:'continuous',backgroundColor:c.muted,justifyContent:'center',alignItems:'center',opacity:pressed?.7:1})}><Text style={{color:c.blue,fontSize:14,fontWeight:'600'}}>巡遊去活動附近</Text></Pressable>:null}
      </View>;
    })}
  </View>;
}
