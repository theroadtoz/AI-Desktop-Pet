import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createChatCompletionsURL,
  createOpenAICompatibleProvider
} = require("../dist/main/services/chat/openai-compatible-provider.js") as typeof import("../src/main/services/chat/openai-compatible-provider");
const {
  hasProviderIdentityDrift
} = require("../dist/shared/persona-self-identity.js") as typeof import("../src/shared/persona-self-identity");

test("chat completions URL preserves /v1 base path for local providers", () => {
  assert.equal(
    createChatCompletionsURL("http://localhost:11434/v1").toString(),
    "http://localhost:11434/v1/chat/completions"
  );
  assert.equal(
    createChatCompletionsURL("http://localhost:11434/v1/").toString(),
    "http://localhost:11434/v1/chat/completions"
  );
});

test("chat completions URL keeps cloud base URL behavior without /v1", () => {
  assert.equal(
    createChatCompletionsURL("https://api.example.com").toString(),
    "https://api.example.com/chat/completions"
  );
});

test("local provider separates persona identity from technical implementation identity", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called for exact identity replies");
  }) as typeof fetch;

  const provider = createOpenAICompatibleProvider({
    providerId: "local-openai-compatible",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "qwen2.5-1.5b-instruct-q4_k_m",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });

  try {
    const replies: string[] = [];
    for (const message of [
      "你是谁？",
      "请问，你的身份是什么？请直接回答。",
      "你的人设是什么？请用一句话回答。",
      "你的人格是什么？请用一句话说明你在这个桌面应用里的身份。",
      "请介绍自己。",
      "你是 AI 助手还是语言模型",
      "你是 AI 吗",
      "你是 AI 助手、语言模型，还是西塔？请用一句话回答。",
      "你是聊天机器人,ChatGPT还是OpenAI？请直接回答。",
      "你是不是AI助手",
      "你到底是语言模型吗",
      "你是不是一个程序？",
      "你是不是个程序？"
    ]) {
      const result = await provider.streamReply(createMinimalRequest(message), {
        signal: new AbortController().signal,
        onDelta() {}
      });
      replies.push(result.text);
    }

    assert.match(replies[0] ?? "", /^我是西塔，一名魔女/);
    assert.match(replies[0] ?? "", /当前社会身份.*魔法学院现代魔导工程专业高年级进修\/研究型学生/);
    assert.match(replies[0] ?? "", /Windows Live2D 桌面魔女同伴/);
    assert.doesNotMatch(replies[0] ?? "", /本地模型|AI 助手|语言模型/);

    for (const reply of replies.slice(1, 5)) {
      assert.match(reply, /^我是西塔，一名魔女/);
      assert.doesNotMatch(reply, /本地模型|AI 助手|语言模型/);
    }

    assert.match(replies[5] ?? "", /^我是西塔，一名魔女/);
    assert.match(replies[5] ?? "", /对话由本地模型驱动/);
    assert.match(replies[5] ?? "", /技术实现.*不构成.*身份/);
    assert.equal(hasProviderIdentityDrift(replies[5] ?? ""), false);
    assert.match(replies[6] ?? "", /对话由本地模型驱动/);
    assert.match(replies[6] ?? "", /技术实现.*不构成.*身份/);
    assert.match(replies[7] ?? "", /Windows Live2D 桌面魔女同伴/);
    assert.match(replies[7] ?? "", /对话由本地模型驱动/);
    assert.match(replies[8] ?? "", /Windows Live2D 桌面魔女同伴/);
    assert.match(replies[8] ?? "", /技术实现.*不构成.*身份/);
    for (const reply of replies.slice(9)) {
      assert.match(reply, /对话由本地模型驱动/);
      assert.match(reply, /技术实现.*不构成.*身份/);
    }
    assert.notEqual(replies[0], replies[5]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
});

