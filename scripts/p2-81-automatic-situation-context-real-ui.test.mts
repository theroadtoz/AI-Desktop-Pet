import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const p2_81 = readFileSync("scripts/p2-81-automatic-situation-context-real-ui.mjs", "utf8");
const p2_10c = readFileSync("scripts/p2-10c-chat-mode-switching-real-ui.mjs", "utf8");
const p2_11d = readFileSync("scripts/p2-11d-chat-ui-polish-real-ui.mjs", "utf8");
const p2_11e = readFileSync("scripts/p2-11e-companion-control-shelf-real-ui.mjs", "utf8");
const p2_77 = readFileSync("scripts/p2-77-long-motion-runtime-real-ui.mjs", "utf8");
const p2_11g = readFileSync("scripts/p2-11g-real-ui-regression-runner.mjs", "utf8");

test("P2-81 reports bundled real, Fake/injected, and real Windows probe evidence separately", () => {
  for (const token of [
    "bundled-real local classifier",
    "Fake/injected strategy",
    "real Windows probe",
    "fakeChatProvider: true",
    "injected: false",
    "realOsStateClaimed",
    "schemaClosedSetValidated",
    "automatic_situation_classified",
    "bundled-local-model"
  ]) {
    assert.match(p2_81, new RegExp(escapeRegExp(token), "u"));
  }
  assert.match(p2_81, /getAutomaticSituation\(/u);
  assert.match(p2_81, /probeExecuted: true/u);
  assert.match(p2_81, /schemaClosedSetValidated: probe\?\.schemaClosedSetValidated === true/u);
  assert.match(p2_81, /osValuesPersisted: reportedProbeIsSanitized && probe\.osValuesPersisted === false/u);
  assert.match(p2_81, /noSensitiveFields: reportedProbeIsSanitized && probe\.noSensitiveFields === true/u);
});

test("P2-81 keeps real Windows probe evidence privacy-safe, closed-set, and free of OS values", () => {
  const probeFunction = p2_81.slice(
    p2_81.indexOf("async function runRealWindowsProbe()"),
    p2_81.indexOf("async function main()")
  );

  for (const token of [
    "probeExecuted: true",
    "schemaClosedSetValidated",
    "osValuesPersisted: false",
    "noSensitiveFields: true"
  ]) {
    assert.match(probeFunction, new RegExp(escapeRegExp(token), "u"));
  }

  assert.doesNotMatch(probeFunction, /mediaPlaying:\s*result\.snapshot/u);
  assert.doesNotMatch(probeFunction, /gamePresence:\s*result\.snapshot/u);
  assert.doesNotMatch(probeFunction, /\b(title|process(?:Name)?|path)\s*:/iu);
  assert.doesNotMatch(probeFunction, /\bprobe:\s*/u);
  assert.doesNotMatch(probeFunction, /\bstatusSummary\s*:/u);
  assert.doesNotMatch(probeFunction, /\bcapabilitySummary\s*:/u);
  assert.match(
    probeFunction,
    /\["probeExecuted", "schemaClosedSetValidated", "osValuesPersisted", "noSensitiveFields"\]/u
  );
});

test("P2-81 real bundled classifier covers all contexts without confusing game topics with current play", () => {
  for (const token of [
    "game-development-is-work",
    "game-knowledge-is-reading",
    "ordinary-chat-is-default",
    "current-game-activity-is-game",
    "我正在开发一款游戏",
    "给我讲讲这款游戏的世界观",
    "今天心情不错，想和你随便聊聊",
    "我准备马上玩一局游戏",
    'expectedContextId: "work"',
    'expectedContextId: "reading"',
    'expectedContextId: "default"',
    'expectedContextId: "game"',
    "automatic_situation_classified"
  ]) {
    assert.match(p2_81, new RegExp(escapeRegExp(token), "u"));
  }
});

test("migrated smoke runners no longer execute manual mode switching", () => {
  const p2_10cMain = p2_10c.slice(p2_10c.indexOf("async function main()"), p2_10c.indexOf("const scriptPath"));
  for (const source of [p2_10cMain, p2_11d, p2_11e, p2_77]) {
    assert.doesNotMatch(source, /setMode\(/u);
    assert.doesNotMatch(source, /setMode\(/u);
  }
  assert.match(p2_11g, /automatic situation read-only UI/u);
  assert.match(p2_11g, /chat UI polish, density, and retired manual-mode controls/u);
});

test("P2-81 asserts retired controls, read-only automatic values, reply redaction, and an existing action chain", () => {
  for (const token of [
    "manualModeControlsAbsent",
    "readOnlyAutomaticApi",
    "replyDoesNotLeakSituationLabels",
    "existingActionChainStillTriggers",
    "final-classification-action-settled",
    "click_body"
  ]) {
    assert.match(p2_81, new RegExp(escapeRegExp(token), "u"));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
