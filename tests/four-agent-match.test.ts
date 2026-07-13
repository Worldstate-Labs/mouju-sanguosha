import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runWithBindings } from "../lib/runtime-env.ts";
import {
  ApiError,
  claimAgentPairing,
  getRoom,
  handleOperation,
  heartbeatAgent,
} from "../lib/store.ts";

const AGENT_CAPABILITIES = ["deterministic-cli-v1", "detached-daemon-v1", "command-fallback-v1", "view-parity-v1", "independent-heartbeat-v1", "action-reason-v1"];

interface LegalAction {
  id: string;
  kind: "exact" | "discard" | "skill";
  label: string;
  action?: Record<string, unknown>;
  skill?: string;
  candidateCardIds?: string[];
  minCards?: number;
  maxCards?: number;
  targetIds?: string[];
  minTargets?: number;
  maxTargets?: number;
}

interface TestView {
  ok: boolean;
  alreadyApplied?: boolean;
  agentReceipt?: { requestId: string; actionAccepted: boolean; reasonAccepted: boolean; reasonPolicy: string };
  guestToken?: string;
  agentToken?: string;
  controlEpoch?: number;
  pairing?: { pairingCode: string; playerId: string };
  room: {
    code: string;
    status: "lobby" | "playing" | "finished";
    version: number;
    canStart: boolean;
    startBlockers: Array<{ code: string; count: number }>;
  };
  players: Array<{
    id: string;
    name: string;
    role?: string | null;
    alive?: boolean;
    hand?: Array<{ id: string; name: string }>;
    duelReserveCount?: number;
    duelDefeatedCount?: number;
    duelRoster?: Array<{ id: string; name: string }>;
    duelLineup?: Array<{ id: string; name: string }>;
    agentStatus?: { state: string; label: string; consecutiveTimeouts: number };
  }>;
  you: null | {
    playerId: string;
    controlEpoch: number;
    authVia: string;
    agentDiagnostics: null | {
      agentName: string;
      runtime: string;
      state: string;
      lastHeartbeatAt: string | null;
      lastObservedVersion: number | null;
      consecutiveTimeouts: number;
      scopes: string[];
      events: Array<{ type: string; summary: string; reason?: string | null }>;
    };
  };
  game: null | {
    status?: string;
    round?: number;
    mode?: "duel" | "identity";
    winner: null | { label: string; playerIds: string[] };
    pending: null | { targetId: string };
    turnPlayerId: string | null;
    phase?: string | null;
    deckCount?: number;
    discardTop?: unknown;
    ruleset?: string;
    engineVersion?: number;
    rulesetId?: string;
    deadlineAt: string | null;
    decisionId: string | null;
    legalActions: LegalAction[];
    logs: Array<{ text: string }>;
  };
}

class MockStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new MockStatement(this.database, this.sql, values);
  }

  first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[], success: true, meta: {} };
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class MockD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new MockStatement(this.sqlite, sql);
  }

  batch(statements: MockStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function request(token?: string) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://game.example/api/game", { headers });
}

async function rejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof ApiError && error.code === code);
}

function chooseAction(actions: LegalAction[], pending: boolean, warmup: boolean) {
  let selected: LegalAction | undefined;
  if (pending) {
    selected = actions.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass");
    selected ??= actions.find((entry) => entry.kind === "exact");
    selected ??= actions.find((entry) => entry.kind === "discard");
    selected ??= actions.find((entry) => entry.kind === "skill");
  } else if (warmup) {
    selected = actions.find((entry) => entry.kind === "discard");
    selected ??= actions.find((entry) => entry.kind === "exact" && entry.action?.type === "endTurn");
  } else {
    selected = actions.find(
      (entry) =>
        entry.kind === "exact" &&
        ["【杀】", "【决斗】", "【南蛮入侵】", "【万箭齐发】"].some((name) => entry.label.includes(name)),
    );
    selected ??= actions.find((entry) => entry.kind === "discard");
    selected ??= actions.find(
      (entry) => entry.kind === "exact" && entry.action?.type !== "endTurn" && !entry.label.includes("【桃】"),
    );
    selected ??= actions.find((entry) => entry.kind === "skill");
    selected ??= actions.find((entry) => entry.kind === "exact" && entry.action?.type === "endTurn");
    selected ??= actions[0];
  }
  assert.ok(selected, "the prompted Agent always receives at least one legal action");
  if (selected.kind === "exact") return selected.action!;
  if (selected.kind === "discard") {
    return { type: "discard", cardIds: selected.candidateCardIds!.slice(0, selected.minCards) };
  }
  return {
    type: "skill",
    skill: selected.skill,
    cardIds: selected.candidateCardIds?.slice(0, selected.minCards ?? 0),
    targetIds: selected.targetIds?.slice(0, selected.minTargets ?? 0),
  };
}