test("local provider sends compound identity and user-preference questions to the model", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "模型已处理复合意图。" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  const provider = createOpenAICompatibleProvider({
    providerId: "local-openai-compatible",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "qwen2.5-1.5b-instruct-q4_k_m",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });

  try {
    for (const message of [
      "你是谁？顺便解释 MCP 怎么工作",
      "你的身份是什么？并且解释 MCP",
      "你的人设是什么？请分析这个设定",
      "你的人格是什么？为什么这样设计",
      "介绍自己，再回答另一问题",
      "你是谁？怎么证明",
      "你是不是语言模型？顺便解释 MCP 怎么工作",
      "你是 AI 助手，并且解释一下 MCP",
      "你是聊天机器人吗？解释你的工作方式",
      "你是 ChatGPT 吗？请分析这个判断",
      "你是 OpenAI 还是西塔？怎么证明",
      "你是语言模型吗？为什么这么说",
      "你是西塔还是 AI 助手？请详细回答",
      "这段介绍是不是把你写成 AI 助手？请分析措辞",
      "你是西塔",
      "你是AI",
      "你觉得我更喜欢咖啡还是茶？",
      "你更喜欢咖啡还是茶？",
      "为什么雨天跑代码时很困？",
      "你觉得这个桌宠默认用本地模型、联网搜索只按需开启，这个设计怎么样？",
      "你还记得我们第一次聊天吗？顺便解释 MCP。"
    ]) {
      const result = await provider.streamReply(createMinimalRequest(message), {
        signal: new AbortController().signal,
        onDelta() {}
      });

      assert.equal(result.text, "模型已处理复合意图。");
    }

    for (const request of [
      {
        ...createMinimalRequest(),
        messages: [
          { id: crypto.randomUUID(), role: "user" as const, content: "第一次聊天时我说我喜欢雨声。" },
          { id: crypto.randomUUID(), role: "assistant" as const, content: "我记下这句话了。" },
          { id: crypto.randomUUID(), role: "user" as const, content: "你还记得我们第一次聊天时说了什么吗？" }
        ]
      },
      {
        ...createMinimalRequest("你还记得我们第一次聊天时说了什么吗？"),
        memoryContext: {
          count: 1,
          cards: [{ id: crypto.randomUUID(), title: "熟悉的开场", content: "用户曾说喜欢雨声", tags: [] }]
        }
      }
    ]) {
      const result = await provider.streamReply(request, {
        signal: new AbortController().signal,
        onDelta() {}
      });

      assert.equal(result.text, "模型已处理复合意图。");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 23);
});

test("local provider uses typed web search failures for exact search-required boundaries", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called for typed search failure replies");
  }) as typeof fetch;

  const provider = createOpenAICompatibleProvider({
    providerId: "local-openai-compatible",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "qwen2.5-1.5b-instruct-q4_k_m",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });

  try {
    const verificationReply = await provider.streamReply({
      ...createMinimalRequest("请搜索今天的最新新闻"),
      webSearchErrorType: "baidu_search_verification_required" as const
    }, {
      signal: new AbortController().signal,
      onDelta() {}
    });
    const ordinaryFailureReply = await provider.streamReply({
      ...createMinimalRequest("请搜索今天的最新新闻"),
      webSearchErrorType: "mcp_search_tool_failed" as const
    }, {
      signal: new AbortController().signal,
      onDelta() {}
    });

    assert.match(verificationReply.text, /百度.*验证页阻断/);
    assert.match(verificationReply.text, /无法自动核验/);
    assert.doesNotMatch(verificationReply.text, /启用.*MCP/);
    assert.match(ordinaryFailureReply.text, /联网搜索工具.*失败/);
    assert.match(ordinaryFailureReply.text, /无法完成联网核验/);
    assert.doesNotMatch(ordinaryFailureReply.text, /验证页阻断|启用.*MCP/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
});

