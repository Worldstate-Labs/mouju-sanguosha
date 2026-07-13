import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  assertGameInvariantV2,
  createGameV2,
  getLegalActionsV2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import { createGame } from "../lib/game.ts";
import { ROLE_MAP, STANDARD_CHARACTERS, type Card, type LobbySeat } from "../lib/game-v2-data.ts";

function seats(count: number): LobbySeat[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `Agent ${index + 1}`,
    kind: "agent",
    seat: index,
  }));
}

function instantiate(option: LegalActionV2): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  if (option.kind === "discard") {
    return { type: "discard", cardIds: option.candidateCardIds!.slice(0, option.minCards) };
  }
  return {
    type: "skill",
    skill: option.skill,
    cardIds: option.candidateCardIds?.slice(0, option.minCards ?? 0),
    targetIds: option.targetIds?.slice(0, option.minTargets ?? 0),
  };
}

function chooseOption(state: GameStateV2, actions: LegalActionV2[]) {
  if (state.status === "setup" || state.pending) {
    return actions.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass")
      ?? actions.find((entry) => entry.kind === "skill")
      ?? actions.find((entry) => entry.kind === "discard")
      ?? actions[0];
  }
  return actions.find((entry) => entry.kind === "exact" && /[杀决斗南蛮万箭激将]/.test(entry.label))
    ?? actions.find((entry) => entry.kind === "skill")
    ?? actions.find((entry) => entry.kind === "exact" && entry.action?.type !== "endTurn" && !entry.label.includes("【桃】"))
    ?? actions.find((entry) => entry.kind === "exact" && entry.action?.type === "endTurn")
    ?? actions[0];
}

function step(state: GameStateV2, stepNumber: number) {
  const actorId = state.pending?.actorId ?? state.turn?.playerId;
  assert.ok(actorId, "every unfinished state has a decision actor");
  const actions = getLegalActionsV2(state, actorId);
  assert.ok(actions.length > 0, `actor ${actorId} has a legal action`);
  const activeActors = state.players.filter((entry) => getLegalActionsV2(state, entry.id).length > 0);
  assert.equal(activeActors.length, 1, "human and Agent authorization exposes exactly one active seat");
  const next = applyGameActionV2(state, actorId, instantiate(chooseOption(state, actions)), { nowMs: stepNumber + 10 });
  assertGameInvariantV2(next);
  return next;
}

function finishSelection(state: GameStateV2) {
  let next = state;
  let sequence = 0;
  while (next.status === "setup") next = step(next, sequence++);
  return next;
}

function takeCard(state: GameStateV2, predicate: (card: Card) => boolean) {
  const arrays = [state.deck, state.discard, state.processing, state.revealed];
  for (const zone of arrays) {
    const index = zone.findIndex(predicate);
    if (index >= 0) return zone.splice(index, 1)[0];
  }
  for (const owner of state.players) {
    for (const zone of [owner.hand, owner.judgment]) {
      const index = zone.findIndex(predicate);
      if (index >= 0) return zone.splice(index, 1)[0];
    }
    for (const slot of ["weapon", "armor", "offensiveHorse", "defensiveHorse"] as const) {
      const card = owner.equipment[slot];
      if (card && predicate(card)) {
        owner.equipment[slot] = null;
        return card;
      }
    }
  }
  throw new Error("test card not found");
}

test("classic identity setup supports 4 through 10 seats and preserves all 108 cards", () => {
  for (let count = 4; count <= 10; count += 1) {
    const initial = createGameV2(seats(count), { seed: 10_000 + count }, { nowMs: 1 });
    assert.equal(initial.players.length, count);
    assert.deepEqual(
      initial.players.map((entry) => entry.role).sort(),
      [...ROLE_MAP[count]].sort(),
    );
    assert.equal(initial.pending?.kind, "chooseCharacter");
    assertGameInvariantV2(initial);

    const playing = finishSelection(initial);
    const lord = playing.players.find((entry) => entry.role === "lord")!;
    assert.equal(lord.maxHp, lord.character!.maxHp + 1);
    assert.equal(playing.turn?.playerId, lord.id);
    assert.ok(playing.players.every((entry) => entry.character));
    assert.ok(playing.players.filter((entry) => entry.id !== lord.id).every((entry) => entry.hand.length === 4));
    assertGameInvariantV2(playing);
  }
});

