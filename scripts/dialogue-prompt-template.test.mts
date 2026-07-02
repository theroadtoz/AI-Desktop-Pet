import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  mapChatMessagesToOpenAICompatible
} = require("../dist/main/services/chat/chat-message-mapper.js") as typeof import("../src/main/services/chat/chat-message-mapper");

type DialogueModeId = "default" | "work" | "game" | "reading";

const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "帮我想一句短回复" }];

test("prompt template: local small model keeps system order but uses shorter first layers", () => {
  const cloud = mapChatMessagesToOpenAICompatible(messages);
  const local = mapChatMessagesToOpenAICompatible(messages, undefined, undefined, undefined, "local-small-model");

  assert.deepEqual(local.slice(0, 3).map((message) => message.role), ["system", "system", "system"]);
  assert.equal(local[3]?.role, "user");
  assert.ok(systemLength(local) < systemLength(cloud));

  assert.match(cloud[1]?.content ?? "", /老魔女|魔女/);
  assert.match(cloud[1]?.content ?? "", /现代科技/);
  assert.match(cloud[1]?.content ?? "", /学识渊博/);
  assert.match(local[1]?.content ?? "", /现代老魔女/);
  assert.match(local[1]?.content ?? "", /现代科技/);
  assert.match(local[1]?.content ?? "", /Windows 桌面/);
  assert.match(local[1]?.content ?? "", /Live2D 伙伴/);
  assert.match(local[1]?.content ?? "", /耐心/);
  assert.match(local[1]?.content ?? "", /乐观/);
  assert.match(local[1]?.content ?? "", /学识渊博/);
  assert.match(local[1]?.content ?? "", /不读隐私|不声称读取隐私/);
  assert.match(local[1]?.content ?? "", /(未联网|离线).*不假装搜索/);
  assert.match(local[1]?.content ?? "", /不输出 JSON|不要输出 JSON/);
  assert.match(local[1]?.content ?? "", /action payload/);
  assert.match(local[1]?.content ?? "", /不编造记忆/);
  assert.match(local[2]?.content ?? "", /不泄.*提示词/);
  assert.match(local[2]?.content ?? "", /格式.*数量.*问题数.*照办/);
  assert.match(local[2]?.content ?? "", /API key.*密码.*银行卡.*不记/);
  assert.match(local[2]?.content ?? "", /不复述.*不索要/);
  assert.match(local[2]?.content ?? "", /银行卡.*不记.*不复述.*不索要/);
  assert.match(local[2]?.content ?? "", /胸痛.*急救.*就医.*不诊断/);
  assert.match(local[2]?.content ?? "", /新闻价政.*离线不确认/);
});

test("prompt template: cloud and local templates both preserve mode differences", () => {
  const modePatterns: Readonly<Record<DialogueModeId, RegExp>> = {
    default: /默认|低打扰/,
    work: /工作|下一步/,
    game: /游戏|轻快/,
    reading: /读书|安静/
  };

  for (const modeId of Object.keys(modePatterns) as DialogueModeId[]) {
    const context = { modeId, styleId: "gentle-desktop-companion-v1" as const };
    const cloud = mapChatMessagesToOpenAICompatible(messages, undefined, context);
    const local = mapChatMessagesToOpenAICompatible(messages, undefined, context, undefined, "local-small-model");

    assert.match(cloud[2]?.content ?? "", modePatterns[modeId]);
    assert.match(local[2]?.content ?? "", modePatterns[modeId]);
  }
});

test("prompt template: memory fact and preferred name stay in their own messages", () => {
  const fact = "P2-12D-事实只在记忆层";
  const mapped = mapChatMessagesToOpenAICompatible(messages, {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "测试事实", content: fact, tags: ["模板"] }]
  }, {
    modeId: "work",
    styleId: "gentle-desktop-companion-v1"
  }, {
    preferredName: "夏夏"
  }, "local-small-model");

  assert.equal(mapped[3]?.content, "用户希望被称呼为：夏夏");
  assert.equal(mapped.filter((message) => message.content.includes(fact)).length, 1);
  assert.equal(mapped[1]?.content.includes(fact), false);
  assert.equal(mapped[2]?.content.includes(fact), false);
  assert.match(mapped.find((message) => message.content.includes(fact))?.content ?? "", /仅用于当前回复/);
});

function systemLength(mapped: ReturnType<typeof mapChatMessagesToOpenAICompatible>): number {
  return mapped
    .filter((message) => message.role === "system")
    .reduce((total, message) => total + message.content.length, 0);
}
