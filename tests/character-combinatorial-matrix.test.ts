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
  id: `matrix-${seat}`,
  name: `矩阵玩家${seat + 1}`,
  kind: "human",
  seat,
}));

function instantiate(option: LegalActionV2, boundary: "first" | "last" = "first"): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  const cardCount = boundary === "last" ? option.maxCards ?? option.minCards ?? 0 : option.minCards ?? 0;
  const targetCount = boundary === "last" ? option.maxTargets ?? option.minTargets ?? 0 : option.minTargets ?? 0;
  const cards = boundary === "last" ? [...(option.candidateCardIds ?? [])].reverse() : option.candidateCardIds ?? [];
  const targets = boundary === "last" ? [...(option.targetIds ?? [])].reverse() : option.targetIds ?? [];
  if (option.kind === "discard") return { type: "discard", cardIds: cards.slice(0, cardCount) };
  return {
    type: "skill",
    skill: option.skill,
    cardIds: cards.slice(0, cardCount),
    targetIds: targets.slice(0, targetCount),
  };
}

function playing(seed: number) {
  let state = createGameV2(seats(), { seed }, { nowMs: 1 });
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

function isolatePlay(state: GameStateV2, actorId: string) {
  state.pending = null;
  state.stack = [];
  state.turn = { playerId: actorId, phase: "play", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
}

function actionSignature(option: LegalActionV2) {
  if (option.kind !== "exact") return `${option.kind}:${option.skill ?? "none"}`;
  const action = option.action!;
  return ["exact", action.type, action.as, action.skill, action.choice, action.zone].filter(Boolean).join(":");
}

function representativeActions(options: LegalActionV2[]) {
  const grouped = new Map<string, LegalActionV2[]>();
  for (const option of options) {
    const signature = actionSignature(option);
    const entries = grouped.get(signature) ?? [];
    entries.push(option);
    grouped.set(signature, entries);
  }
  const actions: GameActionV2[] = [];
  for (const entries of grouped.values()) {
    actions.push(instantiate(entries[0], "first"));
    actions.push(instantiate(entries.at(-1)!, "last"));
  }
  return [...new Map(actions.map((action) => [JSON.stringify(action), action])).values()];
}

function assertLiveDecision(state: GameStateV2) {
  assertGameInvariantV2(state);
  if (state.status === "finished") return;
  const actorId = state.pending?.actorId ?? state.turn?.playerId;
  assert.ok(actorId);
  assert.ok(getLegalActionsV2(state, actorId!).length > 0, `no legal continuation after ${state.pending?.kind ?? state.turn?.phase}`);
}

function clearPublicAndPrivateZones(state: GameStateV2) {
  for (const owner of state.players) {
    state.discard.push(
      ...owner.hand.splice(0),
      ...Object.values(owner.equipment).filter((card): card is Card => Boolean(card)),
      ...owner.judgment.splice(0),
    );
    owner.equipment = { weapon: null, armor: null, offensiveHorse: null, defensiveHorse: null };
  }
}

function chooseSettlementAction(actions: LegalActionV2[], policy: "accept" | "decline") {
  if (policy === "accept") {
    return actions.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass")
      ?? actions.find((entry) => entry.kind === "skill")
      ?? actions.find((entry) => entry.kind === "discard")
      ?? actions[0];
  }
  return actions.find((entry) => entry.kind === "exact" && entry.action?.type === "pass")
    ?? actions.find((entry) => entry.kind === "discard")
    ?? actions.find((entry) => entry.kind === "skill")
    ?? actions[0];
}

function settleCurrentUse(state: GameStateV2, policy: "accept" | "decline", clock: number) {
  let next = state;
  for (let step = 0; next.pending && step < 120; step += 1) {
    const actorId = next.pending.actorId;
    const actions = getLegalActionsV2(next, actorId);
    assert.ok(actions.length > 0, `${policy} policy has no exit from ${next.pending.kind}`);
    next = applyGameActionV2(next, actorId, instantiate(chooseSettlementAction(actions, policy)), { nowMs: clock + step });
    assertGameInvariantV2(next);
  }
  assert.equal(next.pending, null, `${policy} policy did not settle within the decision bound`);
  assert.equal(next.stack.length, 0, `${policy} policy left an in-flight frame`);
  assertLiveDecision(next);
  return next;
}

test("all 25 generals × every equipment name keep representative boundary actions executable", () => {
  const base = playing(152001);
  const allCards = [
    ...base.deck,
    ...base.discard,
    ...base.players.flatMap((entry) => [...entry.hand, ...Object.values(entry.equipment).filter((card): card is Card => Boolean(card)), ...entry.judgment]),
  ];
  const equipmentNames = [...new Set(allCards.filter((card) => card.category === "equip").map((card) => card.name))];
  let pairCount = 0;
  let probeCount = 0;

  for (const character of STANDARD_CHARACTERS) {
    for (const equipmentName of [null, ...equipmentNames]) {
      const state = structuredClone(base);
      const actorId = state.turn!.playerId;
      const actor = assign(state, actorId, character.id);
      const otherPlayers = state.players.filter((entry) => entry.id !== actorId);
      assign(state, otherPlayers[0].id, "caocao").hp -= 1;
      assign(state, otherPlayers[1].id, "zhenji").hp -= 1;
      assign(state, otherPlayers[2].id, "zhangfei").hp -= 1;
      if (equipmentName) {
        const equipment = take(state, (card) => card.name === equipmentName);
        actor.equipment[equipment.slot!] = equipment;
      }
      const wanted = ["杀", "闪", "桃", "决斗", "过河拆桥", "顺手牵羊", "乐不思蜀", "无中生有"];
      for (const name of wanted) actor.hand.push(take(state, (card) => card.name === name));
      isolatePlay(state, actorId);

      const actions = representativeActions(getLegalActionsV2(state, actorId));
      assert.ok(actions.length > 0);
      for (const action of actions) {
        const next = applyGameActionV2(state, actorId, action, { nowMs: 100 + probeCount });
        assertLiveDecision(next);
        probeCount += 1;
      }
      pairCount += 1;
    }
  }

  assert.equal(pairCount, STANDARD_CHARACTERS.length * (equipmentNames.length + 1));
  assert.ok(probeCount > 4_000);
  console.log(`CHARACTER_EQUIPMENT_MATRIX_PAIRS=${pairCount}`);
  console.log(`CHARACTER_EQUIPMENT_MATRIX_PROBES=${probeCount}`);
});

test("every ordered pair of 25 generals settles Sha and Duel through both accept and decline policies", () => {
  const base = playing(152008);
  const sourceId = base.turn!.playerId;
  const targetId = base.players.find((entry) => entry.id !== sourceId && distanceV2(base, sourceId, entry.id) === 1)!.id;
  let scenarios = 0;
  let decisions = 0;

  for (const sourceCharacter of STANDARD_CHARACTERS) {
    for (const targetCharacter of STANDARD_CHARACTERS) {
      for (const cardName of ["杀", "决斗"] as const) {
        for (const policy of ["accept", "decline"] as const) {
          const state = structuredClone(base);
          clearPublicAndPrivateZones(state);
          const source = assign(state, sourceId, sourceCharacter.id);
          const target = assign(state, targetId, targetCharacter.id);
          const others = state.players.filter((entry) => entry.id !== source.id && entry.id !== target.id);
          others.forEach((entry) => assign(state, entry.id, "zhangfei"));
          source.role = "lord";
          source.maxHp = source.character!.maxHp + 1;
          source.hp = source.maxHp;
          target.role = "rebel";
          others[0].role = "loyalist";
          others[1].role = "renegade";

          const useCard = take(state, (card) => card.name === cardName);
          if (cardName === "杀") {
            const convertedShan = take(state, (card) => card.name === "杀" && card.id !== useCard.id);
            const qingguoCard = take(state, (card) => card.color === "black" && !["杀", "闪", "桃"].includes(card.name));
            const shanOne = take(state, (card) => card.name === "闪");
            const shanTwo = take(state, (card) => card.name === "闪");
            source.hand.push(useCard);
            target.hand.push(convertedShan, qingguoCard, shanOne, shanTwo);
          } else {
            const sourceShan = take(state, (card) => card.name === "闪");
            const sourceSha = take(state, (card) => card.name === "杀");
            const targetShan = take(state, (card) => card.name === "闪");
            const targetSha = take(state, (card) => card.name === "杀" && card.id !== sourceSha.id);
            source.hand.push(useCard, sourceShan, sourceSha);
            target.hand.push(targetShan, targetSha);
          }
          isolatePlay(state, source.id);
          const use = getLegalActionsV2(state, source.id).find(
            (entry) => entry.action?.cardId === useCard.id && entry.action?.targetId === target.id,
          );
          assert.ok(use?.action, `${sourceCharacter.name} -> ${targetCharacter.name} ${cardName} is executable`);
          const started = applyGameActionV2(state, source.id, use.action!, { nowMs: 1_000_000 + scenarios * 200 });
          const before = started.decisionSeq;
          const settled = settleCurrentUse(started, policy, 1_000_001 + scenarios * 200);
          decisions += settled.decisionSeq - before;
          scenarios += 1;
        }
      }
    }
  }

  assert.equal(scenarios, STANDARD_CHARACTERS.length ** 2 * 4);
  assert.ok(decisions > 2_500);
  console.log(`CHARACTER_ORDERED_PAIR_SCENARIOS=${scenarios}`);
  console.log(`CHARACTER_ORDERED_PAIR_DECISIONS=${decisions}`);
});

test("all 25 target generals enforce Qianxun delayed-trick rules and duplicate judgment exclusion", () => {
  const base = playing(152002);
  const actorId = base.turn!.playerId;
  const nearestId = base.players.find((entry) => entry.id !== actorId && distanceV2(base, actorId, entry.id) === 1)!.id;

  for (const character of STANDARD_CHARACTERS) {
    let state = structuredClone(base);
    const actor = assign(state, actorId, "huangyueying");
    const target = assign(state, nearestId, character.id);
    const indulgence = take(state, (card) => card.name === "乐不思蜀");
    const snatch = take(state, (card) => card.name === "顺手牵羊");
    actor.hand.push(indulgence, snatch);
    isolatePlay(state, actorId);
    const targetActions = getLegalActionsV2(state, actorId).filter((entry) => entry.action?.targetId === target.id);
    assert.equal(targetActions.some((entry) => entry.action?.cardId === indulgence.id), character.id !== "luxun", `${character.name} indulgence target rule`);
    assert.equal(targetActions.some((entry) => entry.action?.cardId === snatch.id), character.id !== "luxun", `${character.name} snatch target rule`);

    state = structuredClone(base);
    const duplicateActor = assign(state, actorId, "huangyueying");
    const duplicateTarget = assign(state, nearestId, character.id);
    const installed = take(state, (card) => card.name === "乐不思蜀");
    const second = take(state, (card) => card.name === "乐不思蜀");
    duplicateTarget.judgment.push(installed);
    duplicateActor.hand.push(second);
    isolatePlay(state, actorId);
    assert.ok(!getLegalActionsV2(state, actorId).some((entry) => entry.action?.cardId === second.id && entry.action.targetId === duplicateTarget.id), `${character.name} cannot receive duplicate indulgence`);

    state = structuredClone(base);
    const daqiao = assign(state, actorId, "daqiao");
    const guoseTarget = assign(state, nearestId, character.id);
    const diamond = take(state, (card) => card.suit === "diamond" && card.name !== "乐不思蜀");
    daqiao.hand.push(diamond);
    isolatePlay(state, actorId);
    assert.equal(
      getLegalActionsV2(state, actorId).some((entry) => entry.action?.cardId === diamond.id && entry.action?.as === "乐不思蜀" && entry.action.targetId === guoseTarget.id),
      character.id !== "luxun",
      `${character.name} Guose target rule`,
    );
  }
});

test("Kongcheng target exclusion remains exact across every target general", () => {
  const base = playing(152003);
  const actorId = base.turn!.playerId;
  const targetId = base.players.find((entry) => entry.id !== actorId && distanceV2(base, actorId, entry.id) === 1)!.id;
  for (const character of STANDARD_CHARACTERS) {
    const state = structuredClone(base);
    const actor = assign(state, actorId, "caocao");
    const target = assign(state, targetId, character.id);
    state.discard.push(...target.hand.splice(0));
    const visibleEquipment = take(state, (card) => card.slot === "armor");
    target.equipment.armor = visibleEquipment;
    const sha = take(state, (card) => card.name === "杀");
    const duel = take(state, (card) => card.name === "决斗");
    const dismantle = take(state, (card) => card.name === "过河拆桥");
    actor.hand.push(sha, duel, dismantle);
    isolatePlay(state, actorId);
    const actions = getLegalActionsV2(state, actorId).filter((entry) => entry.action?.targetId === target.id);
    assert.equal(actions.some((entry) => entry.action?.cardId === sha.id), character.id !== "zhugeliang", `${character.name} Sha targeting`);
    assert.equal(actions.some((entry) => entry.action?.cardId === duel.id), character.id !== "zhugeliang", `${character.name} Duel targeting`);
    assert.ok(actions.some((entry) => entry.action?.cardId === dismantle.id), `${character.name} remains targetable by dismantle`);
  }
});

test("Wushuang consumes a successful Bagua judgment as only the first of two Shan", () => {
  let state = playing(152004);
  const source = assign(state, state.turn!.playerId, "lvbu");
  const target = assign(state, state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id, "caocao");
  for (const other of state.players.filter((entry) => ![source.id, target.id].includes(entry.id))) assign(state, other.id, "zhangfei");
  state.discard.push(...source.hand.splice(0), ...target.hand.splice(0));
  const sha = take(state, (card) => card.name === "杀");
  const shan = take(state, (card) => card.name === "闪");
  const bagua = take(state, (card) => card.name === "八卦阵");
  const redJudge = take(state, (card) => card.color === "red");
  source.hand.push(sha);
  target.hand.push(shan);
  target.equipment.armor = bagua;
  state.deck.push(redJudge);
  isolatePlay(state, source.id);
  const hpBefore = target.hp;

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
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.pending?.kind, "response");
  assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
  state = applyGameActionV2(
    state,
    target.id,
    getLegalActionsV2(state, target.id).find((entry) => entry.action?.cardId === shan.id)!.action!,
    { nowMs: 102 },
  );
  assert.equal(state.players.find((entry) => entry.id === target.id)!.hp, hpBefore);
  assert.notEqual(state.pending?.kind, "response");
  assertGameInvariantV2(state);
});

test("Qinggang suppresses both Renwang blocking and Bagua while preserving a normal response", () => {
  for (const armorName of ["仁王盾", "八卦阵"] as const) {
    let state = playing(armorName === "仁王盾" ? 152005 : 152006);
    const source = assign(state, state.turn!.playerId, "caocao");
    const target = assign(state, state.players.find((entry) => entry.id !== source.id && distanceV2(state, source.id, entry.id) === 1)!.id, "zhangfei");
    state.discard.push(...source.hand.splice(0), ...target.hand.splice(0));
    const qinggang = take(state, (card) => card.name === "青釭剑");
    const blackSha = take(state, (card) => card.name === "杀" && card.color === "black");
    const armor = take(state, (card) => card.name === armorName);
    source.equipment.weapon = qinggang;
    source.hand.push(blackSha);
    target.equipment.armor = armor;
    isolatePlay(state, source.id);
    state = applyGameActionV2(
      state,
      source.id,
      getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === blackSha.id && entry.action.targetId === target.id)!.action!,
      { nowMs: 100 },
    );
    assert.equal(state.pending?.kind, "response", `Qinggang ignores ${armorName}`);
    assert.equal((state.pending!.data as { remaining: number }).remaining, 1);
    assert.ok(!state.logs.some((entry) => entry.text.includes("令黑色【杀】无效")));
    assertGameInvariantV2(state);
  }
});

