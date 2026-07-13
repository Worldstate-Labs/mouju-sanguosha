import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runWithBindings } from "../lib/runtime-env.ts";
import { ApiError, claimAgentPairing, getRoom, handleOperation } from "../lib/store.ts";

const AGENT_CAPABILITIES = ["deterministic-cli-v1", "detached-daemon-v1", "command-fallback-v1", "view-parity-v1", "independent-heartbeat-v1", "action-reason-v1", "decision-loop-lease-v1"];

interface TestResult {
  players: Array<{ id: string; agentStatus?: { state: string; label: string } }>;
  room: { code: string; status: string };
  you: { playerId: string; controlMode: string; controlEpoch: number; authVia?: string };
  pairing: {
    pairingCode: string;
    playerId: string;
    mode: string;
  };
  guestToken: string;
  agentToken: string;
  controlEpoch: number;
}

class MockStatement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(database: DatabaseSync, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

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

function request(token?: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers(extraHeaders);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://game.example/api/game", { headers });
}

async function rejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof ApiError && error.code === code,
  );
}

test("participants atomically choose and control only their own Agent seat", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const created = (await handleOperation(request(), {
      op: "create",
      name: "主公",
      maxPlayers: 3,
      participation: "agent",
    })) as TestResult;
    assert.equal(created.players.length, 1);
    assert.equal(created.you.controlMode, "pairing");
    assert.equal(created.you.controlEpoch, 1);
    assert.equal(created.pairing.mode, "delegate");
    assert.equal(created.pairing.playerId, created.you.playerId);

    const room = created.room.code as string;
    const hostToken = created.guestToken as string;
    await handleOperation(request(), { op: "join", room, name: "忠臣", participation: "human" });
    await handleOperation(request(), { op: "join", room, name: "反贼", participation: "human" });
    await handleOperation(request(), { op: "join", room, name: "内奸", participation: "human" });
    await rejectsWithCode(handleOperation(request(hostToken), { op: "start", room }), "AGENT_PAIRING_PENDING");
    await rejectsWithCode(handleOperation(request(hostToken), { op: "addAgent", room }), "UNKNOWN_OPERATION");

    await rejectsWithCode(
      claimAgentPairing({ pairingCode: created.pairing.pairingCode, agent: { name: "旧脚本", runtime: "codex" } }),
      "AGENT_CAPABILITIES_REQUIRED",
    );
    const firstClaim = (await claimAgentPairing({
      pairingCode: created.pairing.pairingCode,
      agent: { name: "Codex", runtime: "deterministic-cli", capabilities: AGENT_CAPABILITIES },
    })) as TestResult;
    assert.equal(firstClaim.controlEpoch, 2);
    d1.sqlite
      .prepare("UPDATE agent_credentials SET created_at = datetime('now', '-121 seconds') WHERE target_player_id = ? AND revoked_at IS NULL")
      .run(created.you.playerId);
    const stalledClaim = (await getRoom(request(hostToken), room)) as TestResult;
    assert.equal(stalledClaim.players.find((entry) => entry.id === created.you.playerId)?.agentStatus?.state, "offline");
    assert.equal(stalledClaim.players.find((entry) => entry.id === created.you.playerId)?.agentStatus?.label, "CLI 接入超时");
    d1.sqlite
      .prepare("UPDATE agent_credentials SET created_at = CURRENT_TIMESTAMP WHERE target_player_id = ? AND revoked_at IS NULL")
      .run(created.you.playerId);
    assert.equal(((await getRoom(request(firstClaim.agentToken), room)) as TestResult).you.authVia, "agent");

    const replaced = (await handleOperation(request(hostToken), {
      op: "createAgentPairing",
      room,
    })) as TestResult;
    assert.equal(replaced.you.controlMode, "pairing");
    assert.equal(replaced.you.controlEpoch, 3);
    await rejectsWithCode(getRoom(request(firstClaim.agentToken), room), "TOKEN_INVALID");

    const secondClaim = (await claimAgentPairing({ pairingCode: replaced.pairing.pairingCode, agent: { capabilities: AGENT_CAPABILITIES } })) as TestResult;
    assert.equal(secondClaim.controlEpoch, 4);
    const takenBack = (await handleOperation(request(hostToken), { op: "revokeAgent", room })) as TestResult;
    assert.equal(takenBack.you.controlMode, "human");
    assert.equal(takenBack.you.controlEpoch, 5);
    await rejectsWithCode(getRoom(request(secondClaim.agentToken), room), "TOKEN_INVALID");
    assert.equal(
      ((await handleOperation(request(hostToken), { op: "start", room })) as TestResult).room.status,
      "playing",
    );

    const joinRoom = (await handleOperation(request(), {
      op: "create",
      name: "房主二",
      maxPlayers: 4,
    })) as TestResult;
    const joinedAsAgent = (await handleOperation(request(), {
      op: "join",
      room: joinRoom.room.code,
      name: "反贼",
      participation: "agent",
    })) as TestResult;
    assert.equal(joinedAsAgent.players.length, 2);
    assert.equal(joinedAsAgent.you.controlMode, "pairing");
    assert.equal(joinedAsAgent.pairing.playerId, joinedAsAgent.you.playerId);
    await handleOperation(request(), { op: "join", room: joinRoom.room.code, name: "桌友三" });
    await handleOperation(request(), { op: "join", room: joinRoom.room.code, name: "桌友四" });
    await rejectsWithCode(
      handleOperation(request(joinRoom.guestToken), { op: "start", room: joinRoom.room.code }),
      "AGENT_PAIRING_PENDING",
    );

    const accountRequest = () => request(undefined, { "oai-authenticated-user-email": "owner@example.com" });
    const accountRoom = (await handleOperation(accountRequest(), {
      op: "create",
      name: "账号玩家",
      maxPlayers: 2,
    })) as TestResult;
    const restoredAsAgent = (await handleOperation(accountRequest(), {
      op: "join",
      room: accountRoom.room.code,
      participation: "agent",
    })) as TestResult;
    assert.equal(restoredAsAgent.players.length, 1);
    assert.equal(restoredAsAgent.you.controlMode, "pairing");
    assert.equal(restoredAsAgent.pairing.playerId, restoredAsAgent.you.playerId);
    const restoredAsHuman = (await handleOperation(accountRequest(), {
      op: "join",
      room: accountRoom.room.code,
      participation: "human",
    })) as TestResult;
    assert.equal(restoredAsHuman.players.length, 1);
    assert.equal(restoredAsHuman.you.controlMode, "human");
    await rejectsWithCode(
      claimAgentPairing({ pairingCode: restoredAsAgent.pairing.pairingCode }),
      "PAIRING_EXPIRED",
    );
  });
});

