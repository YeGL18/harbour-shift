import { sounds } from '../audio/sounds';
import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedTextInput as TextInput, t, useLocale, getLocalizedPlaceName } from '../i18n';
import React, { useLayoutEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMultiplayer } from '../MultiplayerProvider';
import { useGame } from '../GameProvider';
import { VEHICLE_BY_ID } from '../game';
import { LANDMARK_BY_ID } from '../data/landmarks';
import { getRentalCost } from '../data/vehicles';
import { isPlaceAllowed } from '../data/vehicleAccess';
import type { RootStackParamList } from '../navigation';
import { Button, Icon } from './components';
import { RestoreRoomExit } from './RestoreRoomExit';
import { ShiftTimeFields, ShiftTimeSummary } from './ShiftTimeFields';
import { clockLabel,roomStartTime } from '../multiplayer/time';
import { VehiclePicker } from './VehiclePicker';
import { money } from './theme';
import { getShiftDurationMinutes } from '../game/shiftDuration';
import { ShiftDurationChoice } from './ShiftDurationChoice';
import {OrderPreferencesEditor,BlindPreflightControl} from './OrderPreferencesEditor';
import {isCurrentEliteCertification} from '../../shared/eliteCourse';

export function GarageScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Garage'>) {
  useLocale();
  const [advanced, setAdvanced] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const controller = useGame();
  const mp = useMultiplayer();
  const room = mp.snapshot?.room;
  const roomLobby = room?.status === 'lobby';
  const self = room?.players.find(player => player.id === mp.snapshot?.you.playerId);
  const restoringRoom = !mp.snapshot && (mp.hasSession || mp.connection === 'connecting' || mp.connection === 'reconnecting');
  const activeRoom = !!room;
  const { colors: c, isDark, vehicleId, setVehicleId, game, start, resume, hydrated, shift, setShift, startPlace, rentalInput, setRentalInput, rentalOverride, saveNotice, handoverPlace, setHandoverPlace, energyInput, setEnergyInput, energyUnitPriceOverride, startHour, setStartHour, startMinute, setStartMinute, invalidStartTime } = controller;
  const insets = useSafeAreaInsets();
  const effectiveShift = room?.shift ?? shift;
  const durationMinutes = controller.shiftDurationMinutes;
  const effectiveDuration = room ? getShiftDurationMinutes(room) : durationMinutes;
  const continuing = !activeRoom && game && game.phase !== 'ended';
  const vehicle = VEHICLE_BY_ID[vehicleId];
  const invalidRental = rentalInput.trim() !== '' && rentalOverride === undefined;
  const accessValid = isPlaceAllowed(startPlace, vehicleId) && (!handoverPlace || isPlaceAllowed(handoverPlace, vehicleId));
  const invalidEnergy = energyInput.trim() !== '' && energyUnitPriceOverride === undefined;
  const canStart = !activeRoom && !restoringRoom && mp.hydrated && !controller.proPending && !controller.proSettlementRequired && !invalidStartTime && !invalidRental && !invalidEnergy && accessValid;
  const roomVehicle=self?VEHICLE_BY_ID[self.vehicleId]:undefined;
  const roomStart=self?.startPlaceId?LANDMARK_BY_ID.get(self.startPlaceId):undefined;
  const roomHandover=self?.handoverPlaceId?LANDMARK_BY_ID.get(self.handoverPlaceId):undefined;
  useLayoutEffect(() => navigation.setOptions({ headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="遊戲設定" onPress={() => navigation.navigate('Settings')} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name={{ ios: 'slider.horizontal.3', android: 'tune' }} color={c.text} /></Pressable> }), [c, navigation]);
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44} style={[s.root, { backgroundColor: c.background }]}>
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.content}>
      <View style={s.shortcuts}>
        <Pressable testID="garage-profile" accessibilityRole="button" onPress={() => navigation.navigate('Profile')} style={[s.shortcut, { backgroundColor: c.surface }]}><Icon name={{ ios: 'person.crop.circle', android: 'account_circle' }} color={c.text} size={22}/><View style={{ flex: 1, gap: 2 }}><Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>玩家資料</Text><Text translate={false} numberOfLines={1} style={[s.vehicleSubtitle, { color: c.secondary }]}>{mp.nickname || t('設定玩家名稱')}</Text></View></Pressable>
        <Pressable testID="garage-multiplayer" accessibilityRole="button" onPress={() => navigation.navigate(activeRoom ? 'Room' : 'MultiplayerLobby')} style={[s.shortcut, { backgroundColor: c.surface }]}><Icon name={{ ios: 'person.2.fill', android: 'groups' }} color={c.blue} size={22}/><View style={{ flex: 1, gap: 2 }}><Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{activeRoom ? '返回房間' : '多人開更'}</Text><Text numberOfLines={1} style={[s.vehicleSubtitle, { color: c.secondary }]}>{activeRoom ? `房間 ${room!.code}` : '2–8 人同場競爭'}</Text></View></Pressable>
      </View>
      {restoringRoom&&!mp.hasSession&&<Text style={{color:c.secondary,fontSize:13,lineHeight:20}}>連接房間中…</Text>}
      <View style={{flexDirection:'row',gap:8,marginBottom:12}}><Pressable testID="garage-pro" accessibilityRole="button" onPress={()=>navigation.navigate('Pro')} style={[s.shortcut,{backgroundColor:c.surface}]}><Icon name={{ios:'star.circle',android:'stars'}} color={c.blue} size={20}/><Text style={{color:c.text,fontSize:14,flexShrink:1}}>港運 Pro</Text></Pressable><Pressable testID="garage-elite" accessibilityRole="button" onPress={()=>navigation.navigate('Elite')} style={[s.shortcut,{backgroundColor:c.surface}]}><Icon name={{ios:'calendar.badge.clock',android:'event_available'}} color={c.blue} size={20}/><Text style={{color:c.text,fontSize:14,flexShrink:1}}>專屬預約（ELITE）</Text></Pressable></View>
      {controller.proSettlementRequired?<Button title="重試" colors={c} secondary disabled={controller.proPending} onPress={()=>void controller.retryProSettlement().catch(()=>{})}/>:null}
      {restoringRoom && <View style={{marginBottom:20}}><RestoreRoomExit colors={c} onLeft={()=>navigation.reset({index:0,routes:[{name:'Garage'}]})}/></View>}
      {activeRoom ? <View testID="garage-room-context" style={{padding:16,gap:12,borderRadius:16,borderCurve:'continuous',backgroundColor:c.surface}}>
        <View style={{gap:5}}><Text style={{color:c.secondary,fontSize:13}}>{roomLobby?'等候開更':room!.status==='finished'?'今場已完成':'比賽進行中'}</Text><Text translate={false} style={{color:c.text,fontSize:24,fontWeight:'700',letterSpacing:3,fontVariant:['tabular-nums']}}>{room!.code}</Text><Text style={{color:c.secondary,fontSize:13}}>{clockLabel(roomStartTime(room!))} · 共通{room!.speed}×</Text></View>
        {roomVehicle&&self?<View style={{gap:5}}><Text style={{color:c.text,fontSize:16,fontWeight:'600'}}>{roomVehicle.name}</Text><Text style={{color:c.secondary,fontSize:13,lineHeight:20}}>取車：{roomStart?getLocalizedPlaceName(roomStart):t('地圖位置')}{'\n'}交更：{roomHandover?getLocalizedPlaceName(roomHandover):t('地圖位置')}</Text><Text style={{color:c.secondary,fontSize:12}}>車租 HK${money(getRentalCost(self.vehicleId,room!.shift,self.rentalOverride,effectiveDuration),2)} · 能源 HK${money(self.energyUnitPriceOverride??roomVehicle.energyProfile?.unitPrice??0,2)}/{roomVehicle.energyProfile?.kind==='swap'||roomVehicle.energyProfile?.kind==='charge'?'kWh':'L'}</Text></View>:null}
        {roomLobby?<><Text style={{color:c.secondary,fontSize:13,lineHeight:20}}>車租及能源會計入淨收入。</Text><Button title="更改車輛、車租及能源" testID="garage-room-setup" colors={c} secondary disabled={!self||mp.connection!=='connected'||!!mp.pending} onPress={()=>navigation.navigate('RoomSetup')}/></>:<Text style={{color:c.secondary,fontSize:13,lineHeight:20}}>開更後車輛、取車及交更地點由伺服器保存。返回房間查看今場狀態及名次。</Text>}
      </View> : restoringRoom ? null : <>
      {saveNotice ? <Text style={{ color: c.secondary, fontSize: 13, lineHeight: 20, marginBottom: 16 }}>{saveNotice}</Text> : null}
      <Text style={[s.eyebrow, { color: c.secondary }]}>香港 · 由你揀更份長度</Text>
      <Text style={[s.heading, { color: c.text }]}>今更，喺邊出發？</Text>
      <View style={{marginTop:12}}><ShiftDurationChoice value={durationMinutes} onChange={controller.setShiftDurationMinutes} speed={controller.speed} colors={c}/></View>
      <Text style={{color:c.secondary,fontSize:13,marginTop:12}}>開更時段</Text><View style={[s.segment, { backgroundColor: c.muted }]}>{(['day','night'] as const).map(value => <Pressable key={value} testID={`shift-${value}`} accessibilityRole="button" accessibilityState={{ selected: value === shift }} onPress={() => { if (value !== shift) { sounds.playCue('select');setShift(value); } }} style={[s.shiftOption, shift === value && { backgroundColor: c.surface }]}><Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{value === 'day' ? '日間 05:00' : '夜間 17:00'}</Text></Pressable>)}</View>
      <View style={{ borderRadius: 12, marginTop: 8, backgroundColor: c.surface }}><ShiftTimeSummary title="開更／交更時間" value={invalidStartTime ? '--:--' : `${startHour.padStart(2, '0')}:${startMinute.padStart(2, '0')} → ${clockLabel(((controller.startTimeMinutes ?? 300) + durationMinutes) % 1440)}`} expanded={editingTime} onPress={()=>setEditingTime(value=>!value)} colors={c}/>{editingTime && <View style={{ padding: 10 }}><ShiftTimeFields compact shiftDurationMinutes={durationMinutes} hour={startHour} minute={startMinute} onHour={setStartHour} onMinute={setStartMinute} colors={c}/></View>}</View>

      <Pressable testID="choose-start-location" accessibilityRole="button" onPress={() => navigation.navigate('StartLocation')} style={[s.location, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Icon name={{ ios: 'location.circle', android: 'location_on' }} color={c.text} size={22}/>
        <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={1} style={[s.locationName, { color: c.text }]}>{getLocalizedPlaceName(startPlace)}</Text></View>
        <Icon name={{ ios: 'chevron.right', android: 'chevron_right' }} color={c.secondary} size={16}/>
      </Pressable>
      <Pressable testID="choose-handover-location" accessibilityRole="button" onPress={() => navigation.navigate('StartLocation', { purpose: 'handover' })} style={[s.location, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Icon name={{ ios: 'flag.checkered', android: 'flag' }} color={c.text} size={22}/><View style={{ flex: 1, gap: 5 }}><Text style={[s.locationName, { color: c.text }]}>交更：{handoverPlace ? getLocalizedPlaceName(handoverPlace) : t('同取車地點')}</Text></View><Icon name={{ ios: 'chevron.right', android: 'chevron_right' }} color={c.secondary} size={16}/>
      </Pressable>
      {handoverPlace && <Pressable accessibilityRole="button" onPress={() => setHandoverPlace(null)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.secondary, fontSize: 13 }}>改為同取車地點交更</Text></Pressable>}
      <Text style={[s.section, { color: c.text }]}>揀架車開更</Text>
      <VehiclePicker value={vehicleId} onChange={setVehicleId} colors={c} dark={isDark} shift={effectiveShift} duration={effectiveDuration}/>
      <View style={{gap:12,marginTop:16}}><OrderPreferencesEditor value={controller.orderPreferences} onChange={controller.setOrderPreferences} vehicleId={vehicleId} eliteCertified={isCurrentEliteCertification(controller.eliteCertification)} colors={c}/><View style={{padding:14,borderRadius:14,borderCurve:'continuous',backgroundColor:c.surface}}><BlindPreflightControl value={controller.blindOrdersPreference} onChange={controller.setBlindOrdersPreference} colors={c}/></View></View>
      <Pressable testID="toggle-cost-settings" accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(value => !value)} style={[s.advancedToggle, { backgroundColor: c.surface }]}><View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>車租及能源設定</Text><Text style={{ color: c.secondary, fontSize: 12 }}>車租 HK${money(rentalOverride ?? getRentalCost(vehicleId, shift, undefined, durationMinutes))} · 可自訂</Text></View><Icon name={{ ios: advanced ? 'chevron.up' : 'chevron.down', android: advanced ? 'expand_less' : 'expand_more' }} color={c.secondary} size={18}/></Pressable>
      {advanced && <>
      <Text style={{color:c.secondary,fontSize:12,lineHeight:19,marginTop:8}}>半更預設車租五折；自訂車租按所填金額，唔會再折半。</Text>
      <View style={[s.rental, { backgroundColor: c.surface }]}>
        <View style={{ flex: 1, gap: 5 }}><Text style={[s.locationName, { color: c.text }]}>本更車租</Text><Text style={[s.vehicleSubtitle, { color: c.secondary }]}>{vehicleId === 'red-flag' ? '紅旗用你指定嘅暫定車租，可修改' : '可自行修改，只影響新開一更'}</Text></View>
        <Text style={{ color: c.secondary }}>HK$</Text><TextInput testID="rental-input" accessibilityLabel="自訂本更車租" keyboardType="decimal-pad" value={rentalInput} onChangeText={setRentalInput} placeholder={String(getRentalCost(vehicleId, shift, undefined, durationMinutes))} placeholderTextColor={c.secondary} maxLength={7} style={[s.rentalInput, { color: c.text, backgroundColor: c.muted }]} />
      </View>
      <View style={[s.rental, { backgroundColor: c.surface }]}>
        <View style={{ flex: 1, gap: 5 }}><Text style={[s.locationName, { color: c.text }]}>能源參考單價</Text><Text style={[s.vehicleSubtitle, { color: c.secondary }]}>{vehicle.energyProfile?.kind==='swap'||vehicle.energyProfile?.kind==='charge' ? '每 kWh' : '每公升'} · 留空用遊戲設定；填寫後本更補給亦用此價</Text></View>
        <Text style={{ color: c.secondary }}>HK$</Text><TextInput testID="energy-price-input" accessibilityLabel="自訂能源單價" keyboardType="decimal-pad" value={energyInput} onChangeText={setEnergyInput} placeholder={String(vehicle.energyProfile?.unitPrice ?? '')} placeholderTextColor={c.secondary} maxLength={7} style={[s.rentalInput, { color: c.text, backgroundColor: c.muted }]} />
      </View>
      <Text style={{ color: c.secondary, fontSize: 12, lineHeight: 19, marginTop: 8 }}>預設每公里約 HK${((vehicle.energyProfile?.consumptionPerKm ?? 0) * (energyUnitPriceOverride ?? vehicle.energyProfile?.unitPrice ?? 0)).toFixed(2)}。小露寶按每 400 公里約 $120 入氣校準；私家車採遊戲節能車及折扣油價，並非現場牌價。</Text>
      </>}
      {invalidEnergy && <Text style={{ color: c.secondary, fontSize: 13 }}>請輸入零或以上嘅能源單價。</Text>}
      {invalidRental && <Text style={{ color: c.secondary, fontSize: 13 }}>請輸入零或以上嘅車租。</Text>}
      {!accessValid && <Text style={{ color: c.secondary, fontSize: 13 }}>所選車款唔適用呢個取車或交更地點，請重新揀位置。</Text>}
      {continuing && <><Text style={[s.saveNote, { color: c.secondary }]}>已保存一更 · 完成 {game.completedTrips} 單 · 淨收入 HK${money(game.netIncome)}</Text><Text style={{color:c.secondary,fontSize:12,lineHeight:19,marginTop:6}}>已保存更份維持原有長度；以上設定只用於重新開更。</Text></>}
      </>}
    </ScrollView>
    <View style={[s.footer, { backgroundColor: c.surface, borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 16) }]}>
      {!hydrated || !mp.hydrated ? <ActivityIndicator color={c.text} /> : activeRoom ? <Button title="返回房間" testID="garage-return-room" colors={c} onPress={() => navigation.navigate('Room')}/> : restoringRoom ? <ActivityIndicator color={c.text}/> : continuing ? <>
        <Button title="繼續本更" cue="resume" testID="resume-shift" colors={c} onPress={() => { resume(); navigation.replace('Shift'); }} />
        <Pressable accessibilityRole="button" testID="new-shift" disabled={!canStart} onPress={() => { start(); navigation.replace('Shift'); }} style={[s.newShift, !canStart && { opacity: .35 }]}><Text style={{ color: c.secondary, fontSize: 15 }}>用所選設定重新開更</Text></Pressable>
      </> : <Button title={durationMinutes===360?'開始半更':durationMinutes===1440?'開始特更':'開始全更'} testID="start-shift" disabled={!canStart} colors={c} onPress={() => { start(); navigation.replace('Shift'); }} />}
    </View>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  root: { flex: 1 }, content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 20 }, shortcuts: { flexDirection: 'row', gap: 8, marginBottom: 12 }, shortcut: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, padding: 8, borderRadius: 12, borderCurve: 'continuous' }, advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, padding: 12, borderRadius: 12, borderCurve: 'continuous', marginTop: 12 },
  eyebrow: { fontSize: 12, fontWeight: '500', marginBottom: 4 }, heading: { fontSize: 29, fontWeight: '700', letterSpacing: -.8 }, section: { fontSize: 20, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 10, marginTop: 12 }, shiftOption: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  location: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10, minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 8 }, locationName: { fontSize: 16, fontWeight: '600' },
  vehicleSubtitle: { fontSize: 12, lineHeight: 18 },
  rental: { padding: 12, borderRadius: 12, marginTop: 8, flexDirection: 'row', gap: 8, alignItems: 'center' }, rentalInput: { minHeight: 44, minWidth: 80, textAlign: 'right', paddingHorizontal: 12, borderRadius: 8, fontSize: 18, fontVariant: ['tabular-nums'] }, saveNote: { fontSize: 13, marginTop: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth }, newShift: { alignItems: 'center', padding: 14 },
});
