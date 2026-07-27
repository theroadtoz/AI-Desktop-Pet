import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  estimateConservativeCharTokens,
  getFinalContextBudgetOptions,
  measureMappedContextBudget,
  reselectStructuredContextUntilWithinBudget,
  resolveTotalContextBudget,
  selectStructuredContext,
  summarizeOlderHistoryWithBundledRuntime
} = require("../dist/main/services/chat/chat-context-budget.js") as typeof import("../src/main/services/chat/chat-context-budget");

const { mapChatMessagesToOpenAICompatible } = require("../dist/main/services/chat/chat-message-mapper.js") as typeof import("../src/main/services/chat/chat-message-mapper");

test("P2-87C conservative character estimator covers Chinese, English, code and URL with a safety margin", () => {
  const samples = [
    { text: "西塔会保留最新意图。", minimumEstimate: 31 },
    { text: "Keep the newest user intent.", minimumEstimate: 30 },
    { text: "const answer = items.filter(Boolean).map(String);", minimumEstimate: 44 },
    { text: "https://example.test/docs/context?query=budget#safe", minimumEstimate: 46 }
  ];

  for (const sample of samples) {
    const estimated = estimateConservativeCharTokens(sample.text);
    assert.equal(Number.isSafeInteger(estimated), true);
    assert.equal(estimated >= sample.minimumEstimate, true);
    assert.equal(estimated - Math.ceil(Buffer.byteLength(sample.text, "utf8") * 0.6) >= 12, true);
  }
  assert.equal(estimateConservativeCharTokens("") > 0, true);
});

test("P2-87C Fake Provider permits a short manual key memory after final cloud-template mapping", () => {
  const memoryContext = {
    count: 1,
    cards: [{
      id: crypto.randomUUID(),
      title: "P2-11D 验收事实卡",
      content: "P2-11D 事实卡正文哨兵",
      tags: ["p2-11d"],
      importance: "key" as const,
      sourceType: "manual-chat" as const,
      managedByUser: true
    }]
  };
  const mapped = mapChatMessagesToOpenAICompatible(
    [{ id: crypto.randomUUID(), role: "user", content: "P2-11D 用户正文哨兵" }],
    memoryContext,
    { modeId: "default", styleId: "gentle-desktop-companion-v1" },
    { preferredName: "馆长" },
    "cloud-chat",
    {
      isoTime: "2026-07-26T11:43:00.000Z",
      localDate: "2026/07/26",
      localTime: "19:43",
      weekday: "星期日",
      timezone: "Asia/Shanghai",
      locale: "zh-CN"
    }
  );

  const final = measureMappedContextBudget(mapped, getFinalContextBudgetOptions("fake"));

  assert.equal(final.estimator, "conservative_char");
  assert.equal(final.withinBudget, true);
});

test("P2-87C protects system, persona, manual key memory and latest intent before omitting older history", () => {
  const result = resolveTotalContextBudget([
    { kind: "system", content: "system-rule" },
    { kind: "persona", content: "persona-rule" },
    { kind: "memory_key", content: "manual-key", protected: true },
    { kind: "history_older", content: "older-history-that-does-not-fit" },
    { kind: "history_recent", content: "latest-user-intent", protected: true }
  ], { totalBudget: 120, replyReserve: 20 });

  assert.equal(result.summary.estimator, "conservative_char");
  assert.equal(result.summary.replyReserve, 20);
  assert.equal(result.summary.withinBudget, true);
  assert.equal(result.kept.some((entry) => entry.content === "system-rule"), true);
  assert.equal(result.kept.some((entry) => entry.content === "persona-rule"), true);
  assert.equal(result.kept.some((entry) => entry.content === "manual-key"), true);
  assert.equal(result.kept.some((entry) => entry.content === "latest-user-intent"), true);
  assert.equal(result.summary.resolutionCounts.omitted, 1);
  assert.equal(result.summary.semanticSummary, "not_available");
});

test("P2-87C deduplicates citations without calling them semantic summaries", () => {
  const result = resolveTotalContextBudget([
    { kind: "system", content: "system-rule" },
    { kind: "persona", content: "persona-rule" },
    { kind: "search_citation", content: "same-citation" },
    { kind: "search_citation", content: "same-citation" },
    { kind: "history_recent", content: "latest-user-intent", protected: true }
  ], { totalBudget: 200, replyReserve: 20 });

  assert.equal(result.summary.resolutionCounts.deduplicated, 1);
  assert.equal(result.summary.resolutionCounts.semantic_summary, 0);
  assert.equal(result.summary.semanticSummary, "not_needed");
});

test("P2-87C fails closed when system and persona exceed the prompt budget", () => {
  const result = resolveTotalContextBudget([
    { kind: "system", content: "system-rule-that-is-deliberately-too-long" },
    { kind: "persona", content: "persona-rule-that-is-deliberately-too-long" },
    { kind: "history_recent", content: "latest-user-intent", protected: true }
  ], { totalBudget: 50, replyReserve: 20 });

  assert.equal(result.summary.withinBudget, false);
  assert.equal(result.kept.length, 0);
});

