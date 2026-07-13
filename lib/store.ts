import {
  applyGameAction,
  applyTimeout,
  assertGameInvariantV2,
  createGame,
  getLegalActions,
  kingdomName,
  roleName,
  type GameAction,
  type GameState,
  type LobbySeat,
} from "./game";
import { STANDARD_CHARACTERS } from "./game-v2-data";
import { getRequestIdentity } from "./auth";
import { getBindings } from "./runtime-env";

type RoomStatus = "lobby" | "playing" | "finished";
type PrincipalType = "guest" | "account" | "agent";
type ControlMode = "human" | "pairing" | "agent";
type AuthVia = "guest" | "account" | "agent";
type AgentReportedPhase = "connecting" | "observing" | "idle" | "planning" | "submitting" | "recovering" | "blocked" | "unattended";
type AgentPublicState =
  | "pairing"
  | "pairing_expired"
  | "connecting"
  | "ready"
  | "acting"
  | "submitting"
  | "accepted"
  | "delayed"
  | "offline"
  | "timed_out"
  | "safe_mode"
  | "unattended";

const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
const AGENT_TTL_MS = 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const AGENT_SCOPES = ["game:observe:self", "game:act:self", "game:heartbeat:self"];
const AGENT_PROTOCOL = "mouju-agent/2.4";
const AGENT_REQUIRED_CAPABILITIES = ["deterministic-cli-v1", "detached-daemon-v1", "command-fallback-v1", "view-parity-v1", "independent-heartbeat-v1", "action-reason-v1", "decision-loop-lease-v1"] as const;
const AGENT_RESPONSE_WINDOW_MS = 60_000;
const AGENT_TURN_WINDOW_MS = 120_000;
const HUMAN_RESPONSE_WINDOW_MS = 35_000;
const HUMAN_TURN_WINDOW_MS = 75_000;
const AGENT_PLANNING_GRACE_MS = 30_000;
const AGENT_GRACE_TRIGGER_MS = 20_000;
const AGENT_READY_PROBE_MS = 4_000;
// The official CLI keeps a successfully claimed daemon alive for up to 90s
// while a weak network recovers. Do not show a false terminal-looking timeout
// before that deterministic recovery window has elapsed.
const AGENT_CONNECT_TIMEOUT_MS = 100_000;
const AGENT_TIMEOUTS_BEFORE_SUSPEND = 3;
const AGENT_PHASES = new Set<AgentReportedPhase>([
  "connecting",
  "observing",
  "idle",
  "planning",
  "submitting",
  "recovering",
  "blocked",
  "unattended",
]);
const AGENT_REPORTED_ERRORS = new Set([
  "upstream_network",
  "model_timeout",
  "rate_limited",
  "context_error",
  "internal_error",
]);

interface RoomRow {
  code: string;
  status: RoomStatus;
  max_players: number;
  host_player_id: string;
  state_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface PlayerRow {
  id: string;
  room_code: string;
  name: string;
  kind: "human" | "agent";
  principal_type: PrincipalType;
  account_key: string | null;
  owner_player_id: string | null;
  control_mode: ControlMode;
  control_epoch: number;
  scopes_json: string;
  credential_expires_at: string | null;
  seat: number;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  auth_via?: AuthVia;
  auth_scopes?: string[];
  auth_credential_id?: string;
  auth_suspended_at?: string | null;
  auth_protocol_version?: string;
}

interface PairingRow {
  id: string;
  room_code: string;
  target_player_id: string;
  owner_player_id: string;
  code_hash: string;
  mode: "delegate" | "standalone";
  scopes_json: string;
  expires_at: string;
  claimed_at: string | null;
  revoked_at: string | null;
}

interface AgentCredentialRow {
  id: string;
  room_code: string;
  target_player_id: string;
  owner_player_id: string;
  scopes_json: string;
  control_epoch: number;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  agent_name: string;
  agent_runtime: string;
  protocol_version: string;
  client_version: string | null;
  ready_at: string | null;
  last_heartbeat_at: string | null;
  last_snapshot_at: string | null;
  last_snapshot_version: number | null;
  last_observed_version: number | null;
  reported_phase: AgentReportedPhase;
  heartbeat_seq: number;
  retry_count: number;
  last_reported_error_code: string | null;
  last_server_error_code: string | null;
  last_action_attempt_at: string | null;
  last_action_accepted_at: string | null;
  last_timeout_at: string | null;
  consecutive_timeouts: number;
  suspended_at: string | null;
  deadline_extension_decision_id: string | null;
  created_at: string;
}

interface AgentEventRow {
  id: string;
  type: string;
  game_version: number | null;
  request_id: string | null;
  error_code: string | null;
  action_reason: string | null;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function database() {
  const db = getBindings().DB;
  if (!db) throw new ApiError(503, "DB_UNAVAILABLE", "房间服务暂时不可用");
  return db;
}

const schemaPromises = new WeakMap<object, Promise<void>>();

async function ensureSchema() {
  const db = database();
  let schemaPromise = schemaPromises.get(db as object);
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
          code TEXT PRIMARY KEY NOT NULL,
          status TEXT NOT NULL DEFAULT 'lobby',
          max_players INTEGER NOT NULL,
          host_player_id TEXT NOT NULL,
          state_json TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS room_players (
          id TEXT PRIMARY KEY NOT NULL,
          room_code TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          principal_type TEXT NOT NULL DEFAULT 'guest',
          account_key TEXT,
          owner_player_id TEXT,
          control_mode TEXT NOT NULL DEFAULT 'human',
          control_epoch INTEGER NOT NULL DEFAULT 0,
          scopes_json TEXT NOT NULL DEFAULT '[]',
          credential_expires_at TEXT,
          seat INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT,
          UNIQUE(room_code, seat)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS room_requests (
          room_code TEXT NOT NULL,
          request_id TEXT NOT NULL,
          player_id TEXT NOT NULL,
          request_hash TEXT,
          result_version INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(room_code, request_id)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS agent_pairings (
          id TEXT PRIMARY KEY NOT NULL,
          room_code TEXT NOT NULL,
          target_player_id TEXT NOT NULL,
          owner_player_id TEXT NOT NULL,
          code_hash TEXT NOT NULL UNIQUE,
          mode TEXT NOT NULL,
          scopes_json TEXT NOT NULL DEFAULT '[]',
          expires_at TEXT NOT NULL,
          claimed_at TEXT,
          revoked_at TEXT,
          agent_name TEXT,
          agent_runtime TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS agent_credentials (
          id TEXT PRIMARY KEY NOT NULL,
          room_code TEXT NOT NULL,
          target_player_id TEXT NOT NULL,
          owner_player_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          scopes_json TEXT NOT NULL DEFAULT '[]',
          control_epoch INTEGER NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          last_used_at TEXT,
          agent_name TEXT NOT NULL DEFAULT '自带 Agent',
          agent_runtime TEXT NOT NULL DEFAULT 'other',
          protocol_version TEXT NOT NULL DEFAULT 'mouju-agent/2.0',
          client_version TEXT,
          ready_at TEXT,
          last_heartbeat_at TEXT,
          last_snapshot_at TEXT,
          last_snapshot_version INTEGER,
          last_observed_version INTEGER,
          reported_phase TEXT NOT NULL DEFAULT 'connecting',
          heartbeat_seq INTEGER NOT NULL DEFAULT 0,
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_reported_error_code TEXT,
          last_server_error_code TEXT,
          last_action_attempt_at TEXT,
          last_action_accepted_at TEXT,
          last_timeout_at TEXT,
          consecutive_timeouts INTEGER NOT NULL DEFAULT 0,
          suspended_at TEXT,
          deadline_extension_decision_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS agent_events (
          id TEXT PRIMARY KEY NOT NULL,
          room_code TEXT NOT NULL,
          target_player_id TEXT NOT NULL,
          credential_id TEXT,
          type TEXT NOT NULL,
          game_version INTEGER,
          request_id TEXT,
          error_code TEXT,
          action_reason TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
      ]);

      const columns = await db.prepare("PRAGMA table_info(room_players)").all<{ name: string }>();
      const present = new Set((columns.results ?? []).map((entry: { name: string }) => entry.name));
      const additions: Array<[string, string]> = [
        ["principal_type", "ALTER TABLE room_players ADD COLUMN principal_type TEXT NOT NULL DEFAULT 'guest'"],
        ["account_key", "ALTER TABLE room_players ADD COLUMN account_key TEXT"],
        ["owner_player_id", "ALTER TABLE room_players ADD COLUMN owner_player_id TEXT"],
        ["control_mode", "ALTER TABLE room_players ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'human'"],
        ["control_epoch", "ALTER TABLE room_players ADD COLUMN control_epoch INTEGER NOT NULL DEFAULT 0"],
        ["scopes_json", "ALTER TABLE room_players ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[]'"],
        ["credential_expires_at", "ALTER TABLE room_players ADD COLUMN credential_expires_at TEXT"],
      ];
      const alters = additions.filter(([name]) => !present.has(name)).map(([, sql]) => db.prepare(sql));
      if (alters.length) await db.batch(alters);

      const credentialColumns = await db.prepare("PRAGMA table_info(agent_credentials)").all<{ name: string }>();
      const credentialPresent = new Set(
        (credentialColumns.results ?? []).map((entry: { name: string }) => entry.name),
      );
      const credentialAdditions: Array<[string, string]> = [
        ["agent_name", "ALTER TABLE agent_credentials ADD COLUMN agent_name TEXT NOT NULL DEFAULT '自带 Agent'"],
        ["agent_runtime", "ALTER TABLE agent_credentials ADD COLUMN agent_runtime TEXT NOT NULL DEFAULT 'other'"],
        ["protocol_version", "ALTER TABLE agent_credentials ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'mouju-agent/2.0'"],
        ["client_version", "ALTER TABLE agent_credentials ADD COLUMN client_version TEXT"],
        ["ready_at", "ALTER TABLE agent_credentials ADD COLUMN ready_at TEXT"],
        ["last_heartbeat_at", "ALTER TABLE agent_credentials ADD COLUMN last_heartbeat_at TEXT"],
        ["last_snapshot_at", "ALTER TABLE agent_credentials ADD COLUMN last_snapshot_at TEXT"],
        ["last_snapshot_version", "ALTER TABLE agent_credentials ADD COLUMN last_snapshot_version INTEGER"],
        ["last_observed_version", "ALTER TABLE agent_credentials ADD COLUMN last_observed_version INTEGER"],
        ["reported_phase", "ALTER TABLE agent_credentials ADD COLUMN reported_phase TEXT NOT NULL DEFAULT 'connecting'"],
        ["heartbeat_seq", "ALTER TABLE agent_credentials ADD COLUMN heartbeat_seq INTEGER NOT NULL DEFAULT 0"],
        ["retry_count", "ALTER TABLE agent_credentials ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0"],
        ["last_reported_error_code", "ALTER TABLE agent_credentials ADD COLUMN last_reported_error_code TEXT"],
        ["last_server_error_code", "ALTER TABLE agent_credentials ADD COLUMN last_server_error_code TEXT"],
        ["last_action_attempt_at", "ALTER TABLE agent_credentials ADD COLUMN last_action_attempt_at TEXT"],
        ["last_action_accepted_at", "ALTER TABLE agent_credentials ADD COLUMN last_action_accepted_at TEXT"],
        ["last_timeout_at", "ALTER TABLE agent_credentials ADD COLUMN last_timeout_at TEXT"],
        ["consecutive_timeouts", "ALTER TABLE agent_credentials ADD COLUMN consecutive_timeouts INTEGER NOT NULL DEFAULT 0"],
        ["suspended_at", "ALTER TABLE agent_credentials ADD COLUMN suspended_at TEXT"],
        ["deadline_extension_decision_id", "ALTER TABLE agent_credentials ADD COLUMN deadline_extension_decision_id TEXT"],
      ];
      const credentialAlters = credentialAdditions
        .filter(([name]) => !credentialPresent.has(name))
        .map(([, sql]) => db.prepare(sql));
      if (credentialAlters.length) await db.batch(credentialAlters);

      const requestColumns = await db.prepare("PRAGMA table_info(room_requests)").all<{ name: string }>();
      const requestPresent = new Set((requestColumns.results ?? []).map((entry: { name: string }) => entry.name));
      if (!requestPresent.has("request_hash")) {
        await db.prepare("ALTER TABLE room_requests ADD COLUMN request_hash TEXT").run();
      }

      const eventColumns = await db.prepare("PRAGMA table_info(agent_events)").all<{ name: string }>();
      const eventPresent = new Set((eventColumns.results ?? []).map((entry: { name: string }) => entry.name));
      if (!eventPresent.has("action_reason")) {
        await db.prepare("ALTER TABLE agent_events ADD COLUMN action_reason TEXT").run();
      }

      // Seats created by the v1 Agent API carried a reusable token directly on
      // room_players. Retire those credentials during the in-place upgrade so
      // they cannot accidentally inherit guest/owner privileges from column
      // defaults. Hosts can reconnect them through the short-lived pairing flow.
      await db
        .prepare(`UPDATE room_players
          SET principal_type = 'agent',
              owner_player_id = COALESCE(owner_player_id, (SELECT host_player_id FROM rooms WHERE code = room_code)),
              control_mode = 'pairing',
              scopes_json = ?,
              credential_expires_at = NULL,
              token_hash = 'retired:' || id
          WHERE kind = 'agent' AND principal_type <> 'agent'`)
        .bind(JSON.stringify(AGENT_SCOPES))
        .run();
      await db.batch([
        db.prepare("CREATE INDEX IF NOT EXISTS room_players_room_idx ON room_players(room_code, seat)"),
        db.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS room_players_room_account_idx ON room_players(room_code, account_key)",
        ),
        db.prepare("CREATE INDEX IF NOT EXISTS room_requests_created_idx ON room_requests(room_code, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS agent_pairings_target_idx ON agent_pairings(target_player_id, expires_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS agent_credentials_target_idx ON agent_credentials(target_player_id, control_epoch)"),
        db.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS agent_credentials_target_epoch_idx ON agent_credentials(target_player_id, control_epoch)",
        ),
        db.prepare("CREATE INDEX IF NOT EXISTS agent_events_target_idx ON agent_events(room_code, target_player_id, created_at)"),
      ]);
    })().catch((error) => {
      schemaPromises.delete(db as object);
      throw error;
    });
    schemaPromises.set(db as object, schemaPromise);
  }
  await schemaPromise;
}

