import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-38-low-frequency-companion-safe-context-tag-selection-real-ui.mjs",
  "utf8"
);

test("p2-38 package command builds and runs the safe context tag selection real UI runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-38-low-frequency-companion-safe-context-tag-selection"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-38-low-frequency-companion-safe-context-tag-selection-real-ui.mjs"
  );
});

test("p2-38 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-38-low-frequency-companion-safe-context-tag-selection-runner\.test\.mts/
  );
});

test("p2-38 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: \"1\"",
    "provider: \"fake\"",
    "providerFixture: \"FakeProvider\"",
    "safeSummaryOnly: true"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_PROVIDER:\s*"(?!fake)/);
});

test("p2-38 runner fixes evening time band and accelerates idle plus low frequency intervals", () => {
  for (const token of [
    "const fixedTimeBand = \"evening\"",
    "AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: fixedTimeBand",
    "AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS",
    "P2_38_IDLE_INTERVAL_MS || \"650\"",
    "AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS",
    "P2_38_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || \"700\""
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-38 runner validates startup to first idle to context settle sequence", () => {
  for (const token of [
    "startup_presence_ready",
    "idle-presence-check",
    "idle presence check",
    "context-settle",
    "context settle",
    "idle_presence_evening",
    "idle_presence_context_settle",
    "lowFrequencySequenceStable",
    "firstIdleLowFrequencySafeSummary",
    "secondIdleLowFrequencySafeSummary"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-38 runner checks renderer DOM dataset exposes only safe bubble keys", () => {
  for (const token of [
    "allowedDomDatasetKeys",
    "\"lineId\"",
    "\"reason\"",
    "\"state\"",
    "forbiddenDomDatasetKeys",
    "\"eventId\"",
    "\"timeBand\"",
    "\"safeContextTag\"",
    "\"contextTag\"",
    "rendererDomDatasetNoForbiddenKeys",
    "rendererDomDatasetSafeShape",
    "unexpectedDatasetKeys"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-38 runner matches proactive bubble telemetry to DOM line id", () => {
  for (const token of [
    "waitForProactiveBubble",
    "matchesBubbleTelemetry",
    "firstIdleBubbleMatchesTelemetry",
    "secondIdleBubbleMatchesTelemetry",
    "event.payload?.lineId === bubble.lineId",
    "event.payload?.reason === bubble.reason"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-38 runner outputs low-frequency safe summaries without raw event ids or private surfaces", () => {
  for (const token of [
    "summarizeLowFrequencyEvent",
    "safeSummaryLabel: payload.safeSummaryLabel",
    "countSafeTelemetry",
    "redactKnownInternalRuntimeTelemetry",
    "delete payload.eventId",
    "privacyOutputSafe"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  const lowFrequencySummary = extractFunctionSource("summarizeLowFrequencyEvent");
  assert.match(lowFrequencySummary, /safeSummaryLabel/);
  assert.doesNotMatch(lowFrequencySummary, /eventId/);

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
    /apiKey/i,
    /Authorization/i,
    /safeQuery/i,
    /snippet/i,
    /expressionName/i,
    /motionPath/i,
    /resourcePath/i,
    /partId/i,
    /[A-Za-z]:[\\/]/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(sourceWithoutForbiddenList, pattern);
  }
});

function extractFunctionSource(name: string): string {
  const pattern = new RegExp(`function ${escapeRegExp(name)}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
