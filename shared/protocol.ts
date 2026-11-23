import type { Coordinate, DemandDensity, GameState, PricingType, ShiftType, VehicleId, WorldEvent } from '../src/game/types';
import type {HornView} from './horns';
import type {AirportRoomView} from './airport';

export const PROTOCOL_VERSION = 2 as const;
export const MULTIPLAYER_LIMITS = {
  minPlayers: 2, maxPlayers: 8, nicknameCharacters: 20, roomCodeCharacters: 6,
  countdownMilliseconds: 3000, disconnectAfterMilliseconds: 15000,
  mapLoadingTimeoutMilliseconds: 60_000,
  disconnectGraceMilliseconds: 120000, lobbyTtlMilliseconds: 30 * 60_000,
  runningTtlMilliseconds: 4 * 60 * 60_000, finishedTtlMilliseconds: 24 * 60 * 60_000,
  shiftMinutes: 720, maximumOvertimeMinutes: 240,
} as const;
export type CompetitionMode = 'highest-net' | 'lowest-net' | 'team-net';
export type RoomFeatureVersion = '0.4' | '0.5' | '0.6';
export type TeamId = 'A' | 'B';
export interface TeamStanding {
  teamId: TeamId;
  rank: number | null;
  netIncome: number;
  completedTrips: number;
  playerIds: string[];
  forfeited: boolean;
  finished: boolean;
}
export type RoomWorldEvent = WorldEvent & { status: 'forecast' | 'active' };
export interface RoomMapLoading {
  epoch: string;
  deadlineAt: number;
  /** Authenticated acknowledgements for this loading epoch, never lobby ready. */
  readyPlayerIds: string[];
}
export type RoomStatus = 'lobby' | 'countdown' | 'running' | 'finished';
export type RoomPlayerStatus = 'lobby' | 'driving' | 'finished' | 'disconnected' | 'left';
export const ROOM_SPEEDS = [1, 10, 30, 60] as const;
export type RoomSpeed = (typeof ROOM_SPEEDS)[number];
export function isRoomSpeed(value: unknown): value is RoomSpeed {
  return ROOM_SPEEDS.some(speed => speed === value);
}
export interface DriverCounters {offered:number;accepted:number;cancelled:number;completedTrips:number}
export interface DriverStats extends DriverCounters {acceptanceRate:number;cancellationRate:number;updatedAt:number;reviewBaseline?:import('./training').ReviewBaseline}
export interface DriverCredential {driverId:string;driverToken:string}
export interface DriverSession extends DriverCredential {stats:DriverStats;eliteCertification?:import('./elite').EliteCertification}
export interface DriverProfile {driverId:string;stats:DriverStats;eliteCertification?:import('./elite').EliteCertification}
export interface OrderVisibility { blindOrders: true }
export interface FareReveal { id:string;minute:number;amount:number;destinationName:string }
export interface SharedDispatchAssignment {serviceType?:'standard'|'xl'|'elite';passengerCount?:number;offerId:string;pickupName:string;pickupNameEn?:string;destinationName:string;destinationNameEn?:string;playerId:string;nickname:string;assignedAt:number;expiresAt:number;status:'offered'|'accepted'|'expired';reservation?:'next-trip';competitors:number;estimatedFare?:number;pricingType?:PricingType;pickupLocality?:string;pickupLocalityEn?:string;destinationLocality?:string;destinationLocalityEn?:string;acceptedAt?:number}
export interface RoomRules {
  /** Host-selectable only in an order-policy lobby, then frozen for the shift. */
  blindOrders?:boolean;
  mode: CompetitionMode;
  shift: ShiftType;
  speed: RoomSpeed;
  density: DemandDensity;
  startTimeMinutes?: number;
  shiftDurationMinutes?: 360 | 720 | 1440;
}
/** Node IDs are validated against the selected vehicle's legal road graph. */
export interface PlayerSetup {
  orderPreferences?:import('./orderPolicy').OrderPreferences;
  vehicleId: VehicleId;
  /** Public game cost preferences. Omission uses the selected vehicle/shift default. */
  rentalOverride?: number;
  energyUnitPriceOverride?: number;
  autoAcceptOrders?: boolean;
  startPlaceId?: string;
  startNodeId?: string;
  handoverPlaceId?: string;
  handoverNodeId?: string;
}
export interface RoomPlayer extends PlayerSetup {
  teamId?: TeamId;
  late?: boolean;
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  status: RoomPlayerStatus;
  joinedAt: number;
  disconnectedAt?: number;
  finishedAt?: number;
  forfeited?: boolean;
  forfeitReason?: string;
  phase?: GameState['phase'];
  position?: Coordinate & { heading: number };
  /** Authoritative upcoming connected route, clipped to 1km and at most 100 points. */
  route?: Coordinate[];
  order?: { serviceType?:'standard'|'xl'|'elite';passengerCount?:number;pickupName: string; destinationName: string; pickupNameEn?:string; destinationNameEn?:string; phase: GameState['phase'] };
  netIncome?: number;
  score?: number;
  completedTrips?: number;
  clockMinutes?: number;
}
export interface Room extends RoomRules {
  orderPolicyVersion?:1;
  /** Immutable opt-in for Pro, airport queues and certified scheduled bookings. */
  advancedRulesVersion?: 1;
  /** Immutable opt-in; old rooms keep four legacy vehicles and standard orders. */
  vehicleCatalogVersion?: 1;
  /** Server-derived from the legacy operator default or host preflight; never a raw client projection. */
  orderVisibility?: OrderVisibility;
  featureVersion?:RoomFeatureVersion;
  startTimeMinutes: number;
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  seed: number;
  clockMinutes: number;
  players: RoomPlayer[];
  createdAt: number;
  startsAt?: number;
  /** 0.6 only: countdown with no startsAt waits for every current map renderer. */
  loading?: RoomMapLoading;
  finishedAt?: number;
  expiresAt: number;
  finishReason?: string;
  competition?:{availableDrivers:number;assignments:SharedDispatchAssignment[]};
  teamLeaderboard?: TeamStanding[];
  worldEvent?: WorldEvent;
  worldEvents?: RoomWorldEvent[];
  airport?:AirportRoomView;
}
export interface RankedPlayer {
  late?: boolean;
  playerId: string;
  nickname: string;
  rank: number | null;
  netIncome: number;
  score: number;
  completedTrips: number;
  finished: boolean;
  forfeited: boolean;
  connected: boolean;
}
export type WireGameState = Omit<GameState, 'landmarks'>;
export type ReviewEventType = PlayerGameAction['type'] | 'trip-completed' | 'queue-joined' | 'service-started' | 'shift-ended';
export interface ReviewTimelineEvent { minute: number; type: ReviewEventType; label?: string; amount?: number }
export interface PlayerMatchReview {
  playerId: string; nickname: string; teamId?: TeamId;
  netIncome: number; grossIncome: number; operatingCost: number; rentalCost: number;
  idleMinutes: number; completedTrips: number; acceptedOffers: number; declinedOffers: number; cancelledTrips: number;
  totalDistanceM: number; forfeited: boolean;
  route: Array<Coordinate & { minute: number }>;
  timeline: ReviewTimelineEvent[];
  timelineTruncated: boolean;
}
/** Only published after the room finishes. No credentials or full game states. */
export interface MatchReview { shiftDurationMinutes: 360 | 720 | 1440; finalClockMinutes: number; players: PlayerMatchReview[]; teams?: TeamStanding[] }
export interface RoomSnapshot {
  orderVisibility?: OrderVisibility;
  fareReveals?: FareReveal[];
  protocolVersion: typeof PROTOCOL_VERSION;
  revision: number;
  serverTime: number;
  /** Wall time represented by this committed state; serverTime is response time. */
  stateSampledAt?: number;
  room: Room;
  you: { playerId: string; lastInputSeq: number;driverId?:string;driverStats?:DriverStats;nearbyDrivers?:number;horn?:HornView };
  ownState: WireGameState | null;
  leaderboard: RankedPlayer[];
  review?: MatchReview;
}
export interface RoomSession {
  roomCode: string;
  playerId: string;
  /** Opaque bearer credential. Persist privately; never put in a URL or room roster. */
  resumeToken: string;
  snapshot: RoomSnapshot;
}
export interface CreateRoomRequest {
  orderPolicyVersion?:1;
  advancedRulesVersion?: 1;
  vehicleCatalogVersion?: 1;
  /** Supported redacted view schema, not a request to enable blind orders. */
  blindOrdersVersion?: 1;
  nickname: string;
  setup?: PlayerSetup;
  rules?: Partial<RoomRules>;
  driverCredential?:DriverCredential;
  featureVersion?:RoomFeatureVersion;
}
export interface JoinRoomRequest { orderPolicyVersion?:1; advancedRulesVersion?:1; vehicleCatalogVersion?:1; nickname: string; setup?: PlayerSetup;driverCredential?:DriverCredential;featureVersion?:RoomFeatureVersion;blindOrdersVersion?:1 }
export type PlayerGameAction =
  | { type:'pro-destination';placeId?:string }
  | { type:'airport';choice:'go'|'join'|'leave' }
  | { type: 'elite-booking'; bookingId: string; choice: import('./elite').EliteBookingChoice }
  | { type: 'accept'; offerId: string }
  | { type: 'decline'; offerId: string }
  | { type: 'cancel'; tripId: string }
  | { type: 'cancel-queued';tripId:string }
  | { type: 'branch'; junctionNodeId: string; edgeId: string }
  | { type: 'cruise-to'; nodeId: string }
  | { type: 'route'; policy: 'fastest' | 'economy' }
  | { type: 'event'; choice: 'stay' | 'reroute' }
  | { type: 'accepting'; value: boolean }
  | { type: 'auto-accept'; value: boolean }
  | { type: 'park' }
  | { type: 'rest' }
  | { type: 'drive' }
  | { type: 'service' }
  | { type: 'cancel-charge' }
  | { type: 'station'; stationId: string }
  | { type: 'handover' }
  | { type: 'cancel-handover' }
  | { type: 'recover-energy' };
