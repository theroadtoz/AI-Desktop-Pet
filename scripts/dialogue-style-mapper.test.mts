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
  const gameMapped = mapChatMessagesToOpenAICompatible(messages, undefined, {
    modeId: "game",
    styleId: "gentle-desktop-companion-v1"
  });
  const readingMapped = mapChatMessagesToOpenAICompatible(messages, memoryContext, {
    modeId: "reading",
    styleId: "gentle-desktop-companion-v1"
  });

  assert.match(defaultMapped[2]?.content ?? "", /默认陪伴/);
  assert.match(workMapped[2]?.content ?? "", /当前模式：工作/);
  assert.match(workMapped[2]?.content ?? "", /陪伴优先.*不是任务助手/);
  assert.match(workMapped[2]?.content ?? "", /安静.*陪伴.*不.*拆任务.*下一步/);
  assert.doesNotMatch(workMapped[2]?.content ?? "", /优先拆下一步|给清晰行动建议/);
  assert.match(gameMapped[2]?.content ?? "", /当前模式：游戏/);
  assert.match(readingMapped[2]?.content ?? "", /当前模式：读书/);
  assert.notEqual(defaultMapped[2]?.content, workMapped[2]?.content);
  assert.notEqual(workMapped[2]?.content, gameMapped[2]?.content);
  assert.notEqual(gameMapped[2]?.content, readingMapped[2]?.content);
  assert.equal(workMapped.some((message) => message.content.includes("P2-10C-事实卡正文")), false);
  assert.equal(readingMapped[2]?.content.includes("P2-10C-事实卡正文"), false);
  assert.equal(readingMapped.some((message) => message.role === "system" && message.content.includes("P2-10C-事实卡正文")), true);
});

test("provider message mapping inserts persona before dialogue style", () => {
  const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "你好" }];
  const mapped = mapChatMessagesToOpenAICompatible(messages, undefined, {
    modeId: "default",
    styleId: "gentle-desktop-companion-v1"
  });

  assert.match(mapped[0]?.content ?? "", /低打扰的桌面伙伴/);
  assert.match(mapped[1]?.content ?? "", /现代科技/);
  assert.match(mapped[1]?.content ?? "", /老魔女|魔女/);
  assert.match(mapped[1]?.content ?? "", /耐心/);
  assert.match(mapped[1]?.content ?? "", /乐观/);
  assert.match(mapped[1]?.content ?? "", /学识渊博/);
  assert.match(mapped[1]?.content ?? "", /桌面场景/);
  assert.match(mapped[1]?.content ?? "", /隐私边界/);
  assert.match(mapped[1]?.content ?? "", /记忆边界/);
  assert.match(mapped[1]?.content ?? "", /受限语义白名单.*不直接控制 Live2D/);
  assert.match(mapped[1]?.content ?? "", /搜索边界/);
  assert.doesNotMatch(mapped[1]?.content ?? "", /吾|汝|小家伙/);
  assert.doesNotMatch(mapped[1]?.content ?? "", /"action"\s*:/);
  assert.match(mapped[2]?.content ?? "", /当前模式：默认陪伴/);
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

test("provider message mapping keeps empty memory out and fact cards only in memory message", () => {
  const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "你好" }];
  const emptyMemoryMapped = mapChatMessagesToOpenAICompatible(messages, { count: 0, cards: [] });
  const factText = "P2-12B-事实卡正文";
  const mapped = mapChatMessagesToOpenAICompatible(messages, {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "偏好", content: factText, tags: ["测试"] }]
  });

  assert.equal(emptyMemoryMapped.some((message) => message.content.includes("以下是用户明确授权保存在本机的事实卡")), false);
  assert.equal(mapped[1]?.content.includes(factText), false);
  assert.equal(mapped[2]?.content.includes(factText), false);
  assert.equal(mapped.filter((message) => message.content.includes(factText)).length, 1);
  assert.match(mapped.find((message) => message.content.includes(factText))?.content ?? "", /仅用于当前回复/);
});

test("fake provider replies vary by dialogue mode and stay short", async () => {
  const provider = createFakeChatProvider();
  const defaultReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊");
  const workReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊", "work");
  const gameReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊", "game");
  const readingReply = await streamFakeReply(provider, "conversation-mode", "我们聊聊", "reading");

  assert.match(defaultReply.result.text, /我听到了。|嗯，我在。/);
  assert.match(workReply.result.text, /我安静陪你。|忙你的吧，我在旁边陪着。/);
  assert.doesNotMatch(workReply.result.text, /下一步|拆任务|建议|需要我|要解决/);
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
