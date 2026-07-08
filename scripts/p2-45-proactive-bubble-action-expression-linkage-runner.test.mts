import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-45-proactive-bubble-action-expression-linkage-real-ui.mjs",
  "utf8"
);

test("p2-45 package command builds and runs the proactive bubble action linkage runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-45-proactive-bubble-action-expression-linkage"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-45-proactive-bubble-action-expression-linkage-real-ui.mjs"
  );
});

test("p2-45 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-45-proactive-bubble-action-expression-linkage-runner\.test\.mts/
  );
});

test("p2-45 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
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
});

test("p2-45 runner validates memory and search sourced bubbles drive fixed action states", () => {
  for (const token of [
    "runMemoryActionLinkageCase",
    "runSearchActionLinkageCase",
    "waitForSourcedActionLinkage",
    "memory-safe-pulse",
    "idle_presence_memory_safe",
    "state_memory_injected",
    "quietNod",
    "memory-injected",
    "search-citation-pulse",
    "idle_presence_search_citation",
    "state_search_cited",
    "readingIdle",
    "search-cited",
    "glasses"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-45 runner checks renderer DOM dataset and action telemetry stay safe enum only", () => {
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
    "waitForPetActionStarted",
    "summarizePetAction",
    "expressionPresetId",
    "candidateActionTypes",
    "selectedActionType"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  const actionSummary = extractFunctionSource("summarizePetAction");
  assert.doesNotMatch(actionSummary, /expressionName|partId|motionPath|resourcePath|textContent|messageText/);
});

test("p2-45 runner output forbids raw memory/search/prompt/path data", () => {
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
    "Authorization",
    "expressionName",
    "resourcePath"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }

  assert.match(runnerSource, /delete payload\.eventId/);
  assert.match(runnerSource, /privacyOutputSafe/);
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
