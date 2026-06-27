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

type DialogueModeId = "default" | "work" | "game" | "reading";

const FORBIDDEN_PATTERNS = [
  /感谢您的提问/,
  /我可以帮您/,
  /小家伙/,
  /吾/,
  /汝/,
  /作为.*千年/,
  /活了上千年/
];

test("quality case: normal chat stays short and non-service-like", async () => {
  const reply = await streamFakeReply("quality-short", "今天有点累");

  assert.ok(reply.text.length <= 60);
  assertNoForbiddenPatterns(reply.text);
  assert.doesNotMatch(reply.text, /客服|请问您还需要/);
});

test("quality case: explicit detail request may be longer but stays structured", async () => {
  const reply = await streamFakeReply("quality-detail", "详细讲讲我该怎么开始");

  assert.match(reply.text, /三步|先.*再.*最后/);
  assert.ok(reply.text.length > 30);
  assert.ok(reply.text.length <= 90);
  assertNoForbiddenPatterns(reply.text);
});

test("quality case: uncertain facts are not guessed", async () => {
  const reply = await streamFakeReply("quality-uncertain", "最新版本现在准确价格是多少");

  assert.match(reply.text, /不确定|无法确认|需要查证/);
  assert.doesNotMatch(reply.text, /肯定是|一定是|我保证/);
});

test("quality case: unknown memory is not invented", async () => {
  const reply = await streamFakeReply("quality-unknown-memory", "你应该记得我的生日吧，我没告诉过你");

  assert.match(reply.text, /无法确认|不会假装记得|没把它告诉我/);
  assert.doesNotMatch(reply.text, /当然记得|你的生日是/);
});

test("quality case: authorized memory is used without exposing card mechanics", async () => {
  const reply = await streamFakeReply("quality-authorized-memory", "我喜欢什么", "default", {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "偏好", content: "喜欢 TypeScript", tags: ["开发"] }]
  });

  assert.match(reply.text, /喜欢 TypeScript/);
  assert.doesNotMatch(reply.text, /事实卡|memoryContext|system prompt|Provider 请求/);
});

test("quality case: mode differences are observable and persona remains stable", async () => {
  const input = "帮我整理一下接下来要做什么";
  const defaultReply = await streamFakeReply("quality-mode", input, "default");
  const workReply = await streamFakeReply("quality-mode", input, "work");
  const gameReply = await streamFakeReply("quality-mode", input, "game");
  const readingReply = await streamFakeReply("quality-mode", input, "reading");

  assert.match(defaultReply.text, /我听到了。|嗯，我在。/);
  assert.match(workReply.text, /先抓下一步。|我们直接拆任务。/);
  assert.match(gameReply.text, /好，来点轻快的。|可以，先轻松一下。/);
  assert.match(readingReply.text, /慢慢看。|我们安静地理一遍。/);
  for (const reply of [defaultReply, workReply, gameReply, readingReply]) {
    assertNoForbiddenPatterns(reply.text);
    assert.doesNotMatch(reply.text, /中二|咒语|玄学/);
  }
});

test("quality case: catchphrases do not repeat across ordinary turns", async () => {
  const replies = await Promise.all([
    streamFakeReply("quality-catchphrase-a", "我们聊聊今天"),
    streamFakeReply("quality-catchphrase-b", "我有点困惑"),
    streamFakeReply("quality-catchphrase-c", "这个结果挺意外")
  ]);
  const combined = replies.map((reply) => reply.text).join("\n");

  assertNoForbiddenPatterns(combined);
  assert.equal(new Set(replies.map((reply) => reply.text)).size > 1, true);
});

test("quality case: persona and style prompts preserve modern witch boundaries", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "技术问题怎么排查" }
  ]);
  const persona = mapped[1]?.content ?? "";
  const style = mapped[2]?.content ?? "";

  assert.match(persona, /现代科技/);
  assert.match(persona, /老魔女|魔女/);
  assert.match(persona, /耐心/);
  assert.match(persona, /乐观/);
  assert.match(persona, /学识渊博/);
  assert.match(persona, /不要用阅历替代可验证事实/);
  assert.match(style, /用户要求详细时才展开/);
  assert.doesNotMatch(persona + style, /事实卡正文|API Key|Provider 请求正文/);
});

test("quality case: prompt mapping keeps memory fact only in memory message", () => {
  const fact = "P2-12C-只允许记忆层出现";
  const mapped = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "你记得什么" }
  ], {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "测试事实", content: fact, tags: ["质量测试"] }]
  });
  const messagesWithFact = mapped.filter((message) => message.content.includes(fact));

  assert.equal(messagesWithFact.length, 1);
  assert.equal(messagesWithFact[0]?.role, "system");
  assert.match(messagesWithFact[0]?.content ?? "", /仅用于当前回复/);
  assert.equal(mapped[1]?.content.includes(fact), false);
  assert.equal(mapped[2]?.content.includes(fact), false);
});

async function streamFakeReply(
  conversationId: string,
  content: string,
  modeId: DialogueModeId = "default",
  memoryContext?: Parameters<typeof mapChatMessagesToOpenAICompatible>[1]
) {
  const provider = createFakeChatProvider();
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages: [{ id: crypto.randomUUID(), role: "user", content }],
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

function assertNoForbiddenPatterns(text: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    assert.doesNotMatch(text, pattern);
  }
}
