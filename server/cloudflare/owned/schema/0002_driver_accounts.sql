CREATE TABLE `driver_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `offered` integer NOT NULL DEFAULT 0,
  `accepted` integer NOT NULL DEFAULT 0,
  `cancelled` integer NOT NULL DEFAULT 0,
  `completed_trips` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `driver_stat_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `room_code` text NOT NULL,
  `driver_id` text NOT NULL,
  `offered` integer NOT NULL,
  `accepted` integer NOT NULL,
  `cancelled` integer NOT NULL,
  `completed_trips` integer NOT NULL,
  `applied` integer NOT NULL DEFAULT 0,
  FOREIGN KEY (`room_code`) REFERENCES `rooms` (`code`) ON DELETE CASCADE,
  FOREIGN KEY (`driver_id`) REFERENCES `driver_accounts` (`id`)
);
