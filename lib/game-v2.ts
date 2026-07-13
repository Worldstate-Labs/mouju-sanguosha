import {
  CARD_METADATA,
  ROLE_MAP,
  SKILLS,
  STANDARD_CHARACTERS,
  STANDARD_DECK,
  cardColor,
  kingdomName,
  roleName,
  type Card,
  type CardName,
  type Character,
  type EquipmentSlot,
  type LobbySeat,
  type Role,
  type SkillId,
  type StandardCardName,
} from "./game-v2-data";

export type TurnPhase = "prepare" | "judge" | "draw" | "play" | "discard" | "finish";

export interface EquipmentState {
  weapon: Card | null;
  armor: Card | null;
  offensiveHorse: Card | null;
  defensiveHorse: Card | null;
}

export interface GamePlayerV2 extends LobbySeat {
  role: Role;
  character: Character | null;
  hp: number;
  maxHp: number;
  alive: boolean;
  hand: Card[];
  equipment: EquipmentState;
  judgment: Card[];
  marks: Record<string, number>;
  generalEpoch: number;
  duelRoster?: string[];
  duelLineup?: string[];
  duelDefeated?: string[];
}

export interface BattleLogV2 {
  id: number;
  text: string;
  tone: "normal" | "good" | "danger" | "system";
  at: string;
  visual?: BattleVisualV2;
}

export interface BattleVisualV2 {
  kind: "use" | "aoe" | "transfer" | "discard" | "draw" | "damage" | "heal" | "equip" | "respond" | "nullify" | "judge" | "death" | "turn";
  actorId?: string;
  sourceId?: string;
  targetIds?: string[];
  cardName?: string;
  cardNames?: string[];
  count?: number;
  amount?: number;
  zone?: "hand" | "equip" | "judge" | "deck" | "discard";
}

export interface TurnStateV2 {
  playerId: string;
  phase: TurnPhase;
  shaUsed: number;
  usedSkills: string[];
  stats: Record<string, number | boolean>;
  skipped: TurnPhase[];
}

export interface PendingDecisionV2 {
  id: string;
  kind: string;
  actorId: string;
  prompt: string;
  data: Record<string, unknown>;
}

export interface EffectFrameV2 {
  id: string;
  kind: string;
  step: number;
  data: Record<string, unknown>;
}

export interface GameSetupV2 {
  order: string[];
  index: number;
  characterPool: string[];
  duel?: {
    colorChooserId: string;
    colorChosen: boolean;
    slots: Array<{ id: string; characterId: string; revealed: boolean; pickedBy?: string }>;
    rosters: Record<string, string[]>;
    lineupOrder: string[];
    lineupIndex: number;
    lineupProgress: Record<string, string[]>;
  };
}

export interface WinnerV2 {
  side: "lord" | "rebel" | "renegade";
  label: string;
  playerIds: string[];
}

export interface GameStateV2 {
  engineVersion: 2;
  schemaVersion: 1 | 2;
  rulesetId: "classic-standard-2009-ex";
  mode?: "duel" | "identity";
  duelFirstPlayerId?: string;
  duelFirstDrawPending?: boolean;
  duelTurnTerminated?: boolean;
  status: "setup" | "playing" | "finished";
  players: GamePlayerV2[];
  deck: Card[];
  discard: Card[];
  processing: Card[];
  revealed: Card[];
  round: number;
  turn: TurnStateV2 | null;
  pending: PendingDecisionV2 | null;
  stack: EffectFrameV2[];
  triggers: Array<{ skill: "lianying" | "xiaoji"; actorId: string }>;
  setup: GameSetupV2 | null;
  winner: WinnerV2 | null;
  deadlineAt: string | null;
  rngMode?: "system-v1" | "xorshift32-legacy";
  rngState: number;
  logSeq: number;
  frameSeq: number;
  decisionSeq: number;
  logs: BattleLogV2[];
}

export interface EngineContextV2 {
  nowMs?: number;
}

export interface GameActionV2 {
  type: string;
  decisionId?: string;
  optionId?: string;
  cardId?: string;
  cardIds?: string[];
  targetId?: string;
  targetIds?: string[];
  characterId?: string;
  skill?: string;
  as?: string;
  choice?: string;
  orderedCardIds?: string[];
  zone?: string;
  suit?: string;
}

export interface LegalActionV2 {
  id: string;
  kind: "exact" | "discard" | "skill" | "arrange";
  label: string;
  description?: string;
  action?: GameActionV2;
  skill?: string;
  candidateCardIds?: string[];
  minCards?: number;
  maxCards?: number;
  targetIds?: string[];
  minTargets?: number;
  maxTargets?: number;
  choices?: Array<{ id: string; label: string }>;
  ordered?: boolean;
}

interface CardUse {
  id: string;
  sourceId: string;
  name: StandardCardName;
  cardIds: string[];
  color: "red" | "black" | "none";
  targets: string[];
  targetIndex: number;
  noNullification?: boolean;
  ignoreArmor?: boolean;
  sourceSkill?: string;
  data?: Record<string, unknown>;
}

interface DamageSpec {
  sourceId?: string;
  targetId: string;
  amount: number;
  cardIds: string[];
  cardName?: CardName;
  reason: string;
  targetEpoch?: number;
}

const LORD_CHARACTER_IDS = ["caocao", "liubei", "sunquan"];
const RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function now(context?: EngineContextV2) {
  return context?.nowMs ?? 0;
}

function iso(context?: EngineContextV2) {
  return new Date(now(context)).toISOString();
}

function player(state: GameStateV2, id: string) {
  const found = state.players.find((entry) => entry.id === id);
  if (!found) throw new Error("角色不存在");
  return found;
}

function characterById(id: string) {
  const found = STANDARD_CHARACTERS.find((entry) => entry.id === id);
  if (!found) throw new Error("武将不存在");
  return found;
}

function hasSkill(target: GamePlayerV2, skill: SkillId) {
  return Boolean(target.character?.skills.includes(skill));
}

function addLog(
  state: GameStateV2,
  text: string,
  tone: BattleLogV2["tone"] = "normal",
  context?: EngineContextV2,
  visual?: BattleVisualV2,
) {
  state.logSeq += 1;
  state.logs.push({ id: state.logSeq, text, tone, at: iso(context), ...(visual ? { visual } : {}) });
  if (state.logs.length > 240) state.logs = state.logs.slice(-240);
}

function legacyRandom(state: GameStateV2) {
  let value = state.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0 || 0x9e3779b9;
  return state.rngState / 0x1_0000_0000;
}

function randomInt(state: GameStateV2, max: number) {
  if (!Number.isInteger(max) || max <= 0) throw new Error("随机范围无效");
  if (state.rngMode !== "system-v1") return Math.floor(legacyRandom(state) * max);

  // Production games use the runtime CSPRNG. Rejection sampling avoids modulo
  // bias while keeping all secret randomness out of the client projection.
  const range = 0x1_0000_0000;
  const ceiling = range - (range % max);
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while (values[0] >= ceiling);
  return values[0] % max;
}

