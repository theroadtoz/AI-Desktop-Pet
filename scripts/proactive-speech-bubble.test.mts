import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settleActiveRunSteps } from "./support/runner-step-settlement.mjs";
import {
  DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS,
  DEFAULT_PROACTIVE_SPEECH_BUBBLE_LINE_ID,
  MAX_PROACTIVE_SPEECH_BUBBLE_DURATION_MS,
  MIN_PROACTIVE_SPEECH_BUBBLE_DURATION_MS,
  PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG,
  PROACTIVE_SPEECH_BUBBLE_REASONS,
  PROACTIVE_SPEECH_BUBBLE_SAFE_CONTEXT_TAGS,
  PROACTIVE_SPEECH_BUBBLE_TIME_BANDS,
  clampProactiveSpeechBubbleDuration,
  getProactiveSpeechBubbleLine,
  getProactiveSpeechBubbleTimeBand,
  isProactiveSpeechBubbleLineId,
  isProactiveSpeechBubbleReason,
  isProactiveSpeechBubbleSafeContextTag,
  isProactiveSpeechBubbleTimeBand,
  selectProactiveSpeechBubbleLineId
} from "../src/shared/proactive-speech-bubble.ts";

const FORBIDDEN_TEXTS = [
  "sk-",
  ".env.local",
  "prompt",
  "Provider 请求正文",
  "fact card",
  "用户全文",
  "AI 全文"
] as const;

test("proactive speech bubble exposes only fixed short safe lines", () => {
  assert.equal(isProactiveSpeechBubbleLineId(DEFAULT_PROACTIVE_SPEECH_BUBBLE_LINE_ID), true);
  assert.equal(getProactiveSpeechBubbleLine(DEFAULT_PROACTIVE_SPEECH_BUBBLE_LINE_ID), PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG.startup_presence_ready);

  for (const [lineId, text] of Object.entries(PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG)) {
    assert.equal(isProactiveSpeechBubbleLineId(lineId), true);
    assert.ok([...text].length > 0);
    assert.ok([...text].length <= 16, `${lineId} should stay short`);
    for (const forbiddenText of FORBIDDEN_TEXTS) {
      assert.equal(text.includes(forbiddenText), false, `${lineId} should not include ${forbiddenText}`);
    }
  }
});

test("proactive speech bubble rejects arbitrary ids and reasons", () => {
  assert.equal(isProactiveSpeechBubbleLineId("startup_presence_ready"), true);
  assert.equal(isProactiveSpeechBubbleLineId("chat_reply"), false);
  assert.equal(isProactiveSpeechBubbleLineId("private_memory"), false);

  assert.deepEqual(PROACTIVE_SPEECH_BUBBLE_REASONS, [
    "startup_presence",
    "idle_presence",
    "mode_presence",
    "music_presence",
    "game_presence",
    "return_presence",
    "work_recovery",
    "evening_presence",
    "silence_presence",
    "source_presence"
  ]);
  assert.equal(isProactiveSpeechBubbleReason("startup_presence"), true);
  assert.equal(isProactiveSpeechBubbleReason("idle_presence"), true);
  assert.equal(isProactiveSpeechBubbleReason("mode_presence"), true);
  assert.equal(isProactiveSpeechBubbleReason("chat_done"), false);
  assert.equal(isProactiveSpeechBubbleReason("model_generated"), false);
});

test("proactive speech bubble accepts only safe time bands", () => {
  assert.deepEqual(PROACTIVE_SPEECH_BUBBLE_TIME_BANDS, ["morning", "afternoon", "evening", "night"]);
  assert.equal(isProactiveSpeechBubbleTimeBand("morning"), true);
  assert.equal(isProactiveSpeechBubbleTimeBand("afternoon"), true);
  assert.equal(isProactiveSpeechBubbleTimeBand("evening"), true);
  assert.equal(isProactiveSpeechBubbleTimeBand("night"), true);
  assert.equal(isProactiveSpeechBubbleTimeBand("dawn"), false);
  assert.equal(isProactiveSpeechBubbleTimeBand(""), false);
  assert.equal(isProactiveSpeechBubbleTimeBand(undefined), false);
});

