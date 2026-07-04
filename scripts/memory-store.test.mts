import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createMemoryStore,
  MEMORY_CONTEXT_COMPRESSION_THRESHOLD,
  MEMORY_INJECTION_BUDGET
} = require("../dist/main/services/chat/memory-store.js") as typeof import("../src/main/services/chat/memory-store");
const { parseMemoryStorage } = require("../dist/shared/chat-memory.js") as typeof import("../src/shared/chat-memory");
const { mapChatMessagesToOpenAICompatible } = require("../dist/main/services/chat/chat-message-mapper.js") as typeof import("../src/main/services/chat/chat-message-mapper");
const { createFakeChatProvider } = require("../dist/main/services/chat/fake-provider.js") as typeof import("../src/main/services/chat/fake-provider");

function createDraft(sourceConversationId = crypto.randomUUID()) {
  return {
    title: "喜欢的称呼",
    content: "用户喜欢被称呼为小夏。",
    tags: ["称呼"],
    sourceConversationId
  };
}

test("memory storage is disabled by default and validates storage versions", () => {
  const draft = createDraft();
  const now = 1_700_000_000_000;
  const card = {
    id: crypto.randomUUID(),
    ...draft,
    createdAt: now,
    updatedAt: now,
    enabled: true
  };

  assert.equal(parseMemoryStorage({ version: 1, enabled: false, cards: [] })?.version, 3);
  assert.equal(parseMemoryStorage({ version: 2, enabled: false, cards: [] })?.version, 3);
  assert.equal(parseMemoryStorage({ version: 3, enabled: false, cards: [] })?.enabled, false);
  assert.equal(parseMemoryStorage({ version: 4, enabled: false, cards: [] }), null);
  assert.equal(parseMemoryStorage({ version: 1, enabled: "yes", cards: [] }), null);
  assert.equal(parseMemoryStorage({ version: 1, enabled: true, cards: [{ ...card, enabled: "yes" }] }), null);
});

