import {proShiftEarnsCreditUse,type ProPass} from '../shared/pro';
import {ELITE_COURSE_VERSION} from '../shared/eliteCourse';
import type {EliteCertification} from '../shared/elite';
import type {ProClaim} from './cloudflare/pro';
import { MULTIPLAYER_LIMITS as L, PROTOCOL_VERSION, type ActionEnvelope, type CreateRoomRequest, type JoinRoomRequest, type PlayerGameAction, type PlayerSetup, type RankedPlayer, type Room, type RoomPlayer, type RoomRules, type RoomSession, type RoomSnapshot,type DriverCounters,type DriverStats,type DriverProfile,type RoomFeatureVersion,type TeamId,type TeamStanding } from '../shared/protocol';
import type { GameState,RoadGraph } from '../src/game/types';
import {getVehicleGraph} from '../src/game/access';
import {isLegacyVehicleId} from '../src/game/vehicleCapabilities';
import {applyHornAction,hornView,parseHornActions,pruneHorns,type HornRecord} from './horns';
import type {HornView} from '../shared/horns';
import { defaultSimulation, type GameSimulation } from './simulation';
import { decodeState, encodeState } from './codec';
import { envelope, fail, keys, nickname, object, ProtocolFailure, randomToken, roomCode, rules, setup, tokenHash } from './validation';
import {driverStats,ZERO_COUNTERS} from './driverStats';
import {availableSupply,coordinateDispatch,coordinateFuelQueues,initialDispatchState,recordDispatchAcceptance,type DispatchDriver,type DispatchState,type SharedFuelTicket} from './dispatch';
import type {DriverDelta} from './cloudflare/drivers';
import {getWorldEventAt,getWorldEventSchedule,getWorldEventViews} from '../shared/worldEvents';
import {createReviewRecorder,playerMatchReview,recordReviewAction,recordReviewAdvance,restoreReviewRecorder,sampleReviewRoute,reviewSampleMinutes,type ReviewRecorder} from './review';
import {defaultOrderPreferences,normalizeOrderPreferences} from '../src/game/orderPreferences';
import {isCurrentEliteCertification} from '../shared/eliteCourse';
import { projectBlindSnapshot } from '../shared/blindOrders';
import {withdrawClaimedEliteReservations} from '../src/game/elite';
import {coordinateAirportQueues,type SharedAirportTicket} from './airportQueue';
import {getShiftEndMinute} from '../src/game/shiftDuration';
export { ProtocolFailure } from './validation';
export type { GameSimulation } from './simulation';

interface Player {
  id:string;nickname:string;setup:PlayerSetup;ready:boolean;connected:boolean;joinedAt:number;lastSeen:number;disconnectedAt?:number;finishedAt?:number;
  forfeited:boolean;forfeitReason?:string;left:boolean;tokenHash:string;lastInputSeq:number;rateTokens:number;rateUpdatedAt:number;game:GameState|null;
  driverId?:string;driverStats?:DriverStats;driverApplied?:DriverCounters;eliteCertification?:EliteCertification;proRound?:{shiftKey:string;pass:ProPass};nearbyDrivers?:number;teamId?:TeamId;review?:ReviewRecorder;hornView?:HornView;hornRateTokens?:number;hornRateUpdatedAt?:number;
}
interface Match { room:Omit<Room,'players'>;players:Player[];revision:number;lastTickAt:number;claims:Map<string,string>;legacyStartTimeMissing?:boolean;dispatchState?:DispatchState;fuelTickets?:SharedFuelTicket[];horns?:HornRecord[];airportTickets?:SharedAirportTicket[];airportNextSequence?:number }
const DEFAULT_RULES:RoomRules={mode:'highest-net',shift:'day',speed:30,density:'normal',startTimeMinutes:300};
const DEFAULT_SETUP:PlayerSetup={vehicleId:'kam-fung',startPlaceId:'harbour-city'};
const isModern=(version?:RoomFeatureVersion)=>version==='0.5'||version==='0.6';
const duration=(room:Omit<Room,'players'>):360|720|1440=>room.featureVersion==='0.6'&&(room.shiftDurationMinutes===360||room.shiftDurationMinutes===1440)?room.shiftDurationMinutes:720;
const roomEndMinute=(room:Omit<Room,'players'>):number=>isModern(room.featureVersion)?getShiftEndMinute(duration(room)):duration(room);
function compatibleSetup(value:PlayerSetup,version?:RoomFeatureVersion,catalog?:1):PlayerSetup{if(catalog!==1&&!isLegacyVehicleId(value.vehicleId))fail('room_version','請更新遊戲以加入此房間。',409);return isModern(version)||value.autoAcceptOrders===undefined?value:{...value,autoAcceptOrders:false};}
function featureRules(selected:RoomRules,version?:RoomFeatureVersion):RoomRules {
  if(version!=='0.6'&&(selected.mode==='team-net'||selected.shiftDurationMinutes!==undefined&&selected.shiftDurationMinutes!==720))fail('room_version','請更新遊戲以加入此房間。',409);
  return{...selected,shiftDurationMinutes:version==='0.6'?selected.shiftDurationMinutes||360:720};
}
export interface AuthorityOptions { now?:()=>number; simulation?:GameSimulation; blindOrders?:boolean;hornGraph?:RoadGraph;allowExtendedRooms?:boolean;allowAdvancedRooms?:boolean }
/** Trusted HTTP adapter metadata; never accepted from the action envelope or a client header. */
export interface CommandTiming { receivedAt:number }
export interface DurablePresence { playerId:string;lastSeen:number;forfeitedAt:number|null }
export interface SessionInfo { playerId:string;lastInputSeq:number;lastSeen:number;canForfeit:boolean;driverId?:string;driverStats?:DriverStats;nearbyDrivers?:number;horn?:HornView }
export type PublishedSnapshot=Omit<RoomSnapshot,'you'|'ownState'|'serverTime'>;

/** Pure portable authority. Persistence/leases and HTTP/WebSocket delivery live in adapters. */
export class RoomAuthority {
  private proPasses=new Map<string,ProPass>();
  private readonly rooms=new Map<string,Match>();
  private readonly now:()=>number;
  private readonly sim:GameSimulation;
  private readonly hornGraph?:RoadGraph;
  private readonly blindOrders:boolean;
  private readonly allowExtendedRooms:boolean;
  private readonly allowAdvancedRooms:boolean;
  constructor(options:AuthorityOptions={}){this.now=options.now||Date.now;this.sim=options.simulation||defaultSimulation;this.hornGraph=options.hornGraph;this.blindOrders=options.blindOrders===true;this.allowExtendedRooms=options.allowExtendedRooms!==false;this.allowAdvancedRooms=options.allowAdvancedRooms!==false;}