test("proactive speech bubble accepts only fixed safe context tags", () => {
  assert.deepEqual(PROACTIVE_SPEECH_BUBBLE_SAFE_CONTEXT_TAGS, [
    "context_settle",
    "history_summary_safe",
    "memory_safe_pulse",
    "search_citation_pulse"
  ]);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("context_settle"), true);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("history_summary_safe"), true);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("memory_safe_pulse"), true);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("search_citation_pulse"), true);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("context-settle"), false);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("history-summary-safe"), false);
  assert.equal(isProactiveSpeechBubbleSafeContextTag("memory-safe-pulse"), false);
  assert.equal(isProactiveSpeechBubbleSafeContextTag(undefined), false);
});

test("proactive speech bubble derives local time bands from Date", () => {
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 4, 59)), "night");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 5, 0)), "morning");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 11, 59)), "morning");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 12, 0)), "afternoon");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 17, 59)), "afternoon");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 18, 0)), "evening");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 21, 59)), "evening");
  assert.equal(getProactiveSpeechBubbleTimeBand(new Date(2026, 6, 7, 22, 0)), "night");
});

test("proactive speech bubble duration is clamped to low-interruption bounds", () => {
  assert.equal(clampProactiveSpeechBubbleDuration(Number.NaN), DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS);
  assert.equal(clampProactiveSpeechBubbleDuration(1), MIN_PROACTIVE_SPEECH_BUBBLE_DURATION_MS);
  assert.equal(clampProactiveSpeechBubbleDuration(12_000), MAX_PROACTIVE_SPEECH_BUBBLE_DURATION_MS);
  assert.equal(clampProactiveSpeechBubbleDuration(4_234.7), 4_235);
});

test("proactive speech bubble selection is mode-aware but stays allowlisted", () => {
  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "default",
    tick: 0
  }), "idle_presence_soft");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "focus",
    dialogueModeId: "game",
    tick: 0
  }), "idle_presence_focus");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "work",
    tick: 0
  }), "idle_presence_work");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "default",
    dialogueModeId: "reading",
    tick: 0
  }), "mode_presence_reading");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "quiet",
    dialogueModeId: "reading",
    tick: 0
  }), "mode_presence_focus");
});

test("proactive speech bubble selection can use time bands without changing renderer payload", () => {
  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "default",
    tick: 0,
    timeBand: "morning"
  }), "idle_presence_morning");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "work",
    tick: 0,
    timeBand: "afternoon"
  }), "idle_presence_work_afternoon");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "reading",
    tick: 0,
    timeBand: "night"
  }), "idle_presence_reading_night");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "game",
    tick: 0,
    timeBand: "evening"
  }), "idle_presence_game_evening");
});

test("proactive speech bubble selection keeps low-interruption presence ahead of dialogue mode", () => {
  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "quiet",
    dialogueModeId: "work",
    tick: 0,
    timeBand: "morning"
  }), "idle_presence_quiet");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "sleep",
    dialogueModeId: "game",
    tick: 0
  }), "idle_presence_quiet");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "focus",
    dialogueModeId: "work",
    tick: 0,
    timeBand: "afternoon"
  }), "mode_presence_focus");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "quiet",
    dialogueModeId: "reading",
    tick: 0,
    timeBand: "night"
  }), "mode_presence_focus");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "sleep",
    dialogueModeId: "game",
    tick: 0
  }), "mode_presence_focus");
});

test("proactive speech bubble selection applies safe context tag after low-interruption presence", () => {
  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "default",
    tick: 0,
    timeBand: "morning",
    safeContextTag: "context_settle"
  }), "idle_presence_context_settle");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "work",
    tick: 0,
    timeBand: "afternoon",
    safeContextTag: "context_settle"
  }), "idle_presence_context_settle");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "default",
    tick: 0,
    timeBand: "afternoon",
    safeContextTag: "history_summary_safe"
  }), "idle_presence_history_summary");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "default",
    tick: 0,
    timeBand: "morning",
    safeContextTag: "memory_safe_pulse"
  }), "idle_presence_memory_safe");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "default",
    dialogueModeId: "default",
    tick: 0,
    timeBand: "evening",
    safeContextTag: "search_citation_pulse"
  }), "idle_presence_search_citation");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "focus",
    dialogueModeId: "default",
    tick: 0,
    safeContextTag: "context_settle"
  }), "idle_presence_focus");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "quiet",
    dialogueModeId: "work",
    tick: 0,
    safeContextTag: "context_settle"
  }), "idle_presence_quiet");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "idle_presence",
    presenceModeId: "sleep",
    dialogueModeId: "game",
    tick: 0,
    safeContextTag: "context_settle"
  }), "idle_presence_quiet");
});