function cleanName(input: unknown, fallback: string) {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  return (name || fallback).slice(0, 16);
}

function cleanAgentReason(input: unknown) {
  if (typeof input !== "string") return null;
  const reason = input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return reason ? reason.slice(0, 120) : null;
}

function requireAgentReason(input: unknown) {
  if (typeof input !== "string" || !input.trim()) {
    throw new ApiError(400, "ACTION_REASON_REQUIRED", "Agent 每次行动都必须提交一句简短理由");
  }
  if (/[\r\n]/.test(input)) {
    throw new ApiError(400, "BAD_ACTION_REASON", "行动理由必须是一句话，不能包含换行");
  }
  const reason = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const length = Array.from(reason).length;
  if (length < 8 || length > 120) {
    throw new ApiError(400, "BAD_ACTION_REASON", "行动理由需要 8–120 个字符");
  }
  if ((reason.match(/[。！？.!?]/g) ?? []).length > 1) {
    throw new ApiError(400, "BAD_ACTION_REASON", "行动理由只能包含一句话");
  }
  if (/(思维链|chain[- ]of[- ]thought|系统提示|prompt|模型输出|执行(?:当前)?合法动作|选择(?:这个|此)动作)/i.test(reason)) {
    throw new ApiError(400, "BAD_ACTION_REASON", "请说明具体战术目的，不要提交占位文字、提示词或思维链");
  }
  return reason;
}

function usesRequiredAgentReason(protocol: string | undefined) {
  return protocol === "mouju-agent/2.1" || protocol === "mouju-agent/2.2" || protocol === "mouju-agent/2.3" || protocol === "mouju-agent/2.4";
}

function normalizeCode(input: unknown) {
  const code = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new ApiError(400, "BAD_ROOM_CODE", "请输入 6 位房间码");
  return code;
}

function normalizePairingCode(input: unknown) {
  const code = typeof input === "string" ? input.trim().toUpperCase().replace(/[^A-Z2-9]/g, "") : "";
  if (code.length !== 12) throw new ApiError(400, "BAD_PAIRING_CODE", "请输入 12 位 Agent 配对码");
  return code;
}

