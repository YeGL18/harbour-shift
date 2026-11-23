import React from 'react';
import { View } from 'react-native';
import type { GameState } from '../game/types';
import { eliteEnabled, isEliteOnlyShift } from '../game/elite';
import type { Palette } from './theme';
import { gameTime } from './theme';
import { LocalizedText as Text, LocalizedPressable as Pressable, getLocalizedPlaceName, t, useLocale } from '../i18n';
import { Icon } from './components';
/** A compact route to the separate schedule; never overlays a second immediate offer card. */
export function EliteBookingNotice({ state, colors: c, onOpen, disabled = false }: {
    state: GameState;
    colors: Palette;
    onOpen: () => void;
    disabled?: boolean;
}) {
    useLocale();
    const booking = state.eliteReservations?.find(item => ['accepted', 'travelling', 'waiting', 'in-trip'].includes(item.status)) || state.eliteReservations?.find(item => item.status === 'available');
    if (!booking && (!eliteEnabled(state) || !isEliteOnlyShift(state) || state.phase === 'ended'))
        return null;
    return <Pressable testID="elite-booking-notice" accessibilityRole="button" disabled={disabled} onPress={onOpen} style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.surface, opacity: pressed ? .7 : 1 })}>
  <Icon name={{ ios: 'calendar.badge.clock', android: 'event_available' }} size={19} color={c.blue}/>
  <View style={{ flex: 1, gap: 3 }}>
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>專屬預約（ELITE）</Text>
    {booking ? <Text translate={false} numberOfLines={1} style={{ color: c.secondary, fontSize: 12 }}>
      {gameTime(booking.pickupAt, state.startTimeMinutes)} · {getLocalizedPlaceName(booking.offer.pickup)}
    </Text> : <Text style={{ color: c.secondary, fontSize: 12 }}>未有合適預約</Text>}
  </View>
  <Text style={{ color: c.blue, fontSize: 13 }}>{booking?.status === 'available' ? '查看邀請' : '預約安排'}</Text>
 </Pressable>;
}
