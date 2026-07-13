import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentCliSource } from "../lib/agent-cli.ts";

const ROOM = "QA8K2M";
const TOKEN = "agent_test_secret_must_never_be_printed";
const CAPABILITIES = ["deterministic-cli-v1", "detached-daemon-v1", "command-fallback-v1", "view-parity-v1", "independent-heartbeat-v1", "action-reason-v1", "decision-loop-lease-v1"];

function runCli(file: string, args: string[], stdin = "") {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test("official CLI pairs once, survives slow reasoning and daemon loss, retries idempotently, and keeps the seat projection private", { timeout: 30_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${ROOM}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${ROOM}.credential.json`);
  try { fs.unlinkSync(descriptor); } catch { /* absent is expected */ }
  try { fs.unlinkSync(credential); } catch { /* absent is expected */ }

  let heartbeatCount = 0;
  const heartbeatPhases: string[] = [];
  let lastHeartbeatSeq = 0;
  let actionCount = 0;
  let pairCount = 0;
  let submissionAttempts = 0;
  let retryRequestId = "";
  const view = (version = 1) => ({
    ok: true,
    serverTime: new Date().toISOString(),
    room: { code: ROOM, status: "playing", version, mode: "duel", maxPlayers: 2, hostPlayerId: "p1" },
    you: { playerId: "p1", name: "CLI 玩家", authVia: "agent", controlMode: "agent", controlEpoch: 2, canAct: true, scopes: ["game:observe:self", "game:act:self", "game:heartbeat:self"] },
    players: [
      { id: "p1", name: "CLI 玩家", hand: [{ id: "c1", name: "杀" }], role: "lord", duelRoster: [{ id: "guanyu", name: "关羽" }], duelLineup: [{ id: "guanyu", name: "关羽" }], handCount: 1, hp: 4, maxHp: 4 },
      { id: "p2", name: "对手", handCount: 4, hand: [{ id: "forbidden-card", name: "桃" }], duelRoster: [{ id: "forbidden-general" }], duelLineup: [{ id: "forbidden-lineup" }], hp: 3, maxHp: 4 },
    ],
    game: {
      status: "playing", mode: "duel", engineVersion: 2, rulesetId: "classic-standard-2009-ex",
      round: 3, turnPlayerId: "p1", phase: "play", pending: null, deckCount: 71,
      discardTop: { id: "discard-1", name: "闪", suit: "heart", rank: "2" },
      decisionId: "d1", decision: "你的出牌阶段", deadlineAt: new Date(Date.now() + 120_000).toISOString(),
      legalActions: [{ id: "end", kind: "exact", label: "结束回合", action: { type: "endTurn" } }],
      logs: [{ id: 1, text: "轮到 CLI 玩家行动", tone: "system", at: new Date().toISOString() }],
      winner: null, ruleset: "经典三将1V1 · 标准25将池 + EX",
    },
  });

  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/agent-spec") return response.end(JSON.stringify({ ok: true, protocol: "mouju-agent/2.4", cli: { version: "1.4.0" } }));
    if (request.url === "/api/agent-pair") {
      pairCount += 1;
      assert.deepEqual((body.agent as { capabilities: string[] }).capabilities, CAPABILITIES);
      return response.end(JSON.stringify({ ok: true, protocol: "mouju-agent/2.4", room: ROOM, agentToken: TOKEN, controlEpoch: 2, capabilities: CAPABILITIES }));
    }
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    if (request.method === "GET" && request.url?.startsWith("/api/game?")) return response.end(JSON.stringify(view(actionCount ? 2 : 1)));
    if (request.url === "/api/agent-heartbeat") {
      heartbeatPhases.push(String(body.reportedPhase));
      const seq = Number(body.seq);
      if (seq < lastHeartbeatSeq) {
        response.statusCode = 409;
        return response.end(JSON.stringify({ ok: false, error: { code: "STALE_HEARTBEAT", message: "sequence regressed" } }));
      }
      lastHeartbeatSeq = Math.max(lastHeartbeatSeq, seq);
      heartbeatCount += 1;
      return response.end(JSON.stringify({
        ok: true, serverTime: new Date().toISOString(), ready: heartbeatCount >= 2,
        nextReadinessHeartbeatAt: heartbeatCount < 2 ? new Date(Date.now() + 4_000).toISOString() : null,
      }));
    }
    if (request.url === "/api/game" && body.op === "act") {
      submissionAttempts += 1;
      assert.deepEqual(body.action, { type: "endTurn" });
      assert.equal(typeof body.reason, "string");
      if (actionCount === 1 && submissionAttempts === 2) {
        if (!retryRequestId) retryRequestId = String(body.requestId);
        assert.equal(body.requestId, retryRequestId, "ambiguous retries preserve the idempotency key");
        response.statusCode = 429;
        response.setHeader("retry-after", "0");
        return response.end(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "retry same request" } }));
      }
      if (actionCount === 1 && submissionAttempts === 3) {
        assert.equal(body.requestId, retryRequestId, "lost acknowledgements preserve the idempotency key");
        actionCount += 1;
        response.destroy();
        return;
      }
      if (actionCount === 2 && submissionAttempts === 4) {
        assert.equal(body.requestId, retryRequestId, "retry after a lost ACK reuses the accepted request id");
        return response.end(JSON.stringify({
          ...view(3),
          agentReceipt: { requestId: body.requestId, actionAccepted: true, reasonAccepted: true, reasonPolicy: "action-reason-v1" },
        }));
      }
      actionCount += 1;
      return response.end(JSON.stringify({
        ...view(2),
        agentReceipt: { requestId: body.requestId, actionAccepted: true, reasonAccepted: true, reasonPolicy: "action-reason-v1" },
      }));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  let launcher: ReturnType<typeof spawn> | null = null;
  let daemonPid: number | null = null;

  try {
  const version = await runCli(cli, ["version"]);
  assert.equal(version.code, 0);
  assert.equal(JSON.parse(version.stdout).protocol, "mouju-agent/2.4");
  const doctor = await runCli(cli, ["doctor", "--origin", origin]);
  assert.equal(doctor.code, 0);

  launcher = spawn(process.execPath, [cli, "connect", "--origin", origin, "--room", ROOM, "--pair-code", "ABCD-EFGH-JK23", "--agent-name", "CLI Test"], { stdio: ["ignore", "pipe", "pipe"] });
  let daemonOutput = "";
  let daemonErrors = "";
  launcher.stdout.on("data", (chunk) => { daemonOutput += String(chunk); });
  launcher.stderr.on("data", (chunk) => { daemonErrors += String(chunk); });
  const readyDeadline = Date.now() + 9_000;
  while (!daemonOutput.includes('"event":"ready"') && Date.now() < readyDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(daemonOutput, /"event":"paired"/, daemonErrors);
  assert.match(daemonOutput, /"event":"ready"/, daemonErrors);
  assert.match(daemonOutput, /"detached":true/, daemonErrors);
  assert.match(daemonOutput, /"continuation":\{"required":true,"next":"next"/, daemonErrors);
  assert.ok(heartbeatCount >= 2);
  assert.doesNotMatch(daemonOutput + daemonErrors, new RegExp(TOKEN));
  assert.doesNotMatch(fs.readFileSync(descriptor, "utf8"), new RegExp(TOKEN));
  assert.equal(fs.statSync(credential).mode & 0o077, 0, "recovery credential is owner-only");
  const launcherCode = launcher.exitCode !== null
    ? launcher.exitCode
    : await new Promise<number | null>((resolve) => launcher!.once("close", resolve));
  assert.equal(launcherCode, 0, daemonErrors);
  daemonPid = JSON.parse(fs.readFileSync(descriptor, "utf8")).pid;
  assert.doesNotThrow(() => process.kill(daemonPid!, 0), "the detached daemon survives launcher exit");

  const unattendedDeadline = Date.now() + 2_000;
  while (!heartbeatPhases.includes("unattended") && Date.now() < unattendedDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(heartbeatPhases.includes("unattended"), "a heartbeat-only daemon explicitly reports that no decision consumer is attached");

  const status = await runCli(cli, ["status", "--room", ROOM]);
  const statusBody = JSON.parse(status.stdout);
  assert.equal(statusBody.ready, true);
  assert.equal(statusBody.phase, "unattended");
  assert.equal(statusBody.decisionLoopActive, false);
  assert.deepEqual(statusBody.continuation, { required: true, next: "next", reason: "match_not_terminal" });
  const next = await runCli(cli, ["next", "--room", ROOM, "--wait", "1"]);
  const visible = JSON.parse(next.stdout);
  assert.equal(visible.schema, "mouju-visible-state/1");
  assert.deepEqual(visible.continuation, { required: true, next: "act", reason: "decision_ready" });
  assert.equal(visible.game.legalActions[0].id, "end");
  assert.equal(visible.game.deckCount, 71);
  assert.equal(visible.game.discardTop.name, "闪");
  assert.equal(visible.game.round, 3);
  assert.equal(visible.self.hand[0].name, "杀");
  assert.equal(visible.self.duelLineup[0].name, "关羽");
  assert.match(visible.cardHelp["杀"].effect, /伤害/);
  assert.match(visible.cardHelp["闪"].effect, /抵消/);
  assert.match(visible.generalHelp.guanyu.skillText, /武圣/);
  assert.equal("hand" in visible.players[1], false, "another seat's hand is stripped even if an upstream projection regresses");
  assert.equal("duelRoster" in visible.players[1], false);
  assert.equal("duelLineup" in visible.players[1], false);
  const heartbeatBeforeSlowReasoning = heartbeatCount;
  await new Promise((resolve) => setTimeout(resolve, 5_200));
  assert.ok(heartbeatCount > heartbeatBeforeSlowReasoning, "heartbeat scheduling continues while the reasoning Agent is slow");
  assert.equal(heartbeatPhases.at(-1), "planning", "only a live decision lease may advertise planning");
  const acted = await runCli(
    cli,
    ["act", "--room", ROOM],
    JSON.stringify({ legalId: "end", reason: "当前没有更优行动，保留手牌结束本回合。" }),
  );
  const actedBody = JSON.parse(acted.stdout);
  assert.equal(actedBody.receipt.reasonAccepted, true);
  assert.equal(actedBody.continuation.next, "next");
  assert.equal(actionCount, 1);
  assert.ok(Number(JSON.parse(fs.readFileSync(credential, "utf8")).seq) >= lastHeartbeatSeq, "the recovery capsule persists the last accepted heartbeat sequence");

  // Reproduce ChatGPT Work forcibly reaping the detached child after ready.
  // No second pairing is allowed: status/next/act must recover through bounded
  // deterministic commands using the same owner-only credential capsule.
  process.kill(daemonPid!, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const fallbackStatus = JSON.parse((await runCli(cli, ["status", "--room", ROOM])).stdout);
  assert.equal(fallbackStatus.mode, "command_fallback");
  assert.equal(fallbackStatus.daemonAlive, false);
  assert.equal(fallbackStatus.ready, true);
  assert.equal(fallbackStatus.phase, "unattended");
  assert.equal(fallbackStatus.decisionLoopActive, false);
  const fallbackNext = JSON.parse((await runCli(cli, ["next", "--room", ROOM, "--wait", "1"])).stdout);
  assert.equal(fallbackNext.schema, "mouju-visible-state/1");
  assert.equal(fallbackNext.continuation.next, "act");
  assert.equal("hand" in fallbackNext.players[1], false);
  const fallbackAct = JSON.parse((await runCli(
    cli,
    ["act", "--room", ROOM],
    JSON.stringify({ legalId: "end", reason: "守护进程已回收，仍按当前局面保留手牌结束回合。" }),
  )).stdout);
  assert.equal(fallbackAct.mode, "command_fallback");
  assert.equal(fallbackAct.receipt.reasonAccepted, true);
  assert.equal(fallbackAct.continuation.next, "next");
  assert.equal(actionCount, 2);
  assert.equal(submissionAttempts, 4, "fallback survives rate limiting and a lost success acknowledgement");
  assert.equal(pairCount, 1, "daemon recovery never consumes another pairing code");
  await runCli(cli, ["stop", "--room", ROOM]);
  const stoppedDeadline = Date.now() + 3_000;
  let terminalStatus: Record<string, unknown> = {};
  while (Date.now() < stoppedDeadline) {
    const statusResult = await runCli(cli, ["status", "--room", ROOM]);
    terminalStatus = JSON.parse(statusResult.stdout);
    if (terminalStatus.stopped) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(terminalStatus.stopReason, "stopped_by_owner");
  assert.equal((terminalStatus.continuation as { required: boolean }).required, false);
  assert.equal(fs.existsSync(credential), false, "terminal stop removes the recovery credential");
  } finally {
    if (launcher?.exitCode == null) launcher?.kill("SIGTERM");
    if (daemonPid) { try { process.kill(daemonPid, "SIGTERM"); } catch {} }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(descriptor); } catch { /* daemon may already clean it */ }
    try { fs.unlinkSync(credential); } catch { /* terminal stop removes it */ }
  }
});

test("a match that finishes during pairing produces an explicit terminal reason instead of a silent exit", { timeout: 8_000 }, async () => {
  const room = "END8K2";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-terminal-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${room}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${room}.credential.json`);
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  try { fs.unlinkSync(descriptor); } catch {}
  try { fs.unlinkSync(credential); } catch {}
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/agent-pair") return response.end(JSON.stringify({ ok: true, protocol: "mouju-agent/2.4", room, agentToken: TOKEN, controlEpoch: 4, capabilities: CAPABILITIES }));
    if (request.method === "GET" && request.url?.startsWith("/api/game?")) return response.end(JSON.stringify({
      ok: true, room: { code: room, status: "finished", version: 9 }, you: null, players: [],
      game: { status: "finished", engineVersion: 2, rulesetId: "classic-standard-2009-ex", legalActions: [], logs: [] },
    }));
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runCli(cli, ["connect", "--origin", `http://127.0.0.1:${address.port}`, "--room", room, "--pair-code", "ABCD-EFGH-JK23"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"event":"paired"/);
    assert.match(result.stdout, /"event":"terminal"/);
    assert.match(result.stdout, /"reason":"match_finished"/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN));
    const status = await runCli(cli, ["status", "--room", room]);
    assert.equal(JSON.parse(status.stdout).stopReason, "match_finished");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(descriptor); } catch {}
    try { fs.unlinkSync(credential); } catch {}
  }
});