export type RoomAction = PlayerGameAction
  | { type: 'profile'; nickname: string }
  | { type: 'setup'; setup: PlayerSetup }
  | { type: 'ready'; ready: boolean }
  | { type: 'rules'; rules: Partial<RoomRules> }
  | { type: 'team'; teamId: TeamId }
  | { type: 'map-ready'; epoch: string; ready: boolean }
  | { type: 'start' }
  | { type: 'leave' };
export interface ActionEnvelope { seq: number; action: RoomAction }
export interface ProtocolError { code: string; message: string; retryAfterMilliseconds?: number }
export interface ErrorResponse { error: ProtocolError }

/** Optional realtime adapter; the HTTP transport uses the same action/snapshot shapes. */
export type ClientMessage =
  | { type: 'authenticate'; resumeToken: string }
  | { type: 'action'; seq: number; action: RoomAction }
  | { type: 'heartbeat' };
export type ServerMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'error'; error: ProtocolError }
  | { type: 'closed'; reason: string };

export const MULTIPLAYER_API = {
  health: '/health', create: '/v1/rooms',
  createDriver:'/v1/drivers',driverMe:'/v1/drivers/me',
  room: (code: string) => `/v1/rooms/${encodeURIComponent(code)}`,
  join: (code: string) => `/v1/rooms/${encodeURIComponent(code)}/join`,
  actions: (code: string) => `/v1/rooms/${encodeURIComponent(code)}/actions`,
  horn: (code:string)=>`/v1/rooms/${encodeURIComponent(code)}/horn`,
  heartbeat: (code: string) => `/v1/rooms/${encodeURIComponent(code)}/heartbeat`,
} as const;
