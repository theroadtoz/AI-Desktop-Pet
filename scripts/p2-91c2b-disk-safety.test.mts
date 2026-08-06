import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const mutableFs = require("node:fs") as Record<string, unknown>;
const { parseMemoryStorage } = require("../dist/shared/chat-memory.js") as typeof import("../src/shared/chat-memory");
const { createMemoryStore } = require("../dist/main/services/chat/memory-store.js") as typeof import("../src/main/services/chat/memory-store");
const { createMemoryReviewStore, parseMemoryReviewStorage } = require("../dist/main/services/chat/memory-review-store.js") as typeof import("../src/main/services/chat/memory-review-store");

function v1Card() {
  const now = 1_700_000_000_000;
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "称呼",
    content: "用户希望被称为小夏。",
    tags: ["称呼"],
    sourceConversationId: "22222222-2222-4222-8222-222222222222",
    createdAt: now,
    updatedAt: now,
    enabled: true
  };
}

function v2Card() {
  return {
    ...v1Card(),
    sourceType: "manual-chat",
    namespace: "personal",
    key: "preferred-name",
    lastInjectedAt: null,
    injectionCount: 0
  };
}

function v3Card() {
  return {
    ...v2Card(),
    importance: "key",
    category: "addressing",
    confidence: 0.9,
    sourceMessageId: "33333333-3333-4333-8333-333333333333",
    observedCount: 1,
    lastObservedAt: 1_700_000_000_000,
    compressionState: "raw"
  };
}

function v4Card() {
  return { ...v3Card(), managedByUser: true };
}

function suppression() {
  return {
    namespace: "personal",
    key: "preferred-name",
    category: "addressing",
    createdAt: 1_700_000_000_000
  };
}

function factsStorage(version: 1 | 2 | 3 | 4): Record<string, unknown> {
  const card = version === 1 ? v1Card() : version === 2 ? v2Card() : version === 3 ? v3Card() : v4Card();
  return version === 4
    ? { version, enabled: true, cards: [card], suppressions: [suppression()] }
    : { version, enabled: true, cards: [card] };
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function assertRejectsObjectStructure(
  label: string,
  value: Record<string, unknown>,
  parse: (candidate: Record<string, unknown>) => unknown
): void {
  assert.equal(parse({ ...value, unexpected: true }), null, `${label}:extra`);
  assert.equal(parse(Object.assign(Object.create({ polluted: true }), value)), null, `${label}:custom-prototype`);
  assert.equal(parse(Object.assign(Object.create(null), value)), null, `${label}:null-prototype`);
  assert.equal(parse({ ...value, [Symbol(label)]: true }), null, `${label}:symbol`);

  const descriptorKey = Object.keys(value)[0]!;
  const hidden = { ...value };
  Object.defineProperty(hidden, descriptorKey, { value: value[descriptorKey], enumerable: false, configurable: true, writable: true });
  assert.equal(parse(hidden), null, `${label}:non-enumerable`);

  let getterCalls = 0;
  const accessor = { ...value };
  Object.defineProperty(accessor, descriptorKey, {
    enumerable: true,
    configurable: true,
    get: () => {
      getterCalls += 1;
      return value[descriptorKey];
    }
  });
  assert.equal(parse(accessor), null, `${label}:accessor`);
  assert.equal(getterCalls, 0, `${label}:getter-zero`);
}

function assertRejectsArrayStructure(label: string, value: unknown[], parse: (candidate: unknown[]) => unknown): void {
  const sparse = [...value];
  sparse.length += 1;
  assert.equal(parse(sparse), null, `${label}:hole`);

  const extra = [...value];
  Object.defineProperty(extra, "extra", { value: true, enumerable: true, configurable: true, writable: true });
  assert.equal(parse(extra), null, `${label}:extra-descriptor`);

  const customPrototype = [...value];
  Object.setPrototypeOf(customPrototype, []);
  assert.equal(parse(customPrototype), null, `${label}:custom-prototype`);
  const nullPrototype = [...value];
  Object.setPrototypeOf(nullPrototype, null);
  assert.equal(parse(nullPrototype), null, `${label}:null-prototype`);
  assert.equal(parse(Object.assign([...value], { [Symbol(label)]: true })), null, `${label}:symbol`);

  if (value.length > 0) {
    const hidden = [...value];
    Object.defineProperty(hidden, "0", { value: value[0], enumerable: false, configurable: true, writable: true });
    assert.equal(parse(hidden), null, `${label}:non-enumerable-index`);
    let getterCalls = 0;
    const accessor = [...value];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return value[0];
      }
    });
    assert.equal(parse(accessor), null, `${label}:accessor-index`);
    assert.equal(getterCalls, 0, `${label}:getter-zero`);
  }
}

function withJsonParseValue<T>(value: unknown, run: () => T): T {
  const originalParse = JSON.parse;
  JSON.parse = (() => value) as typeof JSON.parse;
  try {
    return run();
  } finally {
    JSON.parse = originalParse;
  }
}

async function assertNoTransientArtifacts(directory: string, label: string): Promise<void> {
  const entries = existsSync(directory) ? await readdir(directory) : [];
  assert.deepEqual(entries.filter((name) => /(?:\.tmp$|\.bak$|partial)/u.test(name)), [], `${label}:transient-artifacts`);
}

function reviewCandidate() {
  const now = 1_700_000_000_000;
  return {
    action: "create", category: "addressing", confidence: 0.9, content: "用户希望被称为小夏。", createdAt: now,
    id: "44444444-4444-4444-8444-444444444444", importance: "key", key: "preferred-name", namespace: "personal",
    sourceConversationId: "22222222-2222-4222-8222-222222222222", sourceMessageId: "33333333-3333-4333-8333-333333333333",
    status: "pending-review", tags: ["称呼"], title: "称呼", updatedAt: now
  };
}

