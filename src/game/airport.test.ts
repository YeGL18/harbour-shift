import assert from 'node:assert/strict';
import test from 'node:test';
import {HKG_AIRPORT} from '../../shared/airport';
import {LANDMARK_BY_ID} from '../data/landmarks';
import {getVehicleGraph} from './access';
import {acceptOffer,advanceGame,applyAirportAction,createInitialState,getVehiclePosition,normalizeGameState,setAcceptingOrders} from './engine';
import {airportJourney,airportPlaces,airportWorldOffers,insideAirportDemand} from './airport';
import {isSafeStoppingEdge} from './systems';
const waiting=LANDMARK_BY_ID.get(HKG_AIRPORT.waitingPlaceId)!;
const fresh=()=>createInitialState({advancedRulesVersion:1,seed:1,vehicleId:'private',startPlace:waiting,handoverPlace:null,dispatchManaged:true,offerResponseWindowMinutes:5});

test('named HKG proxies are real accessible local-road points, separated from the game demand outline',()=>{
 const state=fresh(),graph=getVehicleGraph(state.vehicleId),places=airportPlaces(state,graph)!;
 assert.equal(places.waiting.id,'building-1910240212');assert.equal(places.pickup.id,'building-1103043661');assert.ok(graph.nodes[places.waiting.nodeId!]);assert.ok(insideAirportDemand(places.waiting));assert.ok(!insideAirportDemand({lat:22.28,lon:113.94}));
 assert.equal(places.waiting.name,waiting.name);assert.notEqual(places.waiting.nodeId,places.pickup.nodeId);
 const incoming=Object.values(graph.edges).filter(edge=>edge.to===places.waiting.nodeId);assert.ok(incoming.length);assert.ok(incoming.every(isSafeStoppingEdge),'Every real incoming approach ends on an ordinary stopping proxy, never a motorway or tunnel');
});
test('go/join physically follows a legal directed route and never issues an airport ticket remotely',()=>{
 const initial=createInitialState({advancedRulesVersion:1,seed:1,vehicleId:'private',startPlace:LANDMARK_BY_ID.get('harbour-city')!,handoverPlace:null,dispatchManaged:true});
 const graph=getVehicleGraph(initial.vehicleId),preview=airportJourney(initial,graph)!;assert.ok(preview.distanceM>20000);assert.ok(preview.route.length);const position=getVehiclePosition(initial,graph);assert.deepEqual(preview.coordinates[0],{lat:position.lat,lon:position.lon});
 let state=applyAirportAction(initial,'join',graph);assert.deepEqual(getVehiclePosition(state,graph),getVehiclePosition(initial,graph));assert.equal(state.airportQueue,null);assert.equal(state.navigation?.kind,'airport');
 state=advanceGame(state,1,graph);assert.equal(state.airportQueue,null);
 for(let i=0;i<120&&state.phase!=='airport-queue';i++)state=advanceGame(state,2,graph);
 assert.equal(state.phase,'airport-queue');assert.ok(state.airportQueue!.joinedAt>0);assert.ok(state.totalDistanceM>20000);assert.equal(state.navigation,null);
});
test('virtual waiting advances game/idle time without moving, and explicit leave/rejoin gets a new ticket',()=>{
 const initial=fresh(),queued=applyAirportAction(initial,'join');assert.equal(queued.phase,'airport-queue');const held=advanceGame(queued,1);
 assert.deepEqual(getVehiclePosition(held),getVehiclePosition(queued));assert.equal(held.clockMinutes,1);assert.equal(held.idleMinutes,1);
 const left=applyAirportAction(held,'leave');assert.equal(left.phase,'cruising');assert.equal(left.airportQueue,null);assert.equal(left.acceptingOrders,true);
 const rejoined=applyAirportAction(left,'join');assert.notEqual(rejoined.airportQueue!.id,queued.airportQueue!.id);assert.ok(rejoined.airportQueue!.sequence!>queued.airportQueue!.sequence!);
});
test('legacy saves and occupied/resting/offline-dispatch states cannot silently join',()=>{
 const old={...fresh(),advancedRulesVersion:undefined};assert.equal(applyAirportAction(old,'join'),old);
 const stopped=setAcceptingOrders(fresh(),false),arrival=applyAirportAction(stopped,'join');assert.equal(arrival.airportQueue,null);assert.ok(arrival.parking);assert.equal(arrival.acceptingOrders,false);
 const resting={...fresh(),parking:{kind:'rest' as const,startedAt:0}};assert.equal(applyAirportAction(resting,'join'),resting);
 const queued=applyAirportAction(fresh(),'join'),leaving=advanceGame(setAcceptingOrders(queued,false),.01);assert.equal(leaving.airportQueue,null);assert.equal(leaving.acceptingOrders,false);
});
test('solo airport passengers quote normal fares once and keep the original five-second offer lease',()=>{
 let state=applyAirportAction({...fresh(),dispatchManaged:false},'join');
 for(let i=0;i<120&&!state.currentOffer;i++)state=advanceGame(state,.25);
 assert.ok(state.currentOffer?.id.startsWith('airport-'));assert.equal(state.currentOffer!.pickup.id,HKG_AIRPORT.pickupPlaceId);assert.ok(state.currentOffer!.estimatedFare>0);assert.equal(state.currentOffer!.expiresAt-state.currentOffer!.createdAt,5);assert.equal(state.grossIncome,0);assert.equal(state.presentedOffers,1);assert.equal(state.airportQueue,null);
 const before=getVehiclePosition(state),accepted=acceptOffer(state);assert.deepEqual(getVehiclePosition(accepted),before);assert.equal(accepted.acceptedOffers,1);assert.equal(accepted.grossIncome,0);
 const finished=advanceGame(setAcceptingOrders(accepted,false),100);assert.equal(finished.completedTrips,1);assert.ok(finished.grossIncome>0);assert.equal(finished.acceptedOffers,1);
});
test('cold restore retains queue identity and history; deadline clears it without a paid-trip bonus',()=>{
 const queued=applyAirportAction(fresh(),'join'),restored=normalizeGameState(JSON.parse(JSON.stringify(queued)))!;assert.deepEqual(restored.airportQueue,queued.airportQueue);
 const nearEnd={...queued,shiftDurationMinutes:360 as const,clockMinutes:359.9,nextDemandMinute:360};const ended=advanceGame(nearEnd,.2);assert.equal(ended.phase,'ended');assert.equal(ended.airportQueue,null);assert.equal(ended.grossIncome,0);
 const old=normalizeGameState({...queued,advancedRulesVersion:undefined})!;assert.equal(old.airportQueue,null);assert.notEqual(old.phase,'airport-queue');
});
