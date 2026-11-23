import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MULTIPLAYER_API as API, MULTIPLAYER_LIMITS, PROTOCOL_VERSION, type ActionEnvelope, type DriverStats, type PlayerSetup, type RoomAction, type RoomRules, type RoomSession, type RoomSnapshot } from '../shared/protocol';
import { MULTIPLAYER_BASE_URL } from './multiplayer/config';
import { combineDriverCounts, emptySoloLedger, readSoloLedger, recordSoloSession, applySoloTrainingReset, soloReviewStatus, type DriverCounts, type SoloLedger } from './profile/ledger';
import { MultiplayerError, isAuthorityResponseError, isTerminalMultiplayerError, request } from './multiplayer/transport';
import {validHornPressId,type HornAction} from '../shared/horns';
import type {SoloTrainingSubmission} from '../shared/training';
import {isLegacyVehicleId,VEHICLE_CATALOG_VERSION} from './game/vehicleCapabilities';
import {emptySoloProLedger,readSoloProLedger,addSoloPracticePass,completeSoloProShift,type SoloProLedger} from './profile/proLedger';
import {isPremiumProTier,type PremiumProTier,type ProPass} from '../shared/pro';
import {ORDER_POLICY_VERSION} from '../shared/orderPolicy';
import {ADVANCED_RULES_VERSION} from '../shared/pro';
import {certifySoloElite,isCurrentEliteCertification} from '../shared/eliteCourse';
import type {EliteCertification,EliteSubmission} from '../shared/elite';

