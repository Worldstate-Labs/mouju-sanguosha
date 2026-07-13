import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  assertGameInvariantV2,
  createGameV2,
  distanceV2,
  getLegalActionsV2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import { STANDARD_CHARACTERS, type Card, type LobbySeat } from "../lib/game-v2-data.ts";

const seats = (count: number): LobbySeat[] => Array.from({ length: count }, (_, seat) => ({
  id: `deep-${seat}`,
  name: `深层玩家${seat + 1}`,
  kind: "human",
  seat,
}));

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

function playing(count: number, seed: number) {
  let state = createGameV2(seats(count), { seed }, { nowMs: 1 });
  for (let step = 0; state.status === "setup" && step < 300; step += 1) {
    const actorId = state.pending!.actorId;
    const legal = getLegalActionsV2(state, actorId);
    const selected = legal.find((entry) => entry.action?.type !== "pass") ?? legal[0];
    state = applyGameActionV2(state, actorId, instantiate(selected), { nowMs: step + 2 });
  }
  assert.equal(state.status, "playing");
  return state;
}

function general(id: string) {
  return STANDARD_CHARACTERS.find((entry) => entry.id === id)!;
}

function assign(state: GameStateV2, playerId: string, characterId: string) {
  const target = state.players.find((entry) => entry.id === playerId)!;
  target.character = general(characterId);
  target.maxHp = target.character.maxHp;
  target.hp = target.maxHp;
  return target;
}

function take(state: GameStateV2, predicate: (card: Card) => boolean) {
  for (const zone of [state.deck, state.discard, state.processing, state.revealed]) {
    const index = zone.findIndex(predicate);
    if (index >= 0) return zone.splice(index, 1)[0];
  }
  for (const owner of state.players) {
    const handIndex = owner.hand.findIndex(predicate);
    if (handIndex >= 0) return owner.hand.splice(handIndex, 1)[0];
    const judgmentIndex = owner.judgment.findIndex(predicate);
    if (judgmentIndex >= 0) return owner.judgment.splice(judgmentIndex, 1)[0];
    for (const slot of ["weapon", "armor", "offensiveHorse", "defensiveHorse"] as const) {
      const card = owner.equipment[slot];
      if (card && predicate(card)) {
        owner.equipment[slot] = null;
        return card;
      }
    }
  }
  throw new Error("required physical card not found");
}

function clearHand(state: GameStateV2, playerId: string) {
  const target = state.players.find((entry) => entry.id === playerId)!;
  state.discard.push(...target.hand.splice(0));
  return target;
}

function isolatePlay(state: GameStateV2, actorId: string) {
  state.pending = null;
  state.stack = [];
  state.turn = { playerId: actorId, phase: "play", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
}

function leaveDeckCards(state: GameStateV2, count: number) {
  const move = Math.max(0, state.deck.length - count);
  state.discard.push(...state.deck.splice(0, move));
  assert.equal(state.deck.length, count);
}

function exhaustDrawPiles(state: GameStateV2, vaultId: string) {
  const vault = state.players.find((entry) => entry.id === vaultId)!;
  vault.hand.push(...state.deck.splice(0), ...state.discard.splice(0));
  assert.equal(state.deck.length, 0);
  assert.equal(state.discard.length, 0);
}

test("KOF replacement rejects damage triggers belonging to the newly entered general", () => {
  let state = playing(2, 151001);
  const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const target = state.players.find((entry) => entry.id !== source.id)!;
  assign(state, source.id, "xuchu");
  assign(state, target.id, "zhaoyun");
  target.duelLineup = ["zhaoyun", "guojia", "caocao"];
  target.duelDefeated = [];
  target.hp = 1;
  const oldEpoch = target.generalEpoch;
  clearHand(state, source.id);
  clearHand(state, target.id);
  const sha = take(state, (card) => card.name === "杀");
  source.hand.push(sha);
  isolatePlay(state, source.id);
  state.turn!.stats.luoyi = true;
  state.duelFirstDrawPending = false;

  const use = getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!;
  state = applyGameActionV2(state, source.id, use.action!, { nowMs: 100 });
  const noShan = getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!;
  state = applyGameActionV2(state, target.id, noShan.action!, { nowMs: 101 });
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 8; guard += 1) {
    const rescuer = state.pending.actorId;
    const pass = getLegalActionsV2(state, rescuer).find((entry) => entry.action?.type === "pass")!;
    state = applyGameActionV2(state, rescuer, pass.action!, { nowMs: 102 + guard });
  }

  const replacement = state.players.find((entry) => entry.id === target.id)!;
  assert.equal(replacement.character?.id, "guojia");
  assert.equal(replacement.generalEpoch, oldEpoch + 1);
  assert.equal(replacement.hand.length, 4);
  assert.notEqual(state.pending?.kind, "damageTrigger", "the new Guojia was not the damaged general");
  assert.notEqual(state.pending?.kind, "yijiAssign");
  assert.ok(!state.logs.some((entry) => entry.text.includes("发动【遗计】")));
  assertGameInvariantV2(state);
});

test("fatal Lightning replacement clears the old judge-phase stack and hands the turn to the opponent", () => {
  let state = playing(2, 151014);
  const target = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const opponent = state.players.find((entry) => entry.id !== target.id)!;
  assign(state, target.id, "zhaoyun");
  assign(state, opponent.id, "zhangfei");
  target.duelLineup = ["zhaoyun", "guojia", "caocao"];
  target.duelDefeated = [];
  target.hp = 1;
  clearHand(state, target.id);
  clearHand(state, opponent.id);
  const lightning = take(state, (card) => card.name === "闪电");
  const lethalJudge = take(state, (card) => card.suit === "spade" && ["2", "3", "4", "5", "6", "7", "8", "9"].includes(card.rank));
  target.judgment.push(lightning);
  state.deck.push(lethalJudge);
  state.stack = [];
  state.turn = { playerId: target.id, phase: "judge", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
  state.pending = { id: "enter-fatal-judge", kind: "optionalSkill", actorId: target.id, prompt: "进入判定", data: { skill: "guanxing", resume: "judge" } };
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 100 },
  );
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 8; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 101 + guard },
    );
  }
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 8; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 120 + guard },
    );
  }
  const replacement = state.players.find((entry) => entry.id === target.id)!;
  assert.equal(replacement.character?.id, "guojia");
  assert.equal(replacement.hand.length, 4);
  assert.equal(state.turn?.playerId, opponent.id);
  assert.equal(state.turn?.phase, "play");
  assert.ok(!state.stack.some((frame) => ["judgePhase", "resolveDelayed"].includes(frame.kind)));
  assert.ok(!state.logs.some((entry) => entry.text.includes("发动【遗计】")));
  assertGameInvariantV2(state);
});

test("Cao Cao may obtain the physical Lightning that dealt its judgment damage", () => {
  let state = playing(4, 151028);
  const target = assign(state, state.turn!.playerId, "caocao");
  state.players.filter((entry) => entry.id !== target.id).forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, target.id);
  const lightning = take(state, (card) => card.name === "闪电");
  const lethalJudge = take(state, (card) => card.suit === "spade" && ["2", "3", "4", "5", "6", "7", "8", "9"].includes(card.rank));
  target.judgment.push(lightning);
  state.deck.push(lethalJudge);
  state.stack = [];
  state.turn = { playerId: target.id, phase: "judge", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
  state.pending = { id: "enter-cao-lightning", kind: "optionalSkill", actorId: target.id, prompt: "进入判定", data: { skill: "guanxing", resume: "judge" } };
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 100 },
  );
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 8; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 101 + guard },
    );
  }
  assert.equal(target.maxHp, 4);
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, 1);
  assert.equal(state.pending?.kind, "damageTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "jianxiong");
  assert.ok(state.processing.some((card) => card.id === lightning.id));
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 120 },
  );
  assert.ok(state.players.find((entry) => entry.id === target.id)!.hand.some((card) => card.id === lightning.id));
  assert.ok(!state.discard.some((card) => card.id === lightning.id));
  assertGameInvariantV2(state);
});

