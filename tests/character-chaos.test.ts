import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameActionV2,
  applyTimeoutV2,
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

function actionSignature(option: LegalActionV2) {
  if (option.kind !== "exact") return `${option.kind}:${option.skill ?? "none"}`;
  const action = option.action!;
  return [option.kind, action.type, action.skill, action.choice, action.as, action.zone].join(":");
}

function boundaryInstances(option: LegalActionV2) {
  if (option.kind === "exact") return [option.action!];
  const cardCounts = [...new Set([option.minCards ?? 0, option.maxCards ?? option.minCards ?? 0])];
  const targetCounts = [...new Set([option.minTargets ?? 0, option.maxTargets ?? option.minTargets ?? 0])];
  const actions: GameActionV2[] = [];
  for (const cardCount of cardCounts) for (const targetCount of targetCounts) {
    for (const reverse of [false, true]) {
      const cards = reverse ? [...(option.candidateCardIds ?? [])].reverse() : (option.candidateCardIds ?? []);
      const targets = reverse ? [...(option.targetIds ?? [])].reverse() : (option.targetIds ?? []);
      actions.push(option.kind === "discard"
        ? { type: "discard", cardIds: cards.slice(0, cardCount) }
        : { type: "skill", skill: option.skill, cardIds: cards.slice(0, cardCount), targetIds: targets.slice(0, targetCount) });
    }
  }
  return actions;
}

