import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  applyTimeoutV2,
  assertGameInvariantV2,
  attackRangeV2,
  createGameV2,
  distanceV2,
  gameV2TestHooks,
  getLegalActionsV2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import type { LobbySeat } from "../lib/game-v2-data.ts";

const seats = (count = 4): LobbySeat[] => Array.from({ length: count }, (_, seat) => ({
  id: `branch-${count}-${seat}`,
  name: `分支玩家${seat + 1}`,
  kind: "human",
  seat,
}));

function materialize(option: LegalActionV2): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  if (option.kind === "discard") {
    return { type: "discard", cardIds: option.candidateCardIds!.slice(0, option.minCards) };
  }
  return {
    type: "skill",
    skill: option.skill,
    cardIds: option.candidateCardIds?.slice(0, option.minCards),
    targetIds: option.targetIds?.slice(0, option.minTargets),
  };
}

function playing(seed = 710001, count = 4) {
  let state = createGameV2(seats(count), { seed });
  for (let step = 0; state.status === "setup" && step < 300; step += 1) {
    const actorId = state.pending!.actorId;
    const legal = getLegalActionsV2(state, actorId);
    state = applyGameActionV2(state, actorId, materialize(legal.find((entry) => entry.action?.type !== "pass") ?? legal[0]));
  }
  assert.equal(state.status, "playing");
  return state;
}

function expectInvariant(state: GameStateV2, pattern: RegExp) {
  assert.throws(() => assertGameInvariantV2(state), pattern);
}

test("engine input guards and compatibility defaults execute both sides", () => {
  const system = createGameV2(seats(), {}, undefined);
  assert.equal(system.rngMode, "system-v1");
  const explicitSystem = createGameV2(seats(), { seed: 0, rngMode: "system-v1" });
  assert.equal(explicitSystem.rngMode, "system-v1");
  const zeroLegacy = createGameV2(seats(), { seed: 0 });
  assert.equal(zeroLegacy.rngMode, "xorshift32-legacy");
  assert.notEqual(zeroLegacy.rngState, 0);

  const state = playing();
  const first = state.players[0];
  const second = state.players[1];
  assert.equal(distanceV2(state, first.id, first.id), 1);
  const dead = structuredClone(state);
  dead.players.find((entry) => entry.id === second.id)!.alive = false;
  assert.equal(distanceV2(dead, first.id, second.id), Number.POSITIVE_INFINITY);
  assert.throws(() => distanceV2(state, "missing", second.id), /角色不存在/);
  assert.throws(() => distanceV2(state, first.id, "missing"), /角色不存在/);

  const unknownWeapon = structuredClone(first);
  unknownWeapon.equipment.weapon = {
    ...state.deck[0],
    id: "unknown-weapon",
    name: "不存在的武器" as never,
    slot: "weapon",
  };
  assert.equal(attackRangeV2(unknownWeapon), 1);
  unknownWeapon.equipment.weapon = null;
  assert.equal(attackRangeV2(unknownWeapon), 1);
});

test("legal-action gates execute finished, dead, waiting, setup, and wrong-turn behavior", () => {
  const state = playing(710002);
  const actorId = state.turn!.playerId;
  const other = state.players.find((entry) => entry.id !== actorId)!.id;

  const finished = structuredClone(state);
  finished.status = "finished";
  assert.deepEqual(getLegalActionsV2(finished, actorId), []);

  const dead = structuredClone(state);
  dead.players.find((entry) => entry.id === actorId)!.alive = false;
  assert.deepEqual(getLegalActionsV2(dead, actorId), []);
  assert.deepEqual(getLegalActionsV2(state, "missing"), []);
  assert.deepEqual(getLegalActionsV2(state, other), []);

  const waiting = structuredClone(state);
  waiting.pending = {
    id: "branch-wait",
    kind: "optionalSkill",
    actorId,
    prompt: "等待",
    data: { skill: "biyue" },
  };
  assert.deepEqual(getLegalActionsV2(waiting, other), []);

  const setup = createGameV2(seats(), { seed: 710003 });
  assert.deepEqual(getLegalActionsV2(setup, setup.players.find((entry) => entry.id !== setup.pending!.actorId)!.id), []);

  assert.throws(() => applyGameActionV2(finished, actorId, { type: "pass" }), /对局已经结束/);
  assert.throws(() => applyGameActionV2(state, "missing", { type: "pass" }), /角色不存在/);
  assert.throws(() => applyGameActionV2(dead, actorId, { type: "pass" }), /已阵亡角色不能行动/);

  const stale = structuredClone(waiting);
  assert.throws(
    () => applyGameActionV2(stale, actorId, { type: "pass", decisionId: "older-decision" }),
    /决策已经变化/,
  );
});

