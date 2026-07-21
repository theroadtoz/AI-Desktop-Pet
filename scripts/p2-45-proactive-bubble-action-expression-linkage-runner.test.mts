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
const mainSource = readFileSync("src/main/app.ts", "utf8");

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
    "scanScenarioPrivacyArtifacts",
    "assertNoScreenshotResidue",
    "cleanupRealUiRun",
    "AI_DESKTOP_PET_PROVIDER: \"fake\"",
    "AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: \"1\"",
    "AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: \"1\"",
    "provider: \"fake\"",
    "providerFixture: \"FakeProvider\"",
    "environmentFixture: \"safe-active\"",
    "safeSummaryOnly: true"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-45 safe-active fixture is acceptance-only and keeps production source paths", () => {
  assert.match(mainSource, /const isP245AcceptanceSafeActive = isAcceptanceTelemetryEnabled &&[\s\S]*AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT/);
  assert.match(mainSource, /proactiveBubbleCoordinator\?\.updateCoarseState\(isP245AcceptanceSafeActive[\s\S]*engagement: "allowed"[\s\S]*: state\)/);
  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION|injectProactiveBubbleCandidateForAcceptance/);
  assert.match(runnerSource, /sendChatTurnAndWait/);
  assert.match(runnerSource, /window\.memoryApi\.setEnabled/);
  assert.match(runnerSource, /window\.webSearchApi\.setSettings/);
});

