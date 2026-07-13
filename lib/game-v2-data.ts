export type PlayerKind = "human" | "agent";
export type Role = "lord" | "loyalist" | "rebel" | "renegade";
export type Kingdom = "wei" | "shu" | "wu" | "qun";
export type Suit = "spade" | "heart" | "club" | "diamond";
export type CardColor = "red" | "black";
export type CardCategory = "basic" | "trick" | "delayed" | "equip";
export type EquipmentSlot = "weapon" | "armor" | "offensiveHorse" | "defensiveHorse";

export type StandardCardName =
  | "杀"
  | "闪"
  | "桃"
  | "无中生有"
  | "过河拆桥"
  | "顺手牵羊"
  | "决斗"
  | "南蛮入侵"
  | "万箭齐发"
  | "桃园结义"
  | "五谷丰登"
  | "借刀杀人"
  | "无懈可击"
  | "乐不思蜀"
  | "闪电"
  | "诸葛连弩"
  | "雌雄双股剑"
  | "青釭剑"
  | "青龙偃月刀"
  | "丈八蛇矛"
  | "贯石斧"
  | "方天画戟"
  | "麒麟弓"
  | "寒冰剑"
  | "八卦阵"
  | "仁王盾"
  | "赤兔"
  | "大宛"
  | "紫骍"
  | "绝影"
  | "的卢"
  | "爪黄飞电";

// 【酒】只为 engine v1 的旧房间与旧牌面说明保留；经典标准新牌堆不会生成它。
export type CardName = StandardCardName | "酒";

export interface Card {
  id: string;
  name: CardName;
  suit: Suit;
  rank: string;
  color: CardColor;
  category: CardCategory;
  slot?: EquipmentSlot;
  asName?: StandardCardName;
}

export interface LobbySeat {
  id: string;
  name: string;
  kind: PlayerKind;
  seat: number;
}

export type SkillId =
  | "jianxiong"
  | "hujia"
  | "fankui"
  | "guicai"
  | "ganglie"
  | "tuxi"
  | "luoyi"
  | "tiandu"
  | "yiji"
  | "qingguo"
  | "luoshen"
  | "rende"
  | "jijiang"
  | "wusheng"
  | "paoxiao"
  | "guanxing"
  | "kongcheng"
  | "longdan"
  | "mashu"
  | "tieqi"
  | "jizhi"
  | "qicai"
  | "zhiheng"
  | "jiuyuan"
  | "qixi"
  | "keji"
  | "kurou"
  | "yingzi"
  | "fanjian"
  | "guose"
  | "liuli"
  | "qianxun"
  | "lianying"
  | "jieyin"
  | "xiaoji"
  | "jijiu"
  | "qingnang"
  | "wushuang"
  | "lijian"
  | "biyue";

