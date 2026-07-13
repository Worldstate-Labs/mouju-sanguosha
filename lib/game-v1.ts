// Frozen compatibility engine for rooms created before the classic-standard rules upgrade.
export type PlayerKind = "human" | "agent";
export type Role = "lord" | "loyalist" | "rebel" | "renegade";
export type Kingdom = "wei" | "shu" | "wu" | "qun";
export type Suit = "spade" | "heart" | "club" | "diamond";
export type CardCategory = "basic" | "trick" | "equip";

export interface LobbySeat {
  id: string;
  name: string;
  kind: PlayerKind;
  seat: number;
}

export interface Character {
  id: string;
  name: string;
  title: string;
  kingdom: Kingdom;
  gender: "male" | "female";
  maxHp: number;
  skill: string;
  skillName: string;
  skillText: string;
}

export type CardName =
  | "杀"
  | "闪"
  | "桃"
  | "酒"
  | "无中生有"
  | "过河拆桥"
  | "顺手牵羊"
  | "决斗"
  | "南蛮入侵"
  | "万箭齐发"
  | "桃园结义"
  | "诸葛连弩"
  | "青釭剑"
  | "丈八蛇矛"
  | "方天画戟"
  | "麒麟弓";

export interface Card {
  id: string;
  name: CardName;
  suit: Suit;
  rank: string;
  color: "red" | "black";
  category: CardCategory;
}

export interface GamePlayer {
  id: string;
  name: string;
  kind: PlayerKind;
  seat: number;
  role: Role;
  character: Character;
  hp: number;
  maxHp: number;
  alive: boolean;
  hand: Card[];
  weapon: Card | null;
}

export interface BattleLog {
  id: number;
  text: string;
  tone: "normal" | "good" | "danger" | "system";
  at: string;
}

interface PendingResponse {
  kind: "sha" | "duel" | "aoe";
  sourceId: string;
  targetId: string;
  opponentId?: string;
  required: "杀" | "闪";
  remaining: number;
  sourceCardId: string;
  damage: number;
  queue?: string[];
  queueIndex?: number;
}

export interface GameState {
  engineVersion: 1;
  status: "playing" | "finished";
  players: GamePlayer[];
  deck: Card[];
  discard: Card[];
  round: number;
  turn: {
    playerId: string;
    phase: "play";
    shaUsed: number;
    drunk: boolean;
    skillUsed: string[];
    counters: Record<string, number>;
  } | null;
  pending: PendingResponse | null;
  winner: {
    side: "lord" | "rebel" | "renegade";
    label: string;
    playerIds: string[];
  } | null;
  deadlineAt: string | null;
  logSeq: number;
  logs: BattleLog[];
}

export type GameAction =
  | { type: "playCard"; cardId: string; targetId?: string; as?: "杀" | "桃" }
  | { type: "respond"; cardId: string }
  | { type: "pass" }
  | { type: "discard"; cardIds: string[] }
  | { type: "endTurn" }
  | {
      type: "skill";
      skill: "rende" | "zhiheng" | "qingnang";
      cardIds: string[];
      targetId?: string;
    };

export interface LegalAction {
  id: string;
  kind: "exact" | "discard" | "skill";
  label: string;
  description?: string;
  action?: GameAction;
  skill?: "rende" | "zhiheng" | "qingnang";
  candidateCardIds?: string[];
  minCards?: number;
  maxCards?: number;
  targetIds?: string[];
}