test("multiple Guicai owners replace one public judgment in seat order and Tiandu obtains only the final card", () => {
  let state = playing(4, 151030);
  const ordered = [...state.players].sort((left, right) => left.seat - right.seat);
  const sourceIndex = ordered.findIndex((entry) => entry.id === state.turn!.playerId);
  const cycle = Array.from({ length: ordered.length }, (_, index) => ordered[(sourceIndex + index) % ordered.length]);
  const [source, firstSima, secondSima, targetSeat] = cycle;
  assign(state, source.id, "zhangfei");
  assign(state, firstSima.id, "simayi");
  assign(state, secondSima.id, "simayi");
  const target = assign(state, targetSeat.id, "guojia");
  for (const entry of state.players) clearHand(state, entry.id);
  const armor = take(state, (card) => card.name === "八卦阵");
  const sha = take(state, (card) => card.name === "杀");
  const natural = take(state, (card) => card.color === "black");
  const firstReplacement = take(state, (card) => card.color === "black" && card.id !== natural.id);
  const finalReplacement = take(state, (card) => card.color === "red");
  source.hand.push(sha);
  firstSima.hand.push(firstReplacement);
  secondSima.hand.push(finalReplacement);
  target.equipment.armor = armor;
  state.deck.push(natural);
  isolatePlay(state, source.id);
  const hpBefore = target.hp;
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "judgment");
  assert.equal(state.pending?.actorId, firstSima.id);
  state = applyGameActionV2(
    state,
    firstSima.id,
    getLegalActionsV2(state, firstSima.id).find((entry) => entry.action?.cardId === firstReplacement.id)!.action!,
    { nowMs: 102 },
  );
  assert.equal(state.pending?.actorId, secondSima.id);
  assert.match(state.pending!.prompt, new RegExp(`${firstReplacement.rank}【${firstReplacement.name}】`));
  state = applyGameActionV2(
    state,
    secondSima.id,
    getLegalActionsV2(state, secondSima.id).find((entry) => entry.action?.cardId === finalReplacement.id)!.action!,
    { nowMs: 103 },
  );
  assert.equal(state.pending?.kind, "tiandu");
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 104 },
  );
  assert.ok(state.players.find((entry) => entry.id === target.id)!.hand.some((card) => card.id === finalReplacement.id));
  assert.ok(state.discard.some((card) => card.id === natural.id));
  assert.ok(state.discard.some((card) => card.id === firstReplacement.id));
  assert.ok(!state.discard.some((card) => card.id === finalReplacement.id));
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  assertGameInvariantV2(state);
});

test("Jizhi triggered by Nullification draws before the counter-chain resumes", () => {
  let state = playing(4, 151040);
  const actor = assign(state, state.players.find((entry) => entry.id !== state.turn!.playerId)!.id, "huangyueying");
  state.players.filter((entry) => entry.id !== actor.id).forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, actor.id);
  const nullification = take(state, (card) => card.name === "无懈可击");
  const jizhiDraw = take(state, (card) => card.name !== "无懈可击");
  actor.hand.push(nullification);
  state.deck.push(jizhiDraw);
  const order = [actor.id, ...state.players.filter((entry) => entry.id !== actor.id).map((entry) => entry.id)];
  state.stack = [];
  state.pending = {
    id: "jizhi-nullification",
    kind: "nullification",
    actorId: actor.id,
    prompt: "等待无懈可击",
    data: {
      use: { id: "jizhi-trick", sourceId: state.turn!.playerId, name: "过河拆桥", cardIds: [], color: "black", targets: [actor.id], targetIndex: 0 },
      targetId: actor.id,
      order,
      cursor: 0,
      passes: 0,
      parity: 0,
      continuation: "effect",
    },
  };
  state = applyGameActionV2(
    state,
    actor.id,
    getLegalActionsV2(state, actor.id).find((entry) => entry.action?.cardId === nullification.id)!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.pending?.kind, "optionalSkill");
  assert.equal((state.pending!.data as { skill: string }).skill, "jizhi");
  state = applyGameActionV2(
    state,
    actor.id,
    getLegalActionsV2(state, actor.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.ok(state.players.find((entry) => entry.id === actor.id)!.hand.some((card) => card.id === jizhiDraw.id));
  assert.equal(state.pending?.kind, "nullification");
  assert.notEqual(state.pending?.actorId, actor.id);
  assert.equal((state.pending!.data as { parity: number }).parity, 1);
  assertGameInvariantV2(state);
});

test("a general killed by Ganglie during its own turn replaces cleanly inside the nested skill stack", () => {
  let state = playing(2, 151015);
  const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const xiahoudun = state.players.find((entry) => entry.id !== source.id)!;
  assign(state, source.id, "zhaoyun");
  assign(state, xiahoudun.id, "xiahoudun");
  source.duelLineup = ["zhaoyun", "guojia", "caocao"];
  source.duelDefeated = [];
  source.hp = 1;
  clearHand(state, source.id);
  clearHand(state, xiahoudun.id);
  const sha = take(state, (card) => card.name === "杀");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.hand.push(sha);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === xiahoudun.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "damageTrigger");
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  assert.equal(state.pending?.kind, "ganglieChoice");
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 103 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 8; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 104 + guard },
    );
  }
  const replacement = state.players.find((entry) => entry.id === source.id)!;
  assert.equal(replacement.character?.id, "guojia");
  assert.equal(replacement.hand.length, 4);
  assert.equal(state.turn?.playerId, xiahoudun.id);
  assert.ok(!state.logs.some((entry) => entry.text.includes("发动【遗计】")));
  assertGameInvariantV2(state);
});

test("identity-turn death by Ganglie finishes the in-flight card before handing off the turn", () => {
  let state = playing(4, 151032);
  const source = assign(state, state.turn!.playerId, "zhangfei");
  const xiahoudun = assign(
    state,
    state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id,
    "xiahoudun",
  );
  const others = state.players.filter((entry) => entry.id !== source.id && entry.id !== xiahoudun.id);
  source.role = "rebel";
  xiahoudun.role = "loyalist";
  others[0].role = "lord";
  others[1].role = "renegade";
  source.hp = 1;
  for (const entry of state.players) {
    clearHand(state, entry.id);
  }
  const sha = take(state, (card) => card.name === "杀");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.hand.push(sha);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === xiahoudun.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  assert.equal(state.pending?.kind, "ganglieChoice");
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 103 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 104 + guard },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === source.id)!.alive, false);
  assert.notEqual(state.turn?.playerId, source.id);
  assert.ok(state.discard.some((card) => card.id === sha.id), "the completed Sha must enter discard");
  assert.ok(!state.processing.some((card) => card.id === sha.id), "no dead-turn card may remain marooned in processing");
  assertGameInvariantV2(state);
});

test("a victory caused inside Ganglie cleans every in-flight physical card from transient zones", () => {
  let state = playing(4, 151037);
  const source = assign(state, state.turn!.playerId, "zhangfei");
  const xiahoudun = assign(
    state,
    state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id,
    "xiahoudun",
  );
  const others = state.players.filter((entry) => entry.id !== source.id && entry.id !== xiahoudun.id);
  source.role = "lord";
  xiahoudun.role = "rebel";
  others[0].role = "rebel";
  others[1].role = "renegade";
  source.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const sha = take(state, (card) => card.name === "杀");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.hand.push(sha);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === xiahoudun.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 103 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 104 + guard },
    );
  }
  assert.equal(state.status, "finished");
  assert.ok(state.discard.some((card) => card.id === sha.id));
  assert.equal(state.processing.length, 0);
  assert.equal(state.revealed.length, 0);
  assertGameInvariantV2(state);
});