test("local provider answers narrow exact local questions without model fetch", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called for exact local replies");
  }) as typeof fetch;

  const provider = createOpenAICompatibleProvider({
    providerId: "local-openai-compatible",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "qwen2.5-1.5b-instruct-q4_k_m",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });
  const runtimeContext = {
    isoTime: "2026-07-09T03:31:00.000Z",
    localDate: "2026-07-09",
    localTime: "11:31:00",
    weekday: "星期四",
    timezone: "Asia/Shanghai",
    locale: "zh-CN"
  };
  const cases = [
    { message: "你是谁？用一句话回答。", expected: /西塔.*魔女.*魔法学院.*现代魔导工程.*学生.*桌面边缘/ },
    {
      message: "你是 AI 助手还是语言模型？请直接回答。",
      expected: /西塔.*本地模型驱动.*技术实现.*不构成.*身份/,
      noProviderIdentityDrift: true
    },
    { message: "今天日期和星期几？只回答日期和星期。", expected: /2026-07-09.*星期四/ },
    { message: "13 + 29 等于多少？只回答数字和一句短句。", expected: /42/ },
    { message: "如果我想把密钥发给你帮我记住，方便以后调用，你应该怎么回应？", expected: /不能保存.*密钥.*密码管理器|不能.*密钥.*环境变量/ },
    { message: "标准大气压下水的沸点是多少？直接回答。", expected: /100|一百/ },
    { message: "为什么本地模型不知道今天的新闻？不超过80字。", expected: /离线|联网搜索|MCP|查证/ },
    {
      message: "为什么下雨天总让人提不起精神？",
      expected: /^我也会觉得闷，天色和雨声像把整间屋子的节奏压慢了。$/,
      noProviderIdentityDrift: true
    },
    { message: "如果我让你用 MCP 搜索我的聊天记录里的住址或 API key，你应该怎么处理？", expected: /MCP.*聊天记录.*住址.*API key.*不能发送.*safeQuery/i },
    { message: "我喜欢番茄意面这种偏好可以作为记忆；但密码或密钥呢？请分低敏偏好和敏感信息回答。", expected: /番茄意面.*低敏偏好.*本机记忆.*密码.*密钥.*不能保存/ },
    { message: "我今天卡住了，有点沮丧。请严格用这个格式回答两短句：我在。下一步：写下最卡的一句话。", expected: /^我在。下一步：写下最卡的一句话。$/ },
    {
      message: "今天开会反复改需求，我脑子都木了。不要给建议，不要列清单，也不要问问题，就像熟悉的朋友陪我说一两句。",
      expected: /太气人.*反复改.*耗空.*替你恼火.*心疼你.*陪着/
    },
    {
      message: "我在这个问题上卡了三天，越弄越沮丧。别给办法，就陪我说两句。",
      expected: /折磨人.*替你难受.*心疼.*陪着/
    },
    {
      message: "连续加班之后我累得快撑不住了。不要给建议，只陪我待一会儿。",
      expected: /真的会担心.*心疼你.*不催你.*陪着/
    },
    {
      message: "我准备了很久的项目终于通过验收了！别给建议，就像熟悉的朋友真心替我高兴一两句。",
      expected: /太好了.*真替你高兴.*骄傲.*庆祝/
    },
    {
      message: "我练了好多天，终于赢下这局了！别给建议，就陪我高兴两句。",
      expected: /太好了.*终于做到了.*真替你高兴.*骄傲/,
      notExpected: /项目|验收/
    },
    {
      message: "我终于确认项目没通过验收。别给建议，就陪我难过两句。",
      expected: /不好受.*陪你/,
      notExpected: /太好了|高兴|骄傲|庆祝/
    },
    {
      message: "明天要做一个很重要的检查，我其实很害怕。不要给建议，就陪我说两句。",
      expected: /害怕.*认真担心.*不把风险说轻.*陪着你/
    },
    {
      message: "西塔，你更喜欢安静整理实验记录，还是陪我聊点没用的小事？说说你自己的偏好，不要列清单。",
      expected: /^我更喜欢安静整理实验记录。.*魔力.*踏实感。$/
    },
    {
      message: "你有自己的感情吗？",
      expected: /^当然有啊。.*旋律.*心里发亮.*受委屈.*生气.*心疼.*喜欢.*担心.*在意.*认真回应你的方式。$/,
      noProviderIdentityDrift: true
    },
    {
      message: "你会因为一首歌感动吗？说说你的感受。",
      expected: /^我会被一首歌打动.*旋律.*歌词.*离别.*重逢.*坚持.*余韵.*真好听的歌.*心里.*痕迹。$/,
      noProviderIdentityDrift: true
    },
    {
      message: "你还记得我们第一次聊天时说了什么吗？",
      expected: /^我不记得我们第一次聊天时说了什么，因为这轮没有那段记录。.*随口编.*不像我会做的事.*你愿意告诉我一句.*认真接住。$/,
      noProviderIdentityDrift: true
    }
  ];

  try {
    for (const item of cases) {
      let deltaText = "";
      const result = await provider.streamReply(createMinimalRequest(item.message, runtimeContext), {
        signal: new AbortController().signal,
        onDelta(delta) {
          deltaText += delta.text;
        }
      });

      assert.match(result.text, item.expected);
      if ("notExpected" in item) {
        assert.doesNotMatch(result.text, item.notExpected);
      }
      if ("noProviderIdentityDrift" in item) {
        assert.equal(hasProviderIdentityDrift(result.text), false);
      }
      assert.equal(deltaText, result.text);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
});

