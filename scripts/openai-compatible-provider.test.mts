import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createChatCompletionsURL,
  createOpenAICompatibleProvider
} = require("../dist/main/services/chat/openai-compatible-provider.js") as typeof import("../src/main/services/chat/openai-compatible-provider");

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
    assert.equal(body.messages?.[0]?.content, "你是桌面伙伴。用中文，短句，不输出 JSON。");
    assert.match(body.messages?.[1]?.content ?? "", /现代老魔女/);
    assert.match(body.messages?.[2]?.content ?? "", /模式：工作=给下一步/);
    assert.ok(systemLength(body.messages ?? []) < 240);
    assert.ok(body.messages?.some((message) => message.content?.includes("用户喜欢被叫测试者")));
    assert.equal(deltaText, "你好，本地模型在。");
    assert.equal(result.text, "你好，本地模型在。");
    assert.ok(result.emotion.length > 0);
    assert.ok(result.intensity.length > 0);
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

function createMinimalRequest() {
  return {
    requestVersion: 1,
    conversationId: "provider-error-test",
    messages: [{ id: crypto.randomUUID(), role: "user" as const, content: "test" }]
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
