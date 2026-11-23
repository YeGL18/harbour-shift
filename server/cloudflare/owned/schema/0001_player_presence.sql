CREATE TABLE `player_presence` (
  `room_code` text NOT NULL,
  `player_id` text NOT NULL,
  `last_seen` integer NOT NULL,
  `forfeited_at` integer,
  PRIMARY KEY (`room_code`, `player_id`),
  FOREIGN KEY (`room_code`) REFERENCES `rooms` (`code`) ON DELETE CASCADE
);
