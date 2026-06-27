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

test("dialogue style mapper creates distinct mode prompts without expanding memory", () => {
  const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "帮我安排一下" }];
  const memoryContext = {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "秘密事实", content: "P2-10C-事实卡正文", tags: [] }]
  };
  const defaultMapped = mapChatMessagesToOpenAICompatible(messages, undefined, {
    modeId: "default",
    styleId: "gentle-desktop-companion-v1"
  });
  const workMapped = mapChatMessagesToOpenAICompatible(messages, undefined, {
    modeId: "work",
    styleId: "gentle-desktop-companion-v1"
  });
  const readingMapped = mapChatMessagesToOpenAICompatible(messages, memoryContext, {
    modeId: "reading",
    styleId: "gentle-desktop-companion-v1"
  });

  assert.match(defaultMapped[1]?.content ?? "", /默认陪伴/);
  assert.match(workMapped[1]?.content ?? "", /当前模式：工作/);
  assert.match(readingMapped[1]?.content ?? "", /当前模式：读书/);
  assert.notEqual(defaultMapped[1]?.content, workMapped[1]?.content);
  assert.equal(workMapped.some((message) => message.content.includes("P2-10C-事实卡正文")), false);
  assert.equal(readingMapped[1]?.content.includes("P2-10C-事实卡正文"), false);
  assert.equal(readingMapped.some((message) => message.role === "system" && message.content.includes("P2-10C-事实卡正文")), true);
});

test("provider message mapping injects only sanitized user profile call name", () => {
  const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "你好" }];
  const mapped = mapChatMessagesToOpenAICompatible(messages, undefined, {
    modeId: "default",
    styleId: "gentle-desktop-companion-v1"
  }, {
    preferredName: "夏夏"
  });

  assert.equal(mapped.some((message) => message.role === "system" && message.content === "用户希望被称呼为：夏夏"), true);
  assert.equal(mapped.some((message) => message.content.includes("displayName")), false);
  assert.equal(mapped.some((message) => message.content.includes("completedAt")), false);
});

test("fake provider replies vary by dialogue mode and stay short", async () => {
  const provider = createFakeChatProvider();
  const defaultReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊");
  const workReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊", "work");
  const gameReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊", "game");
  const readingReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊", "reading");

  assert.match(defaultReply.result.text, /我听到了。|嗯，我在。/);
  assert.match(workReply.result.text, /先抓下一步。|我们直接拆任务。/);
  assert.match(gameReply.result.text, /好，来点轻快的。|可以，先轻松一下。/);
  assert.match(readingReply.result.text, /慢慢看。|我们安静地理一遍。/);
  assert.ok(workReply.result.text.length <= 60);
  assert.ok(gameReply.result.text.length <= 60);
  assert.ok(readingReply.result.text.length <= 60);
  assert.equal(workReply.deltaText, workReply.result.text);
});

async function streamFakeReply(
  provider: ReturnType<typeof createFakeChatProvider>,
  conversationId: string,
  content: string,
  modeId: "default" | "work" | "game" | "reading" = "default"
) {
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages: [{ id: crypto.randomUUID(), role: "user", content }],
    dialogueStyleContext: { modeId, styleId: "gentle-desktop-companion-v1" }
  }, {
    signal: new AbortController().signal,
    onDelta(delta) {
      deltaText += delta.text;
    }
  });

  return { deltaText, result };
}