test("timeout selection executes every safe-default tier including skill and no-action rejection", () => {
  const state = playing(710004);
  assert.throws(() => applyTimeoutV2(state, { nowMs: 0 }), /尚未超时/);

  const noActor = structuredClone(state);
  noActor.turn = null;
  noActor.pending = null;
  noActor.deadlineAt = new Date(1).toISOString();
  assert.throws(() => applyTimeoutV2(noActor, { nowMs: 2 }), /没有等待中的决策/);

  const noAction = structuredClone(state);
  noAction.pending = {
    id: "unknown-timeout",
    kind: "unknown" as never,
    actorId: state.players[0].id,
    prompt: "未知",
    data: {},
  };
  noAction.deadlineAt = new Date(1).toISOString();
  assert.throws(() => applyTimeoutV2(noAction, { nowMs: 2 }), /没有安全默认动作/);

  const yiji = structuredClone(state);
  const actor = yiji.players[0];
  const card = yiji.deck.pop()!;
  yiji.revealed.push(card);
  yiji.pending = {
    id: "timeout-yiji",
    kind: "yijiAssign",
    actorId: actor.id,
    prompt: "遗计",
    data: { cardIds: [card.id], remaining: 1 },
  };
  yiji.deadlineAt = new Date(1).toISOString();
  const timed = applyTimeoutV2(yiji, { nowMs: 2 });
  assert.notEqual(timed.pending?.id, "timeout-yiji");
  assertGameInvariantV2(timed);
});

