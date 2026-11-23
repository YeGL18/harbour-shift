import { sounds } from '../audio/sounds';
import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedSwitch as Switch, t, useLocale, intlLocale, getLocalizedPlaceName } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Clipboard, Keyboard, KeyboardAvoidingView, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import { MULTIPLAYER_LIMITS, ROOM_SPEEDS, type RoomSnapshot, type RoomRules } from '../../shared/protocol';
import { ShiftTimeFields } from './ShiftTimeFields';
import { clockFields, clockLabel, parseShiftTime, roomStartTime } from '../multiplayer/time';
import { roomPlayerStatus } from '../multiplayer/playerStatus';
import { LANDMARK_BY_ID } from '../data/landmarks';
import { VEHICLE_BY_ID, getRentalCost } from '../data/vehicles';
import type { RootStackParamList } from '../navigation';
import { Icon } from './components';
import { gameTime, money } from './theme';
import { RoomLeaderboard } from './RoomLeaderboard';
import { getRoomReadiness } from './roomPresentation';
import { returnToShift } from './shiftNavigation';
import { ChoiceRow, Group, MultiplayerPage, NetworkAction, SectionLabel, StatusMessage, SupportingText, multiplayerStyles as s, useNetworkTask } from './multiplayerParts';
import { getShiftDurationMinutes } from '../game/shiftDuration';
import { ShiftDurationChoice } from './ShiftDurationChoice';
import { competitionModeLabel,estimatedRealMinutes,shiftDurationLabel } from './shiftPresentation';
import { MatchComparison } from './MatchComparison';
import { WorldEventNotice } from './WorldEventNotice';
import {BlindPreflightControl} from './OrderPreferencesEditor';