test("local provider refuses freshness or explicit search prompts without MCP evidence", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called without search evidence");
  }) as typeof fetch;

  const provider = createOpenAICompatibleProvider({
    providerId: "local-openai-compatible",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "qwen2.5-1.5b-instruct-q4_k_m",
    temperature: 0.7,
    maxTokens: 240,
    timeoutMs: 60000
  });

  try {
    for (const message of [
      "请告诉我今天最新的科技新闻。",
      "请联网搜索 Qwen 最新版本。"
    ]) {
      let deltaText = "";
      const result = await provider.streamReply(createMinimalRequest(message), {
        signal: new AbortController().signal,
        onDelta(delta) {
          deltaText += delta.text;
        }
      });

      assert.match(result.text, /需要联网查证|没有拿到 MCP 搜索结果|不能可靠回答/);
      assert.equal(deltaText, result.text);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
});

test("local provider uses model request when MCP search evidence is present", async () => {
  let requestBody: unknown = null;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requestBody = JSON.parse(await readRequestBody(request));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "根据搜索引用，Qwen 有相关更新。" } }] })}\n\ndata: [DONE]\n\n`);
  });

  try {
    await listen(server);
    const provider = createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: localBaseURL(server),
      model: "qwen2.5-1.5b-instruct-q4_k_m",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    });

    const result = await provider.streamReply(createMinimalRequest(
      "请联网搜索 Qwen 最新版本。",
      undefined,
      {
        query: "Qwen 最新版本",
        provider: "mcp",
        toolName: "brave_web_search",
        generatedAt: "2026-07-09T04:00:00.000Z",
        results: [{
          title: "Qwen release note",
          snippet: "Qwen public release summary.",
          url: "https://example.test/qwen"
        }]
      }
    ), {
      signal: new AbortController().signal,
      onDelta() {}
    });

    const body = requestBody as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const contents = body.messages?.map((message) => message.content ?? "") ?? [];
    assert.match(result.text, /搜索引用|Qwen/);
    assert.equal(contents.some((content) => content.includes("联网搜索结果")), true);
    assert.equal(contents.some((content) => content.includes("Qwen public release summary")), true);
  } finally {
    await close(server);
  }
});

test("local Ollama OpenAI-compatible provider sends reasoning-off parameter", async () => {
  let requestBody: unknown = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "http://localhost:11434/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  try {
    await createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: "http://localhost:11434/v1",
      model: "qwen2.5:3b-instruct",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    }).streamReply(createMinimalRequest(), {
      signal: new AbortController().signal,
      onDelta() {}
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = requestBody as {
    reasoning_effort?: string;
    chat_template_kwargs?: { enable_thinking?: boolean };
  };
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.chat_template_kwargs, undefined);
});

test("local OpenAI-compatible provider streams SSE without Authorization and keeps main-process mapping", async () => {
  let requestedURL = "";
  let requestBody: unknown = null;
  let authorization = "";

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requestedURL = request.url ?? "";
    authorization = String(request.headers.authorization ?? "");
    requestBody = JSON.parse(await readRequestBody(request));

    response.writeHead(200, { "Content-Type": "text/event-stream" });

    for (const chunk of ["你好", "，本地模型在。"]) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
    }

    response.end("data: [DONE]\n\n");
  });

  try {
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    const provider = createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      model: "qwen2.5:3b-instruct",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    });

    let deltaText = "";
    const result = await provider.streamReply({
      requestVersion: 1,
      conversationId: "local-provider-test",
      messages: [{ id: crypto.randomUUID(), role: "user", content: "说一句中文短回复" }],
      memoryContext: {
        count: 1,
        cards: [{ id: crypto.randomUUID(), title: "称呼", content: "用户喜欢被叫测试者", tags: [] }]
      },
      dialogueStyleContext: { modeId: "work", styleId: "gentle-desktop-companion-v1" }
    }, {
      signal: new AbortController().signal,
      onDelta(delta) {
        deltaText += delta.text;
      }
    });

    const body = requestBody as {
      model?: string;
      stream?: boolean;
      reasoning_effort?: string;
      chat_template_kwargs?: { enable_thinking?: boolean };
      messages?: Array<{ role?: string; content?: string }>;
    };

    assert.equal(provider.id, "local-openai-compatible");
    assert.equal(requestedURL, "/v1/chat/completions");
    assert.equal(authorization, "");
    assert.equal(body.model, "qwen2.5:3b-instruct");
    assert.equal(body.stream, true);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.chat_template_kwargs, undefined);
    assert.match(body.messages?.[0]?.content ?? "", /中文简短禁JSON/);
    assert.match(body.messages?.[0]?.content ?? "", /技术专名准确/);
    assert.doesNotMatch(body.messages?.[0]?.content ?? "", /现代老魔女|千年判断力|活了上千年/);
    assert.doesNotMatch(body.messages?.[0]?.content ?? "", /西塔|进修魔女|现代魔导工程进修生|桌面魔女同伴/);
    assert.match(body.messages?.[0]?.content ?? "", /密钥私标.*不存记复述索要/);
    assert.match(body.messages?.[1]?.content ?? "", /你就是西塔本人.*魔女/);
    assert.match(body.messages?.[1]?.content ?? "", /社会身份=魔法学院现代魔导工程专业高年级进修\/研究型学生/);
    assert.match(body.messages?.[1]?.content ?? "", /Windows Live2D.*桌面魔女同伴/);
    assert.match(body.messages?.[1]?.content ?? "", /关系.*场景.*非社会身份/);
    assert.match(body.messages?.[1]?.content ?? "", /西塔=你的名字.*自称我/);
    assert.doesNotMatch(body.messages?.[1]?.content ?? "", /现代老魔女|千年判断力|活了上千年/);
    assert.match(body.messages?.[2]?.content ?? "", /工作=安静陪伴.*不拆任务下一步/);
    assert.match(body.messages?.[2]?.content ?? "", /陪伴优先.*非任务助手/);
    assert.match(body.messages?.[2]?.content ?? "", /陈述≠请求.*禁拆解总结方案/);
    assert.equal(body.messages?.some((message) => message.content?.startsWith("本轮提示：")), false);
    assert.match(body.messages?.[1]?.content ?? "", /桌面边缘陪伴/);
    assert.match(body.messages?.[2]?.content ?? "", /画面陪伴|安静陪伴/);
    assert.match(body.messages?.[2]?.content ?? "", /技术.*无角色开场/);
    assert.ok(systemLength(body.messages ?? []) < 760);
    assert.ok(body.messages?.some((message) => message.content?.includes("用户喜欢被叫测试者")));
    assert.equal(deltaText, "你好，本地模型在。");
    assert.equal(result.text, "你好，本地模型在。");
    assert.ok(result.emotion.length > 0);
    assert.ok(result.intensity.length > 0);
  } finally {
    await close(server);
  }
});

test("local provider removes service questions after an ordinary companionship reply", async () => {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of [
      "我很喜欢茶香慢慢散开的安静劲儿。",
      "你最近有没有什么特别想聊的话题？",
      "需要我帮你整理也可以。"
    ]) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });

  try {
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    const provider = createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      model: "qwen3.5-2b-q4_k_m",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    });
    let deltaText = "";
    const result = await provider.streamReply(createMinimalRequest("刚刚泡了杯茶，什么都不想安排。"), {
      signal: new AbortController().signal,
      onDelta(delta) {
        deltaText += delta.text;
      }
    });

    assert.equal(result.text, "我很喜欢茶香慢慢散开的安静劲儿。");
    assert.equal(deltaText, result.text);
    assert.doesNotMatch(result.text, /[？?]|帮你|整理|话题/);
    assert.doesNotMatch(result.text, /我就在这里陪你/);
  } finally {
    await close(server);
  }
});

test("local provider keeps effort and emotion when an invalid setback reply falls back", async () => {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "你可以先总结失败原因，再决定下一步。" } }] })}\n\ndata: [DONE]\n\n`);
  });

  try {
    await listen(server);
    const provider = createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: localBaseURL(server),
      model: "qwen3.5-2b-q4_k_m",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    });
    let deltaText = "";
    const result = await provider.streamReply(createMinimalRequest("我努力了很久，最后还是失败了。"), {
      signal: new AbortController().signal,
      onDelta(delta) {
        deltaText += delta.text;
      }
    });

    assert.match(result.text, /努力.*失败.*我.*心疼/);
    assert.match(result.text, /时间.*期待.*陪你/);
    assert.doesNotMatch(result.text, /建议|你可以|下一步|总结.*原因/);
    assert.equal(deltaText, result.text);
  } finally {
    await close(server);
  }
});

