import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const runnerSource = readFileSync(
  "scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs",
  "utf8"
);
const mainSource = readFileSync("src/main/app.ts", "utf8");
const petPreloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");
const petRendererSource = readFileSync("src/renderer/pet/main.ts", "utf8");

test("p2-46 package command builds and runs the proactive bubble user control runner", () => {
  assert.equal(
    packageJson.scripts?.["accept:p2-46-proactive-bubble-frequency-user-control"],
    "npm run build && node --no-warnings --experimental-strip-types scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs"
  );
});

test("p2-46 runner is included in the live2d parameter verification path", () => {
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/p2-46-proactive-bubble-frequency-user-control-runner\.test\.mts/
  );
  assert.match(
    packageJson.scripts?.["test:live2d-parameters"] ?? "",
    /scripts\/proactive-companion-settings\.test\.mts/
  );
});

test("p2-46 runner uses real UI harness, FakeProvider isolation, acceptance telemetry, and cleanup", () => {
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
    "AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: \"1\"",
    "provider: \"fake\"",
    "providerFixture: \"FakeProvider\"",
    "safeSummaryOnly: true"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
  assert.match(mainSource, /const isP245AcceptanceSafeActive = isAcceptanceTelemetryEnabled &&[\s\S]*AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT/);
  assert.match(mainSource, /proactiveBubbleCoordinator\?\.updateCoarseState\(isP245AcceptanceSafeActive[\s\S]*engagement: "allowed"[\s\S]*: state\)/);
  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION|injectProactiveBubbleCandidateForAcceptance/);
});

