import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createAssistantReplyPrivacyStreamGuard,
  redactAssistantPersonaSelfIdentityDrift,
  redactAssistantReplyPrivateMarkers,
  sanitizeAssistantReplyForDisplay
} = require("../dist/main/services/chat/assistant-reply-privacy.js") as typeof import("../src/main/services/chat/assistant-reply-privacy");
const {
  createChatEngine
} = require("../dist/main/services/chat/chat-engine.js") as typeof import("../src/main/services/chat/chat-engine");
const {
  hasGenericAiSelfIdentityDrift
} = require("../dist/shared/persona-self-identity.js") as typeof import("../src/shared/persona-self-identity");

function collectSafeReplyDeltas(chunks: readonly string[]): string {
  let streamed = "";
  const guard = createAssistantReplyPrivacyStreamGuard((text) => {
    streamed += text;
  });

  for (const chunk of chunks) {
    guard.push(chunk);
  }

  guard.flush();
  return streamed;
}

function assertSafeAcrossAllPartitions(source: string): void {
  const characters = Array.from(source);
  const safeFinal = sanitizeAssistantReplyForDisplay(source);
  const partitionCount = 2 ** Math.max(characters.length - 1, 0);

  for (let partition = 0; partition < partitionCount; partition += 1) {
    const chunks: string[] = [];
    let chunk = characters[0] ?? "";

    for (let index = 1; index < characters.length; index += 1) {
      if ((partition & (1 << (index - 1))) !== 0) {
        chunks.push(chunk);
        chunk = characters[index];
      } else {
        chunk += characters[index];
      }
    }

    if (chunk) {
      chunks.push(chunk);
    }

    assert.equal(collectSafeReplyDeltas(chunks), safeFinal, `stream differs at partition ${partition}`);
  }
}

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
  assert.match(redacted, /我会尽量准确/);
  assert.doesNotMatch(redacted, /作为西塔/);
  assert.match(redacted, /我的身份是桌面魔女同伴/);
  assert.doesNotMatch(redacted, /我是一个AI助手|作为语言模型|普通 AI 助手|本质上是聊天机器人/);
  assert.equal(hasGenericAiSelfIdentityDrift(redacted), false);
});

test("assistant reply stream guard keeps Xita in first person across deltas", () => {
  const source = "我知道你今天不太好。西塔就在这里，随时准备支持你。";
  const expected = "我知道你今天不太好。我就在这里，随时准备支持你。";

  assert.equal(sanitizeAssistantReplyForDisplay(source), expected);
  assert.equal(collectSafeReplyDeltas(["我知道你今天不太好。西", "塔就在这里，随时准备支持你。"]), expected);
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

test("assistant reply stream guard does not leak a long Windows path across any partition", () => {
  const windowsPath = `C:\\Users\\Alice\\${"private-directory\\".repeat(16)}model.gguf`;
  const source = `Windows path: "${windowsPath}"。`;
  const safeFinal = sanitizeAssistantReplyForDisplay(source);

  assert.doesNotMatch(safeFinal, /private-directory|model\.gguf/);

  for (let split = 0; split <= source.length; split += 1) {
    const streamed = collectSafeReplyDeltas([
      source.slice(0, split),
      source.slice(split)
    ]);

    assert.equal(streamed, safeFinal, `stream differs at split ${split}`);
  }

  assert.equal(
    collectSafeReplyDeltas(Array.from(source)),
    safeFinal,
    "stream differs when every character is a chunk"
  );
});

test("assistant reply stream guard is invariant across sensitive-text split points", () => {
  const windowsPath = `C:\\Users\\Alice\\${"private-directory\\".repeat(16)}model.gguf`;
  const uncPath = `\\\\fileserver\\private-share\\${"restricted-folder\\".repeat(16)}notes.txt`;
  const source = [
    `Windows path: "${windowsPath}"。`,
    `UNC path: "${uncPath}"。`,
    "Authorization: Bearer abc.def-123_sensitive。",
    "Secret: sk-p262a-secret-should-never-appear。",
    "Markers: TOKEN_private-session P2-62A_STREAM_SENTINEL。",
    "我是一个AI助手，但这些内容都不能泄漏。"
  ].join("\n");
  const safeFinal = sanitizeAssistantReplyForDisplay(source);

  assert.doesNotMatch(safeFinal, /private-directory|restricted-folder|fileserver|abc\.def-123_sensitive|sk-p262a-secret|TOKEN_private-session|P2-62A_STREAM_SENTINEL/);
  assert.match(safeFinal, /\[本地路径\]/);
  assert.match(safeFinal, /\[敏感令牌\]/);
  assert.match(safeFinal, /\[敏感密钥\]/);
  assert.match(safeFinal, /\[私有标记\]/);

  for (let split = 0; split <= source.length; split += 1) {
    const streamed = collectSafeReplyDeltas([
      source.slice(0, split),
      source.slice(split)
    ]);

    assert.equal(streamed, safeFinal, `stream differs at split ${split}`);
  }

  assert.equal(
    collectSafeReplyDeltas(Array.from(source)),
    safeFinal,
    "stream differs when every character is a chunk"
  );
});

test("assistant reply stream guard is invariant across all short sensitive-text partitions", () => {
  for (const source of [
    "C:\\x",
    "\\\\a\\b",
    "Bearer x",
    "sk-12345678",
    "TOKEN_x",
    "AA_SENTINEL"
  ]) {
    assertSafeAcrossAllPartitions(source);
  }
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
  assert.equal(hasGenericAiSelfIdentityDrift(streamed), false);
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
  assert.match(streamed, /我会继续回答/);
  assert.match(result.text, /我会继续回答/);
  assert.doesNotMatch(streamed, /作为西塔/);
  assert.doesNotMatch(result.text, /作为西塔/);
});

test("chat engine rejects an aborted reply when the provider resolves late", async () => {
  let resolveReply: ((result: {
    text: string;
    emotion: "neutral";
    intensity: "low";
  }) => void) | undefined;
  const provider = {
    id: "local-openai-compatible" as const,
    streamReply(_request: Parameters<ReturnType<typeof createChatEngine>["startChatStream"]>[0], options: {
      signal: AbortSignal;
      onDelta(delta: { text: string }): void;
    }) {
      options.onDelta({ text: "late provider reply" });
      return new Promise<{
        text: string;
        emotion: "neutral";
        intensity: "low";
      }>((resolve) => {
        resolveReply = resolve;
      });
    }
  };
  const engine = createChatEngine(provider);
  let streamed = "";
  const replyPromise = engine.startChatStream({
    requestVersion: 2,
    conversationId: "late-abort-test",
    messages: [{ id: crypto.randomUUID(), role: "user", content: "stop" }]
  }, {
    onDelta(delta) {
      streamed += delta.text;
    }
  });

  assert.equal(engine.abortActiveStream(), true);
  assert.ok(resolveReply);
  resolveReply({
    text: "late provider reply",
    emotion: "neutral",
    intensity: "low"
  });

  await assert.rejects(replyPromise, (error: unknown) => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    return true;
  });
  assert.equal(streamed, "");
});
