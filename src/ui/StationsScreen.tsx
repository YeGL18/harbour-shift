import { getShiftDurationMinutes } from '../game/shiftDuration';
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LocalizedText as Text, LocalizedPressable as Pressable, getLocalizedPlaceName, useLocale } from '../i18n';
import { useGame } from '../GameProvider';
import {useMultiplayer} from '../MultiplayerProvider';
import { fuelQueueBaseline } from '../game/fuelQueue';
import { distanceMetres, getVehiclePosition, getHandoverPlan,getPhaseRemainingMinutes } from '../game';
import { getCompatibleStations, type EnergyStation } from '../data/serviceStations';
import type { RootStackParamList } from '../navigation';
import { Button,Icon } from './components';
import {chargingStationPresentation} from './chargingPresentation';
import {money} from './theme';

export function StationsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Stations'>) {
  useLocale();
  const controller = useGame(), { game, colors: c } = controller;
  const mp=useMultiplayer();
  const [sort, setSort] = useState<'nearest' | 'cheapest'>('nearest');
  useLayoutEffect(() => navigation.setOptions({ headerRight: () => <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.text, fontSize: 17 }}>完成</Text></Pressable> }), [navigation, c]);
  const position = game ? getVehiclePosition(game) : undefined;
  const stations = useMemo(() => game && position ? getCompatibleStations(game.vehicleId).map(station => ({ station, distance: distanceMetres(position, station) })).sort((a, b) => sort === 'cheapest' ? (game.energy.kind==='charge'&&game.energy.unitPriceOverride!==undefined?0:(a.station.unitPrice ?? Infinity) - (b.station.unitPrice ?? Infinity)) || a.distance - b.distance : a.distance - b.distance) : [], [game?.vehicleId,game?.energy.unitPriceOverride, position?.lat, position?.lon, sort]);
  const handover = game?.handoverPlace;
  // A blinded destination is a structural pickup proxy, never an arrival/ETA
  // input. Keep known station prices/distances and the existing choice locks.
  const blindPreboard=controller.blindOrders&&!!game&&(!!game.queuedTrip||!!game.activeTrip&&!Number.isFinite(game.activeTrip.pickedUpAt));
  const pinned = useMemo(() => handover ? [...stations].sort((a, b) => distanceMetres(handover, a.station) - distanceMetres(handover, b.station))[0] : undefined, [stations, handover]);
  const returnPlan = useMemo(() => game && pinned && !blindPreboard ? getHandoverPlan(game, undefined, pinned.station) : undefined, [blindPreboard,game?.queuedTrip?.offer.id,game?.activeTrip?.offer.id,game?.activeTrip?.pickedUpAt,game?.phase,game?.vehicleId, game ? Math.floor(game.clockMinutes / 2) : 0, pinned?.station.id, handover]);
  if (!game) return null;
  const charge=game.energy.kind==='charge',session=game.chargingSession;
  const charging=charge&&game.navigation?.kind==='charge'&&game.navigation.stage==='servicing'&&!!session;
  const networkBusy=controller.online&&(mp.connection!=='connected'||!!mp.pending);
  const activePort=charge&&game.navigation?.kind==='charge'?chargingStationPresentation(game.vehicleId,game.navigation.target as EnergyStation,game.energy.unitPriceOverride):null;
  const idle = ['cruising','service-route','fuel-queue'].includes(game.phase) && !game.activeTrip && !game.queuedTrip && !game.deadlineSettlement && game.clockMinutes<getShiftDurationMinutes(game);
  const unit = charge||game.energy.kind === 'swap' ? 'kWh' : 'L';
  const row = ({ station, distance }: { station: EnergyStation; distance: number }, isPinned = false) => {
    const port=charge?chargingStationPresentation(game.vehicleId,station,game.energy.unitPriceOverride):null;
    const queue = charge||blindPreboard?undefined:fuelQueueBaseline(station, game.startTimeMinutes + game.clockMinutes + distance / 500);
    return <Pressable key={isPinned ? `pinned-${station.id}` : station.id} testID={isPinned ? 'station-near-handover' : `station-${station.id}`} accessibilityRole="button" disabled={!idle||charge&&networkBusy} onPress={() => { controller.station(station); navigation.popTo('Shift'); }} style={[s.station, { backgroundColor: c.surface, borderColor: isPinned ? c.blue : c.line, opacity: idle&&(!charge||!networkBusy) ? 1 : .5 }]}>
    <View style={{ flex: 1, gap: 5 }}>
      {isPinned && <Text style={{ color: c.blue, fontSize: 12, fontWeight: '600' }}>離交更地點最近</Text>}
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{getLocalizedPlaceName(station)}</Text>
      <Text style={{ color: c.secondary, fontSize: 12 }}>{station.district} · 距離你 {(distance / 1000).toFixed(1)} 公里{!charge&&station.unitPrice != null ? ` · $${station.unitPrice.toFixed(2)}/${unit}` : ''}</Text>
      {port&&<><Text style={{color:c.text,fontSize:13}}>{port.connector} · {port.modelledPower?`遊戲估算 ${port.powerKw} kW`:`額定功率 ${port.powerKw} kW`}</Text><Text style={{color:c.secondary,fontSize:12}}>{port.priceSource==='custom'?`本更自訂 $${port.unitPrice.toFixed(2)}/kWh`:port.priceSource==='official-reference'?`官方參考 $${port.unitPrice.toFixed(2)}/kWh · ${port.priceAsOf??'—'}`:`遊戲參考 $${port.unitPrice.toFixed(2)}/kWh`}</Text></>}
      {isPinned && handover && <Text style={{ color: c.secondary, fontSize: 12 }}>距交更點 {(distanceMetres(station, handover) / 1000).toFixed(1)} 公里</Text>}
      {!charge&&<Text style={{ color: c.secondary, fontSize: 12 }}>{station.dedicated ? '專用氣站' : '服務站'}{station.priceAsOf ? ` · 價格參考 ${station.priceAsOf}` : ' · 遊戲參考價'}</Text>}
      {queue&&<Text style={{ color: queue.peakTurnover ? c.blue : c.secondary, fontSize: 12 }}>估計輪候 {Math.ceil(queue.waitMinutes)} 分鐘{queue.peakTurnover ? ' · 交更高峰' : ''}</Text>}
    </View><Icon name={{ ios: 'chevron.right', android: 'chevron_right' }} size={16} color={c.secondary}/>
  </Pressable>; };
  return <FlatList contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={s.content} data={stations.filter(item => sort !== 'nearest' || item.station.id !== pinned?.station.id)} keyExtractor={item => item.station.id} renderItem={({ item }) => row(item)} ItemSeparatorComponent={() => <View style={{ height: 10 }}/>} ListHeaderComponent={<View style={{ gap: 12, marginBottom: 12 }}>
    <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>{charge?'充電站':game.energy.kind === 'swap' ? '換電站' : game.energy.kind === 'lpg' ? '入氣站' : '油站'}</Text>
    {charging&&session&&<View testID="stations-charge-progress" style={[s.chargeStatus,{backgroundColor:c.surface}]}>
      <View style={s.statusRow}><Text style={{color:c.text,fontSize:17,fontWeight:'600'}}>充電中</Text><Text style={{color:c.text,fontSize:20,fontWeight:'600',fontVariant:['tabular-nums']}}>{Math.round(game.energy.remaining/game.energy.capacity*100)}%</Text></View>
      <Text numberOfLines={2} style={{color:c.secondary,fontSize:13}}>{getLocalizedPlaceName(game.navigation!.target)}</Text>
      {activePort&&<Text style={{color:c.secondary,fontSize:12}}>{activePort.connector} · 遊戲估算 {session.powerKw} kW</Text>}
      {activePort&&<Text style={{color:c.secondary,fontSize:12}}>{activePort.priceSource==='custom'?`本更自訂 $${session.unitPrice.toFixed(2)}/kWh`:activePort.priceSource==='official-reference'?`官方參考 $${session.unitPrice.toFixed(2)}/kWh · ${activePort.priceAsOf??'—'}`:`遊戲參考 $${session.unitPrice.toFixed(2)}/kWh`}</Text>}
      <Text style={{color:c.text,fontSize:14,fontVariant:['tabular-nums']}}>已充 {session.deliveredKWh.toFixed(1)} kWh · 已付 HK${money(session.billedCost,2)}</Text>
      <Text style={{color:c.secondary,fontSize:12}}>餘下約 {Math.ceil(getPhaseRemainingMinutes(game))} 分鐘遊戲時間</Text>
      <Button testID="stations-stop-charging" title="停止充電" cue="cancel" colors={c} secondary disabled={networkBusy} onPress={()=>{controller.stopCharging();navigation.popTo('Shift');}}/>
    </View>}
    <Text style={{ color: c.secondary, fontSize: 13, lineHeight: 20 }}>{charge?'已按車輛篩選接頭。距離為直線估算，功率為遊戲估算；泊車及會員費未計。':'選擇服務站導航，抵達後按次序輪候。距離為直線估算，價格屬遊戲參考。'}</Text>
    <View style={[s.segment, { backgroundColor: c.muted }]}>{(['nearest', 'cheapest'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: value === sort }} onPress={() => setSort(value)} style={[s.option, { backgroundColor: value === sort ? c.surface : c.muted }]}><Text style={{ color: c.text }}>{value === 'nearest' ? '最近' : '最平參考價'}</Text></Pressable>)}</View>
    {returnPlan && !returnPlan.canFinishRefuelAndReturn && <Text style={{ color: c.blue, fontSize: 13 }}>{charge?'時間緊迫：充電及回程可能趕唔切交更，請先檢查交更點。':'時間緊迫：入氣輪候及回程可能趕唔切交更，請先檢查交更點。'}</Text>}
    {!idle && <Text style={{ color: c.secondary, fontSize: 13 }}>{game.deadlineSettlement?'已逾交更時間，完成目前補給後收更。':charging?'停止充電後，可以選擇其他充電站。':'完成或取消目前行程後，先可以前往補給。'}</Text>}
    {sort === 'nearest' && pinned && row(pinned, true)}
    {!stations.length && <Text style={{ color: c.secondary }}>暫時未有適用嘅服務站。</Text>}
    </View>} />;
}
const s = StyleSheet.create({ content: { padding: 16, paddingBottom: 40, gap: 12 }, segment: { flexDirection: 'row', padding: 4, borderRadius: 12 }, option: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, station: { minHeight: 96, padding: 14, borderRadius: 14, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },chargeStatus:{padding:14,borderRadius:14,borderCurve:'continuous',gap:8},statusRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12} });
