import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, advanceGame, applyEliteBookingAction, canAcceptEliteReservation, cancelTrip, normalizeGameState, canCompleteOfferBeforeHandover, setDispatchOffer } from './engine';
import { eliteWindow, createEliteReservation, eliteEnabled, eliteAllowsOrdinaryOffer, withdrawClaimedEliteReservations, routeToElitePickup } from './elite';
import { certifySoloElite, ELITE_COURSE_VERSION, ELITE_QUESTIONS, gradeEliteAnswers } from '../../shared/eliteCourse';
import { projectBlindGameState } from '../../shared/blindOrders';
import type { GameState, Landmark, RoadGraph } from './types';
const graph: RoadGraph = { nodes: { a: { id: 'a', lat: 22.30, lon: 114.16 }, b: { id: 'b', lat: 22.301, lon: 114.16 }, c: { id: 'c', lat: 22.302, lon: 114.16 } }, edges: { ab: { id: 'ab', from: 'a', to: 'b', lengthM: 100, speedKph: 20, name: '本地街', safeStop: true }, bc: { id: 'bc', from: 'b', to: 'c', lengthM: 100, speedKph: 20, name: '本地街', safeStop: true }, ca: { id: 'ca', from: 'c', to: 'a', lengthM: 100, speedKph: 20, name: '本地街', safeStop: true } }, outgoing: { a: ['ab'], b: ['bc'], c: ['ca'] } };
const landmarks: Landmark[] = ['harbour-city', 'elements', 'megabox'].map((id, i) => ({ ...graph.nodes[['a', 'b', 'c'][i]], id, nodeId: ['a', 'b', 'c'][i], name: ['海港城', '圓方', 'MegaBox'][i], nameEn: ['Harbour City', 'Elements', 'MegaBox'][i], district: '油尖旺區', kind: 'shopping' }));
const seed = Array.from({ length: 100 }, (_, i) => i).find(value => !!eliteWindow(value, 0))!;
function fresh(): GameState { return createInitialState({ seed, vehicleId: 'alphard-hybrid', advancedRulesVersion: 1, eliteCertified: true, shiftDurationMinutes: 360, graph, landmarks, handoverPlace: null, dispatchManaged: true }); }
function proposal(): GameState { const initial = fresh(), spec = eliteWindow(seed, 0)!; return advanceGame({ ...initial, clockMinutes: spec.announcedAt, nextDemandMinute: spec.announcedAt + .25, nextEventMinute: 1e5 }, .001, graph); }
const id = (state: GameState) => state.eliteReservations![0].id;
test('exclusive shifts match an opening reservation on a quiet seed and resume after going available', () => {
    const quietSeed = Array.from({ length: 100 }, (_, value) => value).find(value => !eliteWindow(value, 0))!;
    const game = createInitialState({
        seed: quietSeed, vehicleId: 'alphard-hybrid', advancedRulesVersion: 1, eliteCertified: true,
        orderPreferences: { enabledPricingTypes: ['private-elite'] }, handoverPlace: null,
        shiftDurationMinutes: 360, graph, landmarks, density: 'busy',
    });
    assert.equal(advanceGame(game, 2.99, graph).eliteReservations?.length, 0);
    const reserved = advanceGame(game, 3.01, graph);
    assert.equal(reserved.currentOffer, null);
    assert.equal(reserved.eliteReservations?.length, 1);
    assert.equal(reserved.eliteReservations?.[0].announcedAt, 3);
    assert.equal(reserved.eliteReservations?.[0].pickupAt, 68);
    assert.equal(canAcceptEliteReservation(reserved, id(reserved), graph), true);
    const resumed = normalizeGameState(JSON.parse(JSON.stringify(reserved)), graph)!;
    assert.equal(advanceGame(resumed, 1, graph).eliteReservations?.length, 1);

    const off = advanceGame({ ...game, acceptingOrders: false }, 8, graph);
    assert.equal(off.eliteReservations?.length, 0);
    assert.ok(!off.eliteReviewedWindows?.includes(0));
    const backOnline = advanceGame({ ...off, acceptingOrders: true }, 1, graph);
    assert.equal(canAcceptEliteReservation(backOnline, id(backOnline), graph), true);
    const committed = applyEliteBookingAction(backOnline, id(backOnline), 'accept', graph);
    assert.equal(committed.eliteReservations?.[0].status, 'accepted');
    const departed = applyEliteBookingAction(committed, id(committed), 'depart', graph);
    const finished = advanceGame(departed, 70, graph);
    assert.equal(finished.eliteReservations?.[0].status, 'completed');
    assert.equal(finished.completedTrips, 1);
    assert.equal(finished.grossIncome, backOnline.eliteReservations?.[0].offer.estimatedFare);
});
test('course is original, independently graded, requires 8/10, and rejects forged versions/answers', () => { const answers = ELITE_QUESTIONS.map(item => item.correct); assert.equal(gradeEliteAnswers(ELITE_COURSE_VERSION, answers).score, 10); assert.equal(gradeEliteAnswers(ELITE_COURSE_VERSION, answers.map((v, i) => i < 3 ? (v + 1) % 3 : v)).passed, false); assert.throws(() => certifySoloElite({ assessmentId: 'a', courseVersion: 'fake', answers })); assert.throws(() => gradeEliteAnswers(ELITE_COURSE_VERSION, [...answers.slice(1), 3])); assert.equal(certifySoloElite({ assessmentId: 'solo:abc', courseVersion: ELITE_COURSE_VERSION, answers }, 123).certifiedAt, 123); });
test('qualification requires advanced opt-in and an eligible MPV; rare draw cannot reroll on repeated ticks or restore', () => { const base = fresh(); assert.equal(eliteEnabled({ ...base, advancedRulesVersion: undefined }), false); assert.equal(eliteEnabled({ ...base, eliteCertified: false }), false); assert.equal(eliteEnabled({ ...base, vehicleId: 'tesla-model-y' }), false); const state = proposal(); assert.equal(state.eliteReservations!.length, 1); assert.equal(state.presentedOffers, 1); const again = advanceGame(state, .1, graph); assert.equal(again.eliteReservations!.length, 1); assert.equal(again.presentedOffers, 1); const restored = normalizeGameState(JSON.parse(JSON.stringify(again)), graph)!; assert.deepEqual(restored.eliteReservations, state.eliteReservations); assert.equal(advanceGame(restored, .1, graph).eliteReservations!.length, 1); const quietSeed = Array.from({ length: 100 }, (_, i) => i).find(value => !eliteWindow(value, 0))!; assert.equal(createEliteReservation({ ...base, seed: quietSeed }, 0, graph), null); });
test('manual commitment preserves fixed fare, counts once, and autoaccept never commits a scheduled contract', () => { const state = { ...proposal(), autoAcceptOrders: true }; assert.equal(state.acceptedOffers, 0); const booking = state.eliteReservations![0]; assert.ok(booking.offer.estimatedFare >= 200); assert.equal(booking.offer.serviceType, 'elite'); assert.equal(setDispatchOffer(state, booking.offer, graph), state); assert.equal(canAcceptEliteReservation(state, booking.id, graph), true); const accepted = applyEliteBookingAction(state, booking.id, 'accept', graph); assert.equal(accepted.acceptedOffers, 1); assert.equal(accepted.activeTrip, null); assert.equal(applyEliteBookingAction(accepted, booking.id, 'accept', graph), accepted); assert.equal(accepted.eliteReservations![0].offer.estimatedFare, booking.offer.estimatedFare); assert.equal(state.eliteReservations![0].status, 'available'); assert.equal(canAcceptEliteReservation({ ...state, platform: { ...state.platform, suspendedUntil: 999 } }, booking.id, graph), false); });
test('safe local final approach is connected; early arrival stops until the appointment, then boards and pays once', () => { let state = proposal(); state = applyEliteBookingAction(state, id(state), 'accept', graph); const booking = state.eliteReservations![0], price = booking.offer.estimatedFare, approach = routeToElitePickup(state, booking, graph)!; assert.ok(approach.route.length); assert.equal(approach.route.at(-1), booking.offer.eliteApproachEdgeId); state = applyEliteBookingAction(state, booking.id, 'depart', graph); state = advanceGame(state, 5, graph); assert.equal(state.phase, 'waiting'); assert.equal(state.grossIncome, 0); assert.equal(state.eliteReservations![0].status, 'waiting'); const distance = state.totalDistanceM; state = advanceGame(state, booking.pickupAt - state.clockMinutes - .01, graph); assert.equal(state.phase, 'waiting'); assert.equal(state.totalDistanceM, distance); assert.equal(state.grossIncome, 0); const restored = normalizeGameState(JSON.parse(JSON.stringify(state)), graph)!; state = advanceGame(restored, 10, graph); assert.equal(state.completedTrips, 1); assert.equal(state.grossIncome, price); assert.equal(state.acceptedOffers, 1); assert.equal(state.eliteReservations![0].status, 'completed'); assert.equal(advanceGame(state, .1, graph).completedTrips, 1); });
test('a missed booking counts one cancellation without fare; explicit future cancellation and competing withdrawal never double-charge', () => { let state = proposal(); state = applyEliteBookingAction(state, id(state), 'accept', graph); const booking = state.eliteReservations![0]; state = advanceGame({ ...state, clockMinutes: booking.graceEndsAt + .01, nextDemandMinute: booking.graceEndsAt + 1 }, .01, graph); assert.equal(state.cancelledTrips, 1); assert.equal(state.grossIncome, 0); assert.equal(state.eliteReservations![0].status, 'missed'); assert.equal(advanceGame(state, .2, graph).cancelledTrips, 1); const proposed = proposal(), claimed = withdrawClaimedEliteReservations(proposed, new Map([[id(proposed), 'other']]), 'you'); assert.equal(claimed.eliteReservations![0].status, 'unavailable'); assert.equal(claimed.declinedOffers, 0); assert.equal(claimed.platform.offered, 0); assert.equal(claimed.presentedOffers, 1); const accepted = applyEliteBookingAction(proposed, id(proposed), 'accept', graph), cancelled = applyEliteBookingAction(accepted, id(accepted), 'cancel', graph); assert.equal(cancelled.cancelledTrips, 1); assert.equal(applyEliteBookingAction(cancelled, id(cancelled), 'cancel', graph), cancelled); });
test('other trips must leave time and energy for the accepted appointment; active passengers cannot be interrupted', () => { const proposed = proposal(), accepted = applyEliteBookingAction(proposed, id(proposed), 'accept', graph), booking = accepted.eliteReservations![0], ordinary = { ...booking.offer, id: 'ordinary', eliteBookingId: undefined, scheduledPickupMinute: undefined, serviceType: 'standard' as const, pricingType: 'private-upfront' as const, pickupMinutes: 1, tripMinutes: 1 }; assert.equal(eliteAllowsOrdinaryOffer(accepted, ordinary, graph), true); assert.equal(canCompleteOfferBeforeHandover({ ...accepted, clockMinutes: booking.pickupAt - 2 }, ordinary, graph), false); const driving = applyEliteBookingAction(accepted, id(accepted), 'depart', graph); assert.equal(applyEliteBookingAction(driving, id(driving), 'depart', graph), driving); const aboard = advanceGame({ ...driving, clockMinutes: booking.pickupAt }, 3, graph); if (aboard.activeTrip) {
    assert.equal(applyEliteBookingAction(aboard, id(aboard), 'accept', graph), aboard);
} assert.equal(applyEliteBookingAction({ ...proposed, energy: { ...proposed.energy, remaining: 0 } }, id(proposed), 'accept', graph).acceptedOffers, 0); });
test('blind scheduled wire contains only known pickup/time, revealing destination at boarding and price only after actual completion', () => { let state = proposal(); const booking = state.eliteReservations![0], secret = booking.offer.destination.id; let projected = projectBlindGameState(state, true); assert.equal(projected.eliteReservations![0].offer.destination.id, 'withheld-destination'); assert.equal(projected.eliteReservations![0].offer.estimatedFare, 0); assert.equal(projected.eliteReservations![0].pickupAt, booking.pickupAt); assert.ok(!JSON.stringify(projected.eliteReservations).includes(`\"id\":\"${secret}\"`)); assert.equal(state.eliteReservations![0].offer.destination.id, secret); state = applyEliteBookingAction(state, booking.id, 'accept', graph); state = applyEliteBookingAction(state, booking.id, 'depart', graph); state = advanceGame(state, 5, graph); projected = projectBlindGameState(state, true); assert.equal(projected.movement.nextEdgeIds.length, 0); assert.equal(projected.eliteReservations![0].offer.tripRoute.length, 0); state = advanceGame(state, booking.pickupAt - state.clockMinutes + 10, graph); projected = projectBlindGameState(state, true); assert.equal(projected.eliteReservations![0].offer.estimatedFare, booking.offer.estimatedFare); assert.equal(projected.eliteReservations![0].status, 'completed'); });
test('the response boundary expires precisely, while a passenger cancellation uses the existing safe-dropoff path', () => {
    const proposed = proposal(), booking = proposed.eliteReservations![0];
    assert.equal(canAcceptEliteReservation({ ...proposed, clockMinutes: booking.respondBy }, booking.id, graph), false);
    let state = applyEliteBookingAction(proposed, booking.id, 'accept', graph);
    state = applyEliteBookingAction(state, booking.id, 'depart', graph);
    state = advanceGame(state, 5, graph);
    const trip = state.activeTrip!;
    state = advanceGame(state, booking.pickupAt + trip.waitMinutes + trip.boardingMinutes - state.clockMinutes + .001, graph);
    assert.equal(state.phase, 'dropoff');
    assert.equal(state.eliteReservations![0].status, 'in-trip');
    const wire = projectBlindGameState(state, true);
    assert.equal(wire.eliteReservations![0].offer.destination.id, booking.offer.destination.id);
    assert.equal(wire.eliteReservations![0].offer.estimatedFare, 0);
    const stopped = cancelTrip(state, graph);
    assert.equal(stopped.phase, 'safe-dropoff');
    const cancelled = advanceGame(stopped, 2, graph);
    assert.equal(cancelled.cancelledTrips, 1);
    assert.equal(cancelled.completedTrips, 0);
    assert.equal(cancelled.grossIncome, 0);
    assert.equal(cancelled.eliteReservations![0].status, 'cancelled');
    assert.equal(advanceGame(cancelled, 1, graph).cancelledTrips, 1);
});
test('shift settlement cancels an unpaid future commitment once and old saves never gain qualifications', () => {
    const proposed = proposal(), accepted = applyEliteBookingAction(proposed, id(proposed), 'accept', graph);
    const ended = advanceGame({ ...accepted, clockMinutes: 359.99, nextDemandMinute: 360, nextHandoverReviewMinute: 360 }, 1, graph);
    assert.equal(ended.phase, 'ended');
    assert.equal(ended.cancelledTrips, 1);
    assert.equal(ended.grossIncome, 0);
    assert.equal(ended.eliteReservations![0].status, 'missed');
    const old = { ...fresh(), advancedRulesVersion: undefined, eliteCertified: undefined, eliteReservations: undefined, eliteReviewedWindows: undefined };
    const restored = normalizeGameState(old, graph)!;
    assert.equal(restored.eliteCertified, false);
    assert.deepEqual(restored.eliteReservations, []);
    assert.equal(advanceGame(restored, 1, graph).acceptedOffers, 0);
});
test('a next-trip quote budgets the current passenger distance as well as the ordinary and scheduled journeys', () => {
    const proposed = proposal(), accepted = applyEliteBookingAction(proposed, id(proposed), 'accept', graph), booking = accepted.eliteReservations![0];
    const offer = { ...booking.offer, id: 'following', eliteBookingId: undefined, scheduledPickupMinute: undefined, serviceType: 'standard' as const, pricingType: 'private-upfront' as const, reservation: 'next-trip' as const, pickupDistanceM: 0, pickupMinutes: 0, tripDistanceM: 100, tripMinutes: .3 };
    const active = { offer: { ...offer, id: 'aboard' }, acceptedAt: 0, actualDistanceM: 0, paidDistanceM: 0, routePolicy: 'fastest' as const, waitMinutes: 0, boardingMinutes: 0, fareOnCompletion: 30, canonicalDistanceM: 100, canonicalMinutes: .3, pickedUpAt: 0 };
    const during = { ...accepted, phase: 'dropoff' as const, activeTrip: active, movement: { edgeId: 'ab', distanceOnEdgeM: 0, nextEdgeIds: ['bc', 'ca'] } };
    // .035L covers the following + future booking, but not all 300m still owed
    // to the passenger already aboard. Never promise the same energy twice.
    assert.equal(eliteAllowsOrdinaryOffer({ ...during, energy: { ...during.energy, remaining: .035 } }, offer, graph), false);
    assert.equal(eliteAllowsOrdinaryOffer(during, offer, graph), true);
});