test("cross-size character chaos preserves invariants and always reaches a legal terminal state", () => {
  const sizes = [2, 4, 5, 6, 7, 8, 9, 10];
  const runCount = Math.max(1, Number(process.env.CHARACTER_CHAOS_RUNS ?? 120));
  const baseSeed = Number(process.env.CHARACTER_CHAOS_BASE ?? 50000);
  const reachedPending = new Set<string>();
  const timeoutVerifiedPending = new Set<string>();
  const validationVerifiedPending = new Set<string>();
  let timeoutVerifiedPlayPhase = false;
  let completed = 0;
  for (let run = 0; run < runCount; run += 1) {
    const seed = baseSeed + run;
    const random = rng(seed ^ 0x9e3779b9);
    let state = createGameV2(seats(sizes[run % sizes.length]), { seed }, { nowMs: 1 });
    for (let step = 0; step < 5000 && state.status !== "finished"; step += 1) {
      if (state.pending) {
        reachedPending.add(state.pending.kind);
        if (!validationVerifiedPending.has(state.pending.kind)) {
          const original = JSON.stringify(state);
          const actorId = state.pending.actorId;
          const legal = getLegalActionsV2(state, actorId);
          const selected = instantiate(legal[0]);
          const wrongActor = state.players.find((entry) => entry.alive && entry.id !== actorId)!;
          assert.deepEqual(getLegalActionsV2(state, wrongActor.id), [], `wrong actor saw legal actions for ${state.pending.kind}`);
          assert.throws(
            () => applyGameActionV2(state, wrongActor.id, selected, { nowMs: run * 100000 + step + 2 }),
            undefined,
            `wrong actor action was accepted for ${state.pending.kind}`,
          );
          assert.throws(
            () => applyGameActionV2(state, actorId, { type: "choose", choice: "__fabricated__", decisionId: state.pending!.id }, { nowMs: run * 100000 + step + 2 }),
            undefined,
            `fabricated action was accepted for ${state.pending.kind}`,
          );
          assert.throws(
            () => applyGameActionV2(state, actorId, { ...selected, decisionId: `${state.pending!.id}:stale` }, { nowMs: run * 100000 + step + 2 }),
            undefined,
            `stale decision was accepted for ${state.pending.kind}`,
          );
          assert.equal(JSON.stringify(state), original, `rejected submission mutated ${state.pending.kind}`);
          validationVerifiedPending.add(state.pending.kind);
        }
        if (!timeoutVerifiedPending.has(state.pending.kind)) {
          const decisionId = state.pending.id;
          const timedOut = structuredClone(state);
          timedOut.deadlineAt = new Date(0).toISOString();
          const advanced = applyTimeoutV2(timedOut, { nowMs: run * 100000 + step + 2 });
          assertGameInvariantV2(advanced);
          assert.notEqual(advanced.pending?.id, decisionId, `timeout did not advance ${state.pending.kind}`);
          assert.ok(advanced.logs.some((entry) => entry.text.includes("行动超时")), `timeout log missing for ${state.pending.kind}`);
          timeoutVerifiedPending.add(state.pending.kind);
        }
      } else if (!timeoutVerifiedPlayPhase && state.turn?.phase === "play") {
        const turnPlayerId = state.turn.playerId;
        const timedOut = structuredClone(state);
        timedOut.deadlineAt = new Date(0).toISOString();
        const advanced = applyTimeoutV2(timedOut, { nowMs: run * 100000 + step + 2 });
        assertGameInvariantV2(advanced);
        assert.ok(advanced.turn?.playerId !== turnPlayerId || advanced.turn?.phase !== "play" || advanced.status === "finished");
        timeoutVerifiedPlayPhase = true;
      }
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
  assert.deepEqual(timeoutVerifiedPending, reachedPending, "every reached pending kind must survive its safe timeout path");
  assert.deepEqual(validationVerifiedPending, reachedPending, "every reached pending kind must reject cross-seat, fabricated, and stale submissions");
  assert.equal(timeoutVerifiedPlayPhase, true, "the normal play-phase timeout path was not exercised");
  if (runCount >= 120) {
    for (const required of ["response", "nullification", "rescue", "judgment", "chooseZoneCard", "discardPhase"]) {
      assert.ok(reachedPending.has(required), `chaos never reached ${required}`);
    }
  }
  process.stdout.write(`\nCHARACTER_CHAOS_PENDING=${[...reachedPending].sort().join(",")}\n`);
  process.stdout.write(`CHARACTER_CHAOS_TIMEOUTS=${[...timeoutVerifiedPending].sort().join(",")}\n`);
  process.stdout.write(`CHARACTER_CHAOS_VALIDATION=${[...validationVerifiedPending].sort().join(",")}\n`);
});

test("representative legal-action fan-out survives accept, decline, minimum, maximum, first, and last alternatives", () => {
  const sizes = [2, 4, 5, 6, 7, 8, 9, 10];
  const runCount = Math.max(1, Number(process.env.CHARACTER_BRANCH_RUNS ?? 24));
  const baseSeed = Number(process.env.CHARACTER_BRANCH_BASE ?? 200000);
  const exercised = new Set<string>();
  let probes = 0;

  for (let run = 0; run < runCount; run += 1) {
    const seed = baseSeed + run;
    const random = rng(seed ^ 0x85ebca6b);
    let state = createGameV2(seats(sizes[run % sizes.length]), { seed }, { nowMs: 1 });
    for (let step = 0; step < 5000 && state.status !== "finished"; step += 1) {
      const actorId = state.pending?.actorId ?? state.turn?.playerId;
      assert.ok(actorId, `fan-out seed ${seed} step ${step} has no actor`);
      const actions = getLegalActionsV2(state, actorId);
      assert.ok(actions.length > 0, `fan-out seed ${seed} step ${step} has no legal action`);

      if (step < 600) {
        const groups = new Map<string, LegalActionV2[]>();
        for (const option of actions) {
          const signature = actionSignature(option);
          const group = groups.get(signature) ?? [];
          group.push(option);
          groups.set(signature, group);
        }
        const alternatives: GameActionV2[] = [];
        for (const [signature, group] of groups) {
          exercised.add(`${state.pending?.kind ?? state.turn?.phase}:${signature}`);
          for (const option of [group[0], group[group.length - 1]]) alternatives.push(...boundaryInstances(option));
        }
        const unique = [...new Map(alternatives.map((action) => [JSON.stringify(action), action])).values()].slice(0, 24);
        for (const alternative of unique) {
          const branch = applyGameActionV2(state, actorId, alternative, { nowMs: run * 100000 + step + 2 });
          assertGameInvariantV2(branch);
          if (branch.status !== "finished") {
            const nextActor = branch.pending?.actorId ?? branch.turn?.playerId;
            assert.ok(nextActor, `fan-out branch ${seed}/${step} lost its actor`);
            assert.ok(getLegalActionsV2(branch, nextActor).length > 0, `fan-out branch ${seed}/${step} deadlocked after ${JSON.stringify(alternative)}`);
          }
          probes += 1;
        }
      }

      state = applyGameActionV2(state, actorId, instantiate(choose(actions, random)), { nowMs: run * 100000 + step + 2 });
      assertGameInvariantV2(state);
    }
    assert.equal(state.status, "finished", `fan-out seed ${seed} did not finish within 5000 decisions`);
  }
  assert.ok(exercised.size >= 55, `fan-out reached too few distinct action signatures: ${exercised.size}`);
  assert.ok(probes >= 2_000, `fan-out executed too few alternative actions: ${probes}`);
  process.stdout.write(`\nCHARACTER_BRANCH_SIGNATURES=${exercised.size}\nCHARACTER_BRANCH_PROBES=${probes}\n`);
});
