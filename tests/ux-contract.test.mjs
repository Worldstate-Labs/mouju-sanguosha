import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, css, matrix, actionPresentation] = await Promise.all([
  readFile(new URL("../app/GameClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("./visual-matrix.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../lib/action-presentation.ts", import.meta.url), "utf8"),
]);

test("product UX surfaces have explicit desktop, mobile and short-landscape contracts", () => {
  assert.deepEqual(matrix.viewports.map((entry) => entry.name), [
    "desktop-wide",
    "desktop-short",
    "tablet-landscape",
    "mobile-standard",
    "mobile-compact",
  ]);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /orientation: landscape/);
  assert.match(css, /max-height: 620px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /100dvh/);
});

test("selection has tactile feedback, drag targets, a relation line and an explicit confirmation preview", () => {
  assert.match(client, /function tactile\(/);
  assert.match(client, /draggable=\{selectable\}/);
  assert.match(client, /data-drag-target/);
  assert.match(client, /className="target-relation-layer"/);
  assert.match(client, /className="action-selection-preview"/);
  assert.match(client, /confirmTargetAction/);
  assert.match(css, /\.target-relation-layer line/);
  assert.match(css, /\.player-seat\[data-drag-target="true"\]/);
});

test("pending card responses remain bound to a visible physical hand card", () => {
  assert.match(client, /const ownedCardIds = new Set/);
  assert.match(client, /presentLegalActions\(game\.legalActions, ownedCardIds, selected\)/);
  assert.match(actionPresentation, /owned\.has\(entry\.action\.cardId\) && selected\.has/);
  assert.match(actionPresentation, /return !entry\.action\?\.cardId \|\| !owned\.has/);
});

test("opponent public stats always expose explicit HP and hand-count labels", () => {
  assert.match(client, /className="seat-hand-count"/);
  assert.match(client, /<small>手牌<\/small><b>\{entry\.handCount \?\? 0\}<\/b>/);
  assert.match(css, /\.seat-stats[^}]*position: absolute[^}]*bottom:/s);
  assert.match(css, /\.seat-hand-count small/);
});

test("Agent owner view always separates latest rationale from opt-in diagnostics", () => {
  const reasonIndex = client.indexOf('className="agent-reason-feed"');
  const advancedIndex = client.indexOf('className="agent-advanced-diagnostics"');
  assert.ok(reasonIndex > 0 && advancedIndex > reasonIndex);
  assert.match(client, /最新理由/);
  assert.match(client, /高级连接诊断/);
  assert.match(client, /先恢复原会话/);
  assert.match(client, /确认旧会话失效后重配/);
  assert.match(css, /\.agent-reason-scroll[^}]*overflow-y: auto/s);
  assert.match(css, /\.agent-advanced-diagnostics\[open\][^}]*overflow-y: auto/s);
  assert.match(css, /\.action-panel > \.agent-diagnostics[^}]*overflow: hidden/s);
  assert.match(client, /tabIndex=\{0\} aria-label="可独立滚动的 Agent 决策理由"/);
  assert.match(css, /\.action-panel > \.agent-diagnostics \.agent-reason-feed[^}]*overflow-y: auto/s);
  assert.match(css, /\.action-panel > \.agent-diagnostics \.agent-latest-reason p[^}]*max-height: none[^}]*overflow: visible/s);
  assert.match(css, /\.action-panel > \.agent-diagnostics \.agent-diagnostic-actions[^}]*position: static/s);
});

test("action presentation is tiered, privacy-bound and has dedicated motion cues", () => {
  assert.match(client, /type EventTier = "light" \| "standard" \| "major"/);
  assert.match(client, /eventTier\(entry\)/);
  assert.match(client, /combined\.length > 8/);
  assert.match(client, /<ActionMotionLayer event=\{activeAnimation\}/);
  for (const kind of ["transfer", "damage", "heal", "respond", "nullify", "equip", "aoe", "death"]) {
    assert.match(css, new RegExp(`\\.motion-${kind}`));
  }
});

test("structured battle reports are not captured by the legacy direct-log grid", () => {
  assert.match(css, /\.log-list > p \{ display: grid/);
  assert.doesNotMatch(css, /\.log-list p \{[^}]*display: grid/);
  assert.match(css, /\.log-entry p \{[^}]*display: block[^}]*overflow-wrap: break-word/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.log-entry \{ grid-template-columns: 34px minmax\(0,1fr\)/);
  assert.match(css, /\.log-sequence \{ display: none; \}/);
});

test("audio channels and post-game loop are independently controllable", () => {
  for (const channel of ["music", "effects", "turnAlerts", "animations"]) {
    assert.match(client, new RegExp(`onToggle\\("${channel}"\\)`));
  }
  assert.match(client, /className="result-scoreboard"/);
  assert.match(client, /className="result-highlights"/);
  assert.match(client, /同桌再来一局/);
  assert.match(client, /op: "rematch"/);
  assert.match(css, /\.result-overlay[^}]*position: fixed/s);
  assert.match(css, /\.result-overlay[^}]*overflow-y: auto/s);
  assert.match(client, /return \{ music: true, effects: true, turnAlerts: true, animations: true \}/);
  assert.match(client, /music: value\?\.music !== false, effects: value\?\.effects !== false/);
});

test("every in-room new-room entry resets client session state instead of only changing the URL", () => {
  assert.match(client, /const startNewRoom = \(\) => \{/);
  assert.match(client, /sessionEpochRef\.current \+= 1;[\s\S]*?setView\(null\);[\s\S]*?setRoomCode\(""\);[\s\S]*?history\.replaceState\(\{\}, "", "\/"\)/);
  assert.match(client, /<SpectatorJoin[^>]*onNewRoom=\{startNewRoom\}/);
  assert.match(client, /<GameBoard[\s\S]*?onNewRoom=\{startNewRoom\}[\s\S]*?syncProblem=/);
  assert.doesNotMatch(client, /<Link href="\/"[^>]*>\s*<Icon name="users" size=\{15\} \/>创建新房间/);
});

test("general detail cards render structured skill data instead of parsing bracketed prose", () => {
  assert.match(client, /skills: general\.skills\.map\(\(skillId\) => SKILLS\[skillId\]\)/);
  assert.match(client, /general\.skills\.map\(\(skill\) =>/);
  assert.doesNotMatch(client, /general\.skillText\.matchAll/);
  assert.match(client, /skill\.kind === "lord" \? "主公技"/);
});

test("room recovery distinguishes permanent errors from retryable network failures", () => {
  assert.match(client, /ROOM_NOT_FOUND", "ROOM_CLOSED/);
  assert.match(client, /reason: "room_missing", retryable: false/);
  assert.match(client, /reconnectState\?\.retryable/);
  assert.match(client, /这个房间已经不存在/);
  assert.match(client, /返回首页，创建新房间/);
});

test("mandatory decisions outrank optional motion and the mobile battle log", () => {
  assert.match(client, /audioPreferences\.animations && !game\.pending/);
  assert.match(client, /mobileLogOpen && \(Boolean\(view\?\.game\?\.pending\)/);
  assert.match(css, /--mobile-action-h:/);
  assert.match(css, /--mobile-agent-action-h:/);
  assert.match(css, /agent-reason-scroll[^}]*overflow-y: auto/s);
});

test("Agent pairing keeps permissions available without crowding the primary mobile task", () => {
  assert.match(client, /className="agent-security-details"/);
  assert.match(client, /Agent 权限与高级接入信息/);
  assert.match(css, /\.agent-security-details > summary/);
});