async function setupAgentLobby(d1: MockD1, count = 4) {
  const owners: string[] = [];
  const pairings: Array<{ pairingCode: string; playerId: string }> = [];
  const created = (await handleOperation(request(), {
    op: "create",
    name: "席位一",
    maxPlayers: count,
    participation: "agent",
  })) as TestView;
  owners.push(created.guestToken!);
  pairings.push(created.pairing!);
  for (let index = 1; index < count; index += 1) {
    const joined = (await handleOperation(request(), {
      op: "join",
      room: created.room.code,
      name: `席位${["一", "二", "三", "四"][index]}`,
      participation: "agent",
    })) as TestView;
    owners.push(joined.guestToken!);
    pairings.push(joined.pairing!);
  }

  const versionBeforeClaims = ((await getRoom(request(owners[0]), created.room.code)) as TestView).room.version;
  const claims = (await Promise.all(
    pairings.map((pairing, index) =>
      claimAgentPairing({
        pairingCode: pairing.pairingCode,
        agent: { name: `Runtime-${index + 1}`, runtime: "deterministic-cli", version: "test-1.0", capabilities: AGENT_CAPABILITIES },
      }),
    ),
  )) as TestView[];
  const versionAfterClaims = ((await getRoom(request(owners[0]), created.room.code)) as TestView).room.version;
  assert.equal(versionAfterClaims, versionBeforeClaims, "independent claims do not mutate gameplay version");

  const tokens = claims.map((claim) => claim.agentToken!);
  const epochs = claims.map((claim) => claim.controlEpoch!);
  await rejectsWithCode(
    handleOperation(request(owners[0]), { op: "start", room: created.room.code }),
    "AGENT_NOT_READY",
  );

  const observations = (await Promise.all(tokens.map((token) => getRoom(request(token), created.room.code)))) as TestView[];
  const observedVersion = observations[0].room.version;
  assert.ok(observations.every((view) => view.room.version === observedVersion));
  const sequences = Array.from({ length: count }, () => 1);
  const firstHeartbeats = await Promise.all(
    tokens.map((token, index) =>
      heartbeatAgent(request(token), {
        room: created.room.code,
        controlEpoch: epochs[index],
        seq: sequences[index],
        observedVersion,
        decisionId: observations[index].game?.decisionId ?? null,
        reportedPhase: "observing",
        retryCount: 0,
      }),
    ),
  );
  assert.ok(firstHeartbeats.every((heartbeat) => !heartbeat.ready), "one heartbeat does not prove a persistent Agent session");
  d1.sqlite
    .prepare("UPDATE agent_credentials SET last_heartbeat_at = datetime('now', '-5 seconds') WHERE room_code = ? AND revoked_at IS NULL")
    .run(created.room.code);
  const continuityObservations = (await Promise.all(tokens.map((token) => getRoom(request(token), created.room.code)))) as TestView[];
  const continuityHeartbeats = await Promise.all(
    tokens.map((token, index) => {
      sequences[index] += 1;
      return heartbeatAgent(request(token), {
        room: created.room.code,
        controlEpoch: epochs[index],
        seq: sequences[index],
        observedVersion: continuityObservations[index].room.version,
        decisionId: continuityObservations[index].game?.decisionId ?? null,
        reportedPhase: "observing",
        retryCount: 0,
      });
    }),
  );
  assert.ok(continuityHeartbeats.every((heartbeat) => heartbeat.ready), "a later heartbeat proves continuity and makes the seat ready");
  assert.equal(
    ((await getRoom(request(owners[0]), created.room.code)) as TestView).room.version,
    observedVersion,
    "heartbeats never change optimistic game version",
  );
  return { room: created.room.code, owners, tokens, epochs, sequences, pairings };
}

function assertPrivateProjection(view: TestView, allTokens: string[], allPairingCodes: string[]) {
  assert.ok(view.you);
  const own = view.players.find((entry) => entry.id === view.you!.playerId)!;
  assert.ok(Array.isArray(own.hand), "the Agent receives only its own private hand");
  if (view.game?.mode === "duel") {
    assert.ok(Array.isArray(own.duelRoster), "a duel Agent receives its own drafted roster");
    assert.ok(Array.isArray(own.duelLineup), "a duel Agent receives its own private lineup");
  }
  for (const other of view.players.filter((entry) => entry.id !== own.id)) {
    assert.equal(other.hand, undefined, "another seat's hand is never projected");
    assert.equal(other.duelRoster, undefined, "another duelist's five-general roster is never projected");
    assert.equal(other.duelLineup, undefined, "another duelist's three-general order is never projected");
    if (view.game?.mode !== "duel" && other.alive !== false && other.role !== "lord") assert.equal(other.role, null);
  }
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("rngState"), false, "internal RNG state is never projected");
  assert.equal(serialized.includes("rngMode"), false, "internal RNG mode is never projected");
  for (const secret of [...allTokens, ...allPairingCodes]) assert.equal(serialized.includes(secret), false);
}