function opaqueToken(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function pairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function prepareOwnedPairing(room: string, playerId: string, seatName: string, controlEpoch: number) {
  const code = pairingCode();
  const pairingId = `pair_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const expiresAt = futureIso(PAIRING_TTL_MS);
  return {
    pairingId,
    code,
    codeHash: await tokenHash(code.replaceAll("-", "")),
    expiresAt,
    response: {
      pairingId,
      pairingCode: code,
      room,
      playerId,
      seatName,
      mode: "delegate" as const,
      scopes: AGENT_SCOPES,
      controlEpoch,
      expiresAt,
    },
  };
}

async function tokenHash(raw: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function futureIso(durationMs: number) {
  return new Date(Date.now() + durationMs).toISOString();
}

function timestamp(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
}

function expired(value: string | null | undefined) {
  return Boolean(value && timestamp(value) <= Date.now());
}

function scopes(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function hydratePlayer(row: PlayerRow): PlayerRow {
  return {
    ...row,
    principal_type: row.principal_type ?? (row.kind === "agent" ? "agent" : "guest"),
    account_key: row.account_key ?? null,
    owner_player_id: row.owner_player_id ?? row.id,
    control_mode: row.control_mode ?? (row.kind === "agent" ? "agent" : "human"),
    control_epoch: Number(row.control_epoch ?? 0),
    scopes_json: row.scopes_json ?? "[]",
    credential_expires_at: row.credential_expires_at ?? null,
  };
}

async function roomRow(codeInput: unknown): Promise<RoomRow> {
  const code = normalizeCode(codeInput);
  const row = await database().prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
  if (!row) throw new ApiError(404, "ROOM_NOT_FOUND", "没有找到这个房间");
  return row;
}

async function roomPlayers(code: string): Promise<PlayerRow[]> {
  const result = await database()
    .prepare("SELECT * FROM room_players WHERE room_code = ? ORDER BY seat ASC")
    .bind(code)
    .all<PlayerRow>();
  return (result.results ?? []).map(hydratePlayer);
}

async function playerById(id: string) {
  const row = await database().prepare("SELECT * FROM room_players WHERE id = ?").bind(id).first<PlayerRow>();
  return row ? hydratePlayer(row) : null;
}

async function accountKeyFor(request: Request) {
  const identity = await getRequestIdentity(request);
  return identity ? { identity, key: await tokenHash(identity.subjectKey) } : null;
}

async function authenticatedPlayer(request: Request, code: string, required = true): Promise<PlayerRow | null> {
  const authorization = request.headers.get("authorization");
  const raw = bearer(request);
  if (authorization && !raw) {
    throw new ApiError(401, "TOKEN_INVALID", "Authorization 必须使用有效的 Bearer 席位凭证");
  }
  if (raw) {
    const hash = await tokenHash(raw);
    const seat = await database()
      .prepare("SELECT * FROM room_players WHERE room_code = ? AND token_hash = ?")
      .bind(code, hash)
      .first<PlayerRow>();
    if (seat) {
      const found = hydratePlayer(seat);
      if (found.principal_type === "guest" && found.kind === "human" && !expired(found.credential_expires_at)) {
        found.auth_via = "guest";
        found.auth_scopes = [];
        return found;
      }
    } else {
      const delegated = await database()
        .prepare(`SELECT p.*, c.id AS auth_credential_id, c.scopes_json AS auth_scopes_json,
          c.control_epoch AS auth_control_epoch, c.expires_at AS auth_expires_at,
          c.suspended_at AS auth_suspended_at, c.protocol_version AS auth_protocol_version
          FROM agent_credentials c
          JOIN room_players p ON p.id = c.target_player_id AND p.room_code = c.room_code
          JOIN rooms r ON r.code = c.room_code
          WHERE c.room_code = ? AND c.token_hash = ? AND c.revoked_at IS NULL AND r.status <> 'finished'`)
        .bind(code, hash)
        .first<PlayerRow & {
          auth_credential_id: string;
          auth_scopes_json: string;
          auth_control_epoch: number;
          auth_expires_at: string;
        }>();
      if (
        delegated &&
        !expired(delegated.auth_expires_at) &&
        delegated.control_mode === "agent" &&
        Number(delegated.control_epoch) === Number(delegated.auth_control_epoch)
      ) {
        const found = hydratePlayer(delegated);
        found.auth_via = "agent";
        found.auth_scopes = scopes(delegated.auth_scopes_json);
        found.auth_credential_id = delegated.auth_credential_id;
        found.auth_suspended_at = delegated.auth_suspended_at;
        found.auth_protocol_version = delegated.auth_protocol_version;
        return found;
      }
    }

    // An explicit Authorization header is authoritative. Never fall through to
    // ambient account cookies after a bad bearer token: doing so would turn an
    // expired/revoked Agent request into a logged-in human request.
    throw new ApiError(401, "TOKEN_INVALID", "席位凭证无效、已过期或已被撤销");
  }

  const account = await accountKeyFor(request);
  if (account) {
    const row = await database()
      .prepare("SELECT * FROM room_players WHERE room_code = ? AND account_key = ?")
      .bind(code, account.key)
      .first<PlayerRow>();
    if (row) {
      const found = hydratePlayer(row);
      found.auth_via = "account";
      found.auth_scopes = [];
      return found;
    }
  }

  if (required) {
    throw new ApiError(401, "IDENTITY_REQUIRED", "席位身份已失效或尚未加入房间");
  }
  return null;
}

function requireSeatOwner(row: PlayerRow | null) {
  if (!row || row.auth_via === "agent" || row.principal_type === "agent" || row.kind === "agent") {
    throw new ApiError(403, "OWNER_REQUIRED", "Agent 不能管理房间、席位或再次创建授权");
  }
}

function canObserve(row: PlayerRow | null) {
  return Boolean(row && (row.auth_via !== "agent" || (row.auth_scopes ?? []).includes("game:observe:self")));
}

function canAct(row: PlayerRow | null) {
  if (!row) return false;
  if (row.auth_via === "agent") {
    return (
      row.control_mode === "agent" &&
      !row.auth_suspended_at &&
      (row.auth_scopes ?? []).includes("game:act:self")
    );
  }
  return row.control_mode === "human";
}

function canTick(row: PlayerRow | null) {
  return Boolean(row && (row.auth_via !== "agent" || (row.auth_scopes ?? []).includes("game:heartbeat:self")));
}

function connected(lastSeen: string | null) {
  return Boolean(lastSeen && Date.now() - timestamp(lastSeen) < 35_000);
}

function eventId() {
  return `evt_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
}

function latestIso(...values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  return valid.sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null;
}

function ageMs(value: string | null | undefined) {
  return value ? Math.max(0, Date.now() - timestamp(value)) : null;
}

function approximateLastSeen(value: string | null) {
  const age = ageMs(value);
  if (age === null) return null;
  if (age < 15_000) return "刚刚";
  if (age < 90_000) return "约 1 分钟前";
  return "较久前";
}

function decisionActorId(game: GameState | null) {
  if (!game) return null;
  if (game.engineVersion === 2) return game.pending?.actorId ?? game.turn?.playerId ?? null;
  return game.pending?.targetId ?? game.turn?.playerId ?? null;
}

function decisionId(room: RoomRow, game: GameState | null) {
  if (!game || game.status === "finished") return null;
  if (game.engineVersion === 2) {
    if (game.pending) return `v${room.version}:d:${game.pending.id}:${game.pending.actorId}`;
    return game.turn ? `v${room.version}:turn:${game.turn.playerId}:${game.turn.phase}` : null;
  }
  if (game.pending) {
    return `v${room.version}:response:${game.pending.targetId}:${game.pending.kind}:${game.pending.remaining}`;
  }
  return game.turn ? `v${room.version}:turn:${game.turn.playerId}:${game.turn.phase}` : null;
}

function decisionWindowMs(game: GameState, agentControlled: boolean) {
  if (agentControlled) return game.pending ? AGENT_RESPONSE_WINDOW_MS : AGENT_TURN_WINDOW_MS;
  return game.pending ? HUMAN_RESPONSE_WINDOW_MS : HUMAN_TURN_WINDOW_MS;
}

async function applyDecisionWindow(game: GameState, knownPlayers?: PlayerRow[]) {
  if (game.status === "finished" || !game.deadlineAt) return;
  const actorId = decisionActorId(game);
  if (!actorId) return;
  const actor = knownPlayers?.find((entry) => entry.id === actorId) ?? await playerById(actorId);
  if (!actor) return;
  game.deadlineAt = new Date(Date.now() + decisionWindowMs(game, actor.control_mode === "agent")).toISOString();
}

async function currentAgentCredentials(roomCode: string) {
  const result = await database()
    .prepare("SELECT * FROM agent_credentials WHERE room_code = ? AND revoked_at IS NULL ORDER BY created_at DESC")
    .bind(roomCode)
    .all<AgentCredentialRow>();
  const map = new Map<string, AgentCredentialRow>();
  for (const entry of result.results ?? []) {
    const key = `${entry.target_player_id}:${Number(entry.control_epoch)}`;
    if (!map.has(key)) map.set(key, { ...entry, control_epoch: Number(entry.control_epoch) });
  }
  return map;
}

async function pendingAgentPairings(roomCode: string) {
  const result = await database()
    .prepare(`SELECT * FROM agent_pairings
      WHERE room_code = ? AND claimed_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC`)
    .bind(roomCode)
    .all<PairingRow>();
  const map = new Map<string, PairingRow>();
  for (const entry of result.results ?? []) {
    if (!map.has(entry.target_player_id)) map.set(entry.target_player_id, entry);
  }
  return map;
}

function agentPublicStatus(
  room: RoomRow,
  game: GameState | null,
  row: PlayerRow,
  credential: AgentCredentialRow | undefined,
  pairing: PairingRow | undefined,
) {
  const activeDecision = decisionActorId(game) === row.id;
  let state: AgentPublicState;
  let label: string;
  let attention: "none" | "warning" | "critical" = "none";
  let activityAt: string | null = null;
  let ready = false;

  if (row.control_mode === "pairing") {
    const pairingExpired = !pairing || expired(pairing.expires_at);
    state = pairingExpired ? "pairing_expired" : "pairing";
    label = pairingExpired ? "配对已过期" : "等待 Agent 配对";
    attention = "warning";
  } else if (!credential || expired(credential.expires_at)) {
    state = "offline";
    label = "Agent 授权失效";
    attention = "critical";
  } else if (credential.suspended_at) {
    state = "safe_mode";
    label = "系统安全托管";
    attention = "critical";
    activityAt = latestIso(credential.last_used_at, credential.last_heartbeat_at);
  } else {
    activityAt = latestIso(
      credential.last_used_at,
      credential.last_heartbeat_at,
      credential.last_action_attempt_at,
      credential.last_action_accepted_at,
    ) ?? credential.created_at;
    const activityAge = ageMs(activityAt);
    const syncingLobby = room.status === "lobby" && Number(credential.last_observed_version) !== room.version;
    ready = Boolean(credential.ready_at) && !syncingLobby;
    if (!ready) {
      if ((ageMs(activityAt) ?? 0) > AGENT_CONNECT_TIMEOUT_MS) {
        state = "offline";
        label = credential.last_snapshot_at ? "CLI 双心跳验证超时" : "CLI 接入超时";
        attention = "critical";
      } else {
        state = "connecting";
        label = credential.last_snapshot_at ? "Agent 同步中" : "Agent 连接中";
        attention = "warning";
      }
    } else {
      const healthyFor = activeDecision ? 12_000 : 35_000;
      const offlineAfter = activeDecision ? 25_000 : 60_000;
      if (activityAge === null || activityAge > offlineAfter) {
        state = "offline";
        label = "Agent 心跳中断";
        attention = "critical";
      } else if (activityAge > healthyFor) {
        state = "delayed";
        label = "Agent 网络延迟";
        attention = "warning";
      } else if (credential.last_timeout_at && (ageMs(credential.last_timeout_at) ?? Infinity) < 15_000) {
        state = "timed_out";
        label = "本次已超时托管";
        attention = "warning";
      } else if (credential.reported_phase === "unattended") {
        state = "unattended";
        label = activeDecision ? "Agent 未守候本次行动" : "Agent 未持续守候";
        attention = "critical";
        ready = false;
      } else if (activeDecision && credential.reported_phase === "submitting") {
        state = "submitting";
        label = "Agent 正在提交";
      } else if (activeDecision && credential.reported_phase === "planning") {
        state = "acting";
        label = "Agent 正在行动";
      } else if (
        credential.last_action_accepted_at &&
        (ageMs(credential.last_action_accepted_at) ?? Infinity) < 8_000
      ) {
        state = "accepted";
        label = "动作已由服务器接受";
      } else if (activeDecision) {
        state = "acting";
        label = "等待 Agent 行动";
      } else {
        state = "ready";
        label = room.status === "lobby" ? "Agent 已就绪" : "Agent 在线待机";
      }
    }
  }

  return {
    state,
    label,
    ready,
    activeDecision,
    attention,
    lastSeenApprox: approximateLastSeen(activityAt),
    consecutiveTimeouts: Number(credential?.consecutive_timeouts ?? 0),
  };
}

function startBlockers(
  room: RoomRow,
  rows: PlayerRow[],
  credentials: Map<string, AgentCredentialRow>,
) {
  const counts = new Map<string, number>();
  const add = (code: string) => counts.set(code, (counts.get(code) ?? 0) + 1);
  if (rows.length < (room.max_players === 2 ? 2 : 4)) add("NOT_ENOUGH_PLAYERS");
  for (const row of rows) {
    if (row.control_mode === "pairing") {
      add("AGENT_PAIRING");
      continue;
    }
    if (row.control_mode !== "agent") continue;
    const credential = credentials.get(`${row.id}:${row.control_epoch}`);
    if (!credential || expired(credential.expires_at) || credential.suspended_at) {
      add("AGENT_OFFLINE");
      continue;
    }
    if (!credential.ready_at || Number(credential.last_observed_version) !== room.version) {
      add("AGENT_NOT_READY");
      continue;
    }
    if (!credential.last_heartbeat_at || (ageMs(credential.last_heartbeat_at) ?? Infinity) > 60_000) {
      add("AGENT_OFFLINE");
      continue;
    }
    if (credential.reported_phase === "unattended") {
      add("AGENT_UNATTENDED");
    }
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}

function eventSummary(event: AgentEventRow) {
  const summaries: Record<string, string> = {
    pairing_claimed: "Agent 已领取席位凭证",
    ready: `已确认房间版本 V${event.game_version ?? "?"}`,
    action_accepted: `服务器已接受动作${event.game_version ? ` · V${event.game_version}` : ""}`,
    action_rejected: `动作被服务器拒绝${event.error_code ? ` · ${event.error_code}` : ""}`,
    timeout: "本次行动超时，服务器执行安全默认动作",
    suspended: "连续超时，已切换为系统安全托管",
    unattended: "CLI 在线，但 Agent 决策循环没有持续守候",
    attended: "Agent 已恢复持续守候",
    takeover: "席位所有者已收回真人控制",
  };
  return summaries[event.type] ?? "Agent 状态已更新";
}

async function ownerAgentDiagnostics(
  room: RoomRow,
  viewer: PlayerRow,
  credential: AgentCredentialRow | undefined,
  publicStatus: ReturnType<typeof agentPublicStatus> | undefined,
) {
  if (viewer.auth_via === "agent" || viewer.control_mode !== "agent" || !credential || !publicStatus) return null;
  const events = await database()
    .prepare(`SELECT id, type, game_version, request_id, error_code, action_reason, created_at
      FROM agent_events WHERE room_code = ? AND target_player_id = ?
      ORDER BY created_at DESC LIMIT 60`)
    .bind(room.code, viewer.id)
    .all<AgentEventRow>();
  const lastCommunicationAt = latestIso(
    credential.last_used_at,
    credential.last_heartbeat_at,
    credential.last_action_attempt_at,
    credential.last_action_accepted_at,
  );
  return {
    agentName: credential.agent_name,
    runtime: credential.agent_runtime,
    protocolVersion: credential.protocol_version,
    clientVersion: credential.client_version,
    state: publicStatus.state,
    label: publicStatus.label,
    readyAt: credential.ready_at,
    lastCommunicationAt,
    communicationAgeMs: ageMs(lastCommunicationAt),
    lastHeartbeatAt: credential.last_heartbeat_at,
    lastSnapshotAt: credential.last_snapshot_at,
    lastSnapshotVersion: credential.last_snapshot_version,
    lastObservedVersion: credential.last_observed_version,
    currentVersion: room.version,
    reportedPhase: credential.reported_phase,
    reportedPhaseIsSelfReported: true,
    retryCount: Number(credential.retry_count ?? 0),
    lastReportedErrorCode: credential.last_reported_error_code,
    lastServerErrorCode: credential.last_server_error_code,
    lastActionAttemptAt: credential.last_action_attempt_at,
    lastActionAcceptedAt: credential.last_action_accepted_at,
    lastTimeoutAt: credential.last_timeout_at,
    consecutiveTimeouts: Number(credential.consecutive_timeouts ?? 0),
    suspendedAt: credential.suspended_at,
    expiresAt: credential.expires_at,
    controlEpoch: Number(credential.control_epoch),
    scopes: scopes(credential.scopes_json),
    events: (events.results ?? []).map((event) => ({
      id: event.id,
      type: event.type,
      at: event.created_at,
      summary: eventSummary(event),
      reason: event.type === "action_accepted" ? event.action_reason : null,
    })),
  };
}

function parseState(room: RoomRow): GameState | null {
  if (!room.state_json) return null;
  try {
    const parsed = JSON.parse(room.state_json) as GameState;
    if (!parsed || typeof parsed !== "object" || (parsed.engineVersion !== 1 && parsed.engineVersion !== 2)) {
      throw new Error("unknown engine state");
    }
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.deck) || !Array.isArray(parsed.discard)) {
      throw new Error("missing state zones");
    }
    if (parsed.engineVersion === 2) {
      if (!Array.isArray(parsed.triggers)) parsed.triggers = [];
      parsed.mode ??= parsed.players.length === 2 ? "duel" : "identity";
      parsed.rngMode ??= "xorshift32-legacy";
      for (const target of parsed.players) target.generalEpoch ??= 0;
      assertGameInvariantV2(parsed);
    }
    return parsed;
  } catch {
    throw new ApiError(500, "STATE_CORRUPT", "房间状态无法读取");
  }
}