test("C2B facts v1-v4 reject every missing field and non-plain descriptor shape", () => {
  for (const version of [1, 2, 3, 4] as const) {
    const storage = factsStorage(version);
    assert.ok(parseMemoryStorage(storage), `v${version}:positive`);

    for (const key of Object.keys(storage)) {
      assert.equal(parseMemoryStorage(withoutKey(storage, key)), null, `v${version}:root-missing:${key}`);
    }
    assertRejectsObjectStructure(`v${version}:root`, storage, parseMemoryStorage);

    const card = (storage.cards as Array<Record<string, unknown>>)[0]!;
    for (const key of Object.keys(card)) {
      assert.equal(parseMemoryStorage({ ...storage, cards: [withoutKey(card, key)] }), null, `v${version}:card-missing:${key}`);
    }
    assertRejectsObjectStructure(`v${version}:card`, card, (candidate) => parseMemoryStorage({ ...storage, cards: [candidate] }));
    assertRejectsArrayStructure(`v${version}:cards`, storage.cards as unknown[], (cards) => parseMemoryStorage({ ...storage, cards }));
    assertRejectsArrayStructure(`v${version}:tags`, card.tags as unknown[], (tags) => parseMemoryStorage({ ...storage, cards: [{ ...card, tags }] }));
  }

  assert.equal(parseMemoryStorage({ ...factsStorage(1), cards: [{ ...v1Card(), sourceType: "manual-chat" }] }), null, "v1:future-field");
  assert.equal(parseMemoryStorage({ ...factsStorage(2), cards: [{ ...v2Card(), importance: "key" }] }), null, "v2:future-field");
  assert.equal(parseMemoryStorage({ ...factsStorage(3), cards: [{ ...v3Card(), managedByUser: true }] }), null, "v3:future-field");
});

test("C2B facts v1-v3 preserve owned values and apply only the exact later defaults", () => {
  const v1 = v1Card();
  const projectedV1 = parseMemoryStorage({ version: 1, enabled: true, cards: [v1] });
  assert.ok(projectedV1);
  assert.deepEqual(projectedV1.cards[0], {
    ...v1,
    sourceType: "manual-chat",
    namespace: "personal",
    key: "manual-11111111",
    importance: "key",
    category: "manual",
    confidence: 1,
    sourceMessageId: null,
    observedCount: 1,
    lastObservedAt: v1.updatedAt,
    compressionState: "raw",
    managedByUser: true,
    lastInjectedAt: null,
    injectionCount: 0
  });
  assert.deepEqual(projectedV1.suppressions, []);

  const v2 = {
    ...v2Card(),
    namespace: "preferences",
    key: "language:reply",
    lastInjectedAt: 1_700_000_000_123,
    injectionCount: 7
  };
  const projectedV2 = parseMemoryStorage({ version: 2, enabled: false, cards: [v2] });
  assert.ok(projectedV2);
  assert.deepEqual(projectedV2.cards[0], {
    ...v2,
    importance: "key",
    category: "manual",
    confidence: 1,
    sourceMessageId: null,
    observedCount: 1,
    lastObservedAt: v2.updatedAt,
    compressionState: "raw",
    managedByUser: true
  });
  assert.equal(projectedV2.enabled, false);
  assert.deepEqual(projectedV2.suppressions, []);

  const v3 = {
    ...v3Card(),
    sourceType: "auto-local-model",
    namespace: "preferences",
    key: "language:reply",
    importance: "general",
    category: "language",
    confidence: 0.91,
    observedCount: 4,
    lastObservedAt: 1_700_000_000_234,
    compressionState: "merged",
    lastInjectedAt: 1_700_000_000_345,
    injectionCount: 9
  };
  const projectedV3 = parseMemoryStorage({ version: 3, enabled: true, cards: [v3] });
  assert.ok(projectedV3);
  assert.deepEqual(projectedV3.cards[0], { ...v3, managedByUser: false });
  assert.deepEqual(projectedV3.suppressions, []);
});

test("C2B facts v4 suppression and persisted scalars must already be canonical", () => {
  const storage = factsStorage(4);
  const item = suppression();
  for (const key of Object.keys(item)) {
    assert.equal(parseMemoryStorage({ ...storage, suppressions: [withoutKey(item, key)] }), null, `suppression-missing:${key}`);
  }
  assertRejectsObjectStructure("suppression", item, (candidate) => parseMemoryStorage({ ...storage, suppressions: [candidate] }));
  assertRejectsArrayStructure("suppressions", storage.suppressions as unknown[], (suppressions) => parseMemoryStorage({ ...storage, suppressions }));

  const card = v4Card();
  for (const [field, value] of [
    ["title", " 称呼"],
    ["content", "用户  希望被称为小夏。"],
    ["tags", [" 称呼"]],
    ["namespace", "Personal"],
    ["key", "Preferred-Name"],
    ["category", "Addressing"],
    ["confidence", 0.901],
    ["injectionCount", Number.NaN],
    ["observedCount", Number.POSITIVE_INFINITY]
  ] as const) {
    assert.equal(parseMemoryStorage({ ...storage, cards: [{ ...card, [field]: value }] }), null, `card-noncanonical:${field}`);
  }
});

test("C2B review v1 rejects every missing field, non-plain shape, and non-canonical scalar", () => {
  const storage = { version: 1, candidates: [reviewCandidate()] };
  for (const key of Object.keys(storage)) {
    assert.equal(parseMemoryReviewStorage(withoutKey(storage, key)), null, `review-root-missing:${key}`);
  }
  assertRejectsObjectStructure("review-root", storage, parseMemoryReviewStorage);
  assertRejectsArrayStructure("review-candidates", storage.candidates, (candidates) => parseMemoryReviewStorage({ ...storage, candidates }));

  const candidate = reviewCandidate();
  for (const key of Object.keys(candidate)) {
    assert.equal(parseMemoryReviewStorage({ ...storage, candidates: [withoutKey(candidate, key)] }), null, `candidate-missing:${key}`);
  }
  assertRejectsObjectStructure("review-candidate", candidate, (value) => parseMemoryReviewStorage({ ...storage, candidates: [value] }));
  assertRejectsArrayStructure("review-tags", candidate.tags, (tags) => parseMemoryReviewStorage({ ...storage, candidates: [{ ...candidate, tags }] }));

  for (const [field, value] of [
    ["action", "ignore"],
    ["status", "future"],
    ["importance", "urgent"],
    ["title", " 称呼"],
    ["content", "用户  希望被称为小夏。"],
    ["tags", [" 称呼"]],
    ["namespace", "Personal"],
    ["key", "Preferred-Name"],
    ["category", "Addressing"],
    ["confidence", 0.901],
    ["createdAt", Number.NaN],
    ["updatedAt", Number.POSITIVE_INFINITY]
  ] as const) {
    assert.equal(parseMemoryReviewStorage({ ...storage, candidates: [{ ...candidate, [field]: value }] }), null, `candidate-noncanonical:${field}`);
  }
  assert.equal(parseMemoryReviewStorage({ ...storage, candidates: [{ ...candidate, updatedAt: candidate.createdAt - 1 }] }), null, "candidate-time-order");
  assert.equal(parseMemoryReviewStorage({ version: 2, candidates: [] }), null, "review-future-version");
});

