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
  id: `exhaustive-${seat}`,
  name: `穷举玩家${seat + 1}`,
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
    const index = owner.hand.findIndex(predicate);
    if (index >= 0) return owner.hand.splice(index, 1)[0];
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

test("all five general card conversions enforce color, suit, zone, context, and physical provenance", () => {
  const state = playing(141001);
  const actorId = state.turn!.playerId;
  const actor = clearHand(state, actorId);
  state.turn!.phase = "play";
  const red = take(state, (card) => card.color === "red" && !["杀", "闪", "桃"].includes(card.name));
  const black = take(state, (card) => card.color === "black" && !["杀", "闪", "过河拆桥"].includes(card.name));
  const blackArmor = take(state, (card) => card.name === "仁王盾");
  const diamond = take(state, (card) => card.suit === "diamond" && card.name !== "乐不思蜀");
  const shan = take(state, (card) => card.name === "闪");
  actor.hand.push(red, black, diamond, shan);

  actor.character = general("guanyu");
  let actions = getLegalActionsV2(state, actorId);
  assert.ok(actions.some((entry) => entry.action?.cardId === red.id && entry.action.skill === "wusheng" && entry.action.as === "杀"));
  assert.ok(!actions.some((entry) => entry.action?.cardId === black.id && entry.action.skill === "wusheng"));

  actor.character = general("zhaoyun");
  actions = getLegalActionsV2(state, actorId);
  assert.ok(actions.some((entry) => entry.action?.cardId === shan.id && entry.action.skill === "longdan" && entry.action.as === "杀"));
  assert.ok(!actions.some((entry) => entry.action?.cardId === red.id && entry.action.skill === "longdan"));

  actor.character = general("ganning");
  actions = getLegalActionsV2(state, actorId);
  assert.ok(actions.some((entry) => entry.action?.cardId === black.id && entry.action.skill === "qixi" && entry.action.as === "过河拆桥"));
  assert.ok(!actions.some((entry) => entry.action?.cardId === red.id && entry.action.skill === "qixi"));

  actor.character = general("daqiao");
  actions = getLegalActionsV2(state, actorId);
  assert.ok(actions.some((entry) => entry.action?.cardId === diamond.id && entry.action.skill === "guose" && entry.action.as === "乐不思蜀"));
  assert.ok(!actions.some((entry) => entry.action?.cardId === black.id && entry.action.skill === "guose"));

  actor.character = general("zhenji");
  actor.equipment.armor = blackArmor;
  state.pending = { id: "conversion-response", kind: "response", actorId, prompt: "请响应闪", data: { required: "闪", remaining: 1, kind: "aoe", targetId: actorId } };
  actions = getLegalActionsV2(state, actorId);
  assert.ok(actions.some((entry) => entry.action?.cardId === black.id && entry.action.skill === "qingguo" && entry.action.as === "闪"));
  assert.ok(!actions.some((entry) => entry.action?.cardId === red.id && entry.action.skill === "qingguo"));
  assert.ok(!actions.some((entry) => entry.action?.cardId === blackArmor.id && entry.action.skill === "qingguo"), "倾国只能转换黑色手牌，不能消耗装备区");
});

test("every play-phase conversion publishes its original physical card in text and structured logs", () => {
  const cases = [
    { skill: "wusheng", character: "guanyu", as: "杀", predicate: (card: Card) => card.color === "red" && card.name !== "杀" },
    { skill: "longdan", character: "zhaoyun", as: "杀", predicate: (card: Card) => card.name === "闪" },
    { skill: "qixi", character: "ganning", as: "过河拆桥", predicate: (card: Card) => card.color === "black" && card.name !== "过河拆桥" },
    { skill: "guose", character: "daqiao", as: "乐不思蜀", predicate: (card: Card) => card.suit === "diamond" && card.name !== "乐不思蜀" },
  ] as const;
  cases.forEach(({ skill, character, as, predicate }, index) => {
    let state = playing(141050 + index);
    const actorId = state.turn!.playerId;
    const actor = assign(state, actorId, character);
    const target = assign(state, state.players.find((entry) => entry.id !== actorId)!.id, "caocao");
    clearHand(state, actorId);
    const physical = take(state, predicate);
    actor.hand.push(physical);
    state.stack = [];
    state.turn!.phase = "play";
    const action = getLegalActionsV2(state, actorId).find((entry) => entry.action?.cardId === physical.id && entry.action?.skill === skill && entry.action?.targetId === target.id)!;
    assert.ok(action, `${skill} should expose a playable conversion`);
    state = applyGameActionV2(state, actorId, action.action!, { nowMs: 100 });
    const log = state.logs.findLast((entry) => entry.text.includes(`发动【${skill === "wusheng" ? "武圣" : skill === "longdan" ? "龙胆" : skill === "qixi" ? "奇袭" : "国色"}】`))!;
    assert.match(log.text, new RegExp(`${physical.rank}【${physical.name}】.*【${as}】`));
    assert.equal(log.visual?.cardName, as);
    assert.deepEqual(log.visual?.cardNames, [physical.name]);
    assertGameInvariantV2(state);
  });
});

