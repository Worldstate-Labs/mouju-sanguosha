CREATE TABLE `agent_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`target_player_id` text NOT NULL,
	`owner_player_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`control_epoch` integer NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_credentials_token_idx` ON `agent_credentials` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_credentials_target_epoch_idx` ON `agent_credentials` (`target_player_id`,`control_epoch`);--> statement-breakpoint
CREATE TABLE `agent_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`target_player_id` text NOT NULL,
	`owner_player_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`mode` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`expires_at` text NOT NULL,
	`claimed_at` text,
	`revoked_at` text,
	`agent_name` text,
	`agent_runtime` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_pairings_code_idx` ON `agent_pairings` (`code_hash`);--> statement-breakpoint
ALTER TABLE `room_players` ADD `principal_type` text DEFAULT 'guest' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_players` ADD `account_key` text;--> statement-breakpoint
ALTER TABLE `room_players` ADD `owner_player_id` text;--> statement-breakpoint
ALTER TABLE `room_players` ADD `control_mode` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_players` ADD `control_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `room_players` ADD `scopes_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_players` ADD `credential_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `room_players_room_account_idx` ON `room_players` (`room_code`,`account_key`);