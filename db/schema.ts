import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey().notNull(),
  status: text("status").notNull().default("lobby"),
  maxPlayers: integer("max_players").notNull(),
  hostPlayerId: text("host_player_id").notNull(),
  stateJson: text("state_json"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roomPlayers = sqliteTable(
  "room_players",
  {
    id: text("id").primaryKey().notNull(),
    roomCode: text("room_code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    principalType: text("principal_type").notNull().default("guest"),
    accountKey: text("account_key"),
    ownerPlayerId: text("owner_player_id"),
    controlMode: text("control_mode").notNull().default("human"),
    controlEpoch: integer("control_epoch").notNull().default(0),
    scopesJson: text("scopes_json").notNull().default("[]"),
    credentialExpiresAt: text("credential_expires_at"),
    seat: integer("seat").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    uniqueIndex("room_players_token_idx").on(table.tokenHash),
    uniqueIndex("room_players_room_seat_idx").on(table.roomCode, table.seat),
    uniqueIndex("room_players_room_account_idx").on(table.roomCode, table.accountKey),
  ],
);

export const agentCredentials = sqliteTable(
  "agent_credentials",
  {
    id: text("id").primaryKey().notNull(),
    roomCode: text("room_code").notNull(),
    targetPlayerId: text("target_player_id").notNull(),
    ownerPlayerId: text("owner_player_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopesJson: text("scopes_json").notNull().default("[]"),
    controlEpoch: integer("control_epoch").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    agentName: text("agent_name").notNull().default("自带 Agent"),
    agentRuntime: text("agent_runtime").notNull().default("other"),
    protocolVersion: text("protocol_version").notNull().default("mouju-agent/1.2"),
    clientVersion: text("client_version"),
    readyAt: text("ready_at"),
    lastHeartbeatAt: text("last_heartbeat_at"),
    lastSnapshotAt: text("last_snapshot_at"),
    lastSnapshotVersion: integer("last_snapshot_version"),
    lastObservedVersion: integer("last_observed_version"),
    reportedPhase: text("reported_phase").notNull().default("connecting"),
    heartbeatSeq: integer("heartbeat_seq").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    lastReportedErrorCode: text("last_reported_error_code"),
    lastServerErrorCode: text("last_server_error_code"),
    lastActionAttemptAt: text("last_action_attempt_at"),
    lastActionAcceptedAt: text("last_action_accepted_at"),
    lastTimeoutAt: text("last_timeout_at"),
    consecutiveTimeouts: integer("consecutive_timeouts").notNull().default(0),
    suspendedAt: text("suspended_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("agent_credentials_token_idx").on(table.tokenHash),
    uniqueIndex("agent_credentials_target_epoch_idx").on(table.targetPlayerId, table.controlEpoch),
  ],
);

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: text("id").primaryKey().notNull(),
    roomCode: text("room_code").notNull(),
    targetPlayerId: text("target_player_id").notNull(),
    credentialId: text("credential_id"),
    type: text("type").notNull(),
    gameVersion: integer("game_version"),
    requestId: text("request_id"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("agent_events_id_idx").on(table.id),
  ],
);

export const agentPairings = sqliteTable(
  "agent_pairings",
  {
    id: text("id").primaryKey().notNull(),
    roomCode: text("room_code").notNull(),
    targetPlayerId: text("target_player_id").notNull(),
    ownerPlayerId: text("owner_player_id").notNull(),
    codeHash: text("code_hash").notNull(),
    mode: text("mode").notNull(),
    scopesJson: text("scopes_json").notNull().default("[]"),
    expiresAt: text("expires_at").notNull(),
    claimedAt: text("claimed_at"),
    revokedAt: text("revoked_at"),
    agentName: text("agent_name"),
    agentRuntime: text("agent_runtime"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("agent_pairings_code_idx").on(table.codeHash),
  ],
);

export const roomRequests = sqliteTable(
  "room_requests",
  {
    roomCode: text("room_code").notNull(),
    requestId: text("request_id").notNull(),
    playerId: text("player_id").notNull(),
    resultVersion: integer("result_version").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.roomCode, table.requestId] })],
);