test("v1 memory storage migrates to v3 metadata without dropping cards", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const memoryDirectory = join(userDataPath, "memory");
    await mkdir(memoryDirectory, { recursive: true });
    const now = 1_700_000_000_000;
    const legacyCard = {
      id: crypto.randomUUID(),
      ...createDraft(),
      createdAt: now,
      updatedAt: now,
      enabled: true
    };
    const memoryPath = join(memoryDirectory, "facts.json");
    await writeFile(memoryPath, JSON.stringify({
      version: 1,
      enabled: true,
      cards: [legacyCard]
    }), "utf8");

    const store = createMemoryStore({ userDataPath });
    const [card] = store.listCards();
    assert.equal(card.id, legacyCard.id);
    assert.equal(card.sourceType, "manual-chat");
    assert.equal(card.namespace, "personal");
    assert.equal(card.key, `manual-${legacyCard.id.slice(0, 8).toLowerCase()}`);
    assert.equal(card.importance, "key");
    assert.equal(card.category, "manual");
    assert.equal(card.confidence, 1);
    assert.equal(card.sourceMessageId, null);
    assert.equal(card.observedCount, 1);
    assert.equal(card.lastObservedAt, legacyCard.updatedAt);
    assert.equal(card.compressionState, "raw");
    assert.equal(card.lastInjectedAt, null);
    assert.equal(card.injectionCount, 0);

    const migrated = JSON.parse(await readFile(memoryPath, "utf8"));
    assert.equal(migrated.version, 3);
    assert.equal(migrated.cards.length, 1);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("memory cards require explicit enablement and deletion survives restart", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    assert.equal(store.getSettings().enabled, false);
    assert.equal(store.createInjection().count, 0);

    assert.equal(store.setEnabled(true).enabled, true);
    const card = store.createCard(createDraft());
    assert.equal(card.sourceType, "manual-chat");
    assert.equal(card.namespace, "personal");
    assert.equal(card.key, `manual-${card.id.slice(0, 8).toLowerCase()}`);
    assert.equal(card.importance, "key");
    assert.equal(card.category, "manual");
    assert.equal(card.confidence, 1);
    assert.equal(card.sourceMessageId, null);
    assert.equal(card.observedCount, 1);
    assert.equal(card.lastObservedAt, card.updatedAt);
    assert.equal(card.compressionState, "raw");
    assert.equal(card.lastInjectedAt, null);
    assert.equal(card.injectionCount, 0);
    assert.equal(store.listCards().length, 1);
    assert.equal(store.createInjection().count, 1);
    const injectedCard = store.getCard(card.id);
    assert.equal(injectedCard?.injectionCount, 1);
    assert.equal(typeof injectedCard?.lastInjectedAt, "number");

    assert.equal(store.updateCard(card.id, { enabled: false })?.enabled, false);
    assert.equal(store.createInjection().count, 0);
    assert.equal(store.getCard(card.id)?.injectionCount, 1);
    assert.equal(store.updateCard(card.id, { enabled: true })?.enabled, true);
    assert.deepEqual(await readdir(join(userDataPath, "memory")), ["facts.json"]);

    assert.equal(createMemoryStore({ userDataPath }).createInjection().count, 1);
    assert.equal(store.getCard(card.id)?.injectionCount, 2);
    assert.equal(store.deleteCard(card.id), true);
    assert.equal(createMemoryStore({ userDataPath }).listCards().length, 0);

    store.createCard(createDraft());
    store.clearCards();
    assert.equal(createMemoryStore({ userDataPath }).listCards().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("memory summary is safe and does not update injection metadata", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    store.setEnabled(true);

    for (let index = 0; index < MEMORY_INJECTION_BUDGET + 3; index += 1) {
      store.createCard({
        title: `P2-26 private title ${index}`,
        content: `P2-26 private content ${index}`,
        tags: [`p2-26-private-tag-${index}`],
        sourceConversationId: crypto.randomUUID()
      });
    }

    const beforeCards = store.listCards();
    const summary = store.getSummary();
    const afterCards = store.listCards();
    const serializedSummary = JSON.stringify(summary);

    assert.equal(summary.enabled, true);
    assert.equal(summary.totalCards, MEMORY_INJECTION_BUDGET + 3);
    assert.equal(summary.enabledCards, MEMORY_INJECTION_BUDGET + 3);
    assert.equal(summary.disabledCards, 0);
    assert.equal(summary.injectableCount, MEMORY_INJECTION_BUDGET);
    assert.equal(summary.injectableCount <= summary.injectionBudget, true);
    assert.equal(beforeCards.every((card) => card.injectionCount === 0 && card.lastInjectedAt === null), true);
    assert.equal(afterCards.every((card) => card.injectionCount === 0 && card.lastInjectedAt === null), true);
    assert.equal(afterCards.every((card) => card.compressionState === "raw"), true);
    assert.equal(serializedSummary.includes("P2-26 private title"), false);
    assert.equal(serializedSummary.includes("P2-26 private content"), false);
    assert.equal(serializedSummary.includes("p2-26-private-tag"), false);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("memory summary reports injectable zero while disabled and counts safe metadata", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    const manualCard = store.createCard(createDraft());
    let summary = store.getSummary();

    assert.equal(summary.enabled, false);
    assert.equal(summary.totalCards, 1);
    assert.equal(summary.enabledCards, 1);
    assert.equal(summary.disabledCards, 0);
    assert.equal(summary.injectableCount, 0);
    assert.equal(summary.sourceTypeCounts["manual-chat"], 1);
    assert.equal(summary.importanceCounts.key, 1);

    store.setEnabled(true);
    store.captureAutoMemoriesFromLatestUserMessage({
      conversationId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      content: "请用简体中文回复我"
    });
    store.captureAutoMemoriesFromLatestUserMessage({
      conversationId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      content: "回复短一点"
    });
    assert.equal(store.updateCard(manualCard.id, { enabled: false })?.enabled, false);
    summary = store.getSummary();

    assert.equal(summary.enabled, true);
    assert.equal(summary.totalCards, 3);
    assert.equal(summary.enabledCards, 2);
    assert.equal(summary.disabledCards, 1);
    assert.equal(summary.injectableCount, 2);
    assert.equal(summary.sourceTypeCounts["manual-chat"], 1);
    assert.equal(summary.sourceTypeCounts["auto-local-heuristic"], 2);
    assert.equal(summary.sourceTypeCounts["auto-local-model"], 0);
    assert.equal(summary.importanceCounts.key, 2);
    assert.equal(summary.importanceCounts.general, 1);
    assert.equal(summary.compressionStateCounts.raw, 3);
    assert.equal(summary.categoryCounts.manual, 1);
    assert.equal(summary.categoryCounts.language, 1);
    assert.equal(summary.categoryCounts.interaction, 1);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("auto heuristic memory is gated by the memory switch and skips sensitive messages", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const disabled = store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId,
      content: "以后请叫我P214C小夏"
    });
    assert.equal(disabled.skippedReason, "disabled");
    assert.equal(store.listCards().length, 0);

    store.setEnabled(true);
    const sensitive = store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId: crypto.randomUUID(),
      content: "我的 API Key 是 sk-p214c-should-not-be-stored"
    });
    assert.equal(sensitive.skippedReason, "sensitive");
    assert.equal(store.listCards().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("auto heuristic memory stores short facts without full user text", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    store.setEnabled(true);
    const summary = store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId,
      content: "以后请叫我P214C小夏，这整句话不应该被完整保存"
    });
    assert.equal(summary.capturedCount, 1);
    assert.equal(summary.keyCount, 1);
    assert.deepEqual(summary.safeCategories, ["addressing"]);

    const [card] = store.listCards();
    assert.equal(card?.sourceType, "auto-local-heuristic");
    assert.equal(card?.importance, "key");
    assert.equal(card?.category, "addressing");
    assert.equal(card?.sourceMessageId, messageId);
    assert.equal(card?.observedCount, 1);
    assert.equal(card?.compressionState, "raw");
    assert.equal(card?.content.includes("这整句话"), false);

    const rawStorage = await readFile(store.getMemoryPath(), "utf8");
    assert.equal(rawStorage.includes("这整句话不应该被完整保存"), false);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("auto heuristic memory distinguishes key and general facts", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    const conversationId = crypto.randomUUID();
    store.setEnabled(true);
    store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId: crypto.randomUUID(),
      content: "请用简体中文回复我"
    });
    store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId: crypto.randomUUID(),
      content: "我希望桌宠贴近屏幕右侧"
    });

    const cards = store.listCards();
    assert.equal(cards.some((card) => card.importance === "key" && card.category === "language"), true);
    assert.equal(cards.some((card) => card.importance === "general" && card.category === "pet_presentation"), true);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("auto heuristic memory merges duplicates deterministically", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    const conversationId = crypto.randomUUID();
    store.setEnabled(true);
    store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId: crypto.randomUUID(),
      content: "请用简体中文回复我"
    });
    const duplicate = store.captureAutoMemoriesFromLatestUserMessage({
      conversationId,
      messageId: crypto.randomUUID(),
      content: "以后请用简体中文回复我"
    });

    const cards = store.listCards();
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.observedCount, 2);
    assert.equal(cards[0]?.compressionState, "deduplicated");
    assert.equal(duplicate.deduplicatedCount, 1);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("memory injection applies deterministic budget sorting when context crosses threshold", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    store.setEnabled(true);
    for (let index = 0; index < MEMORY_CONTEXT_COMPRESSION_THRESHOLD + 2; index += 1) {
      store.createCard({
        ...createDraft(),
        title: `P2-14C budget fact ${index}`,
        content: `P2-14C local budget fact ${index}`,
        tags: ["budget"],
        sourceConversationId: crypto.randomUUID()
      });
    }

    const injection = store.createInjection();
    assert.equal(injection.count, MEMORY_INJECTION_BUDGET);
    assert.equal(injection.count <= MEMORY_INJECTION_BUDGET, true);
    assert.equal(store.listCards().some((card) => card.compressionState === "budgeted"), true);
    assert.equal(store.listCards().filter((card) => card.enabled && card.compressionState === "budgeted").length, MEMORY_CONTEXT_COMPRESSION_THRESHOLD + 2);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("corrupted memory storage falls back without exposing cards", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const memoryDirectory = join(userDataPath, "memory");
    await mkdir(memoryDirectory, { recursive: true });
    await writeFile(join(memoryDirectory, "facts.json"), "not-json", "utf8");
    const store = createMemoryStore({ userDataPath });
    assert.equal(store.getSettings().enabled, false);
    assert.equal(store.listCards().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("provider message mapping only includes explicit memory context", () => {
  const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "你好" }];
  const withoutMemory = mapChatMessagesToOpenAICompatible(messages);
  assert.equal(withoutMemory[0]?.role, "system");
  assert.equal(withoutMemory[1]?.role, "system");
  assert.match(withoutMemory[1]?.content ?? "", /老魔女|魔女/);
  assert.equal(withoutMemory[2]?.role, "system");
  assert.match(withoutMemory[2]?.content ?? "", /低打扰桌面伙伴/);
  assert.match(withoutMemory[2]?.content ?? "", /默认回复 1-3 句/);
  assert.equal(withoutMemory.some((message) => message.content.includes("用户喜欢被称呼为小夏")), false);

  const withMemory = mapChatMessagesToOpenAICompatible(messages, {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "称呼", content: "用户喜欢被称呼为小夏。", tags: ["称呼"] }]
  });
  assert.equal(withMemory[3]?.role, "system");
  assert.equal(withMemory.some((message) => message.role === "system" && message.content.includes("用户喜欢被称呼为小夏")), true);
});

