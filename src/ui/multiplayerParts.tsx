import { LocalizedText as Text, LocalizedPressable as Pressable } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Palette } from './theme';
import { createNetworkTaskRunner } from './networkTask';
import { Icon } from './components';
import { sounds,type SoundCue } from '../audio/sounds';

export function MultiplayerPage({ children, colors, keyboard = false }: {children: React.ReactNode; colors: Palette; keyboard?: boolean}) {
  const inset = useSafeAreaInsets();
  return <KeyboardAvoidingView style={{flex:1,backgroundColor:colors.background}} behavior={keyboard && process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={{flex:1}} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content,{paddingBottom:Math.max(inset.bottom,20)+20}]}>{children}</ScrollView>
  </KeyboardAvoidingView>;
}

export function Group({children,colors,style}:{children:React.ReactNode;colors:Palette;style?:StyleProp<ViewStyle>}) {
  return <View style={[styles.group,{backgroundColor:colors.surface,borderColor:colors.line},style]}>{children}</View>;
}
export function SectionLabel({children,colors}:{children:React.ReactNode;colors:Palette}) {
  return <Text style={[styles.section,{color:colors.secondary}]}>{children}</Text>;
}
export function SupportingText({children,colors}:{children:React.ReactNode;colors:Palette}) {
  return <Text style={[styles.support,{color:colors.secondary}]}>{children}</Text>;
}
export function StatusMessage({title,detail,colors,busy=false,action,actionTitle,testID}:{title:React.ReactNode;detail?:string;colors:Palette;busy?:boolean;action?:()=>void;actionTitle?:string;testID?:string}) {
  return <View testID={testID} accessibilityLiveRegion="polite" style={[styles.notice,{backgroundColor:colors.muted}]}>
    <View style={{flexDirection:'row',gap:10,alignItems:'center'}}>{busy?<ActivityIndicator size="small" color={colors.blue}/>:<Icon name={{ios:'info.circle',android:'info'}} color={colors.secondary} size={20}/>}<Text style={{flex:1,color:colors.text,fontSize:15,fontWeight:'600',lineHeight:21}}>{title}</Text></View>
    {detail ? <Text style={[styles.support,{color:colors.secondary}]}>{detail}</Text> : null}
    {action&&actionTitle ? <Pressable accessibilityRole="button" onPress={action} style={styles.inlineAction}><Text style={{color:colors.blue,fontSize:15,fontWeight:'600'}}>{actionTitle}</Text></Pressable> : null}
  </View>;
}

export function NetworkAction({title,pendingTitle,onPress,disabled=false,pending=false,secondary=false,colors,testID,cue='tap'}:{title:string;pendingTitle?:string;onPress:()=>void;disabled?:boolean;pending?:boolean;secondary?:boolean;colors:Palette;testID?:string;cue?:SoundCue|false}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:disabled||pending,busy:pending}} testID={testID} disabled={disabled||pending} onPress={()=>{if(cue)sounds.playCue(cue);onPress();}} style={({pressed})=>[styles.action,{backgroundColor:secondary?colors.muted:colors.blue,opacity:disabled || pending ? .55 : pressed ? .75 : 1}]}>
    {pending ? <ActivityIndicator color={secondary?colors.text:colors.onBlue} size="small"/> : null}<Text style={{fontSize:17,fontWeight:'600',color:secondary?colors.text:colors.onBlue,textAlign:'center'}}>{pending?(pendingTitle??'處理中…'):title}</Text>
  </Pressable>;
}

export function ChoiceRow({title,detail,selected,onPress,disabled=false,colors,testID}:{title:string;detail?:string;selected:boolean;onPress:()=>void;disabled?:boolean;colors:Palette;testID?:string}) {
  return <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{checked:selected,disabled}} disabled={disabled} onPress={()=>{if(!selected){sounds.playCue('select');onPress();}}} style={({pressed})=>[styles.choice,{borderColor:selected?colors.blue:colors.line,backgroundColor:colors.surface,opacity:disabled ? .6 : pressed ? .7 : 1}]}>
    <View style={{flex:1,gap:4}}><Text style={{fontSize:16,fontWeight:'600',color:colors.text}}>{title}</Text>{detail?<Text style={[styles.support,{color:colors.secondary}]}>{detail}</Text>:null}</View>
    <Icon name={{ios:selected?'checkmark.circle.fill':'circle',android:selected?'radio_button_checked':'radio_button_unchecked'}} color={selected?colors.blue:colors.secondary} size={22}/>
  </Pressable>;
}

export function useNetworkTask() {
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const runner=useRef<ReturnType<typeof createNetworkTaskRunner>|null>(null);
  if(!runner.current)runner.current=createNetworkTaskRunner({busy:setBusy,error:setError});
  useEffect(()=>{runner.current!.mount();return()=>runner.current!.dispose();},[]);
  return {busy,error,run:runner.current.run,clearError:()=>{if(runner.current!.isMounted())setError(null);}};
}

export const multiplayerStyles = StyleSheet.create({
  title:{fontSize:27,fontWeight:'700',letterSpacing:-.6},
  heading:{fontSize:20,fontWeight:'600'},
  row:{flexDirection:'row',alignItems:'center',gap:12},
  field:{minHeight:52,borderRadius:10,borderCurve:'continuous',paddingHorizontal:14,fontSize:17},
  body:{fontSize:15,lineHeight:23},
  divider:{height:StyleSheet.hairlineWidth},
  link:{minHeight:44,justifyContent:'center'},
});
const styles=StyleSheet.create({
  content:{padding:16,gap:12},group:{borderRadius:14,borderCurve:'continuous',padding:12,gap:10,borderWidth:StyleSheet.hairlineWidth},
  section:{fontSize:13,fontWeight:'500',lineHeight:18},support:{fontSize:13,lineHeight:20},notice:{padding:16,borderRadius:12,borderCurve:'continuous',gap:8},inlineAction:{minHeight:44,justifyContent:'center'},
  action:{minHeight:52,borderRadius:12,borderCurve:'continuous',paddingVertical:14,paddingHorizontal:18,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:10},
  choice:{flex:1,minHeight:56,padding:12,borderRadius:12,borderCurve:'continuous',borderWidth:1.5,flexDirection:'row',alignItems:'center',gap:12},
});