test("P2-87C selects structured memory and citations upstream while retaining manual key memory", () => {
  const manualKey = {
    id: crypto.randomUUID(),
    title: "manual key",
    content: "manual key content",
    tags: [],
    importance: "key" as const,
    sourceType: "manual-chat" as const,
    managedByUser: true
  };
  const general = {
    id: crypto.randomUUID(),
    title: "general",
    content: "g".repeat(2_000),
    tags: [],
    importance: "general" as const,
    sourceType: "auto-local-heuristic" as const,
    managedByUser: false
  };
  const selected = selectStructuredContext({
    messages: [
      { id: crypto.randomUUID(), role: "user", content: "old".repeat(600) },
      { id: crypto.randomUUID(), role: "user", content: "latest user intent" }
    ],
    memoryContext: { count: 2, cards: [manualKey, general] },
    webSearchContext: {
      query: "safe query",
      provider: "mcp",
      toolName: "tool",
      generatedAt: "2026-07-26T00:00:00.000Z",
      results: [
        { title: "same", snippet: "citation", url: "https://example.test/a" },
        { title: "same", snippet: "citation", url: "https://example.test/a" }
      ]
    }
  });

  assert.equal(selected.memoryContext?.cards.some((card) => card.id === manualKey.id), true);
  assert.equal(selected.memoryContext?.cards.some((card) => card.id === general.id), false);
  assert.equal(selected.messages.at(-1)?.content, "latest user intent");
  assert.equal(selected.webSearchContext?.results.length, 1);
  assert.equal(selected.summary.resolutionCounts.deduplicated, 1);
});

test("P2-87C continues lowering the structured budget when an intermediate selection is unchanged", () => {
  const general = {
    id: crypto.randomUUID(),
    title: "automatic memory",
    content: "g".repeat(220),
    tags: [],
    importance: "general" as const,
    sourceType: "auto-local-heuristic" as const,
    managedByUser: false
  };
  const input = {
    messages: [
      { id: crypto.randomUUID(), role: "assistant" as const, content: "previous reply".repeat(18) },
      { id: crypto.randomUUID(), role: "user" as const, content: "latest user intent" }
    ],
    memoryContext: { count: 1, cards: [general] }
  };
  const fitsFinalBudget = (selection: ReturnType<typeof selectStructuredContext>) => (
    (selection.memoryContext?.cards.length ?? 0) === 0 && selection.messages.length === 1
  );

  const selected = reselectStructuredContextUntilWithinBudget(input, fitsFinalBudget);

  assert.equal(selected.messages.length, 1);
  assert.equal(selected.messages[0]?.role, "user");
  assert.equal(selected.memoryContext, undefined);
});

test("P2-87C final mapper measurement fails closed without changing mapped text", () => {
  const final = measureMappedContextBudget([
    { role: "system", content: "system".repeat(600) },
    { role: "system", content: "persona".repeat(600) },
    { role: "user", content: "latest user intent" }
  ]);

  assert.equal(final.estimator, "conservative_char");
  assert.equal(final.withinBudget, false);
  assert.equal(final.replyReserve > 0, true);
});

test("P2-87C bundled semantic summary fails closed for unavailable targets and invalid output", async () => {
  let fetchCalls = 0;
  const unavailable = await summarizeOlderHistoryWithBundledRuntime({
    history: [{ id: crypto.randomUUID(), role: "user", content: "older history" }],
    getTarget: () => null,
    fetchFn: async () => {
      fetchCalls += 1;
      return new Response();
    }
  });
  const invalid = await summarizeOlderHistoryWithBundledRuntime({
    history: [{ id: crypto.randomUUID(), role: "user", content: "older history" }],
    getTarget: () => ({
      baseURL: "http://127.0.0.1:8080/v1",
      model: "bundled-model",
      localPresetId: "embedded-llama-cpp"
    }),
    fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 })
  });

  assert.equal(unavailable.status, "not_available");
  assert.equal(fetchCalls, 0);
  assert.deepEqual(invalid, { status: "failed" });
});

test("P2-87C reselects upstream non-protected context after final mapper measurement exceeds budget", () => {
  const general = {
    id: crypto.randomUUID(),
    title: "general",
    content: "g".repeat(700),
    tags: [],
    importance: "general" as const,
    sourceType: "auto-local-heuristic" as const,
    managedByUser: false
  };
  const input = {
    messages: [{ id: crypto.randomUUID(), role: "user" as const, content: "latest user intent" }],
    memoryContext: { count: 1, cards: [general] }
  };
  let structuredBudget = 900;
  let selected = selectStructuredContext({ ...input, totalBudget: structuredBudget });
  const finalWithinBudget = () => measureMappedContextBudget([
    { role: "system", content: "s".repeat(1_000) },
    { role: "system", content: "p".repeat(1_000) },
    ...selected.messages.map((message) => ({ role: message.role, content: message.content })),
    ...(selected.memoryContext?.cards.map((card) => ({ role: "system", content: card.content })) ?? [])
  ]).withinBudget;

  assert.equal(finalWithinBudget(), false);
  while (!finalWithinBudget() && structuredBudget > 1) {
    structuredBudget = Math.max(1, structuredBudget - 128);
    selected = selectStructuredContext({ ...input, totalBudget: structuredBudget });
  }

  assert.equal(selected.memoryContext?.cards.length ?? 0, 0);
  assert.equal(selected.messages[0]?.content, "latest user intent");
  assert.equal(finalWithinBudget(), true);
});
