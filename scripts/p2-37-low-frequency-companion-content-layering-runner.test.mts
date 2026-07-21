import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG } from "../src/shared/proactive-speech-bubble.ts";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-37-low-frequency-companion-content-layering-real-ui.mjs",
  "utf8"
);
const p234Source = readFileSync(
  "scripts/p2-34-companion-presence-idle-mode-cadence-real-ui.mjs",
  "utf8"
);
const p236Source = readFileSync(
  "scripts/p2-36-low-frequency-companion-event-pool-runtime-integration-real-ui.mjs",
  "utf8"
);
const p224eSource = readFileSync(
  "scripts/p2-24e-proactive-speech-bubble-v2-real-ui.mjs",
  "utf8"
);
const petPreloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");

test("p2-37 package command builds and runs the content layering real UI runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-37-low-frequency-companion-content-layering"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-37-low-frequency-companion-content-layering-real-ui.mjs"
  );
});

test("p2-37 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-37-low-frequency-companion-content-layering-runner\.test\.mts/
  );
});

test("p2-37 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
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

test("p2-37 runner accelerates idle and low-frequency intervals and fixes time band through acceptance env", () => {
  for (const token of [
    "P2_37_PROACTIVE_SPEECH_BUBBLE_TIME_BAND",
    "P2_37_COMPANION_TIME_BAND",
    "AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: requestedTimeBand",
    "AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS",
    "P2_37_IDLE_INTERVAL_MS || \"850\"",
    "AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS",
    "P2_37_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || \"900\""
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-37 runner validates real low-frequency events and matching proactive bubble telemetry", () => {
  for (const token of [
    "low_frequency_companion_event",
    "proactive_speech_bubble",
    "waitForLowFrequencyEvent",
    "waitForProactiveBubble",
    "defaultIdleLowFrequencyEventShown",
    "defaultIdleBubbleMatchesTelemetry",
    "modeAwareLowFrequencyEventShown",
    "modeAwareBubbleMatchesTelemetry"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-37 runner covers default evening and mode-aware evening content layering", () => {
  for (const token of [
    "contentLayeringPlans",
    "selectedPlan",
    "idle_presence_evening",
    "idle_presence_work_morning",
    "idle_presence_work_afternoon",
    "idle_presence_reading_night",
    "setDialogueMode(chat, selectedPlan.dialogueModeId)",
    "mode_presence_game",
    "idle_presence_game_evening",
    "defaultTimeBandIdleLineShown",
    "modeAwareTimeBandIdleLineShown"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-37 runner checks renderer DOM dataset does not expose eventId or timeBand", () => {
  for (const token of [
    "forbiddenDomDatasetKeys",
    "\"eventId\"",
    "\"timeBand\"",
    "rendererDomDatasetNoEventIdOrTimeBand",
    "rendererDomDatasetSafeShape",
    "datasetKeys",
    "forbiddenDatasetKeys"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-37 runner keeps output to safe summaries without raw private surfaces", () => {
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

test("preload accepts every line while migrated runners keep catalog-backed scoped allowlists", () => {
  for (const lineId of Object.keys(PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG)) {
    const pattern = new RegExp(escapeRegExp(JSON.stringify(lineId)));
    assert.match(petPreloadSource, pattern, `pet preload should allow ${lineId}`);
  }

  assertCatalogBackedScopedLines("p2-34", extractStringSet(p234Source, "safeLineIds"));
  assertCatalogBackedScopedLines("p2-36", extractStringSet(p236Source, "allowedLineIds"));
  assertCatalogBackedScopedLines("p2-24e", extractStringSet(p224eSource, "safeLineIds"));
});

function assertCatalogBackedScopedLines(runnerId: string, lineIds: Set<string>): void {
  assert.ok(lineIds.size > 0, `${runnerId} should keep a scoped safe line allowlist`);
  for (const lineId of lineIds) {
    assert.ok(
      Object.hasOwn(PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG, lineId),
      `${runnerId} scoped line should exist in the catalog: ${lineId}`
    );
  }
  for (const lineId of ["startup_presence_ready", "idle_presence_evening", "mode_presence_focus"]) {
    assert.ok(lineIds.has(lineId), `${runnerId} should retain ${lineId}`);
  }
}

function extractStringSet(source: string, name: string): Set<string> {
  const match = source.match(new RegExp(`const ${escapeRegExp(name)} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `missing string set ${name}`);
  return new Set([...match[1].matchAll(/"([a-z0-9_-]+)"/g)].map((item) => item[1]));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