export interface SkillDefinition {
  id: SkillId;
  name: string;
  text: string;
  kind: "normal" | "locked" | "lord";
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  jianxiong: { id: "jianxiong", name: "奸雄", kind: "normal", text: "受到伤害后，可以获得对你造成伤害的牌。" },
  hujia: { id: "hujia", name: "护驾", kind: "lord", text: "需要使用或打出【闪】时，可令其他魏势力角色依次选择是否代为打出。" },
  fankui: { id: "fankui", name: "反馈", kind: "normal", text: "受到有来源的伤害后，可以获得伤害来源的一张牌。" },
  guicai: { id: "guicai", name: "鬼才", kind: "normal", text: "一名角色的判定牌生效前，可以打出一张手牌代替之。" },
  ganglie: { id: "ganglie", name: "刚烈", kind: "normal", text: "受到伤害后，可以判定；若结果不为红桃，伤害来源弃两张手牌或失去1点体力。" },
  tuxi: { id: "tuxi", name: "突袭", kind: "normal", text: "摸牌阶段可以放弃从牌堆摸牌，改为从至多两名有手牌的其他角色处各获得一张随机手牌。" },
  luoyi: { id: "luoyi", name: "裸衣", kind: "normal", text: "摸牌阶段可以少摸一张；本回合使用【杀】或【决斗】造成的伤害+1。" },
  tiandu: { id: "tiandu", name: "天妒", kind: "normal", text: "判定牌生效后，可以获得此判定牌。" },
  yiji: { id: "yiji", name: "遗计", kind: "normal", text: "每受到1点伤害后，可以观看牌堆顶两张牌并将其任意分配给角色。" },
  qingguo: { id: "qingguo", name: "倾国", kind: "normal", text: "可以将一张黑色手牌当【闪】使用或打出。" },
  luoshen: { id: "luoshen", name: "洛神", kind: "normal", text: "准备阶段可以连续判定；黑色结果归你并可继续，红色结果终止。" },
  rende: { id: "rende", name: "仁德", kind: "normal", text: "出牌阶段可将任意张手牌交给其他角色；本阶段首次累计给出至少两张时回复1点体力。" },
  jijiang: { id: "jijiang", name: "激将", kind: "lord", text: "需要使用或打出【杀】时，可令其他蜀势力角色依次选择是否代为打出。" },
  wusheng: { id: "wusheng", name: "武圣", kind: "normal", text: "可以将一张红色牌当【杀】使用或打出。" },
  paoxiao: { id: "paoxiao", name: "咆哮", kind: "normal", text: "出牌阶段使用【杀】无次数限制。" },
  guanxing: { id: "guanxing", name: "观星", kind: "normal", text: "准备阶段可以观看牌堆顶X张牌并以任意顺序置于牌堆顶或牌堆底，X为存活角色数且至多为5。" },
  kongcheng: { id: "kongcheng", name: "空城", kind: "locked", text: "没有手牌时，不能成为【杀】或【决斗】的目标。" },
  longdan: { id: "longdan", name: "龙胆", kind: "normal", text: "可以将【杀】当【闪】、【闪】当【杀】使用或打出。" },
  mashu: { id: "mashu", name: "马术", kind: "locked", text: "计算与其他角色的距离时始终-1。" },
  tieqi: { id: "tieqi", name: "铁骑", kind: "normal", text: "使用【杀】指定目标后可以判定；若为红色，该目标不能使用【闪】响应此【杀】。" },
  jizhi: { id: "jizhi", name: "集智", kind: "normal", text: "使用非延时锦囊牌时，可以摸一张牌。" },
  qicai: { id: "qicai", name: "奇才", kind: "locked", text: "使用锦囊牌无距离限制。" },
  zhiheng: { id: "zhiheng", name: "制衡", kind: "normal", text: "出牌阶段限一次，可以弃置任意张牌并摸等量的牌。" },
  jiuyuan: { id: "jiuyuan", name: "救援", kind: "lord", text: "濒死时，其他吴势力角色对你使用【桃】时额外回复1点体力。" },
  qixi: { id: "qixi", name: "奇袭", kind: "normal", text: "可以将一张黑色牌当【过河拆桥】使用。" },
  keji: { id: "keji", name: "克己", kind: "normal", text: "若出牌阶段没有使用或打出过【杀】，可以跳过弃牌阶段。" },
  kurou: { id: "kurou", name: "苦肉", kind: "normal", text: "出牌阶段可以失去1点体力并摸两张牌。" },
  yingzi: { id: "yingzi", name: "英姿", kind: "normal", text: "摸牌阶段可以额外摸一张牌。" },
  fanjian: { id: "fanjian", name: "反间", kind: "normal", text: "出牌阶段限一次，令一名其他角色声明花色并获得你的一张随机手牌；花色不符则其受到1点伤害。" },
  guose: { id: "guose", name: "国色", kind: "normal", text: "可以将一张方块牌当【乐不思蜀】使用。" },
  liuli: { id: "liuli", name: "流离", kind: "normal", text: "成为【杀】的目标时，可以弃置一张牌，将目标转移给攻击范围内另一名合法角色。" },
  qianxun: { id: "qianxun", name: "谦逊", kind: "locked", text: "不能成为【顺手牵羊】或【乐不思蜀】的目标。" },
  lianying: { id: "lianying", name: "连营", kind: "normal", text: "失去最后一张手牌后，可以摸一张牌。" },
  jieyin: { id: "jieyin", name: "结姻", kind: "normal", text: "出牌阶段限一次，可以弃置两张手牌，令你与一名受伤的男性角色各回复1点体力。" },
  xiaoji: { id: "xiaoji", name: "枭姬", kind: "normal", text: "装备区里的一张牌失去后，可以摸两张牌。" },
  jijiu: { id: "jijiu", name: "急救", kind: "normal", text: "自己的回合外，可以将一张红色牌当【桃】使用。" },
  qingnang: { id: "qingnang", name: "青囊", kind: "normal", text: "出牌阶段限一次，可以弃置一张手牌令一名受伤角色回复1点体力。" },
  wushuang: { id: "wushuang", name: "无双", kind: "locked", text: "使用【杀】需目标连续使用两张【闪】；【决斗】中对方每轮需连续打出两张【杀】。" },
  lijian: { id: "lijian", name: "离间", kind: "normal", text: "出牌阶段限一次，可以弃置一张牌，令一名男性角色视为对另一名男性角色使用不可被【无懈可击】响应的【决斗】。" },
  biyue: { id: "biyue", name: "闭月", kind: "normal", text: "结束阶段可以摸一张牌。" },
};

