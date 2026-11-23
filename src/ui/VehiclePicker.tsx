import React from 'react';
import {StyleSheet,View,useWindowDimensions} from 'react-native';
import {LocalizedText as Text,LocalizedPressable as Pressable,getLocalizedPlaceName,t,useLocale} from '../i18n';
import {VEHICLES,getRentalCost} from '../data/vehicles';
import type {ShiftDurationMinutes,ShiftType,Vehicle,VehicleId} from '../game/types';
import {groupedVehicles,vehiclePickerDetails} from './vehiclePresentation';
import {CarIllustration} from './CarIllustration';
import {Icon} from './components';
import {sounds} from '../audio/sounds';
import {money,type Palette} from './theme';

/** Bounded 12-model catalogue; rows stay in the parent screen's native scroll. */
export function VehiclePicker({value,onChange,colors:c,dark=false,shift='day',duration=720,vehicles=VEHICLES,disabled=false,prefix='vehicle'}:{value:VehicleId;onChange:(id:VehicleId)=>void;colors:Palette;dark?:boolean;shift?:ShiftType;duration?:ShiftDurationMinutes;vehicles?:readonly Vehicle[];disabled?:boolean;prefix?:string}){
 useLocale();const {fontScale}=useWindowDimensions();
 return <View style={s.groups}>{groupedVehicles(vehicles).map(group=><View key={group.id} testID={`${prefix}-group-${group.id}`} style={{gap:6}}>
  <Text accessibilityRole="header" style={[s.heading,{color:c.secondary}]}>{group.label}</Text>
  <View style={[s.list,{backgroundColor:c.surface,borderColor:c.line}]}>{group.vehicles.map((vehicle,index)=>{
   const checked=vehicle.id===value,details=vehiclePickerDetails(vehicle),name=getLocalizedPlaceName(vehicle),capacity=t(`最多 ${details.capacity} 客`),energy=t(details.energyLabel),rent=getRentalCost(vehicle.id,shift,undefined,duration);
   const label=[name,capacity,energy,...(details.xl?['XL']:[]),`${t('車租')} HK$${money(rent)}`].join('，');
   return <Pressable key={vehicle.id} testID={`${prefix}-${vehicle.id}`} translate={false} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{checked,disabled}} disabled={disabled} onPress={()=>{if(!checked){sounds.playCue('select');onChange(vehicle.id);}}} style={({pressed})=>[s.row,{borderTopWidth:index?StyleSheet.hairlineWidth:0,borderTopColor:c.line,backgroundColor:pressed&&!disabled?c.muted:c.surface,opacity:disabled?.55:1}]}>
    {fontScale<=1.35&&<View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.art}><CarIllustration id={vehicle.id} width={66} dark={dark}/></View>}
    <View style={s.copy}><View style={s.titleRow}><Text translate={false} numberOfLines={fontScale>1.35?undefined:2} style={[s.name,{color:c.text}]}>{name}</Text>{details.xl&&<View style={[s.badge,{backgroundColor:c.muted}]}><Text translate={false} style={[s.badgeText,{color:c.text}]}>XL</Text></View>}</View>
     <View style={s.details}><Text translate={false} style={[s.detail,{color:c.secondary}]}>{capacity} · {energy}</Text><Text translate={false} style={[s.detail,{color:c.secondary,fontVariant:['tabular-nums']}]}>{t('車租')} HK${money(rent)}</Text></View>
    </View>
    <Icon name={{ios:checked?'checkmark.circle.fill':'circle',android:checked?'radio_button_checked':'radio_button_unchecked'}} color={checked?c.blue:c.secondary} size={22}/>
   </Pressable>;
  })}</View>
 </View>)}</View>;
}
const s=StyleSheet.create({groups:{gap:14},heading:{fontSize:12,fontWeight:'600',paddingHorizontal:4},list:{borderWidth:StyleSheet.hairlineWidth,borderRadius:12,borderCurve:'continuous',overflow:'hidden'},row:{minHeight:72,paddingVertical:10,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:10},art:{width:66,height:36,justifyContent:'center'},copy:{flex:1,minWidth:0,gap:4},titleRow:{flexDirection:'row',alignItems:'center',gap:6},name:{fontSize:15,fontWeight:'600',flexShrink:1},details:{flexDirection:'row',flexWrap:'wrap',columnGap:10,rowGap:2},detail:{fontSize:12,lineHeight:18,flexShrink:1,maxWidth:'100%'},badge:{paddingHorizontal:5,paddingVertical:2,borderRadius:4,borderCurve:'continuous'},badgeText:{fontSize:10,fontWeight:'700'}});
