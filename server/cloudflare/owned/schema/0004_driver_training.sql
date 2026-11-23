CREATE TABLE driver_training_attempts (
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
CREATE INDEX driver_training_attempts_driver ON driver_training_attempts(driver_id,created_at);
--> statement-breakpoint
CREATE TABLE driver_review_periods (
  assessment_id TEXT PRIMARY KEY NOT NULL REFERENCES driver_training_attempts(id),
  driver_id TEXT NOT NULL REFERENCES driver_accounts(id),
  started_at INTEGER NOT NULL,
  offered INTEGER NOT NULL,
  accepted INTEGER NOT NULL,
  cancelled INTEGER NOT NULL,
  completed_trips INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX driver_review_periods_latest ON driver_review_periods(driver_id,started_at DESC);
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_training_insert BEFORE INSERT ON driver_training_attempts WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_training_update BEFORE UPDATE ON driver_training_attempts WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_training_delete BEFORE DELETE ON driver_training_attempts WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_review_period_insert BEFORE INSERT ON driver_review_periods WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_review_period_update BEFORE UPDATE ON driver_review_periods WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER __harbour_fence_review_period_delete BEFORE DELETE ON driver_review_periods WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