const CHARACTERS: Character[] = [
  {
    id: "liubei",
    name: "刘备",
    title: "乱世的枭雄",
    kingdom: "shu",
    gender: "male",
    maxHp: 4,
    skill: "rende",
    skillName: "仁德",
    skillText: "出牌阶段可交给他人手牌；每回合首次累计给出两张时回复1点体力。",
  },
  {
    id: "guanyu",
    name: "关羽",
    title: "美髯公",
    kingdom: "shu",
    gender: "male",
    maxHp: 4,
    skill: "wusheng",
    skillName: "武圣",
    skillText: "可将一张红色牌当【杀】使用或打出。",
  },
  {
    id: "zhangfei",
    name: "张飞",
    title: "万夫不当",
    kingdom: "shu",
    gender: "male",
    maxHp: 4,
    skill: "paoxiao",
    skillName: "咆哮",
    skillText: "出牌阶段使用【杀】无次数限制。",
  },
  {
    id: "zhaoyun",
    name: "赵云",
    title: "少年将军",
    kingdom: "shu",
    gender: "male",
    maxHp: 4,
    skill: "longdan",
    skillName: "龙胆",
    skillText: "可将【杀】与【闪】互相转化使用或打出。",
  },
  {
    id: "zhugeliang",
    name: "诸葛亮",
    title: "迟暮的丞相",
    kingdom: "shu",
    gender: "male",
    maxHp: 3,
    skill: "kongcheng",
    skillName: "空城",
    skillText: "没有手牌时，不能成为【杀】或【决斗】的目标。",
  },
  {
    id: "caocao",
    name: "曹操",
    title: "魏武帝",
    kingdom: "wei",
    gender: "male",
    maxHp: 4,
    skill: "jianxiong",
    skillName: "奸雄",
    skillText: "受到伤害后，获得造成伤害的牌（若仍在弃牌堆）。",
  },
  {
    id: "simayi",
    name: "司马懿",
    title: "狼顾之鬼",
    kingdom: "wei",
    gender: "male",
    maxHp: 3,
    skill: "fankui",
    skillName: "反馈",
    skillText: "受到有来源的伤害后，随机获得伤害来源的一张手牌。",
  },
  {
    id: "sunquan",
    name: "孙权",
    title: "年轻的贤君",
    kingdom: "wu",
    gender: "male",
    maxHp: 4,
    skill: "zhiheng",
    skillName: "制衡",
    skillText: "每回合限一次，弃置任意张牌并摸等量的牌。",
  },
  {
    id: "zhouyu",
    name: "周瑜",
    title: "大都督",
    kingdom: "wu",
    gender: "male",
    maxHp: 3,
    skill: "yingzi",
    skillName: "英姿",
    skillText: "摸牌阶段额外摸一张牌。",
  },
  {
    id: "diaochan",
    name: "貂蝉",
    title: "绝世的舞姬",
    kingdom: "qun",
    gender: "female",
    maxHp: 3,
    skill: "biyue",
    skillName: "闭月",
    skillText: "回合结束时摸一张牌。",
  },
  {
    id: "huatuo",
    name: "华佗",
    title: "神医",
    kingdom: "qun",
    gender: "male",
    maxHp: 3,
    skill: "qingnang",
    skillName: "青囊",
    skillText: "每回合限一次，弃一张手牌令一名受伤角色回复1点体力。",
  },
  {
    id: "lvbu",
    name: "吕布",
    title: "武的化身",
    kingdom: "qun",
    gender: "male",
    maxHp: 4,
    skill: "wushuang",
    skillName: "无双",
    skillText: "你使用的【杀】需两张【闪】响应；与你【决斗】需连续打出两张【杀】。",
  },
  {
    id: "huangyueying",
    name: "黄月英",
    title: "归隐的杰女",
    kingdom: "shu",
    gender: "female",
    maxHp: 3,
    skill: "jizhi",
    skillName: "集智",
    skillText: "使用锦囊牌后摸一张牌。",
  },
];

const ROLE_MAP: Record<number, Role[]> = {
  2: ["lord", "rebel"],
  3: ["lord", "rebel", "renegade"],
  4: ["lord", "loyalist", "rebel", "renegade"],
  5: ["lord", "loyalist", "rebel", "rebel", "renegade"],
  6: ["lord", "loyalist", "rebel", "rebel", "rebel", "renegade"],
  7: ["lord", "loyalist", "loyalist", "rebel", "rebel", "rebel", "renegade"],
  8: ["lord", "loyalist", "loyalist", "rebel", "rebel", "rebel", "rebel", "renegade"],
};

const CATEGORY_BY_NAME: Record<CardName, CardCategory> = {
  杀: "basic",
  闪: "basic",
  桃: "basic",
  酒: "basic",
  无中生有: "trick",
  过河拆桥: "trick",
  顺手牵羊: "trick",
  决斗: "trick",
  南蛮入侵: "trick",
  万箭齐发: "trick",
  桃园结义: "trick",
  诸葛连弩: "equip",
  青釭剑: "equip",
  丈八蛇矛: "equip",
  方天画戟: "equip",
  麒麟弓: "equip",
};

const DECK_PLAN: Array<[CardName, number]> = [
  ["杀", 28],
  ["闪", 18],
  ["桃", 9],
  ["酒", 4],
  ["无中生有", 4],
  ["过河拆桥", 4],
  ["顺手牵羊", 3],
  ["决斗", 3],
  ["南蛮入侵", 2],
  ["万箭齐发", 2],
  ["桃园结义", 1],
  ["诸葛连弩", 1],
  ["青釭剑", 1],
  ["丈八蛇矛", 1],
  ["方天画戟", 1],
  ["麒麟弓", 1],
];