export interface Character {
  id: string;
  name: string;
  title: string;
  kingdom: Kingdom;
  gender: "male" | "female";
  maxHp: number;
  skills: SkillId[];
  skill: SkillId;
  skillName: string;
  skillText: string;
}

function character(
  id: string,
  name: string,
  title: string,
  kingdom: Kingdom,
  gender: "male" | "female",
  maxHp: number,
  skills: SkillId[],
): Character {
  return {
    id,
    name,
    title,
    kingdom,
    gender,
    maxHp,
    skills,
    skill: skills[0],
    skillName: skills.map((skill) => SKILLS[skill].name).join(" · "),
    skillText: skills.map((skill) => `【${SKILLS[skill].name}】${SKILLS[skill].text}`).join(" "),
  };
}

export const STANDARD_CHARACTERS: Character[] = [
  character("caocao", "曹操", "魏武帝", "wei", "male", 4, ["jianxiong", "hujia"]),
  character("simayi", "司马懿", "狼顾之鬼", "wei", "male", 3, ["fankui", "guicai"]),
  character("xiahoudun", "夏侯惇", "独眼的罗刹", "wei", "male", 4, ["ganglie"]),
  character("zhangliao", "张辽", "前将军", "wei", "male", 4, ["tuxi"]),
  character("xuchu", "许褚", "虎痴", "wei", "male", 4, ["luoyi"]),
  character("guojia", "郭嘉", "早终的先知", "wei", "male", 3, ["tiandu", "yiji"]),
  character("zhenji", "甄姬", "薄幸的美人", "wei", "female", 3, ["qingguo", "luoshen"]),
  character("liubei", "刘备", "乱世的枭雄", "shu", "male", 4, ["rende", "jijiang"]),
  character("guanyu", "关羽", "美髯公", "shu", "male", 4, ["wusheng"]),
  character("zhangfei", "张飞", "万夫不当", "shu", "male", 4, ["paoxiao"]),
  character("zhugeliang", "诸葛亮", "迟暮的丞相", "shu", "male", 3, ["guanxing", "kongcheng"]),
  character("zhaoyun", "赵云", "少年将军", "shu", "male", 4, ["longdan"]),
  character("machao", "马超", "一骑当千", "shu", "male", 4, ["mashu", "tieqi"]),
  character("huangyueying", "黄月英", "归隐的杰女", "shu", "female", 3, ["jizhi", "qicai"]),
  character("sunquan", "孙权", "年轻的贤君", "wu", "male", 4, ["zhiheng", "jiuyuan"]),
  character("ganning", "甘宁", "锦帆游侠", "wu", "male", 4, ["qixi"]),
  character("lvmeng", "吕蒙", "白衣渡江", "wu", "male", 4, ["keji"]),
  character("huanggai", "黄盖", "轻身为国", "wu", "male", 4, ["kurou"]),
  character("zhouyu", "周瑜", "大都督", "wu", "male", 3, ["yingzi", "fanjian"]),
  character("daqiao", "大乔", "矜持之花", "wu", "female", 3, ["guose", "liuli"]),
  character("luxun", "陆逊", "儒生雄才", "wu", "male", 3, ["qianxun", "lianying"]),
  character("sunshangxiang", "孙尚香", "弓腰姬", "wu", "female", 3, ["jieyin", "xiaoji"]),
  character("huatuo", "华佗", "神医", "qun", "male", 3, ["jijiu", "qingnang"]),
  character("lvbu", "吕布", "武的化身", "qun", "male", 4, ["wushuang"]),
  character("diaochan", "貂蝉", "绝世的舞姬", "qun", "female", 3, ["lijian", "biyue"]),
];

