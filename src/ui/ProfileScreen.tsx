import { LocalizedText as Text, LocalizedTextInput as TextInput, useLocale } from '../i18n';
import React, { useEffect, useState } from 'react';
import { Keyboard, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import { MULTIPLAYER_LIMITS } from '../../shared/protocol';
import type { RootStackParamList } from '../navigation';
import {reviewCounts,reviewPeriod} from '../../shared/training';
import { Icon } from './components';
import { Group, MultiplayerPage, NetworkAction, StatusMessage, SupportingText, multiplayerStyles as s, useNetworkTask } from './multiplayerParts';

export function ProfileScreen({navigation}:NativeStackScreenProps<RootStackParamList,'Profile'>) {
  useLocale();
  const {colors:c}=useGame();
  const mp=useMultiplayer();
  const [draft,setDraft]=useState(mp.nickname);
  const task=useNetworkTask();
  useEffect(()=>{if(mp.hydrated)setDraft(mp.nickname);},[mp.hydrated]);
  const trimmed=draft.normalize('NFKC').trim(),count=Array.from(trimmed).length;
  const valid=count>0 && count<=MULTIPLAYER_LIMITS.nicknameCharacters;
  const verified=mp.driverAccount?.stats;
  const baseline=verified?.reviewBaseline;
  const periods=[{label:'本機單人',period:mp.soloReview.activePeriod},...(verified?[{label:'線上已核實',period:reviewPeriod(baseline?.periodId||'lifetime',baseline?.startedAt||0,reviewCounts(verified,baseline?.counters))}]:[])];
  const rate=(value:number|null)=>value==null?'—':`${Math.round(value*100)}%`;
  const save=()=>{if(!valid||!mp.hydrated||task.busy||mp.pending)return;Keyboard.dismiss();mp.clearError();void task.run('profile',()=>mp.saveNickname(trimmed),()=>navigation.goBack());};
  return <MultiplayerPage colors={c} keyboard>
    <View style={{alignItems:'center',paddingVertical:12,gap:12}}><View style={{width:72,height:72,borderRadius:36,backgroundColor:c.muted,justifyContent:'center',alignItems:'center'}}><Icon name={{ios:'person.crop.circle',android:'account_circle'}} size={44} color={c.secondary}/></View><Text style={[s.heading,{color:c.text}]}>你想大家點稱呼你？</Text></View>
    {!mp.hydrated ? <StatusMessage colors={c} title="讀取玩家資料…" busy/> : null}
    <Group colors={c}>
      <Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>玩家暱稱</Text>
      <TextInput key={mp.hydrated?'ready':'loading'} testID="player-nickname" accessibilityLabel="玩家暱稱" accessibilityHint="最多二十個字，會同房內玩家分享" defaultValue={mp.nickname} onChangeText={setDraft} editable={mp.hydrated&&!task.busy} placeholder="輸入暱稱" placeholderTextColor={c.secondary} style={[s.field,{color:c.text,backgroundColor:c.muted}]} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" maxLength={MULTIPLAYER_LIMITS.nicknameCharacters*2} returnKeyType="done" onSubmitEditing={save}/>
      <Text style={{color:c.secondary,fontSize:12,fontVariant:['tabular-nums']}}>{count} / {MULTIPLAYER_LIMITS.nicknameCharacters} 個字</Text>
    </Group>
    <Group colors={c}><Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>累積司機紀錄</Text><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>{[['接單率', mp.driverStats.offered ? `${Math.round(mp.driverStats.acceptanceRate * 100)}%` : '—'], ['取消率', mp.driverStats.accepted ? `${Math.round(mp.driverStats.cancellationRate * 100)}%` : '—'], ['完成行程', String(mp.driverStats.completedTrips)]].map(([label, value]) => <View key={label} style={{ gap: 6 }}><Text style={{ color: c.secondary, fontSize: 13 }}>{label}</Text><Text translate={false} style={{ color: c.text, fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text></View>)}</View><Text style={{ color: c.secondary, fontSize: 12, lineHeight: 19 }}>紀錄跨局保留。單人紀錄保存在本機；聯機紀錄由司機帳號保存，派單只採用伺服器核實嘅紀錄。</Text>{mp.driverAccount&&<Text translate={false} selectable style={{ color: c.secondary, fontSize: 11 }}>{mp.driverAccount.driverId}</Text>}</Group>
    <Group colors={c}><Text style={{color:c.text,fontSize:17,fontWeight:'600'}}>目前觀察期</Text>{periods.map(({label,period})=><View key={label} style={{gap:4}}><Text style={{color:c.secondary,fontSize:13}}>{label}</Text><Text translate={false} style={{color:c.text,fontSize:22,fontVariant:['tabular-nums']}}>{rate(period.acceptanceRate)} / {rate(period.cancellationRate)}</Text></View>)}<Text style={{color:c.secondary,fontSize:12}}>接單率／取消率；沒有新樣本時顯示「—」。</Text><NetworkAction testID="open-training" title="學習以重置" colors={c} disabled={!mp.hydrated} onPress={()=>navigation.navigate('Training')}/></Group>
    <SupportingText colors={c}>暱稱會顯示喺房間、遊戲地圖同今場成績，並保存喺呢部機。</SupportingText>
    <Group colors={c}><NetworkAction testID="profile-pro" title="港運 Pro" colors={c} onPress={()=>navigation.navigate('Pro')}/><NetworkAction testID="profile-elite" title="專屬預約（ELITE）" colors={c} onPress={()=>navigation.navigate('Elite')}/></Group>
    {count>MULTIPLAYER_LIMITS.nicknameCharacters ? <StatusMessage colors={c} title={`暱稱最多${MULTIPLAYER_LIMITS.nicknameCharacters}個字`} detail="縮短少少就可以儲存。"/> : null}
    {task.error ? <StatusMessage colors={c} testID="profile-error" title="未能儲存" detail={task.error}/> : null}
    <NetworkAction testID="save-player-profile" title="儲存暱稱" pendingTitle="儲存中…" colors={c} pending={task.busy==='profile'} disabled={!valid||!mp.hydrated||!!mp.pending} onPress={save}/>
  </MultiplayerPage>;
}
