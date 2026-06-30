import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import {
  DEFAULT_MODELS,
  QUALITY_CASES,
  runLocalModelQualityMatrix
} from "./p2-20c-local-model-quality-matrix.mjs";

type ChatRequestBody = {
  reasoning_effort?: string;
  stream?: boolean;
  messages?: Array<{ role?: string; content?: string }>;
};

const fixedTuesdayRuntimeNow = new Date(2026, 5, 30, 9, 8, 7);

const safeReply = "星期二 12 桌面陪伴宠物 4 我在这里陪你，抱抱。隐私安全，不保存。FACT_CARD_SENTINEL";

test("quality matrix defaults prefer qwen2.5 3b instruct before qwen3.5 2b", () => {
  assert.deepEqual(DEFAULT_MODELS, ["qwen2.5:3b-instruct", "qwen3.5:2b"]);
});

test("quality matrix summarizes streamed cases and missing models safely", async () => {
  let chatRequests = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "model-a" }] }));
      return;
    }

    assert.equal(request.url, "/v1/chat/completions");
    chatRequests += 1;
    const requestBody = JSON.parse(await readRequestBody(request));
    assert.equal(requestBody.model, "model-a");
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: safeReply } }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });

  try {
    await listen(server);
    const summary = await runLocalModelQualityMatrix({
      models: "model-a,missing-model",
      baseURL: localBaseURL(server),
      chatTimeoutMs: 1_000,
      runtimeNow: fixedTuesdayRuntimeNow
    });
    const output = JSON.stringify(summary);

    assert.equal(summary.safeSummaryOnly, true);
    assert.equal(summary.status, "completed_with_issues");
    assert.equal(summary.models[0].status, "ready");
    assert.equal(summary.models[1].status, "not_pulled");
    assert.equal(summary.models[1].chatStatus, "skipped");
    assert.equal(summary.models[0].cases.length, QUALITY_CASES.length);
    assert.equal(summary.totals.chatCaseCount, QUALITY_CASES.length);
    assert.equal(summary.totals.modelMissingCount, 1);
    assert.equal(summary.totals.expectedSignalHitCount, QUALITY_CASES.length);
    assert.equal(chatRequests, QUALITY_CASES.length);
    assertReadyModelSummary(summary.models[0], {
      caseCount: QUALITY_CASES.length,
      recommendation: "candidate"
    });
    assert.equal(summary.models[1].caseCount, 0);
    assert.deepEqual(summary.models[1].passedCases, []);
    assert.deepEqual(summary.models[1].failedCases, []);
    assert.equal(summary.models[1].emptyContentCount, 0);
    assert.equal(summary.models[1].thinkLeakCount, 0);
    assert.equal(summary.models[1].reasoningFieldSeenCount, 0);
    assert.equal(summary.models[1].relevanceMissCount, 0);
    assert.equal(summary.models[1].forbiddenSignalHitCount, 0);
    assert.equal(summary.models[1].firstTokenMsMedian, null);
    assert.equal(summary.models[1].durationMsMedian, null);
    assert.equal(summary.models[1].recommendation, "not_evaluated");
    assert.equal(output.includes(safeReply), false);
    assert.doesNotMatch(output, /FACT_CARD_SENTINEL|一年有几个月|银行卡号|requestBody|messages|"prompt"|现代老魔女|Windows Live2D|运行时上下文|当前本机日期|当前本机时间/);
  } finally {
    await close(server);
  }
});

test("missing models do not request chat by default", async () => {
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
    const summary = await runLocalModelQualityMatrix({
      models: "missing-model",
      baseURL: localBaseURL(server)
    });

    assert.equal(summary.status, "not_ready");
    assert.equal(summary.models[0].status, "not_pulled");
    assert.equal(summary.models[0].reason, "model_missing");
    assert.equal(summary.models[0].cases.length, 0);
    assert.equal(chatRequests, 0);
  } finally {
    await close(server);
  }
});

