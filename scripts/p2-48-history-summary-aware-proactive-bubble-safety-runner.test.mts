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

test("p2-48 runner verifies the fixed enum-only source candidate and bubble line", () => {
  for (const token of [
    "history-summary-pulse",
    "context compression pulse",
    "idle_presence_history_summary",
    "waitForCompressedContextBubble",
    "waitForProactiveBubble",
    "history_summary_safe",
    "source_presence",
    "state_proactive_bubble_visible",
    "historyCoordinatorActionFirst",
    "historyLowFrequencyDefinitionSafe",
    "historyCoordinatorSourceShown",
    "unrelatedIdleBubbleDidNotConsumeLedger",
    "historyBubbleLineShown",
    "historyBubbleMatchesTelemetry"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
  assert.doesNotMatch(extractFunctionSource("waitForCompressedContextBubble"), /waitForLowFrequencyEvent/);
  assert.match(runnerSource, /statuses\.join\(","\) === "queued,attempted,shown"/);
  assert.match(runnerSource, /countShownIdleCandidatesBetween/);
});

test("p2-48 runner follows first-frame startup and coordinator action-first ordering", () => {
  assert.match(runnerSource, /waitForProductionStartupReadiness/);
  assert.match(runnerSource, /event\.type === "first_frame"/);
  assert.match(runnerSource, /reason === "startup_first_visible_frame"/);
  assert.match(runnerSource, /candidateId: "startup_daily"/);
  assert.match(runnerSource, /candidateId: "history_summary_safe"/);
  assert.match(runnerSource, /reason: "source_presence"/);
  assert.match(runnerSource, /event\.__index > Math\.max\(attemptedIndex, releaseIndex\) && event\.__index < shownIndex/);
  assert.match(runnerSource, /attemptedIndex > queuedIndex && actionIndex > attemptedIndex && shownIndex > actionIndex/);
  assert.doesNotMatch(
    extractFunctionSource("waitForCompressedContextBubble"),
    /reason:\s*"idle_presence"/
  );
});

test("p2-48 runner settles reply actions before releasing the waiting source candidate", () => {
  assert.match(runnerSource, /setStage\("compressed_reply_action_settle"\)/);
  assert.match(runnerSource, /await waitForHighPriorityActionsSettled\(signal, 12_000\)/);
  assert.match(runnerSource, /const releaseIndex = lastTelemetryIndex\(\)/);
  assert.match(runnerSource, /await closeChat\(signal, chat\)/);
  assert.match(runnerSource, /const ACTION_STABLE_MS = 350/);
});

test("p2-48 runner isolates real OS engagement without bypassing coordinator or ledger", () => {
  assert.match(runnerSource, /AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: "1"/);
  assert.match(runnerSource, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"/);
  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION/);
  assert.doesNotMatch(runnerSource, /injectProactiveCandidate|clear.*Ledger|delete.*ledger/i);
  assert.match(runnerSource, /process\.env\.P2_48_IDLE_INTERVAL_MS \|\| "60000"/);
  assert.doesNotMatch(runnerSource, /P2_48_IDLE_INTERVAL_MS \|\| "650"/);
  assert.doesNotMatch(runnerSource, /GLOBAL_COOLDOWN|globalCooldownMs|classCooldownMs|lineCooldownMs/);
  assert.match(runnerSource, /waitForCandidateTerminal/);
  assert.match(runnerSource, /inspectCandidateActionFirst/);
});

test("p2-48 diagnostics preserve coordinator and action cooldown reasons as closed enums", () => {
  const candidateNormalizer = extractFunctionSource("normalizeSkipReason");
  for (const reason of ["global_cooldown", "class_cooldown", "line_cooldown", "daily_class_limit", "daily_total_limit"]) {
    assert.match(candidateNormalizer, new RegExp(escapeRegExp(reason)));
  }
  const actionNormalizer = extractFunctionSource("normalizeActionSkipReason");
  for (const reason of ["active_action", "global_cooldown", "same_action_cooldown"]) {
    assert.match(actionNormalizer, new RegExp(escapeRegExp(reason)));
  }
  assert.match(runnerSource, /"chat_reply_waiting", "chat_reply_completed"/);
});

test("p2-48 runner has finite abort-aware steps and closed safe diagnostics", () => {
  assert.match(runnerSource, /const RUNNER_TOTAL_TIMEOUT_MS = Math\.min\(/);
  assert.match(runnerSource, /new AbortController\(\)/);
  assert.match(runnerSource, /runnerAbortController\.abort\(new Error\("runner_total_timeout"\)\)/);
  assert.match(runnerSource, /async function runStep\(signal, operation\)/);
  assert.match(runnerSource, /throwIfAborted\(signal\)/);
  assert.match(runnerSource, /await settleRunSteps\(\)/);
  assert.match(runnerSource, /stage: currentStage/);
  assert.match(runnerSource, /recentTelemetry: events\.slice\(-8\)/);
  assert.match(runnerSource, /summarizeSafeTelemetry/);
  assert.doesNotMatch(extractFunctionSource("summarizeSafeTelemetry"), /\.\.\.event\.payload/);
});

test("p2-48 runner captures and cleans only the owned Electron process identity", () => {
  assert.match(runnerSource, /captureOwnedProcessTree\(child\.pid, process\.pid, "electron\.exe"\)/);
  assert.match(runnerSource, /selectInitialOwnedRootIdentity/);
  assert.match(runnerSource, /isSameOwnedProcessIdentity\(ownedRootIdentity, currentRoot\)/);
  assert.match(runnerSource, /mergeOwnedProcessIdentities/);
  assert.match(runnerSource, /p2-83a-capture-process-tree\.ps1/);
  assert.match(runnerSource, /p2-83a-probe-owned-process-identities\.ps1/);
  assert.match(runnerSource, /p2-83a-wait-owned-exit\.ps1/);
  assert.match(runnerSource, /spawnSync\("taskkill\.exe", \["\/PID", String\(identity\.pid\), "\/F"\]/);
  assert.doesNotMatch(runnerSource, /taskkill\.exe[\s\S]{0,120}"\/T"/);
  assert.match(runnerSource, /summarizeOwnedProcessSurvivors/);
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
    "delete payload.eventId",
    "scanScenarioPrivacyArtifacts",
    "verificationSources: [\"telemetry\", \"electron_stdout\", \"electron_stderr\"]",
    "inspectStructuredPrivacyValue",
    "sanitizeElectronInfrastructureOutput",
    "inspectElectronOutputPrivacy",
    "electron.stderr.log"
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

test("p2-48 treats stderr as authoritative after exact infrastructure normalization", () => {
  const forbiddenPatterns = Function(`return ${extractConstArraySource("forbiddenOutputPatterns")
    .replace(/^const forbiddenOutputPatterns = /, "")
    .replace(/;$/, "")}`)() as RegExp[];
  const privacyRuleIds = Function(`return ${extractConstArraySource("privacyRuleIds")
    .replace(/^const privacyRuleIds = /, "")
    .replace(/;$/, "")}`)() as string[];
  const warningBlock = Function(`return ${extractConstArraySource("electronSecurityWarningBlock")
    .replace(/^const electronSecurityWarningBlock = /, "")
    .replace(/;$/, "")}`)() as string[];
  const runnerContext = {
    root: "E:\\repo",
    runDir: "E:\\repo\\.tmp\\run",
    appDataDir: "E:\\repo\\.tmp\\run\\user-data"
  };
  const isPathValueBoundary = Function(`return (${extractFunctionSource("isPathValueBoundary")})`)() as
    (character: string) => boolean;
  const replaceOwnedPathValue = Function(
    "isPathValueBoundary",
    `return (${extractFunctionSource("replaceOwnedPathValue")})`
  )(isPathValueBoundary) as (text: string, path: { pathValue: string; allowDescendants: boolean }) => string;
  const sanitizePaths = Function(
    "context",
    "replaceOwnedPathValue",
    `return (${extractFunctionSource("sanitizeRunnerInfrastructurePaths")})`
  )(runnerContext, replaceOwnedPathValue) as (text: string, context?: Record<string, string>) => string;
  const sanitizeElectronOutput = Function(
    "electronSecurityWarningBlock",
    `return (${extractFunctionSource("sanitizeElectronInfrastructureOutput")})`
  )(warningBlock) as (text: string) => string;
  const inspectPrivacyText = Function(
    "forbiddenOutputPatterns",
    "privacyRuleIds",
    `return (${extractFunctionSource("inspectPrivacyText")})`
  )(forbiddenPatterns, privacyRuleIds) as (text: string, source: string) => Array<{ source: string }>;
  const inspectElectronOutput = Function(
    "sanitizeRunnerInfrastructurePaths",
    "sanitizeElectronInfrastructureOutput",
    "inspectPrivacyText",
    `return (${extractFunctionSource("inspectElectronOutputPrivacy")})`
  )(sanitizePaths, sanitizeElectronOutput, inspectPrivacyText) as
    (text: string, source: string) => Array<{ source: string }>;

  assert.doesNotMatch(extractFunctionSource("sanitizeRunnerInfrastructurePaths"), /runContext\.root|context\.root/);
  const allowedPaths = [
    "E:\\repo\\.tmp\\run",
    "E:\\repo\\.tmp\\run\\logs\\telemetry.jsonl",
    "E:\\repo\\.tmp\\run\\user-data",
    "E:\\repo\\.tmp\\run\\user-data\\logs\\app.log"
  ];
  const rejectedPaths = [
    "E:\\repo\\private\\payload.json",
    "E:\\repo\\.tmp\\run-other\\payload.json",
    "E:\\repo\\.tmp\\runaway\\payload.json",
    "E:\\repo\\dist\\search.js"
  ];
  for (const pathValue of allowedPaths) assert.doesNotMatch(sanitizePaths(pathValue), /\b[A-Za-z]:[\\/]/);
  for (const pathValue of rejectedPaths) assert.match(sanitizePaths(pathValue), /\b[A-Za-z]:[\\/]/);

  const forbiddenStructuredValuePatterns = Function(`return ${extractConstArraySource("forbiddenStructuredValuePatterns")
    .replace(/^const forbiddenStructuredValuePatterns = /, "")
    .replace(/;$/, "")}`)() as Array<{ ruleId: string; pattern: RegExp }>;
  const forbiddenStructuredFieldRules = Function(`return ${extractConstObjectSource("forbiddenStructuredFieldRules")
    .replace(/^const forbiddenStructuredFieldRules = /, "")
    .replace(/;$/, "")}`)() as Record<string, string>;
  const inspectStructured = Function(
    "forbiddenStructuredValuePatterns",
    "forbiddenStructuredFieldRules",
    "sanitizeRunnerInfrastructurePaths",
    `return (${extractFunctionSource("inspectStructuredPrivacyValue")})`
  )(forbiddenStructuredValuePatterns, forbiddenStructuredFieldRules, sanitizePaths) as
    (value: unknown, source: string, matches: unknown[]) => void;
  const inspectTelemetry = Function(
    "inspectStructuredPrivacyValue",
    "inspectPrivacyText",
    `return (${extractFunctionSource("inspectTelemetryPrivacy")})`
  )(inspectStructured, inspectPrivacyText) as (text: string) => unknown[];

  for (const pathValue of allowedPaths) {
    const resultMatches: unknown[] = [];
    inspectStructured({ path: pathValue }, "result_payload", resultMatches);
    assert.deepEqual(inspectTelemetry(JSON.stringify({ type: "startup", payload: { path: pathValue } })), []);
    assert.deepEqual(inspectElectronOutput(pathValue, "electron_stdout"), []);
    assert.deepEqual(inspectElectronOutput(pathValue, "electron_stderr"), []);
    assert.deepEqual(resultMatches, []);
  }
  for (const pathValue of rejectedPaths) {
    const resultMatches: unknown[] = [];
    inspectStructured({ path: pathValue }, "result_payload", resultMatches);
    assert.notDeepEqual(inspectTelemetry(JSON.stringify({ type: "startup", payload: { path: pathValue } })), []);
    assert.equal(inspectElectronOutput(pathValue, "electron_stdout")[0]?.source, "electron_stdout");
    assert.equal(inspectElectronOutput(pathValue, "electron_stderr")[0]?.source, "electron_stderr");
    assert.notDeepEqual(resultMatches, []);
  }

  assert.deepEqual(inspectElectronOutput(warningBlock.join("\n"), "electron_stderr"), []);
  assert.deepEqual(inspectElectronOutput("E:\\repo\\.tmp\\run\\user-data", "electron_stderr"), []);
  for (const sensitive of [
    '\"prompt\": \"private\"',
    '\"messages\": [\"private\"]',
    '\"safeQuery\": \"private\"',
    "https://example.invalid/private",
    "C:\\private\\payload.json",
    "apiKey: sk-private"
  ]) {
    assert.equal(inspectElectronOutput(sensitive, "electron_stderr")[0]?.source, "electron_stderr");
  }
});

function extractConstArraySource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function extractFunctionSource(name: string): string {
  const start = runnerSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = runnerSource.indexOf(") {", start);
  assert.notEqual(bodyStart, -1, `missing function body ${name}`);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart + 2; index < runnerSource.length; index += 1) {
    if (runnerSource[index] === "{") {
      depth += 1;
      opened = true;
    } else if (runnerSource[index] === "}") {
      depth -= 1;
      if (opened && depth === 0) return runnerSource.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

function extractConstObjectSource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\{[\\s\\S]*?\\n\\};`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const object ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