test("participants can leave a lobby, transfer host, and reconnect to a retained playing seat", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const solo = (await handleOperation(request(), {
      op: "create",
      name: "唯一房主",
      maxPlayers: 2,
    })) as TestResult;
    const soloLeft = await handleOperation(request(solo.guestToken), {
      op: "leaveRoom",
      room: solo.room.code,
    }) as { seatRetained: boolean; closed: boolean };
    assert.equal(soloLeft.seatRetained, false);
    assert.equal(soloLeft.closed, true);
    await rejectsWithCode(getRoom(request(solo.guestToken), solo.room.code), "ROOM_NOT_FOUND");

    const created = (await handleOperation(request(), {
      op: "create",
      name: "原房主",
      maxPlayers: 4,
    })) as TestResult;
    const hostToken = created.guestToken;
    const room = created.room.code;
    const joined = (await handleOperation(request(), {
      op: "join",
      room,
      name: "接任房主",
    })) as TestResult;
    const joinedToken = joined.guestToken;
    const joinedId = joined.you.playerId;

    assert.equal(((await getRoom(request(joinedToken), room)) as TestResult).you.playerId, joinedId);
    const hostLeft = await handleOperation(request(hostToken), { op: "leaveRoom", room }) as {
      seatRetained: boolean;
      transferredHostTo: { playerId: string; name: string } | null;
    };
    assert.equal(hostLeft.seatRetained, false);
    assert.equal(hostLeft.transferredHostTo?.playerId, joinedId);
    await rejectsWithCode(getRoom(request(hostToken), room), "TOKEN_INVALID");
    const transferredView = await getRoom(request(joinedToken), room) as TestResult & { room: { hostPlayerId: string } };
    assert.equal(transferredView.room.hostPlayerId, joinedId);

    const duel = (await handleOperation(request(), {
      op: "create",
      name: "甲",
      maxPlayers: 2,
    })) as TestResult;
    const duelHostToken = duel.guestToken;
    const duelJoin = (await handleOperation(request(), {
      op: "join",
      room: duel.room.code,
      name: "乙",
    })) as TestResult;
    const duelGuestToken = duelJoin.guestToken;
    const duelGuestId = duelJoin.you.playerId;
    await handleOperation(request(duelHostToken), { op: "start", room: duel.room.code });

    const detached = await handleOperation(request(duelGuestToken), { op: "leaveRoom", room: duel.room.code }) as { seatRetained: boolean };
    assert.equal(detached.seatRetained, true);
    const hostViewWhileGuestAway = await getRoom(request(duelHostToken), duel.room.code) as TestResult & { players: Array<{ id: string; connected: boolean }> };
    assert.equal(hostViewWhileGuestAway.players.find((entry) => entry.id === duelGuestId)?.connected, false);
    const restored = await getRoom(request(duelGuestToken), duel.room.code) as TestResult & { players: Array<{ id: string; connected: boolean }> };
    assert.equal(restored.you.playerId, duelGuestId);
    assert.equal(restored.players.find((entry) => entry.id === duelGuestId)?.connected, true);
  });
});