test("proactive speech bubble selection keeps startup and mode presence ahead of safe context tag", () => {
  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "startup_presence",
    presenceModeId: "default",
    dialogueModeId: "work",
    tick: 0,
    safeContextTag: "context_settle"
  }), "startup_presence_ready");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "default",
    dialogueModeId: "reading",
    tick: 0,
    safeContextTag: "context_settle"
  }), "mode_presence_reading");

  assert.equal(selectProactiveSpeechBubbleLineId({
    reason: "mode_presence",
    presenceModeId: "focus",
    dialogueModeId: "work",
    tick: 0,
    safeContextTag: "context_settle"
  }), "mode_presence_focus");
});

test("main runtime gates proactive speech bubble time band env to acceptance telemetry", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");

  assert.match(appSource, /AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND/);
  assert.match(appSource, /function readAcceptanceProactiveSpeechBubbleTimeBand\([\s\S]*isAcceptance[\s\S]*isProactiveSpeechBubbleTimeBand/);
  assert.match(appSource, /if \(!isAcceptance \|\| !isProactiveSpeechBubbleTimeBand\(value\)\) \{[\s\S]*return null;/);
  assert.match(appSource, /ACCEPTANCE_PROACTIVE_SPEECH_BUBBLE_TIME_BAND \?\? getProactiveSpeechBubbleTimeBand\(new Date\(\)\)/);
  assert.match(appSource, /timeBand: getRuntimeProactiveSpeechBubbleTimeBand\(\)/);
});

test("pet preload keeps proactive speech bubble allowlists aligned", () => {
  const preloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");

  for (const lineId of Object.keys(PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG)) {
    assert.match(preloadSource, new RegExp(JSON.stringify(lineId)));
  }

  for (const reason of PROACTIVE_SPEECH_BUBBLE_REASONS) {
    assert.match(preloadSource, new RegExp(JSON.stringify(reason)));
  }

  assert.doesNotMatch(preloadSource, /textContent|messageText|promptText|factCard/);
});

test("main runtime routes proactive bubbles through the unified coordinator", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const idleSchedulerIndex = appSource.indexOf("function scheduleIdleProactiveSpeechBubble()");
  const idleSchedulerEndIndex = appSource.indexOf("function scheduleStartupProactiveSpeechBubbleIfNeeded()");
  const idleSchedulerSource = appSource.slice(idleSchedulerIndex, idleSchedulerEndIndex);

  assert.notEqual(idleSchedulerIndex, -1);
  assert.notEqual(idleSchedulerEndIndex, -1);
  assert.match(appSource, /createProactiveBubbleCoordinator/);
  assert.match(appSource, /createProactiveBubbleLedgerStore/);
  assert.match(idleSchedulerSource, /refreshProactiveBubbleRuntimeGates\(\)/);
  assert.match(idleSchedulerSource, /proactiveBubbleCoordinator\?\.tick\(\)/);
  assert.match(idleSchedulerSource, /proactiveBubbleCoordinator\?\.queuePresence\(\s*"idle_presence",\s*payload,\s*getPetActionStateTriggerReason\(actionStateId\)\s*\)/);
  assert.doesNotMatch(idleSchedulerSource, /sendPetActionTrigger|webContents\.send\("pet:proactive-speech-bubble"/);
  const modeSchedulerSource = appSource.slice(
    appSource.indexOf("function schedulePetModeActionStateTrigger"),
    appSource.indexOf("function logProactiveSpeechBubbleDecision")
  );
  assert.match(modeSchedulerSource, /proactiveBubbleCoordinator\?\.queuePresence\("mode_presence", payload, reason\)/);
  assert.doesNotMatch(modeSchedulerSource, /sendPetActionTrigger|webContents\.send\("pet:proactive-speech-bubble"/);
  assert.match(appSource, /requestAction: sendPetActionTrigger/);
  assert.match(appSource, /onActionLifecycle\(\{ status: "started", reason: actionReason \}\)/);
  assert.match(appSource, /logTelemetry\("proactive_bubble_candidate", \{/);
  assert.match(appSource, /function flushStartupProactiveSpeechBubbleCandidate\(\)/);
  assert.match(appSource, /function flushStartupProactiveSpeechBubbleCandidate\(\)[\s\S]*proactiveBubbleCoordinator\?\.onFirstFrame\(\);[\s\S]*scheduleIdleProactiveSpeechBubble\(\);/);
  assert.match(appSource, /petTelemetryEvent\.payload\?\.reason === "startup_first_visible_frame"[\s\S]*pet_interaction_action_finished/);
  assert.match(appSource, /startupProactiveSpeechBubbleTimer = setTimeout\([\s\S]*PET_ACTION_TRIGGER_THROTTLE_MS \+ 150/);
  assert.match(appSource, /startupProactiveSpeechBubbleTimer = setTimeout\([\s\S]*flushStartupProactiveSpeechBubbleCandidate\(\)/);
});

test("P2-34 production runner follows coordinator action-first cadence without safe injection", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const runnerSource = readFileSync(
    "scripts/p2-34-companion-presence-idle-mode-cadence-real-ui.mjs",
    "utf8"
  );
  assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION|injectProactiveBubbleCandidateForAcceptance/);
  assert.match(runnerSource, /AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:[\s\S]*"250"/);
  assert.match(appSource, /Math\.min\(60 \* 60_000, Math\.max\(100, Math\.round\(parsed\)\)\)/);
  assert.match(runnerSource, /inspectCandidateActionFirst\([\s\S]*"startup_daily",[\s\S]*startupOutcome\.appearanceTerminalIndex,[\s\S]*"state_greet"/);
  assert.match(runnerSource, /waitForProductionStartupReadiness\(signal\)/);
  assert.match(runnerSource, /event\.type === "first_frame", 20_000/);
  assert.match(runnerSource, /event\.payload\?\.reason === "startup_first_visible_frame"[\s\S]*\.includes\(event\.type\), 20_000/);
  assert.match(runnerSource, /if \(!appearanceFirstEvent\)[\s\S]*startup_appearance_lifecycle_timeout/);
  assert.match(runnerSource, /appearanceFirstEvent\.type === "pet_interaction_action_started"[\s\S]*startup_appearance_terminal_timeout/);
  assert.match(runnerSource, /appearanceFirstEvent\.type === "pet_interaction_action_skipped"[\s\S]*appearanceTerminal = appearanceFirstEvent/);
  assert.match(runnerSource, /startup_appearance_invalid_direct_finished/);
  assert.match(runnerSource, /pet_interaction_action_finished" \|\| event\.type === "pet_interaction_action_skipped"/);
  assert.match(runnerSource, /waitForCandidateTerminal\([\s\S]*"startup_daily",[\s\S]*appearanceTerminal\.__index,[\s\S]*15_000/);
  assert.match(runnerSource, /inspectCandidateActionFirst\([\s\S]*"startup_daily",[\s\S]*startupOutcome\.appearanceTerminalIndex/);
  assert.match(runnerSource, /startupReadinessDiagnostic = \{[\s\S]*appearanceLifecycle:[\s\S]*candidateLifecycle:/);
  assert.match(runnerSource, /startupOutcome\.terminalStatus === "shown"[\s\S]*startupShownActionFirst/);
  assert.match(runnerSource, /startupOutcome\.terminalStatus === "skipped"[\s\S]*"engagement_blocked", "interruptibility_not_allowed", "system_unavailable"[\s\S]*startupBubble\.state === "hidden"/);
  assert.match(runnerSource, /inspectCandidateActionFirst\("idle_presence", idleStartIndex\)/);
  assert.match(runnerSource, /waitForCandidateTerminal\(signal, "idle_presence", idleStartIndex, 9_000\)/);
  assert.match(runnerSource, /waitForLowFrequencyQueuedDecision\(signal, idleStartIndex, 9_000\)/);
  assert.match(runnerSource, /decisionEvent\.type === "low_frequency_companion_event"[\s\S]*decisionEvent\.payload\?\.status === "queued"/);
  assert.match(runnerSource, /"engagement_blocked", "interruptibility_not_allowed", "system_unavailable"/);
  assert.doesNotMatch(runnerSource, /setDialogueMode|setPresenceMode|expectedDialogueCases|expectedPresenceCases/);
  assert.match(runnerSource, /manualModeControlsAbsent:[\s\S]*manualModeApisAbsent:/);
  assert.match(runnerSource, /\["dialogueOpenWelcome", "listen"\]\.includes\(event\.payload\?\.type\)/);
  assert.match(runnerSource, /api\?\.getAutomaticSituation\(\)[\s\S]*!\("setAutomaticSituation" in api\)/);
  assert.match(runnerSource, /Object\.keys\(bubble\.dataset\)\.every\(\(key\) => \["state", "lineId", "reason"\]\.includes\(key\)\)/);
  assert.match(runnerSource, /setProactiveCadenceOff\(signal, chat\)/);
  assert.match(runnerSource, /setProactiveCadence\(signal, chat, "normal"\)/);
  assert.match(runnerSource, /countOpenCoordinatorCandidates\(\) === 0/);
  assert.match(runnerSource, /inspectFreshCandidateFlow\(beforeReenableIndex\)/);
  assert.match(runnerSource, /status === "queued"[\s\S]*freshQueuedCandidates\.add\(candidateId\)/);
  assert.match(runnerSource, /status === "attempted" \|\| status === "shown"[\s\S]*freshQueuedCandidates\.has\(candidateId\)/);
  assert.match(runnerSource, /REENABLE_NO_REPLAY_WINDOW_MS = 500/);
  assert.match(runnerSource, /RUNNER_TOTAL_TIMEOUT_MS = 120_000/);
  assert.match(runnerSource, /RUN_STEP_SETTLE_TIMEOUT_MS = 5_000/);
  assert.match(runnerSource, /runnerAbortController\.abort\(new Error\("Runner total timeout"\)\)/);
  assert.match(runnerSource, /async function runStep\(signal, operation\)/);
  assert.match(runnerSource, /activeRunSteps\.add\(operationPromise\)/);
  assert.match(runnerSource, /return settleActiveRunSteps\(activeRunSteps, timeoutMs\)/);
  assert.match(runnerSource, /finally \{[\s\S]*await settleRunSteps\(RUN_STEP_SETTLE_TIMEOUT_MS\);[\s\S]*await stopElectron\(context\);[\s\S]*cleanupRealUiRun\(context\)/);
  assert.match(runnerSource, /queuedIndex >= 0 && attemptedIndex > queuedIndex[\s\S]*actionIndex > attemptedIndex && shownIndex > actionIndex/);

  const stripSource = runnerSource.match(/function stripKnownInternalRuntimeTelemetry\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(stripSource, "missing precise P2-34 runtime telemetry normalizer");
  const stripTelemetry = Function(`return (${stripSource})`)() as
    (text: string, runnerUserDataPath: string) => string;
  const forbiddenSource = runnerSource.match(/const forbiddenOutputPatterns = \[[\s\S]*?\];/)?.[0];
  assert.ok(forbiddenSource, "missing P2-34 forbidden output patterns");
  const forbiddenPatterns = Function(`return ${forbiddenSource
    .replace(/^const forbiddenOutputPatterns = /, "")
    .replace(/;$/, "")}`)() as RegExp[];
  const runnerPath = "E:\\repo\\.tmp\\p2-34\\user-data";
  const normalize = (payload: Record<string, unknown>) => stripTelemetry(JSON.stringify({
    type: "startup",
    payload: { userDataPath: runnerPath, ...payload }
  }), runnerPath);
  const safeEvent = normalize({ appVersion: "1.0.0" });
  assert.match(safeEvent, /\"type\":\"startup\"/);
  assert.match(safeEvent, /\"userDataPath\":\"\[runner-user-data\]\"/);
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test(safeEvent)), false);
  for (const unsafePayload of [
    { url: "https://example.invalid/private" },
    { path: "C:\\private\\payload.json" },
    { prompt: "raw private prompt" }
  ]) {
    const normalized = normalize(unsafePayload);
    assert.equal(forbiddenPatterns.some((pattern) => pattern.test(normalized)), true);
  }
  const unrelatedPath = stripTelemetry(JSON.stringify({
    type: "startup",
    payload: { userDataPath: "C:\\private\\other-user-data" }
  }), runnerPath);
  assert.match(unrelatedPath, /C:\\\\private\\\\other-user-data/);
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test(unrelatedPath)), true);

  const warningSource = runnerSource.match(/const electronSecurityWarningBlock = \[[\s\S]*?\];/)?.[0];
  assert.ok(warningSource, "missing exact Electron warning block");
  const warningBlock = Function(`return ${warningSource
    .replace(/^const electronSecurityWarningBlock = /, "")
    .replace(/;$/, "")}`)() as string[];
  const normalizerSource = runnerSource.match(/function normalizeKnownElectronSecurityWarning\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(normalizerSource, "missing exact Electron warning normalizer");
  const normalizeWarning = Function("electronSecurityWarningBlock", `return (${normalizerSource})`)(warningBlock) as
    (text: string) => string;
  const exactWarning = normalizeWarning(warningBlock.join("\n"));
  assert.match(exactWarning, /\[electron-security-docs\]/);
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test(exactWarning)), false);
  const ordinaryUrlLine = "product log https://electronjs.org/docs/tutorial/security.";
  assert.equal(normalizeWarning(ordinaryUrlLine), ordinaryUrlLine);
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test(normalizeWarning(ordinaryUrlLine))), true);
  const nearMatchWarning = [...warningBlock];
  nearMatchWarning[0] = `prefix ${nearMatchWarning[0]}`;
  assert.equal(normalizeWarning(nearMatchWarning.join("\n")), nearMatchWarning.join("\n"));
  assert.equal(forbiddenPatterns.some((pattern) => pattern.test(normalizeWarning(nearMatchWarning.join("\n")))), true);
});

test("p2-34 active runner steps have an independent hard settlement deadline", async () => {
  const resolvedSteps = new Set<Promise<unknown>>();
  const resolved = Promise.resolve("done");
  resolvedSteps.add(resolved);
  resolved.finally(() => resolvedSteps.delete(resolved));
  assert.deepEqual(await settleActiveRunSteps(resolvedSteps, 100), {
    settled: true,
    pendingCount: 0
  });

  const stuckSteps = new Set<Promise<unknown>>([new Promise(() => undefined)]);
  const startedAt = Date.now();
  assert.deepEqual(await settleActiveRunSteps(stuckSteps, 20), {
    settled: false,
    pendingCount: 1
  });
  assert.ok(Date.now() - startedAt < 250);
});

test("main runtime maps low frequency events to selector safe context tags", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const mapperIndex = appSource.indexOf("function getLowFrequencyCompanionSafeContextTag(");
  const mapperEndIndex = appSource.indexOf("function createProactiveSpeechBubblePayload(", mapperIndex);
  const mapperSource = appSource.slice(mapperIndex, mapperEndIndex);

  assert.notEqual(mapperIndex, -1);
  assert.notEqual(mapperEndIndex, -1);
  assert.match(appSource, /type ProactiveSpeechBubbleSafeContextTag/);
  assert.match(mapperSource, /event\?\.eventId === "context-settle"/);
  assert.match(mapperSource, /return "context_settle"/);
  assert.match(mapperSource, /event\?\.eventId === "history-summary-pulse"/);
  assert.match(mapperSource, /return "history_summary_safe"/);
  assert.match(mapperSource, /event\?\.eventId === "memory-safe-pulse"/);
  assert.match(mapperSource, /return "memory_safe_pulse"/);
  assert.match(mapperSource, /event\?\.eventId === "search-citation-pulse"/);
  assert.match(mapperSource, /return "search_citation_pulse"/);
});

test("main runtime only queues sourced history memory and search low frequency events from safe counters", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const queueIndex = appSource.indexOf("function queueSourcedLowFrequencyCompanionEvent(");
  const queueEndIndex = appSource.indexOf("function clearQueuedSourcedLowFrequencyCompanionEvent(", queueIndex);
  const queueSource = appSource.slice(queueIndex, queueEndIndex);
  const historyQueueIndex = appSource.indexOf("const contextBudget = budgetChatContext(request.messages);");
  const historyQueueEndIndex = appSource.indexOf("void resolveWebSearchForLatestMessage", historyQueueIndex);
  const historyQueueSource = appSource.slice(historyQueueIndex, historyQueueEndIndex);

  assert.notEqual(queueIndex, -1);
  assert.notEqual(queueEndIndex, -1);
  assert.notEqual(historyQueueIndex, -1);
  assert.notEqual(historyQueueEndIndex, -1);
  assert.match(appSource, /const BASE_RUNTIME_LOW_FREQUENCY_COMPANION_EVENT_IDS = \[[\s\S]*"idle-presence-check"[\s\S]*"mode-presence-echo"[\s\S]*"context-settle"[\s\S]*\] as const/);
  assert.match(appSource, /pendingSourcedLowFrequencyCompanionEvents/);
  assert.match(appSource, /actionStateId: PetActionStateId/);
  assert.match(appSource, /const SOURCED_LOW_FREQUENCY_COMPANION_EVENT_TTL_MS = 15 \* 60 \* 1_000/);
  assert.match(appSource, /function selectMemorySafePulseActionStateId/);
  assert.match(appSource, /autoCaptureSkippedReason === "sensitive"[\s\S]*return "memory-skipped"/);
  assert.match(appSource, /memoryInjectionCount > 0[\s\S]*return "memory-injected"/);
  assert.match(appSource, /capturedCount > 0[\s\S]*return "proactive-bubble-visible"/);
  assert.match(appSource, /function getEffectiveLowFrequencyCompanionActionStateId/);
  assert.match(appSource, /function pruneExpiredSourcedLowFrequencyCompanionEvents/);
  assert.match(appSource, /function clearSourcedLowFrequencyCompanionEvents/);
  assert.match(queueSource, /eventId !== "history-summary-pulse"[\s\S]*eventId !== "memory-safe-pulse"[\s\S]*eventId !== "search-citation-pulse"/);
  assert.match(queueSource, /actionStateId: options\.actionStateId/);
  assert.match(queueSource, /queuedAtMs: now/);
  assert.match(historyQueueSource, /contextBudget\.summary\.compressed[\s\S]*contextBudget\.summary\.summaryMessageCount > 0[\s\S]*contextBudget\.summary\.summarizedMessageCount > 0[\s\S]*queueSourcedLowFrequencyCompanionEvent\("history-summary-pulse", \{\s*actionStateId: "proactive-bubble-visible"\s*\}\)/);
  assert.doesNotMatch(historyQueueSource, /providerMessages|summaryText|summaryBody|submittedMessage\.content|userMessage|assistantMessage|safeQuery|webSearch|prompt/i);
  assert.match(appSource, /const memorySafePulseActionStateId = selectMemorySafePulseActionStateId/);
  assert.match(appSource, /queueSourcedLowFrequencyCompanionEvent\("memory-safe-pulse", \{\s*actionStateId: memorySafePulseActionStateId\s*\}\)/);
  assert.match(appSource, /webSearchCitationCount > 0[\s\S]*queueSourcedLowFrequencyCompanionEvent\("search-citation-pulse", \{\s*actionStateId: "search-cited"\s*\}\)/);
  assert.match(queueSource, /proactiveBubbleCoordinator\.queueSource\([\s\S]*getPetActionStateTriggerReason\(options\.actionStateId\)/);
  assert.match(appSource, /currentPresenceModeId === "sleep"[\s\S]*clearSourcedLowFrequencyCompanionEvents\(\)/);
  assert.doesNotMatch(appSource, /safeQuery.*queueSourcedLowFrequencyCompanionEvent|webSearchResolution\.context\.results.*queueSourcedLowFrequencyCompanionEvent/);
});

test("proactive speech bubble renderer payload contract stays event-pool agnostic", () => {
  const sharedSource = readFileSync("src/shared/proactive-speech-bubble.ts", "utf8");
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const preloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");
  const payloadTypeSource = sharedSource.slice(
    sharedSource.indexOf("export type ProactiveSpeechBubblePayload"),
    sharedSource.indexOf("};", sharedSource.indexOf("export type ProactiveSpeechBubblePayload")) + 2
  );

  assert.match(sharedSource, /export type ProactiveSpeechBubblePayload = \{\s+lineId: ProactiveSpeechBubbleLineId;\s+reason: ProactiveSpeechBubbleReason;\s+durationMs: number;\s+\};/);
  assert.doesNotMatch(payloadTypeSource, /eventId|safeContextTag|timeBand/);
  assert.match(appSource, /petWindow\.webContents\.send\("pet:proactive-speech-bubble", payload\)/);
  assert.doesNotMatch(appSource, /petWindow\.webContents\.send\("pet:proactive-speech-bubble", \{/);
  assert.match(preloadSource, /return \{\s+lineId,\s+reason,\s+durationMs: Math\.round\(durationMs\)\s+\};/);
  assert.doesNotMatch(preloadSource, /eventId|safeContextTag|timeBand/);
});
