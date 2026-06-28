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
type DialogueModeId = "default" | "work" | "game" | "reading";

const FORBIDDEN_DETOURS = [
  /请问您还需要/,
  /感谢您的提问/,
  /小家伙/,
  /吾/,
  /汝/
];

test("relevance case: direct question answers the asked core", async () => {
  const reply = await streamFakeReply("relevance-direct", [
    userMessage("怎么复盘才不散？")
  ]);

  assert.match(reply.text, /复盘/);
  assert.match(reply.text, /发生了什么|卡在哪里|下一次/);
  assertNoDetours(reply.text);
});

test("relevance case: emotional disclosure keeps the concrete reason", async () => {
  const reply = await streamFakeReply("relevance-emotion-reason", [
    userMessage("今天评审没过，我有点难受")
  ]);

  assert.match(reply.text, /评审没过/);
  assert.match(reply.text, /难受/);
  assert.doesNotMatch(reply.text, /先慢一点说$/);
});

test("relevance case: operation request points to app capability or boundary", async () => {
  const reply = await streamFakeReply("relevance-operation", [
    userMessage("帮我把模型切到本地 Ollama，如果没有装好怎么办？")
  ]);

  assert.match(reply.text, /本地模型|Ollama|模型/);
  assert.match(reply.text, /设置|未就绪|不会假装/);
  assert.doesNotMatch(reply.text, /已经切好|已完成/);
});

test("relevance case: follow-up uses available conversation context", async () => {
  const reply = await streamFakeReply("relevance-follow-up", [
    userMessage("TypeScript 和 Python 哪个更适合做这个桌宠脚本？"),
    assistantMessage("项目主体更贴近 TypeScript，临时工具可以看情况。"),
    userMessage("那这个呢？")
  ]);

  assert.match(reply.text, /TypeScript/);
  assert.match(reply.text, /Python/);
  assert.match(reply.text, /桌宠|脚本/);
});

test("relevance case: multi-intent input covers feeling and requested next step", async () => {
  const reply = await streamFakeReply("relevance-multi-intent", [
    userMessage("我有点焦虑，也想知道今晚先做哪一步")
  ]);

  assert.match(reply.text, /焦虑/);
  assert.match(reply.text, /今晚|一步|小动作/);
});

test("relevance case: uncertain facts are not guessed", async () => {
  const reply = await streamFakeReply("relevance-uncertain", [
    userMessage("这个软件最新版本的准确价格是多少？")
  ]);

  assert.match(reply.text, /不确定|需要查证|无法确认/);
  assert.doesNotMatch(reply.text, /肯定是|一定是|我保证/);
});

test("relevance case: memory question does not pretend to remember unprovided facts", async () => {
  const reply = await streamFakeReply("relevance-memory-boundary", [
    userMessage("你还记得我昨天没告诉你的生日吗？")
  ]);

  assert.match(reply.text, /无法确认|不会假装记得|没把它告诉我/);
  assert.doesNotMatch(reply.text, /当然记得|你的生日是/);
});

test("relevance case: unavailable local model does not fall back to fixed companionship", async () => {
  const originalFetch = globalThis.fetch;
  const provider = createChatProviderFromConfig({
    config: {
      providerId: "local-openai-compatible",
      displayName: "Ollama 本地模型",
      baseURL: "http://localhost:11434/v1",
      model: "qwen3.5:2b-q4_K_M",
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
        conversationId: "relevance-local-not-ready",
        messages: [userMessage("本地模型没启动时你会怎么回复？")]
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

test("relevance case: local-small-model prompt keeps answer focus rules", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    userMessage("刚才那个怎么处理？")
  ], undefined, undefined, undefined, "local-small-model");
  const systemText = mapped
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  assert.match(systemText, /先答当前问题/);
  assert.match(systemText, /具体原因/);
  assert.match(systemText, /不知道就说不确定/);
  assert.doesNotMatch(systemText, /API Key|Provider 请求正文|事实卡正文/);
});

async function streamFakeReply(
  conversationId: string,
  messages: ChatMessage[],
  modeId: DialogueModeId = "default",
  memoryContext?: Parameters<typeof mapChatMessagesToOpenAICompatible>[1]
) {
  const provider = createFakeChatProvider();
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages,
    dialogueStyleContext: { modeId, styleId: "gentle-desktop-companion-v1" },
    memoryContext
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

function assistantMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content
  };
}

function assertNoDetours(text: string): void {
  for (const pattern of FORBIDDEN_DETOURS) {
    assert.doesNotMatch(text, pattern);
  }
}
