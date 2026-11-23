import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { LocalizedText as Text,LocalizedPressable as Pressable } from '../i18n';
import type { Palette } from './theme';
import { estimatedRealMinutes, type ShiftDuration } from './shiftPresentation';
import { sounds } from '../audio/sounds';

export function ShiftDurationChoice({value,onChange,speed,colors:c,disabled=false,prefix='shift-duration'}:{value:ShiftDuration;onChange:(value:ShiftDuration)=>void;speed:number;colors:Palette;disabled?:boolean;prefix?:string}) {
  const {fontScale}=useWindowDimensions();
  return <View style={{gap:8}}>
    <Text style={{color:c.secondary,fontSize:13}}>更份長度</Text>
    <View style={{flexDirection:fontScale>1.7?'column':'row',gap:8}}>{([360,720,1440] as const).map(minutes=><Pressable key={minutes} testID={`${prefix}-${minutes}`} accessibilityRole="radio" accessibilityState={{checked:minutes===value,disabled}} onPress={()=>{if(minutes!==value){sounds.playCue('select');onChange(minutes);}}} disabled={disabled} style={({pressed})=>({flex:fontScale>1.7?undefined:1,minHeight:58,padding:8,gap:3,borderRadius:10,borderCurve:'continuous',alignItems:'center',justifyContent:'center',backgroundColor:minutes===value?c.blue:c.muted,opacity:disabled?.5:pressed?.7:1})}><Text style={{color:minutes===value?c.onBlue:c.text,fontSize:14,fontWeight:'600'}}>{minutes===360?'半更':minutes===720?'全更':'特更'}</Text><Text style={{color:minutes===value?c.onBlue:c.secondary,fontSize:12}}>{minutes/60} 小時</Text></Pressable>)}</View>
    <Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>基準約 {estimatedRealMinutes(value,speed)} 分鐘（{speed}×）</Text>
    <Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>{value===1440?'跨日工作，可自行休息；預設車租為早晚更合計。':value===720?'全更按所選開更時段，計算日更或夜更車租。':'半更預設車租五折；自訂金額維持不變。'}</Text>
  </View>;
}
