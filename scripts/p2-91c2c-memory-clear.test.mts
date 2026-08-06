import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearMemoryTransaction,
  commitMemoryClear,
  isMemoryClearRecoveryRequired,
  prepareMemoryClear,
  recoverMemoryClearTransactions
} from "../dist/main/services/chat/memory-clear-transaction.js";

const id = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const now = 1_700_000_000_000;

function writeFixture(root: string): void {
  writeFileSync(join(root, "memory", "facts.json"), `${JSON.stringify({
    version: 4,
    enabled: true,
    cards: [{
      id,
      title: "喜欢茶",
      content: "用户喜欢喝茶",
      tags: ["饮品"],
      sourceConversationId: conversationId,
      sourceType: "manual-chat",
      namespace: "personal",
      key: "manual-tea",
      importance: "key",
      category: "manual",
      confidence: 1,
      sourceMessageId: null,
      observedCount: 1,
      lastObservedAt: now,
      compressionState: "raw",
      createdAt: now,
      updatedAt: now,
      enabled: true,
      managedByUser: true,
      lastInjectedAt: null,
      injectionCount: 0
    }],
    suppressions: [{
      namespace: "personal",
      key: "preferred-name",
      category: "addressing",
      createdAt: now
    }]
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(root, "memory", "reviews.json"), `${JSON.stringify({
    version: 1,
    candidates: [{
      action: "create",
      title: "已确认偏好",
      content: "用户确认喜欢茶",
      tags: ["饮品"],
      namespace: "personal",
      key: "confirmed-tea",
      importance: "key",
      category: "manual",
      confidence: 1,
      sourceConversationId: conversationId,
      sourceMessageId: id,
      id,
      status: "confirmed",
      createdAt: now,
      updatedAt: now
    }, {
      action: "create",
      title: "待确认偏好",
      content: "用户可能喜欢茶",
      tags: ["饮品"],
      namespace: "personal",
      key: "pending-tea",
      importance: "general",
      category: "manual",
      confidence: 0.8,
      sourceConversationId: conversationId,
      sourceMessageId: id,
      id: "33333333-3333-4333-8333-333333333333",
      status: "pending-review",
      createdAt: now,
      updatedAt: now
    }]
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(root, "config", "user-profile.json"), `${JSON.stringify({
    displayName: "小明",
    preferredName: "明明",
    completedAt: "2023-11-14T22:13:20.000Z"
  }, null, 2)}\n`, "utf8");
}

function fixturePaths(root: string) {
  return {
    facts: join(root, "memory", "facts.json"),
    reviews: join(root, "memory", "reviews.json"),
    profile: join(root, "config", "user-profile.json"),
    transaction: join(root, "memory", "memory-clear-transaction")
  };
}

function snapshot(path: string): { bytes: Buffer; mtimeNs: bigint } {
  return {
    bytes: readFileSync(path),
    mtimeNs: statSync(path, { bigint: true }).mtimeNs
  };
}

function createFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "p2-91c2c-clear-"));
  mkdirSync(join(root, "memory"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  writeFixture(root);
  return root;
}

function assertClearedFixture(paths: ReturnType<typeof fixturePaths>): void {
  const facts = JSON.parse(readFileSync(paths.facts, "utf8"));
  const reviews = JSON.parse(readFileSync(paths.reviews, "utf8"));
  assert.deepEqual(facts.cards, []);
  assert.equal(reviews.candidates.some((candidate: { status: string }) => candidate.status === "pending-review"), false);
  assert.equal(existsSync(paths.profile), false);
}

test("clearMemoryTransaction clears cards and pending reviews without regenerating legacy profile cards", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    const result = clearMemoryTransaction({ userDataPath: root });
    assert.deepEqual(result, { status: "cleared" });
    const facts = JSON.parse(readFileSync(paths.facts, "utf8"));
    const reviews = JSON.parse(readFileSync(paths.reviews, "utf8"));
    assert.equal(facts.enabled, true);
    assert.deepEqual(facts.cards, []);
    assert.deepEqual(facts.suppressions, [{
      namespace: "personal",
      key: "preferred-name",
      category: "addressing",
      createdAt: now
    }]);
    assert.equal(reviews.candidates.length, 1);
    assert.equal(reviews.candidates[0].status, "confirmed");
    assert.equal(existsSync(paths.profile), false);
    assert.equal(existsSync(paths.transaction), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a facts commit failure rolls reviews back to exact bytes and mtime", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    const before = {
      facts: snapshot(paths.facts),
      reviews: snapshot(paths.reviews),
      profile: snapshot(paths.profile)
    };
    assert.throws(() => clearMemoryTransaction({
      userDataPath: root,
      fault(operation, participant) {
        if (operation === "commit" && participant === "facts") throw new Error("fault");
      }
    }), { message: "Memory clear failed" });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      const after = snapshot(paths[participant]);
      assert.deepEqual(after.bytes, before[participant].bytes);
      assert.equal(after.mtimeNs, before[participant].mtimeNs);
    }
    assert.equal(existsSync(paths.transaction), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unsafe facts, reviews, or profile sources fail prepare without changing any participant", () => {
  const sentinel = "sk-private-clear-sentinel";
  const cases: Array<{
    name: string;
    expectedReason: "invalid-schema" | "future-version" | "sensitive";
    mutate(paths: ReturnType<typeof fixturePaths>): void;
  }> = [
    { name: "invalid facts", expectedReason: "invalid-schema", mutate: (paths) => writeFileSync(paths.facts, "{", "utf8") },
    { name: "future facts", expectedReason: "future-version", mutate: (paths) => {
      const value = JSON.parse(readFileSync(paths.facts, "utf8"));
      value.version = 5;
      writeFileSync(paths.facts, `${JSON.stringify(value)}\n`, "utf8");
    } },
    { name: "sensitive facts", expectedReason: "sensitive", mutate: (paths) => {
      const value = JSON.parse(readFileSync(paths.facts, "utf8"));
      value.cards[0].content = sentinel;
      writeFileSync(paths.facts, `${JSON.stringify(value)}\n`, "utf8");
    } },
    { name: "invalid reviews", expectedReason: "invalid-schema", mutate: (paths) => writeFileSync(paths.reviews, "{", "utf8") },
    { name: "future reviews", expectedReason: "future-version", mutate: (paths) => {
      const value = JSON.parse(readFileSync(paths.reviews, "utf8"));
      value.version = 2;
      writeFileSync(paths.reviews, `${JSON.stringify(value)}\n`, "utf8");
    } },
    { name: "sensitive reviews", expectedReason: "sensitive", mutate: (paths) => {
      const value = JSON.parse(readFileSync(paths.reviews, "utf8"));
      value.candidates[0].content = sentinel;
      writeFileSync(paths.reviews, `${JSON.stringify(value)}\n`, "utf8");
    } },
    { name: "invalid profile", expectedReason: "invalid-schema", mutate: (paths) => writeFileSync(paths.profile, "{", "utf8") },
    { name: "sensitive profile", expectedReason: "sensitive", mutate: (paths) => {
      const value = JSON.parse(readFileSync(paths.profile, "utf8"));
      value.preferredName = sentinel;
      writeFileSync(paths.profile, `${JSON.stringify(value)}\n`, "utf8");
    } }
  ];

  for (const testCase of cases) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      testCase.mutate(paths);
      const before = {
        facts: snapshot(paths.facts),
        reviews: snapshot(paths.reviews),
        profile: snapshot(paths.profile),
        memoryEntries: readdirSync(join(root, "memory")).sort(),
        configEntries: readdirSync(join(root, "config")).sort()
      };
      assert.throws(
        () => clearMemoryTransaction({ userDataPath: root }),
        (error) => error instanceof Error &&
          error.message === `Memory clear unavailable: ${testCase.expectedReason}` &&
          !error.message.includes(sentinel),
        testCase.name
      );
      for (const participant of ["facts", "reviews", "profile"] as const) {
        const after = snapshot(paths[participant]);
        assert.deepEqual(after.bytes, before[participant].bytes, `${testCase.name}:bytes:${participant}`);
        assert.equal(after.mtimeNs, before[participant].mtimeNs, `${testCase.name}:mtime:${participant}`);
      }
      assert.deepEqual(readdirSync(join(root, "memory")).sort(), before.memoryEntries, `${testCase.name}:memory-dir`);
      assert.deepEqual(readdirSync(join(root, "config")).sort(), before.configEntries, `${testCase.name}:config-dir`);
      assert.equal(existsSync(paths.transaction), false, `${testCase.name}:transaction`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("prepared journal is a closed privacy-safe schema and restart keeps exact source files", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  const bodyMarker = "PRIVATE_MEMORY_BODY_MARKER";
  try {
    const facts = JSON.parse(readFileSync(paths.facts, "utf8"));
    facts.cards[0].content = bodyMarker;
    writeFileSync(paths.facts, `${JSON.stringify(facts)}\n`, "utf8");
    const before = {
      facts: snapshot(paths.facts),
      reviews: snapshot(paths.reviews),
      profile: snapshot(paths.profile)
    };
    prepareMemoryClear({ userDataPath: root });
    const journalPath = join(paths.transaction, "journal.json");
    const journalText = readFileSync(journalPath, "utf8");
    const journal = JSON.parse(journalText);
    assert.deepEqual(Object.keys(journal).sort(), ["participants", "phase", "reason", "version"]);
    assert.equal(journal.version, 1);
    assert.equal(journal.phase, "prepared");
    assert.equal(journal.reason, "prepared");
    assert.deepEqual(journal.participants.map((entry: { participant: string }) => entry.participant), ["reviews", "facts", "profile"]);
    for (const participant of journal.participants) {
      assert.deepEqual(Object.keys(participant).sort(), ["participant", "sourceFingerprint", "targetFingerprint"]);
      assert.match(participant.sourceFingerprint, /^[a-f0-9]{64}$/u);
      assert.match(participant.targetFingerprint, /^[a-f0-9]{64}$/u);
    }
    assert.doesNotMatch(journalText, new RegExp(`${bodyMarker}|${id}|${conversationId}`, "u"));
    assert.equal(journalText.includes(root), false);

    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), { status: "recovered" });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      const after = snapshot(paths[participant]);
      assert.deepEqual(after.bytes, before[participant].bytes);
      assert.equal(after.mtimeNs, before[participant].mtimeNs);
    }
    assert.equal(existsSync(paths.transaction), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restart completes committed phases and only cleans a completed transaction", () => {
  const modulePath = join(process.cwd(), "dist", "main", "services", "chat", "memory-clear-transaction.js");
  const cases = [
    { name: "reviews committed", expectedPhase: "reviews-committed", exitWhen: "operation === 'commit' && participant === 'facts'" },
    { name: "facts committed", expectedPhase: "facts-committed", exitWhen: "operation === 'journal' && journalWrites === 4" },
    { name: "cleanup", expectedPhase: "cleanup", exitWhen: "operation === 'cleanup'" }
  ];

  for (const testCase of cases) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      const child = spawnSync(process.execPath, ["-e", `
        const { clearMemoryTransaction } = require(${JSON.stringify(modulePath)});
        let journalWrites = 0;
        clearMemoryTransaction({
          userDataPath: ${JSON.stringify(root)},
          fault(operation, participant) {
            if (operation === "journal") journalWrites += 1;
            if (${testCase.exitWhen}) process.exit(91);
          }
        });
      `], { encoding: "utf8" });
      assert.equal(child.status, 91, `${testCase.name}: child exit`);
      const journal = JSON.parse(readFileSync(join(paths.transaction, "journal.json"), "utf8"));
      assert.equal(journal.phase, testCase.expectedPhase, `${testCase.name}: durable phase`);

      assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), { status: "recovered" }, testCase.name);
      assertClearedFixture(paths);
      assert.equal(existsSync(paths.transaction), false, `${testCase.name}: transaction cleanup`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an external fingerprint change is preserved and enters durable recovery_required", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    const prepared = prepareMemoryClear({ userDataPath: root });
    const foreignBytes = Buffer.from("foreign bytes must not be overwritten\n", "utf8");
    writeFileSync(paths.reviews, foreignBytes);

    assert.deepEqual(commitMemoryClear(prepared), { status: "recovery_required", reason: "fingerprint-conflict" });
    assert.deepEqual(readFileSync(paths.reviews), foreignBytes);
    const journalText = readFileSync(join(paths.transaction, "journal.json"), "utf8");
    const journal = JSON.parse(journalText);
    assert.equal(journal.phase, "recovery_required");
    assert.equal(journal.reason, "fingerprint-conflict");
    assert.equal(journalText.includes(foreignBytes.toString("utf8").trim()), false);
    assert.equal(existsSync(join(paths.transaction, "backup", "reviews.bin")), true);
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
      status: "recovery_required",
      reason: "fingerprint-conflict"
    });
    assert.deepEqual(readFileSync(paths.reviews), foreignBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a rollback failure retains safe recovery material and fails closed", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    const result = clearMemoryTransaction({
      userDataPath: root,
      fault(operation, participant) {
        if (operation === "commit" && participant === "facts") throw new Error("commit fault");
        if (operation === "rollback" && participant === "reviews") throw new Error("rollback fault");
      }
    });
    assert.deepEqual(result, { status: "recovery_required", reason: "rollback-failed" });
    const journalText = readFileSync(join(paths.transaction, "journal.json"), "utf8");
    const journal = JSON.parse(journalText);
    assert.equal(journal.phase, "recovery_required");
    assert.equal(journal.reason, "rollback-failed");
    assert.doesNotMatch(journalText, new RegExp(`${id}|${conversationId}|用户|喜欢`, "u"));
    assert.equal(existsSync(join(paths.transaction, "backup", "reviews.bin")), true);
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
      status: "recovery_required",
      reason: "rollback-failed"
    });
    assert.equal(existsSync(paths.transaction), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown or future journals fail closed without changing source files or journal bytes", () => {
  const cases: Array<{
    name: string;
    reason: "invalid-schema" | "future-version";
    mutate(value: unknown): unknown;
  }> = [
    { name: "future version", reason: "future-version", mutate: (value) => ({ ...(value as object), version: 2 }) },
    { name: "unknown root field", reason: "invalid-schema", mutate: (value) => ({ ...(value as object), body: "private" }) },
    { name: "unknown phase", reason: "invalid-schema", mutate: (value) => ({ ...(value as object), phase: "unknown" }) },
    { name: "unknown reason", reason: "invalid-schema", mutate: (value) => ({ ...(value as object), reason: "unknown" }) },
    { name: "phase reason mismatch", reason: "invalid-schema", mutate: (value) => ({ ...(value as object), reason: "committed" }) },
    { name: "duplicate participant", reason: "invalid-schema", mutate: (value) => {
      const journal = structuredClone(value) as { participants: unknown[] };
      journal.participants[1] = journal.participants[0];
      return journal;
    } },
    { name: "unknown participant field", reason: "invalid-schema", mutate: (value) => {
      const journal = structuredClone(value) as { participants: Array<Record<string, unknown>> };
      journal.participants[0].body = "private";
      return journal;
    } },
    { name: "invalid fingerprint", reason: "invalid-schema", mutate: (value) => {
      const journal = structuredClone(value) as { participants: Array<Record<string, unknown>> };
      journal.participants[0].sourceFingerprint = "not-a-fingerprint";
      return journal;
    } }
  ];

  for (const testCase of cases) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      const before = {
        facts: snapshot(paths.facts),
        reviews: snapshot(paths.reviews),
        profile: snapshot(paths.profile)
      };
      prepareMemoryClear({ userDataPath: root });
      const journalPath = join(paths.transaction, "journal.json");
      const original = JSON.parse(readFileSync(journalPath, "utf8"));
      const unsafeBytes = Buffer.from(`${JSON.stringify(testCase.mutate(original), null, 2)}\n`, "utf8");
      writeFileSync(journalPath, unsafeBytes);

      assert.equal(isMemoryClearRecoveryRequired({ userDataPath: root }), true, testCase.name);
      assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
        status: "recovery_required",
        reason: testCase.reason
      }, testCase.name);
      assert.deepEqual(readFileSync(journalPath), unsafeBytes, `${testCase.name}: journal`);
      for (const participant of ["facts", "reviews", "profile"] as const) {
        const after = snapshot(paths[participant]);
        assert.deepEqual(after.bytes, before[participant].bytes, `${testCase.name}:${participant}:bytes`);
        assert.equal(after.mtimeNs, before[participant].mtimeNs, `${testCase.name}:${participant}:mtime`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("prepare and commit write failures restore exact files with a fixed safe error", () => {
  const sentinel = "private fault detail must not escape";
  const cases: Array<{
    name: string;
    shouldFail(operation: string, participant: string | undefined, journalWrites: number): boolean;
  }> = [
    { name: "reviews next", shouldFail: (operation, participant) => operation === "next" && participant === "reviews" },
    { name: "facts next", shouldFail: (operation, participant) => operation === "next" && participant === "facts" },
    { name: "reviews backup", shouldFail: (operation, participant) => operation === "backup" && participant === "reviews" },
    { name: "facts backup", shouldFail: (operation, participant) => operation === "backup" && participant === "facts" },
    { name: "profile backup", shouldFail: (operation, participant) => operation === "backup" && participant === "profile" },
    { name: "prepared journal", shouldFail: (operation, _participant, journalWrites) => operation === "journal" && journalWrites === 1 },
    { name: "reviews commit", shouldFail: (operation, participant) => operation === "commit" && participant === "reviews" },
    { name: "facts commit", shouldFail: (operation, participant) => operation === "commit" && participant === "facts" },
    { name: "profile commit", shouldFail: (operation, participant) => operation === "commit" && participant === "profile" },
    { name: "reviews journal", shouldFail: (operation, _participant, journalWrites) => operation === "journal" && journalWrites === 2 },
    { name: "facts journal", shouldFail: (operation, _participant, journalWrites) => operation === "journal" && journalWrites === 3 },
    { name: "cleanup journal", shouldFail: (operation, _participant, journalWrites) => operation === "journal" && journalWrites === 4 }
  ];

  for (const testCase of cases) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      const before = {
        facts: snapshot(paths.facts),
        reviews: snapshot(paths.reviews),
        profile: snapshot(paths.profile)
      };
      let journalWrites = 0;
      assert.throws(() => clearMemoryTransaction({
        userDataPath: root,
        fault(operation, participant) {
          if (operation === "journal") journalWrites += 1;
          if (testCase.shouldFail(operation, participant, journalWrites)) throw new Error(sentinel);
        }
      }), (error) => error instanceof Error && error.message === "Memory clear failed" && !error.message.includes(sentinel), testCase.name);
      for (const participant of ["facts", "reviews", "profile"] as const) {
        const after = snapshot(paths[participant]);
        assert.deepEqual(after.bytes, before[participant].bytes, `${testCase.name}:${participant}:bytes`);
        assert.equal(after.mtimeNs, before[participant].mtimeNs, `${testCase.name}:${participant}:mtime`);
      }
      assert.equal(existsSync(paths.transaction), false, `${testCase.name}:transaction`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("cleanup failure returns cleanup-pending and leaves a completed transaction for restart cleanup", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    let cleanupFaulted = false;
    assert.deepEqual(clearMemoryTransaction({
      userDataPath: root,
      fault(operation) {
        if (operation === "cleanup" && !cleanupFaulted) {
          cleanupFaulted = true;
          throw new Error("cleanup fault");
        }
      }
    }), { status: "recovery_required", reason: "cleanup-pending" });
    assertClearedFixture(paths);
    const journal = JSON.parse(readFileSync(join(paths.transaction, "journal.json"), "utf8"));
    assert.equal(journal.phase, "cleanup");
    assert.equal(journal.reason, "cleanup-pending");
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), { status: "recovered" });
    assertClearedFixture(paths);
    assert.equal(existsSync(paths.transaction), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("journal-less transaction residue is fail-closed unless the directory is empty", () => {
  const unsafeRoot = createFixtureRoot();
  const unsafePaths = fixturePaths(unsafeRoot);
  try {
    const before = {
      facts: snapshot(unsafePaths.facts),
      reviews: snapshot(unsafePaths.reviews),
      profile: snapshot(unsafePaths.profile)
    };
    mkdirSync(join(unsafePaths.transaction, "next"), { recursive: true });
    const unknownPath = join(unsafePaths.transaction, "next", "unknown.bin");
    const unknownBytes = Buffer.from("unknown transaction residue\n", "utf8");
    writeFileSync(unknownPath, unknownBytes);
    assert.equal(isMemoryClearRecoveryRequired({ userDataPath: unsafeRoot }), true);
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: unsafeRoot }), {
      status: "recovery_required",
      reason: "invalid-schema"
    });
    assert.deepEqual(clearMemoryTransaction({ userDataPath: unsafeRoot }), {
      status: "recovery_required",
      reason: "invalid-schema"
    });
    assert.deepEqual(readFileSync(unknownPath), unknownBytes);
    for (const participant of ["facts", "reviews", "profile"] as const) {
      const after = snapshot(unsafePaths[participant]);
      assert.deepEqual(after.bytes, before[participant].bytes);
      assert.equal(after.mtimeNs, before[participant].mtimeNs);
    }
  } finally {
    rmSync(unsafeRoot, { recursive: true, force: true });
  }

  const emptyRoot = createFixtureRoot();
  const emptyPaths = fixturePaths(emptyRoot);
  try {
    mkdirSync(emptyPaths.transaction, { recursive: true });
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: emptyRoot }), { status: "recovered" });
    assert.equal(existsSync(emptyPaths.transaction), false);
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test("completed phase fingerprint conflicts never roll canonical files back", () => {
  const modulePath = join(process.cwd(), "dist", "main", "services", "chat", "memory-clear-transaction.js");
  for (const testCase of [
    { name: "facts committed", expectedPhase: "facts-committed", exitWhen: "operation === 'journal' && journalWrites === 4" },
    { name: "cleanup", expectedPhase: "cleanup", exitWhen: "operation === 'cleanup'" }
  ]) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      const child = spawnSync(process.execPath, ["-e", `
        const { clearMemoryTransaction } = require(${JSON.stringify(modulePath)});
        let journalWrites = 0;
        clearMemoryTransaction({ userDataPath: ${JSON.stringify(root)}, fault(operation) {
          if (operation === "journal") journalWrites += 1;
          if (${testCase.exitWhen}) process.exit(92);
        }});
      `], { encoding: "utf8" });
      assert.equal(child.status, 92, testCase.name);
      assert.equal(JSON.parse(readFileSync(join(paths.transaction, "journal.json"), "utf8")).phase, testCase.expectedPhase);
      const foreignBytes = Buffer.from(`foreign completed bytes ${testCase.name}\n`, "utf8");
      writeFileSync(paths.facts, foreignBytes);
      const beforeRecovery = {
        facts: snapshot(paths.facts),
        reviews: snapshot(paths.reviews),
        profileExists: existsSync(paths.profile),
        profile: existsSync(paths.profile) ? snapshot(paths.profile) : null
      };

      assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
        status: "recovery_required",
        reason: "fingerprint-conflict"
      });
      assert.deepEqual(snapshot(paths.facts), beforeRecovery.facts);
      assert.deepEqual(snapshot(paths.reviews), beforeRecovery.reviews);
      assert.equal(existsSync(paths.profile), beforeRecovery.profileExists);
      if (beforeRecovery.profile) assert.deepEqual(snapshot(paths.profile), beforeRecovery.profile);
      const journal = JSON.parse(readFileSync(join(paths.transaction, "journal.json"), "utf8"));
      assert.equal(journal.phase, "recovery_required");
      assert.equal(journal.reason, "fingerprint-conflict");
      assert.equal(existsSync(join(paths.transaction, "backup")), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("restart never installs a corrupted next artifact", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  const modulePath = join(process.cwd(), "dist", "main", "services", "chat", "memory-clear-transaction.js");
  try {
    const child = spawnSync(process.execPath, ["-e", `
      const { clearMemoryTransaction } = require(${JSON.stringify(modulePath)});
      clearMemoryTransaction({ userDataPath: ${JSON.stringify(root)}, fault(operation, participant) {
        if (operation === "commit" && participant === "facts") process.exit(93);
      }});
    `], { encoding: "utf8" });
    assert.equal(child.status, 93);
    const before = {
      facts: snapshot(paths.facts),
      reviews: snapshot(paths.reviews),
      profile: snapshot(paths.profile)
    };
    const corruptedNext = join(paths.transaction, "next", "facts.bin");
    const corruptedBytes = Buffer.from("corrupted next artifact\n", "utf8");
    writeFileSync(corruptedNext, corruptedBytes);

    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
      status: "recovery_required",
      reason: "fingerprint-conflict"
    });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      assert.deepEqual(snapshot(paths[participant]), before[participant], participant);
    }
    assert.deepEqual(readFileSync(corruptedNext), corruptedBytes);
    const journal = JSON.parse(readFileSync(join(paths.transaction, "journal.json"), "utf8"));
    assert.equal(journal.phase, "recovery_required");
    assert.equal(journal.reason, "fingerprint-conflict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared restart retains a corrupted next artifact instead of cleaning it", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    prepareMemoryClear({ userDataPath: root });
    const before = {
      facts: snapshot(paths.facts),
      reviews: snapshot(paths.reviews),
      profile: snapshot(paths.profile)
    };
    const corruptedNext = join(paths.transaction, "next", "facts.bin");
    const corruptedBytes = Buffer.from("prepared next artifact was replaced\n", "utf8");
    writeFileSync(corruptedNext, corruptedBytes);

    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
      status: "recovery_required",
      reason: "fingerprint-conflict"
    });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      assert.deepEqual(snapshot(paths[participant]), before[participant], participant);
    }
    assert.deepEqual(readFileSync(corruptedNext), corruptedBytes);
    assert.equal(existsSync(paths.transaction), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepared restart retains a corrupted backup artifact instead of cleaning it", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    prepareMemoryClear({ userDataPath: root });
    const before = {
      facts: snapshot(paths.facts),
      reviews: snapshot(paths.reviews),
      profile: snapshot(paths.profile)
    };
    const corruptedBackup = join(paths.transaction, "backup", "facts.bin");
    const corruptedBytes = Buffer.from("prepared backup artifact was replaced\n", "utf8");
    writeFileSync(corruptedBackup, corruptedBytes);

    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
      status: "recovery_required",
      reason: "fingerprint-conflict"
    });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      assert.deepEqual(snapshot(paths[participant]), before[participant], participant);
    }
    assert.deepEqual(readFileSync(corruptedBackup), corruptedBytes);
    assert.equal(existsSync(paths.transaction), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("journal fingerprints are opaque for missing participants and bind source and next mtime", () => {
  const missingRoot = createFixtureRoot();
  const missingPaths = fixturePaths(missingRoot);
  try {
    rmSync(missingPaths.profile);
    prepareMemoryClear({ userDataPath: missingRoot });
    const journalText = readFileSync(join(missingPaths.transaction, "journal.json"), "utf8");
    const journal = JSON.parse(journalText);
    assert.doesNotMatch(journalText, /missing|exists|mtime/iu);
    for (const participant of journal.participants) {
      assert.match(participant.sourceFingerprint, /^[a-f0-9]{64}$/u);
      assert.match(participant.targetFingerprint, /^[a-f0-9]{64}$/u);
    }
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  for (const target of ["source", "next"] as const) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      const prepared = prepareMemoryClear({ userDataPath: root });
      const touchedPath = target === "source" ? paths.facts : join(paths.transaction, "next", "facts.bin");
      const bytes = readFileSync(touchedPath);
      const beforeMtime = statSync(touchedPath, { bigint: true }).mtimeNs;
      const touchedAt = new Date(Date.now() + 10_000);
      utimesSync(touchedPath, touchedAt, touchedAt);
      assert.deepEqual(readFileSync(touchedPath), bytes);
      assert.notEqual(statSync(touchedPath, { bigint: true }).mtimeNs, beforeMtime);
      assert.deepEqual(commitMemoryClear(prepared), { status: "recovery_required", reason: "fingerprint-conflict" }, target);
      assert.deepEqual(readFileSync(touchedPath), bytes, `${target}:bytes`);
      assert.equal(existsSync(paths.transaction), true, `${target}:transaction`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("non-canonical raw journal and unknown artifacts fail closed without cleanup", () => {
  for (const testCase of ["duplicate-key", "unknown-root-artifact", "unknown-next-artifact"] as const) {
    const root = createFixtureRoot();
    const paths = fixturePaths(root);
    try {
      prepareMemoryClear({ userDataPath: root });
      const journalPath = join(paths.transaction, "journal.json");
      let protectedPath = journalPath;
      if (testCase === "duplicate-key") {
        const duplicate = readFileSync(journalPath, "utf8").replace('  "phase": "prepared",', '  "phase": "prepared",\n  "phase": "prepared",');
        writeFileSync(journalPath, duplicate, "utf8");
      } else {
        protectedPath = testCase === "unknown-root-artifact"
          ? join(paths.transaction, "foreign.bin")
          : join(paths.transaction, "next", "foreign.bin");
        writeFileSync(protectedPath, "foreign artifact\n", "utf8");
      }
      const protectedBytes = readFileSync(protectedPath);
      assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
        status: "recovery_required",
        reason: "invalid-schema"
      }, testCase);
      assert.deepEqual(readFileSync(protectedPath), protectedBytes, testCase);
      assert.equal(existsSync(paths.transaction), true, testCase);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("partial rename rolls back exactly and partial cleanup remains cleanup-pending", () => {
  const renameRoot = createFixtureRoot();
  const renamePaths = fixturePaths(renameRoot);
  try {
    const before = {
      facts: snapshot(renamePaths.facts),
      reviews: snapshot(renamePaths.reviews),
      profile: snapshot(renamePaths.profile)
    };
    assert.throws(() => clearMemoryTransaction({
      userDataPath: renameRoot,
      fault(operation, participant) {
        if (operation === "commit-after-backup" && participant === "facts") throw new Error("partial rename");
      }
    }), { message: "Memory clear failed" });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      assert.deepEqual(snapshot(renamePaths[participant]), before[participant]);
    }
    assert.equal(existsSync(renamePaths.transaction), false);
  } finally {
    rmSync(renameRoot, { recursive: true, force: true });
  }

  const cleanupRoot = createFixtureRoot();
  const cleanupPaths = fixturePaths(cleanupRoot);
  try {
    let faulted = false;
    assert.deepEqual(clearMemoryTransaction({
      userDataPath: cleanupRoot,
      fault(operation) {
        if (operation === "cleanup-after-next" && !faulted) {
          faulted = true;
          throw new Error("partial cleanup");
        }
      }
    }), { status: "recovery_required", reason: "cleanup-pending" });
    assertClearedFixture(cleanupPaths);
    const journal = JSON.parse(readFileSync(join(cleanupPaths.transaction, "journal.json"), "utf8"));
    assert.equal(journal.phase, "cleanup");
    assert.equal(journal.reason, "cleanup-pending");
    assert.equal(existsSync(join(cleanupPaths.transaction, "next")), false);
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: cleanupRoot }), { status: "recovered" });
    assert.equal(existsSync(cleanupPaths.transaction), false);
  } finally {
    rmSync(cleanupRoot, { recursive: true, force: true });
  }
});

test("prepare cleanup residue enters durable prepare-failed recovery", () => {
  const root = createFixtureRoot();
  const paths = fixturePaths(root);
  try {
    const before = {
      facts: snapshot(paths.facts),
      reviews: snapshot(paths.reviews),
      profile: snapshot(paths.profile)
    };
    assert.deepEqual(clearMemoryTransaction({
      userDataPath: root,
      fault(operation, participant) {
        if (operation === "next" && participant === "reviews") throw new Error("prepare write");
        if (operation === "cleanup") throw new Error("prepare cleanup");
      }
    }), { status: "recovery_required", reason: "prepare-failed" });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      assert.deepEqual(snapshot(paths[participant]), before[participant]);
    }
    const journal = JSON.parse(readFileSync(join(paths.transaction, "journal.json"), "utf8"));
    assert.equal(journal.phase, "recovery_required");
    assert.equal(journal.reason, "prepare-failed");
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: root }), {
      status: "recovery_required",
      reason: "prepare-failed"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restart forward and cleanup failures use closed phase-specific reasons", () => {
  const forwardRoot = createFixtureRoot();
  const forwardPaths = fixturePaths(forwardRoot);
  const modulePath = join(process.cwd(), "dist", "main", "services", "chat", "memory-clear-transaction.js");
  try {
    const child = spawnSync(process.execPath, ["-e", `
      const { clearMemoryTransaction } = require(${JSON.stringify(modulePath)});
      clearMemoryTransaction({ userDataPath: ${JSON.stringify(forwardRoot)}, fault(operation, participant) {
        if (operation === "commit" && participant === "facts") process.exit(94);
      }});
    `], { encoding: "utf8" });
    assert.equal(child.status, 94);
    const before = {
      facts: snapshot(forwardPaths.facts),
      reviews: snapshot(forwardPaths.reviews),
      profile: snapshot(forwardPaths.profile)
    };
    assert.deepEqual(recoverMemoryClearTransactions({
      userDataPath: forwardRoot,
      fault(operation, participant) {
        if (operation === "commit" && participant === "facts") throw new Error("forward write");
      }
    }), { status: "recovery_required", reason: "forward-failed" });
    for (const participant of ["facts", "reviews", "profile"] as const) {
      assert.deepEqual(snapshot(forwardPaths[participant]), before[participant]);
    }
    const journal = JSON.parse(readFileSync(join(forwardPaths.transaction, "journal.json"), "utf8"));
    assert.equal(journal.phase, "recovery_required");
    assert.equal(journal.reason, "forward-failed");
  } finally {
    rmSync(forwardRoot, { recursive: true, force: true });
  }

  const cleanupRoot = createFixtureRoot();
  const cleanupPaths = fixturePaths(cleanupRoot);
  try {
    let firstCleanup = true;
    assert.deepEqual(clearMemoryTransaction({
      userDataPath: cleanupRoot,
      fault(operation) {
        if (operation === "cleanup" && firstCleanup) {
          firstCleanup = false;
          throw new Error("initial cleanup");
        }
      }
    }), { status: "recovery_required", reason: "cleanup-pending" });
    assert.deepEqual(recoverMemoryClearTransactions({
      userDataPath: cleanupRoot,
      fault(operation) {
        if (operation === "cleanup") throw new Error("restart cleanup");
      }
    }), { status: "recovery_required", reason: "cleanup-pending" });
    const pending = JSON.parse(readFileSync(join(cleanupPaths.transaction, "journal.json"), "utf8"));
    assert.equal(pending.phase, "cleanup");
    assert.equal(pending.reason, "cleanup-pending");
    assert.deepEqual(recoverMemoryClearTransactions({ userDataPath: cleanupRoot }), { status: "recovered" });
  } finally {
    rmSync(cleanupRoot, { recursive: true, force: true });
  }
});
