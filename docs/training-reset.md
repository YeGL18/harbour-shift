# Voluntary learning and new observation periods

The reset course from `future-training-courses.md` is implemented in source. The separate business-service qualification course remains a future proposal. This page describes source behavior; it does not claim a production migration, deployment or native visual QA.

The Profile screen opens a self-contained Training modal. Players can read the original ten-question lesson, leave without changing records, submit answers, review their result and then explicitly confirm a new period. Eight correct answers pass. Passing alone has no effect. The question bank contains complete Hong Kong Cantonese, formal Chinese and English text; Simplified Chinese derives from the formal version through the existing converter. No payment, seven-shift requirement or real-world platform certificate is involved.

## What changes

Confirmation appends a baseline containing the four existing lifetime counters. A current-period rate is computed from subsequent counter differences. With no new offered or accepted sample, the corresponding rate is `null` in the API and displayed as `—`. Earlier periods remain readable. Lifetime counters, session high-water receipts, earnings, operating costs, trips, match results and existing sanctions are not cleared.

Solo periods stay in the existing on-device solo ledger and are never submitted as verified reputation. A durable storage failure does not display success. Replaying the same assessment ID does not move the baseline again. Solo confirmation requires no unfinished solo shift or multiplayer session. Online confirmation additionally checks every committed active room for that authenticated driver, including another device. It does not interrupt an active match or reset any game clock.

Verified multiplayer dispatch applies its existing mild history weighting to the new-period counter difference. Lifetime totals remain the career record. Existing per-game suspensions retain their original state and rules.

## Authoritative API

All endpoints use the existing opaque driver bearer token and body-size/admission limits. Clients cannot supply counters, a grade, a baseline or a new percentage.

| Method and path | Body / result |
| --- | --- |
| `GET /v1/drivers/training` | Current period, lifetime counters, previous periods and whether confirmation is currently allowed. |
| `POST /v1/drivers/training/attempts` | `{courseVersion}` → server-issued assessment ID. |
| `POST /v1/drivers/training/submit` | `{assessmentId,answers}` → server-graded score/pass and per-question correctness. Same-answer retries are idempotent; changed answers require a new attempt. |
| `POST /v1/drivers/training/confirm` | `{assessmentId,expectedPeriodId,confirm:true}` → atomic baseline snapshot. An already-applied assessment returns `alreadyApplied:true`. |

The single SQLite `INSERT ... SELECT` checks the active-room guard and expected current period while capturing all counters. Two concurrent different confirmations cannot both replace the same period. A stale expected period receives `409 training_period_changed` and requires a fresh explicit confirmation.

## Migration and compatibility

Append-only migration `server/cloudflare/owned/schema/0004_driver_training.sql` adds assessment and baseline tables plus their six permanent migration-fence triggers. It does not alter or clear `driver_accounts`, `driver_stat_events`, rooms or player states. Together with the original fifteen triggers, the schema has twenty-one write-fence triggers.

Apply the new migration once using the existing reviewed release procedure. Reapplying its DDL reports an existing-table error; do not rerun or rewrite prior migrations. No remote database was changed while implementing this feature.

The ordinary driver APIs tolerate the narrowly identified missing baseline table and execute their original SELECT. Thus an older schema still serves ordinary profiles; only training returns `503 training_unavailable`. An older bundle continues to work with the expanded schema and ignores the two new tables. Rolling back runtime must preserve those tables and records. No unknown database error is silently converted into an empty profile.

## Validation

- Full server regression suite: 119 passing tests, including six new training-store tests using real SQLite.
- Provider hook harness: 23 passing cases, including ordered solo writes, unchanged verified history, failed durable writes and idempotent reset retries.
- Six client/profile/catalogue checks cover old ledger compatibility, retained session receipts, zero-sample rates, incorrect answers, the 8/10 boundary and complete localized course data.
- Full app TypeScript check passed.
- Isolated owned Worker/private-compute-DO HTTP test: 75 requests, six checks, one cold restart, 18.066 seconds and zero cleanup failures. It used only a throwaway local D1 database. It verified migration-unavailable behavior, server grading, loading/running refusal, genuine dispatch/accept/cancel/leave counters, explicit confirmation, exact retry and cold restoration. No test clock or counter injection was used.

Native light/dark/large-text course interaction, release packaging, production migration and live verification remain release gates owned by the main task. The local test artifact and receipt are in the task's `work/training-qa` directory and are not production artifacts.
