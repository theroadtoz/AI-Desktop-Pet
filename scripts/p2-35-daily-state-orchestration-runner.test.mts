import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync("scripts/p2-35-daily-state-orchestration-rule-table-real-ui.mjs", "utf8");

test("p2-35 package command builds and runs the daily state orchestration real UI runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-35-daily-state-orchestration-rule-table"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-35-daily-state-orchestration-rule-table-real-ui.mjs"
  );
});

test("p2-35 runner uses the real UI harness with fake provider isolation and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "setPresenceMode",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "provider: \"fake\""
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_PROVIDER:\s*"(?!fake)/);
});

test("p2-35 runner validates catalog and mode boundaries without changing runtime behavior", () => {
  for (const token of [
    "listDailyStateOrchestrationRules",
    "selectLowFrequencyCompanionEvent",
    "catalogCoversModes",
    "defaultAllowsLowFrequencyEvent",
    "focusQuietOnlyLowInterruption",
    "sleepSuppressesLowFrequencyEvents",
    "chatOpenTriggersListen",
    "sleepTriggersDoze",
    "noScreenshotResidue",
    "privacyOutputSafe",
    "expectedPresenceModeIds = [\"default\", \"focus\", \"quiet\", \"sleep\"]"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-35 runner keeps output to safe summary tokens", () => {
  for (const token of [
    "safeSummaryOnly: true",
    "eventId: event.eventId",
    "reason: event.bubbleReason",
    "stateId: event.actionStateId",
    "actionType: getPetActionState(event.actionStateId).actionType",
    "actionType: payload.type",
    "modeId: payload.modeId",
    "presenceModeId: payload.presenceModeId",
    "status: event.interruptPolicy",
    "count: 1",
    "durationMs: payload.durationMs",
    "textLength:"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-35 runner forbids dangerous output patterns and raw private fields", () => {
  const sourceWithoutForbiddenList = runnerSource.replace(
    /const forbiddenOutputPatterns = \[[\s\S]*?\];/,
    ""
  );
  const forbiddenPatterns = [
    /providerRequestBody/i,
    /requestBody/i,
    /factCardBody/i,
    /memoryCardBody/i,
    /userMessage/i,
    /assistantMessage/i,
    /messageText/i,
    /bubbleText/i,
    /prompt/i,
    /apiKey/i,
    /Authorization/i,
    /safeQuery/i,
    /snippet/i,
    /expressionName/i,
    /motionPath/i,
    /resourcePath/i,
    /partId/i,
    /\.motion3\.json/i,
    /\.exp3\.json/i,
    /[A-Za-z]:[\\/]/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(sourceWithoutForbiddenList, pattern);
  }

  assert.doesNotMatch(sourceWithoutForbiddenList, /runDir\s*:/);
  assert.doesNotMatch(sourceWithoutForbiddenList, /appDataDir\s*:/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
