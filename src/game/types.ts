import type {MapDemandRequest, MapDemandSnapshot} from './mapDemand';
import type {EliteReservation} from '../../shared/elite';
import type {ProTier} from '../../shared/pro';
import type {AirportQueueTicket} from '../../shared/airport';
export interface Coordinate { lat: number; lon: number }
export interface RoadNode extends Coordinate { id: string; name?: string }
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  shape?: Coordinate[];
  name?: string;
  roadClass?: string;
  speedKph?: number;
  safeStop?: boolean;
  elevation?: number;
}
export interface RoadGraph {
  nodes: Record<string, RoadNode>;
  edges: Record<string, RoadEdge>;
  outgoing: Record<string, string[]>;
}
export type PlaceKind = 'residential' | 'shopping' | 'business' | 'transport';
export interface Landmark extends Coordinate {
  id: string;
  name: string;
  district: string;
  kind: PlaceKind;
  nodeId?: string;
  nameEn?: string;
  sourceRecordId?: string;
  snapDistanceM?: number;
  waitingProfile?: 'ordinary' | 'saikung';
  demandWeight?: number;
}
export type ShiftType = 'day' | 'night';
export type ShiftDurationMinutes = 360 | 720 | 1440;
/** Seeded game event; times are relative shift clock minutes, never wall ms. */
export interface WorldEvent {
  id: string;
  title: string;
  titleEn: string;
  pickupPlaceId: string;
  center: Coordinate;
  radiusM: number;
  startsAt: number;
  endsAt: number;
  demandBoost: number;
}
export type DemandDensity = 'normal' | 'busy';
export type PricingType = 'taxi-metered' | 'taxi-discount85' | 'taxi-upfront' | 'private-upfront' | 'private-xl' | 'private-elite';
export type OrderServiceType = 'standard' | 'xl' | 'elite';
export type VehicleId = 'kam-fung' | 'little-treasure' | 'red-flag' | 'private'
  | 'tesla-model-3' | 'tesla-model-y' | 'tesla-model-s'
  | 'aion-y-plus-standard' | 'aion-y-plus-premium' | 'mg4-trophy'
  | 'alphard-hybrid' | 'vellfire-hybrid';