test("command fallback refuses a recovery credential that is readable by other OS users", async () => {
  const room = "SAFE8K";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-permission-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${room}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${room}.credential.json`);
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  fs.writeFileSync(descriptor, JSON.stringify({ cliVersion: "1.4.0", protocol: "mouju-agent/2.4", room, pid: 99999999, port: 1 }), { mode: 0o600 });
  fs.writeFileSync(credential, JSON.stringify({ cliVersion: "1.4.0", protocol: "mouju-agent/2.4", origin: "http://127.0.0.1:1", room, token: TOKEN, controlEpoch: 1, seq: 0 }), { mode: 0o644 });
  try {
    const result = await runCli(cli, ["status", "--room", room]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /permissions are unsafe/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN));
  } finally {
    try { fs.unlinkSync(descriptor); } catch {}
    try { fs.unlinkSync(credential); } catch {}
  }
});

test("intermittent observe and heartbeat outages recover without consuming another pairing code", { timeout: 12_000 }, async () => {
  const room = "NET8K2";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-network-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${room}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${room}.credential.json`);
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  try { fs.unlinkSync(descriptor); } catch {}
  try { fs.unlinkSync(credential); } catch {}
  let pairCount = 0;
  let observeAttempts = 0;
  let heartbeatAttempts = 0;
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/agent-pair") {
      pairCount += 1;
      return response.end(JSON.stringify({ ok: true, protocol: "mouju-agent/2.4", room, agentToken: TOKEN, controlEpoch: 3, capabilities: CAPABILITIES }));
    }
    if (request.method === "GET" && request.url?.startsWith("/api/game?")) {
      observeAttempts += 1;
      if (observeAttempts === 1) {
        response.statusCode = 503;
        return response.end(JSON.stringify({ ok: false, error: { code: "UPSTREAM_NETWORK" } }));
      }
      return response.end(JSON.stringify({
        ok: true, serverTime: new Date().toISOString(),
        room: { code: room, status: "lobby", version: 4, mode: "duel" },
        you: { playerId: "p1", controlEpoch: 3, authVia: "agent", canAct: true },
        players: [], game: null,
      }));
    }
    if (request.url === "/api/agent-heartbeat") {
      heartbeatAttempts += 1;
      if (heartbeatAttempts === 1) {
        response.destroy();
        return;
      }
      return response.end(JSON.stringify({ ok: true, ready: true, suspended: false, serverTime: new Date().toISOString() }));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let daemonPid: number | null = null;
  try {
    const result = await runCli(cli, ["connect", "--origin", `http://127.0.0.1:${address.port}`, "--room", room, "--pair-code", "ABCD-EFGH-JK23"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"event":"ready"/);
    assert.equal(pairCount, 1);
    assert.ok(observeAttempts >= 2);
    assert.ok(heartbeatAttempts >= 2);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN));
    daemonPid = JSON.parse(fs.readFileSync(descriptor, "utf8")).pid;
  } finally {
    if (daemonPid) { try { process.kill(daemonPid, "SIGTERM"); } catch {} }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(descriptor); } catch {}
    try { fs.unlinkSync(credential); } catch {}
  }
});

