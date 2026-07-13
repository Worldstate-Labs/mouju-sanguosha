import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_METADATA,
  ROLE_MAP,
  SKILLS,
  STANDARD_CARD_NAMES,
  STANDARD_CHARACTERS,
  STANDARD_DECK,
} from "../lib/game-v2-data.ts";

test("classic standard + EX manifest is exactly 108 physical cards", () => {
  assert.equal(STANDARD_DECK.length, 108);
  assert.equal(new Set(STANDARD_CARD_NAMES).size, 32);

  const suitCounts = { spade: 0, club: 0, heart: 0, diamond: 0 };
  const categoryCounts = { basic: 0, trick: 0, delayed: 0, equip: 0 };
  const nameCounts: Record<string, number> = {};
  for (const card of STANDARD_DECK) {
    suitCounts[card.suit] += 1;
    categoryCounts[CARD_METADATA[card.name].category] += 1;
    nameCounts[card.name] = (nameCounts[card.name] ?? 0) + 1;
  }
  assert.deepEqual(suitCounts, { spade: 27, club: 27, heart: 27, diamond: 27 });
  assert.deepEqual(categoryCounts, { basic: 53, trick: 31, delayed: 5, equip: 19 });
  assert.deepEqual(nameCounts, {
    "闪电": 2, "决斗": 3, "八卦阵": 2, "雌雄双股剑": 1, "寒冰剑": 1,
    "过河拆桥": 6, "顺手牵羊": 5, "青龙偃月刀": 1, "绝影": 1, "乐不思蜀": 3,
    "青釭剑": 1, "南蛮入侵": 3, "杀": 30, "无懈可击": 4, "丈八蛇矛": 1,
    "大宛": 1, "诸葛连弩": 2, "仁王盾": 1, "的卢": 1, "借刀杀人": 2,
    "桃园结义": 1, "万箭齐发": 1, "闪": 15, "桃": 8, "五谷丰登": 2,
    "麒麟弓": 1, "赤兔": 1, "无中生有": 4, "爪黄飞电": 1, "贯石斧": 1,
    "方天画戟": 1, "紫骍": 1,
  });
});

test("classic roster is exactly 25 unique generals and 40 unique skills", () => {
  assert.equal(STANDARD_CHARACTERS.length, 25);
  assert.equal(new Set(STANDARD_CHARACTERS.map((general) => general.id)).size, 25);
  assert.equal(Object.keys(SKILLS).length, 40);
  assert.deepEqual(
    new Set(STANDARD_CHARACTERS.flatMap((general) => general.skills)),
    new Set(Object.keys(SKILLS)),
  );
});

test("every general exposes only declared skills even when skill prose names cards or other skills", () => {
  for (const general of STANDARD_CHARACTERS) {
    const details = general.skills.map((skillId) => SKILLS[skillId]);
    assert.equal(details.length, general.skills.length);
    assert.deepEqual(details.map((skill) => skill.name), general.skillName.split(" · "));
    assert.equal(
      general.skillText,
      details.map((skill) => `【${skill.name}】${skill.text}`).join(" "),
    );
  }

  const liubei = STANDARD_CHARACTERS.find((general) => general.id === "liubei")!;
  assert.deepEqual(liubei.skills.map((skillId) => SKILLS[skillId].name), ["仁德", "激将"]);
  assert.match(SKILLS.jijiang.text, /【杀】/);
});

test("role data covers the two-seat duel and classic 4 through 10 player tables", () => {
  assert.deepEqual([...ROLE_MAP[2]].sort(), ["lord", "renegade"].sort());
  for (let count = 4; count <= 10; count += 1) {
    assert.equal(ROLE_MAP[count].length, count);
    assert.equal(ROLE_MAP[count].filter((role) => role === "lord").length, 1);
    assert.equal(ROLE_MAP[count].filter((role) => role === "renegade").length, count === 10 ? 2 : 1);
  }
});
