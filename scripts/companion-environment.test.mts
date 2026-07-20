import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompanionEnvironmentSnapshotStore,
  createUnknownCompanionEnvironmentSnapshot,
  normalizeCompanionEnvironmentSignalInputs,
  parseCompanionEnvironmentSnapshot,
  type CompanionEnvironmentSnapshotSignals
} from "../src/main/services/desktop-context/companion-environment.ts";

const KNOWN_SIGNALS = {
  activity: { value: "active", source: "power-monitor", capability: "available", confidence: "high" },
  interruptibility: { value: "allowed", source: "quns", capability: "available", confidence: "medium" },
  media: { value: "stopped", source: "gsmtc", capability: "available", confidence: "medium" },
  game: { value: "inactive", source: "user-explicit", capability: "available", confidence: "low" },
  timeBand: { value: "daytime", source: "local-clock", capability: "available", confidence: "high" }
} as const;

function snapshotAt(updatedAtMs: number, revision = 1) {
  return {
    schemaVersion: 1,
    revision,
    updatedAtMs,
    activity: { ...KNOWN_SIGNALS.activity, changedAtMs: updatedAtMs, stableSinceMs: updatedAtMs },
    interruptibility: { ...KNOWN_SIGNALS.interruptibility, changedAtMs: updatedAtMs, stableSinceMs: updatedAtMs },
    media: { ...KNOWN_SIGNALS.media, changedAtMs: updatedAtMs, stableSinceMs: updatedAtMs },
    game: { ...KNOWN_SIGNALS.game, changedAtMs: updatedAtMs, stableSinceMs: updatedAtMs },
    timeBand: { ...KNOWN_SIGNALS.timeBand, changedAtMs: updatedAtMs, stableSinceMs: updatedAtMs }
  };
}

test("environment snapshot parser accepts only its closed root and signal contracts", () => {
  const valid = snapshotAt(10);
  assert.deepEqual(parseCompanionEnvironmentSnapshot(JSON.stringify(valid)), valid);

  for (const invalid of [
    { ...valid, privateValue: "no" },
    { ...valid, activity: { ...valid.activity, idleSeconds: 60 } },
    { ...valid, media: { ...valid.media, source: "power-monitor" } },
    { ...valid, game: { ...valid.game, source: "quns" } },
    { ...valid, timeBand: { ...valid.timeBand, confidence: null } },
    { ...valid, interruptibility: { ...valid.interruptibility, value: "game" } },
    { ...valid, media: { value: "unknown", source: "none", capability: "available", confidence: null, changedAtMs: 10, stableSinceMs: 10 } },
    { ...valid, media: { value: "unknown", source: "gsmtc", capability: "available", confidence: null, changedAtMs: 10, stableSinceMs: 10 } },
    { ...valid, media: { value: "unknown", source: "gsmtc", capability: "unavailable", confidence: null, changedAtMs: 10, stableSinceMs: 10 } },
    { ...valid, media: { value: "unknown", source: "gsmtc", capability: "unknown", confidence: "low", changedAtMs: 10, stableSinceMs: 10 } }
  ]) {
    assert.equal(parseCompanionEnvironmentSnapshot(JSON.stringify(invalid)), null);
  }
});

test("snapshot parser rejects invalid time ordering and keeps unknown defaults unavailable", () => {
  const valid = snapshotAt(10);
  assert.equal(parseCompanionEnvironmentSnapshot(JSON.stringify({
    ...valid,
    updatedAtMs: 9
  })), null);
  assert.equal(parseCompanionEnvironmentSnapshot(JSON.stringify({
    ...valid,
    activity: { ...valid.activity, changedAtMs: 9, stableSinceMs: 10 }
  })), null);
  assert.deepEqual(createUnknownCompanionEnvironmentSnapshot(7), {
    schemaVersion: 1,
    revision: 0,
    updatedAtMs: 7,
    activity: { value: "unknown", source: "none", capability: "unavailable", confidence: null, changedAtMs: 7, stableSinceMs: 7 },
    interruptibility: { value: "unknown", source: "none", capability: "unavailable", confidence: null, changedAtMs: 7, stableSinceMs: 7 },
    media: { value: "unknown", source: "none", capability: "unavailable", confidence: null, changedAtMs: 7, stableSinceMs: 7 },
    game: { value: "unknown", source: "none", capability: "unavailable", confidence: null, changedAtMs: 7, stableSinceMs: 7 },
    timeBand: { value: "unknown", source: "none", capability: "unavailable", confidence: null, changedAtMs: 7, stableSinceMs: 7 }
  });
});

test("input parser is strict before a provider result can reach the stabilizer", () => {
  assert.deepEqual(normalizeCompanionEnvironmentSignalInputs(KNOWN_SIGNALS), KNOWN_SIGNALS);
  assert.equal(normalizeCompanionEnvironmentSignalInputs({ ...KNOWN_SIGNALS, screen: "private" }), null);
  assert.equal(normalizeCompanionEnvironmentSignalInputs({
    ...KNOWN_SIGNALS,
    media: { ...KNOWN_SIGNALS.media, title: "private" }
  }), null);
});

test("snapshot store increments only on a semantic change and supports unsubscribe", () => {
  const store = createCompanionEnvironmentSnapshotStore();
  const notifications: number[] = [];
  const unsubscribe = store.subscribe((snapshot) => notifications.push(snapshot.revision));
  const firstSignals = Object.fromEntries(Object.entries(KNOWN_SIGNALS).map(([key, input]) => [key, {
    ...input,
    changedAtMs: 5,
    stableSinceMs: 0
  }]));
  const first = store.commit(firstSignals as CompanionEnvironmentSnapshotSignals, 5);
  assert.equal(first.revision, 1);
  assert.equal(store.commit(firstSignals as CompanionEnvironmentSnapshotSignals, 6).revision, 1);
  unsubscribe();
  const nextSignals = { ...firstSignals, media: { ...firstSignals.media, value: "playing" as const, changedAtMs: 7, stableSinceMs: 6 } };
  assert.equal(store.commit(nextSignals as CompanionEnvironmentSnapshotSignals, 7).revision, 2);
  assert.deepEqual(notifications, [1]);
  assert.equal(store.commit(nextSignals as CompanionEnvironmentSnapshotSignals, 6).revision, 2);
});
