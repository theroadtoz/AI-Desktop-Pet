import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-36-low-frequency-companion-event-pool-runtime-integration-real-ui.mjs",
  "utf8"
);

test("p2-36 package command builds and runs the low frequency companion event real UI runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-36-low-frequency-companion-event-pool-runtime-integration"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-36-low-frequency-companion-event-pool-runtime-integration-real-ui.mjs"
  );
});

test("p2-36 runner uses real UI harness, FakeProvider isolation, safe summary output, and cleanup", () => {
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

test("p2-36 runner sets accelerated idle and low frequency interval acceptance env", () => {
  for (const token of [
    "AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS",
    "P2_36_IDLE_INTERVAL_MS || \"900\"",
    "AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS",
    "P2_36_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || \"8000\""
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-36 runner validates runtime event whitelist and forbids source-bound future events", () => {
  for (const token of [
    "low_frequency_companion_event",
    "runtimeAllowedEventIds",
    "idle-presence-check",
    "context-settle",
    "mode-presence-echo",
    "forbiddenRuntimeEventIds",
    "memory-safe-pulse",
    "search-citation-pulse",
    "runtimeAllowed",
    "runtimeForbidden"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-36 runner checks renderer payload stays event-pool agnostic", () => {
  for (const token of [
    "rendererPayloadNoEventIdLeak",
    "hasEventIdKey",
    "hasForbiddenEventIdLeak",
    "datasetKeys",
    "Object.hasOwn(dataset, 'eventId')",
    "text.includes(eventId)",
    "Object.values(dataset).includes(eventId)"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-36 runner covers minimum interval, chat suppression, and sleep suppression", () => {
  for (const token of [
    "proactive_speech_bubble",
    "minimum_interval",
    "minimumIntervalNoSecondShown",
    "P2_36_MINIMUM_INTERVAL_OBSERVE_MS || 6200",
    "chatSuppressesNewShownEvents",
    "P2_36_CHAT_SUPPRESSION_WINDOW_MS || 2600",
    "sleepSuppressesNewShownEvents",
    "P2_36_SLEEP_SUPPRESSION_WINDOW_MS || 2600",
    "setPresenceMode(chat, \"sleep\")"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-36 runner keeps output to safe summaries without raw private surfaces", () => {
  for (const token of [
    "summarizeBubble",
    "summarizeLowFrequencyEvent",
    "summarizeProactiveBubble",
    "countSafeTelemetry",
    "stripKnownInternalRuntimeTelemetry",
    "privacyOutputSafe"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