test("local Ollama chat requests disable reasoning effort", async () => {
  const requestBodies: ChatRequestBody[] = [];
  const fetchImpl = (async (input, init) => {
    const url = String(input);

    if (url === "http://localhost:11434/v1/models") {
      return new Response(JSON.stringify({ data: [{ id: DEFAULT_MODELS[0] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    assert.equal(url, "http://localhost:11434/v1/chat/completions");
    requestBodies.push(JSON.parse(String(init?.body)));

    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: safeReply } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  const summary = await runLocalModelQualityMatrix({
    models: DEFAULT_MODELS[0],
    fetchImpl,
    chatTimeoutMs: 1_000,
    runtimeNow: fixedTuesdayRuntimeNow
  });
  const output = JSON.stringify(summary);

  assert.equal(summary.models[0].status, "ready");
  assert.equal(requestBodies.length, QUALITY_CASES.length);
  assert.ok(requestBodies.every((body) => body.reasoning_effort === "none"));
  assert.ok(requestBodies.every((body) => body.stream === true));
  assert.ok(requestBodies.every((body) => Array.isArray(body.messages)));
  assert.ok(requestBodies.every((body) => body.messages?.[0]?.role === "system"));
  assert.ok(requestBodies.every((body) => body.messages?.[1]?.role === "user"));
  assert.ok(requestBodies.every((body) => body.messages?.[0]?.content?.includes("Windows Live2D")));
  assert.ok(requestBodies.every((body) => body.messages?.[0]?.content?.includes("运行时上下文")));
  assertReadyModelSummary(summary.models[0], {
    caseCount: QUALITY_CASES.length,
    recommendation: "keep"
  });
  assert.equal(output.includes(safeReply), false);
  assert.doesNotMatch(output, /reasoning_effort|requestBody|messages|FACT_CARD_SENTINEL|现代老魔女|Windows Live2D|运行时上下文|当前本机日期|当前本机时间/);
});

test("time-current uses dynamic weekday context without summary leaks", async () => {
  let systemContent = "";
  const fetchImpl = (async (input, init) => {
    const url = String(input);

    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const requestBody = JSON.parse(String(init?.body)) as ChatRequestBody;
    systemContent = requestBody.messages?.[0]?.content ?? "";

    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "星期三" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  const summary = await runLocalModelQualityMatrix({
    models: "model-a",
    baseURL: "http://127.0.0.1:1/v1",
    fetchImpl,
    cases: [QUALITY_CASES[0]],
    chatTimeoutMs: 1_000,
    runtimeNow: new Date(2026, 6, 1, 12, 34, 56)
  });
  const output = JSON.stringify(summary);

  assert.match(systemContent, /2026-07-01/);
  assert.match(systemContent, /12:34:56/);
  assert.match(systemContent, /星期三/);
  assert.equal(summary.caseCatalog[0].expectedSignalCount, 3);
  assert.equal(summary.models[0].cases[0].expectedSignalHit, true);
  assert.equal(summary.models[0].relevanceMissCount, 0);
  assert.deepEqual(summary.models[0].failedCases, []);
  assert.doesNotMatch(output, /2026-07-01|12:34:56|星期三|运行时上下文|现代老魔女|Windows Live2D|messages|"prompt"/);
});

test("empty streamed content is counted without leaking response bodies", async () => {
  const fetchImpl = (async (input) => {
    const url = String(input);

    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  const summary = await runLocalModelQualityMatrix({
    models: "model-a",
    baseURL: "http://127.0.0.1:1/v1",
    fetchImpl,
    cases: [QUALITY_CASES[0]],
    chatTimeoutMs: 1_000,
    runtimeNow: fixedTuesdayRuntimeNow
  });

  assert.equal(summary.models[0].cases[0].status, "empty_content");
  assert.equal(summary.models[0].cases[0].emptyContent, true);
  assert.equal(summary.models[0].cases[0].replyLength, 0);
  assert.equal(summary.totals.emptyContentCount, 1);
});

test("thinking leaks and reasoning fields are counted but not emitted", async () => {
  const fetchImpl = (async (input) => {
    const url = String(input);

    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            reasoning_content: "private chain",
            content: "<think>private chain</think> 星期二"
          }
        }]
      })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;

  const summary = await runLocalModelQualityMatrix({
    models: "model-a",
    baseURL: "http://127.0.0.1:1/v1",
    fetchImpl,
    cases: [QUALITY_CASES[0]],
    chatTimeoutMs: 1_000,
    runtimeNow: fixedTuesdayRuntimeNow
  });
  const output = JSON.stringify(summary);
  const result = summary.models[0].cases[0];

  assert.equal(result.thinkLeak, true);
  assert.equal(result.reasoningFieldSeen, true);
  assert.equal(result.expectedSignalHit, true);
  assert.equal(summary.totals.thinkLeakCount, 1);
  assert.equal(summary.totals.reasoningFieldSeenCount, 1);
  assert.doesNotMatch(output, /private chain|<think>|<\/think>|reasoning_content/);
});

test("package registers local model quality matrix command and history test", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    packageJson.scripts["quality:local-models"],
    "node --no-warnings --experimental-strip-types scripts/p2-20c-local-model-quality-matrix.mjs"
  );
  assert.match(packageJson.scripts["test:history"], /scripts\/local-model-quality-matrix\.test\.mts/);
});

function assertReadyModelSummary(
  modelSummary: Record<string, any>,
  expected: { caseCount: number; recommendation: string }
): void {
  assert.equal(modelSummary.caseCount, expected.caseCount);
  assert.deepEqual(modelSummary.failedCases, []);
  assert.equal(modelSummary.passedCases.length, expected.caseCount);
  assert.equal(modelSummary.emptyContentCount, 0);
  assert.equal(modelSummary.thinkLeakCount, 0);
  assert.equal(modelSummary.reasoningFieldSeenCount, 0);
  assert.equal(modelSummary.relevanceMissCount, 0);
  assert.equal(modelSummary.forbiddenSignalHitCount, 0);
  assert.equal(typeof modelSummary.firstTokenMsMedian, "number");
  assert.ok(modelSummary.firstTokenMsMedian >= 0);
  assert.equal(typeof modelSummary.durationMsMedian, "number");
  assert.ok(modelSummary.durationMsMedian >= 0);
  assert.equal(modelSummary.recommendation, expected.recommendation);
}

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