test("all invariant rejection branches and legal dying exceptions execute", () => {
  const setup = createGameV2(seats(), { seed: 710005 });

  const missingCard = structuredClone(setup);
  missingCard.deck.pop();
  expectInvariant(missingCard, /牌张守恒失败/);

  const duplicateCard = structuredClone(setup);
  duplicateCard.deck[0] = structuredClone(duplicateCard.deck[1]);
  expectInvariant(duplicateCard, /实体牌出现在多个区域/);

  const badCount = structuredClone(setup);
  badCount.players.pop();
  expectInvariant(badCount, /玩家数量/);

  const duplicateId = structuredClone(setup);
  duplicateId.players[1].id = duplicateId.players[0].id;
  expectInvariant(duplicateId, /玩家 ID 重复/);

  const duplicateSeat = structuredClone(setup);
  duplicateSeat.players[1].seat = duplicateSeat.players[0].seat;
  expectInvariant(duplicateSeat, /玩家座位重复/);

  const prematureHp = structuredClone(setup);
  prematureHp.players[0].hp = 1;
  expectInvariant(prematureHp, /尚未选将却已有体力/);

  const state = playing(710006);
  const actor = state.players[0];

  const nonInteger = structuredClone(state);
  nonInteger.players[0].hp = 1.5;
  expectInvariant(nonInteger, /体力数据无效/);

  const noMax = structuredClone(state);
  noMax.players[0].maxHp = 0;
  expectInvariant(noMax, /体力数据无效/);

  const tooHigh = structuredClone(state);
  tooHigh.players[0].hp = tooHigh.players[0].maxHp + 1;
  expectInvariant(tooHigh, /体力越界/);

  const negative = structuredClone(state);
  negative.players[0].hp = -1;
  expectInvariant(negative, /体力越界/);

  const aliveMismatch = structuredClone(state);
  aliveMismatch.players[0].alive = false;
  expectInvariant(aliveMismatch, /存活状态与体力不一致/);

  const deadMismatch = structuredClone(state);
  deadMismatch.players[0].hp = 0;
  expectInvariant(deadMismatch, /存活状态与体力不一致/);

  const pendingDying = structuredClone(state);
  pendingDying.players[0].hp = -1;
  pendingDying.pending = {
    id: "dying-pending",
    kind: "rescue",
    actorId: pendingDying.players[1].id,
    prompt: "求桃",
    data: { targetId: actor.id },
  };
  assert.doesNotThrow(() => assertGameInvariantV2(pendingDying));

  const stackDying = structuredClone(state);
  stackDying.players[0].hp = -1;
  stackDying.stack.push({ id: "dying-frame", kind: "dying", data: { targetId: actor.id } });
  assert.doesNotThrow(() => assertGameInvariantV2(stackDying));

  const invalidPending = structuredClone(state);
  invalidPending.pending = {
    id: "dead-pending",
    kind: "optionalSkill",
    actorId: invalidPending.players[0].id,
    prompt: "无效",
    data: { skill: "biyue" },
  };
  invalidPending.players[0].alive = false;
  invalidPending.players[0].hp = 0;
  expectInvariant(invalidPending, /决策对象无效/);

  const noTurn = structuredClone(state);
  noTurn.turn = null;
  expectInvariant(noTurn, /缺少回合/);

  const prematureWinner = structuredClone(state);
  prematureWinner.winner = { side: "lord", label: "错误胜者", playerIds: [actor.id] };
  expectInvariant(prematureWinner, /不应已有胜者/);

  const deadTurn = structuredClone(state);
  deadTurn.players.find((entry) => entry.id === deadTurn.turn!.playerId)!.alive = false;
  deadTurn.players.find((entry) => entry.id === deadTurn.turn!.playerId)!.hp = 0;
  expectInvariant(deadTurn, /当前回合指向无效/);
  deadTurn.turnTerminated = true;
  assert.doesNotThrow(() => assertGameInvariantV2(deadTurn));
  deadTurn.turnTerminated = false;
  deadTurn.duelTurnTerminated = true;
  assert.doesNotThrow(() => assertGameInvariantV2(deadTurn));

  const finished = structuredClone(state);
  finished.status = "finished";
  finished.turn = null;
  finished.pending = null;
  finished.stack = [];
  finished.winner = null;
  expectInvariant(finished, /缺少胜者/);

  finished.winner = { side: "lord", label: "主公胜利", playerIds: [actor.id] };
  finished.turn = structuredClone(state.turn);
  expectInvariant(finished, /仍残留回合/);

  finished.turn = null;
  finished.processing.push(finished.deck.pop()!);
  expectInvariant(finished, /仍残留临时牌区/);
});

test("internal primitives execute corrupt-input and empty-state defenses", () => {
  const state = playing(710007);
  assert.throws(() => gameV2TestHooks.characterById("missing"), /武将不存在/);
  assert.throws(() => gameV2TestHooks.randomInt(state, 0), /随机范围无效/);

  const allDead = structuredClone(state);
  for (const target of allDead.players) {
    target.alive = false;
    target.hp = 0;
  }
  assert.deepEqual(gameV2TestHooks.actionOrder(allDead, "missing"), []);
  assert.deepEqual(gameV2TestHooks.actionOrder(state, "missing"), state.players.filter((entry) => entry.alive));

  const oneAlive = structuredClone(state);
  const currentId = oneAlive.turn!.playerId;
  for (const target of oneAlive.players) {
    if (target.id !== currentId) {
      target.alive = false;
      target.hp = 0;
    }
  }
  assert.equal(gameV2TestHooks.nextAlive(oneAlive, currentId), null);
  const beforeTurn = structuredClone(oneAlive.turn);
  gameV2TestHooks.endTurn(oneAlive);
  assert.deepEqual(oneAlive.turn, beforeTurn);

  assert.equal(gameV2TestHooks.removeCard([], "missing"), null);
  assert.equal(gameV2TestHooks.removeOwnedCard(state.players[0], "missing"), null);
  assert.throws(
    () => gameV2TestHooks.removeOwnedCardsTracked(state, state.players[0], ["missing"]),
    /所选牌已不在/,
  );

  const finished = structuredClone(state);
  finished.status = "finished";
  gameV2TestHooks.stampDeadline(finished, { nowMs: 10 });
  assert.equal(finished.deadlineAt, null);
  const pending = structuredClone(state);
  pending.pending = { id: "pending", kind: "optionalSkill", actorId: pending.players[0].id, prompt: "等待", data: {} };
  gameV2TestHooks.stampDeadline(pending, { nowMs: 10 });
  assert.equal(pending.deadlineAt, new Date(35_010).toISOString());
  const play = structuredClone(state);
  play.pending = null;
  play.turn!.phase = "play";
  gameV2TestHooks.stampDeadline(play, { nowMs: 10 });
  assert.equal(play.deadlineAt, new Date(75_010).toISOString());
  play.turn!.phase = "draw";
  gameV2TestHooks.stampDeadline(play, { nowMs: 10 });
  assert.equal(play.deadlineAt, new Date(35_010).toISOString());
});