test("replacing Xiaoji's own equipment creates one optional two-card draw", () => {
  let state = playing(152007);
  const actorId = state.turn!.playerId;
  const actor = assign(state, actorId, "sunshangxiang");
  const oldWeapon = take(state, (card) => card.slot === "weapon");
  const newWeapon = take(state, (card) => card.slot === "weapon" && card.id !== oldWeapon.id);
  actor.equipment.weapon = oldWeapon;
  actor.hand.push(newWeapon);
  isolatePlay(state, actorId);
  const before = actor.hand.length;
  state = applyGameActionV2(
    state,
    actorId,
    getLegalActionsV2(state, actorId).find((entry) => entry.action?.cardId === newWeapon.id)!.action!,
    { nowMs: 100 },
  );
  assert.equal(state.pending?.kind, "lossTrigger");
  assert.equal((state.pending!.data as { skill: string }).skill, "xiaoji");
  assert.ok(state.discard.some((card) => card.id === oldWeapon.id));
  state = applyGameActionV2(
    state,
    actorId,
    getLegalActionsV2(state, actorId).find((entry) => entry.action?.choice === "yes")!.action!,
    { nowMs: 101 },
  );
  assert.equal(state.players.find((entry) => entry.id === actorId)!.hand.length, before - 1 + 2);
  assertGameInvariantV2(state);
});
