import { LocalizedText as Text, useLocale } from '../i18n';
import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import type { RootStackParamList } from '../navigation';
import { RoomLeaderboard } from './RoomLeaderboard';
import { Group, MultiplayerPage, NetworkAction, StatusMessage, SupportingText, multiplayerStyles as s } from './multiplayerParts';
import { competitionModeLabel } from './shiftPresentation';
import { MatchComparison } from './MatchComparison';

export function LeaderboardScreen({navigation}:NativeStackScreenProps<RootStackParamList,'Leaderboard'>) {
  useLocale();
  const {colors:c}=useGame();
  const mp=useMultiplayer(),snapshot=mp.snapshot;
  return <MultiplayerPage colors={c}>
    {!snapshot?<StatusMessage colors={c} title="未有房間成績" detail="加入房間並開始一更，就可以查看今場名次。"/>:<>
      <Text style={[s.title,{color:c.text}]}>{snapshot.room.status==='finished'?'今場成績':'即時名次'}</Text>
      <SupportingText colors={c}>房間 {snapshot.room.code} · {competitionModeLabel(snapshot.room.mode)}</SupportingText>
      {mp.connection!=='connected'?<StatusMessage colors={c} title="等候重新連線" detail="以下係最近一次收到嘅伺服器資料。" action={()=>mp.reconnect()} actionTitle="重新連線"/>:null}
      <Group colors={c}><RoomLeaderboard entries={snapshot.leaderboard} players={snapshot.room.players} selfId={snapshot.you.playerId} colors={c} finished={snapshot.room.status==='finished'} teams={snapshot.room.mode==='team-net'?snapshot.room.teamLeaderboard:undefined}/></Group>
      {snapshot.room.status==='finished'&&snapshot.review?<MatchComparison review={snapshot.review} selfId={snapshot.you.playerId} startTimeMinutes={snapshot.room.startTimeMinutes} colors={c}/>:null}
      <SupportingText colors={c}>只顯示今場由伺服器結算嘅玩家資料；未交更嘅收入仍會變動，失去資格嘅玩家不列名次。</SupportingText>
    </>}
    <NetworkAction colors={c} title={snapshot?'返回房間':'前往多人開更'} onPress={()=>navigation.navigate(snapshot?'Room':'MultiplayerLobby')}/>
  </MultiplayerPage>;
}