test("p2-46 runner validates coordinator-era off cadence and source toggles", () => {
  for (const token of [
    "runOffCadenceCase",
    "runSourceToggleCase",
    "proactiveCompanionApi",
    "offStartupCandidateSuppressed",
    "offNoBubbleShown",
    "cadence",
    "memorySourceBubbles",
    "searchSourceBubbles",
    "runtimeOffBubbleState",
    "runtimeOffClearsPendingCandidates",
    "runtimeOffShowsNothingAfterClear",
    "countCoordinatorCandidateEventsAfter",
    "countOpenCoordinatorCandidates",
    "idle_presence_memory_safe",
    "idle_presence_search_citation",
    "memory-safe-pulse",
    "search-citation-pulse"
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
});

test("p2-46 runner waits for production startup coordinator terminal before inspecting DOM", () => {
  assert.match(runnerSource, /waitForFirstFrame\(20_000\)/);
  assert.match(runnerSource, /candidateId === "startup_daily"/);
  assert.match(runnerSource, /\["shown", "skipped", "expired"\]\.includes/);
  assert.match(runnerSource, /startup_candidate_not_shown/);
  assert.match(runnerSource, /waitForBubbleVisible\(pet, \{/);
  assert.match(runnerSource, /startupSkipReason: summarizeSkipReason\("startup_daily"\)/);
  assert.match(runnerSource, /"engagement_blocked"[\s\S]*"interruptibility_not_allowed"[\s\S]*"system_unavailable"/);
});

test("p2-46 runner uses the supported bundled search profile and restores its fixture", () => {
  for (const token of [
    "bundled-baidu-search",
    "baidu-search-mcp-server.js",
    "installBundledSearchFixture",
    "restoreBundledSearchFixture",
    "toolName: \"search\""
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(token)));
  }
  assert.doesNotMatch(runnerSource, /command:\s*\$\{JSON\.stringify\(process\.execPath\)\}/);
  assert.match(runnerSource, /finally \{[\s\S]*cleanupScenariosAndRestore\(contexts, cleanupScenario, restoreBundledSearchFixture\)/);
});

test("p2-46 restores the bundled fixture after every cleanup attempt even when cleanup fails", async () => {
  const cleanupAll = Function(`return (${extractFunctionSource("cleanupScenariosAndRestore")})`)() as
    (contexts: string[], cleanup: (context: string) => Promise<void>, restore: () => void) => Promise<void>;
  const calls: string[] = [];
  await assert.rejects(
    cleanupAll(
      ["off", "sources"],
      async (context) => {
        calls.push(`cleanup:${context}`);
        if (context === "off") throw new Error("cleanup failed");
      },
      () => calls.push("restore")
    ),
    /cleanup failed/
  );
  assert.deepEqual(calls, ["cleanup:off", "cleanup:sources", "restore"]);
  assert.match(extractFunctionSource("cleanupScenariosAndRestore"), /try \{[\s\S]*for \(const runContext[\s\S]*catch \(error\)[\s\S]*\} finally \{[\s\S]*restore\(\)/);
});

test("p2-46 runner has a finite total timeout and idempotent per-scenario cleanup", () => {
  assert.match(runnerSource, /const RUNNER_TOTAL_TIMEOUT_MS = 180_000/);
  assert.match(runnerSource, /new AbortController\(\)/);
  assert.match(runnerSource, /throwIfRunnerAborted\(\)/);
  assert.match(runnerSource, /const cleanedContexts = new Set\(\)/);
  assert.match(runnerSource, /if \(cleanedContexts\.has\(runContext\)\) return/);
});

test("p2-46 privacy filtering is exact for fixed Electron warning output", () => {
  assert.match(runnerSource, /const electronSecurityWarningBlock = \[/);
  assert.match(runnerSource, /electronSecurityWarningBlock\.every/);
  assert.match(runnerSource, /sanitizeRunnerInfrastructurePaths/);
  assert.match(runnerSource, /verificationSources: \["telemetry", "electron_stdout", "electron_stderr"\]/);
  assert.match(runnerSource, /\["runner_progress", "progress\.log", false\]/);
  assert.match(runnerSource, /\["electron_stderr", "electron\.stderr\.log", true\]/);
  assert.match(runnerSource, /inspectElectronOutputPrivacy\(artifact\.text, artifact\.source, runContext\)/);
  assert.match(runnerSource, /artifact\.source === "telemetry"[\s\S]*inspectTelemetryPrivacy/);
  assert.match(runnerSource, /forbiddenStructuredFieldRules/);
  assert.match(runnerSource, /network_location_value/);
  assert.doesNotMatch(runnerSource, /replace\([^\n]*https\?:\\\/\\\//);
});

test("p2-46 treats stderr as authoritative after exact infrastructure normalization", () => {
  const forbiddenPatterns = Function(`return ${extractConstArraySource("forbiddenOutputPatterns")
    .replace(/^const forbiddenOutputPatterns = /, "")
    .replace(/;$/, "")}`)() as RegExp[];
  const privacyRuleIds = Function(`return ${extractConstArraySource("privacyRuleIds")
    .replace(/^const privacyRuleIds = /, "")
    .replace(/;$/, "")}`)() as string[];
  const warningBlock = Function(`return ${extractConstArraySource("electronSecurityWarningBlock")
    .replace(/^const electronSecurityWarningBlock = /, "")
    .replace(/;$/, "")}`)() as string[];
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
    (text: string, source: string, context: Record<string, string>) => Array<{ source: string }>;
  const context = {
    root: "E:\\repo",
    runDir: "E:\\repo\\.tmp\\run",
    appDataDir: "E:\\repo\\.tmp\\run\\user-data"
  };

  assert.doesNotMatch(extractFunctionSource("sanitizeRunnerInfrastructurePaths"), /runContext\.root/);
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
  assert.deepEqual(inspectElectronOutput("E:\\repo\\.tmp\\run\\user-data", "electron_stderr", context), []);
  for (const sensitive of [
    '\"prompt\": \"private\"',
    '\"messages\": [\"private\"]',
    '\"safeQuery\": \"private\"',
    "https://example.invalid/private",
    "C:\\private\\payload.json",
    "apiKey: sk-private"
  ]) {
    assert.equal(inspectElectronOutput(sensitive, "electron_stderr", context)[0]?.source, "electron_stderr");
  }
});

test("p2-46 off cadence clears an already visible renderer bubble without action semantics", () => {
  assert.match(mainSource, /function clearPetProactiveSpeechBubble/);
  assert.match(mainSource, /petWindow\.webContents\.send\("pet:clear-proactive-speech-bubble"\)/);
  assert.match(petPreloadSource, /onClearProactiveSpeechBubble/);
  assert.match(petPreloadSource, /ipcRenderer\.on\("pet:clear-proactive-speech-bubble"/);
  assert.match(petRendererSource, /onClearProactiveSpeechBubble\(\(\) =>/);
  assert.match(petRendererSource, /clearProactiveSpeechBubble\(\)/);
});

test("p2-46 runner keeps output to safe summaries and checks cleanup", () => {
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
    "textContent",
    "bubbleText"
  ]) {
    assert.match(forbiddenList, new RegExp(escapeRegExp(token), "i"));
  }

  assert.match(runnerSource, /delete payload\.eventId/);
  assert.match(runnerSource, /privacyOutputSafe/);
  assert.match(runnerSource, /noScreenshotResidue/);
});

function extractConstArraySource(name: string): string {
  const pattern = new RegExp(`const ${escapeRegExp(name)} = \\[[\\s\\S]*?\\];`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing const array ${name}`);
  return match[0];
}

function extractFunctionSource(name: string): string {
  const pattern = new RegExp(`(?:async )?function ${escapeRegExp(name)}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
  const match = runnerSource.match(pattern);
  assert.ok(match, `missing function ${name}`);
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
