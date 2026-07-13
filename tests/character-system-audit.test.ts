import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  assertGameInvariantV2,
  createGameV2,
  EFFECT_FRAME_KINDS_V2,
  getLegalActionsV2,
  PENDING_KINDS_V2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import { SKILLS, STANDARD_CHARACTERS, kingdomName, type LobbySeat, type SkillId } from "../lib/game-v2-data.ts";

type SkillClass = "active" | "conversion" | "trigger" | "locked" | "lord";

const SKILL_CLASSES: Record<SkillId, SkillClass> = {
  jianxiong: "trigger", hujia: "lord", fankui: "trigger", guicai: "trigger", ganglie: "trigger",
  tuxi: "trigger", luoyi: "trigger", tiandu: "trigger", yiji: "trigger", qingguo: "conversion",
  luoshen: "trigger", rende: "active", jijiang: "lord", wusheng: "conversion", paoxiao: "locked",
  guanxing: "trigger", kongcheng: "locked", longdan: "conversion", mashu: "locked", tieqi: "trigger",
  jizhi: "trigger", qicai: "locked", zhiheng: "active", jiuyuan: "lord", qixi: "conversion",
  keji: "trigger", kurou: "active", yingzi: "trigger", fanjian: "active", guose: "conversion",
  liuli: "trigger", qianxun: "locked", lianying: "trigger", jieyin: "active", xiaoji: "trigger",
  jijiu: "conversion", qingnang: "active", wushuang: "locked", lijian: "active", biyue: "trigger",
};

const REQUIRED_AXES: Record<SkillClass, string[]> = {
  active: ["available", "cost-boundary", "target-boundary", "once-per-turn", "resolution", "timeout", "ui", "privacy"],
  conversion: ["matching-card", "non-matching-card", "multiple-physical-cards", "play", "response", "provenance", "ui", "privacy"],
  trigger: ["trigger", "no-trigger", "accept", "decline", "no-resource", "ordering", "timeout", "ui", "privacy"],
  locked: ["applies", "does-not-apply", "boundary", "interaction", "ui", "privacy"],
  lord: ["eligible-provider", "ineligible-provider", "all-decline", "provider-conversion", "duel-disabled", "timeout", "ui", "privacy"],
};

const TARGETED_SKILL_SUITES = new Set<SkillId>([
  "paoxiao", "kongcheng", "mashu", "qicai", "jiuyuan", "keji", "qianxun", "wushuang", "biyue",
]);

function seats(count: number): LobbySeat[] {
  return Array.from({ length: count }, (_, seat) => ({ id: `audit-p${seat}`, name: `审计玩家${seat + 1}`, kind: "agent", seat }));
}

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

function setup(state: GameStateV2) {
  let next = state;
  for (let step = 0; next.status === "setup" && step < 300; step += 1) {
    const actorId = next.pending!.actorId;
    const legal = getLegalActionsV2(next, actorId);
    const selected = legal.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass") ?? legal[0];
    next = applyGameActionV2(next, actorId, instantiate(selected), { nowMs: step + 2 });
  }
  assert.equal(next.status, "playing");
  return next;
}

function preferred(actions: LegalActionV2[]) {
  return actions.find((entry) => entry.kind === "skill")
    ?? actions.find((entry) => entry.action?.skill)
    ?? actions.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass" && entry.action?.type !== "endTurn")
    ?? actions.find((entry) => entry.kind === "discard")
    ?? actions.find((entry) => entry.action?.type === "pass")
    ?? actions[0];
}

test("the executable character audit manifest covers every declared general and skill", () => {
  assert.equal(STANDARD_CHARACTERS.length, 25);
  assert.equal(Object.keys(SKILLS).length, 40);
  assert.equal(PENDING_KINDS_V2.length, 34);
  assert.equal(new Set(PENDING_KINDS_V2).size, PENDING_KINDS_V2.length);
  assert.equal(EFFECT_FRAME_KINDS_V2.length, 20);
  assert.equal(new Set(EFFECT_FRAME_KINDS_V2).size, EFFECT_FRAME_KINDS_V2.length);
  assert.deepEqual(
    (["wei", "shu", "wu", "qun"] as const).map((kingdom) => kingdomName(kingdom)),
    ["魏", "蜀", "吴", "群"],
  );
  assert.deepEqual(new Set(Object.keys(SKILL_CLASSES)), new Set(Object.keys(SKILLS)));
  for (const general of STANDARD_CHARACTERS) {
    assert.ok(general.skills.length > 0, `${general.name} has no declared skill`);
    for (const skill of general.skills) assert.ok(SKILL_CLASSES[skill], `${general.name}.${skill} is not classified`);
  }
  for (const [skill, kind] of Object.entries(SKILL_CLASSES)) {
    assert.ok(REQUIRED_AXES[kind].length >= 6, `${skill} has an incomplete edge-case axis list`);
  }
});

test("skill-biased deterministic games preserve invariants and report which skills still need targeted scenarios", () => {
  const offered = new Set<SkillId>();
  const announced = new Set<SkillId>();
  const names = Object.values(SKILLS).map((entry) => [entry.id, `【${entry.name}】`] as const);

  for (let run = 0; run < 24; run += 1) {
    let state = setup(createGameV2(seats(10), { seed: 12000 + run }, { nowMs: 1 }));
    const offset = (run * 10) % STANDARD_CHARACTERS.length;
    state.players.forEach((player, index) => {
      const general = STANDARD_CHARACTERS[(offset + index) % STANDARD_CHARACTERS.length];
      player.character = general;
      player.maxHp = general.maxHp + (player.role === "lord" ? 1 : 0);
      player.hp = player.maxHp;
    });
    for (let step = 0; step < 1500 && state.status !== "finished"; step += 1) {
      const actorId = state.pending?.actorId ?? state.turn!.playerId;
      const actions = getLegalActionsV2(state, actorId);
      assert.ok(actions.length > 0, `run ${run} step ${step} has no legal exit from ${state.pending?.kind ?? state.turn?.phase}`);
      for (const entry of actions) {
        const skill = (entry.skill ?? entry.action?.skill) as SkillId | undefined;
        if (skill && skill in SKILLS) offered.add(skill);
      }
      state = applyGameActionV2(state, actorId, instantiate(preferred(actions)), { nowMs: run * 100000 + step + 2 });
      assertGameInvariantV2(state);
      for (const log of state.logs.slice(-4)) {
        for (const [skill, label] of names) if (log.text.includes(label)) announced.add(skill);
      }
    }
  }

  const uncovered = Object.keys(SKILLS).filter((skill) => !offered.has(skill as SkillId) && !announced.has(skill as SkillId) && !TARGETED_SKILL_SUITES.has(skill as SkillId));
  assert.ok(offered.size + announced.size >= 20, `biased exploration reached too few skills: ${[...new Set([...offered, ...announced])].join(", ")}`);
  assert.deepEqual(uncovered, [], `skills missing both exploration and a targeted suite: ${uncovered.join(",")}`);
  process.stdout.write(`\nCHARACTER_AUDIT_TARGETED_GAPS=${uncovered.join(",")}\n`);
});
