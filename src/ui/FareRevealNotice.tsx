import React,{useEffect,useState} from 'react';
import {View} from 'react-native';
import {LocalizedText as Text} from '../i18n';
import type {FareReveal} from '../../shared/protocol';
import {selectFareReveal,type VisibleFareReveal} from './fareReveal';
import {money,type Palette} from './theme';
const history=new Map<string,Set<string>>();
export function FareRevealNotice({reveals,namespace,colors:c}:{reveals:FareReveal[];namespace:string;colors:Palette}) {
  const [visible,setVisible]=useState<(VisibleFareReveal&{namespace:string})|null>(null);
  useEffect(()=>{
    let seen=history.get(namespace);if(!seen){seen=new Set();history.set(namespace,seen);}
    while(history.size>16)history.delete(history.keys().next().value!);
    const next=selectFareReveal(reveals,seen,Date.now());
    if(next)setVisible({...next,namespace});
  },[namespace,reveals]);
  useEffect(()=>{if(!visible)return;const timer=setTimeout(()=>setVisible(null),Math.max(0,visible.expiresAt-Date.now()));return()=>clearTimeout(timer);},[visible]);
  if(!visible||visible.namespace!==namespace)return null;
  return <View testID="completed-fare-reveal" accessibilityLiveRegion="polite" style={{backgroundColor:c.surface,borderColor:c.line,borderWidth:1,borderRadius:16,borderCurve:'continuous',padding:14,gap:5}}>
    <Text maxFontSizeMultiplier={1.4} style={{color:c.secondary,fontSize:13}}>行程完成 · 車資已入帳</Text>
    <Text translate={false} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.6} style={{color:c.text,fontSize:23,fontWeight:'600',fontVariant:['tabular-nums']}}>HK${money(visible.reveal.amount,2)}</Text>
  </View>;
}
