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

const seats = (count = 4): LobbySeat[] => Array.from({ length: count }, (_, seat) => ({
  id: `equipment-${seat}`,
  name: `装备玩家${seat + 1}`,
  kind: "human",
  seat,
}));

function instantiate(option: LegalActionV2): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  if (option.kind === "discard") return { type: "discard", cardIds: option.candidateCardIds!.slice(0, option.minCards) };
  return {
    type: "skill",
    skill: option.skill,
    cardIds: option.candidateCardIds?.slice(0, option.minCards ?? 0),
    targetIds: option.targetIds?.slice(0, option.minTargets ?? 0),
  };
}

function playing(seed: number, count = 4) {
  let state = createGameV2(seats(count), { seed }, { nowMs: 1 });
  for (let step = 0; state.status === "setup" && step < 300; step += 1) {
    const actorId = state.pending!.actorId;
    const legal = getLegalActionsV2(state, actorId);
    state = applyGameActionV2(state, actorId, instantiate(legal.find((entry) => entry.action?.type !== "pass") ?? legal[0]), { nowMs: step + 2 });
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

function nearest(state: GameStateV2, sourceId: string) {
  return state.players.find((entry) => entry.id !== sourceId && distanceV2(state, sourceId, entry.id) === 1)!;
}

test("Zhuge Crossbow grants only the equipment-based repeat-Sha exception", () => {
  const state = playing(153001);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "caocao");
  const target = nearest(state, actorId);
  clearHand(state, actorId);
  const crossbow = take(state, (card) => card.name === "诸葛连弩");
  const sha = take(state, (card) => card.name === "杀");
  actor.equipment.weapon = crossbow;
  actor.hand.push(sha);
  isolatePlay(state, actorId);
  state.turn!.shaUsed = 1;
  assert.ok(getLegalActionsV2(state, actorId).some((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id));
  actor.equipment.weapon = null;
  state.discard.push(crossbow);
  assert.ok(!getLegalActionsV2(state, actorId).some((entry) => entry.action?.cardId === sha.id));
  assertGameInvariantV2(state);
});

test("Double-Sword triggers only across genders and resolves both discard and draw choices", () => {
  const initial = playing(153002);
  const sourceId = initial.turn!.playerId;
  const source = assign(initial, sourceId, "caocao");
  const target = assign(initial, nearest(initial, sourceId).id, "zhenji");
  clearHand(initial, sourceId);
  clearHand(initial, target.id);
  const sword = take(initial, (card) => card.name === "雌雄双股剑");
  const sha = take(initial, (card) => card.name === "杀");
  const cost = take(initial, (card) => !["闪", "桃"].includes(card.name));
  source.equipment.weapon = sword;
  source.hand.push(sha);
  target.hand.push(cost);
  isolatePlay(initial, sourceId);
  const use = getLegalActionsV2(initial, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!;
  const triggered = applyGameActionV2(initial, sourceId, use.action!, { nowMs: 100 });
  assert.equal(triggered.pending?.kind, "cixiong");

  const declined = applyGameActionV2(
    structuredClone(triggered),
    sourceId,
    getLegalActionsV2(triggered, sourceId).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 100 },
  );
  assert.equal(declined.pending?.kind, "response");
  assert.equal(declined.pending?.actorId, target.id);

  let discarded = applyGameActionV2(
    structuredClone(triggered),
    sourceId,
    getLegalActionsV2(triggered, sourceId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.equal(discarded.pending?.kind, "cixiongChoice");
  discarded = applyGameActionV2(
    discarded,
    target.id,
    getLegalActionsV2(discarded, target.id).find((entry) => entry.action?.cardId === cost.id)!.action!,
    { nowMs: 102 },
  );
  assert.ok(discarded.discard.some((card) => card.id === cost.id));

  let drew = applyGameActionV2(
    structuredClone(triggered),
    sourceId,
    getLegalActionsV2(triggered, sourceId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 103 },
  );
  const handBefore = drew.players.find((entry) => entry.id === sourceId)!.hand.length;
  drew = applyGameActionV2(
    drew,
    target.id,
    getLegalActionsV2(drew, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 104 },
  );
  assert.equal(drew.players.find((entry) => entry.id === sourceId)!.hand.length, handBefore + 1);

  const emptyTarget = structuredClone(initial);
  const emptyTargetPlayer = emptyTarget.players.find((entry) => entry.id === target.id)!;
  emptyTarget.discard.push(...emptyTargetPlayer.hand.splice(0));
  let autoDraw = applyGameActionV2(emptyTarget, sourceId, use.action!, { nowMs: 104 });
  const beforeAutoDraw = autoDraw.players.find((entry) => entry.id === sourceId)!.hand.length;
  autoDraw = applyGameActionV2(
    autoDraw,
    sourceId,
    getLegalActionsV2(autoDraw, sourceId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 105 },
  );
  assert.equal(autoDraw.players.find((entry) => entry.id === sourceId)!.hand.length, beforeAutoDraw + 1);
  assert.equal(autoDraw.pending?.kind, "response");

  const sameGender = structuredClone(initial);
  assign(sameGender, target.id, "caocao");
  const direct = applyGameActionV2(sameGender, sourceId, use.action!, { nowMs: 106 });
  assert.notEqual(direct.pending?.kind, "cixiong");
});

test("Tieqi's general trigger resolves before Double-Sword's equipment trigger at the same target timing", () => {
  let state = playing(153022);
  const source = assign(state, state.turn!.playerId, "machao");
  const target = assign(state, nearest(state, source.id).id, "zhenji");
  state.players
    .filter((entry) => entry.id !== source.id && entry.id !== target.id)
    .forEach((entry) => assign(state, entry.id, "zhangfei"));
  clearHand(state, source.id);
  clearHand(state, target.id);
  const sword = take(state, (card) => card.name === "雌雄双股剑");
  const sha = take(state, (card) => card.name === "杀");
  const redJudge = take(state, (card) => card.color === "red");
  const blackDraw = take(state, (card) => card.color === "black" && card.id !== redJudge.id);
  source.equipment.weapon = sword;
  source.hand.push(sha);
  state.deck.push(blackDraw, redJudge);
  isolatePlay(state, source.id);
  const hpBefore = target.hp;
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.pending?.kind, "tieqi");
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "cixiong");
  assert.ok(state.discard.some((card) => card.id === redJudge.id));
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  assert.ok(state.players.find((entry) => entry.id === source.id)!.hand.some((card) => card.id === blackDraw.id));
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore - 1);
  assertGameInvariantV2(state);
});

test("Ice Sword either declines into damage or prevents it while discarding at most two cards", () => {
  const initial = playing(153003);
  const sourceId = initial.turn!.playerId;
  const source = assign(initial, sourceId, "caocao");
  const target = assign(initial, nearest(initial, sourceId).id, "zhangfei");
  clearHand(initial, sourceId);
  clearHand(initial, target.id);
  const weapon = take(initial, (card) => card.name === "寒冰剑");
  const sha = take(initial, (card) => card.name === "杀");
  const firstCard = take(initial, (card) => !["闪", "桃"].includes(card.name));
  const secondCard = take(initial, (card) => !["闪", "桃"].includes(card.name) && card.id !== firstCard.id);
  source.equipment.weapon = weapon;
  source.hand.push(sha);
  target.hand.push(firstCard, secondCard);
  isolatePlay(initial, sourceId);
  let pending = applyGameActionV2(
    initial,
    sourceId,
    getLegalActionsV2(initial, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  pending = applyGameActionV2(
    pending,
    target.id,
    getLegalActionsV2(pending, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.equal(pending.pending?.kind, "hanbing");
  const hpBefore = target.hp;

  const declined = applyGameActionV2(
    structuredClone(pending),
    sourceId,
    getLegalActionsV2(pending, sourceId).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  assert.equal(declined.players.find((entry) => entry.id === target.id)!.hp, hpBefore - 1);

  let prevented = applyGameActionV2(
    structuredClone(pending),
    sourceId,
    getLegalActionsV2(pending, sourceId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 103 },
  );
  for (let index = 0; prevented.pending?.kind === "hanbingChoice" && index < 2; index += 1) {
    prevented = applyGameActionV2(
      prevented,
      sourceId,
      getLegalActionsV2(prevented, sourceId).find((entry) => entry.action?.zone === "hand")!.action!,
      { nowMs: 104 + index },
    );
  }
  assert.equal(prevented.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  assert.equal(prevented.players.find((entry) => entry.id === target.id)!.hand.length, 0);
  assertGameInvariantV2(prevented);
});

test("Green-Dragon follow-up Sha preserves Wusheng physical-card provenance", () => {
  let state = playing(153004);
  const sourceId = state.turn!.playerId;
  const source = assign(state, sourceId, "guanyu");
  const target = assign(state, nearest(state, sourceId).id, "caocao");
  clearHand(state, sourceId);
  clearHand(state, target.id);
  const weapon = take(state, (card) => card.name === "青龙偃月刀");
  const firstSha = take(state, (card) => card.name === "杀");
  const converted = take(state, (card) => card.color === "red" && !["杀", "闪", "桃"].includes(card.name));
  const shan = take(state, (card) => card.name === "闪");
  source.equipment.weapon = weapon;
  source.hand.push(firstSha, converted);
  target.hand.push(shan);
  isolatePlay(state, sourceId);
  const hpBefore = target.hp;
  state = applyGameActionV2(
    state,
    sourceId,
    getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === firstSha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === shan.id)!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "qinglong");
  const declined = applyGameActionV2(
    structuredClone(state),
    sourceId,
    getLegalActionsV2(state, sourceId).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  assert.equal(declined.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  assert.notEqual(declined.pending?.kind, "qinglong");
  const followUp = getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === converted.id && entry.action?.skill === "wusheng")!;
  state = applyGameActionV2(state, sourceId, followUp.action!, { nowMs: 102 });
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 103 },
  );
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore - 1);
  assert.match(state.logs.findLast((entry) => entry.text.includes("【青龙偃月刀】"))!.text, new RegExp(`【武圣】.*【${converted.name}】.*【杀】`));
  assertGameInvariantV2(state);
});

test("Spear converts exactly two hand cards in both play and response contexts with public provenance", () => {
  let state = playing(153005);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "caocao");
  const target = assign(state, nearest(state, actorId).id, "zhangfei");
  clearHand(state, actorId);
  clearHand(state, target.id);
  const weapon = take(state, (card) => card.name === "丈八蛇矛");
  const first = take(state, (card) => card.name !== "杀");
  const second = take(state, (card) => card.name !== "杀" && card.id !== first.id);
  actor.equipment.weapon = weapon;
  actor.hand.push(first, second);
  isolatePlay(state, actorId);
  const template = getLegalActionsV2(state, actorId).find((entry) => entry.skill === "zhangba")!;
  state = applyGameActionV2(state, actorId, { type: "skill", skill: "zhangba", cardIds: [first.id, second.id], targetIds: [target.id] }, { nowMs: 100 });
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.ok(template.candidateCardIds?.includes(first.id));
  const playLog = state.logs.find((entry) => entry.text.includes("发动【丈八蛇矛】"))!;
  assert.match(playLog.text, new RegExp(`${first.rank}【${first.name}】.*${second.rank}【${second.name}】.*【杀】`));
  assert.deepEqual(playLog.visual?.cardNames, [first.name, second.name]);

  state = playing(153006);
  const responderId = state.players.find((entry) => entry.id !== state.turn!.playerId)!.id;
  const responder = assign(state, responderId, "caocao");
  clearHand(state, responderId);
  const responseSpear = take(state, (card) => card.name === "丈八蛇矛");
  const responseFirst = take(state, (card) => card.name !== "杀");
  const responseSecond = take(state, (card) => card.name !== "杀" && card.id !== responseFirst.id);
  responder.equipment.weapon = responseSpear;
  responder.hand.push(responseFirst, responseSecond);
  state.stack = [];
  state.pending = {
    id: "zhangba-response",
    kind: "response",
    actorId: responderId,
    prompt: "请打出杀",
    data: {
      required: "杀",
      remaining: 1,
      use: { id: "duel-use", sourceId: state.turn!.playerId, name: "决斗", cardIds: [], color: "none", targets: [responderId], targetIndex: 0 },
      targetId: responderId,
      opponentId: state.turn!.playerId,
      kind: "duel",
    },
  };
  const response = getLegalActionsV2(state, responderId).find((entry) => entry.skill === "zhangba_response")!;
  state = applyGameActionV2(
    state,
    responderId,
    { type: "skill", skill: "zhangba_response", cardIds: [responseFirst.id, responseSecond.id], targetIds: [] },
    { nowMs: 200 },
  );
  assert.ok(response.candidateCardIds?.includes(responseSecond.id));
  assert.match(state.logs.at(-1)!.text, /【丈八蛇矛】.*【杀】/);
  assertGameInvariantV2(state);
});

test("Spear obeys the normal once-per-turn Sha limit except for Paoxiao", () => {
  for (const characterId of ["caocao", "zhangfei"] as const) {
    const state = playing(characterId === "caocao" ? 153016 : 153017);
    const actorId = state.turn!.playerId;
    const actor = assign(state, actorId, characterId);
    clearHand(state, actorId);
    const spear = take(state, (card) => card.name === "丈八蛇矛");
    const first = take(state, (card) => card.name !== "杀");
    const second = take(state, (card) => card.name !== "杀" && card.id !== first.id);
    actor.equipment.weapon = spear;
    actor.hand.push(first, second);
    isolatePlay(state, actorId);
    state.turn!.shaUsed = 1;
    const offered = getLegalActionsV2(state, actorId).some((entry) => entry.skill === "zhangba");
    assert.equal(offered, characterId === "zhangfei");
    assertGameInvariantV2(state);
  }
});

test("Jianxiong obtains both physical cards from a damaging Spear-converted Sha", () => {
  let state = playing(153019);
  const sourceId = state.turn!.playerId;
  const source = assign(state, sourceId, "zhangfei");
  const target = assign(state, nearest(state, sourceId).id, "caocao");
  clearHand(state, sourceId);
  clearHand(state, target.id);
  const spear = take(state, (card) => card.name === "丈八蛇矛");
  const first = take(state, (card) => card.name !== "杀");
  const second = take(state, (card) => card.name !== "杀" && card.id !== first.id);
  source.equipment.weapon = spear;
  source.hand.push(first, second);
  isolatePlay(state, sourceId);
  const convert = getLegalActionsV2(state, sourceId).find((entry) => entry.skill === "zhangba" && entry.targetIds?.includes(target.id))!;
  state = applyGameActionV2(
    state,
    sourceId,
    { type: "skill", skill: "zhangba", cardIds: [first.id, second.id], targetIds: [target.id] },
    { nowMs: 100 },
  );
  assert.ok(convert.candidateCardIds?.includes(first.id));
  assert.ok([first.id, second.id].every((id) => state.processing.some((card) => card.id === id)));
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "damageTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "jianxiong");
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 102 },
  );
  const gained = state.players.find((entry) => entry.id === target.id)!.hand.map((card) => card.id);
  assert.ok([first.id, second.id].every((id) => gained.includes(id)));
  assert.ok([first.id, second.id].every((id) => !state.discard.some((card) => card.id === id)));
  assertGameInvariantV2(state);
});

test("Spear provenance remains explicit when supplying Jijiang or answering Borrowed Sword", () => {
  let state = playing(153013);
  const lord = assign(state, state.turn!.playerId, "liubei");
  const provider = assign(state, state.players.find((entry) => entry.id !== lord.id)!.id, "zhangfei");
  const target = state.players.find((entry) => entry.id !== lord.id && entry.id !== provider.id)!;
  clearHand(state, provider.id);
  const jijiangSpear = take(state, (card) => card.name === "丈八蛇矛");
  const jijiangFirst = take(state, (card) => card.name !== "杀");
  const jijiangSecond = take(state, (card) => card.name !== "杀" && card.id !== jijiangFirst.id);
  provider.equipment.weapon = jijiangSpear;
  provider.hand.push(jijiangFirst, jijiangSecond);
  isolatePlay(state, lord.id);
  state.pending = {
    id: "zhangba-jijiang",
    kind: "lordRequest",
    actorId: provider.id,
    prompt: "请为激将提供杀",
    data: {
      skill: "jijiang",
      lordId: lord.id,
      mode: "play",
      providers: [provider.id],
      cursor: 0,
      targetId: target.id,
    },
  };
  assert.ok(getLegalActionsV2(state, provider.id).some((entry) => entry.skill === "lord_zhangba"));
  state = applyGameActionV2(
    state,
    provider.id,
    { type: "skill", skill: "lord_zhangba", cardIds: [jijiangFirst.id, jijiangSecond.id], targetIds: [] },
    { nowMs: 300 },
  );
  assert.match(
    state.logs.find((entry) => entry.text.includes("响应【激将】"))!.text,
    /发动【丈八蛇矛】.*当【杀】.*响应【激将】/,
  );
  assertGameInvariantV2(state);

  state = playing(153014);
  const source = assign(state, state.turn!.playerId, "caocao");
  const borrower = assign(state, state.players.find((entry) => entry.id !== source.id)!.id, "zhangfei");
  const borrowedTarget = state.players.find((entry) => entry.id !== source.id && entry.id !== borrower.id)!;
  clearHand(state, borrower.id);
  const borrowedSpear = take(state, (card) => card.name === "丈八蛇矛");
  const borrowedFirst = take(state, (card) => card.name !== "杀");
  const borrowedSecond = take(state, (card) => card.name !== "杀" && card.id !== borrowedFirst.id);
  borrower.equipment.weapon = borrowedSpear;
  borrower.hand.push(borrowedFirst, borrowedSecond);
  isolatePlay(state, source.id);
  state.pending = {
    id: "zhangba-borrowed-sword",
    kind: "borrowSha",
    actorId: borrower.id,
    prompt: "请响应借刀杀人",
    data: { sourceId: source.id, targetId: borrowedTarget.id },
  };
  assert.ok(getLegalActionsV2(state, borrower.id).some((entry) => entry.skill === "zhangba_response"));
  state = applyGameActionV2(
    state,
    borrower.id,
    { type: "skill", skill: "zhangba_response", cardIds: [borrowedFirst.id, borrowedSecond.id], targetIds: [] },
    { nowMs: 400 },
  );
  assert.match(
    state.logs.find((entry) => entry.text.includes("响应【借刀杀人】"))!.text,
    /发动【丈八蛇矛】.*当【杀】.*响应【借刀杀人】/,
  );
  assertGameInvariantV2(state);
});

test("Stone Axe accept deals damage after two exact costs while decline preserves the dodge", () => {
  const initial = playing(153007);
  const sourceId = initial.turn!.playerId;
  const source = assign(initial, sourceId, "caocao");
  const target = assign(initial, nearest(initial, sourceId).id, "zhangfei");
  clearHand(initial, sourceId);
  clearHand(initial, target.id);
  const weapon = take(initial, (card) => card.name === "贯石斧");
  const sha = take(initial, (card) => card.name === "杀");
  const costOne = take(initial, (card) => !["杀", "闪"].includes(card.name));
  const costTwo = take(initial, (card) => !["杀", "闪"].includes(card.name) && card.id !== costOne.id);
  const shan = take(initial, (card) => card.name === "闪");
  source.equipment.weapon = weapon;
  source.hand.push(sha, costOne, costTwo);
  target.hand.push(shan);
  isolatePlay(initial, sourceId);
  let pending = applyGameActionV2(
    initial,
    sourceId,
    getLegalActionsV2(initial, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  pending = applyGameActionV2(
    pending,
    target.id,
    getLegalActionsV2(pending, target.id).find((entry) => entry.action?.cardId === shan.id)!.action!,
    { nowMs: 101 },
  );
  assert.equal(pending.pending?.kind, "guanshi");
  const hpBefore = target.hp;
  const declined = applyGameActionV2(
    structuredClone(pending),
    sourceId,
    getLegalActionsV2(pending, sourceId).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  assert.equal(declined.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  const hit = applyGameActionV2(
    structuredClone(pending),
    sourceId,
    { type: "skill", skill: "guanshi", cardIds: [costOne.id, costTwo.id], targetIds: [] },
    { nowMs: 103 },
  );
  assert.equal(hit.players.find((entry) => entry.id === target.id)!.hp, hpBefore - 1);
  assert.ok([costOne.id, costTwo.id].every((id) => hit.discard.some((card) => card.id === id)));
  assertGameInvariantV2(hit);
});

test("Halberd exposes two and three targets only when Sha is the last hand card", () => {
  const state = playing(153008);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "caocao");
  clearHand(state, actorId);
  const weapon = take(state, (card) => card.name === "方天画戟");
  const sha = take(state, (card) => card.name === "杀");
  const extra = take(state, (card) => card.name !== "杀");
  actor.equipment.weapon = weapon;
  actor.hand.push(sha);
  isolatePlay(state, actorId);
  const multi = getLegalActionsV2(state, actorId).filter((entry) => entry.action?.cardId === sha.id && (entry.action.targetIds?.length ?? 0) > 1);
  assert.ok(multi.some((entry) => entry.action?.targetIds?.length === 2));
  assert.ok(multi.some((entry) => entry.action?.targetIds?.length === 3));
  actor.hand.push(extra);
  assert.ok(!getLegalActionsV2(state, actorId).some((entry) => entry.action?.cardId === sha.id && (entry.action.targetIds?.length ?? 0) > 1));
  assertGameInvariantV2(state);
});

test("Halberd preserves Wusheng provenance when the last hand card becomes a multi-target Sha", () => {
  let state = playing(153018);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "guanyu");
  clearHand(state, actorId);
  const halberd = take(state, (card) => card.name === "方天画戟");
  const converted = take(state, (card) => card.color === "red" && card.name !== "杀");
  actor.equipment.weapon = halberd;
  actor.hand.push(converted);
  isolatePlay(state, actorId);
  const multi = getLegalActionsV2(state, actorId).find((entry) => entry.action?.cardId === converted.id && entry.action.targetIds?.length === 3)!;
  assert.ok(multi);
  assert.equal(multi.action?.skill, "wusheng");
  state = applyGameActionV2(state, actorId, multi.action!, { nowMs: 100 });
  const log = state.logs.findLast((entry) => entry.visual?.cardName === "杀")!;
  assert.match(log.text, new RegExp(`【方天画戟】.*【武圣】.*${converted.rank}【${converted.name}】.*【杀】`));
  assert.deepEqual(log.visual?.targetIds, multi.action?.targetIds);
  assert.deepEqual(log.visual?.cardNames, [converted.name]);
  assertGameInvariantV2(state);
});

test("Qilin Bow offers each horse only after damage and discards the selected physical horse", () => {
  let state = playing(153009);
  const sourceId = state.turn!.playerId;
  const source = assign(state, sourceId, "caocao");
  const target = assign(state, nearest(state, sourceId).id, "zhangfei");
  clearHand(state, sourceId);
  clearHand(state, target.id);
  const weapon = take(state, (card) => card.name === "麒麟弓");
  const sha = take(state, (card) => card.name === "杀");
  const offensive = take(state, (card) => card.slot === "offensiveHorse");
  const defensive = take(state, (card) => card.slot === "defensiveHorse");
  source.equipment.weapon = weapon;
  source.hand.push(sha);
  target.equipment.offensiveHorse = offensive;
  target.equipment.defensiveHorse = defensive;
  isolatePlay(state, sourceId);
  state = applyGameActionV2(
    state,
    sourceId,
    getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "qilin");
  const choices = getLegalActionsV2(state, sourceId);
  assert.ok(choices.some((entry) => entry.action?.cardId === offensive.id));
  assert.ok(choices.some((entry) => entry.action?.cardId === defensive.id));
  const declined = applyGameActionV2(
    structuredClone(state),
    sourceId,
    choices.find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  const declinedTarget = declined.players.find((entry) => entry.id === target.id)!;
  assert.equal(declinedTarget.equipment.offensiveHorse?.id, offensive.id);
  assert.equal(declinedTarget.equipment.defensiveHorse?.id, defensive.id);
  state = applyGameActionV2(state, sourceId, choices.find((entry) => entry.action?.cardId === defensive.id)!.action!, { nowMs: 102 });
  assert.equal(state.players.find((entry) => entry.id === target.id)!.equipment.defensiveHorse, null);
  assert.ok(state.discard.some((card) => card.id === defensive.id));
  assertGameInvariantV2(state);
});

test("declining Bagua keeps the full Wushuang response cost and disables a retry", () => {
  let state = playing(153015);
  const source = assign(state, state.turn!.playerId, "lvbu");
  const target = assign(state, nearest(state, source.id).id, "caocao");
  clearHand(state, source.id);
  clearHand(state, target.id);
  const armor = take(state, (card) => card.name === "八卦阵");
  const sha = take(state, (card) => card.name === "杀");
  source.hand.push(sha);
  target.equipment.armor = armor;
  isolatePlay(state, source.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.pending?.kind, "optionalSkill");
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal((state.pending!.data as { remaining: number }).remaining, 2);
  assert.equal((state.pending!.data as { baguaTried?: boolean }).baguaTried, true);
  assert.ok(!getLegalActionsV2(state, target.id).some((entry) => entry.action?.skill === "bagua"));
  assertGameInvariantV2(state);
});

test("Bagua may be used independently for each of Wushuang's two sequential Shan responses", () => {
  for (const firstJudgeColor of ["red", "black"] as const) {
    let state = playing(firstJudgeColor === "red" ? 153020 : 153021);
    const source = assign(state, state.turn!.playerId, "lvbu");
    const target = assign(state, nearest(state, source.id).id, "caocao");
    state.players
      .filter((entry) => entry.id !== source.id && entry.id !== target.id)
      .forEach((entry) => assign(state, entry.id, "zhangfei"));
    clearHand(state, source.id);
    clearHand(state, target.id);
    const armor = take(state, (card) => card.name === "八卦阵");
    const sha = take(state, (card) => card.name === "杀");
    const firstJudge = take(state, (card) => card.color === firstJudgeColor);
    const secondRedJudge = take(state, (card) => card.color === "red" && card.id !== firstJudge.id);
    const physicalShan = firstJudgeColor === "black" ? take(state, (card) => card.name === "闪") : null;
    source.hand.push(sha);
    target.equipment.armor = armor;
    if (physicalShan) target.hand.push(physicalShan);
    state.deck.push(secondRedJudge, firstJudge);
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
    assert.equal(state.pending?.kind, "response");
    if (firstJudgeColor === "black") {
      assert.equal((state.pending!.data as { remaining: number }).remaining, 2);
      assert.ok(!getLegalActionsV2(state, target.id).some((entry) => entry.action?.skill === "bagua"));
      state = applyGameActionV2(
        state,
        target.id,
        getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === physicalShan!.id)!.action!,
        { nowMs: 102 },
      );
    }
    assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
    const secondBagua = getLegalActionsV2(state, target.id).find((entry) => entry.action?.skill === "bagua");
    assert.ok(secondBagua, "the next sequential Shan is a fresh response and may invoke Bagua again");
    state = applyGameActionV2(state, target.id, secondBagua.action!, { nowMs: 103 });
    assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
    assert.notEqual(state.pending?.kind, "response");
    assertGameInvariantV2(state);
  }
});

test("Renwang blocks only black Sha, while horses and Mashu compose distance exactly", () => {
  for (const color of ["black", "red"] as const) {
    let state = playing(color === "black" ? 153010 : 153011);
    const sourceId = state.turn!.playerId;
    const source = assign(state, sourceId, "caocao");
    const target = assign(state, nearest(state, sourceId).id, "zhangfei");
    clearHand(state, sourceId);
    clearHand(state, target.id);
    const shield = take(state, (card) => card.name === "仁王盾");
    const sha = take(state, (card) => card.name === "杀" && card.color === color);
    source.hand.push(sha);
    target.equipment.armor = shield;
    isolatePlay(state, sourceId);
    state = applyGameActionV2(
      state,
      sourceId,
      getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!.action!,
      { nowMs: 100 },
    );
    assert.equal(state.pending?.kind === "response", color === "red");
    assert.equal(state.logs.some((entry) => entry.text.includes("仁王盾") && entry.text.includes("无效")), color === "black");
    assertGameInvariantV2(state);
  }

  const state = playing(153012, 5);
  const source = state.players[0];
  const target = state.players[2];
  assign(state, source.id, "caocao");
  assign(state, target.id, "zhangfei");
  assert.equal(distanceV2(state, source.id, target.id), 2);
  const offensive = take(state, (card) => card.slot === "offensiveHorse");
  const defensive = take(state, (card) => card.slot === "defensiveHorse");
  source.equipment.offensiveHorse = offensive;
  target.equipment.defensiveHorse = defensive;
  assert.equal(distanceV2(state, source.id, target.id), 2);
  source.character = general("machao");
  assert.equal(distanceV2(state, source.id, target.id), 1);
  assertGameInvariantV2(state);
});