function shuffle<T>(state: GameStateV2, values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(state, index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function alivePlayers(state: GameStateV2) {
  return state.players.filter((entry) => entry.alive).sort((a, b) => a.seat - b.seat);
}

function actionOrder(state: GameStateV2, startingId: string, includeStarting = true) {
  const alive = alivePlayers(state);
  const start = alive.findIndex((entry) => entry.id === startingId);
  if (start < 0) return alive;
  const offset = includeStarting ? 0 : 1;
  return Array.from({ length: alive.length - (includeStarting ? 0 : 1) }, (_, index) => alive[(start + index + offset) % alive.length]);
}

function nextAlive(state: GameStateV2, currentId: string) {
  return actionOrder(state, currentId, false)[0] ?? null;
}

function seatDistance(state: GameStateV2, fromId: string, toId: string) {
  const alive = alivePlayers(state);
  const from = alive.findIndex((entry) => entry.id === fromId);
  const to = alive.findIndex((entry) => entry.id === toId);
  if (from < 0 || to < 0 || from === to) return from === to ? 0 : Number.POSITIVE_INFINITY;
  const raw = Math.abs(from - to);
  return Math.min(raw, alive.length - raw);
}

export function distanceV2(state: GameStateV2, fromId: string, toId: string) {
  const from = player(state, fromId);
  const to = player(state, toId);
  let result = seatDistance(state, fromId, toId);
  if (from.equipment.offensiveHorse) result -= 1;
  if (to.equipment.defensiveHorse) result += 1;
  if (hasSkill(from, "mashu")) result -= 1;
  return Math.max(1, result);
}

export function attackRangeV2(target: GamePlayerV2) {
  const weapon = target.equipment.weapon;
  if (!weapon || weapon.name === "酒") return 1;
  return CARD_METADATA[weapon.name as StandardCardName]?.attackRange ?? 1;
}

function equipmentCards(target: GamePlayerV2) {
  return Object.values(target.equipment).filter((card): card is Card => Boolean(card));
}

function allOwnedCards(target: GamePlayerV2) {
  return [...target.hand, ...equipmentCards(target)];
}

function cardIndex(cards: Card[], id: string) {
  return cards.findIndex((card) => card.id === id);
}

function removeCard(cards: Card[], id: string) {
  const index = cardIndex(cards, id);
  if (index < 0) return null;
  return cards.splice(index, 1)[0];
}

function restorePhysicalCard(card: Card) {
  delete card.asName;
  return card;
}

function removeOwnedCard(target: GamePlayerV2, id: string) {
  const fromHand = removeCard(target.hand, id);
  if (fromHand) return { card: fromHand, zone: "hand" as const };
  for (const slot of ["weapon", "armor", "offensiveHorse", "defensiveHorse"] as EquipmentSlot[]) {
    if (target.equipment[slot]?.id === id) {
      const card = target.equipment[slot]!;
      target.equipment[slot] = null;
      return { card, zone: slot };
    }
  }
  return null;
}

function removeOwnedCardsTracked(state: GameStateV2, target: GamePlayerV2, ids: string[]) {
  const handBefore = target.hand.length;
  let removedFromHand = 0;
  let removedEquipment = 0;
  const removed = ids.map((id) => {
    const result = removeOwnedCard(target, id);
    if (!result) throw new Error("所选牌已不在你的可用区域");
    if (result.zone === "hand") removedFromHand += 1;
    else removedEquipment += 1;
    return result;
  });
  if (target.alive && handBefore > 0 && removedFromHand > 0 && target.hand.length === 0 && hasSkill(target, "lianying")) {
    state.triggers.push({ skill: "lianying", actorId: target.id });
  }
  if (target.alive && removedEquipment > 0 && hasSkill(target, "xiaoji")) {
    for (let index = 0; index < removedEquipment; index += 1) state.triggers.push({ skill: "xiaoji", actorId: target.id });
  }
  return removed;
}

function queueEquipmentLossTrigger(state: GameStateV2, target: GamePlayerV2, count = 1) {
  if (!target.alive || !hasSkill(target, "xiaoji")) return;
  for (let index = 0; index < count; index += 1) state.triggers.push({ skill: "xiaoji", actorId: target.id });
}

function findCardEverywhere(state: GameStateV2, id: string) {
  const zones = [state.deck, state.discard, state.processing, state.revealed];
  for (const zone of zones) {
    const found = zone.find((card) => card.id === id);
    if (found) return found;
  }
  for (const target of state.players) {
    const found = target.hand.find((card) => card.id === id)
      ?? equipmentCards(target).find((card) => card.id === id)
      ?? target.judgment.find((card) => card.id === id);
    if (found) return found;
  }
  return null;
}

function recycleDeck(state: GameStateV2, context?: EngineContextV2) {
  if (state.deck.length > 0 || state.discard.length === 0) return;
  state.deck = shuffle(state, state.discard);
  state.discard = [];
  addLog(state, "弃牌堆重新洗入牌堆。", "system", context);
}

function draw(state: GameStateV2, targetId: string, count: number, context?: EngineContextV2) {
  const target = player(state, targetId);
  for (let index = 0; index < count; index += 1) {
    recycleDeck(state, context);
    const card = state.deck.pop();
    if (!card) break;
    target.hand.push(card);
  }
}

function pushFrame(state: GameStateV2, kind: string, data: Record<string, unknown> = {}) {
  state.frameSeq += 1;
  state.stack.push({ id: `f${state.frameSeq}`, kind, step: 0, data });
}

function setPending(
  state: GameStateV2,
  kind: string,
  actorId: string,
  prompt: string,
  data: Record<string, unknown> = {},
) {
  state.decisionSeq += 1;
  state.pending = { id: `d${state.decisionSeq}`, kind, actorId, prompt, data };
}

function dataAs<T>(value: Record<string, unknown>) {
  return value as T;
}

function exact(id: string, label: string, action: GameActionV2, description?: string): LegalActionV2 {
  return { id, kind: "exact", label, action, description };
}

function stampDeadline(state: GameStateV2, context?: EngineContextV2) {
  if (state.status === "finished") {
    state.deadlineAt = null;
    return;
  }
  const duration = state.pending ? 35_000 : state.turn?.phase === "play" ? 75_000 : 35_000;
  state.deadlineAt = new Date(now(context) + duration).toISOString();
}

function buildCards(cardIds?: string[]) {
  if (cardIds && (cardIds.length !== STANDARD_DECK.length || new Set(cardIds).size !== cardIds.length)) {
    throw new Error("牌实体 ID 必须覆盖整副牌且保持唯一");
  }
  return STANDARD_DECK.map((blueprint, index) => {
    const metadata = CARD_METADATA[blueprint.name];
    return {
      // Production passes opaque IDs generated independently from the gameplay RNG.
      // The stable fallback keeps seeded engine tests exactly reproducible.
      id: cardIds?.[index] ?? `c_test_${String(index + 1).padStart(3, "0")}`,
      name: blueprint.name,
      suit: blueprint.suit,
      rank: blueprint.rank,
      color: cardColor(blueprint.suit),
      category: metadata.category,
      slot: metadata.slot,
    } satisfies Card;
  });
}

function defaultEquipment(): EquipmentState {
  return { weapon: null, armor: null, offensiveHorse: null, defensiveHorse: null };
}

function chooseOptions(state: GameStateV2, pool: string[], count: number) {
  return shuffle(state, pool).slice(0, Math.min(count, pool.length));
}

function beginCharacterSelection(state: GameStateV2) {
  const setup = state.setup!;
  const actorId = setup.order[setup.index];
  const target = player(state, actorId);
  let choices: string[];
  if (target.role === "lord") {
    const extraPool = setup.characterPool.filter((id) => !LORD_CHARACTER_IDS.includes(id));
    choices = [...LORD_CHARACTER_IDS, ...chooseOptions(state, extraPool, 2)];
  } else choices = chooseOptions(state, setup.characterPool, 3);
  setPending(state, "chooseCharacter", actorId, "请选择你的武将", { choices });
}

function beginDuelSetup(state: GameStateV2) {
  const setup = state.setup!;
  const duel = setup.duel!;
  if (!duel.colorChosen) {
    setPending(state, "duelColor", duel.colorChooserId, "请选择暖色或冷色：暖色先选将，冷色先行动", {});
    return;
  }
  if (setup.index < setup.order.length) {
    const actorId = setup.order[setup.index];
    setPending(state, "duelDraft", actorId, "经典1V1选将：请选择一名武将", {});
    return;
  }
  const actorId = duel.lineupOrder[duel.lineupIndex];
  const progress = duel.lineupProgress[actorId] ?? [];
  const ordinal = ["首发", "第二", "第三"][progress.length] ?? "下一";
  setPending(state, "duelLineup", actorId, `请秘密确定${ordinal}名出场武将`, {});
}

function duelColorActions() {
  return [
    exact("duel-color:warm", "选择暖色 · 获得选将先手", { type: "choose", choice: "warm" }),
    exact("duel-color:cool", "选择冷色 · 获得行动先手", { type: "choose", choice: "cool" }),
  ];
}

function handleDuelColor(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const setup = state.setup!;
  const duel = setup.duel!;
  if (actor.id !== duel.colorChooserId || !["warm", "cool"].includes(action.choice ?? "")) {
    throw new Error("暖色/冷色选择无效");
  }
  const other = state.players.find((entry) => entry.id !== actor.id)!;
  const warm = action.choice === "warm" ? actor : other;
  const cool = action.choice === "cool" ? actor : other;
  warm.role = "lord";
  cool.role = "renegade";
  state.duelFirstPlayerId = cool.id;
  setup.order = [warm.id, cool.id, cool.id, warm.id, warm.id, cool.id, cool.id, warm.id, warm.id, cool.id];
  duel.lineupOrder = [warm.id, cool.id];
  duel.colorChosen = true;
  state.pending = null;
  addLog(state, `${actor.name} 选择${action.choice === "warm" ? "暖色（选将先手）" : "冷色（行动先手）"}。`, "system", context);
  beginDuelSetup(state);
}

function duelDraftActions(state: GameStateV2, actor: GamePlayerV2) {
  void actor;
  const slots = state.setup!.duel!.slots.filter((slot) => !slot.pickedBy);
  return slots.map((slot) => exact(
    `duel-draft:${slot.id}`,
    slot.revealed
      ? `选择 ${characterById(slot.characterId).name}`
      : `选择暗置武将 ${slot.id.replace("general-slot-", "")}`,
    { type: "choose", choice: slot.id },
    slot.revealed ? characterById(slot.characterId).skillText : "暗置武将选中后仅你可见",
  ));
}

function handleDuelDraft(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const setup = state.setup!;
  const duel = setup.duel!;
  if (setup.order[setup.index] !== actor.id) throw new Error("现在不是你的选将顺序");
  const slot = duel.slots.find((entry) => entry.id === action.choice && !entry.pickedBy);
  if (!slot) throw new Error("该武将位置已经不可选择");
  const wasRevealed = slot.revealed;
  slot.pickedBy = actor.id;
  slot.revealed = true;
  duel.rosters[actor.id].push(slot.characterId);
  actor.duelRoster = [...duel.rosters[actor.id]];
  setup.index += 1;
  state.pending = null;
  addLog(
    state,
    wasRevealed ? `${actor.name} 选择了 ${characterById(slot.characterId).name}。` : `${actor.name} 选择了一名暗置武将。`,
    "system",
    context,
  );
  beginDuelSetup(state);
}

function duelLineupActions(state: GameStateV2, actor: GamePlayerV2) {
  const duel = state.setup!.duel!;
  const selected = duel.lineupProgress[actor.id] ?? [];
  const ordinal = ["首发", "第二将", "第三将"][selected.length] ?? "出场";
  return duel.rosters[actor.id]
    .filter((id) => !selected.includes(id))
    .map((id) => exact(
      `duel-lineup:${selected.length}:${id}`,
      `${ordinal}：${characterById(id).name}`,
      { type: "choose", characterId: id },
      characterById(id).skillText,
    ));
}

function handleDuelLineup(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const setup = state.setup!;
  const duel = setup.duel!;
  if (duel.lineupOrder[duel.lineupIndex] !== actor.id) throw new Error("现在不是你确定阵容的顺序");
  const selected = duel.lineupProgress[actor.id] ?? [];
  const characterId = action.characterId ?? "";
  if (!duel.rosters[actor.id].includes(characterId) || selected.includes(characterId)) {
    throw new Error("该武将不在你的可选阵容中");
  }
  selected.push(characterId);
  duel.lineupProgress[actor.id] = selected;
  state.pending = null;
  if (selected.length < 3) {
    beginDuelSetup(state);
    return;
  }
  actor.duelLineup = [...selected];
  duel.lineupIndex += 1;
  addLog(state, `${actor.name} 已秘密确定三名武将的出场顺序。`, "system", context);
  if (duel.lineupIndex < duel.lineupOrder.length) beginDuelSetup(state);
  else finishDuelSetup(state, context);
}

function finishDuelSetup(state: GameStateV2, context?: EngineContextV2) {
  for (const target of state.players) {
    const firstGeneral = characterById(target.duelLineup![0]);
    target.character = firstGeneral;
    target.maxHp = firstGeneral.maxHp;
    target.hp = target.maxHp;
    target.duelDefeated = [];
    draw(state, target.id, 4, context);
  }
  const first = player(state, state.duelFirstPlayerId!);
  state.setup = null;
  state.status = "playing";
  state.round = 1;
  state.duelFirstDrawPending = true;
  state.turn = {
    playerId: first.id,
    phase: "prepare",
    shaUsed: 0,
    usedSkills: [],
    stats: {},
    skipped: [],
  };
  addLog(state, `经典1V1开始，${first.name} 获得行动先手；双方首发武将同时亮出。`, "system", context);
  pushFrame(state, "enterPhase", { phase: "prepare" });
}

function finishSetup(state: GameStateV2, context?: EngineContextV2) {
  state.setup = null;
  state.status = "playing";
  for (const target of state.players) draw(state, target.id, 4, context);
  const lord = state.players.find((entry) => entry.role === "lord")!;
  addLog(
    state,
    `身份局开始，${lord.name} 是主公，武将为 ${lord.character?.name}。`,
    "system",
    context,
  );
  state.round = 1;
  state.turn = {
    playerId: lord.id,
    phase: "prepare",
    shaUsed: 0,
    usedSkills: [],
    stats: {},
    skipped: [],
  };
  pushFrame(state, "enterPhase", { phase: "prepare" });
}

export function createGameV2(
  seats: LobbySeat[],
  options: {
    seed?: number;
    cardIds?: string[];
    rngMode?: "system-v1" | "xorshift32-legacy";
  } = {},
  context?: EngineContextV2,
): GameStateV2 {
  const mode = seats.length === 2 ? "duel" : "identity";
  if (seats.length !== 2 && (seats.length < 4 || seats.length > 10)) {
    throw new Error("经典标准规则支持 2 人对决或 4–10 人身份局");
  }
  const randomSeed = options.seed ?? 0x6d2b79f5;
  const state: GameStateV2 = {
    engineVersion: 2,
    schemaVersion: 2,
    rulesetId: "classic-standard-2009-ex",
    mode,
    status: "setup",
    players: [],
    deck: [],
    discard: [],
    processing: [],
    revealed: [],
    round: 0,
    turn: null,
    pending: null,
    stack: [],
    triggers: [],
    setup: null,
    winner: null,
    deadlineAt: null,
    rngMode: options.rngMode ?? (options.seed === undefined ? "system-v1" : "xorshift32-legacy"),
    rngState: randomSeed >>> 0,
    logSeq: 0,
    frameSeq: 0,
    decisionSeq: 0,
    logs: [],
  };
  const roles = shuffle(state, ROLE_MAP[seats.length]);
  state.players = seats.map((seat, index) => ({
    ...seat,
    role: roles[index],
    character: null,
    hp: 0,
    maxHp: 0,
    alive: true,
    hand: [],
    equipment: defaultEquipment(),
    judgment: [],
    marks: {},
    generalEpoch: 0,
    duelRoster: mode === "duel" ? [] : undefined,
    duelLineup: mode === "duel" ? [] : undefined,
    duelDefeated: mode === "duel" ? [] : undefined,
  }));
  state.deck = shuffle(state, buildCards(options.cardIds));
  const lord = state.players.find((entry) => entry.role === "lord")!;
  if (mode === "duel") {
    const candidates = chooseOptions(state, STANDARD_CHARACTERS.map((entry) => entry.id), 10);
    const colorChooser = state.players[randomInt(state, state.players.length)];
    state.setup = {
      order: [],
      index: 0,
      characterPool: candidates,
      duel: {
        colorChooserId: colorChooser.id,
        colorChosen: false,
        slots: candidates.map((characterId, index) => ({
          id: `general-slot-${index + 1}`,
          characterId,
          revealed: index < 6,
        })),
        rosters: Object.fromEntries(state.players.map((entry) => [entry.id, []])),
        lineupOrder: [],
        lineupIndex: 0,
        lineupProgress: Object.fromEntries(state.players.map((entry) => [entry.id, []])),
      },
    };
    beginDuelSetup(state);
  } else {
    state.setup = {
      order: actionOrder(state, lord.id, true).map((entry) => entry.id),
      index: 0,
      characterPool: STANDARD_CHARACTERS.map((entry) => entry.id),
    };
    beginCharacterSelection(state);
  }
  stampDeadline(state, context);
  return state;
}

function handleChooseCharacter(
  state: GameStateV2,
  action: GameActionV2,
  context?: EngineContextV2,
) {
  const pending = state.pending!;
  const { choices } = dataAs<{ choices: string[] }>(pending.data);
  const characterId = action.characterId ?? "";
  if (!choices.includes(characterId)) throw new Error("该武将不在本次候选中");
  const target = player(state, pending.actorId);
  const selected = characterById(characterId);
  target.character = selected;
  target.maxHp = selected.maxHp + (target.role === "lord" && state.players.length >= 3 ? 1 : 0);
  target.hp = target.maxHp;
  const setup = state.setup!;
  setup.characterPool = setup.characterPool.filter((id) => id !== characterId);
  setup.index += 1;
  state.pending = null;
  addLog(state, `${target.name} 已选择武将。`, "system", context);
  if (setup.index >= setup.order.length) finishSetup(state, context);
  else beginCharacterSelection(state);
}

function beginTurn(state: GameStateV2, targetId: string, context?: EngineContextV2) {
  const target = player(state, targetId);
  state.turn = {
    playerId: target.id,
    phase: "prepare",
    shaUsed: 0,
    usedSkills: [],
    stats: {},
    skipped: [],
  };
  addLog(state, `轮到 ${target.name}。`, "system", context);
  pushFrame(state, "enterPhase", { phase: "prepare" });
}

function endTurn(state: GameStateV2, context?: EngineContextV2) {
  const current = player(state, state.turn!.playerId);
  const next = nextAlive(state, current.id);
  if (!next) return;
  if (next.seat <= current.seat) state.round += 1;
  addLog(state, `${current.name} 的回合结束。`, "system", context);
  beginTurn(state, next.id, context);
}

function enterPhase(state: GameStateV2, phase: TurnPhase, context?: EngineContextV2) {
  const turn = state.turn!;
  turn.phase = phase;
  const target = player(state, turn.playerId);
  if (turn.skipped.includes(phase)) {
    addLog(state, `${target.name} 跳过${phaseLabel(phase)}。`, "system", context);
    pushNextPhase(state, phase);
    return;
  }
  addLog(state, `${target.name} 进入${phaseLabel(phase)}。`, "normal", context);
  if (phase === "prepare") pushFrame(state, "preparePhase");
  else if (phase === "judge") pushFrame(state, "judgePhase");
  else if (phase === "draw") pushFrame(state, "drawPhase");
  else if (phase === "play") return;
  else if (phase === "discard") pushFrame(state, "discardPhase");
  else pushFrame(state, "finishPhase");
}

function phaseLabel(phase: TurnPhase) {
  return {
    prepare: "准备阶段",
    judge: "判定阶段",
    draw: "摸牌阶段",
    play: "出牌阶段",
    discard: "弃牌阶段",
    finish: "结束阶段",
  }[phase];
}

function pushNextPhase(state: GameStateV2, phase: TurnPhase) {
  const phases: TurnPhase[] = ["prepare", "judge", "draw", "play", "discard", "finish"];
  const next = phases[phases.indexOf(phase) + 1];
  if (next) pushFrame(state, "enterPhase", { phase: next });
  else pushFrame(state, "endTurn");
}

function processPreparePhase(state: GameStateV2) {
  const target = player(state, state.turn!.playerId);
  if (hasSkill(target, "guanxing") && !state.turn!.usedSkills.includes("guanxing:phase")) {
    setPending(state, "optionalSkill", target.id, "是否发动【观星】？", { skill: "guanxing", resume: "prepare" });
    return;
  }
  if (hasSkill(target, "luoshen") && !state.turn!.usedSkills.includes("luoshen:phase")) {
    setPending(state, "optionalSkill", target.id, "是否发动【洛神】？", { skill: "luoshen", resume: "prepare" });
    return;
  }
  pushNextPhase(state, "prepare");
}

function processJudgePhase(state: GameStateV2) {
  const target = player(state, state.turn!.playerId);
  if (target.judgment.length === 0) {
    pushNextPhase(state, "judge");
    return;
  }
  const delayed = target.judgment.at(-1)!;
  removeCard(target.judgment, delayed.id);
  state.processing.push(delayed);
  pushFrame(state, "resolveDelayed", { playerId: target.id, cardId: delayed.id, name: delayed.asName ?? delayed.name });
}

function processDrawPhase(state: GameStateV2, context?: EngineContextV2) {
  const target = player(state, state.turn!.playerId);
  const drawCount = phaseDrawCount(state);
  if (hasSkill(target, "tuxi")) {
    const candidates = alivePlayers(state).filter((entry) => entry.id !== target.id && entry.hand.length > 0);
    if (candidates.length > 0) {
      setPending(state, "drawChoice", target.id, "摸牌阶段：是否发动【突袭】？", {
        skill: "tuxi",
        targetIds: candidates.map((entry) => entry.id),
        drawCount,
      });
      return;
    }
  }
  if (hasSkill(target, "luoyi")) {
    setPending(state, "drawChoice", target.id, "摸牌阶段：是否发动【裸衣】？", { skill: "luoyi", drawCount });
    return;
  }
  if (hasSkill(target, "yingzi")) {
    setPending(state, "drawChoice", target.id, "摸牌阶段：是否发动【英姿】？", { skill: "yingzi", drawCount });
    return;
  }
  consumeDuelFirstDraw(state);
  draw(state, target.id, drawCount, context);
  addLog(state, `${target.name} 摸 ${drawCount} 张牌。`, "normal", context, { kind: "draw", actorId: target.id, targetIds: [target.id], count: drawCount, zone: "deck" });
  pushNextPhase(state, "draw");
}

function phaseDrawCount(state: GameStateV2) {
  return state.mode === "duel"
    && state.duelFirstDrawPending
    && state.turn?.playerId === state.duelFirstPlayerId
    ? 1
    : 2;
}

function consumeDuelFirstDraw(state: GameStateV2) {
  if (state.mode === "duel" && state.duelFirstDrawPending && state.turn?.playerId === state.duelFirstPlayerId) {
    state.duelFirstDrawPending = false;
  }
}

function processDiscardPhase(state: GameStateV2) {
  const target = player(state, state.turn!.playerId);
  const excess = Math.max(0, target.hand.length - Math.max(0, target.hp));
  if (excess > 0
    && hasSkill(target, "keji")
    && !state.turn!.stats.shaUsedOrPlayed
    && !state.turn!.usedSkills.includes("keji:phase")) {
    setPending(state, "optionalSkill", target.id, "是否发动【克己】跳过弃牌阶段？", { skill: "keji", resume: "discard" });
    return;
  }
  if (excess > 0) {
    setPending(state, "discardPhase", target.id, `请弃置 ${excess} 张手牌`, { count: excess });
    return;
  }
  pushNextPhase(state, "discard");
}

function processFinishPhase(state: GameStateV2) {
  const target = player(state, state.turn!.playerId);
  if (hasSkill(target, "biyue") && !state.turn!.usedSkills.includes("biyue")) {
    setPending(state, "optionalSkill", target.id, "是否发动【闭月】摸一张牌？", { skill: "biyue", resume: "finish" });
    return;
  }
  pushNextPhase(state, "finish");
}

function advance(state: GameStateV2, context?: EngineContextV2) {
  for (let guard = 0; guard < 800 && !state.pending && state.status !== "finished"; guard += 1) {
    const trigger = state.triggers.shift();
    if (trigger) {
      const owner = state.players.find((entry) => entry.id === trigger.actorId);
      if (owner?.alive) {
        const name = trigger.skill === "lianying" ? "连营" : "枭姬";
        const drawCount = trigger.skill === "lianying" ? 1 : 2;
        setPending(state, "lossTrigger", owner.id, `是否发动【${name}】摸${drawCount === 1 ? "一" : "两"}张牌？`, {
          skill: trigger.skill,
          drawCount,
        });
        continue;
      }
    }
    const frame = state.stack.pop();
    if (!frame) {
      if (state.mode === "duel" && state.duelTurnTerminated && state.turn) {
        state.duelTurnTerminated = false;
        const current = player(state, state.turn.playerId);
        const opponent = alivePlayers(state).find((entry) => entry.id !== current.id);
        if (opponent) {
          if (opponent.seat <= current.seat) state.round += 1;
          addLog(state, `${current.name} 的回合因武将阵亡结束。`, "system", context);
          beginTurn(state, opponent.id, context);
          continue;
        }
      }
      break;
    }
    if (frame.kind === "enterPhase") enterPhase(state, dataAs<{ phase: TurnPhase }>(frame.data).phase, context);
    else if (frame.kind === "preparePhase") processPreparePhase(state);
    else if (frame.kind === "judgePhase") processJudgePhase(state);
    else if (frame.kind === "drawPhase") processDrawPhase(state, context);
    else if (frame.kind === "discardPhase") processDiscardPhase(state);
    else if (frame.kind === "finishPhase") processFinishPhase(state);
    else if (frame.kind === "endTurn") endTurn(state, context);
    else if (frame.kind === "resolveDelayed") resolveDelayedFrame(state, frame, context);
    else if (frame.kind === "resolveUse") resolveUseFrame(state, frame, context);
    else if (frame.kind === "resolveTarget") resolveTargetFrame(state, frame);
    else if (frame.kind === "applyCardEffect") applyCardEffectFrame(state, frame, context);
    else if (frame.kind === "damage") resolveDamageFrame(state, frame, context);
    else if (frame.kind === "dying") resolveDyingFrame(state, frame, context);
    else if (frame.kind === "death") resolveDeathFrame(state, frame, context);
    else if (frame.kind === "afterDamage") resolveAfterDamageFrame(state, frame, context);
    else if (frame.kind === "postShaDamage") resolvePostShaDamageFrame(state, frame, context);
    else if (frame.kind === "continueResponse") continueResponseFrame(state, frame, context);
    else if (frame.kind === "continueNullification") continueNullificationFrame(state, frame, context);
    else if (frame.kind === "continueHanbing") continueHanbingFrame(state, frame, context);
    else if (frame.kind === "finishUse") finishUseFrame(state, frame, context);
    else throw new Error(`未知规则帧：${frame.kind}`);
  }
  if (!state.pending && state.stack.length > 0 && state.status !== "finished") throw new Error("规则引擎自动推进超过安全上限");
}

function isBlackShaBlocked(state: GameStateV2, use: CardUse, target: GamePlayerV2) {
  return use.name === "杀"
    && use.color === "black"
    && target.equipment.armor?.name === "仁王盾"
    && !use.ignoreArmor;
}

function cannotTarget(state: GameStateV2, source: GamePlayerV2, target: GamePlayerV2, name: StandardCardName) {
  if (!target.alive || source.id === target.id && !["无中生有", "桃", "闪电"].includes(name)) return true;
  if (hasSkill(target, "kongcheng") && target.hand.length === 0 && (name === "杀" || name === "决斗")) return true;
  if (hasSkill(target, "qianxun") && (name === "顺手牵羊" || name === "乐不思蜀")) return true;
  if ((name === "乐不思蜀" || name === "闪电") && target.judgment.some((card) => (card.asName ?? card.name) === name)) return true;
  return false;
}

function zoneHasCards(target: GamePlayerV2, includeJudgment = true) {
  return target.hand.length > 0 || equipmentCards(target).length > 0 || (includeJudgment && target.judgment.length > 0);
}

function validSingleTargets(state: GameStateV2, source: GamePlayerV2, name: StandardCardName) {
  const others = alivePlayers(state).filter((target) => !cannotTarget(state, source, target, name));
  if (name === "杀") return others.filter((target) => distanceV2(state, source.id, target.id) <= attackRangeV2(source));
  if (name === "顺手牵羊") {
    return others.filter((target) => zoneHasCards(target) && (hasSkill(source, "qicai") || distanceV2(state, source.id, target.id) <= 1));
  }
  if (name === "过河拆桥") return others.filter((target) => zoneHasCards(target));
  if (name === "决斗" || name === "乐不思蜀") return others;
  if (name === "借刀杀人") return others.filter((target) => Boolean(target.equipment.weapon)
    && validSingleTargets(state, target, "杀").some((victim) => victim.id !== source.id));
  return [];
}

function transformedOptions(target: GamePlayerV2, card: Card, inOwnTurn: boolean) {
  const options: Array<{ name: StandardCardName; skill?: string }> = [];
  if (card.name !== "酒" && card.name in CARD_METADATA) options.push({ name: card.name as StandardCardName });
  if (card.color === "red" && hasSkill(target, "wusheng")) options.push({ name: "杀", skill: "wusheng" });
  if (card.name === "闪" && hasSkill(target, "longdan")) options.push({ name: "杀", skill: "longdan" });
  if (card.color === "black" && hasSkill(target, "qixi")) options.push({ name: "过河拆桥", skill: "qixi" });
  if (card.suit === "diamond" && hasSkill(target, "guose")) options.push({ name: "乐不思蜀", skill: "guose" });
  if (!inOwnTurn && card.color === "red" && hasSkill(target, "jijiu")) options.push({ name: "桃", skill: "jijiu" });
  return options.filter((entry, index, entries) => entries.findIndex((candidate) => candidate.name === entry.name && candidate.skill === entry.skill) === index);
}

function validSingleTargetsAfterCost(state: GameStateV2, source: GamePlayerV2, name: StandardCardName, costId: string) {
  const candidates = alivePlayers(state).filter((target) => !cannotTarget(state, source, target, name));
  if (name === "杀") return candidates.filter((target) => distanceAfterCost(state, source, target, costId) <= attackRangeAfterCost(source, costId));
  if (name === "顺手牵羊") return candidates.filter((target) => zoneHasCards(target)
    && (hasSkill(source, "qicai") || distanceAfterCost(state, source, target, costId) <= 1));
  return validSingleTargets(state, source, name);
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

function cardPlayActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions: LegalActionV2[] = [];
  for (const card of allOwnedCards(actor)) {
    const inHand = actor.hand.some((entry) => entry.id === card.id);
    for (const option of transformedOptions(actor, card, true).filter((entry) => inHand || Boolean(entry.skill))) {
      const name = option.name;
      if (name === "闪" || name === "无懈可击") continue;
      if (name === "桃" && actor.hp >= actor.maxHp) continue;
      if (name === "杀") {
        const unlimited = hasSkill(actor, "paoxiao") || actor.equipment.weapon?.name === "诸葛连弩";
        if (state.turn!.shaUsed >= 1 && !unlimited) continue;
      }
      if (name === "闪电" && actor.judgment.some((entry) => entry.name === "闪电")) continue;
      const targets = validSingleTargetsAfterCost(state, actor, name, card.id);
      if (["杀", "顺手牵羊", "过河拆桥", "决斗", "乐不思蜀", "借刀杀人"].includes(name)) {
        for (const target of targets) {
          actions.push(exact(
            `play:${card.id}:${option.skill ?? name}:${target.id}`,
            `对 ${target.name} 使用【${name}】`,
            { type: "playCard", cardId: card.id, targetId: target.id, as: name, skill: option.skill },
          ));
        }
        if (name === "杀" && actor.equipment.weapon?.name === "方天画戟" && inHand && actor.hand.length === 1) {
          for (const size of [2, 3]) for (const group of combinations(targets, size)) {
            actions.push(exact(
              `play:${card.id}:fangtian:${group.map((target) => target.id).join(":")}`,
              `【方天画戟】对 ${group.map((target) => target.name).join("、")} 使用【杀】`,
              { type: "playCard", cardId: card.id, targetIds: group.map((target) => target.id), as: "杀", skill: "fangtian" },
            ));
          }
        }
      } else if (name === "桃" || name === "无中生有" || name === "闪电"
        || name === "南蛮入侵" || name === "万箭齐发" || name === "桃园结义" || name === "五谷丰登"
        || CARD_METADATA[name].category === "equip") {
        actions.push(exact(
          `play:${card.id}:${option.skill ?? name}`,
          `使用【${name}】`,
          { type: "playCard", cardId: card.id, as: name, skill: option.skill },
        ));
      }
    }
  }
  if (actor.equipment.weapon?.name === "丈八蛇矛" && actor.hand.length >= 2) {
    const targets = validSingleTargets(state, actor, "杀").map((target) => target.id);
    if (targets.length > 0) {
      actions.push({
        id: "skill:zhangba",
        kind: "skill",
        skill: "zhangba",
        label: "丈八蛇矛 · 两张手牌当【杀】",
        candidateCardIds: actor.hand.map((card) => card.id),
        minCards: 2,
        maxCards: 2,
        targetIds: targets,
        minTargets: 1,
        maxTargets: 1,
      });
    }
  }
  return actions;
}

function activeSkillActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions: LegalActionV2[] = [];
  const used = state.turn!.usedSkills;
  if (hasSkill(actor, "rende") && actor.hand.length > 0) {
    actions.push({ id: "skill:rende", kind: "skill", skill: "rende", label: "仁德", description: SKILLS.rende.text,
      candidateCardIds: actor.hand.map((card) => card.id), minCards: 1, maxCards: actor.hand.length,
      targetIds: alivePlayers(state).filter((entry) => entry.id !== actor.id).map((entry) => entry.id), minTargets: 1, maxTargets: 1 });
  }
  if (hasSkill(actor, "zhiheng") && !used.includes("zhiheng") && allOwnedCards(actor).length > 0) {
    actions.push({ id: "skill:zhiheng", kind: "skill", skill: "zhiheng", label: "制衡", description: SKILLS.zhiheng.text,
      candidateCardIds: allOwnedCards(actor).map((card) => card.id), minCards: 1, maxCards: allOwnedCards(actor).length });
  }
  if (hasSkill(actor, "kurou")) actions.push(exact("skill:kurou", "苦肉 · 失去1点体力并摸两张", { type: "skill", skill: "kurou" }));
  if (hasSkill(actor, "fanjian") && !used.includes("fanjian") && actor.hand.length > 0) {
    actions.push({ id: "skill:fanjian", kind: "skill", skill: "fanjian", label: "反间", description: SKILLS.fanjian.text,
      candidateCardIds: [], minCards: 0, maxCards: 0,
      targetIds: alivePlayers(state).filter((entry) => entry.id !== actor.id).map((entry) => entry.id), minTargets: 1, maxTargets: 1 });
  }
  if (hasSkill(actor, "jieyin") && !used.includes("jieyin") && actor.hand.length >= 2) {
    const targets = alivePlayers(state).filter((entry) => entry.id !== actor.id && entry.character?.gender === "male" && entry.hp < entry.maxHp);
    if (targets.length) actions.push({ id: "skill:jieyin", kind: "skill", skill: "jieyin", label: "结姻", description: SKILLS.jieyin.text,
      candidateCardIds: actor.hand.map((card) => card.id), minCards: 2, maxCards: 2,
      targetIds: targets.map((entry) => entry.id), minTargets: 1, maxTargets: 1 });
  }
  if (hasSkill(actor, "qingnang") && !used.includes("qingnang") && actor.hand.length > 0) {
    const targets = alivePlayers(state).filter((entry) => entry.hp < entry.maxHp);
    if (targets.length) actions.push({ id: "skill:qingnang", kind: "skill", skill: "qingnang", label: "青囊", description: SKILLS.qingnang.text,
      candidateCardIds: actor.hand.map((card) => card.id), minCards: 1, maxCards: 1,
      targetIds: targets.map((entry) => entry.id), minTargets: 1, maxTargets: 1 });
  }
  if (hasSkill(actor, "lijian") && !used.includes("lijian") && allOwnedCards(actor).length > 0) {
    const males = alivePlayers(state).filter((entry) => entry.id !== actor.id && entry.character?.gender === "male");
    for (const card of allOwnedCards(actor)) for (const duelSource of males) for (const duelTarget of males) {
      if (duelSource.id === duelTarget.id || cannotTarget(state, duelSource, duelTarget, "决斗")) continue;
      actions.push(exact(
        `skill:lijian:${card.id}:${duelSource.id}:${duelTarget.id}`,
        `弃置【${card.name}】，令 ${duelSource.name} 对 ${duelTarget.name} 决斗`,
        { type: "skill", skill: "lijian", cardId: card.id, cardIds: [card.id], targetIds: [duelSource.id, duelTarget.id] },
        SKILLS.lijian.text,
      ));
    }
  }
  if (state.mode !== "duel" && actor.role === "lord" && hasSkill(actor, "jijiang") && !used.includes("jijiangFailed")) {
    const unlimited = hasSkill(actor, "paoxiao") || actor.equipment.weapon?.name === "诸葛连弩";
    const providers = alivePlayers(state).filter((entry) => entry.id !== actor.id && entry.character?.kingdom === "shu");
    if ((state.turn!.shaUsed < 1 || unlimited) && providers.length > 0) {
      for (const target of validSingleTargets(state, actor, "杀")) {
        actions.push(exact(`jijiang:${target.id}`, `发动【激将】对 ${target.name} 使用【杀】`, {
          type: "lordSkill", skill: "jijiang", targetId: target.id,
        }));
      }
    }
  }
  return actions;
}

export function getLegalActionsV2(state: GameStateV2, actorId: string): LegalActionV2[] {
  if (state.status === "finished") return [];
  const actor = state.players.find((entry) => entry.id === actorId);
  if (!actor?.alive) return [];
  if (state.pending) {
    if (state.pending.actorId !== actorId) return [];
    return pendingActions(state, actor);
  }
  if (state.status !== "playing" || !state.turn || state.turn.playerId !== actorId || state.turn.phase !== "play") return [];
  return [
    ...cardPlayActions(state, actor),
    ...activeSkillActions(state, actor),
    exact("phase:end-play", "结束出牌阶段", { type: "endTurn" }),
  ];
}

function pendingActions(state: GameStateV2, actor: GamePlayerV2): LegalActionV2[] {
  const pending = state.pending!;
  if (pending.kind === "duelColor") return duelColorActions();
  if (pending.kind === "duelDraft") return duelDraftActions(state, actor);
  if (pending.kind === "duelLineup") return duelLineupActions(state, actor);
  if (pending.kind === "chooseCharacter") {
    const { choices } = dataAs<{ choices: string[] }>(pending.data);
    return choices.map((id) => {
      const choice = characterById(id);
      return exact(`character:${id}`, `${choice.name} · ${choice.skillName}`, { type: "chooseCharacter", characterId: id });
    });
  }
  if (pending.kind === "discardPhase") {
    const { count } = dataAs<{ count: number }>(pending.data);
    return [{ id: "discard:phase", kind: "discard", label: `弃置 ${count} 张手牌`, candidateCardIds: actor.hand.map((card) => card.id), minCards: count, maxCards: count }];
  }
  if (pending.kind === "optionalSkill") {
    const { skill } = dataAs<{ skill: SkillId | "bagua" }>(pending.data);
    const name = skill === "bagua" ? "八卦阵" : SKILLS[skill].name;
    return [
      exact(`skill:${skill}:yes`, `发动【${name}】`, { type: "choose", choice: "yes" }),
      exact(`skill:${skill}:no`, "不发动", { type: "pass" }),
    ];
  }
  if (pending.kind === "lossTrigger") {
    const data = dataAs<{ skill: "lianying" | "xiaoji"; drawCount: number }>(pending.data);
    const name = data.skill === "lianying" ? "连营" : "枭姬";
    return [
      exact(`loss:${data.skill}:yes`, `发动【${name}】`, { type: "choose", choice: "yes" }),
      exact(`loss:${data.skill}:no`, "不发动", { type: "pass" }),
    ];
  }
  if (pending.kind === "drawChoice") {
    const data = dataAs<{ skill: SkillId; targetIds?: string[]; drawCount?: number }>(pending.data);
    if (data.skill === "tuxi") return [
      { id: "skill:tuxi", kind: "skill", skill: "tuxi", label: "发动突袭", targetIds: data.targetIds, minTargets: 1, maxTargets: Math.min(data.drawCount ?? 2, data.targetIds?.length ?? 0), candidateCardIds: [], minCards: 0, maxCards: 0 },
      exact("draw:normal", `正常摸${(data.drawCount ?? 2) === 1 ? "一" : "两"}张`, { type: "pass" }),
    ];
    return [
      exact(`skill:${data.skill}:yes`, `发动【${SKILLS[data.skill].name}】`, { type: "choose", choice: "yes" }),
      exact("draw:normal", "不发动，正常摸牌", { type: "pass" }),
    ];
  }
  if (pending.kind === "response") return responseActions(state, actor);
  if (pending.kind === "rescue") return rescueActions(state, actor);
  if (pending.kind === "chooseZoneCard") return zoneChoiceActions(state, actor);
  if (pending.kind === "nullification") return nullificationActions(state, actor);
  if (pending.kind === "chooseSuit") return ["spade", "heart", "club", "diamond"].map((suit) => exact(`suit:${suit}`, `声明${suitLabel(suit)}`, { type: "choose", suit }));
  if (pending.kind === "chooseBorrowTarget") {
    const { targetIds } = dataAs<{ targetIds: string[] }>(pending.data);
    return targetIds.map((id) => exact(`borrow:${id}`, `令其对 ${player(state, id).name} 使用【杀】`, { type: "choose", targetId: id }));
  }
  if (pending.kind === "harvest") {
    const ids = dataAs<{ cardIds: string[] }>(pending.data).cardIds;
    return ids.map((id) => {
      const card = findCardEverywhere(state, id)!;
      return exact(`harvest:${id}`, `获得【${card.name}】${suitSymbol(card.suit)}${card.rank}`, { type: "choose", cardId: id });
    });
  }
  if (pending.kind === "guanxing") {
    const data = dataAs<{ remainingIds: string[]; topIds: string[]; bottomIds: string[] }>(pending.data);
    const actions: LegalActionV2[] = [];
    for (const id of data.remainingIds) {
      const card = findCardEverywhere(state, id)!;
      const label = `【${card.name}】${suitSymbol(card.suit)}${card.rank}`;
      actions.push(exact(`guanxing:top:${id}`, `${label}置于牌堆顶`, { type: "choose", cardId: id, choice: "top" }));
      actions.push(exact(`guanxing:bottom:${id}`, `${label}置于牌堆底`, { type: "choose", cardId: id, choice: "bottom" }));
    }
    return actions;
  }
  if (pending.kind === "judgment") {
    const actions = actor.hand.map((card) => exact(
      `guicai:${card.id}`,
      `以【${card.name}】${suitSymbol(card.suit)}${card.rank}改判`,
      { type: "respond", cardId: card.id, skill: "guicai" },
    ));
    actions.push(exact("guicai:pass", "不发动【鬼才】", { type: "pass" }));
    return actions;
  }
  if (pending.kind === "tiandu") return [
    exact("tiandu:yes", "发动【天妒】获得判定牌", { type: "choose", choice: "yes" }),
    exact("tiandu:no", "不发动【天妒】", { type: "pass" }),
  ];
  if (pending.kind === "luoshenContinue") return [
    exact("luoshen:continue", "继续发动【洛神】", { type: "choose", choice: "continue" }),
    exact("luoshen:stop", "停止【洛神】", { type: "pass" }),
  ];
  if (pending.kind === "borrowSha") return borrowShaActions(state, actor);
  if (pending.kind === "damageTrigger") return damageTriggerActions(state, actor);
  if (pending.kind === "fankui") return fankuiActions(state, actor);
  if (pending.kind === "ganglieChoice") return ganglieChoiceActions(state, actor);
  if (pending.kind === "yijiAssign") return yijiAssignActions(state, actor);
  if (pending.kind === "liuli") return liuliActions(state, actor);
  if (pending.kind === "tieqi") return yesNoActions("铁骑", "tieqi");
  if (pending.kind === "cixiong") return yesNoActions("雌雄双股剑", "cixiong");
  if (pending.kind === "cixiongChoice") return cixiongChoiceActions(state, actor);
  if (pending.kind === "hanbing") return yesNoActions("寒冰剑", "hanbing");
  if (pending.kind === "hanbingChoice") return hanbingChoiceActions(state, actor);
  if (pending.kind === "qinglong") return qinglongActions(state, actor);
  if (pending.kind === "guanshi") return guanshiActions(state, actor);
  if (pending.kind === "qilin") return qilinActions(state, actor);
  if (pending.kind === "lordRequest") return lordRequestActions(state, actor);
  return [];
}

function yesNoActions(label: string, id: string): LegalActionV2[] {
  return [
    exact(`${id}:yes`, `发动【${label}】`, { type: "choose", choice: "yes" }),
    exact(`${id}:no`, "不发动", { type: "pass" }),
  ];
}

function suitLabel(value: string) {
  return { spade: "黑桃", heart: "红桃", club: "梅花", diamond: "方块" }[value] ?? value;
}

function suitSymbol(value: string) {
  return { spade: "♠", heart: "♥", club: "♣", diamond: "♦" }[value] ?? "";
}

function publicCardLabel(card: Card) {
  return `${suitSymbol(card.suit)}${card.rank}【${card.name}】`;
}

function publicCardList(cards: Card[]) {
  return cards.map(publicCardLabel).join("、");
}

function sameAction(left: GameActionV2, right: GameActionV2) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateSubmission(state: GameStateV2, actorId: string, action: GameActionV2) {
  const legal = getLegalActionsV2(state, actorId);
  const exactMatch = legal.some((entry) => entry.kind === "exact" && entry.action && sameAction(entry.action, action));
  if (exactMatch) return;
  const template = legal.find((entry) => entry.kind !== "exact" && entry.skill === action.skill)
    ?? legal.find((entry) => entry.kind === "discard" && action.type === "discard");
  if (!template) throw new Error("该动作不在当前服务器合法动作中");
  const cards = [...new Set(action.cardIds ?? [])];
  const targets = [...new Set(action.targetIds ?? (action.targetId ? [action.targetId] : []))];
  if (cards.length !== (action.cardIds ?? []).length || targets.length !== (action.targetIds ?? (action.targetId ? [action.targetId] : [])).length) {
    throw new Error("不能重复选择牌或目标");
  }
  if (cards.length < (template.minCards ?? 0) || cards.length > (template.maxCards ?? Number.POSITIVE_INFINITY)) throw new Error("所选牌数量不合法");
  if (targets.length < (template.minTargets ?? 0) || targets.length > (template.maxTargets ?? Number.POSITIVE_INFINITY)) throw new Error("所选目标数量不合法");
  if (cards.some((id) => !template.candidateCardIds?.includes(id))) throw new Error("所选牌不在候选范围内");
  if (targets.some((id) => !template.targetIds?.includes(id))) throw new Error("所选目标不在候选范围内");
}

export function applyGameActionV2(
  state: GameStateV2,
  actorId: string,
  action: GameActionV2,
  context?: EngineContextV2,
) {
  if (state.status === "finished") throw new Error("对局已经结束");
  const next = structuredClone(state);
  const actor = player(next, actorId);
  if (!actor.alive) throw new Error("已阵亡角色不能行动");
  if (next.pending?.id && action.decisionId && action.decisionId !== next.pending.id) throw new Error("决策已经变化，请重新观察");
  validateSubmission(next, actorId, action);
  if (next.pending) resolvePendingAction(next, actor, action, context);
  else resolvePlayAction(next, actor, action, context);
  advance(next, context);
  stampDeadline(next, context);
  assertGameInvariantV2(next);
  return next;
}

function resolvePendingAction(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const pending = state.pending!;
  if (pending.kind === "duelColor") return handleDuelColor(state, actor, action, context);
  if (pending.kind === "duelDraft") return handleDuelDraft(state, actor, action, context);
  if (pending.kind === "duelLineup") return handleDuelLineup(state, actor, action, context);
  if (pending.kind === "chooseCharacter") return handleChooseCharacter(state, action, context);
  if (pending.kind === "discardPhase") {
    const discarded = removeOwnedCardsTracked(state, actor, action.cardIds ?? []).map((entry) => entry.card);
    state.discard.push(...discarded);
    state.pending = null;
    addLog(state, `${actor.name} 弃置 ${discarded.length} 张手牌：${publicCardList(discarded)}。`, "normal", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, cardNames: discarded.map((card) => card.name), count: discarded.length, zone: "discard" });
    pushNextPhase(state, "discard");
    return;
  }
  if (pending.kind === "optionalSkill") return resolveOptionalSkill(state, actor, action, context);
  if (pending.kind === "lossTrigger") return resolveLossTrigger(state, actor, action, context);
  if (pending.kind === "drawChoice") return resolveDrawChoice(state, actor, action, context);
  if (pending.kind === "response") return resolveResponseDecision(state, actor, action, context);
  if (pending.kind === "rescue") return resolveRescueDecision(state, actor, action, context);
  if (pending.kind === "chooseZoneCard") return resolveZoneChoice(state, actor, action, context);
  if (pending.kind === "nullification") return resolveNullificationDecision(state, actor, action, context);
  if (pending.kind === "chooseSuit") return resolveSuitChoice(state, actor, action, context);
  if (pending.kind === "chooseBorrowTarget") return resolveBorrowTarget(state, actor, action, context);
  if (pending.kind === "harvest") return resolveHarvestChoice(state, actor, action, context);
  if (pending.kind === "guanxing") return resolveGuanxingChoice(state, actor, action, context);
  if (pending.kind === "judgment") return resolveJudgmentDecision(state, actor, action, context);
  if (pending.kind === "tiandu") return resolveTianduDecision(state, actor, action, context);
  if (pending.kind === "luoshenContinue") return resolveLuoshenContinue(state, actor, action, context);
  if (pending.kind === "borrowSha") return resolveBorrowSha(state, actor, action, context);
  if (pending.kind === "damageTrigger") return resolveDamageTrigger(state, actor, action, context);
  if (pending.kind === "fankui") return resolveFankui(state, actor, action, context);
  if (pending.kind === "ganglieChoice") return resolveGanglieChoice(state, actor, action, context);
  if (pending.kind === "yijiAssign") return resolveYijiAssign(state, actor, action, context);
  if (pending.kind === "liuli") return resolveLiuli(state, actor, action, context);
  if (pending.kind === "tieqi") return resolveTieqi(state, actor, action, context);
  if (pending.kind === "cixiong") return resolveCixiong(state, actor, action, context);
  if (pending.kind === "cixiongChoice") return resolveCixiongChoice(state, actor, action, context);
  if (pending.kind === "hanbing") return resolveHanbing(state, actor, action, context);
  if (pending.kind === "hanbingChoice") return resolveHanbingChoice(state, actor, action, context);
  if (pending.kind === "qinglong") return resolveQinglong(state, actor, action, context);
  if (pending.kind === "guanshi") return resolveGuanshi(state, actor, action, context);
  if (pending.kind === "qilin") return resolveQilin(state, actor, action, context);
  if (pending.kind === "lordRequest") return resolveLordRequest(state, actor, action, context);
  throw new Error(`当前决策尚未实现：${pending.kind}`);
}