const SUITS: Suit[] = ["spade", "heart", "club", "diamond"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function shuffle<T>(values: T[]): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

function makeDeck(): Card[] {
  let index = 0;
  const cards: Card[] = [];
  for (const [name, count] of DECK_PLAN) {
    for (let copy = 0; copy < count; copy += 1) {
      const suit = SUITS[index % SUITS.length];
      cards.push({
        id: `c_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`,
        name,
        suit,
        rank: RANKS[index % RANKS.length],
        color: suit === "heart" || suit === "diamond" ? "red" : "black",
        category: CATEGORY_BY_NAME[name],
      });
      index += 1;
    }
  }
  return shuffle(cards);
}

function roleLabel(role: Role): string {
  return { lord: "主公", loyalist: "忠臣", rebel: "反贼", renegade: "内奸" }[role];
}

function addLog(
  state: GameState,
  text: string,
  tone: BattleLog["tone"] = "normal",
) {
  state.logSeq += 1;
  state.logs.push({ id: state.logSeq, text, tone, at: new Date().toISOString() });
  if (state.logs.length > 180) state.logs = state.logs.slice(-180);
}

function stampDeadline(state: GameState) {
  if (state.status === "finished") {
    state.deadlineAt = null;
    return;
  }
  state.deadlineAt = new Date(Date.now() + (state.pending ? 45_000 : 75_000)).toISOString();
}

function player(state: GameState, id: string): GamePlayer {
  const found = state.players.find((entry) => entry.id === id);
  if (!found) throw new Error("角色不存在");
  return found;
}

function recycleDeck(state: GameState) {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffle(state.discard);
    state.discard = [];
    addLog(state, "弃牌堆重新洗入牌堆。", "system");
  }
}

function draw(state: GameState, target: GamePlayer, count: number) {
  for (let i = 0; i < count; i += 1) {
    recycleDeck(state);
    const card = state.deck.pop();
    if (!card) return;
    target.hand.push(card);
  }
}

function alivePlayers(state: GameState): GamePlayer[] {
  return state.players.filter((entry) => entry.alive).sort((a, b) => a.seat - b.seat);
}

function distance(state: GameState, fromId: string, toId: string): number {
  const alive = alivePlayers(state);
  const from = alive.findIndex((entry) => entry.id === fromId);
  const to = alive.findIndex((entry) => entry.id === toId);
  if (from < 0 || to < 0) return Number.POSITIVE_INFINITY;
  const raw = Math.abs(from - to);
  return Math.min(raw, alive.length - raw);
}

function weaponRange(card: Card | null): number {
  if (!card) return 1;
  return {
    诸葛连弩: 1,
    青釭剑: 2,
    丈八蛇矛: 3,
    方天画戟: 4,
    麒麟弓: 5,
  }[card.name] ?? 1;
}

function cardIndex(owner: GamePlayer, cardId: string): number {
  return owner.hand.findIndex((card) => card.id === cardId);
}

function takeHandCard(owner: GamePlayer, cardId: string): Card {
  const index = cardIndex(owner, cardId);
  if (index < 0) throw new Error("这张牌已不在你的手牌中");
  return owner.hand.splice(index, 1)[0];
}

function randomHandCard(owner: GamePlayer): Card | null {
  if (owner.hand.length === 0) return null;
  const index = Math.floor(Math.random() * owner.hand.length);
  return owner.hand.splice(index, 1)[0];
}

function canUseAs(owner: GamePlayer, card: Card, desired: "杀" | "闪" | "桃"): boolean {
  if (card.name === desired) return true;
  if (desired === "杀" && owner.character.skill === "wusheng" && card.color === "red") return true;
  if (desired === "杀" && owner.character.skill === "longdan" && card.name === "闪") return true;
  if (desired === "闪" && owner.character.skill === "longdan" && card.name === "杀") return true;
  if (desired === "桃" && owner.character.skill === "qingnang" && card.color === "red") return true;
  return false;
}

function cannotTarget(target: GamePlayer, effectiveName: CardName): boolean {
  return (
    target.character.skill === "kongcheng" &&
    target.hand.length === 0 &&
    (effectiveName === "杀" || effectiveName === "决斗")
  );
}

function validTargets(state: GameState, actor: GamePlayer, effectiveName: CardName): GamePlayer[] {
  const others = alivePlayers(state).filter((entry) => entry.id !== actor.id);
  if (effectiveName === "杀") {
    return others.filter(
      (target) => distance(state, actor.id, target.id) <= weaponRange(actor.weapon) && !cannotTarget(target, effectiveName),
    );
  }
  if (effectiveName === "过河拆桥") {
    return others.filter((target) => target.hand.length > 0 || target.weapon);
  }
  if (effectiveName === "顺手牵羊") {
    return others.filter(
      (target) => distance(state, actor.id, target.id) <= 1 && (target.hand.length > 0 || target.weapon),
    );
  }
  if (effectiveName === "决斗") return others.filter((target) => !cannotTarget(target, effectiveName));
  return [];
}

function removeSourceCardFromDiscard(state: GameState, cardId: string): Card | null {
  const index = state.discard.findIndex((card) => card.id === cardId);
  if (index < 0) return null;
  return state.discard.splice(index, 1)[0];
}

