import { sounds } from '../audio/sounds';
import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedTextInput as TextInput, LocalizedSwitch as Switch, t, useLocale } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import { MULTIPLAYER_LIMITS, ROOM_SPEEDS, type CompetitionMode, type RoomSpeed } from '../../shared/protocol';
import type { RootStackParamList } from '../navigation';
import { RestoreRoomExit } from './RestoreRoomExit';
import { ShiftTimeFields } from './ShiftTimeFields';
import { clockFields,clockLabel,defaultShiftStart,parseShiftTime } from '../multiplayer/time';
import { buildPlayerSetup } from '../multiplayer/setup';
import { isPlaceAllowed } from '../data/vehicleAccess';
import { Icon } from './components';
import { ChoiceRow, Group, MultiplayerPage, NetworkAction, StatusMessage, SupportingText, multiplayerStyles as s, useNetworkTask } from './multiplayerParts';
import { ShiftDurationChoice } from './ShiftDurationChoice';
import {OrderPreferencesEditor,BlindPreflightControl} from './OrderPreferencesEditor';
import {defaultOrderPreferences,normalizeOrderPreferences} from '../game/orderPreferences';
import {isCurrentEliteCertification} from '../../shared/eliteCourse';
import type {OrderPreferences} from '../../shared/orderPolicy';
import { competitionModeLabel,estimatedRealMinutes,newRoomSpeed,shiftDurationLabel } from './shiftPresentation';