test("duel setup defenses execute missing progress, invalid order, and invalid choices", () => {
  const base = createGameV2(seats(2), { seed: 710008 });
  const chooser = base.players.find((entry) => entry.id === base.setup!.duel!.colorChooserId)!;
  const other = base.players.find((entry) => entry.id !== chooser.id)!;
  assert.throws(
    () => gameV2TestHooks.handleDuelColor(structuredClone(base), other, { type: "choose", choice: "warm" }),
    /选择无效/,
  );
  assert.throws(
    () => gameV2TestHooks.handleDuelColor(structuredClone(base), chooser, { type: "choose", choice: "invalid" }),
    /选择无效/,
  );

  const draft = structuredClone(base);
  gameV2TestHooks.handleDuelColor(draft, draft.players.find((entry) => entry.id === chooser.id)!, { type: "choose", choice: "warm" });
  const draftActor = draft.players.find((entry) => entry.id === draft.pending!.actorId)!;
  const wrongDraftActor = draft.players.find((entry) => entry.id !== draftActor.id)!;
  assert.throws(
    () => gameV2TestHooks.handleDuelDraft(structuredClone(draft), wrongDraftActor, { type: "choose", choice: draft.setup!.duel!.slots[0].id }),
    /不是你的选将顺序/,
  );
  assert.throws(
    () => gameV2TestHooks.handleDuelDraft(structuredClone(draft), draftActor, { type: "choose", choice: "missing" }),
    /不可选择/,
  );

  const lineup = structuredClone(draft);
  const duel = lineup.setup!.duel!;
  lineup.setup!.index = lineup.setup!.order.length;
  duel.lineupOrder = lineup.players.map((entry) => entry.id);
  duel.lineupIndex = 0;
  duel.rosters[lineup.players[0].id] = duel.slots.slice(0, 4).map((entry) => entry.characterId);
  delete duel.lineupProgress[lineup.players[0].id];
  gameV2TestHooks.beginDuelSetup(lineup);
  assert.match(lineup.pending!.prompt, /首发/);
  assert.equal(gameV2TestHooks.duelLineupActions(lineup, lineup.players[0])[0].label.startsWith("首发"), true);
  duel.lineupProgress[lineup.players[0].id] = duel.rosters[lineup.players[0].id].slice(0, 3);
  assert.equal(gameV2TestHooks.duelLineupActions(lineup, lineup.players[0])[0].label.startsWith("出场"), true);
  duel.lineupProgress[lineup.players[0].id] = duel.rosters[lineup.players[0].id].slice(0, 4);
  gameV2TestHooks.beginDuelSetup(lineup);
  assert.match(lineup.pending!.prompt, /下一/);

  const correct = lineup.players[0];
  assert.throws(
    () => gameV2TestHooks.handleDuelLineup(structuredClone(lineup), lineup.players[1], { type: "choose", characterId: duel.rosters[correct.id][0] }),
    /不是你确定阵容/,
  );
  delete duel.lineupProgress[correct.id];
  assert.throws(
    () => gameV2TestHooks.handleDuelLineup(structuredClone(lineup), correct, { type: "choose" }),
    /不在你的可选阵容/,
  );
  duel.lineupProgress[correct.id] = [duel.rosters[correct.id][0]];
  assert.throws(
    () => gameV2TestHooks.handleDuelLineup(structuredClone(lineup), correct, { type: "choose", characterId: duel.rosters[correct.id][0] }),
    /不在你的可选阵容/,
  );
});