function checkVictory(state: GameState) {
  const living = alivePlayers(state);
  const lord = state.players.find((entry) => entry.role === "lord");
  if (!lord?.alive) {
    const renegades = living.filter((entry) => entry.role === "renegade");
    if (living.length === 1 && renegades.length === 1) {
      state.winner = { side: "renegade", label: "内奸独胜", playerIds: renegades.map((entry) => entry.id) };
    } else {
      const rebels = state.players.filter((entry) => entry.role === "rebel");
      state.winner = { side: "rebel", label: "反贼胜利", playerIds: rebels.map((entry) => entry.id) };
    }
  } else if (!living.some((entry) => entry.role === "rebel" || entry.role === "renegade")) {
    const winners = state.players.filter((entry) => entry.role === "lord" || entry.role === "loyalist");
      state.winner = { side: "lord", label: "主公阵营胜利", playerIds: winners.map((entry) => entry.id) };
  }
  if (state.winner) {
    state.status = "finished";
    state.turn = null;
    state.pending = null;
    state.deadlineAt = null;
    addLog(state, `对局结束：${state.winner.label}。`, "system");
  }
}

function eliminate(state: GameState, target: GamePlayer, sourceId?: string) {
  target.alive = false;
  target.hp = 0;
  state.discard.push(...target.hand);
  target.hand = [];
  if (target.weapon) state.discard.push(target.weapon);
  target.weapon = null;
  addLog(state, `${target.name} 阵亡，身份为${roleLabel(target.role)}。`, "danger");

  const source = sourceId ? state.players.find((entry) => entry.id === sourceId) : null;
  if (source?.alive && target.role === "rebel") {
    draw(state, source, 3);
    addLog(state, `${source.name} 击破反贼，摸三张牌。`, "good");
  }
  if (source?.alive && source.role === "lord" && target.role === "loyalist") {
    state.discard.push(...source.hand);
    source.hand = [];
    if (source.weapon) state.discard.push(source.weapon);
    source.weapon = null;
    addLog(state, `${source.name} 误杀忠臣，弃置所有牌。`, "danger");
  }
  checkVictory(state);
}

function autoRescue(state: GameState, target: GamePlayer, sourceId?: string) {
  while (target.hp <= 0) {
    const peachIndex = target.hand.findIndex((card) => canUseAs(target, card, "桃"));
    if (peachIndex < 0) break;
    const [peach] = target.hand.splice(peachIndex, 1);
    state.discard.push(peach);
    target.hp += 1;
    addLog(state, `${target.name} 在濒死时使用【桃】，回复至 ${target.hp} 点体力。`, "good");
  }
  if (target.hp <= 0) eliminate(state, target, sourceId);
}

function dealDamage(
  state: GameState,
  targetId: string,
  amount: number,
  sourceId?: string,
  sourceCardId?: string,
) {
  const target = player(state, targetId);
  if (!target.alive || state.status === "finished") return;
  target.hp -= amount;
  addLog(state, `${target.name} 受到 ${amount} 点伤害，剩余 ${Math.max(0, target.hp)} 点体力。`, "danger");

  const source = sourceId ? state.players.find((entry) => entry.id === sourceId) : null;
  if (target.character.skill === "fankui" && source?.alive && source.hand.length > 0) {
    const stolen = randomHandCard(source);
    if (stolen) {
      target.hand.push(stolen);
      addLog(state, `${target.name} 发动【反馈】，获得 ${source.name} 的一张手牌。`, "normal");
    }
  }
  if (target.character.skill === "jianxiong" && sourceCardId) {
    const recovered = removeSourceCardFromDiscard(state, sourceCardId);
    if (recovered) {
      target.hand.push(recovered);
      addLog(state, `${target.name} 发动【奸雄】，获得了造成伤害的牌。`, "normal");
    }
  }
  if (target.hp <= 0) autoRescue(state, target, sourceId);
}

function beginTurn(state: GameState, target: GamePlayer) {
  const drawCount = target.character.skill === "yingzi" ? 3 : 2;
  state.turn = {
    playerId: target.id,
    phase: "play",
    shaUsed: 0,
    drunk: false,
    skillUsed: [],
    counters: {},
  };
  draw(state, target, drawCount);
  addLog(state, `轮到 ${target.name}，摸 ${drawCount} 张牌。`, "system");
}

function nextTurn(state: GameState, currentId: string) {
  if (state.status === "finished") return;
  const current = player(state, currentId);
  if (current.character.skill === "biyue" && current.alive) {
    draw(state, current, 1);
    addLog(state, `${current.name} 发动【闭月】，摸一张牌。`, "good");
  }
  const living = alivePlayers(state);
  const next = living.find((entry) => entry.seat > current.seat) ?? living[0];
  if (!next) return;
  if (next.seat <= current.seat) state.round += 1;
  beginTurn(state, next);
}

function requiredAgainst(state: GameState, opponentId: string): number {
  return player(state, opponentId).character.skill === "wushuang" ? 2 : 1;
}

