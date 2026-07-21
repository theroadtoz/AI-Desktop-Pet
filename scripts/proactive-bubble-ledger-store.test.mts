import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  createProactiveBubbleLedgerStore
} = require("../dist/main/services/config/proactive-bubble-ledger-store.js") as typeof import(
  "../src/main/services/config/proactive-bubble-ledger-store"
);

function withStore(run: (store: ReturnType<typeof createProactiveBubbleLedgerStore>, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "p2-83a-ledger-"));
  try {
    run(createProactiveBubbleLedgerStore({ userDataPath: root }), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("ledger enforces global, class, line, daily, and startup budgets", () => withStore((store) => {
  const base = new Date(2026, 6, 20, 8).getTime();
  const first = {
    cadence: "normal" as const,
    candidateClass: "environment" as const,
    lineId: "environment_music_started" as const,
    nowMs: base,
    dateKey: "2026-07-20"
  };
  assert.equal(store.canShow(first), null);
  store.recordShown(first);
  assert.equal(store.canShow({ ...first, lineId: "environment_game_started", nowMs: base + 10_000 }), "global_cooldown");
  assert.equal(store.canShow({ ...first, lineId: "environment_game_started", nowMs: base + 31 * 60_000 }), "class_cooldown");
  assert.equal(store.canShow({ ...first, nowMs: base + 5 * 60 * 60_000 }), "line_cooldown");
  assert.equal(store.canShow({ ...first, nowMs: base + 25 * 60 * 60_000, dateKey: "2026-07-21" }), null);

  const startup = {
    cadence: "normal" as const,
    candidateClass: "startup" as const,
    lineId: "startup_presence_ready" as const,
    nowMs: base,
    dateKey: "2026-07-20"
  };
  assert.equal(store.canShow(startup), null);
  store.recordShown(startup);
  assert.equal(store.canShow({ ...startup, nowMs: base + 1_000 }), "startup_daily_limit");
  assert.equal(store.canShow({ ...startup, dateKey: "2026-07-21", nowMs: base + 24 * 60 * 60_000 }), null);
}));

test("quiet cadence applies the stricter source cooldown", () => withStore((store) => {
  const base = new Date(2026, 6, 20, 8).getTime();
  const input = {
    cadence: "quiet" as const,
    candidateClass: "source" as const,
    lineId: "idle_presence_memory_safe" as const,
    nowMs: base,
    dateKey: "2026-07-20"
  };
  store.recordShown(input);
  assert.equal(store.canShow({
    ...input,
    lineId: "idle_presence_search_citation",
    nowMs: base + 2 * 60 * 60_000
  }), "daily_class_limit");
}));

test("corrupt or private-shaped ledger safely resets and persists only the closed schema", () => withStore((store, root) => {
  const path = store.getLedgerPath();
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, rawWindowTitle: "PRIVATE_TITLE" }), "utf8");
  const recovered = createProactiveBubbleLedgerStore({ userDataPath: root });
  recovered.recordShown({
    candidateClass: "source",
    lineId: "idle_presence_history_summary",
    nowMs: new Date(2026, 6, 20, 8).getTime(),
    dateKey: "2026-07-20"
  });
  const persisted = readFileSync(path, "utf8");
  assert.doesNotMatch(persisted, /PRIVATE_TITLE|window|process|media|memoryBody|searchQuery/i);
  assert.deepEqual(Object.keys(JSON.parse(persisted)).sort(), [
    "dailyClassCounts",
    "dailyTotal",
    "dateKey",
    "lastClassShownAtMs",
    "lastLineShownAtMs",
    "lastShownAtMs",
    "schemaVersion",
    "startupDateKey"
  ]);
}));