test("a Fangtian Sha continues across remaining targets after Ganglie kills its current-turn source", () => {
  let state = playing(4, 151033);
  const source = assign(state, state.turn!.playerId, "machao");
  const orderedTargets = state.players.filter((entry) => entry.id !== source.id).sort((left, right) => left.seat - right.seat);
  const xiahoudun = assign(state, orderedTargets[0].id, "xiahoudun");
  const remainingTargets = orderedTargets.slice(1).map((entry) => assign(state, entry.id, "zhangfei"));
  source.role = "rebel";
  xiahoudun.role = "loyalist";
  remainingTargets[0].role = "lord";
  remainingTargets[1].role = "renegade";
  source.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const fangtian = take(state, (card) => card.name === "方天画戟");
  const sha = take(state, (card) => card.name === "杀");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.equipment.weapon = fangtian;
  source.hand.push(sha);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);
  const hpBefore = new Map(state.players.map((entry) => [entry.id, entry.hp]));
  const multi = getLegalActionsV2(state, source.id).find((entry) => entry.action?.targetIds?.length === 3)!;
  assert.equal(multi.action?.targetIds?.[0], xiahoudun.id);
  state = applyGameActionV2(state, source.id, multi.action!, { nowMs: 100 });
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 103 },
  );
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 104 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 105 + guard },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === source.id)!.alive, false);
  for (const target of remainingTargets) {
    assert.equal(state.pending?.kind, "response", "a dead source cannot be asked to trigger Tieqi");
    assert.equal(state.pending?.actorId, target.id);
    state = applyGameActionV2(
      state,
      target.id,
      getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 130 + target.seat },
    );
  }
  assert.ok(remainingTargets.every((target) => state.players.find((entry) => entry.id === target.id)!.hp === hpBefore.get(target.id)! - 1));
  assert.notEqual(state.turn?.playerId, source.id);
  assert.ok(state.discard.some((card) => card.id === sha.id));
  assert.ok(state.discard.some((card) => card.id === fangtian.id));
  assertGameInvariantV2(state);
});

test("a dead Wushuang source no longer doubles later Fangtian targets' Shan, including an empty Bagua judgment", () => {
  let state = playing(4, 151042);
  const source = assign(state, state.turn!.playerId, "lvbu");
  const orderedTargets = state.players.filter((entry) => entry.id !== source.id).sort((left, right) => left.seat - right.seat);
  const xiahoudun = assign(state, orderedTargets[0].id, "xiahoudun");
  const baguaTarget = assign(state, orderedTargets[1].id, "zhangfei");
  const finalTarget = assign(state, orderedTargets[2].id, "zhangfei");
  source.role = "rebel";
  xiahoudun.role = "loyalist";
  baguaTarget.role = "lord";
  finalTarget.role = "renegade";
  source.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const fangtian = take(state, (card) => card.name === "方天画戟");
  const bagua = take(state, (card) => card.name === "八卦阵");
  const sha = take(state, (card) => card.name === "杀");
  const shan = take(state, (card) => card.name === "闪");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.equipment.weapon = fangtian;
  source.hand.push(sha);
  baguaTarget.equipment.armor = bagua;
  baguaTarget.hand.push(shan);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);

  const multi = getLegalActionsV2(state, source.id).find((entry) => entry.action?.targetIds?.length === 3)!;
  assert.equal(multi.action?.targetIds?.[0], xiahoudun.id);
  state = applyGameActionV2(state, source.id, multi.action!, { nowMs: 100 });
  assert.equal((state.pending!.data as { remaining: number }).remaining, 2, "Wushuang applies while its owner is alive");
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 103 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 104 + guard },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === source.id)!.alive, false);
  assert.equal(state.pending?.kind, "optionalSkill");
  assert.equal((state.pending!.data as { skill: string }).skill, "bagua");
  assert.equal((state.pending!.data as { targetId: string }).targetId, baguaTarget.id);
  assert.ok(state.processing.some((card) => card.id === sha.id), "the multi-target Sha stays in processing until every target settles");

  const declinedBagua = applyGameActionV2(
    structuredClone(state),
    baguaTarget.id,
    getLegalActionsV2(state, baguaTarget.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 118 },
  );
  assert.equal(declinedBagua.pending?.kind, "response");
  assert.equal((declinedBagua.pending!.data as { remaining: number }).remaining, 1);
  assertGameInvariantV2(declinedBagua);

  let successfulBagua = structuredClone(state);
  const redJudge = take(successfulBagua, (card) => card.color === "red");
  successfulBagua.deck.push(redJudge);
  successfulBagua = applyGameActionV2(
    successfulBagua,
    baguaTarget.id,
    getLegalActionsV2(successfulBagua, baguaTarget.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 119 },
  );
  assert.equal(successfulBagua.pending?.kind, "response");
  assert.equal(successfulBagua.pending?.actorId, finalTarget.id, "a successful Bagua fully dodges after Wushuang's owner dies");
  assert.equal((successfulBagua.pending!.data as { remaining: number }).remaining, 1);
  assert.ok(successfulBagua.players.find((entry) => entry.id === baguaTarget.id)!.hand.some((card) => card.id === shan.id));
  assertGameInvariantV2(successfulBagua);

  exhaustDrawPiles(state, finalTarget.id);
  state = applyGameActionV2(
    state,
    baguaTarget.id,
    getLegalActionsV2(state, baguaTarget.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 120 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, baguaTarget.id);
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1, "dead generals no longer provide locked skills");
  state = applyGameActionV2(
    state,
    baguaTarget.id,
    getLegalActionsV2(state, baguaTarget.id).find((entry) => entry.action?.cardId === shan.id)!.action!,
    { nowMs: 121 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, finalTarget.id);
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
  state = applyGameActionV2(
    state,
    finalTarget.id,
    getLegalActionsV2(state, finalTarget.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 122 },
  );
  assert.ok(!state.processing.some((card) => card.id === sha.id));
  assert.notEqual(state.turn?.playerId, source.id);
  assertGameInvariantV2(state);
});

test("nullification order stays anchored after the current-turn source dies during a multi-target trick", () => {
  let state = playing(4, 151036);
  const source = assign(state, state.turn!.playerId, "zhangfei");
  const bySeat = [...state.players].sort((left, right) => left.seat - right.seat);
  const afterSource = [
    ...bySeat.filter((entry) => entry.seat > source.seat),
    ...bySeat.filter((entry) => entry.seat < source.seat),
  ];
  const xiahoudun = assign(state, afterSource[0].id, "xiahoudun");
  afterSource.slice(1).forEach((entry) => assign(state, entry.id, "zhangfei"));
  source.role = "rebel";
  xiahoudun.role = "loyalist";
  afterSource[1].role = "lord";
  afterSource[2].role = "renegade";
  source.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const invasion = take(state, (card) => card.name === "南蛮入侵");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.hand.push(invasion);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === invasion.id)!.action!,
    { nowMs: 100 },
  );
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 101 + guard },
    );
  }
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, xiahoudun.id);
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 120 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 121 },
  );
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 122 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 123 + guard },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === source.id)!.alive, false);
  assert.equal(state.pending?.kind, "nullification");
  assert.equal(state.pending?.actorId, xiahoudun.id, "action order resumes immediately after the dead current seat");
  assertGameInvariantV2(state);
});