function advanceAoe(state: GameState) {
  const pending = state.pending;
  if (!pending || pending.kind !== "aoe") return;
  const queue = pending.queue ?? [];
  let index = (pending.queueIndex ?? 0) + 1;
  while (index < queue.length && !player(state, queue[index]).alive) index += 1;
  if (index >= queue.length || state.status === "finished") {
    state.pending = null;
    return;
  }
  pending.queueIndex = index;
  pending.targetId = queue[index];
  pending.remaining = 1;
}

function resolveResponse(state: GameState, responder: GamePlayer, passed: boolean, card?: Card) {
  const pending = state.pending;
  if (!pending) throw new Error("当前无需响应");
  if (pending.targetId !== responder.id) throw new Error("还没有轮到你响应");

  if (!passed && card) {
    state.discard.push(card);
    addLog(state, `${responder.name} 打出【${pending.required}】。`, "good");
    pending.remaining -= 1;
    if (pending.remaining > 0) return;

    if (pending.kind === "sha") {
      addLog(state, `${responder.name} 闪过了攻击。`, "normal");
      state.pending = null;
      return;
    }
    if (pending.kind === "duel") {
      const previousResponder = pending.targetId;
      const nextResponder = pending.opponentId!;
      pending.targetId = nextResponder;
      pending.opponentId = previousResponder;
      pending.remaining = requiredAgainst(state, previousResponder);
      return;
    }
    advanceAoe(state);
    return;
  }

  addLog(state, `${responder.name} 放弃响应【${pending.required}】。`, "danger");
  if (pending.kind === "sha" || pending.kind === "duel") {
    const { targetId, damage, sourceCardId } = pending;
    const damageSourceId = pending.kind === "duel" ? pending.opponentId : pending.sourceId;
    state.pending = null;
    dealDamage(state, targetId, damage, damageSourceId, sourceCardId);
    return;
  }
  const { targetId, damage, sourceId, sourceCardId } = pending;
  dealDamage(state, targetId, damage, sourceId, sourceCardId);
  if (state.pending?.kind === "aoe") advanceAoe(state);
}

function applySkill(state: GameState, actor: GamePlayer, action: Extract<GameAction, { type: "skill" }>) {
  if (!state.turn || state.turn.playerId !== actor.id || state.pending) throw new Error("当前不能发动技能");
  const turn = state.turn;
  const ids = [...new Set(action.cardIds)];
  if (ids.some((id) => cardIndex(actor, id) < 0)) throw new Error("所选手牌已发生变化");

  if (action.skill === "zhiheng") {
    if (actor.character.skill !== "zhiheng") throw new Error("你的武将没有【制衡】");
    if (turn.skillUsed.includes("zhiheng")) throw new Error("本回合已发动过【制衡】");
    if (ids.length < 1) throw new Error("请至少选择一张牌");
    for (const id of ids) state.discard.push(takeHandCard(actor, id));
    draw(state, actor, ids.length);
    turn.skillUsed.push("zhiheng");
    addLog(state, `${actor.name} 发动【制衡】，换取 ${ids.length} 张牌。`, "good");
    return;
  }

  const target = action.targetId ? player(state, action.targetId) : null;
  if (!target?.alive) throw new Error("请选择一名存活角色");
  if (action.skill === "qingnang") {
    if (actor.character.skill !== "qingnang") throw new Error("你的武将没有【青囊】");
    if (turn.skillUsed.includes("qingnang")) throw new Error("本回合已发动过【青囊】");
    if (ids.length !== 1) throw new Error("【青囊】需弃置一张手牌");
    if (target.hp >= target.maxHp) throw new Error("目标体力已满");
    state.discard.push(takeHandCard(actor, ids[0]));
    target.hp += 1;
    turn.skillUsed.push("qingnang");
    addLog(state, `${actor.name} 发动【青囊】，令 ${target.name} 回复1点体力。`, "good");
    return;
  }
  if (action.skill === "rende") {
    if (actor.character.skill !== "rende") throw new Error("你的武将没有【仁德】");
    if (target.id === actor.id) throw new Error("不能对自己发动【仁德】");
    if (ids.length < 1) throw new Error("请至少选择一张手牌");
    for (const id of ids) target.hand.push(takeHandCard(actor, id));
    turn.counters.rende = (turn.counters.rende ?? 0) + ids.length;
    if (turn.counters.rende >= 2 && !turn.skillUsed.includes("rende-heal") && actor.hp < actor.maxHp) {
      actor.hp += 1;
      turn.skillUsed.push("rende-heal");
      addLog(state, `${actor.name} 因【仁德】回复1点体力。`, "good");
    }
    addLog(state, `${actor.name} 发动【仁德】，交给 ${target.name} ${ids.length} 张牌。`, "normal");
  }
}