export const ROLE_MAP: Record<number, Role[]> = {
  2: ["lord", "renegade"],
  4: ["lord", "loyalist", "rebel", "renegade"],
  5: ["lord", "loyalist", "rebel", "rebel", "renegade"],
  6: ["lord", "loyalist", "rebel", "rebel", "rebel", "renegade"],
  7: ["lord", "loyalist", "loyalist", "rebel", "rebel", "rebel", "renegade"],
  8: ["lord", "loyalist", "loyalist", "rebel", "rebel", "rebel", "rebel", "renegade"],
  9: ["lord", "loyalist", "loyalist", "loyalist", "rebel", "rebel", "rebel", "rebel", "renegade"],
  10: ["lord", "loyalist", "loyalist", "loyalist", "rebel", "rebel", "rebel", "rebel", "renegade", "renegade"],
};

export interface CardMetadata {
  category: CardCategory;
  slot?: EquipmentSlot;
  attackRange?: number;
}

export const CARD_METADATA: Record<StandardCardName, CardMetadata> = {
  杀: { category: "basic" }, 闪: { category: "basic" }, 桃: { category: "basic" },
  无中生有: { category: "trick" }, 过河拆桥: { category: "trick" }, 顺手牵羊: { category: "trick" },
  决斗: { category: "trick" }, 南蛮入侵: { category: "trick" }, 万箭齐发: { category: "trick" },
  桃园结义: { category: "trick" }, 五谷丰登: { category: "trick" }, 借刀杀人: { category: "trick" },
  无懈可击: { category: "trick" }, 乐不思蜀: { category: "delayed" }, 闪电: { category: "delayed" },
  诸葛连弩: { category: "equip", slot: "weapon", attackRange: 1 },
  雌雄双股剑: { category: "equip", slot: "weapon", attackRange: 2 },
  青釭剑: { category: "equip", slot: "weapon", attackRange: 2 },
  青龙偃月刀: { category: "equip", slot: "weapon", attackRange: 3 },
  丈八蛇矛: { category: "equip", slot: "weapon", attackRange: 3 },
  贯石斧: { category: "equip", slot: "weapon", attackRange: 3 },
  方天画戟: { category: "equip", slot: "weapon", attackRange: 4 },
  麒麟弓: { category: "equip", slot: "weapon", attackRange: 5 },
  寒冰剑: { category: "equip", slot: "weapon", attackRange: 2 },
  八卦阵: { category: "equip", slot: "armor" }, 仁王盾: { category: "equip", slot: "armor" },
  赤兔: { category: "equip", slot: "offensiveHorse" }, 大宛: { category: "equip", slot: "offensiveHorse" },
  紫骍: { category: "equip", slot: "offensiveHorse" }, 绝影: { category: "equip", slot: "defensiveHorse" },
  的卢: { category: "equip", slot: "defensiveHorse" }, 爪黄飞电: { category: "equip", slot: "defensiveHorse" },
};

export interface CardBlueprint {
  name: StandardCardName;
  suit: Suit;
  rank: string;
}

const cell = (suit: Suit, rank: string, ...names: StandardCardName[]): CardBlueprint[] =>
  names.map((name) => ({ name, suit, rank }));