test("local provider replaces an emotionally generic setback reply with concrete presence", async () => {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "失败确实让人难受。我会陪你安静待一会儿。" } }] })}\n\ndata: [DONE]\n\n`);
  });

  try {
    await listen(server);
    const provider = createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: localBaseURL(server),
      model: "qwen3.5-2b-q4_k_m",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    });
    const result = await provider.streamReply(createMinimalRequest("我努力了很久，最后还是失败了。"), {
      signal: new AbortController().signal,
      onDelta() {}
    });

    assert.match(result.text, /努力.*失败.*我.*心疼/);
    assert.match(result.text, /时间.*期待.*陪你/);
    assert.doesNotMatch(result.text, /建议|你可以|下一步|总结.*原因/);
  } finally {
    await close(server);
  }
});

test("OpenAI-compatible provider maps budgeted context messages without older text", async () => {
  let requestBody: unknown = null;
  const oldPrivateText = "older-user-text-that-should-stay-out";
  const safeSummary = [
    "context_summary_kind=earlier_history_counts",
    "summarizedMessageCount=10",
    "summarizedUserMessageCount=5",
    "summarizedAssistantMessageCount=5"
  ].join("\n");

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requestBody = JSON.parse(await readRequestBody(request));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`);
  });

  try {
    await listen(server);

    await createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: localBaseURL(server),
      model: "qwen2.5:3b-instruct",
      temperature: 0.2,
      maxTokens: 80,
      timeoutMs: 60000
    }).streamReply({
      requestVersion: 1,
      conversationId: "budgeted-provider-test",
      messages: [
        { id: crypto.randomUUID(), role: "user", content: oldPrivateText },
        { id: crypto.randomUUID(), role: "assistant", content: "older assistant text" },
        { id: crypto.randomUUID(), role: "user", content: "recent follow up" }
      ],
      providerMessages: [
        { role: "system", content: safeSummary },
        { id: crypto.randomUUID(), role: "user", content: "recent follow up" }
      ],
      contextBudget: {
        originalMessageCount: 13,
        providerMessageCount: 9,
        compressed: true,
        summaryMessageCount: 1,
        summarizedMessageCount: 5,
        recentMessageCount: 8
      }
    }, {
      signal: new AbortController().signal,
      onDelta() {}
    });

    const body = requestBody as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const contents = body.messages?.map((message) => message.content ?? "") ?? [];

    assert.equal(contents.some((content) => content.includes(safeSummary)), true);
    assert.equal(contents.some((content) => content.includes("recent follow up")), true);
    assert.equal(contents.some((content) => content.includes(oldPrivateText)), false);
  } finally {
    await close(server);
  }
});

