import type { CardName } from "./game";

export interface CardGuide {
  name: CardName;
  image: string;
  category: "基本牌" | "普通锦囊" | "延时锦囊" | "武器牌" | "防具牌" | "坐骑牌";
  subtitle: string;
  timing: string;
  target: string;
  effect: string;
  response: string;
  limits: string[];
  rulesNote?: string;
}

const weapon = (
  name: CardName,
  image: string,
  range: number,
  effect: string,
  limits: string[] = [],
): CardGuide => ({
  name,
  image,
  category: "武器牌",
  subtitle: `攻击范围 ${range} · ${effect.split("；")[0]}`,
  timing: "自己的出牌阶段装备",
  target: "自己的武器栏",
  effect: `装备后攻击范围为 ${range}。${effect}`,
  response: "装备动作不开启无懈窗口；其后的【杀】按正常响应链结算。",
  limits: ["同一时间只能有一件武器，替换时旧武器进入弃牌堆", ...limits],
});

const horse = (name: CardName, image: string, direction: "offense" | "defense"): CardGuide => ({
  name,
  image,
  category: "坐骑牌",
  subtitle: direction === "offense" ? "进攻坐骑 · 你到别人的距离 -1" : "防御坐骑 · 别人到你的距离 +1",
  timing: "自己的出牌阶段装备",
  target: direction === "offense" ? "自己的进攻坐骑栏" : "自己的防御坐骑栏",
  effect: direction === "offense" ? "计算你到其他角色的距离时 -1，最低仍为 1。" : "其他角色计算到你的距离时 +1。",
  response: "装备动作无需响应；距离修正会立即影响之后的目标合法性。",
  limits: [direction === "offense" ? "与防御坐骑可同时存在" : "与进攻坐骑可同时存在", "同类坐骑替换时，旧牌进入弃牌堆"],
});

