# Owned compute authority

This permanent adapter runs the existing authoritative engine inside a named Durable Object while D1 remains the source of truth. It forwards the original Request/Response streams, D1 environment, bound `waitUntil` and trusted Edge ingress. It does not use DO storage for scores or replace account/session authentication.

The permanent gate reads the existing operations control row for `/`, health and API requests. Missing, invalid, frozen or unavailable control fails closed. All `__ops` routes return 404, including initialization/export/release routes. There is no administration credential, time window, initializer or schema mutation in this runtime. The separately authorized migration operations are not source-package contents.

`schema/` retains the four immutable backend schema-only migrations and appends `0004_driver_training.sql` for voluntary training assessments and observation-period baselines. Apply migrations in journal order to a genuinely new database; an existing installation applies only the unapplied append. Do not edit or rerun applied history. The new tables add six write-fence triggers, for twenty-one in total, and leave the five original application tables unchanged. On a **new empty installation only**, an authorized database operator must separately initialize the singleton control metadata (`id=1`, `frozen=0`, remaining control fields null), after confirming all eleven application tables and the control table are empty. This is an explicit operator action, not seed data, automatic DML or a public administration API. Health remains unavailable until correctly initialized. **Never replace, recreate or reset an existing migrated control row/fence** to make health pass; its state belongs to the authorized migration/cutover process. Training migration, compatibility and validation details are in `../../../docs/training-reset.md`.

Local checks:

```sh
node --test server/cloudflare/owned/*.test.mjs
python3 scripts/test-package-source.py
```

To keep a specifically approved core unchanged, run `node server/cloudflare/owned/build.mjs --core /absolute/approved-core.mjs --core-sha256 APPROVED_SHA256`. To build a new core from the checked source, explicitly use `--rebuild-core`; this invokes the unchanged parent `bundle.mjs` with a task-local output. Both operations write generated files under `owned/build/`, excluded from source archives. Neither command deploys or accesses a remote database.

`wrangler.example.jsonc` contains placeholders only. A release owner must retain the existing Worker name, DO migration history/namespace and exact destination D1 identity in private deployment configuration. Never copy actual credentials, `.dev.vars`, `.wrangler` state, migration archives or database exports into source. Opening a destination for writes and hostname cutover are separate authorized operations and are not performed by this adapter or builder.

Version 0.8 appends `0005_driver_pro.sql` and `0006_driver_elite.sql` after training. The existing authority and driver accounts can run while the additive schema is applied. Verify all 33 permanent fence triggers and foreign keys after applying the new files. The Pro claim-availability trigger is separate from those 33 fences.
