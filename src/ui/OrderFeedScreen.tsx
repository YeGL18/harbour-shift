import { LocalizedText as Text, LocalizedPressable as Pressable, useLocale, getLocalizedPlaceName } from '../i18n';
import React, { useLayoutEffect, useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGame } from '../GameProvider';
import { getVehiclePosition, distanceMetres } from '../game';
import type { RootStackParamList } from '../navigation';
import { gameTime, money } from './theme';
import { PRICING_LABEL } from './pricing';

export function OrderFeedScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'OrderFeed'>) {
  useLocale();
  const { game, colors: c, blindOrders } = useGame();
  useLayoutEffect(() => navigation.setOptions({ headerRight: () => <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} hitSlop={14}><Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>完成</Text></Pressable> }), [c, navigation]);
  const offers = useMemo(() => [...(game?.observedOffers ?? [])].sort((a, b) => b.createdAt - a.createdAt), [game?.observedOffers]);
  const position = game ? getVehiclePosition(game) : undefined;
  return <FlatList style={{ flex: 1, backgroundColor: c.background }} contentInsetAdjustmentBehavior="automatic" data={offers} keyExtractor={offer => offer.id} contentContainerStyle={{ paddingBottom: 40 }} ListHeaderComponent={<Text style={[s.explanation, { color: c.secondary }]}>附近需求會隨機一批批出現，離上客點超過 2.5 公里先移除。灰色單只供觀察，並非可預約訂單；派到你嘅接單卡先可以接。路程及金額為估算。</Text>} ListEmptyComponent={<Text style={[s.empty, { color: c.secondary }]}>附近暫未有新需求。停車等候或去另一區試吓。</Text>} renderItem={({ item }) => <View style={[s.card, { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={s.row}><Text style={[s.type, { color: c.secondary }]}>{PRICING_LABEL[item.pricingType]} · {gameTime(item.createdAt, game?.startTimeMinutes)}</Text><Text style={[s.fare, { color: c.secondary }]}>{blindOrders?'完成行程後顯示車資':`$${money(item.estimatedFare, 2)}`}</Text></View>
      <Text style={[s.route, { color: c.secondary }]}>{getLocalizedPlaceName(item.pickup)} → {getLocalizedPlaceName(item.destination)}</Text>
      <Text style={{ color: c.secondary, fontSize: 12 }}>{position ? `上客點 ${(distanceMetres(position, item.pickup) / 1000).toFixed(1)} 公里 · ` : ''}{blindOrders?'上車後顯示目的地':`${Math.ceil(item.tripMinutes)} 分鐘`} · 只供觀察</Text>
    </View>} />;
}
const s = StyleSheet.create({ explanation: { fontSize: 14, lineHeight: 22, padding: 20 }, empty: { padding: 24, textAlign: 'center', fontSize: 15 }, card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10, marginBottom: 12, marginHorizontal: 16 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, type: { flex: 1, fontSize: 12 }, fare: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] }, route: { fontSize: 16, lineHeight: 23 } });