test("classic KOF duel drafts five, secretly lines up three, and applies the first-turn draw handicap", () => {
  const initial = createGameV2(seats(2), { seed: 202 }, { nowMs: 1 });
  assert.equal(initial.mode, "duel");
  assert.equal(initial.pending?.kind, "duelColor");
  assertGameInvariantV2(initial);

  const playing = finishSelection(initial);
  const first = playing.players.find((entry) => entry.id === playing.duelFirstPlayerId)!;
  const second = playing.players.find((entry) => entry.id !== first.id)!;
  assert.equal(first.role, "renegade");
  assert.equal(second.role, "lord");
  assert.ok(playing.players.every((entry) => entry.duelRoster?.length === 5));
  assert.ok(playing.players.every((entry) => entry.duelLineup?.length === 3));
  assert.equal(first.maxHp, first.character!.maxHp, "duel players receive no lord HP bonus");
  assert.equal(second.maxHp, second.character!.maxHp);
  assert.equal(first.hand.length, 5, "four opening cards plus the one-card first draw");
  assert.equal(playing.duelFirstDrawPending, false, "the first-draw handicap is consumed exactly once");
  assert.equal(second.hand.length, 4);
  assert.equal(playing.turn?.playerId, first.id);
  assert.equal(playing.turn?.phase, "play");

  second.character = STANDARD_CHARACTERS.find((entry) => entry.id === "liubei")!;
  first.character = STANDARD_CHARACTERS.find((entry) => entry.id === "zhaoyun")!;
  playing.turn!.playerId = second.id;
  playing.turn!.phase = "play";
  assert.ok(!getLegalActionsV2(playing, second.id).some((entry) => entry.action?.type === "lordSkill"));
});

test("state invariants reject silent corruption while permitting the bounded dying state", () => {
  const healthy = finishSelection(createGameV2(seats(4), { seed: 40404 }, { nowMs: 1 }));

  const duplicateSeat = structuredClone(healthy);
  duplicateSeat.players[1].seat = duplicateSeat.players[0].seat;
  assert.throws(() => assertGameInvariantV2(duplicateSeat), /座位重复/);

  const overhealed = structuredClone(healthy);
  overhealed.players[0].hp = overhealed.players[0].maxHp + 1;
  assert.throws(() => assertGameInvariantV2(overhealed), /体力越界/);

  const dying = structuredClone(healthy);
  const target = dying.players[1];
  target.hp = -1;
  target.alive = true;
  dying.pending = {
    id: "test-rescue",
    kind: "rescue",
    actorId: dying.players[0].id,
    prompt: `${target.name} 濒死，需要【桃】`,
    data: { targetId: target.id },
  };
  assert.doesNotThrow(() => assertGameInvariantV2(dying));

  dying.pending = null;
  assert.throws(() => assertGameInvariantV2(dying), /体力越界|存活状态/);
});

test("structured public animation shows 顺手牵羊 direction without leaking the stolen hand card", () => {
  let state = finishSelection(createGameV2(seats(2), { seed: 9127 }, { nowMs: 1 }));
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const target = state.players.find((entry) => entry.id !== actor.id)!;
  const shunshou = takeCard(state, (card) => card.name === "顺手牵羊");
  actor.hand.push(shunshou);
  state.turn!.phase = "play";
  state.turn!.shaUsed = 0;
  state.stack = [];
  state.pending = null;

  const use = getLegalActionsV2(state, actor.id).find((entry) => entry.kind === "exact" && entry.action?.as === "顺手牵羊" && entry.action.targetId === target.id);
  assert.ok(use?.action, "顺手牵羊 is legal at distance one");
  state = applyGameActionV2(state, actor.id, use.action, { nowMs: 100 });
  while (state.pending?.kind === "nullification") {
    const responder = state.pending.actorId;
    const pass = getLegalActionsV2(state, responder).find((entry) => entry.kind === "exact" && entry.action?.type === "pass");
    assert.ok(pass?.action);
    state = applyGameActionV2(state, responder, pass.action, { nowMs: 101 + state.logSeq });
  }
  assert.equal(state.pending?.kind, "chooseZoneCard");
  const zoneActor = state.pending!.actorId;
  const chooseHand = getLegalActionsV2(state, zoneActor).find((entry) => entry.kind === "exact" && entry.action?.zone === "hand");
  assert.ok(chooseHand?.action);
  state = applyGameActionV2(state, zoneActor, chooseHand.action, { nowMs: 200 });

  const transfer = [...state.logs].reverse().find((entry) => entry.visual?.kind === "transfer");
  assert.ok(transfer?.visual);
  assert.equal(transfer.visual.sourceId, target.id);
  assert.deepEqual(transfer.visual.targetIds, [actor.id]);
  assert.equal(transfer.visual.zone, "hand");
  assert.equal(transfer.visual.cardName, undefined, "a stolen hand card remains hidden from public animation metadata");
  assert.equal(JSON.stringify(transfer.visual).includes(target.hand[0]?.id ?? "never"), false);
});

