import { getShiftDurationMinutes } from '../game/shiftDuration';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedTextInput as TextInput, getLocalizedPlaceName, useLocale, t } from '../i18n';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import { getRentalCost } from '../data/vehicles';
import { ENERGY_PROFILE_DEFAULTS } from '../data/serviceStations';
import { LANDMARK_BY_ID } from '../data/landmarks';
import { getVehicleRoadGraph } from '../data/vehicleAccess';
import type { PlayerSetup } from '../../shared/protocol';
import type { VehicleId } from '../game';
import { parseRoomCost } from '../multiplayer/setup';
import type { RootStackParamList } from '../navigation';
import { Group, MultiplayerPage, NetworkAction, SectionLabel, StatusMessage, SupportingText, useNetworkTask } from './multiplayerParts';
import { VehiclePicker } from './VehiclePicker';
import {roomCatalogVehicles} from './vehiclePresentation';
import { money } from './theme';
import {OrderPreferencesEditor} from './OrderPreferencesEditor';
import {defaultOrderPreferences,normalizeOrderPreferences} from '../game/orderPreferences';
import {isCurrentEliteCertification} from '../../shared/eliteCourse';
import type {OrderPreferences} from '../../shared/orderPolicy';
import {useEffect} from 'react';

export function RoomSetupScreen({navigation}:NativeStackScreenProps<RootStackParamList,'RoomSetup'>) {
  useLocale();
  const {colors:c,isDark}=useGame(),mp=useMultiplayer(),task=useNetworkTask();
  const room=mp.snapshot?.room,self=room?.players.find(p=>p.id===mp.snapshot?.you.playerId);
  const original=useRef({room:room?.code,player:self?.id});
  const [vehicleId,setVehicleId]=useState<VehicleId>(self?.vehicleId??'kam-fung');
  const certified=isCurrentEliteCertification(mp.onlineEliteCertification);
  const [preferences,setPreferences]=useState<OrderPreferences>(self?.orderPreferences??defaultOrderPreferences(self?.vehicleId??'kam-fung'));
  useEffect(()=>{void mp.refreshDriver().catch(()=>{});},[]);
  const [rent,setRent]=useState(self?.rentalOverride===undefined?'':String(self.rentalOverride));
  const [energy,setEnergy]=useState(self?.energyUnitPriceOverride===undefined?'':String(self.energyUnitPriceOverride));
  useLayoutEffect(()=>navigation.setOptions({headerLeft:()=> <Pressable accessibilityRole="button" disabled={!!task.busy} onPress={()=>navigation.goBack()} style={s.close}><Text style={{color:c.text,fontSize:17}}>取消</Text></Pressable>}),[navigation,c,task.busy]);
  if(!room||!self)return <MultiplayerPage colors={c}><StatusMessage colors={c} title="未加入房間"/><NetworkAction colors={c} title="返回房間" onPress={()=>navigation.goBack()}/></MultiplayerPage>;
  const graph=getVehicleRoadGraph(vehicleId),start=LANDMARK_BY_ID.get(self.startPlaceId??''),handover=LANDMARK_BY_ID.get(self.handoverPlaceId??'');
  const startNode=start?.nodeId??self.startNodeId,handoverNode=handover?.nodeId??self.handoverNodeId??startNode;
  const legal=!!startNode&&!!graph.nodes[startNode]&&!!handoverNode&&!!graph.nodes[handoverNode];
  const sameRoom=room.code===original.current.room&&self.id===original.current.player;
  const editable=sameRoom&&room.status==='lobby'&&mp.connection==='connected';
  let costs:Pick<PlayerSetup,'rentalOverride'|'energyUnitPriceOverride'>={},costError=false;
  try {costs={rentalOverride:parseRoomCost(rent,100_000),energyUnitPriceOverride:parseRoomCost(energy,1000)};}catch{costError=true;}
  const available=roomCatalogVehicles(room.vehicleCatalogVersion);
  const catalogValid=available.some(vehicle=>vehicle.id===vehicleId);
  const profile=ENERGY_PROFILE_DEFAULTS[vehicleId],unit=profile.kind==='swap'||profile.kind==='charge'?'kWh':'L';
  const save=()=>void task.run('setup',async()=>{
    if(!editable||!legal||!catalogValid||costError)throw new Error('請檢查車輛與成本設定。');
    await mp.updateSetup({vehicleId,...(self.startPlaceId?{startPlaceId:self.startPlaceId}:{startNodeId:self.startNodeId}),...(self.handoverPlaceId?{handoverPlaceId:self.handoverPlaceId}:{handoverNodeId:self.handoverNodeId}),...costs,...(room.orderPolicyVersion===1?{orderPreferences:normalizeOrderPreferences(preferences,vehicleId,true)}:{}),autoAcceptOrders:self.autoAcceptOrders??false});
  },()=>navigation.goBack());
  return <MultiplayerPage colors={c} keyboard>
    <SupportingText colors={c}>儲存後會取消你嘅準備狀態。車租及能源設定會計入今場淨收入，房內玩家可以查看。</SupportingText>
    <SectionLabel colors={c}>揀架車開更</SectionLabel>
    <VehiclePicker value={vehicleId} onChange={id=>{setVehicleId(id);setPreferences(previous=>normalizeOrderPreferences(previous,id,certified)??defaultOrderPreferences(id));setRent('');setEnergy('');}} vehicles={available} disabled={!editable||!!task.busy} colors={c} dark={isDark} shift={room.shift} duration={getShiftDurationMinutes(room)} prefix="room-vehicle"/>
    {room.orderPolicyVersion===1?<OrderPreferencesEditor value={preferences} onChange={setPreferences} vehicleId={vehicleId} eliteCertified={certified} colors={c} disabled={!editable||!!task.busy} prefix='room'/>:<SupportingText colors={c}>舊房間沿用原有接單規則；想揀單型，請建立新版房間。</SupportingText>}    <Group colors={c}><Text style={{color:c.text,fontWeight:'600'}}>本更成本</Text>
      <Text style={{color:c.secondary,fontSize:13}}>車租（HK$／更）</Text><TextInput testID="room-rental-input" accessibilityLabel="房間車租" value={rent} onChangeText={setRent} editable={editable&&!task.busy} keyboardType="decimal-pad" placeholder={String(getRentalCost(vehicleId,room.shift,undefined,getShiftDurationMinutes(room)))} placeholderTextColor={c.secondary} style={[s.input,{color:c.text,backgroundColor:c.muted}]}/>
      <Text style={{color:c.secondary,fontSize:13}}>{profile.kind==='swap'||profile.kind==='charge'?'能源單價（HK$／kWh）':'能源單價（HK$／L）'}</Text><TextInput testID="room-energy-input" accessibilityLabel="房間能源單價" value={energy} onChangeText={setEnergy} editable={editable&&!task.busy} keyboardType="decimal-pad" placeholder={profile.unitPrice.toFixed(2)} placeholderTextColor={c.secondary} style={[s.input,{color:c.text,backgroundColor:c.muted}]}/>
      <SupportingText colors={c}>留空使用所選車輛預設；輸入 0 代表免費。</SupportingText>
      <Text translate={false} style={{color:c.text,fontSize:14,fontVariant:['tabular-nums']}}>HK${money(costs.rentalOverride??getRentalCost(vehicleId,room.shift,undefined,getShiftDurationMinutes(room)),2)} · HK${money(costs.energyUnitPriceOverride??profile.unitPrice,2)}/{unit}</Text>
    </Group>
    <Group colors={c}><Text style={{color:c.secondary,fontSize:13}}>取車：{start?getLocalizedPlaceName(start):t('自選開工點')}{'\n'}交更：{handover?getLocalizedPlaceName(handover):t('同取車地點')}</Text></Group>
    {!legal&&<StatusMessage colors={c} title="車輛未能到達所選地點" detail="所選車輛無法通行現有取車或交更地點，請選擇另一款車。"/>}
    {costError&&<StatusMessage colors={c} title="成本設定無效。" detail="車租請輸入 0–100000，能源單價請輸入 0–1000。"/>}
    {!editable&&<StatusMessage colors={c} title={sameRoom?'目前無法更改設定':'房間已更改，請重新操作。'} detail="只可以喺已連線嘅等候房間內更改，開更後會鎖定。"/>}
    {task.error&&<StatusMessage colors={c} title="操作未完成" detail={task.error}/>}
    <NetworkAction testID="save-room-setup" colors={c} title="儲存車輛與成本" pendingTitle="儲存中…" pending={!!task.busy} disabled={!editable||!legal||!catalogValid||costError||!!mp.pending} onPress={save}/>
  </MultiplayerPage>;
}
const s=StyleSheet.create({close:{minWidth:44,minHeight:44,justifyContent:'center'},input:{minHeight:48,borderRadius:10,paddingHorizontal:12,paddingVertical:10,fontSize:17,fontVariant:['tabular-nums']}});