export function RoomScreen({navigation}:NativeStackScreenProps<RootStackParamList,'Room'>) {
  useLocale();
  const controller=useGame(),{ colors:c }=controller;
  const mp=useMultiplayer(),task=useNetworkTask(),leaveTask=useNetworkTask();
  const inset=useSafeAreaInsets(),{width,fontScale}=useWindowDimensions();
  const currentMp=useRef(mp);currentMp.current=mp;
  const scroll=useRef<React.ComponentRef<typeof ScrollView>>(null);
  const snapshot:RoomSnapshot|null=mp.snapshot;
  const room=snapshot?.room,selfId=snapshot?.you.playerId??'';
  const [now,setNow]=useState(Date.now());
  const [settingsExpanded,setSettingsExpanded]=useState(false),[helpExpanded,setHelpExpanded]=useState(false),[copied,setCopied]=useState(false);
  const copyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(copyTimer.current)clearTimeout(copyTimer.current);},[]);
  useEffect(()=>{if(task.error||leaveTask.error||mp.error)scroll.current?.scrollTo({y:0,animated:false});},[task.error,leaveTask.error,mp.error]);
  const commonStart=room?roomStartTime(room):300;
  const [timeDraft,setTimeDraft]=useState(()=>clockFields(commonStart));
  useEffect(()=>setTimeDraft(clockFields(commonStart)),[room?.code,commonStart,room?.hostPlayerId]);
  const draftStart=parseShiftTime(timeDraft.hour,timeDraft.minute);
  const timeChanged=draftStart!==commonStart;
  const receipt=useRef({revision:snapshot?.revision,at:Date.now(),serverTime:snapshot?.serverTime??Date.now()});
  if(receipt.current.revision!==snapshot?.revision)receipt.current={revision:snapshot?.revision,at:Date.now(),serverTime:snapshot?.serverTime??Date.now()};
  const enteredBeforeStart=useRef(room?.status==='lobby'||room?.status==='countdown');
  const lastHost=useRef(room?.hostPlayerId);
  const [hostNotice,setHostNotice]=useState<{nickname:string;isSelf:boolean}|null>(null);
  useEffect(()=>{
    if(room?.status!=='countdown')return;
    const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);
  },[room?.status]);
  useEffect(()=>{
    if(room?.status==='lobby'||room?.status==='countdown')enteredBeforeStart.current=true;
    if(room?.status==='countdown'&&room.loading&&!controller.mapInstanceId){returnToShift(navigation);return;}
    if(room?.status==='running'&&enteredBeforeStart.current){enteredBeforeStart.current=false;returnToShift(navigation);}
  },[room?.status,room?.loading?.epoch,navigation]);
  useEffect(()=>{
    if(room?.hostPlayerId&&lastHost.current&&room.hostPlayerId!==lastHost.current){
      const name=room.players.find(player=>player.id===room.hostPlayerId)?.nickname??'其他玩家';
      setHostNotice({nickname:name,isSelf:room.hostPlayerId===selfId});
    }
    lastHost.current=room?.hostPlayerId;
  },[room?.hostPlayerId,selfId]);
  const perform=(key:string,action:()=>Promise<unknown>,after?:()=>void)=>{mp.clearError();void task.run(key,action,after);};
  const leave=()=>{void leaveTask.run('leave',()=>{const current=currentMp.current;current.clearError();return current.leaveRoom();},()=>navigation.replace('MultiplayerLobby'));};
  const requestLeave=()=>{
    if(leaveTask.busy||(!['reconnecting','offline'].includes(mp.connection)&&(task.busy||mp.pending)))return;
    if(room?.status==='running'||room?.status==='countdown')Alert.alert(t('離開今場？'),t('離開會結束你喺今場嘅參與，其他玩家會繼續。'),[{text:t('留喺房間'),style:'cancel'},{text:t('離開房間'),style:'destructive',onPress:leave}]);
    else leave();
  };
  if(!room||!snapshot)return <MultiplayerPage colors={c}><StatusMessage colors={c} title={mp.error?'房間未能恢復':'未加入房間'} detail={mp.error??'可以建立房間，或者輸入朋友嘅房間碼。'}/><NetworkAction colors={c} title="前往多人開更" onPress={()=>navigation.replace('MultiplayerLobby')}/></MultiplayerPage>;
  const self=room.players.find(player=>player.id===selfId);
  const host=room.hostPlayerId===selfId;
  const lobby=room.status==='lobby',finished=room.status==='finished',modern=room.featureVersion==='0.6';
  const busy=!!task.busy||!!mp.pending||!!leaveTask.busy;
  const canLeaveOffline=mp.connection==='reconnecting'||mp.connection==='offline';
  const connected=mp.connection==='connected';
  const readiness=getRoomReadiness(room,selfId,{timeChanged,draftValid:draftStart!==undefined});
  const vehicle=self?VEHICLE_BY_ID[self.vehicleId]:undefined;
  const setupValid=!!self&&(!!self.startPlaceId||!!self.startNodeId)&&(!!self.handoverPlaceId||!!self.handoverNodeId);
  const placeName=(id?:string)=>{const place=id?LANDMARK_BY_ID.get(id):undefined;return place?getLocalizedPlaceName(place):t('地圖位置');};
  const roomDuration=getShiftDurationMinutes(room);
  const rental=self?getRentalCost(self.vehicleId,room.shift,self.rentalOverride,roomDuration):0;
  const energy=self?.energyUnitPriceOverride??vehicle?.energyProfile?.unitPrice??0;
  const unit=vehicle?.energyProfile?.kind==='swap'||vehicle?.energyProfile?.kind==='charge'?'kWh':'L';
  const countdown=Math.max(0,Math.ceil(((room.startsAt??receipt.current.serverTime)-(receipt.current.serverTime+Math.max(0,now-receipt.current.at)))/1000));
  const updateRules=(rules:Partial<RoomRules>)=>perform('rules',()=>mp.updateRules(rules));
  const copyCode=()=>{Clipboard.setString(room.code);setCopied(true);if(copyTimer.current)clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(false),1600);};
  const compactActions=fontScale<=1.3&&width>=350;
  return <KeyboardAvoidingView style={{flex:1,backgroundColor:c.background}} behavior={process.env.EXPO_OS==='ios'?'padding':undefined}>
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content,{paddingBottom:16+inset.bottom}]}>
      <Group colors={c} style={{gap:6}}>
        <View style={[s.row,{justifyContent:'space-between'}]}>
          <View style={{flex:1,gap:2}}><Text style={{color:c.secondary,fontSize:12}}>房間碼</Text><Text translate={false} selectable testID="multiplayer-room-code" maxFontSizeMultiplier={1.4} style={{color:c.text,fontSize:30,fontWeight:'700',letterSpacing:4,fontVariant:['tabular-nums']}}>{room.code}</Text></View>
          <Pressable testID="copy-room-code" accessibilityRole="button" accessibilityLabel={copied?'已複製':'複製房間碼'} onPress={copyCode} style={styles.iconAction}><Icon name={{ios:copied?'checkmark':'doc.on.doc',android:copied?'check':'content_copy'}} color={c.blue} size={21}/></Pressable>
          <Pressable testID="share-room-code" accessibilityRole="button" accessibilityLabel="分享房間碼" disabled={busy} onPress={()=>perform('share',()=>Share.share({message:t(`港更房間碼：${room.code}\n喺「多人開更」輸入房間碼就可以加入。`)}))} style={styles.iconAction}><Icon name={{ios:'square.and.arrow.up',android:'share'}} color={c.blue} size={21}/></Pressable>
        </View>
        <Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>{competitionModeLabel(room.mode)} · {room.shift==='night'?'夜間開更':'日間開更'} · {clockLabel(commonStart)} · 共通{room.speed}×</Text>
        <Text style={{color:c.secondary,fontSize:12}}>{room.orderVisibility?.blindOrders?'盲單已開':'盲單已關'}</Text>
        <Text style={{color:c.secondary,fontSize:12}}>{shiftDurationLabel(roomDuration)} · 基準約 {estimatedRealMinutes(roomDuration,room.speed)} 分鐘</Text>
      </Group>
      {room.worldEvents?.length?<WorldEventNotice events={room.worldEvents} clockMinutes={room.clockMinutes} startTimeMinutes={commonStart} game={controller.online&&room.status==='running'?controller.game:null} colors={c} busy={busy||!connected} onCruise={nodeId=>{controller.cruiseTo(nodeId);returnToShift(navigation);}}/>:null}
      {!connected?<StatusMessage testID="room-connection-state" colors={c} title={mp.connection==='connecting'?'連接房間中…':'連線中斷，正在重連'} busy={mp.connection==='connecting'||mp.connection==='reconnecting'} detail={`${room.status==='running'?'伺服器更時間仍會繼續。':''}畫面暫時未能取得新狀態；最近更新${new Date(snapshot.serverTime).toLocaleTimeString(intlLocale())}。`} action={()=>mp.reconnect()} actionTitle="重新連線"/>:null}
      {leaveTask.error||task.error||mp.error?<StatusMessage testID="room-action-error" colors={c} title="操作未完成" detail={leaveTask.error??task.error??mp.error??undefined} action={()=>{leaveTask.clearError();task.clearError();mp.clearError();}} actionTitle="關閉提示"/>:null}
      {hostNotice?<StatusMessage colors={c} title={<><Text>房主已轉交畀</Text><Text translate={false}>{hostNotice.isSelf?t('你'):hostNotice.nickname}</Text><Text>。</Text></>}/>:null}
      {room.status==='countdown'?<StatusMessage testID="room-countdown" colors={c} title={room.loading&&!room.startsAt?'等候所有玩家載入地圖…':countdown>0?`${countdown}秒後一齊開更`:'等候伺服器確認開更…'} detail="全房用同一時間及遊戲速度。" busy/>:null}
      {lobby?<>
        <View style={[s.row,{justifyContent:'space-between',alignItems:'flex-start'}]}><View style={{flex:1}}><SectionLabel colors={c}>玩家 {readiness.participants.length} / {room.mode==='team-net'?4:MULTIPLAYER_LIMITS.maxPlayers}{host?' · 你係房主':''}</SectionLabel></View><Text style={{color:c.secondary,fontSize:12}}><Text translate={false}>{readiness.readyCount}/{readiness.participants.length} </Text>已準備</Text></View>
        <Group colors={c} style={{gap:0,paddingVertical:0}}>{room.players.map((player,index)=>{
          const ready=player.ready&&player.connected&&!player.forfeited&&player.status!=='left';
          return <View key={player.id} testID={`room-player-${player.id}`} style={[styles.player,{borderTopWidth:index?StyleSheet.hairlineWidth:0,borderColor:c.line}]}>
            <Icon name={{ios:ready?'checkmark.circle.fill':'person.crop.circle',android:ready?'check_circle':'account_circle'}} color={ready?c.blue:c.secondary} size={24}/>
            <View style={{flex:1,gap:3}}><Text style={{color:c.text,fontSize:15,fontWeight:player.id===selfId?'600':'500'}}><Text translate={false}>{player.nickname}</Text>{player.id===selfId?'（你）':''}</Text><Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>{player.teamId?`${player.teamId} 隊 · `:''}{VEHICLE_BY_ID[player.vehicleId]?.name??'未揀車'} · {roomPlayerStatus(player,true)}</Text></View>
            {room.hostPlayerId===player.id?<Text style={{color:c.secondary,fontSize:11}}>房主</Text>:null}
          </View>;
        })}</Group>
        {room.mode==='team-net'?<Group colors={c}><Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>我的隊伍</Text><View style={{flexDirection:'row',gap:8}}>{(['A','B']as const).map(team=><ChoiceRow key={team} testID={`choose-team-${team}`} colors={c} title={`${team} 隊 · ${readiness.teamCounts[team]}/2`} selected={self?.teamId===team} disabled={busy||!connected} onPress={()=>{if(self?.teamId!==team)perform('team',()=>mp.setTeam(team));}}/>)}</View><SupportingText colors={c}>4 人分兩隊，每隊 2 人；隊員淨收入合計，一人失去資格全隊不列名次。</SupportingText></Group>:null}
        <Pressable testID="room-open-garage" accessibilityRole="button" accessibilityLabel="更改車輛、車租及能源" disabled={busy||!connected} onPress={()=>navigation.navigate('RoomSetup')} style={({pressed})=>[styles.setup,{backgroundColor:c.surface,borderColor:c.line,opacity:(busy||!connected) ? .55 : pressed ? .7 : 1}]}>
          <Icon name={{ios:'car',android:'directions_car'}} color={c.secondary} size={23}/><View style={{flex:1,gap:4}}><Text style={{color:c.text,fontSize:14,fontWeight:'600'}}>{vehicle?.name??'未揀車'}</Text><Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>取車：{placeName(self?.startPlaceId)}{'\n'}交更：{placeName(self?.handoverPlaceId)}</Text><Text style={{color:c.secondary,fontSize:12}}>車租 HK${money(rental,2)} · 能源 HK${money(energy,2)}/{unit}</Text></View><Icon name={{ios:'chevron.right',android:'chevron_right'}} color={c.secondary} size={17}/>
        </Pressable>
        {host?<Group colors={c}>
          <Pressable testID="room-host-settings" accessibilityRole="button" accessibilityState={{expanded:settingsExpanded}} disabled={busy} onPress={()=>{sounds.playCue('open');setSettingsExpanded(value=>!value);}} style={styles.disclosure}><View style={{flex:1,gap:3}}><Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>房主設定</Text><Text style={{color:c.secondary,fontSize:12}}>{clockLabel(commonStart)} · {room.speed}×</Text></View><Icon name={{ios:settingsExpanded?'chevron.up':'chevron.down',android:settingsExpanded?'expand_less':'expand_more'}} color={c.secondary} size={18}/></Pressable>
          {settingsExpanded?<>
            {room.orderPolicyVersion===1?<BlindPreflightControl value={room.blindOrders===true} onChange={value=>updateRules({blindOrders:value})} colors={c} disabled={busy||!connected} prefix='room-host'/>:null}
            <View style={{gap:8,flexDirection:fontScale>1.3?'column':'row'}}><ChoiceRow colors={c} title="最高淨收入勝出" selected={room.mode==='highest-net'} onPress={()=>updateRules({mode:'highest-net'})} disabled={busy||!connected}/><ChoiceRow colors={c} title="最低淨收入勝出" selected={room.mode==='lowest-net'} onPress={()=>updateRules({mode:'lowest-net'})} disabled={busy||!connected}/></View>
            {modern?<ChoiceRow colors={c} title="2v2 隊伍淨收入" selected={room.mode==='team-net'} onPress={()=>updateRules({mode:'team-net'})} disabled={busy||!connected||readiness.participants.length>4}/>:null}
            {modern&&readiness.participants.length>4?<SupportingText colors={c}>2v2 最多四人，需先有人離開先可以轉隊伍模式。</SupportingText>:null}
            {modern?<ShiftDurationChoice value={roomDuration} onChange={value=>updateRules({shiftDurationMinutes:value})} speed={room.speed} colors={c} disabled={busy||!connected} prefix="room-duration"/>:null}
            <View style={[s.row,{paddingVertical:4}]}><Text style={{flex:1,color:c.text,fontSize:15}}>夜間開更</Text><Switch trackColor={{false:c.line,true:c.blue}} accessibilityLabel="房間夜間開更" value={room.shift==='night'} onValueChange={night=>{sounds.playCue('select');updateRules({shift:night?'night':'day'});}} disabled={busy||!connected}/></View>
            <Text style={{color:c.secondary,fontSize:12}}>共同行車速度</Text><View style={{flexDirection:fontScale>1.5?'column':'row',gap:8}}>{ROOM_SPEEDS.map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:room.speed===value}} onPress={()=>{if(room.speed!==value){sounds.playCue('select');updateRules({speed:value});}}} disabled={busy||!connected} style={{flex:fontScale>1.5?undefined:1,minHeight:44,justifyContent:'center',alignItems:'center',borderRadius:10,borderCurve:'continuous',backgroundColor:room.speed===value?c.blue:c.muted}}><Text style={{color:room.speed===value?c.onBlue:c.text,fontWeight:'600',fontSize:16}}>{value}×</Text></Pressable>)}</View>
            <View style={[s.divider,{backgroundColor:c.line,marginVertical:4}]}/><ShiftTimeFields compact shiftDurationMinutes={roomDuration} hour={timeDraft.hour} minute={timeDraft.minute} onHour={hour=>setTimeDraft(value=>({...value,hour}))} onMinute={minute=>setTimeDraft(value=>({...value,minute}))} colors={c} prefix="room-start" title="共通開更時間" disabled={busy||!connected}/>
            {timeChanged?<><NetworkAction testID="apply-room-start-time" colors={c} title="套用共通時間" pendingTitle="更新共通時間…" disabled={busy||!connected||draftStart===undefined} pending={task.busy==='rules'} onPress={()=>{Keyboard.dismiss();if(draftStart!==undefined)updateRules({startTimeMinutes:draftStart});}}/><NetworkAction colors={c} title="還原房間時間" secondary disabled={busy} onPress={()=>{Keyboard.dismiss();setTimeDraft(clockFields(commonStart));}}/></>:null}
            <SupportingText colors={c}>更改房規後，全房需要重新準備。</SupportingText>
          </>:null}
        </Group>:null}
      </>:<>
        <SectionLabel colors={c}>{finished?'今場成績':'即時名次'} · {gameTime(room.clockMinutes,commonStart)}</SectionLabel>
        <Group colors={c} style={{paddingVertical:0}}><RoomLeaderboard entries={snapshot.leaderboard} players={room.players} selfId={selfId} colors={c} finished={finished} teams={room.mode==='team-net'?room.teamLeaderboard:undefined}/></Group>
        {finished&&snapshot.review?<MatchComparison review={snapshot.review} selfId={selfId} startTimeMinutes={commonStart} colors={c}/>:null}
        <SupportingText colors={c}>{finished?'名次由伺服器結算；失去資格嘅玩家不列名次。':'名次按最近伺服器更新顯示，未交更收入仍會變動。'}</SupportingText>
      </>}
      <Pressable testID="room-help" accessibilityRole="button" accessibilityState={{expanded:helpExpanded}} onPress={()=>setHelpExpanded(value=>!value)} style={styles.disclosure}><Text style={{flex:1,color:c.secondary,fontSize:13}}>房間說明</Text><Icon name={{ios:helpExpanded?'chevron.up':'chevron.down',android:helpExpanded?'expand_less':'expand_more'}} color={c.secondary} size={16}/></Pressable>
      {helpExpanded?<><SupportingText colors={c}>車租及能源會計入淨收入。</SupportingText><SupportingText colors={c}>房主離線時由伺服器轉交房主。比賽中斷線仍會繼續行車，超過{MULTIPLAYER_LIMITS.disconnectGraceMilliseconds/1000}秒未重連會失去資格。</SupportingText></>:null}
      <Pressable testID="leave-multiplayer-room" accessibilityRole="button" accessibilityState={{disabled:!!leaveTask.busy||(!canLeaveOffline&&(!!task.busy||!!mp.pending)),busy:!!leaveTask.busy}} disabled={!!leaveTask.busy||(!canLeaveOffline&&(!!task.busy||!!mp.pending))} onPress={requestLeave} style={styles.leave}><Text style={{color:c.secondary,fontSize:15,fontWeight:'500'}}>{leaveTask.busy?'離開中…':finished?'離開房間，再開一場':'離開房間'}</Text></Pressable>
    </ScrollView>
    {lobby||room.status==='countdown'&&!!room.loading||room.status==='running'&&self&&!self.forfeited&&self.status!=='finished'?<View style={[styles.dock,{backgroundColor:c.surface,borderColor:c.line,paddingBottom:Math.max(inset.bottom,12)}]}>
      {lobby?<>
        <View style={{flexDirection:compactActions?'row':'column',gap:10}}><View style={{flex:compactActions?1:undefined}}><NetworkAction testID="toggle-room-ready" colors={c} title={self?.ready?'取消準備':'準備好'} pendingTitle="更新準備狀態…" pending={task.busy==='ready'} disabled={busy||!connected||!setupValid||!self||(host&&timeChanged&&!self.ready)} secondary={!!self?.ready} onPress={()=>perform('ready',()=>mp.setReady(!self?.ready))}/></View>{host?<View style={{flex:compactActions?1:undefined}}><NetworkAction testID="start-room-race" title="開始今場" pendingTitle="開始中…" colors={c} disabled={!readiness.canStart||busy||!connected} pending={task.busy==='start'} onPress={()=>perform('start',()=>mp.startRoom())}/></View>:null}</View>
        {host&&!readiness.canStart?<Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>{timeChanged?'請先套用或還原房間時間。':!readiness.teamReady?'2v2 需要四位玩家，A、B 隊各兩位。':`最少${MULTIPLAYER_LIMITS.minPlayers}位玩家，而且全員連線及準備好，先可以開始。`}</Text>:!host?<Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>等房主開始。房規改動後需要再按準備。</Text>:null}
      </>:<NetworkAction testID="return-to-multiplayer-shift" colors={c} title={room.status==='countdown'&&room.loading?'返回地圖繼續準備':'返回今更'} disabled={!connected} onPress={()=>returnToShift(navigation)}/>}</View>:null}
  </KeyboardAvoidingView>;
}
const styles=StyleSheet.create({content:{padding:16,gap:12,paddingBottom:16},iconAction:{width:44,minHeight:44,alignItems:'center',justifyContent:'center'},player:{minHeight:62,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:10},setup:{minHeight:84,padding:12,borderRadius:14,borderCurve:'continuous',borderWidth:StyleSheet.hairlineWidth,flexDirection:'row',alignItems:'center',gap:10},disclosure:{minHeight:44,flexDirection:'row',alignItems:'center',gap:10},leave:{minHeight:48,alignItems:'center',justifyContent:'center'},dock:{borderTopWidth:StyleSheet.hairlineWidth,paddingHorizontal:16,paddingTop:12,gap:8}});
