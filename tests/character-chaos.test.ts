import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  assertGameInvariantV2,
  createGameV2,
  getLegalActionsV2,
  type GameActionV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import type { LobbySeat } from "../lib/game-v2-data.ts";

function seats(count: number): LobbySeat[] {
  return Array.from({ length: count }, (_, seat) => ({ id: `chaos-${seat}`, name: `混沌玩家${seat + 1}`, kind: seat % 2 ? "agent" : "human", seat }));
}

function instantiate(option: LegalActionV2): GameActionV2 {
  if (option.kind === "exact") return option.action!;
  if (option.kind === "discard") return { type: "discard", cardIds: option.candidateCardIds!.slice(0, option.minCards) };
  return { type: "skill", skill: option.skill, cardIds: option.candidateCardIds?.slice(0, option.minCards ?? 0), targetIds: option.targetIds?.slice(0, option.minTargets ?? 0) };
}

function rng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function choose(actions: LegalActionV2[], random: () => number) {
  const active = actions.filter((entry) => entry.kind === "skill" || entry.action?.skill);
  const nonPass = actions.filter((entry) => entry.action?.type !== "pass" && entry.action?.type !== "endTurn");
  const pool = active.length && random() < 0.62 ? active : nonPass.length && random() < 0.76 ? nonPass : actions;
  return pool[Math.floor(random() * pool.length)];
}

test("cross-size character chaos preserves invariants and always reaches a legal terminal state", () => {
  const sizes = [2, 4, 5, 6, 7, 8, 9, 10];
  const runCount = Math.max(1, Number(process.env.CHARACTER_CHAOS_RUNS ?? 120));
  const baseSeed = Number(process.env.CHARACTER_CHAOS_BASE ?? 50000);
  const reachedPending = new Set<string>();
  let completed = 0;
  for (let run = 0; run < runCount; run += 1) {
    const seed = baseSeed + run;
    const random = rng(seed ^ 0x9e3779b9);
    let state = createGameV2(seats(sizes[run % sizes.length]), { seed }, { nowMs: 1 });
    for (let step = 0; step < 5000 && state.status !== "finished"; step += 1) {
      if (state.pending) reachedPending.add(state.pending.kind);
      const actorId = state.pending?.actorId ?? state.turn?.playerId;
      assert.ok(actorId, `seed ${seed} step ${step} has no actor`);
      const actions = getLegalActionsV2(state, actorId);
      assert.ok(actions.length > 0, `seed ${seed} step ${step} has no legal action at ${state.pending?.kind ?? state.turn?.phase}`);
      state = applyGameActionV2(state, actorId, instantiate(choose(actions, random)), { nowMs: run * 100000 + step + 2 });
      assertGameInvariantV2(state);
    }
    assert.equal(state.status, "finished", `seed ${seed} (${state.players.length} players) did not finish within 5000 decisions`);
    assert.ok(state.winner?.playerIds.length, `seed ${seed} finished without a winner`);
    completed += 1;
  }
  assert.equal(completed, runCount);
  for (const required of ["response", "nullification", "rescue", "judgment", "chooseZoneCard", "discardPhase"]) {
    assert.ok(reachedPending.has(required), `chaos never reached ${required}`);
  }
  process.stdout.write(`\nCHARACTER_CHAOS_PENDING=${[...reachedPending].sort().join(",")}\n`);
});
