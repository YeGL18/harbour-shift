CREATE TABLE driver_elite_attempts (
 id TEXT PRIMARY KEY NOT NULL,
 driver_id TEXT NOT NULL REFERENCES driver_accounts(id),
 course_version TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 submitted_at INTEGER,
 answers TEXT,
 score INTEGER,
 passed INTEGER NOT NULL DEFAULT 0 CHECK(passed IN(0,1))
);
--> statement-breakpoint
CREATE INDEX driver_elite_attempts_driver ON driver_elite_attempts(driver_id,created_at);
--> statement-breakpoint
CREATE TABLE driver_elite_certifications (
 driver_id TEXT PRIMARY KEY NOT NULL REFERENCES driver_accounts(id),
 assessment_id TEXT NOT NULL UNIQUE REFERENCES driver_elite_attempts(id),
 course_version TEXT NOT NULL,
 certified_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_elite_attempt_insert BEFORE INSERT ON driver_elite_attempts WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_elite_attempt_update BEFORE UPDATE ON driver_elite_attempts WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_elite_attempt_delete BEFORE DELETE ON driver_elite_attempts WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_elite_cert_insert BEFORE INSERT ON driver_elite_certifications WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_elite_cert_update BEFORE UPDATE ON driver_elite_certifications WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_elite_cert_delete BEFORE DELETE ON driver_elite_certifications WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