function resolveLossTrigger(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ skill: "lianying" | "xiaoji"; drawCount: number }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") return;
  draw(state, actor.id, data.drawCount, context);
  addLog(state, `${actor.name} 发动【${data.skill === "lianying" ? "连营" : "枭姬"}】，摸${data.drawCount === 1 ? "一" : "两"}张牌。`, "good", context);
}

function resolvePlayAction(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  if (!state.turn || state.turn.playerId !== actor.id || state.turn.phase !== "play") throw new Error("现在不是你的出牌阶段");
  if (action.type === "endTurn") {
    pushNextPhase(state, "play");
    return;
  }
  if (action.type === "lordSkill" && action.skill === "jijiang") {
    beginLordRequest(state, actor, "jijiang", "play", undefined, action.targetId, context);
    return;
  }
  if (action.type === "skill") return resolveActiveSkill(state, actor, action, context);
  if (action.type !== "playCard" || !action.cardId || !action.as) throw new Error("动作格式不正确");
  startCardUse(state, actor, action, context);
}

function resolveOptionalSkill(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ skill: SkillId | "bagua"; resume: string; use?: CardUse; targetId?: string }>(state.pending!.data);
  state.pending = null;
  if (data.skill === "jizhi") {
    if (action.type !== "pass") {
      draw(state, actor.id, 1, context);
      addLog(state, `${actor.name} 发动【集智】，摸一张牌。`, "good", context);
    }
    return;
  }
  if (data.skill === "bagua") {
    if (action.type === "pass") {
      const source = player(state, data.use!.sourceId);
      const required = hasSkill(source, "wushuang") ? 2 : 1;
      setPending(state, "response", actor.id, `请打出${required > 1 ? "两张" : ""}【闪】`, {
        required: "闪", remaining: required, use: data.use, targetId: actor.id, kind: "sha", baguaTried: true,
      });
    } else beginJudgment(state, actor.id, "八卦阵", { resume: "bagua", use: data.use, targetId: actor.id }, context);
    return;
  }
  if (action.type === "pass") {
    state.turn!.usedSkills.push(`${data.skill}:phase`);
    pushFrame(state, `${data.resume}Phase`);
    return;
  }
  if (data.skill === "biyue") {
    state.turn!.usedSkills.push("biyue");
    draw(state, actor.id, 1, context);
    addLog(state, `${actor.name} 发动【闭月】，摸一张牌。`, "good", context);
    pushFrame(state, "finishPhase");
  } else if (data.skill === "keji") {
    state.turn!.usedSkills.push("keji");
    addLog(state, `${actor.name} 发动【克己】，跳过弃牌阶段。`, "good", context);
    pushNextPhase(state, "discard");
  } else if (data.skill === "guanxing") {
    state.turn!.usedSkills.push("guanxing:phase");
    beginGuanxing(state, actor, context);
  } else if (data.skill === "luoshen") {
    state.turn!.usedSkills.push("luoshen:phase");
    pushFrame(state, "preparePhase");
    pushFrame(state, "resolveDelayed", { playerId: actor.id, cardId: "", name: "luoshen" });
  }
}

function resolveDrawChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { skill, drawCount } = dataAs<{ skill: SkillId; drawCount?: number }>(state.pending!.data);
  const normalDraw = drawCount ?? phaseDrawCount(state);
  state.pending = null;
  consumeDuelFirstDraw(state);
  if (action.type === "pass") {
    draw(state, actor.id, normalDraw, context);
    addLog(state, `${actor.name} 摸 ${normalDraw} 张牌。`, "normal", context);
  } else if (skill === "tuxi") {
    for (const id of action.targetIds ?? []) {
      const target = player(state, id);
      if (target.hand.length) {
        const cardId = target.hand[randomInt(state, target.hand.length)].id;
        actor.hand.push(removeOwnedCardsTracked(state, target, [cardId])[0].card);
      }
    }
    addLog(state, `${actor.name} 发动【突袭】，获得 ${action.targetIds?.length ?? 0} 张手牌。`, "good", context, { kind: "transfer", actorId: actor.id, sourceId: action.targetIds?.[0], targetIds: [actor.id], count: action.targetIds?.length ?? 0, zone: "hand" });
  } else if (skill === "luoyi") {
    const count = Math.max(0, normalDraw - 1);
    draw(state, actor.id, count, context);
    state.turn!.stats.luoyi = true;
    addLog(state, `${actor.name} 发动【裸衣】，摸 ${count} 张牌。`, "good", context);
  } else if (skill === "yingzi") {
    const count = normalDraw + 1;
    draw(state, actor.id, count, context);
    addLog(state, `${actor.name} 发动【英姿】，摸 ${count} 张牌。`, "good", context);
  }
  pushNextPhase(state, "draw");
}

function beginGuanxing(state: GameStateV2, actor: GamePlayerV2, context?: EngineContextV2) {
  const count = Math.min(5, alivePlayers(state).length);
  const cards: Card[] = [];
  for (let index = 0; index < count; index += 1) {
    recycleDeck(state, context);
    const card = state.deck.pop();
    if (card) cards.push(card);
  }
  state.revealed.push(...cards);
  setPending(state, "guanxing", actor.id, "观星：依次选择牌与放置位置", {
    remainingIds: cards.map((card) => card.id),
    topIds: [],
    bottomIds: [],
  });
}

function resolveActiveSkill(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const skill = action.skill ?? "";
  if (skill === "zhangba") {
    startVirtualSha(state, actor, action.cardIds ?? [], action.targetIds?.[0] ?? action.targetId ?? "", "zhangba", context);
    return;
  }
  if (skill === "rende") {
    const target = player(state, action.targetIds?.[0] ?? action.targetId!);
    target.hand.push(...removeOwnedCardsTracked(state, actor, action.cardIds ?? []).map((entry) => entry.card));
    const before = Number(state.turn!.stats.rendeCount ?? 0);
    const after = before + (action.cardIds?.length ?? 0);
    state.turn!.stats.rendeCount = after;
    if (before < 2 && after >= 2) {
      state.turn!.stats.rendeHealed = true;
      actor.hp = Math.min(actor.maxHp, actor.hp + 1);
    }
    addLog(state, `${actor.name} 发动【仁德】，交给 ${target.name} ${action.cardIds?.length ?? 0} 张牌。`, "good", context, { kind: "transfer", actorId: actor.id, sourceId: actor.id, targetIds: [target.id], count: action.cardIds?.length ?? 0, zone: "hand" });
    return;
  }
  if (skill === "zhiheng") {
    const discarded = removeOwnedCardsTracked(state, actor, action.cardIds ?? []).map((entry) => entry.card);
    state.discard.push(...discarded);
    state.turn!.usedSkills.push("zhiheng");
    draw(state, actor.id, action.cardIds?.length ?? 0, context);
    addLog(state, `${actor.name} 发动【制衡】，弃置 ${publicCardList(discarded)}，摸 ${discarded.length} 张牌。`, "good", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, cardNames: discarded.map((card) => card.name), count: discarded.length, zone: "discard" });
    return;
  }
  if (skill === "kurou") {
    state.turn!.stats.kurouDrawAfterRescue = true;
    loseHp(state, actor.id, 1, actor.id, "苦肉", context);
    if (actor.alive && actor.hp > 0) {
      draw(state, actor.id, 2, context);
      delete state.turn!.stats.kurouDrawAfterRescue;
    }
    addLog(state, `${actor.name} 发动【苦肉】。`, "danger", context);
    return;
  }
  if (skill === "fanjian") {
    state.turn!.usedSkills.push("fanjian");
    const committedCardId = actor.hand[randomInt(state, actor.hand.length)].id;
    setPending(state, "chooseSuit", action.targetIds?.[0] ?? action.targetId!, "反间：请选择一种花色", { sourceId: actor.id, committedCardId });
    return;
  }
  if (skill === "jieyin") {
    const discarded = removeOwnedCardsTracked(state, actor, action.cardIds ?? []).map((entry) => entry.card);
    state.discard.push(...discarded);
    const target = player(state, action.targetIds?.[0] ?? action.targetId!);
    actor.hp = Math.min(actor.maxHp, actor.hp + 1);
    target.hp = Math.min(target.maxHp, target.hp + 1);
    state.turn!.usedSkills.push("jieyin");
    addLog(state, `${actor.name} 弃置 ${publicCardList(discarded)} 发动【结姻】，与 ${target.name} 各回复1点体力。`, "good", context, { kind: "heal", actorId: actor.id, targetIds: [actor.id, target.id], cardNames: discarded.map((card) => card.name), amount: 1 });
    return;
  }
  if (skill === "qingnang") {
    const discarded = removeOwnedCardsTracked(state, actor, [action.cardIds![0]])[0].card;
    state.discard.push(discarded);
    const target = player(state, action.targetIds?.[0] ?? action.targetId!);
    target.hp = Math.min(target.maxHp, target.hp + 1);
    state.turn!.usedSkills.push("qingnang");
    addLog(state, `${actor.name} 弃置 ${publicCardLabel(discarded)} 发动【青囊】，令 ${target.name} 回复1点体力。`, "good", context, { kind: "heal", actorId: actor.id, targetIds: [target.id], cardName: discarded.name, amount: 1 });
    return;
  }
  if (skill === "lijian") {
    const discarded = removeOwnedCardsTracked(state, actor, [action.cardIds![0]])[0].card;
    state.discard.push(discarded);
    state.turn!.usedSkills.push("lijian");
    const [sourceId, targetId] = action.targetIds ?? [];
    const use: CardUse = { id: `u${state.frameSeq + 1}`, sourceId, name: "决斗", cardIds: [], color: "none", targets: [targetId], targetIndex: 0, noNullification: true, sourceSkill: "lijian" };
    pushFrame(state, "resolveUse", { use });
    addLog(state, `${actor.name} 弃置 ${publicCardLabel(discarded)} 发动【离间】，令 ${player(state, sourceId).name} 对 ${player(state, targetId).name} 发起【决斗】。`, "danger", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, targetIds: [sourceId, targetId], cardName: discarded.name, count: 1, zone: "discard" });
    return;
  }
  throw new Error("该主动技能尚未实现");
}

function startVirtualSha(state: GameStateV2, actor: GamePlayerV2, ids: string[], targetId: string, skill: string, context?: EngineContextV2) {
  const cards = removeOwnedCardsTracked(state, actor, ids).map((entry) => entry.card);
  state.processing.push(...cards);
  const colors = new Set(cards.map((card) => card.color));
  const color = colors.size === 1 ? cards[0].color : "none";
  const use: CardUse = { id: `u${state.frameSeq + 1}`, sourceId: actor.id, name: "杀", cardIds: ids, color, targets: [targetId], targetIndex: 0, sourceSkill: skill };
  state.turn!.shaUsed += 1;
  state.turn!.stats.shaUsedOrPlayed = true;
  pushFrame(state, "resolveUse", { use });
  addLog(state, `${actor.name} 发动【丈八蛇矛】，对 ${player(state, targetId).name} 使用【杀】。`, "normal", context);
}

function startCardUse(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const removed = removeOwnedCardsTracked(state, actor, [action.cardId!])[0];
  const physical = removed.card;
  const name = action.as as StandardCardName;
  state.processing.push(physical);
  const targets = action.targetId ? [action.targetId] : action.targetIds ?? [];
  if (name === "闪电") targets.push(actor.id);
  if (["南蛮入侵", "万箭齐发"].includes(name)) targets.push(...actionOrder(state, actor.id, false).map((entry) => entry.id));
  if (name === "桃园结义" || name === "五谷丰登") targets.push(...actionOrder(state, actor.id, true).map((entry) => entry.id));
  if (name === "无中生有" || name === "桃") targets.push(actor.id);
  const use: CardUse = {
    id: `u${state.frameSeq + 1}`,
    sourceId: actor.id,
    name,
    cardIds: [physical.id],
    color: physical.color,
    targets,
    targetIndex: 0,
    ignoreArmor: actor.equipment.weapon?.name === "青釭剑" && name === "杀",
    sourceSkill: action.skill,
  };
  if (name === "杀") {
    state.turn!.shaUsed += 1;
    state.turn!.stats.shaUsedOrPlayed = true;
  }
  const sourceSkillName = action.skill ? SKILLS[action.skill as SkillId]?.name : undefined;
  addLog(state, `${actor.name}${sourceSkillName ? ` 发动【${sourceSkillName}】，` : " "}使用【${name}】${targets.length === 1 && targets[0] !== actor.id ? `，目标是 ${player(state, targets[0]).name}` : ""}。`, "normal", context, {
    kind: ["南蛮入侵", "万箭齐发", "桃园结义", "五谷丰登"].includes(name) ? "aoe" : "use",
    actorId: actor.id,
    sourceId: actor.id,
    targetIds: targets,
    cardName: name,
    count: 1,
  });
  const virtualCategory = CARD_METADATA[name].category;
  if (virtualCategory === "equip") equipCard(state, actor, physical, context);
  else if (virtualCategory === "delayed") {
    removeCard(state.processing, physical.id);
    physical.asName = name;
    player(state, targets[0]).judgment.push(physical);
  } else {
    pushFrame(state, "resolveUse", { use });
    if (virtualCategory === "trick" && hasSkill(actor, "jizhi")) {
      setPending(state, "optionalSkill", actor.id, "是否发动【集智】摸一张牌？", { skill: "jizhi", resume: "resolveUse" });
    }
  }
}

function equipCard(state: GameStateV2, actor: GamePlayerV2, card: Card, context?: EngineContextV2) {
  removeCard(state.processing, card.id);
  const slot = card.slot!;
  const previous = actor.equipment[slot];
  if (previous) {
    state.discard.push(previous);
    queueEquipmentLossTrigger(state, actor);
  }
  actor.equipment[slot] = card;
  addLog(state, `${actor.name} 装备了【${card.name}】。`, "good", context, { kind: "equip", actorId: actor.id, targetIds: [actor.id], cardName: card.name, count: 1, zone: "equip" });
}

// The following frame handlers are completed below in this file. They are kept as
// named reducers so every paused state remains JSON-serializable.
function resolveDelayedFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const data = dataAs<{ playerId: string; cardId: string; name: string }>(frame.data);
  if (data.name === "luoshen") {
    beginJudgment(state, data.playerId, "luoshen", { resume: "luoshen" }, context);
    return;
  }
  setPending(state, "nullification", data.playerId, `【${data.name}】即将生效，等待【无懈可击】`, {
    use: { id: frame.id, sourceId: data.playerId, name: data.name as StandardCardName, cardIds: [data.cardId], color: "none", targets: [data.playerId], targetIndex: 0 } satisfies CardUse,
    targetId: data.playerId,
    order: actionOrder(state, data.playerId, true).map((entry) => entry.id), cursor: 0, passes: 0, parity: 0,
    continuation: "delayed",
  });
}

function resolveUseFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { use } = dataAs<{ use: CardUse }>(frame.data);
  if (use.name === "五谷丰登" && use.targetIndex === 0 && state.revealed.length === 0) {
    for (let index = 0; index < alivePlayers(state).length; index += 1) {
      recycleDeck(state, context);
      const card = state.deck.pop();
      if (card) state.revealed.push(card);
    }
  }
  if (use.targetIndex >= use.targets.length) {
    pushFrame(state, "finishUse", { use });
    return;
  }
  pushFrame(state, "resolveTarget", { use });
}

