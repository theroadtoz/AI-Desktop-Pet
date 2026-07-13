import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateActiveYawnInteractionScenario,
  evaluateCanvasContinuity,
  evaluateInterruptedStateScenario,
  evaluateInterruptedWorkScenario,
  evaluateNaturalCompletedScenario,
  evaluateStartedActionEchoScenario,
  evaluateTerminalTelemetrySafety
} from "./p2-63c-2-yawn-runtime-state-conflict-real-ui.mjs";

const runnerSource = readFileSync(
  "scripts/p2-63c-2-yawn-runtime-state-conflict-real-ui.mjs",
  "utf8"
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

function event(index: number, type: string, payload: Record<string, unknown>) {
  return { __index: index, type, payload };
}

test("runner uses the production app and existing real-UI mechanisms without source injection", () => {
  assert.match(runnerSource, /from "\.\/support\/real-ui-harness\.mjs"/u);
  assert.match(runnerSource, /startElectron\(context\)/u);
  assert.match(runnerSource, /setPresenceMode\(chat, "sleep"\)/u);
  assert.match(runnerSource, /modeId: "work", actionType: "workFocus", reason: "state_work", stateId: "work"/u);
  assert.match(runnerSource, /modeId: "reading", actionType: "readingIdle", reason: "state_read", stateId: "read"/u);
  assert.match(runnerSource, /modeId: "game", actionType: "gameReady", reason: "state_game", stateId: "game"/u);
  assert.match(runnerSource, /clickPet\(pet, "head"\)/u);
  assert.match(runnerSource, /clickPet\(pet, "body"\)/u);
  assert.match(runnerSource, /captureNaturalYawnFrames\(pet, context, naturalStartIndex\)/u);
  assert.match(runnerSource, /captureVisiblePageFrame/u);
  assert.match(runnerSource, /waitForVisibleRendererFrame/u);
  assert.match(runnerSource, /Page\.captureScreenshot/u);
  assert.match(runnerSource, /P2_63C_2_YAWN_SAMPLE_COUNT = 5/u);
  assert.match(runnerSource, /observeStartedActionEcho\(chat/u);
  assert.match(runnerSource, /resources[\\/]models[\\/]witch[\\/]model-manifest\.json/u);
  assert.match(runnerSource, /resources[\\/]models[\\/]witch[\\/]motions[\\/]yawn-once\.motion3\.json/u);
  assert.match(runnerSource, /eca4ad06bb4665c3d4ae2a619a1d6528360044935508d08b06310ea3125b52b4/u);
  assert.doesNotMatch(runnerSource, /prepareIsolatedApp|isolated-app|patchFile|source injection|terminal-control/u);
});

test("default verify reaches the yawn runtime and model asset protocol static gates", () => {
  const runtimeGates = packageJson.scripts["test:live2d-runtime-gates"];
  assert.match(runtimeGates, /scripts\/model-asset-protocol\.test\.mts/u);
  assert.match(runtimeGates, /scripts\/p2-63c-2-yawn-runtime-state-conflict-real-ui\.test\.mts/u);
  assert.match(packageJson.scripts["verify:core"], /npm run test:live2d-runtime-gates/u);
  assert.match(packageJson.scripts.verify, /npm run verify:core/u);
});

test("natural completion requires one production yawn start and one completed restore marker", () => {
  const result = evaluateNaturalCompletedScenario([
    event(1, "pet_interaction_action_started", {
      type: "doze",
      reason: "state_sleep",
      stateId: "sleep",
      motionPresetId: "yawn-once"
    }),
    event(2, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "completed"
    })
  ], 0);

  assert.equal(result.passed, true);
  assert.equal(result.yawnStartedCount, 1);
  assert.equal(result.restoreMarkerCount, 1);
  assert.equal(result.terminalStatus, "completed");
});

test("natural completion rejects duplicate sleep starts", () => {
  const result = evaluateNaturalCompletedScenario([
    event(1, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
    event(2, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
    event(3, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "completed"
    })
  ], 0);

  assert.equal(result.passed, false);
  assert.equal(result.yawnStartedCount, 2);
});

test("natural completion reports a real timeout without treating it as completed", () => {
  const result = evaluateNaturalCompletedScenario([
    event(1, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
    event(2, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "timed_out"
    })
  ], 0);

  assert.equal(result.passed, false);
  assert.equal(result.restoreMarkerCount, 0);
  assert.equal(result.observedRestoreMarkerCount, 1);
  assert.equal(result.observedTerminalStatus, "timed_out");
});

test("natural completion rejects a semantic action start without native motion evidence", () => {
  const result = evaluateNaturalCompletedScenario([
    event(1, "pet_interaction_action_started", {
      type: "doze",
      reason: "state_sleep",
      stateId: "sleep"
    }),
    event(2, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "completed"
    })
  ], 0);

  assert.equal(result.passed, false);
  assert.equal(result.yawnStartedCount, 0);
});

test("sleep to work requires interrupted restore before target start and rejects active_action skip", () => {
  const result = evaluateInterruptedWorkScenario([
    event(1, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
    event(2, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "interrupted"
    }),
    event(3, "pet_interaction_action_started", { type: "workFocus", reason: "state_work", stateId: "work" })
  ], 0);

  assert.equal(result.passed, true);
  assert.equal(result.strictOrder, true);
  assert.equal(result.restoreMarkerCount, 1);
  assert.equal(result.targetStartedCount, 1);
  assert.equal(result.activeActionSkipCount, 0);
});

test("sleep to work fails when the target is skipped by the active yawn", () => {
  const result = evaluateInterruptedWorkScenario([
    event(1, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
    event(2, "pet_interaction_action_skipped", {
      type: "workFocus",
      reason: "state_work",
      stateId: "work",
      skipReason: "active_action",
      activeType: "doze",
      motionPresetId: "yawn-once"
    })
  ], 0);

  assert.equal(result.passed, false);
  assert.equal(result.activeActionSkipCount, 1);
});

test("sleep interruption restores before each work, reading, and game target starts", () => {
  const targets = [
    { modeId: "work", actionType: "workFocus", reason: "state_work", stateId: "work" },
    { modeId: "reading", actionType: "readingIdle", reason: "state_read", stateId: "read" },
    { modeId: "game", actionType: "gameReady", reason: "state_game", stateId: "game" }
  ];

  for (const target of targets) {
    const result = evaluateInterruptedStateScenario([
      event(1, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
      event(2, "pet_interaction_action_finished", {
        type: "doze",
        reason: "state_sleep",
        motionPresetId: "yawn-once",
        terminalStatus: "interrupted"
      }),
      event(3, "pet_interaction_action_started", {
        type: target.actionType,
        reason: target.reason,
        stateId: target.stateId
      })
    ], target, 0);

    assert.equal(result.passed, true, target.modeId);
    assert.equal(result.strictOrder, true, target.modeId);
    assert.equal(result.targetStartedCount, 1, target.modeId);
  }
});

test("active yawn skips ordinary head and body interactions without starting an override", () => {
  const result = evaluateActiveYawnInteractionScenario([
    event(1, "pet_interaction_action_started", { type: "doze", reason: "state_sleep", stateId: "sleep", motionPresetId: "yawn-once" }),
    event(2, "pet_interaction_action_skipped", {
      type: "headPat",
      reason: "click_head",
      skipReason: "active_action",
      activeType: "doze",
      motionPresetId: "yawn-once"
    }),
    event(3, "pet_interaction_action_skipped", {
      type: "greeting",
      reason: "click_body",
      skipReason: "active_action",
      activeType: "doze",
      motionPresetId: "yawn-once"
    })
  ], 0);

  assert.equal(result.passed, true);
  assert.equal(result.headSkipCount, 1);
  assert.equal(result.bodySkipCount, 1);
  assert.equal(result.overrideStartedCount, 0);
});

test("canvas continuity requires five natural-yawn samples with three nonempty changing frames", () => {
  assert.equal(evaluateCanvasContinuity([
    { width: 630, height: 900, nonTransparentPixels: 2_000, frameHash: "a", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 2_010, frameHash: "b", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 2_020, frameHash: "b", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false }
  ]).passed, true);

  assert.equal(evaluateCanvasContinuity([
    { width: 630, height: 900, nonTransparentPixels: 2_000, frameHash: "same", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 2_010, frameHash: "same", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 2_020, frameHash: "same", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false }
  ]).passed, false);

  assert.equal(evaluateCanvasContinuity([
    { width: 630, height: 900, nonTransparentPixels: 2_000, frameHash: "a", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 2_010, frameHash: "b", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false },
    { width: 630, height: 900, nonTransparentPixels: 0, frameHash: "blank", contextLost: false }
  ]).passed, false);
});

test("started action echo activates once and terminal telemetry stays safe", () => {
  assert.equal(evaluateStartedActionEchoScenario({ activeTransitions: 1, activeText: "小动作：她打了个哈欠" }).passed, true);
  assert.equal(evaluateStartedActionEchoScenario({ activeTransitions: 2, activeText: "小动作：她打了个哈欠" }).passed, false);

  const safety = evaluateTerminalTelemetrySafety([
    event(1, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "completed"
    }),
    event(2, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "interrupted"
    })
  ]);
  assert.equal(safety.passed, true);
  assert.equal(evaluateTerminalTelemetrySafety([
    event(1, "pet_interaction_action_finished", {
      type: "doze",
      reason: "state_sleep",
      motionPresetId: "yawn-once",
      terminalStatus: "failed",
      error: "internal detail"
    })
  ]).passed, false);
});
