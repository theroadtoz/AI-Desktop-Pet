import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createHistoryStore } = require("../dist/main/services/chat/history-store.js") as typeof import("../src/main/services/chat/history-store");
const { parseHistoryStorage } = require("../dist/shared/chat-history.js") as typeof import("../src/shared/chat-history");

function createMessage(role: "user" | "assistant", content: string, createdAt: number) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt
  };
}

test("history storage validates data and safely falls back for malformed or unknown versions", () => {
  const message = createMessage("user", "你好", 1_700_000_000_000);

  assert.equal(parseHistoryStorage({ version: 1, conversations: [] })?.version, 1);
  assert.equal(parseHistoryStorage({ version: 2, conversations: [] }), null);
  assert.equal(parseHistoryStorage({ version: 1, conversations: [{ id: message.id, messages: [message] }] }), null);
  assert.equal(parseHistoryStorage({ version: 1, conversations: [{
    id: message.id,
    title: "测试",
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    messages: [{ ...message, role: "system" }]
  }] }), null);
});

test("history storage persists completed messages atomically and deletion survives restart", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-history-"));
  const conversationId = crypto.randomUUID();

  try {
    const store = createHistoryStore({ userDataPath });
    const userMessage = createMessage("user", "第一条消息", 1_700_000_000_000);
    assert.equal(store.appendMessage(conversationId, userMessage), true);
    assert.equal(store.appendMessage(conversationId, userMessage), false);
    assert.equal(store.appendMessage(conversationId, createMessage("assistant", "第一条回复", 1_700_000_000_100)), true);

    assert.deepEqual(store.listConversations().map(({ id, messageCount }) => ({ id, messageCount })), [{
      id: conversationId,
      messageCount: 2
    }]);
    assert.equal(store.getConversation(conversationId)?.messages[1]?.content, "第一条回复");
    assert.deepEqual(await readdir(join(userDataPath, "history")), ["conversations.json"]);

    const reloadedStore = createHistoryStore({ userDataPath });
    assert.equal(reloadedStore.getConversation(conversationId)?.messages.length, 2);
    assert.equal(reloadedStore.deleteConversation(conversationId), true);
    assert.equal(createHistoryStore({ userDataPath }).listConversations().length, 0);

    reloadedStore.clearConversations();
    assert.equal(createHistoryStore({ userDataPath }).listConversations().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("corrupted local history is not exposed to the renderer-facing store", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-history-"));

  try {
    const historyDirectory = join(userDataPath, "history");
    await mkdir(historyDirectory, { recursive: true });
    await writeFile(join(historyDirectory, "conversations.json"), "not-json", "utf8");
    assert.equal(createHistoryStore({ userDataPath }).listConversations().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
