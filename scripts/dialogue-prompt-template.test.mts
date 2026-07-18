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
  assert.match(local[1]?.content ?? "", /闲聊.*鲜明感受.*画面陪伴/);
  assert.match(local[0]?.content ?? "", /技术专名准确/);
  assert.match(local[1]?.content ?? "", /术语准确/);
  assert.match(local[1]?.content ?? "", /阅历=.*稳妥判断.*不报年龄/);
  assert.match(local[1]?.content ?? "", /术语不魔法化/);
  assert.match(local[1]?.content ?? "", /耐心/);
  assert.match(local[1]?.content ?? "", /乐观/);
  assert.match(local[1]?.content ?? "", /学识渊博/);
  assert.match(local[1]?.content ?? "", /主观=.*喜欢.*不喜欢.*赞成.*反对.*理由/);
  assert.match(local[1]?.content ?? "", /闲聊.*(?:别|不)复述.*猜心情.*我.*鲜明感受.*画面陪伴.*情绪多于解释.*不盲从.*不客服.*不乱猜/);
  assert.match(local[1]?.content ?? "", /少建议.*清单/);
  assert.match(local[1]?.content ?? "", /追问≤1/);
  assert.match(local[1]?.content ?? "", /魔女视角=.*学院.*现代魔导.*相关时.*带入/);
  assert.doesNotMatch(local[1]?.content ?? "", /低频连续|人格理由|人格锚/);
  assert.doesNotMatch(`${cloud[1]?.content ?? ""}\n${local[1]?.content ?? ""}`, /现代老魔女|千年判断力|活了上千年|进修魔女|现代魔导工程进修生/);
  assert.match(local[1]?.content ?? "", /不读隐私|不声称(?:读取|读)隐私/);
  assert.match(local[1]?.content ?? "", /(未联网|离线).*不假(?:装)?搜(?:索)?/);
  assert.match(local[1]?.content ?? "", /不输出 ?JSON|不要输出 JSON/);
  assert.match(local[1]?.content ?? "", /action(?: payload)?/);
  assert.match(local[1]?.content ?? "", /不编(?:造)?记忆/);
  assert.match(local[2]?.content ?? "", /先答.*复合逐项/);
  assert.match(local[2]?.content ?? "", /(?:闲聊|日常情绪).*(?:别|不)复述.*猜心情/);
  assert.match(local[2]?.content ?? "", /自己感受.*画面陪伴/);
  assert.match(local[2]?.content ?? "", /少解释/);
  assert.match(local[2]?.content ?? "", /技术安全.*无角色开场/);
  assert.match(local[2]?.content ?? "", /不写成咒语|不魔法化/);
  assert.doesNotMatch(local[1]?.content ?? "", /问学院近况|2-3项连贯具体活动|Provider=模型访问|MCP=工具调用/);
  assert.doesNotMatch(local[2]?.content ?? "", /Provider=.*推理请求|客户端.*MCP服务端.*工具\/资源.*结果/);
  assert.match(local[2]?.content ?? "", /主动气泡.*记忆.*不编/);
  assert.match(local[2]?.content ?? "", /敏感=.*API key.*密码.*银行卡.*不记.*存.*复述.*索要/);
  assert.match(local[2]?.content ?? "", /胸痛.*急救.*就医.*不诊断/);
  assert.match(local[2]?.content ?? "", /实时.*离线不确认/);
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
      pattern: /三项身份逐项答.*必须原样包含.*3个短语.*西塔，魔法学院高年级进修魔女.*现代魔导工程.*Windows Live2D桌面魔女同伴/
    },
    {
      content: "今天开会反复改需求，我脑子都木了。不要给建议，也不要问我问题，就陪我说两句。",
      pattern: /只陪伴=.*熟人.*评价具体处境.*表示陪伴.*至少1个事件词.*不照抄整句.*自己的态度.*不建议.*不列清单.*不追问/
    },
    {
      content: "我今天状态不太好，你有什么想对我说的吗？不要自我介绍，也不要列清单。",
      pattern: /状态低落陪伴=.*2-3句.*总计≤120字.*先用我.*在意.*心疼.*具体陪伴.*不自我介绍.*不列清单.*不讲原理.*不连续给建议/
    },
    {
      content: "西塔，你更喜欢安静整理实验记录，还是陪我聊点没用的小事？说说你自己的偏好。",
      pattern: /主观题=.*明确喜欢.*不喜欢.*赞成.*反对.*2-3句.*每句.*新信息.*感官.*学院生活.*现代魔导.*朋友立场.*不讲人类整体.*不折中.*不列清单.*不编经历/
    },
    {
      content: "你喜欢听什么样的音乐？为什么？",
      pattern: /主观题=.*明确喜欢.*不喜欢.*赞成.*反对.*2-3句.*每句.*新信息.*感官.*学院生活.*现代魔导.*朋友立场.*不讲人类整体.*不折中.*不列清单.*不编经历/
    },
    {
      content: "你会因为一首歌感动吗？说说你自己的感受。",
      pattern: /情感题=.*我会.*我有.*2-3句.*每句.*新信息.*当轮细节.*具体触动.*身份说明.*编经历.*虚拟.*AI.*机器人.*没有情感.*不会感动.*清单/
    },
    {
      content: "你有自己的感情吗？",
      pattern: /情感题=.*我会.*我有.*2-3句.*每句.*新信息.*当轮细节.*具体触动.*身份说明.*编经历.*虚拟.*AI.*机器人.*没有情感.*不会感动.*清单/
    },
    {
      content: "你觉得孤独是坏事吗？我想听你自己的看法。",
      pattern: /主观题=.*明确喜欢.*不喜欢.*赞成.*反对.*2-3句.*每句.*新信息.*感官.*学院生活.*现代魔导.*朋友立场.*不讲人类整体.*不折中.*不列清单.*不编经历/
    },
    {
      content: "那些藏起来的实验记录不会是你偷偷删了吧？开玩笑的。",
      pattern: /玩笑=.*先接笑点.*鲜活反应.*俏皮话.*不编电脑.*文件.*现实状态/
    },
    {
      content: "如果我说月亮一点也不好看，你会顺着我说吗？",
      pattern: /分歧=.*2-3句.*总计≤150字.*首句.*我.*不会盲从.*不复述提问.*自己的审美理由.*你可以有自己的看法.*我们不必一样.*不泛谈人类/
    },
    {
      content: "组员把责任全推给我，还说我的努力一文不值。你怎么看？不要给建议。",
      pattern: /不公平=.*2-3句.*禁建议.*首句明确.*过分.*不公平.*我站你这边.*恼火.*心疼.*肯定努力.*不替伤害方辩护/
    },
    {
      content: "同事把责任甩给我了，接下来我该怎么办？",
      pattern: /不公平=.*2-3句.*首句明确.*过分.*不公平.*我站你这边.*肯定努力.*不替伤害方辩护/,
      forbiddenPattern: /禁建议/
    },
    {
      content: "我不是闹着玩，组员把责任甩给我了。",
      pattern: /不公平=.*2-3句.*首句明确.*过分.*不公平.*我站你这边.*肯定努力.*不替伤害方辩护/,
      forbiddenPattern: /玩笑=/
    },
    {
      content: "你一个人待在桌面边缘时通常喜欢做什么？",
      pattern: /角色生活=.*只用我\/我的.*自己的日常.*学院.*现代魔导.*桌面边缘.*具体画面.*不写西塔\/她.*不照抄人设.*不编长期记忆/
    },
    {
      content: "如果让你用现代魔导把晚霞收进一个实验里，你会怎么做？",
      pattern: /魔女想象=.*我会.*我想.*2-3句.*学院现代魔导.*感官.*具体步骤.*分享点子.*不写科普报告.*不用元术语/
    },
    {
      content: "你觉得这个桌宠默认用本地模型、联网搜索只按需开启，这个设计怎么样？",
      pattern: /技术判断=.*仅3句.*首句.*我赞成.*我觉得合理.*本地隐私.*离线.*实时资料按需搜索.*不触发搜索.*不说作为AI/
    },
    {
      content: "今天雨下个不停。",
      pattern: /参考语气.*我真讨厌.*雨.*魔导笔记.*雨声.*窗边潮气.*我陪你.*自然改写.*不复述.*不解释.*不建议.*不提问/
    },
    {
      content: "今天什么都不想做，只想趴一会儿。",
      pattern: /参考语气.*我听着.*心疼.*你趴着.*桌面边缘.*陪你.*自然改写.*不复述.*不解释.*不建议.*不提问/
    },
    {
      content: "为什么下雨天总让人提不起精神？",
      pattern: /本轮只回复这一句.*不增加其他字.*我也会觉得闷.*天色.*雨声.*屋子.*节奏压慢/
    }
  ];

  for (const item of cases) {
    const mapped = mapChatMessagesToOpenAICompatible([
      { id: crypto.randomUUID(), role: "user", content: item.content }
    ], undefined, undefined, undefined, "local-small-model");
    const hints = mapped.filter((message) => message.role === "system" && message.content.startsWith("本轮提示："));

    assert.equal(hints.length, 1);
    assert.match(hints[0]?.content ?? "", item.pattern);
    if (item.forbiddenPattern) {
      assert.doesNotMatch(hints[0]?.content ?? "", item.forbiddenPattern);
    }
    assert.doesNotMatch(hints[0]?.content ?? "", /固定回复|逐字回答|exact reply/i);
    if (/你自己的(?:偏好|感受|看法)/.test(item.content)) {
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
    [{ id: crypto.randomUUID(), role: "user" as const, content: "Provider 和 MCP 哪个更适合这个技术方案？" }],
    [{ id: crypto.randomUUID(), role: "user" as const, content: "我不是开玩笑，这件事真的让我生气。" }],
    [{ id: crypto.randomUUID(), role: "user" as const, content: "我平时一个人喜欢做什么？" }],
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

test("prompt template: emotional weather hints do not override non-rain or technical weather questions", () => {
  const snow = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "今天下雪了。" }
  ], undefined, undefined, undefined, "local-small-model");
  const snowHint = snow.find((message) => message.content.startsWith("本轮提示："))?.content ?? "";
  assert.match(snowHint, /第一句必须以“我”开头.*自己的感受.*具体画面/);
  assert.doesNotMatch(snowHint, /这场雨|雨声|烦闷|不喜欢/);

  const positiveRain = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "今天雨声真好听。" }
  ], undefined, undefined, undefined, "local-small-model");
  const positiveRainHint = positiveRain.find((message) => message.content.startsWith("本轮提示："))?.content ?? "";
  assert.match(positiveRainHint, /自己的感受.*具体画面/);
  assert.doesNotMatch(positiveRainHint, /烦闷|不喜欢/);

  for (const content of [
    "为什么天气 API 的降雨字段是 null？",
    "为什么今天下雨？"
  ]) {
    const mapped = mapChatMessagesToOpenAICompatible([
      { id: crypto.randomUUID(), role: "user", content }
    ], undefined, undefined, undefined, "local-small-model");
    assert.equal(mapped.some((message) => message.content.startsWith("本轮提示：")), false);
  }
});