test("four participant-owned Agents connect concurrently and finish a complete four-player match", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const setup = await setupAgentLobby(d1);

    d1.sqlite
      .prepare(`UPDATE agent_credentials SET last_used_at = datetime('now', '-45 seconds'),
        last_heartbeat_at = datetime('now', '-45 seconds') WHERE target_player_id = ? AND revoked_at IS NULL`)
      .run(setup.pairings[0].playerId);
    let ownerView = (await getRoom(request(setup.owners[0]), setup.room)) as TestView;
    assert.equal(ownerView.players.find((entry) => entry.id === setup.pairings[0].playerId)?.agentStatus?.state, "delayed");
    d1.sqlite
      .prepare(`UPDATE agent_credentials SET last_used_at = datetime('now', '-90 seconds'),
        last_heartbeat_at = datetime('now', '-90 seconds') WHERE target_player_id = ? AND revoked_at IS NULL`)
      .run(setup.pairings[0].playerId);
    ownerView = (await getRoom(request(setup.owners[0]), setup.room)) as TestView;
    assert.equal(ownerView.players.find((entry) => entry.id === setup.pairings[0].playerId)?.agentStatus?.state, "offline");

    const restoredObservation = (await getRoom(request(setup.tokens[0]), setup.room)) as TestView;
    setup.sequences[0] += 1;
    await heartbeatAgent(request(setup.tokens[0]), {
      room: setup.room,
      controlEpoch: setup.epochs[0],
      seq: setup.sequences[0],
      observedVersion: restoredObservation.room.version,
      decisionId: null,
      reportedPhase: "idle",
    });

    const privateOwnerViews = (await Promise.all(
      setup.owners.map((token) => getRoom(request(token), setup.room)),
    )) as TestView[];
    privateOwnerViews.forEach((view, index) => {
      assert.equal(view.you?.agentDiagnostics?.agentName, `Runtime-${index + 1}`);
      assert.equal(view.you?.agentDiagnostics?.lastObservedVersion, view.room.version);
      assert.deepEqual(view.you?.agentDiagnostics?.scopes.sort(), [
        "game:act:self",
        "game:heartbeat:self",
        "game:observe:self",
      ]);
      const serialized = JSON.stringify(view);
      for (let other = 0; other < 4; other += 1) {
        if (other !== index) assert.equal(serialized.includes(`Runtime-${other + 1}`), false);
      }
    });

    const lobby = (await getRoom(request(setup.owners[0]), setup.room)) as TestView;
    assert.equal(lobby.room.canStart, true);
    const started = (await handleOperation(request(setup.owners[0]), { op: "start", room: setup.room })) as TestView;
    assert.equal(started.room.status, "playing");
    assert.ok(started.game?.deadlineAt);
    assert.ok(
      new Date(started.game!.deadlineAt!).getTime() - Date.now() >= 55_000,
      "the first Agent decision receives at least the 60-second response window",
    );

    const acted = new Set<string>();
    let idempotencyChecked = false;
    let finalView: TestView | null = null;
    for (let step = 0; step < 5_000; step += 1) {
      const views = (await Promise.all(
        setup.tokens.map((token) => getRoom(request(token), setup.room)),
      )) as TestView[];
      assert.ok(views.every((view) => view.room.version === views[0].room.version));
      views.forEach((view) => assertPrivateProjection(view, setup.tokens, setup.pairings.map((entry) => entry.pairingCode)));

      const actionable = views
        .map((view, index) => ({ view, index }))
        .filter(({ view }) => (view.game?.legalActions.length ?? 0) > 0);
      assert.equal(actionable.length, 1, `step ${step} has exactly one server-authorized Agent`);
      const { view: actorView, index: actorIndex } = actionable[0];
      const actorId = actorView.you!.playerId;
      const currentVersion = actorView.room.version;

      await Promise.all(
        views.map((view, index) => {
          setup.sequences[index] += 1;
          return heartbeatAgent(request(setup.tokens[index]), {
            room: setup.room,
            controlEpoch: setup.epochs[index],
            seq: setup.sequences[index],
            observedVersion: view.room.version,
            decisionId: view.game?.decisionId ?? null,
            reportedPhase: index === actorIndex ? "planning" : "idle",
          });
        }),
      );
      assert.equal(
        ((await getRoom(request(setup.owners[0]), setup.room)) as TestView).room.version,
        currentVersion,
        "concurrent health updates do not invalidate the pending action",
      );

      const action = chooseAction(
        actorView.game!.legalActions,
        Boolean(actorView.game!.pending),
        acted.size < 4,
      );
      if (!idempotencyChecked) {
        d1.sqlite.prepare(`UPDATE agent_credentials SET consecutive_timeouts = 2,
          last_timeout_at = datetime('now', '-20 seconds') WHERE target_player_id = ? AND revoked_at IS NULL`).run(actorId);
        await rejectsWithCode(
          handleOperation(request(setup.tokens[actorIndex]), {
            op: "act",
            room: setup.room,
            expectedVersion: currentVersion,
            requestId: "missing-reason",
            action,
          }),
          "ACTION_REASON_REQUIRED",
        );
        await rejectsWithCode(
          handleOperation(request(setup.tokens[actorIndex]), {
            op: "act",
            room: setup.room,
            expectedVersion: currentVersion,
            requestId: "placeholder-reason",
            action,
            reason: "执行当前合法动作。",
          }),
          "BAD_ACTION_REASON",
        );
      }
      const body = {
        op: "act",
        room: setup.room,
        expectedVersion: currentVersion,
        requestId: `match-${step}`,
        action,
        reason: "结合当前公开局面选择该合法行动，以推进本回合战术目标。",
      };
      let result: TestView;
      if (!idempotencyChecked) {
        const repeated = (await Promise.all([
          handleOperation(request(setup.tokens[actorIndex]), body),
          handleOperation(request(setup.tokens[actorIndex]), body),
        ])) as TestView[];
        assert.equal(repeated.filter((entry) => entry.alreadyApplied).length, 1);
        assert.equal(new Set(repeated.map((entry) => entry.room.version)).size, 1);
        assert.ok(repeated.every((entry) => entry.agentReceipt?.actionAccepted && entry.agentReceipt.reasonAccepted));
        assert.ok(repeated.every((entry) => entry.agentReceipt?.reasonPolicy === "action-reason-v1"));
        assert.equal((d1.sqlite.prepare("SELECT consecutive_timeouts AS count FROM agent_credentials WHERE target_player_id = ? AND revoked_at IS NULL").get(actorId) as { count: number }).count, 0, "a successful accepted action clears the Agent timeout budget");
        await rejectsWithCode(
          handleOperation(request(setup.tokens[actorIndex]), {
            ...body,
            expectedVersion: currentVersion + 1,
            action: { type: "pass" },
          }),
          "REQUEST_ID_REUSED",
        );
        result = repeated[0];
        idempotencyChecked = true;
      } else {
        result = (await handleOperation(request(setup.tokens[actorIndex]), body)) as TestView;
      }
      acted.add(actorId);
      if (result.room.status === "finished") {
        finalView = result;
        break;
      }
    }

    assert.ok(finalView, "the four-Agent match finishes before the deadlock safety bound");
    assert.equal(finalView.room.status, "finished");
    assert.ok(finalView.game?.winner?.playerIds.length);
    assert.equal(acted.size, 4, "all four Agents successfully submit at least one server-accepted action");
    assert.ok(finalView.game?.logs.some((entry) => entry.text.includes("对局结束")));
  });
});