test("dead-source action order wraps from the last seat to seat zero", () => {
  let state = playing(4, 151044);
  const bySeat = [...state.players].sort((left, right) => left.seat - right.seat);
  const source = assign(state, bySeat.at(-1)!.id, "zhangfei");
  const xiahoudun = assign(state, bySeat[0].id, "xiahoudun");
  assign(state, bySeat[1].id, "zhangfei");
  assign(state, bySeat[2].id, "zhangfei");
  source.role = "rebel";
  xiahoudun.role = "loyalist";
  bySeat[1].role = "lord";
  bySeat[2].role = "renegade";
  source.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const invasion = take(state, (card) => card.name === "南蛮入侵");
  const nonHeartJudge = take(state, (card) => card.suit !== "heart");
  source.hand.push(invasion);
  state.deck.push(nonHeartJudge);
  isolatePlay(state, source.id);

  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === invasion.id)!.action!,
    { nowMs: 100 },
  );
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 101 + guard },
    );
  }
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, xiahoudun.id);
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 120 },
  );
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 121 },
  );
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "damage")!.action!,
    { nowMs: 122 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 123 + guard },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === source.id)!.alive, false);
  assert.equal(state.pending?.kind, "nullification");
  assert.equal(state.pending?.actorId, xiahoudun.id);
  assert.equal(state.players.find((entry) => entry.id === state.pending!.actorId)!.seat, 0);
  assertGameInvariantV2(state);
});

test("template actions reject type confusion, duplicate selections, and fabricated cards or targets", () => {
  const state = playing(4, 151029);
  const actor = state.players.find((entry) => entry.hand.length >= 2)!;
  const owner = state.players.find((entry) => entry.id !== actor.id)!;
  const [first, second] = actor.hand;
  state.stack = [];
  state.pending = {
    id: "validate-ganglie-template",
    kind: "ganglieChoice",
    actorId: actor.id,
    prompt: "刚烈边界校验",
    data: { ownerId: owner.id },
  };
  const snapshot = structuredClone(state);
  const invalid: Array<{ action: GameActionV2; error: RegExp }> = [
    {
      action: { type: "playCard", skill: "ganglie_discard", cardIds: [first.id, second.id] },
      error: /动作类型不合法/,
    },
    {
      action: { type: "skill", skill: "ganglie_discard", cardIds: [first.id, first.id] },
      error: /不能重复/,
    },
    {
      action: { type: "skill", skill: "ganglie_discard", cardIds: [first.id] },
      error: /牌数量不合法/,
    },
    {
      action: { type: "skill", skill: "ganglie_discard", cardIds: [first.id, "fabricated-card"] },
      error: /候选范围/,
    },
    {
      action: { type: "skill", skill: "ganglie_discard", cardIds: [first.id, second.id], targetIds: ["fabricated-target"] },
      error: /目标.*候选范围/,
    },
  ];
  for (const { action, error } of invalid) {
    assert.throws(() => applyGameActionV2(state, actor.id, action, { nowMs: 100 }), error);
    assert.deepEqual(state, snapshot, "a rejected untrusted submission must leave the observed state untouched");
  }
  assertGameInvariantV2(state);
});

test("exact legal actions remain valid when an API client sends JSON object fields in a different order", () => {
  const state = playing(4, 151034);
  const actor = assign(state, state.turn!.playerId, "zhangfei");
  const target = state.players.find((entry) => entry.id !== actor.id && distanceV2(state, actor.id, entry.id) === 1)!;
  clearHand(state, actor.id);
  const sha = take(state, (card) => card.name === "杀");
  actor.hand.push(sha);
  isolatePlay(state, actor.id);
  const exactAction = getLegalActionsV2(state, actor.id).find(
    (entry) => entry.kind === "exact" && entry.action?.cardId === sha.id && entry.action.targetId === target.id,
  )!.action!;
  const reordered = Object.fromEntries(
    Object.entries(exactAction).filter(([, value]) => value !== undefined).reverse(),
  ) as GameActionV2;
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(exactAction));
  const next = applyGameActionV2(state, actor.id, reordered, { nowMs: 100 });
  assert.ok(next.processing.some((card) => card.id === sha.id));
  assertGameInvariantV2(next);
});

test("a matching decisionId is accepted as transport metadata on an exact action", () => {
  const state = playing(4, 151035);
  const actor = assign(state, state.turn!.playerId, "diaochan");
  state.stack = [];
  state.turn!.phase = "finish";
  state.pending = {
    id: "current-exact-decision",
    kind: "optionalSkill",
    actorId: actor.id,
    prompt: "是否发动闭月",
    data: { skill: "biyue", resume: "finish" },
  };
  const decline = getLegalActionsV2(state, actor.id).find((entry) => entry.action?.type === "pass")!.action!;
  const next = applyGameActionV2(
    state,
    actor.id,
    { ...decline, decisionId: state.pending.id },
    { nowMs: 100 },
  );
  assert.notEqual(next.pending?.id, "current-exact-decision");
  assertGameInvariantV2(next);
});

test("two points of Luoyi damage create exactly two independent Yiji assignments", () => {
  let state = playing(4, 151002);
  const source = assign(state, state.turn!.playerId, "xuchu");
  const target = assign(
    state,
    state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id,
    "guojia",
  );
  clearHand(state, source.id);
  clearHand(state, target.id);
  const sha = take(state, (card) => card.name === "杀");
  source.hand.push(sha);
  isolatePlay(state, source.id);
  state.turn!.stats.luoyi = true;

  const use = getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!;
  state = applyGameActionV2(state, source.id, use.action!, { nowMs: 100 });
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );

  let triggerCount = 0;
  const assigned = new Set<string>();
  while (state.pending?.kind === "damageTrigger") {
    assert.equal((state.pending.data as { skill: string }).skill, "yiji");
    triggerCount += 1;
    const accept = getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!;
    state = applyGameActionV2(state, target.id, accept.action!, { nowMs: 110 + triggerCount * 10 });
    while (state.pending?.kind === "yijiAssign") {
      const cardId = (state.pending.data as { cardIds: string[] }).cardIds[0];
      assigned.add(cardId);
      state = applyGameActionV2(state, target.id, { type: "choose", cardId, targetId: target.id }, { nowMs: 111 + assigned.size });
    }
  }

  assert.equal(triggerCount, 2);
  assert.equal(assigned.size, 4);
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, 1);
  assert.ok([...assigned].every((id) => state.players.find((entry) => entry.id === target.id)!.hand.some((card) => card.id === id)));
  assertGameInvariantV2(state);
});

test("Guanxing and Yiji draw across an exact deck-to-discard recycle boundary", () => {
  let state = playing(4, 151003);
  const guanxingId = state.turn!.playerId;
  assign(state, guanxingId, "zhugeliang");
  leaveDeckCards(state, 1);
  state.stack = [];
  state.pending = { id: "recycle-guanxing", kind: "optionalSkill", actorId: guanxingId, prompt: "观星", data: { skill: "guanxing", resume: "prepare" } };
  const accept = getLegalActionsV2(state, guanxingId).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, guanxingId, accept.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "guanxing");
  assert.equal((state.pending!.data as { remainingIds: string[] }).remainingIds.length, 4);
  assert.ok(state.logs.some((entry) => entry.text === "弃牌堆重新洗入牌堆。"));
  while (state.pending?.kind === "guanxing") {
    const id = (state.pending.data as { remainingIds: string[] }).remainingIds[0];
    state = applyGameActionV2(state, guanxingId, { type: "choose", cardId: id, choice: "top" }, { nowMs: 101 + state.decisionSeq });
  }
  assertGameInvariantV2(state);

  state = playing(4, 151004);
  const guojia = assign(state, state.players.find((entry) => entry.id !== state.turn!.playerId)!.id, "guojia");
  leaveDeckCards(state, 1);
  state.stack = [];
  state.pending = {
    id: "recycle-yiji",
    kind: "damageTrigger",
    actorId: guojia.id,
    prompt: "遗计",
    data: { skill: "yiji", damage: { targetId: guojia.id, amount: 1, cardIds: [], reason: "测试" } },
  };
  state = applyGameActionV2(
    state,
    guojia.id,
    getLegalActionsV2(state, guojia.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 200 },
  );
  assert.equal(state.pending?.kind, "yijiAssign");
  assert.equal((state.pending!.data as { cardIds: string[] }).cardIds.length, 2);
  assert.ok(state.logs.some((entry) => entry.text === "弃牌堆重新洗入牌堆。"));
  assertGameInvariantV2(state);
});

