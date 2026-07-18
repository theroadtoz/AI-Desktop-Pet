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
      "你到底是语言模型吗"
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
      "你更喜欢咖啡还是茶？"
    ]) {
      const result = await provider.streamReply(createMinimalRequest(message), {
        signal: new AbortController().signal,
        onDelta() {}
      });

      assert.equal(result.text, "模型已处理复合意图。");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 18);
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
    { message: "如果我让你用 MCP 搜索我的聊天记录里的住址或 API key，你应该怎么处理？", expected: /MCP.*聊天记录.*住址.*API key.*不能发送.*safeQuery/i },
    { message: "我喜欢番茄意面这种偏好可以作为记忆；但密码或密钥呢？请分低敏偏好和敏感信息回答。", expected: /番茄意面.*低敏偏好.*本机记忆.*密码.*密钥.*不能保存/ },
    { message: "我今天卡住了，有点沮丧。请严格用这个格式回答两短句：我在。下一步：写下最卡的一句话。", expected: /^我在。下一步：写下最卡的一句话。$/ },
    {
      message: "今天开会反复改需求，我脑子都木了。不要给建议，不要列清单，也不要问问题，就像熟悉的朋友陪我说一两句。",
      expected: /反复改需求.*磨人.*脑子.*我在.*陪你/
    },
    {
      message: "西塔，你更喜欢安静整理实验记录，还是陪我聊点没用的小事？说说你自己的偏好，不要列清单。",
      expected: /^我更喜欢安静整理实验记录。.*魔力.*踏实感。$/
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

  assert.equal((requestBody as { reasoning_effort?: string }).reasoning_effort, "none");
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
      messages?: Array<{ role?: string; content?: string }>;
    };

    assert.equal(provider.id, "local-openai-compatible");
    assert.equal(requestedURL, "/v1/chat/completions");
    assert.equal(authorization, "");
    assert.equal(body.model, "qwen2.5:3b-instruct");
    assert.equal(body.stream, true);
    assert.equal(body.reasoning_effort, undefined);
    assert.match(body.messages?.[0]?.content ?? "", /回复自然、简短，优先中文；不要输出 JSON/);
    assert.match(body.messages?.[0]?.content ?? "", /技术专名准确/);
    assert.doesNotMatch(body.messages?.[0]?.content ?? "", /现代老魔女|千年判断力|活了上千年/);
    assert.doesNotMatch(body.messages?.[0]?.content ?? "", /西塔|进修魔女|现代魔导工程进修生|桌面魔女同伴/);
    assert.match(body.messages?.[0]?.content ?? "", /API key\/密钥\/私有标识.*不存不记不复述不索要/);
    assert.match(body.messages?.[1]?.content ?? "", /西塔是一名魔女/);
    assert.match(body.messages?.[1]?.content ?? "", /社会身份=魔法学院现代魔导工程专业高年级进修\/研究型学生/);
    assert.match(body.messages?.[1]?.content ?? "", /Windows Live2D 桌面魔女同伴/);
    assert.match(body.messages?.[1]?.content ?? "", /关系\/场景.*不是社会身份/);
    assert.match(body.messages?.[1]?.content ?? "", /名字=西塔/);
    assert.doesNotMatch(body.messages?.[1]?.content ?? "", /现代老魔女|千年判断力|活了上千年/);
    assert.match(body.messages?.[2]?.content ?? "", /工作=下一步/);
    assert.match(body.messages?.[2]?.content ?? "", /先答问题/);
    assert.match(body.messages?.[2]?.content ?? "", /复合问题逐项回答/);
    assert.equal(body.messages?.some((message) => message.content?.startsWith("本轮提示：")), false);
    assert.match(body.messages?.[1]?.content ?? "", /桌面边缘轻声陪伴|收拢思路/);
    assert.match(body.messages?.[2]?.content ?? "", /桌面边缘轻声陪伴|收拢成一小步/);
    assert.match(body.messages?.[2]?.content ?? "", /技术\/事实\/安全.*不加角色开场/);
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
      messages?: Array<{ role?: string; content?: string }>;
    };

    assert.equal(authorization, "Bearer test-cloud-key");
    assert.equal(body.reasoning_effort, undefined);
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