function resolveTargetFrame(state: GameStateV2, frame: EffectFrameV2) {
  const { use } = dataAs<{ use: CardUse }>(frame.data);
  const targetId = use.targets[use.targetIndex];
  const nextUse = { ...use, targetIndex: use.targetIndex + 1 };
  pushFrame(state, "resolveUse", { use: nextUse });
  if (CARD_METADATA[use.name].category === "trick" && !use.noNullification) {
    const order = actionOrder(state, use.sourceId, true).map((entry) => entry.id);
    setPending(state, "nullification", order[0], `【${use.name}】对 ${player(state, targetId).name} 即将生效`, {
      use, targetId, order, cursor: 0, passes: 0, parity: 0, continuation: "effect",
    });
  } else pushFrame(state, "applyCardEffect", { use, targetId });
}

function applyCardEffectFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { use, targetId } = dataAs<{ use: CardUse; targetId: string }>(frame.data);
  applyCardEffect(state, use, targetId, context);
}

function finishUseFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { use } = dataAs<{ use: CardUse }>(frame.data);
  if (use.name === "五谷丰登" && state.revealed.length > 0) {
    state.discard.push(...state.revealed);
    state.revealed = [];
  }
  for (const id of use.cardIds) {
    const card = removeCard(state.processing, id);
    if (card) state.discard.push(card);
  }
  void context;
}

function resolveDamageFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const damage = dataAs<DamageSpec>(frame.data);
  dealDamage(state, damage, context);
}

function resolveAfterDamageFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const data = dataAs<{ damage: DamageSpec; skills?: SkillId[]; index?: number }>(frame.data);
  const target = player(state, data.damage.targetId);
  if (data.damage.targetEpoch !== undefined && data.damage.targetEpoch !== target.generalEpoch) return;
  if (!target.alive) return;
  const skills = data.skills ?? [
    ...(hasSkill(target, "jianxiong") ? (["jianxiong"] as SkillId[]) : []),
    ...(hasSkill(target, "fankui") ? (["fankui"] as SkillId[]) : []),
    ...(hasSkill(target, "ganglie") ? (["ganglie"] as SkillId[]) : []),
    ...Array.from({ length: data.damage.amount }, () => "yiji" as SkillId).filter(() => hasSkill(target, "yiji")),
  ];
  const index = data.index ?? 0;
  if (index >= skills.length) return;
  const skill = skills[index];
  pushFrame(state, "afterDamage", { damage: data.damage, skills, index: index + 1 });
  const source = data.damage.sourceId ? state.players.find((entry) => entry.id === data.damage.sourceId && entry.alive) : null;
  const canTrigger = skill === "jianxiong"
    ? data.damage.cardIds.some((id) => state.processing.some((card) => card.id === id))
    : skill === "fankui"
      ? Boolean(source && allOwnedCards(source).length > 0)
      : skill === "ganglie"
        ? Boolean(source)
        : true;
  if (!canTrigger) return;
  setPending(state, "damageTrigger", target.id, `是否发动【${SKILLS[skill].name}】？`, {
    skill,
    damage: data.damage,
  });
  void context;
}

function damageTriggerActions(state: GameStateV2, actor: GamePlayerV2) {
  const { skill } = dataAs<{ skill: SkillId }>(state.pending!.data);
  void actor;
  return [
    exact(`damage:${skill}:yes`, `发动【${SKILLS[skill].name}】`, { type: "choose", choice: "yes" }),
    exact(`damage:${skill}:no`, "不发动", { type: "pass" }),
  ];
}

function resolveDamageTrigger(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { skill, damage } = dataAs<{ skill: SkillId; damage: DamageSpec }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") return;
  if (skill === "jianxiong") {
    const gained: Card[] = [];
    for (const id of damage.cardIds) {
      const card = removeCard(state.processing, id);
      if (card) gained.push(card);
    }
    actor.hand.push(...gained);
    addLog(state, `${actor.name} 发动【奸雄】，获得造成伤害的牌。`, "good", context);
    return;
  }
  if (skill === "fankui") {
    setPending(state, "fankui", actor.id, "反馈：请获得伤害来源的一张牌", { sourceId: damage.sourceId });
    return;
  }
  if (skill === "ganglie") {
    beginJudgment(state, actor.id, "刚烈", { resume: "ganglie", sourceId: damage.sourceId, ownerId: actor.id }, context);
    return;
  }
  if (skill === "yiji") {
    const cards: Card[] = [];
    for (let index = 0; index < 2; index += 1) {
      recycleDeck(state, context);
      const card = state.deck.pop();
      if (card) cards.push(card);
    }
    state.revealed.push(...cards);
    if (cards.length) setPending(state, "yijiAssign", actor.id, "遗计：请分配两张牌", { cardIds: cards.map((card) => card.id) });
    addLog(state, `${actor.name} 发动【遗计】。`, "good", context);
  }
}

function fankuiActions(state: GameStateV2, actor: GamePlayerV2) {
  const { sourceId } = dataAs<{ sourceId: string }>(state.pending!.data);
  const source = player(state, sourceId);
  const actions: LegalActionV2[] = [];
  if (source.hand.length) actions.push(exact("fankui:hand", "获得一张随机手牌", { type: "choose", zone: "hand" }));
  for (const card of equipmentCards(source)) {
    actions.push(exact(`fankui:${card.id}`, `获得装备【${card.name}】`, { type: "choose", zone: "equip", cardId: card.id }));
  }
  void actor;
  return actions;
}

function resolveFankui(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { sourceId } = dataAs<{ sourceId: string }>(state.pending!.data);
  state.pending = null;
  const source = player(state, sourceId);
  const id = action.zone === "hand" ? source.hand[randomInt(state, source.hand.length)].id : action.cardId!;
  const card = removeOwnedCardsTracked(state, source, [id])[0].card;
  actor.hand.push(card);
  addLog(state, `${actor.name} 发动【反馈】，获得 ${source.name} 的${action.zone === "hand" ? "一张手牌" : publicCardLabel(card)}。`, "good", context, {
    kind: "transfer", actorId: actor.id, sourceId: source.id, targetIds: [actor.id], ...(action.zone === "hand" ? {} : { cardName: card.name }), count: 1, zone: action.zone === "hand" ? "hand" : "equip",
  });
}

function ganglieChoiceActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions: LegalActionV2[] = [];
  if (actor.hand.length >= 2) actions.push({
    id: "ganglie:discard",
    kind: "skill",
    skill: "ganglie_discard",
    label: "弃置两张手牌",
    candidateCardIds: actor.hand.map((card) => card.id),
    minCards: 2,
    maxCards: 2,
  });
  actions.push(exact("ganglie:damage", "受到夏侯惇造成的1点伤害", { type: "choose", choice: "damage" }));
  void state;
  return actions;
}

function resolveGanglieChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { ownerId } = dataAs<{ ownerId: string }>(state.pending!.data);
  state.pending = null;
  if (action.skill === "ganglie_discard") {
    const discarded = removeOwnedCardsTracked(state, actor, action.cardIds ?? []).map((entry) => entry.card);
    state.discard.push(...discarded);
    addLog(state, `${actor.name} 因【刚烈】弃置 ${publicCardList(discarded)}。`, "normal", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, cardNames: discarded.map((card) => card.name), count: discarded.length, zone: "discard" });
  } else {
    queueDamage(state, { sourceId: ownerId, targetId: actor.id, amount: 1, cardIds: [], reason: "【刚烈】" });
  }
}

function yijiAssignActions(state: GameStateV2, actor: GamePlayerV2) {
  const { cardIds } = dataAs<{ cardIds: string[] }>(state.pending!.data);
  const card = findCardEverywhere(state, cardIds[0])!;
  return alivePlayers(state).map((target) => exact(
    `yiji:${card.id}:${target.id}`,
    `将【${card.name}】${suitSymbol(card.suit)}${card.rank}交给 ${target.name}`,
    { type: "choose", cardId: card.id, targetId: target.id },
  ));
  void actor;
}

function resolveYijiAssign(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { cardIds } = dataAs<{ cardIds: string[] }>(state.pending!.data);
  const [currentId, ...remaining] = cardIds;
  state.pending = null;
  const card = removeCard(state.revealed, currentId);
  if (!card) throw new Error("遗计牌已离开分配区");
  const target = player(state, action.targetId!);
  target.hand.push(card);
  addLog(state, `${actor.name} 将一张【遗计】牌交给 ${target.name}。`, "good", context);
  if (remaining.length) setPending(state, "yijiAssign", actor.id, "遗计：请分配剩余的牌", { cardIds: remaining });
}

function resolveDyingFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { targetId, sourceId, order, cursor = 0, passes = 0 } = dataAs<{ targetId: string; sourceId?: string; order: string[]; cursor?: number; passes?: number }>(frame.data);
  const target = player(state, targetId);
  if (!target.alive || target.hp > 0) return;
  if (passes >= order.length) {
    pushFrame(state, "death", { targetId, sourceId });
    return;
  }
  const actorId = order[cursor % order.length];
  setPending(state, "rescue", actorId, `${target.name} 濒死，需要【桃】`, { targetId, sourceId, order, cursor, passes });
  void context;
}

function resolveDeathFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { targetId, sourceId } = dataAs<{ targetId: string; sourceId?: string }>(frame.data);
  eliminate(state, targetId, sourceId, context);
}

type LordRequestData = {
  skill: "hujia" | "jijiang";
  lordId: string;
  mode: "response" | "play";
  providers: string[];
  cursor: number;
  baguaTriedProviderId?: string;
  responseData?: Record<string, unknown>;
  targetId?: string;
};

function beginLordRequest(
  state: GameStateV2,
  lord: GamePlayerV2,
  skill: "hujia" | "jijiang",
  mode: "response" | "play",
  responseData?: Record<string, unknown>,
  targetId?: string,
  context?: EngineContextV2,
) {
  const kingdom = skill === "hujia" ? "wei" : "shu";
  const providers = actionOrder(state, lord.id, false)
    .filter((entry) => entry.character?.kingdom === kingdom)
    .map((entry) => entry.id);
  const data: LordRequestData = { skill, lordId: lord.id, mode, providers, cursor: 0, responseData, targetId };
  addLog(state, `${lord.name} 发动【${skill === "hujia" ? "护驾" : "激将"}】。`, "good", context);
  continueLordRequest(state, data);
}

function continueLordRequest(state: GameStateV2, data: LordRequestData) {
  while (data.cursor < data.providers.length && !player(state, data.providers[data.cursor]).alive) data.cursor += 1;
  if (data.cursor >= data.providers.length) {
    const lord = player(state, data.lordId);
    if (data.mode === "response") {
      const response = { ...(data.responseData ?? {}), lordSkillTried: true };
      setPending(state, "response", lord.id, `无人响应【${data.skill === "hujia" ? "护驾" : "激将"}】，请自行响应`, response);
    } else state.turn!.usedSkills.push("jijiangFailed");
    return;
  }
  const provider = player(state, data.providers[data.cursor]);
  setPending(state, "lordRequest", provider.id, `${player(state, data.lordId).name} 请求你提供【${data.skill === "hujia" ? "闪" : "杀"}】`, data as unknown as Record<string, unknown>);
}

function lordRequestActions(state: GameStateV2, actor: GamePlayerV2) {
  const data = dataAs<LordRequestData>(state.pending!.data);
  const required = data.skill === "hujia" ? "闪" : "杀";
  const candidates: Array<{ card: Card; skill?: string }> = [];
  if (required === "闪") {
    for (const card of actor.hand) {
      if (card.name === "闪") candidates.push({ card });
      if (card.name === "杀" && hasSkill(actor, "longdan")) candidates.push({ card, skill: "longdan" });
      if (card.color === "black" && hasSkill(actor, "qingguo")) candidates.push({ card, skill: "qingguo" });
    }
  } else {
    for (const card of allOwnedCards(actor)) {
      const inHand = actor.hand.some((entry) => entry.id === card.id);
      if (inHand && card.name === "杀") candidates.push({ card });
      if (card.color === "red" && hasSkill(actor, "wusheng")) candidates.push({ card, skill: "wusheng" });
      if (inHand && card.name === "闪" && hasSkill(actor, "longdan")) candidates.push({ card, skill: "longdan" });
    }
  }
  const actions = candidates.map(({ card, skill }) => exact(
    `lord-provide:${card.id}:${skill ?? required}`,
    `提供【${required}】${skill ? `（${SKILLS[skill as SkillId].name}）` : ""}`,
    { type: "provide", cardId: card.id, as: required, skill },
  ));
  if (required === "杀" && actor.equipment.weapon?.name === "丈八蛇矛" && actor.hand.length >= 2) actions.push({
    id: "lord-provide:zhangba", kind: "skill", skill: "lord_zhangba", label: "丈八蛇矛·两张手牌当【杀】",
    candidateCardIds: actor.hand.map((card) => card.id), minCards: 2, maxCards: 2,
  });
  if (required === "闪"
    && actor.equipment.armor?.name === "八卦阵"
    && data.baguaTriedProviderId !== actor.id) {
    actions.push(exact("lord-provide:bagua", "发动【八卦阵】尝试提供【闪】", { type: "provideSkill", skill: "bagua" }));
  }
  actions.push(exact("lord-provide:pass", "不提供", { type: "pass" }));
  return actions;
}

function resolveLordRequest(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<LordRequestData>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") {
    data.cursor += 1;
    continueLordRequest(state, data);
    return;
  }
  if (action.type === "provideSkill" && action.skill === "bagua") {
    data.baguaTriedProviderId = actor.id;
    beginJudgment(state, actor.id, "护驾·八卦阵", { resume: "hujiaBagua", lordRequest: data }, context);
    return;
  }
  const ids = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  const cards = removeOwnedCardsTracked(state, actor, ids).map((entry) => entry.card);
  const lord = player(state, data.lordId);
  const providedName = data.skill === "hujia" ? "闪" : "杀";
  const providerSkillName = action.skill && action.skill in SKILLS ? SKILLS[action.skill as SkillId].name : undefined;
  addLog(state, `${actor.name}${providerSkillName ? ` 发动【${providerSkillName}】，将 ${publicCardList(cards)} 当【${providedName}】` : ` 使用 ${publicCardList(cards)}`}为 ${lord.name} 响应【${data.skill === "hujia" ? "护驾" : "激将"}】。`, "good", context, { kind: "respond", actorId: actor.id, sourceId: actor.id, targetIds: [lord.id], cardName: providedName, cardNames: cards.map((card) => card.name), count: cards.length });
  if (data.mode === "play") {
    state.processing.push(...cards);
    const colors = new Set(cards.map((card) => card.color));
    const use: CardUse = {
      id: `u${state.frameSeq + 1}:jijiang`, sourceId: lord.id, name: "杀", cardIds: cards.map((card) => card.id),
      color: colors.size === 1 ? cards[0].color : "none", targets: [data.targetId!], targetIndex: 0,
      ignoreArmor: lord.equipment.weapon?.name === "青釭剑", sourceSkill: "jijiang",
    };
    state.turn!.shaUsed += 1;
    state.turn!.stats.shaUsedOrPlayed = true;
    pushFrame(state, "resolveUse", { use });
  } else {
    state.discard.push(...cards);
    completeResponse(state, lord.id, data.responseData as never, context);
  }
}

function responseActions(state: GameStateV2, actor: GamePlayerV2) {
  const { required, lordSkillTried, baguaTried } = dataAs<{ required: "杀" | "闪"; lordSkillTried?: boolean; baguaTried?: boolean }>(state.pending!.data);
  const actions: LegalActionV2[] = [];
  for (const card of allOwnedCards(actor)) {
    const inHand = actor.hand.some((entry) => entry.id === card.id);
    const options: Array<{ skill?: string }> = [];
    if (inHand && card.name === required) options.push({});
    if (required === "杀" && hasSkill(actor, "wusheng") && card.color === "red") options.push({ skill: "wusheng" });
    if (required === "杀" && inHand && hasSkill(actor, "longdan") && card.name === "闪") options.push({ skill: "longdan" });
    if (required === "闪" && inHand && hasSkill(actor, "longdan") && card.name === "杀") options.push({ skill: "longdan" });
    if (required === "闪" && inHand && hasSkill(actor, "qingguo") && card.color === "black") options.push({ skill: "qingguo" });
    for (const option of options) actions.push(exact(
      `respond:${card.id}:${option.skill ?? required}`,
      option.skill
        ? `发动【${SKILLS[option.skill as SkillId].name}】：将【${card.name}】${suitSymbol(card.suit)}${card.rank}当【${required}】打出`
        : `打出【${card.name}】${suitSymbol(card.suit)}${card.rank}`,
      { type: "respond", cardId: card.id, as: required, skill: option.skill },
    ));
  }
  if (required === "杀" && actor.equipment.weapon?.name === "丈八蛇矛" && actor.hand.length >= 2) {
    actions.push({ id: "respond:zhangba", kind: "skill", skill: "zhangba_response", label: "丈八蛇矛 · 两张手牌当【杀】",
      candidateCardIds: actor.hand.map((card) => card.id), minCards: 2, maxCards: 2 });
  }
  if (required === "闪" && !baguaTried && actor.equipment.armor?.name === "八卦阵") {
    actions.push(exact("respond:bagua", "发动【八卦阵】判定", { type: "responseSkill", skill: "bagua" }));
  }
  if (!lordSkillTried && state.mode !== "duel" && actor.role === "lord") {
    if (required === "闪" && hasSkill(actor, "hujia")
      && alivePlayers(state).some((entry) => entry.id !== actor.id && entry.character?.kingdom === "wei")) {
      actions.push(exact("lord:hujia", "发动【护驾】", { type: "lordSkill", skill: "hujia" }));
    }
    if (required === "杀" && hasSkill(actor, "jijiang")
      && alivePlayers(state).some((entry) => entry.id !== actor.id && entry.character?.kingdom === "shu")) {
      actions.push(exact("lord:jijiang", "发动【激将】", { type: "lordSkill", skill: "jijiang" }));
    }
  }
  actions.push(exact("respond:pass", `不打出【${required}】`, { type: "pass" }));
  return actions;
}

function rescueActions(state: GameStateV2, actor: GamePlayerV2) {
  const targetId = dataAs<{ targetId: string }>(state.pending!.data).targetId;
  const actions: LegalActionV2[] = [];
  for (const card of allOwnedCards(actor)) {
    const normalPeach = card.name === "桃";
    const emergency = card.color === "red" && hasSkill(actor, "jijiu") && actor.id !== state.turn?.playerId;
    if (normalPeach || emergency) actions.push(exact(`rescue:${card.id}`, `对 ${player(state, targetId).name} 使用【桃】`, { type: "respond", cardId: card.id, as: "桃", skill: emergency && card.name !== "桃" ? "jijiu" : undefined }));
  }
  actions.push(exact("rescue:pass", "不使用【桃】", { type: "pass" }));
  return actions;
}