export interface Vehicle {
  id: VehicleId;
  name: string;
  subtitle: string;
  type: 'taxi' | 'private';
  totalSeats?: number;
  passengerCapacity?: number;
  accessProfile?: 'urban-taxi' | 'private';
  xlEligible?: boolean;
  nameEn?: string;
  modelVariant?: string;
  specificationSource?: string;
  gameAssumptions?: string;
  color: string;
  rentalCost: number;
  rentalDay: number;
  rentalNight: number;
  rentalSource: 'user-provided' | 'game-config';
  fuelCostPerKm: number;
  commissionRate: number;
  baseFare: number;
  farePerKm: number;
  farePerMinute: number;
  energyProfile?: EnergyProfile;
}
export type EnergyKind = 'lpg' | 'petrol' | 'swap' | 'charge';
export type ChargeConnector = 'type2' | 'ccs2' | 'chademo' | 'gbt-ac' | 'gbt-dc';
export interface ChargingOption {
  connector: ChargeConnector;
  powerKw: number;
  powerBasis: 'official' | 'game-reference';
  unitPrice?: number;
  priceBasis?: 'official-reference' | 'game-reference';
  priceNote?: string;
  operator?: string;
  vehicleRestriction?: 'tesla-only';
  count?: number;
}
export interface EnergyProfile {
  kind: EnergyKind;
  capacity: number;
  consumptionPerKm: number;
  unitPrice: number;
  initialFraction?: number;
  serviceMinutes?: number;
  calibrationNote?: string;
  chargingConnectors?: ChargeConnector[];
  maxChargePowerKw?: number;
  maxACChargePowerKw?: number;
}
export interface EnergyStation extends Coordinate {
  nameEn?: string;
  id: string;
  name: string;
  nodeId: string;
  kind: EnergyKind;
  district?: string;
  unitPrice?: number;
  serviceMinutes?: number;
  dedicated?: boolean;
  connectorTypes?: ChargeConnector[];
  chargingOptions?: ChargingOption[];
  chargePowerKw?: number;
}
export interface EnergyState {
  kind: EnergyKind;
  capacity: number;
  remaining: number;
  consumed: number;
  costAdded: number;
  unitPricePaid: number;
  unitPriceOverride?: number;
  lowWarningShown?: boolean;
  emptyWarningShown?: boolean;
  /** Initial supplied stock or already-billed purchased kWh; never bill these twice on consumption. */
  prepaidRemaining?: number;
}
export interface ChargingSession {
  stationId: string;
  startedAt: number;
  lastUpdatedAt: number;
  initialRemainingKWh: number;
  deliveredKWh: number;
  gridKWh: number;
  billedCost: number;
  unitPrice: number;
  targetKWh: number;
  powerKw: number;
  connector: ChargeConnector;
}
export interface ChargeReceipt {
  stationId: string;
  stationName: string;
  endedAt: number;
  deliveredKWh: number;
  gridKWh: number;
  billedCost: number;
  completed: boolean;
}
export interface EnergyRecovery {
  endsAt: number;
  previousPhase: GameState['phase'];
}
export interface PlatformStats {
  offered: number;
  accepted: number;
  cancelled: number;
  acceptanceRate: number;
  cancellationRate: number;
  suspendedUntil: number;
  penaltyLevel: number;
  reviewOffered: number;
  reviewAccepted: number;
  reviewCancelled: number;
}
export interface NavigationTask {
  kind: 'refuel' | 'swap' | 'charge' | 'handover' | 'safe-dropoff' | 'parking' | 'airport';
  target: EnergyStation | Landmark;
  stage: 'routing' | 'servicing';
  endsAt?: number;
  parkingKind?: 'temporary' | 'rest';
  /** Canonical directed station approach, shared by every queueing driver. */
  queueApproach?: string[];
  queueConnectorDistanceM?: number;
  queueConnectorMinutes?: number;
  handoverAfterService?: boolean;
  chargeTargetFraction?: number;
  joinAirportQueue?: boolean;
}
export interface FuelQueueAssignment {
  id: string;
  stationId: string;
  joinedAt: number;
  serviceStartsAt: number;
  serviceEndsAt: number;
  aheadCount: number;
}
export interface FuelQueueTicket extends FuelQueueAssignment {
  approachEdgeIds: string[];
  distanceToStationM: number;
  connectorDistanceM?: number;
  connectorMinutes?: number;
  metresPerWaitMinute?: number;
  assignmentPending?: boolean;
  backgroundAheadCount?: number;
  shared?: boolean;
}
export interface ParkingState {
  kind: 'temporary' | 'rest';
  startedAt: number;
  endsAt?: number;
}
export interface DrivingAssist {
  approachingJunctionNodeId?: string;
  approachDistanceM?: number;
  crossedJunctionNodeId?: string;
  crossedAtDistanceM?: number;
}
export interface SurgeArea {
  pickupDot?: Coordinate;
  radiusM?: number;
  intensity?: number;
  demandPerMinute?: number;
  availableDrivers?: number;
  sampledAtMinute?: number;
  id: string;
  name: string;
  center: Coordinate;
  multiplier: number;
  waitMinutesMin: number;
  waitMinutesMax: number;
  level?: 'quiet' | 'normal' | 'busy' | 'surge';
}
export interface Movement {
  edgeId: string;
  distanceOnEdgeM: number;
  nextEdgeIds: string[];
  recentEdgeIds?: string[];
  committedEdgeCount?: number;
}
export interface Offer {
  eliteBookingId?: string;
  /** Safe local final approach for a scheduled pickup; authoritative routing only. */
  eliteApproachEdgeId?: string;
  scheduledPickupMinute?: number;
  /** Omission is a legacy standard request; counts always exclude the driver. */
  serviceType?: OrderServiceType;
  passengerCount?: number;
  id: string;
  createdAt: number;
  requestedAt?: number;
  expiresAt: number;
  pickup: Landmark;
  destination: Landmark;
  pickupDistanceM: number;
  tripDistanceM: number;
  pickupMinutes: number;
  tripMinutes: number;
  estimatedFare: number;
  estimatedNet: number;
  surge: number;
  pickupRoute: string[];
  tripRoute: string[];
  pricingType: PricingType;
  pricingLabel: string;
  feedKind: 'live' | 'along-route' | 'counterfactual';
  routeEstimated?: boolean;
  demandLevel?: 'quiet' | 'normal' | 'busy' | 'surge';
  estimatedWaitMinutes?: number;
  surgeDescription?: string;
  reservation?: 'next-trip';
}
export interface ActiveTrip {
  offer: Offer;
  acceptedAt: number;
  pickedUpAt?: number;
  actualDistanceM: number;
  routePolicy: 'fastest' | 'economy';
  waitMinutes: number;
  boardingMinutes: number;
  phaseEndsAt?: number;
  arrivedAt?: number;
  fareOnCompletion: number;
  canonicalDistanceM: number;
  canonicalMinutes: number;
  paidDistanceM: number;
  cancellationRequestedAt?: number;
}
export interface GhostBranch {
  movement: Movement;
  startedAt: number;
  expiresAt: number;
  sourceOfferId: string;
  status: 'watching' | 'found' | 'complete' | 'no-offer';
  offer?: Offer;
  offers: Offer[];
}
export interface RouteEvent {
  kind?: 'roadworks' | 'traffic' | 'cattle' | 'dog' | 'pedestrian';
  speedFactor?: number;
  blockingStartsAt?: number;
  blockingUntil?: number;
  coordinate?: Coordinate;
  id: string;
  title: string;
  description: string;
  roadName: string;
  affectedEdgeId: string;
  startedAt: number;
  expiresAt: number;
  resolved: boolean;
  choice?: 'stay' | 'reroute';
  rerouteAvailable?: boolean;
}
export interface GameLog {
  id: string;
  minute: number;
  kind: 'offer' | 'accept' | 'decline' | 'pickup' | 'dropoff' | 'ghost' | 'observed' | 'cancel' | 'wait' | 'route' | 'event' | 'shift' | 'platform' | 'energy' | 'parking';
  text: string;
  amount?: number;
}
export interface GameSummary {
  shiftDurationMinutes?: ShiftDurationMinutes;
  idleMinutes?: number;
  grossIncome: number;
  expenses: number;
  netIncome: number;
  score: number;
  completedTrips: number;
  overtimeMinutes: number;
  totalDistanceKm: number;
  cancelledTrips: number;
  handoverStatus?: 'on-time' | 'missed';
  handoverFailureReason?: 'deadline' | 'fuel';
  shiftEndReason?: ShiftEndReason;
}
export type ShiftEndReason = 'handover' | 'deadline' | 'fuel-completed-late' | 'fuel-cancelled-late' | 'fuel-timeout';
export interface DeadlineSettlement {
  kind: 'fuel';
  startedAt: number;
  expiresAt: number;
  stationId: string;
  ticketId?: string;
}
export interface GameState {
  /** Frozen preflight choices. Absence preserves the rules of older saves. */
  orderPreferences?:import('../../shared/orderPolicy').OrderPreferences;
  blindOrders?:boolean;
  /** Qualified at shift start; a course passed mid-shift applies next shift. */
  eliteCertified?: boolean;
  advancedRulesVersion?:1;
  proDestination?: {placeId: string; expiresAt: number};
  proDestinationsUsed?: number;
  proPass?: import('../../shared/pro').ProPass;
  proTier?:ProTier;
  airportQueue?:AirportQueueTicket|null;
  airportOfferHistory?:string[];
  airportJoinCounter?:number;
  eliteReservations?: EliteReservation[];
  eliteReviewedWindows?: number[];
  eliteLastSearchMinute?: number;
  version: 3;
  seed: number;
  landmarks: Landmark[];
  vehicleId: VehicleId;
  /** Latched capability; absent old saves retain standard-only dispatch. */
  xlOrdersEnabled?: boolean;
  phase: 'cruising' | 'pickup' | 'waiting' | 'boarding' | 'dropoff' | 'alighting' | 'safe-dropoff' | 'service-route' | 'fuel-queue' | 'airport-queue' | 'servicing' | 'ended';
  shift: ShiftType;
  shiftDurationMinutes?: ShiftDurationMinutes;
  worldEvent?: WorldEvent;
  startTimeMinutes: number;
  startPlaceId?: string;
  startLabel?: string;
  driverSessionId?: string;
  platformHistory?: Pick<PlatformStats, 'offered' | 'accepted' | 'cancelled'>;
  rentalCostApplied: number;
  rentalOverride?: number;
  density: DemandDensity;
  demandSupply?: {position:Coordinate;availableDrivers:number}[];
  mapDemandRequests?: MapDemandRequest[];
  mapDemandDisplay?: MapDemandSnapshot;
  offerResponseWindowMinutes?: number;
  acceptingOrders: boolean;
  autoAcceptOrders?: boolean;
  parking: ParkingState | null;
  drivingAssist?: DrivingAssist;
  cruiseTarget?: Landmark;
  navigation: NavigationTask | null;
  fuelQueue?: FuelQueueTicket | null;
  fuelQueueMode?: 'solo' | 'shared' | 'legacy';
  nextTripEnabled?: boolean;
  dispatchManaged?: boolean;
  fuelQueueOwnerId?: string;
  energy: EnergyState;
  chargingSession?: ChargingSession | null;
  lastChargeReceipt?: ChargeReceipt | null;
  energyRecovery: EnergyRecovery | null;
  platform: PlatformStats;
  demandCooldownUntil: number;
  handoverPlace: Landmark | null;
  handoverReminderShown: boolean;
  handoverStatus?: 'pending' | 'on-time' | 'missed';
  handoverFailureReason?: 'deadline' | 'fuel';
  handoverReturnWarningShown?: boolean;
  /** Explicit cancellation survives ticks and restore; reminders never force navigation. */
  handoverIntent?: 'none' | 'requested' | 'cancelled';
  nextHandoverReviewMinute?: number;
  /** Only the fuel queue/service already in progress at the deadline may finish. */
  deadlineSettlement?: DeadlineSettlement;
  shiftEndReason?: ShiftEndReason;
  clockMinutes: number;
  /** Empty cruising/parking time, excluding accepted pickups and operations. */
  idleMinutes?: number;
  movement: Movement;
  currentOffer: Offer | null;
  activeTrip: ActiveTrip | null;
  queuedTrip?: ActiveTrip | null;
  nextTripOfferForTripId?: string;
  nextTripOfferCooldownUntil?: number;
  ghost: GhostBranch | null;
  ghostOffer: Offer | null;
  ghostOffers: Offer[];
  observedOffers: Offer[];
  routeEvent: RouteEvent | null;
  grossIncome: number;
  operatingCost: number;
  netIncome: number;
  wallet: number;
  completedTrips: number;
  /** All displayed offers, including withdrawn cards; monotone for lifetime ledgers. */
  presentedOffers?: number;
  acceptedOffers: number;
  declinedOffers: number;
  cancelledTrips: number;
  totalDistanceM: number;
  nextDemandMinute: number;
  demandIndex: number;
  nextEventMinute: number;
  eventIndex: number;
  logs: GameLog[];
  summary: GameSummary | null;
}
export interface UpcomingBranch {
  junctionNodeId: string;
  distanceM: number;
  coordinate: Coordinate;
  selectedEdgeId: string;
  options: Array<{ edgeId: string; name: string; coordinate: Coordinate; selected: boolean }>;
}
export interface LookaheadSegment {
  edgeId: string;
  name: string;
  coordinates: Coordinate[];
  distanceFromCarM: number;
  lengthM: number;
  opacity: number;
}
export interface InitialGameOptions {
  orderPreferences?:import('../../shared/orderPolicy').OrderPreferences;
  blindOrders?:boolean;
  advancedRulesVersion?:1;
  proPass?: import('../../shared/pro').ProPass;
  proTier?:ProTier;
  eliteCertified?: boolean;
  xlOrdersEnabled?: boolean;
  seed?: number;
  vehicleId?: VehicleId;
  graph?: RoadGraph;
  startNodeId?: string;
  landmarks?: Landmark[];
  startPlaceId?: string;
  startPlace?: Landmark;
  shift?: ShiftType;
  shiftDurationMinutes?: ShiftDurationMinutes;
  worldEvent?: WorldEvent;
  startTimeMinutes?: number;
  rentalOverride?: number;
  density?: DemandDensity;
  handoverPlace?: Landmark | null;
  initialEnergyFraction?: number;
  energyUnitPriceOverride?: number;
  offerResponseWindowMinutes?: number;
  driverSessionId?: string;
  platformHistory?: Pick<PlatformStats, 'offered' | 'accepted' | 'cancelled'>;
  fuelQueueMode?: 'solo' | 'shared' | 'legacy';
  nextTripEnabled?: boolean;
  dispatchManaged?: boolean;
  fuelQueueOwnerId?: string;
  autoAcceptOrders?: boolean;
}
export type CreateGameOptions = InitialGameOptions;