function playerPublicView(
  game: GameState | null,
  row: PlayerRow,
  agentStatus: ReturnType<typeof agentPublicStatus> | undefined,
  viewerId?: string,
) {
  const base = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    principalType: row.principal_type,
    controlMode: row.control_mode,
    seat: row.seat,
    connected: agentStatus
      ? ["ready", "acting", "submitting", "accepted"].includes(agentStatus.state)
      : connected(row.last_seen_at),
    agentStatus,
  };
  const gamePlayer = game?.players.find((entry) => entry.id === row.id);
  if (!gamePlayer) return base;
  const duelSidesReady = game.players.length !== 2
    || game.engineVersion !== 2
    || Boolean(game.duelFirstPlayerId);
  const revealRole =
    game?.status === "finished"
    || (game?.players.length === 2 && duelSidesReady)
    || gamePlayer.role === "lord"
    || !gamePlayer.alive
    || viewerId === gamePlayer.id;
  const weapon = game?.engineVersion === 2 ? gamePlayer.equipment.weapon : gamePlayer.weapon;
  const judgment = game?.engineVersion === 2
    ? gamePlayer.judgment.map((card) => card.asName ? { ...card, name: card.asName } : card)
    : [];
  const character = gamePlayer.character
    ? { ...gamePlayer.character, kingdomName: kingdomName(gamePlayer.character.kingdom) }
    : null;
  return {
    ...base,
    alive: gamePlayer.alive,
    hp: gamePlayer.hp,
    maxHp: gamePlayer.maxHp,
    handCount: gamePlayer.hand.length,
    hand: viewerId === gamePlayer.id ? gamePlayer.hand : undefined,
    weapon,
    equipment: game?.engineVersion === 2 ? gamePlayer.equipment : { weapon, armor: null, offensiveHorse: null, defensiveHorse: null },
    judgment,
    role: revealRole ? gamePlayer.role : null,
    roleName: revealRole
      ? game?.players.length === 2
        ? gamePlayer.id === (game?.engineVersion === 2 ? game.duelFirstPlayerId : undefined) ? "先手" : "后手"
        : roleName(gamePlayer.role)
      : "未知",
    character,
    duelReserveCount: game?.engineVersion === 2 && game.players.length === 2
      ? Math.max(0, (gamePlayer.duelLineup?.length ?? 0) - (gamePlayer.character ? 1 : 0))
      : undefined,
    duelDefeatedCount: game?.engineVersion === 2 && game.players.length === 2
      ? gamePlayer.duelDefeated?.length ?? 0
      : undefined,
    duelRoster: game?.engineVersion === 2 && game.players.length === 2 && viewerId === gamePlayer.id
      ? (gamePlayer.duelRoster ?? []).map((id) => {
          const general = STANDARD_CHARACTERS.find((entry) => entry.id === id)!;
          return { id: general.id, name: general.name, title: general.title, skillName: general.skillName, skillText: general.skillText };
        })
      : undefined,
    duelLineup: game?.engineVersion === 2 && game.players.length === 2 && viewerId === gamePlayer.id
      ? (gamePlayer.duelLineup ?? []).map((id) => {
          const general = STANDARD_CHARACTERS.find((entry) => entry.id === id)!;
          return { id: general.id, name: general.name, title: general.title, skillName: general.skillName, skillText: general.skillText };
        })
      : undefined,
    duelDefeated: game?.engineVersion === 2 && game.players.length === 2
      ? (gamePlayer.duelDefeated ?? []).map((id) => STANDARD_CHARACTERS.find((entry) => entry.id === id)?.name ?? id)
      : undefined,
  };
}

async function makeView(room: RoomRow, viewer: PlayerRow | null, alreadyApplied = false) {
  const [rows, credentials, pairings] = await Promise.all([
    roomPlayers(room.code),
    currentAgentCredentials(room.code),
    pendingAgentPairings(room.code),
  ]);
  if (room.status === "lobby" && rows.length === 0) {
    throw new ApiError(404, "ROOM_CLOSED", "空房间已经关闭");
  }
  if (viewer && !rows.some((row) => row.id === viewer.id)) {
    throw new ApiError(401, "TOKEN_INVALID", "这个席位已经离开房间");
  }
  const game = parseState(room);
  const viewerId = viewer?.id;
  const viewerCanAct = canAct(viewer);
  const viewerPairing = viewer?.control_mode === "pairing";
  const pending = game?.pending;
  const pendingActorId = game?.engineVersion === 2 ? pending?.actorId : pending?.targetId;
  const turnPlayer = game?.turn ? game.players.find((entry) => entry.id === game.turn!.playerId) : null;
  const statuses = new Map(
    rows
      .filter((row) => row.control_mode !== "human")
      .map((row) => [
        row.id,
        agentPublicStatus(
          room,
          game,
          row,
          credentials.get(`${row.id}:${row.control_epoch}`),
          pairings.get(row.id),
        ),
      ] as const),
  );
  const blockers = startBlockers(room, rows, credentials);
  const ownStatus = viewer ? statuses.get(viewer.id) : undefined;
  const ownCredential = viewer ? credentials.get(`${viewer.id}:${viewer.control_epoch}`) : undefined;
  const diagnostics = viewer
    ? await ownerAgentDiagnostics(room, viewer, ownCredential, ownStatus)
    : null;
  let decision = "等待房主开始对局";
  if (game?.status === "finished") decision = game.winner?.label ?? "对局结束";
  else if (pending) {
    const target = game.players.find((entry) => entry.id === pendingActorId);
    decision =
      target?.id === viewerId
        ? viewerCanAct
          ? game.engineVersion === 2 ? pending.prompt : `请打出【${pending.required}】或放弃响应`
          : viewerPairing
            ? "正在等待你的 Agent 完成配对"
            : ownStatus?.state === "safe_mode"
              ? "系统将在截止时执行安全动作"
              : ownStatus?.label ?? "你的 Agent 正在处理本次响应"
        : `等待 ${target?.name ?? "玩家"}${game.engineVersion === 2 ? "处理当前决策" : "响应"}`;
  } else if (turnPlayer) {
    decision =
      turnPlayer.id === viewerId
        ? viewerCanAct
          ? "你的出牌阶段"
          : viewerPairing
            ? "正在等待你的 Agent 完成配对"
            : ownStatus?.state === "safe_mode"
              ? "系统安全托管中"
              : ownStatus?.label ?? "你的 Agent 正在托管此席位"
        : `等待 ${turnPlayer.name} 行动`;
  }

  return {
    ok: true,
    alreadyApplied,
    serverTime: new Date().toISOString(),
    room: {
      code: room.code,
      status: room.status,
      maxPlayers: room.max_players,
      mode: room.max_players === 2 ? "duel" : "identity",
      hostPlayerId: room.host_player_id,
      version: room.version,
      createdAt: room.created_at,
      updatedAt: room.updated_at,
      canStart: room.status === "lobby" && blockers.length === 0,
      startBlockers: blockers,
    },
    players: rows.map((row) => playerPublicView(game, row, statuses.get(row.id), viewerId)),
    you: viewer
      ? {
          playerId: viewer.id,
          name: viewer.name,
          kind: viewer.kind,
          isHost: viewer.id === room.host_player_id,
          identityType: viewer.auth_via === "agent" ? "agent" : viewer.principal_type,
          authVia: viewer.auth_via,
          controlMode: viewer.control_mode,
          controlEpoch: viewer.control_epoch,
          canAct: viewerCanAct,
          scopes: viewer.auth_scopes ?? [],
          agentDiagnostics: diagnostics,
        }
      : null,
    game: game
      ? {
          status: game.status,
          round: game.round,
          turnPlayerId: game.turn?.playerId ?? null,
          phase: game.turn?.phase ?? null,
          pending: pending
            ? game.engineVersion === 2
              ? { kind: pending.kind, targetId: pending.actorId, prompt: pending.prompt, required: null, remaining: null }
              : { kind: pending.kind, targetId: pending.targetId, required: pending.required, remaining: pending.remaining }
            : null,
          deckCount: game.deck.length,
          discardTop: game.discard.at(-1) ?? null,
          logs: game.logs,
          winner: game.winner,
          deadlineAt: game.deadlineAt,
          decisionId: decisionId(room, game),
          decision,
          legalActions: viewerId && viewerCanAct ? getLegalActions(game, viewerId) : [],
          ruleset: game.engineVersion === 2
            ? game.players.length === 2
              ? "经典三将1V1 · 标准25将池 + EX"
              : "经典标准身份局 · 2009/2011 + EX"
            : "谋局核心简化规则 v1",
          mode: game.engineVersion === 2
            ? game.mode ?? (game.players.length === 2 ? "duel" : "identity")
            : "identity",
          engineVersion: game.engineVersion,
          rulesetId: game.engineVersion === 2 ? game.rulesetId : "mouju-core-v1",
        }
      : null,
  };
}

async function newRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const random = new Uint8Array(6);
    crypto.getRandomValues(random);
    const code = Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
    if (!(await database().prepare("SELECT code FROM rooms WHERE code = ?").bind(code).first())) return code;
  }
  throw new ApiError(503, "CODE_EXHAUSTED", "暂时无法创建房间，请稍后重试");
}

function directViewer(row: PlayerRow, via: AuthVia) {
  const viewer = hydratePlayer(row);
  viewer.auth_via = via;
  viewer.auth_scopes = via === "agent" ? scopes(viewer.scopes_json) : [];
  return viewer;
}

export async function createRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const account = await accountKeyFor(request);
  const requestedPlayers = Number(payload.maxPlayers) || 5;
  const maxPlayers = requestedPlayers === 2 ? 2 : Math.max(4, Math.min(10, requestedPlayers));
  const name = cleanName(payload.name, account?.identity.displayName ?? "无名主公");
  const code = await newRoomCode();
  const playerId = `p_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const rawToken = opaqueToken(account ? "seat" : "guest");
  const hash = await tokenHash(rawToken);
  const principal: PrincipalType = account ? "account" : "guest";
  const expiresAt = account ? null : futureIso(GUEST_TTL_MS);
  const wantsAgent = payload.participation === "agent";
  const initialEpoch = wantsAgent ? 1 : 0;
  const preparedPairing = wantsAgent ? await prepareOwnedPairing(code, playerId, name, initialEpoch) : null;
  const db = database();
  const statements = [
    db
      .prepare(
        "INSERT INTO rooms (code, status, max_players, host_player_id, state_json, version) VALUES (?, 'lobby', ?, ?, NULL, 1)",
      )
      .bind(code, maxPlayers, playerId),
    db
      .prepare(`INSERT INTO room_players
        (id, room_code, name, kind, principal_type, account_key, owner_player_id, control_mode,
         control_epoch, scopes_json, credential_expires_at, seat, token_hash, last_seen_at)
        VALUES (?, ?, ?, 'human', ?, ?, ?, ?, ?, '[]', ?, 0, ?, CURRENT_TIMESTAMP)`)
      .bind(
        playerId,
        code,
        name,
        principal,
        account?.key ?? null,
        playerId,
        wantsAgent ? "pairing" : "human",
        initialEpoch,
        expiresAt,
        hash,
      ),
  ];
  if (preparedPairing) {
    statements.push(
      db
        .prepare(`INSERT INTO agent_pairings
          (id, room_code, target_player_id, owner_player_id, code_hash, mode, scopes_json, expires_at)
          VALUES (?, ?, ?, ?, ?, 'delegate', ?, ?)`)
        .bind(
          preparedPairing.pairingId,
          code,
          playerId,
          playerId,
          preparedPairing.codeHash,
          JSON.stringify(AGENT_SCOPES),
          preparedPairing.expiresAt,
        ),
    );
  }
  const created = await db.batch(statements);
  if (!created.every((result: { meta: { changes?: number } }) => result.meta.changes === 1)) {
    throw new ApiError(409, "CREATE_RACE", "房间创建状态发生冲突，请重试");
  }
  const viewer = directViewer((await playerById(playerId))!, account ? "account" : "guest");
  return {
    ...(await makeView(await roomRow(code), viewer)),
    ...(preparedPairing ? { pairing: preparedPairing.response } : {}),
    ...(account ? {} : { guestToken: rawToken, playerToken: rawToken, guestExpiresAt: expiresAt }),
  };
}

export async function joinRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const account = await accountKeyFor(request);
  if (account) {
    const existing = await database()
      .prepare("SELECT * FROM room_players WHERE room_code = ? AND account_key = ?")
      .bind(room.code, account.key)
      .first<PlayerRow>();
    if (existing) {
      const ownedSeat = directViewer(existing, "account");
      if (payload.participation === "agent") {
        if (room.status === "finished") throw new ApiError(409, "GAME_FINISHED", "对局已经结束");
        const pairing = await createPairing(room, ownedSeat, ownedSeat);
        const refreshed = directViewer((await playerById(ownedSeat.id))!, "account");
        return { ...(await makeView(await roomRow(room.code), refreshed)), pairing };
      }
      if (payload.participation === "human" && ownedSeat.control_mode !== "human") {
        return revokeAgentControl(request, { room: room.code });
      }
      return makeView(room, ownedSeat);
    }
  }
  if (room.status !== "lobby") throw new ApiError(409, "GAME_STARTED", "对局已经开始");
  const rows = await roomPlayers(room.code);
  if (rows.length >= room.max_players) throw new ApiError(409, "ROOM_FULL", "房间已满");
  const usedSeats = new Set(rows.map((entry) => entry.seat));
  let seat = 0;
  while (usedSeats.has(seat)) seat += 1;
  const playerId = `p_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const rawToken = opaqueToken(account ? "seat" : "guest");
  const hash = await tokenHash(rawToken);
  const principal: PrincipalType = account ? "account" : "guest";
  const expiresAt = account ? null : futureIso(GUEST_TTL_MS);
  const name = cleanName(payload.name, account?.identity.displayName ?? `玩家${rows.length + 1}`);
  const wantsAgent = payload.participation === "agent";
  const initialEpoch = wantsAgent ? 1 : 0;
  const preparedPairing = wantsAgent
    ? await prepareOwnedPairing(room.code, playerId, name, initialEpoch)
    : null;
  try {
    const db = database();
    const statements = [
      db
        .prepare(`INSERT INTO room_players
          (id, room_code, name, kind, principal_type, account_key, owner_player_id, control_mode,
           control_epoch, scopes_json, credential_expires_at, seat, token_hash, last_seen_at)
          SELECT ?, ?, ?, 'human', ?, ?, ?, ?, ?, '[]', ?, ?, ?, CURRENT_TIMESTAMP
          WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'lobby' AND version = ?)`)
        .bind(
          playerId,
          room.code,
          name,
          principal,
          account?.key ?? null,
          playerId,
          wantsAgent ? "pairing" : "human",
          initialEpoch,
          expiresAt,
          seat,
          hash,
          room.code,
          room.version,
        ),
    ];
    if (preparedPairing) {
      statements.push(
        db
          .prepare(`INSERT INTO agent_pairings
            (id, room_code, target_player_id, owner_player_id, code_hash, mode, scopes_json, expires_at)
            SELECT ?, ?, ?, ?, ?, 'delegate', ?, ?
            WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'lobby' AND version = ?)
              AND EXISTS (SELECT 1 FROM room_players WHERE room_code = ? AND id = ? AND control_mode = 'pairing')`)
          .bind(
            preparedPairing.pairingId,
            room.code,
            playerId,
            playerId,
            preparedPairing.codeHash,
            JSON.stringify(AGENT_SCOPES),
            preparedPairing.expiresAt,
            room.code,
            room.version,
            room.code,
            playerId,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          "UPDATE rooms SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ? AND status = 'lobby'",
        )
        .bind(room.code, room.version),
    );
    const result = await db.batch(statements);
    if (!result.every((entry: { meta: { changes?: number } }) => entry.meta.changes === 1)) {
      throw new Error("join conflict");
    }
  } catch {
    throw new ApiError(409, "JOIN_RACE", "房间刚刚发生变化，请重试");
  }
  const viewer = directViewer((await playerById(playerId))!, account ? "account" : "guest");
  return {
    ...(await makeView(await roomRow(room.code), viewer)),
    ...(preparedPairing ? { pairing: preparedPairing.response } : {}),
    ...(account ? {} : { guestToken: rawToken, playerToken: rawToken, guestExpiresAt: expiresAt }),
  };
}