function zoneChoiceActions(state: GameStateV2, actor: GamePlayerV2) {
  const data = dataAs<{ targetId: string; mode: "discard" | "obtain"; includeJudgment: boolean }>(state.pending!.data);
  const target = player(state, data.targetId);
  const actions: LegalActionV2[] = [];
  if (target.hand.length > 0) actions.push(exact("zone:hand", `${data.mode === "discard" ? "弃置" : "获得"}一张随机手牌`, { type: "choose", zone: "hand" }));
  for (const card of equipmentCards(target)) actions.push(exact(`zone:${card.id}`, `${data.mode === "discard" ? "弃置" : "获得"}【${card.name}】`, { type: "choose", cardId: card.id, zone: "equip" }));
  if (data.includeJudgment) for (const card of target.judgment) actions.push(exact(`zone:${card.id}`, `${data.mode === "discard" ? "弃置" : "获得"}判定区【${card.asName ?? card.name}】`, { type: "choose", cardId: card.id, zone: "judge" }));
  void actor;
  return actions;
}

function nullificationActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions = actor.hand.filter((card) => card.name === "无懈可击")
    .map((card) => exact(`nullify:${card.id}`, "使用【无懈可击】", { type: "respond", cardId: card.id, as: "无懈可击" }));
  actions.push(exact("nullify:pass", "不使用【无懈可击】", { type: "pass" }));
  void state;
  return actions;
}

function resolveResponseDecision(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ required: "杀" | "闪"; remaining: number; use: CardUse; targetId: string; kind: string; opponentId?: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "responseSkill" && action.skill === "bagua") {
    beginJudgment(state, actor.id, "八卦阵", { resume: "responseBagua", responseData: data }, context);
    return;
  }
  if (action.type === "lordSkill" && (action.skill === "hujia" || action.skill === "jijiang")) {
    beginLordRequest(state, actor, action.skill, "response", data as unknown as Record<string, unknown>, undefined, context);
    return;
  }
  if (action.type === "pass") {
    if (data.kind === "sha") queueShaDamage(state, data.use, data.targetId, context);
    else if (data.kind === "aoe") queueDamageFromUse(state, data.use, data.targetId);
    else if (data.kind === "duel") queueDamageFromUse(state, data.use, actor.id, data.opponentId);
    return;
  }
  const ids = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  const physicalCards = removeOwnedCardsTracked(state, actor, ids).map((entry) => entry.card);
  state.discard.push(...physicalCards);
  state.turn!.stats.shaUsedOrPlayed ||= data.required === "杀"
    && state.turn?.phase === "play"
    && state.turn.playerId === actor.id;
  const responseSkillName = action.skill ? SKILLS[action.skill as SkillId]?.name : undefined;
  addLog(state, `${actor.name}${responseSkillName ? ` 发动【${responseSkillName}】，将 ${publicCardList(physicalCards)} 当【${data.required}】打出。` : ` 打出 ${publicCardList(physicalCards)}。`}`, "good", context, { kind: "respond", actorId: actor.id, targetIds: [actor.id], cardName: data.required, cardNames: physicalCards.map((card) => card.name), count: physicalCards.length });
  completeResponse(state, actor.id, data, context);
}

function completeResponse(
  state: GameStateV2,
  responderId: string,
  data: { required: "杀" | "闪"; remaining: number; use: CardUse; targetId: string; kind: string; opponentId?: string },
  context?: EngineContextV2,
) {
  const responder = player(state, responderId);
  const remaining = data.remaining - 1;
  if (remaining > 0) {
    pushFrame(state, "continueResponse", { actorId: responder.id, prompt: `还需打出 ${remaining} 张【${data.required}】`, data: { ...data, remaining, lordSkillTried: false } });
    return;
  }
  if (data.kind === "duel") {
    const otherId = data.opponentId!;
    pushFrame(state, "continueResponse", {
      actorId: otherId,
      prompt: "【决斗】：请打出【杀】",
      data: {
        ...data,
        targetId: otherId,
        opponentId: responder.id,
        remaining: hasSkill(responder, "wushuang") ? 2 : 1,
        lordSkillTried: false,
      },
    });
  } else if (data.kind === "sha") {
    addLog(state, `${responder.name} 使用【闪】抵消了【杀】。`, "normal", context);
    afterShaDodged(state, data.use, data.targetId, context);
  }
}

function continueResponseFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { actorId, prompt, data } = dataAs<{ actorId: string; prompt: string; data: Record<string, unknown> }>(frame.data);
  if (!player(state, actorId).alive) return;
  setPending(state, "response", actorId, prompt, data);
  void context;
}

function resolveRescueDecision(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ targetId: string; sourceId?: string; order: string[]; cursor: number; passes: number }>(state.pending!.data);
  state.pending = null;
  const target = player(state, data.targetId);
  if (action.type === "pass") {
    pushFrame(state, "dying", { ...data, cursor: (data.cursor + 1) % data.order.length, passes: data.passes + 1 });
    return;
  }
  const removed = removeOwnedCardsTracked(state, actor, [action.cardId!])[0];
  state.discard.push(removed.card);
  let recover = 1;
  if (state.mode !== "duel" && target.role === "lord" && hasSkill(target, "jiuyuan") && actor.id !== target.id && actor.character?.kingdom === "wu") recover += 1;
  target.hp = Math.min(target.maxHp, target.hp + recover);
  const rescueSkillName = action.skill ? SKILLS[action.skill as SkillId]?.name : undefined;
  addLog(state, `${actor.name}${rescueSkillName ? ` 发动【${rescueSkillName}】，将 ${publicCardLabel(removed.card)} 当【桃】` : ` 使用 ${publicCardLabel(removed.card)}`}救援 ${target.name}，回复 ${recover} 点体力。`, "good", context, { kind: "heal", actorId: actor.id, sourceId: actor.id, targetIds: [target.id], cardName: "桃", cardNames: [removed.card.name], amount: recover });
  if (target.hp <= 0) pushFrame(state, "dying", { ...data, cursor: data.cursor, passes: 0 });
  else if (state.turn?.stats.kurouDrawAfterRescue && target.id === state.turn.playerId) {
    draw(state, target.id, 2, context);
    delete state.turn.stats.kurouDrawAfterRescue;
  }
}

function resolveZoneChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ targetId: string; mode: "discard" | "obtain"; continuation?: string }>(state.pending!.data);
  state.pending = null;
  const target = player(state, data.targetId);
  let card: Card | null = null;
  if (action.zone === "hand") {
    const cardId = target.hand[randomInt(state, target.hand.length)]?.id;
    if (cardId) card = removeOwnedCardsTracked(state, target, [cardId])[0].card;
  } else if (action.zone === "equip") card = removeOwnedCardsTracked(state, target, [action.cardId!])[0]?.card ?? null;
  else if (action.zone === "judge") card = removeCard(target.judgment, action.cardId!);
  if (!card) throw new Error("所选牌已经离开目标区域");
  restorePhysicalCard(card);
  if (data.mode === "discard") state.discard.push(card);
  else actor.hand.push(card);
  addLog(state, `${actor.name} ${data.mode === "discard" ? "弃置" : "获得"}了 ${target.name} 的${data.mode === "discard" ? `【${card.name}】` : "一张牌"}。`, data.mode === "discard" ? "danger" : "good", context, {
    kind: data.mode === "discard" ? "discard" : "transfer",
    actorId: actor.id,
    sourceId: target.id,
    targetIds: data.mode === "discard" ? [] : [actor.id],
    ...(data.mode === "discard" || action.zone !== "hand" ? { cardName: card.name } : {}),
    count: 1,
    zone: data.mode === "discard" ? "discard" : action.zone as "hand" | "equip" | "judge",
  });
}

function resolveNullificationDecision(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ use: CardUse; targetId: string; order: string[]; cursor: number; passes: number; parity: number; continuation: string }>(state.pending!.data);
  state.pending = null;
  let { cursor, passes, parity } = data;
  let mayTriggerJizhi = false;
  if (action.type === "respond") {
    const card = removeOwnedCardsTracked(state, actor, [action.cardId!])[0].card;
    state.discard.push(card);
    parity += 1;
    passes = 0;
    cursor = (cursor + 1) % data.order.length;
    addLog(state, `${actor.name} 使用【无懈可击】。`, "normal", context, { kind: "nullify", actorId: actor.id, targetIds: [data.targetId], cardName: "无懈可击", count: 1 });
    mayTriggerJizhi = hasSkill(actor, "jizhi");
  } else {
    passes += 1;
    cursor = (cursor + 1) % data.order.length;
  }
  if (passes >= data.order.length) {
    if (data.continuation === "effect") {
      if (parity % 2 === 0) pushFrame(state, "applyCardEffect", { use: data.use, targetId: data.targetId });
      else addLog(state, `【${data.use.name}】对 ${player(state, data.targetId).name} 的效果被抵消。`, "normal", context);
    } else finishDelayedAfterNullification(state, data.use, data.targetId, parity % 2 === 1, context);
    return;
  }
  const nextActor = data.order[cursor];
  pushFrame(state, "continueNullification", {
    actorId: nextActor,
    data: { ...data, cursor, passes, parity },
  });
  if (mayTriggerJizhi) setPending(state, "optionalSkill", actor.id, "是否发动【集智】摸一张牌？", { skill: "jizhi", resume: "nullification" });
}

function continueNullificationFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { actorId, data } = dataAs<{ actorId: string; data: Record<string, unknown> }>(frame.data);
  if (!player(state, actorId).alive) return;
  setPending(state, "nullification", actorId, "等待【无懈可击】", data);
  void context;
}

function resolveSuitChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { sourceId, committedCardId } = dataAs<{ sourceId: string; committedCardId: string }>(state.pending!.data);
  state.pending = null;
  const source = player(state, sourceId);
  const card = removeOwnedCardsTracked(state, source, [committedCardId])[0].card;
  actor.hand.push(card);
  addLog(state, `${actor.name} 从 ${source.name} 处获得一张${suitLabel(card.suit)}牌。`, "normal", context, { kind: "transfer", actorId: actor.id, sourceId: source.id, targetIds: [actor.id], count: 1, zone: "hand" });
  if (card.suit !== action.suit) queueDamage(state, { sourceId, targetId: actor.id, amount: 1, cardIds: [], reason: "反间" });
}

function resolveBorrowTarget(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ use: CardUse; weaponHolderId: string }>(state.pending!.data);
  state.pending = null;
  data.use.data = { ...(data.use.data ?? {}), borrowTargetId: action.targetId };
  resolveBorrowedSword(state, data.use, player(state, data.weaponHolderId), context);
  void actor;
}

function resolveHarvestChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ cardIds: string[]; use: CardUse; targetId: string }>(state.pending!.data);
  state.pending = null;
  const card = removeCard(state.revealed, action.cardId!)!;
  actor.hand.push(card);
  addLog(state, `${actor.name} 从【五谷丰登】中获得【${card.name}】。`, "good", context);
  void data;
  void context;
}

function resolveGuanxingChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ remainingIds: string[]; topIds: string[]; bottomIds: string[] }>(state.pending!.data);
  const id = action.cardId!;
  if (!data.remainingIds.includes(id)) throw new Error("该牌已完成观星放置");
  data.remainingIds = data.remainingIds.filter((entry) => entry !== id);
  if (action.choice === "top") data.topIds.push(id);
  else data.bottomIds.push(id);
  state.pending = null;
  if (data.remainingIds.length > 0) {
    setPending(state, "guanxing", actor.id, "观星：依次选择牌与放置位置", data as unknown as Record<string, unknown>);
    return;
  }
  const takeRevealed = (cardId: string) => removeCard(state.revealed, cardId)!;
  const bottom = data.bottomIds.map(takeRevealed);
  const top = data.topIds.map(takeRevealed);
  state.deck.unshift(...bottom);
  state.deck.push(...top.reverse());
  addLog(state, `${actor.name} 完成【观星】。`, "good", context);
  pushFrame(state, "preparePhase");
}

function resolveJudgmentDecision(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{
    targetId: string;
    reason: string;
    cardId: string;
    continuation: Record<string, unknown>;
    guicaiOrder: string[];
    cursor: number;
  }>(state.pending!.data);
  state.pending = null;
  if (action.type === "respond") {
    const old = removeCard(state.processing, data.cardId);
    if (old) state.discard.push(old);
    const replacement = removeOwnedCardsTracked(state, actor, [action.cardId!])[0].card;
    state.processing.push(replacement);
    data.cardId = replacement.id;
    addLog(state, `${actor.name} 发动【鬼才】，将判定牌替换为 ${suitSymbol(replacement.suit)}${replacement.rank}【${replacement.name}】。`, "normal", context, {
      kind: "judge", actorId: actor.id, targetIds: [data.targetId], cardName: replacement.name, count: 1,
    });
  }
  data.cursor += 1;
  if (data.cursor < data.guicaiOrder.length) {
    const current = findCardEverywhere(state, data.cardId)!;
    setPending(state, "judgment", data.guicaiOrder[data.cursor], `当前判定牌为 ${suitSymbol(current.suit)}${current.rank}【${current.name}】，是否发动【鬼才】？`, data as unknown as Record<string, unknown>);
  } else completeJudgment(state, data, context);
}

function completeJudgment(
  state: GameStateV2,
  data: { targetId: string; reason: string; cardId: string; continuation: Record<string, unknown>; guicaiOrder: string[]; cursor: number },
  context?: EngineContextV2,
) {
  const card = findCardEverywhere(state, data.cardId)!;
  addLog(state, `${player(state, data.targetId).name} 的【${data.reason}】最终判定结果为 ${suitSymbol(card.suit)}${card.rank}【${card.name}】。`, "normal", context, {
    kind: "judge", actorId: data.targetId, targetIds: [data.targetId], cardName: card.name, count: 1,
  });
  const target = player(state, data.targetId);
  if (hasSkill(target, "tiandu")) {
    setPending(state, "tiandu", target.id, "是否发动【天妒】获得判定牌？", { judgment: data });
  } else applyJudgmentOutcome(state, data, context);
}

function resolveTianduDecision(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { judgment } = dataAs<{ judgment: { targetId: string; reason: string; cardId: string; continuation: Record<string, unknown>; guicaiOrder: string[]; cursor: number } }>(state.pending!.data);
  state.pending = null;
  if (action.type !== "pass") {
    const card = removeCard(state.processing, judgment.cardId);
    if (card) actor.hand.push(card);
    addLog(state, `${actor.name} 发动【天妒】，获得判定牌。`, "good", context);
  }
  applyJudgmentOutcome(state, judgment, context);
}

function applyJudgmentOutcome(
  state: GameStateV2,
  judgment: { targetId: string; reason: string; cardId: string; continuation: Record<string, unknown> },
  context?: EngineContextV2,
) {
  const card = findCardEverywhere(state, judgment.cardId);
  const continuation = dataAs<{ resume: string; cardIds?: string[]; use?: CardUse; targetId?: string }>(judgment.continuation);
  if (!card) {
    // 天妒已获得实体牌；结算仍使用已记录的花色点数快照。
    const obtained = player(state, judgment.targetId).hand.find((entry) => entry.id === judgment.cardId);
    if (!obtained) throw new Error("判定牌丢失");
    applyJudgmentWithCard(state, judgment, continuation, obtained, context);
  } else applyJudgmentWithCard(state, judgment, continuation, card, context);
}

function applyJudgmentWithCard(
  state: GameStateV2,
  judgment: { targetId: string; reason: string; cardId: string },
  continuation: {
    resume: string;
    cardIds?: string[];
    use?: CardUse;
    targetId?: string;
    sourceId?: string;
    ownerId?: string;
    lordRequest?: LordRequestData;
    responseData?: { required: "杀" | "闪"; remaining: number; use: CardUse; targetId: string; kind: string; opponentId?: string };
  },
  card: Card,
  context?: EngineContextV2,
) {
  const discardJudge = () => {
    const judged = removeCard(state.processing, judgment.cardId);
    if (judged) state.discard.push(judged);
  };
  if (continuation.resume === "luoshen") {
    if (card.color === "black") {
      const judged = removeCard(state.processing, card.id);
      if (judged) player(state, judgment.targetId).hand.push(judged);
      setPending(state, "luoshenContinue", judgment.targetId, "洛神判定为黑色，是否继续？", {});
    } else {
      discardJudge();
      pushFrame(state, "preparePhase");
    }
    return;
  }
  if (continuation.resume === "indulgence") {
    if (card.suit !== "heart") state.turn!.skipped.push("play");
    discardJudge();
    discardProcessing(state, continuation.cardIds ?? []);
    pushFrame(state, "judgePhase");
    return;
  }
  if (continuation.resume === "lightning") {
    const rank = RANK_ORDER.indexOf(card.rank) + 1;
    const hit = card.suit === "spade" && rank >= 2 && rank <= 9;
    discardJudge();
    if (hit) {
      discardProcessing(state, continuation.cardIds ?? []);
      pushFrame(state, "judgePhase");
      queueDamage(state, { targetId: judgment.targetId, amount: 3, cardIds: continuation.cardIds ?? [], cardName: "闪电", reason: "【闪电】" });
    } else passLightning(state, continuation.cardIds?.[0] ?? "", judgment.targetId);
    return;
  }
  if (continuation.resume === "ganglie") {
    discardJudge();
    const source = continuation.sourceId
      ? state.players.find((entry) => entry.id === continuation.sourceId && entry.alive)
      : null;
    if (card.suit !== "heart" && source) {
      setPending(state, "ganglieChoice", source.id, "【刚烈】：弃置两张手牌，否则受到1点伤害", {
        ownerId: continuation.ownerId,
      });
    }
    return;
  }
  if (continuation.resume === "tieqi") {
    discardJudge();
    const use = continuation.use!;
    const targetId = continuation.targetId!;
    if (card.color === "red") {
      shaFlags(use, targetId).noDodge = true;
      addLog(state, `${player(state, use.sourceId).name} 的【铁骑】判定为红色，${player(state, targetId).name} 不能使用【闪】。`, "good", context);
    }
    pushFrame(state, "applyCardEffect", { use, targetId });
    return;
  }
  if (continuation.resume === "hujiaBagua") {
    discardJudge();
    const request = continuation.lordRequest!;
    const provider = player(state, judgment.targetId);
    if (card.color === "red") {
      addLog(state, `${provider.name} 的【八卦阵】判定成功，主公获得【闪】响应。`, "good", context);
      completeResponse(state, request.lordId, request.responseData as never, context);
    } else {
      // A failed Bagua judgment does not count as declining Hujia. The same
      // provider may still supply a Shan from hand (but cannot retry Bagua).
      continueLordRequest(state, request);
    }
    return;
  }
  if (continuation.resume === "responseBagua") {
    discardJudge();
    const response = continuation.responseData!;
    if (card.color === "red") {
      addLog(state, `${player(state, judgment.targetId).name} 的【八卦阵】判定成功。`, "good", context);
      completeResponse(state, judgment.targetId, response, context);
    } else {
      setPending(state, "response", judgment.targetId, "【八卦阵】判定失败，请使用手牌响应", { ...response, baguaTried: true });
    }
    return;
  }
  if (continuation.resume === "bagua") {
    discardJudge();
    const use = continuation.use!;
    const source = player(state, use.sourceId);
    const required = hasSkill(source, "wushuang") ? 2 : 1;
    if (card.color === "red" && required === 1) {
      addLog(state, `${player(state, judgment.targetId).name} 的【八卦阵】判定成功。`, "good", context);
      afterShaDodged(state, use, judgment.targetId, context);
    } else {
      const remaining = card.color === "red" ? required - 1 : required;
      setPending(state, "response", judgment.targetId, `请打出${remaining > 1 ? "两张" : ""}【闪】`, {
        required: "闪", remaining, use, targetId: judgment.targetId, kind: "sha", baguaTried: card.color !== "red",
      });
    }
  }
}

