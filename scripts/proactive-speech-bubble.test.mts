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
  PROACTIVE_SPEECH_BUBBLE_TIME_BANDS,
  clampProactiveSpeechBubbleDuration,
  getProactiveSpeechBubbleLine,
  getProactiveSpeechBubbleTimeBand,
  isProactiveSpeechBubbleLineId,
  isProactiveSpeechBubbleReason,
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
  assert.match(idleSchedulerSource, /reason !== "mode_presence"[\s\S]*selectRuntimeLowFrequencyCompanionEvent/);
  assert.match(idleSchedulerSource, /createProactiveSpeechBubblePayload\(selection\.event\.bubbleReason\)/);
  assert.match(idleSchedulerSource, /sendProactiveSpeechBubble\(payload\)/);
  assert.match(idleSchedulerSource, /lastLowFrequencyCompanionEventAt = now/);
  assert.match(idleSchedulerSource, /lastLowFrequencyCompanionEventId = selection\.event\.eventId/);
  assert.match(appSource, /logTelemetry\("low_frequency_companion_event", \{[\s\S]*eventId:[\s\S]*reason:[\s\S]*stateId:[\s\S]*actionType:[\s\S]*modeId:[\s\S]*presenceModeId:[\s\S]*status,[\s\S]*skipReason:[\s\S]*safeSummaryLabel:[\s\S]*interruptPolicy:[\s\S]*durationMs:[\s\S]*elapsedSinceLastEventMs:[\s\S]*minimumIntervalMs:/);
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
  assert.doesNotMatch(payloadTypeSource, /eventId|timeBand/);
  assert.match(appSource, /petWindow\.webContents\.send\("pet:proactive-speech-bubble", payload\)/);
  assert.doesNotMatch(appSource, /petWindow\.webContents\.send\("pet:proactive-speech-bubble", \{/);
  assert.match(preloadSource, /return \{\s+lineId,\s+reason,\s+durationMs: Math\.round\(durationMs\)\s+\};/);
  assert.doesNotMatch(preloadSource, /eventId|timeBand/);
});
