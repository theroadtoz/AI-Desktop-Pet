import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createHistoryStore } = require("../dist/main/services/chat/history-store.js") as typeof import("../src/main/services/chat/history-store");
const { createMemoryStore } = require("../dist/main/services/chat/memory-store.js") as typeof import("../src/main/services/chat/memory-store");
const { createMemoryReviewStore } = require("../dist/main/services/chat/memory-review-store.js") as typeof import("../src/main/services/chat/memory-review-store");

function message(role: "user" | "assistant", content: string, createdAt: number) {
  return { id: crypto.randomUUID(), role, content, createdAt };
}

type HistoryWriteAction = {
  name: string;
  run(store: ReturnType<typeof createHistoryStore>, conversationId: string, messageId: string): unknown;
  expectedResult: unknown;
  expectedRetention: 100 | 500;
};

const HISTORY_WRITE_ACTIONS: HistoryWriteAction[] = [
  {
    name: "append",
    run: (store) => store.appendMessage(crypto.randomUUID(), message("user", "追加迁移", 1_700_000_000_100)),
    expectedResult: true,
    expectedRetention: 500
  },
  { name: "delete", run: (store, conversationId) => store.deleteConversation(conversationId), expectedResult: true, expectedRetention: 500 },
  { name: "clear", run: (store) => store.clearConversations(), expectedResult: true, expectedRetention: 500 },
  { name: "set-retention", run: (store) => store.setRetentionLimit(100), expectedResult: 100, expectedRetention: 100 },
  {
    name: "save-summary",
    run: (store, conversationId, messageId) => store.saveSemanticSummary(conversationId, [messageId], "迁移后的安全摘要"),
    expectedResult: true,
    expectedRetention: 500
  }
];