function resolveLuoshenContinue(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  state.pending = null;
  if (action.type === "pass") pushFrame(state, "preparePhase");
  else beginJudgment(state, actor.id, "洛神", { resume: "luoshen" }, context);
}

function borrowShaActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions: LegalActionV2[] = [];
  for (const card of allOwnedCards(actor)) {
    const options = transformedOptions(actor, card, false).filter((entry) => entry.name === "杀");
    const inHand = actor.hand.some((entry) => entry.id === card.id);
    const selected = options.find((entry) => entry.skill) ?? (inHand && card.name === "杀" ? { name: "杀" as const } : null);
    if (selected) actions.push(exact(`borrow-sha:${card.id}:${selected.skill ?? "sha"}`, "按要求使用【杀】", { type: "respond", cardId: card.id, as: "杀", skill: selected.skill }));
  }
  if (actor.equipment.weapon?.name === "丈八蛇矛" && actor.hand.length >= 2) actions.push({
    id: "borrow-sha:zhangba", kind: "skill", skill: "zhangba_response", label: "丈八蛇矛 · 两张手牌当【杀】",
    candidateCardIds: actor.hand.map((card) => card.id), minCards: 2, maxCards: 2,
  });
  actions.push(exact("borrow-sha:pass", "不使用【杀】并交出武器", { type: "pass" }));
  void state;
  return actions;
}

function resolveBorrowSha(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { sourceId, targetId } = dataAs<{ sourceId: string; targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") {
    const weapon = actor.equipment.weapon;
    if (weapon) {
      actor.equipment.weapon = null;
      player(state, sourceId).hand.push(weapon);
      queueEquipmentLossTrigger(state, actor);
      addLog(state, `${actor.name} 未使用【杀】，${player(state, sourceId).name} 获得其武器。`, "normal", context);
    }
    return;
  }
  const ids = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  const cards = removeOwnedCardsTracked(state, actor, ids).map((entry) => entry.card);
  state.processing.push(...cards);
  const colors = new Set(cards.map((entry) => entry.color));
  const use: CardUse = {
    id: `u${state.frameSeq + 1}:borrow`, sourceId: actor.id, name: "杀", cardIds: ids,
    color: colors.size === 1 ? cards[0].color : "none", targets: [targetId], targetIndex: 0,
    ignoreArmor: actor.equipment.weapon?.name === "青釭剑", sourceSkill: action.skill,
  };
  const borrowedSkillName = action.skill && action.skill in SKILLS ? SKILLS[action.skill as SkillId].name : undefined;
  addLog(state, `${actor.name}${borrowedSkillName ? ` 发动【${borrowedSkillName}】，将 ${publicCardList(cards)} 当【杀】` : ` 使用 ${publicCardList(cards)}`}响应【借刀杀人】，目标是 ${player(state, targetId).name}。`, "normal", context, { kind: "use", actorId: actor.id, sourceId: actor.id, targetIds: [targetId], cardName: "杀", cardNames: cards.map((card) => card.name), count: cards.length });
  pushFrame(state, "resolveUse", { use });
}

function applyCardEffect(state: GameStateV2, use: CardUse, targetId: string, context?: EngineContextV2) {
  const source = player(state, use.sourceId);
  const target = player(state, targetId);
  if (use.name === "桃") {
    target.hp = Math.min(target.maxHp, target.hp + 1);
    return;
  }
  if (use.name === "无中生有") {
    draw(state, target.id, 2, context);
    return;
  }
  if (use.name === "过河拆桥" || use.name === "顺手牵羊") {
    if (!zoneHasCards(target)) {
      addLog(state, `${use.name === "过河拆桥" ? "【过河拆桥】" : "【顺手牵羊】"}结算时 ${target.name} 已没有可选择的牌，效果结束。`, "normal", context);
      return;
    }
    setPending(state, "chooseZoneCard", source.id, `${use.name}：请选择 ${target.name} 的一张牌`, { targetId, mode: use.name === "过河拆桥" ? "discard" : "obtain", includeJudgment: true });
    return;
  }
  if (use.name === "杀") return resolveShaEffect(state, use, target, context);
  if (use.name === "决斗") {
    setPending(state, "response", target.id, `【决斗】：请打出【杀】`, { required: "杀", remaining: hasSkill(source, "wushuang") ? 2 : 1, use, targetId: target.id, opponentId: source.id, kind: "duel" });
    return;
  }
  if (use.name === "南蛮入侵" || use.name === "万箭齐发") {
    const required = use.name === "南蛮入侵" ? "杀" : "闪";
    setPending(state, "response", target.id, `请打出【${required}】响应【${use.name}】`, { required, remaining: 1, use, targetId, kind: "aoe" });
    return;
  }
  if (use.name === "桃园结义") {
    if (target.hp < target.maxHp) target.hp += 1;
    return;
  }
  if (use.name === "五谷丰登") {
    if (state.revealed.length > 0) setPending(state, "harvest", target.id, "五谷丰登：请选择一张牌", { cardIds: state.revealed.map((card) => card.id), use, targetId });
    return;
  }
  if (use.name === "借刀杀人") return resolveBorrowedSword(state, use, target, context);
}

type ShaFlags = {
  liuli?: boolean;
  tieqi?: boolean;
  cixiong?: boolean;
  noDodge?: boolean;
  hanbing?: boolean;
};

function shaFlags(use: CardUse, targetId: string) {
  use.data ??= {};
  const key = `sha:${targetId}`;
  const existing = use.data[key] as ShaFlags | undefined;
  if (existing) return existing;
  const created: ShaFlags = {};
  use.data[key] = created;
  return created;
}

function distanceAfterCost(state: GameStateV2, from: GamePlayerV2, to: GamePlayerV2, costId: string) {
  let result = seatDistance(state, from.id, to.id);
  if (from.equipment.offensiveHorse && from.equipment.offensiveHorse.id !== costId) result -= 1;
  if (to.equipment.defensiveHorse) result += 1;
  if (hasSkill(from, "mashu")) result -= 1;
  return Math.max(1, result);
}

function attackRangeAfterCost(from: GamePlayerV2, costId: string) {
  return from.equipment.weapon?.id === costId ? 1 : attackRangeV2(from);
}

function liuliPairs(state: GameStateV2, use: CardUse, target: GamePlayerV2) {
  const source = player(state, use.sourceId);
  const pairs: Array<{ card: Card; target: GamePlayerV2 }> = [];
  for (const card of allOwnedCards(target)) {
    for (const candidate of alivePlayers(state)) {
      if (candidate.id === target.id || candidate.id === source.id || use.targets.includes(candidate.id)) continue;
      if (cannotTarget(state, source, candidate, "杀")) continue;
      if (distanceAfterCost(state, target, candidate, card.id) > attackRangeAfterCost(target, card.id)) continue;
      pairs.push({ card, target: candidate });
    }
  }
  return pairs;
}

function resolveShaEffect(state: GameStateV2, use: CardUse, target: GamePlayerV2, context?: EngineContextV2) {
  if (!target.alive) return;
  const source = player(state, use.sourceId);
  const flags = shaFlags(use, target.id);
  if (!flags.tieqi) {
    flags.tieqi = true;
    if (hasSkill(source, "tieqi")) {
      setPending(state, "tieqi", source.id, `是否对 ${target.name} 发动【铁骑】？`, { use, targetId: target.id });
      return;
    }
  }
  if (!flags.liuli) {
    flags.liuli = true;
    if (hasSkill(target, "liuli") && liuliPairs(state, use, target).length > 0) {
      setPending(state, "liuli", target.id, "是否发动【流离】转移此【杀】？", { use, targetId: target.id });
      return;
    }
  }
  if (!flags.cixiong) {
    flags.cixiong = true;
    if (source.equipment.weapon?.name === "雌雄双股剑" && source.character?.gender !== target.character?.gender) {
      setPending(state, "cixiong", source.id, `是否对 ${target.name} 发动【雌雄双股剑】？`, { use, targetId: target.id });
      return;
    }
  }
  if (isBlackShaBlocked(state, use, target)) {
    addLog(state, `${target.name} 的【仁王盾】令黑色【杀】无效。`, "normal", context);
    return;
  }
  if (flags.noDodge) {
    queueShaDamage(state, use, target.id, context);
    return;
  }
  if (target.equipment.armor?.name === "八卦阵" && !use.ignoreArmor) {
    setPending(state, "optionalSkill", target.id, "是否发动【八卦阵】判定？", { skill: "bagua", resume: "sha", use, targetId: target.id });
    return;
  }
  const required = hasSkill(source, "wushuang") ? 2 : 1;
  setPending(state, "response", target.id, `请打出${required > 1 ? "两张" : ""}【闪】`, {
    required: "闪", remaining: required, use, targetId: target.id, kind: "sha", baguaTried: Boolean(use.ignoreArmor),
  });
}

function liuliActions(state: GameStateV2, actor: GamePlayerV2) {
  const { use } = dataAs<{ use: CardUse }>(state.pending!.data);
  const actions = liuliPairs(state, use, actor).map(({ card, target }) => exact(
    `liuli:${card.id}:${target.id}`,
    `弃置【${card.name}】，将【杀】转给 ${target.name}`,
    { type: "skill", skill: "liuli", cardId: card.id, targetId: target.id },
  ));
  actions.push(exact("liuli:pass", "不发动【流离】", { type: "pass" }));
  return actions;
}

function resolveLiuli(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { use, targetId } = dataAs<{ use: CardUse; targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") {
    pushFrame(state, "applyCardEffect", { use, targetId });
    return;
  }
  const valid = liuliPairs(state, use, actor).some((pair) => pair.card.id === action.cardId && pair.target.id === action.targetId);
  if (!valid) throw new Error("流离的牌或新目标已不合法");
  const card = removeOwnedCardsTracked(state, actor, [action.cardId!])[0].card;
  state.discard.push(card);
  const redirectedId = action.targetId!;
  const originalFlags = shaFlags(use, targetId);
  const redirectedFlags = shaFlags(use, redirectedId);
  redirectedFlags.tieqi = true;
  redirectedFlags.liuli = true;
  redirectedFlags.noDodge = originalFlags.noDodge;
  addLog(state, `${actor.name} 弃置 ${publicCardLabel(card)} 发动【流离】，将【杀】转移给 ${player(state, redirectedId).name}。`, "good", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, targetIds: [redirectedId], cardName: card.name, count: 1, zone: "discard" });
  pushFrame(state, "applyCardEffect", { use, targetId: redirectedId });
}

function resolveTieqi(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { use, targetId } = dataAs<{ use: CardUse; targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") pushFrame(state, "applyCardEffect", { use, targetId });
  else beginJudgment(state, actor.id, "铁骑", { resume: "tieqi", use, targetId }, context);
}

function resolveCixiong(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { use, targetId } = dataAs<{ use: CardUse; targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") {
    pushFrame(state, "applyCardEffect", { use, targetId });
    return;
  }
  const target = player(state, targetId);
  if (target.hand.length === 0) {
    draw(state, actor.id, 1, context);
    addLog(state, `${actor.name} 因【雌雄双股剑】摸一张牌。`, "good", context);
    pushFrame(state, "applyCardEffect", { use, targetId });
    return;
  }
  setPending(state, "cixiongChoice", target.id, "【雌雄双股剑】：弃一张手牌，否则令对方摸一张", { use, targetId, sourceId: actor.id });
}

function cixiongChoiceActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions = actor.hand.map((card) => exact(
    `cixiong:discard:${card.id}`,
    `弃置【${card.name}】`,
    { type: "choose", choice: "discard", cardId: card.id },
  ));
  actions.push(exact("cixiong:draw", "不弃牌，令对方摸一张", { type: "pass" }));
  void state;
  return actions;
}

function resolveCixiongChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { use, targetId, sourceId } = dataAs<{ use: CardUse; targetId: string; sourceId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") {
    draw(state, sourceId, 1, context);
    addLog(state, `${actor.name} 不弃牌，${player(state, sourceId).name} 因【雌雄双股剑】摸一张牌。`, "normal", context, { kind: "draw", actorId: sourceId, targetIds: [sourceId], count: 1, zone: "deck" });
  } else {
    const discarded = removeOwnedCardsTracked(state, actor, [action.cardId!])[0].card;
    state.discard.push(discarded);
    addLog(state, `${actor.name} 因【雌雄双股剑】弃置 ${publicCardLabel(discarded)}。`, "normal", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, cardName: discarded.name, count: 1, zone: "discard" });
  }
  pushFrame(state, "applyCardEffect", { use, targetId });
}

function queueShaDamage(state: GameStateV2, use: CardUse, targetId: string, context?: EngineContextV2) {
  const source = player(state, use.sourceId);
  const target = player(state, targetId);
  const flags = shaFlags(use, targetId);
  if (!flags.hanbing && source.equipment.weapon?.name === "寒冰剑" && zoneHasCards(target, false)) {
    flags.hanbing = true;
    setPending(state, "hanbing", source.id, `是否发动【寒冰剑】防止伤害并弃置 ${target.name} 的两张牌？`, { use, targetId });
    return;
  }
  pushFrame(state, "postShaDamage", { use, targetId, targetEpoch: target.generalEpoch });
  queueDamageFromUse(state, use, targetId);
  void context;
}

function resolveHanbing(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { use, targetId } = dataAs<{ use: CardUse; targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") {
    queueShaDamage(state, use, targetId, context);
    return;
  }
  setPending(state, "hanbingChoice", actor.id, "寒冰剑：请弃置目标的第1张牌", { use, targetId, remaining: 2 });
}

function hanbingChoiceActions(state: GameStateV2, actor: GamePlayerV2) {
  const { targetId } = dataAs<{ targetId: string }>(state.pending!.data);
  const target = player(state, targetId);
  const actions: LegalActionV2[] = [];
  if (target.hand.length) actions.push(exact("hanbing:hand", "弃置一张随机手牌", { type: "choose", zone: "hand" }));
  for (const card of equipmentCards(target)) actions.push(exact(`hanbing:equip:${card.id}`, `弃置装备【${card.name}】`, { type: "choose", zone: "equip", cardId: card.id }));
  void actor;
  return actions;
}

function resolveHanbingChoice(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const data = dataAs<{ use: CardUse; targetId: string; remaining: number }>(state.pending!.data);
  state.pending = null;
  const target = player(state, data.targetId);
  let card: Card | null = null;
  if (action.zone === "hand") {
    const id = target.hand[randomInt(state, target.hand.length)].id;
    card = removeOwnedCardsTracked(state, target, [id])[0].card;
  } else if (action.zone === "equip") card = removeOwnedCardsTracked(state, target, [action.cardId!])[0].card;
  else throw new Error("寒冰剑只能选择手牌或装备");
  if (!card) throw new Error("寒冰剑所选牌已离开目标区域");
  restorePhysicalCard(card);
  state.discard.push(card);
  addLog(state, `${actor.name} 以【寒冰剑】弃置了 ${target.name} 的 ${publicCardLabel(card)}。`, "danger", context, { kind: "discard", actorId: actor.id, sourceId: target.id, cardName: card.name, count: 1, zone: "discard" });
  const remaining = data.remaining - 1;
  if (remaining > 0) pushFrame(state, "continueHanbing", { actorId: actor.id, data: { ...data, remaining } });
}

function continueHanbingFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { actorId, data } = dataAs<{ actorId: string; data: { use: CardUse; targetId: string; remaining: number } }>(frame.data);
  const target = player(state, data.targetId);
  if (player(state, actorId).alive && target.alive && zoneHasCards(target, false)) {
    setPending(state, "hanbingChoice", actorId, `寒冰剑：请弃置目标的第${3 - data.remaining}张牌`, data as unknown as Record<string, unknown>);
  }
  void context;
}

function resolvePostShaDamageFrame(state: GameStateV2, frame: EffectFrameV2, context?: EngineContextV2) {
  const { use, targetId, targetEpoch } = dataAs<{ use: CardUse; targetId: string; targetEpoch?: number }>(frame.data);
  const source = state.players.find((entry) => entry.id === use.sourceId && entry.alive);
  const target = state.players.find((entry) => entry.id === targetId && entry.alive);
  if (targetEpoch !== undefined && target?.generalEpoch !== targetEpoch) return;
  if (!source || !target || source.equipment.weapon?.name !== "麒麟弓") return;
  const horses = [target.equipment.offensiveHorse, target.equipment.defensiveHorse].filter((card): card is Card => Boolean(card));
  if (!horses.length) return;
  setPending(state, "qilin", source.id, `是否发动【麒麟弓】弃置 ${target.name} 的一匹坐骑？`, { targetId, cardIds: horses.map((card) => card.id) });
  void context;
}

function qilinActions(state: GameStateV2, actor: GamePlayerV2) {
  const { targetId, cardIds } = dataAs<{ targetId: string; cardIds: string[] }>(state.pending!.data);
  const target = player(state, targetId);
  const actions = cardIds.map((id) => {
    const card = equipmentCards(target).find((entry) => entry.id === id)!;
    return exact(`qilin:${id}`, `弃置【${card.name}】`, { type: "choose", cardId: id });
  });
  actions.push(exact("qilin:pass", "不发动【麒麟弓】", { type: "pass" }));
  void actor;
  return actions;
}

