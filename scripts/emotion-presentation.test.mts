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

test("emotion presentation matrix keeps low and medium intensities on micro presentations", () => {
  const emotions = ["happy", "confused", "sad", "angry", "surprised"] as const;

  for (const emotion of emotions) {
    assert.equal(selectEmotionPresentation({ emotion, intensity: "low" }).mode, "micro");
    assert.equal(selectEmotionPresentation({ emotion, intensity: "medium" }).mode, "micro");
  }

  assert.equal(selectEmotionPresentation({ emotion: "happy", intensity: "high" }).mode, "emphasis");
  assert.equal(selectEmotionPresentation({ emotion: "sad", intensity: "high" }).mode, "emphasis");
  assert.equal(selectEmotionPresentation({ emotion: "angry", intensity: "high" }).mode, "emphasis");
  assert.equal(selectEmotionPresentation({ emotion: "surprised", intensity: "high" }).mode, "emphasis");
  assert.equal(selectEmotionPresentation({ emotion: "confused", intensity: "high" }).mode, "micro");
});

test("emotion classifier covers the P2-5F low medium high fake-provider matrix", () => {
  const cases = [
    ["happy", "low", "我今天很开心"],
    ["happy", "medium", "这也太好了"],
    ["happy", "high", "我太开心了"],
    ["confused", "low", "我有点不懂"],
    ["confused", "medium", "这是为什么"],
    ["confused", "high", "我完全不懂"],
    ["sad", "low", "有点难过"],
    ["sad", "medium", "最近压力很大"],
    ["sad", "high", "我快崩溃了"],
    ["angry", "low", "我有点生气"],
    ["angry", "medium", "这也太离谱了"],
    ["angry", "high", "这太气人了"],
    ["surprised", "low", "有点没想到"],
    ["surprised", "medium", "真的假的"],
    ["surprised", "high", "这太震惊了"],
    ["neutral", "low", "今天天气晴朗"]
  ] as const;

  for (const [emotion, intensity, latestUserMessage] of cases) {
    assert.deepEqual(classifyEmotion({ latestUserMessage }), { emotion, intensity });
  }
});

test("presentation guard rejects untrusted or policy-inconsistent IPC payloads", () => {
  assert.equal(isEmotionPresentation({ emotion: "sad", intensity: "high", mode: "emphasis" }), true);
  assert.equal(isEmotionPresentation({ emotion: "confused", intensity: "high", mode: "emphasis" }), false);
  assert.equal(isEmotionPresentation({ emotion: "happy", intensity: "medium", mode: "emphasis" }), false);
  assert.equal(isEmotionPresentation({ emotion: "happy", intensity: "high", mode: "unknown" }), false);
});