test("dialogue style message does not include memory card content", () => {
  const messages = [{ id: crypto.randomUUID(), role: "user" as const, content: "你好" }];
  const mapped = mapChatMessagesToOpenAICompatible(messages, {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "称呼", content: "用户喜欢被称呼为小夏。", tags: ["称呼"] }]
  });

  assert.equal(mapped[2]?.role, "system");
  assert.equal(mapped[2]?.content.includes("用户喜欢被称呼为小夏"), false);
});

test("fake provider returns short varied replies with emotion classification", async () => {
  const provider = createFakeChatProvider();
  const firstText = await streamFakeReply(provider, "conversation-a", "我今天很开心");
  const secondText = await streamFakeReply(provider, "conversation-b", "我今天很开心");
  const sadText = await streamFakeReply(provider, "conversation-c", "我有点难过");

  assert.equal(firstText.result.emotion, "happy");
  assert.equal(firstText.result.intensity, "low");
  assert.equal(firstText.deltaText, firstText.result.text);
  assert.ok(firstText.result.text.length > 0 && firstText.result.text.length <= 40);
  assert.ok(secondText.result.text.length > 0 && secondText.result.text.length <= 40);
  assert.ok(sadText.result.text.length > 0 && sadText.result.text.length <= 40);
  assert.notEqual(new Set([firstText.result.text, secondText.result.text, sadText.result.text]).size, 1);
});

async function streamFakeReply(
  provider: ReturnType<typeof createFakeChatProvider>,
  conversationId: string,
  content: string
) {
  let deltaText = "";
  const result = await provider.streamReply({
    requestVersion: 1,
    conversationId,
    messages: [{ id: crypto.randomUUID(), role: "user", content }]
  }, {
    signal: new AbortController().signal,
    onDelta(delta) {
      deltaText += delta.text;
    }
  });

  return { deltaText, result };
}