test("Wusheng recomputes range after its converted physical equipment has already been paid", () => {
  for (const equipmentName of ["方天画戟", "赤兔"] as const) {
    const state = playing(equipmentName === "方天画戟" ? 141035 : 141036);
    const actor = assign(state, state.turn!.playerId, "guanyu");
    state.players.filter((entry) => entry.id !== actor.id).forEach((entry) => assign(state, entry.id, "caocao"));
    clearHand(state, actor.id);
    const equipment = take(state, (card) => card.name === equipmentName);
    assert.equal(equipment.color, "red");
    actor.equipment[equipment.slot!] = equipment;
    isolatePlay(state, actor.id);
    const near = state.players.find((entry) => entry.id !== actor.id && distanceV2(state, actor.id, entry.id) === 1)!;
    const far = state.players.find((entry) => entry.id !== actor.id && Math.abs(entry.seat - actor.seat) === 2)!;
    assert.ok(getLegalActionsV2(state, actor.id).some(
      (entry) => entry.action?.cardId === equipment.id && entry.action.skill === "wusheng" && entry.action.targetId === near.id,
    ));
    assert.ok(!getLegalActionsV2(state, actor.id).some(
      (entry) => entry.action?.cardId === equipment.id && entry.action.skill === "wusheng" && entry.action.targetId === far.id,
    ), `${equipmentName} cannot supply its own range after being converted`);
    assertGameInvariantV2(state);
  }
});

test("制衡、结姻、青囊 enforce cost, target eligibility, exact healing, and once-per-turn limits", () => {
  let state = playing(141002);
  const actorId = state.turn!.playerId;
  let actor = assign(state, actorId, "sunquan");
  state.turn!.phase = "play";
  const zhiheng = getLegalActionsV2(state, actorId).find((entry) => entry.skill === "zhiheng")!;
  const paid = zhiheng.candidateCardIds!.slice(0, 2);
  const before = actor.hand.length;
  state = applyGameActionV2(state, actorId, { type: "skill", skill: "zhiheng", cardIds: paid }, { nowMs: 100 });
  actor = state.players.find((entry) => entry.id === actorId)!;
  assert.equal(actor.hand.length, before);
  assert.ok(paid.every((id) => !actor.hand.some((card) => card.id === id)));
  assert.ok(!getLegalActionsV2(state, actorId).some((entry) => entry.skill === "zhiheng"));

  state = playing(141003);
  const jieyinId = state.turn!.playerId;
  const jieyin = assign(state, jieyinId, "sunshangxiang");
  const male = assign(state, state.players.find((entry) => entry.id !== jieyinId)!.id, "caocao");
  const female = assign(state, state.players.find((entry) => entry.id !== jieyinId && entry.id !== male.id)!.id, "zhenji");
  jieyin.hp -= 1;
  male.hp -= 1;
  female.hp -= 1;
  state.turn!.phase = "play";
  const template = getLegalActionsV2(state, jieyinId).find((entry) => entry.skill === "jieyin")!;
  assert.deepEqual(template.targetIds, [male.id]);
  const costs = template.candidateCardIds!.slice(0, 2);
  state = applyGameActionV2(state, jieyinId, { type: "skill", skill: "jieyin", cardIds: costs, targetIds: [male.id] }, { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === jieyinId)!.hp, jieyin.maxHp);
  assert.equal(state.players.find((entry) => entry.id === male.id)!.hp, male.maxHp);
  assert.ok(!getLegalActionsV2(state, jieyinId).some((entry) => entry.skill === "jieyin"));

  state = playing(141004);
  const doctorId = state.turn!.playerId;
  const doctor = assign(state, doctorId, "huatuo");
  doctor.hp -= 1;
  state.turn!.phase = "play";
  const qingnang = getLegalActionsV2(state, doctorId).find((entry) => entry.skill === "qingnang")!;
  assert.ok(qingnang.targetIds?.includes(doctorId));
  state = applyGameActionV2(state, doctorId, { type: "skill", skill: "qingnang", cardIds: [qingnang.candidateCardIds![0]], targetIds: [doctorId] }, { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === doctorId)!.hp, doctor.maxHp);
  assert.ok(!getLegalActionsV2(state, doctorId).some((entry) => entry.skill === "qingnang"));
});

test("突袭、裸衣、英姿 execute both modified-draw accounting and target boundaries", () => {
  let state = playing(141005);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "zhangliao");
  const targets = state.players.filter((entry) => entry.id !== actorId).slice(0, 2);
  const beforeActor = actor.hand.length;
  const beforeTargets = targets.map((entry) => entry.hand.length);
  state.turn!.phase = "draw";
  state.pending = { id: "draw-tuxi", kind: "drawChoice", actorId, prompt: "突袭", data: { skill: "tuxi", targetIds: targets.map((entry) => entry.id), drawCount: 2 } };
  const tuxi = getLegalActionsV2(state, actorId).find((entry) => entry.skill === "tuxi")!;
  assert.equal(tuxi.maxTargets, 2);
  state = applyGameActionV2(state, actorId, { type: "skill", skill: "tuxi", targetIds: targets.map((entry) => entry.id) }, { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === actorId)!.hand.length, beforeActor + 2);
  targets.forEach((target, index) => assert.equal(state.players.find((entry) => entry.id === target.id)!.hand.length, beforeTargets[index] - 1));

  state = playing(141006);
  const xuchuId = state.turn!.playerId;
  const xuchu = assign(state, xuchuId, "xuchu");
  const beforeLuoyi = xuchu.hand.length;
  state.turn!.phase = "draw";
  state.pending = { id: "draw-luoyi", kind: "drawChoice", actorId: xuchuId, prompt: "裸衣", data: { skill: "luoyi", drawCount: 2 } };
  const useLuoyi = getLegalActionsV2(state, xuchuId).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, xuchuId, useLuoyi.action!, { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === xuchuId)!.hand.length, beforeLuoyi + 1);
  assert.equal(state.turn!.stats.luoyi, true);

  state = playing(141007);
  const zhouyuId = state.turn!.playerId;
  const zhouyu = assign(state, zhouyuId, "zhouyu");
  const beforeYingzi = zhouyu.hand.length;
  state.turn!.phase = "draw";
  state.pending = { id: "draw-yingzi", kind: "drawChoice", actorId: zhouyuId, prompt: "英姿", data: { skill: "yingzi", drawCount: 2 } };
  const useYingzi = getLegalActionsV2(state, zhouyuId).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, zhouyuId, useYingzi.action!, { nowMs: 100 });
  assert.equal(state.players.find((entry) => entry.id === zhouyuId)!.hand.length, beforeYingzi + 3);
});

