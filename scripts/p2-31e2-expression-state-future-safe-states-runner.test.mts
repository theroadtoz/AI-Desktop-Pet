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

test("p2-31e2 runner keeps local provider busy coverage without claiming local model quality", () => {
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
});

test("p2-31e2 runner requires local-model-busy and memory safe states", () => {
  for (const token of [
    "local-provider-request-local-model-busy-dark",
    "state_local_model_busy",
    "local-model-busy",
    "replyThinking",
    "expressionPresetId: \"dark\"",
    "localProviderDoesNotUseGenericWaitingReason",
    "chat_reply_waiting",
    "fake-provider-memory-injected-happy",
    "state_memory_injected",
    "memory-injected",
    "expressionPresetId: \"happy\"",
    "fake-provider-memory-skipped-presentation-only",
    "state_memory_skipped",
    "memory-skipped",
    "quietNod"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-31e2 runner requires search and proactive safe states", () => {
  for (const token of [
    "fake-provider-search-cited-glasses",
    "state_search_cited",
    "search-cited",
    "readingIdle",
    "expressionPresetId: \"glasses\"",
    "fakeProviderSearchStateObserved",
    "proactive-bubble-visible-happy",
    "state_proactive_bubble_visible",
    "proactive-bubble-visible",
    "softSmile",
    "expressionPresetId: \"happy\"",
    "proactiveBubbleStateObserved"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-31e2 runner uses fake provider only for the memory scenario and hides dynamic seeds", () => {
  for (const token of [
    "scenario=fake-provider-memory-safe-states",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "window.memoryApi.setEnabled(true)",
    "privateSeeds.push",
    "memorySeedOutput: false",
    "privateSeedCount",
    "containsForbiddenOutput(privacyText, privateSeeds)",
    "isSafeSummary(summary, privateSeeds)"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.doesNotMatch(runnerSource, /observed:\s*.*privateSeeds|expected:\s*.*privateSeeds/);
});

test("p2-31e2 runner hides search details and proactive bubble text", () => {
  for (const token of [
    "runFakeProviderSearchCitationScenario",
    "privateSearchSeed",
    "privateTitleSeed",
    "privateSnippetSeed",
    "privateUrlSeed",
    "createFakeMcpSearchServerSource",
    "searchQueryOutput: false",
    "searchCitationDetailOutput: false",
    "proactiveBubbleBodyOutput: false",
    "containsForbiddenOutput(privacyText, privateSeeds)",
    "isSafeSummary(summary, privateSeeds)"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  assert.doesNotMatch(runnerSource, /observed:\s*.*private(Search|Title|Snippet|Url)Seed|expected:\s*.*private(Search|Title|Snippet|Url)Seed/);
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
  ).replace(
    /const sensitiveSeed = \[[\s\S]*?\]\.join\(""\);/,
    "const sensitiveSeed = '<private-seed>';"
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
    "safeSummaryOnly: true",
    "memorySeedOutput: false",
    "searchQueryOutput: false",
    "searchCitationDetailOutput: false",
    "proactiveBubbleBodyOutput: false"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