test("two participant-owned Agents complete a full three-general KOF duel", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const setup = await setupAgentLobby(d1, 2);
    const lobby = (await getRoom(request(setup.owners[0]), setup.room)) as TestView;
    assert.equal(lobby.room.canStart, true);
    await handleOperation(request(setup.owners[0]), { op: "start", room: setup.room });

    const acted = new Set<string>();
    let finalView: TestView | null = null;
    for (let step = 0; step < 9_000; step += 1) {
      const views = (await Promise.all(setup.tokens.map((token) => getRoom(request(token), setup.room)))) as TestView[];
      assert.ok(views.every((view) => view.room.version === views[0].room.version));
      views.forEach((view) => assertPrivateProjection(view, setup.tokens, setup.pairings.map((entry) => entry.pairingCode)));
      const actionable = views.map((view, index) => ({ view, index }))
        .filter(({ view }) => (view.game?.legalActions.length ?? 0) > 0);
      assert.equal(actionable.length, 1, `duel step ${step} has exactly one authorized Agent`);
      const { view, index } = actionable[0];
      const result = (await handleOperation(request(setup.tokens[index]), {
        op: "act",
        room: setup.room,
        expectedVersion: view.room.version,
        requestId: `duel-${step}`,
        action: chooseAction(view.game!.legalActions, Boolean(view.game!.pending), acted.size < 2),
        reason: "根据当前手牌、体力与场上信息选择该动作以争取优势。",
      })) as TestView;
      acted.add(view.you!.playerId);
      if (result.room.status === "finished") {
        finalView = result;
        break;
      }
    }

    assert.ok(finalView, "the two-Agent KOF duel finishes before the safety bound");
    assert.equal(finalView.game?.mode, "duel");
    assert.ok(finalView.game?.winner?.playerIds.length);
    assert.equal(acted.size, 2);
    const loser = finalView.players.find((entry) => !finalView!.game!.winner!.playerIds.includes(entry.id))!;
    assert.equal(loser.duelDefeatedCount, 3);
  });
});

