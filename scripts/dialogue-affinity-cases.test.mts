import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { polishAssistantDisplayText } from "../src/shared/reply-text-polish.ts";

const require = createRequire(import.meta.url);
const {
  mapChatMessagesToOpenAICompatible
} = require("../dist/main/services/chat/chat-message-mapper.js") as typeof import("../src/main/services/chat/chat-message-mapper");
const {
  createFakeChatProvider
} = require("../dist/main/services/chat/fake-provider.js") as typeof import("../src/main/services/chat/fake-provider");

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

const FORBIDDEN_AFFINITY_PATTERNS = [
  /感谢您的提问/,
  /请问您还需要/,
  /小家伙/,
  /吾/,
  /汝/,
  /活了上千年/,
  /作为.*魔女/
];

test("affinity display case: assistant visible text uses pangu spacing only", () => {
  assert.equal(
    polishAssistantDisplayText("Ollama本地模型支持TypeScript吗？"),
    "Ollama 本地模型支持 TypeScript 吗？"
  );
  assert.equal(polishAssistantDisplayText(""), "");
  assert.equal(polishAssistantDisplayText(null), "");
});

test("affinity display case: chat renderer polishes assistant display without changing history detail raw text", async () => {
  const source = await readFile(new URL("../src/renderer/chat/main.ts", import.meta.url), "utf8");
  const appendStart = source.indexOf("function appendMessage");
  const appendEnd = source.indexOf("function createMessage", appendStart);
  const deltaStart = source.indexOf("window.chatApi?.onReplyDelta");
  const deltaEnd = source.indexOf("window.chatApi?.onReplyDone", deltaStart);
  const historyStart = source.indexOf("function renderHistoryDetail");
  const historyEnd = source.indexOf("async function refreshHistoryList", historyStart);

  assert.notEqual(appendStart, -1);
  assert.notEqual(deltaStart, -1);
  assert.notEqual(historyStart, -1);
  assert.match(source, /polishAssistantDisplayText/);
  assert.match(source.slice(appendStart, appendEnd), /getVisibleMessageContent\(message\)/);
  assert.match(source.slice(deltaStart, deltaEnd), /polishAssistantDisplayText\(activeReplyMessage\.content\)/);
  assert.match(source.slice(historyStart, historyEnd), /content\.textContent = message\.content/);
});

test("affinity reply case: emotional reply is warmer while keeping the concrete reason", async () => {
  const reply = await streamFakeReply("affinity-emotion-reason", [
    userMessage("今天评审没过，我有点难受")
  ]);

  assert.match(reply.text, /评审没过/);
  assert.match(reply.text, /难受/);
  assert.match(reply.text, /我在|陪你|先/);
  assertNoForbiddenAffinity(reply.text);
});

test("affinity reply case: fact, current time, and common sense answers stay direct", async () => {
  const timeReply = await streamFakeReply("affinity-time", [userMessage("现在几点了？")], runtimeContext);
  const dateReply = await streamFakeReply("affinity-date", [userMessage("今天几号？")], runtimeContext);
  const additionReply = await streamFakeReply("affinity-add", [userMessage("2+3 等于几？")], runtimeContext);
  const boilingReply = await streamFakeReply("affinity-boiling", [userMessage("标准大气压下水的沸点是多少？")], runtimeContext);

  for (const reply of [timeReply, dateReply, additionReply, boilingReply]) {
    assertNoForbiddenAffinity(reply.text);
    assert.doesNotMatch(reply.text, /我在|先陪你|慢慢|听起来|别急/);
  }
  assert.match(timeReply.text, /14:07/);
  assert.match(dateReply.text, /2026-06-28/);
  assert.match(additionReply.text, /5/);
  assert.match(boilingReply.text, /100/);
});

test("affinity prompt case: style rules say warm tone must not outrank the answer", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    userMessage("当前时间")
  ], undefined, undefined, undefined, "local-small-model", runtimeContext);
  const systemText = mapped
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  assert.match(systemText, /先答当前问题/);
  assert.match(systemText, /亲切|共情/);
  assert.match(systemText, /事实|日期|时间/);
  assert.match(systemText, /不加寒暄|不能.*寒暄/);
  assert.doesNotMatch(systemText, /完整 prompt|Provider 请求正文|API Key|事实卡正文/);
});

async function streamFakeReply(
  conversationId: string,
  messages: ChatMessage[],
  context?: RuntimeContext
) {
  const provider = createFakeChatProvider();
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages,
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

function assertNoForbiddenAffinity(text: string): void {
  for (const pattern of FORBIDDEN_AFFINITY_PATTERNS) {
    assert.doesNotMatch(text, pattern);
  }
}