const PROFILE_KEY = 'harbour-shift.nickname.v1';
const DRIVER_KEY = 'harbour-shift.driver.v1';
const SOLO_LEDGER_KEY = 'harbour-shift.solo-history.v1';
const SOLO_PRO_KEY='harbour-shift.solo-pro.v1',SOLO_ELITE_KEY='harbour-shift.solo-elite.v1';
interface DriverAccount { driverId: string; driverToken: string; stats: DriverStats;eliteCertification?:EliteCertification }
const SESSION_KEY = 'harbour-shift.room.v1';
type Credential = Pick<RoomSession, 'roomCode' | 'playerId' | 'resumeToken'> & { lastAllocatedSeq?: number };
type Connection = 'offline' | 'connecting' | 'connected' | 'reconnecting';
function useMultiplayerController() {
  const [hydrated, setHydrated] = useState(false);
  const [nickname, setNickname] = useState('');
  const [driverAccount, setDriverAccount] = useState<DriverAccount | null>(null);
  const driverRef = useRef<DriverAccount | null>(null);
  const creatingDriver = useRef<Promise<DriverAccount> | null>(null);
  const [soloLedger, setSoloLedger] = useState<SoloLedger>(emptySoloLedger);
  const soloLedgerRef = useRef(soloLedger);
  const soloPersistence = useRef<Promise<unknown>>(Promise.resolve());
  const [soloPro,setSoloPro]=useState<SoloProLedger>(emptySoloProLedger),soloProRef=useRef(soloPro);
  const [soloProPending,setSoloProPending]=useState(false),proPending=useRef(0),proPersistence=useRef<Promise<unknown>>(Promise.resolve());
  const [soloEliteCertification,setSoloEliteCertification]=useState<EliteCertification|undefined>(undefined),elitePersistence=useRef<Promise<unknown>>(Promise.resolve());
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(0);
  const [connection, setConnection] = useState<Connection>('offline');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const credential = useRef<Credential | null>(null), latest = useRef<RoomSnapshot | null>(null);
  const generation = useRef(0), nextSeq = useRef(0), unresolved = useRef<ActionEnvelope | null>(null);
  const active = useRef(AppState.currentState === 'active'), inPoll = useRef<number|null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [retry, setRetry] = useState(0);
  const persistence=useRef<Promise<unknown>>(Promise.resolve());
  const entering=useRef(false);
  const hornQueue=useRef<Array<{action:HornAction;at:number}>>([]),hornFlight=useRef<number|null>(null),hornWake=useRef<ReturnType<typeof setTimeout>|null>(null),pendingRef=useRef(pending);
  pendingRef.current=pending;
  const flushHornRef=useRef<()=>void>(()=>{});
  const persistSession=useCallback((value:Credential|null,epoch:number):Promise<void>=>{
    const write=async()=>{
      if(epoch!==generation.current)return;
      if(value)await AsyncStorage.setItem(SESSION_KEY,JSON.stringify(value));
      else await AsyncStorage.removeItem(SESSION_KEY);
    };
    const result=persistence.current.then(write,write);persistence.current=result.catch(()=>{});return result;
  },[]);
  const clearSession = useCallback(() => {
    generation.current++; queue.current=Promise.resolve(); credential.current = null; latest.current = null; unresolved.current = null;
    nextSeq.current = 0; setSnapshot(null); setConnection('offline'); setPending(null);
    hornQueue.current=[];hornFlight.current=null;if(hornWake.current)clearTimeout(hornWake.current);hornWake.current=null;
    void persistSession(null,generation.current).catch(()=>{});
  }, [persistSession]);
  const apply = useCallback((value: RoomSnapshot, epoch: number) => {
    if (epoch !== generation.current || value.you.playerId !== credential.current?.playerId) return;
    if (value.protocolVersion !== PROTOCOL_VERSION) throw new MultiplayerError('多人版本已更新，請更新遊戲。', 409, 'PROTOCOL');
    if (latest.current && (value.revision < latest.current.revision || value.revision===latest.current.revision&&value.serverTime<latest.current.serverTime)) return;
    latest.current = value; nextSeq.current = Math.max(nextSeq.current, value.you.lastInputSeq);
    if (unresolved.current && value.you.lastInputSeq >= unresolved.current.seq) unresolved.current = null;
    const stats = value.you.driverStats;
    if (stats && driverRef.current && value.you.driverId === driverRef.current.driverId) {
      const account = { ...driverRef.current, stats };
      driverRef.current = account; setDriverAccount(account);
      // The token is private local storage, never added to room rosters or URLs.
      void AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(account)).catch(() => {});
    }
    setSnapshot(value); setSnapshotReceivedAt(Date.now()); setConnection('connected');
  }, []);
  const failed = useCallback((cause: unknown, epoch: number) => {
    if (epoch !== generation.current) return;
    const problem = cause instanceof Error ? cause : new Error('連線失敗。');
    setError(problem.message);
    if (isAuthorityResponseError(cause) && cause instanceof MultiplayerError && [401, 404, 410].includes(cause.status)) clearSession();
    else if (credential.current && !isTerminalMultiplayerError(cause)) setConnection('reconnecting');
  }, [clearSession]);
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.multiGet([PROFILE_KEY, SESSION_KEY, DRIVER_KEY, SOLO_LEDGER_KEY, SOLO_PRO_KEY, SOLO_ELITE_KEY]).then(entries => {
      if (!mounted) return;
      setNickname(entries[0][1] ?? '');
      try { const saved = JSON.parse(entries[2]?.[1] ?? 'null'); if (saved && typeof saved.driverId === 'string' && /^[0-9a-f]{64}$/i.test(saved.driverToken) && saved.stats) { driverRef.current = saved; setDriverAccount(saved); } } catch { /* Room access remains independent of a damaged profile. */ }
      try { const ledger = readSoloLedger(JSON.parse(entries[3]?.[1] ?? 'null')); soloLedgerRef.current = ledger; setSoloLedger(ledger); } catch { /* Fresh local history. */ }
      try {
        const raw=JSON.parse(entries[4]?.[1]??'null'),ledger=readSoloProLedger(raw);soloProRef.current=ledger;setSoloPro(ledger);
        if(raw?.version===1&&JSON.stringify(raw)!==JSON.stringify(ledger)){
          // Persist the one-pack upgrade before subsequent activations/completions.
          proPending.current++;setSoloProPending(true);
          const write=()=>AsyncStorage.setItem(SOLO_PRO_KEY,JSON.stringify(ledger));
          const result=proPersistence.current.then(write,write);proPersistence.current=result.then(()=>{},()=>{});
          void result.catch(()=>{if(mounted)setError('權益使用紀錄尚未儲存，請重試。');}).finally(()=>{proPending.current--;if(mounted)setSoloProPending(proPending.current>0);});
        }
      }catch{/* Old saves have no local practice packs. */}
      try {const certificate=JSON.parse(entries[5]?.[1]??'null');if(isCurrentEliteCertification(certificate))setSoloEliteCertification(certificate);}catch{/* Local qualification is independent of verified online identity. */}
      try {
        const stored = JSON.parse(entries[1][1] ?? 'null');
        if (stored && /^[A-Z0-9]{6}$/.test(stored.roomCode) && typeof stored.playerId === 'string' && typeof stored.resumeToken === 'string') {
          credential.current = stored; nextSeq.current=Number.isSafeInteger(stored.lastAllocatedSeq)&&stored.lastAllocatedSeq>=0?stored.lastAllocatedSeq:0; setConnection('connecting');
        }
      } catch { void AsyncStorage.removeItem(SESSION_KEY); }
      setHydrated(true);
    }).catch(() => { if (mounted) { setHydrated(true); setError('未能讀取玩家資料。'); } });
    const subscription = AppState.addEventListener('change', state => { active.current = state === 'active'; if (active.current) setRetry(value => value + 1); });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let disposed = false;
    const poll = async () => {
      if (disposed || inPoll.current===generation.current || !active.current || !credential.current) return;
      const session = credential.current, epoch = generation.current;
      inPoll.current = epoch;
      try { apply(await request<RoomSnapshot>(MULTIPLAYER_BASE_URL, API.room(session.roomCode), undefined, session.resumeToken), epoch); }
      catch (cause) { failed(cause, epoch); }
      finally { if(inPoll.current===epoch)inPoll.current = null; }
    };
    void poll(); const timer = setInterval(() => void poll(), 900);
    return () => { disposed = true; clearInterval(timer); };
  }, [hydrated, retry, apply, failed]);
  const dispatch = useCallback((action: RoomAction): Promise<void> => {
    const originSession=credential.current,originEpoch=generation.current;
    // One ordered queue. An uncertain request is retried with the SAME sequence,
    // so an interrupted accept/cancel cannot execute twice after reconnection.
    const operation = async () => {
      const session = originSession, epoch = originEpoch;
      if (!session) throw new MultiplayerError('請先加入房間。');
      if(epoch!==generation.current || credential.current?.playerId!==session.playerId || credential.current?.roomCode!==session.roomCode)throw new MultiplayerError('房間已更改，請重新操作。',409,'ROOM_CHANGED');
      setPending(action.type); setError(null);
      const send = async (envelope: ActionEnvelope) => {
        try {
          if(epoch!==generation.current)return;
          credential.current={...session,lastAllocatedSeq:Math.max(nextSeq.current,envelope.seq)};
          await persistSession(credential.current,epoch);
          if(epoch!==generation.current)return;
          const value = await request<RoomSnapshot>(MULTIPLAYER_BASE_URL, API.actions(session.roomCode), envelope, session.resumeToken);
          if(epoch!==generation.current)return;
          apply(value, epoch);
          if (unresolved.current === envelope) unresolved.current = null;
        } catch (cause) {
          // Only a definite client error proves this input was rejected. A 5xx
          // may follow a committed write whose response was interrupted.
          if (isTerminalMultiplayerError(cause) && epoch===generation.current && unresolved.current === envelope) unresolved.current = null;
          throw cause;
        }
      };
      try {
        if (unresolved.current) {
          try { await send(unresolved.current); }
          catch (cause) {
            if (!isTerminalMultiplayerError(cause)) throw cause;
            // The rejected previous input is resolved; allow a fresh leave or
            // recovery action instead of permanently blocking the queue.
          }
        }
        if (epoch !== generation.current) return;
        const envelope = { seq: ++nextSeq.current, action };
        unresolved.current = envelope;
        // Reserve the sequence before transmission. A process restart cannot
        // reuse an in-flight sequence for a different input.
        await send(envelope);
      } catch (cause) { failed(cause, epoch); throw cause; }
      finally { if(epoch===generation.current)setPending(null); }
    };
    const result = queue.current.then(operation, operation);
    queue.current = result.catch(() => {});
    return result;
  }, [apply, failed, persistSession]);
  const flushHorns=useCallback(async()=>{
    const session=credential.current,epoch=generation.current,current=latest.current;
    if(!session||hornFlight.current===epoch||!active.current||current?.room.status!=='running')return;
    hornQueue.current=hornQueue.current.filter(entry=>Date.now()-entry.at<=2000);
    if(!hornQueue.current.length)return;
    // Acceptance/cancellation use the durable sequence channel. Audio is
    // disposable and waits/drops instead of delaying those decisions.
    if(pendingRef.current||unresolved.current){hornWake.current=setTimeout(()=>flushHornRef.current(),200);return;}
    const actions=hornQueue.current.splice(0,12).map(entry=>entry.action);hornFlight.current=epoch;
    try{const value=await request<RoomSnapshot>(MULTIPLAYER_BASE_URL,API.horn(session.roomCode),{actions},session.resumeToken);if(epoch===generation.current)apply(value,epoch);}
    catch{/* Lost audio is never retried with a game input sequence or shown as a trip error. */}
    finally{if(hornFlight.current===epoch){hornFlight.current=null;if(hornQueue.current.length)hornWake.current=setTimeout(()=>flushHornRef.current(),40);}}
  },[apply]);
  flushHornRef.current=()=>{void flushHorns();};
  const sendHorn=useCallback((action:HornAction)=>{
    if(!validHornPressId(action.pressId)||typeof action.pressed!=='boolean'||!active.current||latest.current?.room.status!=='running'||!credential.current)return;
    const last=hornQueue.current.at(-1);
    if(action.pressed&&last?.action.pressed&&last.action.pressId===action.pressId)last.at=Date.now();
    else hornQueue.current.push({action,at:Date.now()});
    hornQueue.current=hornQueue.current.slice(-24);flushHornRef.current();
  },[]);
  useEffect(()=>()=>{hornQueue.current=[];if(hornWake.current)clearTimeout(hornWake.current);},[]);
  const install = async (session: RoomSession) => {
    generation.current++; queue.current=Promise.resolve(); latest.current = null; nextSeq.current = 0; unresolved.current = null;
    hornQueue.current=[];hornFlight.current=null;if(hornWake.current)clearTimeout(hornWake.current);hornWake.current=null;
    credential.current = { roomCode: session.roomCode, playerId: session.playerId, resumeToken: session.resumeToken, lastAllocatedSeq:session.snapshot.you.lastInputSeq };
    await persistSession(credential.current,generation.current);
    apply(session.snapshot, generation.current); setRetry(value => value + 1);
  };
  const enter = async (kind: 'create' | 'join', body: unknown, code?: string) => {
    if (credential.current) throw new MultiplayerError('請先離開現有房間。');
    if(entering.current)throw new MultiplayerError('連接房間中…');
    entering.current=true;
    setPending(kind); setError(null); setConnection('connecting');
    try { await install(await request<RoomSession>(MULTIPLAYER_BASE_URL, kind === 'create' ? API.create : API.join(code!), body)); }
    catch (cause) { setConnection('offline'); setError(cause instanceof Error ? cause.message : '未能加入房間。'); throw cause; }
    finally { entering.current=false;setPending(null); }
  };
  const ensureDriver = async (): Promise<DriverAccount> => {
    if (driverRef.current) return driverRef.current;
    if (creatingDriver.current) return creatingDriver.current;
    const operation = (async () => {
      const account = await request<DriverAccount>(MULTIPLAYER_BASE_URL, '/v1/drivers', {});
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(account));
      driverRef.current = account; setDriverAccount(account); return account;
    })();
    creatingDriver.current = operation;
    try { return await operation; } finally { if (creatingDriver.current === operation) creatingDriver.current = null; }
  };
  const withDriver = async (kind: 'create' | 'join', body: Record<string, unknown>, code?: string) => {
    const account = await ensureDriver();
    const payload={...body,featureVersion:'0.6',driverCredential:{driverId:account.driverId,driverToken:account.driverToken}};
    const vehicle = (body.setup as PlayerSetup | undefined)?.vehicleId;
    const catalog = { ...payload, blindOrdersVersion: 1, vehicleCatalogVersion: VEHICLE_CATALOG_VERSION };
    const advanced = { ...catalog, advancedRulesVersion: ADVANCED_RULES_VERSION };
    const modern = {...advanced,orderPolicyVersion:ORDER_POLICY_VERSION};
    const rejectsCapability = (cause: unknown): cause is MultiplayerError => isAuthorityResponseError(cause)
      && cause.status === 400 && cause.code === 'unexpected_field';
    try { return await enter(kind, modern, code); }
    catch (cause) {
      // Safe to retry only a definite rejection before any room mutation.
      if (!rejectsCapability(cause)) throw cause;
      if((body.setup as PlayerSetup|undefined)?.orderPreferences!==undefined||(body.rules as RoomRules|undefined)?.blindOrders!==undefined)throw new MultiplayerError('呢個房間版本未支援開更前接單設定，請更新遊戲。',409,'room_version');
      try{return await enter(kind,advanced,code);}
      catch(advancedCause){if(!rejectsCapability(advancedCause))throw advancedCause;}
      if((body.setup as PlayerSetup&{proPass?:unknown}|undefined)?.proPass)throw new MultiplayerError('請更新遊戲以加入此房間。',409,'room_version');
      try{return await enter(kind,catalog,code);}
      catch(catalogCause){if(!rejectsCapability(catalogCause))throw catalogCause;}
      if (vehicle && !isLegacyVehicleId(vehicle)) {
        throw new MultiplayerError('呢款車需要新版多人房間。', 409, 'room_version');
      }
      try { return await enter(kind, {...payload, blindOrdersVersion: 1}, code); }
      catch (olderCause) {
        if (!rejectsCapability(olderCause)) throw olderCause;
        return enter(kind, payload, code);
      }
    }
  };
  const updateSoloPro=async(change:(ledger:SoloProLedger)=>SoloProLedger)=>{
    if(!hydrated)throw new Error('讀取玩家資料…');
    proPending.current++;setSoloProPending(true);
    const write=async()=>{const next=change(soloProRef.current);if(next!==soloProRef.current){await AsyncStorage.setItem(SOLO_PRO_KEY,JSON.stringify(next));soloProRef.current=next;setSoloPro(next);}return next;};
    const result=proPersistence.current.then(write,write);proPersistence.current=result.then(()=>{},()=>{});
    try{return await result;}finally{proPending.current--;setSoloProPending(proPending.current>0);}
  };
  return {
    driverAccount, driverStats: combineDriverCounts(soloLedger.totals, driverAccount?.stats), soloStats: soloLedger.totals,
    recordSolo: (sessionId: string, counts: DriverCounts) => {
      if (!hydrated) return;
      const write = async () => {
        const ledger=recordSoloSession(soloLedgerRef.current,sessionId,counts);
        if(ledger===soloLedgerRef.current)return;
        await AsyncStorage.setItem(SOLO_LEDGER_KEY,JSON.stringify(ledger));
        soloLedgerRef.current=ledger;setSoloLedger(ledger);
      };
      soloPersistence.current=soloPersistence.current.then(write,write).catch(()=>{});
    },
    soloReview:soloReviewStatus(soloLedger),
    soloPro,soloProPending,soloEliteCertification,
    activateSoloPro:(tier:PremiumProTier)=>updateSoloPro(ledger=>{if(!isPremiumProTier(tier))throw new Error('所選級別無效。');return addSoloPracticePass(ledger,tier,`practice:${Date.now()}:${Math.random().toString(36).slice(2)}`,Date.now());}),
    completeSoloPro:(shiftId:string,pass?:ProPass,reason?:string)=>updateSoloPro(ledger=>completeSoloProShift(ledger,shiftId,pass,reason)),
    certifySoloElite:async(submission:EliteSubmission)=>{if(!hydrated)throw new Error('讀取玩家資料…');const certificate=certifySoloElite(submission);const write=async()=>{await AsyncStorage.setItem(SOLO_ELITE_KEY,JSON.stringify(certificate));setSoloEliteCertification(certificate);return certificate;};const result=elitePersistence.current.then(write,write);elitePersistence.current=result.then(()=>{},()=>{});return result;},
    ensureTrainingAccount:ensureDriver,
    resetSoloReview:async(submission:SoloTrainingSubmission)=>{
      const reset=async()=>{
        if(credential.current)throw new Error('請先完成本更並離開房間。');
        const ledger=applySoloTrainingReset(soloLedgerRef.current,submission,Date.now());
        if(ledger!==soloLedgerRef.current){await AsyncStorage.setItem(SOLO_LEDGER_KEY,JSON.stringify(ledger));soloLedgerRef.current=ledger;setSoloLedger(ledger);}
        return soloReviewStatus(ledger);
      };
      const operation=soloPersistence.current.then(reset,reset);
      soloPersistence.current=operation.then(()=>{},()=>{});
      return operation;
    },
    refreshDriver: async () => {
      const account = await ensureDriver();
      const response = await request<{ driverId: string; stats: DriverAccount['stats'];eliteCertification?:EliteCertification }>(MULTIPLAYER_BASE_URL, '/v1/drivers/me', undefined, account.driverToken);
      const updated = { ...account, stats: response.stats,eliteCertification:response.eliteCertification }; driverRef.current = updated; setDriverAccount(updated);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(updated));
    },
    onlineEliteCertification:driverAccount?.eliteCertification,
    hydrated, nickname, snapshot, snapshotReceivedAt, hasSession:!!credential.current, connection, pending, error, apiConfigured: !!MULTIPLAYER_BASE_URL,
    dispatch,sendHorn,
    saveNickname: async (value: string) => {
      const name = value.normalize('NFKC').trim();
      if (!name || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name) || Array.from(name).length > MULTIPLAYER_LIMITS.nicknameCharacters) throw new Error('暱稱請用 1–20 個字。');
      if (credential.current) await dispatch({ type: 'profile', nickname: name });
      await AsyncStorage.setItem(PROFILE_KEY, name); setNickname(name);
    },
    createRoom: (rules: RoomRules, setup?: PlayerSetup) => withDriver('create', { nickname, rules, setup }),
    joinRoom: (code: string, setup?: PlayerSetup) => withDriver('join', { nickname, setup }, code.trim().toUpperCase()),
    updateRules: (rules: Partial<RoomRules>) => dispatch({ type: 'rules', rules }),
    updateSetup: (setup: PlayerSetup) => dispatch({ type: 'setup', setup }),
    setTeam: (teamId: 'A' | 'B') => dispatch({ type: 'team', teamId }),
    setReady: async (ready: boolean, setup?: PlayerSetup) => { const epoch=generation.current; if (ready && setup) await dispatch({ type: 'setup', setup }); if(epoch!==generation.current)throw new MultiplayerError('房間已更改，請重新操作。',409,'ROOM_CHANGED'); await dispatch({ type: 'ready', ready }); },
    startRoom: () => dispatch({ type: 'start' }),
    setMapReady: (epoch:string,ready:boolean) => dispatch({type:'map-ready',epoch,ready}),
    leaveRoom: async () => {
      // Leaving is always available offline. The server continues the room and
      // applies its existing disconnect grace if it cannot receive this input.
      const epoch=generation.current;
      if(connection==='connected') { try { await dispatch({type:'leave'}); } catch { /* explicit local leave still wins */ } }
      if(epoch===generation.current){clearSession();setError(null);}
    },
    reconnect: () => { setRetry(value => value + 1); },
    clearError: () => setError(null),
  };
}
const MultiplayerContext = createContext<ReturnType<typeof useMultiplayerController> | null>(null);
export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const value = useMultiplayerController();
  return <MultiplayerContext.Provider value={value}>{children}</MultiplayerContext.Provider>;
}
export function useMultiplayer() {
  const value = useContext(MultiplayerContext);
  if (!value) throw new Error('MultiplayerProvider is required.');
  return value;
}