function playCard(state: GameState, actor: GamePlayer, action: Extract<GameAction, { type: "playCard" }>) {
  const turn = state.turn;
  if (!turn || turn.playerId !== actor.id || state.pending) throw new Error("现在不是你的出牌时机");
  const original = actor.hand[cardIndex(actor, action.cardId)];
  if (!original) throw new Error("这张牌已不在你的手牌中");

  let effectiveName: CardName = original.name;
  if (action.as) {
    if (!canUseAs(actor, original, action.as)) throw new Error("这张牌不能如此转化");
    effectiveName = action.as;
  }
  if (effectiveName === "闪") throw new Error("【闪】只能在响应时打出");

  const needsTarget = ["杀", "过河拆桥", "顺手牵羊", "决斗"].includes(effectiveName);
  const target = action.targetId ? state.players.find((entry) => entry.id === action.targetId) : null;
  if (needsTarget) {
    const options = validTargets(state, actor, effectiveName);
    if (!target || !options.some((entry) => entry.id === target.id)) throw new Error("该目标不在有效范围内");
  }
  if (effectiveName === "桃" && actor.hp >= actor.maxHp) throw new Error("体力已满，无需使用【桃】");
  if (effectiveName === "酒" && turn.drunk) throw new Error("本回合已经使用过【酒】");
  if (effectiveName === "杀") {
    const unlimited = actor.character.skill === "paoxiao" || actor.weapon?.name === "诸葛连弩";
    if (turn.shaUsed >= 1 && !unlimited) throw new Error("本回合已使用过【杀】");
  }

  const used = takeHandCard(actor, original.id);
  state.discard.push(used);
  addLog(state, `${actor.name} 使用【${effectiveName}】${target ? `，目标是 ${target.name}` : ""}。`, "normal");

  if (effectiveName === "杀") {
    turn.shaUsed += 1;
    const damage = turn.drunk ? 2 : 1;
    turn.drunk = false;
    state.pending = {
      kind: "sha",
      sourceId: actor.id,
      targetId: target!.id,
      required: "闪",
      remaining: actor.character.skill === "wushuang" ? 2 : 1,
      sourceCardId: used.id,
      damage,
    };
  } else if (effectiveName === "桃") {
    actor.hp = Math.min(actor.maxHp, actor.hp + 1);
    addLog(state, `${actor.name} 回复1点体力。`, "good");
  } else if (effectiveName === "酒") {
    turn.drunk = true;
    addLog(state, `${actor.name} 已蓄势，下一张【杀】伤害 +1。`, "good");
  } else if (effectiveName === "无中生有") {
    draw(state, actor, 2);
    addLog(state, `${actor.name} 摸两张牌。`, "good");
  } else if (effectiveName === "过河拆桥") {
    const victim = target!;
    const removed = randomHandCard(victim) ?? victim.weapon;
    if (removed) {
      if (removed === victim.weapon) victim.weapon = null;
      state.discard.push(removed);
      addLog(state, `${victim.name} 的一张牌被弃置。`, "danger");
    }
  } else if (effectiveName === "顺手牵羊") {
    const victim = target!;
    const stolen = randomHandCard(victim) ?? victim.weapon;
    if (stolen) {
      if (stolen === victim.weapon) victim.weapon = null;
      actor.hand.push(stolen);
      addLog(state, `${actor.name} 获得 ${victim.name} 的一张牌。`, "good");
    }
  } else if (effectiveName === "决斗") {
    state.pending = {
      kind: "duel",
      sourceId: actor.id,
      targetId: target!.id,
      opponentId: actor.id,
      required: "杀",
      remaining: requiredAgainst(state, actor.id),
      sourceCardId: used.id,
      damage: 1,
    };
  } else if (effectiveName === "南蛮入侵" || effectiveName === "万箭齐发") {
    const queue = alivePlayers(state).filter((entry) => entry.id !== actor.id).map((entry) => entry.id);
    if (queue.length > 0) {
      state.pending = {
        kind: "aoe",
        sourceId: actor.id,
        targetId: queue[0],
        required: effectiveName === "南蛮入侵" ? "杀" : "闪",
        remaining: 1,
        sourceCardId: used.id,
        damage: 1,
        queue,
        queueIndex: 0,
      };
    }
  } else if (effectiveName === "桃园结义") {
    for (const entry of alivePlayers(state)) entry.hp = Math.min(entry.maxHp, entry.hp + 1);
    addLog(state, "所有存活角色各回复1点体力。", "good");
  } else if (used.category === "equip") {
    removeSourceCardFromDiscard(state, used.id);
    if (actor.weapon) state.discard.push(actor.weapon);
    actor.weapon = used;
    addLog(state, `${actor.name} 装备了【${used.name}】。`, "good");
  }

  if (used.category === "trick" && actor.character.skill === "jizhi" && actor.alive) {
    draw(state, actor, 1);
    addLog(state, `${actor.name} 发动【集智】，摸一张牌。`, "good");
  }
}

