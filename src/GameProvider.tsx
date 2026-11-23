import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { acceptOffer, cancelTrip, cancelQueuedTrip, cancelHandover, cancelCharging, chooseBranch, chooseTripRoute, createInitialState, declineOffer, resolveRouteEvent, getUpcomingBranches, normalizeGameState, setAcceptingOrders, setAutoAcceptOrders, parkTemporarily, parkForRest, resumeDriving, navigateToStation, navigateToHandover, startEnergyService, cruiseToNode, requestEnergyRecovery, applyEliteBookingAction,applyAirportAction,setProDestination,type DemandDensity, type GameState, type Landmark, type ShiftType, type VehicleId } from './game';
import type { EnergyStation } from './data/serviceStations';
import { LANDMARKS } from './data/landmarks';
import { isKnownVehicleId } from './game/vehicleCapabilities';
import { usePalette, type Appearance } from './ui/theme';
import { ROAD_GRAPH } from './map/roadGraph';
import { sounds } from './audio/sounds';
import { useMultiplayer } from './MultiplayerProvider';
import { isRoomSpeed, type PlayerGameAction, type RoomSpeed } from '../shared/protocol';
import { offerDeadlineFromSnapshot } from './multiplayer/offerClock';
import { newShiftDurationPreference, type ShiftDuration } from './ui/shiftPresentation';
import { getShiftDurationMinutes } from './game/shiftDuration';
import { getWorldEventAt, getWorldEventSchedule } from '../shared/worldEvents';
import { advanceGameWithWorldEvents } from './game';
import type {SoloTrainingSubmission} from '../shared/training';
import { projectBlindGameState } from '../shared/blindOrders';
import { SOLO_BLIND_ORDERS } from './config/blindOrders';
import {defaultOrderPreferences,normalizeOrderPreferences} from './game/orderPreferences';
import {readOrderPreferences,type OrderPreferences} from '../shared/orderPolicy';
import {isCurrentMapReady,reportMapReadiness,soloMayRun,type MapReadiness,type MapLoadStatus} from './ui/mapReadiness';
import {syncSoloOfferWindow,isSoloOfferExpired,type SoloOfferWindow} from './ui/soloOfferWindow';
import {currentProPass,proShiftEarnsCreditUse,type ProPass} from '../shared/pro';
import {isCurrentEliteCertification} from '../shared/eliteCourse';
import type {EliteBookingChoice,EliteSubmission} from '../shared/elite';

