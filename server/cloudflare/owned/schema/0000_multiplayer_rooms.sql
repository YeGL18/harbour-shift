CREATE TABLE `rooms` (
  `code` text PRIMARY KEY NOT NULL,
  `metadata` text NOT NULL,
  `generation` text NOT NULL,
  `version` integer NOT NULL DEFAULT 0,
  `expires_at` integer NOT NULL,
  `lease_token` text,
  `lease_until` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_expires_idx` ON `rooms` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `player_states` (
  `room_code` text NOT NULL,
  `generation` text NOT NULL,
  `player_id` text NOT NULL,
  `state` blob NOT NULL,
  PRIMARY KEY (`room_code`, `generation`, `player_id`),
  FOREIGN KEY (`room_code`) REFERENCES `rooms` (`code`) ON DELETE CASCADE
);