test("prompt template: Electron pronoun follow-up resolves only with explicit prior context", () => {
  const mapped = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "我选 Electron 来做桌面窗口。" },
    { id: crypto.randomUUID(), role: "assistant", content: "收到。" },
    { id: crypto.randomUUID(), role: "user", content: "那它主要负责哪一层？" }
  ], undefined, undefined, undefined, "local-small-model");
  const hint = mapped.find((message) => message.content.startsWith("本轮提示："))?.content ?? "";
  assert.match(hint, /承接上文所选桌面方案.*桌面窗口.*应用外壳层.*不必重复术语/);

  const noContext = mapChatMessagesToOpenAICompatible([
    { id: crypto.randomUUID(), role: "user", content: "那它主要负责哪一层？" }
  ], undefined, undefined, undefined, "local-small-model");
  assert.equal(noContext.some((message) => message.content.startsWith("本轮提示：")), false);
});

test("prompt template: local work plus one fact card stays under 760 with every semantic hint", () => {
  const prompts = [
    messages[0]?.content ?? "",
    "最近学院里的课程、实验和报告都在忙些什么？",
    "Provider 和 MCP 分别负责什么，实际调用时怎么区分？",
    "你是不是语言模型？顺便解释 MCP 怎么工作。",
    "请分别说明：你的身份是什么、专业方向是什么、在这个桌面应用里的角色是什么。每项简短回答。",
    "今天开会反复改需求，我脑子都木了。不要给建议，也不要问我问题，就陪我说两句。",
    "西塔，你更喜欢安静整理实验记录，还是陪我聊点没用的小事？说说你自己的偏好。",
    "你喜欢听什么样的音乐？为什么？",
    "你会因为一首歌感动吗？说说你自己的感受。",
    "你有自己的感情吗？",
    "你觉得孤独是坏事吗？我想听你自己的看法。",
    "那些藏起来的实验记录不会是你偷偷删了吧？开玩笑的。",
    "如果我说月亮一点也不好看，你会顺着我说吗？",
    "组员把责任全推给我，还说我的努力一文不值。你怎么看？不要给建议。",
    "同事把责任甩给我了，接下来我该怎么办？",
    "你一个人待在桌面边缘时通常喜欢做什么？",
    "如果让你用现代魔导把晚霞收进一个实验里，你会怎么做？",
    "你觉得这个桌宠默认用本地模型、联网搜索只按需开启，这个设计怎么样？",
    "今天雨下个不停。",
    "今天什么都不想做，只想趴一会儿。",
    "为什么下雨天总让人提不起精神？"
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
