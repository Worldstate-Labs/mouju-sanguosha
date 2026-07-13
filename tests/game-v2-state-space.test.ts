import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  applyGameActionV2,
  assertGameInvariantV2,
  createGameV2,
  distanceV2,
  getLegalActionsV2,
  PENDING_KINDS_V2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "../lib/game-v2.ts";
import { STANDARD_CHARACTERS, type Card, type LobbySeat } from "../lib/game-v2-data.ts";

const MAX_ACTIONS_PER_STATE = Number(process.env.MODEL_MAX_ACTIONS_PER_STATE ?? 20_000);
const MAX_GRAPH_STATES = Number(process.env.MODEL_MAX_GRAPH_STATES ?? 1_000);
const MAX_GRAPH_TRANSITIONS = Number(process.env.MODEL_MAX_GRAPH_TRANSITIONS ?? 15_000);
const GRAPH_DEPTH = Number(process.env.MODEL_GRAPH_DEPTH ?? 4);
const TRACE_RUNS = Number(process.env.MODEL_TRACE_RUNS ?? 16);

const seats = (count: number, namespace: string): LobbySeat[] => Array.from({ length: count }, (_, seat) => ({
  id: `${namespace}-p${seat}`,
  name: `模型玩家${seat + 1}`,
  kind: "agent",
  seat,
}));

function combinations(values: string[], minimum: number, maximum: number) {
  const result: string[][] = [];
  const selected: string[] = [];
  const visit = (start: number, wanted: number) => {
    if (selected.length === wanted) {
      result.push([...selected]);
      if (result.length > MAX_ACTIONS_PER_STATE) throw new Error("单状态组合数超过模型检查上限");
      return;
    }
    for (let index = start; index <= values.length - (wanted - selected.length); index += 1) {
      selected.push(values[index]);
      visit(index + 1, wanted);
      selected.pop();
    }
  };
  for (let count = minimum; count <= maximum; count += 1) visit(0, count);
  return result;
}

function enumerateTemplate(option: LegalActionV2): GameActionV2[] {
  const candidateCards = option.candidateCardIds ?? [];
  const candidateTargets = option.targetIds ?? [];
  const minimumCards = option.minCards ?? 0;
  const maximumCards = option.maxCards ?? minimumCards;
  const minimumTargets = option.minTargets ?? 0;
  const maximumTargets = option.maxTargets ?? minimumTargets;
  const cardSets = combinations(candidateCards, minimumCards, maximumCards);
  const targetSets = combinations(candidateTargets, minimumTargets, maximumTargets);
  const actions: GameActionV2[] = [];
  for (const cardIds of cardSets) {
    for (const targetIds of targetSets) {
      if (actions.length >= MAX_ACTIONS_PER_STATE) throw new Error("单状态动作数超过模型检查上限");
      if (option.kind === "discard") actions.push({ type: "discard", cardIds });
      else if (option.kind === "arrange") actions.push({ type: "arrange", cardIds, targetIds });
      else actions.push({ type: "skill", skill: option.skill, cardIds, targetIds });
    }
  }
  return actions;
}

function enumerateLegalActions(options: LegalActionV2[]) {
  const actions = options.flatMap((option) => option.kind === "exact" ? [option.action!] : enumerateTemplate(option));
  const unique = [...new Map(actions.map((action) => [JSON.stringify(action), action])).values()];
  if (unique.length > MAX_ACTIONS_PER_STATE) throw new Error("单状态动作数超过模型检查上限");
  return unique;
}

function semanticState(state: GameStateV2) {
  const value = structuredClone(state);
  value.logs = [];
  value.logSeq = 0;
  value.deadlineAt = null;
  value.decisionSeq = 0;
  value.frameSeq = 0;
  if (value.pending) value.pending.id = "decision";
  value.stack.forEach((frame, index) => { frame.id = `frame-${index}`; });
  return value;
}

function stateHash(state: GameStateV2) {
  return createHash("sha256").update(JSON.stringify(semanticState(state))).digest("hex");
}

function activeActor(state: GameStateV2) {
  return state.pending?.actorId ?? state.turn?.playerId ?? null;
}

function deterministicRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function chooseTraceAction(actions: LegalActionV2[], random: () => number) {
  const active = actions.filter((entry) => entry.kind === "skill" || entry.action?.skill);
  const nonPass = actions.filter((entry) => entry.action?.type !== "pass" && entry.action?.type !== "endTurn");
  const pool = active.length && random() < 0.62 ? active : nonPass.length && random() < 0.76 ? nonPass : actions;
  const option = pool[Math.floor(random() * pool.length)];
  return enumerateLegalActions([option])[0];
}

function finishSetup(initial: GameStateV2) {
  let state = initial;
  for (let step = 0; state.status === "setup" && step < 300; step += 1) {
    const actorId = state.pending!.actorId;
    const legal = getLegalActionsV2(state, actorId);
    const selected = legal.find((entry) => entry.kind === "exact" && entry.action?.type !== "pass") ?? legal[0];
    state = applyGameActionV2(state, actorId, enumerateLegalActions([selected])[0], { nowMs: step + 2 });
  }
  assert.equal(state.status, "playing");
  return state;
}