test("C2B canWrite is side-effect free and sensitive facts stay empty and immutable", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-facts-"));
  try {
    const missing = createMemoryStore({ userDataPath });
    assert.equal(missing.canWrite(), true);
    assert.equal(missing.canWrite(), true);
    assert.equal(existsSync(join(userDataPath, "memory")), false);

    missing.setEnabled(true);
    const created = missing.createCard({
      title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"],
      sourceConversationId: "22222222-2222-4222-8222-222222222222"
    });
    assert.equal(created.status, "created");
    const memoryPath = missing.getMemoryPath();
    const raw = JSON.parse(await readFile(memoryPath, "utf8"));
    raw.cards[0].content = "api key: private-value";
    await writeFile(memoryPath, `${JSON.stringify(raw)}\n`, "utf8");
    const before = await readFile(memoryPath);
    const beforeMtime = (await stat(memoryPath)).mtimeMs;

    const unsafe = createMemoryStore({ userDataPath });
    assert.equal(unsafe.canWrite(), false);
    assert.equal(unsafe.listCards().length, 0);
    assert.deepEqual(unsafe.createInjection(), { count: 0, cards: [] });
    assert.throws(() => unsafe.setEnabled(false), /Memory storage unavailable/);
    assert.equal((await readFile(memoryPath)).equals(before), true);
    assert.equal((await stat(memoryPath)).mtimeMs, beforeMtime);
    assert.deepEqual(await readdir(join(userDataPath, "memory")), ["facts.json"]);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B unsafe review files do not prune or overwrite their source", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-reviews-"));
  try {
    const reviews = createMemoryReviewStore({ userDataPath });
    reviews.enqueue({
      action: "create", title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"], namespace: "personal", key: "preferred-name",
      importance: "key", category: "addressing", confidence: 0.9,
      sourceConversationId: "22222222-2222-4222-8222-222222222222", sourceMessageId: "33333333-3333-4333-8333-333333333333"
    });
    const reviewPath = reviews.getReviewPath();
    const raw = JSON.parse(await readFile(reviewPath, "utf8"));
    raw.candidates[0].title = "api key: private-value";
    await writeFile(reviewPath, `${JSON.stringify(raw)}\n`, "utf8");
    const before = await readFile(reviewPath);
    const beforeMtime = (await stat(reviewPath)).mtimeMs;

    const unsafe = createMemoryReviewStore({ userDataPath });
    assert.equal(unsafe.canWrite(), false);
    assert.throws(() => unsafe.listCandidates(), /Memory review storage unavailable/);
    assert.throws(() => unsafe.getCandidate("not-an-id"), /Memory review storage unavailable/);
    assert.throws(() => unsafe.clearPendingCandidates(), /Memory review storage unavailable/);
    assert.equal((await readFile(reviewPath)).equals(before), true);
    assert.equal((await stat(reviewPath)).mtimeMs, beforeMtime);
    assert.deepEqual(await readdir(join(userDataPath, "memory")), ["reviews.json"]);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B invalid and future disk sources remain unreadable and unwriteable", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-states-"));
  try {
    const memoryDirectory = join(userDataPath, "memory");
    await mkdir(memoryDirectory, { recursive: true });
    const factsPath = join(memoryDirectory, "facts.json");
    await writeFile(factsPath, "{\"version\":5}", "utf8");
    const factsBefore = await readFile(factsPath);
    const futureFacts = createMemoryStore({ userDataPath });
    assert.equal(futureFacts.canWrite(), false);
    assert.equal(futureFacts.getSummary().totalCards, 0);
    assert.equal((await readFile(factsPath)).equals(factsBefore), true);

    const reviewsPath = join(memoryDirectory, "reviews.json");
    await writeFile(reviewsPath, "{\"version\":1,\"candidates\":[{\"extra\":true}]}", "utf8");
    const reviewsBefore = await readFile(reviewsPath);
    const invalidReviews = createMemoryReviewStore({ userDataPath });
    assert.equal(invalidReviews.canWrite(), false);
    assert.throws(() => invalidReviews.listCandidates(), /Memory review storage unavailable/);
    assert.equal((await readFile(reviewsPath)).equals(reviewsBefore), true);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B canWrite is twice side-effect free for every disk source state", async () => {
  const cases: Array<{ name: string; setup(root: string): Promise<void>; expected: boolean }> = [
    { name: "missing", setup: async () => {}, expected: true },
    { name: "current", setup: async (root) => { const store = createMemoryStore({ userDataPath: root }); store.setEnabled(false); }, expected: true },
    { name: "legacy", setup: async (root) => { await mkdir(join(root, "memory"), { recursive: true }); await writeFile(join(root, "memory", "facts.json"), JSON.stringify({ version: 1, enabled: false, cards: [] }), "utf8"); }, expected: true },
    { name: "invalid", setup: async (root) => { await mkdir(join(root, "memory"), { recursive: true }); await writeFile(join(root, "memory", "facts.json"), "{", "utf8"); }, expected: false },
    { name: "future", setup: async (root) => { await mkdir(join(root, "memory"), { recursive: true }); await writeFile(join(root, "memory", "facts.json"), "{\"version\":5}", "utf8"); }, expected: false },
    { name: "sensitive", setup: async (root) => { const store = createMemoryStore({ userDataPath: root }); store.setEnabled(true); const created = store.createCard({ title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"], sourceConversationId: "22222222-2222-4222-8222-222222222222" }); if (created.status !== "created") throw new Error("fixture"); const raw = JSON.parse(await readFile(store.getMemoryPath(), "utf8")); raw.cards[0].content = "api key: private-value"; await writeFile(store.getMemoryPath(), JSON.stringify(raw), "utf8"); }, expected: false },
    { name: "unsafe-profile", setup: async (root) => { await mkdir(join(root, "config"), { recursive: true }); await writeFile(join(root, "config", "user-profile.json"), "{", "utf8"); }, expected: false }
  ];
  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), `desktop-pet-c2b-${item.name}-`));
    try {
      await item.setup(root);
      const directory = join(root, "memory");
      const path = join(directory, "facts.json");
      const configDirectory = join(root, "config");
      const profilePath = join(configDirectory, "user-profile.json");
      const before = existsSync(path) ? await readFile(path) : null;
      const beforeMtime = before ? (await stat(path, { bigint: true })).mtimeNs : null;
      const beforeDirectory = existsSync(directory) ? await readdir(directory) : [];
      const beforeProfile = existsSync(profilePath) ? await readFile(profilePath) : null;
      const beforeProfileMtime = beforeProfile ? (await stat(profilePath, { bigint: true })).mtimeNs : null;
      const beforeConfigDirectory = existsSync(configDirectory) ? await readdir(configDirectory) : [];
      const store = createMemoryStore({ userDataPath: root });
      assert.equal(store.canWrite(), item.expected, item.name);
      assert.equal(store.canWrite(), item.expected, item.name);
      assert.equal(existsSync(path), before !== null, item.name);
      if (before) {
        assert.equal((await readFile(path)).equals(before), true, item.name);
        assert.equal((await stat(path, { bigint: true })).mtimeNs, beforeMtime, item.name);
      }
      assert.deepEqual(existsSync(directory) ? await readdir(directory) : [], beforeDirectory, item.name);
      assert.deepEqual((existsSync(directory) ? await readdir(directory) : []).filter((name) => /(?:\.tmp$|\.bak$)/u.test(name)), [], item.name);
      assert.equal(existsSync(profilePath), beforeProfile !== null, `${item.name}:profile-exists`);
      if (beforeProfile) {
        assert.equal((await readFile(profilePath)).equals(beforeProfile), true, `${item.name}:profile-bytes`);
        assert.equal((await stat(profilePath, { bigint: true })).mtimeNs, beforeProfileMtime, `${item.name}:profile-mtimeNs`);
      }
      assert.deepEqual(existsSync(configDirectory) ? await readdir(configDirectory) : [], beforeConfigDirectory, `${item.name}:config-directory`);
      await assertNoTransientArtifacts(configDirectory, `${item.name}:config`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("C2B review canWrite is twice side-effect free for every expressible source state", async () => {
  const cases: Array<{ name: string; expected: boolean; expectedCount?: number; source?: unknown }> = [
    { name: "missing", expected: true, expectedCount: 0 },
    { name: "current", expected: true, expectedCount: 1, source: { version: 1, candidates: [{ ...reviewCandidate(), status: "confirmed" }] } },
    { name: "invalid", expected: false, source: "{" },
    { name: "future", expected: false, source: { version: 2, candidates: [] } },
    { name: "sensitive", expected: false, source: { version: 1, candidates: [{ ...reviewCandidate(), status: "confirmed", title: "api-key-private-marker" }] } }
  ];
  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), `desktop-pet-c2b-review-${item.name}-`));
    try {
      const directory = join(root, "memory");
      const path = join(directory, "reviews.json");
      if (item.source !== undefined) {
        await mkdir(directory, { recursive: true });
        await writeFile(path, typeof item.source === "string" ? item.source : JSON.stringify(item.source), "utf8");
      }
      const before = existsSync(path) ? await readFile(path) : null;
      const beforeMtime = before ? (await stat(path, { bigint: true })).mtimeNs : null;
      const beforeDirectory = existsSync(directory) ? await readdir(directory) : [];
      const reviews = createMemoryReviewStore({ userDataPath: root });
      assert.equal(reviews.canWrite(), item.expected, `${item.name}:first`);
      assert.equal(reviews.canWrite(), item.expected, `${item.name}:second`);
      if (item.expected) {
        assert.equal(reviews.listCandidates().length, item.expectedCount, `${item.name}:projection`);
      } else {
        assert.throws(() => reviews.listCandidates(), /Memory review storage unavailable/, `${item.name}:projection`);
      }
      assert.equal(existsSync(path), before !== null, `${item.name}:exists`);
      if (before) {
        assert.equal((await readFile(path)).equals(before), true, `${item.name}:bytes`);
        assert.equal((await stat(path, { bigint: true })).mtimeNs, beforeMtime, `${item.name}:mtimeNs`);
      }
      assert.deepEqual(existsSync(directory) ? await readdir(directory) : [], beforeDirectory, `${item.name}:directory`);
      await assertNoTransientArtifacts(directory, item.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("C2B every persisted user-text position rejects the whole sensitive source without leakage", async () => {
  const marker = "api-key-private-marker";
  const cases: Array<{ name: string; relativePath: string; source: unknown; probe(root: string): unknown }> = [];
  for (const field of ["title", "content", "tags", "namespace", "key", "category"] as const) {
    const card = v4Card() as Record<string, unknown>;
    card[field] = field === "tags" ? [marker] : marker;
    cases.push({
      name: `fact-card:${field}`,
      relativePath: join("memory", "facts.json"),
      source: { ...factsStorage(4), cards: [card] },
      probe(root) {
        const store = createMemoryStore({ userDataPath: root });
        return [store.canWrite(), store.getSettings(), store.listCards(), store.listSuppressions(), store.createInjection()];
      }
    });

    const candidate = reviewCandidate() as Record<string, unknown>;
    candidate[field] = field === "tags" ? [marker] : marker;
    cases.push({
      name: `review-candidate:${field}`,
      relativePath: join("memory", "reviews.json"),
      source: { version: 1, candidates: [candidate] },
      probe(root) {
        const store = createMemoryReviewStore({ userDataPath: root });
        let errorText = "";
        try { store.listCandidates(); } catch (error) { errorText = error instanceof Error ? error.message : "non-error"; }
        return [store.canWrite(), errorText];
      }
    });
  }
  for (const field of ["namespace", "key", "category"] as const) {
    cases.push({
      name: `suppression:${field}`,
      relativePath: join("memory", "facts.json"),
      source: { ...factsStorage(4), suppressions: [{ ...suppression(), [field]: marker }] },
      probe(root) {
        const store = createMemoryStore({ userDataPath: root });
        return [store.canWrite(), store.getSettings(), store.listCards(), store.listSuppressions(), store.createInjection()];
      }
    });
  }
  for (const field of ["displayName", "preferredName"] as const) {
    cases.push({
      name: `profile:${field}`,
      relativePath: join("config", "user-profile.json"),
      source: { displayName: "小林", preferredName: "林林", completedAt: "2026-07-30", [field]: marker },
      probe(root) {
        const store = createMemoryStore({ userDataPath: root });
        return [store.canWrite(), store.getSettings(), store.listCards(), store.createInjection()];
      }
    });
  }

  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-sensitive-replay-"));
    try {
      const path = join(root, item.relativePath);
      const directory = join(path, "..");
      await mkdir(directory, { recursive: true });
      await writeFile(path, `${JSON.stringify(item.source)}\n`, "utf8");
      const before = await readFile(path);
      const beforeMtime = (await stat(path, { bigint: true })).mtimeNs;
      const beforeDirectory = await readdir(directory);
      const result = item.probe(root);
      assert.equal(Array.isArray(result) && result[0], false, `${item.name}:canWrite`);
      assert.equal(JSON.stringify(result).includes(marker), false, `${item.name}:no-leak`);
      assert.equal((await readFile(path)).equals(before), true, `${item.name}:bytes`);
      assert.equal((await stat(path, { bigint: true })).mtimeNs, beforeMtime, `${item.name}:mtimeNs`);
      assert.deepEqual(await readdir(directory), beforeDirectory, `${item.name}:directory`);
      await assertNoTransientArtifacts(directory, item.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("C2B review enqueue and fact confirmation reject every sensitive writable text position", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-sensitive-write-"));
  try {
    const facts = createMemoryStore({ userDataPath });
    facts.setEnabled(true);
    const reviews = createMemoryReviewStore({ userDataPath });
    const factPath = facts.getMemoryPath();
    const reviewPath = reviews.getReviewPath();
    const beforeFacts = await readFile(factPath);
    const marker = "api-key-private-marker";
    for (const field of ["title", "content", "tags", "namespace", "key", "category"] as const) {
      const draft = {
        action: "create" as const, title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"], namespace: "personal", key: "preferred-name",
        importance: "key" as const, category: "addressing", confidence: 0.9,
        sourceConversationId: "22222222-2222-4222-8222-222222222222", sourceMessageId: "33333333-3333-4333-8333-333333333333"
      };
      draft[field] = field === "tags" ? [marker] : marker;
      assert.throws(() => reviews.enqueue(draft), /Invalid memory review candidate/);
      assert.equal(existsSync(reviewPath), false);
      const candidate = { ...draft, id: "44444444-4444-4444-8444-444444444444", status: "pending-review" as const, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };
      assert.deepEqual(facts.confirmReviewedCandidate(candidate), { status: "blocked" });
      assert.equal((await readFile(factPath)).equals(beforeFacts), true);
      assert.equal(facts.canWrite(), true);
      assert.equal((await readFile(factPath, "utf8")).includes(marker), false, `${field}:no-leak`);
    }
    await assertNoTransientArtifacts(join(userDataPath, "memory"), "review-enqueue-confirm");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B review update and auto capture reject every sensitive writable text without persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-sensitive-update-ingress-"));
  try {
    const reviews = createMemoryReviewStore({ userDataPath: root });
    const candidate = reviews.enqueue({
      action: "create", title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"], namespace: "personal", key: "preferred-name",
      importance: "key", category: "addressing", confidence: 0.9,
      sourceConversationId: "22222222-2222-4222-8222-222222222222", sourceMessageId: "33333333-3333-4333-8333-333333333333"
    });
    const reviewPath = reviews.getReviewPath();
    const reviewBefore = await readFile(reviewPath);
    const reviewMtime = (await stat(reviewPath, { bigint: true })).mtimeNs;
    const marker = "api-key-private-marker";
    for (const [field, value] of [["title", marker], ["content", marker], ["tags", [marker]]] as const) {
      assert.equal(reviews.updatePendingCandidate(candidate.id, { [field]: value } as never), null, field);
      assert.equal((await readFile(reviewPath)).equals(reviewBefore), true, `${field}:bytes`);
      assert.equal((await stat(reviewPath, { bigint: true })).mtimeNs, reviewMtime, `${field}:mtimeNs`);
      assert.equal((await readFile(reviewPath, "utf8")).includes(marker), false, `${field}:no-leak`);
    }

    const facts = createMemoryStore({ userDataPath: root });
    facts.setEnabled(true);
    const factsPath = facts.getMemoryPath();
    const factsBefore = await readFile(factsPath);
    const factsMtime = (await stat(factsPath, { bigint: true })).mtimeNs;
    const capture = facts.captureAutoMemoriesFromLatestUserMessage({
      conversationId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      content: marker
    });
    assert.equal(capture.skippedReason, "sensitive");
    assert.equal(JSON.stringify(capture).includes(marker), false);
    assert.equal((await readFile(factsPath)).equals(factsBefore), true);
    assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, factsMtime);
    assert.equal((await readFile(factsPath, "utf8")).includes(marker), false);
    assert.deepEqual((await readdir(join(root, "memory"))).sort(), ["facts.json", "reviews.json"]);
    await assertNoTransientArtifacts(join(root, "memory"), "review-update-auto-capture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C2B manual fact creation rejects every sensitive writable text position before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-sensitive-manual-write-"));
  try {
    const facts = createMemoryStore({ userDataPath: root });
    facts.setEnabled(true);
    const factsPath = facts.getMemoryPath();
    const before = await readFile(factsPath);
    const beforeMtime = (await stat(factsPath, { bigint: true })).mtimeNs;
    const marker = "api-key-private-marker";
    for (const [field, value] of [["title", marker], ["content", marker], ["tags", [marker]]] as const) {
      const draft: Record<string, unknown> = {
        title: "称呼",
        content: "用户希望被称为小夏。",
        tags: ["称呼"],
        sourceConversationId: "22222222-2222-4222-8222-222222222222"
      };
      draft[field] = value;
      assert.throws(() => facts.createCard(draft as never), /Invalid memory draft/, field);
      assert.equal((await readFile(factsPath)).equals(before), true, `${field}:bytes`);
      assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, beforeMtime, `${field}:mtimeNs`);
      assert.equal((await readFile(factsPath, "utf8")).includes(marker), false, `${field}:no-leak`);
    }
    assert.deepEqual(await readdir(join(root, "memory")), ["facts.json"]);
    await assertNoTransientArtifacts(join(root, "memory"), "manual-sensitive-write");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C2B manual fact update rejects every sensitive writable text position before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-sensitive-manual-update-"));
  try {
    const facts = createMemoryStore({ userDataPath: root });
    facts.setEnabled(true);
    const created = facts.createCard({
      title: "称呼",
      content: "用户希望被称为小夏。",
      tags: ["称呼"],
      sourceConversationId: "22222222-2222-4222-8222-222222222222"
    });
    assert.equal(created.status, "created");
    const factsPath = facts.getMemoryPath();
    const before = await readFile(factsPath);
    const beforeMtime = (await stat(factsPath, { bigint: true })).mtimeNs;
    const marker = "api-key-private-marker";
    for (const [field, value] of [["title", marker], ["content", marker], ["tags", [marker]]] as const) {
      assert.equal(facts.updateCard(created.card.id, { [field]: value } as never), null, field);
      assert.equal((await readFile(factsPath)).equals(before), true, `${field}:bytes`);
      assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, beforeMtime, `${field}:mtimeNs`);
      assert.equal((await readFile(factsPath, "utf8")).includes(marker), false, `${field}:no-leak`);
    }
    assert.deepEqual(await readdir(join(root, "memory")), ["facts.json"]);
    await assertNoTransientArtifacts(join(root, "memory"), "manual-sensitive-update");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C2B rejects duplicate card, tag, suppression, and review candidate sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-duplicates-"));
  try {
    const facts = createMemoryStore({ userDataPath: root });
    facts.setEnabled(true);
    const created = facts.createCard({ title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"], sourceConversationId: "22222222-2222-4222-8222-222222222222" });
    assert.equal(created.status, "created");
    const raw = JSON.parse(await readFile(facts.getMemoryPath(), "utf8"));
    assert.equal(parseMemoryStorage({ ...raw, cards: [raw.cards[0], { ...raw.cards[0] }] }), null);
    assert.equal(parseMemoryStorage({ ...raw, cards: [{ ...raw.cards[0], tags: ["称呼", "称呼"] }] }), null);
    const suppression = { namespace: "personal", key: "preferred-name", category: "addressing", createdAt: 1_700_000_000_000 };
    assert.equal(parseMemoryStorage({ ...raw, suppressions: [suppression, { ...suppression }] }), null);
    const reviews = createMemoryReviewStore({ userDataPath: root });
    const candidate = reviewCandidate();
    assert.equal(parseMemoryReviewStorage({ version: 1, candidates: [candidate, { ...candidate }] }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C2B profile accepts legacy date forms but rejects invalid descriptors and dates", async () => {
  for (const completedAt of ["2026-07-30", "2026-07-30T08:00:00+08:00"]) {
    const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-profile-date-"));
    try {
      await mkdir(join(root, "config"), { recursive: true });
      await writeFile(join(root, "config", "user-profile.json"), JSON.stringify({ displayName: "小林", completedAt }), "utf8");
      assert.equal(createMemoryStore({ userDataPath: root }).listCards().length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-profile-invalid-"));
  try {
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "user-profile.json"), JSON.stringify({ displayName: "小林", completedAt: " " }), "utf8");
    const store = createMemoryStore({ userDataPath: root });
    assert.equal(store.canWrite(), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("C2B profile accepts only exact canonical plain-own-data roots without invoking getters", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-profile-shape-"));
  try {
    const configDirectory = join(root, "config");
    const profilePath = join(configDirectory, "user-profile.json");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(profilePath, "{}", "utf8");
    const before = await readFile(profilePath);
    const beforeMtime = (await stat(profilePath, { bigint: true })).mtimeNs;
    const exactProfiles = [
      { displayName: "小林", completedAt: "2026-07-30" },
      { displayName: "小林", preferredName: "林林", completedAt: "2026-07-30T08:00:00+08:00" }
    ];
    const parseProfile = (value: Record<string, unknown>): unknown => withJsonParseValue(value, () =>
      createMemoryStore({ userDataPath: root }).canWrite() ? value : null
    );

    for (const [index, profile] of exactProfiles.entries()) {
      assert.ok(parseProfile(profile), `profile-${index}:positive`);
      for (const key of Object.keys(profile).filter((key) => key !== "preferredName")) {
        assert.equal(parseProfile(withoutKey(profile, key)), null, `profile-${index}:missing:${key}`);
      }
      assertRejectsObjectStructure(`profile-${index}`, profile, parseProfile);
    }

    for (const profile of [
      { displayName: " 小林", completedAt: "2026-07-30" },
      { displayName: "小林", preferredName: "林  林", completedAt: "2026-07-30" },
      { displayName: "小林", completedAt: " " },
      { displayName: "小林", completedAt: "not-a-date" },
      { displayName: "小林", completedAt: 1_700_000_000_000 }
    ]) {
      assert.equal(parseProfile(profile), null, "profile:noncanonical-or-invalid");
    }

    const sensitiveProfile = { displayName: "api key secret", completedAt: "2026-07-30" };
    assert.equal(withJsonParseValue(sensitiveProfile, () => createMemoryStore({ userDataPath: root }).canWrite()), false);
    assert.equal(withJsonParseValue(sensitiveProfile, () => createMemoryStore({ userDataPath: root }).listCards().length), 0);
    assert.equal((await readFile(profilePath)).equals(before), true);
    assert.equal((await stat(profilePath, { bigint: true })).mtimeNs, beforeMtime);
    assert.deepEqual(await readdir(configDirectory), ["user-profile.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C2B unsafe sources reject every potential writer before bad arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-writer-gate-"));
  try {
    const directory = join(root, "memory");
    const factsPath = join(directory, "facts.json");
    const reviewsPath = join(directory, "reviews.json");
    await mkdir(directory, { recursive: true });
    await writeFile(factsPath, "{", "utf8");
    const factsBefore = await readFile(factsPath);
    const factsMtime = (await stat(factsPath, { bigint: true })).mtimeNs;
    const factsDirectoryBefore = await readdir(directory);
    const facts = createMemoryStore({ userDataPath: root });
    for (const call of [
      () => facts.setEnabled("bad" as never), () => facts.createCard({} as never), () => facts.confirmReviewedCandidate({} as never),
      () => facts.updateCard("bad", {}), () => facts.deleteCard("bad"), () => facts.forgetCard("bad"), () => facts.clearCards(),
      () => facts.allowSuppression("bad"), () => facts.clearSuppressions()
    ]) assert.throws(call, /Memory storage unavailable/);
    assert.deepEqual(facts.createInjection(), { count: 0, cards: [] });
    assert.equal((await readFile(factsPath)).equals(factsBefore), true, "facts:bytes");
    assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, factsMtime, "facts:mtimeNs");
    assert.deepEqual(await readdir(directory), factsDirectoryBefore, "facts:directory");
    await assertNoTransientArtifacts(directory, "facts:bad-args");

    await writeFile(reviewsPath, "{", "utf8");
    const reviewsBefore = await readFile(reviewsPath);
    const reviewsMtime = (await stat(reviewsPath, { bigint: true })).mtimeNs;
    const reviewDirectoryBefore = await readdir(directory);
    const reviews = createMemoryReviewStore({ userDataPath: root });
    for (const call of [
      () => reviews.enqueue({} as never), () => reviews.listCandidates(), () => reviews.getCandidate("bad"),
      () => reviews.updatePendingCandidate("bad", {}), () => reviews.setStatus("bad", "confirmed"),
      () => reviews.pruneExpiredPendingCandidates(Number.NaN), () => reviews.clearPendingCandidates()
    ]) assert.throws(call, /Memory review storage unavailable/);
    assert.equal((await readFile(reviewsPath)).equals(reviewsBefore), true, "reviews:bytes");
    assert.equal((await stat(reviewsPath, { bigint: true })).mtimeNs, reviewsMtime, "reviews:mtimeNs");
    assert.equal((await readFile(factsPath)).equals(factsBefore), true, "reviews:facts-bytes");
    assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, factsMtime, "reviews:facts-mtimeNs");
    assert.deepEqual(await readdir(directory), reviewDirectoryBefore, "reviews:directory");
    await assertNoTransientArtifacts(directory, "reviews:bad-args");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C2B facts writes fail closed on mkdir, write, and rename faults", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-facts-fault-"));
  try {
    const missing = createMemoryStore({ userDataPath });
    const memoryDirectory = join(userDataPath, "memory");
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        assert.throws(() => missing.setEnabled(true), /Memory storage unavailable/);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `missing:${operation}:single-call`);
      assert.equal(existsSync(missing.getMemoryPath()), false, `missing:${operation}:no-final`);
      await assertNoTransientArtifacts(memoryDirectory, `missing:${operation}`);
    }

    missing.setEnabled(true);
    const created = missing.createCard({
      title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"],
      sourceConversationId: "22222222-2222-4222-8222-222222222222"
    });
    assert.equal(created.status, "created");
    const path = missing.getMemoryPath();
    const before = await readFile(path);
    const beforeMtime = (await stat(path, { bigint: true })).mtimeNs;
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        assert.throws(() => missing.updateCard(created.card.id, { title: "新称呼" }), /Memory storage unavailable/);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `existing:${operation}:single-call`);
      assert.equal((await readFile(path)).equals(before), true, `existing:${operation}:bytes`);
      assert.equal((await stat(path, { bigint: true })).mtimeNs, beforeMtime, `existing:${operation}:mtimeNs`);
      assert.deepEqual(await readdir(join(userDataPath, "memory")), ["facts.json"]);
      await assertNoTransientArtifacts(memoryDirectory, `existing:${operation}`);
    }
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B review writes fail closed on write and rename faults", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-reviews-fault-"));
  try {
    const missing = createMemoryReviewStore({ userDataPath });
    const memoryDirectory = join(userDataPath, "memory");
    const enqueue = () => missing.enqueue({
      action: "create", title: "称呼", content: "用户希望被称为小夏。", tags: ["称呼"], namespace: "personal", key: "preferred-name",
      importance: "key", category: "addressing", confidence: 0.9,
      sourceConversationId: "22222222-2222-4222-8222-222222222222", sourceMessageId: "33333333-3333-4333-8333-333333333333"
    });
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        assert.throws(enqueue, /Memory review storage unavailable/);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `missing:${operation}:single-call`);
      assert.equal(existsSync(missing.getReviewPath()), false, `missing:${operation}:no-final`);
      await assertNoTransientArtifacts(memoryDirectory, `missing:${operation}`);
    }
    const reviews = createMemoryReviewStore({ userDataPath });
    const candidate = enqueue();
    const path = reviews.getReviewPath();
    const before = await readFile(path);
    const beforeMtime = (await stat(path, { bigint: true })).mtimeNs;
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        assert.throws(() => reviews.setStatus(candidate.id, "confirmed"), /Memory review storage unavailable/);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `existing:${operation}:single-call`);
      assert.equal((await readFile(path)).equals(before), true, `existing:${operation}:bytes`);
      assert.equal((await stat(path, { bigint: true })).mtimeNs, beforeMtime, `existing:${operation}:mtimeNs`);
      assert.deepEqual(await readdir(join(userDataPath, "memory")), ["reviews.json"]);
      await assertNoTransientArtifacts(memoryDirectory, `existing:${operation}`);
    }
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B legacy and profile migrations preserve source bytes on failure and retry only a failed unlink", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-migration-"));
  try {
    const memoryDirectory = join(userDataPath, "memory");
    const factsPath = join(memoryDirectory, "facts.json");
    await mkdir(memoryDirectory, { recursive: true });
    await writeFile(factsPath, `${JSON.stringify({ version: 1, enabled: true, cards: [v1Card()] })}\n`, "utf8");
    const factsBefore = await readFile(factsPath);
    const factsMtime = (await stat(factsPath, { bigint: true })).mtimeNs;
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        const legacy = createMemoryStore({ userDataPath });
        assert.throws(() => legacy.listCards(), /Memory storage unavailable/);
        assert.equal(legacy.canWrite(), true);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `legacy:${operation}:single-call`);
      assert.equal((await readFile(factsPath)).equals(factsBefore), true, `legacy:${operation}:bytes`);
      assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, factsMtime, `legacy:${operation}:mtimeNs`);
      assert.deepEqual(await readdir(memoryDirectory), ["facts.json"]);
      await assertNoTransientArtifacts(memoryDirectory, `legacy:${operation}`);
    }

    await rm(userDataPath, { recursive: true, force: true });
    await mkdir(join(userDataPath, "config"), { recursive: true });
    const profilePath = join(userDataPath, "config", "user-profile.json");
    await writeFile(profilePath, JSON.stringify({
      displayName: "小林", preferredName: "林林", completedAt: "2026-07-30T00:00:00.000Z"
    }), "utf8");
    const profileBefore = await readFile(profilePath);
    const profileMtime = (await stat(profilePath, { bigint: true })).mtimeNs;
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        assert.throws(() => createMemoryStore({ userDataPath }).listCards(), /Memory storage unavailable/);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `profile:${operation}:single-call`);
      assert.equal((await readFile(profilePath)).equals(profileBefore), true, `profile:${operation}:bytes`);
      assert.equal((await stat(profilePath, { bigint: true })).mtimeNs, profileMtime, `profile:${operation}:mtimeNs`);
      assert.equal(existsSync(join(userDataPath, "memory", "facts.json")), false, `profile:${operation}:no-final`);
      await assertNoTransientArtifacts(join(userDataPath, "memory"), `profile:${operation}`);
    }

    const originalUnlink = mutableFs.unlinkSync;
    let unlinkCalls = 0;
    mutableFs.unlinkSync = () => { unlinkCalls += 1; throw new Error("fault"); };
    try {
      assert.equal(createMemoryStore({ userDataPath }).listCards().length, 1);
    } finally {
      mutableFs.unlinkSync = originalUnlink;
    }
    assert.equal(unlinkCalls, 1, "profile:unlink:single-call");
    assert.equal(existsSync(profilePath), true);
    assert.equal((await readFile(profilePath)).equals(profileBefore), true, "profile:unlink:bytes");
    assert.equal((await stat(profilePath, { bigint: true })).mtimeNs, profileMtime, "profile:unlink:mtimeNs");
    await assertNoTransientArtifacts(join(userDataPath, "memory"), "profile:unlink");
    const retried = createMemoryStore({ userDataPath });
    assert.equal(retried.listCards().length, 1);
    assert.equal(existsSync(profilePath), false);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("C2B combines legacy facts and profile into one atomic write", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-c2b-combined-"));
  try {
    const memoryDirectory = join(userDataPath, "memory");
    const factsPath = join(memoryDirectory, "facts.json");
    const profilePath = join(userDataPath, "config", "user-profile.json");
    await mkdir(memoryDirectory, { recursive: true });
    await mkdir(join(userDataPath, "config"), { recursive: true });
    await writeFile(factsPath, `${JSON.stringify({ version: 1, enabled: true, cards: [v1Card()] })}\n`, "utf8");
    await writeFile(profilePath, JSON.stringify({ displayName: "小林", completedAt: "2026-07-30" }), "utf8");
    const factsBefore = await readFile(factsPath);
    const profileBefore = await readFile(profilePath);
    const factsMtime = (await stat(factsPath, { bigint: true })).mtimeNs;
    const profileMtime = (await stat(profilePath, { bigint: true })).mtimeNs;
    for (const operation of ["mkdirSync", "writeFileSync", "renameSync"] as const) {
      const original = mutableFs[operation];
      let calls = 0;
      mutableFs[operation] = () => { calls += 1; throw new Error("fault"); };
      try {
        assert.throws(() => createMemoryStore({ userDataPath }).listCards(), /Memory storage unavailable/);
      } finally {
        mutableFs[operation] = original;
      }
      assert.equal(calls, 1, `combined:${operation}:single-call`);
      assert.equal((await readFile(factsPath)).equals(factsBefore), true, `combined:${operation}:facts-bytes`);
      assert.equal((await stat(factsPath, { bigint: true })).mtimeNs, factsMtime, `combined:${operation}:facts-mtimeNs`);
      assert.equal((await readFile(profilePath)).equals(profileBefore), true, `combined:${operation}:profile-bytes`);
      assert.equal((await stat(profilePath, { bigint: true })).mtimeNs, profileMtime, `combined:${operation}:profile-mtimeNs`);
      assert.deepEqual(await readdir(memoryDirectory), ["facts.json"]);
      await assertNoTransientArtifacts(memoryDirectory, `combined:${operation}`);
    }

    const migrated = createMemoryStore({ userDataPath });
    assert.equal(migrated.listCards().length, 2);
    assert.equal(existsSync(profilePath), false);
    const persisted = JSON.parse(await readFile(factsPath, "utf8"));
    assert.equal(persisted.version, 4);
    assert.equal(persisted.cards.length, 2);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