function resolveQilin(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { targetId } = dataAs<{ targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") return;
  const target = player(state, targetId);
  const card = removeOwnedCardsTracked(state, target, [action.cardId!])[0].card;
  state.discard.push(card);
  addLog(state, `${actor.name} 发动【麒麟弓】，弃置 ${target.name} 的【${card.name}】。`, "good", context);
}

function afterShaDodged(state: GameStateV2, use: CardUse, targetId: string, context?: EngineContextV2) {
  const source = player(state, use.sourceId);
  const target = player(state, targetId);
  if (!source.alive || !target.alive) return;
  if (source.equipment.weapon?.name === "青龙偃月刀" && shaCardsFor(state, source).length > 0) {
    setPending(state, "qinglong", source.id, `【青龙偃月刀】：可对 ${target.name} 再使用一张【杀】`, { targetId });
    return;
  }
  if (source.equipment.weapon?.name === "贯石斧" && allOwnedCards(source).length >= 2) {
    setPending(state, "guanshi", source.id, `【贯石斧】：可弃置两张牌，令此【杀】仍造成伤害`, { use, targetId });
  }
  void context;
}

function shaCardsFor(state: GameStateV2, actor: GamePlayerV2) {
  return allOwnedCards(actor).flatMap((card) => transformedOptions(actor, card, false)
    .filter((entry) => entry.name === "杀")
    .map((entry) => ({ card, skill: entry.skill })));
  void state;
}

function qinglongActions(state: GameStateV2, actor: GamePlayerV2) {
  const actions = shaCardsFor(state, actor).map(({ card, skill }) => exact(
    `qinglong:${card.id}:${skill ?? "sha"}`,
    `再使用【杀】${skill ? `（${SKILLS[skill as SkillId]?.name ?? skill}）` : ""}`,
    { type: "respond", cardId: card.id, as: "杀", skill },
  ));
  if (actor.equipment.weapon?.name === "丈八蛇矛" && actor.hand.length >= 2) actions.push({
    id: "qinglong:zhangba", kind: "skill", skill: "qinglong_zhangba", label: "两张手牌当【杀】",
    candidateCardIds: actor.hand.map((card) => card.id), minCards: 2, maxCards: 2,
  });
  actions.push(exact("qinglong:pass", "不再使用【杀】", { type: "pass" }));
  return actions;
}

function resolveQinglong(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { targetId } = dataAs<{ targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") return;
  const ids = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  const cards = removeOwnedCardsTracked(state, actor, ids).map((entry) => entry.card);
  state.processing.push(...cards);
  const colors = new Set(cards.map((card) => card.color));
  const use: CardUse = {
    id: `u${state.frameSeq + 1}:qinglong`, sourceId: actor.id, name: "杀", cardIds: ids,
    color: colors.size === 1 ? cards[0].color : "none", targets: [targetId], targetIndex: 0,
    ignoreArmor: actor.equipment.weapon?.name === "青釭剑", sourceSkill: action.skill,
  };
  const qinglongSkillName = action.skill && action.skill in SKILLS ? SKILLS[action.skill as SkillId].name : undefined;
  addLog(state, `${actor.name} 发动【青龙偃月刀】，${qinglongSkillName ? `并发动【${qinglongSkillName}】，将 ${publicCardList(cards)} 当` : `使用 ${publicCardList(cards)} 作为`}【杀】再次攻击。`, "good", context, { kind: "use", actorId: actor.id, sourceId: actor.id, targetIds: [targetId], cardName: "杀", cardNames: cards.map((card) => card.name), count: cards.length });
  pushFrame(state, "resolveUse", { use });
}

function guanshiActions(state: GameStateV2, actor: GamePlayerV2) {
  return [
    {
      id: "guanshi:discard", kind: "skill", skill: "guanshi", label: "弃置两张牌，令【杀】命中",
      candidateCardIds: allOwnedCards(actor).map((card) => card.id), minCards: 2, maxCards: 2,
    },
    exact("guanshi:pass", "不发动【贯石斧】", { type: "pass" }),
  ];
  void state;
}

function resolveGuanshi(state: GameStateV2, actor: GamePlayerV2, action: GameActionV2, context?: EngineContextV2) {
  const { use, targetId } = dataAs<{ use: CardUse; targetId: string }>(state.pending!.data);
  state.pending = null;
  if (action.type === "pass") return;
  const discarded = removeOwnedCardsTracked(state, actor, action.cardIds ?? []).map((entry) => entry.card);
  state.discard.push(...discarded);
  addLog(state, `${actor.name} 弃置 ${publicCardList(discarded)} 发动【贯石斧】，令【杀】命中。`, "good", context, { kind: "discard", actorId: actor.id, sourceId: actor.id, cardNames: discarded.map((card) => card.name), count: discarded.length, zone: "discard" });
  queueShaDamage(state, use, targetId, context);
}

function resolveBorrowedSword(state: GameStateV2, use: CardUse, weaponHolder: GamePlayerV2, context?: EngineContextV2) {
  const borrowTargetId = String(use.data?.borrowTargetId ?? "");
  if (!borrowTargetId) {
    const targets = validSingleTargets(state, weaponHolder, "杀").map((entry) => entry.id).filter((id) => id !== use.sourceId);
    setPending(state, "chooseBorrowTarget", use.sourceId, `请选择 ${weaponHolder.name} 使用【杀】的目标`, { use, weaponHolderId: weaponHolder.id, targetIds: targets });
    return;
  }
  setPending(state, "borrowSha", weaponHolder.id, `请对 ${player(state, borrowTargetId).name} 使用【杀】，否则交出武器`, {
    sourceId: use.sourceId,
    targetId: borrowTargetId,
  });
  void context;
}

function queueDamageFromUse(state: GameStateV2, use: CardUse, targetId: string, sourceOverride?: string) {
  let amount = 1;
  const sourceId = sourceOverride ?? use.sourceId;
  if (state.turn?.stats.luoyi && state.turn.playerId === sourceId && (use.name === "杀" || use.name === "决斗")) amount += 1;
  queueDamage(state, { sourceId, targetId, amount, cardIds: use.cardIds, cardName: use.name, reason: `【${use.name}】` });
}

function queueDamage(state: GameStateV2, damage: DamageSpec) {
  const target = player(state, damage.targetId);
  pushFrame(state, "damage", { ...damage, targetEpoch: damage.targetEpoch ?? target.generalEpoch } as unknown as Record<string, unknown>);
}

function dealDamage(state: GameStateV2, damage: DamageSpec, context?: EngineContextV2) {
  const target = player(state, damage.targetId);
  if (!target.alive || state.status === "finished") return;
  damage.targetEpoch ??= target.generalEpoch;
  target.hp -= damage.amount;
  addLog(state, `${target.name} 受到 ${damage.amount} 点伤害，剩余 ${target.hp} 点体力。`, "danger", context, { kind: "damage", actorId: damage.sourceId, sourceId: damage.sourceId, targetIds: [target.id], cardName: damage.cardName, amount: damage.amount });
  pushFrame(state, "afterDamage", { damage });
  if (target.hp <= 0) {
    const rescueStart = state.turn?.playerId ?? target.id;
    pushFrame(state, "dying", { targetId: target.id, sourceId: damage.sourceId, order: actionOrder(state, rescueStart, true).map((entry) => entry.id), cursor: 0, passes: 0 });
  }
}

function loseHp(state: GameStateV2, targetId: string, amount: number, sourceId: string | undefined, reason: string, context?: EngineContextV2) {
  const target = player(state, targetId);
  target.hp -= amount;
  addLog(state, `${target.name} 因【${reason}】失去 ${amount} 点体力。`, "danger", context, { kind: "damage", actorId: sourceId, sourceId, targetIds: [target.id], amount });
  if (target.hp <= 0) {
    const rescueStart = state.turn?.playerId ?? targetId;
    pushFrame(state, "dying", { targetId, sourceId, order: actionOrder(state, rescueStart, true).map((entry) => entry.id), cursor: 0, passes: 0 });
  }
}

function beginJudgment(state: GameStateV2, targetId: string, reason: string, continuation: Record<string, unknown>, context?: EngineContextV2) {
  recycleDeck(state, context);
  const card = state.deck.pop();
  if (!card) return;
  state.processing.push(card);
  const judgmentStart = state.turn?.playerId ?? targetId;
  const guicaiOrder = actionOrder(state, judgmentStart, true).filter((entry) => hasSkill(entry, "guicai")).map((entry) => entry.id);
  const data = { targetId, reason, cardId: card.id, continuation, guicaiOrder, cursor: 0 };
  addLog(state, `${player(state, targetId).name} 的【${reason}】亮出判定牌 ${suitSymbol(card.suit)}${card.rank}【${card.name}】。`, "normal", context, {
    kind: "judge", actorId: targetId, targetIds: [targetId], cardName: card.name, count: 1,
  });
  if (guicaiOrder.length > 0) setPending(state, "judgment", guicaiOrder[0], `判定牌为 ${suitSymbol(card.suit)}${card.rank}【${card.name}】，是否发动【鬼才】？`, data);
  else completeJudgment(state, data, context);
}

function finishDelayedAfterNullification(state: GameStateV2, use: CardUse, targetId: string, nullified: boolean, context?: EngineContextV2) {
  if (use.name === "乐不思蜀") {
    if (nullified) {
      discardProcessing(state, use.cardIds);
      pushFrame(state, "judgePhase");
    } else beginJudgment(state, targetId, "乐不思蜀", { resume: "indulgence", cardIds: use.cardIds }, context);
  } else if (use.name === "闪电") {
    if (nullified) passLightning(state, use.cardIds[0], targetId);
    else beginJudgment(state, targetId, "闪电", { resume: "lightning", cardIds: use.cardIds }, context);
  }
}

function discardProcessing(state: GameStateV2, ids: string[]) {
  for (const id of ids) {
    const card = removeCard(state.processing, id);
    if (card) {
      delete card.asName;
      state.discard.push(card);
    }
  }
}

function passLightning(state: GameStateV2, cardId: string, fromId: string) {
  const card = removeCard(state.processing, cardId);
  if (!card) return;
  const next = actionOrder(state, fromId, false).find((entry) => !entry.judgment.some((item) => item.name === "闪电"));
  if (next) next.judgment.push(card);
  else state.discard.push(card);
  pushFrame(state, "judgePhase");
}

function eliminate(state: GameStateV2, targetId: string, sourceId?: string, context?: EngineContextV2) {
  const target = player(state, targetId);
  if (!target.alive) return;
  const defeatedGeneral = target.character;
  const defeatedDuringOwnTurn = state.turn?.playerId === target.id;
  target.alive = false;
  target.hp = 0;
  state.discard.push(...target.hand, ...equipmentCards(target), ...target.judgment.map(restorePhysicalCard));
  target.hand = [];
  target.equipment = defaultEquipment();
  target.judgment = [];
  target.marks = {};
  if (state.mode === "duel") {
    const defeatedId = target.duelLineup?.shift();
    if (defeatedId) target.duelDefeated?.push(defeatedId);
    addLog(state, `${target.name} 的 ${defeatedGeneral?.name ?? "武将"} 阵亡。`, "danger", context, { kind: "death", actorId: sourceId, sourceId, targetIds: [target.id] });
    if (target.duelLineup?.length) {
      const replacement = characterById(target.duelLineup[0]);
      target.character = replacement;
      target.maxHp = replacement.maxHp;
      target.hp = target.maxHp;
      target.alive = true;
      target.generalEpoch += 1;
      draw(state, target.id, 4, context);
      state.triggers = state.triggers.filter((trigger) => trigger.actorId !== target.id);
      addLog(state, `${target.name} 的下一名武将 ${replacement.name} 登场，摸四张牌。`, "system", context);
      if (defeatedDuringOwnTurn) {
        state.duelTurnTerminated = true;
        const phaseFrames = new Set(["enterPhase", "preparePhase", "judgePhase", "drawPhase", "discardPhase", "finishPhase", "endTurn"]);
        state.stack = state.stack.filter((frame) => !phaseFrames.has(frame.kind));
      }
      return;
    }
    state.discard.push(...state.processing.map(restorePhysicalCard), ...state.revealed.map(restorePhysicalCard));
    state.processing = [];
    state.revealed = [];
    addLog(state, `${target.name} 的三名出战武将全部阵亡。`, "danger", context);
    checkVictory(state, context);
    return;
  }
  addLog(state, `${target.name} 阵亡，身份为${roleName(target.role)}。`, "danger", context, { kind: "death", actorId: sourceId, sourceId, targetIds: [target.id] });
  const source = sourceId ? state.players.find((entry) => entry.id === sourceId) : null;
  if (state.mode !== "duel" && source?.alive && target.role === "rebel") draw(state, source.id, 3, context);
  if (state.mode !== "duel" && source?.alive && source.role === "lord" && target.role === "loyalist") {
    const ids = allOwnedCards(source).map((card) => card.id);
    state.discard.push(...removeOwnedCardsTracked(state, source, ids).map((entry) => entry.card));
  }
  checkVictory(state, context);
  if (state.status !== "finished" && state.turn?.playerId === target.id) {
    state.stack = [];
    const living = alivePlayers(state);
    const next = living.find((entry) => entry.seat > target.seat) ?? living[0] ?? null;
    if (next) {
      if (next.seat <= target.seat) state.round += 1;
      beginTurn(state, next.id, context);
    }
  }
}

function checkVictory(state: GameStateV2, context?: EngineContextV2) {
  const living = alivePlayers(state);
  const lord = state.players.find((entry) => entry.role === "lord");
  const duel = state.mode === "duel" || state.players.length === 2;
  if (duel && living.length === 1) {
    const winner = living[0];
    state.winner = {
      side: winner.role === "lord" ? "lord" : "renegade",
      label: `${winner.name}赢得经典1V1`,
      playerIds: [winner.id],
    };
  } else if (!lord?.alive) {
    const renegades = living.filter((entry) => entry.role === "renegade");
    state.winner = living.length === 1 && renegades.length === 1
      ? { side: "renegade", label: "内奸独胜", playerIds: renegades.map((entry) => entry.id) }
      : {
          side: "rebel",
          label: duel ? `${living[0]?.name ?? "后手"}赢得双人对决` : "反贼胜利",
          playerIds: state.players.filter((entry) => entry.role === "rebel").map((entry) => entry.id),
        };
  } else if (!living.some((entry) => entry.role === "rebel" || entry.role === "renegade")) {
    state.winner = {
      side: "lord",
      label: duel ? `${lord.name}赢得双人对决` : "主公阵营胜利",
      playerIds: state.players.filter((entry) => entry.role === "lord" || entry.role === "loyalist").map((entry) => entry.id),
    };
  }
  if (state.winner) {
    state.status = "finished";
    state.turn = null;
    state.pending = null;
    state.stack = [];
    addLog(state, `对局结束：${state.winner.label}。`, "system", context);
  }
}

export function applyTimeoutV2(state: GameStateV2, context?: EngineContextV2) {
  if (!state.deadlineAt || now(context) < new Date(state.deadlineAt).getTime()) throw new Error("当前决策尚未超时");
  const actorId = state.pending?.actorId ?? state.turn?.playerId;
  if (!actorId) throw new Error("当前没有等待中的决策");
  const actions = getLegalActionsV2(state, actorId);
  const selected = actions.find((entry) => entry.kind === "exact" && entry.action?.type === "pass")
    ?? actions.find((entry) => entry.kind === "exact" && entry.action?.type === "endTurn")
    ?? actions.find((entry) => entry.kind === "discard")
    ?? actions.find((entry) => entry.kind === "exact")
    ?? actions[0];
  if (!selected) throw new Error("当前没有安全默认动作");
  let action: GameActionV2;
  if (selected.kind === "discard") action = { type: "discard", cardIds: selected.candidateCardIds!.slice(0, selected.minCards) };
  else if (selected.kind === "skill") action = { type: "skill", skill: selected.skill, cardIds: selected.candidateCardIds?.slice(0, selected.minCards), targetIds: selected.targetIds?.slice(0, selected.minTargets) };
  else action = selected.action!;
  const prepared = structuredClone(state);
  addLog(prepared, `${player(prepared, actorId).name} 行动超时，系统执行默认动作。`, "system", context);
  return applyGameActionV2(prepared, actorId, action, context);
}

export function assertGameInvariantV2(state: GameStateV2) {
  const cards = [
    ...state.deck,
    ...state.discard,
    ...state.processing,
    ...state.revealed,
    ...state.players.flatMap((entry) => [...entry.hand, ...equipmentCards(entry), ...entry.judgment]),
  ];
  if (cards.length !== 108) throw new Error(`牌张守恒失败：当前 ${cards.length} 张`);
  if (new Set(cards.map((card) => card.id)).size !== 108) throw new Error("实体牌出现在多个区域");
  if (state.players.length !== 2 && (state.players.length < 4 || state.players.length > 10)) {
    throw new Error("玩家数量不符合双人对决或身份局规则");
  }
  if (new Set(state.players.map((entry) => entry.id)).size !== state.players.length) throw new Error("玩家 ID 重复");
  if (new Set(state.players.map((entry) => entry.seat)).size !== state.players.length) throw new Error("玩家座位重复");
  for (const entry of state.players) {
    if (state.status === "setup" && !entry.character) {
      if (entry.hp !== 0 || entry.maxHp !== 0) throw new Error(`${entry.name} 尚未选将却已有体力`);
      continue;
    }
    if (!Number.isInteger(entry.hp) || !Number.isInteger(entry.maxHp) || entry.maxHp <= 0) throw new Error(`${entry.name} 的体力数据无效`);
    const isDyingTarget = entry.hp <= 0 && (
      (state.pending?.kind === "rescue" && state.pending.data.targetId === entry.id)
      || state.stack.some((frame) => frame.kind === "dying" && frame.data.targetId === entry.id)
    );
    if ((!isDyingTarget && entry.hp < 0) || entry.hp > entry.maxHp) {
      throw new Error(`${entry.name} 的体力越界：${entry.hp}/${entry.maxHp}, pending=${state.pending?.kind ?? "none"}, stack=${state.stack.map((frame) => frame.kind).join(",")}`);
    }
    if (entry.alive !== (entry.hp > 0) && !(entry.alive && isDyingTarget)) {
      throw new Error(`${entry.name} 的存活状态与体力不一致：alive=${entry.alive}, hp=${entry.hp}, status=${state.status}, pending=${state.pending?.kind ?? "none"}`);
    }
  }
  if (state.pending && !state.players.some((entry) => entry.id === state.pending!.actorId && entry.alive)) throw new Error("决策对象无效");
  if (state.status === "playing") {
    if (!state.turn) throw new Error("进行中的对局缺少回合");
    if (state.winner) throw new Error("进行中的对局不应已有胜者");
    if (!state.players.some((entry) => entry.id === state.turn!.playerId && entry.alive)) throw new Error("当前回合指向无效或阵亡玩家");
  }
  if (state.status === "finished") {
    if (!state.winner?.playerIds.length) throw new Error("结束的对局缺少胜者");
    if (state.turn || state.pending || state.stack.length) throw new Error("结束的对局仍残留回合、决策或结算栈");
  }
}

export const v2RoleName = roleName;
export const v2KingdomName = kingdomName;
export { RANK_ORDER };