  async createRoom(request:CreateRoomRequest):Promise<RoomSession>{
    const input=object(request);keys(input,['nickname','setup','rules','featureVersion','blindOrdersVersion','vehicleCatalogVersion','advancedRulesVersion','orderPolicyVersion']);const now=this.now();if(request.featureVersion!==undefined&&!['0.4','0.5','0.6'].includes(request.featureVersion))fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.blindOrdersVersion!==undefined&&request.blindOrdersVersion!==1||this.blindOrders&&request.blindOrdersVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.vehicleCatalogVersion!==undefined&&(request.vehicleCatalogVersion!==1||request.featureVersion!=='0.6'))fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.vehicleCatalogVersion===1&&!this.allowExtendedRooms)fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.advancedRulesVersion!==undefined&&(request.advancedRulesVersion!==1||request.vehicleCatalogVersion!==1||request.featureVersion!=='0.6')||request.advancedRulesVersion===1&&!this.allowAdvancedRooms)fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.orderPolicyVersion!==undefined&&(request.orderPolicyVersion!==1||request.advancedRulesVersion!==1||request.vehicleCatalogVersion!==1||request.blindOrdersVersion!==1))fail('room_version','請更新遊戲以加入此房間。',409);
    const base=request.featureVersion==='0.6'?{...DEFAULT_RULES,speed:60 as const,shiftDurationMinutes:360 as const}:DEFAULT_RULES;
    const selected=featureRules(request.rules?rules(request.rules,base):{...base},request.featureVersion);
    if(request.orderPolicyVersion!==1&&(selected.blindOrders!==undefined||request.setup?.orderPreferences!==undefined))fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.orderPolicyVersion===1){selected.blindOrders=selected.blindOrders??this.blindOrders;if(selected.blindOrders&&request.blindOrdersVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);}
    const playerSetup=compatibleSetup(this.sim.validateSetup(request.setup?setup(request.setup):{...DEFAULT_SETUP}),request.featureVersion,request.vehicleCatalogVersion);
    let code=roomCode();for(let count=0;this.rooms.has(code)&&count<10;count++)code=roomCode();if(this.rooms.has(code))fail('capacity','請稍後再建立房間。',503);
    const token=randomToken();const player=await this.newPlayer(nickname(request.nickname),playerSetup,token,now);
    if(selected.mode==='team-net')player.teamId='A';
    const match:Match={room:{...selected,...(request.vehicleCatalogVersion===1?{vehicleCatalogVersion:1 as const}:{}),featureVersion:request.featureVersion||'0.4',startTimeMinutes:selected.startTimeMinutes??(selected.shift==='night'?1020:300),code,hostPlayerId:player.id,status:'lobby',seed:crypto.getRandomValues(new Uint32Array(1))[0],clockMinutes:0,createdAt:now,expiresAt:now+L.lobbyTtlMilliseconds},players:[player],revision:1,lastTickAt:now,claims:new Map(),dispatchState:initialDispatchState(),fuelTickets:[]};
    if(request.advancedRulesVersion===1)match.room.advancedRulesVersion=1;
    if(request.orderPolicyVersion===1){match.room.orderPolicyVersion=1;match.room.blindOrders=selected.blindOrders;if(selected.blindOrders)match.room.orderVisibility={blindOrders:true};}
    else if(this.blindOrders)match.room.orderVisibility={blindOrders:true};
    this.rooms.set(code,match);return{roomCode:code,playerId:player.id,resumeToken:token,snapshot:this.snapshot(match,player,now)};
  }
  async joinRoom(code:string,request:JoinRoomRequest):Promise<RoomSession>{
    const input=object(request);keys(input,['nickname','setup','featureVersion','blindOrdersVersion','vehicleCatalogVersion','advancedRulesVersion','orderPolicyVersion']);const now=this.now();const match=this.requireRoom(code,now);this.tickMatch(match,now);
    if(request.blindOrdersVersion!==undefined&&request.blindOrdersVersion!==1||match.room.orderVisibility?.blindOrders&&request.blindOrdersVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.featureVersion!==undefined&&!['0.4','0.5','0.6'].includes(request.featureVersion)||match.room.featureVersion==='0.6'&&request.featureVersion!=='0.6'||match.room.featureVersion==='0.5'&&!isModern(request.featureVersion))fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.vehicleCatalogVersion!==undefined&&request.vehicleCatalogVersion!==1||match.room.vehicleCatalogVersion===1&&request.vehicleCatalogVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.advancedRulesVersion!==undefined&&request.advancedRulesVersion!==1||match.room.advancedRulesVersion===1&&request.advancedRulesVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
    if(request.orderPolicyVersion!==undefined&&request.orderPolicyVersion!==1||match.room.orderPolicyVersion===1&&(request.orderPolicyVersion!==1||request.blindOrdersVersion!==1)||match.room.orderPolicyVersion!==1&&request.setup?.orderPreferences!==undefined)fail('room_version','請更新遊戲以加入此房間。',409);
    if(match.room.status!=='lobby')fail('match_started','比賽已開始，不能加入新玩家。',409);
    if(match.players.filter(player=>!player.left).length>=(match.room.mode==='team-net'?4:L.maxPlayers))fail('room_full',match.room.mode==='team-net'?'隊際房間已滿，最多四人。':'房間已滿，最多八人。',409);
    const name=nickname(request.nickname);this.uniqueNickname(match,name);
    const selected=compatibleSetup(this.sim.validateSetup(request.setup?setup(request.setup):{...DEFAULT_SETUP}),match.room.featureVersion,match.room.vehicleCatalogVersion);
    const token=randomToken();const player=await this.newPlayer(name,selected,token,now);
    // WebCrypto yields: the in-process adapter may have handled another join or
    // host start meanwhile. Durable adapters additionally hold a room lease.
    if(match.room.status!=='lobby')fail('match_started','比賽已開始，不能加入新玩家。',409);
    if(match.players.filter(entry=>!entry.left).length>=(match.room.mode==='team-net'?4:L.maxPlayers))fail('room_full',match.room.mode==='team-net'?'隊際房間已滿，最多四人。':'房間已滿，最多八人。',409);
    this.uniqueNickname(match,name);if(match.room.mode==='team-net')player.teamId=this.smallestTeam(match);match.players.push(player);match.revision++;
    this.ensureHost(match);return{roomCode:match.room.code,playerId:player.id,resumeToken:token,snapshot:this.snapshot(match,player,now)};
  }
  async readSnapshot(code:string,token:string):Promise<RoomSnapshot>{
    const now=this.now();const match=this.requireRoom(code,now);const player=await this.authenticate(match,token);this.tickMatch(match,now);this.touch(match,player,now);return this.snapshot(match,player,now);
  }
  /** Client rendering capability; checked before hydrating or mutating an extended room. */
  requireVehicleCatalog(code:string,version:unknown):void{const room=this.requireRoom(code,this.now()).room;if(room.vehicleCatalogVersion===1&&version!==1)fail('room_version','請更新遊戲以加入此房間。',409);}
  requireAdvancedRules(code:string,version:unknown):void{const room=this.requireRoom(code,this.now()).room;if(room.advancedRulesVersion===1&&version!==1)fail('room_version','請更新遊戲以加入此房間。',409);}
  requireOrderPolicy(code:string,version:unknown):void{if(this.requireRoom(code,this.now()).room.orderPolicyVersion===1&&version!==1)fail('room_version','請更新遊戲以加入此房間。',409);}
  /** Metadata-only credential check, before a durable adapter inflates player states. */
  async authorizeSession(code:string,token:string):Promise<void>{await this.authenticate(this.requireRoom(code,this.now()),token);}
  async sessionInfo(code:string,token:string):Promise<SessionInfo>{const match=this.requireRoom(code,this.now());const player=await this.authenticate(match,token);return{playerId:player.id,lastInputSeq:player.lastInputSeq,lastSeen:player.lastSeen,canForfeit:['countdown','running'].includes(match.room.status)&&!match.room.loading&&player.finishedAt===undefined&&!player.forfeited&&!player.left,driverId:player.driverId,driverStats:this.careerStats(player),nearbyDrivers:player.nearbyDrivers,horn:match.room.featureVersion==='0.6'?player.hornView:undefined};}
  assertDriverAvailable(code:string,driverId:string,except?:string):void{if(this.requireRoom(code,this.now()).players.some(player=>!player.left&&player.id!==except&&player.driverId===driverId))fail('driver_in_room','房間內已有這個司機帳號。',409);}
  attachDriver(code:string,playerId:string,profile:DriverProfile):void{const match=this.requireRoom(code,this.now());this.assertDriverAvailable(code,profile.driverId,playerId);const player=match.players.find(entry=>entry.id===playerId);if(!player)fail('unauthorized','重連憑證無效。',401);player.driverId=profile.driverId;player.driverStats=profile.stats;player.eliteCertification=profile.eliteCertification;player.driverApplied={...ZERO_COUNTERS};match.revision++;}
  driverIds(code:string):string[]{return this.requireRoom(code,this.now()).players.flatMap(player=>player.driverId?[player.driverId]:[]);}
  applyDriverProfiles(code:string,profiles:DriverProfile[]):void{const match=this.requireRoom(code,this.now());for(const player of match.players){const profile=profiles.find(entry=>entry.driverId===player.driverId);if(profile){player.driverStats=profile.stats;player.eliteCertification=profile.eliteCertification;}}}
  applyProPasses(passes:Map<string,ProPass>):void {this.proPasses=passes;}
  prepareProClaims(code:string):ProClaim[]{
    const match=this.requireRoom(code,this.now());
    return match.players.flatMap(player=>{
      const round=player.proRound;
      if(!round||!player.driverId)return [];
      const completed=player.game?.phase==='ended'&&proShiftEarnsCreditUse(player.game.shiftEndReason)&&!player.forfeited;
      const active=Boolean(player.game&&!player.left&&!player.forfeited&&player.game.phase!=='ended'&&['countdown','running'].includes(match.room.status));
      const claim:ProClaim={...round.pass,shiftKey:round.shiftKey,driverId:player.driverId,state:completed?'consumed':active?'held':'released'};
      return [claim];
    });
  }
  prepareDriverDeltas(code:string):DriverDelta[]{const match=this.requireRoom(code,this.now()),deltas=new Map<string,DriverCounters>();for(const player of match.players){if(!player.driverId||!player.game)continue;const counters=this.gameCounters(player.game),previous=player.driverApplied||ZERO_COUNTERS,delta={...ZERO_COUNTERS};for(const key of Object.keys(delta)as Array<keyof DriverCounters>)delta[key]=Math.max(0,counters[key]-previous[key]);const total=deltas.get(player.driverId)||{...ZERO_COUNTERS};for(const key of Object.keys(total)as Array<keyof DriverCounters>)total[key]+=delta[key];deltas.set(player.driverId,total);player.driverStats=this.careerStats(player);player.driverApplied={offered:Math.max(previous.offered,counters.offered),accepted:Math.max(previous.accepted,counters.accepted),cancelled:Math.max(previous.cancelled,counters.cancelled),completedTrips:Math.max(previous.completedTrips,counters.completedTrips)};}return[...deltas].map(([driverId,counters])=>({driverId,counters}));}
  /** Merge independent durable heartbeats before ticking; expiry is sticky. */
  applyPresence(code:string,records:DurablePresence[],now=this.now()):void{
    const match=this.requireRoom(code,now);let changed=false;
    for(const record of records){const player=match.players.find(entry=>entry.id===record.playerId);if(!player)continue;
      player.lastSeen=Math.max(player.lastSeen,record.lastSeen);
      if(player.left||player.forfeited)continue;
      const expired=record.forfeitedAt!==null||now-player.lastSeen>L.disconnectAfterMilliseconds+L.disconnectGraceMilliseconds;
      if(expired&&!match.room.loading&&player.finishedAt===undefined&&['countdown','running'].includes(match.room.status)){player.forfeited=true;player.connected=false;player.forfeitReason='斷線超過重連寬限';changed=true;continue;}
      const connected=now-player.lastSeen<=L.disconnectAfterMilliseconds;
      if(connected!==player.connected){player.connected=connected;changed=true;}
      player.disconnectedAt=connected?undefined:player.lastSeen+L.disconnectAfterMilliseconds;
    }
    this.ensureHost(match);if(changed)match.revision++;
  }
  publishedSnapshot(code:string):PublishedSnapshot{const match=this.requireRoom(code,this.now());const {you,ownState,serverTime,...published}=this.snapshot(match,match.players[0],this.now());return published;}
  /** Ephemeral audio has its own authenticated channel, never the trip input queue. */
  async handleHorn(code:string,token:string,input:unknown,timing?:CommandTiming):Promise<RoomSnapshot>{
    const now=this.now(),match=this.requireRoom(code,now),player=await this.authenticate(match,token),actions=parseHornActions(input);
    this.tickMatch(match,now);this.touch(match,player,now);
    if(match.room.featureVersion!=='0.6'||match.room.status!=='running'||player.left||player.forfeited||!player.game||player.game.phase==='ended')return this.snapshot(match,player,now);
    const ingress=timing?.receivedAt;
    if(ingress!==undefined&&(!Number.isSafeInteger(ingress)||ingress>now||now-ingress>2000))return this.snapshot(match,player,now);
    const eventAt=ingress??now;
    const tokens=Math.min(8,(player.hornRateTokens??8)+Math.max(0,now-(player.hornRateUpdatedAt??now))*.003);
    player.hornRateUpdatedAt=now;if(tokens<1)return this.snapshot(match,player,now);player.hornRateTokens=tokens-1;
    this.updateHornViews(match,now);
    if(player.hornView?.available){for(const action of actions)match.horns=applyHornAction(match.horns,player.id,action,eventAt);match.revision++;}
    return this.snapshot(match,player,now);
  }
  private updateHornViews(match:Match,now:number):void{
    match.horns=pruneHorns(match.horns,now);
    const participants=match.players.map(p=>({id:p.id,position:p.game?.movement,eligible:match.room.status==='running'&&!p.left&&!p.forfeited&&p.connected&&!!p.game&&p.game.phase!=='ended'}));
    for(const player of match.players)player.hornView=match.room.featureVersion==='0.6'?hornView(match.horns,player.id,participants,this.hornGraph||getVehicleGraph(player.game?.vehicleId||'kam-fung'),now,player.hornView?.available):undefined;
  }
  async handleCommand(code:string,token:string,input:ActionEnvelope,timing?:CommandTiming):Promise<RoomSnapshot>{
    const now=this.now();const match=this.requireRoom(code,now);const player=await this.authenticate(match,token);const command=envelope(input);
    const ingress=timing?.receivedAt;
    const gateIngress=command.action.type==='map-ready'&&match.room.status==='countdown'&&match.room.loading;
    const lowerBound=gateIngress?gateIngress.deadlineAt-L.mapLoadingTimeoutMilliseconds:match.lastTickAt;
    const at=(command.action.type==='accept'||!!gateIngress)&&typeof ingress==='number'&&Number.isFinite(ingress)&&ingress>=lowerBound&&ingress<=now?ingress:now;
    const catchUp=at<now;
    // A command may wait for the room publisher's lease. Validate it at trusted
    // server ingress only while the durable world has not already passed that
    // instant. Never rewind a later commit or revive a reassigned request.
    this.tickMatch(match,at,!catchUp);this.touch(match,player,now);
    if(command.seq<=player.lastInputSeq){if(catchUp)this.tickMatch(match,now);return this.snapshot(match,player,now);}
    try{
    this.consumeRate(player,now);
    const action=command.action;
    if(['airport','elite-booking','pro-destination'].includes(action.type)&&match.room.advancedRulesVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
    if((player.left||player.forfeited)&&action.type!=='leave')fail('player_left','此玩家已退出或失去參賽資格。',409);
    if(action.type==='profile') {const name=nickname(action.nickname);this.uniqueNickname(match,name,player.id);player.nickname=name;}
    else if(action.type==='leave') {this.samplePlayer(player,true);const completed=match.room.featureVersion==='0.6'&&player.game?.phase==='ended'&&!player.forfeited;player.left=true;player.ready=false;player.connected=false;player.forfeited=!completed&&!match.room.loading&&match.room.status!=='lobby';player.forfeitReason=player.forfeited?'主動離開比賽':undefined;if(match.room.status==='lobby')match.players=match.players.filter(entry=>entry.id!==player.id);if(match.room.loading)this.returnLoadingToLobby(match,now);this.ensureHost(match);}
    else if(action.type==='map-ready'){
      if(match.room.featureVersion!=='0.6')fail('room_version','請更新遊戲以加入此房間。',409);
      // A late unmount/background acknowledgement must never pause a running
      // world or accidentally mark a subsequent lobby/start ready.
      const loading=match.room.loading;
      if(match.room.status==='countdown'&&loading){
        if(action.epoch!==loading.epoch)fail('loading_changed','地圖載入階段已更改，請查看最新房間。',409);
        const ready=new Set(loading.readyPlayerIds);if(action.ready)ready.add(player.id);else ready.delete(player.id);loading.readyPlayerIds=[...ready];
        this.updateMapLoading(match,now);
      }
    }
    else if(['setup','ready','rules','team','start'].includes(action.type)) {
      if(match.room.status!=='lobby')fail('rules_locked','開始後房規與車輛設定已鎖定。',409);
      if(action.type==='setup'){const selected=compatibleSetup(this.sim.validateSetup(setup(action.setup)),match.room.featureVersion,match.room.vehicleCatalogVersion);this.checkOrderSetup(match,selected,player.eliteCertification);player.setup=selected;player.ready=false;}
      else if(action.type==='ready'){if(action.ready)this.checkOrderSetup(match,player.setup,player.eliteCertification);player.ready=action.ready;}
      else if(action.type==='team'){
        if(match.room.featureVersion!=='0.6'||match.room.mode!=='team-net')fail('team_unavailable','此房間未啟用隊際模式。',409);
        if(player.teamId!==action.teamId){player.teamId=action.teamId;player.ready=false;}
      }
      else if(action.type==='rules'){
        this.requireHost(match,player);const selected=featureRules(rules(action.rules,match.room),match.room.featureVersion);
        if(match.room.orderPolicyVersion!==1&&action.rules.blindOrders!==undefined)fail('room_version','請更新遊戲以加入此房間。',409);
        if(selected.mode==='team-net'&&match.players.filter(entry=>!entry.left).length>4)fail('team_capacity','隊際模式需要四名玩家，每隊兩人。',409);
        const enteringTeam=selected.mode==='team-net'&&match.room.mode!=='team-net';Object.assign(match.room,selected);
        if(match.room.orderPolicyVersion===1){if(match.room.blindOrders)match.room.orderVisibility={blindOrders:true};else delete match.room.orderVisibility;}
        for(const [index,entry]of match.players.entries()){entry.ready=false;if(enteringTeam)entry.teamId=index%2?'B':'A';else if(selected.mode!=='team-net')entry.teamId=undefined;}
      }else if(action.type==='start'){
        this.requireHost(match,player);const entrants=match.players.filter(entry=>!entry.left);
        if(entrants.length<L.minPlayers||entrants.some(entry=>!entry.connected||!entry.ready))fail('not_ready','需要2至8名玩家全部連線並準備好。',409);
        if(match.room.mode==='team-net'&&(entrants.length!==4||entrants.filter(entry=>entry.teamId==='A').length!==2||entrants.filter(entry=>entry.teamId==='B').length!==2))fail('teams_unbalanced','隊際模式需要四名玩家，每隊兩人。',409);
        for(const entry of entrants)this.checkOrderSetup(match,entry.setup,entry.eliteCertification);
        for(const entry of entrants){
          const game=this.offerWindow(this.sim.create(entry.setup,match.room,match.room.seed),match.room.speed);
          const configured=this.sim.configurePlayer?this.sim.configurePlayer(game,entry.id,match.room.featureVersion,match.room.vehicleCatalogVersion):game;
          const advanced=match.room.advancedRulesVersion===1;
          const pass=advanced&&entry.driverId?this.proPasses.get(entry.driverId):undefined;
          entry.proRound=pass?{shiftKey:crypto.randomUUID(),pass}:undefined;
          entry.game=advanced?{...configured,advancedRulesVersion:1,proTier:pass?.tier??'blue',
            eliteCertified:entry.eliteCertification?.courseVersion===ELITE_COURSE_VERSION}:configured;
          if(match.room.orderPolicyVersion===1)entry.game={...entry.game,orderPreferences:normalizeOrderPreferences(entry.setup.orderPreferences??defaultOrderPreferences(entry.setup.vehicleId),entry.setup.vehicleId,entry.game.eliteCertified),blindOrders:match.room.blindOrders};
          if(match.room.featureVersion==='0.6'){entry.review=createReviewRecorder();this.samplePlayer(entry,true);}
        }
        match.room.status='countdown';
        const loadingMs=match.room.featureVersion==='0.6'?L.mapLoadingTimeoutMilliseconds:0;
        const shiftMs=roomEndMinute(match.room)*60_000/match.room.speed;
        // Slow rooms must persist through turnover and the final settlement poll.
        match.room.expiresAt=now+Math.max(L.runningTtlMilliseconds,loadingMs+L.countdownMilliseconds+shiftMs+60_000);
        if(match.room.featureVersion==='0.6'){match.room.loading={epoch:crypto.randomUUID(),deadlineAt:now+L.mapLoadingTimeoutMilliseconds,readyPlayerIds:[]};delete match.room.startsAt;match.lastTickAt=now;}
        else{match.room.startsAt=now+L.countdownMilliseconds;match.lastTickAt=match.room.startsAt;}
        this.coordinateMatch(match);
      }
    } else {
      if(match.room.status!=='running'||!player.game||player.game.phase==='ended')fail('not_driving','比賽尚未開始或本更已結束。',409);
      if(action.type==='cancel-charge'&&match.room.vehicleCatalogVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
      if(action.type==='auto-accept'&&action.value&&!isModern(match.room.featureVersion))fail('room_version','請更新遊戲以加入此房間。',409);
      const before=player.game;
      if(action.type==='elite-booking'){
        if(match.room.advancedRulesVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);
        const booking=before.eliteReservations?.find(entry=>entry.id===action.bookingId);
        if(!booking)fail('booking_changed','預約已更改，請查看最新狀態。',409);
        const owner=match.claims.get(action.bookingId);
        if(action.choice==='accept'&&owner&&owner!==player.id){player.game=withdrawClaimedEliteReservations(before,match.claims,player.id);fail('offer_taken','此訂單已由另一位司機接走。',409);}
      }
      if((action.type==='accept'||action.type==='decline')&&before.currentOffer?.id!==action.offerId)fail('offer_expired','此訂單已過期，請查看最新派單。',409);
      if(action.type==='cancel'&&before.activeTrip?.offer.id!==action.tripId)fail('trip_changed','行程已更改或已結束，請查看最新狀態。',409);
      if(action.type==='cancel-queued'&&before.queuedTrip?.offer.id!==action.tripId)fail('trip_changed','行程已更改或已結束，請查看最新狀態。',409);
      if((action.type==='accept'||action.type==='auto-accept'&&action.value)&&before.currentOffer){const owner=match.claims.get(before.currentOffer.id);if(owner&&owner!==player.id){player.game=this.withdrawTakenOffer(before);match.revision++;fail('offer_taken','此訂單已由另一位司機接走。',409);}}
      const after=this.sim.apply(before,action as PlayerGameAction);player.game=after;
      if(action.type==='elite-booking'){
        if(after===before)fail('booking_unavailable','目前無法執行這個預約安排。',409);
        if(action.choice==='accept'&&after.eliteReservations?.some(entry=>entry.id===action.bookingId&&entry.status==='accepted')&&after.acceptedOffers>before.acceptedOffers)match.claims.set(action.bookingId,player.id);
      }
      if(match.room.featureVersion==='0.6'&&player.review){recordReviewAction(player.review,before,after,action as PlayerGameAction);this.samplePlayer(player,after.phase==='ended');}
      if(after.acceptedOffers>before.acceptedOffers){const offerId=before.currentOffer?.id;const trip=after.queuedTrip?.offer.id===offerId?after.queuedTrip:after.activeTrip?.offer.id===offerId?after.activeTrip:null;if(trip){match.claims.set(trip.offer.id,player.id);match.dispatchState=recordDispatchAcceptance(match.dispatchState,trip.offer,player.id,now);}}
      this.clearClaimedOffers(match);this.markFinished(match,player,now);this.coordinateMatch(match,!catchUp);
    }
    if(action.type==='leave'&&match.room.advancedRulesVersion===1&&match.room.status==='running')this.coordinateAirport(match);
    this.settleCompletedEarly(match,now);player.lastInputSeq=command.seq;match.revision++;
    }catch(error){if(catchUp)this.tickMatch(match,now);throw error;}
    if(catchUp)this.tickMatch(match,now);
    return this.snapshot(match,player,now);
  }
  tick(now=this.now()):void{for(const [code,match]of this.rooms){if(match.room.expiresAt<=now)this.rooms.delete(code);else this.tickMatch(match,now);}}
  getRoomCodes():string[]{return [...this.rooms.keys()];}
  getPlayerIds(code:string):string[]{return this.requireRoom(code,this.now()).players.map(player=>player.id);}
  presenceSeeds(code:string):DurablePresence[]{return this.requireRoom(code,this.now()).players.map(player=>({playerId:player.id,lastSeen:player.lastSeen,forfeitedAt:player.forfeited?player.lastSeen+L.disconnectAfterMilliseconds+L.disconnectGraceMilliseconds:null}));}
  serializeRoomMetadata(code:string):string|null{
    const match=this.rooms.get(code);if(!match)return null;
    return JSON.stringify({schemaVersion:1,room:match.room,revision:match.revision,lastTickAt:match.lastTickAt,claims:[...match.claims],dispatchState:match.dispatchState,fuelTickets:match.fuelTickets,airportTickets:match.airportTickets,airportNextSequence:match.airportNextSequence,horns:match.horns,players:match.players.map(({game,...player})=>player)});
  }
  deserializeRoomMetadata(json:string):void{
    const stored=JSON.parse(json);if(stored.schemaVersion!==1||!stored.room?.code||!Array.isArray(stored.players))fail('invalid_saved_room','房間存檔無效。',500);
    if(stored.room.vehicleCatalogVersion!==undefined&&(stored.room.vehicleCatalogVersion!==1||stored.room.featureVersion!=='0.6'))fail('invalid_saved_room','房間存檔無效。',500);
    if(stored.room.vehicleCatalogVersion!==1&&stored.players.some((player:Player)=>!isLegacyVehicleId(player.setup?.vehicleId)))fail('invalid_saved_room','房間存檔無效。',500);
    if(stored.room.orderPolicyVersion!==undefined&&(stored.room.orderPolicyVersion!==1||stored.room.advancedRulesVersion!==1||stored.room.vehicleCatalogVersion!==1||typeof stored.room.blindOrders!=='boolean'))fail('invalid_saved_room','房間存檔無效。',500);
    const legacy=stored.room.startTimeMinutes===undefined;
    const room={...stored.room,featureVersion:stored.room.featureVersion||'0.4',startTimeMinutes:stored.room.startTimeMinutes??(stored.room.shift==='night'?1020:300)};
    if(room.orderPolicyVersion===1){if(room.blindOrders)room.orderVisibility={blindOrders:true};else delete room.orderVisibility;}
    room.shiftDurationMinutes=duration(room);if(room.featureVersion!=='0.6'){delete room.worldEvent;delete room.worldEvents;delete room.teamLeaderboard;delete room.loading;}
    const airportTickets=room.advancedRulesVersion===1&&Array.isArray(stored.airportTickets)?stored.airportTickets:[];
    const airportNextSequence=room.advancedRulesVersion===1&&Number.isSafeInteger(stored.airportNextSequence)&&stored.airportNextSequence>=0?stored.airportNextSequence:0;
    if(room.advancedRulesVersion!==1)delete room.airport;
    this.rooms.set(room.code,{room,legacyStartTimeMissing:legacy&&room.status!=='lobby',revision:stored.revision,lastTickAt:stored.lastTickAt,claims:new Map(stored.claims||[]),dispatchState:stored.dispatchState||initialDispatchState(),fuelTickets:stored.fuelTickets||[],airportTickets,airportNextSequence,horns:pruneHorns(stored.horns,this.now()),players:stored.players.map((player:Player)=>({...player,teamId:room.featureVersion==='0.6'?player.teamId:undefined,review:room.featureVersion==='0.6'?restoreReviewRecorder(player.review):undefined,game:null}))});
  }
  serializePlayerState(code:string,id:string):string|null{const player=this.rooms.get(code)?.players.find(entry=>entry.id===id);return player?.game?encodeState(player.game):null;}
  deserializePlayerState(code:string,id:string,json:string):void{const match=this.rooms.get(code);const player=match?.players.find(entry=>entry.id===id);if(!player||!match)fail('invalid_saved_player','玩家存檔無效。',500);player.game=this.sim.restore(decodeState(json));if(match.room.vehicleCatalogVersion!==1&&!isLegacyVehicleId(player.game.vehicleId))fail('invalid_saved_player','玩家存檔無效。',500);if(match.legacyStartTimeMissing){match.room.startTimeMinutes=player.game.startTimeMinutes;match.legacyStartTimeMissing=false;}player.game=this.offerWindow({...player.game,startTimeMinutes:match.room.startTimeMinutes,shiftDurationMinutes:duration(match.room),worldEvent:match.room.featureVersion==='0.6'?getWorldEventAt(match.room.seed,player.game.clockMinutes,duration(match.room),match.room.startTimeMinutes):undefined},match.room.speed);if(this.sim.configurePlayer)player.game=this.sim.configurePlayer(player.game,id,match.room.featureVersion,match.room.vehicleCatalogVersion);if(match.room.orderPolicyVersion!==1){delete player.game.orderPreferences;delete player.game.blindOrders;}else player.game.blindOrders=match.room.blindOrders;}
  serializeRoom(code:string):string|null{const metadata=this.serializeRoomMetadata(code);if(!metadata)return null;return JSON.stringify({metadata:JSON.parse(metadata),states:this.getPlayerIds(code).map(id=>({id,state:this.serializePlayerState(code,id)}))});}
  deserializeRoom(json:string):void{const stored=JSON.parse(json);this.deserializeRoomMetadata(JSON.stringify(stored.metadata));for(const entry of stored.states||[])if(entry.state)this.deserializePlayerState(stored.metadata.room.code,entry.id,entry.state);}

  private checkOrderSetup(match:Match,value:PlayerSetup,certificate?:EliteCertification):void{if(value.orderPreferences===undefined)return;if(match.room.orderPolicyVersion!==1)fail('room_version','請更新遊戲以加入此房間。',409);if(value.orderPreferences.enabledPricingTypes.includes('private-elite')&&!isCurrentEliteCertification(certificate))fail('elite_required','請先通過商務資格課程，先可以揀專屬預約（ELITE）。',409);}
  private async newPlayer(name:string,selected:PlayerSetup,token:string,now:number):Promise<Player>{return{id:crypto.randomUUID(),nickname:name,setup:selected,ready:false,connected:true,joinedAt:now,lastSeen:now,forfeited:false,left:false,tokenHash:await tokenHash(token),lastInputSeq:0,rateTokens:20,rateUpdatedAt:now,game:null};}
  private requireRoom(code:string,now:number):Match{const match=this.rooms.get(String(code).toUpperCase());if(!match)fail('room_not_found','找不到房間；房間可能已過期或伺服器已重啟。',404);if(match.room.expiresAt<=now){this.rooms.delete(match.room.code);fail('room_expired','房間已過期。',410);}return match;}
  private async authenticate(match:Match,token:string):Promise<Player>{const digest=await tokenHash(token);const player=match.players.find(entry=>entry.tokenHash===digest);if(!player)fail('unauthorized','重連憑證不屬於此房間。',401);return player;}
  private touch(match:Match,player:Player,now:number):void{if(!player.connected&&!player.left&&!player.forfeited){player.connected=true;player.disconnectedAt=undefined;match.revision++;}player.lastSeen=now;this.ensureHost(match);}
  private uniqueNickname(match:Match,name:string,except?:string):void{if(match.players.some(entry=>!entry.left&&entry.id!==except&&entry.nickname.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('nickname_taken','房內已有相同名稱。',409);}
  private requireHost(match:Match,player:Player):void{if(match.room.hostPlayerId!==player.id)fail('host_only','只有房主可進行此操作。',403);}
  private returnLoadingToLobby(match:Match,now:number):void {
    match.room.status='lobby';match.room.clockMinutes=0;match.room.expiresAt=now+L.lobbyTtlMilliseconds;delete match.room.loading;delete match.room.startsAt;delete match.room.competition;
    match.lastTickAt=now;match.claims.clear();match.dispatchState=initialDispatchState();match.fuelTickets=[];match.airportTickets=[];match.airportNextSequence=0;delete match.room.airport;
    match.players=match.players.filter(player=>!player.left);for(const player of match.players){player.game=null;player.review=undefined;player.ready=false;player.finishedAt=undefined;player.forfeited=false;player.forfeitReason=undefined;player.nearbyDrivers=undefined;}
    this.ensureHost(match);
  }
  /** True only while every required participant acknowledges this map epoch. */
  private updateMapLoading(match:Match,now:number):boolean {
    const loading=match.room.loading;if(match.room.featureVersion!=='0.6'||match.room.status!=='countdown'||!loading)return false;
    if(match.players.some(player=>player.left||player.forfeited)){this.returnLoadingToLobby(match,now);return true;}
    const ready=loading.readyPlayerIds.filter(id=>match.players.some(player=>player.id===id&&player.connected));
    let changed=ready.length!==loading.readyPlayerIds.length;loading.readyPlayerIds=ready;
    const complete=match.players.length>=L.minPlayers&&match.players.every(player=>player.connected&&ready.includes(player.id));
    if(!complete){
      if(match.room.startsAt!==undefined){delete match.room.startsAt;match.lastTickAt=now;changed=true;}
      if(now>=loading.deadlineAt){this.returnLoadingToLobby(match,now);return true;}
    }else if(match.room.startsAt===undefined){match.room.startsAt=now+L.countdownMilliseconds;match.lastTickAt=match.room.startsAt;changed=true;}
    return changed;
  }
  private smallestTeam(match:Match):TeamId{return match.players.filter(player=>!player.left&&player.teamId==='A').length<=match.players.filter(player=>!player.left&&player.teamId==='B').length?'A':'B';}
  private samplePlayer(player:Player,force=false):void{if(!player.review||!player.game)return;const last=player.review.route.at(-1);if(last&&Math.abs(last.minute-player.game.clockMinutes)<1e-7)return;if(!force&&last&&player.game.clockMinutes-last.minute<reviewSampleMinutes(player.game.shiftDurationMinutes)-1e-7)return;sampleReviewRoute(player.review,player.game,this.sim.peer(player.game).position,force);}
  private ensureHost(match:Match):void{const host=match.players.find(entry=>entry.id===match.room.hostPlayerId);if(host?.connected&&!host.left&&!host.forfeited)return;const next=match.players.find(entry=>entry.connected&&!entry.left&&!entry.forfeited);if(next&&next.id!==match.room.hostPlayerId){match.room.hostPlayerId=next.id;match.revision++;}}
  private consumeRate(player:Player,now:number):void{player.rateTokens=Math.min(20,player.rateTokens+Math.max(0,now-player.rateUpdatedAt)*.005);player.rateUpdatedAt=now;if(player.rateTokens<1)throw new ProtocolFailure(429,'rate_limited','操作太頻密，請稍後再試。',200);player.rateTokens--;}
  private gameCounters(game:GameState):DriverCounters{return{offered:Math.max(0,game.presentedOffers??game.platform.offered),accepted:Math.max(0,game.acceptedOffers),cancelled:Math.max(0,game.cancelledTrips),completedTrips:Math.max(0,game.completedTrips)};}
  private careerStats(player:Player):DriverStats|undefined{if(!player.driverId||!player.driverStats)return undefined;const stats={...player.driverStats},current=player.game?this.gameCounters(player.game):player.driverApplied||ZERO_COUNTERS,previous=player.driverApplied||ZERO_COUNTERS;for(const key of Object.keys(ZERO_COUNTERS)as Array<keyof DriverCounters>)stats[key]+=Math.max(0,current[key]-previous[key]);return {...driverStats(stats,Math.max(stats.updatedAt,this.now())),reviewBaseline:stats.reviewBaseline};}
  private drivers(match:Match):DispatchDriver[]{return match.players.flatMap(player=>player.game?[{id:player.id,nickname:player.nickname,game:player.game,connected:player.connected,left:player.left,forfeited:player.forfeited,stats:this.careerStats(player)}]:[]);}
  private coordinateAirport(match:Match):void{
    if(match.room.advancedRulesVersion!==1){match.airportTickets=[];match.airportNextSequence=0;delete match.room.airport;return;}
    const airport=coordinateAirportQueues(this.drivers(match),match.airportTickets||[],match.airportNextSequence||0,match.room.clockMinutes);
    match.airportTickets=airport.tickets;match.airportNextSequence=airport.nextSequence;match.room.airport=airport.view;
    for(const player of match.players)if(airport.games.has(player.id))player.game=airport.games.get(player.id)!;
  }
  private coordinateMatch(match:Match,dispatchEnabled=true):void{if(!isModern(match.room.featureVersion)||!['countdown','running'].includes(match.room.status)||match.room.featureVersion==='0.6'&&match.room.status!=='running')return;
    const before=match.room.featureVersion==='0.6'?new Map(match.players.map(player=>[player.id,player.game])):undefined;
    const fuel=coordinateFuelQueues(this.drivers(match),match.fuelTickets||[],match.room.clockMinutes);match.fuelTickets=fuel.tickets;for(const player of match.players)if(fuel.games.has(player.id))player.game=fuel.games.get(player.id)!;
    this.coordinateAirport(match);
    if(dispatchEnabled){const dispatch=coordinateDispatch(this.drivers(match),match.room.seed,match.room.clockMinutes,match.claims,match.dispatchState,this.now());match.dispatchState=dispatch.state;for(const claim of dispatch.acceptedClaims)match.claims.set(claim.offerId,claim.playerId);for(const player of match.players){if(dispatch.games.has(player.id))player.game=dispatch.games.get(player.id)!;player.nearbyDrivers=dispatch.nearby.get(player.id)||0;}
      this.clearClaimedOffers(match);match.room.competition={availableDrivers:dispatch.availableDrivers,assignments:dispatch.assignments};this.coordinateAirport(match);}
    if(before)for(const player of match.players){const previous=before.get(player.id);if(previous&&player.game&&player.review)recordReviewAdvance(player.review,previous,player.game);}
  }
  private offerWindow(game:GameState,speed:number):GameState{const minutes=speed*5/60;if(this.sim.configureOfferWindow)return this.sim.configureOfferWindow(game,minutes);const offer=game.currentOffer;return{...game,offerResponseWindowMinutes:minutes,currentOffer:offer?{...offer,expiresAt:offer.createdAt+minutes}:null};}
  private withdrawTakenOffer(game:GameState):GameState{return{...game,currentOffer:null,platform:{...game.platform,offered:Math.max(game.acceptedOffers+game.declinedOffers,game.platform.offered-1)}};}
  private clearClaimedOffers(match:Match):void{for(const player of match.players){if(!player.game)continue;player.game=withdrawClaimedEliteReservations(player.game,match.claims,player.id);const offer=player.game.currentOffer;const owner=offer&&match.claims.get(offer.id);if(owner&&owner!==player.id)player.game=this.withdrawTakenOffer(player.game);if(!isModern(match.room.featureVersion)){const remaining=player.game.observedOffers.filter(entry=>!match.claims.has(entry.id));if(remaining.length!==player.game.observedOffers.length)player.game={...player.game,observedOffers:remaining};}}}
  private lateFuelCompletion(match:Match,player:Player):boolean{const game=player.game,shift=duration(match.room);return isModern(match.room.featureVersion)&&game?.phase==='ended'&&game.shiftEndReason==='fuel-completed-late'&&game.clockMinutes>shift&&game.clockMinutes<=shift+Math.min(240,shift/3)&&game.energy.capacity>0&&game.energy.remaining>=game.energy.capacity-1e-6&&!game.activeTrip&&!game.queuedTrip&&!game.energyRecovery;}
  private markFinished(match:Match,player:Player,now:number):void{if(player.game?.phase==='ended'){if(player.finishedAt===undefined)player.finishedAt=now;if(player.game.handoverStatus==='missed'&&!this.lateFuelCompletion(match,player)){player.forfeited=true;player.forfeitReason=player.game.handoverFailureReason==='fuel'?'未完成交更前補給':'未能準時返回交更點';}}}
  private settleCompletedEarly(match:Match,now:number):boolean {
    if(match.room.featureVersion!=='0.6'||match.room.status!=='running')return false;
    const remaining=match.players.filter(player=>!player.left&&!player.forfeited);
    // An empty/all-forfeit roster must not pass an every() test vacuously.
    if(!remaining.length||remaining.some(player=>player.game?.phase!=='ended'))return false;
    const actualEnd=Math.max(0,...match.players.map(player=>player.game?.clockMinutes||0));
    match.room.clockMinutes=Math.min(match.room.clockMinutes,actualEnd);match.lastTickAt=now;
    for(const player of match.players)this.samplePlayer(player,true);
    match.room.status='finished';match.room.finishedAt=now;match.room.expiresAt=now+L.finishedTtlMilliseconds;match.room.finishReason='共同更份已結束';return true;
  }
  private tickMatch(match:Match,now:number,dispatchEnabled=true):void{
    let changed=false;
    for(const player of match.players){
      if(player.connected&&!player.left&&now-player.lastSeen>L.disconnectAfterMilliseconds){player.connected=false;player.disconnectedAt=player.lastSeen+L.disconnectAfterMilliseconds;changed=true;}
      if(!match.room.loading&&!player.connected&&!player.left&&!player.forfeited&&player.finishedAt===undefined&&player.disconnectedAt!==undefined&&now-player.disconnectedAt>L.disconnectGraceMilliseconds&&['countdown','running'].includes(match.room.status)){player.forfeited=true;player.forfeitReason='斷線超過重連寬限';changed=true;}
    }
    this.ensureHost(match);
    changed=this.updateMapLoading(match,now)||changed;
    if(match.room.status==='countdown'&&now>=(match.room.startsAt||Infinity)){match.room.status='running';delete match.room.loading;if(match.room.featureVersion==='0.6')this.coordinateMatch(match,dispatchEnabled);changed=true;}
    if(match.room.status==='running'&&now>match.lastTickAt){
      // The engine decides which already-joined fuel queues/services may finish
      // after turnover. Keep their shared clock and FIFO tickets moving; older
      // rooms retain the original hard twelve-hour deadline.
      const modern=isModern(match.room.featureVersion),shift=duration(match.room);
      const limit=roomEndMinute(match.room);
      const target=Math.min(limit,match.room.clockMinutes+(now-match.lastTickAt)*match.room.speed/60_000);
      const minutes=target-match.room.clockMinutes;
      const supply=modern?availableSupply(this.drivers(match)):undefined;
      for(const player of match.players){if(!player.game)continue;const history=player.driverStats,applied=player.driverApplied||ZERO_COUNTERS;player.game={...player.game,demandSupply:supply,platformHistory:history?{offered:Math.max(0,history.offered-applied.offered),accepted:Math.max(0,history.accepted-applied.accepted),cancelled:Math.max(0,history.cancelled-applied.cancelled)}:undefined};}
      if(match.room.featureVersion==='0.6'){
        // Keep event boundaries exact even after a long polling gap. Fifteen-
        // minute route samples are actual engine positions, never interpolated
        // snapshots or a full replay stream.
        const from=match.room.clockMinutes;const boundaries=getWorldEventSchedule(match.room.seed,shift,match.room.startTimeMinutes).flatMap(event=>[event.startsAt,event.endsAt]);
        const stride=reviewSampleMinutes(shift);for(let minute=(Math.floor(from/stride)+1)*stride;minute<target;minute+=stride)boundaries.push(minute);
        const steps=[...new Set([...boundaries.filter(minute=>minute>from&&minute<target),target])].sort((a,b)=>a-b);
        let cursor=from;
        for(const end of steps){const event=getWorldEventAt(match.room.seed,cursor,shift,match.room.startTimeMinutes);
          for(const player of match.players){if(!player.game||player.left||player.forfeited)continue;const before={...player.game,worldEvent:event};player.game=this.offerWindow(this.sim.advance(before,end-cursor),match.room.speed);if(player.review)recordReviewAdvance(player.review,before,player.game);this.samplePlayer(player,player.game.phase==='ended');this.markFinished(match,player,now);}
          cursor=end;
        }
        const event=getWorldEventAt(match.room.seed,target,shift,match.room.startTimeMinutes);for(const player of match.players)if(player.game)player.game={...player.game,worldEvent:event};
      }else for(const player of match.players){if(!player.game||player.left||player.forfeited)continue;player.game=this.offerWindow(this.sim.advance(player.game,minutes),match.room.speed);this.markFinished(match,player,now);}
      match.room.clockMinutes=target;match.lastTickAt=now;this.clearClaimedOffers(match);this.coordinateMatch(match,dispatchEnabled);changed=true;
      const completedEarly=this.settleCompletedEarly(match,now);
      const eligible=match.players.filter(player=>!player.left&&!player.forfeited);
      const unfinished=eligible.filter(player=>player.game?.phase!=='ended');
      if(!completedEarly&&target>=shift&&(!modern||!unfinished.length||target>=limit)){
        for(const player of unfinished){player.forfeited=true;player.forfeitReason='未能準時返回交更點';}
        // Freeze the final room clock at actual completion, rather than adding
        // idle overtime when a delayed poll observes everyone already ended.
        if(modern&&!unfinished.length)match.room.clockMinutes=Math.max(shift,...match.players.map(player=>player.game?.clockMinutes||0));
        if(match.room.featureVersion==='0.6')for(const player of match.players)this.samplePlayer(player,true);
        match.room.status='finished';match.room.finishedAt=now;match.room.expiresAt=now+L.finishedTtlMilliseconds;match.room.finishReason='共同更份已結束';
      }
    }
    changed=this.settleCompletedEarly(match,now)||changed;
    if(changed)match.revision++;
  }
  private publicPlayer(match:Match,player:Player):RoomPlayer{
    const retainedFinish=match.room.featureVersion==='0.6'&&player.game?.phase==='ended'&&!player.forfeited;
    const status:RoomPlayer['status']=player.forfeited||player.left&&!retainedFinish?'left':player.game?.phase==='ended'?'finished':!player.connected?'disconnected':match.room.status==='lobby'||match.room.status==='countdown'?'lobby':'driving';
    return{...player.setup,teamId:player.teamId,id:player.id,nickname:player.nickname,connected:player.connected,ready:player.ready,status,joinedAt:player.joinedAt,disconnectedAt:player.disconnectedAt,finishedAt:player.finishedAt,forfeited:player.forfeited,forfeitReason:player.forfeitReason,...(this.lateFuelCompletion(match,player)?{late:true}:{}),...(player.game?this.sim.peer(player.game):{})};
  }
  private snapshot(match:Match,you:Player|undefined,now:number):RoomSnapshot{
    this.updateHornViews(match,now);
    const players=match.players.filter(player=>!player.left||match.room.status!=='lobby').map(player=>this.publicPlayer(match,player));
    const sorted=[...players].sort((a,b)=>Number(!!a.forfeited)-Number(!!b.forfeited)||(match.room.mode==='lowest-net'?1:-1)*((a.netIncome||0)-(b.netIncome||0))||a.joinedAt-b.joinedAt||a.id.localeCompare(b.id));
    let previous:number|undefined;let rank=0;
    const leaderboard:RankedPlayer[]=sorted.map((player,index)=>{const income=player.netIncome||0;if(income!==previous)rank=index+1;previous=income;const eligible=!player.forfeited&&(!['lobby','countdown'].includes(match.room.status))&&(match.room.status!=='finished'||player.status==='finished');return{playerId:player.id,nickname:player.nickname,rank:eligible?rank:null,netIncome:income,score:player.score||0,completedTrips:player.completedTrips||0,finished:player.status==='finished',forfeited:!!player.forfeited,connected:player.connected,...(player.late?{late:true}:{})};});
    const ownState=you?.game?(({landmarks,...state})=>state)(you.game):null;
    const teamLeaderboard=match.room.mode==='team-net'?this.teamStandings(match,players):undefined;
    const eventFields=match.room.featureVersion==='0.6'?{worldEvent:getWorldEventAt(match.room.seed,match.room.clockMinutes,duration(match.room),match.room.startTimeMinutes),worldEvents:getWorldEventViews(match.room.seed,match.room.clockMinutes,duration(match.room),match.room.startTimeMinutes)}:{};
    const review=match.room.featureVersion==='0.6'&&match.room.status==='finished'?{shiftDurationMinutes:duration(match.room),finalClockMinutes:match.room.clockMinutes,players:match.players.map(playerMatchReview),teams:teamLeaderboard}:undefined;
    return projectBlindSnapshot({protocolVersion:PROTOCOL_VERSION,revision:match.revision,serverTime:now,stateSampledAt:['running','finished'].includes(match.room.status)?match.lastTickAt:now,room:{...match.room,...eventFields,teamLeaderboard,players},you:{playerId:you?.id||'',lastInputSeq:you?.lastInputSeq||0,driverId:you?.driverId,driverStats:you?this.careerStats(you):undefined,nearbyDrivers:you?.nearbyDrivers,horn:you?.hornView},ownState,leaderboard,review});
  }
  private teamStandings(match:Match,players:RoomPlayer[]):TeamStanding[]{
    const standings=(['A','B']as const).map(teamId=>{const members=players.filter(player=>player.teamId===teamId);return{teamId,rank:null as number|null,netIncome:members.reduce((sum,player)=>sum+(player.netIncome||0),0),completedTrips:members.reduce((sum,player)=>sum+(player.completedTrips||0),0),playerIds:members.map(player=>player.id),forfeited:members.some(player=>!!player.forfeited),finished:members.length===2&&members.every(player=>player.status==='finished')};});
    standings.sort((a,b)=>Number(a.forfeited)-Number(b.forfeited)||b.netIncome-a.netIncome||a.teamId.localeCompare(b.teamId));
    let rank=0,previous:number|undefined;for(const [index,team]of standings.entries()){if(team.netIncome!==previous)rank=index+1;previous=team.netIncome;if(!['lobby','countdown'].includes(match.room.status)&&team.playerIds.length===2&&!team.forfeited&&(match.room.status!=='finished'||team.finished))team.rank=rank;}
    return standings;
  }
}