export function createGame(seats: LobbySeat[]): GameState {
  if (seats.length < 2 || seats.length > 8) throw new Error("身份局需要 2–8 名玩家");
  const roles = shuffle(ROLE_MAP[seats.length]);
  const characters = shuffle(CHARACTERS).slice(0, seats.length);
  const deck = makeDeck();
  const players: GamePlayer[] = seats.map((seat, index) => {
    const role = roles[index];
    const character = characters[index];
    const maxHp = character.maxHp + (role === "lord" ? 1 : 0);
    return {
      ...seat,
      role,
      character,
      hp: maxHp,
      maxHp,
      alive: true,
      hand: [],
      weapon: null,
    };
  });
  const state: GameState = {
    engineVersion: 1,
    status: "playing",
    players,
    deck,
    discard: [],
    round: 1,
    turn: null,
    pending: null,
    winner: null,
    deadlineAt: null,
    logSeq: 0,
    logs: [],
  };
  for (const entry of players) draw(state, entry, 4);
  const lord = players.find((entry) => entry.role === "lord")!;
  addLog(state, `身份局开始，${lord.name} 是主公，武将为 ${lord.character.name}。`, "system");
  beginTurn(state, lord);
  stampDeadline(state);
  return state;
}

export function applyGameAction(state: GameState, actorId: string, action: GameAction): GameState {
  if (state.status !== "playing") throw new Error("对局已经结束");
  const next = structuredClone(state);
  const actor = player(next, actorId);
  if (!actor.alive) throw new Error("已阵亡角色不能行动");

  if (action.type === "respond") {
    const pending = next.pending;
    if (!pending || pending.targetId !== actor.id) throw new Error("当前无需你响应");
    const card = actor.hand[cardIndex(actor, action.cardId)];
    if (!card || !canUseAs(actor, card, pending.required)) throw new Error(`请选择可当作【${pending.required}】的牌`);
    resolveResponse(next, actor, false, takeHandCard(actor, card.id));
    if (!next.pending && next.turn && !player(next, next.turn.playerId).alive) {
      nextTurn(next, next.turn.playerId);
    }
    stampDeadline(next);
    return next;
  }
  if (action.type === "pass") {
    resolveResponse(next, actor, true);
    if (!next.pending && next.turn && !player(next, next.turn.playerId).alive) {
      nextTurn(next, next.turn.playerId);
    }
    stampDeadline(next);
    return next;
  }
  if (next.pending) throw new Error(`正在等待 ${player(next, next.pending.targetId).name} 响应`);
  if (!next.turn || next.turn.playerId !== actor.id) throw new Error("现在不是你的回合");

  if (action.type === "playCard") playCard(next, actor, action);
  else if (action.type === "skill") applySkill(next, actor, action);
  else if (action.type === "discard") {
    const ids = [...new Set(action.cardIds)];
    const excess = Math.max(0, actor.hand.length - Math.max(0, actor.hp));
    if (excess <= 0) throw new Error("当前无需弃牌");
    if (ids.length < 1) throw new Error("请选择要弃置的牌");
    if (ids.some((id) => cardIndex(actor, id) < 0)) throw new Error("所选手牌已发生变化");
    if (ids.length > excess && excess > 0) throw new Error(`当前只需弃置 ${excess} 张牌`);
    for (const id of ids) next.discard.push(takeHandCard(actor, id));
    addLog(next, `${actor.name} 弃置 ${ids.length} 张手牌。`, "normal");
  } else if (action.type === "endTurn") {
    const excess = actor.hand.length - Math.max(0, actor.hp);
    if (excess > 0) throw new Error(`手牌超过体力上限，请先弃置 ${excess} 张牌`);
    addLog(next, `${actor.name} 结束回合。`, "system");
    nextTurn(next, actor.id);
  }
  stampDeadline(next);
  return next;
}

export function applyTimeout(state: GameState): GameState {
  if (state.status !== "playing") throw new Error("对局已经结束");
  if (!state.deadlineAt || Date.now() < new Date(state.deadlineAt).getTime()) {
    throw new Error("当前决策尚未超时");
  }
  const actorId = state.pending?.targetId ?? state.turn?.playerId;
  if (!actorId) throw new Error("当前没有等待中的决策");
  const prepared = structuredClone(state);
  addLog(prepared, `${player(prepared, actorId).name} 行动超时，系统执行默认动作。`, "system");
  if (prepared.pending) return applyGameAction(prepared, actorId, { type: "pass" });
  const discard = getLegalActions(prepared, actorId).find((entry) => entry.kind === "discard");
  if (discard) {
    return applyGameAction(prepared, actorId, {
      type: "discard",
      cardIds: discard.candidateCardIds!.slice(0, discard.minCards),
    });
  }
  return applyGameAction(prepared, actorId, { type: "endTurn" });
}