function reviewDraft(key: string) {
  return {
    action: "create" as const,
    title: "合成偏好",
    content: "用户喜欢安静的陪伴。",
    tags: ["合成"],
    namespace: "preference",
    key,
    importance: "general" as const,
    category: "interaction",
    confidence: 0.9,
    sourceConversationId: crypto.randomUUID(),
    sourceMessageId: crypto.randomUUID()
  };
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
  const historyPath = join(userDataPath, "history", "conversations.json");
  const conversations = Array.from({ length: 100 }, (_, index) => {
    const createdAt = 1_700_000_000_000 + index;
    const historyMessage = message("user", `合成会话 ${index}`, createdAt);
    return {
      id: crypto.randomUUID(),
      title: `合成会话 ${index}`,
      createdAt,
      updatedAt: createdAt,
      messages: [historyMessage]
    };
  });
  const oldest = conversations[0];

  try {
    await mkdir(join(userDataPath, "history"), { recursive: true });
    await writeFile(historyPath, JSON.stringify({
      version: 2,
      retentionLimit: 100,
      conversations,
      semanticSummaries: [{
        conversationId: oldest.id,
        sourceMessageIds: [oldest.messages[0].id],
        content: "最早会话的安全摘要",
        updatedAt: oldest.updatedAt
      }]
    }), "utf8");
    const store = createHistoryStore({ userDataPath });
    assert.equal(store.appendMessage(crypto.randomUUID(), message("user", "第 101 个合成会话", 1_700_000_000_100)), true);

    assert.equal(store.getConversation(oldest.id), null);
    assert.equal(store.getSemanticSummary(oldest.id, [oldest.messages[0].id]), null);
    assert.equal(store.listConversations().length, 100);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("default 500 evicts the 501st oldest conversation and linked summary", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-91a-default-500-"));
  const historyPath = join(userDataPath, "history", "conversations.json");
  const conversations = Array.from({ length: 500 }, (_, index) => {
    const createdAt = 1_700_000_000_000 + index;
    return {
      id: crypto.randomUUID(),
      title: `合成会话 ${index}`,
      createdAt,
      updatedAt: 1_700_000_000_500,
      messages: [message("user", `合成内容 ${index}`, createdAt)]
    };
  });
  const oldest = conversations[0];

  try {
    await mkdir(join(userDataPath, "history"), { recursive: true });
    await writeFile(historyPath, JSON.stringify({
      version: 2,
      retentionLimit: 500,
      conversations,
      semanticSummaries: [{
        conversationId: oldest.id,
        sourceMessageIds: [oldest.messages[0].id],
        content: "最旧会话的安全摘要",
        updatedAt: oldest.updatedAt
      }]
    }), "utf8");
    const store = createHistoryStore({ userDataPath });

    assert.equal(store.appendMessage(crypto.randomUUID(), message("user", "第 501 个会话", 1_700_000_001_000)), true);
    assert.equal(store.listConversations().length, 500);
    assert.equal(store.getConversation(oldest.id), null);
    assert.equal(store.getSemanticSummary(oldest.id, [oldest.messages[0].id]), null);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("v1 and legacy 2048 migrate through every public history write path", async () => {
  for (const source of ["v1", "legacy-2048"] as const) {
    for (const action of HISTORY_WRITE_ACTIONS) {
      const userDataPath = await mkdtemp(join(tmpdir(), `desktop-pet-p2-91a-${source}-${action.name}-`));
      const historyDirectory = join(userDataPath, "history");
      const historyPath = join(historyDirectory, "conversations.json");
      const conversationId = crypto.randomUUID();
      const historyMessage = message("user", "迁移合成内容", 1_700_000_000_000);
      const conversation = {
        id: conversationId,
        title: "迁移合成会话",
        createdAt: historyMessage.createdAt,
        updatedAt: historyMessage.createdAt,
        messages: [historyMessage]
      };
      const storage = source === "v1"
        ? { version: 1, conversations: [conversation] }
        : { version: 2, retentionLimit: 2_048, conversations: [conversation], semanticSummaries: [] };

      try {
        await mkdir(historyDirectory, { recursive: true });
        await writeFile(historyPath, `${JSON.stringify(storage)}\n`, "utf8");
        const store = createHistoryStore({ userDataPath });
        assert.equal(store.getRetentionLimit(), 500, `${source}/${action.name} read projection`);
        assert.equal(action.run(store, conversationId, historyMessage.id), action.expectedResult, `${source}/${action.name}`);
        const persisted = JSON.parse(await readFile(historyPath, "utf8"));
        assert.equal(persisted.version, 2);
        assert.equal(persisted.retentionLimit, action.expectedRetention);
        assert.equal((await readdir(historyDirectory)).some((name) => name.endsWith(".tmp")), false);
      } finally {
        await rm(userDataPath, { recursive: true, force: true });
      }
    }
  }
});

test("oversized v1 and legacy 2048 are pruned on a delete migration write", async () => {
  await assertOversizedMigrationWritePrunesToDefault("delete");
});

test("oversized v1 and legacy 2048 are pruned on a save-summary migration write", async () => {
  await assertOversizedMigrationWritePrunesToDefault("save-summary");
});

test("oversized migration write failures preserve exact bytes and leave no temporary file", async () => {
  for (const source of ["v1", "legacy-2048"] as const) {
    for (const action of ["delete", "save-summary"] as const) {
      const userDataPath = await mkdtemp(join(tmpdir(), `desktop-pet-p2-91a-oversized-fail-${source}-${action}-`));
      const historyDirectory = join(userDataPath, "history");
      const historyPath = join(historyDirectory, "conversations.json");
      const conversations = Array.from({ length: 700 }, (_, index) => {
        const createdAt = 1_700_000_000_000 + index;
        const historyMessage = message("user", `不可写迁移内容 ${index}`, createdAt);
        return {
          id: crypto.randomUUID(),
          title: `不可写迁移会话 ${index}`,
          createdAt,
          updatedAt: createdAt,
          messages: [historyMessage]
        };
      });
      const newest = conversations.at(-1)!;
      const storage = source === "v1"
        ? { version: 1, conversations }
        : { version: 2, retentionLimit: 2_048, conversations, semanticSummaries: [] };
      const original = `${JSON.stringify(storage)}\n`;

      try {
        await mkdir(historyDirectory, { recursive: true });
        await writeFile(historyPath, original, "utf8");
        const store = createHistoryStore({
          userDataPath,
          writeFileSync() {
            throw new Error("synthetic oversized write failure");
          }
        });
        const result = action === "delete"
          ? store.deleteConversation(newest.id)
          : store.saveSemanticSummary(newest.id, [newest.messages[0].id], "不可落盘的安全摘要");

        assert.equal(result, false, `${source}/${action}`);
        assert.equal(await readFile(historyPath, "utf8"), original, `${source}/${action} bytes`);
        assert.equal((await readdir(historyDirectory)).some((name) => name.endsWith(".tmp")), false, `${source}/${action} tmp`);
      } finally {
        await rm(userDataPath, { recursive: true, force: true });
      }
    }
  }
});

async function assertOversizedMigrationWritePrunesToDefault(action: "delete" | "save-summary"): Promise<void> {
  for (const source of ["v1", "legacy-2048"] as const) {
      const userDataPath = await mkdtemp(join(tmpdir(), `desktop-pet-p2-91a-oversized-${source}-${action}-`));
      const historyDirectory = join(userDataPath, "history");
      const historyPath = join(historyDirectory, "conversations.json");
      const conversations = Array.from({ length: 700 }, (_, index) => {
        const createdAt = 1_700_000_000_000 + index;
        const historyMessage = message("user", `迁移合成内容 ${index}`, createdAt);
        return {
          id: crypto.randomUUID(),
          title: `迁移合成会话 ${index}`,
          createdAt,
          updatedAt: createdAt,
          messages: [historyMessage]
        };
      });
      const newest = conversations.at(-1)!;
      const storage = source === "v1"
        ? { version: 1, conversations }
        : {
            version: 2,
            retentionLimit: 2_048,
            conversations,
            semanticSummaries: conversations.map((conversation) => ({
              conversationId: conversation.id,
              sourceMessageIds: [conversation.messages[0].id],
              content: `迁移安全摘要 ${conversation.title}`,
              updatedAt: conversation.updatedAt
            }))
          };

      try {
        await mkdir(historyDirectory, { recursive: true });
        await writeFile(historyPath, `${JSON.stringify(storage)}\n`, "utf8");
        const store = createHistoryStore({ userDataPath });

        if (action === "delete") {
          assert.equal(store.deleteConversation(newest.id), true, `${source}/${action}`);
        } else {
          assert.equal(store.saveSemanticSummary(
            newest.id,
            [newest.messages[0].id],
            "首次写入后的安全摘要"
          ), true, `${source}/${action}`);
        }

        const persisted = JSON.parse(await readFile(historyPath, "utf8"));
        const persistedConversationIds = new Set<string>(persisted.conversations.map((conversation: { id: string }) => conversation.id));
        assert.equal(persisted.version, 2, `${source}/${action} version`);
        assert.equal(persisted.retentionLimit, 500, `${source}/${action} retention`);
        assert.equal(persisted.conversations.length, 500, `${source}/${action} conversation count`);
        assert.equal(persisted.semanticSummaries.every((summary: { conversationId: string }) =>
          persistedConversationIds.has(summary.conversationId)
        ), true, `${source}/${action} orphan summaries`);
        assert.equal((await readdir(historyDirectory)).some((name) => name.endsWith(".tmp")), false);
      } finally {
        await rm(userDataPath, { recursive: true, force: true });
      }
  }
}

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

test("v1 and legacy 2048 write failures preserve original bytes through every write path", async () => {
  for (const source of ["v1", "legacy-2048"] as const) {
    for (const action of HISTORY_WRITE_ACTIONS) {
      const userDataPath = await mkdtemp(join(tmpdir(), `desktop-pet-p2-91a-fail-${source}-${action.name}-`));
      const historyDirectory = join(userDataPath, "history");
      const historyPath = join(historyDirectory, "conversations.json");
      const conversationId = crypto.randomUUID();
      const historyMessage = message("user", "不可写迁移内容", 1_700_000_000_000);
      const conversation = {
        id: conversationId,
        title: "不可写迁移会话",
        createdAt: historyMessage.createdAt,
        updatedAt: historyMessage.createdAt,
        messages: [historyMessage]
      };
      const storage = source === "v1"
        ? { version: 1, conversations: [conversation] }
        : { version: 2, retentionLimit: 2_048, conversations: [conversation], semanticSummaries: [] };
      const original = `${JSON.stringify(storage)}\n`;

      try {
        await mkdir(historyDirectory, { recursive: true });
        await writeFile(historyPath, original, "utf8");
        const store = createHistoryStore({
          userDataPath,
          writeFileSync() {
            throw new Error("synthetic write failure");
          }
        });
        const expectedFailure = action.name === "set-retention" ? null : false;
        assert.equal(action.run(store, conversationId, historyMessage.id), expectedFailure, `${source}/${action.name}`);
        assert.equal(await readFile(historyPath, "utf8"), original);
        assert.equal((await readdir(historyDirectory)).some((name) => name.endsWith(".tmp")), false);
      } finally {
        await rm(userDataPath, { recursive: true, force: true });
      }
    }
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
    const schemas = [
      { name: "v1-root", create: () => ({ version: 1, conversations: [base.conversations[0]], futureV1Root: true }) },
      { name: "v2-root", create: () => ({ ...structuredClone(base), futureRoot: true }) },
      { name: "conversation", create: () => { const value = structuredClone(base) as any; value.conversations[0].futureConversation = true; return value; } },
      { name: "message", create: () => { const value = structuredClone(base) as any; value.conversations[0].messages[0].futureMessage = true; return value; } },
      { name: "summary", create: () => { const value = structuredClone(base) as any; value.semanticSummaries[0].futureSummary = true; return value; } }
    ];
    for (const schema of schemas) {
      for (const action of HISTORY_WRITE_ACTIONS) {
        const original = `${JSON.stringify(schema.create())}\n`;
        await writeFile(historyPath, original, "utf8");
        const store = createHistoryStore({ userDataPath });
        const expectedFailure = action.name === "set-retention" ? null : false;
        assert.equal(action.run(store, conversationId, historyMessage.id), expectedFailure, `${schema.name}/${action.name}`);
        assert.equal(await readFile(historyPath, "utf8"), original);
      }
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

test("clearing history preserves facts, review candidates, suppressions and selected retention", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-p2-91a-clear-isolation-"));

  try {
    const history = createHistoryStore({ userDataPath });
    const memory = createMemoryStore({ userDataPath });
    const reviews = createMemoryReviewStore({ userDataPath });
    memory.setEnabled(true);
    const fact = memory.createCard({
      title: "手动事实",
      content: "用户喜欢紫色。",
      tags: ["偏好"],
      sourceConversationId: crypto.randomUUID()
    });
    assert.equal(fact.status, "created");
    const pending = reviews.enqueue(reviewDraft("pending-clear-isolation"));
    const suppressionCandidate = reviews.enqueue(reviewDraft("suppression-clear-isolation"));
    assert.equal(memory.confirmReviewedCandidate(suppressionCandidate).status, "created");
    const automaticCard = memory.listCards().find((card) => card.sourceType !== "manual-chat");
    assert.ok(automaticCard);
    assert.equal(memory.forgetCard(automaticCard.id).status, "forgotten");
    assert.equal(history.setRetentionLimit(1_000), 1_000);
    const conversationId = crypto.randomUUID();
    const historyMessage = message("user", "待清除历史", 1_700_000_000_000);
    assert.equal(history.appendMessage(conversationId, historyMessage), true);
    assert.equal(history.saveSemanticSummary(conversationId, [historyMessage.id], "待清除安全摘要"), true);
    const cardsBefore = memory.listCards();
    const reviewsBefore = reviews.listCandidates();
    const suppressionsBefore = memory.listSuppressions();

    assert.equal(history.clearConversations(), true);
    assert.equal(history.listConversations().length, 0);
    assert.equal(history.getSemanticSummary(conversationId, [historyMessage.id]), null);
    assert.equal(history.getRetentionLimit(), 1_000);
    assert.deepEqual(memory.listCards(), cardsBefore);
    assert.deepEqual(reviews.listCandidates(), reviewsBefore);
    assert.deepEqual(memory.listSuppressions(), suppressionsBefore);
    assert.ok(reviews.getCandidate(pending.id));
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
  assert.match(html, /历史原文和派生摘要，并重置当前会话；不会清空事实卡、待复核候选或已忘记类型/);
});
