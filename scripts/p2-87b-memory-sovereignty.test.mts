import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createMemoryStore } = require("../dist/main/services/chat/memory-store.js") as typeof import("../src/main/services/chat/memory-store");
const { createMemoryReviewStore } = require("../dist/main/services/chat/memory-review-store.js") as typeof import("../src/main/services/chat/memory-review-store");
const { parseMemoryCardUpdate, parseMemoryStorage } = require("../dist/shared/chat-memory.js") as typeof import("../src/shared/chat-memory");

function createDraft() {
  return {
    title: "P287B private title",
    content: "P287B private content",
    tags: ["P287B-private-tag"],
    sourceConversationId: crypto.randomUUID()
  };
}

function createLiteralLegacyStorage(version: 1 | 2 | 3) {
  const now = 1_700_000_000_000;
  const v1 = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "P287B legacy title",
    content: "P287B legacy content",
    tags: ["P287B-legacy"],
    sourceConversationId: "22222222-2222-4222-8222-222222222222",
    createdAt: now,
    updatedAt: now,
    enabled: true
  };
  const v2 = {
    ...v1,
    sourceType: "manual-chat",
    namespace: "personal",
    key: "manual-11111111",
    lastInjectedAt: null,
    injectionCount: 0
  };
  const v3 = {
    ...v2,
    importance: "key",
    category: "manual",
    confidence: 1,
    sourceMessageId: null,
    observedCount: 1,
    lastObservedAt: now,
    compressionState: "raw"
  };
  return { version, enabled: true, cards: [version === 1 ? v1 : version === 2 ? v2 : v3] };
}

