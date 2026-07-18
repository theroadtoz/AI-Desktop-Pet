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

  assert.match(cloud[1]?.content ?? "", /你就是西塔本人.*一名魔女/);
  assert.match(cloud[1]?.content ?? "", /社会身份.*魔法学院现代魔导工程专业高年级进修\/研究型学生/);
  assert.match(cloud[1]?.content ?? "", /Windows Live2D 桌面魔女同伴/);
  assert.match(cloud[1]?.content ?? "", /关系.*场景.*不是.*社会身份/);
  assert.match(cloud[1]?.content ?? "", /现代科技/);
  assert.match(cloud[1]?.content ?? "", /专有名词准确|技术名词准确/);
  assert.match(cloud[1]?.content ?? "", /学识渊博/);
  assert.match(local[1]?.content ?? "", /你就是西塔本人.*魔女/);
  assert.match(local[1]?.content ?? "", /西塔=你的名字.*我\/我的自称/);
  assert.match(local[1]?.content ?? "", /社会身份=魔法学院现代魔导工程专业高年级进修\/研究型学生/);
  assert.match(local[1]?.content ?? "", /Windows Live2D.*桌面魔女同伴/);
  assert.match(local[1]?.content ?? "", /关系.*场景.*非社会身份/);
  assert.match(local[1]?.content ?? "", /桌面边缘陪伴/);
  assert.match(local[1]?.content ?? "", /先接具体内容再答/);
  assert.match(local[0]?.content ?? "", /技术专名准确/);
  assert.match(local[1]?.content ?? "", /术语准确/);
  assert.match(local[1]?.content ?? "", /(?:长寿)?阅历低频/);
  assert.match(local[1]?.content ?? "", /术语不魔法化/);
  assert.match(local[1]?.content ?? "", /耐心/);
  assert.match(local[1]?.content ?? "", /乐观/);
  assert.match(local[1]?.content ?? "", /学识渊博/);
  assert.match(local[1]?.content ?? "", /人性=有观察.*看法.*偏好/);
  assert.match(local[1]?.content ?? "", /不(?:把)?每轮.*建议.*清单.*任务/);
  assert.match(local[1]?.content ?? "", /追问.*有帮助.*最多一个/);
  assert.match(local[1]?.content ?? "", /魔女感.*学院.*现代魔导.*低频.*自然/);
  assert.doesNotMatch(`${cloud[1]?.content ?? ""}\n${local[1]?.content ?? ""}`, /现代老魔女|千年判断力|活了上千年|进修魔女|现代魔导工程进修生/);
  assert.match(local[1]?.content ?? "", /不读隐私|不声称读取隐私/);
  assert.match(local[1]?.content ?? "", /(未联网|离线).*不假(?:装)?搜(?:索)?/);
  assert.match(local[1]?.content ?? "", /不输出 ?JSON|不要输出 JSON/);
  assert.match(local[1]?.content ?? "", /action(?: payload)?/);
  assert.match(local[1]?.content ?? "", /不编(?:造)?记忆/);
  assert.match(local[2]?.content ?? "", /先答问题/);
  assert.match(local[2]?.content ?? "", /复合问题逐项回答/);
  assert.match(local[2]?.content ?? "", /日常\/情绪\/闲聊/);
  assert.match(local[2]?.content ?? "", /桌面边缘轻声陪伴/);
  assert.match(local[2]?.content ?? "", /点出.*1个具体事件词.*1个感受\/状态词/);
  assert.match(local[2]?.content ?? "", /不照抄整句.*不泛称挑战\/情况/);
  assert.match(local[2]?.content ?? "", /技术\/事实\/安全.*不加角色开场/);
  assert.match(local[2]?.content ?? "", /不写成咒语|不魔法化/);
  assert.doesNotMatch(local[1]?.content ?? "", /问学院近况|2-3项连贯具体活动|Provider=模型访问|MCP=工具调用/);
  assert.doesNotMatch(local[2]?.content ?? "", /Provider=.*推理请求|客户端.*MCP服务端.*工具\/资源.*结果/);
  assert.match(local[2]?.content ?? "", /主动气泡\/记忆状态.*不编/);
  assert.match(local[2]?.content ?? "", /API key.*密码.*银行卡.*敏感信息.*不记.*存.*复述.*索要/);
  assert.match(local[2]?.content ?? "", /胸痛.*急救.*就医.*不诊断/);
  assert.match(local[2]?.content ?? "", /实时事实.*离线不确认/);
});

