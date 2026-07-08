import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-50-expression-preset-visual-qa-state-priority-real-ui.mjs",
  "utf8"
);
const linkageSource = readFileSync("src/shared/pet-expression-state-linkage.ts", "utf8");
const linkageTestSource = readFileSync("scripts/pet-expression-state-linkage.test.mts", "utf8");

test("p2-50 package command builds and runs the expression priority runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-50-expression-preset-visual-qa-state-priority"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-50-expression-preset-visual-qa-state-priority-real-ui.mjs"
  );
});

test("p2-50 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-50-expression-preset-visual-qa-state-priority-runner\.test\.mts/
  );
});

test("p2-50 focus guard blocks needs-visual-check presets without changing default behavior", () => {
  assert.match(linkageSource, /function allowsFocusVisualRisk/);
  assert.match(linkageSource, /presenceModeId !== "focus" \|\| visualRisk !== "needs-visual-check"/);
  assert.match(linkageSource, /allowsFocusVisualRisk\(presenceModeId, preset\.visualRisk\)/);

  for (const token of [
    "default-think-keeps-dark",
    "focus-think-blocks-dark",
    "focus-local-model-busy-blocks-dark",
    "focus-work-keeps-glasses",
    "focus-search-keeps-glasses",
    "quiet-listen-is-presentation-only",
    "sleep-state-is-presentation-only",
    "expression state linkage blocks needs-visual-check presets in focus",
    "expression state linkage never selects medium or high intensity in quiet or sleep"
  ]) {
    assert.match(linkageTestSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-50 runner uses real UI harness, controlled providers, safe output, and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "AI_DESKTOP_PET_PROVIDER: \"local-openai-compatible\"",
    "safeSummaryOnly: true",
    "visualQaClaim: \"telemetry-only-no-screenshot\"",
    "screenshotOutput: false",
    "outputPathsPrinted: false",
    "privacyOutputSafe"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-50 runner validates state priority cases with safe expression preset ids", () => {
  for (const token of [
    "fake-default-think-dark",
    "fake-focus-think-presentation-only",
    "fake-focus-work-glasses",
    "fake-focus-read-glasses",
    "fake-focus-search-glasses",
    "fake-quiet-listen-presentation-only",
    "fake-sleep-state-presentation-only",
    "local-focus-local-model-busy-presentation-only",
    "state_local_model_busy",
    "state_search_cited",
    "expressionPresetId: \"dark\"",
    "expressionPresetId: \"glasses\"",
    "expressionPresetId: null"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-50 runner keeps output free of raw expression resources and private text", () => {
  const forbiddenList = extractConstArraySource("forbiddenOutputPatterns");
  for (const token of [
    "providerRequestBody",
    "factCardBody",
    "search query",
    "safeQuery",
    "snippet",
    "domain",
    "url",
    "title",
    "bubbleText",
    "messageText",
    "textContent",
    "messages",
    "content",
    "prompt",
    "apiKey",
    "Authorization",
    "expressionName",
    "expressionPath",
    "motionPath",
    "resourcePath",
    "partId"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }
  assert.match(forbiddenList, /\/\\\.motion3\\\.json\/i/);
  assert.match(forbiddenList, /\/\\\.exp3\\\.json\/i/);

  const actionSummary = extractFunctionSource("summarizeAction");
  assert.doesNotMatch(actionSummary, /expressionName|expressionPath|resourcePath|partId|messageText|textContent/);
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
