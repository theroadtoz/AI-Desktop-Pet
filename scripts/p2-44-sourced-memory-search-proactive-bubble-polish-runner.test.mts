import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-44-sourced-memory-search-proactive-bubble-polish-real-ui.mjs",
  "utf8"
);

test("p2-44 package command builds and runs the sourced memory/search proactive bubble runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-44-sourced-memory-search-proactive-bubble-polish"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-44-sourced-memory-search-proactive-bubble-polish-real-ui.mjs"
  );
});

test("p2-44 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-44-sourced-memory-search-proactive-bubble-polish-runner\.test\.mts/
  );
});

test("p2-44 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
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

test("p2-44 runner validates sourced memory and search citation bubbles after real chat turns", () => {
  for (const token of [
    "runMemoryPulseCase",
    "runSearchCitationPulseCase",
    "window.memoryApi.setEnabled(true)",
    "window.memoryApi.createCard",
    "window.memoryApi.clearCards()",
    "window.webSearchApi.setSettings",
    "memory-safe-pulse",
    "memory safe pulse",
    "idle_presence_memory_safe",
    "search-citation-pulse",
    "search citation pulse",
    "idle_presence_search_citation",
    "waitForSourcedBubble"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-44 runner checks renderer DOM dataset exposes only safe bubble keys", () => {
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

test("p2-44 runner summarizes low-frequency and bubble telemetry without raw source payloads", () => {
  for (const token of [
    "summarizeLowFrequencyEvent",
    "safeSummaryLabel: payload.safeSummaryLabel",
    "summarizeProactiveBubble",
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

  const forbiddenList = extractConstArraySource("forbiddenOutputPatterns");
  for (const token of [
    "safeQuery",
    "snippet",
    "domain",
    "url",
    "title",
    "providerMessages",
    "factCardBody",
    "memoryCardBody",
    "requestBody",
    "Authorization"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }
});

function extractFunctionSource(name: string): string {
  const pattern = new RegExp(`function ${escapeRegExp(name)}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function extractConstArraySource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