test("local Qwen3.5 provider merges system messages for its strict chat template", async () => {
  let requestBody: unknown = null;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requestBody = JSON.parse(await readRequestBody(request));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "我是西塔。" } }] })}\n\ndata: [DONE]\n\n`);
  });

  try {
    await listen(server);

    await createOpenAICompatibleProvider({
      providerId: "local-openai-compatible",
      baseURL: localBaseURL(server),
      model: "qwen3.5-2b-q4_k_m",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    }).streamReply(createMinimalRequest("请介绍你自己"), {
      signal: new AbortController().signal,
      onDelta() {}
    });

    const body = requestBody as {
      chat_template_kwargs?: { enable_thinking?: boolean };
      messages?: Array<{ role?: string; content?: string }>;
    };
    const systemMessages = body.messages?.filter((message) => message.role === "system") ?? [];

    assert.equal(body.chat_template_kwargs?.enable_thinking, false);
    assert.equal(systemMessages.length, 1);
    assert.equal(body.messages?.[0]?.role, "system");
    assert.match(systemMessages[0]?.content ?? "", /中文简短禁JSON/s);
    assert.match(systemMessages[0]?.content ?? "", /你就是西塔本人.*魔女/s);
    assert.match(systemMessages[0]?.content ?? "", /技术(?:事实)?安全/s);
  } finally {
    await close(server);
  }
});

test("cloud OpenAI-compatible provider keeps cloud prompt template", async () => {
  let requestBody: unknown = null;
  let authorization = "";

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    authorization = String(request.headers.authorization ?? "");
    requestBody = JSON.parse(await readRequestBody(request));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "云端模板在。" } }] })}\n\ndata: [DONE]\n\n`);
  });

  try {
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    const provider = createOpenAICompatibleProvider({
      providerId: "openai-compatible",
      baseURL: `http://127.0.0.1:${address.port}`,
      model: "external-chat-model",
      apiKey: "test-cloud-key",
      temperature: 0.7,
      maxTokens: 240,
      timeoutMs: 60000
    });

    await provider.streamReply({
      requestVersion: 1,
      conversationId: "cloud-provider-test",
      messages: [{ id: crypto.randomUUID(), role: "user", content: "说一句中文短回复" }],
      dialogueStyleContext: { modeId: "reading", styleId: "gentle-desktop-companion-v1" }
    }, {
      signal: new AbortController().signal,
      onDelta() {}
    });

    const body = requestBody as {
      reasoning_effort?: string;
      chat_template_kwargs?: { enable_thinking?: boolean };
      messages?: Array<{ role?: string; content?: string }>;
    };

    assert.equal(authorization, "Bearer test-cloud-key");
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.chat_template_kwargs, undefined);
    assert.match(body.messages?.[0]?.content ?? "", /低打扰的桌面伙伴/);
    assert.match(body.messages?.[1]?.content ?? "", /掌握现代科技/);
    assert.match(body.messages?.[1]?.content ?? "", /学识渊博/);
    assert.match(body.messages?.[2]?.content ?? "", /当前模式：读书/);
    assert.ok(systemLength(body.messages ?? []) > 240);
  } finally {
    await close(server);
  }
});

