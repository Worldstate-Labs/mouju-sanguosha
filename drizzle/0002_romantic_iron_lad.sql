CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`target_player_id` text NOT NULL,
	`credential_id` text,
	`type` text NOT NULL,
	`game_version` integer,
	`request_id` text,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_id_idx` ON `agent_events` (`id`);--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `agent_name` text DEFAULT '自带 Agent' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `agent_runtime` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `protocol_version` text DEFAULT 'mouju-agent/1.2' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `client_version` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `ready_at` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_heartbeat_at` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_snapshot_at` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_snapshot_version` integer;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_observed_version` integer;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `reported_phase` text DEFAULT 'connecting' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `heartbeat_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_reported_error_code` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_server_error_code` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_action_attempt_at` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_action_accepted_at` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `last_timeout_at` text;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `consecutive_timeouts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_credentials` ADD `suspended_at` text;