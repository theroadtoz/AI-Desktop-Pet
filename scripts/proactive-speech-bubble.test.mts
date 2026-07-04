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
  clampProactiveSpeechBubbleDuration,
  getProactiveSpeechBubbleLine,
  isProactiveSpeechBubbleLineId,
  isProactiveSpeechBubbleReason,
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