export function MultiplayerLobbyScreen({navigation}:NativeStackScreenProps<RootStackParamList,'MultiplayerLobby'>) {
  useLocale();
  const controller=useGame(),{fontScale}=useWindowDimensions();
  const {colors:c,shift:garageShift}=controller;
  const mp=useMultiplayer(),task=useNetworkTask();
  const [mode,setMode]=useState<CompetitionMode>('highest-net');
  const [shift,setShift]=useState(garageShift),[speed,setSpeed]=useState<RoomSpeed>(()=>newRoomSpeed(controller.speed));
  const [code,setCode]=useState(''),[tab,setTab]=useState<'create'|'join'>('create');
  const certified=isCurrentEliteCertification(mp.onlineEliteCertification);
  const [blind,setBlind]=useState(controller.blindOrdersPreference);
  const [preferences,setPreferences]=useState<OrderPreferences>(()=>normalizeOrderPreferences(controller.orderPreferences,controller.vehicleId,certified)??defaultOrderPreferences(controller.vehicleId));
  useEffect(()=>{void mp.refreshDriver().catch(()=>{});},[]);
  const [advanced,setAdvanced]=useState(false),[helpExpanded,setHelpExpanded]=useState(false);
  const [timeDraft,setTimeDraft]=useState(()=>clockFields(controller.startTimeMinutes??defaultShiftStart(garageShift)));
  const timeInitialized=useRef(controller.hydrated);
  useEffect(()=>{if(controller.hydrated&&!timeInitialized.current){timeInitialized.current=true;setShift(controller.shift);setSpeed(newRoomSpeed(controller.speed));setTimeDraft(clockFields(controller.startTimeMinutes??defaultShiftStart(controller.shift)));}},[controller.hydrated,controller.startTimeMinutes,controller.shift,controller.speed]);
  const commonStart=parseShiftTime(timeDraft.hour,timeDraft.minute);
  const changeShift=(night:boolean)=>{const next=night?'night':'day';if(next!==shift){sounds.playCue('select');setShift(next);setTimeDraft(clockFields(defaultShiftStart(next)));}};
  const room=mp.snapshot?.room,busy=!!mp.pending||!!task.busy;
  const validNickname=!!mp.nickname.trim();
  const accessValid=isPlaceAllowed(controller.startPlace,controller.vehicleId)&&(!controller.handoverPlace||isPlaceAllowed(controller.handoverPlace,controller.vehicleId));
  const unavailable=!mp.apiConfigured;
  const goRoom=()=>navigation.navigate('Room');
  const blocked=busy||mp.hasSession||unavailable||!validNickname||!mp.hydrated||!controller.hydrated||!accessValid;
  const create=()=>{if(commonStart===undefined||!controller.hydrated)return;Keyboard.dismiss();mp.clearError();void task.run('create',()=>mp.createRoom({mode,shift,speed,density:'busy',startTimeMinutes:commonStart,shiftDurationMinutes:controller.shiftDurationMinutes,blindOrders:blind},{...buildPlayerSetup(controller),orderPreferences:normalizeOrderPreferences(preferences,controller.vehicleId,certified)}),goRoom);};
  const join=()=>{if(!controller.hydrated||!mp.hydrated)return;Keyboard.dismiss();mp.clearError();void task.run('join',()=>mp.joinRoom(code.trim().toUpperCase(),buildPlayerSetup(controller)),goRoom);};
  return <MultiplayerPage colors={c} keyboard>
    <Pressable testID="edit-player-profile" accessibilityRole="button" onPress={()=>navigation.navigate('Profile')} style={({pressed})=>({minHeight:60,padding:12,borderRadius:14,borderCurve:'continuous',backgroundColor:c.surface,flexDirection:'row',alignItems:'center',gap:10,opacity:pressed?.7:1})}>
      <Icon name={{ios:'person.crop.circle',android:'account_circle'}} color={c.secondary} size={24}/><View style={{flex:1,gap:3}}><Text translate={false} style={{color:c.text,fontSize:16,fontWeight:'600'}}>{mp.nickname||t('設定玩家暱稱')}</Text><Text style={{color:c.secondary,fontSize:12}}>司機紀錄跨局保留</Text></View><Icon name={{ios:'chevron.right',android:'chevron_right'}} color={c.secondary} size={16}/>
    </Pressable>
    <RestoreRoomExit colors={c} onLeft={()=>navigation.reset({index:0,routes:[{name:'Garage'}]})}/>
    {!mp.hydrated?<StatusMessage colors={c} title="讀取多人資料…" busy/>:null}
    {unavailable?<StatusMessage colors={c} title="多人服務未設定" detail="暫時未有可連線嘅伺服器。單人開更仍可喺車房使用。"/>:null}
    {!validNickname&&mp.hydrated?<StatusMessage colors={c} title="先設定玩家暱稱" detail="房內玩家會用呢個名稱認得你。" action={()=>navigation.navigate('Profile')} actionTitle="設定暱稱"/>:null}
    {!accessValid&&!room?<StatusMessage colors={c} title="請先更改車房地點" detail="目前車種未能到達所選取車或交更點。" action={()=>navigation.navigate('Garage')} actionTitle="返回車房"/>:null}
    {task.error||mp.error?<StatusMessage testID="multiplayer-error" colors={c} title="連線操作未完成" detail={task.error??mp.error??undefined} action={()=>{task.clearError();mp.clearError();}} actionTitle="關閉提示"/>:null}
    {room?<Group colors={c}><Text style={{fontSize:16,fontWeight:'600',color:c.text}}>你已加入房間</Text><Text translate={false} selectable maxFontSizeMultiplier={1.4} style={{color:c.text,fontSize:30,fontWeight:'700',letterSpacing:4,fontVariant:['tabular-nums']}}>{room.code}</Text><SupportingText colors={c}>{room.players.length}位玩家 · {room.status==='lobby'?'等候開更':room.status==='finished'?'今場已完成':'比賽進行中'}</SupportingText><NetworkAction title="返回房間" colors={c} onPress={goRoom}/></Group>:<>
      <View style={{flexDirection:'row',padding:4,gap:4,borderRadius:12,borderCurve:'continuous',backgroundColor:c.muted}}>{(['create','join']as const).map(value=><Pressable key={value} testID={`lobby-${value}-tab`} accessibilityRole="tab" accessibilityState={{selected:tab===value,disabled:busy}} disabled={busy} onPress={()=>{if(tab!==value){sounds.playCue('select');Keyboard.dismiss();setTab(value);}}} style={{flex:1,minHeight:44,paddingHorizontal:8,paddingVertical:10,justifyContent:'center',alignItems:'center',borderRadius:9,borderCurve:'continuous',backgroundColor:tab===value?c.surface:c.muted}}><Text style={{color:tab===value?c.text:c.secondary,fontSize:15,fontWeight:tab===value?'600':'400',textAlign:'center'}}>{value==='create'?'建立房間':'加入房間'}</Text></Pressable>)}</View>
      {tab==='create'?<>
        <Group colors={c}>
          <Pressable testID="lobby-advanced-settings" accessibilityRole="button" accessibilityState={{expanded:advanced}} disabled={busy} onPress={()=>{sounds.playCue('open');setAdvanced(value=>!value);}} style={{minHeight:60,flexDirection:'row',alignItems:'center',gap:10}}><View style={{flex:1,gap:4}}><Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>房間設定</Text><Text style={{color:c.secondary,fontSize:13,lineHeight:19}}>{competitionModeLabel(mode)}</Text><Text style={{color:c.secondary,fontSize:12}}>{shiftDurationLabel(controller.shiftDurationMinutes)} · 基準約 {estimatedRealMinutes(controller.shiftDurationMinutes,speed)} 分鐘</Text><Text style={{color:c.secondary,fontSize:12}}>{commonStart===undefined?'--:--':clockLabel(commonStart)} · {speed}× · {mode==='team-net'?'4 位玩家':'2–8位玩家'}</Text></View><Icon name={{ios:advanced?'chevron.up':'chevron.down',android:advanced?'expand_less':'expand_more'}} color={c.secondary} size={18}/></Pressable>
          {advanced?<>
            <View style={{height:.5,backgroundColor:c.line}}/>
            <View style={{gap:8,flexDirection:fontScale>1.3?'column':'row'}}><ChoiceRow colors={c} title="最高淨收入勝出" selected={mode==='highest-net'} onPress={()=>setMode('highest-net')} disabled={busy} testID="mode-highest-net"/><ChoiceRow colors={c} title="最低淨收入勝出" selected={mode==='lowest-net'} onPress={()=>setMode('lowest-net')} disabled={busy} testID="mode-lowest-net"/></View>
            <ChoiceRow colors={c} title="2v2 隊伍淨收入" selected={mode==='team-net'} onPress={()=>setMode('team-net')} disabled={busy} testID="mode-team-net"/>
            {mode==='team-net'?<SupportingText colors={c}>4 人分兩隊，每隊 2 人；隊員淨收入合計，一人失去資格全隊不列名次。</SupportingText>:null}
            <ShiftDurationChoice value={controller.shiftDurationMinutes} onChange={controller.setShiftDurationMinutes} speed={speed} colors={c} disabled={busy} prefix="lobby-duration"/>
            <View style={s.row}><Text style={{flex:1,color:c.text,fontSize:15}}>夜間開更</Text><Switch trackColor={{false:c.line,true:c.blue}} testID="room-night-shift" accessibilityLabel="全房夜間開更" value={shift==='night'} onValueChange={changeShift} disabled={busy}/></View>
            <Text style={{color:c.secondary,fontSize:12}}>共同行車速度</Text><View style={{flexDirection:fontScale>1.5?'column':'row',gap:8}}>{ROOM_SPEEDS.map(value=><Pressable key={value} testID={`room-speed-${value}`} accessibilityRole="button" accessibilityState={{selected:value===speed}} disabled={busy} onPress={()=>{if(speed!==value){sounds.playCue('select');setSpeed(value);}}} style={({pressed})=>({flex:fontScale>1.5?undefined:1,minHeight:44,justifyContent:'center',alignItems:'center',borderRadius:10,borderCurve:'continuous',backgroundColor:value===speed?c.blue:c.muted,opacity:pressed?.7:1})}><Text style={{color:value===speed?c.onBlue:c.text,fontSize:16,fontWeight:'600'}}>{value}×</Text></Pressable>)}</View>
            <ShiftTimeFields compact shiftDurationMinutes={controller.shiftDurationMinutes} hour={timeDraft.hour} minute={timeDraft.minute} onHour={hour=>setTimeDraft(value=>({...value,hour}))} onMinute={minute=>setTimeDraft(value=>({...value,minute}))} colors={c} prefix="lobby-start" title="共通開更時間" disabled={busy||!controller.hydrated}/>
            <SupportingText colors={c}>開始後由伺服器推進同一更時間；離開畫面唔會暫停比賽。</SupportingText>
          </>:null}
        </Group>
        <OrderPreferencesEditor value={preferences} onChange={setPreferences} vehicleId={controller.vehicleId} eliteCertified={certified} colors={c} disabled={busy} prefix='lobby'/><Group colors={c}><BlindPreflightControl value={blind} onChange={setBlind} colors={c} disabled={busy} prefix='lobby'/></Group>
        <NetworkAction testID="create-multiplayer-room" title="建立房間" pendingTitle="建立房間中…" colors={c} pending={task.busy==='create'} disabled={blocked||commonStart===undefined} onPress={create}/>
      </>:<Group colors={c}>
        <Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>加入朋友房間</Text>
        <TextInput testID="join-room-code" accessibilityLabel="房間碼" value={code} onChangeText={value=>setCode(value.normalize('NFKC').replace(/[^A-Za-z0-9]/g,'').toUpperCase())} editable={!busy} placeholder="房間碼" placeholderTextColor={c.secondary} style={[s.field,{backgroundColor:c.muted,color:c.text,fontVariant:['tabular-nums'],letterSpacing:4,fontSize:22}]} autoCapitalize="characters" autoCorrect={false} maxLength={MULTIPLAYER_LIMITS.roomCodeCharacters} returnKeyType="join" onSubmitEditing={()=>{if(code.length===MULTIPLAYER_LIMITS.roomCodeCharacters&&!blocked)join();}}/>
        <NetworkAction testID="join-multiplayer-room" title="加入房間" pendingTitle="加入房間中…" colors={c} pending={task.busy==='join'} disabled={blocked||code.length!==MULTIPLAYER_LIMITS.roomCodeCharacters} onPress={join}/>
      </Group>}
    </>}
    <Pressable testID="lobby-help" accessibilityRole="button" accessibilityState={{expanded:helpExpanded}} onPress={()=>setHelpExpanded(value=>!value)} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:10}}><Text style={{flex:1,color:c.secondary,fontSize:13}}>房間說明</Text><Icon name={{ios:helpExpanded?'chevron.up':'chevron.down',android:helpExpanded?'expand_less':'expand_more'}} color={c.secondary} size={16}/></Pressable>
    {helpExpanded?<SupportingText colors={c}>可以喺房間內更改車輛、車租及能源單價。所有成本會計入淨收入。</SupportingText>:null}
  </MultiplayerPage>;
}
