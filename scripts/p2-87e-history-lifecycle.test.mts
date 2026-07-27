import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createHistoryStore } = require("../dist/main/services/chat/history-store.js") as typeof import("../src/main/services/chat/history-store");
const { createMemoryReviewStore } = require("../dist/main/services/chat/memory-review-store.js") as typeof import("../src/main/services/chat/memory-review-store");

function message(role: "user" | "assistant", content: string, createdAt: number) {
  return { id: crypto.randomUUID(), role, content, createdAt };
}

test("v1 history migrates atomically to v2 with default retention and prunes linked summaries", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-history-"));
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const historyPath = join(userDataPath, "history", "conversations.json");

  try {
    await mkdir(join(userDataPath, "history"), { recursive: true });
    await writeFile(historyPath, JSON.stringify({
      version: 1,
      conversations: [
        { id: firstId, title: "最早", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, messages: [message("user", "第一段", 1_700_000_000_000)] },
        { id: secondId, title: "较新", createdAt: 1_700_000_000_100, updatedAt: 1_700_000_000_100, messages: [message("user", "第二段", 1_700_000_000_100)] }
      ]
    }), "utf8");
    const store = createHistoryStore({ userDataPath });

    assert.equal(store.getRetentionLimit(), 500);
    assert.equal(store.setRetentionLimit(100), 100);
    assert.equal(store.saveSemanticSummary(firstId, store.getConversation(firstId)?.messages.map((item) => item.id) ?? [], "第一段的安全语义摘要"), true);
    assert.equal(store.saveSemanticSummary(secondId, store.getConversation(secondId)?.messages.map((item) => item.id) ?? [], "sk-synthetic-secret"), false);
    assert.equal(store.getSemanticSummary(firstId, store.getConversation(firstId)?.messages.map((item) => item.id) ?? []), "第一段的安全语义摘要");
    assert.equal(store.setRetentionLimit(1), 100);
    assert.equal(store.deleteConversation(firstId), true);
    assert.equal(store.getSemanticSummary(firstId, []), null);

    const persisted = JSON.parse(await readFile(historyPath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.equal(persisted.retentionLimit, 100);
    assert.equal(persisted.semanticSummaries.length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("retention deletes the oldest original conversation and its linked semantic summary", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-retention-"));

  try {
    const store = createHistoryStore({ userDataPath });
    assert.equal(store.setRetentionLimit(100), 100);
    const firstId = crypto.randomUUID();
    const firstMessage = message("user", "最早的合成会话", 1_700_000_000_000);
    assert.equal(store.appendMessage(firstId, firstMessage), true);
    assert.equal(store.saveSemanticSummary(firstId, [firstMessage.id], "最早会话的安全摘要"), true);

    for (let index = 1; index <= 100; index += 1) {
      assert.equal(store.appendMessage(crypto.randomUUID(), message("user", `合成会话 ${index}`, 1_700_000_000_000 + index)), true);
    }

    assert.equal(store.getConversation(firstId), null);
    assert.equal(store.getSemanticSummary(firstId, [firstMessage.id]), null);
    assert.equal(store.listConversations().length, 100);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("unknown history schema rejects every write without replacing the original file", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-unknown-history-"));
  const historyPath = join(userDataPath, "history", "conversations.json");
  const conversationId = crypto.randomUUID();
  const original = JSON.stringify({
    version: 999,
    conversations: [{
      id: conversationId,
      title: "不可恢复的合成历史",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      messages: [message("user", "合成内容", 1_700_000_000_000)]
    }]
  }) + "\n";

  try {
    await mkdir(join(userDataPath, "history"), { recursive: true });
    await writeFile(historyPath, original, "utf8");
    const store = createHistoryStore({ userDataPath });

    assert.equal(store.setRetentionLimit(100), null);
    assert.equal(store.clearConversations(), false);
    assert.equal(store.appendMessage(crypto.randomUUID(), message("user", "不应写入", 1_700_000_000_100)), false);
    assert.equal(store.deleteConversation(conversationId), false);
    assert.equal(store.saveSemanticSummary(conversationId, [crypto.randomUUID()], "不应写入的摘要"), false);
    assert.equal(await readFile(historyPath, "utf8"), original);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("v1 migration write failure leaves the readable v1 file unchanged", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-v1-write-failure-"));
  const historyPath = join(userDataPath, "history", "conversations.json");
  const conversationId = crypto.randomUUID();
  const original = JSON.stringify({
    version: 1,
    conversations: [{
      id: conversationId,
      title: "可读的合成 v1 历史",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      messages: [message("user", "合成内容", 1_700_000_000_000)]
    }]
  }) + "\n";

  try {
    await mkdir(join(userDataPath, "history"), { recursive: true });
    await writeFile(historyPath, original, "utf8");
    const store = createHistoryStore({
      userDataPath,
      writeFileSync() {
        throw new Error("synthetic write failure");
      }
    });

    assert.equal(store.getConversation(conversationId)?.messages.length, 1);
    assert.equal(store.setRetentionLimit(100), null);
    assert.equal(await readFile(historyPath, "utf8"), original);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("future v2 fields at every history level reject writes without data loss", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-future-history-"));
  const historyPath = join(userDataPath, "history", "conversations.json");
  const conversationId = crypto.randomUUID();
  const historyMessage = message("user", "合成内容", 1_700_000_000_000);
  const base = {
    version: 2,
    retentionLimit: 500,
    conversations: [{
      id: conversationId,
      title: "合成 v2",
      createdAt: historyMessage.createdAt,
      updatedAt: historyMessage.createdAt,
      messages: [historyMessage]
    }],
    semanticSummaries: [{
      conversationId,
      sourceMessageIds: [historyMessage.id],
      content: "合成安全摘要",
      updatedAt: historyMessage.createdAt
    }]
  };

  try {
    await mkdir(join(userDataPath, "history"), { recursive: true });
    const v1Future = {
      version: 1,
      conversations: [base.conversations[0]],
      futureV1Root: true
    };
    const v1Original = JSON.stringify(v1Future) + "\n";
    await writeFile(historyPath, v1Original, "utf8");
    assert.equal(createHistoryStore({ userDataPath }).setRetentionLimit(100), null);
    assert.equal(await readFile(historyPath, "utf8"), v1Original);
    for (const mutate of [
      (value: any) => { value.futureRoot = true; },
      (value: any) => { value.conversations[0].futureConversation = true; },
      (value: any) => { value.conversations[0].messages[0].futureMessage = true; },
      (value: any) => { value.semanticSummaries[0].futureSummary = true; }
    ]) {
      const future = structuredClone(base);
      mutate(future);
      const original = JSON.stringify(future) + "\n";
      await writeFile(historyPath, original, "utf8");
      assert.equal(createHistoryStore({ userDataPath }).setRetentionLimit(100), null);
      assert.equal(await readFile(historyPath, "utf8"), original);
    }
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("clearing history preserves the selected retention limit", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-clear-retention-"));

  try {
    const store = createHistoryStore({ userDataPath });
    assert.equal(store.setRetentionLimit(100), 100);
    assert.equal(store.appendMessage(crypto.randomUUID(), message("user", "合成会话", 1_700_000_000_000)), true);
    assert.equal(store.clearConversations(), true);
    assert.equal(store.getRetentionLimit(), 100);
    assert.equal(store.listConversations().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("expired pending reviews are removed without changing retained review decisions", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-review-"));

  try {
    const store = createMemoryReviewStore({ userDataPath });
    const pending = store.enqueue({
      action: "create",
      title: "合成偏好",
      content: "合成内容",
      tags: ["合成"],
      namespace: "preference",
      key: "synthetic",
      importance: "general",
      category: "interaction",
      confidence: 0.9,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    const rejected = store.enqueue({
      action: "update-suggestion",
      title: "已拒绝建议",
      content: "合成内容",
      tags: ["合成"],
      namespace: "preference",
      key: "synthetic-rejected",
      importance: "general",
      category: "interaction",
      confidence: 0.9,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    assert.notEqual(store.setStatus(rejected.id, "rejected"), null);

    assert.equal(store.pruneExpiredPendingCandidates(pending.createdAt + 30 * 24 * 60 * 60 * 1_000 + 1), 1);
    assert.equal(store.getCandidate(pending.id), null);
    assert.equal(store.getCandidate(rejected.id)?.status, "rejected");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("expired pending candidates cannot be edited, confirmed, or transitioned", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-87e-expired-review-"));

  try {
    const store = createMemoryReviewStore({ userDataPath });
    const candidate = store.enqueue({
      action: "create",
      title: "合成过期候选",
      content: "合成内容",
      tags: ["合成"],
      namespace: "preference",
      key: "expired-synthetic",
      importance: "general",
      category: "interaction",
      confidence: 0.9,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    const reviewPath = store.getReviewPath();
    const persisted = JSON.parse(await readFile(reviewPath, "utf8"));
    persisted.candidates[0].createdAt = candidate.createdAt - 30 * 24 * 60 * 60 * 1_000 - 1;
    persisted.candidates[0].updatedAt = persisted.candidates[0].createdAt;
    await writeFile(reviewPath, JSON.stringify(persisted), "utf8");

    const expiredStore = createMemoryReviewStore({ userDataPath });
    assert.equal(expiredStore.updatePendingCandidate(candidate.id, { title: "不应更新" }), null);
    assert.equal(expiredStore.setStatus(candidate.id, "confirmed"), null);
    assert.equal(expiredStore.getCandidate(candidate.id), null);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("history UI keeps clear scopes explicit and main reuses only persisted bundled summaries", async () => {
  const [appSource, rendererSource, html] = await Promise.all([
    readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8"),
    readFile(join(process.cwd(), "src", "renderer", "chat", "main.ts"), "utf8"),
    readFile(join(process.cwd(), "src", "renderer", "chat", "index.html"), "utf8")
  ]);

  assert.match(appSource, /const persistedSemanticSummary = omittedMessageIds\.length > 0/);
  assert.match(appSource, /historyStoreForRequest\.getSemanticSummary\(request\.conversationId, omittedMessageIds\)/);
  assert.match(appSource, /historyStoreForRequest\.saveSemanticSummary\(request\.conversationId, omittedMessageIds, semanticSummary\.content\)/);
  assert.match(appSource, /status: "reused" as const/);
  assert.match(appSource, /memoryReviewStore\.pruneExpiredPendingCandidates\(\);\s+const candidate = parsedUpdate/);
  assert.match(rendererSource, /await window\.historyApi\?\.clearConversations\(\);\s+selectedHistoryConversation = null;\s+resetCurrentConversation\(\);/);
  assert.match(rendererSource, /function resetCurrentConversation\(\): void/);
  assert.match(html, /id="history-retention-limit"/);
  assert.match(html, /事实卡和待复核候选；不会清空聊天历史或已忘记类型/);
  assert.match(html, /历史原文和派生摘要，并重置当前会话；不会清空事实卡、待复核候选或已忘记类型/);
});