// New policy states never overwrite the namespace understood by pre-policy apps.
const STORAGE = 'harbour-shift.session.v3';
const LEGACY_STORAGE='harbour-shift.session.v2';
const DEFAULT_PLACE = LANDMARKS.find(place => place.id === 'harbour-city') ?? LANDMARKS[0];
function useGameController() {
  const mp = useMultiplayer();
  const online = !!mp.snapshot?.ownState;
  const onlineGame = useMemo(() => mp.snapshot?.ownState ? { ...mp.snapshot.ownState, landmarks: LANDMARKS } : null, [mp.snapshot?.ownState]);
  const [game, setGame] = useState<GameState | null>(null);
  const [vehicleId, setVehicleId] = useState<VehicleId>('kam-fung');
  const [shift, setShiftValue] = useState<ShiftType>('day');
  const [shiftDurationMinutes, setShiftDurationMinutes] = useState<ShiftDuration>(360);
  const [startHour, setStartHour] = useState('05');
  const [startMinute, setStartMinute] = useState('00');
  const setShift = (value: ShiftType) => { setShiftValue(value); setStartHour(value === 'night' ? '17' : '05'); setStartMinute('00'); };
  const validTime = /^\d{1,2}$/.test(startHour) && /^\d{1,2}$/.test(startMinute) && Number(startHour) < 24 && Number(startMinute) < 60;
  const startTimeMinutes = validTime ? Number(startHour) * 60 + Number(startMinute) : undefined;
  const invalidStartTime = !validTime;
  const [startPlace, setStartPlace] = useState<Landmark>(DEFAULT_PLACE);
  const [handoverPlace, setHandoverPlace] = useState<Landmark | null>(null);
  const [rentalInputs, setRentalInputs] = useState<Record<string, string>>({});
  const [energyInputs, setEnergyInputs] = useState<Record<string, string>>({});
  const [orderPreferencesInputs,setOrderPreferencesInputs]=useState<Record<string,OrderPreferences>>({});
  const [blindOrdersPreference,setBlindOrdersPreference]=useState(SOLO_BLIND_ORDERS);
  const orderPreferences=normalizeOrderPreferences(orderPreferencesInputs[vehicleId]??defaultOrderPreferences(vehicleId),vehicleId,isCurrentEliteCertification(mp.soloEliteCertification))!;
  const setOrderPreferences=(value:OrderPreferences)=>{const parsed=readOrderPreferences(value);if(parsed)setOrderPreferencesInputs(previous=>({...previous,[vehicleId]:normalizeOrderPreferences(parsed,vehicleId,isCurrentEliteCertification(mp.soloEliteCertification))!}));};
  const [density, setDensity] = useState<DemandDensity>('busy');
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [speed, setSpeed] = useState<RoomSpeed>(60);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showFullTripRoute, setShowFullTripRoute] = useState(false);
  const [autoAcceptPreference, setAutoAcceptPreference] = useState(false);
  const [autoAcceptPending, setAutoAcceptPending] = useState<boolean|null>(null);
  const [paused, setPaused] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [startupPending,setStartupPending]=useState(false);
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const [shiftVisible,setShiftVisible]=useState(false);
  const [mapReadiness,setMapReadiness]=useState<MapReadiness|null>(null);
  const beginMapLoad=useCallback((session:string,instance:string)=>setMapReadiness({session,instance,status:'loading'}),[]);
  const reportMapLoad=useCallback((session:string,instance:string,status:MapLoadStatus)=>setMapReadiness(previous=>reportMapReadiness(previous,session,instance,status)),[]);
  const endMapLoad=useCallback((session:string,instance:string)=>setMapReadiness(previous=>previous?.session===session&&previous.instance===instance?null:previous),[]);
  const mapSessionKey=online?`room:${mp.snapshot!.room.code}:${mp.snapshot!.you.playerId}`:`solo:${game?.driverSessionId??game?.seed??'none'}`;
  const mapReady=isCurrentMapReady(mapReadiness,mapSessionKey);
  const soloCanRun=soloMayRun({online,paused,planning,foreground,visible:shiftVisible,mapReady,startupPending});
  const { colors, isDark } = usePalette(appearance);
  const current = useRef({ game, vehicleId, appearance, shift, shiftDurationMinutes, startHour, startMinute, startPlace, handoverPlace, rentalInputs, energyInputs, orderPreferencesInputs,blindOrdersPreference,density, speed, soundEnabled, showFullTripRoute, autoAcceptPreference, startupPending, hydrated });
  current.current = { game, vehicleId, appearance, shift, shiftDurationMinutes, startHour, startMinute, startPlace, handoverPlace, rentalInputs, energyInputs, orderPreferencesInputs,blindOrdersPreference,density, speed, soundEnabled, showFullTripRoute, autoAcceptPreference, startupPending, hydrated };
  const appActive = useRef(true);
  const offerWindow = useRef<SoloOfferWindow|null>(null);
  offerWindow.current=syncSoloOfferWindow(offerWindow.current,game?.currentOffer?.id,Date.now(),!soloCanRun);
  const soloEventSchedule=useMemo(()=>game?getWorldEventSchedule(game.seed,getShiftDurationMinutes(game),game.startTimeMinutes):[],[game?.seed,game?.shiftDurationMinutes,game?.startTimeMinutes]);
  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([STORAGE,LEGACY_STORAGE,'harbour-shift.session.v1']).then(entries => {
      if (!active) return;
      try {
        const raw = entries.find(([,value])=>value!==null)?.[1];
        if (!raw) return;
        const stored = JSON.parse(raw);
        const saved = stored.game;
        if (saved?.version === 1) setSaveNotice('新版已更新全港道路，請重新開更。舊版存檔已保留。');
        const movement = saved?.movement;
        const validMovement = movement && ROAD_GRAPH.edges[movement.edgeId]
          && Number.isFinite(movement.distanceOnEdgeM) && Array.isArray(movement.nextEdgeIds)
          && movement.nextEdgeIds.every((id: string) => ROAD_GRAPH.edges[id]);
        if ([2,3].includes(saved?.version) && Number.isFinite(saved.clockMinutes) && validMovement
          && ['cruising','fuel-queue','airport-queue','pickup','waiting','boarding','alighting','dropoff','safe-dropoff','service-route','servicing','ended'].includes(saved.phase)
          && Array.isArray(saved.ghostOffers) && Array.isArray(saved.observedOffers)) {
          const migrated = normalizeGameState({ ...saved, landmarks: LANDMARKS });
          if (migrated) {setGame(migrated);setStartupPending(stored.startupPending===true||migrated.dispatchManaged===true);const window=stored.soloOfferWindow;if(window&&window.id===migrated.currentOffer?.id&&Number.isFinite(window.remainingMs)){const now=Date.now();offerWindow.current={id:window.id,deadline:now+Math.max(0,Math.min(5000,window.remainingMs)),pausedAt:now};}} 
          else setSaveNotice('舊存檔路線未能套用新版車輛可行範圍，請重新開更。');
        }
        if (isKnownVehicleId(stored.vehicleId)) setVehicleId(stored.vehicleId);
        if (['system','light','dark'].includes(stored.appearance)) setAppearance(stored.appearance);
        setShiftDurationMinutes(newShiftDurationPreference(stored.shiftDurationMinutes));
        if (['day','night'].includes(stored.shift)) { setShiftValue(stored.shift); setStartHour(typeof stored.startHour === 'string' ? stored.startHour : stored.shift === 'night' ? '17' : '05'); setStartMinute(typeof stored.startMinute === 'string' ? stored.startMinute : '00'); }
        if (stored.startPlace?.nodeId && ROAD_GRAPH.nodes[stored.startPlace.nodeId]
          && Number.isFinite(stored.startPlace.lat) && Number.isFinite(stored.startPlace.lon)) setStartPlace(stored.startPlace);
        if (stored.handoverPlace?.nodeId && ROAD_GRAPH.nodes[stored.handoverPlace.nodeId]) setHandoverPlace(stored.handoverPlace);
        if (stored.rentalInputs && typeof stored.rentalInputs === 'object') setRentalInputs(stored.rentalInputs);
        if (stored.energyInputs && typeof stored.energyInputs === 'object') setEnergyInputs(stored.energyInputs);
        if(stored.orderPreferencesInputs&&typeof stored.orderPreferencesInputs==='object'){const saved:Record<string,OrderPreferences>={};for(const [id,value]of Object.entries(stored.orderPreferencesInputs)){const preferences=readOrderPreferences(value);if(isKnownVehicleId(id)&&preferences)saved[id]=preferences;}setOrderPreferencesInputs(saved);}
        if(typeof stored.blindOrdersPreference==='boolean')setBlindOrdersPreference(stored.blindOrdersPreference);
        if (['normal','busy'].includes(stored.density)) setDensity(stored.density);
        if (isRoomSpeed(stored.speed)) setSpeed(stored.speed);
        if (typeof stored.soundEnabled === 'boolean') setSoundEnabled(stored.soundEnabled);
        if (typeof stored.showFullTripRoute === 'boolean') setShowFullTripRoute(stored.showFullTripRoute);
        if (typeof stored.autoAcceptPreference === 'boolean') setAutoAcceptPreference(stored.autoAcceptPreference);
      } catch { /* A corrupt or old road-network save starts a fresh shift. */ }
    }).finally(() => { if (active) setHydrated(true); });
    const save = () => {
      const snapshot = current.current;
      if (!snapshot.hydrated) return;
      // The immutable place catalogue must not be serialized on every autosave.
      const { landmarks: _catalogue, ...smallGame } = snapshot.game ?? {};
      const { hydrated: _ready, ...preferences } = snapshot;
      void AsyncStorage.setItem(STORAGE, JSON.stringify({ ...preferences, game: snapshot.game ? smallGame : null,soloOfferWindow:offerWindow.current?{id:offerWindow.current.id,remainingMs:Math.max(0,Math.min(5000,offerWindow.current.deadline-(offerWindow.current.pausedAt??Date.now())))}:undefined })).catch(() => {});
    };
    const timer = setInterval(save, 3000);
    const sub = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';setForeground(state==='active');
      if (state !== 'active') save();
    });
    return () => { active = false; clearInterval(timer); sub.remove(); save(); };
  }, []);
  useEffect(() => {
    if (!soloCanRun || !hydrated) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = Math.min((now - last) / 1000, .5); last = now;
      if (!appActive.current) return;
      setGame(previous => {
        if (!previous || previous.phase === 'ended') return previous;
        const decisionSpeed = previous.currentOffer || ['waiting','boarding','alighting','safe-dropoff'].includes(previous.phase) ? Math.min(speed, 10) : speed;
        // Junction movement assistance lives in the engine. No wall-clock
        // deadline can accelerate the car before it actually crosses a fork.
        return advanceGameWithWorldEvents(previous, delta * decisionSpeed / 60, soloEventSchedule);
      });
    }, 150);
    return () => clearInterval(timer);
  }, [soloCanRun, speed, hydrated, soloEventSchedule]);
  useEffect(() => {
    if (!soloCanRun) return;
    const id=game?.currentOffer?.id;
    if(!id)return;
    const expire=()=>{if(offerWindow.current?.id===id&&isSoloOfferExpired(offerWindow.current,Date.now()))setGame(previous=>previous?.currentOffer?.id===id?declineOffer(previous):previous);};
    expire();const timer=setInterval(expire,50);return()=>clearInterval(timer);
  },[soloCanRun,game?.currentOffer?.id]);
  useEffect(()=>{
    if(!online&&startupPending&&mapReady&&foreground&&shiftVisible&&game){
      setGame(previous=>previous?{...previous,dispatchManaged:false}:previous);setStartupPending(false);
    }
  },[online,startupPending,mapReady,foreground,shiftVisible,game?.driverSessionId,game?.seed]);
  useEffect(() => {
    if (!hydrated || !mp.hydrated || !game) return;
    mp.recordSolo(game.driverSessionId ?? `legacy:${game.seed}:${game.startTimeMinutes}:${game.vehicleId}`, {
      offered: game.presentedOffers ?? game.platform.offered, accepted: game.acceptedOffers, cancelled: game.cancelledTrips, completedTrips: game.completedTrips,
    });
  }, [hydrated, mp.hydrated, game?.driverSessionId, game?.seed, game?.presentedOffers, game?.platform.offered, game?.acceptedOffers, game?.cancelledTrips, game?.completedTrips]);
  const soloPass=(game as (GameState&{proPass?:ProPass})|null)?.proPass;
  const proSettlementRequired=!!(game?.phase==='ended'&&game.driverSessionId&&soloPass&&proShiftEarnsCreditUse(game.shiftEndReason)&&!mp.soloPro?.completedShifts[game.driverSessionId]);
  const settleSoloPro=async()=>{if(game?.phase==='ended'&&game.driverSessionId&&soloPass)await mp.completeSoloPro(game.driverSessionId,soloPass,game.shiftEndReason);};
  useEffect(()=>{
    if(!hydrated||!mp.hydrated||!proSettlementRequired)return;
    void settleSoloPro().catch(()=>setSaveNotice('權益使用紀錄尚未儲存，請重試。'));
  },[hydrated,mp.hydrated,game?.phase,game?.driverSessionId,soloPass?.packId,game?.shiftEndReason]);
  const displayGame=online?onlineGame:game;
  const blindOrders=online?mp.snapshot?.orderVisibility?.blindOrders===true:(game?.blindOrders??SOLO_BLIND_ORDERS);
  const visibleGame=useMemo(()=>!online&&game&&blindOrders?projectBlindGameState(game,true):displayGame,[online,game,blindOrders,displayGame]);
  const autoAcceptEnabled=autoAcceptPending??displayGame?.autoAcceptOrders??autoAcceptPreference;
  useEffect(()=>setAutoAcceptPending(null),[mp.snapshot?.room.code,online]);
  const setAutoAcceptEnabled=(value:boolean)=>{
    if(online){
      if(mp.pending||autoAcceptPending!==null)return;
      setAutoAcceptPending(value);
      void mp.dispatch({type:'auto-accept',value}).then(()=>setAutoAcceptPreference(value)).catch(()=>{}).finally(()=>setAutoAcceptPending(null));
    }else{
      setAutoAcceptPreference(value);
      setGame(previous=>previous?(soloCanRun?setAutoAcceptOrders(previous,value):{...previous,autoAcceptOrders:value}):previous);
    }
  };
  const offerDeadline=online&&mp.snapshot?offerDeadlineFromSnapshot(mp.snapshot,mp.snapshotReceivedAt):offerWindow.current?.deadline??null;
  const latestDeadline=useRef(offerDeadline);latestDeadline.current=offerDeadline;
  useEffect(()=>{sounds.setEnabled(soundEnabled);},[soundEnabled]);
  useEffect(()=>{
    const sync=(state=AppState.currentState)=>{
      if(state==='active'&&displayGame?.currentOffer&&(online?mapReady&&shiftVisible:soloCanRun)&&soundEnabled&&(!latestDeadline.current||Date.now()<latestDeadline.current)) sounds.playOffer();
      else sounds.stopOffer();
    };
    sync();const sub=AppState.addEventListener('change',sync);
    return()=>{sub.remove();sounds.stopOffer();};
  },[displayGame?.currentOffer?.id,soloCanRun,mapReady,shiftVisible,soundEnabled,online]);
  const lastAccepted=useRef<{key:string;count:number}|null>(null);
  const soundSession=online?`room:${mp.snapshot?.room.code}:${mp.snapshot?.you.playerId}`:`solo:${game?.seed}`;
  useEffect(()=>{
    const count=displayGame?.acceptedOffers;
    if(count!==undefined&&lastAccepted.current?.key===soundSession&&count>lastAccepted.current.count&&soundEnabled&&foreground&&mapReady&&shiftVisible)sounds.playAccepted();
    lastAccepted.current=count===undefined?null:{key:soundSession,count};
  },[displayGame?.acceptedOffers,soundSession,soundEnabled,foreground,mapReady,shiftVisible]);
  const rentalKey = `${vehicleId}:${shift}`;
  const rentalInput = rentalInputs[rentalKey] ?? '';
  const rentalOverride = rentalInput.trim() !== '' && Number.isFinite(Number(rentalInput)) && Number(rentalInput) >= 0 ? Number(rentalInput) : undefined;
  const energyInput = energyInputs[vehicleId] ?? '';
  const energyUnitPriceOverride = energyInput.trim() !== '' && Number.isFinite(Number(energyInput)) && Number(energyInput) >= 0 ? Number(energyInput) : undefined;
  const start = () => {
    if (invalidStartTime||mp.soloProPending||proSettlementRequired||!mp.hydrated) return;
    offerWindow.current=null;setStartupPending(true);
    const seed=Math.floor(Date.now()/1000);
    const pass=currentProPass(mp.soloPro?.packs??[]);
    setGame(createInitialState({ driverSessionId: `solo:${Date.now()}:${Math.random().toString(36).slice(2)}`, platformHistory: mp.driverStats, autoAcceptOrders:autoAcceptPreference, orderPreferences,blindOrders:blindOrdersPreference,dispatchManaged:true, xlOrdersEnabled:true,advancedRulesVersion:1,proTier:pass?.tier??'blue',proPass:pass,eliteCertified:isCurrentEliteCertification(mp.soloEliteCertification), startTimeMinutes, shiftDurationMinutes, worldEvent:getWorldEventAt(seed,0,shiftDurationMinutes,startTimeMinutes), vehicleId, seed, shift, startPlace, startPlaceId: startPlace.id, handoverPlace: handoverPlace ?? startPlace, rentalOverride, energyUnitPriceOverride, density }));
    setSaveNotice(''); setPlanning(false); setPaused(false);
  };
  const remote = (action: PlayerGameAction) => { void mp.dispatch(action).catch(() => {}); };
  return {
    orderPreferences,setOrderPreferences,blindOrdersPreference,setBlindOrdersPreference,
    online, game: visibleGame, blindOrders, showFullTripRoute, setShowFullTripRoute,
    eliteCertification:mp.soloEliteCertification,
    submitEliteCourse:(submission:EliteSubmission)=>mp.certifySoloElite(submission),
    eliteBooking:(bookingId:string,choice:EliteBookingChoice)=>online?remote({type:'elite-booking',bookingId,choice}):setGame(previous=>previous?applyEliteBookingAction(previous,bookingId,choice):previous),
    airport:(choice:'go'|'join'|'leave')=>online?remote({type:'airport',choice}):setGame(previous=>previous?applyAirportAction(previous,choice):previous),
    proDestination:(placeId?:string)=>online?remote({type:'pro-destination',...(placeId?{placeId}:{})}):setGame(previous=>previous?setProDestination(previous,placeId):previous),
    proSettlementRequired,proPending:mp.soloProPending,retryProSettlement:settleSoloPro,
    canResetTraining:!mp.hasSession&&!online&&(!game||game.phase==='ended'),
    resetSoloTraining:async(submission:SoloTrainingSubmission)=>{
      if(mp.hasSession||online||(current.current.game&&current.current.game.phase!=='ended'))throw new Error('請先完成本更並離開房間。');
      return mp.resetSoloReview(submission);
    },
    mapSessionKey,mapReady,mapInstanceId:mapReadiness?.session===mapSessionKey?mapReadiness.instance:undefined,mapLoadStatus:mapReadiness?.session===mapSessionKey?mapReadiness.status:'loading' as MapLoadStatus,foreground,shiftVisible,beginMapLoad,reportMapLoad,endMapLoad,setShiftVisible,
    autoAcceptEnabled,autoAcceptPreference,setAutoAcceptEnabled,autoAcceptPending:autoAcceptPending!==null,
    offerDeadline,offerPausedAt:online?null:offerWindow.current?.pausedAt??null, vehicleId, setVehicleId, shift, setShift, shiftDurationMinutes, setShiftDurationMinutes, startHour, setStartHour, startMinute, setStartMinute, startTimeMinutes, invalidStartTime, startPlace, setStartPlace, handoverPlace, setHandoverPlace, rentalInput, rentalOverride, saveNotice,
    setRentalInput: (value: string) => setRentalInputs(previous => ({ ...previous, [rentalKey]: value })),
    energyInput, energyUnitPriceOverride, setEnergyInput: (value: string) => setEnergyInputs(previous => ({ ...previous, [vehicleId]: value })),
    density, setDensity, appearance, setAppearance, colors, isDark, soundEnabled, setSoundEnabled, speed: online ? mp.snapshot!.room.speed : speed, setSpeed, paused: online ? false : paused, setPaused, planning, setPlanning, hydrated, start,
    resume: () => { setPlanning(false); setPaused(false); },
    accept: () => online ? (displayGame?.currentOffer ? remote({ type: 'accept', offerId:displayGame.currentOffer.id }) : undefined) : setGame(previous => previous && soloCanRun ? (offerWindow.current?.id===previous.currentOffer?.id && isSoloOfferExpired(offerWindow.current,Date.now()) ? declineOffer(previous) : acceptOffer(previous)) : previous),
    decline: () => online ? (displayGame?.currentOffer ? remote({ type: 'decline', offerId:displayGame.currentOffer.id }) : undefined) : setGame(previous => previous ? declineOffer(previous) : previous),
    cancelQueued: () => online ? (displayGame?.queuedTrip ? remote({ type: 'cancel-queued', tripId: displayGame.queuedTrip.offer.id }) : undefined) : setGame(previous => previous ? cancelQueuedTrip(previous) : previous),
    cancel: () => online ? (displayGame?.activeTrip ? remote({ type: 'cancel', tripId:displayGame.activeTrip.offer.id }) : undefined) : setGame(previous => previous ? cancelTrip(previous) : previous),
    accepting: (value: boolean) => online ? remote({ type: 'accepting', value }) : setGame(previous => previous ? setAcceptingOrders(previous, value) : previous),
    park: () => online ? remote({ type: 'park' }) : setGame(previous => previous ? parkTemporarily(previous) : previous),
    rest: () => online ? remote({ type: 'rest' }) : setGame(previous => previous ? parkForRest(previous) : previous),
    drive: () => online ? remote({ type: 'drive' }) : setGame(previous => previous ? resumeDriving(previous) : previous),
    station: (station: EnergyStation) => online ? remote({ type: 'station', stationId: station.id }) : setGame(previous => previous ? navigateToStation(previous, station) : previous),
    handover: () => online ? remote({ type: 'handover' }) : setGame(previous => previous ? navigateToHandover(previous) : previous),
    stopCharging: () => online ? remote({type:'cancel-charge'}) : setGame(previous => previous ? cancelCharging(previous) : previous),
    cancelHandover: () => online ? remote({type:'cancel-handover'}) : setGame(previous=>previous?cancelHandover(previous):previous),
    service: () => online ? remote({ type: 'service' }) : setGame(previous => previous ? startEnergyService(previous) : previous),
    recoverEnergy: () => online ? remote({ type: 'recover-energy' }) : setGame(previous => previous ? requestEnergyRecovery(previous) : previous),
    cruiseTo: (nodeId: string) => online ? remote({ type: 'cruise-to', nodeId }) : setGame(previous => previous ? cruiseToNode(previous, nodeId) : previous),
    branch: (junction: string, edge: string) => online ? remote({ type: 'branch', junctionNodeId: junction, edgeId: edge }) : setGame(previous => previous ? chooseBranch(previous, junction, edge) : previous),
    route: (policy: 'fastest' | 'economy') => online ? remote({ type: 'route', policy }) : setGame(previous => previous ? chooseTripRoute(previous, policy) : previous),
    event: (choice: 'stay' | 'reroute') => online ? remote({ type: 'event', choice }) : setGame(previous => previous ? resolveRouteEvent(previous, choice) : previous),
    discard: () => {if(proSettlementRequired){setSaveNotice('權益使用紀錄尚未儲存，請重試。');return;} setGame(null);setStartupPending(false); setPaused(true); setPlanning(false); },
  };
}
type GameController = ReturnType<typeof useGameController>;
const GameContext = createContext<GameController | null>(null);
export function GameProvider({ children }: { children: ReactNode }) {
  const controller = useGameController();
  return <GameContext.Provider value={controller}>{children}</GameContext.Provider>;
}
export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error('GameProvider is required.');
  return value;
}
