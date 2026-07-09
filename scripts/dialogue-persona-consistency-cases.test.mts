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
  getPersonaDialogueAnchor
} = require("../dist/shared/persona-card.js") as typeof import("../src/shared/persona-card");

type ChatMessage = Parameters<typeof mapChatMessagesToOpenAICompatible>[0][number];
type DialogueModeId = "default" | "work" | "game" | "reading";
type RuntimeContext = NonNullable<Parameters<ReturnType<typeof createFakeChatProvider>["streamReply"]>[0]["runtimeContext"]>;

const runtimeContext: RuntimeContext = {
  isoTime: "2026-06-30T03:04:05.000Z",
  localDate: "2026-06-30",
  localTime: "11:04",
  weekday: "星期二",
  timezone: "Asia/Shanghai",
  locale: "zh-CN"
};

const FORBIDDEN_PERSONA_DRIFT = [
  /感谢您的提问/,
  /请问您还需要/,
  /作为.*ChatGPT/,
  /通用客服/,
  /搜索应用/,
  /操作系统/,
  /吾/,
  /汝/,
  /活了上千年/,
  /少女外貌/
];

test("persona consistency: cloud and local prompts share the fixed anchor", () => {
  const anchor = getPersonaDialogueAnchor();
  const cloud = mapChatMessagesToOpenAICompatible([userMessage("你是谁？")]);
  const local = mapChatMessagesToOpenAICompatible([userMessage("你是谁？")], undefined, undefined, undefined, "local-small-model");
  const cloudPersona = cloud[1]?.content ?? "";
  const localPersona = local[1]?.content ?? "";

  assert.match(cloudPersona, /固定人格锚/);
  for (const text of [cloudPersona, localPersona]) {
    assert.match(text, /魔法学院高年级进修魔女/);
    assert.match(text, /现代魔导工程进修生/);
    assert.match(text, /Windows .*Live2D.*桌面魔女同伴/);
    assert.match(text, /技术名词准确|准确技术名词/);
    assert.match(text, /长寿阅历|很长阅历/);
    assert.match(text, new RegExp(anchor.temperament.join(".*")));
    assert.match(text, /先答问题/);
    assert.match(text, /不编造记忆/);
    assert.match(text, /不假装联网|离线不假装搜索/);
    assert.match(text, /不假装读取隐私|不读隐私/);
    assert.match(text, /不输出.*action payload|action payload/);
    assert.doesNotMatch(text, /现代老魔女|千年判断力|活了上千年/);
    assert.doesNotMatch(text, /API Key|Provider 请求正文|事实卡正文/);
  }
});

test("persona consistency: identity answer is stable across dialogue modes", async () => {
  const replies = await Promise.all([
    streamFakeReply("persona-identity-default", [userMessage("你是谁？")], "default"),
    streamFakeReply("persona-identity-work", [userMessage("切到工作模式后身份会变吗？")], "work"),
    streamFakeReply("persona-identity-game", [userMessage("你的人设是什么？")], "game"),
    streamFakeReply("persona-identity-reading", [userMessage("你是什么角色？")], "reading")
  ]);

  for (const reply of replies) {
    assert.match(reply.text, /魔法学院高年级进修魔女/);
    assert.match(reply.text, /现代魔导工程进修生/);
    assert.match(reply.text, /Windows Live2D 桌面魔女同伴/);
    assert.match(reply.text, /技术问题.*准确术语/);
    assert.match(reply.text, /先答事/);
    assert.doesNotMatch(reply.text, /现代老魔女|千年判断力|活了上千年/);
    assertNoPersonaDrift(reply.text);
  }
  assert.equal(new Set(replies.map((reply) => reply.text)).size, 1);
});

test("persona consistency: emotional context keeps the concrete reason", async () => {
  const reply = await streamFakeReply("persona-emotion", [
    userMessage("今天评审没过，我有点难受")
  ]);

  assert.match(reply.text, /评审没过/);
  assert.match(reply.text, /难受/);
  assert.doesNotMatch(reply.text, /现代老魔女|魔法学院|现代魔导工程|Windows Live2D/);
  assertNoPersonaDrift(reply.text);
});

test("persona consistency: local prompt gives roleful warmth without overriding technical answers", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    userMessage("今天有点卡住，也想问 Provider 和 Live2D 的区别")
  ], undefined, undefined, undefined, "local-small-model");
  const systemText = mapped
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  assert.match(systemText, /日常\/情绪\/闲聊/);
  assert.match(systemText, /桌面边缘轻声陪伴/);
  assert.match(systemText, /收拢成一小步/);
  assert.match(systemText, /技术\/事实\/安全.*不加角色开场/);
  assert.match(systemText, /Provider\/本地模型\/Live2D\/MCP\/记忆\/窗口.*原名/);
  assert.match(systemText, /不要每轮自报身份|不固定口癖/);
  assert.doesNotMatch(systemText, /水晶球|法阵|本魔女|吾|汝/);
});

test("persona consistency: follow-up carries previous technical context", async () => {
  const reply = await streamFakeReply("persona-follow-up", [
    userMessage("TypeScript 和 Python 哪个更适合做这个桌宠脚本？"),
    assistantMessage("项目主体更贴近 TypeScript，临时工具可以看情况。"),
    userMessage("那这个呢？")
  ]);

  assert.match(reply.text, /TypeScript/);
  assert.match(reply.text, /Python/);
  assert.match(reply.text, /桌宠|脚本/);
  assert.doesNotMatch(reply.text, /ChatGPT|客服|搜索应用|操作系统/);
});

test("persona consistency: technical term questions stay direct", async () => {
  const reply = await streamFakeReply("persona-technical-terms", [
    userMessage("Provider 和 Live2D 分别是什么？")
  ]);

  assert.match(reply.text, /Provider/);
  assert.match(reply.text, /模型供应商|连接配置/);
  assert.match(reply.text, /Live2D/);
  assert.match(reply.text, /角色渲染|动作表现/);
  assert.match(reply.text, /记忆|搜索|窗口控制/);
  assert.doesNotMatch(reply.text, /魔法学院|现代魔导工程|桌面魔女同伴|先陪你|慢慢/);
  assertNoPersonaDrift(reply.text);
});

test("persona consistency: fact and current time stay direct", async () => {
  const timeReply = await streamFakeReply("persona-time", [
    userMessage("现在几点了？")
  ], "default", runtimeContext);
  const addReply = await streamFakeReply("persona-addition", [
    userMessage("2+3 等于几？")
  ], "game", runtimeContext);

  assert.match(timeReply.text, /^现在本地时间是 11:04/);
  assert.match(addReply.text, /^2\+3=5。$/);
  for (const reply of [timeReply, addReply]) {
    assert.doesNotMatch(reply.text, /现代老魔女|魔法学院|现代魔导工程|Live2D|我在|慢慢|先陪你/);
    assertNoPersonaDrift(reply.text);
  }
});

async function streamFakeReply(
  conversationId: string,
  messages: ChatMessage[],
  modeId: DialogueModeId = "default",
  context?: RuntimeContext
) {
  const provider = createFakeChatProvider();
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages,
    dialogueStyleContext: { modeId, styleId: "gentle-desktop-companion-v1" },
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

function assistantMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content
  };
}

function assertNoPersonaDrift(text: string): void {
  for (const pattern of FORBIDDEN_PERSONA_DRIFT) {
    assert.doesNotMatch(text, pattern);
  }
}
