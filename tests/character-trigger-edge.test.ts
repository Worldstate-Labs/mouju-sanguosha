import assert from "node:assert/strict";
import test from "node:test";
import { applyGameActionV2, createGameV2, getLegalActionsV2, type GameActionV2, type GameStateV2, type LegalActionV2 } from "../lib/game-v2.ts";
import { STANDARD_CHARACTERS, type Card, type LobbySeat } from "../lib/game-v2-data.ts";

const seats = (count: number): LobbySeat[] => Array.from({ length: count }, (_, seat) => ({ id: `trigger-${seat}`, name: `触发玩家${seat + 1}`, kind: "human", seat }));

function instantiate(option: LegalActionV2): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  if (option.kind === "discard") return { type: "discard", cardIds: option.candidateCardIds!.slice(0, option.minCards) };
  return { type: "skill", skill: option.skill, cardIds: option.candidateCardIds?.slice(0, option.minCards ?? 0), targetIds: option.targetIds?.slice(0, option.minTargets ?? 0) };
}

function playing(count = 4, seed = 8300) {
  let state = createGameV2(seats(count), { seed }, { nowMs: 1 });
  for (let step = 0; state.status === "setup" && step < 300; step += 1) {
    const actorId = state.pending!.actorId;
    const legal = getLegalActionsV2(state, actorId);
    state = applyGameActionV2(state, actorId, instantiate(legal.find((entry) => entry.action?.type !== "pass") ?? legal[0]), { nowMs: step + 2 });
  }
  return state;
}

function general(id: string) { return STANDARD_CHARACTERS.find((entry) => entry.id === id)!; }

function take(state: GameStateV2, predicate: (card: Card) => boolean) {
  for (const zone of [state.deck, state.discard, state.processing, state.revealed]) {
    const index = zone.findIndex(predicate);
    if (index >= 0) return zone.splice(index, 1)[0];
  }
  for (const player of state.players) {
    const index = player.hand.findIndex(predicate);
    if (index >= 0) return player.hand.splice(index, 1)[0];
  }
  throw new Error("required card not found");
}

function assign(state: GameStateV2, playerId: string, id: string) {
  const player = state.players.find((entry) => entry.id === playerId)!;
  player.character = general(id);
  player.maxHp = player.character.maxHp;
  player.hp = player.maxHp;
  return player;
}

test("仁德 heals exactly once when the cumulative phase total crosses two", () => {
  let state = playing(4, 8301);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "liubei");
  const targetId = state.players.find((entry) => entry.id !== actorId)!.id;
  actor.hp -= 1;
  const ids = actor.hand.slice(0, 3).map((card) => card.id);
  state.turn!.phase = "play";
  for (let index = 0; index < 3; index += 1) {
    const template = getLegalActionsV2(state, actorId).find((entry) => entry.skill === "rende")!;
    state = applyGameActionV2(state, actorId, { type: "skill", skill: "rende", cardIds: [ids[index]], targetIds: [targetId] }, { nowMs: 100 + index });
    assert.equal(state.players.find((entry) => entry.id === actorId)!.hp, index === 0 ? actor.maxHp - 1 : actor.maxHp);
    assert.ok(template.candidateCardIds?.includes(ids[index]));
  }
});

test("反间 commits one hidden card before the suit choice and resolves both match outcomes", () => {
  const initial = playing(4, 8302);
  const actorId = initial.turn!.playerId;
  const targetId = initial.players.find((entry) => entry.id !== actorId)!.id;
  const actor = assign(initial, actorId, "zhouyu");
  initial.discard.push(...actor.hand.splice(0));
  const committed = take(initial, (card) => card.suit === "spade");
  actor.hand.push(committed);
  initial.turn!.phase = "play";
  const template = getLegalActionsV2(initial, actorId).find((entry) => entry.skill === "fanjian")!;
  const pending = applyGameActionV2(initial, actorId, { type: "skill", skill: "fanjian", targetIds: [targetId] }, { nowMs: 100 });
  assert.equal(pending.pending?.kind, "chooseSuit");
  assert.equal((pending.pending!.data as { committedCardId: string }).committedCardId, committed.id);
  const hp = pending.players.find((entry) => entry.id === targetId)!.hp;
  const match = applyGameActionV2(pending, targetId, { type: "choose", suit: "spade" }, { nowMs: 101 });
  assert.equal(match.players.find((entry) => entry.id === targetId)!.hp, hp);
  assert.ok(template.targetIds?.includes(targetId));

  const mismatchBase = structuredClone(pending);
  const mismatch = applyGameActionV2(mismatchBase, targetId, { type: "choose", suit: "heart" }, { nowMs: 102 });
  assert.equal(mismatch.players.find((entry) => entry.id === targetId)!.hp, hp - 1);
});