export const CARD_GUIDES: Record<CardName, CardGuide> = {
  杀: {
    name: "杀", image: "/card-art/sha.webp", category: "基本牌", subtitle: "攻击牌 · 迫使目标使用【闪】",
    timing: "自己的出牌阶段，或服务器要求打出【杀】时", target: "攻击范围内的一名其他角色",
    effect: "目标未完成有效【闪】响应时，受到 1 点普通伤害。",
    response: "目标使用一张【闪】；【无双】会把需求提高为连续两张。铁骑红色判定时不能响应。",
    limits: ["出牌阶段通常限一张", "【咆哮】或【诸葛连弩】解除次数限制", "空手的诸葛亮不能成为新的【杀】目标"],
    rulesNote: "武圣、龙胆、激将和丈八蛇矛都可生成【杀】，但仍受当前目标与次数规则约束。",
  },
  闪: {
    name: "闪", image: "/card-art/shan.webp", category: "基本牌", subtitle: "防御牌 · 抵消【杀】或【万箭齐发】",
    timing: "服务器要求响应【闪】时", target: "自己",
    effect: "完成一次【闪】响应，抵消当前的一次攻击要求。", response: "响应牌本身不会再产生普通响应。",
    limits: ["不能在出牌阶段主动使用", "倾国可以黑色手牌、龙胆可以【杀】转化响应"],
  },
  桃: {
    name: "桃", image: "/card-art/tao.webp", category: "基本牌", subtitle: "恢复牌 · 治疗或濒死求援",
    timing: "自己出牌阶段且已受伤，或任意角色濒死求【桃】时", target: "出牌阶段只能对自己；濒死时对当前濒死角色",
    effect: "回复 1 点体力，不超过上限。濒死时按座次依次询问，直到体力至少为 1 或全员放弃。", response: "不开启无懈窗口。",
    limits: ["满体力时不能在出牌阶段使用", "救援主公孙权时，其他吴势力角色的【桃】额外回复 1 点"],
    rulesNote: "华佗在自己回合外可以红色手牌或装备牌发动【急救】当【桃】。",
  },
  酒: {
    name: "酒", image: "/card-art/jiu.webp", category: "基本牌", subtitle: "旧房间兼容牌 · 当前规则集不使用",
    timing: "仅谋局核心规则 v1 旧房间", target: "自己", effect: "经典标准 108 张牌堆中不包含【酒】。", response: "当前规则无此响应窗口。",
    limits: ["新建的经典标准房间不会抽到此牌", "不能作为濒死自救牌"], rulesNote: "保留该说明只是为了旧对局与旧卡面兼容。",
  },
  无中生有: {
    name: "无中生有", image: "/card-art/wuzhong.webp", category: "普通锦囊", subtitle: "单目标锦囊 · 摸两张牌", timing: "自己的出牌阶段", target: "自己",
    effect: "结算后摸两张牌。", response: "任意存活角色可对此效果使用【无懈可击】。",
    limits: ["无距离限制", "被无懈时不摸牌"], rulesNote: "黄月英使用时可先发动【集智】摸一张，不因之后被无懈而撤销。",
  },
  过河拆桥: {
    name: "过河拆桥", image: "/card-art/guohe.webp", category: "普通锦囊", subtitle: "拆解资源 · 弃置目标一张牌", timing: "自己的出牌阶段", target: "拥有手牌、装备或判定牌的一名其他角色",
    effect: "选择目标的手牌区、一张明置装备或一张判定牌弃置。选手牌区时由服务器确定一张隐藏手牌。", response: "任意角色可通过无懈链抵消对当前目标的效果。",
    limits: ["无距离限制", "不泄露目标的隐藏手牌 ID"],
  },
  顺手牵羊: {
    name: "顺手牵羊", image: "/card-art/shunshou.webp", category: "普通锦囊", subtitle: "获取资源 · 拿走近邻目标一张牌", timing: "自己的出牌阶段", target: "距离 1 且有牌的一名其他角色",
    effect: "从目标的手牌、装备或判定区获得一张牌；隐藏手牌由服务器确定。", response: "可通过无懈链抵消当前目标的效果。",
    limits: ["普通情况下目标距离必须为 1", "【奇才】可忽略距离", "不能指定有【谦逊】的陆逊"],
  },
  决斗: {
    name: "决斗", image: "/card-art/juedou.webp", category: "普通锦囊", subtitle: "交替出杀 · 首个无法响应者受伤", timing: "自己的出牌阶段", target: "一名其他角色，无距离限制",
    effect: "由目标开始，双方交替打出【杀】；首个放弃或无法完成响应的一方受到对方造成的 1 点伤害。", response: "目标效果可被【无懈可击】抵消；进入决斗后只打出【杀】。",
    limits: ["空手诸葛亮不能成为目标", "与吕布决斗时，对方每轮需连续打出两张【杀】", "【离间】生成的虚拟决斗不能被无懈"],
  },
  南蛮入侵: {
    name: "南蛮入侵", image: "/card-art/nanman.webp", category: "普通锦囊", subtitle: "群体锦囊 · 其他角色各打出【杀】", timing: "自己的出牌阶段", target: "除使用者外的所有存活角色",
    effect: "从使用者下家起依次结算；未打出【杀】者受到使用者造成的 1 点伤害。", response: "每个目标先单独开启无懈链；未被抵消者再打出【杀】。",
    limits: ["不包含使用者", "多目标按行动顺序逐一结算"],
  },
  万箭齐发: {
    name: "万箭齐发", image: "/card-art/wanjian.webp", category: "普通锦囊", subtitle: "群体锦囊 · 其他角色各打出【闪】", timing: "自己的出牌阶段", target: "除使用者外的所有存活角色",
    effect: "从使用者下家起依次结算；未打出【闪】者受到使用者造成的 1 点伤害。", response: "每个目标先单独开启无懈链；未被抵消者再打出【闪】。",
    limits: ["不包含使用者", "八卦阵与倾国可在【闪】窗口生效"],
  },
  桃园结义: {
    name: "桃园结义", image: "/card-art/taoyuan.webp", category: "普通锦囊", subtitle: "全体回复 · 每名受伤角色回复一点", timing: "自己的出牌阶段", target: "所有存活角色，包括自己",
    effect: "从使用者开始按行动顺序，每名已受伤目标回复 1 点体力。", response: "对每个目标单独开启无懈链；只抵消当前目标的回复。",
    limits: ["不超过体力上限", "不能复活已阵亡角色"],
  },
  五谷丰登: {
    name: "五谷丰登", image: "/card-art/wugu.webp", category: "普通锦囊", subtitle: "公开选牌 · 按座次分配等同存活人数的牌", timing: "自己的出牌阶段", target: "所有存活角色",
    effect: "亮出等同存活角色数的牌；从使用者开始，每个未被无懈的目标选择获得一张，最后剩余牌弃置。", response: "无懈链只取消当前目标取牌，不影响之后目标。",
    limits: ["亮出牌为公开信息", "强制选择超时时由服务器选择第一张合法牌"],
  },
  借刀杀人: {
    name: "借刀杀人", image: "/card-art/jiedao.webp", category: "普通锦囊", subtitle: "两段目标 · 令持武器者出【杀】或交出武器", timing: "自己的出牌阶段", target: "先选一名装备武器的其他角色 A，再选 A 攻击范围内的合法目标 B",
    effect: "A 须对 B 使用一张【杀】，否则使用者获得 A 的武器。此【杀】不计入 A 的出牌阶段次数。", response: "先对借刀效果开启无懈链；成功使用【杀】后再进入正常【闪】响应。",
    limits: ["A 必须当前装备武器", "B 不能是借刀的使用者，且必须是 A 的合法【杀】目标"],
  },
  无懈可击: {
    name: "无懈可击", image: "/card-art/wuxie.webp", category: "普通锦囊", subtitle: "锦囊响应 · 翻转当前效果的生效状态", timing: "一个锦囊效果对某名目标生效前，或延时锦囊在判定阶段即将生效时", target: "当前正在结算的一个锦囊效果",
    effect: "每打出一张就翻转一次生效状态；全员连续放弃后，奇数张令原效果无效，偶数张令其继续生效。", response: "【无懈可击】也可被新的【无懈可击】抵消。",
    limits: ["多目标锦囊对每个目标单独开链", "【离间】生成的决斗明确不开启此窗口"], rulesNote: "黄月英使用【无懈可击】也可选择发动【集智】。",
  },
  乐不思蜀: {
    name: "乐不思蜀", image: "/card-art/lebu.webp", category: "延时锦囊", subtitle: "判定控制 · 非红桃则跳过出牌阶段", timing: "自己的出牌阶段放入目标判定区；在目标的判定阶段结算", target: "判定区没有同名牌的一名其他角色",
    effect: "在目标判定阶段进行判定：结果为红桃时无事发生；否则目标跳过本回合出牌阶段。结算后实体牌弃置。", response: "判定前先开启无懈链；鬼才可在判定牌生效前替换。",
    limits: ["同一判定区不能同时有两张乐不思蜀", "不能指定有【谦逊】的陆逊"],
  },
  闪电: {
    name: "闪电", image: "/card-art/shandian.webp", category: "延时锦囊", subtitle: "流转判定 · 黑桃 2–9 造成三点伤害", timing: "自己的出牌阶段置入自己判定区；判定阶段结算", target: "自己，且判定区没有同名牌",
    effect: "判定为黑桃 2–9 时，目标受到 3 点无来源普通伤害并弃置闪电；否则将闪电移给下一名判定区没有闪电的存活角色。", response: "判定前可开启无懈链；鬼才可改判。",
    limits: ["判定区按后进先出顺序结算", "无合法下家时进入弃牌堆"],
  },

  诸葛连弩: weapon("诸葛连弩", "/card-art/zhuge.webp", 1, "你在自己出牌阶段使用【杀】无次数限制。", ["失去武器后立即恢复通常的【杀】次数限制"]),
  雌雄双股剑: weapon("雌雄双股剑", "/card-art/cixiong.webp", 2, "你使用【杀】指定不同性别目标后可发动；目标弃一张手牌，否则你摸一张。", ["每个合法目标单独结算"]),
  青釭剑: weapon("青釭剑", "/card-art/qinggang.webp", 2, "你的【杀】忽略目标防具，包括八卦阵与仁王盾。", ["只忽略防具，不忽略武将技或坐骑"]),
  青龙偃月刀: weapon("青龙偃月刀", "/card-art/qinglong.webp", 3, "目标使用【闪】抵消你的【杀】后，你可对其再使用一张【杀】。", ["追击用【杀】不计入出牌阶段次数"]),
  丈八蛇矛: weapon("丈八蛇矛", "/card-art/zhangba.webp", 3, "你可将两张手牌当一张【杀】使用或打出。", ["两张子牌颜色相同时虚拟【杀】为该颜色，否则为无色"]),
  贯石斧: weapon("贯石斧", "/card-art/guanshi.webp", 3, "目标使用【闪】抵消你的【杀】后，你可弃置两张牌，令此【杀】仍造成伤害。", ["成本可包含手牌或装备，也可弃置贯石斧本身"]),
  方天画戟: weapon("方天画戟", "/card-art/fangtian.webp", 4, "当你使用的【杀】是最后一张手牌时，可额外指定至多两个合法目标。", ["最多同时指定三名目标", "每个目标独立结算技能、防具和响应"]),
  麒麟弓: weapon("麒麟弓", "/card-art/qilin.webp", 5, "你使用【杀】对目标造成伤害后，可弃置其装备的一匹坐骑。", ["可选进攻坐骑或防御坐骑"]),
  寒冰剑: weapon("寒冰剑", "/card-art/hanbing.webp", 2, "你的【杀】即将造成伤害时，可防止此伤害，改为依次弃置目标至多两张手牌或装备牌。", ["选择隐藏手牌时不泄露具体牌 ID", "不能选择判定区的牌", "防止伤害后不触发受伤技能"]),
  八卦阵: {
    name: "八卦阵", image: "/card-art/bagua.webp", category: "防具牌", subtitle: "防具 · 需要【闪】时可判定", timing: "出牌阶段装备；需要使用或打出【闪】时可发动", target: "自己的防具栏",
    effect: "进行一次判定；红色视为使用或打出一张【闪】，黑色失败。", response: "判定可被【鬼才】替换；【青釭剑】的【杀】会忽略此防具。",
    limits: ["同一时间只能有一件防具", "面对无双【杀】时，一次成功判定只提供一张【闪】"],
  },
  仁王盾: {
    name: "仁王盾", image: "/card-art/renwang.webp", category: "防具牌", subtitle: "防具 · 黑色【杀】对你无效", timing: "自己的出牌阶段装备", target: "自己的防具栏",
    effect: "锁定效果：黑色【杀】对你无效。", response: "在【闪】窗口之前直接令黑色【杀】无效；青釭剑可忽略。",
    limits: ["不防红色或无色【杀】", "同一时间只能有一件防具"],
  },
  赤兔: horse("赤兔", "/card-art/chitu.webp", "offense"),
  大宛: horse("大宛", "/card-art/dawan.webp", "offense"),
  紫骍: horse("紫骍", "/card-art/zixing.webp", "offense"),
  绝影: horse("绝影", "/card-art/jueying.webp", "defense"),
  的卢: horse("的卢", "/card-art/dilu.webp", "defense"),
  爪黄飞电: horse("爪黄飞电", "/card-art/zhaohuang.webp", "defense"),
};

export const CARD_NAMES = Object.keys(CARD_GUIDES) as CardName[];