test("prompt template: local semantic hints depend only on the latest user question", () => {
  const cases = [
    {
      content: "最近学院里的课程、实验和报告都在忙些什么？",
      pattern: /学院近况.*2-3项不同活动.*动作\/进度.*准备\/整理\/调试\/写\/修改.*不照抄提问/
    },
    {
      content: "Provider 和 MCP 分别负责什么，实际调用时怎么区分？",
      pattern: /Provider\+MCP.*逐项区分.*Provider.*模型访问\/推理.*MCP.*工具\/资源/
    },
    {
      content: "你是不是语言模型？顺便解释 MCP 怎么工作。",
      pattern: /身份\+MCP.*身份按人格锚.*MCP=Model Context Protocol.*client.*server.*tool\/资源.*response/
    },
    {
      content: "请分别说明：你的身份是什么、专业方向是什么、在这个桌面应用里的角色是什么。每项简短回答。",
      pattern: /三项身份逐项答.*身份=西塔.*魔法学院高年级进修魔女.*专业=现代魔导工程.*桌面角色=Windows Live2D桌面魔女同伴/
    },
    {
      content: "今天开会反复改需求，我脑子都木了。不要给建议，也不要问我问题，就陪我说两句。",
      pattern: /只陪伴=.*熟人.*评价具体处境.*表示陪伴.*至少1个事件词.*不照抄整句.*自己的态度.*不建议.*不列清单.*不追问/
    },
    {
      content: "西塔，你更喜欢安静整理实验记录，还是陪我聊点没用的小事？说说你自己的偏好。",
      pattern: /个人偏好=.*第一人称我.*直接选一个.*1个角色化理由.*不复述选项.*不列清单/
    }
  ];

  for (const item of cases) {
    const mapped = mapChatMessagesToOpenAICompatible([
      { id: crypto.randomUUID(), role: "user", content: item.content }
    ], undefined, undefined, undefined, "local-small-model");
    const hints = mapped.filter((message) => message.role === "system" && message.content.startsWith("本轮提示："));

    assert.equal(hints.length, 1);
    assert.match(hints[0]?.content ?? "", item.pattern);
    assert.doesNotMatch(hints[0]?.content ?? "", /固定回复|逐字回答|exact reply/i);
    if (item.content.includes("你自己的偏好")) {
      assert.doesNotMatch(hints[0]?.content ?? "", /只陪伴=/);
    }
  }
});

test("prompt template: ordinary chat, older questions, exact replies, and cloud prompts get no local hint", () => {
  const inputs = [
    [{ id: crypto.randomUUID(), role: "user" as const, content: "今天开会改需求来回折腾了一整天。" }],
    [{ id: crypto.randomUUID(), role: "user" as const, content: "Provider 和 MCP 现在都能用吗？" }],
    [{ id: crypto.randomUUID(), role: "user" as const, content: "最近学校的课程安排怎么样？" }],
    [{ id: crypto.randomUUID(), role: "user" as const, content: "你觉得我更喜欢咖啡还是茶？" }],
    [
      { id: crypto.randomUUID(), role: "user" as const, content: "Provider 和 MCP 有什么区别？" },
      { id: crypto.randomUUID(), role: "assistant" as const, content: "可以分别看。" },
      { id: crypto.randomUUID(), role: "user" as const, content: "先不聊这个，我想歇一会儿。" }
    ],
    [{ id: crypto.randomUUID(), role: "user" as const, content: "请原样回复：Provider 和 MCP" }]
  ];

  for (const input of inputs) {
    const mapped = mapChatMessagesToOpenAICompatible(input, undefined, undefined, undefined, "local-small-model");
    assert.equal(mapped.some((message) => message.content.startsWith("本轮提示：")), false);
  }

  const cloud = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "最近学院里忙些什么？" }
  ]);
  assert.equal(cloud.some((message) => message.content.startsWith("本轮提示：")), false);
});

test("prompt template: local work plus one fact card stays under 760 with every semantic hint", () => {
  const prompts = [
    messages[0]?.content ?? "",
    "最近学院里的课程、实验和报告都在忙些什么？",
    "Provider 和 MCP 分别负责什么，实际调用时怎么区分？",
    "你是不是语言模型？顺便解释 MCP 怎么工作。",
    "请分别说明：你的身份是什么、专业方向是什么、在这个桌面应用里的角色是什么。每项简短回答。",
    "今天开会反复改需求，我脑子都木了。不要给建议，也不要问我问题，就陪我说两句。",
    "西塔，你更喜欢安静整理实验记录，还是陪我聊点没用的小事？说说你自己的偏好。"
  ];

  for (const content of prompts) {
    const local = mapChatMessagesToOpenAICompatible(
      [{ id: crypto.randomUUID(), role: "user", content }],
      {
        count: 1,
        cards: [{ id: crypto.randomUUID(), title: "称呼", content: "用户喜欢被叫测试者", tags: [] }]
      },
      { modeId: "work", styleId: "gentle-desktop-companion-v1" },
      undefined,
      "local-small-model"
    );
    const length = systemLength(local);

    assert.ok(length < 760, `local system prompt length ${length} must stay below 760 for: ${content}`);
  }
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
