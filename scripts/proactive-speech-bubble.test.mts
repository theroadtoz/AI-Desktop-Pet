import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

  assert.deepEqual(PROACTIVE_SPEECH_BUBBLE_REASONS, ["startup_presence", "idle_presence", "mode_presence"]);
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

test("main runtime routes idle proactive bubbles through low frequency event pool with safe telemetry", () => {
  const appSource = readFileSync("src/main/app.ts", "utf8");
  const idleSchedulerIndex = appSource.indexOf("function scheduleIdleProactiveSpeechBubble()");
  const idleSchedulerEndIndex = appSource.indexOf("function scheduleStartupProactiveSpeechBubbleIfNeeded()");
  const idleSchedulerSource = appSource.slice(idleSchedulerIndex, idleSchedulerEndIndex);

  assert.notEqual(idleSchedulerIndex, -1);
  assert.notEqual(idleSchedulerEndIndex, -1);
  assert.match(appSource, /import\s+\{[\s\S]*selectLowFrequencyCompanionEvent[\s\S]*\}\s+from "\.\.\/shared\/daily-state-orchestration"/);
  assert.match(appSource, /getPetActionStateTriggerReason/);
  assert.match(idleSchedulerSource, /reason !== "mode_presence"[\s\S]*selectRuntimeLowFrequencyCompanionEvent/);
  assert.match(idleSchedulerSource, /createProactiveSpeechBubblePayload\(selection\.event\.bubbleReason,[\s\S]*safeContextTag: getLowFrequencyCompanionSafeContextTag\(selection\.event\)/);
  assert.match(idleSchedulerSource, /const actionStateId = getEffectiveLowFrequencyCompanionActionStateId\(selection\.event\);/);
  assert.match(idleSchedulerSource, /sendProactiveSpeechBubble\(\s*payload,\s*getPetActionStateTriggerReason\(actionStateId\)\s*\)/);
  assert.match(idleSchedulerSource, /lastLowFrequencyCompanionEventAt = now/);
  assert.match(idleSchedulerSource, /lastLowFrequencyCompanionEventId = selection\.event\.eventId/);
  assert.match(appSource, /logTelemetry\("low_frequency_companion_event", \{[\s\S]*eventId:[\s\S]*reason:[\s\S]*stateId:[\s\S]*actionType:[\s\S]*modeId:[\s\S]*presenceModeId:[\s\S]*status,[\s\S]*skipReason:[\s\S]*safeSummaryLabel:[\s\S]*interruptPolicy:[\s\S]*durationMs:[\s\S]*elapsedSinceLastEventMs:[\s\S]*minimumIntervalMs:/);
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
  assert.match(appSource, /clearQueuedSourcedLowFrequencyCompanionEvent\(selection\.event\.eventId\)/);
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
