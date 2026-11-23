import { LocalizedText as Text, useLocale } from '../i18n';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMultiplayer } from '../MultiplayerProvider';
import { RoomLeaderboard } from './RoomLeaderboard';
import { useGame } from '../GameProvider';
import { VEHICLE_BY_ID, getSummary } from '../game';
import type { RootStackParamList } from '../navigation';
import { Button, Divider } from './components';
import { CarIllustration } from './CarIllustration';
import { duration, money } from './theme';
import { handoverResultLabel } from './handoverResult';
import { competitionModeLabel } from './shiftPresentation';
import { MatchComparison } from './MatchComparison';

export function SummaryScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Summary'>) {
  useLocale();
  const { game, colors: c, isDark, discard, online } = useGame();
  const mp = useMultiplayer();
  const insets = useSafeAreaInsets();
  if (online && mp.snapshot) {
    const snapshot = mp.snapshot, room = snapshot.room;
    const self = snapshot.leaderboard.find(player => player.playerId === snapshot.you.playerId);
    return <View style={{ flex: 1, backgroundColor: c.background }}><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.content}><Text style={[s.caption, { color: c.secondary }]}>{game?.shiftEndReason==='fuel-completed-late'?handoverResultLabel(game):self?.forfeited ? '失去資格' : game?.handoverStatus === 'missed' ? handoverResultLabel(game) : room.status === 'finished' ? '今場已結算' : '你已交更，其他玩家仍在行駛'}</Text><Text style={[s.label, { color: c.text }]}>本更實際淨收入</Text><Text adjustsFontSizeToFit numberOfLines={1} style={[s.total, { color: c.text }]}>HK${money(self?.netIncome ?? game?.netIncome ?? 0, 2)}</Text><Text style={[s.sectionLabel, { color: c.text }]}>{competitionModeLabel(room.mode)}</Text><RoomLeaderboard entries={snapshot.leaderboard} players={room.players} selfId={snapshot.you.playerId} colors={c} finished={room.status === 'finished'} teams={room.mode==='team-net'?room.teamLeaderboard:undefined}/><Text style={{ color: c.secondary, fontSize: 14, lineHeight: 22 }}>{room.mode==='team-net'?'隊員淨收入合計；一人失去資格，全隊不列名次。':room.status === 'finished' ? '名次按實際淨收入結算；失去資格嘅玩家不列名次。' : '未交更玩家嘅收入仍會變動，最終名次待伺服器結算。'}</Text>{room.status==='finished'&&snapshot.review?<MatchComparison review={snapshot.review} selfId={snapshot.you.playerId} startTimeMinutes={room.startTimeMinutes} colors={c}/>:null}{mp.connection !== 'connected' && <Text style={{ color: c.secondary, fontSize: 14, marginTop: 12 }}>連線中斷，正在重連</Text>}</ScrollView><View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: c.surface }]}><Button title="返回房間" colors={c} onPress={() => navigation.replace('Room')}/></View></View>;
  }
  if (!game) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  const summary = game.summary || getSummary(game);
  const vehicle = VEHICLE_BY_ID[game.vehicleId];
  const values = [['司機收入', `HK$${money(summary.grossIncome, 2)}`], ['車租與行車成本', `− HK$${money(summary.expenses, 2)}`], ['完成行程', `${summary.completedTrips} 單`], ['取消訂單', `${summary.cancelledTrips} 單`], ['行駛距離', `${summary.totalDistanceKm.toFixed(1)} 公里`], ['交更狀態', handoverResultLabel(game)], ...(summary.overtimeMinutes>0? [['遲到時間',duration(summary.overtimeMinutes)]]:[])];
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.content}>
      <Text style={[s.caption, { color: c.secondary }]}>{vehicle.name} · 今更辛苦晒</Text>
      <Text style={[s.label, { color: c.text }]}>本更淨收入</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} style={[s.total, { color: c.text }]}>HK${money(summary.netIncome, 2)}</Text>
      <View style={s.art}><CarIllustration id={game.vehicleId} width={260} dark={isDark}/></View>
      <View style={[s.results, { backgroundColor: c.surface }]}>{values.map(([label, value], index) => <React.Fragment key={label}>{index > 0 && <Divider colors={c}/>}<View style={s.row}><Text style={[s.rowLabel, { color: c.secondary }]}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[s.rowValue, { color: c.text }]}>{value}</Text></View></React.Fragment>)}</View>
      <View style={s.score}><Text style={[s.rowLabel, { color: c.secondary }]}>按更份長度折算成績</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[s.scoreValue, { color: c.text }]}>HK${money(summary.score, 2)}</Text></View>
      <Text style={[s.sectionLabel, { color: c.text }]}>呢更嘅幾個決定</Text>
      {game.logs.filter(log => ['dropoff','ghost','route'].includes(log.kind)).slice(0, 5).map(log => <View key={log.id} style={[s.log, { borderBottomColor: c.line }]}><Text style={[s.logText, { color: c.secondary }]}>{log.text}</Text>{log.amount != null && <Text style={{ color: c.text, fontSize: 14, fontVariant: ['tabular-nums'] }}>${money(log.amount, 2)}</Text>}</View>)}
    </ScrollView>
    <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: c.surface }]}><Button title="再開一更" colors={c} onPress={() => { discard(); navigation.replace('Garage'); }} /></View>
  </View>;
}
const s = StyleSheet.create({ content: { padding: 24, paddingBottom: 32 }, caption: { fontSize: 14, marginTop: 12, marginBottom: 20 }, label: { fontSize: 20, fontWeight: '600' }, total: { fontSize: 44, letterSpacing: -1.8, fontWeight: '700', marginTop: 8, fontVariant: ['tabular-nums'] }, art: { alignItems: 'center', marginVertical: 16 }, results: { paddingHorizontal: 18, borderRadius: 16, borderCurve: 'continuous' }, row: { minHeight: 54, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 }, rowLabel: { fontSize: 15, flex: 1, flexShrink: 1 }, rowValue: { fontSize: 16, fontWeight: '500', maxWidth: '48%', textAlign: 'right', fontVariant: ['tabular-nums'] }, score: { paddingVertical: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scoreValue: { fontSize: 21, fontWeight: '600', maxWidth: '48%', textAlign: 'right', fontVariant: ['tabular-nums'] }, sectionLabel: { fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8 }, log: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12 }, logText: { flex: 1, fontSize: 14, lineHeight: 20 }, footer: { padding: 20 } });