test("Yingzi and Zhiheng preserve exact card counts when recycling in the middle of a draw", () => {
  let state = playing(4, 151005);
  const zhouyuId = state.turn!.playerId;
  const zhouyu = assign(state, zhouyuId, "zhouyu");
  leaveDeckCards(state, 1);
  const beforeYingzi = zhouyu.hand.length;
  state.stack = [];
  state.pending = { id: "recycle-yingzi", kind: "drawChoice", actorId: zhouyuId, prompt: "英姿", data: { skill: "yingzi", drawCount: 2 } };
  state = applyGameActionV2(
    state,
    zhouyuId,
    getLegalActionsV2(state, zhouyuId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.players.find((entry) => entry.id === zhouyuId)!.hand.length, beforeYingzi + 3);
  assert.ok(state.logs.some((entry) => entry.text === "弃牌堆重新洗入牌堆。"));
  assertGameInvariantV2(state);

  state = playing(4, 151006);
  const sunquanId = state.turn!.playerId;
  const sunquan = assign(state, sunquanId, "sunquan");
  state.discard.push(...state.deck.splice(0));
  isolatePlay(state, sunquanId);
  const beforeZhiheng = sunquan.hand.length;
  const template = getLegalActionsV2(state, sunquanId).find((entry) => entry.skill === "zhiheng")!;
  state = applyGameActionV2(
    state,
    sunquanId,
    { type: "skill", skill: "zhiheng", cardIds: template.candidateCardIds!.slice(0, 2) },
    { nowMs: 200 },
  );
  assert.equal(state.players.find((entry) => entry.id === sunquanId)!.hand.length, beforeZhiheng);
  assert.ok(state.logs.some((entry) => entry.text === "弃牌堆重新洗入牌堆。"));
  assertGameInvariantV2(state);
});

test("Guanxing becomes a safe no-op when every physical card is already outside both draw piles", () => {
  let state = playing(4, 151007);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "zhugeliang");
  actor.hand.push(...state.deck.splice(0), ...state.discard.splice(0));
  state.stack = [];
  state.pending = { id: "empty-guanxing", kind: "optionalSkill", actorId, prompt: "观星", data: { skill: "guanxing", resume: "prepare" } };
  const accept = getLegalActionsV2(state, actorId).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, actorId, accept.action!, { nowMs: 100 });

  assert.notEqual(state.pending?.kind, "guanxing");
  assert.ok(state.pending ? getLegalActionsV2(state, state.pending.actorId).length > 0 : getLegalActionsV2(state, state.turn!.playerId).length > 0);
  assertGameInvariantV2(state);
});

test("Luoshen, Yingzi, and Yiji all terminate safely when no drawable card exists anywhere", () => {
  let state = playing(4, 151016);
  const zhenjiId = state.turn!.playerId;
  const zhenji = assign(state, zhenjiId, "zhenji");
  zhenji.hand.push(...state.deck.splice(0), ...state.discard.splice(0));
  state.stack = [];
  state.pending = { id: "empty-luoshen", kind: "optionalSkill", actorId: zhenjiId, prompt: "洛神", data: { skill: "luoshen", resume: "prepare" } };
  state = applyGameActionV2(
    state,
    zhenjiId,
    getLegalActionsV2(state, zhenjiId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 100 },
  );
  assert.notEqual(state.pending?.kind, "judgment");
  assert.notEqual(state.pending?.kind, "luoshenContinue");
  assert.ok(getLegalActionsV2(state, state.pending?.actorId ?? state.turn!.playerId).length > 0);
  assertGameInvariantV2(state);

  state = playing(4, 151017);
  const zhouyuId = state.turn!.playerId;
  const zhouyu = assign(state, zhouyuId, "zhouyu");
  zhouyu.hand.push(...state.deck.splice(0), ...state.discard.splice(0));
  const before = zhouyu.hand.length;
  state.stack = [];
  state.pending = { id: "empty-yingzi", kind: "drawChoice", actorId: zhouyuId, prompt: "英姿", data: { skill: "yingzi", drawCount: 2 } };
  state = applyGameActionV2(
    state,
    zhouyuId,
    getLegalActionsV2(state, zhouyuId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 200 },
  );
  assert.equal(state.players.find((entry) => entry.id === zhouyuId)!.hand.length, before);
  assert.ok(getLegalActionsV2(state, state.pending?.actorId ?? state.turn!.playerId).length > 0);
  assertGameInvariantV2(state);

  state = playing(4, 151018);
  const guojiaId = state.players.find((entry) => entry.id !== state.turn!.playerId)!.id;
  const guojia = assign(state, guojiaId, "guojia");
  guojia.hand.push(...state.deck.splice(0), ...state.discard.splice(0));
  state.stack = [];
  state.pending = { id: "empty-yiji", kind: "damageTrigger", actorId: guojiaId, prompt: "遗计", data: { skill: "yiji", damage: { targetId: guojiaId, amount: 1, cardIds: [], reason: "测试" } } };
  state = applyGameActionV2(
    state,
    guojiaId,
    getLegalActionsV2(state, guojiaId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 300 },
  );
  assert.notEqual(state.pending?.kind, "yijiAssign");
  assert.ok(getLegalActionsV2(state, state.pending?.actorId ?? state.turn!.playerId).length > 0);
  assertGameInvariantV2(state);
});

test("Luoshen resumes the phase sequence exactly once after a red result or decline", () => {
  let state = playing(4, 151019);
  const actorId = state.turn!.playerId;
  const zhenji = assign(state, actorId, "zhenji");
  state.players.filter((entry) => entry.id !== actorId).forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, actorId);
  const red = take(state, (card) => card.color === "red");
  state.deck.push(red);
  state.stack = [];
  state.turn = { playerId: actorId, phase: "prepare", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
  state.pending = { id: "luoshen-red-once", kind: "optionalSkill", actorId, prompt: "洛神", data: { skill: "luoshen", resume: "prepare" } };
  state = applyGameActionV2(
    state,
    actorId,
    getLegalActionsV2(state, actorId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.turn?.phase, "play");
  assert.equal(zhenji.id, actorId);
  assert.equal(state.players.find((entry) => entry.id === actorId)!.hand.length, 2, "normal draw phase must execute once");
  assert.equal(state.stack.length, 0);
  assertGameInvariantV2(state);

  state = playing(4, 151020);
  const declineId = state.turn!.playerId;
  assign(state, declineId, "zhenji");
  state.players.filter((entry) => entry.id !== declineId).forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, declineId);
  const black = take(state, (card) => card.color === "black");
  state.deck.push(black);
  state.stack = [];
  state.turn = { playerId: declineId, phase: "prepare", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
  state.pending = { id: "luoshen-decline-once", kind: "optionalSkill", actorId: declineId, prompt: "洛神", data: { skill: "luoshen", resume: "prepare" } };
  state = applyGameActionV2(
    state,
    declineId,
    getLegalActionsV2(state, declineId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 200 },
  );
  assert.equal(state.pending?.kind, "luoshenContinue");
  state = applyGameActionV2(
    state,
    declineId,
    getLegalActionsV2(state, declineId).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 201 },
  );
  assert.equal(state.turn?.phase, "play");
  assert.equal(state.players.find((entry) => entry.id === declineId)!.hand.length, 3, "one black Luoshen card plus one normal draw phase");
  assert.equal(state.stack.length, 0);
  assertGameInvariantV2(state);
});

