import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {LocalizedText as Text, t} from '../i18n';
import type {GameState} from '../game/types';
import type {AirportDemandEstimate, AirportPool, AirportRoomView} from '../../shared/airport';
import {airportPoolForVehicle, canNavigateToAirport, type airportJourney} from '../game/airport';
import {Button, IconButton} from './components';
import type {Palette} from './theme';

export const airportPoolLabel = (pool: AirportPool) =>
  pool === 'taxi' ? '的士隊列' : pool === 'xl' ? '大型車隊列' : '私家車隊列';

export const airportDemandLabel = (level: AirportDemandEstimate['level']) =>
  level === 'busy' ? '需求較高' : level === 'normal' ? '一般需求' : '需求較低';

export function AirportDemandPanel({game, demand, room, journey, colors: c, busy, onAction, onClose}: {
  game: GameState; demand: AirportDemandEstimate; room?: AirportRoomView;
  journey: ReturnType<typeof airportJourney>; colors: Palette; busy: boolean;
  onAction: (choice: 'go' | 'join' | 'leave') => void; onClose: () => void;
}) {
  const queue = game.airportQueue;
  const pool = airportPoolForVehicle(game);
  const view = room?.pools.find(item => item.pool === pool);
  const canGo = canNavigateToAirport(game) && !!journey;
  const ahead = Math.max(0, queue?.ahead ?? 0);
  const waitMin = queue ? ahead * 2 : demand.estimatedWaitMin;
  const waitMax = queue ? demand.estimatedWaitMax + ahead * 4 : view?.estimatedWaitMax ?? demand.estimatedWaitMax;

  return <View testID="airport-demand-panel" style={[s.panel, {backgroundColor:c.surface,borderColor:c.line}]}>
    <View style={s.header}>
      <View style={s.titleGroup}>
        <Text accessibilityRole="header" style={[s.title, {color:c.text}]}>香港國際機場</Text>
        <Text translate={false} style={[s.subtitle, {color:c.blue}]}>{`HKG · ${t(airportDemandLabel(demand.level))}`}</Text>
      </View>
      <IconButton label="關閉機場需求" name={{ios:'xmark',android:'close'}} colors={c} onPress={onClose}/>
    </View>
    <ScrollView style={s.scroll} contentContainerStyle={s.details} bounces={false}>
      <View style={s.stats}>
        <Text style={[s.body, {color:c.text}]}>{airportPoolLabel(pool)}</Text>
        {queue ? <Text testID="airport-own-position" style={[s.body, {color:c.text}]}>
          {queue.assignmentPending ? '正在確認輪候次序…' : `目前第 ${queue.position ?? 1} 位 · 共 ${queue.total ?? 1} 位`}
        </Text> : view ? <Text style={[s.body, {color:c.secondary}]}>{`輪候 ${view.total} 位`}</Text> : null}
      </View>
      <Text style={[s.body, {color:c.secondary}]}>{`估計等候 ${waitMin}–${waitMax} 分鐘`}</Text>
      {queue?.priority ? <Text style={[s.body, {color:c.blue}]}>鑽石優先</Text> : null}
      {journey && !queue ? <Text style={[s.body, {color:c.secondary}]}>{`約 ${(journey.distanceM / 1000).toFixed(1)} 公里 · ${Math.ceil(journey.minutes)} 分鐘`}</Text> : null}
      {!queue && !canGo ? <Text style={[s.body, {color:c.secondary}]}>完成目前行程或操作後可前往。</Text> : null}
    </ScrollView>
    {queue
      ? <Button testID="leave-airport-queue" title="離開機場隊列" colors={c} secondary disabled={busy} style={s.button} onPress={() => onAction('leave')}/>
      : <View style={s.actions}>
        <Button testID="go-to-airport" title="立即出發" colors={c} disabled={!canGo || busy} style={s.button} onPress={() => onAction('go')}/>
        <Button testID="join-airport-queue" title="前往並加入隊列" colors={c} secondary disabled={!canGo || busy || !game.acceptingOrders}
          style={s.button} onPress={() => onAction('join')}/>
      </View>}
  </View>;
}

const s = StyleSheet.create({
  panel:{borderRadius:32,borderCurve:'continuous',padding:16,gap:12,maxHeight:365,borderWidth:StyleSheet.hairlineWidth},
  header:{flexDirection:'row',alignItems:'center',gap:12},
  titleGroup:{flex:1,gap:4},
  title:{fontSize:20,fontWeight:'700'},
  subtitle:{fontSize:14,fontWeight:'600'},
  scroll:{flexShrink:1},
  details:{gap:5},
  stats:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:8},
  body:{fontSize:15,lineHeight:22},
  actions:{gap:8},
  button:{minHeight:56,borderRadius:16},
});