test("an ambiguous pairing response is never retried automatically", { timeout: 6_000 }, async () => {
  const room = "PAIR8K";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-pair-loss-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${room}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${room}.credential.json`);
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  try { fs.unlinkSync(descriptor); } catch {}
  try { fs.unlinkSync(credential); } catch {}
  let pairCount = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { void chunk; }
    if (request.url === "/api/agent-pair") {
      pairCount += 1;
      response.destroy();
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runCli(cli, ["connect", "--origin", `http://127.0.0.1:${address.port}`, "--room", room, "--pair-code", "ABCD-EFGH-JK23"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"event":"terminal"/);
    assert.match(result.stdout, /"reason":"pair_failed"/);
    assert.equal(pairCount, 1, "single-use pairing is never retried after an ambiguous network failure");
    assert.equal(fs.existsSync(credential), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(descriptor); } catch {}
    try { fs.unlinkSync(credential); } catch {}
  }
});

test("safe mode becomes an explicit terminal CLI state and deletes the recovery credential", async () => {
  const room = "SAFE3K";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-safe-mode-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${room}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${room}.credential.json`);
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  try { fs.unlinkSync(descriptor); } catch {}
  try { fs.unlinkSync(credential); } catch {}
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url?.startsWith("/api/game?")) return response.end(JSON.stringify({
      ok: true, serverTime: new Date().toISOString(),
      room: { code: room, status: "playing", version: 9, mode: "duel" },
      you: { playerId: "p1", controlEpoch: 7, authVia: "agent", canAct: false },
      players: [], game: { status: "playing", engineVersion: 2, rulesetId: "classic-standard-2009-ex", legalActions: [], decisionId: "d9" },
    }));
    if (request.url === "/api/agent-heartbeat") return response.end(JSON.stringify({ ok: true, ready: true, suspended: true, serverTime: new Date().toISOString() }));
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  fs.writeFileSync(descriptor, JSON.stringify({ cliVersion: "1.4.0", protocol: "mouju-agent/2.4", room, pid: 99999999, port: 1 }), { mode: 0o600 });
  fs.writeFileSync(credential, JSON.stringify({ cliVersion: "1.4.0", protocol: "mouju-agent/2.4", origin: `http://127.0.0.1:${address.port}`, room, token: TOKEN, controlEpoch: 7, seq: 4 }), { mode: 0o600 });
  try {
    const result = await runCli(cli, ["status", "--room", room]);
    assert.equal(result.code, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.stopped, true);
    assert.equal(status.stopReason, "safe_mode");
    assert.equal(status.tokenStored, false);
    assert.equal(fs.existsSync(credential), false);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(descriptor); } catch {}
    try { fs.unlinkSync(credential); } catch {}
  }
});

