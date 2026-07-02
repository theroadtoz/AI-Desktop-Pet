import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import {
  diagnoseLocalRuntimes
} from "./p2-20b-local-runtime-diagnostic.mjs";
import {
  parseLocalModelDiagnosticSafeSummary
} from "../src/shared/local-model-diagnostic.ts";

const testRuntime = {
  id: "test-runtime",
  label: "Test runtime",
  command: "test-runtime",
  processNames: ["test-runtime.exe"],
  baseURL: "http://127.0.0.1:1/v1",
  model: "target-model",
  nextActions: {
    commandMissing: "Install runtime.",
    processMissing: "Start runtime.",
    tcpUnreachable: "Start the local server.",
    modelMissing: "Load target model.",
    chatFailed: "Check chat endpoint."
  }
};

test("diagnostic safe-returns not_ready when runtime is unavailable", async () => {
  const result = await diagnoseLocalRuntimes({
    runtimes: [testRuntime],
    env: {},
    commandExists: async () => false,
    processExists: async () => false,
    tcpReachable: async () => false
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "not_ready");
  assert.equal(result.recommendedRuntime, "llama-cpp-bundled");
  assert.equal(result.runtimes[0].id, "llama-cpp-bundled");
  assert.equal(result.runtimes[0].status, "missing_resources");
  assert.equal(result.runtimes[1].status, "not_installed_or_unreachable");
  assert.equal(result.runtimes[1].reason, "command_missing");
  assert.equal(result.runtimes[1].modelsStatus, "skipped");
  assert.equal(result.runtimes[1].chatStatus, "skipped");
  assert.equal(result.runtimes[2].id, "llama-cpp-managed");
  assert.equal(result.runtimes[2].status, "skipped");
});

test("diagnostic reports model_missing without calling chat", async () => {
  let chatRequests = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "other-model" }] }));
      return;
    }

    chatRequests += 1;
    response.writeHead(500);
    response.end();
  });

  try {
    await listen(server);
    const result = await diagnoseLocalRuntimes({
      runtimes: [{ ...testRuntime, baseURL: localBaseURL(server) }],
      env: {},
      commandExists: async () => true,
      processExists: async () => true,
      tcpReachable: async () => true
    });

    assert.equal(result.ok, false);
    assert.equal(result.runtimes[1].status, "model_missing");
    assert.equal(result.runtimes[1].modelsStatus, "model_missing");
    assert.equal(result.runtimes[1].chatStatus, "skipped");
    assert.equal(result.runtimes[1].modelCount, 1);
    assert.equal(chatRequests, 0);
  } finally {
    await close(server);
  }
});

test("diagnostic reports ready for OpenAI-compatible models and streaming chat", async () => {
  let requestBody = "";
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "target-model" }] }));
      return;
    }

    assert.equal(request.url, "/v1/chat/completions");
    requestBody = await readRequestBody(request);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });

  try {
    await listen(server);
    const result = await diagnoseLocalRuntimes({
      runtimes: [{ ...testRuntime, baseURL: localBaseURL(server) }],
      env: {},
      commandExists: async () => true,
      processExists: async () => true,
      tcpReachable: async () => true
    });
    const output = JSON.stringify(result);

    assert.equal(result.ok, true);
    assert.equal(result.status, "ready");
    assert.equal(result.recommendedRuntime, "test-runtime");
    assert.equal(result.runtimes[1].status, "ready");
    assert.equal(result.runtimes[1].modelsStatus, "ready");
    assert.equal(result.runtimes[1].chatStatus, "ready");
    assert.equal(result.runtimes[1].replyLength, 4);
    assert.match(requestBody, /"content":"ping"/);
    assert.doesNotMatch(output, /"content":"ping"/);
    assert.doesNotMatch(output, /pong/);
  } finally {
    await close(server);
  }
});

