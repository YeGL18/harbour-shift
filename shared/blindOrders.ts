import type { ActiveTrip, GameState, Landmark, Offer } from '../src/game/types';
import type { FareReveal, RoomSnapshot, WireGameState } from './protocol';

/** Legacy operator default. New policy rooms derive visibility from frozen preflight choices. */
export const operatorBlindOrders = (value: unknown): boolean => value === '1' || value === true;
export function isBlindBoarded(state: Pick<GameState, 'activeTrip'>): boolean {
  return typeof state.activeTrip?.pickedUpAt === 'number';
}
/** Known pickup coordinates keep older map/route selectors safe, without sending
 * any part of the real hidden POI (including its node ID or district). */
function withheldDestination(pickup: Landmark): Landmark {
  return { id:'withheld-destination', name:'上車後顯示目的地', nameEn:'Destination shown after boarding', district:'', kind:'transport', lat:pickup.lat, lon:pickup.lon, nodeId:pickup.nodeId };
}
export function projectBlindOffer(offer: Offer, destinationVisible = false): Offer {
  return {...offer, destination:destinationVisible?offer.destination:withheldDestination(offer.pickup), estimatedFare:0, estimatedNet:0, surge:1,
    ...(destinationVisible?{}:{tripDistanceM:0, tripMinutes:0, tripRoute:[]}), surgeDescription:undefined};
}
function projectTrip(trip: ActiveTrip, destinationVisible: boolean): ActiveTrip {
  return {...trip, offer:projectBlindOffer(trip.offer,destinationVisible), fareOnCompletion:0,
    ...(destinationVisible?{}:{canonicalDistanceM:0,canonicalMinutes:0})};
}
/** Completion logs are canonical engine records. A retry or cancelled trip
 * cannot invent a reveal; zero fares are valid completed results. */
export function completedFareReveals(state: Pick<GameState,'logs'>): FareReveal[] {
  return state.logs.filter(log=>log.kind==='dropoff' && typeof log.amount==='number' && Number.isFinite(log.amount))
    .slice(0,8).map(log=>({id:log.id,minute:log.minute,amount:log.amount!,destinationName:log.text.replace(/ · 完成行程$/, '')}));
}
/** Read-only client projection. Keep authoritative simulation, persistence and
 * economic totals intact; only completed income contributes to those totals. */
export function projectBlindGameState<T extends GameState | WireGameState>(state:T, enabled:boolean):T {
  if(!enabled)return state;
  const active=state.activeTrip, boarded=isBlindBoarded(state);
  return {...state,
    currentOffer:state.currentOffer?projectBlindOffer(state.currentOffer):null,
    activeTrip:active?projectTrip(active,boarded):null,
    queuedTrip:state.queuedTrip?projectTrip(state.queuedTrip,false):state.queuedTrip,
    eliteReservations:state.eliteReservations?.map(booking=>({...booking,offer:booking.status==='completed'?booking.offer:projectBlindOffer(booking.offer,!!boarded&&active?.offer.eliteBookingId===booking.id)})),
    // Early scheduled arrivals already hold their future passenger path. Do
    // not leak that path through the movement queue before actual boarding.
    movement:!boarded&&active&&['waiting','boarding'].includes(state.phase)?{...state.movement,nextEdgeIds:[]}:state.movement,
    observedOffers:state.observedOffers.map(offer=>projectBlindOffer(offer)),
    ghostOffer:state.ghostOffer?projectBlindOffer(state.ghostOffer):null,
    ghostOffers:state.ghostOffers.map(offer=>projectBlindOffer(offer)), ghost:null,
    // Canonical navigation during pickup ends at the known pickup. Any future
    // passenger edge list belongs solely to the blinded offer/trip above.
    logs:state.logs.filter(log=>!['offer','accept','decline','observed','ghost','route'].includes(log.kind)),
  };
}
/** Also applied to the cached D1 fast path: private full blobs never go to a
 * client directly, and old public caches cannot bypass a room's policy. */
export function projectBlindSnapshot(snapshot:RoomSnapshot):RoomSnapshot {
  if(!snapshot.room.orderVisibility?.blindOrders)return snapshot;
  const ownState=snapshot.ownState;
  return {...snapshot,orderVisibility:{blindOrders:true},fareReveals:ownState?completedFareReveals(ownState):[],
    ownState:ownState?projectBlindGameState(ownState,true):null,
    room:{...snapshot.room,players:snapshot.room.players.map(player=>({...player,
      route:['dropoff','alighting'].includes(player.phase||'')?player.route:undefined,
      order:player.order?(['dropoff','alighting'].includes(player.order.phase)?player.order:{...player.order,destinationName:'上車後顯示目的地',destinationNameEn:'Destination shown after boarding'}):undefined,
    })),competition:snapshot.room.competition?{...snapshot.room.competition,assignments:snapshot.room.competition.assignments.map(assignment=>({...assignment,destinationName:'上車後顯示目的地',destinationNameEn:'Destination shown after boarding',destinationLocality:undefined,destinationLocalityEn:undefined,estimatedFare:undefined}))}:undefined},
    review:snapshot.review?{...snapshot.review,players:snapshot.review.players.map(player=>({...player,timeline:player.timeline.map(event=>event.type==='trip-completed'?event:{...event,label:undefined,amount:undefined})}))}:undefined,
  };
}