test("突袭、裸衣、英姿 decline paths each perform exactly one normal draw", () => {
  const cases = [
    { skill: "tuxi", character: "zhangliao" },
    { skill: "luoyi", character: "xuchu" },
    { skill: "yingzi", character: "zhouyu" },
  ] as const;
  cases.forEach(({ skill, character }, index) => {
    let state = playing(141030 + index);
    const actorId = state.turn!.playerId;
    const actor = assign(state, actorId, character);
    const before = actor.hand.length;
    state.stack = [];
    state.turn!.phase = "draw";
    state.pending = {
      id: `decline-${skill}`,
      kind: "drawChoice",
      actorId,
      prompt: skill,
      data: {
        skill,
        drawCount: 2,
        ...(skill === "tuxi" ? { targetIds: state.players.filter((entry) => entry.id !== actorId).map((entry) => entry.id) } : {}),
      },
    };
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 100 },
    );
    assert.equal(state.players.find((entry) => entry.id === actorId)!.hand.length, before + 2);
    assert.equal(state.turn?.phase, "play");
    assert.ok(!state.logs.some((entry) => entry.text.includes(`发动【${skill === "tuxi" ? "突袭" : skill === "luoyi" ? "裸衣" : "英姿"}】`)));
    assertGameInvariantV2(state);
  });
});

test("奸雄 obtains the exact damage cards and 反馈 handles a public equipment transfer", () => {
  let state = playing(141008);
  const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const caocao = assign(state, state.players.find((entry) => entry.id !== source.id)!.id, "caocao");
  const damageCard = take(state, (card) => card.name === "杀");
  state.processing.push(damageCard);
  state.pending = { id: "damage-jianxiong", kind: "damageTrigger", actorId: caocao.id, prompt: "奸雄", data: { skill: "jianxiong", damage: { sourceId: source.id, targetId: caocao.id, amount: 1, cardIds: [damageCard.id], reason: "测试" } } };
  const accept = getLegalActionsV2(state, caocao.id).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, caocao.id, accept.action!, { nowMs: 100 });
  assert.ok(state.players.find((entry) => entry.id === caocao.id)!.hand.some((card) => card.id === damageCard.id));
  assert.ok(!state.processing.some((card) => card.id === damageCard.id));

  state = playing(141009);
  const attacker = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  const simayi = assign(state, state.players.find((entry) => entry.id !== attacker.id)!.id, "simayi");
  const weapon = take(state, (card) => card.slot === "weapon");
  attacker.equipment.weapon = weapon;
  state.pending = { id: "damage-fankui", kind: "damageTrigger", actorId: simayi.id, prompt: "反馈", data: { skill: "fankui", damage: { sourceId: attacker.id, targetId: simayi.id, amount: 1, cardIds: [], reason: "测试" } } };
  const trigger = getLegalActionsV2(state, simayi.id).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, simayi.id, trigger.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "fankui");
  const takeWeapon = getLegalActionsV2(state, simayi.id).find((entry) => entry.action?.cardId === weapon.id)!;
  state = applyGameActionV2(state, simayi.id, takeWeapon.action!, { nowMs: 101 });
  assert.equal(state.players.find((entry) => entry.id === attacker.id)!.equipment.weapon, null);
  assert.ok(state.players.find((entry) => entry.id === simayi.id)!.hand.some((card) => card.id === weapon.id));
  assert.match(state.logs.findLast((entry) => entry.text.includes("【反馈】"))!.text, new RegExp(weapon.name));
});

test("declining every optional damage trigger resumes without consuming cards or creating a sub-decision", () => {
  const cases = [
    { skill: "jianxiong", character: "caocao" },
    { skill: "fankui", character: "simayi" },
    { skill: "ganglie", character: "xiahoudun" },
    { skill: "yiji", character: "guojia" },
  ] as const;
  cases.forEach(({ skill, character }, index) => {
    let state = playing(141040 + index);
    const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
    const owner = assign(state, state.players.find((entry) => entry.id !== source.id)!.id, character);
    const damageCard = take(state, (card) => card.name === "杀");
    state.processing.push(damageCard);
    state.stack = [{
      id: `finish-declined-${skill}`,
      kind: "finishUse",
      step: 0,
      data: { use: { id: `declined-${skill}-use`, sourceId: source.id, name: "杀", cardIds: [damageCard.id], color: damageCard.color, targets: [owner.id], targetIndex: 1 } },
    }];
    state.pending = {
      id: `decline-damage-${skill}`,
      kind: "damageTrigger",
      actorId: owner.id,
      prompt: skill,
      data: { skill, damage: { sourceId: source.id, targetId: owner.id, amount: 1, cardIds: [damageCard.id], reason: "测试" } },
    };
    const ownerHand = owner.hand.length;
    state = applyGameActionV2(
      state,
      owner.id,
      getLegalActionsV2(state, owner.id).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 100 },
    );
    assert.equal(state.players.find((entry) => entry.id === owner.id)!.hand.length, ownerHand);
    assert.equal(state.pending, null);
    assert.ok(state.discard.some((card) => card.id === damageCard.id));
    assertGameInvariantV2(state);
  });
});