test("diagnostic default chat timeout allows local runtime cold starts", async () => {
  const recordedTimeouts: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof timeout === "number") {
      recordedTimeouts.push(timeout);
    }

    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;

  const fetchImpl = (async (input) => {
    const url = String(input);

    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "target-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    assert.ok(url.endsWith("/chat/completions"));

    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  try {
    await diagnoseLocalRuntimes({
      runtimes: [testRuntime],
      env: {},
      commandExists: async () => true,
      processExists: async () => true,
      tcpReachable: async () => true,
      fetchImpl
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(recordedTimeouts, [2_000, 15_000]);
});

test("diagnostic sends reasoning-off for local Ollama chat and keeps output safe", async () => {
  let requestBody: unknown = null;
  const fetchImpl = (async (input, init) => {
    const url = String(input);

    if (url === "http://localhost:11434/v1/models") {
      return new Response(JSON.stringify({ data: [{ id: "target-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    assert.equal(url, "http://localhost:11434/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  const result = await diagnoseLocalRuntimes({
    runtimes: [{
      ...testRuntime,
      id: "ollama",
      baseURL: "http://localhost:11434/v1"
    }],
    env: {},
    commandExists: async () => true,
    processExists: async () => true,
    tcpReachable: async () => true,
    fetchImpl
  });
  const output = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal((requestBody as { reasoning_effort?: string }).reasoning_effort, "none");
  assert.doesNotMatch(output, /reasoning_effort|requestBody|messages|"content"|ping|pong/);
});

test("diagnostic output omits local paths and sensitive bodies", async () => {
  const result = await diagnoseLocalRuntimes({
    runtimes: [testRuntime],
    env: {
      AI_DESKTOP_PET_LLAMA_CPP_MANAGED: "1",
      AI_DESKTOP_PET_LLAMA_CPP_EXE: "C:\\secret\\llama-server.exe",
      AI_DESKTOP_PET_LLAMA_CPP_MODEL: "D:\\models\\private-model.gguf",
      AI_DESKTOP_PET_LLAMA_CPP_ALIAS: "safe-alias",
      AI_DESKTOP_PET_LLAMA_CPP_HOST: "127.0.0.1",
      AI_DESKTOP_PET_LLAMA_CPP_PORT: "8080"
    },
    commandExists: async () => false,
    processExists: async () => false,
    tcpReachable: async () => false
  });
  const output = JSON.stringify(result);

  assert.equal(result.runtimes[2].status, "env_configured");
  assert.equal(result.runtimes[2].executableConfigured, true);
  assert.equal(result.runtimes[2].modelConfigured, true);
  assert.doesNotMatch(output, /C:\\secret/);
  assert.doesNotMatch(output, /D:\\models/);
  assert.doesNotMatch(output, /private-model\.gguf/);
  assert.doesNotMatch(output, /requestBody|provider request|fact card|API key|\.env\.local/i);
  assert.doesNotMatch(output, /[A-Z]:\\/);
});

test("safe diagnostic parser rejects renderer-unsafe fields", () => {
  const safeSummary = {
    ok: false,
    status: "not_ready",
    recommendedRuntime: "llama-cpp-bundled",
    durationMs: 12,
    safeSummaryOnly: true,
    runtimes: [{
      id: "ollama",
      label: "Ollama",
      status: "not_installed_or_unreachable",
      baseURLHost: "localhost:11434",
      model: "qwen2.5:3b-instruct",
      commandFound: false,
      processFound: false,
      tcpReachable: false,
      modelsStatus: "skipped",
      chatStatus: "skipped"
    }]
  };

  assert.ok(parseLocalModelDiagnosticSafeSummary(safeSummary));
  assert.ok(parseLocalModelDiagnosticSafeSummary({
    ...safeSummary,
    runtimes: [{
      id: "llama-cpp-bundled",
      label: "Bundled llama.cpp runtime",
      status: "missing_resources",
      reason: "manifest_missing",
      bundled: true,
      resourceSource: "development",
      manifestFound: false,
      executableConfigured: false,
      modelConfigured: false
    }]
  }));

  for (const field of ["path", "body", "prompt", "request", "requestBody", "messages", "content", "apiKey", "api_key"]) {
    assert.equal(
      parseLocalModelDiagnosticSafeSummary({
        ...safeSummary,
        runtimes: [{ ...safeSummary.runtimes[0], [field]: "secret" }]
      }),
      null,
      `${field} should be rejected`
    );
  }

  assert.equal(
    parseLocalModelDiagnosticSafeSummary({
      ...safeSummary,
      runtimes: [{ ...safeSummary.runtimes[0], model: "/home/user/private-model.gguf" }]
    }),
    null,
    "Unix-like local paths should be rejected"
  );
});

test("app, preload, and renderer wire local model diagnostic through safe summaries", () => {
  const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const preloadSource = readFileSync(new URL("../src/preload/chat-preload.ts", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../src/renderer/chat/main.ts", import.meta.url), "utf8");
  const htmlSource = readFileSync(new URL("../src/renderer/chat/index.html", import.meta.url), "utf8");

  assert.match(appSource, /ipcMain\.handle\("localRuntime:diagnose-local-model"/);
  assert.match(appSource, /isChatSender\(event\)/);
  assert.match(appSource, /parseLocalModelDiagnosticSafeSummary/);
  assert.match(preloadSource, /parseLocalModelDiagnosticSafeSummary/);
  assert.match(preloadSource, /diagnoseLocalModel\(\)/);
  for (const field of ["body", "prompt", "request", "messages", "content", "apikey"]) {
    assert.match(preloadSource, new RegExp(`"${field}"`));
  }
  assert.match(htmlSource, /id="local-model-diagnostic-section" class="content-stack"/);
  assert.match(htmlSource, /id="local-model-diagnostic-status" class="status-box"/);
  assert.match(htmlSource, /id="local-model-diagnostic-summary" class="selection-note"/);
  assert.match(htmlSource, /id="local-model-diagnostic-button" class="button-light"/);
  assert.match(rendererSource, /window\.localRuntimeApi\.diagnoseLocalModel\(\)/);
  assert.match(rendererSource, /resetLocalModelDiagnosticSummary\(\)/);
  assert.doesNotMatch(rendererSource, /JSON\.stringify\([^)]*LocalModelDiagnostic/i);
  assert.doesNotMatch(htmlSource, /<pre[^>]*local-model-diagnostic/i);
});

test("package registers local model diagnostic script and history test", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    packageJson.scripts["diagnose:local-model"],
    "node --no-warnings --experimental-strip-types scripts/p2-20b-local-runtime-diagnostic.mjs"
  );
  assert.match(packageJson.scripts["test:history"], /scripts\/local-runtime-diagnostic\.test\.mts/);
});

function localBaseURL(server: ReturnType<typeof createServer>): string {
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  return `http://127.0.0.1:${address.port}/v1`;
}

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
