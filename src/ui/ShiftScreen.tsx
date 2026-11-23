import { getShiftDurationMinutes } from '../game/shiftDuration';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { LocalizedText as Text, LocalizedPressable as Pressable, getLocalizedPlaceName, getLocalizedLocality, useLocale, t } from '../i18n';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import { roomPlayerStatus } from '../multiplayer/playerStatus';
import type { MapPeer } from '../map/PeerVehicle';
import { nearestNode } from '../game/routing';
import { getLookahead, getHandoverPlan, getFuelQueueVehicles, getRouteEventOptions, getPhaseRemainingMinutes, getUpcomingBranches, getVehiclePosition, getLocalDemandConditions, getLocalTrafficConditions, getRemainingTripRouteCoordinates, getOfferPreviewRoutes, VEHICLE_BY_ID } from '../game';
import { useScreenCorners, insetScreenCornerRadius } from '../map/useScreenCorners';
import { GameMap } from '../map/GameMap';
import { getVehicleRoadGraph } from '../data/vehicleAccess';
import type { RootStackParamList } from '../navigation';
import { Button, Icon, IconButton } from './components';
import { OfferCard } from './OfferCard';
import {OfferPlanningResume} from './OfferPlanningResume';
import { PeerOrderNotice } from './PeerOrderNotice';
import { WorldEventNotice } from './WorldEventNotice';
import { getWorldEventViews } from '../../shared/worldEvents';
import { duration, gameTime, money } from './theme';
import {useDemandDisplay} from './useDemandDisplay';
import {completedFareReveals,isBlindBoarded} from '../../shared/blindOrders';
import {FareRevealNotice} from './FareRevealNotice';
import {MultiplayerHornButton} from './MultiplayerHornButton';
import {RouteEventNotice} from './RouteEventNotice';
import {showsDrivingTraffic,showsRouteEvent} from './routeEventPresentation';
import {AirportDemandPanel} from './AirportDemandPanel';
import {airportDemand,airportEnabled,airportJourney,canNavigateToAirport} from '../game/airport';
import {EliteBookingNotice} from './EliteBookingNotice';
import {nextGameSpeed} from './shiftPresentation';

