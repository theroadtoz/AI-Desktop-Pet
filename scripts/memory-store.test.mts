import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createMemoryStore } = require("../dist/main/services/chat/memory-store.js") as typeof import("../src/main/services/chat/memory-store");
const { parseMemoryStorage } = require("../dist/shared/chat-memory.js") as typeof import("../src/shared/chat-memory");
const { mapChatMessagesToOpenAICompatible } = require("../dist/main/services/chat/chat-message-mapper.js") as typeof import("../src/main/services/chat/chat-message-mapper");

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

  assert.equal(parseMemoryStorage({ version: 1, enabled: false, cards: [] })?.enabled, false);
  assert.equal(parseMemoryStorage({ version: 2, enabled: false, cards: [] }), null);
  assert.equal(parseMemoryStorage({ version: 1, enabled: "yes", cards: [] }), null);
  assert.equal(parseMemoryStorage({ version: 1, enabled: true, cards: [{ ...card, enabled: "yes" }] }), null);
});

test("memory cards require explicit enablement and deletion survives restart", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-"));

  try {
    const store = createMemoryStore({ userDataPath });
    assert.equal(store.getSettings().enabled, false);
    assert.equal(store.createInjection().count, 0);

    assert.equal(store.setEnabled(true).enabled, true);
    const card = store.createCard(createDraft());
    assert.equal(store.listCards().length, 1);
    assert.equal(store.createInjection().count, 1);

    assert.equal(store.updateCard(card.id, { enabled: false })?.enabled, false);
    assert.equal(store.createInjection().count, 0);
    assert.equal(store.updateCard(card.id, { enabled: true })?.enabled, true);
    assert.deepEqual(await readdir(join(userDataPath, "memory")), ["facts.json"]);

    assert.equal(createMemoryStore({ userDataPath }).createInjection().count, 1);
    assert.equal(store.deleteCard(card.id), true);
    assert.equal(createMemoryStore({ userDataPath }).listCards().length, 0);

    store.createCard(createDraft());
    store.clearCards();
    assert.equal(createMemoryStore({ userDataPath }).listCards().length, 0);
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
  assert.equal(withoutMemory.some((message) => message.content.includes("用户喜欢被称呼为小夏")), false);

  const withMemory = mapChatMessagesToOpenAICompatible(messages, {
    count: 1,
    cards: [{ id: crypto.randomUUID(), title: "称呼", content: "用户喜欢被称呼为小夏。", tags: ["称呼"] }]
  });
  assert.equal(withMemory.some((message) => message.role === "system" && message.content.includes("用户喜欢被称呼为小夏")), true);
});