test("a CLI recovery process advances an expired decision without an open browser", async () => {
  const room = "TICK8K";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mouju-cli-tick-test-"));
  const cli = path.join(temp, "mouju-agent-cli.mjs");
  const descriptor = path.join(os.tmpdir(), `mouju-agent-${room}.json`);
  const credential = path.join(os.tmpdir(), `mouju-agent-${room}.credential.json`);
  fs.writeFileSync(cli, agentCliSource(), { mode: 0o700 });
  try { fs.unlinkSync(descriptor); } catch {}
  try { fs.unlinkSync(credential); } catch {}
  let tickCount = 0;
  const gameView = (version: number, expired: boolean) => ({
    ok: true, serverTime: new Date().toISOString(),
    room: { code: room, status: "playing", version, mode: "duel" },
    you: { playerId: "p1", controlEpoch: 5, authVia: "agent", canAct: true },
    players: [],
    game: {
      status: "playing", engineVersion: 2, rulesetId: "classic-standard-2009-ex", legalActions: [], decisionId: `d${version}`,
      deadlineAt: new Date(Date.now() + (expired ? -1_000 : 60_000)).toISOString(),
    },
  });
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url?.startsWith("/api/game?")) return response.end(JSON.stringify(gameView(5, true)));
    if (request.url === "/api/game" && body.op === "tick") {
      tickCount += 1;
      return response.end(JSON.stringify(gameView(6, false)));
    }
    if (request.url === "/api/agent-heartbeat") return response.end(JSON.stringify({ ok: true, ready: true, suspended: false, serverTime: new Date().toISOString() }));
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  fs.writeFileSync(descriptor, JSON.stringify({ cliVersion: "1.4.0", protocol: "mouju-agent/2.4", room, pid: 99999999, port: 1 }), { mode: 0o600 });
  fs.writeFileSync(credential, JSON.stringify({ cliVersion: "1.4.0", protocol: "mouju-agent/2.4", origin: `http://127.0.0.1:${address.port}`, room, token: TOKEN, controlEpoch: 5, seq: 3 }), { mode: 0o600 });
  try {
    const result = await runCli(cli, ["status", "--room", room]);
    assert.equal(result.code, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.mode, "command_fallback");
    assert.equal(status.roomVersion, 6);
    assert.equal(tickCount, 1, "the expired server decision is advanced exactly once by this recovery process");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(descriptor); } catch {}
    try { fs.unlinkSync(credential); } catch {}
  }
});
