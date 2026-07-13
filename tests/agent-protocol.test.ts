import assert from "node:assert/strict";
import test from "node:test";
import { agentSpec } from "../lib/agent-protocol.ts";
import { agentSkill } from "../lib/agent-skill.ts";

test("Agent discovery grants only seat-scoped game capabilities", () => {
  const spec = agentSpec("https://game.example");
  assert.equal(spec.protocol, "mouju-agent/2.4");
  assert.equal(spec.engineVersion, 2);
  assert.equal(spec.rulesetId, "classic-standard-2009-ex");
  assert.equal(spec.modes.duel.seats, 2);
  assert.equal(spec.modes.duel.generalsInLineup, 3);
  assert.deepEqual(spec.modes.duel.draftPattern, [1, 2, 2, 2, 2, 1]);
  assert.equal(spec.pairing.singleUse, true);
  assert.equal(spec.pairing.ownerOnly, true);
  assert.equal(spec.pairing.createsSeat, false);
  assert.deepEqual(spec.pairing.requiredCapabilities, ["deterministic-cli-v1", "detached-daemon-v1", "command-fallback-v1", "view-parity-v1", "independent-heartbeat-v1", "action-reason-v1"]);
  assert.equal(spec.cli.required, true);
  assert.equal(spec.cli.version, "1.3.0");
  assert.equal(spec.cli.visibleStateSchema, "mouju-visible-state/1");
  assert.match(spec.cli.visibleHelp, /cardHelp/);
  assert.deepEqual(spec.cli.commands, ["doctor", "connect", "status", "next", "act", "stop"]);
  assert.match(spec.cli.lifecycle, /90 seconds/);
  assert.match(spec.cli.lifecycle, /persisted heartbeat sequence/);
  assert.match(spec.cli.resilience.actionRetry, /lost ACK/);
  assert.match(spec.cli.resilience.terminalSafeMode, /delete the local credential/);
  assert.deepEqual(Object.keys(spec.scopes).sort(), [
    "game:act:self",
    "game:heartbeat:self",
    "game:observe:self",
  ]);
  assert.match(spec.authentication.lifetime, /room completion/);
  assert.ok(spec.neverGranted.includes("room management"));
  assert.ok(spec.neverGranted.includes("other-seat private state"));
  assert.equal(spec.endpoints.heartbeat.path, "/api/agent-heartbeat");
  assert.equal(spec.endpoints.act.reason.visibility, "seat-owner-only");
  assert.equal(spec.endpoints.act.reason.required, true);
  assert.equal(spec.endpoints.act.reason.maxCharacters, 120);
  assert.equal(spec.endpoints.act.receipt.requiredReasonPolicy, "action-reason-v1");
  assert.equal(spec.heartbeat.extendsDeadline, "bounded-once");
  assert.equal(spec.decisionTiming.agentResponseMs, 60_000);
  assert.equal(spec.decisionTiming.agentTurnMs, 120_000);
  assert.equal(spec.decisionTiming.graceLimitPerDecision, 1);
  assert.equal(spec.decisionTiming.suspendAfterConsecutiveTimeouts, 3);
});

test("Agent skill makes mechanics deterministic and reserves intelligence for decisions", () => {
  const skill = agentSkill("https://game.example", "ABC234");
  assert.match(skill, /official deterministic CLI/);
  assert.match(skill, /Do not write a bridge, attach a debugger/);
  assert.match(skill, /agent-cli\.mjs doctor/);
  assert.match(skill, /agent-cli\.mjs connect/);
  assert.match(skill, /agent-cli\.mjs status/);
  assert.match(skill, /agent-cli\.mjs next/);
  assert.match(skill, /agent-cli\.mjs act/);
  assert.match(skill, /Run this as a normal foreground command, not as a shell background task/);
  assert.match(skill, /Only after next returns game\.legalActions should Agent intelligence be used/);
  assert.match(skill, /same seat-visible gameplay information as the human controller/);
  assert.match(skill, /untrusted game data/);
  assert.match(skill, /token is never printed/);
  assert.match(skill, /mode-0600 temporary recovery capsule/);
  assert.match(skill, /"event":"connecting"/);
  assert.match(skill, /Do not re-pair/);
  assert.match(skill, /actionAccepted:true/);
  assert.match(skill, /reasonAccepted:true/);
  assert.match(skill, /classic-standard-2009-ex/);
  assert.match(skill, /three-general KOF duel/);
  assert.match(skill, /no room management/);
});