async function createPairing(
  room: RoomRow,
  target: PlayerRow,
  owner: PlayerRow,
) {
  const code = pairingCode();
  const codeHash = await tokenHash(code.replaceAll("-", ""));
  const pairingId = `pair_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const expiresAt = futureIso(PAIRING_TTL_MS);
  const nextEpoch = target.control_epoch + 1;
  const db = database();
  const result = await db.batch([
    db
      .prepare(`INSERT INTO agent_pairings
        (id, room_code, target_player_id, owner_player_id, code_hash, mode, scopes_json, expires_at)
        SELECT ?, ?, ?, ?, ?, 'delegate', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM room_players p
          JOIN rooms r ON r.code = p.room_code
          WHERE p.id = ? AND p.room_code = ? AND p.owner_player_id = ?
            AND p.kind = 'human' AND p.principal_type <> 'agent' AND p.control_epoch = ?
            AND r.version = ? AND r.status <> 'finished'
        )`)
      .bind(
        pairingId,
        room.code,
        target.id,
        owner.id,
        codeHash,
        JSON.stringify(AGENT_SCOPES),
        expiresAt,
        target.id,
        room.code,
        owner.id,
        target.control_epoch,
        room.version,
      ),
    db
      .prepare(`UPDATE room_players SET control_mode = 'pairing', control_epoch = ?
        WHERE id = ? AND room_code = ? AND owner_player_id = ? AND kind = 'human'
          AND principal_type <> 'agent' AND control_epoch = ?
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ? AND status <> 'finished')`)
      .bind(nextEpoch, target.id, room.code, owner.id, target.control_epoch, room.code, room.version),
    db
      .prepare(`UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(target.id, room.code, room.code, room.version),
    db
      .prepare(`UPDATE agent_pairings SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND id <> ?
          AND claimed_at IS NULL AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(target.id, room.code, pairingId, room.code, room.version),
    db
      .prepare(`UPDATE rooms SET version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE code = ? AND version = ? AND status <> 'finished'`)
      .bind(room.code, room.version),
  ]);
  if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1 || result[4].meta.changes !== 1) {
    throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
  }
  return {
    pairingId,
    pairingCode: code,
    room: room.code,
    playerId: target.id,
    seatName: target.name,
    mode: "delegate" as const,
    scopes: AGENT_SCOPES,
    controlEpoch: nextEpoch,
    expiresAt,
  };
}

export async function createAgentPairing(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const owner = await authenticatedPlayer(request, room.code);
  requireSeatOwner(owner);
  if (room.status === "finished") throw new ApiError(409, "GAME_FINISHED", "对局已经结束");
  const pairing = await createPairing(room, owner!, owner!);
  const refreshed = directViewer((await playerById(owner!.id))!, owner!.auth_via!);
  return { ...(await makeView(await roomRow(room.code), refreshed)), pairing };
}

export async function claimAgentPairing(payload: Record<string, unknown>) {
  await ensureSchema();
  const normalized = normalizePairingCode(payload.pairingCode);
  const hash = await tokenHash(normalized);
  const pairing = await database()
    .prepare("SELECT * FROM agent_pairings WHERE code_hash = ? AND claimed_at IS NULL AND revoked_at IS NULL")
    .bind(hash)
    .first<PairingRow>();
  if (!pairing || expired(pairing.expires_at)) {
    throw new ApiError(401, "PAIRING_EXPIRED", "配对码无效、已使用或已经过期");
  }
  const room = await roomRow(pairing.room_code);
  if (room.status === "finished") throw new ApiError(409, "GAME_FINISHED", "对局已经结束");
  const target = await playerById(pairing.target_player_id);
  if (!target) throw new ApiError(404, "SEAT_NOT_FOUND", "Agent 席位已被移除");
  const pairingMatchesSeat =
    target.room_code === pairing.room_code &&
    target.owner_player_id === pairing.owner_player_id &&
    target.control_mode === "pairing" &&
    (pairing.mode === "delegate"
      ? target.id === pairing.owner_player_id && target.kind === "human" && target.principal_type !== "agent"
      : pairing.mode === "standalone" && target.kind === "agent" && target.principal_type === "agent");
  if (!pairingMatchesSeat) throw new ApiError(401, "PAIRING_INVALID", "配对授权与目标席位不匹配");
  const nextEpoch = target.control_epoch + 1;
  const rawToken = opaqueToken("agent");
  const credentialHash = await tokenHash(rawToken);
  const credentialId = `agent_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const expiresAt = futureIso(AGENT_TTL_MS);
  const agentName = cleanName(
    typeof payload.agent === "object" && payload.agent
      ? (payload.agent as Record<string, unknown>).name
      : payload.agentName,
    "自带 Agent",
  );
  const runtime = cleanName(
    typeof payload.agent === "object" && payload.agent
      ? (payload.agent as Record<string, unknown>).runtime
      : payload.runtime,
    "other",
  );
  const agentPayload =
    typeof payload.agent === "object" && payload.agent
      ? (payload.agent as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const advertisedCapabilities = Array.isArray(agentPayload.capabilities)
    ? agentPayload.capabilities.filter((entry): entry is string => typeof entry === "string")
    : [];
  const missingCapabilities = AGENT_REQUIRED_CAPABILITIES.filter((entry) => !advertisedCapabilities.includes(entry));
  if (missingCapabilities.length) {
    throw new ApiError(
      400,
      "AGENT_CAPABILITIES_REQUIRED",
      `当前 Agent 客户端缺少协议能力：${missingCapabilities.join(", ")}；请重新读取最新 Agent Skill`,
    );
  }
  const clientVersion =
    typeof agentPayload.version === "string" ? agentPayload.version.trim().slice(0, 32) || null : null;
  const db = database();
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(`INSERT INTO agent_credentials
        (id, room_code, target_player_id, owner_player_id, token_hash, scopes_json, control_epoch, expires_at,
         agent_name, agent_runtime, protocol_version, client_version)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM agent_pairings a
          JOIN rooms r ON r.code = a.room_code
          JOIN room_players p ON p.id = a.target_player_id AND p.room_code = a.room_code
          WHERE a.id = ? AND a.claimed_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > ?
            AND r.status <> 'finished'
            AND p.control_epoch = ? AND p.control_mode = 'pairing' AND p.owner_player_id = a.owner_player_id
            AND (
              (a.mode = 'delegate' AND p.id = a.owner_player_id AND p.kind = 'human' AND p.principal_type <> 'agent')
              OR (a.mode = 'standalone' AND p.kind = 'agent' AND p.principal_type = 'agent')
            )
        )`)
      .bind(
        credentialId,
        room.code,
        target.id,
        pairing.owner_player_id,
        credentialHash,
        pairing.scopes_json,
        nextEpoch,
        expiresAt,
        agentName,
        runtime,
        AGENT_PROTOCOL,
        clientVersion,
        pairing.id,
        now,
        target.control_epoch,
      ),
    db
      .prepare(`UPDATE room_players SET control_mode = 'agent', control_epoch = ?
        WHERE id = ? AND room_code = ? AND owner_player_id = ? AND control_epoch = ? AND control_mode = 'pairing'
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status <> 'finished')
          AND EXISTS (SELECT 1 FROM agent_pairings WHERE id = ? AND claimed_at IS NULL
            AND revoked_at IS NULL AND expires_at > ?)`)
      .bind(
        nextEpoch,
        target.id,
        room.code,
        pairing.owner_player_id,
        target.control_epoch,
        room.code,
        pairing.id,
        now,
      ),
    db
      .prepare(`UPDATE agent_pairings SET claimed_at = CURRENT_TIMESTAMP, agent_name = ?, agent_runtime = ?
        WHERE id = ? AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
      .bind(agentName, runtime, pairing.id, now),
    db
      .prepare(`UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND id <> ? AND revoked_at IS NULL`)
      .bind(target.id, room.code, credentialId),
    db
      .prepare(`INSERT INTO agent_events
        (id, room_code, target_player_id, credential_id, type, game_version)
        SELECT ?, ?, ?, ?, 'pairing_claimed', ?
        WHERE EXISTS (SELECT 1 FROM agent_credentials WHERE id = ? AND revoked_at IS NULL)`)
      .bind(eventId(), room.code, target.id, credentialId, room.version, credentialId),
  ]);
  if (
    results[0].meta.changes !== 1 ||
    results[1].meta.changes !== 1 ||
    results[2].meta.changes !== 1
  ) {
    throw new ApiError(409, "PAIRING_CONFLICT", "配对码刚刚被使用或房间状态已经变化，请重新配对");
  }
  if (room.status === "playing" && room.state_json) {
    const activeState = parseState(room);
    if (activeState && decisionActorId(activeState) === target.id) {
      const previousDeadline = activeState.deadlineAt;
      await applyDecisionWindow(activeState, [{ ...target, control_mode: "agent", control_epoch: nextEpoch }]);
      if (activeState.deadlineAt !== previousDeadline) {
        await database()
          .prepare(`UPDATE rooms SET state_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE code = ? AND version = ? AND state_json = ? AND status = 'playing'`)
          .bind(JSON.stringify(activeState), room.code, room.version, room.state_json)
          .run();
      }
    }
  }
  return {
    ok: true,
    protocol: AGENT_PROTOCOL,
    room: room.code,
    playerId: target.id,
    seatName: target.name,
    agentToken: rawToken,
    scopes: scopes(pairing.scopes_json),
    controlEpoch: nextEpoch,
    expiresAt,
    observe: `/api/game?room=${room.code}`,
    act: "/api/game",
    heartbeat: "/api/agent-heartbeat",
    readiness: "connecting",
    capabilities: [...AGENT_REQUIRED_CAPABILITIES],
    recommendedHeartbeatMs: { idle: 15_000, decision: 5_000 },
  };
}

export async function heartbeatAgent(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const agent = await authenticatedPlayer(request, room.code);
  if (!agent || agent.auth_via !== "agent" || !agent.auth_credential_id) {
    throw new ApiError(403, "AGENT_REQUIRED", "只有已配对的 Agent 可以发送心跳");
  }
  if (!(agent.auth_scopes ?? []).includes("game:heartbeat:self")) {
    throw new ApiError(403, "SCOPE_DENIED", "当前 Agent 凭证没有心跳权限");
  }
  const controlEpoch = Number(payload.controlEpoch);
  if (!Number.isInteger(controlEpoch) || controlEpoch !== agent.control_epoch) {
    throw new ApiError(409, "CONTROL_CHANGED", "席位控制权已经变化，请停止当前 Agent");
  }
  const seq = Number(payload.seq);
  if (!Number.isInteger(seq) || seq < 1 || seq > 2_147_483_647) {
    throw new ApiError(400, "BAD_HEARTBEAT_SEQ", "心跳 seq 必须是递增正整数");
  }
  const observedVersion = Number(payload.observedVersion);
  if (!Number.isInteger(observedVersion) || observedVersion < 1 || observedVersion > room.version) {
    throw new ApiError(409, "BAD_OBSERVED_VERSION", "请先重新观察当前房间版本");
  }
  const rawPhase = typeof payload.reportedPhase === "string"
    ? payload.reportedPhase
    : typeof payload.state === "string"
      ? payload.state
      : "observing";
  if (!AGENT_PHASES.has(rawPhase as AgentReportedPhase)) {
    throw new ApiError(400, "BAD_REPORTED_PHASE", "Agent 状态不在允许列表中");
  }
  const reportedError =
    typeof payload.errorCode === "string" && AGENT_REPORTED_ERRORS.has(payload.errorCode)
      ? payload.errorCode
      : null;
  if (payload.errorCode != null && !reportedError) {
    throw new ApiError(400, "BAD_REPORTED_ERROR", "Agent 错误代码不在允许列表中");
  }
  const retryCount = Math.max(0, Math.min(20, Number(payload.retryCount) || 0));
  const suppliedDecisionId = typeof payload.decisionId === "string" ? payload.decisionId.slice(0, 120) : null;
  const credential = await database()
    .prepare("SELECT * FROM agent_credentials WHERE id = ? AND revoked_at IS NULL")
    .bind(agent.auth_credential_id)
    .first<AgentCredentialRow>();
  if (!credential || Number(credential.control_epoch) !== controlEpoch) {
    throw new ApiError(409, "CONTROL_CHANGED", "Agent 凭证已被撤销或控制权已经变化");
  }
  if (seq < Number(credential.heartbeat_seq ?? 0)) {
    throw new ApiError(409, "STALE_HEARTBEAT", "心跳序号早于服务器已接收的状态");
  }
  if (
    credential.last_snapshot_version == null ||
    observedVersion > Number(credential.last_snapshot_version)
  ) {
    throw new ApiError(409, "SNAPSHOT_NOT_DELIVERED", "服务器尚未向此 Agent 交付该房间版本");
  }

  const game = parseState(room);
  const currentDecisionId = decisionId(room, game);
  const isDecisionActor = decisionActorId(game) === agent.id;
  let phase = rawPhase as AgentReportedPhase;
  if (
    (phase === "planning" || phase === "submitting") &&
    (!isDecisionActor || !suppliedDecisionId || suppliedDecisionId !== currentDecisionId)
  ) {
    phase = "observing";
  }
  const acknowledgesCurrent =
    observedVersion === room.version && observedVersion === Number(credential.last_snapshot_version);
  // A single request proves only that the pairing code was claimed. A later
  // heartbeat proves that the private in-memory credential is still alive.
  const provesPersistentSession = Boolean(
    acknowledgesCurrent &&
    credential.last_heartbeat_at &&
    (ageMs(credential.last_heartbeat_at) ?? 0) >= AGENT_READY_PROBE_MS,
  );

  if (seq > Number(credential.heartbeat_seq ?? 0)) {
    const result = await database()
      .prepare(`UPDATE agent_credentials SET
        last_heartbeat_at = CURRENT_TIMESTAMP,
        last_used_at = CURRENT_TIMESTAMP,
        last_observed_version = ?,
        reported_phase = ?,
        heartbeat_seq = ?,
        retry_count = ?,
        last_reported_error_code = ?,
        ready_at = CASE WHEN ? = 1 THEN COALESCE(ready_at, CURRENT_TIMESTAMP) ELSE ready_at END
        WHERE id = ? AND room_code = ? AND target_player_id = ? AND control_epoch = ?
          AND revoked_at IS NULL AND heartbeat_seq < ?`)
      .bind(
        observedVersion,
        phase,
        seq,
        retryCount,
        reportedError,
        provesPersistentSession ? 1 : 0,
        credential.id,
        room.code,
        agent.id,
        controlEpoch,
        seq,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, "STALE_HEARTBEAT", "另一条更新的心跳已经被服务器接收");
    }
    if (!credential.ready_at && provesPersistentSession) {
      await database()
        .prepare(`INSERT INTO agent_events
          (id, room_code, target_player_id, credential_id, type, game_version)
          VALUES (?, ?, ?, ?, 'ready', ?)`)
        .bind(eventId(), room.code, agent.id, credential.id, room.version)
        .run();
    }
    const phaseEvent = credential.reported_phase !== phase
      ? phase === "unattended"
        ? "unattended"
        : credential.reported_phase === "unattended"
          ? "attended"
          : null
      : null;
    if (phaseEvent && (credential.ready_at || provesPersistentSession)) {
      await database()
        .prepare(`INSERT INTO agent_events
          (id, room_code, target_player_id, credential_id, type, game_version)
          VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(eventId(), room.code, agent.id, credential.id, phaseEvent, room.version)
        .run();
    }
  }

  const updated = await database()
    .prepare("SELECT * FROM agent_credentials WHERE id = ? AND revoked_at IS NULL")
    .bind(credential.id)
    .first<AgentCredentialRow>();
  if (!updated) throw new ApiError(409, "CONTROL_CHANGED", "Agent 凭证已经失效");
  const ready = Boolean(updated.ready_at) && (room.status !== "lobby" || updated.last_observed_version === room.version);
  let deadlineExtended = false;
  let effectiveDeadlineAt = game?.deadlineAt ?? null;
  const remainingMs = effectiveDeadlineAt ? timestamp(effectiveDeadlineAt) - Date.now() : null;
  if (
    phase === "planning" &&
    isDecisionActor &&
    currentDecisionId &&
    suppliedDecisionId === currentDecisionId &&
    !updated.suspended_at &&
    remainingMs !== null &&
    remainingMs > 0 &&
    remainingMs <= AGENT_GRACE_TRIGGER_MS &&
    updated.deadline_extension_decision_id !== currentDecisionId &&
    room.state_json &&
    game
  ) {
    const claimed = await database()
      .prepare(`UPDATE agent_credentials SET deadline_extension_decision_id = ?
        WHERE id = ? AND revoked_at IS NULL AND suspended_at IS NULL
          AND COALESCE(deadline_extension_decision_id, '') <> ?`)
      .bind(currentDecisionId, updated.id, currentDecisionId)
      .run();
    if (claimed.meta.changes === 1) {
      const originalState = room.state_json;
      game.deadlineAt = new Date(timestamp(effectiveDeadlineAt!) + AGENT_PLANNING_GRACE_MS).toISOString();
      const extended = await database()
        .prepare(`UPDATE rooms SET state_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE code = ? AND version = ? AND state_json = ? AND status = 'playing'`)
        .bind(JSON.stringify(game), room.code, room.version, originalState)
        .run();
      deadlineExtended = extended.meta.changes === 1;
      if (deadlineExtended) effectiveDeadlineAt = game.deadlineAt;
      else {
        await database()
          .prepare("UPDATE agent_credentials SET deadline_extension_decision_id = NULL WHERE id = ? AND deadline_extension_decision_id = ?")
          .bind(updated.id, currentDecisionId)
          .run();
      }
    }
  }
  const health = agentPublicStatus(room, game, agent, updated, undefined);
  return {
    ok: true,
    protocol: AGENT_PROTOCOL,
    serverTime: new Date().toISOString(),
    roomVersion: room.version,
    controlEpoch,
    ready,
    readiness: ready
      ? "ready"
      : updated.last_heartbeat_at
        ? "awaiting_continuity_probe"
        : "awaiting_first_heartbeat",
    nextReadinessHeartbeatAt: !ready && updated.last_heartbeat_at
      ? new Date(timestamp(updated.last_heartbeat_at) + AGENT_READY_PROBE_MS).toISOString()
      : null,
    health: health.state,
    decisionLoopActive: phase !== "unattended",
    actionRequired: isDecisionActor,
    decisionId: currentDecisionId,
    deadlineAt: effectiveDeadlineAt,
    deadlineExtended,
    planningGraceMs: deadlineExtended ? AGENT_PLANNING_GRACE_MS : 0,
    recommendedHeartbeatMs: isDecisionActor ? 5_000 : 15_000,
    suspended: Boolean(updated.suspended_at),
  };
}