test("遗计 assigns two distinct physical cards independently and preserves the 108-card invariant", () => {
  let state = playing(141010);
  const guojia = assign(state, state.players.find((entry) => entry.id !== state.turn!.playerId)!.id, "guojia");
  const firstTarget = state.players.find((entry) => entry.id !== guojia.id)!;
  const secondTarget = state.players.find((entry) => entry.id !== guojia.id && entry.id !== firstTarget.id)!;
  const firstBefore = firstTarget.hand.length;
  const secondBefore = secondTarget.hand.length;
  state.pending = { id: "damage-yiji", kind: "damageTrigger", actorId: guojia.id, prompt: "遗计", data: { skill: "yiji", damage: { targetId: guojia.id, amount: 1, cardIds: [], reason: "测试" } } };
  const accept = getLegalActionsV2(state, guojia.id).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, guojia.id, accept.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "yijiAssign");
  const [firstCard, secondCard] = (state.pending!.data as { cardIds: string[] }).cardIds;
  state = applyGameActionV2(state, guojia.id, { type: "choose", cardId: firstCard, targetId: firstTarget.id }, { nowMs: 101 });
  state = applyGameActionV2(state, guojia.id, { type: "choose", cardId: secondCard, targetId: secondTarget.id }, { nowMs: 102 });
  assert.equal(state.players.find((entry) => entry.id === firstTarget.id)!.hand.length, firstBefore + 1);
  assert.equal(state.players.find((entry) => entry.id === secondTarget.id)!.hand.length, secondBefore + 1);
  assertGameInvariantV2(state);
});

test("观星 places every revealed physical card exactly once across top and bottom", () => {
  let state = playing(141011);
  const actorId = state.turn!.playerId;
  assign(state, actorId, "zhugeliang");
  state.pending = { id: "optional-guanxing", kind: "optionalSkill", actorId, prompt: "观星", data: { skill: "guanxing", resume: "prepare" } };
  const accept = getLegalActionsV2(state, actorId).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, actorId, accept.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "guanxing");
  const ids = [...(state.pending!.data as { remainingIds: string[] }).remainingIds];
  for (let index = 0; index < ids.length; index += 1) {
    state = applyGameActionV2(state, actorId, { type: "choose", cardId: ids[index], choice: index % 2 ? "bottom" : "top" }, { nowMs: 101 + index });
  }
  assert.equal(state.revealed.length, 0);
  const bottomIds = ids.filter((_, index) => index % 2 === 1);
  assert.ok(bottomIds.every((id) => state.deck.some((card) => card.id === id)), "bottom cards must remain at the bottom instead of being drawn during automatic continuation");
  const allIds = [
    ...state.deck,
    ...state.discard,
    ...state.processing,
    ...state.revealed,
    ...state.players.flatMap((entry) => [
      ...entry.hand,
      ...Object.values(entry.equipment).filter((card): card is Card => Boolean(card)),
      ...entry.judgment,
    ]),
  ].map((card) => card.id);
  assert.ok(ids.every((id) => allIds.filter((candidate) => candidate === id).length === 1));
  assert.equal(new Set(state.deck.map((card) => card.id)).size, state.deck.length);
  assertGameInvariantV2(state);
});

test("连营 triggers on the natural loss of the last hand card and both accept and decline resume the card use", () => {
  const initial = playing(141012);
  const actorId = initial.turn!.playerId;
  const luxun = assign(initial, actorId, "luxun");
  clearHand(initial, actorId);
  const trick = take(initial, (card) => card.name === "无中生有");
  luxun.hand.push(trick);
  initial.turn!.phase = "play";
  const use = getLegalActionsV2(initial, actorId).find((entry) => entry.action?.cardId === trick.id && entry.action?.as === "无中生有")!;
  const pending = applyGameActionV2(initial, actorId, use.action!, { nowMs: 100 });
  assert.equal(pending.pending?.kind, "lossTrigger");
  assert.equal((pending.pending!.data as { skill: string }).skill, "lianying");

  let accepted = structuredClone(pending);
  const accept = getLegalActionsV2(accepted, actorId).find((entry) => entry.action?.choice === "yes")!;
  accepted = applyGameActionV2(accepted, actorId, accept.action!, { nowMs: 101 });
  assert.ok(accepted.logs.some((entry) => entry.text.includes("【连营】")));
  assert.ok(accepted.logs.some((entry) => entry.text.includes("使用【无中生有】")));

  let declined = structuredClone(pending);
  const decline = getLegalActionsV2(declined, actorId).find((entry) => entry.action?.type === "pass")!;
  declined = applyGameActionV2(declined, actorId, decline.action!, { nowMs: 101 });
  assert.ok(!declined.logs.some((entry) => entry.text.includes("发动【连营】")));
  assert.ok(declined.logs.some((entry) => entry.text.includes("使用【无中生有】")));
});