test("selection templates execute every default bound and rejection", () => {
  const openTemplate: LegalActionV2 = {
    id: "open",
    kind: "skill",
    skill: "test",
    label: "开放选择",
    candidateCardIds: ["c1"],
    targetIds: ["p1"],
  };
  assert.deepEqual(
    gameV2TestHooks.validateTemplateSelection(openTemplate, { type: "skill", skill: "test" }),
    { type: "skill", skill: "test", cardIds: [], targetIds: [] },
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection(openTemplate, { type: "discard" }),
    /动作类型不合法/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection(openTemplate, { type: "skill", skill: "test", cardIds: ["c1", "c1"] }),
    /不能重复/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection({ ...openTemplate, minCards: 1 }, { type: "skill", skill: "test" }),
    /牌数量不合法/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection({ ...openTemplate, maxCards: 0 }, { type: "skill", skill: "test", cardIds: ["c1"] }),
    /牌数量不合法/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection({ ...openTemplate, minTargets: 1 }, { type: "skill", skill: "test" }),
    /目标数量不合法/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection({ ...openTemplate, maxTargets: 0 }, { type: "skill", skill: "test", targetIds: ["p1"] }),
    /目标数量不合法/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection(openTemplate, { type: "skill", skill: "test", cardIds: ["bad"] }),
    /候选范围/,
  );
  assert.throws(
    () => gameV2TestHooks.validateTemplateSelection(openTemplate, { type: "skill", skill: "test", targetIds: ["bad"] }),
    /候选范围/,
  );
});

test("dispatcher and automatic-advance corruption defenses execute", () => {
  const state = playing(710009);
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const badPending = structuredClone(state);
  badPending.pending = { id: "bad", kind: "unknown" as never, actorId: actor.id, prompt: "未知", data: {} };
  assert.throws(
    () => gameV2TestHooks.resolvePendingAction(badPending, actor, { type: "pass" }),
    /尚未实现/,
  );
  const wrongTurn = structuredClone(state);
  wrongTurn.turn!.playerId = wrongTurn.players.find((entry) => entry.id !== actor.id)!.id;
  assert.throws(() => gameV2TestHooks.resolvePlayAction(wrongTurn, actor, { type: "endTurn" }), /不是你的出牌阶段/);
  const badPlay = structuredClone(state);
  badPlay.turn!.phase = "play";
  assert.throws(() => gameV2TestHooks.resolvePlayAction(badPlay, actor, { type: "playCard" }), /动作格式不正确/);
  assert.throws(() => gameV2TestHooks.resolveActiveSkill(badPlay, actor, { type: "skill" }), /尚未实现/);
  assert.throws(() => gameV2TestHooks.resolveActiveSkill(badPlay, actor, { type: "skill", skill: "unknown" }), /尚未实现/);

  const unknownFrame = structuredClone(state);
  unknownFrame.pending = null;
  unknownFrame.stack = [{ id: "unknown", kind: "unknown" as never, data: {} }];
  assert.throws(() => gameV2TestHooks.advance(unknownFrame), /未知规则帧/);

  const guard = structuredClone(state);
  guard.pending = null;
  guard.stack = Array.from({ length: 801 }, (_, index) => ({
    id: `guard-${index}`,
    kind: "enterPhase" as const,
    data: { phase: "play" },
  }));
  assert.throws(() => gameV2TestHooks.advance(guard), /超过安全上限/);
  assert.equal(gameV2TestHooks.suitLabel("joker"), "joker");
  assert.equal(gameV2TestHooks.suitSymbol("joker"), "");
});
