import { LocalizedText as Text } from '../i18n';
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { RankedPlayer, RoomPlayer, TeamStanding } from '../../shared/protocol';
import { roomPlayerStatus } from '../multiplayer/playerStatus';
import { VEHICLE_BY_ID } from '../data/vehicles';
import { money, type Palette } from './theme';

/** Ordering and ranks come only from the authoritative server snapshot. */
export function RoomLeaderboard({entries,players,selfId,colors:c,finished=false,teams}:{entries:RankedPlayer[];players:RoomPlayer[];selfId:string;colors:Palette;finished?:boolean;teams?:TeamStanding[]}) {
  const {width,fontScale}=useWindowDimensions();
  const stacked=fontScale>1.3||width<350;
  if(!entries.length)return <Text style={{color:c.secondary,fontSize:14,lineHeight:22,paddingVertical:12}}>伺服器未有成績更新。</Text>;
  return <View>{teams?.length?<View testID="team-standings" style={{gap:8,paddingVertical:12}}>{teams.map(team=><View key={team.teamId} style={{padding:12,gap:5,borderRadius:12,borderCurve:'continuous',backgroundColor:c.muted}}><View style={{flexDirection:'row',gap:8,alignItems:'center'}}><Text style={{flex:1,color:c.text,fontSize:16,fontWeight:'600'}}>{team.teamId} 隊 · {team.rank?`第 ${team.rank}`:'不列名次'}</Text><Text style={{color:team.forfeited?c.secondary:c.text,fontWeight:'600',fontSize:16,fontVariant:['tabular-nums']}}>HK${money(team.netIncome,2)}</Text></View><Text translate={false} style={{color:c.secondary,fontSize:13,lineHeight:19}}>{team.playerIds.map(id=>players.find(player=>player.id===id)?.nickname??'').filter(Boolean).join(' · ')}</Text><Text style={{color:c.secondary,fontSize:12}}>{team.forfeited?'隊員失去資格，全隊不列名次':team.finished?'全隊已完成':'兩位隊員淨收入合計'}</Text></View>)}</View>:null}{entries.map((entry,index)=>{
    const player=players.find(item=>item.id===entry.playerId),own=entry.playerId===selfId;
    const status=entry.forfeited?'失去資格':entry.finished?(entry.late?'遲到交更':'已交更'):!entry.connected?'暫時斷線':player?roomPlayerStatus(player):'進行中';
    const income=<View style={{alignItems:stacked?'flex-start':'flex-end',gap:3,maxWidth:stacked?undefined:'44%',flexShrink:stacked?0:1}}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} style={{color:entry.forfeited?c.secondary:c.text,fontSize:16,fontWeight:'600',fontVariant:['tabular-nums']}}>HK${money(entry.netIncome,2)}</Text>{finished&&entry.score!==entry.netIncome&&!entry.forfeited?<Text style={{color:c.secondary,fontSize:11,fontVariant:['tabular-nums']}}>折算 ${money(entry.score,2)}</Text>:null}</View>;
    return <View key={entry.playerId} testID={`rank-${entry.playerId}`} style={[styles.row,{borderTopWidth:index?StyleSheet.hairlineWidth:0,borderColor:c.line}]}>
      <Text style={[styles.rank,{color:own?c.blue:c.secondary}]}>{entry.rank??'—'}</Text>
      <View style={{flex:1,gap:5}}><View style={{flexDirection:'row',alignItems:'flex-start',gap:8}}><Text style={{flex:1,color:c.text,fontSize:15,fontWeight:own?'600':'500',lineHeight:21}}><Text translate={false}>{entry.nickname}</Text>{own?'（你）':''}</Text>{!stacked?income:null}</View><Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>{player?.teamId?`${player.teamId} 隊 · `:''}{player?.vehicleId?VEHICLE_BY_ID[player.vehicleId]?.name??'已選車輛':'未選車'} · {status} · {entry.completedTrips}單</Text>{stacked?income:null}</View>
    </View>;
  })}</View>;
}
const styles=StyleSheet.create({row:{minHeight:68,paddingVertical:11,flexDirection:'row',alignItems:'flex-start',gap:10},rank:{minWidth:22,paddingTop:1,fontSize:18,fontWeight:'600',fontVariant:['tabular-nums']}});
