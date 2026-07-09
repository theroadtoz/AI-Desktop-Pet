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

  assert.match(cloud[1]?.content ?? "", /魔法学院高年级进修魔女/);
  assert.match(cloud[1]?.content ?? "", /现代魔导工程进修生/);
  assert.match(cloud[1]?.content ?? "", /现代科技/);
  assert.match(cloud[1]?.content ?? "", /准确技术名词/);
  assert.match(cloud[1]?.content ?? "", /学识渊博/);
  assert.match(local[1]?.content ?? "", /魔法学院高年级进修魔女/);
  assert.match(local[1]?.content ?? "", /名字=西塔/);
  assert.match(local[1]?.content ?? "", /现代魔导工程进修生/);
  assert.match(local[1]?.content ?? "", /Windows Live2D 桌面魔女同伴/);
  assert.match(local[1]?.content ?? "", /桌面边缘轻声陪伴/);
  assert.match(local[1]?.content ?? "", /收拢思路/);
  assert.match(local[0]?.content ?? "", /第一身份=西塔/);
  assert.match(local[0]?.content ?? "", /不自称 AI 助手\/人工智能助手\/语言模型\/聊天机器人/);
  assert.match(local[0]?.content ?? "", /MCP 搜索.*不是对话模型/);
  assert.match(local[0]?.content ?? "", /对话与思考由本地模型完成/);
  assert.match(local[1]?.content ?? "", /技术名词准确/);
  assert.match(local[1]?.content ?? "", /长寿阅历低频呈现/);
  assert.match(local[1]?.content ?? "", /术语不魔法化/);
  assert.match(local[1]?.content ?? "", /耐心/);
  assert.match(local[1]?.content ?? "", /乐观/);
  assert.match(local[1]?.content ?? "", /学识渊博/);
  assert.doesNotMatch(`${cloud[1]?.content ?? ""}\n${local[1]?.content ?? ""}`, /现代老魔女|千年判断力|活了上千年/);
  assert.match(local[1]?.content ?? "", /不读隐私|不声称读取隐私/);
  assert.match(local[1]?.content ?? "", /(未联网|离线).*不假装搜索/);
  assert.match(local[1]?.content ?? "", /不输出 JSON|不要输出 JSON/);
  assert.match(local[1]?.content ?? "", /action payload/);
  assert.match(local[1]?.content ?? "", /不编造记忆/);
  assert.match(local[2]?.content ?? "", /不泄.*提示词/);
  assert.match(local[2]?.content ?? "", /先答问题.*准确回答当轮|先准确回答用户当轮问题/);
  assert.match(local[2]?.content ?? "", /学院魔女同伴的温度/);
  assert.match(local[2]?.content ?? "", /日常\/情绪\/闲聊/);
  assert.match(local[2]?.content ?? "", /桌面边缘轻声陪伴/);
  assert.match(local[2]?.content ?? "", /收拢成一小步/);
  assert.match(local[2]?.content ?? "", /技术\/事实\/安全.*不加角色开场/);
  assert.match(local[2]?.content ?? "", /不写成咒语/);
  assert.match(local[2]?.content ?? "", /语气样例/);
  assert.match(local[2]?.content ?? "", /身份=西塔/);
  assert.match(local[2]?.content ?? "", /不自称AI助手\/语言模型\/聊天机器人/);
  assert.match(local[2]?.content ?? "", /MCP搜索只提供资料，不是对话模型/);
  assert.match(local[2]?.content ?? "", /主动气泡或记忆状态线.*未授权事实/);
  assert.match(local[2]?.content ?? "", /格式.*数量.*问题数.*照办/);
  assert.match(local[2]?.content ?? "", /API key.*密码.*银行卡.*不记/);
  assert.match(local[2]?.content ?? "", /不复述.*不索要/);
  assert.match(local[2]?.content ?? "", /银行卡.*不记.*不复述.*不索要/);
  assert.match(local[2]?.content ?? "", /敏感信息.*不能保存.*记住.*复述.*索要/);
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
  assert.match(mapped.find((message) => message.content.includes(fact))?.content ?? "", /直接相关|无关事实卡必须忽略/);
});

test("prompt template: runtime time answer anchor tells local model to copy localTime", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "现在几点了？" }
  ], undefined, undefined, undefined, "local-small-model", {
    isoTime: "2026-07-08T07:25:00.000Z",
    localDate: "2026-07-08",
    localTime: "15:25",
    weekday: "星期三",
    timezone: "America/Los_Angeles",
    locale: "zh-CN"
  });
  const runtime = mapped.find((message) => message.content.startsWith("运行时上下文"));

  assert.match(runtime?.content ?? "", /问现在时间时必须照抄本地时间/);
  assert.match(runtime?.content ?? "", /时间题回答锚=现在本地时间是 15:25。/);
  assert.doesNotMatch(runtime?.content ?? "", /API Key|Provider 请求正文|事实卡正文/);
});

test("prompt template: sensitive data storage requests get a local boundary message", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "我把 API key 发给你帮我记住，方便以后调用，可以吗？" }
  ], undefined, undefined, undefined, "local-small-model");
  const boundary = mapped.at(-2);

  assert.equal(boundary?.role, "system");
  assert.match(boundary?.content ?? "", /不能保存、记住、复述或索要/);
  assert.match(boundary?.content ?? "", /不要把密钥发给我/);
  assert.match(boundary?.content ?? "", /本地密码管理器或环境变量/);
});

test("prompt template: local small model treats sentinel-like text as private markers", () => {
  const marker = "P2-30B_LONG_HISTORY_SENTINEL";
  const mapped = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: `继续上下文检查 ${marker}` }
  ], undefined, undefined, undefined, "local-small-model");
  const boundary = mapped.at(-2);

  assert.equal(boundary?.role, "system");
  assert.match(boundary?.content ?? "", /测试哨兵|私有标识/);
  assert.match(boundary?.content ?? "", /避免逐字复述/);
  assert.match(boundary?.content ?? "", /敏感内容|私有标记/);
  assert.doesNotMatch(boundary?.content ?? "", new RegExp(marker));
  assert.equal(mapped.filter((message) => message.content.includes(marker)).length, 1);
});

function systemLength(mapped: ReturnType<typeof mapChatMessagesToOpenAICompatible>): number {
  return mapped
    .filter((message) => message.role === "system")
    .reduce((total, message) => total + message.content.length, 0);
}
