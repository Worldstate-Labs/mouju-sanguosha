import { CARD_GUIDES } from "./card-catalog.ts";
import { STANDARD_CHARACTERS } from "./game-v2-data.ts";

export const AGENT_CLI_VERSION = "1.4.0";

export function agentCliSource() {
  const cardHelp = JSON.stringify(Object.fromEntries(Object.entries(CARD_GUIDES).map(([name, guide]) => [
    name,
    Object.fromEntries(Object.entries(guide).filter(([key]) => key !== "image")),
  ])));
  const generalHelp = JSON.stringify(Object.fromEntries(STANDARD_CHARACTERS.map((general) => [general.id, general])));
  return String.raw`#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_VERSION = "1.4.0";
const PROTOCOL = "mouju-agent/2.4";
const CAPABILITIES = ["deterministic-cli-v1", "detached-daemon-v1", "command-fallback-v1", "view-parity-v1", "independent-heartbeat-v1", "action-reason-v1", "decision-loop-lease-v1"];
const DECISION_REASONING_LEASE_MS = 75_000;
const LOOP_REARM_LEASE_MS = 15_000;
const CARD_HELP = ${cardHelp};
const GENERAL_HELP = ${generalHelp};
const argv = process.argv.slice(2);
const command = argv.shift() || "help";

function fail(message, code = 1) {
  process.stderr.write(JSON.stringify({ ok: false, error: String(message) }) + "\n");
  process.exit(code);
}

function out(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function continuation(next, reason) {
  return { required: true, next, reason };
}

function terminalContinuation(reason) {
  return { required: false, next: null, reason };
}

function option(name, fallback = "") {
  const index = argv.indexOf("--" + name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function roomCode() {
  const room = option("room").trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(room)) fail("--room must be a six-character room code", 2);
  return room;
}

function descriptorPath(room) {
  return path.join(os.tmpdir(), "mouju-agent-" + room + ".json");
}

function credentialPath(room) {
  return path.join(os.tmpdir(), "mouju-agent-" + room + ".credential.json");
}

function writeCredential(credential) {
  const file = credentialPath(credential.room);
  const temporary = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(credential), { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

function readCredential(room) {
  const file = credentialPath(room);
  let stat;
  try { stat = fs.statSync(file); }
  catch { fail("No recoverable deterministic CLI credential for room " + room, 3); }
  if ((stat.mode & 0o077) !== 0) fail("Credential capsule permissions are unsafe; expected 0600", 3);
  let credential;
  try { credential = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("Credential capsule is invalid", 3); }
  if (credential.room !== room || credential.protocol !== PROTOCOL || credential.cliVersion !== CLI_VERSION || !credential.token) {
    fail("Credential capsule failed protocol validation", 3);
  }
  return credential;
}

function removeCredential(room) {
  try { fs.unlinkSync(credentialPath(room)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

function writeTerminalDescriptor(room, pid, stopReason, errorCode = null) {
  removeCredential(room);
  fs.writeFileSync(descriptorPath(room), JSON.stringify({
    cliVersion: CLI_VERSION, protocol: PROTOCOL, room, pid, stopped: true,
    stopReason, errorCode, endedAt: new Date().toISOString(), tokenStored: false,
    continuation: terminalContinuation(stopReason),
  }), { mode: 0o600 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureNoLiveSession(room) {
  if (fs.existsSync(credentialPath(room))) {
    fail("A recoverable CLI credential already exists for room " + room + "; use status/next instead of pairing again", 3);
  }
  try {
    const existing = JSON.parse(fs.readFileSync(descriptorPath(room), "utf8"));
    if (!existing.stopped) {
      process.kill(existing.pid, 0);
      fail("A deterministic CLI session is already running for room " + room + "; use status instead", 3);
    }
    fs.unlinkSync(descriptorPath(room));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ESRCH") throw error;
    try { fs.unlinkSync(descriptorPath(room)); } catch {}
  }
}

async function launchConnect() {
  const origin = option("origin").replace(/\/$/, "");
  const room = roomCode();
  const pairingCode = option("pair-code").trim().toUpperCase();
  const agentName = option("agent-name", "Codex Agent").slice(0, 32);
  if (!/^https?:\/\//.test(origin)) fail("--origin must be an http(s) origin", 2);
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pairingCode)) fail("--pair-code is invalid", 2);
  ensureNoLiveSession(room);
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url), "connect", "--worker", "--origin", origin,
    "--room", room, "--agent-name", agentName,
  ], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MOUJU_PAIR_CODE: pairingCode },
  });
  child.unref();
  let paired = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    let descriptor = null;
    try { descriptor = JSON.parse(fs.readFileSync(descriptorPath(room), "utf8")); } catch {}
    if (descriptor?.stopped) {
      if (!paired && descriptor.stopReason !== "pair_failed") out({ event: "paired", room, daemonPid: descriptor.pid, tokenPrinted: false });
      out({ event: "terminal", room, reason: descriptor.stopReason, errorCode: descriptor.errorCode || null, recoverable: descriptor.stopReason === "pair_failed", continuation: terminalContinuation(descriptor.stopReason) });
      return;
    }
    if (descriptor?.pid) {
      if (!paired) {
        paired = true;
        out({ event: "paired", room, daemonPid: descriptor.pid, tokenPrinted: false });
      }
      try {
        const status = await control(room, { op: "status" });
        if (status.ready) {
          out({ event: "ready", room, daemonPid: descriptor.pid, heartbeat: "independent", detached: true, continuation: continuation("next", "match_not_terminal") });
          return;
        }
      } catch {}
    }
    try { process.kill(child.pid, 0); }
    catch { fail("Detached CLI stopped before readiness and produced no terminal status", 4); }
    await sleep(180);
  }
  // A slow or temporarily disconnected network must not destroy a successfully
  // paired session. Leave the daemon and recovery capsule alive; status/next
  // will deterministically resume without consuming another pairing code.
  out({ event: "connecting", room, daemonPid: child.pid, recoverable: true, next: "status", tokenPrinted: false, continuation: continuation("status", "readiness_pending") });
}

class RemoteError extends Error {
  constructor(status, code, message, retryAfterMs = 0) {
    super(message || code || ("HTTP " + status));
    this.status = status;
    this.remoteCode = code || "HTTP_ERROR";
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Math.max(0, Math.min(10_000, parsed || 0));
}

async function jsonRequest(url, init = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new RemoteError(response.status, "BAD_SERVER_JSON", "Server returned invalid JSON"); }
    if (!response.ok || data?.ok === false) {
      throw new RemoteError(response.status, data?.error?.code, data?.error?.message, retryAfterMs(response));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token) {
  return { "content-type": "application/json", authorization: "Bearer " + token };
}

async function tickIfExpired(origin, room, token, view) {
  const deadline = view?.game?.deadlineAt ? Date.parse(view.game.deadlineAt) : NaN;
  if (view?.room?.status !== "playing" || !Number.isFinite(deadline) || Date.now() < deadline) return view;
  try {
    return await jsonRequest(origin + "/api/game", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ op: "tick", room }),
    });
  } catch (error) {
    if (!(error instanceof RemoteError) || error.status !== 409) throw error;
    // Another browser or Agent won the timeout race. Fetch its authoritative
    // result instead of treating the expected conflict as a connection error.
    return jsonRequest(origin + "/api/game?room=" + encodeURIComponent(room), {
      headers: { authorization: "Bearer " + token },
    });
  }
}

function publicDecision(view) {
  const me = view.players?.find((entry) => entry.id === view.you?.playerId) || null;
  const visibleCardNames = new Set();
  const visibleGeneralIds = new Set();
  const addCard = (card) => { if (card?.name && CARD_HELP[card.name]) visibleCardNames.add(card.name); };
  const addGeneral = (general) => { if (general?.id && GENERAL_HELP[general.id]) visibleGeneralIds.add(general.id); };
  for (const card of me?.hand || []) addCard(card);
  addCard(view.game?.discardTop);
  for (const player of view.players || []) {
    addGeneral(player.character);
    addCard(player.weapon);
    for (const card of Object.values(player.equipment || {})) addCard(card);
    for (const card of player.judgment || []) addCard(card);
  }
  for (const legal of view.game?.legalActions || []) {
    addGeneral({ id: legal.action?.characterId });
    for (const choice of legal.choices || []) addGeneral({ id: choice.id });
    for (const match of legal.label?.matchAll?.(/【([^】]+)】/g) || []) if (CARD_HELP[match[1]]) visibleCardNames.add(match[1]);
  }
  for (const general of me?.duelRoster || []) addGeneral(general);
  for (const general of me?.duelLineup || []) addGeneral(general);
  const visiblePlayer = (entry) => entry.id === me?.id ? entry : {
    id: entry.id, name: entry.name, kind: entry.kind, principalType: entry.principalType,
    controlMode: entry.controlMode, seat: entry.seat, connected: entry.connected,
    agentStatus: entry.agentStatus, alive: entry.alive, hp: entry.hp, maxHp: entry.maxHp,
    handCount: entry.handCount, weapon: entry.weapon, equipment: entry.equipment,
    judgment: entry.judgment, role: entry.role, roleName: entry.roleName,
    character: entry.character, duelReserveCount: entry.duelReserveCount,
    duelDefeatedCount: entry.duelDefeatedCount, duelDefeated: entry.duelDefeated,
  };
  return {
    schema: "mouju-visible-state/1",
    continuation: continuation("act", "decision_ready"),
    serverTime: view.serverTime,
    room: view.room,
    you: view.you ? {
      playerId: view.you.playerId, name: view.you.name, kind: view.you.kind,
      identityType: view.you.identityType, authVia: view.you.authVia,
      controlMode: view.you.controlMode, controlEpoch: view.you.controlEpoch,
      canAct: view.you.canAct, scopes: view.you.scopes,
    } : null,
    self: me,
    players: (view.players || []).map(visiblePlayer),
    cardHelp: Object.fromEntries([...visibleCardNames].map((name) => [name, CARD_HELP[name]])),
    generalHelp: Object.fromEntries([...visibleGeneralIds].map((id) => [id, GENERAL_HELP[id]])),
    game: view.game ? {
      status: view.game.status,
      round: view.game.round,
      mode: view.game.mode,
      turnPlayerId: view.game.turnPlayerId,
      phase: view.game.phase,
      pending: view.game.pending,
      deckCount: view.game.deckCount,
      discardTop: view.game.discardTop,
      logs: view.game.logs,
      winner: view.game.winner,
      decisionId: view.game.decisionId,
      decision: view.game.decision,
      deadlineAt: view.game.deadlineAt,
      legalActions: view.game.legalActions,
      ruleset: view.game.ruleset,
      engineVersion: view.game.engineVersion,
      rulesetId: view.game.rulesetId,
    } : null,
  };
}

function instantiateLegalAction(legal, payload) {
  if (!legal) throw new Error("legalId is not present in the newest legalActions");
  if (legal.kind === "exact") return structuredClone(legal.action);
  const cardIds = Array.isArray(payload.cardIds) ? payload.cardIds : [];
  const targetIds = Array.isArray(payload.targetIds) ? payload.targetIds : [];
  const orderedCardIds = Array.isArray(payload.orderedCardIds) ? payload.orderedCardIds : [];
  if (legal.kind === "discard") return { type: "discard", cardIds };
  if (legal.kind === "skill") return { type: "skill", skill: legal.skill, cardIds, targetIds };
  if (legal.kind === "arrange") return { type: "arrange", orderedCardIds, ...(payload.zone ? { zone: payload.zone } : {}) };
  throw new Error("Unsupported legal action kind: " + legal.kind);
}

async function connectMode() {
  const origin = option("origin").replace(/\/$/, "");
  const room = roomCode();
  const pairingCode = option("pair-code", process.env.MOUJU_PAIR_CODE || "").trim().toUpperCase();
  delete process.env.MOUJU_PAIR_CODE;
  const agentName = option("agent-name", "Codex Agent").slice(0, 32);
  if (!/^https?:\/\//.test(origin)) fail("--origin must be an http(s) origin", 2);
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pairingCode)) fail("--pair-code is invalid", 2);
  ensureNoLiveSession(room);

  // Pair exactly once. Never retry this request: the code is single-use.
  let pair;
  try {
    pair = await jsonRequest(origin + "/api/agent-pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingCode,
        agent: { name: agentName, runtime: "deterministic-cli", version: CLI_VERSION, capabilities: CAPABILITIES },
      }),
    });
    if (pair.protocol !== PROTOCOL || pair.room !== room) throw new Error("Pairing response failed protocol validation");
    if (JSON.stringify(pair.capabilities) !== JSON.stringify(CAPABILITIES)) throw new Error("Server capability set does not match this CLI");
  } catch (error) {
    writeTerminalDescriptor(room, process.pid, "pair_failed", error.remoteCode || "PAIR_FAILED");
    throw error;
  }
  const token = pair.agentToken;
  if (!token) {
    writeTerminalDescriptor(room, process.pid, "pair_failed", "TOKEN_MISSING");
    fail("Server did not return an Agent credential");
  }

  // The daemon owns the token in memory while it lives. A mode-0600 capsule is
  // the deterministic recovery path for runtimes that forcibly reap detached
  // children after the connect command returns. It is never printed.
  const recoveryCredential = {
    cliVersion: CLI_VERSION, protocol: PROTOCOL, origin, room, token,
    controlEpoch: pair.controlEpoch, seq: 0, pairedAt: new Date().toISOString(),
  };
  writeCredential(recoveryCredential);

  const descriptor = descriptorPath(room);
  const controlSecret = crypto.randomBytes(24).toString("hex");
  const state = {
    origin, room, token, controlEpoch: pair.controlEpoch, seq: 0,
    view: null, ready: false, stopped: false, phase: "connecting",
    stopReason: null, lastHeartbeatAt: null, lastObserveAt: null, lastActionAt: null, lastError: null,
    nextWaiters: 0, decisionLeaseUntil: 0, decisionLeaseId: null,
  };
  let observePromise = null;
  let heartbeatPromise = null;
  let observeTimer = null;
  let heartbeatTimer = null;

  function markStopped(reason, errorCode = null) {
    state.stopped = true;
    state.stopReason ||= reason;
    if (errorCode) state.lastError = errorCode;
  }

  async function observe() {
    if (state.stopped) return state.view;
    if (observePromise) return observePromise;
    const task = (async () => {
      let view = await jsonRequest(origin + "/api/game?room=" + encodeURIComponent(room), {
        headers: { authorization: "Bearer " + token },
      });
      view = await tickIfExpired(origin, room, token, view);
      state.view = view;
      state.lastObserveAt = new Date().toISOString();
      if (view.room?.status === "finished" || view.game?.status === "finished") {
        markStopped("match_finished");
        return view;
      }
      if (view.room?.code !== room || view.you?.controlEpoch !== state.controlEpoch) throw new RemoteError(403, "CONTROL_CHANGED", "Observed seat identity changed");
      if (view.game && (view.game.engineVersion !== 2 || view.game.rulesetId !== "classic-standard-2009-ex")) {
        throw new Error("Unsupported game engine or ruleset");
      }
      state.lastError = null;
      return view;
    })();
    observePromise = task;
    try { return await task; }
    finally { if (observePromise === task) observePromise = null; }
  }

  async function heartbeat(reportedPhase = state.phase) {
    if (state.stopped) return null;
    // Serialize concurrent scheduler/control heartbeats. Waiting for an active
    // heartbeat is safer than silently dropping the phase update requested by
    // submit or next.
    while (heartbeatPromise) {
      try { await heartbeatPromise; } catch {}
      if (state.stopped) return null;
    }
    const task = (async () => {
      const view = state.view || await observe();
      state.seq += 1;
      const result = await jsonRequest(origin + "/api/agent-heartbeat", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          room,
          controlEpoch: state.controlEpoch,
          seq: state.seq,
          observedVersion: view.room.version,
          decisionId: view.game?.decisionId || null,
          reportedPhase,
          retryCount: 0,
        }),
      }, 5_000);
      recoveryCredential.seq = state.seq;
      writeCredential(recoveryCredential);
      state.ready = Boolean(result.ready);
      state.lastHeartbeatAt = result.serverTime || new Date().toISOString();
      state.lastError = null;
      if (result.suspended) markStopped("safe_mode", "AGENT_SUSPENDED");
      return result;
    })();
    heartbeatPromise = task;
    try { return await task; }
    finally { if (heartbeatPromise === task) heartbeatPromise = null; }
  }

  async function submit(payload) {
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (reason.length < 8 || reason.length > 120 || /[\r\n]/.test(reason)) throw new Error("reason must be one line of 8-120 characters");
    await observe();
    if (state.stopped) throw new Error("Session stopped: " + state.stopReason);
    const legal = state.view?.game?.legalActions?.find((entry) => entry.id === payload.legalId);
    const action = instantiateLegalAction(legal, payload);
    const requestId = crypto.randomUUID();
    const body = {
      op: "act", room, expectedVersion: state.view.room.version,
      requestId, action, reason,
    };
    state.phase = "submitting";
    await heartbeat("submitting");
    if (state.stopped) throw new Error("Session stopped: " + state.stopReason);
    let lastError;
    let retryAfter = 0;
    for (const delay of [0, 1000, 2000, 4000]) {
      if (delay || retryAfter) await sleep(Math.max(delay, retryAfter));
      retryAfter = 0;
      try {
        const result = await jsonRequest(origin + "/api/game", {
          method: "POST", headers: authHeaders(token), body: JSON.stringify(body),
        });
        if (result.agentReceipt?.requestId !== requestId || result.agentReceipt?.actionAccepted !== true || result.agentReceipt?.reasonAccepted !== true) {
          throw new Error("Server action receipt failed validation");
        }
        state.view = result;
        state.lastActionAt = new Date().toISOString();
        state.phase = "observing";
        state.decisionLeaseId = null;
        state.decisionLeaseUntil = Date.now() + LOOP_REARM_LEASE_MS;
        state.lastError = null;
        return { receipt: result.agentReceipt, roomVersion: result.room.version, continuation: continuation("next", "match_not_terminal") };
      } catch (error) {
        lastError = error;
        if (error instanceof RemoteError && error.status === 429) retryAfter = error.retryAfterMs;
        else if (error instanceof RemoteError && error.status < 500 && error.status !== 408) throw error;
      }
    }
    throw lastError || new Error("Action submission failed");
  }

  async function waitForDecision(waitMs) {
    const end = Date.now() + waitMs;
    state.nextWaiters += 1;
    state.phase = "observing";
    try {
      await observe();
      await heartbeat((state.view?.game?.legalActions || []).length > 0 ? "planning" : "observing");
      while (!state.stopped && Date.now() <= end) {
        await observe();
        if ((state.view?.game?.legalActions || []).length > 0) {
          state.phase = "planning";
          state.decisionLeaseId = state.view.game?.decisionId || null;
          state.decisionLeaseUntil = Date.now() + DECISION_REASONING_LEASE_MS;
          await heartbeat("planning");
          if (state.stopped) {
            return {
              waiting: false,
              stopped: true,
              status: statusView(),
              continuation: terminalContinuation(state.stopReason || "session_stopped"),
            };
          }
          return publicDecision(state.view);
        }
        await sleep(700);
      }
      state.decisionLeaseId = null;
      state.decisionLeaseUntil = Date.now() + LOOP_REARM_LEASE_MS;
      return {
        waiting: !state.stopped,
        stopped: state.stopped,
        status: statusView(),
        continuation: state.stopped
          ? terminalContinuation(state.stopReason || "session_stopped")
          : continuation("next", "still_waiting"),
      };
    } finally {
      state.nextWaiters = Math.max(0, state.nextWaiters - 1);
    }
  }

  function decisionLoopActive() {
    return state.nextWaiters > 0 || Date.now() < state.decisionLeaseUntil;
  }

  function scheduledPhase() {
    if (!decisionLoopActive()) return "unattended";
    return (state.view?.game?.legalActions || []).length > 0 ? "planning" : "observing";
  }

  function statusView() {
    return {
      cliVersion: CLI_VERSION, protocol: PROTOCOL, room, pid: process.pid,
      ready: state.ready, phase: state.phase, stopped: state.stopped, stopReason: state.stopReason,
      decisionLoopActive: decisionLoopActive(),
      decisionLeaseUntil: state.decisionLeaseUntil ? new Date(state.decisionLeaseUntil).toISOString() : null,
      roomVersion: state.view?.room?.version || null,
      decisionId: state.view?.game?.decisionId || null,
      actionRequired: Boolean(state.view?.game?.legalActions?.length),
      lastHeartbeatAt: state.lastHeartbeatAt, lastObserveAt: state.lastObserveAt,
      lastActionAt: state.lastActionAt, lastError: state.lastError,
      continuation: state.stopped
        ? terminalContinuation(state.stopReason || "session_stopped")
        : continuation("next", "match_not_terminal"),
    };
  }

  async function handleControl(message) {
    if (message.op === "status") return statusView();
    if (message.op === "next") return waitForDecision(Math.max(0, Math.min(180000, Number(message.waitMs) || 0)));
    if (message.op === "act") return submit(message.payload || {});
    if (message.op === "stop") {
      markStopped("stopped_by_owner");
      return { stopped: true, stopReason: state.stopReason, continuation: terminalContinuation(state.stopReason) };
    }
    throw new Error("Unknown control operation");
  }

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const line = buffer.slice(0, buffer.indexOf("\n"));
      buffer = "";
      Promise.resolve().then(() => {
        const message = JSON.parse(line);
        if (message.controlSecret !== controlSecret) throw new Error("Local CLI control authentication failed");
        return handleControl(message);
      }).then(
        (result) => socket.end(JSON.stringify({ ok: true, result }) + "\n"),
        (error) => socket.end(JSON.stringify({ ok: false, error: { code: error.remoteCode || "CLI_ERROR", message: error.message } }) + "\n"),
      );
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const controlAddress = server.address();
  if (!controlAddress || typeof controlAddress === "string") throw new Error("Could not establish local CLI control port");
  fs.writeFileSync(descriptor, JSON.stringify({ cliVersion: CLI_VERSION, protocol: PROTOCOL, room, pid: process.pid, port: controlAddress.port, controlSecret, pairedAt: new Date().toISOString(), tokenStored: "credential-capsule-0600" }), { mode: 0o600 });
  out({ event: "paired", room, session: descriptor, tokenPrinted: false });

  async function establishReadiness() {
    while (!state.stopped && !state.ready) {
      try {
        state.phase = "observing";
        await observe();
        const probe = await heartbeat("observing");
        if (probe?.ready) break;
        const due = probe?.nextReadinessHeartbeatAt ? Date.parse(probe.nextReadinessHeartbeatAt) : Date.now() + 4600;
        await sleep(Math.max(4600, due - Date.now() + 350));
      } catch (error) {
        state.lastError = error.remoteCode || error.message;
        if ([401, 403].includes(error.status) || error.remoteCode === "CONTROL_CHANGED") {
          markStopped("authorization_ended", state.lastError);
          break;
        }
        await sleep(1800);
      }
    }
    if (state.ready) out({ event: "ready", room, session: descriptor, heartbeat: "independent", continuation: continuation("next", "match_not_terminal") });
  }

  function scheduleObserve() {
    if (state.stopped) return;
    observeTimer = setTimeout(async () => {
      observeTimer = null;
      try { await observe(); state.lastError = null; }
      catch (error) {
        state.lastError = error.remoteCode || error.message;
        if ([401, 403].includes(error.status) || error.remoteCode === "CONTROL_CHANGED") markStopped("authorization_ended", state.lastError);
      }
      scheduleObserve();
    }, state.view?.game?.legalActions?.length ? 900 : 1900);
  }

  function scheduleHeartbeat() {
    if (state.stopped) return;
    heartbeatTimer = setTimeout(async () => {
      heartbeatTimer = null;
      try {
        state.phase = scheduledPhase();
        await heartbeat(state.phase);
        if (!state.stopped) state.lastError = null;
      }
      catch (error) {
        state.lastError = error.remoteCode || error.message;
        if ([401, 403].includes(error.status) || error.remoteCode === "CONTROL_CHANGED") markStopped("authorization_ended", state.lastError);
      }
      scheduleHeartbeat();
    }, state.view?.game?.legalActions?.length ? 4500 : 12000);
  }

  const cleanup = () => {
    if (observeTimer !== null) clearTimeout(observeTimer);
    if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
    observeTimer = null;
    heartbeatTimer = null;
    try { server.close(); } catch {}
    try {
      const current = JSON.parse(fs.readFileSync(descriptor, "utf8"));
      if (current.pid === process.pid) {
        if (state.stopReason) writeTerminalDescriptor(room, process.pid, state.stopReason, state.lastError);
        // An unclassified process exit is recoverable. Preserve the token-free
        // descriptor and owner-only credential so the next companion command
        // can continue without consuming another one-use pairing code.
      }
    } catch {}
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => { markStopped("process_interrupted"); cleanup(); process.exit(0); });
  process.once("SIGTERM", () => { cleanup(); process.exit(0); });

  await establishReadiness();
  if (state.ready && !state.stopped) {
    state.phase = "unattended";
    await heartbeat("unattended");
  }
  scheduleObserve();
  scheduleHeartbeat();
  while (!state.stopped) await sleep(1000);
  out({ event: "terminal", room, reason: state.stopReason || "session_stopped", errorCode: state.lastError, continuation: terminalContinuation(state.stopReason || "session_stopped") });
  cleanup();
}

function readDescriptor(room, allowStopped = false) {
  const file = descriptorPath(room);
  let descriptor;
  try { descriptor = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("No deterministic CLI session record for room " + room, 3); }
  if (descriptor.stopped) {
    if (allowStopped) return descriptor;
    fail("CLI session is terminal: " + descriptor.stopReason, 3);
  }
  return descriptor;
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function disableLocalControl(room, descriptor, reason) {
  try {
    fs.writeFileSync(descriptorPath(room), JSON.stringify({
      ...descriptor,
      pid: 2147483647,
      port: 0,
      controlSecret: null,
      recoveredBy: "command_fallback",
      recoveryReason: String(reason || "local_control_unavailable").slice(0, 80),
      recoveredAt: new Date().toISOString(),
    }), { mode: 0o600 });
  } catch {}
}

async function directControl(room, message, formerPid = null) {
  const credential = readCredential(room);
  let view = null;
  let lastHeartbeatAt = null;

  const terminal = (reason, errorCode = null) => writeTerminalDescriptor(room, formerPid, reason, errorCode);
  const observe = async () => {
    try {
      view = await jsonRequest(credential.origin + "/api/game?room=" + encodeURIComponent(room), {
        headers: { authorization: "Bearer " + credential.token },
      });
      view = await tickIfExpired(credential.origin, room, credential.token, view);
      if (view.room?.status === "finished" || view.game?.status === "finished") {
        terminal("match_finished");
        return view;
      }
      if (view.room?.code !== room || view.you?.controlEpoch !== credential.controlEpoch) {
        throw new RemoteError(403, "CONTROL_CHANGED", "Observed seat identity changed");
      }
      if (view.game && (view.game.engineVersion !== 2 || view.game.rulesetId !== "classic-standard-2009-ex")) {
        throw new Error("Unsupported game engine or ruleset");
      }
      return view;
    } catch (error) {
      if ([401, 403].includes(error.status) || error.remoteCode === "CONTROL_CHANGED") {
        terminal("authorization_ended", error.remoteCode || "AUTHORIZATION_ENDED");
      }
      throw error;
    }
  };
  const heartbeat = async (reportedPhase) => {
    if (!view) await observe();
    credential.seq = Number(credential.seq || 0) + 1;
    const result = await jsonRequest(credential.origin + "/api/agent-heartbeat", {
      method: "POST", headers: authHeaders(credential.token),
      body: JSON.stringify({
        room, controlEpoch: credential.controlEpoch, seq: credential.seq,
        observedVersion: view.room.version, decisionId: view.game?.decisionId || null,
        reportedPhase, retryCount: 0,
      }),
    });
    writeCredential(credential);
    lastHeartbeatAt = result.serverTime || new Date().toISOString();
    if (result.suspended) terminal("safe_mode", "AGENT_SUSPENDED");
    return result;
  };
  const status = (ready = true, phase = "unattended") => ({
    cliVersion: CLI_VERSION, protocol: PROTOCOL, room, pid: formerPid,
    mode: "command_fallback", daemonAlive: false, ready, phase,
    decisionLoopActive: phase === "planning" || phase === "observing" || phase === "submitting",
    stopped: false, stopReason: null,
    roomVersion: view?.room?.version || null,
    decisionId: view?.game?.decisionId || null,
    actionRequired: Boolean(view?.game?.legalActions?.length),
    lastHeartbeatAt, lastObserveAt: view?.serverTime || null,
    lastActionAt: null, lastError: null,
    continuation: continuation("next", "match_not_terminal"),
  });

  if (message.op === "stop") {
    terminal("stopped_by_owner");
    return { stopped: true, stopReason: "stopped_by_owner", mode: "command_fallback", continuation: terminalContinuation("stopped_by_owner") };
  }
  if (message.op === "status") {
    await observe();
    if (view.room?.status === "finished" || view.game?.status === "finished") return readDescriptor(room, true);
    const probe = await heartbeat("unattended");
    if (probe.suspended) return readDescriptor(room, true);
    return status(Boolean(probe.ready), "unattended");
  }
  if (message.op === "next") {
    const end = Date.now() + Math.max(0, Math.min(180000, Number(message.waitMs) || 0));
    let nextHeartbeat = 0;
    do {
      await observe();
      if (view.room?.status === "finished" || view.game?.status === "finished") {
        return {
          waiting: false,
          stopped: true,
          status: readDescriptor(room, true),
          continuation: terminalContinuation("match_finished"),
        };
      }
      if ((view.game?.legalActions || []).length > 0) {
        const probe = await heartbeat("planning");
        if (probe.suspended) {
          return {
            waiting: false,
            stopped: true,
            status: readDescriptor(room, true),
            continuation: terminalContinuation("safe_mode"),
          };
        }
        return publicDecision(view);
      }
      if (Date.now() >= nextHeartbeat) { await heartbeat("observing"); nextHeartbeat = Date.now() + 9000; }
      if (Date.now() >= end) break;
      await sleep(700);
    } while (Date.now() <= end);
    return { waiting: true, stopped: false, status: status(true, "observing"), continuation: continuation("next", "still_waiting") };
  }
  if (message.op === "act") {
    const payload = message.payload || {};
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (reason.length < 8 || reason.length > 120 || /[\r\n]/.test(reason)) throw new Error("reason must be one line of 8-120 characters");
    await observe();
    const legal = view.game?.legalActions?.find((entry) => entry.id === payload.legalId);
    const action = instantiateLegalAction(legal, payload);
    const requestId = crypto.randomUUID();
    const body = { op: "act", room, expectedVersion: view.room.version, requestId, action, reason };
    const submitProbe = await heartbeat("submitting");
    if (submitProbe.suspended) throw new RemoteError(409, "AGENT_SUSPENDED", "Agent is in server safe mode");
    let lastError;
    let retryAfter = 0;
    for (const delay of [0, 1000, 2000, 4000]) {
      if (delay || retryAfter) await sleep(Math.max(delay, retryAfter));
      retryAfter = 0;
      try {
        const result = await jsonRequest(credential.origin + "/api/game", {
          method: "POST", headers: authHeaders(credential.token), body: JSON.stringify(body),
        });
        if (result.agentReceipt?.requestId !== requestId || result.agentReceipt?.actionAccepted !== true || result.agentReceipt?.reasonAccepted !== true) {
          throw new Error("Server action receipt failed validation");
        }
        return { receipt: result.agentReceipt, roomVersion: result.room.version, mode: "command_fallback", continuation: continuation("next", "match_not_terminal") };
      } catch (error) {
        lastError = error;
        if (error instanceof RemoteError && error.status === 429) retryAfter = error.retryAfterMs;
        else if (error instanceof RemoteError && error.status < 500 && error.status !== 408) throw error;
      }
    }
    throw lastError || new Error("Action submission failed");
  }
  throw new Error("Unknown control operation");
}

function control(room, message) {
  const descriptor = readDescriptor(room);
  if (!processIsAlive(descriptor.pid)) return directControl(room, message, descriptor.pid);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: descriptor.port });
    let buffer = "";
    let requestWritten = false;
    let settled = false;
    const waitMs = message.op === "next"
      ? Math.max(15_000, Math.min(195_000, Number(message.waitMs) + 15_000))
      : message.op === "act" ? 75_000 : 15_000;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error("Local CLI control timed out");
      error.code = "CLI_CONTROL_TIMEOUT";
      error.requestWritten = requestWritten;
      socket.destroy();
      finish(reject, error);
    }, waitMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      requestWritten = true;
      socket.write(JSON.stringify({ ...message, controlSecret: descriptor.controlSecret }) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        response.ok ? finish(resolve, response.result) : finish(reject, new Error(response.error?.message || "CLI control failed"));
      } catch (error) { finish(reject, error); }
      socket.end();
    });
    socket.once("error", (error) => {
      error.requestWritten = requestWritten;
      finish(reject, error);
    });
  }).catch((error) => {
    const safeReadOperation = ["status", "next", "stop"].includes(message.op);
    const definitelyNotDelivered = !error?.requestWritten && ["ECONNREFUSED", "ECONNRESET", "ENOENT", "CLI_CONTROL_TIMEOUT"].includes(error?.code);
    const daemonAlive = processIsAlive(descriptor.pid);
    if (!daemonAlive || definitelyNotDelivered || safeReadOperation) {
      if (daemonAlive) disableLocalControl(room, descriptor, error?.code || error?.message);
      return directControl(room, message, descriptor.pid);
    }
    throw error;
  });
}

async function readStdinJson() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try { return JSON.parse(text); }
  catch { fail("act expects one JSON object on stdin", 2); }
}

async function main() {
  if (command === "version") return out({ cliVersion: CLI_VERSION, protocol: PROTOCOL, capabilities: CAPABILITIES });
  if (command === "doctor") {
    const origin = option("origin").replace(/\/$/, "");
    const spec = await jsonRequest(origin + "/api/agent-spec");
    if (spec.protocol !== PROTOCOL || spec.cli?.version !== CLI_VERSION) fail("CLI and server versions do not match");
    return out({ ok: true, cliVersion: CLI_VERSION, protocol: PROTOCOL, server: origin });
  }
  if (command === "connect") return argv.includes("--worker") ? connectMode() : launchConnect();
  if (["status", "next", "act", "stop"].includes(command)) {
    const room = roomCode();
    if (command === "status") {
      const descriptor = readDescriptor(room, true);
      return out(descriptor.stopped ? descriptor : await control(room, { op: "status" }));
    }
    if (command === "next") return out(await control(room, { op: "next", waitMs: Number(option("wait", "0")) * 1000 }));
    if (command === "act") return out(await control(room, { op: "act", payload: await readStdinJson() }));
    if (command === "stop") return out(await control(room, { op: "stop" }));
  }
  process.stdout.write("mouju-agent-cli " + CLI_VERSION + "\n\n" +
    "Commands:\n" +
    "  doctor  --origin URL\n" +
    "  connect --origin URL --room ROOM --pair-code CODE [--agent-name NAME]\n" +
    "  status  --room ROOM\n" +
    "  next    --room ROOM [--wait 120]\n" +
    "  act     --room ROOM   # JSON payload on stdin\n" +
    "  stop    --room ROOM\n");
}

main().catch((error) => fail(error.remoteCode ? error.remoteCode + ": " + error.message : error.message));
`;
}