function exact(id: string, label: string, action: GameAction, description?: string): LegalAction {
  return { id, kind: "exact", label, action, description };
}

function transformedNames(owner: GamePlayer, card: Card): Array<{ name: CardName; as?: "杀" | "桃" }> {
  const results: Array<{ name: CardName; as?: "杀" | "桃" }> = [{ name: card.name }];
  if (card.name !== "杀" && canUseAs(owner, card, "杀")) results.push({ name: "杀", as: "杀" });
  if (card.name !== "桃" && canUseAs(owner, card, "桃")) results.push({ name: "桃", as: "桃" });
  return results;
}

export function getLegalActions(state: GameState, actorId: string): LegalAction[] {
  if (state.status !== "playing") return [];
  const actor = state.players.find((entry) => entry.id === actorId);
  if (!actor?.alive) return [];
  if (state.pending) {
    if (state.pending.targetId !== actor.id) return [];
    const responses = actor.hand
      .filter((card) => canUseAs(actor, card, state.pending!.required))
      .map((card) =>
        exact(
          `respond:${card.id}`,
          `打出${card.name === state.pending!.required ? "" : `${card.name}当`}【${state.pending!.required}】`,
          { type: "respond", cardId: card.id },
        ),
      );
    responses.push(exact("pass", "放弃响应", { type: "pass" }));
    return responses;
  }
  if (!state.turn || state.turn.playerId !== actor.id) return [];

  const actions: LegalAction[] = [];
  for (const card of actor.hand) {
    for (const option of transformedNames(actor, card)) {
      const name = option.name;
      if (name === "闪") continue;
      if (name === "桃" && actor.hp >= actor.maxHp) continue;
      if (name === "酒" && state.turn.drunk) continue;
      if (name === "杀") {
        const unlimited = actor.character.skill === "paoxiao" || actor.weapon?.name === "诸葛连弩";
        if (state.turn.shaUsed >= 1 && !unlimited) continue;
      }
      const targets = validTargets(state, actor, name);
      if (["杀", "过河拆桥", "顺手牵羊", "决斗"].includes(name)) {
        for (const target of targets) {
          actions.push(
            exact(
              `play:${card.id}:${option.as ?? card.name}:${target.id}`,
              `对 ${target.name} 使用【${name}】`,
              { type: "playCard", cardId: card.id, targetId: target.id, as: option.as },
            ),
          );
        }
      } else if (name !== "闪") {
        actions.push(
          exact(`play:${card.id}:${option.as ?? card.name}`, `使用【${name}】`, {
            type: "playCard",
            cardId: card.id,
            as: option.as,
          }),
        );
      }
    }
  }

  const excess = Math.max(0, actor.hand.length - Math.max(0, actor.hp));
  if (excess > 0) {
    actions.push({
      id: "discard",
      kind: "discard",
      label: `弃置 ${excess} 张牌`,
      candidateCardIds: actor.hand.map((card) => card.id),
      minCards: excess,
      maxCards: excess,
    });
  }

  if (actor.character.skill === "zhiheng" && !state.turn.skillUsed.includes("zhiheng") && actor.hand.length > 0) {
    actions.push({
      id: "skill:zhiheng",
      kind: "skill",
      skill: "zhiheng",
      label: "制衡",
      description: "选择任意张手牌，弃置并摸等量的牌。",
      candidateCardIds: actor.hand.map((card) => card.id),
      minCards: 1,
      maxCards: actor.hand.length,
    });
  }
  if (actor.character.skill === "qingnang" && !state.turn.skillUsed.includes("qingnang") && actor.hand.length > 0) {
    const targets = alivePlayers(state).filter((entry) => entry.hp < entry.maxHp).map((entry) => entry.id);
    if (targets.length > 0) {
      actions.push({
        id: "skill:qingnang",
        kind: "skill",
        skill: "qingnang",
        label: "青囊",
        description: "弃一张手牌，令一名受伤角色回复1点体力。",
        candidateCardIds: actor.hand.map((card) => card.id),
        minCards: 1,
        maxCards: 1,
        targetIds: targets,
      });
    }
  }
  if (actor.character.skill === "rende" && actor.hand.length > 0) {
    actions.push({
      id: "skill:rende",
      kind: "skill",
      skill: "rende",
      label: "仁德",
      description: "选择手牌交给另一名角色。",
      candidateCardIds: actor.hand.map((card) => card.id),
      minCards: 1,
      maxCards: actor.hand.length,
      targetIds: alivePlayers(state).filter((entry) => entry.id !== actor.id).map((entry) => entry.id),
    });
  }
  if (excess === 0) actions.push(exact("end", "结束回合", { type: "endTurn" }));
  return actions;
}

export function roleName(role: Role) {
  return roleLabel(role);
}

export function kingdomName(kingdom: Kingdom) {
  return { wei: "魏", shu: "蜀", wu: "吴", qun: "群" }[kingdom];
}
