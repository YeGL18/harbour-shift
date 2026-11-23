import React from 'react';
import {View} from 'react-native';
import {LocalizedText as Text,LocalizedSwitch as Switch,t} from '../i18n';
import {sounds} from '../audio/sounds';
import type {Palette} from './theme';
import type {PricingType,VehicleId} from '../game/types';
import type {OrderPreferences} from '../../shared/orderPolicy';
import {allowedOrderPricingTypes,toggleOrderType} from '../game/orderPreferences';
import {vehicleSupportsXL} from '../game/vehicleCapabilities';
export const ORDER_TYPE_LABELS:Record<PricingType,string>={'private-upfront':'UberX','private-xl':'UberXL','taxi-metered':'的士咪錶','taxi-discount85':'的士咪錶 85 折','taxi-upfront':'的士預定價','private-elite':'專屬預約（ELITE）'};
export function BlindPreflightControl({value,onChange,colors:c,disabled=false,prefix='solo'}:{value:boolean;onChange:(value:boolean)=>void;colors:Palette;disabled?:boolean;prefix?:string}){
 return <View style={{gap:6}}><View style={{minHeight:52,flexDirection:'row',gap:12,alignItems:'center'}}><Text style={{flex:1,color:c.text,fontSize:15,fontWeight:'600'}}>盲單模式</Text><Switch testID={`${prefix}-blind-orders`} accessibilityLabel="盲單模式" value={value} disabled={disabled} trackColor={{false:c.line,true:c.blue}} onValueChange={next=>{sounds.playCue('select');onChange(next);}}/></View><Text style={{color:c.secondary,fontSize:12,lineHeight:19}}>只喺開更前揀。開啟後，目的地上車先見，車資完成先見；開更後唔可以改。</Text></View>;
}
export function OrderPreferencesEditor({value,onChange,vehicleId,eliteCertified,colors:c,disabled=false,prefix='solo'}:{value:OrderPreferences;onChange:(value:OrderPreferences)=>void;vehicleId:VehicleId;eliteCertified:boolean;colors:Palette;disabled?:boolean;prefix?:string}){
 const allowed=allowedOrderPricingTypes(vehicleId,eliteCertified),shown=[...allowed.filter(type=>type!=='private-elite'),...(vehicleSupportsXL(vehicleId)?['private-elite' as const]:[])];
 return <View testID={`${prefix}-order-preferences`} style={{padding:14,borderRadius:14,borderCurve:'continuous',backgroundColor:c.surface,gap:4}}><Text style={{color:c.text,fontSize:16,fontWeight:'600'}}>今更接咩單？</Text><Text style={{color:c.secondary,fontSize:12,lineHeight:19}}>普通單可以揀多種。專屬預約要獨立開更，唔會同其他單型混接。</Text>
  {shown.map(type=><View key={type} style={{minHeight:52,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:.5,borderColor:c.line}}><View style={{flex:1,gap:3}}><Text style={{color:c.text,fontSize:15}}>{ORDER_TYPE_LABELS[type]}</Text>{type==='private-elite'&&!eliteCertified?<Text style={{color:c.secondary,fontSize:12}}>通過商務資格課程先可以揀</Text>:type==='private-xl'?<Text style={{color:c.secondary,fontSize:12}}>只接車輛可載嘅 5–6 客單</Text>:null}</View><Switch testID={`${prefix}-order-${type}`} accessibilityLabel={t(ORDER_TYPE_LABELS[type])} value={value.enabledPricingTypes.includes(type)} disabled={disabled||!allowed.includes(type)} trackColor={{false:c.line,true:c.blue}} onValueChange={on=>{sounds.playCue('select');onChange(toggleOrderType(value,type,on));}}/></View>)}
  {!value.enabledPricingTypes.length?<Text style={{color:c.secondary,fontSize:12,lineHeight:19}}>未開啟任何單型，今更唔會派單。</Text>:null}<Text style={{color:c.secondary,fontSize:12,lineHeight:19}}>只影響新開一更；已開更嘅接單類型保持不變。</Text>
 </View>;
}
