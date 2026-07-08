import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-48-history-summary-aware-proactive-bubble-safety-real-ui.mjs",
  "utf8"
);
const appSource = readFileSync("src/main/app.ts", "utf8");
const dailySource = readFileSync("src/shared/daily-state-orchestration.ts", "utf8");
const bubbleSource = readFileSync("src/shared/proactive-speech-bubble.ts", "utf8");
const preloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");

test("p2-48 package command builds and runs the compressed-context proactive bubble runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-48-history-summary-aware-proactive-bubble-safety"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-48-history-summary-aware-proactive-bubble-safety-real-ui.mjs"
  );
});

test("p2-48 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-48-history-summary-aware-proactive-bubble-safety-runner\.test\.mts/
  );
});

test("p2-48 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
  for (const token of [
    "createRealUiRunContext",
    "startElectron",
    "connectToElectron",
    "waitForWindow",
    "openHistorySettings",
    "readPrivacyCheckText",
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

test("p2-48 runner seeds long local history and verifies compressed context before bubble display", () => {
  for (const token of [
    "prepareSeededHistory",
    "selectSeededHistory",
    "continueSeededHistory",
    "__p248ContextTransparencyEvents",
    "compressedContextObserved",
    "contextBudget.compressed === true",
    "contextBudget.summaryMessageCount === 1",
    "contextBudget.summarizedMessageCount > 0",
    "contextBudget.recentMessageCount <= 8"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-48 runner verifies the fixed enum-only low-frequency event and bubble line", () => {
  for (const token of [
    "history-summary-pulse",
    "context compression pulse",
    "idle_presence_history_summary",
    "waitForCompressedContextBubble",
    "waitForLowFrequencyEvent",
    "waitForProactiveBubble",
    "historyLowFrequencySafeSummary",
    "historyBubbleLineShown",
    "historyBubbleMatchesTelemetry"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-48 implementation only derives the event from safe context budget counts", () => {
  assert.match(dailySource, /eventId: "history-summary-pulse"/);
  assert.match(dailySource, /safeSummaryLabel: "context compression pulse"/);
  assert.match(bubbleSource, /"history_summary_safe"/);
  assert.match(bubbleSource, /idle_presence_history_summary/);
  assert.match(preloadSource, /"idle_presence_history_summary"/);

  const queueStart = appSource.indexOf("const contextBudget = budgetChatContext(request.messages);");
  const queueEnd = appSource.indexOf("void resolveWebSearchForLatestMessage", queueStart);
  assert.notEqual(queueStart, -1);
  assert.notEqual(queueEnd, -1);
  const queueSource = appSource.slice(queueStart, queueEnd);
  assert.match(queueSource, /contextBudget\.summary\.compressed/);
  assert.match(queueSource, /contextBudget\.summary\.summaryMessageCount > 0/);
  assert.match(queueSource, /contextBudget\.summary\.summarizedMessageCount > 0/);
  assert.match(queueSource, /queueSourcedLowFrequencyCompanionEvent\("history-summary-pulse", \{\s*actionStateId: "proactive-bubble-visible"\s*\}\)/);
  assert.doesNotMatch(
    queueSource,
    /providerMessages|summaryText|summaryBody|submittedMessage\.content|userMessage|assistantMessage|safeQuery|webSearch|prompt/i
  );
});

test("p2-48 runner checks DOM and output privacy boundaries", () => {
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
    "rendererDomDatasetSafeShape",
    "privacyOutputSafe",
    "redactKnownInternalRuntimeTelemetry",
    "delete payload.eventId"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }

  const forbiddenList = extractConstArraySource("forbiddenOutputPatterns");
  for (const token of [
    "eventId",
    "safeContextTag",
    "history summary",
    "summary body",
    "providerMessages",
    "userMessage",
    "assistantMessage",
    "messageText",
    "bubbleText",
    "textContent",
    "safeQuery",
    "snippet",
    "url",
    "Authorization"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }
});

function extractConstArraySource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