export function ShiftScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Shift'>) {
  const locale = useLocale();
  const controller = useGame();
  const mp = useMultiplayer();
  const { game, colors: c, isDark, setPaused, setPlanning, planning, paused, speed, setSpeed, online, blindOrders } = controller;
  const insets = useSafeAreaInsets();
  const corners = useScreenCorners();
  const bottomMargin = Math.max(insets.bottom, 12);
  const bottomCorners = { borderBottomLeftRadius: insetScreenCornerRadius(corners.bottomLeft, 12, bottomMargin, process.env.EXPO_OS==='ios'?24:16), borderBottomRightRadius: insetScreenCornerRadius(corners.bottomRight, 12, bottomMargin, process.env.EXPO_OS==='ios'?24:16) };
  const [panelHeight, setPanelHeight] = useState(100);
  const [topHeight, setTopHeight] = useState(105);
  const [airportOpen,setAirportOpen]=useState(false),airportPreviousPause=React.useRef(false);
  const openAirport=()=>{if(airportOpen)return;airportPreviousPause.current=paused;if(!online)setPaused(true);setAirportOpen(true);};
  const closeAirport=()=>{setAirportOpen(false);if(!online)setPaused(airportPreviousPause.current);};
  useEffect(()=>{if(airportOpen&&game?.currentOffer)closeAirport();},[game?.currentOffer?.id,airportOpen]);
  useEffect(()=>{if(!airportOpen)return;const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{closeAirport();return true;});return()=>subscription.remove();},[airportOpen,online]);
  const [mapAttempt,setMapAttempt]=useState(0),[loadingNow,setLoadingNow]=useState(Date.now());
  const baseMapId=React.useRef(`map-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const {mapSessionKey,beginMapLoad,reportMapLoad,endMapLoad,setShiftVisible}=controller;
  const mapInstance=`${baseMapId.current}:${mapSessionKey}:${mapAttempt}`;
  const localMapReady=controller.mapReady&&controller.mapInstanceId===mapInstance;
  const loadingRoom=online&&mp.snapshot?.room.status==='countdown'&&!!mp.snapshot.room.loading;
  useEffect(()=>{beginMapLoad(mapSessionKey,mapInstance);return()=>endMapLoad(mapSessionKey,mapInstance);},[mapSessionKey,mapInstance,beginMapLoad,endMapLoad]);
  useEffect(()=>{if(!loadingRoom)return;const timer=setInterval(()=>setLoadingNow(Date.now()),200);return()=>clearInterval(timer);},[loadingRoom]);
  const loading=mp.snapshot?.room.loading;
  const readinessAck=React.useRef<string|null>(null);
  const shouldAckReady=localMapReady&&controller.foreground&&controller.shiftVisible;
  const serverAcknowledged=!!loading?.readyPlayerIds.includes(mp.snapshot?.you.playerId??'');
  useEffect(()=>{
    if(!online||!loading||mp.snapshot?.room.status!=='countdown'||mp.connection!=='connected'||mp.pending)return;
    const key=`${loading.epoch}:${shouldAckReady}`;
    if(serverAcknowledged===shouldAckReady){readinessAck.current=null;return;}
    if(readinessAck.current===key)return;readinessAck.current=key;
    void mp.setMapReady(loading.epoch,shouldAckReady).catch(()=>{}).finally(()=>{if(readinessAck.current===key)readinessAck.current=null;});
  },[online,loading?.epoch,serverAcknowledged,shouldAckReady,mp.connection,mp.pending,mp.snapshot?.room.status,mp.snapshotReceivedAt]);
  const retryMap=()=>{const next=mapAttempt+1;beginMapLoad(mapSessionKey,`${baseMapId.current}:${mapSessionKey}:${next}`);setMapAttempt(next);};
  useFocusEffect(useCallback(() => { setShiftVisible(true);setPaused(false); return () => { setShiftVisible(false);setPaused(true); setPlanning(false);setAirportOpen(false); }; }, [setPaused, setPlanning,setShiftVisible]));
  useEffect(() => {
    if (game?.phase === 'ended') { setPaused(true); navigation.replace('Summary'); }
  }, [game?.phase, navigation, setPaused]);
  const previousOnline=React.useRef(online);
  useEffect(()=>{if(previousOnline.current&&!online)navigation.replace('Room');previousOnline.current=online;},[online,navigation]);
  const graph = useMemo(() => getVehicleRoadGraph(game?.vehicleId ?? 'kam-fung'), [game?.vehicleId]);
  const offerPreview = useMemo(() => {if(!game)return null;const preview=getOfferPreviewRoutes(game,graph);return preview&&blindOrders?{...preview,destination:preview.pickup,destinationHidden:true,tripRoute:[]}:preview;}, [game?.currentOffer?.id, graph,blindOrders]);
  const peers = useMemo<MapPeer[]>(() => online && mp.snapshot ? mp.snapshot.room.players.flatMap((player, index) => player.id === mp.snapshot!.you.playerId || !player.position || player.forfeited || player.status === 'left' ? [] : [{ id: player.id, name: player.nickname, position: player.position, route: player.route, vehicleId: player.vehicleId, connected: player.connected, statusLabel: roomPlayerStatus(player), tripLabel: player.order?.pickupName && player.order.destinationName ? `${getLocalizedPlaceName({name:player.order.pickupName,nameEn:player.order.pickupNameEn})} → ${getLocalizedPlaceName({name:player.order.destinationName,nameEn:player.order.destinationNameEn})}` : undefined, color: ['#B359DC','#DB8732','#2AABA1','#DC6683','#7D82CF','#859E39','#A57756','#4495B7'][index % 8] }]) : [], [online, mp.snapshot, locale]);
  useEffect(() => {
    const self = mp.snapshot?.room.players.find(player => player.id === mp.snapshot?.you.playerId);
    if (online && (self?.forfeited || self?.status === 'left')) navigation.replace('Room');
  }, [online, mp.snapshot?.room.status, mp.snapshot?.room.players, navigation]);
  const overview = useMemo(() => game?.phase === 'dropoff' && game.activeTrip ? { id: `${game.activeTrip.offer.id}:${game.activeTrip.pickedUpAt}`, coordinates: getRemainingTripRouteCoordinates(game) } : undefined, [game?.phase, game?.activeTrip?.offer.id, game?.activeTrip?.pickedUpAt]);
  const surgeAreas=useDemandDisplay(game,mapSessionKey,localMapReady,online);
  const airportEligible=!!game&&canNavigateToAirport(game);
  const airportPath=useMemo(()=>game&&airportOpen&&airportEligible?airportJourney(game,graph):null,[airportOpen,airportEligible,game?.vehicleId,game?.movement.edgeId,game?Math.floor(game.movement.distanceOnEdgeM/100):0,graph]);
  const remainingTripRoute=useMemo(()=>controller.showFullTripRoute&&game?.phase==='dropoff'?getRemainingTripRouteCoordinates(game,graph):undefined,[controller.showFullTripRoute,game?.phase,game?.movement,graph]);
  const fareReveals=useMemo(()=>blindOrders&&game?completedFareReveals(game):[],[blindOrders,game?.logs]);
  const handoverPlan = useMemo(() => game?.handoverPlace&&!(blindOrders&&((game.activeTrip&&!isBlindBoarded(game))||game.queuedTrip)) ? getHandoverPlan(game, graph) : undefined, [blindOrders,game?.activeTrip?.pickedUpAt,game?.queuedTrip?.offer.id,game?.vehicleId, game?.handoverPlace?.id, game ? Math.floor(game.clockMinutes * 2) : 0, game?.phase, game?.navigation?.target.id, graph]);
  const eventOptions = useMemo(() => game?.routeEvent && !game.routeEvent.resolved ? getRouteEventOptions(game, graph) : { stay: true, reroute: false }, [game?.routeEvent?.id, game?.routeEvent?.resolved, game?.activeTrip?.offer.id, game?.navigation?.target.id, graph]);
  if (!game) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  const vehicle = VEHICLE_BY_ID[game.vehicleId];
  const position = getVehiclePosition(game);
  const branches = getUpcomingBranches(game);
  const trip = game.activeTrip;
  const charge=game.energy.kind==='charge',chargeSession=game.chargingSession;
  const charging=charge&&game.navigation?.kind==='charge'&&game.navigation.stage==='servicing'&&!!chargeSession;
  const networkBusy=online&&(mp.connection!=='connected'||!!mp.pending);
  const waiting = ['waiting', 'boarding', 'alighting'].includes(game.phase);
  const remainingSeconds = Math.max(1, Math.ceil(getPhaseRemainingMinutes(game) * 60));
  const destination = game.navigation?.target ?? (['dropoff','alighting'].includes(game.phase) ? trip?.offer.destination : trip?.offer.pickup);
  const suspended = game.platform.suspendedUntil > game.clockMinutes;
  const phaseTitle = !online && (planning || paused) ? '已暫停' : game.parking ? (game.parking.kind === 'temporary' ? '臨時停車' : '休息中') : ({ cruising: '巡遊中', pickup: '前往上客', waiting: '等緊乘客', boarding: '乘客上車中', dropoff: '送客途中', alighting: '已停車，乘客落車中', 'safe-dropoff': game.navigation?.stage === 'servicing' ? '已停車，乘客落車中' : '尋找安全位置落客', 'service-route': game.navigation?.kind==='airport'?'前往機場':game.navigation?.kind === 'handover' ? '前往交更' : game.navigation?.kind === 'parking' ? (game.navigation.parkingKind==='rest'?'前往安全休息點':'前往安全停車點') : game.navigation?.handoverAfterService ? (charge?'交更前充電':'交更前補給') : charge?'前往充電站':'前往補充能源', 'fuel-queue': '排隊輪候補給', servicing: game.navigation?.kind==='parking'?'正喺安全泊位停定':game.energyRecovery ? '能源救援中' : charging?'充電中':game.navigation?.kind === 'swap' ? '換電中' : '入氣／加油中', ended: '已收更' } as Record<string,string>)[game.phase];
  const localDemand = getLocalDemandConditions(game);
  const trafficLabel={free:t('路面暢順'),building:t('車流漸多'),congested:t('區域擠塞')}[getLocalTrafficConditions(game,position).level];
  const airportModel=airportEnabled(game)?airportDemand(game.seed,game.clockMinutes,game.startTimeMinutes):undefined;
  const subtitle = game.phase === 'fuel-queue' && game.fuelQueue ? `前面約 ${Math.max(0, Math.ceil((game.fuelQueue.serviceStartsAt - game.clockMinutes) / .8))} 架車 · 輪候約 ${Math.max(0, Math.ceil(game.fuelQueue.serviceStartsAt - game.clockMinutes))} 分鐘` : game.phase === 'safe-dropoff' ? (game.navigation?.stage === 'servicing' ? '乘客落車完成後取消訂單' : '適合停車後，停低俾乘客落車') : waiting ? `${destination ? getLocalizedPlaceName(destination) : ''} · 約 ${remainingSeconds >= 60 ? `${Math.ceil(remainingSeconds / 60)} 分鐘` : `${remainingSeconds} 秒`}` : game.phase === 'servicing' ? (charging&&chargeSession?`已充 ${chargeSession.deliveredKWh.toFixed(1)} kWh · 已付 HK$${money(chargeSession.billedCost,2)}`:game.navigation?.kind==='parking'?`${destination?getLocalizedPlaceName(destination):''} · 停定後休息`:`餘下約 ${Math.ceil(getPhaseRemainingMinutes(game))} 分鐘遊戲時間`) : game.energy.remaining <= 0 ? '能源已用盡 · 本更安排可呼叫救援' : game.parking ? (game.parking.endsAt ? `最多餘下 ${duration(game.parking.endsAt - game.clockMinutes)}` : '停止接單及休息，隨時再開車') : (destination ? getLocalizedPlaceName(destination) : undefined) ?? (game.cruiseTarget ? `巡航前往 ${getLocalizedLocality(game.cruiseTarget)} · ${game.acceptingOrders && !suspended ? '途中繼續接單' : '已暫停接單'}` : suspended ? `平台暫停派單，餘下 ${duration(game.platform.suspendedUntil - game.clockMinutes)}` : !game.acceptingOrders ? '已暫停接單' : branches[0]?.distanceM <= 300 ? '接近路口 · 點分支揀方向' : `${localDemand.district} · ${localDemand.multiplier.toFixed(2)}× · 約 ${localDemand.waitMinutesMin}–${localDemand.waitMinutesMax} 分派單`);
  const nearbyDrivers = mp.snapshot?.you.nearbyDrivers;
  const statusTitle=game.phase==='airport-queue'?'機場輪候中':phaseTitle;
  const statusSubtitle=game.phase==='airport-queue'&&game.airportQueue?(game.airportQueue.assignmentPending?'正在確認輪候次序…':`目前第 ${game.airportQueue.position??1} 位 · 共 ${game.airportQueue.total??1} 位`):subtitle;
  const worldEvents=online?(mp.snapshot?.room.featureVersion==='0.6'?mp.snapshot.room.worldEvents??[]:[]):getWorldEventViews(game.seed,game.clockMinutes,getShiftDurationMinutes(game),game.startTimeMinutes);
  const myRank = mp.snapshot?.leaderboard.find(entry => entry.playerId === mp.snapshot?.you.playerId)?.rank;
  const energyPercent = Math.round(game.energy.remaining / game.energy.capacity * 100);
  return <View style={[s.root, { backgroundColor: c.mapLand }]}>
    {controller.mapInstanceId===mapInstance&&<GameMap airportDemand={airportModel} onAirportPress={openAirport} airportPreview={airportOpen&&airportPath&&canNavigateToAirport(game)?{id:`airport:${mapSessionKey}`,coordinates:airportPath.coordinates}:null} key={mapInstance} onMapLoading={()=>reportMapLoad(mapSessionKey,mapInstance,'loading')} onMapReady={()=>reportMapLoad(mapSessionKey,mapInstance,'ready')} onMapError={()=>reportMapLoad(mapSessionKey,mapInstance,'error')} trafficWorld={{seed:game.seed,clockMinutes:game.clockMinutes,startTimeMinutes:game.startTimeMinutes,worldEvent:game.worldEvent,shiftDurationMinutes:game.shiftDurationMinutes}} remainingTripRoute={remainingTripRoute} queueVehicles={getFuelQueueVehicles(game, graph, peers.map(peer => peer.position))} canPause={!online} offerPreview={offerPreview} peers={peers} snapshotIntervalMs={online ? 900 : 150} branchPreviewDistance={Math.min(1000, Math.max(350, speed * 14))} canCruiseTo={game.phase === 'cruising' && !game.currentOffer && !game.navigation && !game.parking} onCruiseTo={coordinate => { const node = nearestNode(coordinate, graph); if (node) controller.cruiseTo(node.id); }} cruisingTarget={game.cruiseTarget} roadGraph={graph} vehicleId={game.vehicleId} tripOverview={overview} surgeAreas={surgeAreas} position={position} lookahead={getLookahead(game, 1000)} branches={branches} pickup={game.currentOffer?.pickup ?? (trip && !['dropoff','alighting','safe-dropoff'].includes(game.phase) ? trip.offer.pickup : undefined)} destination={(!blindOrders?game.currentOffer?.destination:undefined) ?? game.navigation?.target ?? (['dropoff','alighting'].includes(game.phase) ? trip?.offer.destination : undefined)} dark={isDark} onBranch={(junction, edge) => { controller.branch(junction, edge); void Haptics.selectionAsync(); }} onPlanningChange={setPlanning} planning={planning} topInset={insets.top + topHeight + 12} bottomInset={panelHeight + Math.max(insets.bottom, 12) + 16} />}
    <View pointerEvents="box-none" onLayout={event => setTopHeight(event.nativeEvent.layout.height)} style={[s.top, { top: insets.top + 6 }]}>
      <View style={s.topRow}>
        <IconButton label="暫停及設定" cue="open" name={{ ios: 'line.3.horizontal', android: 'menu' }} colors={c} onPress={() => navigation.navigate('Settings')} />
        <View testID="net-income-pill" style={[s.income, { backgroundColor: c.incomeBackground }]}><Text maxFontSizeMultiplier={1.2} translate={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.7} style={[s.incomeText, { color: c.incomeText }]}><Text maxFontSizeMultiplier={1.2} translate={false} style={{ color: c.incomeCurrency }}>HK$</Text>{money(game.netIncome)}</Text><Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit style={[s.clock, { color: c.incomeText }]}>{gameTime(game.clockMinutes, game.startTimeMinutes)} · {game.clockMinutes>getShiftDurationMinutes(game)?`逾時 ${duration(game.clockMinutes-getShiftDurationMinutes(game))}`:`餘 ${duration(getShiftDurationMinutes(game)-game.clockMinutes)}`}</Text></View>
        <Pressable testID="speed-control" accessibilityRole="button" accessibilityLabel={online ? `房間共同行車速度${speed}倍` : `行車速度${speed}倍，點擊切換`} disabled={online} onPress={() => setSpeed(nextGameSpeed)} style={[s.speed, { backgroundColor: c.surface }]}><Icon name={{ ios: 'forward.fill', android: 'fast_forward' }} size={16} color={c.text}/><Text maxFontSizeMultiplier={1.2} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{speed}×</Text></Pressable>
      </View>
      <View style={s.pills}>
        {game.advancedRulesVersion===1&&<Pressable testID="open-pro" accessibilityRole="button" accessibilityLabel="港運 Pro" onPress={()=>navigation.navigate('Pro')} style={[s.pill,{backgroundColor:c.surface}]}><Icon name={{ios:'star.circle',android:'stars'}} size={19} color={c.blue}/></Pressable>}
        {airportModel&&<Pressable testID="open-airport-demand" accessibilityRole="button" accessibilityLabel="香港國際機場" onPress={openAirport} style={[s.pill,{backgroundColor:c.surface}]}><Icon name={{ios:'airplane',android:'flight_takeoff'}} size={19} color={c.blue}/></Pressable>}
        {online && <Pressable testID="open-room-leaderboard" accessibilityRole="button" onPress={() => navigation.navigate('Room')} style={[s.pill, { backgroundColor: c.surface }]}><Icon name={{ ios: 'person.2.fill', android: 'groups' }} color={c.blue} size={17}/><Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={{ color: c.text, fontSize: 13, flexShrink: 1 }}>{mp.connection === 'connected' ? `${mp.snapshot?.room.players.filter(p => !p.forfeited && p.status !== 'left').length} 人 · ${myRank ? `第 ${myRank}` : '名次'}` : '重連中…'}</Text></Pressable>}
        <Pressable accessibilityRole="button" testID="open-order-feed" accessibilityLabel={`查看附近單，共${game.observedOffers.length}張`} onPress={() => navigation.navigate('OrderFeed')} style={[s.pill, { backgroundColor: c.surface }]}><Icon name={{ ios: 'square.stack', android: 'layers' }} size={17} color={c.secondary}/><Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={{ color: c.text, fontSize: 13, flexShrink: 1 }}>附近單 {game.observedOffers.length}</Text></Pressable>
        <Pressable testID="open-stations" accessibilityRole="button" accessibilityLabel={charge?`電量 ${energyPercent}%，查看充電站`:'入氣及能源補給站'} onPress={() => navigation.navigate('Stations')} style={[s.pill, { backgroundColor: c.surface }]}><Icon name={{ ios: charge||game.energy.kind === 'swap' ? 'bolt.fill' : 'fuelpump', android: charge||game.energy.kind === 'swap' ? 'bolt' : 'local_gas_station' }} size={17} color={c.secondary}/><Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={{ color: c.text, fontSize: 13 }}>{energyPercent}%</Text></Pressable>
        <Pressable testID="open-operations" accessibilityRole="button" accessibilityLabel="本更安排" onPress={() => navigation.navigate('Operations')} style={[s.pill, { backgroundColor: c.surface }]}><Icon name={{ ios: 'ellipsis', android: 'more_horiz' }} size={20} color={c.text}/></Pressable>
      </View>
    </View>
    {online&&<View pointerEvents="box-none" style={{position:'absolute',left:12,top:insets.top+topHeight+12}}><MultiplayerHornButton view={mp.snapshot?.you.horn} selfId={mp.snapshot?.you.playerId||''} sessionKey={mapSessionKey} serverTime={mp.snapshot?.serverTime||0} receivedAt={mp.snapshotReceivedAt} enabled={online&&localMapReady&&mp.snapshot?.room.status==='running'&&game.phase!=='ended'} soundEnabled={controller.soundEnabled} colors={c} onHorn={mp.sendHorn}/></View>}
    <View pointerEvents="box-none" onLayout={event => setPanelHeight(event.nativeEvent.layout.height)} style={[s.bottom, { bottom: bottomMargin }]}>
      {airportOpen&&airportModel?<AirportDemandPanel game={game} demand={airportModel} room={mp.snapshot?.room.airport} journey={airportPath} colors={c} busy={networkBusy} onClose={closeAirport} onAction={choice=>{controller.airport(choice);closeAirport();}}/>:<>
      {online && mp.snapshot && <PeerOrderNotice assignments={mp.snapshot.room.competition?.assignments??[]} ownPlayerId={mp.snapshot.you.playerId} roomCode={mp.snapshot.room.code} serverTime={mp.snapshot.serverTime} colors={c}/>}
      {blindOrders&&<FareRevealNotice namespace={mapSessionKey} reveals={fareReveals} colors={c}/>}
      <EliteBookingNotice state={game} colors={c} onOpen={()=>navigation.navigate('Elite')} disabled={networkBusy}/>
      {!game.currentOffer?<WorldEventNotice compact events={worldEvents} clockMinutes={game.clockMinutes} startTimeMinutes={game.startTimeMinutes} game={game} onCruise={controller.cruiseTo} colors={c} busy={online&&(!!mp.pending||mp.connection!=='connected')}/>:null}
      {online && nearbyDrivers!==undefined && nearbyDrivers>0 && !game.currentOffer && <Pressable testID="shared-dispatch-competition" accessibilityRole="button" onPress={()=>navigation.navigate('Room')} style={[s.reminder,{backgroundColor:c.surface}]}><Icon name={{ios:'person.2.fill',android:'groups'}} color={c.blue} size={18}/><Text maxFontSizeMultiplier={1.2} style={{color:c.secondary,fontSize:12}}>附近 {nearbyDrivers} 位對手 · 共用乘客需求</Text></Pressable>}
      {online && mp.error && <Pressable accessibilityRole="button" onPress={mp.clearError} style={[s.reminder, { backgroundColor: c.surface }]}><Text maxFontSizeMultiplier={1.2} style={{ flex: 1, color: c.text, fontSize: 13 }}>{mp.error}</Text><Icon name={{ ios: 'xmark', android: 'close' }} size={16} color={c.secondary}/></Pressable>}
      {energyPercent <= 15 && !game.energyRecovery && <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Stations')} style={[s.reminder, { backgroundColor: c.surface }]}><Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={{ color: c.text, fontSize: 13, flexShrink: 1 }}>能源剩餘 {energyPercent}% · 前往補給或查看救援</Text><Icon name={{ ios: 'chevron.right', android: 'chevron_right' }} size={14} color={c.text}/></Pressable>}
      {(game.handoverReminderShown || handoverPlan?.shouldReturnNow) && !game.deadlineSettlement && <View testID="handover-reminder" style={[s.handover, { backgroundColor: c.surface }]}><Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={{ color: c.text, fontSize: 13 }}>{handoverPlan?.needsRefuel ? `交更前需補給 · 預留約 ${Number.isFinite(handoverPlan.totalRequiredMinutes) ? Math.ceil(handoverPlan.totalRequiredMinutes+15) : '—'} 分鐘` : '接近交更 · 預留輪候及回程時間'}</Text>{handoverPlan?.needsRefuel && <Text maxFontSizeMultiplier={1.2} style={{ color: c.secondary, fontSize: 11 }}>前往交更會先補給，再自動返回交更點。</Text>}<View style={{ flexDirection: 'row', gap: 8 }}><Pressable testID="handover-refuel" accessibilityRole="button" onPress={() => navigation.navigate('Stations')} style={[s.handoverAction, { backgroundColor: c.muted }]}><Icon name={{ ios: charge?'bolt.fill':'fuelpump', android:charge?'bolt':'local_gas_station' }} size={17} color={c.text}/><Text maxFontSizeMultiplier={1.2} style={{ color: c.text }}>{charge?'充電／補給':'入氣／補給'}</Text></Pressable><Pressable testID="handover-return" accessibilityRole="button" disabled={!!trip||!!game.queuedTrip||game.clockMinutes>=getShiftDurationMinutes(game)} onPress={controller.handover} style={[s.handoverAction, { backgroundColor: c.muted }]}><Icon name={{ ios: 'flag.checkered', android: 'flag' }} size={17} color={c.text}/><Text maxFontSizeMultiplier={1.2} style={{ color: c.text }}>交更點</Text></Pressable></View></View>}
      {game.deadlineSettlement && <View testID="late-refuel-status" style={[s.reminder,{backgroundColor:c.surface}]}><Icon name={{ios:'clock.badge.exclamationmark',android:'schedule'}} color={c.blue} size={18}/><Text maxFontSizeMultiplier={1.2} style={{color:c.text,fontSize:13,flex:1}}>已逾交更時間，完成目前補給後收更。</Text></View>}
      {game.queuedTrip && <View testID="queued-next-trip" style={[s.reminder, { backgroundColor: c.surface }]}><View style={{ flex: 1, gap: 3 }}><Text maxFontSizeMultiplier={1.2} style={{ color: c.blue, fontSize: 12, fontWeight: '600' }}>已預留下一單 · 落客後出發</Text><Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={{ color: c.text, fontSize: 13 }}>{getLocalizedPlaceName(game.queuedTrip.offer.pickup)} → {getLocalizedPlaceName(game.queuedTrip.offer.destination)}</Text></View><Pressable testID="cancel-queued-order" accessibilityRole="button" accessibilityLabel="取消下一張訂單" onPress={controller.cancelQueued} style={s.action}><Icon name={{ ios: 'xmark', android: 'close' }} color={c.secondary} size={20}/></Pressable></View>}
      <OfferPlanningResume online={online} planning={planning} hasOffer={!!game.currentOffer} mapReady={localMapReady} colors={c} onResume={()=>{setPlanning(false);setPaused(false);}}/>
      {game.currentOffer ? <OfferCard blindOrders={blindOrders} key={game.currentOffer.id} offer={game.currentOffer} privateCar={vehicle.type === 'private'} minutes={game.clockMinutes} deadline={controller.offerDeadline} pausedAt={controller.offerPausedAt} colors={c} bottomCorners={bottomCorners} onAccept={controller.accept} onDecline={controller.decline} busy={online && (!!mp.pending || mp.connection !== 'connected')} automatic={controller.autoAcceptEnabled} /> : <>
        {game.routeEvent&&showsRouteEvent(game,game.routeEvent)&&<RouteEventNotice event={game.routeEvent} clockMinutes={game.clockMinutes} rerouteAvailable={eventOptions.reroute} onChoice={controller.event} colors={c}/>}
        <View style={[s.status, { backgroundColor: c.surface, borderColor: c.line }, bottomCorners]}>
          <View style={{ flex: 1, gap: 5 }}><Text maxFontSizeMultiplier={1.2} style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>{statusTitle}</Text>{controller.autoAcceptEnabled&&game.acceptingOrders&&!game.parking&&<Text maxFontSizeMultiplier={1.2} style={{color:c.blue,fontSize:11,fontWeight:'600'}}>自動接單已開</Text>}{!game.acceptingOrders&&!game.parking&&<Text maxFontSizeMultiplier={1.2} style={{color:c.secondary,fontSize:11}}>已暫停接單</Text>}<Text maxFontSizeMultiplier={1.2} style={{ color: c.secondary, fontSize: 13 }} numberOfLines={2}>{statusSubtitle}{game.phase==='cruising'&&showsDrivingTraffic(game)&&<Text translate={false}> · {trafficLabel}</Text>}</Text>{charging&&<Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={{color:c.secondary,fontSize:11}}>餘下約 {Math.ceil(getPhaseRemainingMinutes(game))} 分鐘遊戲時間</Text>}</View>
          {charging?<Pressable testID="shift-stop-charging" accessibilityRole="button" accessibilityLabel="停止充電" accessibilityHint="保留已充電量及費用" disabled={networkBusy} onPress={controller.stopCharging} style={[s.action,{width:52,height:52,gap:2,backgroundColor:c.muted,opacity:networkBusy ? .4 : 1}]}><Icon name={{ios:'stop.fill',android:'stop'}} color={c.text} size={18}/><Text maxFontSizeMultiplier={1.2} style={{color:c.text,fontSize:11,fontWeight:'600'}}>停止</Text></Pressable>:trip ? <Pressable testID="cancel-order" accessibilityRole="button" accessibilityLabel="取消目前訂單" disabled={['safe-dropoff','alighting'].includes(game.phase) || (online && !!mp.pending)} onPress={controller.cancel} style={[s.action, { backgroundColor: c.muted, opacity: ['safe-dropoff','alighting'].includes(game.phase) ? .4 : 1 }]}><Icon name={{ ios: 'xmark', android: 'close' }} color={c.secondary} size={20}/></Pressable> : <Pressable testID="park-or-drive" accessibilityRole="button" accessibilityLabel={game.phase==='airport-queue'?'離開機場隊列':game.parking ? '立即開車' : game.phase === 'fuel-queue' ? '離開補給隊列' : game.phase === 'service-route' ? '取消導航，繼續巡遊' : '臨時停車五分鐘'} disabled={game.phase === 'servicing'} onPress={game.phase==='airport-queue'?()=>controller.airport('leave'):game.parking || ['service-route', 'fuel-queue'].includes(game.phase) ? controller.drive : controller.park} style={[s.action, { backgroundColor: c.muted }]}><Icon name={{ ios: game.parking ? 'play.fill' : ['service-route', 'fuel-queue','airport-queue'].includes(game.phase) ? 'xmark' : 'parkingsign', android: game.parking ? 'play_arrow' : ['service-route', 'fuel-queue','airport-queue'].includes(game.phase) ? 'close' : 'local_parking' }} color={c.text} size={22}/></Pressable>}
          {!online && (planning || paused) && <Pressable accessibilityRole="button" accessibilityLabel="繼續行車" onPress={() => { setPlanning(false); setPaused(false); }} style={[s.action, { backgroundColor: c.primary }]}><Icon name={{ ios: 'play.fill', android: 'play_arrow' }} color={c.onPrimary} size={20}/></Pressable>}
        </View>
      </>}
      </>}
    </View>
    {(!localMapReady||loadingRoom)&&<View testID="map-startup-gate" style={[StyleSheet.absoluteFill,{zIndex:40,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:localMapReady?'rgba(0,0,0,0.12)':c.background}]}>
      <View style={{width:'100%',maxWidth:340,padding:22,gap:14,borderRadius:18,borderCurve:'continuous',backgroundColor:c.surface}}>
        {controller.mapLoadStatus!=='error'?<ActivityIndicator color={c.blue}/>:null}
        <Text style={{color:c.text,fontSize:18,fontWeight:'600',textAlign:'center'}}>{controller.mapLoadStatus==='error'?'地圖未能載入':!localMapReady?'載入地圖…':mp.snapshot?.room.startsAt?`${Math.max(0,Math.ceil((mp.snapshot.room.startsAt-(mp.snapshot.serverTime+Math.max(0,loadingNow-mp.snapshotReceivedAt)))/1000))}秒後一齊開更`:'等候其他玩家載入地圖…'}</Text>
        <Text style={{color:c.secondary,fontSize:14,lineHeight:21,textAlign:'center'}}>{loadingRoom?`地圖已準備 ${loading?.readyPlayerIds.length??0}/${mp.snapshot?.room.players.filter(player=>player.status!=='left'&&!player.forfeited).length??0} · 全員就緒先開始計時及派單。`:online?'比賽時間繼續，地圖載好後恢復操作。':'地圖載好先開始計時及派單；現有接單倒數會保留。'}</Text>
        {controller.mapLoadStatus==='error'?<Button testID="retry-game-map" title="重新載入地圖" colors={c} onPress={retryMap}/>:null}
        <Button title={online?'返回房間':'返回車房'} colors={c} secondary onPress={()=>{setPaused(true);if(online)navigation.navigate('Room');else navigation.reset({index:0,routes:[{name:'Garage'}]});}}/>
      </View>
    </View>}
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1 }, top: { position: 'absolute', left: 12, right: 12, gap: 7 }, topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, income: { borderRadius: 28, paddingHorizontal: 22, minHeight: 54, justifyContent: 'center', alignItems: 'center', flexShrink: 1 }, incomeText: { fontSize: 21, fontWeight: '600', fontVariant: ['tabular-nums'] }, clock: { fontSize: 10, marginTop: 2, fontVariant: ['tabular-nums'] }, speed: { minWidth: 58, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 2 }, pills: { flexDirection: 'row', justifyContent: 'center', gap: 8 }, pill: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 44, borderRadius: 22 }, bottom: { position: 'absolute', left: 12, right: 12, gap: 8 }, status: { minHeight: 84, borderRadius: 28, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8, boxShadow: '0px 4px 20px rgba(0,0,0,0.09)' }, action: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, handover: { padding: 12, gap: 8, borderRadius: 14, borderCurve: 'continuous' }, handoverAction: { flex: 1, minHeight: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, reminder: { borderRadius: 12, paddingHorizontal: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, event: { borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, eventAction: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8 } });