test("many rooms remain isolated and a contested final seat is claimed atomically", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const created = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        handleOperation(request(), {
          op: "create",
          name: `并发房主${index + 1}`,
          maxPlayers: 2,
        }) as Promise<TestResult>,
      ),
    );
    assert.equal(new Set(created.map((entry) => entry.room.code)).size, created.length, "room codes stay unique under concurrency");

    const contested = created[0];
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        handleOperation(request(), {
          op: "join",
          room: contested.room.code,
          name: `抢位玩家${index + 1}`,
        }),
      ),
    );
    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1, "only one contender may claim the final seat");
    assert.equal(
      d1.sqlite.prepare("SELECT COUNT(*) AS count FROM room_players WHERE room_code = ?").get(contested.room.code)?.count,
      2,
      "failed contenders never leave orphan seats",
    );

    const second = created[1];
    const secondGuest = await handleOperation(request(), {
      op: "join",
      room: second.room.code,
      name: "隔离验证玩家",
    }) as TestResult;
    await rejectsWithCode(getRoom(request(contested.guestToken), second.room.code), "TOKEN_INVALID");
    await rejectsWithCode(getRoom(request(secondGuest.guestToken), contested.room.code), "TOKEN_INVALID");

    const untouchedVersion = secondGuest.room.version;
    const contestedStarted = await handleOperation(request(contested.guestToken), {
      op: "start",
      room: contested.room.code,
    }) as TestResult;
    assert.equal(contestedStarted.room.status, "playing");
    const untouched = await getRoom(request(secondGuest.guestToken), second.room.code) as TestResult;
    assert.equal(untouched.room.status, "lobby");
    assert.equal(untouched.room.version, untouchedVersion, "another room's transition never changes this room's version");

    await handleOperation(request(secondGuest.guestToken), { op: "leaveRoom", room: second.room.code });
    const secondAfterLeave = await getRoom(request(second.guestToken), second.room.code) as TestResult;
    assert.equal(secondAfterLeave.players.length, 1);
    assert.equal(
      (await getRoom(request(contested.guestToken), contested.room.code) as TestResult).players.length,
      2,
      "leaving one room cannot remove a same-named or same-seat-index player elsewhere",
    );
  });
});

test("host can keep the table for a rematch while every Agent grant is revoked", async () => {
  const d1 = new MockD1();
  await runWithBindings({ DB: d1 as never }, async () => {
    const created = (await handleOperation(request(), {
      op: "create",
      name: "房主",
      maxPlayers: 2,
    })) as TestResult;
    const guest = (await handleOperation(request(), {
      op: "join",
      room: created.room.code,
      name: "Agent 玩家",
      participation: "agent",
    })) as TestResult;
    const claimed = (await claimAgentPairing({
      pairingCode: guest.pairing.pairingCode,
      agent: { name: "Codex", runtime: "deterministic-cli", capabilities: AGENT_CAPABILITIES },
    })) as TestResult;

    d1.sqlite.prepare("UPDATE rooms SET status = 'finished', state_json = '{}' WHERE code = ?").run(created.room.code);
    await rejectsWithCode(
      handleOperation(request(guest.guestToken), { op: "rematch", room: created.room.code }),
      "HOST_ONLY",
    );

    const rematch = await handleOperation(request(created.guestToken), {
      op: "rematch",
      room: created.room.code,
    }) as TestResult;
    assert.equal(rematch.room.status, "lobby");
    assert.equal(rematch.players.length, 2);
    assert.equal(rematch.you.controlMode, "human");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_credentials WHERE room_code = ?").get(created.room.code)?.count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_pairings WHERE room_code = ?").get(created.room.code)?.count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM room_players WHERE room_code = ? AND control_mode != 'human'").get(created.room.code)?.count, 0);
    await rejectsWithCode(getRoom(request(claimed.agentToken), created.room.code), "TOKEN_INVALID");
  });
});
