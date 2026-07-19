import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  P2_77_POLICY_ONLY_CASES,
  P2_77_PRODUCTION_MOTION_CASES,
  P2_77_REAL_UI_CASES,
  evaluateNativeLifecycle,
  evaluateTelemetrySafety
} from "./p2-77-long-motion-runtime-real-ui.mjs";

const runnerSource = readFileSync("scripts/p2-77-long-motion-runtime-real-ui.mjs", "utf8");

function event(index: number, type: string, payload: Record<string, unknown>) {
  return { __index: index, type, payload };
}

test("P2-77 runner partitions all 14 production motions into real-UI and policy-only evidence", () => {
  assert.equal(P2_77_PRODUCTION_MOTION_CASES.length, 14);
  assert.equal(new Set(P2_77_PRODUCTION_MOTION_CASES.map((item) => item.motionPresetId)).size, 14);
  assert.equal(P2_77_REAL_UI_CASES.length, 9);
  assert.equal(P2_77_POLICY_ONLY_CASES.length, 5);
  assert.deepEqual(P2_77_POLICY_ONLY_CASES.map((item) => item.actionType), [
    "musicListenSway",
    "gamePresenceGlance",
    "returnFromIdle",
    "eveningWindowGlance",
    "longWorkRecovery"
  ]);
});

test("native lifecycle requires one ordered started and completed pair", () => {
  const expected = {
    actionType: "headPat",
    motionPresetId: "head-pat-linger",
    reason: "click_head"
  };
  const result = evaluateNativeLifecycle([
    event(1, "pet_interaction_action_started", {
      type: expected.actionType,
      reason: expected.reason,
      motionPresetId: expected.motionPresetId
    }),
    event(2, "pet_interaction_action_finished", {
      type: expected.actionType,
      reason: expected.reason,
      motionPresetId: expected.motionPresetId,
      terminalStatus: "completed"
    })
  ], expected, 0);

  assert.equal(result.passed, true);
  assert.equal(result.strictOrder, true);
  assert.equal(result.startedCount, 1);
  assert.equal(result.finishedCount, 1);
  assert.equal(result.completedCount, 1);
});

test("native lifecycle rejects missing native preset, duplicate starts, and unsafe terminals", () => {
  const expected = {
    actionType: "searchNoteSettle",
    motionPresetId: "search-note-settle",
    reason: "state_search_cited"
  };
  const missingPreset = evaluateNativeLifecycle([
    event(1, "pet_interaction_action_started", { type: expected.actionType, reason: expected.reason }),
    event(2, "pet_interaction_action_finished", {
      type: expected.actionType,
      reason: expected.reason,
      motionPresetId: expected.motionPresetId,
      terminalStatus: "completed"
    })
  ], expected);
  assert.equal(missingPreset.passed, false);

  const unsafe = evaluateNativeLifecycle([
    event(1, "pet_interaction_action_started", {
      type: expected.actionType,
      reason: expected.reason,
      motionPresetId: expected.motionPresetId
    }),
    event(2, "pet_interaction_action_started", {
      type: expected.actionType,
      reason: expected.reason,
      motionPresetId: expected.motionPresetId
    }),
    event(3, "pet_interaction_action_finished", {
      type: expected.actionType,
      reason: expected.reason,
      motionPresetId: expected.motionPresetId,
      terminalStatus: "timed_out"
    })
  ], expected);
  assert.equal(unsafe.passed, false);
  assert.equal(unsafe.startedCount, 2);
  assert.equal(unsafe.unsafeTerminalCount, 1);
});

test("telemetry safety rejects renderer failures, unsafe motion terminals, and raw context fields", () => {
  assert.equal(evaluateTelemetrySafety([
    event(1, "pet_interaction_action_finished", {
      type: "headPat",
      reason: "click_head",
      motionPresetId: "head-pat-linger",
      terminalStatus: "completed"
    })
  ]).passed, true);

  const result = evaluateTelemetrySafety([
    event(1, "recovery_failed", {}),
    event(2, "pet_interaction_action_finished", {
      type: "headPat",
      terminalStatus: "failed",
      mediaTitle: "must-not-appear"
    })
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.failureCount, 2);
  assert.deepEqual(result.forbiddenKeys, ["mediaTitle"]);
});

test("runner uses production Electron and fixed production surfaces without an arbitrary action payload entry", () => {
  assert.match(runnerSource, /from "\.\/support\/real-ui-harness\.mjs"/u);
  assert.match(runnerSource, /startElectron\(context\)/u);
  assert.match(runnerSource, /clickPet\(pet, "head"\)/u);
  assert.match(runnerSource, /clickPet\(pet, "body"\)/u);
  assert.match(runnerSource, /settleGlobalActionCooldown\(\)/u);
  assert.match(runnerSource, /window\.petApi\?\.openChat\(\)/u);
  assert.match(runnerSource, /form\.requestSubmit\(\)/u);
  assert.match(runnerSource, /state_search_cited/u);
  assert.match(runnerSource, /bundled-mcp-fixture/u);
  assert.match(runnerSource, /kind: "Fake MCP"/u);
  assert.match(runnerSource, /citationCount/u);
  assert.match(runnerSource, /toolCallCount/u);
  assert.match(runnerSource, /bundledFixtureRestored/u);
  assert.match(runnerSource, /simulatedPolicyOnly: true/u);
  assert.match(runnerSource, /realOsStateClaimed: false/u);
  assert.match(runnerSource, /realLongWaitClaimed: false/u);
  assert.match(runnerSource, /coverageGaps/u);
  assert.match(runnerSource, /fakeMcpEvidence/u);
  assert.doesNotMatch(runnerSource, /webSearchApi\.setSettings/u);
  assert.doesNotMatch(runnerSource, /ipcRenderer|pet:action-trigger|playAction\(|dispatchAction|actionPayload/u);
  assert.doesNotMatch(runnerSource, /npm(?:\.cmd)?\s+run\s+verify|p2-11g-real-ui-regression-runner/u);
});

test("runner delegates restored and released evidence to the 14-case technical playback gate", () => {
  assert.match(runnerSource, /p2-65-reaction-motion-technical-playback\.mts/u);
  assert.match(runnerSource, /item\.restoreStatus === "restored"/u);
  assert.match(runnerSource, /item\.cleanupStatus === "released"/u);
  assert.match(runnerSource, /parsed\.cubismParsePresetIds\?\.length !== P2_77_PRODUCTION_MOTION_CASES\.length/u);
  assert.match(runnerSource, /p2-77-runtime-trigger-policy\.test\.mts/u);
  assert.match(runnerSource, /desktop-context-monitor\.test\.mts/u);
});
