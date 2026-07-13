"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { CARD_GUIDES } from "../lib/card-catalog";
import type { CardName } from "../lib/game";
import { SKILLS, STANDARD_CHARACTERS } from "../lib/game-v2-data";
import { GameAudioEngine, type GameSoundKind } from "../lib/game-audio";
import { presentLegalActions } from "../lib/action-presentation";

type RoomStatus = "lobby" | "playing" | "finished";
type Role = "lord" | "loyalist" | "rebel" | "renegade";

interface Card {
  id: string;
  name: CardName;
  suit: "spade" | "heart" | "club" | "diamond";
  rank: string;
  color: "red" | "black";
  category: "basic" | "trick" | "delayed" | "equip";
}

interface EquipmentView {
  weapon: Card | null;
  armor: Card | null;
  offensiveHorse: Card | null;
  defensiveHorse: Card | null;
}

interface PlayerView {
  id: string;
  name: string;
  kind: "human" | "agent";
  principalType: "account" | "guest" | "agent";
  controlMode: "human" | "pairing" | "agent";
  seat: number;
  connected: boolean;
  agentStatus?: AgentPublicStatus;
  alive?: boolean;
  hp?: number;
  maxHp?: number;
  handCount?: number;
  hand?: Card[];
  weapon?: Card | null;
  equipment?: EquipmentView;
  judgment?: Card[];
  role?: Role | null;
  roleName?: string;
  duelReserveCount?: number;
  duelDefeatedCount?: number;
  duelRoster?: Array<{ id: string; name: string; title: string; skillName: string; skillText: string }>;
  duelLineup?: Array<{ id: string; name: string; title: string; skillName: string; skillText: string }>;
  duelDefeated?: string[];
  character?: {
    id: string;
    name: string;
    title: string;
    kingdom: "wei" | "shu" | "wu" | "qun";
    kingdomName: string;
    skillName: string;
    skillText: string;
  };
}

type GeneralInfo = {
  id: string;
  name: string;
  title: string;
  kingdom: "wei" | "shu" | "wu" | "qun";
  kingdomName: string;
  maxHp: number;
  skillName: string;
  skillText: string;
  skills: Array<{ id: string; name: string; text: string; kind: "normal" | "locked" | "lord" }>;
};

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

interface AgentPublicStatus {
  state: AgentPublicState;
  label: string;
  ready: boolean;
  activeDecision: boolean;
  attention: "none" | "warning" | "critical";
  lastSeenApprox: string | null;
  consecutiveTimeouts: number;
}

interface AgentDiagnostics {
  agentName: string;
  runtime: string;
  protocolVersion: string;
  clientVersion: string | null;
  state: AgentPublicState;
  label: string;
  readyAt: string | null;
  lastCommunicationAt: string | null;
  communicationAgeMs: number | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  lastSnapshotVersion: number | null;
  lastObservedVersion: number | null;
  currentVersion: number;
  reportedPhase: string;
  reportedPhaseIsSelfReported: boolean;
  retryCount: number;
  lastReportedErrorCode: string | null;
  lastServerErrorCode: string | null;
  lastActionAttemptAt: string | null;
  lastActionAcceptedAt: string | null;
  lastTimeoutAt: string | null;
  consecutiveTimeouts: number;
  suspendedAt: string | null;
  expiresAt: string;
  controlEpoch: number;
  scopes: string[];
  events: Array<{ id: string; type: string; at: string; summary: string; reason?: string | null }>;
}

interface GameAction {
  type: string;
  cardId?: string;
  targetId?: string;
  targetIds?: string[];
  as?: string;
  cardIds?: string[];
  skill?: string;
  characterId?: string;
  choice?: string;
  orderedCardIds?: string[];
  zone?: string;
  suit?: string;
}

interface LegalAction {
  id: string;
  kind: "exact" | "discard" | "skill" | "arrange";
  label: string;
  description?: string;
  action?: GameAction;
  skill?: string;
  candidateCardIds?: string[];
  minCards?: number;
  maxCards?: number;
  targetIds?: string[];
  minTargets?: number;
  maxTargets?: number;
  choices?: Array<{ id: string; label: string }>;
  ordered?: boolean;
}

interface RoomView {
  ok: boolean;
  serverTime: string;
  room: {
    code: string;
    status: RoomStatus;
    maxPlayers: number;
    mode: "duel" | "identity";
    hostPlayerId: string;
    version: number;
    canStart: boolean;
    startBlockers: Array<{
      code: "NOT_ENOUGH_PLAYERS" | "AGENT_PAIRING" | "AGENT_NOT_READY" | "AGENT_OFFLINE" | "AGENT_UNATTENDED";
      count: number;
    }>;
  };
  players: PlayerView[];
  you: null | {
    playerId: string;
    name: string;
    kind: string;
    isHost: boolean;
    identityType: "account" | "guest" | "agent";
    authVia: "account" | "guest" | "agent";
    controlMode: "human" | "pairing" | "agent";
    controlEpoch: number;
    canAct: boolean;
    scopes: string[];
    agentDiagnostics: AgentDiagnostics | null;
  };
  game: null | {
    status: "setup" | "playing" | "finished";
    round: number;
    turnPlayerId: string | null;
    pending: null | { kind: string; targetId: string; required: string; remaining: number };
    deckCount: number;
    discardTop: Card | null;
    logs: Array<{
      id: number;
      text: string;
      tone: string;
      at: string;
      visual?: {
        kind: "use" | "aoe" | "transfer" | "discard" | "draw" | "damage" | "heal" | "equip" | "respond" | "nullify" | "judge" | "death" | "turn";
        actorId?: string;
        sourceId?: string;
        targetIds?: string[];
        cardName?: string;
        cardNames?: string[];
        count?: number;
        amount?: number;
        zone?: "hand" | "equip" | "judge" | "deck" | "discard";
      };
    }>;
    winner: null | { side: string; label: string; playerIds: string[] };
    deadlineAt: string | null;
    decisionId: string | null;
    decision: string;
    legalActions: LegalAction[];
    ruleset: string;
    phase?: "prepare" | "judge" | "draw" | "play" | "discard" | "finish" | null;
    engineVersion?: number;
    rulesetId?: string;
    mode?: "duel" | "identity";
  };
  playerToken?: string;
  guestToken?: string;
  guestExpiresAt?: string;
  pairing?: AgentPairing;
}

interface AgentPairing {
  pairingId: string;
  pairingCode: string;
  room: string;
  playerId: string;
  seatName: string;
  mode: "delegate";
  scopes: string[];
  expiresAt: string;
}

interface InitialUser {
  displayName: string;
  email: string | null;
  provider: string;
}

interface RecentRoom {
  code: string;
  name: string;
  mode: "duel" | "identity";
  status: RoomStatus;
  identityType: "account" | "guest";
  savedAt: number;
}

const SUIT: Record<Card["suit"], string> = {
  spade: "♠",
  heart: "♥",
  club: "♣",
  diamond: "♦",
};

const ROLE_SHORT: Record<Role, string> = {
  lord: "主",
  loyalist: "忠",
  rebel: "反",
  renegade: "内",
};

function tokenKey(room: string) {
  return `mouju:seat:${room}`;
}

function clientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function tactile(pattern: number | number[] = 10) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

const LAST_ROOM_KEY = "mouju:last-room";
const AUDIO_PREFERENCES_KEY = "mouju:audio:v1";

interface AudioPreferences {
  music: boolean;
  effects: boolean;
  turnAlerts: boolean;
  animations: boolean;
}

function initialAudioPreferences(): AudioPreferences {
  if (typeof window === "undefined") return { music: true, effects: true, turnAlerts: true, animations: true };
  try {
    const value = JSON.parse(localStorage.getItem(AUDIO_PREFERENCES_KEY) ?? "null") as Partial<AudioPreferences> | null;
    return { music: value?.music !== false, effects: value?.effects !== false, turnAlerts: value?.turnAlerts !== false, animations: value?.animations !== false };
  } catch {
    return { music: true, effects: true, turnAlerts: true, animations: true };
  }
}

function useToast() {
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, tone: "success" | "error" | "info" = "success") => {
    setToast({ message, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tone === "error" ? 7000 : 3600);
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}

function Toast({ toast, onClose }: { toast: { message: string; tone: "success" | "error" | "info" }; onClose: () => void }) {
  const icon: IconName = toast.tone === "error" ? "warning" : toast.tone === "info" ? "activity" : "check";
  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} aria-live={toast.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
      <span className="toast-icon"><Icon name={icon} size={18} /></span>
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">×</button>
    </div>
  );
}

function useDialogBehavior(onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((entry) => entry.getClientRects().length > 0);
    focusables()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return dialogRef;
}

async function readJson<T = RoomView>(response: Response): Promise<T> {
  const body = await response.text();
  let data: T & { error?: { code?: string; message?: string } };
  try {
    data = JSON.parse(body) as T & { error?: { code?: string; message?: string } };
  } catch {
    throw new RequestError(response.status, "INVALID_RESPONSE", response.ok ? "服务器返回了无法识别的数据" : "服务器暂时无法完成请求，请稍后重试");
  }
  if (!response.ok) throw new RequestError(response.status, data.error?.code || "REQUEST_FAILED", data.error?.message || "请求失败，请稍后重试");
  return data;
}

class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "RequestError";
  }
}

type ReconnectState = {
  code: string;
  message: string;
  reason: "network" | "room_missing" | "access" | "server";
  retryable: boolean;
};

