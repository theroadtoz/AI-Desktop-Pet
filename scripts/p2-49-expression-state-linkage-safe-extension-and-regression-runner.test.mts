import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-49-expression-state-linkage-safe-extension-and-regression-real-ui.mjs",
  "utf8"
);

test("p2-49 package command builds and runs the expression state linkage safe extension runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-49-expression-state-linkage-safe-extension-and-regression"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-49-expression-state-linkage-safe-extension-and-regression-real-ui.mjs"
  );
});

test("p2-49 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-49-expression-state-linkage-safe-extension-and-regression-runner\.test\.mts/
  );
});

test("p2-49 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, privacy checks, and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "openHistorySettings",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: \"1\"",
    "provider: \"fake\"",
    "providerFixture: \"FakeProvider\"",
    "safeSummaryOnly: true",
    "privacyOutputSafe"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-49 runner reuses the long compressed history scenario before checking the bubble", () => {
  for (const token of [
    "prepareSeededHistory",
    "selectSeededHistory",
    "continueSeededHistory",
    "__p249ContextTransparencyEvents",
    "compressedContextObserved",
    "contextBudget.compressed === true",
    "contextBudget.summaryMessageCount === 1",
    "contextBudget.summarizedMessageCount > 0",
    "contextBudget.recentMessageCount <= 8"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-49 runner validates history-summary-pulse drives the fixed state, action, and expression", () => {
  for (const token of [
    "history-summary-pulse",
    "context compression pulse",
    "idle_presence_history_summary",
    "waitForCompressedContextActionLinkage",
    "waitForLowFrequencyEvent",
    "waitForProactiveBubble",
    "waitForPetActionStarted",
    "fixedLowFrequencyLinked",
    "state_proactive_bubble_visible",
    "proactive-bubble-visible",
    "softSmile",
    "expressionPresetId: \"happy\"",
    "actionExpressionLinked"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-49 runner checks renderer DOM dataset stays lineId/reason/state only", () => {
  for (const token of [
    "allowedDomDatasetKeys",
    "\"lineId\"",
    "\"reason\"",
    "\"state\"",
    "forbiddenDomDatasetKeys",
    "\"eventId\"",
    "\"safeContextTag\"",
    "\"contextTag\"",
    "rendererDomDatasetNoForbiddenKeys",
    "rendererDomDatasetOnlySafeKeys"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-49 runner output privacy forbids raw fields and redacts runtime-only event ids", () => {
  const forbiddenList = extractConstArraySource("forbiddenOutputPatterns");
  for (const token of [
    "eventId",
    "safeContextTag",
    "history summary",
    "summary body",
    "body",
    "text",
    "providerMessages",
    "search",
    "memory",
    "raw path",
    "expressionName",
    "partId",
    "resourcePath"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }

  for (const token of [
    "redactKnownInternalRuntimeTelemetry",
    "delete payload.eventId",
    "isSafeOutput(summary)",
    "privateTexts.every"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  const lowFrequencySummary = extractFunctionSource("summarizeLowFrequencyEvent");
  const actionSummary = extractFunctionSource("summarizePetAction");
  assert.doesNotMatch(lowFrequencySummary, /\beventId\b|safeContextTag|providerMessages|expressionName|partId|resourcePath/);
  assert.doesNotMatch(actionSummary, /\beventId\b|safeContextTag|providerMessages|expressionName|partId|resourcePath/);
});

function extractConstArraySource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function extractFunctionSource(name: string): string {
  const pattern = new RegExp(`function ${escapeRegExp(name)}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