test("repeated Agent matches survive heartbeat jitter, disconnect recovery, stale actions, duplicate delivery, and one autonomous timeout", { timeout: 30_000 }, async () => {
  for (let match = 0; match < 3; match += 1) {
    const d1 = new MockD1();
    await runWithBindings({ DB: d1 as never }, async () => {
      const count = match === 1 ? 2 : 4;
      const setup = await setupAgentLobby(d1, count);
      await handleOperation(request(setup.owners[0]), { op: "start", room: setup.room });
      let disconnectInjected = false;
      let timeoutInjected = false;
      let finished: TestView | null = null;

      for (let step = 0; step < 9_000; step += 1) {
        const views = await Promise.all(setup.tokens.map((token) => getRoom(request(token), setup.room))) as TestView[];
        views.forEach((view) => assertPrivateProjection(view, setup.tokens, setup.pairings.map((entry) => entry.pairingCode)));
        const actionable = views.map((view, index) => ({ view, index })).filter(({ view }) => (view.game?.legalActions.length ?? 0) > 0);
        assert.equal(actionable.length, 1, `chaos match ${match} step ${step} has one authorized controller`);
        const { view, index } = actionable[0];

        setup.sequences[index] += 1;
        const heartbeatBody = {
          room: setup.room,
          controlEpoch: setup.epochs[index],
          seq: setup.sequences[index],
          observedVersion: view.room.version,
          decisionId: view.game!.decisionId,
          reportedPhase: "planning",
          retryCount: step % 4,
        };
        const heartbeat = await heartbeatAgent(request(setup.tokens[index]), heartbeatBody) as { ready: boolean };
        assert.equal(heartbeat.ready, true);
        if (step % 11 === 0) {
          const duplicate = await heartbeatAgent(request(setup.tokens[index]), heartbeatBody) as { ready: boolean };
          assert.equal(duplicate.ready, true, "a retried heartbeat ACK is idempotent");
        }

        if (!disconnectInjected && step >= 3) {
          const actorId = view.you!.playerId;
          d1.sqlite.prepare(`UPDATE agent_credentials SET last_used_at = datetime('now', '-70 seconds'),
            last_heartbeat_at = datetime('now', '-70 seconds'), last_action_attempt_at = NULL,
            last_action_accepted_at = NULL WHERE target_player_id = ? AND revoked_at IS NULL`).run(actorId);
          const ownerOffline = await getRoom(request(setup.owners[index]), setup.room) as TestView;
          assert.equal(ownerOffline.players.find((entry) => entry.id === actorId)?.agentStatus?.state, "offline");
          const restored = await getRoom(request(setup.tokens[index]), setup.room) as TestView;
          setup.sequences[index] += 1;
          await heartbeatAgent(request(setup.tokens[index]), {
            ...heartbeatBody,
            seq: setup.sequences[index],
            observedVersion: restored.room.version,
            decisionId: restored.game!.decisionId,
            retryCount: 3,
            errorCode: "upstream_network",
          });
          disconnectInjected = true;
        }

        if (!timeoutInjected && step >= 8) {
          const row = d1.sqlite.prepare("SELECT state_json FROM rooms WHERE code = ?").get(setup.room) as { state_json: string };
          const state = JSON.parse(row.state_json) as { deadlineAt: string };
          state.deadlineAt = new Date(Date.now() - 1_000).toISOString();
          d1.sqlite.prepare("UPDATE rooms SET state_json = ? WHERE code = ?").run(JSON.stringify(state), setup.room);
          await Promise.allSettled(setup.tokens.map((token) => handleOperation(request(token), { op: "tick", room: setup.room })));
          const afterTimeout = await getRoom(request(setup.owners[0]), setup.room) as TestView;
          timeoutInjected = true;
          if (afterTimeout.room.status === "finished") { finished = afterTimeout; break; }
          continue;
        }

        const action = chooseAction(view.game!.legalActions, Boolean(view.game!.pending), step < count);
        if (step % 13 === 0) {
          await rejectsWithCode(handleOperation(request(setup.tokens[index]), {
            op: "act", room: setup.room, expectedVersion: view.room.version - 1,
            requestId: `chaos-stale-${match}-${step}`, action,
            reason: "先验证过期局面会被拒绝，再依据最新可见状态安全行动。",
          }), "VERSION_CONFLICT");
        }
        const body = {
          op: "act", room: setup.room, expectedVersion: view.room.version,
          requestId: `chaos-${match}-${step}`, action,
          reason: "依据当前可见信息与服务端合法动作完成本次稳定性测试行动。",
        };
        const results = step % 7 === 0
          ? await Promise.all([handleOperation(request(setup.tokens[index]), body), handleOperation(request(setup.tokens[index]), body)]) as TestView[]
          : [await handleOperation(request(setup.tokens[index]), body) as TestView];
        assert.equal(new Set(results.map((entry) => entry.room.version)).size, 1);
        assert.ok(results.every((entry) => entry.agentReceipt?.actionAccepted && entry.agentReceipt.reasonAccepted));
        if (results[0].room.status === "finished") { finished = results[0]; break; }
      }

      assert.ok(disconnectInjected, `chaos match ${match} injected and recovered a disconnect`);
      assert.ok(timeoutInjected, `chaos match ${match} injected an autonomous timeout`);
      assert.ok(finished?.game?.winner, `chaos match ${match} finishes without deadlock`);
    });
  }
});

