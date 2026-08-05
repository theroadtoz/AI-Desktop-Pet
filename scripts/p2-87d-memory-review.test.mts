import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { toPersistentTelemetryEvent } from "../src/shared/telemetry-contract.ts";

const require = createRequire(import.meta.url);
const { createMemoryReviewStore } = require("../dist/main/services/chat/memory-review-store.js") as typeof import("../src/main/services/chat/memory-review-store");
const { createMemoryStore } = require("../dist/main/services/chat/memory-store.js") as typeof import("../src/main/services/chat/memory-store");

test("pending review candidates stay outside injectable memory cards", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-review-"));

  try {
    const store = createMemoryReviewStore({ userDataPath });
    const candidate = store.enqueue({
      action: "create",
      title: "称呼偏好",
      content: "用户希望被称呼为小夏。",
      tags: ["称呼"],
      namespace: "personal",
      key: "addressing-preference",
      importance: "key",
      category: "addressing",
      confidence: 0.92,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });

    assert.equal(candidate.status, "pending-review");
    assert.equal(store.listCandidates().length, 1);
    assert.equal(store.listCandidates()[0]?.content, "用户希望被称呼为小夏。");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("only a confirmed create candidate becomes an injectable local-model card", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-review-"));

  try {
    const reviews = createMemoryReviewStore({ userDataPath });
    const memories = createMemoryStore({ userDataPath });
    memories.setEnabled(true);
    const candidate = reviews.enqueue({
      action: "create",
      title: "语言偏好",
      content: "用户偏好简体中文回复。",
      tags: ["语言"],
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });

    assert.equal(memories.createInjection().count, 0);
    const result = memories.confirmReviewedCandidate(candidate);
    assert.equal(result.status, "created");
    assert.equal(reviews.setStatus(candidate.id, "confirmed")?.status, "confirmed");
    assert.equal(memories.createInjection().count, 1);
    assert.equal(memories.listCards()[0]?.sourceType, "auto-local-model");
    assert.equal(memories.listCards()[0]?.managedByUser, true);

    const conflicting = reviews.enqueue({
      action: "create",
      title: "不同的语言偏好",
      content: "用户偏好英文回复。",
      tags: ["语言"],
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    assert.deepEqual(memories.confirmReviewedCandidate(conflicting), { status: "blocked" });
    assert.equal(memories.listCards().length, 1);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("an edited sensitive candidate cannot become an injectable card", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-review-"));

  try {
    const reviews = createMemoryReviewStore({ userDataPath });
    const memories = createMemoryStore({ userDataPath });
    memories.setEnabled(true);
    const candidate = reviews.enqueue({
      action: "create",
      title: "语言偏好",
      content: "用户偏好简体中文回复。",
      tags: ["语言"],
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    const edited = reviews.updatePendingCandidate(candidate.id, { content: "敏感密钥 sk-p287d-edited-secret" });

    assert.equal(edited, null);
    assert.equal(memories.listCards().length, 0);
    assert.equal(memories.createInjection().count, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("update and revoke suggestions remain reviewable without changing cards", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-review-"));

  try {
    const reviews = createMemoryReviewStore({ userDataPath });
    const memories = createMemoryStore({ userDataPath });
    memories.setEnabled(true);

    for (const action of ["update-suggestion", "revoke-suggestion"] as const) {
      const candidate = reviews.enqueue({
        action,
        title: "语言偏好建议",
        content: "用户修正了一项语言偏好。",
        tags: ["语言"],
        namespace: "personal",
        key: "language-preference",
        importance: "key",
        category: "language",
        confidence: 0.91,
        sourceConversationId: crypto.randomUUID(),
        sourceMessageId: crypto.randomUUID()
      });
      const edited = reviews.updatePendingCandidate(candidate.id, { title: "已编辑的复核建议" });

      assert.equal(edited?.status, "pending-review");
      assert.equal(edited?.title, "已编辑的复核建议");
      assert.equal(reviews.setStatus(candidate.id, "confirmed")?.status, "confirmed");
    }

    assert.equal(memories.listCards().length, 0);
    assert.equal(memories.createInjection().count, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("suppressed and conflicting keys transition create suggestions to blocked without overwriting", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-review-"));

  try {
    const reviews = createMemoryReviewStore({ userDataPath });
    const memories = createMemoryStore({ userDataPath });
    memories.setEnabled(true);
    const storage = JSON.parse(await readFile(memories.getMemoryPath(), "utf8"));
    const now = Date.now();
    storage.cards.push({
      id: crypto.randomUUID(),
      title: "自动语言偏好",
      content: "用户偏好简体中文回复。",
      tags: ["语言"],
      sourceConversationId: crypto.randomUUID(),
      sourceType: "auto-local-model",
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceMessageId: crypto.randomUUID(),
      observedCount: 1,
      lastObservedAt: now,
      compressionState: "raw",
      createdAt: now,
      updatedAt: now,
      enabled: true,
      managedByUser: false,
      lastInjectedAt: null,
      injectionCount: 0
    });
    await writeFile(memories.getMemoryPath(), JSON.stringify(storage), "utf8");
    assert.deepEqual(memories.forgetCard(storage.cards[0].id), { status: "forgotten" });

    const candidate = reviews.enqueue({
      action: "create",
      title: "冲突语言偏好",
      content: "用户偏好英文回复。",
      tags: ["语言"],
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });

    assert.deepEqual(memories.confirmReviewedCandidate(candidate), { status: "blocked" });
    assert.equal(reviews.setStatus(candidate.id, "blocked")?.status, "blocked");
    assert.equal(memories.listCards().length, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("memory capture telemetry uses the post-extraction safe summary only", async () => {
  const appSource = await readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8");
  const captureStart = appSource.indexOf("memoryStoreForRequest.captureAutoMemoriesFromLatestUserMessage({");
  const activityEnd = appSource.indexOf('event.sender.send("chat:memory-activity"', captureStart);
  const captureActivityFlow = appSource.slice(captureStart, activityEnd + 500);

  assert.match(captureActivityFlow, /captureAutoMemoriesFromLatestUserMessage\(\{[\s\S]*toChatMemoryActivityAutoCapture\(autoMemoryCapture\)[\s\S]*capturedCount: 1[\s\S]*event\.sender\.send\("chat:memory-activity"/u);
  assert.match(appSource, /logTelemetry\("memory_auto_capture"\);/u);
  assert.doesNotMatch(appSource, /logTelemetry\("memory_auto_capture"\s*,/u);
  assert.match(appSource, /logTelemetry\("memory_auto_capture_failed"\);/u);
  assert.doesNotMatch(appSource, /logTelemetry\("memory_auto_capture_failed"\s*,/u);

  assert.deepEqual(toPersistentTelemetryEvent("memory_auto_capture", {}), {
    type: "memory_auto_capture",
    payload: {}
  });
  assert.deepEqual(toPersistentTelemetryEvent("memory_auto_capture_failed", {}), {
    type: "memory_auto_capture_failed",
    payload: {}
  });
  assert.equal(toPersistentTelemetryEvent("memory_auto_capture", { enabled: true }), null);
  assert.equal(toPersistentTelemetryEvent("memory_auto_capture", { capturedCount: 1 }), null);
});
