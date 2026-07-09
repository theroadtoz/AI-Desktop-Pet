import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createAssistantReplyPrivacyStreamGuard,
  redactAssistantPersonaSelfIdentityDrift,
  redactAssistantReplyPrivateMarkers
} = require("../dist/main/services/chat/assistant-reply-privacy.js") as typeof import("../src/main/services/chat/assistant-reply-privacy");
const {
  createChatEngine
} = require("../dist/main/services/chat/chat-engine.js") as typeof import("../src/main/services/chat/chat-engine");

test("assistant reply redaction preserves ordinary companion text", () => {
  const text = "我明白了，我们先把下一步定清楚。";

  assert.equal(redactAssistantReplyPrivateMarkers(text), text);
});

test("assistant reply redaction removes private markers, secrets, tokens, and local paths", () => {
  const text = [
    "我看到了 P2-30B_SENSITIVE_SENTINEL。",
    "密钥 sk-p230b-secret-should-not-appear 不应该复述。",
    "令牌 Bearer abc.def-123 也要隐藏。",
    "本地位置 C:\\Users\\Alice\\models\\model.gguf 不能展示。",
    "环境名 AI_DESKTOP_PET_API_KEY 也只概括。"
  ].join(" ");
  const redacted = redactAssistantReplyPrivateMarkers(text);

  assert.doesNotMatch(redacted, /P2-30B_SENSITIVE_SENTINEL/);
  assert.doesNotMatch(redacted, /sk-p230b-secret-should-not-appear/);
  assert.doesNotMatch(redacted, /Bearer\s+abc\.def-123/);
  assert.doesNotMatch(redacted, /C:\\Users\\Alice\\models\\model\.gguf/);
  assert.doesNotMatch(redacted, /AI_DESKTOP_PET_API_KEY/);
  assert.match(redacted, /\[私有标记\]/);
  assert.match(redacted, /\[敏感密钥\]/);
  assert.match(redacted, /\[敏感令牌\]/);
  assert.match(redacted, /\[本地路径\]/);
});

test("assistant reply redaction replaces generic AI self identity with Xita identity", () => {
  const redacted = redactAssistantPersonaSelfIdentityDrift(
    "我是一个AI助手，可以帮你回答问题。作为语言模型，我会尽量准确。我的身份是普通 AI 助手，本质上是聊天机器人。"
  );

  assert.match(redacted, /我是西塔，魔法学院高年级的现代魔导工程进修魔女/);
  assert.match(redacted, /作为西塔/);
  assert.match(redacted, /西塔的身份是桌面魔女同伴/);
  assert.doesNotMatch(redacted, /我是一个AI助手|作为语言模型|普通 AI 助手|本质上是聊天机器人/);
});

test("assistant reply stream guard redacts markers split across deltas", () => {
  let streamed = "";
  const guard = createAssistantReplyPrivacyStreamGuard((text) => {
    streamed += text;
  });

  for (const chunk of [
    "我不会复述 P2-30B_SENS",
    "ITIVE_SENTINEL，也不会输出 sk-p230b-sec",
    "ret-should-not-appear。"
  ]) {
    guard.push(chunk);
  }

  guard.flush();

  assert.doesNotMatch(streamed, /P2-30B_SENSITIVE_SENTINEL/);
  assert.doesNotMatch(streamed, /sk-p230b-secret-should-not-appear/);
  assert.match(streamed, /\[私有标记\]/);
  assert.match(streamed, /\[敏感密钥\]/);
});

test("assistant reply stream guard redacts generic AI self identity split across deltas", () => {
  let streamed = "";
  const guard = createAssistantReplyPrivacyStreamGuard((text) => {
    streamed += text;
  });

  for (const chunk of [
    "我是一个AI",
    "助手，可以陪你整理今天的问题。"
  ]) {
    guard.push(chunk);
  }

  guard.flush();

  assert.match(streamed, /我是西塔，魔法学院高年级的现代魔导工程进修魔女/);
  assert.doesNotMatch(streamed, /我是一个AI助手/);
});

test("chat engine redacts streamed deltas and final provider result", async () => {
  const provider = {
    id: "local-openai-compatible" as const,
    async streamReply(_request: Parameters<ReturnType<typeof createChatEngine>["startChatStream"]>[0], options: {
      signal: AbortSignal;
      onDelta(delta: { text: string }): void;
    }) {
      for (const text of [
        "回复开始 P2-30B_LONG",
        "_HISTORY_SENTINEL 和 sk-p230b-sec",
        "ret-should-not-appear。作为语言",
        "模型，我会继续回答。结束"
      ]) {
        options.onDelta({ text });
      }

      return {
        text: "回复开始 P2-30B_LONG_HISTORY_SENTINEL 和 sk-p230b-secret-should-not-appear。作为语言模型，我会继续回答。结束",
        emotion: "neutral" as const,
        intensity: "low" as const
      };
    }
  };
  const engine = createChatEngine(provider);
  let streamed = "";

  const result = await engine.startChatStream({
    requestVersion: 1,
    conversationId: "reply-redaction-test",
    messages: [{ id: crypto.randomUUID(), role: "user", content: "请回复" }]
  }, {
    onDelta(delta) {
      streamed += delta.text;
    }
  });

  assert.doesNotMatch(streamed, /P2-30B_LONG_HISTORY_SENTINEL|sk-p230b-secret-should-not-appear/);
  assert.doesNotMatch(result.text, /P2-30B_LONG_HISTORY_SENTINEL|sk-p230b-secret-should-not-appear/);
  assert.doesNotMatch(streamed, /作为语言模型/);
  assert.doesNotMatch(result.text, /作为语言模型/);
  assert.match(streamed, /\[私有标记\]/);
  assert.match(result.text, /\[敏感密钥\]/);
  assert.match(streamed, /作为西塔/);
  assert.match(result.text, /作为西塔/);
});