test("过河拆桥 keeps a hand card hidden while choosing and publicly reveals it after discard", () => {
  let state = finishSelection(createGameV2(seats(2), { seed: 9131 }, { nowMs: 1 }));
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const target = state.players.find((entry) => entry.id !== actor.id)!;
  const guohe = takeCard(state, (card) => card.name === "过河拆桥");
  actor.hand.push(guohe);
  state.turn!.phase = "play";
  state.stack = [];
  state.pending = null;

  const use = getLegalActionsV2(state, actor.id).find((entry) => entry.action?.as === "过河拆桥" && entry.action.targetId === target.id);
  assert.ok(use?.action);
  state = applyGameActionV2(state, actor.id, use.action, { nowMs: 100 });
  while (state.pending?.kind === "nullification") {
    const responder = state.pending.actorId;
    const pass = getLegalActionsV2(state, responder).find((entry) => entry.action?.type === "pass");
    assert.ok(pass?.action);
    state = applyGameActionV2(state, responder, pass.action, { nowMs: 101 + state.logSeq });
  }
  const chooseHand = getLegalActionsV2(state, state.pending!.actorId).find((entry) => entry.action?.zone === "hand");
  assert.ok(chooseHand?.action);
  state = applyGameActionV2(state, state.pending!.actorId, chooseHand.action, { nowMs: 200 });

  const discarded = [...state.logs].reverse().find((entry) => entry.visual?.kind === "discard");
  assert.ok(discarded?.visual?.cardName);
  assert.match(discarded.text, new RegExp(`【${discarded.visual.cardName}】`));
});

test("a target spending its last hand card in the nullification chain cannot deadlock zone selection", () => {
  let state = finishSelection(createGameV2(seats(2), { seed: 50089 }, { nowMs: 1 }));
  const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const target = state.players.find((entry) => entry.id !== source.id)!;
  target.character = STANDARD_CHARACTERS.find((entry) => entry.id === "zhangfei")!;
  state.discard.push(...source.hand.splice(0), ...target.hand.splice(0));
  state.discard.push(...Object.values(target.equipment).filter((card): card is Card => Boolean(card)), ...target.judgment.splice(0));
  target.equipment = { weapon: null, armor: null, offensiveHorse: null, defensiveHorse: null };
  const guohe = takeCard(state, (card) => card.name === "过河拆桥");
  const sourceWuxie = takeCard(state, (card) => card.name === "无懈可击");
  const targetWuxie = takeCard(state, (card) => card.name === "无懈可击");
  source.hand.push(guohe, sourceWuxie);
  target.hand.push(targetWuxie);
  state.turn!.phase = "play";
  state.stack = [];
  state.pending = null;

  const use = getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === guohe.id && entry.action.targetId === target.id)!;
  state = applyGameActionV2(state, source.id, use.action!, { nowMs: 100 });
  let targetNullified = false;
  let sourceCountered = false;
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    const legal = getLegalActionsV2(state, actorId);
    const respond = legal.find((entry) => entry.action?.type === "respond");
    const selected = actorId === target.id && !targetNullified && respond
      ? (targetNullified = true, respond)
      : actorId === source.id && targetNullified && !sourceCountered && respond
        ? (sourceCountered = true, respond)
        : legal.find((entry) => entry.action?.type === "pass")!;
    state = applyGameActionV2(state, actorId, selected.action!, { nowMs: 101 + guard });
  }
  assert.equal(targetNullified, true, "target must spend its only Wuxie");
  assert.equal(sourceCountered, true, "source must counter the target's Wuxie");
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hand.length, 0);
  assert.notEqual(state.pending?.kind, "chooseZoneCard");
  assert.ok(!state.pending || getLegalActionsV2(state, state.pending.actorId).length > 0);
  assert.match(state.logs.at(-1)!.text, /已没有可选择的牌/);
});