test("one participant-owned Agent pairs, becomes ready, and completes a 1v1 match against a human-controlled seat", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const created = (await handleOperation(request(), {
      op: "create",
      name: "Agent席位拥有者",
      maxPlayers: 2,
      participation: "agent",
    })) as TestView;
    const ownerToken = created.guestToken!;
    const joined = (await handleOperation(request(), {
      op: "join",
      room: created.room.code,
      name: "真人对手",
      participation: "human",
    })) as TestView;
    const humanToken = joined.guestToken!;
    const claim = await claimAgentPairing({
      pairingCode: created.pairing!.pairingCode,
      agent: { name: "Codex E2E", runtime: "deterministic-cli", version: "e2e-1.0", capabilities: AGENT_CAPABILITIES },
    }) as TestView;
    const agentToken = claim.agentToken!;
    const controlEpoch = claim.controlEpoch!;

    const claimedOwnerView = (await getRoom(request(ownerToken), created.room.code)) as TestView;
    const claimedOpponentView = (await getRoom(request(humanToken), created.room.code)) as TestView;
    const agentPlayerId = created.you!.playerId;
    assert.equal(claimedOwnerView.you?.agentDiagnostics?.agentName, "Codex E2E");
    assert.equal(claimedOwnerView.players.find((entry) => entry.id === agentPlayerId)?.agentStatus?.state, "connecting");
    assert.equal(claimedOpponentView.you?.agentDiagnostics, null);
    assert.equal(claimedOpponentView.players.find((entry) => entry.id === agentPlayerId)?.agentStatus?.state, "connecting");
    assert.equal(JSON.stringify(claimedOpponentView).includes("Codex E2E"), false, "the opponent never receives private runtime identity");

    const firstObservation = (await getRoom(request(agentToken), created.room.code)) as TestView;
    assert.equal(firstObservation.you?.authVia, "agent");
    assert.ok(firstObservation.players.find((entry) => entry.id === agentPlayerId)?.hand === undefined);
    const firstHeartbeat = await heartbeatAgent(request(agentToken), {
      room: created.room.code,
      controlEpoch,
      seq: 1,
      observedVersion: firstObservation.room.version,
      decisionId: firstObservation.game?.decisionId ?? null,
      reportedPhase: "observing",
      retryCount: 0,
    });
    assert.equal(firstHeartbeat.ready, false);
    d1.sqlite
      .prepare("UPDATE agent_credentials SET last_heartbeat_at = datetime('now', '-5 seconds') WHERE target_player_id = ? AND revoked_at IS NULL")
      .run(agentPlayerId);
    const continuityObservation = (await getRoom(request(agentToken), created.room.code)) as TestView;
    const ready = await heartbeatAgent(request(agentToken), {
      room: created.room.code,
      controlEpoch,
      seq: 2,
      observedVersion: continuityObservation.room.version,
      decisionId: continuityObservation.game?.decisionId ?? null,
      reportedPhase: "observing",
      retryCount: 0,
    });
    assert.equal(ready.ready, true);
    const readyOwnerView = (await getRoom(request(ownerToken), created.room.code)) as TestView;
    const readyOpponentView = (await getRoom(request(humanToken), created.room.code)) as TestView;
    assert.equal(readyOwnerView.players.find((entry) => entry.id === agentPlayerId)?.agentStatus?.state, "ready");
    assert.equal(readyOpponentView.players.find((entry) => entry.id === agentPlayerId)?.agentStatus?.state, "ready");
    assert.equal(readyOwnerView.room.canStart, true);

    await handleOperation(request(ownerToken), { op: "start", room: created.room.code });
    const [controllerProjection, ownerProjection, opponentProjection] = await Promise.all([
      getRoom(request(agentToken), created.room.code),
      getRoom(request(ownerToken), created.room.code),
      getRoom(request(humanToken), created.room.code),
    ]) as [TestView, TestView, TestView];
    const controllerSelf = controllerProjection.players.find((entry) => entry.id === agentPlayerId)!;
    const ownerSelf = ownerProjection.players.find((entry) => entry.id === agentPlayerId)!;
    assert.deepEqual(controllerProjection.room, ownerProjection.room, "Agent and human owner receive the same public room state");
    assert.deepEqual(controllerSelf, ownerSelf, "the Agent controller receives the same seat-visible player projection as its human owner");
    assert.equal(controllerProjection.you?.agentDiagnostics, null, "controller credentials never receive owner-only runtime diagnostics");
    assert.ok(ownerProjection.you?.agentDiagnostics, "the human owner retains private Agent diagnostics");
    for (const field of ["status", "round", "mode", "winner", "pending", "turnPlayerId", "phase", "deckCount", "discardTop", "deadlineAt", "decisionId", "logs", "ruleset", "engineVersion", "rulesetId"] as const) {
      assert.deepEqual(controllerProjection.game?.[field], ownerProjection.game?.[field], `Agent and human owner see identical gameplay field ${field}`);
    }
    const controllerIsActor = controllerProjection.game?.pending
      ? controllerProjection.game.pending.targetId === agentPlayerId
      : controllerProjection.game?.turnPlayerId === agentPlayerId;
    assert.equal((controllerProjection.game?.legalActions.length ?? 0) > 0, controllerIsActor, "legal actions are projected exactly to the current controller when it is the decision actor");
    assert.equal(ownerProjection.game?.legalActions.length, 0, "the delegated human owner cannot race the Agent controller");
    const opponentCopy = opponentProjection.players.find((entry) => entry.id === agentPlayerId)!;
    assert.equal(opponentCopy.hand, undefined);
    assert.equal(typeof opponentCopy.handCount, "number", "opponents always receive the public hand count");
    assert.equal(typeof opponentCopy.hp, "number", "opponents always receive public current HP");
    assert.equal(typeof opponentCopy.maxHp, "number", "opponents always receive public maximum HP");
    assert.equal(opponentCopy.duelRoster, undefined);
    assert.equal(opponentCopy.duelLineup, undefined);
    let heartbeatSeq = 2;
    let agentAcceptedActions = 0;
    let agentPlayPhaseActions = 0;
    let activeNetworkRecoveryChecked = false;
    const actedSeats = new Set<string>();
    let finished: TestView | null = null;
    for (let step = 0; step < 9_000; step += 1) {
      const projections = await Promise.all([
        getRoom(request(agentToken), created.room.code),
        getRoom(request(humanToken), created.room.code),
      ]) as [TestView, TestView];
      let agentView = projections[0];
      const humanView = projections[1];
      assertPrivateProjection(agentView, [agentToken], [created.pairing!.pairingCode]);
      assert.equal(humanView.players.find((entry) => entry.id === agentPlayerId)?.hand, undefined);
      if (agentView.game?.winner) { finished = agentView; break; }
      const agentActionable = (agentView.game?.legalActions.length ?? 0) > 0;
      const actorView = agentActionable ? agentView : humanView;
      const actorToken = agentActionable ? agentToken : humanToken;
      assert.ok((actorView.game?.legalActions.length ?? 0) > 0, `step ${step} exposes one actionable seat`);
      if (agentActionable) {
        if (!activeNetworkRecoveryChecked) {
          d1.sqlite.prepare(`UPDATE agent_credentials SET last_used_at = datetime('now', '-40 seconds'),
            last_heartbeat_at = datetime('now', '-40 seconds'),
            last_action_attempt_at = datetime('now', '-40 seconds'),
            last_action_accepted_at = datetime('now', '-40 seconds')
            WHERE target_player_id = ? AND revoked_at IS NULL`).run(agentPlayerId);
          const disconnectedOwner = await getRoom(request(ownerToken), created.room.code) as TestView;
          assert.equal(disconnectedOwner.players.find((entry) => entry.id === agentPlayerId)?.agentStatus?.state, "offline", "an active Agent with a lost network is visibly offline");

          agentView = await getRoom(request(agentToken), created.room.code) as TestView;
          heartbeatSeq += 1;
          const recoveredHeartbeat = await heartbeatAgent(request(agentToken), {
            room: created.room.code,
            controlEpoch,
            seq: heartbeatSeq,
            observedVersion: agentView.room.version,
            decisionId: agentView.game!.decisionId,
            reportedPhase: "planning",
            retryCount: 2,
            errorCode: "upstream_network",
          }) as { ready: boolean; health: string };
          assert.equal(recoveredHeartbeat.ready, true);
          const recoveredOwner = await getRoom(request(ownerToken), created.room.code) as TestView;
          assert.notEqual(recoveredOwner.players.find((entry) => entry.id === agentPlayerId)?.agentStatus?.state, "offline", "a fresh observation and heartbeat restore the same credential");
          await rejectsWithCode(heartbeatAgent(request(agentToken), {
            room: created.room.code,
            controlEpoch,
            seq: heartbeatSeq - 1,
            observedVersion: agentView.room.version,
            decisionId: agentView.game!.decisionId,
            reportedPhase: "planning",
          }), "STALE_HEARTBEAT");
          const duplicateHeartbeat = await heartbeatAgent(request(agentToken), {
            room: created.room.code,
            controlEpoch,
            seq: heartbeatSeq,
            observedVersion: agentView.room.version,
            decisionId: agentView.game!.decisionId,
            reportedPhase: "planning",
          }) as { ready: boolean };
          assert.equal(duplicateHeartbeat.ready, true, "an equal-sequence retry is idempotent after an ambiguous ACK");
          activeNetworkRecoveryChecked = true;
        }
        const remaining = new Date(agentView.game!.deadlineAt!).getTime() - Date.now();
        assert.ok(remaining >= (agentView.game!.pending ? 55_000 : 115_000), "Agent receives its server-side decision window");
        heartbeatSeq += 1;
        await heartbeatAgent(request(agentToken), {
          room: created.room.code,
          controlEpoch,
          seq: heartbeatSeq,
          observedVersion: agentView.room.version,
          decisionId: agentView.game!.decisionId,
          reportedPhase: "planning",
          retryCount: 0,
        });
      } else if (humanView.game?.pending) {
        const remaining = new Date(humanView.game.deadlineAt!).getTime() - Date.now();
        assert.ok(remaining <= 40_000, "a human response is not assigned the Agent decision window");
      }
      const privateReason = agentActionable ? `基于当前合法选项执行第 ${step + 1} 次战术行动。` : undefined;
      const result = (await handleOperation(request(actorToken), {
        op: "act",
        room: created.room.code,
        expectedVersion: actorView.room.version,
        requestId: `mixed-duel-${step}`,
        action: chooseAction(actorView.game!.legalActions, Boolean(actorView.game!.pending), actedSeats.size < 2),
        ...(privateReason ? { reason: privateReason } : {}),
      })) as TestView;
      actedSeats.add(actorView.you!.playerId);
      if (agentActionable) {
        assert.equal(result.agentReceipt?.requestId, `mixed-duel-${step}`);
        assert.equal(result.agentReceipt?.actionAccepted, true);
        assert.equal(result.agentReceipt?.reasonAccepted, true);
        agentAcceptedActions += 1;
        if (agentView.game?.phase === "play") agentPlayPhaseActions += 1;
        if (!result.game?.winner) {
          const ownerAfterAction = (await getRoom(request(ownerToken), created.room.code)) as TestView;
          assert.ok(ownerAfterAction.you?.agentDiagnostics?.events.some((event) => event.type === "action_accepted" && event.reason === privateReason));
          const opponentAfterAction = (await getRoom(request(humanToken), created.room.code)) as TestView;
          assert.equal(JSON.stringify(opponentAfterAction).includes(privateReason!), false, "Agent reason is visible only to the seat owner");
        }
      }
      if (result.game?.winner) { finished = result; break; }
    }
    assert.ok(finished, "the mixed Agent/human 1v1 match reaches a winner");
    assert.ok(agentAcceptedActions > 0, "the Agent submits server-accepted decisions");
    assert.ok(agentPlayPhaseActions > 0, "the Agent reaches and acts during a normal play phase");
  });
});

