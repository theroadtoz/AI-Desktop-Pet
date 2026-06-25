import assert from "node:assert/strict";
import test from "node:test";
import { classifyEmotion } from "../src/main/services/chat/emotion-classifier.ts";
import {
  isEmotionPresentation,
  selectEmotionPresentation
} from "../src/shared/emotion.ts";

test("emotion classifier returns a deterministic intensity for one matching emotion", () => {
  assert.deepEqual(classifyEmotion({ latestUserMessage: "我今天很开心" }), {
    emotion: "happy",
    intensity: "low"
  });
  assert.deepEqual(classifyEmotion({ latestUserMessage: "这也太好了" }), {
    emotion: "happy",
    intensity: "medium"
  });
  assert.deepEqual(classifyEmotion({ latestUserMessage: "我太开心了" }), {
    emotion: "happy",
    intensity: "high"
  });
});

test("unknown and conflicting keywords safely fall back to neutral low intensity", () => {
  assert.deepEqual(classifyEmotion({ latestUserMessage: "今天天气晴朗" }), {
    emotion: "neutral",
    intensity: "low"
  });
  assert.deepEqual(classifyEmotion({ latestUserMessage: "我很开心但也很难过" }), {
    emotion: "neutral",
    intensity: "low"
  });
});

test("only audited high-intensity emotions use emphasis presentation", () => {
  assert.deepEqual(selectEmotionPresentation({ emotion: "happy", intensity: "high" }), {
    emotion: "happy",
    intensity: "high",
    mode: "emphasis"
  });
  assert.equal(selectEmotionPresentation({ emotion: "happy", intensity: "medium" }).mode, "micro");
  assert.equal(selectEmotionPresentation({ emotion: "confused", intensity: "high" }).mode, "micro");
  assert.equal(selectEmotionPresentation({ emotion: "neutral", intensity: "high" }).mode, "neutral");
});

test("presentation guard rejects untrusted or policy-inconsistent IPC payloads", () => {
  assert.equal(isEmotionPresentation({ emotion: "sad", intensity: "high", mode: "emphasis" }), true);
  assert.equal(isEmotionPresentation({ emotion: "confused", intensity: "high", mode: "emphasis" }), false);
  assert.equal(isEmotionPresentation({ emotion: "happy", intensity: "medium", mode: "emphasis" }), false);
  assert.equal(isEmotionPresentation({ emotion: "happy", intensity: "high", mode: "unknown" }), false);
});
