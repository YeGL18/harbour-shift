# Iteration 02: game engine

The v2 engine adds local demand, two separate informational feeds, passenger waiting, cancellation throughout a trip, mixed pricing and configurable shifts. It uses the bundled connected Hong Kong road network and 37,925 real named places. Demand weights and service rules are game configuration rather than measured passenger behaviour.

## Demand and informational orders

The city is indexed into 900-metre cells. Each half-minute of simulation queries nearby cells, with pickup origins within 1.8 km of the relevant car. Road pickup access is checked with a bounded search, capped at 3.8 km and 13 estimated minutes. Place type, virtual hour and normal/busy density affect request intensity. A live order remains the only actionable order while cruising.

Scheduled world requests are seeded by the city seed, cell, channel and **absolute virtual time**, including the selected start time. Two drivers querying the same cell at the same virtual time see the same underlying requests even when their shifts began at different times. An immediate opening offer can use a local named introductory route. A seeded tie-break avoids consistently favouring one pricing channel when pickup distances are equal.

- `observedOffers`: demand near the car's **actual** route during pickup, waiting, boarding or a passenger trip. These are labelled along-route orders and cannot be accepted while serving the current passenger.
- `ghostOffers`: demand near a copied pre-acceptance itinerary. The shadow car keeps cruising along that plan and its deterministic continuation. It watches for up to 20 simulated minutes, ending earlier when the real trip completes or is cancelled.

Both feeds keep the latest 24 entries and pay no income. They show multiple opportunities rather than stopping at the first one. The ghost stream assumes continued cruising without accepting those alternatives; its prices cannot be added together as attainable revenue. Informational trip prices and durations have `routeEstimated: true`; their pickup access is checked, but their full passenger route is estimated. Actionable live quotes retain exact A* trip routing.

## Passenger phases and cancellation

The service sequence is `pickup → waiting → boarding → dropoff`. Waiting and boarding hold the vehicle at pickup. Their combined ordinary duration is 3 seconds to 3 minutes of simulation. Explicit rural `saikung` profiles occasionally extend this to 10 minutes. An explicit `ordinary` profile overrides the broad Sai Kung district fallback, so urban Tseung Kwan O is not automatically assigned rural waits.

`getPhaseRemainingMinutes` exposes the current phase countdown. Cancellation is available during all four service phases: it pays zero, retains elapsed time, distance and operating cost, and records a cancellation. It cannot pay or revoke an already completed trip. Cancellation fees and platform waiting-fee thresholds are not represented as verified current platform rules.

## Pricing and shifts

Taxi vehicles can receive metered, 85% metered, taxi upfront and private-price upfront contracts. Private cars receive only private-price contracts. This eligibility mix is an explicit game rule, not a claim about real platform vehicle eligibility.

Metered and 85% metered trips settle from actual passenger distance accumulated only during `dropoff`; pickup distance is excluded. A shorter passenger route therefore changes the final meter. Normal driving minutes are not incorrectly billed as waiting minutes. The 85% multiplier applies to meter fare; tolls and other extras are currently zero. Upfront contracts keep the accepted quoted payout. Their rate profiles are calibrated to the dated public driver-rate tables; locking the game contract differs from platforms that adjust actual time/distance.

| Vehicle | Day rental | Night rental | Default source |
|---|---:|---:|---|
| 金豐的士 | $480 | $370 | User provided |
| 小露寶 | $560 | $490 | User provided |
| 紅旗的士 | $560 | $490 | User-requested provisional assumption |
| Private car | $0 | $0 | Own-vehicle game default |

Rental overrides are supported. The applied rental is stored once in `rentalCostApplied`. Day/night shifts default to 06:00/18:00; a named place, road node, custom map start and custom clock time are supported. Custom map starts never become synthetic passenger POIs.

## State, route choices and validation

The state schema is version 2. The immutable place catalogue remains a shared reference, is omitted from periodic saves, and is reattached on restoration. Pre-snapped POIs and weak-cached spatial indexes avoid scanning every road node for every place. A* routes and destination-cell sets are cached; informational feeds avoid whole-city passenger-route searches.

Branch choices remain connected to the existing itinerary. Duplicate outgoing records are merged only when their destination and sampled geometry overlap closely. Genuine same-name curves remain distinct and receive direction descriptions. The observed Sai Kung 福民路 northwest/southeast choices were verified as different roads and retained.

`npm test` passes **36/36 tests** and `npm run typecheck` passes. Coverage includes cross-start shared-world consistency, immutable custom starts, multiple unpaid feeds, local density, waiting/boarding, cancellation in every phase, pricing eligibility, actual meter distance, rental/start settings, large-catalogue behaviour and genuine/duplicate forks.

## Observed performance

Diagnostic Node measurements were taken while native builds and, in one run, other test processes competed for CPU. They are noisy host measurements, not device frame-rate results.

- An interim 54,787-row catalogue produced dense scheduled-tick p95 around 23 ms and rural p95 around 16 ms.
- With the final 37,925-row catalogue under concurrent build load, dense scheduled-tick p95 ranged roughly 119–160 ms; rural p95 was about 48 ms. The stress loop rejected each popup and requested another half-minute tick. It received 100 local live offers in 50 simulated minutes.
- A 20-tick informational-feed sample had a maximum around 3.7 ms. The 40,000-place synthetic test confirms catalogue sharing and no per-POI full-node scan.

Exact routing for a new actionable offer remains the main potential CPU spike. It was retained for quote/ETA quality. These measurements do not establish 60 fps or physical-device performance; no further performance sweeps were run after runtime freeze.
