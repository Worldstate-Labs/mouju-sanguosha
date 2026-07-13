CREATE TABLE `room_players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`seat` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_players_token_idx` ON `room_players` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_players_room_seat_idx` ON `room_players` (`room_code`,`seat`);--> statement-breakpoint
CREATE TABLE `room_requests` (
	`room_code` text NOT NULL,
	`request_id` text NOT NULL,
	`player_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_code`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`max_players` integer NOT NULL,
	`host_player_id` text NOT NULL,
	`state_json` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
