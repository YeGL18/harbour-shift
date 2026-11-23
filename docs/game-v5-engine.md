# v0.5 engine behavior

The queue and demand timings below are game rules, not live station observations, a kerbside parking survey, or a reproduction of a platform's private dispatch algorithm. Station names, coordinates and dated price provenance remain in `assets/services` and the existing service research documentation.

## Fuel queues

`fuelQueueBaseline(station, absoluteMinute)` increases LPG queue demand from 04:00/16:00. By 04:30/16:30 the baseline is at least twenty game minutes, and it remains high at turnover. Non-LPG stations do not receive this turnover background queue. Ordinary LPG background waits are shorter.

The vehicle navigates to a canonical directed queue entrance. A new driver already near the forecourt is routed back through that entrance rather than joining ahead of earlier arrivals. Existing queue tickets remain unchanged when a driver attaches handover after service. The reverse road lookup selects a contiguous safe local holding prefix; if the station is connected through an arterial or other unsuitable stopping edge, that final connector is traversed after release without waiting in the queue on it. `safeStop` is the existing conservative game road proxy, not a claim that every real kerbside permits parking. All 63 vehicle-compatible LPG stations have a connected holding prefix, at least 56 metres long; 62 have at least 200 metres and one has about 120 metres. The longest drive-through connector is about 1.57 km.

`GameState.fuelQueue` records entry time, scheduled service time, approach and connector, background cars and the remaining road distance. Ordinary `Movement` is advanced forward at a maximum 12 km/h; no position override or backwards teleport is used. The waiting-distance scale reserves space for eight real participants on shorter holding roads. The renderer receives background queue vehicles separately from authenticated room peers and omits background markers within seven metres of supplied real peer positions.

Solo uses the same baseline and directed approach. Shared rooms use `configureSharedFuelQueues`, persistent server FIFO tickets and `applyFuelQueueAssignment`. Pending tickets wait for authority. The server must preserve assignments across storage/restore and extend later assignments when an earlier physical service ends later than scheduled. A cancelled navigation clears the player's ticket. Service completion preserves weighted fuel cost accounting and does not deduct the tank purchase a second time.

## Handover

The deadline is exactly 720 game minutes after the selected start time. Default shifts are 05:00–17:00 and 17:00–05:00. `getHandoverPlan` includes the return journey and, when a station is supplied, the actual approach detour, queue and service time. Return budgeting uses a 25% travel allowance and a two-minute margin. Idle drivers automatically start returning when their budget is exhausted. Handover also requires a prepared tank/battery: nominally 90%, reduced only by the actual directed drive from the nearest compatible station with a 15% travel allowance and 200-metre margin. Underfilled return commands first navigate to that station, complete the queue and service, then automatically return. Offer budgets include this prospective refuel. A driver still filling at the deadline is marked unprepared rather than complete. Legacy rooms retain their previous fuel-readiness behavior. There is no extension beyond the deadline or teleport to the handover point; unfinished trips pay nothing and a missed handover is recorded. Arriving earlier may end the shift earlier.

`canCompleteOfferBeforeHandover` rejects offers which cannot finish, alight and return within the remaining time or available energy. Acceptance validates a fresh pickup route so movement during the response window cannot leave a stale pickup estimate in the deadline check.

## Reserved next trips and road events

A near-destination offer has `reservation: 'next-trip'`. Acceptance writes `queuedTrip` and preserves the current passenger and itinerary. The next pickup activates only after the current passenger has finished alighting. Cancellation of the reserved trip is a separate, optionally trip-ID-bound action. Preview pickup geometry starts at the current destination.

`getRouteEventOptions` exposes rerouting only when a different connected route can avoid the affected edge. Accepted reroutes replace passenger, service, handover or cruise itineraries and explicitly exclude that edge. A road already under the car cannot be retrospectively avoided; an unavailable choice does not claim success. Staying retains the original route and the affected-edge slowdown.

Existing 0.4 rooms use `configureLegacyGameRules`: ordinary servicing phases and no next-trip reservation, so deployed older clients never receive a new queue phase.

## Validation

Focused engine tests exercise physical queue progression, persistent FIFO assignment, connector non-stopping, queue-aware handover budgets, strict deadlines, next-trip activation after alighting, and actual affected-edge exclusion. The station integration test checks the holding-prefix connectivity and safe stopping metadata of every compatible LPG station and verifies weighted fuel cost after an actual approach, queue and service. Native visual and multiplayer network validation are recorded separately; unit tests alone are not native QA.

## Lifetime counters

`presentedOffers` is monotone and counts cards actually displayed by the dispatcher, including later withdrawals. Per-shift `platform.offered` still excludes a withdrawn card so pausing is not treated as a rejection. `driverSessionId` and the canonical accepted/cancelled counters support an idempotent local session ledger; `platformHistory` is an immutable opening snapshot rather than a second copy of live session totals. Server-managed dispatch skips unpublished automatic cards and increments the displayed-card counter only through `setDispatchOffer`.
