import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LocalizedText as Text, LocalizedPressable as Pressable, getLocalizedPlaceName, getLocalizedLocality, useLocale } from '../i18n';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { Offer } from '../game';
import { Icon } from './components';
import { money, type Palette } from './theme';
import { PRICING_LABEL, isMetered } from './pricing';

export function OfferCard({ offer, privateCar, minutes, deadline, pausedAt, colors: c, bottomCorners, onAccept, onDecline, busy = false, automatic=false, blindOrders=false }: { offer: Offer; privateCar: boolean; minutes: number; deadline?:number|null; pausedAt?:number|null; colors: Palette; bottomCorners?: { borderBottomLeftRadius: number; borderBottomRightRadius: number }; onAccept: () => void; onDecline: () => void; busy?: boolean; automatic?:boolean; blindOrders?:boolean }) {
  useLocale();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.35;
  const reduceMotion = useReducedMotion();
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(pausedAt!=null)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),50);return()=>clearInterval(timer);},[offer.id,deadline,pausedAt]);
  const entrance = useSharedValue(0);
  useEffect(() => { entrance.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) })); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }, [offer.id, entrance]);
  const motion = useAnimatedStyle(() => ({ opacity: entrance.get(), transform: [{ translateY: reduceMotion ? 0 : (1 - entrance.get()) * 32 }] }));
  const effectiveNow=pausedAt??Math.max(now,Date.now());
  const remaining=deadline?Math.max(0,Math.min(1,(deadline-effectiveNow)/5000)):1;
  const seconds=Math.max(0,Math.min(5,Math.ceil((deadline?deadline-effectiveNow:5000)/1000)));
  return <Animated.View testID="offer-card" style={[s.card, { backgroundColor: c.surface, borderColor: c.line }, bottomCorners, motion]}>
    <View style={s.content}>
      <View style={[s.top, largeText && { minHeight: 44 }]}>
        <View style={s.badge}><Icon name={{ ios: 'person.fill', android: 'person' }} size={14} color="#FFFFFF" /><Text numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit minimumFontScale={.8} style={s.badgeText}>{PRICING_LABEL[offer.pricingType]}</Text></View>
        <Pressable accessibilityLabel="略過此訂單" disabled={busy} onPress={onDecline} style={({ pressed }) => [s.close, { backgroundColor: c.muted, opacity: pressed ? .6 : 1 }]}><Icon name={{ ios: 'xmark', android: 'close' }} size={24} color={c.text} /></Pressable>
      </View>
      {offer.serviceType==='xl' && offer.passengerCount !== undefined && <Text style={{color:c.secondary,fontSize:13}}>{offer.passengerCount} 位乘客</Text>}
      {offer.reservation === 'next-trip' && <Text maxFontSizeMultiplier={1.4} style={{ color: c.blue, fontSize: 13, fontWeight: '600' }}>單接單 · 目前乘客落車後前往</Text>}
      <Text numberOfLines={largeText ? 2 : 1} maxFontSizeMultiplier={1.5} style={[s.eta, { color: c.text }]}>{Math.max(1, Math.ceil(offer.pickupMinutes))} 分鐘 · {(offer.pickupDistanceM / 1000).toFixed(1)} 公里接客</Text>
      <View style={[s.route, { borderTopColor: c.line }, largeText && s.routeLarge]}>
        {largeText ? <>
          <View style={{ gap: 10 }}>
            {[{ key: 'pickup', place: offer.pickup, color: '#009EA4' }, ...(blindOrders?[]:[{ key: 'destination', place: offer.destination, color: c.blue }])].map(({ key, place, color }) => <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 12, paddingTop: 7 }}><View style={[key === 'pickup' ? s.pickupDot : s.dropoffDot, { borderColor: color }]}/></View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={2} maxFontSizeMultiplier={1.6} style={[s.address, { color: c.text, flex: undefined }]}>{getLocalizedPlaceName(place)}</Text><View style={[s.locality, { backgroundColor: c.muted, maxWidth: '100%', alignSelf: 'flex-start' }]}><Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: c.secondary, fontSize: 12 }}>{getLocalizedLocality(place)}</Text></View></View>
            </View>)}
          </View>
          {blindOrders&&<Text style={{color:c.secondary,fontSize:14}}>上車後顯示目的地</Text>}
          {!blindOrders&&<Text maxFontSizeMultiplier={1.3} style={[s.tripTime, { color: c.secondary, alignSelf: 'flex-end' }]}>{Math.ceil(offer.tripMinutes)} 分鐘</Text>}
        </> : <>
        <View style={s.routeSymbols}><View style={[s.pickupDot, { borderColor: '#009EA4' }]} /><View style={[s.routeConnector, { backgroundColor: c.line }]} /><View style={[s.dropoffDot, { borderColor: c.blue }]} /></View>
        <View style={s.routeNames}>
          <View style={s.placeRow}><Text numberOfLines={1} style={[s.address, { color: c.text }]}>{getLocalizedPlaceName(offer.pickup)}</Text><View style={[s.locality, { backgroundColor: c.muted }]}><Text numberOfLines={1} style={{ color: c.secondary, fontSize: 12 }}>{getLocalizedLocality(offer.pickup)}</Text></View></View>
          <View style={s.placeRow}>{blindOrders?<Text style={[s.address,{color:c.secondary}]}>上車後顯示目的地</Text>:<><Text numberOfLines={1} style={[s.address, { color: c.text }]}>{getLocalizedPlaceName(offer.destination)}</Text><View style={[s.locality, { backgroundColor: c.muted }]}><Text numberOfLines={1} style={{ color: c.secondary, fontSize: 12 }}>{getLocalizedLocality(offer.destination)}</Text></View></>}</View>
        </View>
        {!blindOrders&&<Text style={[s.tripTime, { color: c.secondary }]}>{Math.ceil(offer.tripMinutes)} 分鐘</Text>}
        </>}
      </View>
      <View style={s.legend}>{[{ key: 'pickup', color: '#009EA4', title: '前往上客' }, ...(blindOrders?[]:[{ key: 'trip', color: c.blue, title: '送客路線' }])].map(item=><View key={item.key} style={s.legendItem}><View style={[s.legendLine, { backgroundColor: item.color }]}/><Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ color: c.secondary, fontSize: 11, flexShrink: 1 }}>{item.title}</Text></View>)}</View>
    </View>
    <View style={[s.earnings, { borderTopColor: c.line }, largeText && s.earningsLarge]}><Text maxFontSizeMultiplier={1.4} style={[s.earningsLabel, { color: c.secondary }]}>{blindOrders?'完成行程後顯示車資':isMetered(offer.pricingType) ? '咪表參考金額' : '預計司機收入'}{!blindOrders&&offer.surge > 1 && !isMetered(offer.pricingType) ? ` · ${offer.surge.toFixed(2)}×` : ''}</Text>{!blindOrders&&<Text testID="offer-fare" numberOfLines={1} maxFontSizeMultiplier={1.6} adjustsFontSizeToFit minimumFontScale={.7} style={[s.fare, { color: c.text }, largeText && { alignSelf: 'flex-end' }]}>{`HK$${money(offer.estimatedFare, 2)}`}</Text>}</View>

    {automatic?<View testID="auto-accept-processing" accessibilityLiveRegion="polite" style={{minHeight:48,padding:14,alignItems:'center'}}><Text maxFontSizeMultiplier={1.4} style={{color:c.secondary,fontSize:15}}>自動接受訂單中…</Text></View>:<Pressable testID="accept-offer" accessibilityRole="button" accessibilityLabel={`接受訂單，餘下${seconds}秒`} disabled={busy||seconds===0} onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onAccept(); }} style={({ pressed }) => [s.accept, { backgroundColor: c.blue, opacity: busy ? .55 : pressed ? .8 : 1 }]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.onBlue, opacity: .13, left: `${remaining * 100}%` }]} />
      <Text numberOfLines={1} maxFontSizeMultiplier={1.5} style={[s.acceptText, { color: c.onBlue }]}>{busy ? '處理中…' : '接受'}</Text>
    </Pressable>}
  </Animated.View>;
}
const s = StyleSheet.create({
  card: { borderRadius: 28, borderCurve: 'continuous', borderWidth: 1, overflow: 'hidden', boxShadow: '0px 4px 24px rgba(0,0,0,0.12)' }, content: { padding: 16, paddingBottom: 8 }, top: { minHeight: 27, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, badge: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: '#111111', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 4, marginRight: 52, flexShrink: 1 }, badgeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flexShrink: 1 }, close: { position: 'absolute', right: 0, top: 0, width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  eta: { fontSize: 20, fontWeight: '600', marginTop: 10, paddingRight: 32 }, rating: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 }, ratingText: { fontSize: 16 }, distance: { marginLeft: 10, fontSize: 15 },
  route: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }, routeLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 5 }, routeSymbols: { width: 12, height: 46, alignItems: 'center', justifyContent: 'center' }, pickupDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 }, routeConnector: { width: 1.5, height: 24 }, dropoffDot: { width: 8, height: 8, borderRadius: 1, borderWidth: 2 }, routeNames: { flex: 1, minWidth: 0, gap: 10 }, address: { fontSize: 15, fontWeight: '500', flex: 1 }, placeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, locality: { maxWidth: '44%', borderRadius: 5, paddingVertical: 3, paddingHorizontal: 6 }, legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 5, marginTop: 8 }, legendItem: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 }, legendLine: { width: 16, height: 3, borderRadius: 2, flexShrink: 0 }, tripTime: { fontSize: 13 },
  earnings: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'space-between', gap: 10 }, earningsLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 4 }, earningsLabel: { fontSize: 13, flexShrink: 1 }, fare: { fontSize: 21, fontWeight: '600', fontVariant: ['tabular-nums'], maxWidth: '100%', flexShrink: 1 },
  pricingNote: { fontSize: 11, paddingHorizontal: 16, paddingBottom: 12 },
  accept: { marginHorizontal: 14, marginBottom: 12, minHeight: 48, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, acceptText: { fontSize: 20, fontWeight: '600' },
});
