import assert from "node:assert/strict";
import test from "node:test";
import { presentLegalActions } from "../lib/action-presentation.ts";

test("two same-name response cards remain distinct physical selections", () => {
  const actions = [
    { id: "shan-a", kind: "exact", label: "打出【闪】♥2", action: { type: "respond", cardId: "a" } },
    { id: "shan-b", kind: "exact", label: "打出【闪】♦7", action: { type: "respond", cardId: "b" } },
    { id: "pass", kind: "exact", label: "不响应", action: { type: "pass" } },
  ];
  const before = presentLegalActions(actions, ["a", "b"], []);
  assert.deepEqual(before.contextExact, []);
  assert.deepEqual(before.selectedExact, []);
  assert.deepEqual(before.passiveExact.map((entry) => entry.id), ["pass"]);
  const selected = presentLegalActions(actions, ["a", "b"], ["b"]);
  assert.deepEqual(selected.selectedExact.map((entry) => entry.id), ["shan-b"]);
});

test("opponent-zone choices remain direct buttons instead of pretending to be owned hand cards", () => {
  const actions = [
    { id: "zone-hand", kind: "exact", action: { type: "choose" } },
    { id: "zone-equip", kind: "exact", action: { type: "choose", cardId: "opponent-weapon" } },
  ];
  const presented = presentLegalActions(actions, ["my-card"], []);
  assert.deepEqual(presented.contextExact.map((entry) => entry.id), ["zone-hand", "zone-equip"]);
});
