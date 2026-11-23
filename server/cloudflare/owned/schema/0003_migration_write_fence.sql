CREATE TABLE __harbour_migration_control (id INTEGER PRIMARY KEY CHECK(id=1),frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN(0,1)),snapshot_id TEXT,frozen_at INTEGER,retired_snapshot_id TEXT);
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_driver_accounts_insert" BEFORE INSERT ON "driver_accounts" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_driver_accounts_update" BEFORE UPDATE ON "driver_accounts" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_driver_accounts_delete" BEFORE DELETE ON "driver_accounts" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_rooms_insert" BEFORE INSERT ON "rooms" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_rooms_update" BEFORE UPDATE ON "rooms" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_rooms_delete" BEFORE DELETE ON "rooms" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_player_states_insert" BEFORE INSERT ON "player_states" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_player_states_update" BEFORE UPDATE ON "player_states" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_player_states_delete" BEFORE DELETE ON "player_states" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_player_presence_insert" BEFORE INSERT ON "player_presence" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_player_presence_update" BEFORE UPDATE ON "player_presence" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_player_presence_delete" BEFORE DELETE ON "player_presence" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_driver_stat_events_insert" BEFORE INSERT ON "driver_stat_events" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_driver_stat_events_update" BEFORE UPDATE ON "driver_stat_events" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
--> statement-breakpoint
CREATE TRIGGER "__harbour_fence_driver_stat_events_delete" BEFORE DELETE ON "driver_stat_events" WHEN (SELECT frozen FROM __harbour_migration_control WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'harbour_migration_frozen'); END;