function reconnectFailure(code: string, error: unknown): ReconnectState {
  if (error instanceof RequestError) {
    if (["ROOM_NOT_FOUND", "ROOM_CLOSED"].includes(error.code)) return { code, message: error.message, reason: "room_missing", retryable: false };
    if (["SEAT_NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(error.code) || error.status === 401 || error.status === 403) return { code, message: error.message, reason: "access", retryable: false };
    if (error.status < 500) return { code, message: error.message, reason: "server", retryable: false };
  }
  return { code, message: error instanceof Error ? error.message : "暂时无法连接房间服务", reason: navigator.onLine ? "server" : "network", retryable: true };
}

function relativeTime(value: string | null) {
  if (!value) return "尚无记录";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const PHASE_LABELS: Record<string, string> = {
  connecting: "连接中",
  observing: "观察局面",
  idle: "待机",
  planning: "正在决策",
  submitting: "提交动作",
  recovering: "重试恢复",
  blocked: "遇到阻塞",
  unattended: "未持续守候",
  prepare: "准备阶段",
  judge: "判定阶段",
  draw: "摸牌阶段",
  play: "出牌阶段",
  discard: "弃牌阶段",
  finish: "结束阶段",
};

type IconName =
  | "activity" | "armor" | "book" | "bot" | "cards" | "check" | "chevron"
  | "clock" | "copy" | "crown" | "deck" | "external" | "google" | "heart"
  | "horse" | "judge" | "link" | "lock" | "log" | "more" | "person"
  | "play" | "refresh" | "server" | "shield" | "skip" | "spark" | "sword"
  | "target" | "users" | "warning" | "weapon" | "wifi" | "exit" | "music" | "volume" | "volumeOff";

function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  if (name === "google") {
    return (
      <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.22-.2-1.75H12v3.18h5.52a4.74 4.74 0 0 1-2.05 3.02l-.02.11 2.98 2.31.2.02c1.84-1.7 2.97-4.2 2.97-6.89Z" />
        <path fill="#34A853" d="M12 22c2.69 0 4.95-.89 6.6-2.88l-3.14-2.44c-.84.57-1.96.97-3.46.97-2.58 0-4.78-1.75-5.56-4.17l-.1.01-3.1 2.4-.04.1A9.97 9.97 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.44 13.48A6.13 6.13 0 0 1 6.1 11.5c0-.69.12-1.36.33-1.98l-.01-.13-3.14-2.44-.1.05A10 10 0 0 0 2 11.5c0 1.62.39 3.15 1.2 4.49l3.24-2.51Z" />
        <path fill="#EA4335" d="M12 5.35c1.87 0 3.13.81 3.85 1.48l2.81-2.74C16.94 2.47 14.69 1 12 1a9.97 9.97 0 0 0-8.81 6l3.24 2.52C7.22 7.1 9.42 5.35 12 5.35Z" />
      </svg>
    );
  }
  const paths: Record<Exclude<IconName, "google">, React.ReactNode> = {
    activity: <><path d="M3 12h4l2-7 4 14 2-7h6" /></>,
    armor: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" /><path d="M9 9h6v5H9z" /></>,
    book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23V5.5Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23V5.5Z" /></>,
    bot: <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M9 12h.01M15 12h.01M9 16h6M12 7V4M10 4h4" /></>,
    cards: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9 8 3-2 3 2-3 3-3-3ZM8 15h8" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    crown: <><path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z" /><path d="M5 21h14" /></>,
    deck: <><rect x="6" y="5" width="13" height="16" rx="2" /><path d="M3 17V5a2 2 0 0 1 2-2h10" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
    exit: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" /><path d="m15 8 4 4-4 4M19 12H8" /></>,
    heart: <path d="M20.8 5.7a5.2 5.2 0 0 0-7.4 0L12 7.1l-1.4-1.4a5.2 5.2 0 1 0-7.4 7.4L12 22l8.8-8.9a5.2 5.2 0 0 0 0-7.4Z" />,
    horse: <><path d="M7 21v-5l-2-3 2-7 5-3 5 2 2 5-4 3v8" /><path d="m10 8 3 2M9 21h9" /></>,
    judge: <><path d="M12 3v18M5 7h14M7 7l-3 6h6L7 7ZM17 7l-3 6h6l-3-6Z" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    log: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    music: <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.6-2L20 8M4 16l2.3 2a7 7 0 0 0 11.6-2" /></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>,
    skip: <><path d="m6 5 9 7-9 7V5ZM18 5v14" /></>,
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    sword: <><path d="m14 4 6-1-1 6L9 19l-4 1 1-4L16 6" /><path d="m11 9 4 4M4 20l-1 1" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
    volumeOff: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m16 10 5 5M21 10l-5 5" /></>,
    warning: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    weapon: <><path d="m14 4 6-1-1 6L9 19l-4 1 1-4L16 6" /><path d="M6 16 3 13M11 9l4 4" /></>,
    wifi: <><path d="M4.9 9.6a11 11 0 0 1 14.2 0M7.8 13a6.8 6.8 0 0 1 8.4 0M10.7 16.4a2.4 2.4 0 0 1 2.6 0" /><circle cx="12" cy="20" r="1" /></>,
  };
  return (
    <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const GAME_PHASES = ["prepare", "judge", "draw", "play", "discard", "finish"] as const;

const IDENTITY_ROLE_SUMMARY: Record<number, string> = {
  4: "主公 1 · 忠臣 1 · 反贼 1 · 内奸 1",
  5: "主公 1 · 忠臣 1 · 反贼 2 · 内奸 1",
  6: "主公 1 · 忠臣 1 · 反贼 3 · 内奸 1",
  7: "主公 1 · 忠臣 2 · 反贼 3 · 内奸 1",
  8: "主公 1 · 忠臣 2 · 反贼 4 · 内奸 1",
  9: "主公 1 · 忠臣 3 · 反贼 4 · 内奸 1",
  10: "主公 1 · 忠臣 3 · 反贼 4 · 内奸 2",
};

function agentIcon(state: AgentPublicState): IconName {
  if (["offline", "timed_out", "safe_mode", "pairing_expired", "unattended"].includes(state)) return "warning";
  if (["connecting", "pairing", "delayed"].includes(state)) return "refresh";
  if (["acting", "submitting"].includes(state)) return "activity";
  return "shield";
}

function actionIcon(action?: GameAction, skill = false): IconName {
  if (skill) return "spark";
  if (action?.type === "pass") return "skip";
  if (action?.type === "endTurn") return "check";
  if (action?.targetId || action?.targetIds?.length) return "target";
  return "play";
}

function logIcon(tone: string): IconName {
  if (tone === "danger") return "warning";
  if (tone === "good") return "check";
  if (tone === "system") return "server";
  return "activity";
}

type ActionVisualKind = GameSoundKind;
type PublicBattleEvent = NonNullable<RoomView["game"]>["logs"][number];

function publicEventMeta(entry: PublicBattleEvent): { kind: ActionVisualKind; label: string; icon: IconName; subject: string | null } {
  const subject = entry.text.match(/【([^】]+)】/)?.[1] ?? null;
  if (entry.visual?.kind === "transfer") return { kind: "draw", label: "牌权转移", icon: "cards", subject };
  if (entry.visual?.kind === "aoe") return { kind: "card", label: "全场锦囊", icon: "spark", subject };
  if (entry.visual?.kind === "nullify") return { kind: "defend", label: "效果抵消", icon: "shield", subject };
  if (entry.visual?.kind === "death") return { kind: "damage", label: "武将阵亡", icon: "warning", subject };
  if (entry.visual?.kind === "damage") return { kind: "damage", label: "伤害结算", icon: "warning", subject };
  if (entry.visual?.kind === "heal") return { kind: "heal", label: "体力恢复", icon: "heart", subject };
  if (entry.visual?.kind === "respond") return { kind: "defend", label: "响应防御", icon: "shield", subject };
  if (entry.visual?.kind === "equip") return { kind: "equip", label: "装备变更", icon: "armor", subject };
  if (entry.visual?.kind === "draw") return { kind: "draw", label: "摸取手牌", icon: "cards", subject };
  if (entry.visual?.kind === "discard") return { kind: "discard", label: "牌进入弃牌堆", icon: "deck", subject };
  if (entry.visual?.kind === "use") return { kind: entry.visual.cardName === "杀" || entry.visual.cardName === "决斗" ? "attack" : "card", label: "使用卡牌", icon: entry.visual.cardName === "杀" || entry.visual.cardName === "决斗" ? "sword" : "cards", subject };
  if (/阵亡|受到|失去.+体力|伤害/.test(entry.text)) return { kind: "damage", label: "伤害结算", icon: "warning", subject };
  if (/回复|桃/.test(entry.text)) return { kind: "heal", label: "体力恢复", icon: "heart", subject };
  if (/打出|抵消|闪过|不能使用【闪】/.test(entry.text)) return { kind: "defend", label: "响应防御", icon: "shield", subject };
  if (/使用【杀】|发起【决斗】|再次使用【杀】/.test(entry.text)) return { kind: "attack", label: "攻击行动", icon: "sword", subject };
  if (/使用【/.test(entry.text)) return { kind: "card", label: "使用卡牌", icon: "cards", subject };
  if (/装备了|武器|防具|坐骑/.test(entry.text)) return { kind: "equip", label: "装备变更", icon: "armor", subject };
  if (/发动【/.test(entry.text)) return { kind: "skill", label: "技能发动", icon: "spark", subject };
  if (/摸.+张牌|获得.+张牌|获得【/.test(entry.text)) return { kind: "draw", label: "获得牌", icon: "cards", subject };
  if (/弃置|被弃置/.test(entry.text)) return { kind: "discard", label: "弃牌", icon: "deck", subject };
  if (/选择|确定|完成【观星】/.test(entry.text)) return { kind: "choice", label: "完成选择", icon: "check", subject };
  if (/轮到|回合|进入.+阶段|跳过.+阶段|对局开始|经典1V1开始/.test(entry.text)) return { kind: "turn", label: "回合进程", icon: "play", subject };
  return { kind: "system", label: entry.tone === "system" ? "系统裁定" : "牌局事件", icon: logIcon(entry.tone), subject };
}

function eventSoundKind(entry: PublicBattleEvent): GameSoundKind | null {
  const kind = publicEventMeta(entry).kind;
  if (kind === "system") return null;
  if (kind === "turn" && !/轮到|回合|对局开始|经典1V1开始/.test(entry.text)) return null;
  return kind;
}

const ACTION_BASE_DWELL_MS: Record<ActionVisualKind, number> = {
  turn: 1200,
  draw: 1400,
  discard: 1400,
  defend: 1650,
  heal: 1650,
  damage: 1700,
  choice: 1750,
  attack: 1900,
  equip: 1900,
  system: 1950,
  card: 2100,
  skill: 2300,
};

type EventTier = "light" | "standard" | "major";

function eventTier(entry: PublicBattleEvent): EventTier {
  if (entry.visual?.kind === "death" || entry.visual?.kind === "aoe" || entry.visual?.kind === "nullify" || /濒死|对局结束|全部阵亡|下一名武将/.test(entry.text)) return "major";
  if (entry.visual?.kind === "draw" || entry.visual?.kind === "discard" || entry.visual?.kind === "equip" || /进入.+阶段|回合结束/.test(entry.text)) return "light";
  return "standard";
}

function actionDwellMs(entry: PublicBattleEvent, viewerName: string | undefined, queueDepth: number) {
  const tier = eventTier(entry);
  const meta = publicEventMeta(entry);
  const visibleCharacters = Array.from(entry.text.replace(/\s/g, "")).length;
  const readingAllowance = Math.min(950, Math.max(0, visibleCharacters - 10) * 55);
  const subjectAllowance = meta.subject ? 180 : 0;
  const observerAllowance = viewerName && entry.text.includes(viewerName) ? 0 : 300;
  const fullDuration = ACTION_BASE_DWELL_MS[meta.kind] + readingAllowance + subjectAllowance + observerAllowance;
  // Area effects can generate many short server events at once. Compress only
  // deep backlogs so the animation does not lag a whole turn behind the table.
  if (tier === "light") return queueDepth >= 5 ? 620 : 900;
  const tierFloor = tier === "major" ? 2200 : ACTION_BASE_DWELL_MS[meta.kind];
  return Math.round(Math.max(queueDepth >= 6 ? 1200 : tierFloor, Math.min(tier === "major" ? 3600 : 2600, fullDuration * (queueDepth >= 6 ? 0.76 : 1))));
}

function eventClock(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

function ActionAnimation({ event, viewerName, durationMs }: { event: PublicBattleEvent | null; viewerName?: string; durationMs: number }) {
  if (!event) return null;
  if (eventTier(event) === "light") return null;
  const meta = publicEventMeta(event);
  const viewerInvolved = Boolean(viewerName && event.text.includes(viewerName));
  return (
    <div
      className={`action-visual action-${meta.kind}`}
      key={event.id}
      style={{ "--action-duration": `${durationMs}ms` } as CSSProperties}
      data-event-kind={meta.kind}
      data-duration-ms={durationMs}
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${meta.label}，${event.text}`}
    >
      <i className="action-visual-ring" />
      <span className="action-visual-icon"><Icon name={meta.icon} size={28} /></span>
      <div><small>{meta.label}<em>{viewerInvolved ? "与你相关" : "公开事件"}</em></small>{meta.subject && <strong>【{meta.subject}】</strong>}<p>{event.text}</p></div>
      <span className="action-visual-progress" aria-hidden="true" />
    </div>
  );
}

function seatMotionPoint(players: PlayerView[], playerId: string | undefined, viewerIndex: number) {
  const index = playerId ? players.findIndex((entry) => entry.id === playerId) : -1;
  if (index < 0 || players.length === 0) return { x: 50, y: 50 };
  const relative = ((index - viewerIndex) % players.length + players.length) % players.length;
  const angle = Math.PI / 2 + (relative * Math.PI * 2) / players.length;
  return { x: 50 + Math.cos(angle) * 41, y: 48 + Math.sin(angle) * 35 };
}

function ActionMotionLayer({ event, players, viewerIndex, durationMs }: { event: PublicBattleEvent | null; players: PlayerView[]; viewerIndex: number; durationMs: number }) {
  const visual = event?.visual;
  if (!event || !visual) return null;
  const actorPoint = seatMotionPoint(players, visual.actorId, viewerIndex);
  const sourcePoint = visual.kind === "draw"
    ? { x: 43, y: 58 }
    : visual.kind === "discard" && !visual.sourceId
      ? actorPoint
      : seatMotionPoint(players, visual.sourceId ?? visual.actorId, viewerIndex);
  const destinationIds = visual.kind === "discard"
    ? [undefined]
    : visual.kind === "aoe"
      ? []
      : visual.targetIds?.length
        ? visual.targetIds.slice(0, 6)
        : [visual.actorId];
  const destinations = visual.kind === "aoe"
    ? [{ x: 50, y: 50 }]
    : destinationIds.map((id) => id
      ? seatMotionPoint(players, id, viewerIndex)
      : { x: 57, y: 58 });
  const tokenCount = visual.kind === "transfer" || visual.kind === "draw" || visual.kind === "discard"
    ? Math.max(1, Math.min(3, visual.count ?? 1))
    : 1;
  const knownCard = visual.cardName && visual.cardName in CARD_GUIDES ? visual.cardName as keyof typeof CARD_GUIDES : null;
  const artStyle = knownCard ? { "--motion-art": `url("${CARD_GUIDES[knownCard].image}")` } as CSSProperties : undefined;
  const sourceName = players.find((entry) => entry.id === visual.sourceId)?.name;
  const targetName = players.find((entry) => entry.id === visual.targetIds?.[0])?.name;
  return (
    <div
      className={`action-motion-layer motion-${visual.kind}`}
      key={`motion-${event.id}`}
      style={{ "--motion-duration": `${durationMs}ms` } as CSSProperties}
      data-motion-kind={visual.kind}
      aria-hidden="true"
    >
      {(visual.kind === "aoe" || visual.kind === "nullify") && <i className="motion-field"><Icon name={visual.kind === "nullify" ? "shield" : "spark"} size={30} /></i>}
      {destinations.flatMap((destination, destinationIndex) => Array.from({ length: tokenCount }, (_, tokenIndex) => (
        <span
          className="motion-flight"
          key={`${destinationIndex}-${tokenIndex}`}
          style={{
            "--motion-from-x": `${sourcePoint.x}%`,
            "--motion-from-y": `${sourcePoint.y}%`,
            "--motion-to-x": `${destination.x}%`,
            "--motion-to-y": `${destination.y}%`,
            "--motion-delay": `${destinationIndex * 90 + tokenIndex * 110}ms`,
          } as CSSProperties}
        >
          <i className={`motion-token ${knownCard ? "known-card" : "card-back"}`} style={artStyle}>
            {visual.kind === "damage" || visual.kind === "death"
              ? <Icon name="warning" size={22} />
              : visual.kind === "heal"
                ? <Icon name="heart" size={22} />
                : visual.kind === "respond" || visual.kind === "nullify"
                  ? <Icon name="shield" size={22} />
                  : visual.kind === "equip"
                    ? <Icon name="armor" size={22} />
                    : knownCard ? <b>{knownCard}</b> : <Icon name="cards" size={21} />}
          </i>
        </span>
      )))}
      {visual.kind === "transfer" && sourceName && targetName && <small className="motion-route-label"><b>{sourceName}</b><i>→</i><b>{targetName}</b><span>{visual.count ?? 1} 张牌</span></small>}
      {visual.kind === "damage" && <strong className="motion-impact-label" style={{ "--impact-x": `${destinations[0]?.x ?? 50}%`, "--impact-y": `${destinations[0]?.y ?? 50}%` } as CSSProperties}>−{visual.amount ?? 1}</strong>}
      {visual.kind === "heal" && <strong className="motion-impact-label heal" style={{ "--impact-x": `${destinations[0]?.x ?? 50}%`, "--impact-y": `${destinations[0]?.y ?? 50}%` } as CSSProperties}>+{visual.amount ?? 1}</strong>}
    </div>
  );
}

function AudioControl({ preferences, onToggle }: { preferences: AudioPreferences; onToggle: (channel: keyof AudioPreferences) => void }) {
  const enabled = preferences.music || preferences.effects || preferences.turnAlerts;
  return (
    <details className="audio-control">
      <summary aria-label={enabled ? "声音设置，当前已开启" : "声音设置，当前已静音"}>
        <Icon name={enabled ? "volume" : "volumeOff"} size={16} /><span>声音</span>
      </summary>
      <section className="audio-menu" aria-label="声音设置">
        <header><span><Icon name="volume" size={15} />声音设置</span><small>选择后自动记住</small></header>
        <button type="button" role="switch" aria-checked={preferences.music} onClick={() => onToggle("music")}>
          <span><Icon name="music" size={17} /><b>背景音乐</b><small>低音量国风氛围循环</small></span><i>{preferences.music ? "开" : "关"}</i>
        </button>
        <button type="button" role="switch" aria-checked={preferences.effects} onClick={() => onToggle("effects")}>
          <span><Icon name="activity" size={17} /><b>事件音效</b><small>攻击、伤害、响应与卡牌结算</small></span><i>{preferences.effects ? "开" : "关"}</i>
        </button>
        <button type="button" role="switch" aria-checked={preferences.turnAlerts} onClick={() => onToggle("turnAlerts")}>
          <span><Icon name="warning" size={17} /><b>轮到我提醒</b><small>独立于普通事件音效</small></span><i>{preferences.turnAlerts ? "开" : "关"}</i>
        </button>
        <button type="button" role="switch" aria-checked={preferences.animations} onClick={() => onToggle("animations")}>
          <span><Icon name="spark" size={17} /><b>动作动画</b><small>关闭后保留战报与状态变化</small></span><i>{preferences.animations ? "开" : "关"}</i>
        </button>
        <p><Icon name="shield" size={12} />只为当前界面有权限看到的事件播放</p>
      </section>
    </details>
  );
}

function AgentStatusBadge({ status, compact = false }: { status: AgentPublicStatus; compact?: boolean }) {
  const detail = status.lastSeenApprox ? `${status.label}，最近通信${status.lastSeenApprox}` : status.label;
  return (
    <span
      className={`agent-status-badge status-${status.state} ${compact ? "compact" : ""}`}
      title={detail}
      aria-label={detail}
    >
      <Icon name={agentIcon(status.state)} size={compact ? 13 : 15} />
      <b>{status.label}</b>
      {!compact && status.lastSeenApprox && <small>{status.lastSeenApprox}</small>}
    </span>
  );
}

function AgentDiagnosticsPanel({
  diagnostics,
  busy,
  onTakeover,
  onRepair,
}: {
  diagnostics: AgentDiagnostics;
  busy: boolean;
  onTakeover: () => void;
  onRepair: () => void;
}) {
  const publicStatus: AgentPublicStatus = {
    state: diagnostics.state,
    label: diagnostics.label,
    ready: Boolean(diagnostics.readyAt),
    activeDecision: false,
    attention: ["offline", "safe_mode", "unattended"].includes(diagnostics.state) ? "critical" : "none",
    lastSeenApprox: null,
    consecutiveTimeouts: diagnostics.consecutiveTimeouts,
  };
  const acceptedAt = diagnostics.lastActionAcceptedAt ? new Date(diagnostics.lastActionAcceptedAt).getTime() : 0;
  const attemptedAt = diagnostics.lastActionAttemptAt ? new Date(diagnostics.lastActionAttemptAt).getTime() : 0;
  const lastAction = attemptedAt > acceptedAt
    ? `最新动作未接受 · ${relativeTime(diagnostics.lastActionAttemptAt)}`
    : acceptedAt
      ? `服务器已接受 · ${relativeTime(diagnostics.lastActionAcceptedAt)}`
      : attemptedAt
        ? `等待服务器确认 · ${relativeTime(diagnostics.lastActionAttemptAt)}`
        : "尚未提交动作";
  const needsAttention = ["offline", "timed_out", "safe_mode", "pairing_expired", "unattended"].includes(diagnostics.state);
  const requiresNewAuthorization = ["safe_mode", "pairing_expired"].includes(diagnostics.state);
  const sameCredentialCanRecover = ["offline", "unattended"].includes(diagnostics.state) && !diagnostics.suspendedAt;
  const versionGap = Math.max(0, diagnostics.currentVersion - (diagnostics.lastObservedVersion ?? diagnostics.currentVersion));
  const actionReasons = diagnostics.events.filter((event) => event.type === "action_accepted");
  const latestReason = actionReasons[0];
  const olderReasons = actionReasons.slice(1);
  const friendlyPhase = PHASE_LABELS[diagnostics.reportedPhase] ?? "保持连接";
  const friendlyState = diagnostics.state === "ready"
    ? "已就绪，等待牌桌行动"
    : diagnostics.state === "acting" || diagnostics.reportedPhase === "planning"
      ? "正在分析当前局面"
      : diagnostics.reportedPhase === "submitting"
        ? "正在提交并确认动作"
        : diagnostics.state === "unattended"
          ? "CLI 仍连接，但 Agent 已停止持续读取决策"
          : sameCredentialCanRecover
          ? "心跳中断，原凭证仍可恢复"
          : diagnostics.state === "timed_out"
            ? "本次已安全托管，Agent 仍可继续"
            : needsAttention
              ? "连接需要你的处理"
          : diagnostics.label;
  return (
    <section className={`agent-diagnostics state-${diagnostics.state}`}>
      <header>
        <div><span>Agent 控制台</span><strong>{diagnostics.agentName}</strong></div>
        <AgentStatusBadge status={publicStatus} compact />
      </header>
      <div className="agent-primary-status" role="status" aria-live="polite">
        <i><Icon name={needsAttention ? "warning" : diagnostics.reportedPhase === "submitting" ? "server" : "bot"} size={18} /></i>
        <div><span>{friendlyPhase}</span><strong>{friendlyState}</strong><small>{lastAction}</small></div>
      </div>
      <section className="agent-reason-feed" tabIndex={0} aria-label="可独立滚动的 Agent 决策理由">
        <header><span><Icon name="spark" size={14} />Agent 决策理由</span><small>Agent 自报 · 仅你可见{actionReasons.length ? ` · ${actionReasons.length} 条` : ""}</small></header>
        <div className="agent-reason-current" aria-live="polite" aria-atomic="true">
          {latestReason ? <article className="agent-latest-reason"><i><Icon name="spark" size={12} /></i><div><b>最新理由</b><p>{latestReason.reason || "本次 Agent 未提供理由（旧协议或连接异常）"}</p><small>{latestReason.summary} · {relativeTime(latestReason.at)}</small></div></article> : <div className="agent-reason-empty"><Icon name="clock" size={14} />Agent 完成动作后，会在这里说明一句理由</div>}
        </div>
        {olderReasons.length > 0 && <div className="agent-reason-scroll" tabIndex={0} aria-label="可独立滚动的历史 Agent 决策理由"><ol aria-label="历史 Agent 决策理由">{olderReasons.map((event) => <li key={event.id}><i><Icon name="check" size={11} /></i><div><p>{event.reason || "Agent 未提供本次理由"}</p><small>{event.summary} · {relativeTime(event.at)}</small></div></li>)}</ol></div>}
      </section>
      {sameCredentialCanRecover && <div className="agent-recovery-note"><Icon name="refresh" size={14} /><span><b>{diagnostics.state === "unattended" ? "让 Agent 继续守候" : "先恢复原会话"}</b>{diagnostics.state === "unattended" ? "让原 Agent 立即继续执行 Skill 的 next → act 循环；不要把后台心跳当作决策仍在运行。" : "让 Agent 按 Skill 再执行 status；不要重新领取配对码。原凭证、席位和当前牌局仍然有效。"}</span></div>}
      <div className="agent-diagnostic-actions">
        {requiresNewAuthorization && <button onClick={onRepair} disabled={busy}><Icon name="refresh" size={14} />重新授权 Agent</button>}
        {sameCredentialCanRecover && <button className="reauthorize-secondary" onClick={onRepair} disabled={busy}><Icon name="link" size={14} />确认旧会话失效后重配</button>}
        <button className="takeover" onClick={onTakeover} disabled={busy}><Icon name="person" size={14} />立即接管并撤销凭证</button>
      </div>
      <details className="agent-advanced-diagnostics">
        <summary><Icon name="activity" size={15} />高级连接诊断<small>心跳、同步、权限与事件</small><Icon name="chevron" size={14} /></summary>
        <div className="agent-diagnostic-grid">
          <div><Icon name="wifi" /><span>心跳验证</span><b>{relativeTime(diagnostics.lastCommunicationAt)}</b></div>
          <div><Icon name="refresh" /><span>视图同步</span><b>{versionGap ? `落后 ${versionGap} 个版本` : "已同步至最新"}</b></div>
          <div><Icon name="server" /><span>动作确认</span><b>{lastAction}</b></div>
          <div><Icon name={diagnostics.consecutiveTimeouts ? "warning" : "shield"} /><span>连续超时</span><b>{diagnostics.consecutiveTimeouts ? `${diagnostics.consecutiveTimeouts}/3 次` : "无"}</b></div>
        </div>
        <p className="agent-self-report"><Icon name="bot" size={14} /><span><b>Agent 自报</b>{friendlyPhase}{diagnostics.retryCount ? ` · 已重试 ${diagnostics.retryCount} 次` : ""}</span></p>
        {(diagnostics.lastServerErrorCode || diagnostics.lastReportedErrorCode) && (
          <p className="agent-error-line">
            {diagnostics.lastServerErrorCode ? `服务器：${diagnostics.lastServerErrorCode}` : ""}
            {diagnostics.lastServerErrorCode && diagnostics.lastReportedErrorCode ? " · " : ""}
            {diagnostics.lastReportedErrorCode ? `Agent 自报：${diagnostics.lastReportedErrorCode}` : ""}
          </p>
        )}
        <dl>
          <div><dt>运行端</dt><dd>{diagnostics.runtime}{diagnostics.clientVersion ? ` · ${diagnostics.clientVersion}` : ""}</dd></div>
          <div><dt>协议</dt><dd>{diagnostics.protocolVersion}</dd></div>
          <div><dt>最近心跳</dt><dd>{relativeTime(diagnostics.lastHeartbeatAt)}</dd></div>
          <div><dt>最近快照</dt><dd>{relativeTime(diagnostics.lastSnapshotAt)} · V{diagnostics.lastSnapshotVersion ?? "—"}</dd></div>
          <div><dt>凭证到期</dt><dd>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(diagnostics.expiresAt))}</dd></div>
          <div><dt>最小权限</dt><dd>{diagnostics.scopes.join(" · ")}</dd></div>
        </dl>
        {diagnostics.events.length > 0 && (
          <ol className="agent-event-timeline">
            {diagnostics.events.map((event) => <li key={event.id}><time>{relativeTime(event.at)}</time><span>{event.summary}</span></li>)}
          </ol>
        )}
        {diagnostics.events.length === 0 && <p className="agent-events-empty"><Icon name="activity" />暂无需要你处理的连接事件</p>}
        <small className="server-trust-note"><Icon name="shield" size={13} />心跳、同步与动作接受均由服务器验证；决策阶段由 Agent 自报。</small>
      </details>
    </section>
  );
}

function Seal() {
  return (
    <span className="brand-seal" aria-hidden="true">
      谋
    </span>
  );
}

function TopBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <Seal />
      <div>
        <strong>谋局</strong>
        {!compact && <span>真人与智能体同席</span>}
      </div>
    </div>
  );
}

function AuthChoices({
  next,
  directSocialAuth,
  compact = false,
}: {
  next: string;
  directSocialAuth: boolean;
  compact?: boolean;
}) {
  const query = encodeURIComponent(next);
  return (
    <div className={`auth-choice ${compact ? "auth-choice-compact" : ""}`}>
      <div className="social-auth-buttons">
        <a className="social-login google-login" href={`/auth/google?next=${query}`}><Icon name="google" size={20} /><span>使用 Google 登录</span></a>
      </div>
      {!compact && (
        <p className="auth-provider-note">
          {directSocialAuth ? "登录后可跨设备找回自己的席位。" : "登录由 ChatGPT 安全承接，可在下一步选择 Google。"}
        </p>
      )}
    </div>
  );
}

function AccountBadge({ user, next }: { user: InitialUser; next: string }) {
  return (
    <div className="account-badge">
      <span className="account-avatar"><Icon name="person" size={15} /><em>{user.displayName.slice(0, 1).toUpperCase()}</em></span>
      <div><b>{user.displayName}</b><small>{user.email ?? "已登录账号"}</small></div>
      <a href={`/auth/logout?next=${encodeURIComponent(next)}`}>退出</a>
    </div>
  );
}

function ParticipationSelector({
  wantsAgent,
  onChange,
}: {
  wantsAgent: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <fieldset className="participation-selector">
      <legend>谁来操作你的席位</legend>
      <div>
        <button type="button" className={!wantsAgent ? "active" : ""} onClick={() => onChange(false)} aria-pressed={!wantsAgent}>
          <span className="selector-icon"><Icon name="person" />{!wantsAgent && <i><Icon name="check" size={12} /></i>}</span><b>本人参与</b><small>由当前浏览器安全操作</small>
        </button>
        <button type="button" className={wantsAgent ? "active" : ""} onClick={() => onChange(true)} aria-pressed={wantsAgent}>
          <span className="selector-icon"><Icon name="bot" />{wantsAgent && <i><Icon name="check" size={12} /></i>}</span><b>我的 Agent 参与</b><small>入席后生成一次性配对码</small>
        </button>
      </div>
      <p><Icon name="lock" size={13} />无论由谁操作，席位都只属于你；房主不能替你授权。</p>
    </fieldset>
  );
}

function Landing({
  initialCode,
  initialUser,
  directSocialAuth,
  onCreate,
  onJoin,
  recentRoom,
  onResume,
  busy,
}: {
  initialCode: string;
  initialUser: InitialUser | null;
  directSocialAuth: boolean;
  onCreate: (name: string, maxPlayers: number, wantsAgent: boolean) => void;
  onJoin: (code: string, name: string, wantsAgent: boolean) => void;
  recentRoom: RecentRoom | null;
  onResume: (code: string) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"create" | "join">(initialCode ? "join" : "create");
  const [name, setName] = useState(initialUser?.displayName ?? "");
  const [code, setCode] = useState(initialCode);
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [wantsAgent, setWantsAgent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const nameError = attempted && !name.trim() ? "请输入玩家昵称" : "";
  const codeError = attempted && mode === "join" && code.length !== 6 ? "请输入完整的六位房间码" : "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!name.trim() || (mode === "join" && code.length !== 6)) return;
    if (mode === "create") onCreate(name, maxPlayers, wantsAgent);
    else onJoin(code, name, wantsAgent);
  };

  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <TopBrand />
        {initialUser
          ? <AccountBadge user={initialUser} next={initialCode ? `/?room=${initialCode}` : "/"} />
          : <AuthChoices next={initialCode ? `/?room=${initialCode}` : "/"} directSocialAuth={directSocialAuth} compact />}
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span>真人与智能体同席的在线牌桌</span><b><Icon name="shield" size={13} />服务端裁定</b></p>
          <h1>一桌谋局，<br /><em>人机皆可入席。</em></h1>
          <p className="hero-lede">
            创建一个 2–10 人三国杀房间，邀请朋友本人参与；也可以让 Codex、Claude 或你自己的 Agent 安全操作属于你的席位。
          </p>
          <div className="hero-points">
            <span><i><Icon name="users" /></i><b>房间码邀请</b><small>2 人或 4–10 人</small></span>
            <span><i><Icon name="refresh" /></i><b>断线可恢复</b><small>席位归属不会丢失</small></span>
            <span><i><Icon name="bot" /></i><b>Agent 可接入</b><small>最小权限、随时接管</small></span>
          </div>
          <div className="mini-table" aria-hidden="true">
            <div className="mini-orbit orbit-one"><i>曹</i><i>关</i><i>孙</i></div>
            <div className="mini-orbit orbit-two"><i>吕</i><i>貂</i></div>
            <div className="mini-deck"><span>杀</span><small>谋局</small></div>
          </div>
        </div>

        <form className="entry-card" onSubmit={submit} aria-busy={busy}>
          {recentRoom && <button type="button" className="resume-room-card" onClick={() => onResume(recentRoom.code)} disabled={busy}><span><Icon name="refresh" size={17} /></span><div><small>{recentRoom.status === "playing" ? "未完成对局" : "最近房间"}</small><b>返回房间 {recentRoom.code}</b><em>{recentRoom.mode === "duel" ? "经典 1V1" : "经典身份局"} · {recentRoom.name}</em></div><Icon name="chevron" size={17} /></button>}
          <div className="entry-tabs" aria-label="选择入席方式">
            <button type="button" className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setAttempted(false); }} aria-pressed={mode === "create"}><Icon name="users" size={17} />创建房间</button>
            <button type="button" className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setAttempted(false); }} aria-pressed={mode === "join"}><Icon name="link" size={17} />加入房间</button>
          </div>
          <div className="entry-body" key={mode}>
            {initialUser ? (
              <div className="signed-in-state"><Icon name="shield" /><span>已登录账号</span><strong>{initialUser.displayName}</strong><small>席位可在其他设备登录后恢复</small></div>
            ) : (
              <>
                <div className="guest-mode-banner"><Icon name="person" /><span><b>访客模式</b><small>无需注册 · 本房间 24 小时有效</small></span></div>
                <AuthChoices next={initialCode ? `/?room=${initialCode}` : "/"} directSocialAuth={directSocialAuth} />
                <div className="guest-divider"><span>或以一次性访客继续</span></div>
              </>
            )}
            <label>
              <span>玩家昵称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：云间客" maxLength={16} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-error" : undefined} />
              {nameError && <small id="name-error" className="field-error"><Icon name="warning" size={13} />{nameError}</small>}
            </label>
            <ParticipationSelector wantsAgent={wantsAgent} onChange={setWantsAgent} />
            {mode === "create" ? (
              <fieldset className="game-mode-selector">
                <legend>玩法与席位</legend>
                <div className="game-mode-cards">
                  <button type="button" className={maxPlayers === 2 ? "active" : ""} onClick={() => setMaxPlayers(2)} aria-pressed={maxPlayers === 2}>
                    <span className="mode-visual duel-visual" aria-hidden="true"><i><Icon name="sword" size={15} /></i><i><Icon name="sword" size={15} /></i></span><b>经典 1V1</b><small>2 人 · 三将擂台</small>{maxPlayers === 2 && <em><Icon name="check" size={12} /></em>}
                  </button>
                  <button type="button" className={maxPlayers !== 2 ? "active" : ""} onClick={() => setMaxPlayers(maxPlayers === 2 ? 4 : maxPlayers)} aria-pressed={maxPlayers !== 2}>
                    <span className="mode-visual identity-visual" aria-hidden="true"><i>主</i><i>忠</i><i>反</i><i>内</i></span><b>经典身份局</b><small>4–10 人 · 阵营博弈</small>{maxPlayers !== 2 && <em><Icon name="check" size={12} /></em>}
                  </button>
                </div>
                {maxPlayers === 2 ? (
                  <p className="duel-mode-note">10 将蛇形选取、双方各得 5 将并秘密排定 3 将；第三名出战武将阵亡才告负。</p>
                ) : (
                  <div className="seat-picker" aria-label="身份局席位数量">
                    {[4, 5, 6, 7, 8, 9, 10].map((count) => (
                      <button type="button" key={count} className={maxPlayers === count ? "active" : ""} onClick={() => setMaxPlayers(count)} aria-pressed={maxPlayers === count}>{count}</button>
                    ))}
                    <p className="identity-role-summary"><Icon name="users" size={14} />{IDENTITY_ROLE_SUMMARY[maxPlayers]}</p>
                  </div>
                )}
              </fieldset>
            ) : (
              <label>
                <span>六位房间码</span>
                <input className="room-code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} placeholder="例如 8F3KQ2" maxLength={6} autoCapitalize="characters" aria-invalid={Boolean(codeError)} aria-describedby={codeError ? "code-error" : undefined} />
                {codeError && <small id="code-error" className="field-error"><Icon name="warning" size={13} />{codeError}</small>}
              </label>
            )}
            <button className="primary-entry" disabled={busy}>
              <span className={busy ? "button-spinner" : "primary-entry-icon"}>{busy ? null : <Icon name={mode === "create" ? "users" : "play"} />}</span>
              <span><b>{busy ? "正在验证并入席…" : mode === "create" ? "创建房间" : "加入房间"}</b><small>{initialUser ? "登录账号" : "一次性访客"} · {wantsAgent ? "Agent 操作" : "本人操作"}</small></span>
              {!busy && <Icon name="chevron" size={18} />}
            </button>
            <p className="entry-foot"><Icon name="lock" size={13} />{initialUser ? "账号仅拥有自己的席位与控制权" : "访客凭证只属于本房间，并在 24 小时后失效"}</p>
          </div>
        </form>
      </section>
      <footer className="landing-footer"><span>经典三将1V1 + 标准身份局 · 非官方同人实现</span><span>108 张标准+EX · 25 名武将 · 2 人或 4–10 人</span></footer>
    </main>
  );
}

function CopyButton({ text, children, onCopied, disabled = false }: { text: string; children: React.ReactNode; onCopied: () => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={`copy-button copy-${state}`}
      disabled={disabled}
      onClick={async () => {
        try {
          if (!navigator.clipboard) throw new Error("clipboard unavailable");
          await navigator.clipboard.writeText(text);
          setState("copied");
          onCopied();
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2200);
      }}
      aria-label={state === "copied" ? "已复制" : state === "failed" ? "复制失败，请重试" : "复制"}
    >
      <Icon name={state === "copied" ? "check" : state === "failed" ? "warning" : "copy"} size={15} />
      <span>{state === "copied" ? "已复制" : state === "failed" ? "复制失败" : children}</span>
    </button>
  );
}

function AgentModal({
  pairing,
  room,
  status,
  diagnostics,
  onClose,
  onCopied,
  onRefresh,
}: {
  pairing: AgentPairing;
  room: string;
  status?: AgentPublicStatus;
  diagnostics?: AgentDiagnostics | null;
  onClose: () => void;
  onCopied: () => void;
  onRefresh: () => void;
}) {
  const dialogRef = useDialogBehavior(onClose);
  const [secondsRemaining, setSecondsRemaining] = useState(() => Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setSecondsRemaining(Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [pairing.expiresAt]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const skillUrl = `${origin}/api/agent-skill?room=${room}`;
  const cliUrl = `${origin}/api/agent-cli`;
  const instruction = `请作为「${pairing.seatName}」加入谋局·三国杀，并持续行动到对局结束。\n\n请先完整读取并严格遵循此 Agent Skill：\n${skillUrl}\n\n房间码：${room}\n五分钟一次性配对码：${pairing.pairingCode}`;
  const expiresAt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(pairing.expiresAt));
  const expired = secondsRemaining <= 0;
  const claimed = Boolean(status && !["pairing", "pairing_expired"].includes(status.state));
  const snapshotReceived = claimed && Boolean(diagnostics?.lastSnapshotAt);
  const ready = snapshotReceived && Boolean(diagnostics?.readyAt && status?.ready);
  const attendanceMissing = status?.state === "unattended";
  const connectionFailed = claimed && Boolean(status && ["offline", "safe_mode"].includes(status.state));
  const countdown = `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="modal agent-modal" role="dialog" aria-modal="true" aria-labelledby="agent-title">
        <button className="modal-close" onClick={onClose} aria-label="关闭" autoFocus>×</button>
        <p className="modal-kicker"><Icon name="shield" size={14} />一次性安全配对</p>
        <h2 id="agent-title">把这个席位交给你的 Agent</h2>
        <p className="modal-lede">复制整段指令给 Codex、Claude 或你的 Agent。配对码五分钟内、仅可使用一次；真正的访问令牌只会返回给 Agent。</p>
        <ol className="pairing-progress" aria-label="Agent 接入进度">
          <li className={claimed ? "complete" : expired ? "failed" : "active"}><Icon name={claimed ? "check" : expired ? "warning" : "clock"} /><span>{claimed ? "CLI 已领取凭证" : expired ? "配对码已过期" : "等待 CLI 领取"}</span></li>
          <li className={snapshotReceived ? "complete" : connectionFailed ? "failed" : claimed ? "active" : ""}><Icon name={snapshotReceived ? "check" : connectionFailed ? "warning" : "link"} /><span>{snapshotReceived ? "CLI 已读取牌桌" : connectionFailed ? "读取牌桌超时" : "CLI 读取牌桌"}</span></li>
          <li className={ready ? "complete" : (connectionFailed || attendanceMissing) && snapshotReceived ? "failed" : snapshotReceived ? "active" : ""}><Icon name={ready ? "check" : (connectionFailed || attendanceMissing) && snapshotReceived ? "warning" : "refresh"} /><span>{ready ? "心跳与持续守候已验证" : attendanceMissing ? "Agent 未开始持续守候" : connectionFailed && snapshotReceived ? "持续心跳超时" : "验证心跳与守候"}</span></li>
          <li className={ready ? "complete" : attendanceMissing ? "failed" : ""}><Icon name={attendanceMissing ? "warning" : "check"} /><span>{ready ? "CLI 会话已就绪" : attendanceMissing ? "需要继续执行 next" : "保持 CLI 会话"}</span></li>
        </ol>
        <div className="agent-token-block pairing-code-block">
          <span><Icon name="person" size={14} />席位</span><strong>{pairing.seatName}</strong>
          <span><Icon name="lock" size={14} />配对码</span><code className={expired && !claimed ? "expired" : ""}>{claimed ? "已安全领取" : expired ? "已失效" : pairing.pairingCode}</code>
          <span><Icon name={claimed ? "shield" : "clock"} size={14} />{claimed ? "领取状态" : "剩余时间"}</span><small className={!claimed && secondsRemaining <= 60 ? "urgent" : ""}>{claimed ? "一次性配对码已消费；Agent 凭证独立有效" : expired ? `已于 ${expiresAt} 失效` : `${countdown} · 至 ${expiresAt}`}</small>
        </div>
        {ready
          ? <button type="button" className="pairing-complete" onClick={onClose}><Icon name="check" size={16} />Agent 已就绪，完成</button>
          : attendanceMissing
            ? <div className="pairing-live-status" role="alert"><Icon name="warning" size={18} /><b>CLI 心跳在线，但 Agent 没有持续读取决策</b><small>让原 Agent 继续严格执行 Skill；不要重新配对，也不要只运行 status。</small></div>
          : connectionFailed
            ? <button type="button" className="pairing-refresh" onClick={onRefresh}><Icon name="refresh" size={16} />接入超时，生成新的配对码</button>
          : claimed
            ? <div className="pairing-live-status" role="status" aria-live="polite"><span className="button-spinner" /><b>{snapshotReceived ? "正在等待 CLI 的第二次间隔心跳…" : "CLI 已领取凭证，正在读取牌桌…"}</b><small>{snapshotReceived ? `正常约 5–8 秒；可让 Agent 执行：node /tmp/mouju-agent-cli.mjs status --room ${room}` : "connect 会自行启动守护进程；不要放入后台任务或启动第二个连接"}</small></div>
          : expired
          ? <button type="button" className="pairing-refresh" onClick={onRefresh}><Icon name="refresh" size={16} />生成新的配对码</button>
          : <CopyButton text={instruction} onCopied={onCopied}>复制完整 Agent 指令</CopyButton>}
        <details className="agent-security-details">
          <summary><Icon name="shield" size={15} /><span>Agent 权限与高级接入信息</span><small>最小权限 · 随时接管</small><Icon name="chevron" size={13} /></summary>
          <div className="agent-permission-grid">
            <div><span><Icon name="shield" size={14} />允许</span><b><Icon name="cards" size={14} />查看自己的视图</b><b><Icon name="play" size={14} />替自己的席位行动</b><b><Icon name="activity" size={14} />发送存活心跳</b></div>
            <div className="denied"><span><Icon name="lock" size={14} />禁止</span><b><Icon name="crown" size={14} />管理房间或其他席位</b><b><Icon name="person" size={14} />读取账号资料</b><b><Icon name="link" size={14} />再次转授权限</b></div>
          </div>
          <div className="agent-links">
            <a href={skillUrl} target="_blank" rel="noreferrer"><Icon name="book" size={14} />查看 Agent Skill<Icon name="external" size={12} /></a>
            <a href={cliUrl} target="_blank" rel="noreferrer"><Icon name="server" size={14} />下载官方 CLI<Icon name="external" size={12} /></a>
            <a href="/api/agent-spec" target="_blank" rel="noreferrer"><Icon name="server" size={14} />查看接口规范<Icon name="external" size={12} /></a>
          </div>
          <p className="security-note"><Icon name="shield" size={16} /><span>本站不需要、也不会索取 Agent 的 API Key。你可随时“立即接管”并撤销凭证。</span></p>
        </details>
      </section>
    </div>
  );
}

function RulesModal({ onClose, initialMode = "identity", currentPhase = null }: { onClose: () => void; initialMode?: "duel" | "identity"; currentPhase?: string | null }) {
  const dialogRef = useDialogBehavior(onClose);
  const [mode, setMode] = useState<"duel" | "identity">(initialMode);
  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <button className="modal-close" onClick={onClose} aria-label="关闭" autoFocus>×</button>
        <p className="modal-kicker"><Icon name="book" size={14} />经典标准规则 · 108 张标准+EX</p>
        <h2 id="rules-title">经典标准规则</h2>
        <div className="rules-mode-tabs" aria-label="选择规则模式">
          <button type="button" className={mode === "duel" ? "active" : ""} onClick={() => setMode("duel")} aria-pressed={mode === "duel"}><Icon name="sword" />经典 1V1</button>
          <button type="button" className={mode === "identity" ? "active" : ""} onClick={() => setMode("identity")} aria-pressed={mode === "identity"}><Icon name="users" />身份局</button>
        </div>
        <div className="rules-visual-grid">
          <article className="rule-visual-card win-rule">
            <header><Icon name={mode === "duel" ? "sword" : "crown"} /><span>{mode === "duel" ? "三将擂台" : "阵营胜负"}</span></header>
            {mode === "duel" ? (
              <><div className="duel-draft-flow" aria-label="十将蛇形选取顺序"><b>1</b><i /><b>2</b><i /><b>2</b><i /><b>2</b><i /><b>2</b><i /><b>1</b></div><p>双方各得 5 将，再秘密排列 3 将。前两将阵亡后换将，第三将阵亡才告负。</p></>
            ) : (
              <><div className="role-goals"><span className="role-lord">主<small>消灭反、内</small></span><span className="role-loyalist">忠<small>保护主公</small></span><span className="role-rebel">反<small>击杀主公</small></span><span className="role-renegade">内<small>最后存活</small></span></div><p>身份仅按规则允许公开；主忠、反贼、内奸拥有不同胜利目标。</p></>
            )}
          </article>
          <article className="rule-visual-card response-rule">
            <header><Icon name="shield" /><span>常见响应链</span></header>
            <div className="response-flow"><span><Icon name="sword" />杀</span><i>→</i><span><Icon name="shield" />闪</span><b>或承受 1 点伤害</b></div>
            <div className="response-flow"><span><Icon name="spark" />锦囊</span><i>→</i><span><Icon name="refresh" />无懈</span><b>可继续反无懈</b></div>
          </article>
        </div>
        <section className="phase-guide" aria-label="回合六阶段">
          <header><Icon name="clock" /><span>一个回合的六个阶段</span></header>
          <ol>{GAME_PHASES.map((phase, index) => <li key={phase} className={currentPhase === phase ? "active" : ""}><i>{index + 1}</i><b>{PHASE_LABELS[phase].replace("阶段", "")}</b>{index < GAME_PHASES.length - 1 && <span>→</span>}</li>)}</ol>
        </section>
        <details className="rules-version-note">
          <summary>版本口径与完整说明<Icon name="chevron" size={14} /></summary>
          <p className="rules-scope">双人玩法采用经典 KOF/王者之战流程：选将先手与行动先手分离，行动先手首回合少摸一张，主公技与身份击杀奖惩关闭。本站沿用 108 张标准+EX 牌和标准 25 将池。身份局口径固定为 2009/2011 经典标准版。</p>
        </details>
      </section>
    </div>
  );
}

function ConfirmRemoveModal({ player, onClose, onConfirm }: { player: PlayerView; onClose: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogBehavior(onClose);
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-player-title" aria-describedby="remove-player-description">
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭" autoFocus>×</button>
        <span className="confirm-icon"><Icon name="warning" size={26} /></span>
        <p className="modal-kicker">移除席位</p>
        <h2 id="remove-player-title">确定移除“{player.name}”吗？</h2>
        <p id="remove-player-description">该玩家会离开房间；如果其席位由 Agent 操作，当前连接和席位凭证也会立即失效。</p>
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="destructive" onClick={() => { onConfirm(); onClose(); }}><Icon name="warning" size={15} />确认移除</button>
        </div>
      </section>
    </div>
  );
}

function LeaveRoomModal({ view, busy, onClose, onConfirm }: { view: RoomView; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogBehavior(onClose);
  const inLobby = view.room.status === "lobby";
  const nextHost = view.you?.isHost ? view.players.find((entry) => entry.id !== view.you?.playerId) : null;
  const agentContinues = view.you?.controlMode === "agent";
  const title = inLobby ? view.you?.isHost && nextHost ? `退出并把房主移交给“${nextHost.name}”？` : "确定离开这个房间？" : "暂时离开牌桌？";
  const description = inLobby
    ? view.you?.isHost && nextHost
      ? "你的席位会被释放，房间和其他参与者保留；新房主可以继续管理并开始对局。"
      : "你的席位会立即释放；如果房间只剩你一人，房间会同时关闭。"
    : agentContinues
      ? "你的席位和 Agent 授权都会保留，Agent 可以继续行动。你可从首页的“返回对局”重新进入并随时接管。"
      : "你的席位会保留。离线期间若轮到你，截止时间到达后服务器会执行安全默认动作；重新进入即可恢复当前局面。";
  const confirmLabel = !inLobby
    ? "暂时离开，保留席位"
    : view.you?.isHost && nextHost
      ? `离开并移交给 ${nextHost.name}`
      : view.players.length === 1
        ? "离开并关闭房间"
        : "确认离开";
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className="modal confirm-modal leave-room-modal" role="alertdialog" aria-modal="true" aria-labelledby="leave-room-title" aria-describedby="leave-room-description">
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭" disabled={busy} autoFocus>×</button>
        <span className="confirm-icon leave-icon"><Icon name="exit" size={26} /></span>
        <p className="modal-kicker">{inLobby ? "离开房间" : "暂离保席"}</p>
        <h2 id="leave-room-title">{title}</h2>
        <p id="leave-room-description">{description}</p>
        {!inLobby && view.you?.identityType === "guest" && <p className="leave-retention-note"><Icon name="lock" size={14} />本浏览器的访客恢复凭证最多保留 24 小时，请勿清理浏览器数据。</p>}
        <div className="confirm-actions">
          <button type="button" onClick={onClose} disabled={busy}>继续留在牌桌</button>
          <button type="button" className={inLobby ? "destructive" : "leave-safe"} onClick={onConfirm} disabled={busy}>{busy ? <span className="button-spinner" /> : <Icon name="exit" size={15} />}{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function ConnectionBanner({ online, onRetry }: { online: boolean; onRetry: () => void }) {
  return (
    <div className={`connection-banner ${online ? "reconnecting" : "offline"}`} role="alert">
      <span><Icon name={online ? "refresh" : "warning"} size={16} /><b>{online ? "正在重新同步牌桌" : "网络已断开"}</b><small>{online ? "操作暂时锁定，恢复后会自动更新" : "席位仍由服务器保留，联网后自动恢复"}</small></span>
      <button type="button" onClick={onRetry} disabled={!online}><Icon name="refresh" size={14} />立即重试</button>
    </div>
  );
}

function ReconnectScreen({ state, online, busy, onRetry, onBack }: { state: ReconnectState; online: boolean; busy: boolean; onRetry: () => void; onBack: () => void }) {
  const missing = state.reason === "room_missing";
  const access = state.reason === "access";
  const title = missing ? "这个房间已经不存在" : access ? "无法恢复这个席位" : online ? "正在重新连接牌桌" : "当前设备没有网络";
  return (
    <main className="reconnect-shell" role="main">
      <section className="reconnect-card" aria-live="polite">
        <span className={`reconnect-orbit ${online && state.retryable ? "is-online" : ""}`}><Icon name={state.retryable ? online ? "refresh" : "wifi" : "warning"} size={28} /></span>
        <p><Icon name={state.retryable ? "shield" : "warning"} size={14} />{state.retryable ? "正在核验席位" : missing ? "房间已关闭" : "恢复入口失效"}</p>
        <h1>{title}</h1>
        <strong>房间 {state.code}</strong>
        <small>{state.message || (online ? "正在验证身份并获取服务器最新局面…" : "联网后将自动重试，不会创建重复席位。")}</small>
        <div>
          {state.retryable && <button type="button" className="primary-action" onClick={onRetry} disabled={!online || busy}>{busy ? <span className="button-spinner" /> : <Icon name="refresh" size={15} />}立即重试</button>}
          <button type="button" className={state.retryable ? "ghost-action" : "primary-action"} onClick={onBack}>{missing ? "返回首页，创建新房间" : "返回首页"}</button>
        </div>
      </section>
    </main>
  );
}

function Lobby({
  view,
  initialUser,
  directSocialAuth,
  busy,
  onStart,
  onCreatePairing,
  onRevokeAgent,
  onClaimGuest,
  onRemove,
  onCopy,
  onRules,
  onLeave,
}: {
  view: RoomView;
  initialUser: InitialUser | null;
  directSocialAuth: boolean;
  busy: boolean;
  onStart: () => void;
  onCreatePairing: () => void;
  onRevokeAgent: () => void;
  onClaimGuest: () => void;
  onRemove: (id: string) => void;
  onCopy: () => void;
  onRules: () => void;
  onLeave: () => void;
}) {
  const invite = typeof window === "undefined" ? "" : `${window.location.origin}/?room=${view.room.code}`;
  const duel = view.room.mode === "duel";
  const empty = Math.max(0, view.room.maxPlayers - view.players.length);
  const agentControlsMySeat = view.you?.controlMode === "agent";
  const pairingMySeat = view.you?.controlMode === "pairing";
  const canUpgradeGuest = Boolean(initialUser && view.you?.identityType === "guest");
  const [pendingRemove, setPendingRemove] = useState<PlayerView | null>(null);
  const blockerText = (blocker: RoomView["room"]["startBlockers"][number]) => blocker.code === "NOT_ENOUGH_PLAYERS"
    ? duel ? "需要两名参与者" : "至少需要四名参与者"
    : blocker.code === "AGENT_PAIRING"
      ? `${blocker.count} 个席位等待 Agent 领取`
      : blocker.code === "AGENT_NOT_READY"
        ? `${blocker.count} 个 Agent 尚未同步最新快照`
        : blocker.code === "AGENT_UNATTENDED"
          ? `${blocker.count} 个 Agent 已连接但未持续守候`
        : `${blocker.count} 个 Agent 离线或心跳过期`;
  const primaryBlocker = view.room.startBlockers[0] ? blockerText(view.room.startBlockers[0]) : null;
  const startLabel = primaryBlocker ?? (duel ? "开始经典 1V1" : "开始身份局");
  return (
    <main className="room-shell lobby-shell">
      <header className="room-topbar">
        <TopBrand compact />
        <div className="room-chip"><i className="status-pulse" /><span>等待开局</span><b>{view.room.code}</b></div>
        <nav>
          <span className={`seat-identity-chip identity-${view.you?.identityType}`}><Icon name={view.you?.identityType === "account" ? "shield" : "person"} size={14} />{view.you?.identityType === "account" ? "账号席位" : "一次性访客"}</span>
          <button onClick={onRules}><Icon name="book" size={15} />规则</button>
          <CopyButton text={invite} onCopied={onCopy}>复制邀请链接</CopyButton>
          <button className="room-leave-button" onClick={onLeave}><Icon name="exit" size={15} />离开</button>
        </nav>
      </header>

      <section className="lobby-main">
        <div className="lobby-title">
          <p><Icon name="users" size={14} />等待开局 · {view.players.length}/{view.room.maxPlayers} 已入席</p>
          <h1>{duel ? view.players.length < 2 ? "一席尚虚，" : "双雄已至，" : "诸位已入席，"}<em>{duel ? view.players.length < 2 ? "静候对手。" : "待决胜负。" : "静候开局。"}</em></h1>
          <span>{duel ? "双人三将擂台；选将、秘密阵容和换将均由服务器裁定并隔离。" : "真人与 Agent 使用同一套规则、同一副牌，隐藏信息彼此隔离。"}</span>
        </div>
        <div className="lobby-layout">
          <div className="seat-list">
            {view.players.map((entry, index) => (
              <article className={`lobby-seat ${entry.controlMode === "agent" || entry.controlMode === "pairing" ? "agent-seat" : ""}`} key={entry.id}>
                <div className="seat-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="lobby-avatar"><Icon name={entry.controlMode === "human" ? "person" : entry.controlMode === "pairing" ? "link" : "bot"} size={22} /><b>{entry.name.slice(0, 1)}</b>{entry.id === view.room.hostPlayerId && <em title="房主"><Icon name="crown" size={12} /></em>}<i className={entry.connected ? "online" : ""} /></div>
                <div className="lobby-seat-copy">
                  <strong>{entry.name}</strong>
                  <span>{entry.id === view.room.hostPlayerId ? "房主 · " : ""}{entry.principalType === "account" ? "账号拥有" : "访客拥有"} · {entry.controlMode === "human" ? "本人操作" : entry.controlMode === "pairing" ? "等待 Agent 配对" : "Agent 操作"}</span>
                </div>
                {entry.agentStatus
                  ? <AgentStatusBadge status={entry.agentStatus} />
                  : <div className={`presence ${entry.connected ? "online" : ""}`}><Icon name={entry.connected ? "wifi" : "warning"} size={14} />{entry.connected ? "在线" : "离线"}</div>}
                {view.you?.isHost && entry.id !== view.room.hostPlayerId && (
                  <button className="remove-seat" onClick={() => setPendingRemove(entry)} aria-label={`管理 ${entry.name} 的席位`}><Icon name="more" size={18} /></button>
                )}
              </article>
            ))}
            {empty > 0 && (
              <article className="lobby-seat empty-seat empty-summary-seat">
                <div className="seat-number">+{empty}</div>
                <div className="lobby-avatar"><Icon name="users" size={22} /></div>
                <div className="lobby-seat-copy"><strong>{duel ? "等待对手" : `还有 ${empty} 个空席`}</strong><span>把房间码或邀请链接发给其他参与者</span></div>
                <CopyButton text={invite} onCopied={onCopy}>邀请玩家</CopyButton>
              </article>
            )}
          </div>
          <aside className="lobby-console">
            <p className="console-label"><Icon name="link" size={14} />房间邀请码</p>
            <div className="room-code-card"><div className="big-code">{view.room.code.slice(0, 3)}<i />{view.room.code.slice(3)}</div><CopyButton text={invite} onCopied={onCopy}>复制邀请</CopyButton></div>
            <p className="lobby-owner-note"><Icon name="lock" size={14} />每位参与者只创建并控制自己的席位；房主不能替别人授权 Agent。</p>
            {view.you?.agentDiagnostics ? (
              <AgentDiagnosticsPanel diagnostics={view.you.agentDiagnostics} busy={busy} onTakeover={onRevokeAgent} onRepair={onCreatePairing} />
            ) : (
              <div className={`seat-control-box ${agentControlsMySeat ? "delegated" : pairingMySeat ? "pairing" : ""}`}>
                <span><Icon name={agentControlsMySeat ? "refresh" : pairingMySeat ? "link" : "person"} size={14} />我的席位</span>
                <strong>{agentControlsMySeat ? "Agent 正在建立可信连接" : pairingMySeat ? "等待你的 Agent 完成配对" : "当前由本人参与"}</strong>
                <small>{agentControlsMySeat ? "完成首次快照、双心跳并进入持续 next 守候后才会显示就绪" : pairingMySeat ? "配对码五分钟内、仅可使用一次；过期可重新生成" : "只有你能决定是否把自己的席位交给 Agent"}</small>
                <div className="seat-control-actions">
                  {pairingMySeat ? (
                    <><button onClick={onCreatePairing} disabled={busy}>重新生成配对码</button><button className="takeover" onClick={onRevokeAgent} disabled={busy}>改由本人参与</button></>
                  ) : (
                    <button onClick={onCreatePairing} disabled={busy}>改由我的 Agent 参与</button>
                  )}
                </div>
              </div>
            )}
            {canUpgradeGuest && (
              <button className="claim-account" onClick={onClaimGuest} disabled={busy}>将访客席位绑定到 {initialUser!.displayName}</button>
            )}
            {view.you?.identityType === "guest" && !initialUser && (
              <div className="guest-upgrade-auth">
                <span>登录后可把当前访客席位绑定到账号</span>
                <AuthChoices next={`/?room=${view.room.code}`} directSocialAuth={directSocialAuth} compact />
              </div>
            )}
            {view.you?.isHost ? (
              <div className="lobby-action-dock">
                <div className="start-checklist" aria-label="开局检查">
                  <span className={view.players.length >= (duel ? 2 : 4) ? "passed" : ""}><Icon name={view.players.length >= (duel ? 2 : 4) ? "check" : "users"} />{duel ? `参与人数 ${view.players.length}/2` : `参与人数 ${view.players.length} · 至少 4 人`}</span>
                  {view.room.startBlockers.filter((entry) => entry.code !== "NOT_ENOUGH_PLAYERS").map((entry) => <span key={entry.code}><Icon name="warning" />{blockerText(entry)}</span>)}
                  {!view.room.startBlockers.length && <span className="passed"><Icon name="shield" />所有席位已通过检查</span>}
                </div>
                <button className="start-game" onClick={onStart} disabled={busy || !view.room.canStart} aria-describedby={primaryBlocker ? "start-game-blocker" : undefined}>
                  {busy
                    ? <><span className="button-spinner" />正在整备牌堆…</>
                    : <><Icon name={primaryBlocker ? "warning" : "play"} /><span>{startLabel}</span></>}
                </button>
                {primaryBlocker && <span id="start-game-blocker" className="sr-only">暂时不能开局：{primaryBlocker}</span>}
              </div>
            ) : (
              <div className="waiting-host"><Icon name="clock" /><span><b>等待房主开始对局</b><small>所有席位就绪后即可开局</small></span></div>
            )}
            <details className="lobby-protocol"><summary><Icon name="bot" size={14} />Agent 接入详情<Icon name="chevron" size={13} /></summary><div><a href={`/api/agent-skill?room=${view.room.code}`} target="_blank">Agent Skill <Icon name="external" size={11} /></a><a href="/api/agent-spec" target="_blank">JSON 接口 <Icon name="external" size={11} /></a></div></details>
          </aside>
        </div>
      </section>
      {pendingRemove && <ConfirmRemoveModal player={pendingRemove} onClose={() => setPendingRemove(null)} onConfirm={() => onRemove(pendingRemove.id)} />}
    </main>
  );
}

function HeartRow({ hp = 0, max = 0 }: { hp?: number; max?: number }) {
  if (max <= 0) {
    return <div className="heart-row heart-unknown" role="img" aria-label="体力尚未确定"><b>—</b></div>;
  }
  return <div className="heart-row" role="img" aria-label={`${hp}/${max} 体力`}><span className="heart-icons" aria-hidden="true">{Array.from({ length: max }).map((_, index) => <i className={index < hp ? "full" : ""} key={index}><Icon name="heart" size={11} /></i>)}</span><b>{hp}/{max}</b></div>;
}

const KINGDOM_LABEL: Record<GeneralInfo["kingdom"], string> = { wei: "魏", shu: "蜀", wu: "吴", qun: "群" };

function catalogGeneral(id: string): GeneralInfo | null {
  const general = STANDARD_CHARACTERS.find((entry) => entry.id === id);
  return general ? {
    ...general,
    kingdomName: KINGDOM_LABEL[general.kingdom],
    skills: general.skills.map((skillId) => SKILLS[skillId]),
  } : null;
}

function playerGeneral(player?: PlayerView | null): GeneralInfo | null {
  if (!player?.character) return null;
  return catalogGeneral(player.character.id) ?? {
    ...player.character,
    maxHp: player.maxHp ?? 0,
    // Legacy rooms expose one already-resolved skill. Keep the fallback
    // structured too: bracketed card names inside its prose are not headings.
    skills: [{ id: player.character.skillName, name: player.character.skillName, text: player.character.skillText, kind: "normal" }],
  };
}

function actionGeneral(action: LegalAction): GeneralInfo | null {
  if (action.action?.characterId) return catalogGeneral(action.action.characterId);
  const named = STANDARD_CHARACTERS.find((entry) => action.label.includes(entry.name));
  return named ? catalogGeneral(named.id) : null;
}

function GeneralDetailModal({ general, onClose }: { general: GeneralInfo; onClose: () => void }) {
  const dialogRef = useDialogBehavior(onClose);
  return (
    <div className="modal-backdrop general-detail-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={`modal general-detail-modal kingdom-${general.kingdom}`} role="dialog" aria-modal="true" aria-labelledby="general-detail-title">
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭武将说明" autoFocus>×</button>
        <header className="general-detail-hero">
          <span className="general-detail-glyph">{general.name.slice(0, 1)}</span>
          <div><p className="modal-kicker">{general.kingdomName}势力 · {general.maxHp} 点体力</p><h2 id="general-detail-title">{general.name}</h2><small>{general.title}</small></div>
        </header>
        <div className="general-skill-list">
          {general.skills.map((skill) => (
            <article key={skill.id}><span><Icon name="spark" size={15} />{skill.kind === "lord" ? "主公技" : skill.kind === "locked" ? "锁定技" : "武将技能"}</span><h3>【{skill.name}】</h3><p>{skill.text}</p></article>
          ))}
        </div>
        <p className="general-detail-tip"><Icon name="shield" size={14} />技能是否合法发动及结算顺序始终由服务端裁定。</p>
        <button type="button" className="card-detail-done" onClick={onClose}><Icon name="check" size={15} />返回牌桌</button>
      </section>
    </div>
  );
}

function equipmentIcon(slot: keyof EquipmentView): IconName {
  if (slot === "weapon") return "weapon";
  if (slot === "armor") return "armor";
  return "horse";
}

const EQUIPMENT_SLOT_LABELS: Record<keyof EquipmentView, string> = {
  weapon: "武器",
  armor: "防具",
  offensiveHorse: "进攻坐骑",
  defensiveHorse: "防御坐骑",
};

function PlayerZonesModal({ player, onClose, onCard }: { player: PlayerView; onClose: () => void; onCard: (card: Card) => void }) {
  const dialogRef = useDialogBehavior(onClose);
  const equipment = Object.entries(player.equipment ?? {}) as Array<[keyof EquipmentView, Card | null]>;
  const judgments = player.judgment ?? [];
  return (
    <div className="modal-backdrop player-zones-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="modal player-zones-modal" role="dialog" aria-modal="true" aria-labelledby="player-zones-title">
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭装备与判定区" autoFocus>×</button>
        <header className="player-zones-heading">
          <span className={`zone-player-mark kingdom-${player.character?.kingdom ?? "qun"}`}>{player.character?.name.slice(0,1) ?? player.name.slice(0,1)}</span>
          <div><p className="modal-kicker"><Icon name="shield" size={14} />公开区域</p><h2 id="player-zones-title">{player.name}的装备与判定区</h2><small>同桌所有玩家均可查看；点击卡牌可阅读完整规则。</small></div>
        </header>
        <div className="public-zone-section">
          <h3><Icon name="armor" size={15} />装备区 <b>{equipment.filter(([, card]) => Boolean(card)).length}/4</b></h3>
          <div className="public-equipment-grid">
            {equipment.map(([slot, card]) => card ? (
              <button type="button" className="public-zone-card" style={cardArtStyle(card)} key={slot} onClick={() => onCard(card)} aria-label={`查看${EQUIPMENT_SLOT_LABELS[slot]}【${card.name}】`}>
                <i><Icon name={equipmentIcon(slot)} size={16} /></i><span>{EQUIPMENT_SLOT_LABELS[slot]}</span><strong>{card.name}</strong><small>{SUIT[card.suit]} {card.rank}</small>
              </button>
            ) : (
              <div className="public-zone-card empty" key={slot}><i><Icon name={equipmentIcon(slot)} size={16} /></i><span>{EQUIPMENT_SLOT_LABELS[slot]}</span><strong>空槽</strong></div>
            ))}
          </div>
        </div>
        <div className="public-zone-section judgment-section">
          <h3><Icon name="judge" size={15} />判定区 <b>{judgments.length}</b></h3>
          {judgments.length ? <div className="public-judgment-list">{judgments.map((card) => <button type="button" className="public-zone-card" style={cardArtStyle(card)} key={card.id} onClick={() => onCard(card)} aria-label={`查看判定牌【${card.name}】`}><i><Icon name="judge" size={16} /></i><span>延时锦囊</span><strong>{card.name}</strong><small>{SUIT[card.suit]} {card.rank}</small></button>)}</div> : <div className="public-zone-empty"><Icon name="check" size={15} />当前没有待结算的判定牌</div>}
        </div>
        <button type="button" className="card-detail-done" onClick={onClose}><Icon name="check" size={15} />返回牌桌</button>
      </section>
    </div>
  );
}

function PlayerSeat({
  entry,
  index,
  count,
  viewerSeat,
  current,
  responding,
  targetable,
  chosen,
  eventPulse,
  onTarget,
  onInfo,
  onGeneral,
  onOpenZones,
  dragTarget,
  onCardDrop,
}: {
  entry: PlayerView;
  index: number;
  count: number;
  viewerSeat: number;
  current: boolean;
  responding: boolean;
  targetable: boolean;
  chosen: boolean;
  eventPulse: boolean;
  onTarget: () => void;
  onInfo: (card: Card) => void;
  onGeneral: () => void;
  onOpenZones: () => void;
  dragTarget: boolean;
  onCardDrop: () => void;
}) {
  const relative = ((index - viewerSeat) % count + count) % count;
  const angle = Math.PI / 2 + (relative * Math.PI * 2) / count;
  const style = {
    "--seat-x": `${50 + Math.cos(angle) * 41}%`,
    "--seat-y": `${48 + Math.sin(angle) * 35}%`,
  } as CSSProperties;
  const gear = Object.entries(entry.equipment ?? {}).filter((entry): entry is [keyof EquipmentView, Card] => Boolean(entry[1]));
  const judgments = entry.judgment ?? [];
  return (
    <article
      className={`player-seat kingdom-${entry.character?.kingdom ?? "qun"} ${gear.length > 0 || judgments.length > 0 ? "has-public-zones" : ""} ${current ? "current" : ""} ${responding ? "responding" : ""} ${targetable ? "targetable" : ""} ${chosen ? "chosen-target" : ""} ${eventPulse ? "event-pulse" : ""} ${entry.alive === false ? "dead" : ""} hp-updated`}
      style={style}
      data-player-id={entry.id}
      data-relative={relative}
      aria-current={current ? "step" : undefined}
      data-drag-target={dragTarget || undefined}
      onDragOver={(event) => { if (dragTarget) { event.preventDefault(); event.dataTransfer.dropEffect = "link"; } }}
      onDrop={(event) => { if (dragTarget) { event.preventDefault(); onCardDrop(); } }}
    >
      <button type="button" className="seat-target-hit" onClick={onTarget} disabled={!targetable} aria-label={`选择 ${entry.name} 为目标`} aria-pressed={chosen} />
      <button type="button" className="seat-portrait" onClick={onGeneral} disabled={!entry.character} aria-label={entry.character ? `查看武将${entry.character.name}的技能说明` : "武将尚未确定"}><Icon name="crown" className="portrait-silhouette" size={34} /><span>{entry.character?.name.slice(0, 1) ?? entry.name.slice(0, 1)}</span><small>{entry.character?.kingdomName ?? "群"}</small>{entry.character && <i className="general-info-hint"><Icon name="book" size={10} /></i>}</button>
      <div className="seat-detail">
        <div className="seat-meta"><span>{entry.controlMode !== "human" ? <><Icon name="bot" size={11} />Agent 操作</> : entry.character?.title ?? "玩家"}</span>{entry.role && <b className={`role role-${entry.role}`}>{entry.roleName === "先手" ? "先" : entry.roleName === "后手" ? "后" : ROLE_SHORT[entry.role]}</b>}</div>
        <strong>{entry.character?.name ?? entry.name}</strong>
        <small>{entry.name}</small>
        {typeof entry.duelReserveCount === "number" && <div className="duel-roster-status"><span aria-label={`备将 ${entry.duelReserveCount}`}>{Array.from({ length: 3 }).map((_, i) => <i className={i < entry.duelReserveCount! ? "ready" : ""} key={i}><Icon name="person" size={10} /></i>)}</span><b>已败 {entry.duelDefeatedCount ?? 0}/3</b></div>}
        {(gear.length > 0 || judgments.length > 0) && (
          <div className="seat-zones" aria-label="装备与判定区">
            {gear.map(([slot, card]) => <button type="button" className={`zone-slot slot-${slot}`} key={card.id} onClick={() => onInfo(card)} title={`查看装备【${card.name}】`} aria-label={`装备 ${card.name}`}><Icon name={equipmentIcon(slot)} size={12} /><span>{card.name}</span></button>)}
            {judgments.map((card) => <button type="button" className="zone-slot judgment-chip" key={card.id} onClick={() => onInfo(card)} title={`查看判定牌【${card.name}】`} aria-label={`判定牌 ${card.name}`}><Icon name="judge" size={12} /><span>{card.name}</span></button>)}
          </div>
        )}
        {entry.agentStatus && <AgentStatusBadge status={entry.agentStatus} compact />}
        <div className="seat-stats"><HeartRow hp={entry.hp} max={entry.maxHp} /><span className="seat-hand-count" aria-label={`${entry.handCount ?? 0} 张手牌`}><Icon name="cards" size={12} /><small>手牌</small><b>{entry.handCount ?? 0}</b></span></div>
      </div>
      {(gear.length > 0 || judgments.length > 0) && <button type="button" className={`seat-zone-summary ${judgments.length ? "has-judgment" : ""}`} onClick={onOpenZones} aria-label={`查看${entry.name}的公开区域：${gear.length}件装备，${judgments.length}张判定牌`}><Icon name={gear.length ? "armor" : "judge"} size={11} /><b>{gear.length || judgments.length}</b>{judgments.length > 0 && <i aria-hidden="true">!</i>}</button>}
      {chosen && <span className="target-check" aria-hidden="true"><Icon name="check" size={15} /></span>}
      {current && <em className="turn-ribbon"><Icon name="play" size={11} />行动</em>}
      {responding && <em className="response-ribbon"><Icon name="shield" size={11} />响应</em>}
      {entry.controlMode === "human" && !entry.connected && <em className="offline-ribbon"><Icon name="warning" size={11} />离线</em>}
    </article>
  );
}

function cardArtStyle(card: Card) {
  return { "--card-art": `url("${CARD_GUIDES[card.name].image}")` } as CSSProperties;
}

function CardTile({
  card,
  selected,
  selectable,
  onClick,
  onInfo,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  selected: boolean;
  selectable: boolean;
  onClick: () => void;
  onInfo: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const guide = CARD_GUIDES[card.name];
  return (
    <div
      className={`hand-card ${card.color} ${selected ? "selected" : ""} ${selectable ? "" : "selection-locked"} ${dragging ? "dragging" : ""}`}
      style={cardArtStyle(card)}
      role="group"
      aria-label={`${card.name}，${guide.category}，${SUIT[card.suit]}${card.rank}`}
      draggable={selectable}
      onDragStart={(event) => { if (!selectable) return; event.dataTransfer.effectAllowed = "link"; event.dataTransfer.setData("text/plain", card.id); onDragStart(); }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="card-select-hit"
        onClick={onClick}
        aria-label={`选择【${card.name}】${SUIT[card.suit]}${card.rank}`}
        aria-pressed={selected}
        disabled={!selectable}
      />
      <span className="card-corner"><b>{card.rank}</b><i>{SUIT[card.suit]}</i></span>
      <span className={`card-name-ribbon ${card.name.length >= 4 ? "long-name" : ""}`}><strong>{card.name}</strong></span>
      <small>{guide.category.replace("牌", "")}</small>
      <span className="card-mark">谋</span>
      {selected && <span className="card-selected-mark" aria-hidden="true"><Icon name="check" size={14} /></span>}
      <button
        type="button"
        className="card-info-button"
        onClick={(event) => { event.stopPropagation(); onInfo(); }}
        aria-label={`查看【${card.name}】详细功能解说`}
        title={`查看【${card.name}】详细功能解说`}
      >
        <Icon name="book" size={15} />
      </button>
    </div>
  );
}

function CardDetailModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const guide = CARD_GUIDES[card.name];
  const dialogRef = useDialogBehavior(onClose);
  return (
    <div className="modal-backdrop card-detail-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal card-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-detail-title"
        aria-describedby="card-detail-subtitle"
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭卡牌解说" autoFocus>×</button>
        <div className="card-detail-layout">
          <div className="card-detail-visual" style={cardArtStyle(card)} aria-hidden="true">
            <span className={`detail-corner ${card.color}`}><b>{card.rank}</b><i>{SUIT[card.suit]}</i></span>
            <span className={`detail-name ${card.name.length >= 4 ? "long-name" : ""}`}><strong>{card.name}</strong></span>
            <small>{guide.category}</small>
            <em>谋</em>
          </div>
          <div className="card-detail-copy">
            <p className="modal-kicker"><Icon name="book" size={14} />卡牌功能解说 · 经典标准规则</p>
            <div className="card-detail-heading">
              <span>{guide.category}</span>
              <h2 id="card-detail-title">{card.name}</h2>
              <b>{SUIT[card.suit]} {card.rank}</b>
            </div>
            <p id="card-detail-subtitle" className="card-detail-subtitle">{guide.subtitle}</p>
            <dl className="card-detail-grid">
              <div><dt><Icon name="clock" size={15} />使用时机</dt><dd>{guide.timing}</dd></div>
              <div><dt><Icon name="target" size={15} />作用目标</dt><dd>{guide.target}</dd></div>
              <div className="wide"><dt><Icon name="spark" size={15} />结算效果</dt><dd>{guide.effect}</dd></div>
              <div className="wide"><dt><Icon name="shield" size={15} />如何响应</dt><dd>{guide.response}</dd></div>
            </dl>
            <div className="card-limit-box">
              <span><Icon name="lock" size={14} />限制与边界</span>
              <ul>{guide.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
            </div>
            {guide.rulesNote && <p className="card-rules-note"><Icon name="warning" size={15} /><span>{guide.rulesNote}</span></p>}
            <button type="button" className="card-detail-done" onClick={onClose}><Icon name="check" size={15} />知道了</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PhaseTrack({ phase }: { phase?: string | null }) {
  if (!phase) return <div className="setup-phase"><Icon name="users" size={15} /><span>对局准备</span><b>选将与阵容由服务器安全裁定</b></div>;
  const activeIndex = GAME_PHASES.indexOf((phase ?? "play") as (typeof GAME_PHASES)[number]);
  return (
    <ol className="phase-track" aria-label={`当前${PHASE_LABELS[phase ?? ""] ?? "出牌阶段"}`}>
      {GAME_PHASES.map((item, index) => (
        <li key={item} className={index === activeIndex ? "active" : index < activeIndex ? "passed" : ""} aria-current={index === activeIndex ? "step" : undefined}>
          <i>{index < activeIndex ? <Icon name="check" size={10} /> : index + 1}</i><span>{PHASE_LABELS[item].replace("阶段", "")}</span>
        </li>
      ))}
    </ol>
  );
}

function SyncStatus({ problem, lastSyncAt }: { problem: boolean; lastSyncAt: number | null }) {
  return (
    <span className={`server-connection-status ${problem ? "problem" : "ok"}`} role="status" aria-label={problem ? "服务器连接异常，画面可能已过期" : "牌桌已与服务器同步"}>
      <Icon name={problem ? "warning" : "wifi"} size={14} /><b>{problem ? "正在重连" : lastSyncAt ? "已同步" : "同步中"}</b>
    </span>
  );
}

function ResultOverlay({
  winner,
  players,
  logs,
  isHost,
  busy,
  onCopied,
  onRematch,
  onNewRoom,
}: {
  winner: NonNullable<RoomView["game"]>["winner"];
  players: PlayerView[];
  logs: NonNullable<RoomView["game"]>["logs"];
  isHost: boolean;
  busy: boolean;
  onCopied: () => void;
  onRematch: () => void;
  onNewRoom: () => void;
}) {
  if (!winner) return null;
  const winners = players.filter((entry) => winner.playerIds.includes(entry.id));
  const stats = players.map((player) => {
    const damage = logs.reduce((total, entry) => total + (entry.visual?.kind === "damage" && (entry.visual.sourceId === player.id || entry.visual.actorId === player.id) ? entry.visual.amount ?? 1 : 0), 0);
    const healing = logs.reduce((total, entry) => total + (entry.visual?.kind === "heal" && (entry.visual.sourceId === player.id || entry.visual.actorId === player.id) ? entry.visual.amount ?? 1 : 0), 0);
    const cards = logs.filter((entry) => (entry.visual?.kind === "use" || entry.visual?.kind === "aoe" || entry.visual?.kind === "equip") && entry.visual.actorId === player.id).length;
    const defeated = logs.filter((entry) => entry.visual?.kind === "death" && (entry.visual.sourceId === player.id || entry.visual.actorId === player.id)).length;
    return { player, damage, healing, cards, defeated, score: damage * 4 + healing * 3 + defeated * 6 + cards };
  }).sort((left, right) => right.score - left.score);
  const mvp = stats[0];
  const highlights = logs
    .filter((entry) => eventTier(entry) === "major" || entry.visual?.kind === "damage" || entry.visual?.kind === "heal" || entry.visual?.kind === "transfer")
    .slice(-5);
  const summary = `谋局·三国杀对局结果\n${winner.label}\n获胜方：${winners.map((entry) => entry.name).join("、")}\n\n${logs.map((entry) => entry.text).join("\n")}`;
  return (
    <section className="result-overlay" aria-label={`对局结束，${winner.label}`}>
      <header className="result-heading">
        <span className="result-seal"><Icon name="crown" size={28} /></span>
        <div><p>对局结束</p><h2>{winner.label}</h2><div className="result-winners">{winners.map((entry) => <span key={entry.id}><Icon name={entry.controlMode === "human" ? "person" : "bot"} size={14} />{entry.name}</span>)}</div></div>
      </header>
      {mvp && <section className="result-mvp"><i><Icon name="spark" size={17} /></i><div><span>本局表现</span><strong>{mvp.player.name}</strong></div><dl><div><dt>伤害</dt><dd>{mvp.damage}</dd></div><div><dt>回复</dt><dd>{mvp.healing}</dd></div><div><dt>用牌</dt><dd>{mvp.cards}</dd></div></dl></section>}
      <section className="result-scoreboard" aria-label="本局数据">
        {stats.map(({ player, damage, healing, cards, defeated }, index) => <article key={player.id}><b>{index + 1}</b><span>{player.name}<small>{winner.playerIds.includes(player.id) ? "胜方" : player.alive === false ? "阵亡" : "败方"}</small></span><em><i>伤 {damage}</i><i>疗 {healing}</i><i>牌 {cards}</i>{defeated > 0 && <i>破 {defeated}</i>}</em></article>)}
      </section>
      <section className="result-highlights" aria-label="关键事件">
        <header><Icon name="log" size={14} /><span>关键时刻</span><small>{highlights.length || "—"} 条</small></header>
        {highlights.length ? <ol>{highlights.map((entry) => { const meta = publicEventMeta(entry); return <li key={entry.id}><i><Icon name={meta.icon} size={12} /></i><span>{entry.text}</span><time>{eventClock(entry.at)}</time></li>; })}</ol> : <p>本局没有额外关键事件</p>}
      </section>
      <footer className="result-actions">
        {isHost && <button type="button" className="result-rematch" disabled={busy} onClick={onRematch}><Icon name="refresh" size={15} />{busy ? "正在重置牌桌…" : "同桌再来一局"}<small>保留玩家，Agent 需重新授权</small></button>}
        <CopyButton text={summary} onCopied={onCopied}>复制完整战报</CopyButton>
        <button type="button" onClick={onNewRoom}><Icon name="users" size={15} />创建新房间</button>
      </footer>
    </section>
  );
}

function GameBoard({
  view,
  initialUser,
  busy,
  onAction,
  onCreatePairing,
  onRevokeAgent,
  onClaimGuest,
  onCopy,
  onRules,
  onLeave,
  onRematch,
  onNewRoom,
  syncProblem,
  lastSyncAt,
  mobileLogOpen,
  onMobileLogChange,
}: {
  view: RoomView;
  initialUser: InitialUser | null;
  busy: boolean;
  onAction: (action: GameAction) => void;
  onCreatePairing: () => void;
  onRevokeAgent: () => void;
  onClaimGuest: () => void;
  onCopy: () => void;
  onRules: () => void;
  onLeave: () => void;
  onRematch: () => void;
  onNewRoom: () => void;
  syncProblem: boolean;
  lastSyncAt: number | null;
  mobileLogOpen: boolean;
  onMobileLogChange: (open: boolean) => void;
}) {
  const game = view.game!;
  const me = view.players.find((entry) => entry.id === view.you?.playerId);
  const viewerPlayerId = view.you?.playerId;
  const viewerIndex = Math.max(0, view.players.findIndex((entry) => entry.id === view.you?.playerId));
  const hand = me?.hand ?? [];
  const agentControlsMySeat = view.you?.controlMode === "agent";
  const pairingMySeat = view.you?.controlMode === "pairing";
  const diagnostics = view.you?.agentDiagnostics;
  const delegatedMySeat = agentControlsMySeat || pairingMySeat;
  const canUpgradeGuest = Boolean(initialUser && view.you?.identityType === "guest");
  const [selection, setSelection] = useState<{
    version: number;
    cards: string[];
    skillMode: LegalAction | null;
    targets: string[];
  }>(() => ({ version: view.room.version, cards: [], skillMode: null, targets: [] }));
  const activeSelection = selection.version === view.room.version
    ? selection
    : { version: view.room.version, cards: [], skillMode: null, targets: [] };
  const selected = activeSelection.cards;
  const skillMode = activeSelection.skillMode;
  const selectedTargets = activeSelection.targets;
  const setSelected = (update: string[] | ((current: string[]) => string[])) => setSelection((current) => {
    const base = current.version === view.room.version
      ? current
      : { version: view.room.version, cards: [], skillMode: null, targets: [] };
    return { ...base, cards: typeof update === "function" ? update(base.cards) : update };
  });
  const setSkillMode = (next: LegalAction | null) => setSelection((current) => {
    const base = current.version === view.room.version
      ? current
      : { version: view.room.version, cards: [], skillMode: null, targets: [] };
    return { ...base, skillMode: next };
  });
  const setSelectedTargets = (update: string[] | ((current: string[]) => string[])) => setSelection((current) => {
    const base = current.version === view.room.version
      ? current
      : { version: view.room.version, cards: [], skillMode: null, targets: [] };
    return { ...base, targets: typeof update === "function" ? update(base.targets) : update };
  });
  const [inspectedCard, setInspectedCard] = useState<Card | null>(null);
  const [inspectedGeneral, setInspectedGeneral] = useState<GeneralInfo | null>(null);
  const [inspectedPlayerZones, setInspectedPlayerZones] = useState<PlayerView | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [audioPreferences, setAudioPreferences] = useState<AudioPreferences>(initialAudioPreferences);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    game.deadlineAt ? Math.max(0, Math.ceil((new Date(game.deadlineAt).getTime() - Date.now()) / 1000)) : 0,
  );
  const logListRef = useRef<HTMLDivElement | null>(null);
  const logPinnedRef = useRef(true);
  const seatLayerRef = useRef<HTMLDivElement | null>(null);
  const tablePanelRef = useRef<HTMLElement | null>(null);
  const battleLogRef = useRef<HTMLElement | null>(null);
  const audioEngineRef = useRef<GameAudioEngine | null>(null);
  const lastSoundLogId = useRef(game.logs.at(-1)?.id ?? 0);
  const lastSoundDecisionId = useRef(game.decisionId);
  const lastAnimatedLogId = useRef(game.logs.at(-1)?.id ?? 0);
  const [animationQueue, setAnimationQueue] = useState<PublicBattleEvent[]>([]);
  const [relationGeometry, setRelationGeometry] = useState<{ targetId: string; from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const activeAnimation = animationQueue[0] ?? null;
  const activeAnimationDuration = activeAnimation ? actionDwellMs(activeAnimation, me?.name, animationQueue.length) : 0;
  const ownedCardIds = new Set([...hand, ...Object.values(me?.equipment ?? {}).filter((card): card is Card => Boolean(card))].map((card) => card.id));
  const presentedActions = presentLegalActions(game.legalActions, ownedCardIds, selected);
  const exact = presentedActions.exact;
  const discard = game.legalActions.find((entry) => entry.kind === "discard");
  const skills = game.legalActions.filter((entry) => entry.kind === "skill");
  const equipment = Object.values(me?.equipment ?? {}).filter((card): card is Card => Boolean(card));
  const selectableCardIds = new Set([
    ...(skillMode?.candidateCardIds ?? discard?.candidateCardIds ?? []),
    ...exact.flatMap((entry) => entry.action?.cardId ? [entry.action.cardId] : []),
  ]);
  const hasDeadline = Boolean(game.deadlineAt);
  const timerProgress = hasDeadline ? Math.max(0, Math.min(100, (secondsLeft / 30) * 100)) : 0;

  useEffect(() => {
    const list = logListRef.current;
    if (list && logPinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [game.logs.length]);

  useEffect(() => {
    const engine = new GameAudioEngine();
    audioEngineRef.current = engine;
    engine.setMusicEnabled(audioPreferences.music);
    engine.setEffectsEnabled(audioPreferences.effects);
    const unlock = () => { void engine.unlock(); };
    if (audioPreferences.music || audioPreferences.effects || audioPreferences.turnAlerts) {
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
    }
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      audioEngineRef.current = null;
      engine.destroy();
    };
    // Preferences are synchronized by the focused effect below; the engine is
    // intentionally created once per room so polling never restarts the music.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(audioPreferences));
    audioEngineRef.current?.setMusicEnabled(audioPreferences.music);
    audioEngineRef.current?.setEffectsEnabled(audioPreferences.effects);
  }, [audioPreferences]);

  useEffect(() => {
    const visibleEvents = game.logs.filter((entry) => entry.id > lastAnimatedLogId.current);
    if (!visibleEvents.length) return;
    lastAnimatedLogId.current = visibleEvents.at(-1)!.id;
    const audible = [...visibleEvents].reverse().find((entry) => eventTier(entry) === "major" && eventSoundKind(entry))
      ?? [...visibleEvents].reverse().find((entry) => eventSoundKind(entry));
    if (audible && audible.id > lastSoundLogId.current) {
      lastSoundLogId.current = audible.id;
      const sound = eventSoundKind(audible);
      const soundTarget = audible.visual?.targetIds?.[0] ?? audible.visual?.actorId;
      const pan = (seatMotionPoint(view.players, soundTarget, viewerIndex).x - 50) / 45;
      if (sound) audioEngineRef.current?.play(sound, { pan, major: eventTier(audible) === "major" });
    }
    if (!audioPreferences.animations || document.visibilityState === "hidden") return;
    setAnimationQueue((current) => {
      const combined = [...current, ...visibleEvents].filter((entry, index, entries) => {
        if (index === 0 || eventTier(entry) !== "light") return true;
        const previous = entries[index - 1];
        return previous.visual?.kind !== entry.visual?.kind || previous.visual?.actorId !== entry.visual?.actorId;
      });
      return (combined.length > 8 ? combined.filter((entry) => eventTier(entry) !== "light") : combined).slice(-10);
    });
  }, [game.logs, audioPreferences.animations, view.players, viewerIndex]);

  useEffect(() => {
    if (!activeAnimation || !activeAnimationDuration) return;
    const timer = window.setTimeout(() => setAnimationQueue((current) => current.slice(1)), activeAnimationDuration);
    return () => window.clearTimeout(timer);
  }, [activeAnimation, activeAnimationDuration]);

  useEffect(() => {
    if (!game.decisionId || game.decisionId === lastSoundDecisionId.current) return;
    lastSoundDecisionId.current = game.decisionId;
    if (game.legalActions.length && audioPreferences.turnAlerts) audioEngineRef.current?.play(game.pending ? "defend" : "choice", { major: true, force: true });
  }, [game.decisionId, game.legalActions.length, game.pending, audioPreferences.turnAlerts]);

  useEffect(() => {
    if (!mobileLogOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    battleLogRef.current?.querySelector<HTMLElement>(".mobile-log-close")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileLogChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [mobileLogOpen, onMobileLogChange]);

  useEffect(() => {
    if (!game.deadlineAt) return;
    const timer = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((new Date(game.deadlineAt!).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [game.deadlineAt]);

  const selectedExact = presentedActions.selectedExact;
  const passiveExact = presentedActions.passiveExact;
  const contextExact = presentedActions.contextExact;
  const generalChoices = contextExact.filter((entry) => Boolean(actionGeneral(entry)) || entry.id.startsWith("duel-draft:"));
  const ordinaryContextExact = contextExact.filter((entry) => !generalChoices.includes(entry));
  const targetIds = new Set<string>();
  if (skillMode) skillMode.targetIds?.forEach((id) => targetIds.add(id));
  else selectedExact.forEach((entry) => {
    if (entry.action?.targetId) targetIds.add(entry.action.targetId);
  });
  if (draggedCardId) exact.filter((entry) => entry.action?.cardId === draggedCardId).forEach((entry) => {
    if (entry.action?.targetId) targetIds.add(entry.action.targetId);
  });
  const selectedTargetAction = selectedTargets.length
    ? selectedExact.find((entry) => entry.action?.targetId === selectedTargets[0])
    : undefined;
  const selectedTargetName = view.players.find((entry) => entry.id === selectedTargets[0])?.name;
  const draggedCard = hand.find((card) => card.id === draggedCardId);
  const selectedCardNames = selected.map((id) => hand.find((card) => card.id === id)?.name ?? equipment.find((card) => card.id === id)?.name).filter(Boolean) as string[];
  const dropCardOnTarget = (targetId: string) => {
    if (!draggedCardId || !exact.some((entry) => entry.action?.cardId === draggedCardId && entry.action?.targetId === targetId)) return;
    setSelected([draggedCardId]);
    setSelectedTargets([targetId]);
    setDraggedCardId(null);
    tactile([10, 25, 12]);
  };

  const chooseCard = (cardId: string) => {
    if (busy || delegatedMySeat) return;
    tactile(8);
    if (skillMode || discard) {
      const max = skillMode?.maxCards ?? discard?.maxCards ?? 1;
      setSelected((current) =>
        current.includes(cardId)
          ? current.filter((id) => id !== cardId)
          : current.length < max
            ? [...current, cardId]
            : max === 1
              ? [cardId]
              : current,
      );
    } else {
      setSelectedTargets([]);
      setSelected((current) => (current.includes(cardId) ? [] : [cardId]));
    }
  };

  const chooseTarget = (targetId: string) => {
    tactile(10);
    if (skillMode) {
      const max = skillMode.maxTargets ?? 1;
      setSelectedTargets((current) => current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : current.length < max ? [...current, targetId] : max === 1 ? [targetId] : current);
      return;
    }
    if (selectedExact.some((entry) => entry.action?.targetId === targetId)) {
      setSelectedTargets((current) => current.includes(targetId) ? [] : [targetId]);
    }
  };

  const confirmTargetAction = () => {
    if (selectedTargetAction?.action) { tactile([12, 35, 16]); onAction(selectedTargetAction.action); }
  };

  const confirmTemplate = () => {
    const template = skillMode ?? discard;
    if (!template) return;
    const min = template.minCards ?? 0;
    const max = template.maxCards ?? Number.POSITIVE_INFINITY;
    if (selected.length < min || selected.length > max) return;
    if (skillMode) {
      const minTargets = skillMode.minTargets ?? (skillMode.targetIds?.length ? 1 : 0);
      const maxTargets = skillMode.maxTargets ?? minTargets;
      if (selectedTargets.length < minTargets || selectedTargets.length > maxTargets) return;
      onAction({ type: "skill", skill: skillMode.skill, cardIds: selected, targetIds: selectedTargets });
    } else onAction({ type: "discard", cardIds: selected });
  };

  const orderedPlayers = view.players
    .map((entry, index) => ({ entry, index, relative: ((index - viewerIndex) % view.players.length + view.players.length) % view.players.length }))
    .sort((left, right) => left.relative - right.relative);
  const relationTargetId = selectedTargets[0] ?? (draggedCardId ? [...targetIds][0] : undefined);
  const activeSeatId = game.pending?.targetId ?? game.turnPlayerId;
  const activePlayer = view.players.find((entry) => entry.id === activeSeatId);

  useEffect(() => {
    if (!activeSeatId || !window.matchMedia("(max-width: 700px)").matches) return;
    const layer = seatLayerRef.current;
    const activeSeat = layer?.querySelector<HTMLElement>(`[data-player-id="${activeSeatId}"]`);
    if (!layer || !activeSeat) return;
    layer.scrollTo({
      left: Math.max(0, activeSeat.offsetLeft - (layer.clientWidth - activeSeat.clientWidth) / 2),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [activeSeatId]);

  useEffect(() => {
    if (!relationTargetId || !viewerPlayerId) return;
    const table = tablePanelRef.current;
    const layer = seatLayerRef.current;
    if (!table || !layer) return;
    let frame = 0;
    const update = () => {
      const tableBox = table.getBoundingClientRect();
      const source = layer.querySelector<HTMLElement>(`[data-player-id="${viewerPlayerId}"]`);
      const target = layer.querySelector<HTMLElement>(`[data-player-id="${relationTargetId}"]`);
      if (!source || !target || !tableBox.width || !tableBox.height) return;
      const point = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        return {
          x: Math.max(2, Math.min(98, ((box.left + box.width / 2 - tableBox.left) / tableBox.width) * 100)),
          y: Math.max(2, Math.min(98, ((box.top + box.height / 2 - tableBox.top) / tableBox.height) * 100)),
        };
      };
      setRelationGeometry({ targetId: relationTargetId, from: point(source), to: point(target) });
    };
    frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    layer.addEventListener("scroll", update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      layer.removeEventListener("scroll", update);
    };
  }, [relationTargetId, viewerPlayerId, view.players.length]);
  const invite = typeof window === "undefined" ? "" : `${window.location.origin}/?room=${view.room.code}`;
  const toggleAudio = (channel: keyof AudioPreferences) => {
    const next = !audioPreferences[channel];
    if (channel === "music") audioEngineRef.current?.setMusicEnabled(next);
    else if (channel === "effects") audioEngineRef.current?.setEffectsEnabled(next);
    else if (channel === "turnAlerts" && next) void audioEngineRef.current?.unlock();
    else if (channel === "animations" && !next) setAnimationQueue([]);
    setAudioPreferences((current) => ({ ...current, [channel]: next }));
  };

  return (
    <>
    <main className={`game-shell mode-${game.mode}`}>
      <header className="game-topbar">
        <TopBrand compact />
        <div className="game-room-meta"><span>{game.mode === "duel" ? "经典 1V1" : "经典身份局"}</span><b>{view.room.code}</b><CopyButton text={invite} onCopied={onCopy}>复制</CopyButton></div>
        <div className="game-status-center"><PhaseTrack phase={game.phase} /></div>
        <div className="game-round">
          <span className="round-counter">{game.status === "setup" ? "选将阶段" : <>第 <b>{game.round}</b> 轮</>}</span>
          <SyncStatus problem={syncProblem} lastSyncAt={lastSyncAt} />
          {delegatedMySeat && <em className={diagnostics ? `agent-top-status status-${diagnostics.state}` : ""}><Icon name={pairingMySeat ? "link" : diagnostics ? agentIcon(diagnostics.state) : "refresh"} size={14} />{pairingMySeat ? "待配对" : diagnostics?.label ?? "连接中"}</em>}
          <AudioControl preferences={audioPreferences} onToggle={toggleAudio} />
          <button className="mobile-log-toggle" onClick={() => onMobileLogChange(true)} aria-expanded={mobileLogOpen} aria-label="打开战报"><Icon name="log" size={16} /><span>战报</span></button>
          <button onClick={onRules} aria-label="查看规则"><Icon name="book" size={16} /><span>规则</span></button>
          <button className="leave-table-button" onClick={onLeave} aria-label="暂时离开牌桌"><Icon name="exit" size={16} /><span>暂离</span></button>
        </div>
      </header>

      <div className="game-workspace">
        <section className="table-panel" ref={tablePanelRef} data-player-count={view.players.length}>
          <div className="ink-mountains" />
          <div className="table-ring"><i /><i /><i /></div>
          {relationTargetId && relationGeometry?.targetId === relationTargetId && <svg className="target-relation-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1={relationGeometry.from.x} y1={relationGeometry.from.y} x2={relationGeometry.to.x} y2={relationGeometry.to.y} /><circle cx={relationGeometry.to.x} cy={relationGeometry.to.y} r="2.4" /></svg>}
          <div className="seat-layer" ref={seatLayerRef} aria-label="玩家席位">
            {orderedPlayers.map(({ entry, index }) => (
              <PlayerSeat
                key={`${entry.id}-${entry.hp ?? "unknown"}`}
                entry={entry}
                index={index}
                count={view.players.length}
                viewerSeat={viewerIndex}
                current={entry.id === game.turnPlayerId}
                responding={entry.id === game.pending?.targetId}
                targetable={targetIds.has(entry.id)}
                chosen={selectedTargets.includes(entry.id)}
                eventPulse={Boolean(
                  activeAnimation?.visual
                    ? activeAnimation.visual.actorId === entry.id
                      || activeAnimation.visual.sourceId === entry.id
                      || activeAnimation.visual.targetIds?.includes(entry.id)
                    : activeAnimation?.text.includes(entry.name)
                )}
                onTarget={() => chooseTarget(entry.id)}
                onInfo={setInspectedCard}
                onGeneral={() => { const general = playerGeneral(entry); if (general) setInspectedGeneral(general); }}
                onOpenZones={() => setInspectedPlayerZones(entry)}
                dragTarget={Boolean(draggedCardId && targetIds.has(entry.id))}
                onCardDrop={() => dropCardOnTarget(entry.id)}
              />
            ))}
          </div>
          <div className={`table-center ${activeAnimation && eventTier(activeAnimation) !== "light" ? "has-action-visual" : ""}`}>
            <div className={`deck-stack ${game.deckCount <= 12 ? "deck-low" : ""}`} aria-label={`牌堆剩余 ${game.deckCount} 张`}><Icon name="deck" size={26} /><b>{game.deckCount}</b><small>牌堆</small></div>
            <button
              type="button"
              className={`discard-stack ${game.discardTop ? "has-card" : ""}`}
              style={game.discardTop ? cardArtStyle(game.discardTop) : undefined}
              onClick={() => game.discardTop && setInspectedCard(game.discardTop)}
              disabled={!game.discardTop}
              aria-label={game.discardTop ? `查看弃牌堆顶【${game.discardTop.name}】的解说` : "弃牌堆为空"}
            >
              {game.discardTop ? <><b>{game.discardTop.name}</b><small>{SUIT[game.discardTop.suit]} {game.discardTop.rank}</small><i><Icon name="book" size={12} /></i></> : <><Icon name="cards" size={20} /><span>弃牌堆</span></>}
            </button>
            <div className={`decision-banner ${game.pending ? "is-response" : ""}`}>
              <div className="decision-meta"><span><Icon name={game.pending ? "shield" : "play"} size={14} />{game.pending ? "等待响应" : PHASE_LABELS[game.phase ?? ""] ?? "出牌阶段"}</span>{activePlayer && <b>{activePlayer.name}</b>}</div>
              <strong role="status" aria-live="polite" aria-atomic="true">{game.decision}</strong>
              {hasDeadline && <span className={`turn-timer ${secondsLeft <= 10 ? "urgent" : ""}`} style={{ "--timer-progress": `${timerProgress}%` } as CSSProperties} aria-label={`剩余 ${secondsLeft} 秒`}><b>{secondsLeft}</b><small>秒</small></span>}
            </div>
            <ActionAnimation event={activeAnimation} viewerName={me?.name} durationMs={activeAnimationDuration} />
          </div>
          {audioPreferences.animations && !game.pending && <ActionMotionLayer event={activeAnimation} players={view.players} viewerIndex={viewerIndex} durationMs={activeAnimationDuration} />}
          <ResultOverlay winner={game.winner} players={view.players} logs={game.logs} isHost={Boolean(view.you?.isHost)} busy={busy} onCopied={onCopy} onRematch={onRematch} onNewRoom={onNewRoom} />
        </section>

        <aside ref={battleLogRef} className={`battle-log ${mobileLogOpen ? "mobile-open" : ""}`} role={mobileLogOpen ? "dialog" : "complementary"} aria-modal={mobileLogOpen || undefined} aria-label="公开战报">
          <header><p><Icon name="log" size={19} />战报</p><span>V{view.room.version}</span><button className="mobile-log-close" onClick={() => onMobileLogChange(false)} aria-label="关闭战报"><Icon name="chevron" size={15} />收起</button></header>
          <div className="log-summary"><span><Icon name="shield" size={13} />仅显示公开信息</span><b>{game.logs.length} 条</b></div>
          <div className="log-list" ref={logListRef} onScroll={(event) => { const list = event.currentTarget; logPinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 44; }}>
            {game.logs.map((entry) => {
              const meta = publicEventMeta(entry);
              return <article className={`log-entry log-${entry.tone} event-${meta.kind}`} key={entry.id}>
                <i className="log-event-icon"><Icon name={meta.icon} size={14} /></i>
                <div><header><b>{meta.label}</b><time dateTime={entry.at}>{eventClock(entry.at)}</time></header><p>{entry.text}</p></div>
                <small className="log-sequence">{String(entry.id).padStart(2, "0")}</small>
              </article>;
            })}
            {!game.logs.length && <div className="log-empty"><Icon name="log" size={24} /><b>战报将在这里出现</b><span>出牌、响应与结算均由服务器记录</span></div>}
          </div>
          <footer className={syncProblem ? "sync-warning" : ""}><SyncStatus problem={syncProblem} lastSyncAt={lastSyncAt} /><b>{view.you?.name}</b></footer>
        </aside>

        <section className="hand-panel">
          <div className="self-card">
            <div className={`self-portrait kingdom-${me?.character?.kingdom ?? "qun"}`}><Icon name="crown" className="portrait-silhouette" size={38} /><b>{me?.character?.name.slice(0, 1) ?? "谋"}</b><small>{me?.character?.kingdomName ?? ""}</small></div>
            <div className="self-detail"><span><i className={`role role-${me?.role ?? "renegade"}`}>{me?.roleName === "先手" ? "先" : me?.roleName === "后手" ? "后" : me?.role ? ROLE_SHORT[me.role] : "?"}</i>{me?.roleName ?? "身份未知"}</span><strong>{me?.character?.name ?? me?.name}</strong><button type="button" className="skill-summary" disabled={!me?.character} onClick={() => { const general = playerGeneral(me); if (general) setInspectedGeneral(general); }} aria-label={me?.character ? `查看${me.character.name}的完整技能说明` : "武将尚未确定"}><Icon name="spark" size={12} /><span>{me?.character?.skillName || "武将技能"}</span><em>{me?.character?.skillText || "选将后可查看完整说明"}</em><i><Icon name="book" size={11} /></i></button><HeartRow hp={me?.hp} max={me?.maxHp} /></div>
            {(me?.duelLineup?.length || me?.duelRoster?.length) ? <div className="duel-private-lineup"><span><Icon name="users" size={13} />{me.duelLineup?.length ? "我的出战顺序" : "我的已选武将"}</span><div>{(me.duelLineup?.length ? me.duelLineup : me.duelRoster)?.map((general, index) => <button type="button" key={general.id} onClick={() => { const info = catalogGeneral(general.id); if (info) setInspectedGeneral(info); }} aria-label={`查看${general.name}技能说明`}><i>{index + 1}</i>{general.name}<Icon name="book" size={9} /></button>)}</div></div> : null}
            <div className="self-control-tools">
              {pairingMySeat ? (
                <><button onClick={onCreatePairing} disabled={busy} aria-label="重新配对 Agent"><Icon name="refresh" size={13} /><span>重新配对</span></button><button className="claim-mini" onClick={onRevokeAgent} disabled={busy} aria-label="改由本人控制"><Icon name="person" size={13} /><span>改由本人</span></button></>
              ) : (
                <button onClick={agentControlsMySeat ? onRevokeAgent : onCreatePairing} disabled={busy} aria-label={agentControlsMySeat ? "立即接管当前席位" : "让 Agent 参与当前席位"}><Icon name={agentControlsMySeat ? "person" : "bot"} size={13} /><span>{agentControlsMySeat ? "立即接管" : "Agent"}</span></button>
              )}
              {canUpgradeGuest && <button className="claim-mini" onClick={onClaimGuest} disabled={busy} aria-label="绑定登录账号"><Icon name="shield" size={13} /><span>绑定账号</span></button>}
            </div>
            {view.you?.identityType === "guest" && !initialUser && (
              <div className="game-guest-auth">
                <span><Icon name="lock" size={12} />绑定席位</span>
                <a href={`/auth/google?next=${encodeURIComponent(`/?room=${view.room.code}`)}`}><Icon name="google" size={14} />Google</a>
              </div>
            )}
          </div>
          <div className="hand-zone">
            <div className="hand-cards" aria-label="你的手牌">
              {hand.length ? hand.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  selected={selected.includes(card.id)}
                  selectable={!busy && !delegatedMySeat && selectableCardIds.has(card.id)}
                  onClick={() => chooseCard(card.id)}
                  onInfo={() => setInspectedCard(card)}
                  dragging={draggedCardId === card.id}
                  onDragStart={() => { setDraggedCardId(card.id); setSelected([card.id]); setSelectedTargets([]); tactile(7); }}
                  onDragEnd={() => setDraggedCardId(null)}
                />
              )) : <div className="empty-hand">空城 · 暂无手牌</div>}
            </div>
            {equipment.length > 0 && (
              <div className="self-equipment-zone desktop-equipment-zone" aria-label="你的装备区">
                <span><Icon name="armor" size={13} />装备区</span>
                {equipment.map((card) => (
                  <div className={`equipment-chip ${selected.includes(card.id) ? "selected" : ""}`} key={card.id}>
                    <button type="button" disabled={busy || delegatedMySeat || !selectableCardIds.has(card.id)} onClick={() => chooseCard(card.id)}><Icon name={card.category === "equip" ? "weapon" : "cards"} size={13} />{card.name}</button>
                    <button type="button" className="equipment-info" onClick={() => setInspectedCard(card)} aria-label={`查看【${card.name}】详细解说`}><Icon name="book" size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="hand-caption">
              <span><Icon name="cards" size={13} />手牌 <b>{hand.length}</b></span>
              <em className={selected.length ? "has-selection" : ""}>{selected.length ? <><Icon name="check" size={12} />已选 {selected.length} 张{selectedTargets.length ? ` · ${selectedTargets.length} 个目标` : " · 请选择目标或确认"}</> : "左右滑动 · 点击发光牌"}</em>
              {equipment.length > 0 && (
                <details className="mobile-equipment-drawer">
                  <summary aria-label={`查看装备区，共 ${equipment.length} 件装备`}><Icon name="armor" size={14} /><span>装备</span><b>{equipment.length}</b></summary>
                  <div>
                    <header><Icon name="armor" size={15} /><strong>我的装备区</strong><small>点击装备可选择，点书本查看说明</small></header>
                    {equipment.map((card) => (
                      <div className={`equipment-chip ${selected.includes(card.id) ? "selected" : ""}`} key={`mobile-${card.id}`}>
                        <button type="button" disabled={busy || delegatedMySeat || !selectableCardIds.has(card.id)} onClick={() => chooseCard(card.id)}><Icon name={card.category === "equip" ? "weapon" : "cards"} size={14} />{card.name}</button>
                        <button type="button" className="equipment-info" onClick={() => setInspectedCard(card)} aria-label={`查看【${card.name}】详细解说`}><Icon name="book" size={14} /></button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
          <div className="action-panel">
            {game.winner ? (
              <div className="winner-card"><Icon name="crown" size={22} /><span>对局结束</span><strong>{game.winner.label}</strong><small>完整结果已显示在牌桌中央</small></div>
            ) : diagnostics ? (
              <>
                {activeSeatId === view.you?.playerId && hasDeadline && secondsLeft <= 20 && <p className={`agent-deadline-warning ${secondsLeft <= 10 ? "urgent" : ""}`}><Icon name="warning" size={14} /><span>Agent 决策剩余 <b>{secondsLeft}</b> 秒；来不及时可立即接管</span></p>}
                <AgentDiagnosticsPanel diagnostics={diagnostics} busy={busy} onTakeover={onRevokeAgent} onRepair={onCreatePairing} />
              </>
            ) : delegatedMySeat ? (
              <div className="agent-control-card">
                <span><Icon name={pairingMySeat ? "link" : "refresh"} size={14} />{pairingMySeat ? "等待配对" : "正在验证连接"}</span>
                <strong>{pairingMySeat ? "等待你的 Agent 完成配对" : "Agent 正在建立可信连接"}</strong>
                <small>{pairingMySeat ? "当前席位不会接受动作。可重新生成一次性配对码，或改由本人继续。" : "完成首次快照确认后才会显示为就绪；你仍可随时立即接管。"}</small>
                <div>
                  {pairingMySeat && <button onClick={onCreatePairing} disabled={busy}><Icon name="refresh" size={14} />重新生成配对码</button>}
                  <button className="takeover" onClick={onRevokeAgent} disabled={busy}><Icon name="person" size={14} />{pairingMySeat ? "改由本人继续" : "立即接管并撤销凭证"}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="action-context">
                  {skillMode ? <><span><Icon name="spark" size={14} />发动技能或装备效果</span><strong>{skillMode.label}</strong><small>{skillMode.description ?? `选择 ${skillMode.minCards ?? 0}–${skillMode.maxCards ?? 0} 张牌、${skillMode.minTargets ?? 0}–${skillMode.maxTargets ?? 0} 个目标`}</small></> : discard ? <><span><Icon name="cards" size={14} />弃牌阶段</span><strong>请选择 {discard.minCards} 张</strong><small>手牌不能超过当前体力</small></> : <><span><Icon name={game.pending ? "shield" : "play"} size={14} />{game.status === "setup" ? "选择武将" : game.pending ? "当前决策" : `${PHASE_LABELS[game.phase ?? ""] ?? "出牌阶段"}`}</span><strong>{selectedTargetAction ? `目标：${selectedTargetName}` : game.decision}</strong><small>{busy ? "正在向服务器提交动作…" : game.pending ? "从服务器给出的合法选项中选择" : selectedTargetAction ? "确认后才会提交，避免误触" : selected.length ? "下一步：选择发光目标或确认动作" : "选择发光手牌，或发动可用技能"}</small></>}
                </div>
                {(selectedCardNames.length > 0 || selectedTargetName || draggedCard) && <div className="action-selection-preview" aria-live="polite"><span><Icon name="cards" size={14} />{selectedCardNames.length ? selectedCardNames.map((name) => `【${name}】`).join(" + ") : draggedCard ? `【${draggedCard.name}】` : "当前选择"}</span>{selectedTargetName ? <><i>→</i><b><Icon name="target" size={13} />{selectedTargetName}</b></> : <small>请选择发光目标</small>}</div>}
                <div className="action-buttons" aria-busy={busy}>
                  {skillMode && <button className="ghost-action" onClick={() => { setSkillMode(null); setSelected([]); setSelectedTargets([]); }}><Icon name="skip" size={15} />取消技能</button>}
                  {!skillMode && skills.map((entry) => <button className="skill-action" key={entry.id} onClick={() => { setSkillMode(entry); setSelected([]); setSelectedTargets([]); }}><Icon name="spark" size={15} />{entry.label}</button>)}
                  {!skillMode && generalChoices.map((entry) => {
                    const general = actionGeneral(entry);
                    return <div className={`general-choice-card ${general ? `kingdom-${general.kingdom}` : "is-hidden"}`} key={entry.id}>
                      <button type="button" className="general-choice-main" disabled={busy} onClick={() => entry.action && onAction(entry.action)}>
                        <span>{general ? general.name.slice(0, 1) : "?"}</span><b>{entry.label}</b><small>{general ? `${general.kingdomName} · ${general.maxHp} 体力 · ${general.skillName}` : entry.description ?? "选择后仅你可见"}</small>
                      </button>
                      {general && <button type="button" className="general-choice-info" onClick={() => setInspectedGeneral(general)} aria-label={`先查看${general.name}的技能说明`}><Icon name="book" size={14} />说明</button>}
                    </div>;
                  })}
                  {(skillMode || discard) && <button className="primary-action" disabled={busy
                    || selected.length < (skillMode?.minCards ?? discard?.minCards ?? 0)
                    || selectedTargets.length < (skillMode?.minTargets ?? (skillMode?.targetIds?.length ? 1 : 0))} onClick={confirmTemplate}>{busy ? <span className="button-spinner" /> : <Icon name="check" size={15} />}确认{skillMode ? `发动${skillMode.label}` : "弃置"}</button>}
                  {!skillMode && ordinaryContextExact.map((entry) => <button className="primary-action" key={entry.id} disabled={busy} onClick={() => entry.action && onAction(entry.action)}>{busy ? <span className="button-spinner" /> : <Icon name={actionIcon(entry.action)} size={15} />}{entry.label}</button>)}
                  {!skillMode && !discard && selectedExact.filter((entry) => !entry.action?.targetId).map((entry) => <button className="primary-action" key={entry.id} disabled={busy} onClick={() => entry.action && onAction(entry.action)}>{busy ? <span className="button-spinner" /> : <Icon name={actionIcon(entry.action)} size={15} />}{entry.label}</button>)}
                  {!skillMode && !discard && selectedTargetAction && <button className="primary-action confirm-target-action" disabled={busy} onClick={confirmTargetAction}>{busy ? <span className="button-spinner" /> : <Icon name="target" size={15} />}确认对 {selectedTargetName} 使用</button>}
                  {!skillMode && passiveExact.map((entry) => <button className={entry.action?.type === "pass" ? "skip-action" : "end-action"} key={entry.id} disabled={busy} onClick={() => entry.action && onAction(entry.action)}><Icon name={actionIcon(entry.action)} size={15} />{entry.label}</button>)}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
    {inspectedPlayerZones && <PlayerZonesModal player={inspectedPlayerZones} onClose={() => setInspectedPlayerZones(null)} onCard={(card) => { setInspectedPlayerZones(null); setInspectedCard(card); }} />}
    {inspectedCard && <CardDetailModal card={inspectedCard} onClose={() => setInspectedCard(null)} />}
    {inspectedGeneral && <GeneralDetailModal general={inspectedGeneral} onClose={() => setInspectedGeneral(null)} />}
    </>
  );
}

function SpectatorJoin({
  view,
  initialUser,
  directSocialAuth,
  onJoin,
  onNewRoom,
  busy,
}: {
  view: RoomView;
  initialUser: InitialUser | null;
  directSocialAuth: boolean;
  onJoin: (code: string, name: string, wantsAgent: boolean) => void;
  onNewRoom: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initialUser?.displayName ?? "");
  const [wantsAgent, setWantsAgent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const next = `/?room=${view.room.code}`;
  return (
    <main className="spectator-shell">
      <TopBrand />
      <section className="spectator-card">
        <p><Icon name="link" size={14} />房间 {view.room.code}</p>
        <h1>{view.room.status === "lobby" ? "牌桌仍有空席" : "这局已经开始"}</h1>
        <span><Icon name="users" size={14} />{view.players.length}/{view.room.maxPlayers} 人已入席</span>
        {view.room.status === "lobby" ? (
          <>
            {initialUser ? <AccountBadge user={initialUser} next={next} /> : <><AuthChoices next={next} directSocialAuth={directSocialAuth} /><div className="guest-divider"><span>或以一次性访客加入</span></div></>}
            <form onSubmit={(event) => { event.preventDefault(); setAttempted(true); if (name.trim()) onJoin(view.room.code, name, wantsAgent); }} aria-busy={busy}>
              <label className="spectator-name-field"><span>玩家昵称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：云间客" maxLength={16} aria-invalid={attempted && !name.trim()} /></label>
              {attempted && !name.trim() && <small className="field-error"><Icon name="warning" size={13} />请输入玩家昵称</small>}
              <ParticipationSelector wantsAgent={wantsAgent} onChange={setWantsAgent} />
              <button className="spectator-submit" disabled={busy}>{busy ? <><span className="button-spinner" />正在验证并入席…</> : <><Icon name="play" size={16} />加入牌桌<small>{initialUser ? "登录账号" : "一次性访客"} · {wantsAgent ? "Agent 操作" : "本人操作"}</small></>}</button>
            </form>
            <small className="spectator-identity-note"><Icon name="lock" size={13} />{initialUser ? "登录账号可以跨设备恢复这个席位。" : "访客凭证仅保存在此浏览器，并在 24 小时后失效。"}</small>
          </>
        ) : <div className="spectator-note"><Icon name="lock" size={22} /><p>对局隐藏信息仅对在席玩家开放。请向房主索取新的房间，或创建自己的牌桌。</p><button type="button" onClick={onNewRoom}><Icon name="users" size={15} />创建新房间</button></div>}
      </section>
    </main>
  );
}

export default function GameClient({
  initialUser,
  directSocialAuth,
}: {
  initialUser: InitialUser | null;
  directSocialAuth: boolean;
}) {
  const [view, setView] = useState<RoomView | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [seatToken, setSeatToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [pairingModal, setPairingModal] = useState<AgentPairing | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [syncProblem, setSyncProblem] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [mobileLogOpen, setMobileLogOpen] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [reconnectState, setReconnectState] = useState<ReconnectState | null>(null);
  const [recentRoom, setRecentRoom] = useState<RecentRoom | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const { toast, show, dismiss } = useToast();
  const tokenRef = useRef("");
  const roomRef = useRef("");
  const viewRef = useRef<RoomView | null>(null);
  const sessionEpochRef = useRef(0);

  useEffect(() => { tokenRef.current = seatToken; }, [seatToken]);
  useEffect(() => { roomRef.current = roomCode; }, [roomCode]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_ROOM_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentRoom;
        if (/^[A-Z2-9]{6}$/.test(parsed.code)) queueMicrotask(() => setRecentRoom(parsed));
      }
    } catch { /* corrupted local resume metadata is ignored */ }
    const onOnline = () => setNetworkOnline(true);
    const onOffline = () => { setNetworkOnline(false); setSyncProblem(true); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>(".landing-shell, .room-shell, .game-shell, .spectator-shell")?.scrollTo(0, 0);
  }, [view?.room.code, view?.room.status]);

  const rememberRoom = useCallback((data: RoomView) => {
    if (!data.you || data.you.identityType === "agent") return;
    const next: RecentRoom = {
      code: data.room.code,
      name: data.you.name,
      mode: data.room.mode,
      status: data.room.status,
      identityType: data.you.identityType,
      savedAt: Date.now(),
    };
    setRecentRoom(next);
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify(next));
  }, []);

  const fetchRoom = useCallback(async (code: string, rawToken?: string, quiet = false) => {
    if (!code) return;
    const requestEpoch = sessionEpochRef.current;
    if (!quiet) setLoadingRoom(true);
    try {
      const response = await fetch(`/api/game?room=${encodeURIComponent(code)}`, {
        headers: rawToken ? { authorization: `Bearer ${rawToken}` } : {},
        cache: "no-store",
      });
      const data = await readJson(response);
      if (requestEpoch !== sessionEpochRef.current) return;
      setView(data);
      setRoomCode(data.room.code);
      setSyncProblem(false);
      setLastSyncAt(Date.now());
      setReconnectState(null);
      rememberRoom(data);
    } catch (error) {
      if (requestEpoch !== sessionEpochRef.current) return;
      if (quiet) setSyncProblem(true);
      if (!quiet) {
        const failure = reconnectFailure(code, error);
        setReconnectState(failure);
        if (viewRef.current) show(failure.message, "error");
      }
    } finally {
      if (!quiet && requestEpoch === sessionEpochRef.current) setLoadingRoom(false);
    }
  }, [rememberRoom, show]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() ?? "";
    if (!/^[A-Z2-9]{6}$/.test(code)) return;
    const stored = localStorage.getItem(tokenKey(code)) ?? "";
    queueMicrotask(() => {
      roomRef.current = code;
      setRoomCode(code);
      setSeatToken(stored);
      fetchRoom(code, stored);
    });
  }, [fetchRoom]);

  useEffect(() => {
    if (!reconnectState?.retryable || view) return;
    const interval = setInterval(() => {
      if (navigator.onLine) fetchRoom(reconnectState.code, tokenRef.current, true);
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchRoom, reconnectState, view]);

  useEffect(() => {
    if (!networkOnline || !roomRef.current) return;
    if (syncProblem || reconnectState) fetchRoom(roomRef.current, tokenRef.current, true);
  }, [fetchRoom, networkOnline, reconnectState, syncProblem]);

  const pollDelay = view?.game?.legalActions.length ? 1100 : 1800;
  useEffect(() => {
    if (!roomCode || !view) return;
    const interval = setInterval(() => fetchRoom(roomRef.current, tokenRef.current, true), pollDelay);
    return () => clearInterval(interval);
  }, [roomCode, view, pollDelay, fetchRoom]);

  const viewerId = view?.you?.playerId;
  useEffect(() => {
    if (!view?.game?.deadlineAt || !roomCode || !viewerId || view.room.status !== "playing") return;
    const remaining = new Date(view.game.deadlineAt).getTime() - Date.now();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/game", {
          method: "POST",
          headers: { "content-type": "application/json", ...(tokenRef.current ? { authorization: `Bearer ${tokenRef.current}` } : {}) },
          body: JSON.stringify({ op: "tick", room: roomRef.current }),
        });
        if (response.ok) setView((await response.json()) as RoomView);
        else fetchRoom(roomRef.current, tokenRef.current, true);
      } catch {
        fetchRoom(roomRef.current, tokenRef.current, true);
      }
    }, Math.max(250, remaining + 350));
    return () => clearTimeout(timer);
  }, [view?.game?.deadlineAt, view?.room.status, viewerId, roomCode, seatToken, fetchRoom]);

  useEffect(() => {
    if (mobileLogOpen && (Boolean(view?.game?.pending) || !networkOnline || syncProblem)) queueMicrotask(() => setMobileLogOpen(false));
  }, [mobileLogOpen, view?.game?.pending, networkOnline, syncProblem]);

  const post = useCallback(async (payload: Record<string, unknown>, rawToken = tokenRef.current) => {
    const requestEpoch = sessionEpochRef.current;
    setBusy(true);
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "content-type": "application/json", ...(rawToken ? { authorization: `Bearer ${rawToken}` } : {}) },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);
      if (requestEpoch !== sessionEpochRef.current) return data;
      setView(data);
      setSyncProblem(false);
      setLastSyncAt(Date.now());
      rememberRoom(data);
      return data;
    } catch (error) {
      if (requestEpoch !== sessionEpochRef.current) throw error;
      show(error instanceof Error ? error.message : "操作失败", "error");
      if (roomRef.current) fetchRoom(roomRef.current, tokenRef.current, true);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [fetchRoom, rememberRoom, show]);

  const adoptSeat = (data: RoomView) => {
    sessionEpochRef.current += 1;
    const token = data.guestToken ?? data.playerToken ?? "";
    setSeatToken(token);
    tokenRef.current = token;
    setRoomCode(data.room.code);
    roomRef.current = data.room.code;
    if (token) localStorage.setItem(tokenKey(data.room.code), token);
    else localStorage.removeItem(tokenKey(data.room.code));
    history.replaceState({}, "", `/?room=${data.room.code}`);
    setView(data);
    setReconnectState(null);
    rememberRoom(data);
    return token;
  };

  const adoptNewSeat = (data: RoomView, wantsAgent: boolean) => {
    adoptSeat(data);
    if (wantsAgent && data.pairing) setPairingModal(data.pairing);
  };
  const create = async (name: string, maxPlayers: number, wantsAgent: boolean) => {
    try {
      adoptNewSeat(await post({ op: "create", name, maxPlayers, participation: wantsAgent ? "agent" : "human" }, ""), wantsAgent);
    } catch { /* toast handled */ }
  };
  const join = async (code: string, name: string, wantsAgent: boolean) => {
    try {
      adoptNewSeat(await post({ op: "join", room: code, name, participation: wantsAgent ? "agent" : "human" }, ""), wantsAgent);
    } catch { /* toast handled */ }
  };
  const act = async (action: GameAction) => {
    if (!view) return;
    try {
      await post({ op: "act", room: view.room.code, expectedVersion: view.room.version, requestId: clientRequestId(), action });
    } catch { /* toast handled */ }
  };
  const createAgentPairing = async () => {
    if (!view) return;
    try {
      const result = await post({ op: "createAgentPairing", room: view.room.code });
      if (result.pairing) setPairingModal(result.pairing);
    } catch { /* toast handled */ }
  };
  const revokeAgent = async () => {
    if (!view) return;
    try {
      await post({ op: "revokeAgent", room: view.room.code });
      show("已恢复本人控制，旧 Agent 凭证已撤销");
    } catch { /* toast handled */ }
  };
  const claimGuest = async () => {
    if (!view) return;
    try {
      const result = await post({ op: "claimGuest", room: view.room.code });
      setSeatToken("");
      tokenRef.current = "";
      localStorage.removeItem(tokenKey(view.room.code));
      setView(result);
      show("访客席位已绑定到你的登录账号");
    } catch { /* toast handled */ }
  };

  const rematch = async () => {
    if (!view) return;
    try {
      await post({ op: "rematch", room: view.room.code });
      setMobileLogOpen(false);
      show("牌桌已重置，玩家席位保留；需要 Agent 的玩家可重新授权");
    } catch { /* toast handled */ }
  };

  const startNewRoom = () => {
    sessionEpochRef.current += 1;
    setPairingModal(null);
    setShowRules(false);
    setLeaveOpen(false);
    setMobileLogOpen(false);
    setReconnectState(null);
    setSyncProblem(false);
    setLoadingRoom(false);
    setBusy(false);
    setView(null);
    viewRef.current = null;
    setRoomCode("");
    roomRef.current = "";
    setSeatToken("");
    tokenRef.current = "";
    history.replaceState({}, "", "/");
    window.scrollTo(0, 0);
  };

  const resumeRoom = (code: string) => {
    sessionEpochRef.current += 1;
    const stored = localStorage.getItem(tokenKey(code)) ?? "";
    setRoomCode(code);
    roomRef.current = code;
    setSeatToken(stored);
    tokenRef.current = stored;
    history.replaceState({}, "", `/?room=${code}`);
    fetchRoom(code, stored);
  };

  const leaveRoom = async () => {
    if (!view) return;
    sessionEpochRef.current += 1;
    setBusy(true);
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "content-type": "application/json", ...(tokenRef.current ? { authorization: `Bearer ${tokenRef.current}` } : {}) },
        body: JSON.stringify({ op: "leaveRoom", room: view.room.code }),
      });
      const result = await readJson<{ ok: boolean; seatRetained: boolean; closed?: boolean; transferredHostTo?: { name: string } | null }>(response);
      if (result.seatRetained) rememberRoom(view);
      else {
        localStorage.removeItem(tokenKey(view.room.code));
        localStorage.removeItem(LAST_ROOM_KEY);
        setRecentRoom(null);
      }
      setLeaveOpen(false);
      setPairingModal(null);
      setShowRules(false);
      setMobileLogOpen(false);
      setReconnectState(null);
      setView(null);
      setRoomCode("");
      roomRef.current = "";
      setSeatToken("");
      tokenRef.current = "";
      setSyncProblem(false);
      history.replaceState({}, "", "/");
      show(result.seatRetained ? "已暂离牌桌，席位和恢复入口已保留" : result.closed ? "已离开，空房间已关闭" : result.transferredHostTo ? `已离开房间，房主已移交给 ${result.transferredHostTo.name}` : "已离开房间");
    } catch (error) {
      show(error instanceof Error ? error.message : "暂时无法离开房间", "error");
      fetchRoom(view.room.code, tokenRef.current, true);
    } finally {
      setBusy(false);
    }
  };

  if (loadingRoom && !view) return <div className="loading-screen" role="status" aria-busy="true"><Seal /><span className="button-spinner" /><b>正在验证席位并同步牌桌</b><small>隐藏信息将按你的席位权限安全加载</small></div>;
  if (reconnectState && !view) return <><ReconnectScreen state={reconnectState} online={networkOnline} busy={loadingRoom} onRetry={() => fetchRoom(reconnectState.code, tokenRef.current)} onBack={() => { sessionEpochRef.current += 1; setReconnectState(null); setRoomCode(""); roomRef.current = ""; history.replaceState({}, "", "/"); }} />{toast && <Toast toast={toast} onClose={dismiss} />}</>;
  if (!view) {
    return <><Landing key={roomCode || "home"} initialCode={roomCode} initialUser={initialUser} directSocialAuth={directSocialAuth} onCreate={create} onJoin={join} recentRoom={recentRoom} onResume={resumeRoom} busy={busy} />{toast && <Toast toast={toast} onClose={dismiss} />}</>;
  }
  const connectionBlocked = !networkOnline || syncProblem;
  const effectiveBusy = busy || connectionBlocked;
  if (!view.you) return <><SpectatorJoin view={view} initialUser={initialUser} directSocialAuth={directSocialAuth} onJoin={join} onNewRoom={startNewRoom} busy={effectiveBusy} />{connectionBlocked && <ConnectionBanner online={networkOnline} onRetry={() => fetchRoom(view.room.code, tokenRef.current, true)} />}{toast && <Toast toast={toast} onClose={dismiss} />}</>;

  return (
    <>
      {view.room.status === "lobby" ? (
        <Lobby
          view={view}
          initialUser={initialUser}
          directSocialAuth={directSocialAuth}
          busy={effectiveBusy}
          onStart={() => post({ op: "start", room: view.room.code }).catch(() => undefined)}
          onCreatePairing={createAgentPairing}
          onRevokeAgent={revokeAgent}
          onClaimGuest={claimGuest}
          onRemove={(id) => post({ op: "removePlayer", room: view.room.code, playerId: id }).catch(() => undefined)}
          onCopy={() => show("邀请链接已复制")}
          onRules={() => setShowRules(true)}
          onLeave={() => setLeaveOpen(true)}
        />
      ) : (
        <GameBoard key={view.room.code} view={view} initialUser={initialUser} busy={effectiveBusy} onAction={act} onCreatePairing={createAgentPairing} onRevokeAgent={revokeAgent} onClaimGuest={claimGuest} onCopy={() => show("邀请链接已复制")} onRules={() => setShowRules(true)} onLeave={() => setLeaveOpen(true)} onRematch={rematch} onNewRoom={startNewRoom} syncProblem={syncProblem} lastSyncAt={lastSyncAt} mobileLogOpen={mobileLogOpen} onMobileLogChange={setMobileLogOpen} />
      )}
      {connectionBlocked && <ConnectionBanner online={networkOnline} onRetry={() => fetchRoom(view.room.code, tokenRef.current, true)} />}
      {leaveOpen && <LeaveRoomModal view={view} busy={busy} onClose={() => setLeaveOpen(false)} onConfirm={leaveRoom} />}
      {pairingModal && (
        <AgentModal
          pairing={pairingModal}
          room={view.room.code}
          status={view.players.find((entry) => entry.id === pairingModal.playerId)?.agentStatus}
          diagnostics={view.you?.playerId === pairingModal.playerId ? view.you.agentDiagnostics : null}
          onClose={() => setPairingModal(null)}
          onCopied={() => show("Agent 指令与一次性配对码已复制")}
          onRefresh={() => { setPairingModal(null); createAgentPairing(); }}
        />
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} initialMode={view.room.mode} currentPhase={view.game?.phase} />}
      {toast && <Toast toast={toast} onClose={dismiss} />}
    </>
  );
}