export async function revokeAgentControl(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const owner = await authenticatedPlayer(request, room.code);
  requireSeatOwner(owner);
  const nextEpoch = owner!.control_epoch + 1;
  const db = database();
  const results = await db.batch([
    db
      .prepare(`UPDATE room_players SET control_mode = 'human', control_epoch = ?
        WHERE id = ? AND room_code = ? AND control_epoch = ?
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(nextEpoch, owner!.id, room.code, owner!.control_epoch, room.code, room.version),
    db
      .prepare(`UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(owner!.id, room.code, room.code, room.version),
    db
      .prepare(`UPDATE agent_pairings SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND claimed_at IS NULL AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(owner!.id, room.code, room.code, room.version),
    db
      .prepare(`INSERT INTO agent_events
        (id, room_code, target_player_id, type, game_version)
        SELECT ?, ?, ?, 'takeover', ?
        WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(eventId(), room.code, owner!.id, room.version, room.code, room.version),
    db
      .prepare("UPDATE rooms SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ?")
      .bind(room.code, room.version),
  ]);
  if (results[0].meta.changes !== 1 || results[4].meta.changes !== 1) {
    throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
  }
  const refreshed = directViewer((await playerById(owner!.id))!, owner!.auth_via!);
  return makeView(await roomRow(room.code), refreshed);
}

export async function claimGuestSeat(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const guest = await authenticatedPlayer(request, room.code);
  if (!guest || guest.auth_via !== "guest" || guest.principal_type !== "guest") {
    throw new ApiError(400, "GUEST_REQUIRED", "当前席位不是一次性访客席位");
  }
  const account = await accountKeyFor(request);
  if (!account) throw new ApiError(401, "ACCOUNT_REQUIRED", "请先使用 Google 登录");
  const duplicate = await database()
    .prepare("SELECT id FROM room_players WHERE room_code = ? AND account_key = ? AND id <> ?")
    .bind(room.code, account.key, guest.id)
    .first();
  if (duplicate) throw new ApiError(409, "ACCOUNT_ALREADY_SEATED", "这个登录账号已在房间中拥有席位");
  const nextEpoch = guest.control_epoch + 1;
  const replacementHash = await tokenHash(opaqueToken("retired"));
  const db = database();
  const results = await db.batch([
    db
      .prepare(`UPDATE room_players SET principal_type = 'account', account_key = ?, credential_expires_at = NULL,
        token_hash = ?, control_mode = 'human', control_epoch = ?
        WHERE id = ? AND room_code = ? AND principal_type = 'guest' AND control_epoch = ?
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(account.key, replacementHash, nextEpoch, guest.id, room.code, guest.control_epoch, room.code, room.version),
    db
      .prepare(`UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(guest.id, room.code, room.code, room.version),
    db
      .prepare(`UPDATE agent_pairings SET revoked_at = CURRENT_TIMESTAMP
        WHERE target_player_id = ? AND room_code = ? AND claimed_at IS NULL AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(guest.id, room.code, room.code, room.version),
    db
      .prepare("UPDATE rooms SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ?")
      .bind(room.code, room.version),
  ]);
  if (results[0].meta.changes !== 1 || results[3].meta.changes !== 1) {
    throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
  }
  return makeView(await roomRow(room.code), directViewer((await playerById(guest.id))!, "account"));
}

export async function removePlayer(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const host = await authenticatedPlayer(request, room.code);
  requireSeatOwner(host);
  if (host!.id !== room.host_player_id) throw new ApiError(403, "HOST_ONLY", "只有房主可以移除席位");
  if (room.status !== "lobby") throw new ApiError(409, "GAME_STARTED", "开局后不能移除席位");
  const targetId = typeof payload.playerId === "string" ? payload.playerId : "";
  if (!targetId || targetId === room.host_player_id) throw new ApiError(400, "BAD_PLAYER", "不能移除房主");
  const target = await database()
    .prepare("SELECT id FROM room_players WHERE room_code = ? AND id = ?")
    .bind(room.code, targetId)
    .first<{ id: string }>();
  if (!target) throw new ApiError(404, "SEAT_NOT_FOUND", "没有找到这个房间内的席位");
  const db = database();
  const results = await db.batch([
    db
      .prepare(`DELETE FROM agent_credentials WHERE room_code = ? AND target_player_id = ?
        AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ? AND status = 'lobby')`)
      .bind(room.code, targetId, room.code, room.version),
    db
      .prepare(`DELETE FROM agent_pairings WHERE room_code = ? AND target_player_id = ?
        AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ? AND status = 'lobby')`)
      .bind(room.code, targetId, room.code, room.version),
    db
      .prepare(`DELETE FROM room_players WHERE room_code = ? AND id = ?
        AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ? AND status = 'lobby')`)
      .bind(room.code, targetId, room.code, room.version),
    db
      .prepare(
        "UPDATE rooms SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ? AND status = 'lobby'",
      )
      .bind(room.code, room.version),
  ]);
  if (results[2].meta.changes !== 1 || results[3].meta.changes !== 1) {
    throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
  }
  return makeView(await roomRow(room.code), host);
}

export async function leaveRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const player = await authenticatedPlayer(request, room.code);
  requireSeatOwner(player);
  const owner = player!;

  if (room.status !== "lobby") {
    await database()
      .prepare("UPDATE room_players SET last_seen_at = NULL WHERE id = ? AND room_code = ?")
      .bind(owner.id, room.code)
      .run();
    return {
      ok: true,
      left: true,
      seatRetained: true,
      room: { code: room.code, status: room.status },
    };
  }

  const rows = await roomPlayers(room.code);
  const remaining = rows.filter((entry) => entry.id !== owner.id);
  const db = database();

  if (remaining.length === 0) {
    const results = await db.batch([
      db.prepare("DELETE FROM agent_events WHERE room_code = ?").bind(room.code),
      db.prepare("DELETE FROM agent_credentials WHERE room_code = ?").bind(room.code),
      db.prepare("DELETE FROM agent_pairings WHERE room_code = ?").bind(room.code),
      db.prepare("DELETE FROM room_requests WHERE room_code = ?").bind(room.code),
      db.prepare("DELETE FROM room_players WHERE room_code = ?").bind(room.code),
      db.prepare("DELETE FROM rooms WHERE code = ? AND status = 'lobby' AND version = ?").bind(room.code, room.version),
    ]);
    if (results[5].meta.changes !== 1) throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
    return { ok: true, left: true, seatRetained: false, closed: true, room: { code: room.code, status: "closed" } };
  }

  const nextHost = owner.id === room.host_player_id
    ? [...remaining].sort((left, right) => left.seat - right.seat)[0]
    : null;
  const results = await db.batch([
    db.prepare("DELETE FROM agent_events WHERE room_code = ? AND target_player_id = ?").bind(room.code, owner.id),
    db.prepare("DELETE FROM agent_credentials WHERE room_code = ? AND target_player_id = ?").bind(room.code, owner.id),
    db.prepare("DELETE FROM agent_pairings WHERE room_code = ? AND target_player_id = ?").bind(room.code, owner.id),
    db.prepare("DELETE FROM room_players WHERE room_code = ? AND id = ?").bind(room.code, owner.id),
    nextHost
      ? db.prepare("UPDATE rooms SET host_player_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND status = 'lobby' AND version = ?").bind(nextHost.id, room.code, room.version)
      : db.prepare("UPDATE rooms SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND status = 'lobby' AND version = ?").bind(room.code, room.version),
  ]);
  if (results[3].meta.changes !== 1 || results[4].meta.changes !== 1) {
    throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
  }
  return {
    ok: true,
    left: true,
    seatRetained: false,
    closed: false,
    transferredHostTo: nextHost ? { playerId: nextHost.id, name: nextHost.name } : null,
    room: { code: room.code, status: "lobby", hostPlayerId: nextHost?.id ?? room.host_player_id },
  };
}

export async function rematchRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const player = await authenticatedPlayer(request, room.code);
  requireSeatOwner(player);
  const owner = player!;
  if (owner.id !== room.host_player_id) throw new ApiError(403, "HOST_ONLY", "只有房主可以发起同桌重开");
  if (room.status !== "finished") throw new ApiError(409, "GAME_NOT_FINISHED", "当前对局尚未结束");

  const db = database();
  const results = await db.batch([
    db.prepare("DELETE FROM agent_events WHERE room_code = ?").bind(room.code),
    db.prepare("DELETE FROM agent_credentials WHERE room_code = ?").bind(room.code),
    db.prepare("DELETE FROM agent_pairings WHERE room_code = ?").bind(room.code),
    db.prepare(`UPDATE room_players SET control_mode = 'human', control_epoch = control_epoch + 1
      WHERE room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'finished' AND version = ?)`)
      .bind(room.code, room.code, room.version),
    db.prepare(`UPDATE rooms SET status = 'lobby', state_json = NULL, version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE code = ? AND status = 'finished' AND version = ?`)
      .bind(room.code, room.version),
  ]);
  if (results[4].meta.changes !== 1) throw new ApiError(409, "VERSION_CONFLICT", "牌桌刚刚发生变化，请刷新后重试");
  const freshRoom = await roomRow(room.code);
  const freshOwner = (await roomPlayers(room.code)).find((entry) => entry.id === owner.id);
  if (!freshOwner) throw new ApiError(401, "SEAT_NOT_FOUND", "房主席位已不存在");
  return makeView(freshRoom, directViewer(freshOwner, owner.auth_via ?? (owner.principal_type === "account" ? "account" : "guest")));
}

export async function startRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const host = await authenticatedPlayer(request, room.code);
  requireSeatOwner(host);
  if (host!.id !== room.host_player_id) throw new ApiError(403, "HOST_ONLY", "只有房主可以开始对局");
  if (room.status !== "lobby") throw new ApiError(409, "GAME_STARTED", "对局已经开始");
  const rows = await roomPlayers(room.code);
  const minimumPlayers = room.max_players === 2 ? 2 : 4;
  if (rows.length < minimumPlayers) {
    throw new ApiError(
      400,
      "NOT_ENOUGH_PLAYERS",
      room.max_players === 2 ? "经典1V1需要 2 名玩家" : "经典标准身份局至少需要 4 名玩家",
    );
  }
  if (rows.some((entry) => entry.control_mode === "pairing")) {
    throw new ApiError(
      409,
      "AGENT_PAIRING_PENDING",
      "有参与者尚未完成自己的 Agent 配对；请先完成配对或由该参与者收回真人控制",
    );
  }
  const credentials = await currentAgentCredentials(room.code);
  const blockers = startBlockers(room, rows, credentials);
  if (blockers.some((entry) => entry.code === "AGENT_NOT_READY")) {
    throw new ApiError(409, "AGENT_NOT_READY", "有 Agent 尚未确认最新房间快照，请等待其完成同步");
  }
  if (blockers.some((entry) => entry.code === "AGENT_UNATTENDED")) {
    throw new ApiError(409, "AGENT_UNATTENDED", "有 Agent 的 CLI 已连接，但决策循环没有持续守候，暂时不能开局");
  }
  if (blockers.some((entry) => entry.code === "AGENT_OFFLINE")) {
    throw new ApiError(409, "AGENT_OFFLINE", "有 Agent 已离线、暂停或心跳过期，暂时不能开局");
  }
  const seats: LobbySeat[] = rows.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind, seat: entry.seat }));
  const state = createGame(seats);
  await applyDecisionWindow(state, rows);
  const now = new Date().toISOString();
  const result = await database()
    .prepare(`UPDATE rooms SET status = 'playing', state_json = ?, version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ? AND status = 'lobby'
        AND NOT EXISTS (
          SELECT 1 FROM room_players p
          WHERE p.room_code = rooms.code AND p.control_mode = 'pairing'
        )
        AND NOT EXISTS (
          SELECT 1 FROM room_players p
          WHERE p.room_code = rooms.code
            AND (
              (p.control_mode = 'agent' AND NOT EXISTS (
                SELECT 1 FROM agent_credentials c
                WHERE c.room_code = p.room_code AND c.target_player_id = p.id
                  AND c.control_epoch = p.control_epoch AND c.revoked_at IS NULL AND c.expires_at > ?
                  AND c.ready_at IS NOT NULL AND c.suspended_at IS NULL
                  AND c.reported_phase <> 'unattended'
                  AND c.last_observed_version = rooms.version
                  AND c.last_heartbeat_at IS NOT NULL
                  AND julianday(c.last_heartbeat_at) >= julianday('now', '-60 seconds')
              ))
              OR (p.kind = 'agent' AND p.control_mode <> 'agent')
            )
        )`)
    .bind(JSON.stringify(state), room.code, room.version, now)
    .run();
  if (!result.meta.changes) {
    const refreshed = await roomRow(room.code);
    if (refreshed.status === "lobby" && refreshed.version === room.version) {
      throw new ApiError(409, "AGENT_NOT_READY", "某位 Agent 的同步或心跳状态已变化，请重新确认后开局");
    }
    throw new ApiError(409, "VERSION_CONFLICT", "房间刚刚发生变化，请重试");
  }
  return makeView(await roomRow(room.code), host);
}

async function acceptedActionView(
  room: RoomRow,
  actor: PlayerRow,
  alreadyApplied: boolean,
  requestId: string,
  actionReason: string | null,
) {
  const projection = await makeView(room, room.status === "finished" && actor.auth_via === "agent" ? null : actor, alreadyApplied);
  return actor.auth_via === "agent"
    ? {
        ...projection,
        agentReceipt: {
          requestId,
          actionAccepted: true,
          reasonAccepted: Boolean(actionReason),
          reasonPolicy: usesRequiredAgentReason(actor.auth_protocol_version) ? "action-reason-v1" : "legacy-optional",
        },
      }
    : projection;
}

export async function actInRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const actor = await authenticatedPlayer(request, room.code);
  const agentCredentialId = actor?.auth_via === "agent" ? actor.auth_credential_id ?? null : null;
  if (agentCredentialId) {
    await database()
      .prepare(`UPDATE agent_credentials SET last_used_at = CURRENT_TIMESTAMP,
        last_action_attempt_at = CURRENT_TIMESTAMP, reported_phase = 'submitting'
        WHERE id = ? AND revoked_at IS NULL`)
      .bind(agentCredentialId)
      .run();
  }
  try {
  if (actor?.auth_via === "agent" && !canObserve(actor)) {
    throw new ApiError(403, "SCOPE_DENIED", "当前 Agent 凭证不能读取动作结果");
  }
  if (actor?.auth_via === "agent" && actor.auth_suspended_at) {
    throw new ApiError(409, "AGENT_SUSPENDED", "Agent 已因连续超时进入安全托管，请由席位所有者处理");
  }
  if (!canAct(actor)) {
    throw new ApiError(409, "CONTROL_CHANGED", "席位当前由另一控制者操作；请刷新或先收回真人控制权");
  }
  const actionReason = actor?.auth_via === "agent"
    ? usesRequiredAgentReason(actor.auth_protocol_version)
      ? requireAgentReason(payload.reason)
      : cleanAgentReason(payload.reason)
    : null;
  const requestId = typeof payload.requestId === "string" ? payload.requestId.slice(0, 80) : "";
  if (!requestId) throw new ApiError(400, "REQUEST_ID_REQUIRED", "动作需要 requestId");
  const requestHash = await tokenHash(canonicalJson({
    expectedVersion: payload.expectedVersion,
    action: payload.action,
    ...(actionReason ? { reason: actionReason } : {}),
  }));
  const prior = await database()
    .prepare("SELECT player_id, request_hash, result_version FROM room_requests WHERE room_code = ? AND request_id = ?")
    .bind(room.code, requestId)
    .first<{ player_id: string; request_hash: string | null; result_version: number }>();
  if (prior) {
    if (prior.player_id !== actor!.id || (prior.request_hash && prior.request_hash !== requestHash)) {
      throw new ApiError(409, "REQUEST_ID_REUSED", "requestId 已用于不同的动作请求");
    }
    return acceptedActionView(await roomRow(room.code), actor!, true, requestId, actionReason);
  }
  if (room.status !== "playing" || !room.state_json) throw new ApiError(409, "NOT_PLAYING", "对局尚未开始或已经结束");
  const expectedVersion = Number(payload.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== room.version) {
    throw new ApiError(409, "VERSION_CONFLICT", "状态已更新，请重新观察后再行动");
  }
  if (!payload.action || typeof payload.action !== "object") throw new ApiError(400, "BAD_ACTION", "缺少合法动作");
  let next: GameState;
  try {
    next = applyGameAction(parseState(room)!, actor!.id, payload.action as GameAction);
  } catch (error) {
    throw new ApiError(400, "ILLEGAL_ACTION", error instanceof Error ? error.message : "非法动作");
  }
  await applyDecisionWindow(next);
  const nextStatus: RoomStatus = next.status === "finished" ? "finished" : "playing";
  const resultVersion = room.version + 1;
  const db = database();
  const results = await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO room_requests (room_code, request_id, player_id, request_hash, result_version)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(room.code, requestId, actor!.id, requestHash, resultVersion, room.code, room.version),
    db
      .prepare(`UPDATE agent_credentials SET last_used_at = CURRENT_TIMESTAMP,
        last_action_accepted_at = CURRENT_TIMESTAMP, reported_phase = 'idle', retry_count = 0,
        last_server_error_code = NULL, consecutive_timeouts = 0
        WHERE id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM room_requests WHERE room_code = ? AND request_id = ? AND player_id = ?)
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(agentCredentialId, room.code, requestId, actor!.id, room.code, room.version),
    db
      .prepare(`INSERT INTO agent_events
        (id, room_code, target_player_id, credential_id, type, game_version, request_id, action_reason)
        SELECT ?, ?, ?, ?, 'action_accepted', ?, ?, ?
        WHERE ? IS NOT NULL
          AND EXISTS (SELECT 1 FROM room_requests WHERE room_code = ? AND request_id = ? AND player_id = ?)
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(
        eventId(),
        room.code,
        actor!.id,
        agentCredentialId,
        resultVersion,
        requestId,
        actionReason,
        agentCredentialId,
        room.code,
        requestId,
        actor!.id,
        room.code,
        room.version,
      ),
    db
      .prepare(`UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP
        WHERE room_code = ? AND revoked_at IS NULL AND ? = 'finished'
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)
          AND EXISTS (SELECT 1 FROM room_requests WHERE room_code = ? AND request_id = ? AND player_id = ?)`)
      .bind(room.code, nextStatus, room.code, room.version, room.code, requestId, actor!.id),
    db
      .prepare(`UPDATE agent_pairings SET revoked_at = CURRENT_TIMESTAMP
        WHERE room_code = ? AND claimed_at IS NULL AND revoked_at IS NULL AND ? = 'finished'
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)
          AND EXISTS (SELECT 1 FROM room_requests WHERE room_code = ? AND request_id = ? AND player_id = ?)`)
      .bind(room.code, nextStatus, room.code, room.version, room.code, requestId, actor!.id),
    db
      .prepare(`UPDATE rooms SET state_json = ?, status = ?, version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ?
          AND EXISTS (SELECT 1 FROM room_requests WHERE room_code = ? AND request_id = ? AND player_id = ?)`)
      .bind(JSON.stringify(next), nextStatus, room.code, room.version, room.code, requestId, actor!.id),
  ]);
  if (results[0].meta.changes !== 1 || results[5].meta.changes !== 1) {
    const raced = await db
      .prepare("SELECT player_id, request_hash FROM room_requests WHERE room_code = ? AND request_id = ?")
      .bind(room.code, requestId)
      .first<{ player_id: string; request_hash: string | null }>();
    if (raced?.player_id === actor!.id && (!raced.request_hash || raced.request_hash === requestHash)) {
      return acceptedActionView(await roomRow(room.code), actor!, true, requestId, actionReason);
    }
    if (raced) throw new ApiError(409, "REQUEST_ID_REUSED", "requestId 已用于不同的动作请求");
    throw new ApiError(409, "VERSION_CONFLICT", "另一位控制者抢先完成了动作，请刷新局面");
  }
  const updated = await roomRow(room.code);
  return acceptedActionView(updated, actor!, false, requestId, actionReason);
  } catch (error) {
    if (agentCredentialId && error instanceof ApiError) {
      await database().batch([
        database()
          .prepare(`UPDATE agent_credentials SET last_server_error_code = ?, reported_phase = 'blocked'
            WHERE id = ? AND revoked_at IS NULL`)
          .bind(error.code, agentCredentialId),
        database()
          .prepare(`INSERT INTO agent_events
            (id, room_code, target_player_id, credential_id, type, game_version, request_id, error_code)
            VALUES (?, ?, ?, ?, 'action_rejected', ?, ?, ?)`)
          .bind(
            eventId(),
            room.code,
            actor!.id,
            agentCredentialId,
            room.version,
            typeof payload.requestId === "string" ? payload.requestId.slice(0, 80) : null,
            error.code,
          ),
      ]);
    }
    throw error;
  }
}

export async function tickRoom(request: Request, payload: Record<string, unknown>) {
  await ensureSchema();
  const room = await roomRow(payload.room);
  const viewer = await authenticatedPlayer(request, room.code);
  if (viewer?.auth_via === "agent" && !canObserve(viewer)) {
    throw new ApiError(403, "SCOPE_DENIED", "当前 Agent 凭证不能读取超时结果");
  }
  if (!canTick(viewer)) throw new ApiError(403, "SCOPE_DENIED", "当前凭证不能推进超时决策");
  if (room.status !== "playing" || !room.state_json) return makeView(room, viewer);
  const state = parseState(room)!;
  if (!state.deadlineAt || Date.now() < new Date(state.deadlineAt).getTime()) return makeView(room, viewer);
  const timeoutActorId = decisionActorId(state);
  const timeoutPlayer = timeoutActorId ? await playerById(timeoutActorId) : null;
  const timeoutCredentials = await currentAgentCredentials(room.code);
  const timeoutCredential =
    timeoutPlayer?.control_mode === "agent"
      ? timeoutCredentials.get(`${timeoutPlayer.id}:${timeoutPlayer.control_epoch}`)
      : undefined;
  const willSuspend = Boolean(
    timeoutCredential && Number(timeoutCredential.consecutive_timeouts ?? 0) + 1 >= AGENT_TIMEOUTS_BEFORE_SUSPEND,
  );
  let next: GameState;
  try {
    next = applyTimeout(state);
  } catch (error) {
    throw new ApiError(409, "TICK_NOT_READY", error instanceof Error ? error.message : "当前不能自动推进");
  }
  await applyDecisionWindow(next);
  const nextStatus: RoomStatus = next.status === "finished" ? "finished" : "playing";
  const db = database();
  const results = await db.batch([
    db
      .prepare(`UPDATE agent_credentials SET
        last_timeout_at = CURRENT_TIMESTAMP,
        last_used_at = CURRENT_TIMESTAMP,
        consecutive_timeouts = consecutive_timeouts + 1,
        reported_phase = CASE WHEN consecutive_timeouts + 1 >= ? THEN 'blocked' ELSE 'idle' END,
        suspended_at = CASE WHEN consecutive_timeouts + 1 >= ? THEN COALESCE(suspended_at, CURRENT_TIMESTAMP) ELSE suspended_at END
        WHERE id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(
        AGENT_TIMEOUTS_BEFORE_SUSPEND,
        AGENT_TIMEOUTS_BEFORE_SUSPEND,
        timeoutCredential?.id ?? null,
        room.code,
        room.version,
      ),
    db
      .prepare(`INSERT INTO agent_events
        (id, room_code, target_player_id, credential_id, type, game_version)
        SELECT ?, ?, ?, ?, 'timeout', ?
        WHERE ? IS NOT NULL AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(
        eventId(),
        room.code,
        timeoutActorId,
        timeoutCredential?.id ?? null,
        room.version + 1,
        timeoutCredential?.id ?? null,
        room.code,
        room.version,
      ),
    db
      .prepare(`INSERT INTO agent_events
        (id, room_code, target_player_id, credential_id, type, game_version)
        SELECT ?, ?, ?, ?, 'suspended', ?
        WHERE ? = 1 AND ? IS NOT NULL
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(
        eventId(),
        room.code,
        timeoutActorId,
        timeoutCredential?.id ?? null,
        room.version + 1,
        willSuspend ? 1 : 0,
        timeoutCredential?.id ?? null,
        room.code,
        room.version,
      ),
    db
      .prepare(`UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP
        WHERE room_code = ? AND revoked_at IS NULL AND ? = 'finished'
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(room.code, nextStatus, room.code, room.version),
    db
      .prepare(`UPDATE agent_pairings SET revoked_at = CURRENT_TIMESTAMP
        WHERE room_code = ? AND claimed_at IS NULL AND revoked_at IS NULL AND ? = 'finished'
          AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND version = ?)`)
      .bind(room.code, nextStatus, room.code, room.version),
    db
      .prepare(`UPDATE rooms SET state_json = ?, status = ?, version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE code = ? AND version = ?`)
      .bind(JSON.stringify(next), nextStatus, room.code, room.version),
  ]);
  if (results[5].meta.changes !== 1) throw new ApiError(409, "VERSION_CONFLICT", "房间已经被其他玩家推进");
  return makeView(
    await roomRow(room.code),
    nextStatus === "finished" && viewer!.auth_via === "agent" ? null : viewer,
  );
}

export async function getRoom(request: Request, codeInput: unknown) {
  await ensureSchema();
  const room = await roomRow(codeInput);
  const viewer = await authenticatedPlayer(request, room.code, false);
  if (viewer?.auth_via === "agent" && !canObserve(viewer)) {
    throw new ApiError(403, "SCOPE_DENIED", "当前 Agent 凭证不能观察席位状态");
  }
  if (viewer) {
    const db = database();
    if (viewer.auth_credential_id) {
      await db
        .prepare(`UPDATE agent_credentials SET last_used_at = CURRENT_TIMESTAMP,
          last_snapshot_at = CURRENT_TIMESTAMP, last_snapshot_version = ?
          WHERE id = ? AND revoked_at IS NULL`)
        .bind(room.version, viewer.auth_credential_id)
        .run();
    } else {
      await db.prepare("UPDATE room_players SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(viewer.id).run();
      viewer.last_seen_at = new Date().toISOString();
    }
  }
  return makeView(room, viewer);
}

export async function handleOperation(request: Request, payload: Record<string, unknown>) {
  const op = typeof payload.op === "string" ? payload.op : "";
  if (op === "create") return createRoom(request, payload);
  if (op === "join") return joinRoom(request, payload);
  if (op === "createAgentPairing") return createAgentPairing(request, payload);
  if (op === "revokeAgent") return revokeAgentControl(request, payload);
  if (op === "claimGuest") return claimGuestSeat(request, payload);
  if (op === "leaveRoom") return leaveRoom(request, payload);
  if (op === "rematch") return rematchRoom(request, payload);
  if (op === "removePlayer") return removePlayer(request, payload);
  if (op === "start") return startRoom(request, payload);
  if (op === "act") return actInRoom(request, payload);
  if (op === "tick") return tickRoom(request, payload);
  throw new ApiError(400, "UNKNOWN_OPERATION", "未知的房间操作");
}

export function authTokenFromRequest(request: Request) {
  return bearer(request);
}