function takeCard(state: GameStateV2, predicate: (card: Card) => boolean) {
  for (const zone of [state.deck, state.discard, state.processing, state.revealed]) {
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
  throw new Error("model-check card not found");
}

function assignCharacter(state: GameStateV2, playerId: string, characterId: string) {
  const target = state.players.find((entry) => entry.id === playerId)!;
  target.character = STANDARD_CHARACTERS.find((entry) => entry.id === characterId)!;
  target.maxHp = target.character.maxHp;
  target.hp = target.maxHp;
  return target;
}

function clearOwnedCards(state: GameStateV2, playerId: string) {
  const target = state.players.find((entry) => entry.id === playerId)!;
  state.discard.push(...target.hand.splice(0), ...Object.values(target.equipment).filter((card): card is Card => Boolean(card)));
  target.equipment = { weapon: null, armor: null, offensiveHorse: null, defensiveHorse: null };
}

function reachableQilinDecision() {
  let state = finishSetup(createGameV2(seats(4, "qilin-root"), { seed: 819_999 }, { nowMs: 1 }));
  const sourceId = state.turn!.playerId;
  const targetId = state.players.find((entry) => entry.id !== sourceId && distanceV2(state, sourceId, entry.id) === 1)!.id;
  const source = assignCharacter(state, sourceId, "caocao");
  const target = assignCharacter(state, targetId, "zhangfei");
  clearOwnedCards(state, source.id);
  clearOwnedCards(state, target.id);
  const weapon = takeCard(state, (card) => card.name === "麒麟弓");
  const sha = takeCard(state, (card) => card.name === "杀");
  const horse = takeCard(state, (card) => card.slot === "defensiveHorse");
  source.equipment.weapon = weapon;
  source.hand.push(sha);
  target.equipment.defensiveHorse = horse;
  state.pending = null;
  state.stack = [];
  state.turn = { playerId: source.id, phase: "play", shaUsed: 0, usedSkills: [], stats: {}, skipped: [] };
  const use = getLegalActionsV2(state, source.id).find((entry) => entry.action?.cardId === sha.id && entry.action.targetId === target.id)!;
  state = applyGameActionV2(state, source.id, use.action!, { nowMs: 100 });
  const decline = getLegalActionsV2(state, target.id).find((entry) => entry.action?.type === "pass")!;
  state = applyGameActionV2(state, target.id, decline.action!, { nowMs: 101 });
  assert.equal(state.pending?.kind, "qilin");
  assertGameInvariantV2(state);
  return state;
}

function stateSignature(state: GameStateV2) {
  const actorId = activeActor(state);
  const actor = state.players.find((entry) => entry.id === actorId);
  const location = state.pending ? `pending:${state.pending.kind}` : `phase:${state.turn?.phase ?? "none"}`;
  return `${state.mode}:${state.players.length}:${location}:${actor?.character?.id ?? "setup"}:${state.stack.at(-1)?.kind ?? "empty"}`;
}

test("bounded reachable-state exploration exhausts every legal action at each processed state", () => {
  const sizes = [2, 4, 6, 10];
  const roots: GameStateV2[] = [];
  const guidedRoots = new Map<string, GameStateV2>();
  const setupKinds = new Set<string>();
  let tracedGames = 0;

  const qilinRoot = reachableQilinDecision();
  guidedRoots.set(stateSignature(qilinRoot), qilinRoot);

  for (const [index, count] of sizes.entries()) {
    const initial = createGameV2(seats(count, `graph-${count}`), { seed: 810_000 + index }, { nowMs: 1 });
    assertGameInvariantV2(initial);
    setupKinds.add(initial.pending!.kind);
    guidedRoots.set(stateSignature(initial), initial);
    roots.push(finishSetup(initial));
  }

  const traceSizes = [2, 4, 5, 6, 7, 8, 9, 10];
  for (let run = 0; run < TRACE_RUNS; run += 1) {
    const seed = 820_000 + run;
    const random = deterministicRandom(seed ^ 0x9e37_79b9);
    let state = createGameV2(seats(traceSizes[run % traceSizes.length], `trace-${run}`), { seed }, { nowMs: 1 });
    for (let step = 0; step < 5_000 && state.status !== "finished"; step += 1) {
      const signature = stateSignature(state);
      if (!guidedRoots.has(signature)) guidedRoots.set(signature, structuredClone(state));
      const actorId = activeActor(state);
      assert.ok(actorId, `trace ${run}/${step} has no actor`);
      const legal = getLegalActionsV2(state, actorId!);
      assert.ok(legal.length > 0, `trace ${run}/${step} deadlocked at ${signature}`);
      state = applyGameActionV2(state, actorId!, chooseTraceAction(legal, random), { nowMs: run * 10_000 + step + 2 });
      assertGameInvariantV2(state);
    }
    assert.equal(state.status, "finished", `trace seed ${seed} did not terminate`);
    tracedGames += 1;
  }

  for (const root of guidedRoots.values()) roots.push(root);
  const queue = roots.map((state) => ({ state, depth: 0 }));
  const seen = new Set<string>();
  const reachedLocations = new Set<string>();
  const reachedPending = new Set<string>();
  const reachedPhases = new Set<string>();
  const reachedCharacters = new Set<string>();
  let processedStates = 0;
  let transitions = 0;
  let maximumActions = 0;
  let deferredStates = 0;

  while (queue.length && processedStates < MAX_GRAPH_STATES) {
    const current = queue.shift()!;
    const hash = stateHash(current.state);
    if (seen.has(hash)) continue;
    seen.add(hash);
    if (current.state.status === "finished") continue;
    const actorId = activeActor(current.state);
    assert.ok(actorId);
    const legalOptions = getLegalActionsV2(current.state, actorId!);
    assert.ok(legalOptions.length > 0, `no legal action at ${stateSignature(current.state)}`);
    const actions = enumerateLegalActions(legalOptions);
    maximumActions = Math.max(maximumActions, actions.length);
    if (transitions + actions.length > MAX_GRAPH_TRANSITIONS) {
      deferredStates += 1;
      continue;
    }

    const before = JSON.stringify(current.state);
    const location = current.state.pending ? current.state.pending.kind : current.state.turn!.phase;
    reachedLocations.add(location);
    if (current.state.pending) reachedPending.add(current.state.pending.kind);
    else reachedPhases.add(current.state.turn!.phase);
    const actor = current.state.players.find((entry) => entry.id === actorId);
    if (actor?.character) reachedCharacters.add(actor.character.id);

    for (const [actionIndex, action] of actions.entries()) {
      const context = { nowMs: 9_000_000 + transitions + actionIndex };
      const next = applyGameActionV2(current.state, actorId!, action, context);
      const replay = applyGameActionV2(current.state, actorId!, action, context);
      assert.deepEqual(replay, next, `transition is not deterministic for ${JSON.stringify(action)}`);
      assert.equal(JSON.stringify(current.state), before, "transition mutated its input state");
      assertGameInvariantV2(next);
      assert.notEqual(stateHash(next), hash, `legal action made no semantic progress: ${JSON.stringify(action)}`);

      if (next.status === "finished") {
        assert.ok(next.winner?.playerIds.length);
        assert.ok(next.players.every((entry) => getLegalActionsV2(next, entry.id).length === 0));
      } else {
        const nextActorId = activeActor(next);
        assert.ok(nextActorId, "unfinished transition has no next actor");
        const authorized = next.players.filter((entry) => getLegalActionsV2(next, entry.id).length > 0);
        assert.deepEqual(authorized.map((entry) => entry.id), [nextActorId], "action mask exposes zero or multiple controllers");
        if (current.depth < GRAPH_DEPTH) queue.push({ state: next, depth: current.depth + 1 });
      }
      transitions += 1;
    }
    processedStates += 1;
  }

  assert.equal(tracedGames, TRACE_RUNS);
  assert.deepEqual(setupKinds, new Set(["duelColor", "chooseCharacter"]));
  assert.ok(processedStates >= 100, `processed too few states: ${processedStates}`);
  assert.ok(transitions >= 2_000, `executed too few exhaustive transitions: ${transitions}`);
  assert.ok(reachedLocations.size >= 15, `reached too few decision/phase locations: ${reachedLocations.size}`);
  assert.ok(reachedCharacters.size >= 15, `reached too few acting generals: ${reachedCharacters.size}`);
  assert.ok(reachedPending.size >= 25, `reached too few pending kinds: ${reachedPending.size}/${PENDING_KINDS_V2.length}`);
  assert.deepEqual(reachedPhases, new Set(["play"]), "only play is an externally actionable phase; the other phases auto-advance");
  const missingPending = PENDING_KINDS_V2.filter((kind) => !reachedPending.has(kind));
  process.stdout.write(
    `\nMODEL_TRACED_GAMES=${tracedGames}`
    + `\nMODEL_GUIDED_ROOTS=${guidedRoots.size}`
    + `\nMODEL_PROCESSED_STATES=${processedStates}`
    + `\nMODEL_EXHAUSTIVE_TRANSITIONS=${transitions}`
    + `\nMODEL_REACHED_LOCATIONS=${reachedLocations.size}`
    + `\nMODEL_REACHED_PENDING=${reachedPending.size}/${PENDING_KINDS_V2.length}`
    + `\nMODEL_MISSING_PENDING=${missingPending.join(",")}`
    + `\nMODEL_REACHED_ACTION_PHASES=${reachedPhases.size}/1`
    + `\nMODEL_REACHED_CHARACTERS=${reachedCharacters.size}`
    + `\nMODEL_MAX_ACTIONS_IN_STATE=${maximumActions}`
    + `\nMODEL_DEFERRED_STATES=${deferredStates}`
    + `\nMODEL_FRONTIER_STATES=${queue.length}\n`,
  );
});
