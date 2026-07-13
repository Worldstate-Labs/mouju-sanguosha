import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { CARD_GUIDES, CARD_NAMES } from "../lib/card-catalog.ts";

test("every card type has a unique illustration and complete rule guide", async () => {
  assert.equal(CARD_NAMES.length, 33, "32 standard names plus the v1-only Wine compatibility guide");
  assert.equal(new Set(CARD_NAMES).size, 33);
  assert.equal(new Set(CARD_NAMES.map((name) => CARD_GUIDES[name].image)).size, 33);

  for (const name of CARD_NAMES) {
    const guide = CARD_GUIDES[name];
    assert.equal(guide.name, name);
    assert.ok(guide.subtitle.length >= 8);
    assert.ok(guide.timing.length >= 4);
    assert.ok(guide.target.length >= 2);
    assert.ok(guide.effect.length >= 8);
    assert.ok(guide.response.length >= 4);
    assert.ok(guide.limits.length >= 2);
    assert.match(guide.image, /^\/card-art\/[a-z]+\.webp$/);
    const file = await stat(`${process.cwd()}/public${guide.image}`);
    assert.ok(file.size > 10_000, `${name} illustration is a real optimized image`);
  }
});