test("鬼才 sees the natural judgment card before choosing and records replacement provenance", () => {
  let state = finishSelection(createGameV2(seats(2), { seed: 9137 }, { nowMs: 1 }));
  const attacker = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const simayi = state.players.find((entry) => entry.id !== attacker.id)!;
  simayi.character = STANDARD_CHARACTERS.find((entry) => entry.id === "simayi")!;
  simayi.maxHp = simayi.character.maxHp;
  simayi.hp = simayi.maxHp;
  simayi.equipment.armor = takeCard(state, (card) => card.name === "八卦阵");
  const sha = takeCard(state, (card) => card.name === "杀");
  attacker.hand.push(sha);
  state.turn!.phase = "play";
  state.turn!.shaUsed = 0;
  state.stack = [];
  state.pending = null;

  const use = getLegalActionsV2(state, attacker.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === simayi.id);
  assert.ok(use?.action);
  state = applyGameActionV2(state, attacker.id, use.action, { nowMs: 100 });
  assert.equal(state.pending?.kind, "optionalSkill");
  const bagua = getLegalActionsV2(state, simayi.id).find((entry) => entry.id === "skill:bagua:yes");
  assert.ok(bagua?.action);
  state = applyGameActionV2(state, simayi.id, bagua.action, { nowMs: 101 });

  assert.equal(state.pending?.kind, "judgment");
  assert.match(state.pending!.prompt, /判定牌为 [♠♥♣♦].+【.+】，是否发动【鬼才】/);
  const reveal = state.logs.at(-1)!;
  assert.equal(reveal.visual?.kind, "judge");
  assert.ok(reveal.visual?.cardName);
  const replace = getLegalActionsV2(state, simayi.id).find((entry) => entry.action?.type === "respond");
  assert.ok(replace?.action);
  state = applyGameActionV2(state, simayi.id, replace.action, { nowMs: 102 });
  assert.match(state.logs.findLast((entry) => entry.text.includes("发动【鬼才】"))!.text, /替换为 [♠♥♣♦].+【.+】/);
});

test("a seat-one first player who replaces during their own turn does not receive the first-draw handicap twice", () => {
  let state = finishSelection(createGameV2(seats(2), { seed: 303 }, { nowMs: 1 }));
  const actor = state.players.find((entry) => entry.seat === 1)!;
  const opponent = state.players.find((entry) => entry.seat === 0)!;
  const huanggai = STANDARD_CHARACTERS.find((entry) => entry.id === "huanggai")!;
  const zhaoyun = STANDARD_CHARACTERS.find((entry) => entry.id === "zhaoyun")!;
  const machao = STANDARD_CHARACTERS.find((entry) => entry.id === "machao")!;

  state.duelFirstPlayerId = actor.id;
  state.duelFirstDrawPending = false;
  state.round = 1;
  state.pending = null;
  state.stack = [];
  state.turn = { playerId: actor.id, phase: "play", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
  actor.character = huanggai;
  actor.maxHp = huanggai.maxHp;
  actor.hp = 1;
  actor.duelLineup = [huanggai.id, zhaoyun.id, machao.id];
  opponent.character = zhaoyun;
  opponent.maxHp = zhaoyun.maxHp;
  opponent.hp = zhaoyun.maxHp;
  for (const target of state.players) {
    const peaches = target.hand.filter((card) => card.name === "桃");
    target.hand = target.hand.filter((card) => card.name !== "桃");
    state.deck.unshift(...peaches);
  }

  const kurou = getLegalActionsV2(state, actor.id).find((entry) => entry.action?.skill === "kurou")!;
  state = applyGameActionV2(state, actor.id, instantiate(kurou), { nowMs: 2 });
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 4; guard += 1) {
    const rescuer = state.pending.actorId;
    const pass = getLegalActionsV2(state, rescuer).find((entry) => entry.action?.type === "pass")!;
    state = applyGameActionV2(state, rescuer, instantiate(pass), { nowMs: guard + 3 });
  }

  const replaced = state.players.find((entry) => entry.id === actor.id)!;
  assert.equal(replaced.character?.id, zhaoyun.id);
  assert.equal(state.turn?.playerId, opponent.id);
  assert.equal(state.turn?.phase, "play");
  assert.equal(state.round, 2, "forced wrap from seat one to seat zero advances the round");
  assert.equal(state.duelFirstDrawPending, false);
});