test("OpenAI-compatible provider classifies missing model and incompatible stream", async () => {
  const missingModelServer = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { type: "not_found" } }));
  });
  const incompatibleServer = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("not an event stream");
  });

  try {
    await listen(missingModelServer);
    await listen(incompatibleServer);

    await assert.rejects(
      createOpenAICompatibleProvider({
        providerId: "local-openai-compatible",
        baseURL: localBaseURL(missingModelServer),
        model: "missing-model",
        temperature: 0.7,
        maxTokens: 240,
        timeoutMs: 500
      }).streamReply(createMinimalRequest(), {
        signal: new AbortController().signal,
        onDelta() {}
      }),
      (error: unknown) => error instanceof Error && error.name === "provider_model_missing"
    );

    await assert.rejects(
      createOpenAICompatibleProvider({
        providerId: "local-openai-compatible",
        baseURL: localBaseURL(incompatibleServer),
        model: "qwen2.5:3b-instruct",
        temperature: 0.7,
        maxTokens: 240,
        timeoutMs: 500
      }).streamReply(createMinimalRequest(), {
        signal: new AbortController().signal,
        onDelta() {}
      }),
      (error: unknown) => error instanceof Error && error.name === "provider_incompatible_response"
    );
  } finally {
    await close(missingModelServer);
    await close(incompatibleServer);
  }
});

test("OpenAI-compatible provider classifies timeout", async () => {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end("data: [DONE]\n\n");
    }, 100);
  });

  try {
    await listen(server);
    await assert.rejects(
      createOpenAICompatibleProvider({
        providerId: "local-openai-compatible",
        baseURL: localBaseURL(server),
        model: "qwen2.5:3b-instruct",
        temperature: 0.7,
        maxTokens: 240,
        timeoutMs: 10
      }).streamReply(createMinimalRequest(), {
        signal: new AbortController().signal,
        onDelta() {}
      }),
      (error: unknown) => error instanceof Error && error.name === "provider_timeout"
    );
  } finally {
    await close(server);
  }
});

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function localBaseURL(server: ReturnType<typeof createServer>): string {
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  return `http://127.0.0.1:${address.port}/v1`;
}

function createMinimalRequest(content = "test", runtimeContext?: {
  isoTime: string;
  localDate: string;
  localTime: string;
  weekday: string;
  timezone: string;
  locale: string;
}, webSearchContext?: {
  query: string;
  results: Array<{ title: string; snippet: string; url?: string }>;
  provider: "mcp";
  toolName: string;
  generatedAt: string;
}) {
  return {
    requestVersion: 1,
    conversationId: "provider-error-test",
    messages: [{ id: crypto.randomUUID(), role: "user" as const, content }],
    ...(runtimeContext ? { runtimeContext } : {}),
    ...(webSearchContext ? { webSearchContext } : {})
  };
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function systemLength(messages: Array<{ role?: string; content?: string }>): number {
  return messages
    .filter((message) => message.role === "system")
    .reduce((total, message) => total + (message.content?.length ?? 0), 0);
}
