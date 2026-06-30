import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  mapChatMessagesToOpenAICompatible
} = require("../dist/main/services/chat/chat-message-mapper.js") as typeof import("../src/main/services/chat/chat-message-mapper");
const {
  createFakeChatProvider
} = require("../dist/main/services/chat/fake-provider.js") as typeof import("../src/main/services/chat/fake-provider");
const {
  createChatProviderFromConfig
} = require("../dist/main/services/chat/provider-factory.js") as typeof import("../src/main/services/chat/provider-factory");

type ChatMessage = Parameters<typeof mapChatMessagesToOpenAICompatible>[0][number];
type RuntimeContext = NonNullable<Parameters<ReturnType<typeof createFakeChatProvider>["streamReply"]>[0]["runtimeContext"]>;

const runtimeContext: RuntimeContext = {
  isoTime: "2026-06-28T06:07:08.000Z",
  localDate: "2026-06-28",
  localTime: "14:07",
  weekday: "星期日",
  timezone: "Asia/Shanghai",
  locale: "zh-CN"
};

test("current time/date case: mapper injects safe runtime context", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    userMessage("当前日期")
  ], undefined, undefined, undefined, "local-small-model", runtimeContext);
  const runtimeMessage = mapped.find((message) => message.content.includes("运行时上下文"));

  assert.equal(runtimeMessage?.role, "system");
  assert.match(runtimeMessage?.content ?? "", /2026-06-28/);
  assert.match(runtimeMessage?.content ?? "", /14:07/);
  assert.match(runtimeMessage?.content ?? "", /Asia\/Shanghai/);
  assert.match(runtimeMessage?.content ?? "", /实时外部事实仍需查证/);
  assert.doesNotMatch(runtimeMessage?.content ?? "", /API Key|Provider 请求正文|事实卡正文/);
});

test("current date case: fake provider uses fixed runtime context", async () => {
  const reply = await streamFakeReply("p2-17b-date", "当前日期", runtimeContext);

  assert.match(reply.text, /2026-06-28/);
  assert.match(reply.text, /星期日/);
  assertShort(reply.text);
});

test("current time case: fake provider uses fixed runtime context", async () => {
  const reply = await streamFakeReply("p2-17b-time", "现在几点了", runtimeContext);

  assert.match(reply.text, /14:07/);
  assert.match(reply.text, /Asia\/Shanghai/);
  assertShort(reply.text);
});

test("current time/date case: missing runtime context says it cannot confirm", async () => {
  const reply = await streamFakeReply("p2-17b-no-context", "现在几点了");

  assert.match(reply.text, /没有系统时间上下文|不能确认/);
  assert.doesNotMatch(reply.text, /14:07|2026-06-28/);
  assertShort(reply.text);
});

test("common sense case: simple arithmetic stays on target", async () => {
  const reply = await streamFakeReply("p2-17b-addition", "2+3 等于几？", runtimeContext);

  assert.match(reply.text, /5/);
  assert.doesNotMatch(reply.text, /慢慢理清楚|先抓下一步/);
  assertShort(reply.text);
});

test("common sense case: months in a year stays on target", async () => {
  const reply = await streamFakeReply("p2-17b-months", "一年有多少个月？", runtimeContext);

  assert.match(reply.text, /12/);
  assert.match(reply.text, /月/);
  assertShort(reply.text);
});

test("common sense case: boiling point at standard atmosphere stays on target", async () => {
  const reply = await streamFakeReply("p2-17b-boiling", "标准大气压下水的沸点是多少？", runtimeContext);

  assert.match(reply.text, /100|100°C/);
  assert.match(reply.text, /标准大气压|沸点/);
  assertShort(reply.text);
});

test("real provider unreachable still does not fall back to fake", async () => {
  const originalFetch = globalThis.fetch;
  const provider = createChatProviderFromConfig({
    config: {
      providerId: "local-openai-compatible",
      displayName: "Ollama 本地模型",
      baseURL: "http://localhost:11434/v1",
      model: "qwen3.5:2b",
      localPresetId: "ollama",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 1000
    },
    getApiKey() {
      throw new Error("local provider must not request a stored key");
    }
  });
  let deltaText = "";

  globalThis.fetch = (async () => {
    throw new TypeError("network unavailable");
  }) as typeof fetch;

  try {
    await assert.rejects(
      provider.streamReply({
        requestVersion: 1,
        conversationId: "p2-17b-local-not-ready",
        messages: [userMessage("当前时间")],
        runtimeContext
      }, {
        signal: new AbortController().signal,
        onDelta(delta) {
          deltaText += delta.text;
        }
      }),
      { name: "provider_network_error" }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(provider.id, "local-openai-compatible");
  assert.equal(deltaText, "");
});

async function streamFakeReply(
  conversationId: string,
  content: string,
  context?: RuntimeContext
) {
  const provider = createFakeChatProvider();
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages: [userMessage(content)],
    dialogueStyleContext: { modeId: "default", styleId: "gentle-desktop-companion-v1" },
    runtimeContext: context
  }, {
    signal: new AbortController().signal,
    onDelta(delta) {
      deltaText += delta.text;
    }
  });

  assert.equal(deltaText, result.text);
  return result;
}

function userMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content
  };
}

function assertShort(text: string): void {
  assert.ok(text.length > 0);
  assert.ok(text.length <= 60);
  assert.doesNotMatch(text, /感谢您的提问|小家伙|吾|汝|请问您还需要/);
}