test("every optional judgment path has a legal fallback when no judgment card exists", () => {
  let state = playing(4, 151021);
  const source = assign(state, state.turn!.playerId, "lvbu");
  const target = assign(state, state.players.find((entry) => entry.id !== source.id)!.id, "caocao");
  const armor = take(state, (card) => card.name === "八卦阵");
  target.equipment.armor = armor;
  clearHand(state, target.id);
  exhaustDrawPiles(state, source.id);
  isolatePlay(state, source.id);
  const shaUse = { id: "empty-bagua-sha", sourceId: source.id, name: "杀" as const, cardIds: [], color: "black" as const, targets: [target.id], targetIndex: 0 };
  state.pending = { id: "empty-bagua", kind: "optionalSkill", actorId: target.id, prompt: "八卦阵", data: { skill: "bagua", resume: "sha", use: shaUse, targetId: target.id } };
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, target.id);
  assert.equal((state.pending!.data as { remaining: number }).remaining, 2);
  assert.equal((state.pending!.data as { baguaTried?: boolean }).baguaTried, true);
  assert.ok(getLegalActionsV2(state, target.id).length > 0);
  assertGameInvariantV2(state);

  state = playing(4, 151043);
  const ordinarySource = assign(state, state.turn!.playerId, "zhangfei");
  const ordinaryTarget = assign(state, state.players.find((entry) => entry.id !== ordinarySource.id)!.id, "caocao");
  const ordinaryArmor = take(state, (card) => card.name === "八卦阵");
  ordinaryTarget.equipment.armor = ordinaryArmor;
  clearHand(state, ordinaryTarget.id);
  exhaustDrawPiles(state, ordinarySource.id);
  isolatePlay(state, ordinarySource.id);
  const ordinaryUse = { id: "empty-ordinary-bagua", sourceId: ordinarySource.id, name: "杀" as const, cardIds: [], color: "black" as const, targets: [ordinaryTarget.id], targetIndex: 0 };
  state.pending = { id: "empty-ordinary-bagua", kind: "optionalSkill", actorId: ordinaryTarget.id, prompt: "八卦阵", data: { skill: "bagua", resume: "sha", use: ordinaryUse, targetId: ordinaryTarget.id } };
  state = applyGameActionV2(
    state,
    ordinaryTarget.id,
    getLegalActionsV2(state, ordinaryTarget.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 150 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
  assertGameInvariantV2(state);

  state = playing(4, 151022);
  const responder = assign(state, state.players.find((entry) => entry.id !== state.turn!.playerId)!.id, "caocao");
  const responseArmor = take(state, (card) => card.name === "八卦阵");
  responder.equipment.armor = responseArmor;
  clearHand(state, responder.id);
  exhaustDrawPiles(state, state.turn!.playerId);
  state.stack = [];
  state.pending = {
    id: "empty-response-bagua",
    kind: "response",
    actorId: responder.id,
    prompt: "请打出闪",
    data: {
      required: "闪",
      remaining: 1,
      use: { id: "empty-aoe", sourceId: state.turn!.playerId, name: "万箭齐发", cardIds: [], color: "none", targets: [responder.id], targetIndex: 0 },
      targetId: responder.id,
      kind: "aoe",
    },
  };
  state = applyGameActionV2(
    state,
    responder.id,
    getLegalActionsV2(state, responder.id).find((entry) => entry.action?.skill === "bagua")!.action!,
    { nowMs: 200 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, responder.id);
  assert.equal((state.pending!.data as { baguaTried?: boolean }).baguaTried, true);
  assert.ok(!getLegalActionsV2(state, responder.id).some((entry) => entry.action?.skill === "bagua"));
  assertGameInvariantV2(state);

  state = playing(4, 151023);
  const lord = assign(state, state.players.find((entry) => entry.role === "lord")!.id, "caocao");
  const provider = assign(state, state.players.find((entry) => entry.id !== lord.id)!.id, "zhenji");
  const attacker = state.players.find((entry) => entry.id !== lord.id && entry.id !== provider.id)!;
  clearHand(state, provider.id);
  const providerArmor = take(state, (card) => card.name === "八卦阵");
  const shan = take(state, (card) => card.name === "闪");
  provider.equipment.armor = providerArmor;
  provider.hand.push(shan);
  exhaustDrawPiles(state, attacker.id);
  state.stack = [];
  state.pending = {
    id: "empty-hujia-bagua",
    kind: "lordRequest",
    actorId: provider.id,
    prompt: "请为护驾提供闪",
    data: {
      skill: "hujia",
      lordId: lord.id,
      mode: "response",
      providers: [provider.id],
      cursor: 0,
      responseData: {
        required: "闪",
        remaining: 1,
        use: { id: "empty-hujia-use", sourceId: attacker.id, name: "杀", cardIds: [], color: "black", targets: [lord.id], targetIndex: 0 },
        targetId: lord.id,
        kind: "sha",
      },
    },
  };
  state = applyGameActionV2(
    state,
    provider.id,
    getLegalActionsV2(state, provider.id).find((entry) => entry.action?.skill === "bagua")!.action!,
    { nowMs: 300 },
  );
  assert.equal(state.pending?.kind, "lordRequest");
  assert.equal(state.pending?.actorId, provider.id);
  assert.ok(!getLegalActionsV2(state, provider.id).some((entry) => entry.action?.skill === "bagua"));
  assert.ok(getLegalActionsV2(state, provider.id).some((entry) => entry.action?.cardId === shan.id));
  assertGameInvariantV2(state);

  state = playing(4, 151024);
  const machao = assign(state, state.turn!.playerId, "machao");
  const tieqiTarget = assign(state, state.players.find((entry) => entry.id !== machao.id)!.id, "caocao");
  exhaustDrawPiles(state, machao.id);
  isolatePlay(state, machao.id);
  const tieqiUse = {
    id: "empty-tieqi-use",
    sourceId: machao.id,
    name: "杀" as const,
    cardIds: [],
    color: "black" as const,
    targets: [tieqiTarget.id],
    targetIndex: 0,
    data: { [`sha:${tieqiTarget.id}`]: { tieqi: true } },
  };
  state.pending = { id: "empty-tieqi", kind: "tieqi", actorId: machao.id, prompt: "铁骑", data: { use: tieqiUse, targetId: tieqiTarget.id } };
  state = applyGameActionV2(
    state,
    machao.id,
    getLegalActionsV2(state, machao.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 400 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, tieqiTarget.id);
  assert.ok(getLegalActionsV2(state, tieqiTarget.id).length > 0);
  assertGameInvariantV2(state);
});

test("delayed tricks and Ganglie also resume safely when no judgment card exists", () => {
  const resolveEmptyDelayed = (name: "乐不思蜀" | "闪电", seed: number) => {
    let state = playing(4, seed);
    const target = state.players.find((entry) => entry.id === state.turn!.playerId)!;
    const delayed = take(state, (card) => card.name === name);
    delayed.asName = name;
    state.processing.push(delayed);
    exhaustDrawPiles(state, target.id);
    state.stack = [];
    state.turn = { playerId: target.id, phase: "judge", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
    const ordered = [...state.players].filter((entry) => entry.alive).sort((left, right) => left.seat - right.seat);
    const start = ordered.findIndex((entry) => entry.id === target.id);
    const order = [...ordered.slice(start), ...ordered.slice(0, start)].map((entry) => entry.id);
    state.pending = {
      id: `empty-delayed-${name}`,
      kind: "nullification",
      actorId: order[0],
      prompt: `${name} 即将生效`,
      data: {
        use: { id: `empty-${name}-use`, sourceId: target.id, name, cardIds: [delayed.id], color: "none", targets: [target.id], targetIndex: 0 },
        targetId: target.id,
        order,
        cursor: 0,
        passes: 0,
        parity: 0,
        continuation: "delayed",
      },
    };
    for (let guard = 0; state.pending?.kind === "nullification" && guard < order.length + 1; guard += 1) {
      const actorId = state.pending.actorId;
      state = applyGameActionV2(
        state,
        actorId,
        getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
        { nowMs: 100 + guard },
      );
    }
    assert.equal(state.turn?.phase, "play");
    assert.equal(state.pending, null);
    assert.equal(state.stack.length, 0);
    assert.ok(getLegalActionsV2(state, target.id).length > 0);
    assert.ok(state.logs.some((entry) => entry.text.includes("没有可用判定牌")));
    assertGameInvariantV2(state);
    return { state, delayed, target };
  };

  const indulgence = resolveEmptyDelayed("乐不思蜀", 151025);
  assert.ok(!indulgence.state.players.some((entry) => entry.judgment.some((card) => card.id === indulgence.delayed.id)));
  assert.ok(!indulgence.state.processing.some((card) => card.id === indulgence.delayed.id));
  assert.ok(!indulgence.state.turn!.skipped.includes("play"));

  const lightning = resolveEmptyDelayed("闪电", 151026);
  assert.ok(lightning.state.players.some((entry) => entry.id !== lightning.target.id && entry.judgment.some((card) => card.id === lightning.delayed.id)));
  assert.ok(!lightning.state.processing.some((card) => card.id === lightning.delayed.id));

  let state = playing(4, 151027);
  const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const xiahoudun = assign(state, state.players.find((entry) => entry.id !== source.id)!.id, "xiahoudun");
  exhaustDrawPiles(state, source.id);
  state.stack = [];
  state.pending = {
    id: "empty-ganglie",
    kind: "damageTrigger",
    actorId: xiahoudun.id,
    prompt: "刚烈",
    data: { skill: "ganglie", damage: { sourceId: source.id, targetId: xiahoudun.id, amount: 1, cardIds: [], reason: "测试" } },
  };
  state = applyGameActionV2(
    state,
    xiahoudun.id,
    getLegalActionsV2(state, xiahoudun.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 300 },
  );
  assert.notEqual(state.pending?.kind, "ganglieChoice");
  assert.ok(state.logs.some((entry) => entry.text.includes("【刚烈】没有可用判定牌")));
  assert.ok(getLegalActionsV2(state, state.turn!.playerId).length > 0);
  assertGameInvariantV2(state);
});

test("Jiuyuan bonus is limited to another Wu provider healing the identity lord", () => {
  const recover = (kind: "wu-other" | "wei-other" | "self" | "nonlord" | "duel") => {
    let state = playing(kind === "duel" ? 2 : 4, 151100 + ["wu-other", "wei-other", "self", "nonlord", "duel"].indexOf(kind));
    let target = kind === "nonlord"
      ? state.players.find((entry) => entry.role !== "lord")!
      : state.players.find((entry) => entry.role === "lord")!;
    target = assign(state, target.id, "sunquan");
    const provider = kind === "self" ? target : state.players.find((entry) => entry.id !== target.id)!;
    assign(state, provider.id, kind === "wei-other" ? "caocao" : "ganning");
    target.hp = 0;
    const peach = take(state, (card) => card.name === "桃");
    provider.hand.push(peach);
    state.stack = [];
    state.pending = { id: `jiuyuan-${kind}`, kind: "rescue", actorId: provider.id, prompt: "濒死", data: { targetId: target.id, order: state.players.map((entry) => entry.id), cursor: 0, passes: 0 } };
    state = applyGameActionV2(
      state,
      provider.id,
      getLegalActionsV2(state, provider.id).find((entry) => entry.action?.cardId === peach.id)!.action!,
      { nowMs: 100 },
    );
    assertGameInvariantV2(state);
    return state.players.find((entry) => entry.id === target.id)!.hp;
  };

  assert.equal(recover("wu-other"), 2);
  assert.equal(recover("wei-other"), 1);
  assert.equal(recover("self"), 1);
  assert.equal(recover("nonlord"), 1);
  assert.equal(recover("duel"), 1);
});

test("Keji is offered only without a Sha and Biyue decline cannot re-prompt forever", () => {
  let state = playing(4, 151008);
  const lvmengId = state.turn!.playerId;
  const lvmeng = assign(state, lvmengId, "lvmeng");
  lvmeng.hp = 1;
  isolatePlay(state, lvmengId);
  const handBeforeKeji = lvmeng.hand.length;
  state = applyGameActionV2(state, lvmengId, { type: "endTurn" }, { nowMs: 100 });
  assert.equal(state.pending?.kind, "optionalSkill");
  assert.equal((state.pending!.data as { skill: string }).skill, "keji");
  state = applyGameActionV2(
    state,
    lvmengId,
    getLegalActionsV2(state, lvmengId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.players.find((entry) => entry.id === lvmengId)!.hand.length, handBeforeKeji);
  assert.ok(state.logs.some((entry) => entry.text.includes("发动【克己】")));

  state = playing(4, 151009);
  const usedShaId = state.turn!.playerId;
  const usedSha = assign(state, usedShaId, "lvmeng");
  usedSha.hp = 1;
  isolatePlay(state, usedShaId);
  state.turn!.stats.shaUsedOrPlayed = true;
  state = applyGameActionV2(state, usedShaId, { type: "endTurn" }, { nowMs: 200 });
  assert.equal(state.pending?.kind, "discardPhase");

  state = playing(4, 151010);
  const diaochanId = state.turn!.playerId;
  const diaochan = assign(state, diaochanId, "diaochan");
  const beforeBiyue = diaochan.hand.length;
  state.stack = [];
  state.turn!.phase = "finish";
  state.pending = { id: "biyue-decline", kind: "optionalSkill", actorId: diaochanId, prompt: "闭月", data: { skill: "biyue", resume: "finish" } };
  const decline = getLegalActionsV2(state, diaochanId).find((entry) => entry.action?.type === "pass")!;
  state = applyGameActionV2(state, diaochanId, decline.action!, { nowMs: 300 });
  assert.equal(state.players.find((entry) => entry.id === diaochanId)!.hand.length, beforeBiyue);
  assert.ok(!(state.pending?.kind === "optionalSkill" && (state.pending.data as { skill?: string }).skill === "biyue"));
  assert.ok(!state.logs.some((entry) => entry.text.includes("发动【闭月】")));
  assertGameInvariantV2(state);
});

test("a Sha played as a Duel response during one's own play phase disables Keji", () => {
  let state = playing(4, 151038);
  const lvmeng = assign(state, state.turn!.playerId, "lvmeng");
  const target = assign(state, state.players.find((entry) => entry.id !== lvmeng.id)!.id, "zhangfei");
  state.players
    .filter((entry) => entry.id !== lvmeng.id && entry.id !== target.id)
    .forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, lvmeng.id);
  clearHand(state, target.id);
  const duel = take(state, (card) => card.name === "决斗");
  const ownSha = take(state, (card) => card.name === "杀");
  const targetSha = take(state, (card) => card.name === "杀" && card.id !== ownSha.id);
  const extraOne = take(state, (card) => ![duel.id, ownSha.id, targetSha.id].includes(card.id));
  const extraTwo = take(state, (card) => ![duel.id, ownSha.id, targetSha.id, extraOne.id].includes(card.id));
  lvmeng.hp = 1;
  lvmeng.hand.push(duel, ownSha, extraOne, extraTwo);
  target.hand.push(targetSha);
  isolatePlay(state, lvmeng.id);
  state = applyGameActionV2(
    state,
    lvmeng.id,
    getLegalActionsV2(state, lvmeng.id).find((entry) => entry.action?.cardId === duel.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 101 + guard },
    );
  }
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === targetSha.id)!.action!,
    { nowMs: 120 },
  );
  state = applyGameActionV2(
    state,
    lvmeng.id,
    getLegalActionsV2(state, lvmeng.id).find((entry) => entry.action?.cardId === ownSha.id)!.action!,
    { nowMs: 121 },
  );
  assert.equal(state.turn!.stats.shaUsedOrPlayed, true);
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 122 },
  );
  state = applyGameActionV2(
    state,
    lvmeng.id,
    getLegalActionsV2(state, lvmeng.id).find((entry) => entry.action?.type === "endTurn")!.action!,
    { nowMs: 123 },
  );
  assert.equal(state.pending?.kind, "discardPhase");
  assert.ok(!(state.pending?.kind === "optionalSkill" && (state.pending.data as { skill?: string }).skill === "keji"));
  assertGameInvariantV2(state);
});