test("集智 accept and decline both resume the original trick instead of swallowing it", () => {
  for (const accept of [true, false]) {
    let state = playing(4, accept ? 8303 : 8304);
    const actorId = state.turn!.playerId;
    const actor = assign(state, actorId, "huangyueying");
    const target = state.players.find((entry) => entry.id !== actorId && entry.hand.length > 0)!;
    const guohe = take(state, (card) => card.name === "过河拆桥");
    actor.hand.push(guohe);
    state.turn!.phase = "play";
    const before = actor.hand.length;
    const use = getLegalActionsV2(state, actorId).find((entry) => entry.action?.cardId === guohe.id && entry.action.targetId === target.id)!;
    state = applyGameActionV2(state, actorId, use.action!, { nowMs: 100 });
    assert.equal(state.pending?.kind, "optionalSkill");
    const decision = getLegalActionsV2(state, actorId).find((entry) => accept ? entry.action?.choice === "yes" : entry.action?.type === "pass")!;
    state = applyGameActionV2(state, actorId, decision.action!, { nowMs: 101 });
    assert.ok(state.pending || state.stack.length > 0 || state.turn?.phase === "play");
    assert.ok(state.logs.some((entry) => entry.text.includes("使用【过河拆桥】")));
    if (accept) assert.equal(state.players.find((entry) => entry.id === actorId)!.hand.length >= before, true);
  }
});

test("枭姬 triggers when a public equipment card is removed by 过河拆桥", () => {
  let state = playing(4, 8305);
  const sourceId = state.turn!.playerId;
  const target = assign(state, state.players.find((entry) => entry.id !== sourceId)!.id, "sunshangxiang");
  const weapon = take(state, (card) => card.slot === "weapon");
  target.equipment.weapon = weapon;
  const source = state.players.find((entry) => entry.id === sourceId)!;
  const guohe = take(state, (card) => card.name === "过河拆桥");
  source.hand.push(guohe);
  state.turn!.phase = "play";
  const use = getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === guohe.id && entry.action.targetId === target.id)!;
  state = applyGameActionV2(state, sourceId, use.action!, { nowMs: 100 });
  while (state.pending?.kind === "nullification") {
    const actorId = state.pending.actorId;
    const pass = getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!;
    state = applyGameActionV2(state, actorId, pass.action!, { nowMs: 101 + state.logSeq });
  }
  assert.equal(state.pending?.kind, "chooseZoneCard");
  const removeWeapon = getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === weapon.id)!;
  state = applyGameActionV2(state, sourceId, removeWeapon.action!, { nowMs: 200 });
  assert.equal(state.pending?.kind, "lossTrigger");
  const before = state.players.find((entry) => entry.id === target.id)!.hand.length;
  const accept = getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, target.id, accept.action!, { nowMs: 201 });
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hand.length, before + 2);
});

test("急救 reveals the physical red card and preserves the enhanced 桃 result", () => {
  let state = playing(4, 8306);
  const healer = assign(state, state.players[1].id, "huatuo");
  const dying = state.players[2];
  dying.hp = 0;
  const red = take(state, (card) => card.color === "red" && card.name !== "桃");
  healer.hand.push(red);
  state.pending = { kind: "rescue", actorId: healer.id, prompt: "濒死", data: { targetId: dying.id, order: state.players.map((entry) => entry.id), cursor: 1, passes: 0 } };
  const jijiu = getLegalActionsV2(state, healer.id).find((entry) => entry.action?.skill === "jijiu" && entry.action.cardId === red.id)!;
  state = applyGameActionV2(state, healer.id, jijiu.action!, { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === dying.id)!.hp, 1);
  assert.match(state.logs.findLast((entry) => entry.text.includes("【急救】"))!.text, new RegExp(`${red.rank}【${red.name}】`));
});
