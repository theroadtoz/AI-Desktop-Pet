import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-51-expression-visual-sampling-motion-boundary-real-ui.mjs",
  "utf8"
);
const motionAuditSource = readFileSync("scripts/live2d-motion-asset-audit.mts", "utf8");
const motionAuditTestSource = readFileSync("scripts/live2d-motion-asset-audit.test.mts", "utf8");

test("p2-51 package command builds and runs the visual sampling runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-51-expression-visual-sampling-motion-boundary"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-51-expression-visual-sampling-motion-boundary-real-ui.mjs"
  );
});

test("p2-51 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-51-expression-visual-sampling-motion-boundary-runner\.test\.mts/
  );
});

test("p2-51 runner uses real UI harness, FakeProvider isolation, and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "findScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: \"1\"",
    "providerFixture: \"FakeProvider\"",
    "safeSummaryOnly: true",
    "outputPathsPrinted: false"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-51 runner performs representative real UI visual sampling without persistent screenshots", () => {
  for (const token of [
    "representative-runtime-sampling-not-full-exp3-review",
    "visualQaClaim: \"representative-real-ui-sampling\"",
    "fullExpressionAssetReview: false",
    "screenshotPersistence: SCREENSHOT_PERSISTENCE",
    "screenshotFilesWritten: 0",
    "Page.captureScreenshot",
    "decodePng",
    "inflateSync",
    "nonTransparentPixels",
    "visibleColorPixels",
    "readPetSurface",
    "hashPrefix"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-51 runner samples only safe representative expression preset states", () => {
  for (const token of [
    "baseline-settled-frame-visual-sample",
    "default-think-dark-visual-sample",
    "default-listen-happy-visual-sample",
    "focus-work-glasses-visual-sample",
    "expressionPresetId: \"dark\"",
    "expressionPresetId: \"happy\"",
    "expressionPresetId: \"glasses\"",
    "unsampledExpressionPresetIds",
    "sampledExpressionPresetIds"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-51 runner keeps output free of raw resources, paths, and private text", () => {
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
  assert.doesNotMatch(actionSummary, /expressionName|expressionPath|motionPath|resourcePath|partId|messageText|textContent/);
});

test("p2-51 motion boundary keeps current native motion intake blocked", () => {
  for (const token of [
    "auditWitchMotionAssets",
    "PET_MOTION_PRESET_IDS",
    "currentSemanticMotionPresetCount",
    "petMotionPresetIdCount",
    "idleSemanticAllowed",
    "no-semantic-motion-presets",
    "official-sample-reference-only",
    "blocked-missing-license",
    "blockedLicenseStatusesRejected",
    "productionLicenseStatusesAccepted"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.match(motionAuditSource, /function isProductionReadyMotionAssetLicenseStatus/);
  assert.match(motionAuditSource, /project-owned/);
  assert.match(motionAuditSource, /user-provided/);
  assert.match(motionAuditSource, /blocked-license/);
  assert.match(motionAuditTestSource, /reference-only or missing-license assets/);
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