test("Hujia visits only Wei providers once and cannot recursively retry after all decline", () => {
  let state = playing(4, 151011);
  const lord = state.players.find((entry) => entry.role === "lord")!;
  assign(state, lord.id, "caocao");
  const others = state.players.filter((entry) => entry.id !== lord.id);
  assign(state, others[0].id, "zhenji");
  assign(state, others[1].id, "simayi");
  assign(state, others[2].id, "liubei");
  const attacker = others[2];
  state.stack = [];
  state.pending = {
    id: "hujia-decline-all",
    kind: "response",
    actorId: lord.id,
    prompt: "请打出闪",
    data: {
      required: "闪",
      remaining: 1,
      use: { id: "hujia-use", sourceId: attacker.id, name: "杀", cardIds: [], color: "black", targets: [lord.id], targetIndex: 0 },
      targetId: lord.id,
      kind: "sha",
    },
  };
  const hujia = getLegalActionsV2(state, lord.id).find((entry) => entry.action?.skill === "hujia")!;
  state = applyGameActionV2(state, lord.id, hujia.action!, { nowMs: 100 });
  const providerIds = (state.pending!.data as { providers: string[] }).providers;
  assert.deepEqual(new Set(providerIds), new Set([others[0].id, others[1].id]));
  for (const providerId of providerIds) {
    assert.equal(state.pending?.kind, "lordRequest");
    assert.equal(state.pending?.actorId, providerId);
    state = applyGameActionV2(
      state,
      providerId,
      getLegalActionsV2(state, providerId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 101 + state.decisionSeq },
    );
  }
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, lord.id);
  assert.equal((state.pending!.data as { lordSkillTried?: boolean }).lordSkillTried, true);
  assert.ok(!getLegalActionsV2(state, lord.id).some((entry) => entry.action?.skill === "hujia"));
  assertGameInvariantV2(state);
});