test("same seed and same commands are byte-for-byte deterministic", () => {
  let left = createGameV2(seats(4), { seed: 424242 }, { nowMs: 1 });
  let right = createGameV2(seats(4), { seed: 424242 }, { nowMs: 1 });
  assert.deepEqual(left, right);
  for (let index = 0; index < 300 && left.status !== "finished"; index += 1) {
    const actorId = left.pending?.actorId ?? left.turn!.playerId;
    const option = chooseOption(left, getLegalActionsV2(left, actorId));
    const action = instantiate(option);
    left = applyGameActionV2(left, actorId, action, { nowMs: index + 2 });
    right = applyGameActionV2(right, actorId, action, { nowMs: index + 2 });
    assert.deepEqual(left, right);
  }
});

test("production card IDs are opaque and independent from the gameplay RNG seed", () => {
  const production = createGame(seats(2));
  assert.equal(production.rngMode, "system-v1");
  const allIds = production.deck.map((card) => card.id);
  assert.equal(new Set(allIds).size, 108);
  assert.ok(allIds.every((id) => /^c_[0-9a-f]{32}$/.test(id)));
  assert.ok(allIds.every((id) => !id.includes(production.rngState.toString(36))));

  const deterministic = createGameV2(seats(2), { seed: 0x1234abcd }, { nowMs: 1 });
  assert.equal(deterministic.rngMode, "xorshift32-legacy");
  assert.ok(deterministic.deck.every((card) => /^c_test_\d{3}$/.test(card.id)));
  assert.ok(deterministic.deck.every((card) => !card.id.includes((0x1234abcd).toString(36))));
});

test("system RNG ignores the legacy seed and does not expose a replayable state", () => {
  const left = createGameV2(seats(2), { seed: 5150, rngMode: "system-v1" }, { nowMs: 1 });
  const right = createGameV2(seats(2), { seed: 5150, rngMode: "system-v1" }, { nowMs: 1 });
  assert.equal(left.schemaVersion, 2);
  assert.equal(left.rngState, 5150);
  assert.equal(right.rngState, 5150);
  assert.notDeepEqual(left.deck.map((card) => card.id), right.deck.map((card) => card.id));
  assert.notDeepEqual(
    left.setup?.duel?.slots.map((slot) => slot.characterId),
    right.setup?.duel?.slots.map((slot) => slot.characterId),
  );
});

test("legacy snapshots without an RNG mode remain playable", () => {
  const legacy = createGameV2(seats(2), { seed: 9191 }, { nowMs: 1 });
  delete legacy.rngMode;
  const actorId = legacy.pending!.actorId;
  const action = instantiate(getLegalActionsV2(legacy, actorId)[0]);
  const next = applyGameActionV2(legacy, actorId, action, { nowMs: 2 });
  assert.ok(next.pending || next.turn || next.status === "finished");
});

test("server rejects stale decisions, fabricated cards, and invalid template counts", () => {
  let state = createGameV2(seats(4), { seed: 77 }, { nowMs: 1 });
  const setupActor = state.pending!.actorId;
  assert.throws(
    () => applyGameActionV2(state, setupActor, { type: "chooseCharacter", characterId: "fabricated" }, { nowMs: 2 }),
    /不在本次候选|不在当前服务器合法动作/,
  );
  state = finishSelection(state);
  const actorId = state.pending?.actorId ?? state.turn!.playerId;
  assert.throws(
    () => applyGameActionV2(state, actorId, { type: "playCard", cardId: "fabricated", as: "杀", targetId: "p1" }, { nowMs: 3 }),
    /不在当前服务器合法动作/,
  );
  if (state.pending) {
    const first = getLegalActionsV2(state, actorId)[0];
    assert.throws(
      () => applyGameActionV2(state, actorId, { ...instantiate(first), decisionId: "stale-decision" }, { nowMs: 4 }),
      /决策已经变化/,
    );
  }
});