test("memory-off rejects manual creation at the store boundary without writing a card", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-p287b-"));

  try {
    const store = createMemoryStore({ userDataPath });
    const result = store.createCard(createDraft());

    assert.deepEqual(result, { status: "disabled" });
    assert.equal(store.listCards().length, 0);
    assert.equal(store.createInjection().count, 0);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("user-maintained automatic cards retain their content, classification, and disabled state", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-p287b-"));

  try {
    const store = createMemoryStore({ userDataPath });
    store.setEnabled(true);
    const legacyCapture = store.captureAutoMemoriesFromLatestUserMessage({
      conversationId: crypto.randomUUID(), messageId: crypto.randomUUID(), content: "请用简体中文回复我"
    });
    assert.equal(legacyCapture.skippedReason, "no_candidate");
    assert.equal(legacyCapture.capturedCount, 0);
    assert.equal(store.listCards().length, 0);
    const created = store.createCard(createDraft());
    assert.equal(created.status, "created");
    const memoryPath = join(userDataPath, "memory", "facts.json");
    const persisted = JSON.parse(await readFile(memoryPath, "utf8"));
    Object.assign(persisted.cards[0], {
      sourceType: "auto-local-heuristic",
      namespace: "personal",
      key: "language-preference",
      category: "language",
      managedByUser: false
    });
    await writeFile(memoryPath, `${JSON.stringify(persisted)}\n`, "utf8");
    const legacyStore = createMemoryStore({ userDataPath });
    const card = legacyStore.listCards()[0];
    assert.equal(card?.sourceType, "auto-local-heuristic");
    assert.equal(card?.managedByUser, false);
    assert.ok(card);

    const updated = legacyStore.updateCard(card.id, {
      title: "P287B user maintained title",
      content: "P287B user maintained content",
      tags: ["P287B-user"],
      importance: "general",
      enabled: false
    });
    assert.equal(updated?.managedByUser, true);
    const userManagedUpdatedAt = updated?.updatedAt;
    const userManagedCompressionState = updated?.compressionState;

    const reviews = createMemoryReviewStore({ userDataPath });
    const candidate = reviews.enqueue({
      action: "create",
      title: "P287B pending replacement",
      content: "P287B pending replacement content",
      tags: ["P287B-review"],
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    assert.equal(candidate.status, "pending-review");
    assert.deepEqual(legacyStore.confirmReviewedCandidate(candidate), { status: "blocked" });
    const protectedCard = legacyStore.getCard(card.id);

    assert.equal(protectedCard?.title, "P287B user maintained title");
    assert.equal(protectedCard?.content, "P287B user maintained content");
    assert.deepEqual(protectedCard?.tags, ["P287B-user"]);
    assert.equal(protectedCard?.importance, "general");
    assert.equal(protectedCard?.enabled, false);
    assert.equal(protectedCard?.observedCount, 1);
    assert.equal(protectedCard?.updatedAt, userManagedUpdatedAt);
    assert.equal(protectedCard?.compressionState, userManagedCompressionState);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("empty and unknown-only updates cannot claim ownership or change card state", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-p287b-"));

  try {
    const store = createMemoryStore({ userDataPath });
    store.setEnabled(true);
    const created = store.createCard(createDraft());
    assert.equal(created.status, "created");
    const memoryPath = join(userDataPath, "memory", "facts.json");
    const persisted = JSON.parse(await readFile(memoryPath, "utf8"));
    Object.assign(persisted.cards[0], { sourceType: "auto-local-heuristic", managedByUser: false });
    await writeFile(memoryPath, `${JSON.stringify(persisted)}\n`, "utf8");
    const legacyStore = createMemoryStore({ userDataPath });
    const before = legacyStore.listCards()[0];
    assert.ok(before);
    assert.equal(before.managedByUser, false);

    assert.equal(parseMemoryCardUpdate({}), null);
    assert.equal(parseMemoryCardUpdate({ unknown: true }), null);
    assert.equal(legacyStore.updateCard(before.id, {}), null);
    assert.equal(legacyStore.updateCard(before.id, { unknown: true } as never), null);
    assert.deepEqual(legacyStore.getCard(before.id), before);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("delete permits recapture while forget blocks recapture until the saved type is allowed again", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-p287b-"));

  try {
    const store = createMemoryStore({ userDataPath });
    store.setEnabled(true);
    const reviews = createMemoryReviewStore({ userDataPath });
    const enqueue = () => reviews.enqueue({
      action: "create",
      title: "P287B review candidate",
      content: "P287B review candidate content",
      tags: ["P287B-review"],
      namespace: "personal",
      key: "language-preference",
      importance: "key",
      category: "language",
      confidence: 0.91,
      sourceConversationId: crypto.randomUUID(),
      sourceMessageId: crypto.randomUUID()
    });
    const firstCandidate = enqueue();
    assert.equal(firstCandidate.status, "pending-review");
    assert.deepEqual(store.confirmReviewedCandidate(firstCandidate), { status: "created" });
    const first = store.listCards()[0];
    assert.ok(first);
    assert.equal(first.sourceType, "auto-local-model");
    assert.equal(store.deleteCard(first.id), true);
    assert.deepEqual(store.confirmReviewedCandidate(enqueue()), { status: "created" });

    const second = store.listCards()[0];
    assert.ok(second);
    const forgotten = store.forgetCard(second.id);
    assert.equal(forgotten.status, "forgotten");
    assert.deepEqual(Object.keys(forgotten), ["status"]);
    assert.equal(store.listCards().length, 0);
    const restarted = createMemoryStore({ userDataPath });
    const restartedReviews = createMemoryReviewStore({ userDataPath });
    const blockedCandidate = restartedReviews.enqueue({
      action: "create", title: "P287B review candidate", content: "P287B review candidate content", tags: ["P287B-review"],
      namespace: "personal", key: "language-preference", importance: "key", category: "language", confidence: 0.91,
      sourceConversationId: crypto.randomUUID(), sourceMessageId: crypto.randomUUID()
    });
    assert.deepEqual(restarted.confirmReviewedCandidate(blockedCandidate), { status: "blocked" });

    const suppressions = restarted.listSuppressions();
    assert.equal(suppressions.length, 1);
    assert.deepEqual(Object.keys(suppressions[0] ?? {}).sort(), ["category", "createdAt", "id"]);
    assert.match(suppressions[0]?.id ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(JSON.stringify(suppressions).includes("P287B"), false);

    assert.equal(restarted.allowSuppression(suppressions[0]!.id), true);
    assert.equal(restarted.allowSuppression(suppressions[0]!.id), false);
    assert.deepEqual(restarted.confirmReviewedCandidate(restartedReviews.enqueue({
      action: "create", title: "P287B review candidate", content: "P287B review candidate content", tags: ["P287B-review"],
      namespace: "personal", key: "language-preference", importance: "key", category: "language", confidence: 0.91,
      sourceConversationId: crypto.randomUUID(), sourceMessageId: crypto.randomUUID()
    })), { status: "created" });
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("storage rejects suppressions with content-shaped or non-finite data", () => {
  const storage = {
    version: 4,
    enabled: false,
    cards: [],
    suppressions: [{
      namespace: "preference",
      key: "language:reply",
      category: "language",
      createdAt: Date.now()
    }]
  };
  assert.ok(parseMemoryStorage(storage));
  assert.equal(parseMemoryStorage({
    ...storage,
    suppressions: [{ ...storage.suppressions[0], content: "private text" }]
  }), null);
  assert.equal(parseMemoryStorage({
    ...storage,
    suppressions: [{ ...storage.suppressions[0], createdAt: Number.POSITIVE_INFINITY }]
  }), null);
});

test("v4 cards fail closed while legacy cards may receive migration defaults", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-p287b-"));

  try {
    const store = createMemoryStore({ userDataPath });
    store.setEnabled(true);
    const created = store.createCard(createDraft());
    assert.equal(created.status, "created");
    const validCard = created.card;

    for (const patch of [
      { namespace: "invalid namespace" },
      { key: "invalid key" },
      { importance: "urgent" },
      { category: "invalid category" },
      { compressionState: "compressed" },
      { managedByUser: undefined }
    ]) {
      assert.equal(parseMemoryStorage({
        version: 4,
        enabled: true,
        cards: [{ ...validCard, ...patch }],
        suppressions: []
      }), null);
    }

    const migrated = parseMemoryStorage(createLiteralLegacyStorage(3));
    assert.equal(migrated?.cards[0]?.managedByUser, true);
    assert.equal(migrated?.cards[0]?.namespace, "personal");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("v1 through v3 cards migrate to v4 with separate empty suppressions", async () => {
  for (const version of [1, 2, 3]) {
    const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-memory-p287b-"));

    try {
      const memoryDirectory = join(userDataPath, "memory");
      const memoryPath = join(memoryDirectory, "facts.json");
      const raw = createLiteralLegacyStorage(version);
      const card = raw.cards[0] as Record<string, unknown>;
      assert.ok(parseMemoryStorage(raw));
      assert.equal(parseMemoryStorage({ ...raw, cards: [{ ...card, managedByUser: true }] }), null);
      const { id: _id, ...missingId } = card;
      assert.equal(parseMemoryStorage({ ...raw, cards: [missingId] }), null);
      await mkdir(memoryDirectory, { recursive: true });
      await writeFile(memoryPath, `${JSON.stringify(raw)}\n`, "utf8");

      const migrated = createMemoryStore({ userDataPath });
      assert.equal(migrated.listCards()[0]?.managedByUser, true);
      const persisted = JSON.parse(await readFile(memoryPath, "utf8"));
      assert.equal(persisted.version, 4);
      assert.deepEqual(persisted.suppressions, []);
      assert.ok(parseMemoryStorage(persisted));
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  }
});

test("memory preload keeps the disabled create result closed and rejects forged suppressions", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  const invoked: unknown[][] = [];
  const suppressionId = crypto.randomUUID();
  let memoryApi: {
    createCard(draft: ReturnType<typeof createDraft>): Promise<unknown>;
    setEnabled(value: unknown): Promise<unknown>;
    updateCard(id: string, value: unknown): Promise<unknown>;
    listSuppressions(): Promise<unknown[]>;
    allowSuppression(value: unknown): Promise<boolean>;
  } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "memoryApi") {
        memoryApi = value as typeof memoryApi;
      }
    }
  };
  const ipcRenderer = {
    invoke(...args: unknown[]) {
      invoked.push(args);
      if (args[0] === "memory:create") {
        return Promise.resolve({ status: "disabled" });
      }
      if (args[0] === "memory:list-suppressions") {
        return Promise.resolve([{ id: suppressionId, category: "language", createdAt: Date.now() }]);
      }
      return Promise.resolve(args[0] === "memory:allow-suppression" && args[1] === suppressionId);
    },
    on() {},
    removeListener() {}
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", preload)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );

  assert.ok(memoryApi);
  assert.deepEqual(await memoryApi.createCard(createDraft()), { status: "disabled" });
  await assert.rejects(memoryApi.setEnabled("enabled"), /Invalid memory enabled value/);
  assert.equal(invoked.some(([channel]) => channel === "memory:set-enabled"), false);
  const updateId = crypto.randomUUID();
  assert.equal(await memoryApi.updateCard(updateId, {}), null);
  assert.equal(await memoryApi.updateCard(updateId, { unknown: true }), null);
  assert.equal(invoked.some(([channel]) => channel === "memory:update"), false);
  const suppressions = await memoryApi.listSuppressions();
  assert.deepEqual(Object.keys(suppressions[0] ?? {}).sort(), ["category", "createdAt", "id"]);
  assert.equal(await memoryApi.allowSuppression(suppressionId), true);
  assert.deepEqual(invoked.find(([channel]) => channel === "memory:allow-suppression"), [
    "memory:allow-suppression",
    suppressionId
  ]);
  assert.equal(await memoryApi.allowSuppression({
    namespace: "preference",
    key: "language:reply",
    category: "language",
    createdAt: Date.now(),
    content: "forged private text"
  }), false);
  assert.equal(invoked.filter(([channel]) => channel === "memory:allow-suppression").length, 1);
});
