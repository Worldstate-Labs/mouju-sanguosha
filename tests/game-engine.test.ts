import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameAction,
  applyTimeout,
  createGame,
  getLegalActions,
  type GameAction,
  type GameState,
  type LegalAction,
  type LobbySeat,
} from "../lib/game-v1.ts";

function seats(count: number): LobbySeat[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `玩家${index + 1}`,
    kind: index % 2 ? "agent" : "human",
    seat: index,
  }));
}

function cardIds(state: GameState) {
  return [
    ...state.deck.map((card) => card.id),
    ...state.discard.map((card) => card.id),
    ...state.players.flatMap((entry) => [
      ...entry.hand.map((card) => card.id),
      ...(entry.weapon ? [entry.weapon.id] : []),
    ]),
  ];
}

function assertCardInvariant(state: GameState, total: number) {
  const ids = cardIds(state);
  assert.equal(ids.length, total, "every card remains in exactly one zone");
  assert.equal(new Set(ids).size, total, "card IDs never duplicate");
}

function choose(action: LegalAction): GameAction {
  if (action.kind === "exact") return action.action!;
  if (action.kind === "discard") {
    return { type: "discard", cardIds: action.candidateCardIds!.slice(0, action.minCards) };
  }
  return {
    type: "skill",
    skill: action.skill!,
    cardIds: action.candidateCardIds!.slice(0, action.minCards),
    targetId: action.targetIds?.[0],
  };
}

function aggressiveAction(actions: LegalAction[], pending: boolean) {
  let selected: LegalAction | undefined;
  if (pending) {
    selected = actions.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass");
    selected ??= actions.find((entry) => entry.kind === "exact");
  } else {
    selected = actions.find(
      (entry) =>
        entry.kind === "exact" &&
        ["【杀】", "【决斗】", "【南蛮入侵】", "【万箭齐发】"].some((name) => entry.label.includes(name)),
    );
    selected ??= actions.find((entry) => entry.kind === "discard");
    selected ??= actions.find((entry) => entry.kind === "exact" && entry.action?.type === "endTurn");
    selected ??= actions.find((entry) => entry.kind === "exact" && !entry.label.includes("【桃】"));
    selected ??= actions[0];
  }
  assert.ok(selected, "the prompted player always has a legal action");
  return choose(selected);
}

test("identity mode creates a valid, secret-ready canonical state", () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8]) {
    const state = createGame(seats(count));
    assert.equal(state.players.length, count);
    assert.equal(state.players.filter((entry) => entry.role === "lord").length, 1);
    assert.equal(state.players.find((entry) => entry.role === "lord")?.maxHp,
      (state.players.find((entry) => entry.role === "lord")?.character.maxHp ?? 0) + 1);
    assert.ok(state.players.every((entry) => entry.hand.length === 4 || entry.id === state.turn?.playerId));
    const total = cardIds(state).length;
    assertCardInvariant(state, total);
  }
});

test("out-of-turn and fabricated-card actions are rejected", () => {
  const state = createGame(seats(2));
  const current = state.turn!.playerId;
  const other = state.players.find((entry) => entry.id !== current)!.id;
  assert.throws(() => applyGameAction(state, other, { type: "endTurn" }), /不是你的回合/);
  assert.throws(
    () => applyGameAction(state, current, { type: "playCard", cardId: "fabricated", targetId: other }),
    /不在你的手牌/,
  );
});

test("an expired prompt advances with a safe default action", () => {
  const state = createGame(seats(2));
  const actor = state.turn!.playerId;
  const beforeRound = state.round;
  state.deadlineAt = new Date(Date.now() - 1_000).toISOString();
  let next = applyTimeout(state);
  if (next.turn?.playerId === actor) {
    next.deadlineAt = new Date(Date.now() - 1_000).toISOString();
    next = applyTimeout(next);
  }
  assert.notEqual(next.turn?.playerId, actor);
  assert.ok(next.round >= beforeRound);
  assert.ok(next.logs.some((entry) => entry.text.includes("行动超时")));
  assert.ok(next.deadlineAt && new Date(next.deadlineAt).getTime() > Date.now());
});

test("a turn owner killed during a duel hands the turn to the next living seat", () => {
  const state = createGame(seats(4));
  const [lord, loyalist, rebel, renegade] = state.players;
  lord.role = "lord";
  loyalist.role = "loyalist";
  rebel.role = "rebel";
  renegade.role = "renegade";
  rebel.character = {
    id: "duel-regression-general",
    name: "回归武将",
    title: "确定性测试",
    kingdom: "shu",
    gender: "male",
    maxHp: 4,
    skill: "paoxiao",
    skillName: "咆哮",
    skillText: "出牌阶段使用【杀】无次数限制。",
  };
  rebel.hp = 1;
  for (const participant of state.players) {
    state.discard.push(...participant.hand.filter((card) => card.name === "桃"));
    participant.hand = participant.hand.filter((card) => card.name !== "桃");
  }
  state.turn = {
    playerId: rebel.id,
    phase: "play",
    shaUsed: 0,
    drunk: false,
    skillUsed: [],
    counters: {},
  };
  state.pending = {
    kind: "duel",
    sourceId: rebel.id,
    targetId: rebel.id,
    opponentId: lord.id,
    required: "杀",
    remaining: 1,
    sourceCardId: "duel-regression",
    damage: 1,
  };

  const next = applyGameAction(state, rebel.id, { type: "pass" });
  assert.equal(next.status, "playing");
  assert.equal(next.players.find((entry) => entry.id === rebel.id)?.alive, false);
  assert.equal(next.turn?.playerId, renegade.id, "the next living seat receives the turn");
  assert.ok(getLegalActions(next, renegade.id).length > 0);
});

test("many autonomous two-player games preserve cards and reach a winner", () => {
  for (let match = 0; match < 12; match += 1) {
    let state = createGame(seats(2));
    const totalCards = cardIds(state).length;
    let steps = 0;
    while (state.status !== "finished" && steps < 700) {
      const actorId = state.pending?.targetId ?? state.turn!.playerId;
      const actions = getLegalActions(state, actorId);
      assert.ok(actions.length > 0, `match ${match} step ${steps} has a legal action`);
      state = applyGameAction(state, actorId, aggressiveAction(actions, Boolean(state.pending)));
      assertCardInvariant(state, totalCards);
      steps += 1;
    }
    assert.equal(state.status, "finished", `match ${match} finishes before the safety bound`);
    assert.ok(state.winner?.playerIds.length);
  }
});
