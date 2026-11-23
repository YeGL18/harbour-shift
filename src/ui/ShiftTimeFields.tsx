import React from 'react';
import { InputAccessoryView, Keyboard, Platform, View, useWindowDimensions } from 'react-native';
import { LocalizedText as Text, LocalizedTextInput as TextInput, LocalizedPressable as Pressable } from '../i18n';
import { parseShiftTime, shiftTimeRange } from '../multiplayer/time';
import type { Palette } from './theme';
import {Icon} from './components';

export function ShiftTimeFields({hour,minute,onHour,onMinute,colors:c,prefix='start',title='開更時間',disabled=false,compact=false,shiftDurationMinutes=720,explanation='24 小時制，例如 05:00。只影響新開一更。'}:{hour:string;minute:string;onHour:(value:string)=>void;onMinute:(value:string)=>void;colors:Palette;prefix?:string;title?:string;disabled?:boolean;compact?:boolean;shiftDurationMinutes?:360|720|1440;explanation?:string}){
  const {width,fontScale}=useWindowDimensions(),stacked=compact&&(fontScale>1.2||width<360);
  const time=parseShiftTime(hour,minute),range=time===undefined?undefined:shiftTimeRange(time,shiftDurationMinutes),accessory=prefix+'-time-keyboard';
  const inputStyle={minWidth:Math.max(compact?56:80,Math.ceil((compact?28:34)*fontScale+24)),minHeight:44,borderRadius:8,textAlign:'center' as const,paddingHorizontal:12,fontSize:compact?19:24,fontVariant:['tabular-nums' as const],color:c.text,backgroundColor:c.muted};
  return <View style={{gap:compact?6:10}}>
    {!compact&&<Text style={{color:c.text,fontSize:16,fontWeight:'600'}}>{title}</Text>}
    <View style={{flexDirection:stacked?'column':'row',alignItems:stacked?'stretch':'center',gap:10}}>
      {compact&&<Text style={{color:c.text,fontSize:14,fontWeight:'500',flex:stacked?undefined:1,flexShrink:1}}>{title}</Text>}
      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
      <View style={{gap:5}}>{!compact&&<Text style={{color:c.secondary,fontSize:12}}>小時</Text>}<TextInput testID={`${prefix}-hour-input`} accessibilityLabel="開更小時，00 至 23" inputAccessoryViewID={accessory} keyboardType="number-pad" maxLength={2} value={hour} onChangeText={onHour} placeholder="05" placeholderTextColor={c.secondary} selectTextOnFocus accessibilityState={{disabled}} editable={!disabled} style={[inputStyle,disabled&&{opacity:.5}]}/></View>
      <Text translate={false} maxFontSizeMultiplier={1} style={{color:c.secondary,fontSize:24,paddingTop:compact?0:14}}>:</Text>
      <View style={{gap:5}}>{!compact&&<Text style={{color:c.secondary,fontSize:12}}>分鐘</Text>}<TextInput testID={`${prefix}-minute-input`} accessibilityLabel="開更分鐘，00 至 59" inputAccessoryViewID={accessory} keyboardType="number-pad" maxLength={2} value={minute} onChangeText={onMinute} placeholder="00" placeholderTextColor={c.secondary} selectTextOnFocus accessibilityState={{disabled}} editable={!disabled} style={[inputStyle,disabled&&{opacity:.5}]}/></View>
      </View>
    </View>
    {!range?<Text testID={`${prefix}-time-error`} accessibilityLiveRegion="polite" style={{color:c.secondary,fontSize:13,lineHeight:20}}>請輸入有效時間：小時 00–23、分鐘 00–59。</Text>:<Text testID={prefix==='start'?'shift-finish-preview':`${prefix}-finish-preview`} style={{color:c.secondary,fontSize:13,lineHeight:20}}>{shiftDurationMinutes===360?'六小時交更：':shiftDurationMinutes===1440?'二十四小時交更：':'十二小時交更：'}{range.finish}{range.nextDay?'（翌日）':''}</Text>}
    {explanation&&!compact?<Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>{explanation}</Text>:null}
    {Platform.OS==='ios'?<InputAccessoryView nativeID={accessory}><View style={{backgroundColor:c.surface,alignItems:'flex-end',paddingHorizontal:16}}><Pressable accessibilityRole="button" accessibilityLabel="完成輸入時間" onPress={Keyboard.dismiss} style={{minHeight:44,minWidth:60,justifyContent:'center',alignItems:'center'}}><Text style={{color:c.blue,fontSize:17,fontWeight:'600'}}>完成</Text></Pressable></View></InputAccessoryView>:null}
  </View>;
}

/** Preserve the full label at accessibility sizes instead of squeezing it beside the clock. */
export function ShiftTimeSummary({title,value,expanded,onPress,colors:c}:{title:string;value:string;expanded:boolean;onPress:()=>void;colors:Palette}){
  const {width,fontScale}=useWindowDimensions(),stacked=fontScale>1.2||width<360;
  return <Pressable testID="edit-shift-time" accessibilityRole="button" accessibilityState={{expanded}} onPress={onPress} style={{paddingHorizontal:12,paddingVertical:8,minHeight:44,flexDirection:stacked?'column':'row',alignItems:stacked?'stretch':'center',gap:8}}>
    <Text style={{color:c.secondary,fontSize:13,flex:stacked?undefined:1,flexShrink:1}}>{title}</Text>
    <View style={{flexDirection:'row',alignItems:'center',gap:8,flexShrink:1}}><Text translate={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={{color:c.text,fontSize:15,fontWeight:'600',fontVariant:['tabular-nums'],flexShrink:1}}>{value}</Text><Icon name={{ios:expanded?'chevron.up':'chevron.down',android:expanded?'expand_less':'expand_more'}} color={c.secondary} size={15}/></View>
  </Pressable>;
}