export const STANDARD_DECK: CardBlueprint[] = [
  ...cell("spade", "A", "闪电", "决斗"),
  ...cell("spade", "2", "八卦阵", "雌雄双股剑", "寒冰剑"),
  ...cell("spade", "3", "过河拆桥", "顺手牵羊"),
  ...cell("spade", "4", "过河拆桥", "顺手牵羊"),
  ...cell("spade", "5", "青龙偃月刀", "绝影"),
  ...cell("spade", "6", "乐不思蜀", "青釭剑"),
  ...cell("spade", "7", "南蛮入侵", "杀"),
  ...cell("spade", "8", "杀", "杀"),
  ...cell("spade", "9", "杀", "杀"),
  ...cell("spade", "10", "杀", "杀"),
  ...cell("spade", "J", "无懈可击", "顺手牵羊"),
  ...cell("spade", "Q", "丈八蛇矛", "过河拆桥"),
  ...cell("spade", "K", "大宛", "南蛮入侵"),

  ...cell("club", "A", "诸葛连弩", "决斗"),
  ...cell("club", "2", "八卦阵", "杀", "仁王盾"),
  ...cell("club", "3", "过河拆桥", "杀"),
  ...cell("club", "4", "过河拆桥", "杀"),
  ...cell("club", "5", "的卢", "杀"),
  ...cell("club", "6", "乐不思蜀", "杀"),
  ...cell("club", "7", "南蛮入侵", "杀"),
  ...cell("club", "8", "杀", "杀"),
  ...cell("club", "9", "杀", "杀"),
  ...cell("club", "10", "杀", "杀"),
  ...cell("club", "J", "杀", "杀"),
  ...cell("club", "Q", "借刀杀人", "无懈可击"),
  ...cell("club", "K", "借刀杀人", "无懈可击"),

  ...cell("heart", "A", "桃园结义", "万箭齐发"),
  ...cell("heart", "2", "闪", "闪"),
  ...cell("heart", "3", "桃", "五谷丰登"),
  ...cell("heart", "4", "桃", "五谷丰登"),
  ...cell("heart", "5", "麒麟弓", "赤兔"),
  ...cell("heart", "6", "桃", "乐不思蜀"),
  ...cell("heart", "7", "桃", "无中生有"),
  ...cell("heart", "8", "桃", "无中生有"),
  ...cell("heart", "9", "桃", "无中生有"),
  ...cell("heart", "10", "杀", "杀"),
  ...cell("heart", "J", "杀", "无中生有"),
  ...cell("heart", "Q", "桃", "过河拆桥", "闪电"),
  ...cell("heart", "K", "爪黄飞电", "闪"),

  ...cell("diamond", "A", "诸葛连弩", "决斗"),
  ...cell("diamond", "2", "闪", "闪"),
  ...cell("diamond", "3", "闪", "顺手牵羊"),
  ...cell("diamond", "4", "闪", "顺手牵羊"),
  ...cell("diamond", "5", "闪", "贯石斧"),
  ...cell("diamond", "6", "闪", "杀"),
  ...cell("diamond", "7", "闪", "杀"),
  ...cell("diamond", "8", "闪", "杀"),
  ...cell("diamond", "9", "闪", "杀"),
  ...cell("diamond", "10", "闪", "杀"),
  ...cell("diamond", "J", "闪", "闪"),
  ...cell("diamond", "Q", "桃", "方天画戟", "无懈可击"),
  ...cell("diamond", "K", "杀", "紫骍"),
];

export const STANDARD_CARD_NAMES = Object.keys(CARD_METADATA) as StandardCardName[];

export function cardColor(suit: Suit): CardColor {
  return suit === "heart" || suit === "diamond" ? "red" : "black";
}

export function roleName(role: Role) {
  return { lord: "主公", loyalist: "忠臣", rebel: "反贼", renegade: "内奸" }[role];
}

export function kingdomName(kingdom: Kingdom) {
  return { wei: "魏", shu: "蜀", wu: "吴", qun: "群" }[kingdom];
}
