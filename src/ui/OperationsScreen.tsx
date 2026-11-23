import { getShiftDurationMinutes } from '../game/shiftDuration';
import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedSwitch as Switch, t, useLocale, getLocalizedPlaceName } from '../i18n';
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMultiplayer } from '../MultiplayerProvider';
import { useGame } from '../GameProvider';
import { getHandoverPlan, getVehiclePosition, getLocalDemandConditions, distanceMetres,getPhaseRemainingMinutes, VEHICLE_BY_ID } from '../game';
import {SERVICE_STATION_BY_ID,type EnergyStation} from '../data/serviceStations';
import type { RootStackParamList } from '../navigation';
import { Button, Divider, Icon } from './components';
import { duration, money } from './theme';
import { PRICING_LABEL } from './pricing';
import {chargingStationPresentation} from './chargingPresentation';

export function OperationsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Operations'>) {
  useLocale();
  const controller = useGame();
  const mp = useMultiplayer();
  const stats = mp.driverStats;
  const { game, colors: c } = controller;
  useLayoutEffect(() => navigation.setOptions({ headerRight: () => <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} hitSlop={14}><Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>完成</Text></Pressable> }), [c, navigation]);
  if (!game) return null;
  const localDemand = getLocalDemandConditions(game);
  const blindPreboard=controller.blindOrders&&(!!game.queuedTrip||!!game.activeTrip&&!Number.isFinite(game.activeTrip.pickedUpAt));
  const handoverPlan = blindPreboard?undefined:getHandoverPlan(game);
  const idle = game.phase === 'cruising' && !game.activeTrip;
  const charge=game.energy.kind==='charge',session=game.chargingSession;
  const charging=charge&&game.navigation?.kind==='charge'&&game.navigation.stage==='servicing'&&!!session;
  const chargeStation=game.navigation?.kind==='charge'?game.navigation.target as EnergyStation:undefined;
  const port=chargeStation?chargingStationPresentation(game.vehicleId,chargeStation,game.energy.unitPriceOverride):null;
  const networkBusy=controller.online&&(mp.connection!=='connected'||!!mp.pending);
  const energyLabel = charge||game.energy.kind === 'swap' ? '電量' : game.energy.kind === 'lpg' ? '石油氣' : '汽油';
  const unit = charge||game.energy.kind === 'swap' ? 'kWh' : 'L';
  const finishAction = (action: () => void) => { action(); navigation.goBack(); };
  const blocked = game.platform.suspendedUntil > game.clockMinutes;
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={s.content}>
    <Text style={[s.heading, { color: c.text }]}>{VEHICLE_BY_ID[game.vehicleId].name}</Text>
    <Text style={{ color: c.secondary, fontSize: 13 }}>{localDemand.district} · 模擬需求 {localDemand.multiplier.toFixed(2)}× · 約 {localDemand.waitMinutesMin}–{localDemand.waitMinutesMax} 分鐘派單</Text>
    {game.activeTrip && <View style={[s.group, { backgroundColor: c.surface }]}>
      <Text style={[s.label, { color: c.text }]}>{PRICING_LABEL[game.activeTrip.offer.pricingType]}{controller.blindOrders?' · 完成行程後顯示車資':` · 參考 HK$${money(game.activeTrip.offer.estimatedFare, 2)}`}</Text>
      <Text style={{ color: c.secondary, fontSize: 14 }}>{getLocalizedPlaceName(game.activeTrip.offer.pickup)} → {getLocalizedPlaceName(game.activeTrip.offer.destination)}</Text>
      <View style={[s.segment, { backgroundColor: c.muted }]}>{(['fastest','economy'] as const).map(policy => <Pressable key={policy} accessibilityRole="button" accessibilityState={{ selected: game.activeTrip?.routePolicy === policy }} disabled={game.phase === 'safe-dropoff'} onPress={() => controller.route(policy)} style={[s.option, game.activeTrip?.routePolicy === policy && { backgroundColor: c.surface }]}><Text style={{ color: c.text }}>{policy === 'fastest' ? '較快路線' : '較短路線'}</Text></Pressable>)}</View>
    </View>}
    <View style={[s.group, { backgroundColor: c.surface }]}>
      <View style={s.row}><Text style={[s.label, { color: c.text }]}>{energyLabel}</Text><Text style={[s.value, { color: c.text }]}>{Math.round(game.energy.remaining / game.energy.capacity * 100)}%</Text></View>
      <Button testID="operations-stations" title={charge?'選擇充電站':'選擇入氣／補給站'} cue="open" colors={c} secondary onPress={() => navigation.navigate('Stations')} />
      <View style={[s.energyTrack, { backgroundColor: c.muted }]}><View style={{ backgroundColor: c.blue, width: `${Math.min(100, game.energy.remaining / game.energy.capacity * 100)}%`, height: 5, borderRadius: 3 }}/></View>
      <Text style={{ color: c.secondary, fontSize: 13 }}>{game.energy.remaining.toFixed(1)} / {game.energy.capacity.toFixed(1)} {unit} · 本更行車成本 HK${money(game.operatingCost, 2)}</Text>
      {chargeStation&&port&&<View testID="operations-charge-status" style={{gap:7}}>
        <Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>{charging?'充電中':'前往充電站'} · {getLocalizedPlaceName(chargeStation)}</Text>
        <Text style={{color:c.secondary,fontSize:13}}>{port.connector} · {port.modelledPower?`遊戲估算 ${port.powerKw} kW`:`額定功率 ${port.powerKw} kW`}</Text>
        <Text style={{color:c.secondary,fontSize:13}}>{port.priceSource==='custom'?`本更自訂 $${port.unitPrice.toFixed(2)}/kWh`:port.priceSource==='official-reference'?`官方參考 $${port.unitPrice.toFixed(2)}/kWh · ${port.priceAsOf??'—'}`:`遊戲參考 $${port.unitPrice.toFixed(2)}/kWh`}</Text>
        {charging&&session&&<><Text style={{color:c.text,fontSize:14,fontVariant:['tabular-nums']}}>已充 {session.deliveredKWh.toFixed(1)} kWh · 已付 HK${money(session.billedCost,2)}</Text><Text style={note(c.secondary)}>供電 {session.gridKWh.toFixed(1)} kWh · 餘下約 {Math.ceil(getPhaseRemainingMinutes(game))} 分鐘遊戲時間</Text><Button testID="operations-stop-charging" title="停止充電" cue="cancel" colors={c} secondary disabled={networkBusy} onPress={()=>finishAction(controller.stopCharging)}/></>}
      </View>}
      {charge&&!session&&game.lastChargeReceipt&&<View testID="last-charge-receipt" style={{gap:5}}><Text style={{color:c.text,fontSize:14,fontWeight:'600'}}>{game.lastChargeReceipt.completed?'上次充電已完成':'上次充電已停止'}</Text><Text style={note(c.secondary)}>{getLocalizedPlaceName(SERVICE_STATION_BY_ID.get(game.lastChargeReceipt.stationId)??{name:game.lastChargeReceipt.stationName})}</Text><Text style={{color:c.secondary,fontSize:13}}>已充 {game.lastChargeReceipt.deliveredKWh.toFixed(1)} kWh · 已付 HK${money(game.lastChargeReceipt.billedCost,2)}</Text></View>}
      <Text style={note(c.secondary)}>{charge?'充電按供電量即時入帳，中途停止會保留已充電量及費用。初始隨車電量不另扣，交更前要補足。':'能源成本按實際耗用量計入本更；補充時唔會重複扣同一筆能源。若開更前自訂單價，本更補給亦用自訂價。'}</Text>
      {charge&&<Text style={note(c.secondary)}>充電時間及損耗屬遊戲模型；泊車、會員及閒置費未計。自訂單價優先。</Text>}
      {game.energy.remaining / game.energy.capacity <= .1 && !game.energyRecovery && <Button testID="energy-recovery" title="呼叫能源救援 · HK$250／30 分鐘" colors={c} secondary onPress={() => finishAction(controller.recoverEnergy)} />}
      {game.energyRecovery && <Text style={note(c.secondary)}>能源救援中，完成後補充約 20%，可再前往服務站。救援時間同費用屬遊戲設定。</Text>}
    </View>
    <View style={[s.group, { backgroundColor: c.surface }]}>
      <View style={s.row}><View style={{flex:1,gap:4}}><Text style={[s.label,{color:c.text}]}>自動接單</Text><Text style={{color:c.secondary,fontSize:12}}>收到合適訂單即自動接受，唔使撳藍色接單掣。</Text></View><Switch testID="auto-accept-switch" accessibilityLabel="自動接單" value={controller.autoAcceptEnabled} disabled={controller.autoAcceptPending||game.phase==='ended'||!!game.deadlineSettlement||(controller.online&&!!mp.pending)} onValueChange={controller.setAutoAcceptEnabled}/></View>
      <Divider colors={c}/>
      <View style={s.row}><View style={{ flex: 1, gap: 4 }}><Text style={[s.label, { color: c.text }]}>接受新訂單</Text><Text style={{ color: c.secondary, fontSize: 12 }}>{charging?'充電期間暫不派單':blocked ? `遊戲平台暫停派單，餘 ${duration(game.platform.suspendedUntil - game.clockMinutes)}` : game.acceptingOrders ? '可以派單，臨停期間亦可接' : '已暫停，現有行程繼續'}</Text></View><Switch testID="accepting-orders-switch" accessibilityLabel="接受新訂單" value={game.acceptingOrders} onValueChange={controller.accepting} /></View>
      <Divider colors={c}/>
      {game.parking ? <Button testID="resume-driving" title="立即開車" colors={c} onPress={() => finishAction(controller.drive)} /> : <Button testID="temporary-parking" title="臨時停車 · 最多五分鐘" colors={c} disabled={!idle} onPress={() => finishAction(controller.park)} />}
      <Button testID="rest-parking" title="停車休息" colors={c} secondary disabled={!idle} onPress={() => finishAction(controller.rest)} />
      {game.navigation?.kind==='parking'&&game.navigation.parkingKind==='rest'?<Text style={note(c.secondary)}>{game.navigation.stage==='servicing'?'正喺安全泊位停定':'前往安全休息點'}：{getLocalizedPlaceName(game.navigation.target)}</Text>:null}
      {['service-route', 'fuel-queue'].includes(game.phase) && <Button title="取消前往，繼續巡遊" cue="cancel" colors={c} secondary onPress={() => finishAction(controller.drive)} />}
      {game.cruiseTarget && <Button testID="cancel-cruise" title="取消巡航，繼續巡遊" cue="cancel" colors={c} secondary onPress={() => finishAction(controller.drive)} />}
      <Text style={note(c.secondary)}>停車時遊戲時間照行。休息期間暫停派單，開車後沿用原本接單設定；停止接單唔會停止行車或交更導航。</Text>
    </View>
    <View style={[s.group, { backgroundColor: c.surface }]}>
      <Text style={[s.label, { color: c.text }]}>累積派單紀錄</Text>
      <View style={s.row}><Text style={{ color: c.secondary }}>接單率</Text><Text style={[s.value, { color: c.text }]}>{stats.offered ? `${(stats.acceptanceRate * 100).toFixed(0)}%` : '—'} · {stats.accepted}/{stats.offered}</Text></View>
      <View style={s.row}><Text style={{ color: c.secondary }}>取消率</Text><Text style={[s.value, { color: c.text }]}>{stats.accepted ? `${(stats.cancellationRate * 100).toFixed(0)}%` : '—'} · {stats.cancelled}/{stats.accepted}</Text></View>
      <Text style={note(c.secondary)}>司機紀錄跨局保留。停權屬遊戲規則：有足夠派單紀錄後，過低接單率或過高取消率會逐級停派 1、3、6、12 小時。實際 Uber 政策並非呢個計法。</Text>
    </View>
    <View style={[s.group, { backgroundColor: c.surface }]}>
      <View style={s.row}><Icon name={{ ios: 'flag.checkered', android: 'flag' }} color={c.text}/><Text style={[s.label, { color: c.text, flex: 1 }]}>{game.handoverPlace ? getLocalizedPlaceName(game.handoverPlace) : t('取車地點交更')}</Text></View>
      <Button testID="navigate-handover" title={handoverPlan?.needsRefuel ? '補給後返回交更點' : '前往交更'} colors={c} secondary disabled={!!game.activeTrip||!!game.queuedTrip||!!game.deadlineSettlement||game.clockMinutes>=getShiftDurationMinutes(game)||game.phase==='ended'} onPress={() => finishAction(controller.handover)} />
      {(game.navigation?.kind==='handover'||game.navigation?.handoverAfterService)&&<Button testID="cancel-handover-continuation" title={game.navigation?.handoverAfterService?'取消交更，繼續補給':'取消交更導航'} colors={c} secondary onPress={()=>finishAction(controller.cancelHandover)}/>}
      <Text style={note(c.secondary)}>交更提醒會預留行車、輪候、補給及回程時間，由你決定幾時返去。夠鐘時已排隊或入緊氣，會完成當次補給後收更並標記遲到。</Text>
    </View>
  </ScrollView>;
}
const s = StyleSheet.create({ content: { padding: 20, paddingBottom: 40, gap: 16 }, heading: { fontSize: 20, fontWeight: '600' }, group: { borderRadius: 14, borderCurve: 'continuous', padding: 16, gap: 14 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, label: { fontSize: 16, fontWeight: '500' }, value: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] }, energyTrack: { height: 5, borderRadius: 3, overflow: 'hidden' }, segment: { flexDirection: 'row', padding: 4, borderRadius: 10 }, option: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, station: { padding: 16, minHeight: 76, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 } });

const note = (color: string) => ({ color, fontSize: 12, lineHeight: 19 });