test("concurrent timeout fallback suspends only the repeatedly failing Agent and owner takeover revokes it", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const setup = await setupAgentLobby(d1);
    await handleOperation(request(setup.owners[0]), { op: "start", room: setup.room });
    for (let step = 0; step < 4; step += 1) {
      const views = (await Promise.all(setup.tokens.map((token) => getRoom(request(token), setup.room)))) as TestView[];
      const actorIndex = views.findIndex((view) => (view.game?.legalActions.length ?? 0) > 0);
      assert.ok(actorIndex >= 0);
      const actorView = views[actorIndex];
      if (actorView.game?.turnPlayerId) break;
      await handleOperation(request(setup.tokens[actorIndex]), {
        op: "act",
        room: setup.room,
        expectedVersion: actorView.room.version,
        requestId: `timeout-setup-${step}`,
        action: chooseAction(actorView.game!.legalActions, true, false),
        reason: "完成当前选将或响应步骤，为后续回合建立合法局面。",
      });
    }
    const initial = (await getRoom(request(setup.tokens[0]), setup.room)) as TestView;
    const timedOutPlayerId = initial.game!.pending?.targetId ?? initial.game!.turnPlayerId!;
    const timedOutIndex = setup.pairings.findIndex((entry) => entry.playerId === timedOutPlayerId);
    assert.ok(timedOutIndex >= 0);

    const setCurrentDeadline = (offsetMs: number) => {
      const row = d1.sqlite
        .prepare("SELECT state_json FROM rooms WHERE code = ?")
        .get(setup.room) as { state_json: string };
      const state = JSON.parse(row.state_json) as { deadlineAt: string };
      state.deadlineAt = new Date(Date.now() + offsetMs).toISOString();
      d1.sqlite.prepare("UPDATE rooms SET state_json = ? WHERE code = ?").run(JSON.stringify(state), setup.room);
    };

    setCurrentDeadline(10_000);
    const planningView = (await getRoom(request(setup.tokens[timedOutIndex]), setup.room)) as TestView;
    const grace = await heartbeatAgent(request(setup.tokens[timedOutIndex]), {
      room: setup.room,
      controlEpoch: setup.epochs[timedOutIndex],
      seq: setup.sequences[timedOutIndex] + 1,
      observedVersion: planningView.room.version,
      decisionId: planningView.game!.decisionId,
      reportedPhase: "planning",
    }) as { deadlineExtended: boolean; deadlineAt: string; planningGraceMs: number };
    assert.equal(grace.deadlineExtended, true);
    assert.equal(grace.planningGraceMs, 30_000);
    assert.ok(new Date(grace.deadlineAt).getTime() - Date.now() > 35_000);
    const repeatedGrace = await heartbeatAgent(request(setup.tokens[timedOutIndex]), {
      room: setup.room,
      controlEpoch: setup.epochs[timedOutIndex],
      seq: setup.sequences[timedOutIndex] + 2,
      observedVersion: planningView.room.version,
      decisionId: planningView.game!.decisionId,
      reportedPhase: "planning",
    }) as { deadlineExtended: boolean };
    assert.equal(repeatedGrace.deadlineExtended, false, "the same decision receives planning grace only once");

    setCurrentDeadline(-1_000);
    const beforeFirst = ((await getRoom(request(setup.tokens[0]), setup.room)) as TestView).room.version;
    await Promise.allSettled(
      setup.tokens.map((token) => handleOperation(request(token), { op: "tick", room: setup.room })),
    );
    const afterFirst = (await getRoom(request(setup.owners[timedOutIndex]), setup.room)) as TestView;
    assert.equal(afterFirst.room.version, beforeFirst + 1, "concurrent ticks apply the timeout exactly once");
    assert.equal(afterFirst.you?.agentDiagnostics?.consecutiveTimeouts, 1);

    setCurrentDeadline(-1_000);
    const repeatableTimedOutState = (d1.sqlite
      .prepare("SELECT state_json FROM rooms WHERE code = ?")
      .get(setup.room) as { state_json: string }).state_json;
    const beforeSecond = afterFirst.room.version;
    await Promise.allSettled(
      setup.tokens.map((token) => handleOperation(request(token), { op: "tick", room: setup.room })),
    );
    const afterSecond = (await getRoom(request(setup.owners[timedOutIndex]), setup.room)) as TestView;
    assert.equal(afterSecond.room.version, beforeSecond + 1);
    assert.equal(afterSecond.you?.agentDiagnostics?.consecutiveTimeouts, 2);
    assert.notEqual(afterSecond.you?.agentDiagnostics?.state, "safe_mode");

    d1.sqlite.prepare("UPDATE rooms SET state_json = ? WHERE code = ?").run(repeatableTimedOutState, setup.room);
    const beforeThird = afterSecond.room.version;
    await Promise.allSettled(
      setup.tokens.map((token) => handleOperation(request(token), { op: "tick", room: setup.room })),
    );
    const afterThird = (await getRoom(request(setup.owners[timedOutIndex]), setup.room)) as TestView;
    assert.equal(afterThird.room.version, beforeThird + 1);
    assert.equal(afterThird.you?.agentDiagnostics?.consecutiveTimeouts, 3);
    assert.equal(afterThird.you?.agentDiagnostics?.state, "safe_mode");
    assert.equal(
      afterThird.players.find((entry) => entry.id === timedOutPlayerId)?.agentStatus?.state,
      "safe_mode",
    );
    assert.ok(afterThird.you?.agentDiagnostics?.events.some((event) => event.type === "suspended"));

    await rejectsWithCode(
      handleOperation(request(setup.tokens[timedOutIndex]), {
        op: "act",
        room: setup.room,
        expectedVersion: afterThird.room.version,
        requestId: "suspended-action",
        action: { type: "endTurn" },
        reason: "当前凭证已暂停，尝试结束回合用于验证服务器拒绝逻辑。",
      }),
      "AGENT_SUSPENDED",
    );
    await handleOperation(request(setup.owners[timedOutIndex]), { op: "revokeAgent", room: setup.room });
    await rejectsWithCode(getRoom(request(setup.tokens[timedOutIndex]), setup.room), "TOKEN_INVALID");
    await rejectsWithCode(
      heartbeatAgent(request(setup.tokens[timedOutIndex]), {
        room: setup.room,
        controlEpoch: setup.epochs[timedOutIndex],
        seq: setup.sequences[timedOutIndex] + 1,
        observedVersion: afterThird.room.version,
        reportedPhase: "idle",
      }),
      "TOKEN_INVALID",
    );
  });
});