test("p2-45 applies the acceptance-only coarse context to every isolated scenario without coordinator bypasses", () => {
  const contextFactory = extractFunctionSource("createScenarioContext");
  assert.match(contextFactory, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"/);
  assert.match(contextFactory, /AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: "1"/);
  assert.match(runnerSource, /runIsolatedScenario\("memory"\)/);
  assert.match(runnerSource, /createScenarioContext\("search"/);
  assert.match(runnerSource, /runIsolatedScenario\("search"\)/);
  assert.match(runnerSource, /waitForCandidateTerminal\([\s\S]*candidateId: "startup_daily"/);
  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION|injectProactiveBubbleCandidateForAcceptance|clearProactiveBubbleLedger|resetProactiveBubbleLedger/);
  assert.match(mainSource, /proactiveBubbleCoordinator\?\.updateCoarseState\(isP245AcceptanceSafeActive[\s\S]*engagement: "allowed"[\s\S]*: state\)/);
});

test("p2-45 runner validates memory and search sourced bubbles drive fixed action states", () => {
  for (const token of [
    "runMemoryActionLinkageCase",
    "runSearchActionLinkageCase",
    "waitForSourcedActionLinkage",
    "memory_safe",
    "idle_presence_memory_safe",
    "state_memory_injected",
    "quietNod",
    "memory-injected",
    "search_citation_safe",
    "idle_presence_search_citation",
    "state_search_cited",
    "searchNoteSettle",
    "search-cited",
    "glasses"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-45 waits for high-priority action terminals before releasing sourced candidates", () => {
  assert.match(runnerSource, /ACTION_STABLE_MS = 350/);
  assert.match(runnerSource, /waitForHighPriorityActionsSettled\(10_000\)/);
  assert.match(runnerSource, /pet_interaction_action_started/);
  assert.match(runnerSource, /pet_interaction_action_finished/);
  assert.match(runnerSource, /pet_interaction_action_skipped/);
  assert.match(runnerSource, /const sourceStartIndex = lastTelemetryIndex\(\)/);
  assert.match(runnerSource, /const releaseIndex = lastTelemetryIndex\(\)[\s\S]*await closeChat\(chat\)/);
  assert.match(runnerSource, /AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:[\s\S]*"60000"/);
});

test("p2-45 treats startup as readiness only and leaves startup line selection to its own contract", () => {
  assert.match(runnerSource, /waitForProductionStartupReadiness\(pet\)/);
  assert.match(runnerSource, /event\.type === "first_frame"[\s\S]*15_000/);
  assert.match(runnerSource, /reason === "startup_first_visible_frame"[\s\S]*startup_daily/);
  assert.match(runnerSource, /if \(startupCandidate\.payload\?\.status === "shown"\)[\s\S]*reason: "startup_presence"/);
});

test("p2-45 proves coordinator action-first ordering for conflict-free shown paths", () => {
  assert.match(runnerSource, /waitForCandidateTerminal/);
  assert.match(runnerSource, /inspectCandidateActionFirst/);
  assert.match(runnerSource, /reason: "source_presence"/);
  assert.match(runnerSource, /queuedIndex >= 0 && attemptedIndex > queuedIndex[\s\S]*actionIndex > attemptedIndex && shownIndex > actionIndex/);
  assert.match(runnerSource, /coordinatorActionFirst: observation\.coordinator\.actionFirst/);
  assert.match(runnerSource, /Object\.assign\(checks, prefixChecks\("memory", memoryResult\.checks\)\)/);
  assert.match(runnerSource, /Object\.assign\(checks, prefixChecks\("search", searchResult\.checks\)\)/);
});

test("p2-45 writes closed safe diagnostics before cleanup on success and failure", () => {
  for (const token of [
    "currentStage",
    "currentCaseId",
    "buildSafeDiagnostic",
    "candidateStatus",
    "skipReason",
    "actionLifecycle",
    "terminalStatus",
    "bubbleReason",
    "candidateQueued",
    "candidateAttempted",
    "actionStarted",
    "actionTerminalObserved",
    "bubbleShown",
    "candidateShown",
    "candidateNotSkipped",
    "completedChecksPassed"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
  assert.match(runnerSource, /catch \(error\) \{[\s\S]*const diagnostic = buildSafeDiagnostic\(checks\)[\s\S]*writeResult\([\s\S]*diagnostic,[\s\S]*checks: diagnostic\.assertions/);
  assert.match(runnerSource, /finally \{[\s\S]*stopElectron[\s\S]*cleanupRealUiRun/);
  const diagnosticSource = extractFunctionSource("buildSafeDiagnostic");
  assert.doesNotMatch(diagnosticSource, /textContent|messageText|safeQuery|snippet|url|title|resourcePath|motionPath/);
});

test("p2-45 startup diagnostics cover production readiness timing without content", () => {
  for (const token of [
    "firstFrameObserved",
    "appearanceStarted",
    "appearanceTerminalObserved",
    "startupCandidateQueued",
    "startupCandidateTerminal",
    "startupBubbleShown",
    "startupCandidateStatus",
    "startupSkipReason",
    "startupAppearanceLifecycle",
    "startupTerminalStatus",
    "startupBubbleReason",
    "scenarioElapsedMs",
    "firstFrameToCandidateMs"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
  assert.match(runnerSource, /event\.type === "first_frame"/);
  assert.match(runnerSource, /candidateId === "startup_daily"/);
  assert.match(runnerSource, /reason === "startup_first_visible_frame"/);
});

test("p2-45 isolates memory and search lifecycles with bounded cleanup", () => {
  assert.match(runnerSource, /runIsolatedScenario\("memory"\)[\s\S]*await cleanupScenario\(context\)[\s\S]*createScenarioContext\("search"[\s\S]*runIsolatedScenario\("search"\)/);
  assert.match(runnerSource, /const cleanedContexts = new Set\(\)/);
  assert.match(runnerSource, /async function cleanupScenario\(runContext\)[\s\S]*await stopElectron\(runContext\)[\s\S]*cleanupRealUiRun\(runContext\)/);
  assert.match(runnerSource, /RUNNER_TOTAL_TIMEOUT_MS = 180_000/);
  assert.match(runnerSource, /AbortController\(\)[\s\S]*runner_total_timeout/);
  assert.match(runnerSource, /throwIfRunnerAborted\(\)/);
});

test("p2-45 search uses the supported bundled production profile and restores its fixture", () => {
  assert.match(runnerSource, /command: "bundled-baidu-search"/);
  assert.match(runnerSource, /args: \[\]/);
  assert.match(runnerSource, /toolName: "search"/);
  assert.doesNotMatch(runnerSource, /command: \$\{JSON\.stringify\(process\.execPath\)\}/);
  assert.match(runnerSource, /installBundledSearchFixture\(\)/);
  assert.match(runnerSource, /restoreBundledSearchFixture\(\)/);
  assert.match(runnerSource, /finally \{[\s\S]*cleanupScenariosAndRestore\(contexts, cleanupScenario, restoreBundledSearchFixture\)/);
  assert.match(runnerSource, /bundledServerBackup = readFileSync\(bundledServerPath\)/);
  assert.match(runnerSource, /writeFileSync\(bundledServerPath, bundledServerBackup\)/);
  assert.match(runnerSource, /name: "search"/);
});

test("p2-45 restores the bundled fixture after every cleanup attempt even when cleanup fails", async () => {
  const cleanupAll = Function(`return (${extractFunctionSource("cleanupScenariosAndRestore")})`)() as
    (contexts: string[], cleanup: (context: string) => Promise<void>, restore: () => void) => Promise<void>;
  const calls: string[] = [];
  await assert.rejects(
    cleanupAll(
      ["memory", "search"],
      async (context) => {
        calls.push(`cleanup:${context}`);
        if (context === "memory") throw new Error("cleanup failed");
      },
      () => calls.push("restore")
    ),
    /cleanup failed/
  );
  assert.deepEqual(calls, ["cleanup:memory", "cleanup:search", "restore"]);
  assert.match(extractFunctionSource("cleanupScenariosAndRestore"), /try \{[\s\S]*for \(const runContext[\s\S]*catch \(error\)[\s\S]*\} finally \{[\s\S]*restore\(\)/);
});

test("p2-45 requires source action start terminal and shown ordering", () => {
  assert.match(runnerSource, /waitForPetActionStarted/);
  assert.match(runnerSource, /waitForPetActionTerminal/);
  assert.match(runnerSource, /actionTerminalIndex > shownIndex/);
  assert.match(runnerSource, /actionTerminalObserved: observation\.actionTerminal\.terminalStatus === "finished"/);
  assert.match(runnerSource, /observation\.bubble\.reason === "source_presence"/);
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
  assert.match(runnerSource, /sanitizeRunnerInfrastructurePaths/);
  assert.match(runnerSource, /runContext\.runDir/);
  assert.match(runnerSource, /runContext\.appDataDir/);
  assert.doesNotMatch(extractFunctionSource("sanitizeRunnerInfrastructurePaths"), /runContext\.root/);
  assert.match(runnerSource, /"\[runner-path\]"/);
  assert.match(runnerSource, /privacyOutputSafe/);
});

test("p2-45 privacy patterns allow closed metadata but reject content-bearing fields", () => {
  const forbiddenPatterns = Function(`return ${extractConstArraySource("forbiddenOutputPatterns")
    .replace(/^const forbiddenOutputPatterns = /, "")
    .replace(/;$/, "")}`)() as RegExp[];
  const isSafe = (value: unknown) => !forbiddenPatterns.some((pattern) => pattern.test(JSON.stringify(value)));

  assert.equal(isSafe({ promptTemplateProfile: "local-small-model", webSearchResultCount: 1 }), true);
  assert.equal(isSafe({ prompt: "raw" }), false);
  assert.equal(isSafe({ providerMessages: [] }), false);
  assert.equal(isSafe({ safeQuery: "raw" }), false);
  assert.equal(isSafe({ title: "raw" }), false);
  assert.equal(isSafe({ endpoint: "https://example.invalid/private" }), false);
  assert.equal(isSafe({ file: "C:\\private\\data.json" }), false);
});

test("p2-45 privacy diagnostics separate artifact source and precise structured fields", () => {
  for (const token of [
    "collectScenarioPrivacyArtifacts",
    "inspectTelemetryPrivacy",
    "inspectStructuredPrivacyValue",
    "inspectPrivacyText",
    "dedupePrivacyMatches",
    "privacyDiagnostic",
    "legacyMatches",
    "verificationSources",
    '"telemetry"',
    '"electron_stdout"',
    '"electron_stderr"',
    '"result_payload"',
    'fieldClass: "structured_key"',
    'fieldClass: "string_value"',
    'fieldClass: "raw_text"'
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
  assert.doesNotMatch(runnerSource, /readPrivacyCheckText\(/);
  assert.doesNotMatch(runnerSource, /isSafeOutput\(summary\)/);
  assert.match(runnerSource, /checks\.privacyOutputSafe = memoryResult\.privacyScan\.safe &&[\s\S]*searchResult\.privacyScan\.safe &&[\s\S]*resultPrivacyScan\.matches\.length === 0/);
  assert.match(runnerSource, /\["telemetry", "electron_stdout", "electron_stderr"\]/);
  assert.match(runnerSource, /\["result_payload"\]/);
  assert.match(runnerSource, /\["runner_progress", "progress\.log", false\]/);
  assert.match(runnerSource, /\["electron_stderr", "electron\.stderr\.log", true\]/);
  assert.match(runnerSource, /for \(const \[source, fileName, authoritative\] of/);
  assert.match(runnerSource, /if \(artifact\.authoritative\)/);
  assert.match(runnerSource, /inspectElectronOutputPrivacy\(artifact\.text, artifact\.source, runContext\)/);
});

test("p2-45 structured privacy scan keeps safe telemetry metadata and rejects raw payload fields", () => {
  const fieldRulesSource = extractConstObjectSource("forbiddenStructuredFieldRules");
  const fieldRules = Function(`return ${fieldRulesSource
    .replace(/^const forbiddenStructuredFieldRules = /, "")
    .replace(/;$/, "")}`)() as Record<string, string>;
  const safeTelemetryKeys = ["eventId", "safeContextTag", "promptTemplateProfile", "webSearchResultCount"];
  for (const key of safeTelemetryKeys) assert.equal(fieldRules[key], undefined);
  for (const key of [
    "prompt",
    "providerMessages",
    "messages",
    "safeQuery",
    "snippet",
    "domain",
    "url",
    "title",
    "apiKey",
    "apiKeyRef",
    "resourcePath",
    "motionPath"
  ]) assert.equal(typeof fieldRules[key], "string");

  assert.match(runnerSource, /for \(const \[key, nestedValue\] of Object\.entries\(value\)\)/);
  assert.match(runnerSource, /forbiddenStructuredValuePatterns/);
  assert.match(runnerSource, /https\?:\\\/\\\/\\S\+/);
  assert.match(runnerSource, /\\b\[A-Za-z\]:\[\\\\\/\]/);
});

test("p2-45 normalizes only runner-owned telemetry paths and exact Electron startup notices", () => {
  assert.match(runnerSource, /inspectTelemetryPrivacy\(sanitizedText, runContext\)/);
  assert.match(runnerSource, /inspectStructuredPrivacyValue\(event, "telemetry", \[\], runContext\)/);
  assert.match(runnerSource, /const inspectedValue = runContext \? sanitizeRunnerInfrastructurePaths\(value, runContext\) : value/);
  assert.match(runnerSource, /\.sort\(\(left, right\) => right\.pathValue\.length - left\.pathValue\.length\)/);
  const sanitizerSource = extractFunctionSource("sanitizeElectronInfrastructureOutput");
  assert.match(sanitizerSource, /electronSecurityWarningBlock\.every/);
  assert.match(sanitizerSource, /lines\[index \+ offset\] === line/);
  assert.match(sanitizerSource, /index \+= electronSecurityWarningBlock\.length/);
  assert.doesNotMatch(sanitizerSource, /includes\(|startsWith\(|https|network_location_value|replace\(\/\.\*\//);
  assert.match(runnerSource, /inspectElectronOutputPrivacy\(artifact\.text, artifact\.source, runContext\)/);

  const forbiddenPatterns = Function(`return ${extractConstArraySource("forbiddenOutputPatterns")
    .replace(/^const forbiddenOutputPatterns = /, "")
    .replace(/;$/, "")}`)() as RegExp[];
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test("raw https://example.invalid/private")), true);
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test("C:\\private\\payload.json")), true);

  const warningBlock = Function(`return ${extractConstArraySource("electronSecurityWarningBlock")
    .replace(/^const electronSecurityWarningBlock = /, "")
    .replace(/;$/, "")}`)() as string[];
  const sanitizeElectronOutput = Function("electronSecurityWarningBlock", `return (${extractFunctionSource("sanitizeElectronInfrastructureOutput")})`)(warningBlock) as
    (text: string) => string;
  const ordinaryUrlLine = "product log https://example.invalid/private";
  assert.equal(sanitizeElectronOutput([...warningBlock, ordinaryUrlLine].join("\n")), ordinaryUrlLine);
  assert.equal(sanitizeElectronOutput([...warningBlock.slice(0, -1), ordinaryUrlLine].join("\n")), [...warningBlock.slice(0, -1), ordinaryUrlLine].join("\n"));
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test(sanitizeElectronOutput(ordinaryUrlLine))), true);

  const isPathValueBoundary = Function(`return (${extractFunctionSource("isPathValueBoundary")})`)() as
    (character: string) => boolean;
  const replaceOwnedPathValue = Function(
    "isPathValueBoundary",
    `return (${extractFunctionSource("replaceOwnedPathValue")})`
  )(isPathValueBoundary) as (text: string, path: { pathValue: string; allowDescendants: boolean }) => string;
  const sanitizePaths = Function(
    "bundledServerPath",
    "replaceOwnedPathValue",
    `return (${extractFunctionSource("sanitizeRunnerInfrastructurePaths")})`
  )("E:\\repo\\dist\\search.js", replaceOwnedPathValue) as
    (text: string, context: Record<string, string>) => string;
  const context = {
    root: "E:\\repo",
    runDir: "E:\\repo\\.tmp\\run",
    appDataDir: "E:\\repo\\.tmp\\run\\user-data"
  };
  const allowedPaths = [
    "E:\\repo\\.tmp\\run",
    "E:\\repo\\.tmp\\run\\logs\\telemetry.jsonl",
    "E:\\repo\\.tmp\\run\\user-data",
    "E:\\repo\\.tmp\\run\\user-data\\logs\\app.log",
    "E:\\repo\\dist\\search.js"
  ];
  const rejectedPaths = [
    "E:\\repo\\private\\payload.json",
    "E:\\repo\\.tmp\\run-other\\payload.json",
    "E:\\repo\\.tmp\\runaway\\payload.json",
    "E:\\repo\\dist\\search.js.bak",
    "E:\\repo\\dist\\search.js\\child"
  ];
  for (const pathValue of allowedPaths) assert.doesNotMatch(sanitizePaths(pathValue, context), /\b[A-Za-z]:[\\/]/);
  for (const pathValue of rejectedPaths) assert.match(sanitizePaths(pathValue, context), /\b[A-Za-z]:[\\/]/);

  const privacyRuleIds = Function(`return ${extractConstArraySource("privacyRuleIds")
    .replace(/^const privacyRuleIds = /, "")
    .replace(/;$/, "")}`)() as string[];
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
    (text: string, source: string, runContext: Record<string, string>) => Array<{ source: string }>;
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
    (value: unknown, source: string, matches?: unknown[], runContext?: Record<string, string>) => { matches: unknown[] };
  const inspectTelemetry = Function(
    "inspectStructuredPrivacyValue",
    "inspectPrivacyText",
    `return (${extractFunctionSource("inspectTelemetryPrivacy")})`
  )(inspectStructured, inspectPrivacyText) as
    (text: string, runContext: Record<string, string>) => unknown[];

  for (const pathValue of allowedPaths) {
    assert.deepEqual(inspectTelemetry(JSON.stringify({ type: "startup", payload: { path: pathValue } }), context), []);
    assert.deepEqual(inspectElectronOutput(pathValue, "electron_stdout", context), []);
    assert.deepEqual(inspectElectronOutput(pathValue, "electron_stderr", context), []);
    assert.deepEqual(inspectStructured({ path: pathValue }, "result_payload", [], context).matches, []);
  }
  for (const pathValue of rejectedPaths) {
    assert.notDeepEqual(inspectTelemetry(JSON.stringify({ type: "startup", payload: { path: pathValue } }), context), []);
    assert.equal(inspectElectronOutput(pathValue, "electron_stdout", context)[0]?.source, "electron_stdout");
    assert.equal(inspectElectronOutput(pathValue, "electron_stderr", context)[0]?.source, "electron_stderr");
    assert.notDeepEqual(inspectStructured({ path: pathValue }, "result_payload", [], context).matches, []);
  }
  assert.deepEqual(inspectElectronOutput(warningBlock.join("\n"), "electron_stderr", context), []);
  assert.deepEqual(inspectElectronOutput("startup E:\\repo\\.tmp\\run\\user-data", "electron_stderr", context), []);
  assert.equal(inspectElectronOutput(ordinaryUrlLine, "electron_stderr", context)[0]?.source, "electron_stderr");
  assert.equal(inspectElectronOutput('\"prompt\": \"private\"', "electron_stderr", context)[0]?.source, "electron_stderr");
  assert.equal(inspectElectronOutput("C:\\private\\payload.json", "electron_stderr", context)[0]?.source, "electron_stderr");
});

function extractFunctionSource(name: string): string {
  const pattern = new RegExp(`(?:async )?function ${escapeRegExp(name)}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
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

function extractConstObjectSource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\{[\\s\\S]*?\\n\\};`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const object ${name}`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
