import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  createGameV2,
  distanceV2,
  getLegalActionsV2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import { STANDARD_CHARACTERS, type Card, type LobbySeat } from "../lib/game-v2-data.ts";

function seats(count: number): LobbySeat[] {
  return Array.from({ length: count }, (_, seat) => ({ id: `edge-p${seat}`, name: `边界玩家${seat + 1}`, kind: "human", seat }));
}

function action(option: LegalActionV2): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  if (option.kind === "discard") return { type: "discard", cardIds: option.candidateCardIds!.slice(0, option.minCards) };
  return { type: "skill", skill: option.skill, cardIds: option.candidateCardIds?.slice(0, option.minCards ?? 0), targetIds: option.targetIds?.slice(0, option.minTargets ?? 0) };
}

function playing(count: number, seed = 7200) {
  let state = createGameV2(seats(count), { seed }, { nowMs: 1 });
  for (let step = 0; state.status === "setup" && step < 300; step += 1) {
    const actorId = state.pending!.actorId;
    const selected = getLegalActionsV2(state, actorId).find((entry) => entry.action?.type !== "pass")!;
    state = applyGameActionV2(state, actorId, action(selected), { nowMs: step + 2 });
  }
  assert.equal(state.status, "playing");
  return state;
}

function general(id: string) {
  return STANDARD_CHARACTERS.find((entry) => entry.id === id)!;
}

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

function setGeneral(state: GameStateV2, playerId: string, id: string) {
  const player = state.players.find((entry) => entry.id === playerId)!;
  player.character = general(id);
  player.maxHp = player.character.maxHp;
  player.hp = player.maxHp;
  return player;
}

test("咆哮 removes only the Sha count limit", () => {
  const state = playing(4);
  const actor = setGeneral(state, state.turn!.playerId, "zhangfei");
  const target = state.players.find((entry) => entry.id !== actor.id)!;
  actor.hand.push(take(state, (card) => card.name === "杀"), take(state, (card) => card.name === "杀"));
  state.turn!.phase = "play";
  state.turn!.shaUsed = 1;
  assert.ok(getLegalActionsV2(state, actor.id).some((entry) => entry.action?.as === "杀" && entry.action.targetId === target.id));
  actor.character = general("caocao");
  assert.ok(!getLegalActionsV2(state, actor.id).some((entry) => entry.action?.as === "杀"));
});

test("空城 blocks Sha and Duel only while the target has no hand cards", () => {
  const state = playing(4, 7201);
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const target = setGeneral(state, state.players.find((entry) => entry.id !== actor.id)!.id, "zhugeliang");
  state.discard.push(...target.hand.splice(0));
  actor.hand.push(take(state, (card) => card.name === "杀"), take(state, (card) => card.name === "决斗"));
  state.turn!.phase = "play";
  assert.ok(!getLegalActionsV2(state, actor.id).some((entry) => entry.action?.targetId === target.id && ["杀", "决斗"].includes(entry.action?.as ?? "")));
  target.hand.push(take(state, () => true));
  assert.ok(getLegalActionsV2(state, actor.id).some((entry) => entry.action?.targetId === target.id && ["杀", "决斗"].includes(entry.action?.as ?? "")));
});

test("马术 reduces outgoing distance by exactly one and never below one", () => {
  const state = playing(5, 7202);
  const source = state.players[0];
  const target = state.players[2];
  source.character = general("caocao");
  const normal = distanceV2(state, source.id, target.id);
  source.character = general("machao");
  assert.equal(distanceV2(state, source.id, target.id), Math.max(1, normal - 1));
  assert.equal(distanceV2(state, source.id, state.players[1].id), 1);
});