test("流离 validates the paid card and range after cost, redirects once, and preserves the original no-dodge flag", () => {
  let state = playing(141013);
  const sourceId = state.turn!.playerId;
  const source = assign(state, sourceId, "caocao");
  const daqiao = assign(state, state.players.find((entry) => entry.id !== sourceId)!.id, "daqiao");
  const redirected = assign(state, state.players.find((entry) => entry.id !== sourceId && entry.id !== daqiao.id)!.id, "zhangfei");
  clearHand(state, sourceId);
  clearHand(state, daqiao.id);
  const sha = take(state, (card) => card.name === "杀");
  const liuliCost = take(state, (card) => card.name !== "桃");
  source.hand.push(sha);
  daqiao.hand.push(liuliCost);
  state.turn!.phase = "play";
  const use = getLegalActionsV2(state, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action?.targetId === daqiao.id)!;
  state = applyGameActionV2(state, sourceId, use.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "liuli");
  const declined = applyGameActionV2(
    structuredClone(state),
    daqiao.id,
    getLegalActionsV2(state, daqiao.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 101 },
  );
  assert.equal(declined.pending?.kind, "response");
  assert.equal(declined.pending?.actorId, daqiao.id);
  assert.ok(declined.players.find((entry) => entry.id === daqiao.id)!.hand.some((card) => card.id === liuliCost.id));
  const redirect = getLegalActionsV2(state, daqiao.id).find((entry) => entry.action?.cardId === liuliCost.id && entry.action?.targetId === redirected.id)!;
  assert.ok(redirect);
  state = applyGameActionV2(state, daqiao.id, redirect.action!, { nowMs: 101 });
  assert.ok(state.discard.some((card) => card.id === liuliCost.id));
  assert.ok(state.logs.some((entry) => entry.text.includes("【流离】") && entry.text.includes(redirected.name)));
  assert.equal(state.pending?.actorId, redirected.id);
  assert.notEqual(state.pending?.kind, "liuli");
});

