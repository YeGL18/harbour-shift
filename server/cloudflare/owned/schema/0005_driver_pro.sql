CREATE TABLE driver_pro_packs (
  id TEXT PRIMARY KEY NOT NULL,
  driver_id TEXT NOT NULL REFERENCES driver_accounts(id),
  tier TEXT NOT NULL CHECK(tier IN ('gold','platinum','diamond')),
  source TEXT NOT NULL CHECK(source IN ('trial','apple','google')),
  transaction_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(source,transaction_id)
);
--> statement-breakpoint
CREATE INDEX driver_pro_packs_driver ON driver_pro_packs(driver_id,created_at);
--> statement-breakpoint
CREATE TABLE driver_pro_claims (
  shift_key TEXT PRIMARY KEY NOT NULL,
  pack_id TEXT NOT NULL REFERENCES driver_pro_packs(id),
  driver_id TEXT NOT NULL REFERENCES driver_accounts(id),
  room_code TEXT NOT NULL,
  held_until INTEGER NOT NULL,
  acquired_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('held','consumed','released'))
);
--> statement-breakpoint
CREATE INDEX driver_pro_claims_pack ON driver_pro_claims(pack_id,state,held_until);
--> statement-breakpoint
CREATE TRIGGER driver_pro_claim_available BEFORE INSERT ON driver_pro_claims
WHEN NOT EXISTS(SELECT 1 FROM driver_pro_claims WHERE shift_key=NEW.shift_key)
 AND NOT EXISTS(
  SELECT 1 FROM driver_pro_packs p
  WHERE p.id=NEW.pack_id AND p.driver_id=NEW.driver_id AND p.revoked_at IS NULL
   AND (SELECT count(*) FROM driver_pro_claims c WHERE c.pack_id=p.id
     AND (c.state='consumed' OR (c.state='held' AND c.held_until>NEW.acquired_at)))<7
 )
BEGIN SELECT RAISE(ABORT,'harbour_pro_pack_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_pro_packs_insert BEFORE INSERT ON driver_pro_packs WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_pro_packs_update BEFORE UPDATE ON driver_pro_packs WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_pro_packs_delete BEFORE DELETE ON driver_pro_packs WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_pro_claims_insert BEFORE INSERT ON driver_pro_claims WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_pro_claims_update BEFORE UPDATE ON driver_pro_claims WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_pro_claims_delete BEFORE DELETE ON driver_pro_claims WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