test("奇才 bypasses trick distance but does not extend Sha range", () => {
  const state = playing(5, 7203);
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const far = state.players.find((entry) => entry.id !== actor.id && distanceV2(state, actor.id, entry.id) > 1)!;
  actor.hand.push(take(state, (card) => card.name === "顺手牵羊"), take(state, (card) => card.name === "杀"));
  state.turn!.phase = "play";
  actor.character = general("huangyueying");
  const actions = getLegalActionsV2(state, actor.id);
  assert.ok(actions.some((entry) => entry.action?.as === "顺手牵羊" && entry.action.targetId === far.id));
  assert.ok(!actions.some((entry) => entry.action?.as === "杀" && entry.action.targetId === far.id));
});

test("谦逊 blocks 顺手牵羊 and 乐不思蜀 without blocking other tricks", () => {
  const state = playing(4, 7204);
  const actor = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const target = setGeneral(state, state.players.find((entry) => entry.id !== actor.id)!.id, "luxun");
  actor.hand.push(take(state, (card) => card.name === "顺手牵羊"), take(state, (card) => card.name === "乐不思蜀"), take(state, (card) => card.name === "过河拆桥"));
  state.turn!.phase = "play";
  const actions = getLegalActionsV2(state, actor.id).filter((entry) => entry.action?.targetId === target.id);
  assert.ok(!actions.some((entry) => entry.action?.as === "顺手牵羊"));
  assert.ok(!actions.some((entry) => entry.action?.as === "乐不思蜀"));
  assert.ok(actions.some((entry) => entry.action?.as === "过河拆桥"));
});

test("无双 requires two consecutive responses to Sha and Duel", () => {
  let state = playing(4, 7205);
  const lvbu = setGeneral(state, state.turn!.playerId, "lvbu");
  const target = state.players.find((entry) => entry.id !== lvbu.id)!;
  target.hand.push(take(state, (card) => card.name === "闪"), take(state, (card) => card.name === "闪"));
  const sha = take(state, (card) => card.name === "杀");
  lvbu.hand.push(sha);
  state.turn!.phase = "play";
  const use = getLegalActionsV2(state, lvbu.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!;
  state = applyGameActionV2(state, lvbu.id, action(use), { nowMs: 100 });
  assert.equal(state.pending?.kind, "response");
  assert.equal((state.pending!.data as { remaining: number }).remaining, 2);
  const first = getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "respond")!;
  state = applyGameActionV2(state, target.id, action(first), { nowMs: 101 });
  assert.equal(state.pending?.kind, "response");
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
});

test("救援 adds one recovery only for another Wu character healing the identity lord", () => {
  let state = playing(4, 7206);
  const lord = state.players.find((entry) => entry.role === "lord")!;
  const provider = state.players.find((entry) => entry.id !== lord.id)!;
  lord.character = general("sunquan");
  lord.maxHp = 4;
  lord.hp = 0;
  provider.character = general("ganning");
  const peach = take(state, (card) => card.name === "桃");
  provider.hand.push(peach);
  state.pending = { kind: "rescue", actorId: provider.id, prompt: "濒死", data: { targetId: lord.id, sourceId: provider.id, order: state.players.map((entry) => entry.id), cursor: 0, passes: 0 } };
  const rescue = getLegalActionsV2(state, provider.id).find((entry) => entry.action?.cardId === peach.id)!;
  state = applyGameActionV2(state, provider.id, action(rescue), { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === lord.id)!.hp, 2);
});

test("闭月 offers accept and decline paths and draws exactly one on accept", () => {
  let state = playing(4, 7207);
  const diaochan = setGeneral(state, state.turn!.playerId, "diaochan");
  const before = diaochan.hand.length;
  state.pending = { kind: "optionalSkill", actorId: diaochan.id, prompt: "是否发动闭月", data: { skill: "biyue", resume: "finish" } };
  const choices = getLegalActionsV2(state, diaochan.id);
  assert.ok(choices.some((entry) => entry.action?.type === "pass"));
  const accept = choices.find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, diaochan.id, action(accept), { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === diaochan.id)!.hand.length, before + 1);
});
