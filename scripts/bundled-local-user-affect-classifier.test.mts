import assert from "node:assert/strict";
import test from "node:test";

import { createBundledLocalUserAffectClassifier } from "../src/main/services/affect/bundled-local-user-affect-classifier.ts";

const target = () => ({
  baseURL: "http://127.0.0.1:12345/v1",
  model: "qwen3.5-2b",
  localPresetId: "embedded-llama-cpp" as const
});

test("bundled user affect classifier returns medium at most and preserves explicit unknown", async () => {
  const classified = createBundledLocalUserAffectClassifier({
    getTarget: target,
    fetchFn: responseFor('{"label":"low","confidence":0.92}')
  });
  assert.deepEqual(await classified.classify({ text: "今天什么都提不起劲" }), {
    kind: "low",
    confidence: "medium",
    source: "conversational-inference",
    status: "classified"
  });

  const unknown = createBundledLocalUserAffectClassifier({
    getTarget: target,
    fetchFn: responseFor('{"label":"unknown","confidence":0.95}')
  });
  assert.deepEqual(await unknown.classify({ text: "这是朋友说的话" }), {
    kind: "unknown",
    confidence: "low",
    source: "conversational-inference",
    status: "classified"
  });
});

test("low confidence and every malformed model response fall back to unknown low", async () => {
  const cases = [
    ['{"label":"tired","confidence":0.4}', "low-confidence"],
    ['{"label":"sad","confidence":0.99}', "invalid-output"],
    ['{"label":"low","confidence":0.9,"reason":"private text"}', "invalid-output"],
    ['```json\n{"label":"low","confidence":0.9}\n```', "invalid-output"]
  ] as const;

  for (const [content, status] of cases) {
    const classifier = createBundledLocalUserAffectClassifier({
      getTarget: target,
      fetchFn: responseFor(content)
    });
    assert.deepEqual(await classifier.classify({ text: "message" }), {
      kind: "unknown",
      confidence: "low",
      source: "conversational-inference",
      status
    });
  }

  const multipleChoices = createBundledLocalUserAffectClassifier({
    getTarget: target,
    fetchFn: async () => new Response(JSON.stringify({
      choices: [
        { message: { content: '{"label":"low","confidence":0.9}' } },
        { message: { content: '{"label":"calm","confidence":0.9}' } }
      ]
    }), { status: 200 })
  });
  assertFallback(await multipleChoices.classify({ text: "message" }), "invalid-output");

  const failed = createBundledLocalUserAffectClassifier({
    getTarget: target,
    fetchFn: async () => new Response("failed", { status: 500 })
  });
  assertFallback(await failed.classify({ text: "message" }), "failed");

  const thrown = createBundledLocalUserAffectClassifier({
    getTarget: target,
    fetchFn: async () => {
      throw new Error("offline");
    }
  });
  assertFallback(await thrown.classify({ text: "message" }), "failed");
});

test("classifier accepts only embedded llama.cpp over localhost and never calls external targets", async () => {
  let fetchCount = 0;
  const fetchFn = async (): Promise<Response> => {
    fetchCount += 1;
    return new Response();
  };
  const targets = [
    null,
    {
      baseURL: "https://api.example.com/v1",
      model: "remote",
      localPresetId: "embedded-llama-cpp"
    },
    {
      baseURL: "http://192.168.1.20:8080/v1",
      model: "remote",
      localPresetId: "embedded-llama-cpp"
    },
    {
      baseURL: "http://localhost:8080/v1",
      model: "",
      localPresetId: "embedded-llama-cpp"
    },
    {
      baseURL: "http://localhost:8080/v1",
      model: "qwen",
      localPresetId: "ollama"
    }
  ];

  for (const candidate of targets) {
    const classifier = createBundledLocalUserAffectClassifier({
      getTarget: () => candidate as ReturnType<typeof target> | null,
      fetchFn
    });
    assertFallback(await classifier.classify({ text: "message" }), "unavailable");
  }
  assert.equal(fetchCount, 0);
});

test("request is bounded, deterministic, non-streaming, and carries no extra conversation", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | null = null;
  const classifier = createBundledLocalUserAffectClassifier({
    getTarget: () => ({
      baseURL: "http://localhost:12345/v1/",
      model: "qwen3.5-2b",
      localPresetId: "embedded-llama-cpp"
    }),
    fetchFn: async (url, init) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"label":"calm","confidence":0.88}' } }]
      }), { status: 200 });
    }
  });

  await classifier.classify({ text: "x".repeat(1_500) });
  assert.equal(requestUrl, "http://localhost:12345/v1/chat/completions");
  const messages = requestBody?.messages as Array<{ role: string; content: string }>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /Allowed labels: unknown, calm, positive, excited, low, tense, tired\./u);
  assert.match(messages[0]?.content ?? "", /jokes, negation/u);
  assert.equal(messages[1]?.role, "user");
  assert.equal(messages[1]?.content.length, 1_000);
  assert.equal(requestBody?.temperature, 0);
  assert.equal(requestBody?.max_tokens, 32);
  assert.equal(requestBody?.stream, false);
  assert.deepEqual(requestBody?.chat_template_kwargs, { enable_thinking: false });
});

test("short timeout and caller cancellation both abort and return unknown low", async () => {
  const abortingFetch: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
  const timedOut = createBundledLocalUserAffectClassifier({
    getTarget: target,
    timeoutMs: 5,
    fetchFn: abortingFetch
  });
  assertFallback(await timedOut.classify({ text: "message" }), "timeout");

  const cancelled = createBundledLocalUserAffectClassifier({
    getTarget: target,
    timeoutMs: 1_000,
    fetchFn: abortingFetch
  });
  const controller = new AbortController();
  const pending = cancelled.classify({ text: "message", signal: controller.signal });
  controller.abort();
  assertFallback(await pending, "failed");
});

function responseFor(content: string): typeof fetch {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function assertFallback(
  result: Awaited<ReturnType<ReturnType<typeof createBundledLocalUserAffectClassifier>["classify"]>>,
  status: string
): void {
  assert.deepEqual(result, {
    kind: "unknown",
    confidence: "low",
    source: "conversational-inference",
    status
  });
}