test("Wushuang finishes exactly after two Shan and alternates Duel requirements by responder", () => {
  let state = playing(4, 151012);
  const lvbu = assign(state, state.turn!.playerId, "lvbu");
  const target = assign(state, state.players.find((entry) => entry.id !== lvbu.id)!.id, "caocao");
  clearHand(state, lvbu.id);
  clearHand(state, target.id);
  const sha = take(state, (card) => card.name === "杀");
  const shanOne = take(state, (card) => card.name === "闪");
  const shanTwo = take(state, (card) => card.name === "闪");
  lvbu.hand.push(sha);
  target.hand.push(shanOne, shanTwo);
  isolatePlay(state, lvbu.id);
  const hpBefore = target.hp;
  state = applyGameActionV2(
    state,
    lvbu.id,
    getLegalActionsV2(state, lvbu.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  for (const card of [shanOne, shanTwo]) {
    assert.equal((state.pending!.data as { remaining: number }).remaining, card === shanOne ? 2 : 1);
    state = applyGameActionV2(
      state,
      target.id,
      getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === card.id)!.action!,
      { nowMs: 101 + state.decisionSeq },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  assert.notEqual(state.pending?.kind, "response");

  state = playing(4, 151013);
  const duelLvbu = assign(state, state.turn!.playerId, "lvbu");
  const duelTarget = assign(state, state.players.find((entry) => entry.id !== duelLvbu.id)!.id, "caocao");
  clearHand(state, duelLvbu.id);
  clearHand(state, duelTarget.id);
  const duel = take(state, (card) => card.name === "决斗");
  const targetShaOne = take(state, (card) => card.name === "杀");
  const targetShaTwo = take(state, (card) => card.name === "杀");
  const lvbuSha = take(state, (card) => card.name === "杀");
  duelLvbu.hand.push(duel, lvbuSha);
  duelTarget.hand.push(targetShaOne, targetShaTwo);
  isolatePlay(state, duelLvbu.id);
  state = applyGameActionV2(
    state,
    duelLvbu.id,
    getLegalActionsV2(state, duelLvbu.id).find((entry) => entry.action?.cardId === duel.id && entry.action.targetId === duelTarget.id)!.action!,
    { nowMs: 200 },
  );
  for (let guard = 0; state.pending?.kind === "nullification" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 201 + guard },
    );
  }
  assert.equal(state.pending?.actorId, duelTarget.id);
  assert.equal((state.pending!.data as { remaining: number }).remaining, 2);
  for (const card of [targetShaOne, targetShaTwo]) {
    state = applyGameActionV2(
      state,
      duelTarget.id,
      getLegalActionsV2(state, duelTarget.id).find((entry) => entry.action?.cardId === card.id)!.action!,
      { nowMs: 220 + state.decisionSeq },
    );
  }
  assert.equal(state.pending?.actorId, duelLvbu.id);
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
  state = applyGameActionV2(
    state,
    duelLvbu.id,
    getLegalActionsV2(state, duelLvbu.id).find((entry) => entry.action?.cardId === lvbuSha.id)!.action!,
    { nowMs: 230 },
  );
  assert.equal(state.pending?.actorId, duelTarget.id);
  assert.equal((state.pending!.data as { remaining: number }).remaining, 2);
  assertGameInvariantV2(state);
});

test("Lianying resolves between Wushuang's two sequential Shan responses and may supply the second Shan", () => {
  let state = playing(4, 151031);
  const source = assign(state, state.turn!.playerId, "lvbu");
  const target = assign(
    state,
    state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id,
    "luxun",
  );
  state.players
    .filter((entry) => entry.id !== source.id && entry.id !== target.id)
    .forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, source.id);
  clearHand(state, target.id);
  const sha = take(state, (card) => card.name === "杀");
  const firstShan = take(state, (card) => card.name === "闪");
  const secondShan = take(state, (card) => card.name === "闪" && card.id !== firstShan.id);
  source.hand.push(sha);
  target.hand.push(firstShan);
  state.deck.push(secondShan);
  isolatePlay(state, source.id);
  const hpBefore = target.hp;
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === firstShan.id)!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "lossTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "lianying");
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
  assert.ok(getLegalActionsV2(state, target.id).some((entry) => entry.action?.cardId === secondShan.id));
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === secondShan.id)!.action!,
    { nowMs: 103 },
  );
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  assertGameInvariantV2(state);
});

test("losing two equipment cards to the loyalist-kill penalty queues two independent Xiaoji decisions", () => {
  let state = playing(4, 151039);
  const source = assign(state, state.turn!.playerId, "sunshangxiang");
  const target = assign(
    state,
    state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id,
    "zhangfei",
  );
  const others = state.players.filter((entry) => entry.id !== source.id && entry.id !== target.id);
  source.role = "lord";
  target.role = "loyalist";
  others[0].role = "rebel";
  others[1].role = "renegade";
  target.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const sha = take(state, (card) => card.name === "杀");
  const armor = take(state, (card) => card.slot === "armor");
  const horse = take(state, (card) => card.slot === "defensiveHorse");
  source.hand.push(sha);
  source.equipment.armor = armor;
  source.equipment.defensiveHorse = horse;
  isolatePlay(state, source.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 102 + guard },
    );
  }
  assert.equal(state.pending?.kind, "lossTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "xiaoji");
  assert.equal(state.players.find((entry) => entry.id === source.id)!.equipment.armor, null);
  assert.equal(state.players.find((entry) => entry.id === source.id)!.equipment.defensiveHorse, null);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 120 },
  );
  assert.equal(state.pending?.kind, "lossTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "xiaoji");
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 121 },
  );
  assert.notEqual(state.pending?.kind, "lossTrigger");
  assert.equal(state.players.find((entry) => entry.id === source.id)!.hand.length, 2);
  assert.ok([sha.id, armor.id, horse.id].every((id) => state.discard.some((card) => card.id === id)));
  assertGameInvariantV2(state);
});
