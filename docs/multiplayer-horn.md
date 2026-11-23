# Multiplayer proximity horn

Implementation for the next candidate; **native playback and live-service QA remain pending**. No deployment is performed by this change. The current live0.6 service does not advertise the optional horn view, so the control stays hidden there.

## Scope

The control appears when another eligible player in the same room is within200 game metres along a connected, same-name, same-elevation road corridor. Once visible, it hides after230m. Sound begins inside150m, with gain `(1-distance/150)^1.5`. This is a conservative gameplay acoustic model, not a real-world sound/line-of-sight estimate. Opposite directions on the same physical segment qualify; geometric crossings, different elevations and unconnected same-name roads do not. Road elevation is retained from the existing official source row; routing geometry and permissions are unchanged.

The56pt native-map-external control responds on press-in. A short press has a minimum300ms local tone; holding renews every1200ms, release stops that voice. Each press has a distinct identifier. Independent local/remote voices can overlap; stopping one sender does not stop the others. A screen-reader activation can issue a short press. The existing game audio switch, native background lifecycle and component unmount stop playback. System media volume is not changed and no microphone, location or notification permission is added.

## Authority and delivery

- `POST /v1/rooms/:code/horn`, using the existing private room bearer, accepts only `{actions:[{pressId,pressed}]}`. At most12 actions per request,64 identifier characters,32 retained records per room,6s history and a3.5s active lease. Per-player audio admission is separate from the game's input-rate budget.
- No client player ID, position, timestamp, income or game-state field is accepted. Only connected, nonforfeited, unfinished room participants qualify. The authenticated recipient receives `you.horn={available,events}` with sender public ID, event ID, trusted timestamps and gain; it exposes no additional coordinates.
- Press/renew/release is idempotent within the retained record. Trusted adapter ingress older than2s or in the future is discarded, not replayed as a late horn. No career counters, passenger claims or durable game input sequences are consumed.
- The provider uses an independent audio request channel. Pending durable game actions win; audio queues are capped24 and older than2s are dropped. Busy leases are not retried; the entire horn request has a1.8s budget and cannot mark the gameplay endpoint unhealthy. Ordinary requests retain their15s/replay rules. A lost horn is not a reconnect/trip error.
- Metadata caches each recipient's projection for the existing fast GET path. Both metadata and state cold restoration preserve the bounded events. Receiver deduplication prevents old short pulses replaying on every poll. Native players additionally expire after5s without renewal.

## Original audio

`scripts/generate-horn.py` deterministically synthesizes an original mono44.1kHz/16-bit, one-second dual-tone PCM loop. It contains no samples or third-party recording. Source/iOS/Android copies share SHA-256:

`108cf3b6e67c203ccb2e1654c74924b50c3f36909814ee82c5261d7cd7ba287b`

Both native modules keep per-press voices (maximum16) separate from the offer, acceptance and UI cue players. Android SoundPool has24 total streams; iOS keeps Ambient category/silent-mode behavior and mixes with other app audio. There are now15 packaged sounds: the prior14 plus this horn. Resource existence and source compilation do not establish audibility or native overlap correctness.

## Local evidence before native QA

- Nine horn topology/state/authority/playback tests pass, including a same-rounded-node bridge/elevation regression, show/hear/hide ranges, bounded history, authentication, cold restore, coordinate-free views, overlapping senders and no game sequence/career changes.
- Existing transport regressions plus two horn busy/timeout cases pass (15 transport tests;24 with the nine horn tests).
- Actual-source Provider mock-I/O harness18/18 passes: original14 plus independent horn/accept ordering, horn-failure isolation and exact validated capability fallback. This is not a real backend/native test.
- App and server TypeScript pass. iOS `clang -fsyntax-only`, real RN headers and simulator SDK with warnings-as-errors pass. Android Kotlin and all four CMake architectures compile successfully; the universal packaging attempt failed from disk exhaustion. The authorized ARM64-only0.6.1(11) recovery APK builds and passes manifest, same-certificate,16KiB alignment, integrity and all15-WAV byte-hash checks. Native short/hold/overlap/background/mute/range tests and live room HTTP remain release gates.

Create/join advertise `blindOrdersVersion:1` for the separately implemented operator policy. Only an authoritative400 `unexpected_field` is retried once without that capability for the old service; timeouts,5xx and policy409 are not retried/downgraded. This compatibility path does not enable horn on an old authority.