test("declining Keji proceeds to the mandatory discard instead of asking again", () => {
  const state = finishSelection(createGameV2(seats(4), { seed: 10 }, { nowMs: 1 }));
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  actor.character = STANDARD_CHARACTERS.find((entry) => entry.id === "lvmeng")!;
  actor.maxHp = 4;
  actor.hp = 1;
  state.turn!.phase = "discard";
  state.turn!.usedSkills = [];
  state.turn!.stats.shaUsedOrPlayed = false;
  state.pending = {
    id: "keji-decline",
    kind: "optionalSkill",
    actorId: actor.id,
    prompt: "是否发动【克己】跳过弃牌阶段？",
    data: { skill: "keji", resume: "discard" },
  };
  state.stack = [];

  const next = applyGameActionV2(state, actor.id, { type: "pass" }, { nowMs: 2 });
  assert.equal(next.pending?.kind, "discardPhase");
  assert.equal(next.pending?.actorId, actor.id);
  assert.ok(next.turn?.usedSkills.includes("keji:phase"));
  assert.ok(getLegalActionsV2(next, actor.id).some((entry) => entry.kind === "discard"));
});

test("a failed Hujia Bagua attempt still lets the same Wei provider supply Shan", () => {
  const state = finishSelection(createGameV2(seats(4), { seed: 31 }, { nowMs: 1 }));
  const lord = state.players.find((entry) => entry.role === "lord")!;
  const provider = state.players.find((entry) => entry.id !== lord.id)!;
  const noGuicai = STANDARD_CHARACTERS.find((entry) => entry.id === "lvmeng")!;
  for (const entry of state.players) entry.character = noGuicai;
  provider.character = STANDARD_CHARACTERS.find((entry) => entry.id === "caocao")!;
  provider.equipment.armor = takeCard(state, (card) => card.name === "八卦阵");
  provider.hand.push(takeCard(state, (card) => card.name === "闪"));
  state.deck.push(takeCard(state, (card) => card.color === "black"));
  state.pending = {
    id: "hujia-bagua",
    kind: "lordRequest",
    actorId: provider.id,
    prompt: "主公请求你提供【闪】",
    data: {
      skill: "hujia",
      lordId: lord.id,
      mode: "response",
      providers: [provider.id],
      cursor: 0,
      responseData: {
        required: "闪",
        remaining: 1,
        use: { id: "test-use", sourceId: provider.id, name: "杀", cardIds: [], targets: [lord.id], targetIndex: 0 },
        targetId: lord.id,
        kind: "sha",
      },
    },
  };
  state.stack = [];

  const next = applyGameActionV2(state, provider.id, { type: "provideSkill", skill: "bagua" }, { nowMs: 2 });
  assert.equal(next.pending?.kind, "lordRequest");
  assert.equal(next.pending?.actorId, provider.id);
  const actions = getLegalActionsV2(next, provider.id);
  assert.ok(actions.some((entry) => entry.action?.type === "provide" && entry.action.as === "闪"));
  assert.ok(!actions.some((entry) => entry.action?.type === "provideSkill" && entry.action.skill === "bagua"));
});

test("six phases are explicit and autonomous Agents finish multi-size games without deadlock", () => {
  const observedPhases = new Set<string>();
  const observedPending = new Set<string>();
  const sizes = [2, 4, 5, 8, 10];
  for (const size of sizes) {
    for (let match = 0; match < 4; match += 1) {
      let state = createGameV2(seats(size), { seed: size * 1000 + match }, { nowMs: 1 });
      for (let index = 0; index < 7_500 && state.status !== "finished"; index += 1) {
        if (state.turn?.phase) observedPhases.add(state.turn.phase);
        if (state.pending?.kind) observedPending.add(state.pending.kind);
        state = step(state, index);
      }
      assert.equal(state.status, "finished", `${size}-seat seed ${match} reaches a role victory`);
      assert.ok(state.winner?.playerIds.length);
      if (size === 2) {
        const loser = state.players.find((entry) => !state.winner!.playerIds.includes(entry.id))!;
        assert.equal(loser.duelDefeated?.length, 3, "third defeated general ends the KOF duel");
        assert.ok(state.players.reduce((sum, entry) => sum + (entry.duelDefeated?.length ?? 0), 0) >= 3);
      }
    }
  }
  assert.deepEqual(observedPhases, new Set(["prepare", "judge", "draw", "play", "discard", "finish"]));
  for (const kind of ["chooseCharacter", "response", "nullification", "rescue", "discardPhase"]) {
    assert.ok(observedPending.has(kind), `simulation reaches ${kind} decisions`);
  }
  for (const kind of ["duelColor", "duelDraft", "duelLineup"]) {
    assert.ok(observedPending.has(kind), `two-seat simulation reaches ${kind}`);
  }
});