test("流离 precedes 铁骑 and may make an existing Fangtian target a second independent target occurrence", () => {
  let state = playing(141034);
  const source = assign(state, state.turn!.playerId, "machao");
  const orderedTargets = state.players.filter((entry) => entry.id !== source.id).sort((left, right) => left.seat - right.seat);
  const daqiao = assign(state, orderedTargets[0].id, "daqiao");
  const repeated = assign(state, orderedTargets[1].id, "zhangfei");
  assign(state, orderedTargets[2].id, "caocao");
  clearHand(state, source.id);
  clearHand(state, daqiao.id);
  clearHand(state, repeated.id);
  const fangtian = take(state, (card) => card.name === "方天画戟");
  const liuliWeapon = take(state, (card) => card.slot === "weapon" && card.name !== "方天画戟" && (card.name === "麒麟弓" || card.name === "青龙偃月刀"));
  const sha = take(state, (card) => card.name === "杀");
  const liuliCost = take(state, (card) => card.name !== "桃");
  source.equipment.weapon = fangtian;
  source.hand.push(sha);
  daqiao.equipment.weapon = liuliWeapon;
  daqiao.hand.push(liuliCost);
  isolatePlay(state, source.id);
  const multi = getLegalActionsV2(state, source.id).find((entry) => entry.action?.targetIds?.length === 3)!;
  assert.equal(multi.action?.targetIds?.[0], daqiao.id);
  assert.ok(multi.action?.targetIds?.includes(repeated.id));
  state = applyGameActionV2(state, source.id, multi.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "liuli", "becoming the target is handled before Machao's after-target Tieqi");
  const redirect = getLegalActionsV2(state, daqiao.id).find(
    (entry) => entry.action?.cardId === liuliCost.id && entry.action?.targetId === repeated.id,
  );
  assert.ok(redirect, "Liuli may choose someone already present in Fangtian's target list");
  state = applyGameActionV2(state, daqiao.id, redirect.action!, { nowMs: 101 });
  assert.equal(state.pending?.kind, "tieqi");
  assert.equal((state.pending!.data as { targetId: string }).targetId, repeated.id);
  state = applyGameActionV2(
    state,
    source.id,
    getLegalActionsV2(state, source.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  state = applyGameActionV2(
    state,
    repeated.id,
    getLegalActionsV2(state, repeated.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 103 },
  );
  assert.equal(state.pending?.kind, "tieqi", "the original target-list occurrence must trigger Tieqi independently");
  assert.equal((state.pending!.data as { targetId: string }).targetId, repeated.id);
  assertGameInvariantV2(state);
});

test("a Liuli redirect to an existing Fangtian target safely skips its later occurrence after that target dies", () => {
  let state = playing(141035);
  const source = assign(state, state.turn!.playerId, "zhangfei");
  const orderedTargets = state.players.filter((entry) => entry.id !== source.id).sort((left, right) => left.seat - right.seat);
  const daqiao = assign(state, orderedTargets[0].id, "daqiao");
  const repeated = assign(state, orderedTargets[1].id, "caocao");
  const finalTarget = assign(state, orderedTargets[2].id, "caocao");
  source.role = "lord";
  daqiao.role = "loyalist";
  repeated.role = "rebel";
  finalTarget.role = "renegade";
  repeated.hp = 1;
  for (const entry of state.players) clearHand(state, entry.id);
  const fangtian = take(state, (card) => card.name === "方天画戟");
  const liuliWeapon = take(state, (card) => card.slot === "weapon" && card.name !== "方天画戟" && (card.name === "麒麟弓" || card.name === "青龙偃月刀"));
  const sha = take(state, (card) => card.name === "杀");
  const liuliCost = take(state, (card) => card.name !== "桃");
  source.equipment.weapon = fangtian;
  source.hand.push(sha);
  daqiao.equipment.weapon = liuliWeapon;
  daqiao.hand.push(liuliCost);
  isolatePlay(state, source.id);
  const finalHp = finalTarget.hp;

  const multi = getLegalActionsV2(state, source.id).find((entry) => entry.action?.targetIds?.length === 3)!;
  state = applyGameActionV2(state, source.id, multi.action!, { nowMs: 100 });
  const redirect = getLegalActionsV2(state, daqiao.id).find(
    (entry) => entry.action?.cardId === liuliCost.id && entry.action?.targetId === repeated.id,
  )!;
  state = applyGameActionV2(state, daqiao.id, redirect.action!, { nowMs: 101 });
  assert.equal(state.pending?.actorId, repeated.id);
  state = applyGameActionV2(
    state,
    repeated.id,
    getLegalActionsV2(state, repeated.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 102 },
  );
  for (let guard = 0; state.pending?.kind === "rescue" && guard < 12; guard += 1) {
    const actorId = state.pending.actorId;
    state = applyGameActionV2(
      state,
      actorId,
      getLegalActionsV2(state, actorId).find((entry) => entry.action?.type === "pass")!.action!,
      { nowMs: 103 + guard },
    );
  }
  assert.equal(state.players.find((entry) => entry.id === repeated.id)!.alive, false);
  assert.equal(state.pending?.kind, "response");
  assert.equal(state.pending?.actorId, finalTarget.id, "the dead duplicate occurrence is skipped without a decision");
  state = applyGameActionV2(
    state,
    finalTarget.id,
    getLegalActionsV2(state, finalTarget.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 130 },
  );
  assert.equal(state.pending?.kind, "damageTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "jianxiong");
  state = applyGameActionV2(
    state,
    finalTarget.id,
    getLegalActionsV2(state, finalTarget.id).find((entry) => entry.action?.type === "pass")!.action!,
    { nowMs: 131 },
  );
  assert.equal(state.players.find((entry) => entry.id === daqiao.id)!.hp, daqiao.maxHp);
  assert.equal(state.players.find((entry) => entry.id === finalTarget.id)!.hp, finalHp - 1);
  assert.ok(state.discard.some((card) => card.id === sha.id));
  assert.ok(state.discard.some((card) => card.id === liuliCost.id));
  assertGameInvariantV2(state);
});

test("铁骑 decline keeps the dodge window while a red judgment bypasses an available physical Shan", () => {
  const initial = playing(141014);
  const sourceId = initial.turn!.playerId;
  const machao = assign(initial, sourceId, "machao");
  const target = assign(initial, initial.players.find((entry) => entry.id !== sourceId)!.id, "zhangfei");
  initial.players.filter((entry) => entry.id !== sourceId && entry.id !== target.id).forEach((entry) => assign(initial, entry.id, "caocao"));
  clearHand(initial, sourceId);
  clearHand(initial, target.id);
  const sha = take(initial, (card) => card.name === "杀");
  const shan = take(initial, (card) => card.name === "闪");
  const redJudge = take(initial, (card) => card.color === "red");
  machao.hand.push(sha);
  target.hand.push(shan);
  initial.deck.push(redJudge);
  initial.turn!.phase = "play";
  const use = getLegalActionsV2(initial, sourceId).find((entry) => entry.action?.cardId === sha.id && entry.action?.targetId === target.id)!;
  const tieqi = applyGameActionV2(initial, sourceId, use.action!, { nowMs: 100 });
  assert.equal(tieqi.pending?.kind, "tieqi");

  let declined = structuredClone(tieqi);
  const decline = getLegalActionsV2(declined, sourceId).find((entry) => entry.action?.type === "pass")!;
  declined = applyGameActionV2(declined, sourceId, decline.action!, { nowMs: 101 });
  assert.equal(declined.pending?.kind, "response");
  assert.ok(getLegalActionsV2(declined, target.id).some((entry) => entry.action?.cardId === shan.id));

  let accepted = structuredClone(tieqi);
  const accept = getLegalActionsV2(accepted, sourceId).find((entry) => entry.action?.choice === "yes")!;
  const hpBefore = target.hp;
  accepted = applyGameActionV2(accepted, sourceId, accept.action!, { nowMs: 101 });
  assert.equal(accepted.players.find((entry) => entry.id === target.id)!.hp, hpBefore - 1);
  assert.ok(accepted.players.find((entry) => entry.id === target.id)!.hand.some((card) => card.id === shan.id));
  assert.ok(accepted.logs.some((entry) => entry.text.includes("【铁骑】判定为红色")));
});

test("刚烈 non-heart judgment exposes both exact-two-discard and one-damage outcomes", () => {
  let state = playing(141015);
  const owner = assign(state, state.players.find((entry) => entry.id !== state.turn!.playerId)!.id, "xiahoudun");
  const source = state.players.find((entry) => entry.id === state.turn!.playerId)!;
  state.players.filter((entry) => entry.id !== owner.id).forEach((entry) => assign(state, entry.id, "zhangfei"));
  const nonHeart = take(state, (card) => card.suit !== "heart");
  state.deck.push(nonHeart);
  state.pending = { id: "damage-ganglie", kind: "damageTrigger", actorId: owner.id, prompt: "刚烈", data: { skill: "ganglie", damage: { sourceId: source.id, targetId: owner.id, amount: 1, cardIds: [], reason: "测试" } } };
  const accept = getLegalActionsV2(state, owner.id).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, owner.id, accept.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "ganglieChoice");

  let discardBranch = structuredClone(state);
  const discard = getLegalActionsV2(discardBranch, source.id).find((entry) => entry.skill === "ganglie_discard")!;
  const beforeCards = discardBranch.players.find((entry) => entry.id === source.id)!.hand.length;
  discardBranch = applyGameActionV2(discardBranch, source.id, { type: "skill", skill: "ganglie_discard", cardIds: discard.candidateCardIds!.slice(0, 2) }, { nowMs: 101 });
  assert.equal(discardBranch.players.find((entry) => entry.id === source.id)!.hand.length, beforeCards - 2);

  let damageBranch = structuredClone(state);
  const hpBefore = damageBranch.players.find((entry) => entry.id === source.id)!.hp;
  const damage = getLegalActionsV2(damageBranch, source.id).find((entry) => entry.action?.choice === "damage")!;
  damageBranch = applyGameActionV2(damageBranch, source.id, damage.action!, { nowMs: 101 });
  assert.equal(damageBranch.players.find((entry) => entry.id === source.id)!.hp, hpBefore - 1);
});

test("天妒 accept obtains the exact judgment card while decline discards it and both resume resolution", () => {
  const initial = playing(141016);
  const guojia = assign(initial, initial.players.find((entry) => entry.id !== initial.turn!.playerId)!.id, "guojia");
  const judged = take(initial, () => true);
  initial.processing.push(judged);
  initial.pending = { id: "tiandu-choice", kind: "tiandu", actorId: guojia.id, prompt: "天妒", data: { judgment: { targetId: guojia.id, reason: "刚烈", cardId: judged.id, continuation: { resume: "ganglie" }, guicaiOrder: [], cursor: 0 } } };

  let accepted = structuredClone(initial);
  const accept = getLegalActionsV2(accepted, guojia.id).find((entry) => entry.action?.choice === "yes")!;
  accepted = applyGameActionV2(accepted, guojia.id, accept.action!, { nowMs: 100 });
  assert.ok(accepted.players.find((entry) => entry.id === guojia.id)!.hand.some((card) => card.id === judged.id));
  assert.ok(!accepted.processing.some((card) => card.id === judged.id));

  let declined = structuredClone(initial);
  const decline = getLegalActionsV2(declined, guojia.id).find((entry) => entry.action?.type === "pass")!;
  declined = applyGameActionV2(declined, guojia.id, decline.action!, { nowMs: 100 });
  assert.ok(declined.discard.some((card) => card.id === judged.id));
});

test("洛神 takes black judgments, offers continuation, and stops on the first red judgment", () => {
  let state = playing(141017);
  const actorId = state.turn!.playerId;
  const zhenji = assign(state, actorId, "zhenji");
  state.players.filter((entry) => entry.id !== actorId).forEach((entry) => assign(state, entry.id, "zhangfei"));
  const black = take(state, (card) => card.color === "black");
  state.deck.push(black);
  state.pending = { id: "optional-luoshen", kind: "optionalSkill", actorId, prompt: "洛神", data: { skill: "luoshen", resume: "prepare" } };
  const accept = getLegalActionsV2(state, actorId).find((entry) => entry.action?.choice === "yes")!;
  state = applyGameActionV2(state, actorId, accept.action!, { nowMs: 100 });
  assert.equal(state.pending?.kind, "luoshenContinue");
  assert.ok(state.players.find((entry) => entry.id === zhenji.id)!.hand.some((card) => card.id === black.id));
  const red = take(state, (card) => card.color === "red");
  state.deck.push(red);
  const continueAction = getLegalActionsV2(state, actorId).find((entry) => entry.action?.choice === "continue")!;
  state = applyGameActionV2(state, actorId, continueAction.action!, { nowMs: 101 });
  assert.notEqual(state.pending?.kind, "luoshenContinue");
  assert.ok(state.discard.some((card) => card.id === red.id));
  assertGameInvariantV2(state);
});

test("激将 orders only Shu providers, accepts a converted physical card, stops after all decline, and is disabled in duel", () => {
  const initial = playing(141018);
  const lordId = initial.turn!.playerId;
  const lord = assign(initial, lordId, "liubei");
  lord.role = "lord";
  const provider = assign(initial, initial.players.find((entry) => entry.id !== lordId)!.id, "guanyu");
  initial.players.filter((entry) => entry.id !== lordId && entry.id !== provider.id).forEach((entry) => assign(initial, entry.id, "lvbu"));
  clearHand(initial, provider.id);
  const red = take(initial, (card) => card.color === "red" && card.name !== "杀");
  provider.hand.push(red);
  initial.turn!.phase = "play";
  const target = initial.players.find((entry) => entry.id !== lordId && entry.id !== provider.id)!;
  const jijiang = getLegalActionsV2(initial, lordId).find((entry) => entry.action?.skill === "jijiang" && entry.action?.targetId === target.id)!;
  assert.ok(jijiang);
  const request = applyGameActionV2(initial, lordId, jijiang.action!, { nowMs: 100 });
  assert.equal(request.pending?.kind, "lordRequest");
  assert.equal(request.pending?.actorId, provider.id);
  const converted = getLegalActionsV2(request, provider.id).find((entry) => entry.action?.cardId === red.id && entry.action?.skill === "wusheng")!;
  const provided = applyGameActionV2(request, provider.id, converted.action!, { nowMs: 101 });
  assert.ok(provided.logs.some((entry) => entry.text.includes("【武圣】") && entry.text.includes("【激将】")));
  assert.ok(!provided.players.find((entry) => entry.id === provider.id)!.hand.some((card) => card.id === red.id));

  let declined = structuredClone(request);
  const pass = getLegalActionsV2(declined, provider.id).find((entry) => entry.action?.type === "pass")!;
  declined = applyGameActionV2(declined, provider.id, pass.action!, { nowMs: 101 });
  assert.ok(declined.turn!.usedSkills.includes("jijiangFailed"));
  assert.ok(!getLegalActionsV2(declined, lordId).some((entry) => entry.action?.skill === "jijiang"));

  const duel = playing(141019, 2);
  const duelLordId = duel.turn!.playerId;
  assign(duel, duelLordId, "liubei").role = "lord";
  assign(duel, duel.players.find((entry) => entry.id !== duelLordId)!.id, "guanyu");
  duel.turn!.phase = "play";
  assert.ok(!getLegalActionsV2(duel, duelLordId).some((entry) => entry.action?.skill === "jijiang"));
});

test("离间 requires two distinct male targets, consumes one physical card, bypasses nullification, and is once per turn", () => {
  let state = playing(141020);
  const actorId = state.turn!.playerId;
  const diaochan = assign(state, actorId, "diaochan");
  const males = state.players.filter((entry) => entry.id !== actorId).slice(0, 2);
  assign(state, males[0].id, "caocao");
  assign(state, males[1].id, "zhangfei");
  const female = state.players.find((entry) => entry.id !== actorId && !males.some((male) => male.id === entry.id))!;
  assign(state, female.id, "zhenji");
  state.turn!.phase = "play";
  const lijian = getLegalActionsV2(state, actorId).find((entry) => entry.action?.skill === "lijian" && entry.action?.targetIds?.[0] === males[0].id && entry.action?.targetIds?.[1] === males[1].id)!;
  assert.ok(lijian);
  assert.ok(!getLegalActionsV2(state, actorId).some((entry) => entry.action?.skill === "lijian" && entry.action?.targetIds?.includes(female.id)));
  const costId = lijian.action!.cardId!;
  state = applyGameActionV2(state, actorId, lijian.action!, { nowMs: 100 });
  assert.ok(state.discard.some((card) => card.id === costId));
  assert.notEqual(state.pending?.kind, "nullification");
  assert.equal((state.pending?.data as { use?: { sourceSkill?: string } } | undefined)?.use?.sourceSkill, "lijian");
  assert.ok(!getLegalActionsV2(state, actorId).some((entry) => entry.action?.skill === "lijian"));
  assert.ok(diaochan.alive);
});

test("苦肉 draws two only after surviving the HP loss and does not grant the draw after an unrecoverable self-kill", () => {
  let state = playing(141021);
  const actorId = state.turn!.playerId;
  let huanggai = assign(state, actorId, "huanggai");
  huanggai.hp = 2;
  state.turn!.phase = "play";
  const before = huanggai.hand.length;
  const kurou = getLegalActionsV2(state, actorId).find((entry) => entry.action?.skill === "kurou")!;
  state = applyGameActionV2(state, actorId, kurou.action!, { nowMs: 100 });
  huanggai = state.players.find((entry) => entry.id === actorId)!;
  assert.equal(huanggai.hp, 1);
  assert.equal(huanggai.hand.length, before + 2);

  state = playing(141022);
  const dyingId = state.turn!.playerId;
  const dying = assign(state, dyingId, "huanggai");
  state.players.filter((entry) => entry.id !== dyingId).forEach((entry) => assign(state, entry.id, "zhangfei"));
  for (const owner of state.players) {
    state.discard.push(...owner.hand.filter((card) => card.name === "桃"));
    owner.hand = owner.hand.filter((card) => card.name !== "桃");
  }
  dying.hp = 1;
  state.turn!.phase = "play";
  const handBeforeDeath = dying.hand.length;
  const fatal = getLegalActionsV2(state, dyingId).find((entry) => entry.action?.skill === "kurou")!;
  state = applyGameActionV2(state, dyingId, fatal.action!, { nowMs: 100 });
  for (let step = 0; state.pending?.kind === "rescue" && step < 20; step += 1) {
    const rescuerId = state.pending.actorId;
    const passRescue = getLegalActionsV2(state, rescuerId).find((entry) => entry.action?.type === "pass")!;
    state = applyGameActionV2(state, rescuerId, passRescue.action!, { nowMs: 101 + step });
  }
  const eliminated = state.players.find((entry) => entry.id === dyingId)!;
  assert.equal(eliminated.alive, false);
  assert.ok(eliminated.hand.length <= handBeforeDeath, "fatal Kurou must not grant its two-card draw");
  assertGameInvariantV2(state);
});
