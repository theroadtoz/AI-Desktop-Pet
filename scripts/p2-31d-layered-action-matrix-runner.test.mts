import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync("scripts/p2-31d-layered-action-matrix-real-ui.mjs", "utf8");

test("p2-31d package command runs the real UI matrix runner with strip-types and no warnings", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-31d-layered-action-matrix"],
    "node --no-warnings --experimental-strip-types scripts/p2-31d-layered-action-matrix-real-ui.mjs"
  );
});

test("p2-31d runner is a real UI harness script with fake provider isolation and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS",
    "provider: \"fake\""
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_PROVIDER:\s*"(?!fake)/);
});

test("p2-31d runner validates real UI observations against the layered decision catalog", () => {
  for (const token of [
    "PET_LAYERED_ACTION_DECISION_CATALOG",
    "getPetLayeredActionDecisionForReason",
    "PET_TELEMETRY_ALLOWED_FIELDS",
    "stateId: decision.stateId",
    "triggerReason: decision.triggerReason",
    "actionType: decision.actionType",
    "allowedDialogueModes",
    "allowedPresenceModes",
    "motionPresetFallbackStatus: decision.motionPresetFallback.status"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-31d runner declares the expected visible action-state matrix", () => {
  const expectedTokens = [
    "chat_opened",
    "chat_input_focus",
    "chat_reply_waiting",
    "state_work",
    "state_game",
    "state_read",
    "state_sleep",
    "chat_reply_sustain",
    "pet_edge_settled",
    "rapid_touch_combo",
    "listen",
    "think",
    "work",
    "game",
    "read",
    "sleep",
    "reply-sustain",
    "edge",
    "flustered"
  ];

  for (const token of expectedTokens) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  for (const token of ["idle", "greet", "local-model-busy"]) {
    assert.match(runnerSource, new RegExp(`catalogOnlyStates[\\s\\S]*${escapeRegExp(token)}`));
  }
});

test("p2-31d runner keeps output to safe summaries instead of raw resources or private text", () => {
  const sourceWithoutForbiddenList = runnerSource.replace(
    /const forbiddenOutputPatterns = \[[\s\S]*?\];/,
    ""
  );
  const forbiddenPatterns = [
    /providerRequestBody/i,
    /factCardBody/i,
    /messages/i,
    /content/i,
    /prompt/i,
    /apiKey/i,
    /expressionName/i,
    /partId/i,
    /\.motion3\.json/i,
    /\.exp3\.json/i,
    /[A-Za-z]:[\\/]/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(sourceWithoutForbiddenList, pattern);
  }

  assert.match(runnerSource, /safeSummaryOnly:\s*true/);
  assert.doesNotMatch(sourceWithoutForbiddenList, /runDir\s*:/);
  assert.doesNotMatch(sourceWithoutForbiddenList, /appDataDir\s*:/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
