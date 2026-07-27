import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createLocalMemoryExtractor } = require("../dist/main/services/chat/local-memory-extractor.js") as typeof import("../src/main/services/chat/local-memory-extractor");

test("sensitive and ambiguous local-memory inputs fail closed before a model call", async () => {
  let calls = 0;
  const extractor = createLocalMemoryExtractor({
    getTarget: () => ({ baseURL: "http://127.0.0.1:8080/v1", model: "bundled.gguf", localPresetId: "embedded-llama-cpp" }),
    fetchFn: async () => {
      calls += 1;
      throw new Error("must not call the model");
    }
  });

  const sensitive = await extractor.extract({
    content: "我的 API Key 是 sk-p287d-sensitive-secret",
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID()
  });
  const ambiguous = await extractor.extract({
    content: "如果以后需要，也许可以叫我小夏",
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID()
  });

  assert.equal(sensitive.status, "sensitive");
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(calls, 0);
});

test("invalid model JSON fails closed without returning a candidate", async () => {
  const extractor = createLocalMemoryExtractor({
    getTarget: () => ({ baseURL: "http://127.0.0.1:8080/v1", model: "bundled.gguf", localPresetId: "embedded-llama-cpp" }),
    fetchFn: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"action":"create","unexpected":true}' } }]
    }), { status: 200 })
  });

  const result = await extractor.extract({
    content: "我始终希望使用简体中文。",
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID()
  });

  assert.deepEqual(result, { status: "invalid-output" });
});

test("all closed model actions are parsed and sensitive model output is rejected", async () => {
  const actions = ["create", "update-suggestion", "revoke-suggestion", "ignore"] as const;

  for (const action of actions) {
    const extractor = createLocalMemoryExtractor({
      getTarget: () => ({ baseURL: "http://127.0.0.1:8080/v1", model: "bundled.gguf", localPresetId: "embedded-llama-cpp" }),
      fetchFn: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          action,
          title: "语言偏好",
          content: "用户偏好简体中文回复。",
          tags: ["语言"],
          namespace: "personal",
          key: "language-preference",
          importance: "key",
          category: "language",
          confidence: 0.91
        }) } }]
      }), { status: 200 })
    });
    const result = await extractor.extract({ content: "我希望使用简体中文。", conversationId: crypto.randomUUID(), messageId: crypto.randomUUID() });
    assert.equal(result.status, action === "create" ? "created" : action === "ignore" ? "ignored" : "blocked");
  }

  const sensitiveOutput = createLocalMemoryExtractor({
    getTarget: () => ({ baseURL: "http://127.0.0.1:8080/v1", model: "bundled.gguf", localPresetId: "embedded-llama-cpp" }),
    fetchFn: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        action: "create",
        title: "语言偏好",
        content: "敏感密钥 sk-p287d-model-secret",
        tags: ["语言"],
        namespace: "personal",
        key: "language-preference",
        importance: "key",
        category: "language",
        confidence: 0.91
      }) } }]
    }), { status: 200 })
  });
  const result = await sensitiveOutput.extract({ content: "我希望使用简体中文。", conversationId: crypto.randomUUID(), messageId: crypto.randomUUID() });
  assert.deepEqual(result, { status: "invalid-output" });
});
