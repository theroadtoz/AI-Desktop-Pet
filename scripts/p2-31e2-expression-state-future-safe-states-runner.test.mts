import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync("scripts/p2-31e2-expression-state-future-safe-states-real-ui.mjs", "utf8");

test("p2-31e2 package command runs the future safe states real UI runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-31e2-expression-state-future-safe-states"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-31e2-expression-state-future-safe-states-real-ui.mjs"
  );
});

test("p2-31e2 runner uses a local provider trigger without claiming local model quality", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "AI_DESKTOP_PET_PROVIDER: \"local-openai-compatible\"",
    "AI_DESKTOP_PET_BASE_URL: \"http://127.0.0.1:9/v1\"",
    "localModelChatQualityClaim: false",
    "localProviderReachabilityRequired: false"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.doesNotMatch(runnerSource, /provider:\s*"fake"/);
});

test("p2-31e2 runner requires local-model-busy with a safe expression preset", () => {
  for (const token of [
    "local-provider-request-local-model-busy-dark",
    "state_local_model_busy",
    "local-model-busy",
    "replyThinking",
    "expressionPresetId: \"dark\"",
    "localProviderDoesNotUseGenericWaitingReason",
    "chat_reply_waiting"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-31e2 runner keeps output to safe summaries and cleans temporary files", () => {
  const sourceWithoutForbiddenList = runnerSource.replace(
    /const forbiddenOutputPatterns = \[[\s\S]*?\];/,
    ""
  ).replace(
    "AI_DESKTOP_PET_BASE_URL: \"http://127.0.0.1:9/v1\",",
    "AI_DESKTOP_PET_BASE_URL: \"<local-test-url>\","
  ).replace(
    "line.includes('\"promptTemplateProfile\"')",
    "line.includes('<provider-profile-enum>')"
  );
  const forbiddenPatterns = [
    /providerRequestBody/i,
    /factCardBody/i,
    /memoryContext\.cards/i,
    /messages/i,
    /content/i,
    /prompt/i,
    /apiKey/i,
    /expressionName/i,
    /expressionPath/i,
    /resourcePath/i,
    /partId/i,
    /\.motion3\.json/i,
    /\.exp3\.json/i,
    /[A-Za-z]:[\\/]/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(sourceWithoutForbiddenList, pattern);
  }

  for (const token of [
    "readPrivacyCheckText",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "safeSummaryOnly: true"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
