import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const compiledDirectory = mkdtempSync(join(tmpdir(), "p2-82b-environment-stabilizer-"));
process.on("exit", () => {
  rmSync(compiledDirectory, { recursive: true, force: true });
});
execFileSync(process.execPath, [
  resolve("node_modules/typescript/bin/tsc"),
  "--module", "CommonJS",
  "--target", "ES2022",
  "--moduleResolution", "Node",
  "--types", "node",
  "--skipLibCheck",
  "--outDir", compiledDirectory,
  resolve("src/main/services/desktop-context/companion-environment.ts"),
  resolve("src/main/services/desktop-context/environment-signal-stabilizer.ts")
], { stdio: "pipe" });
const require = createRequire(join(compiledDirectory, "environment-signal-stabilizer.js"));
const {
  createEnvironmentSignalStabilizer,
  selectHighestPriorityActivity
} = require("./environment-signal-stabilizer.js") as typeof import(
  "../src/main/services/desktop-context/environment-signal-stabilizer.ts"
);

const SIGNALS = {
  activity: { value: "active", source: "power-monitor", capability: "available", confidence: "high" },
  interruptibility: { value: "allowed", source: "quns", capability: "available", confidence: "medium" },
  media: { value: "stopped", source: "gsmtc", capability: "available", confidence: "medium" },
  game: { value: "unknown", source: "user-explicit", capability: "unknown", confidence: null },
  timeBand: { value: "daytime", source: "local-clock", capability: "available", confidence: "high" }
} as const;

test("activity priority preserves suspended over every lower state", () => {
  assert.equal(selectHighestPriorityActivity(["active", "away", "locked"]), "locked");
  assert.equal(selectHighestPriorityActivity(["unknown", "idle-long", "suspended"]), "suspended");
});

test("stabilizer commits only on a second matching sample at least five seconds later", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  assert.equal(stabilizer.sample(SIGNALS).revision, 0);
  nowMs = 4_999;
  assert.equal(stabilizer.sample(SIGNALS).revision, 0);
  nowMs = 5_000;
  const snapshot = stabilizer.sample(SIGNALS);
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.activity.value, "active");
  assert.equal(snapshot.activity.stableSinceMs, 0);
  assert.equal(snapshot.activity.changedAtMs, 5_000);
  nowMs = 10_000;
  assert.equal(stabilizer.sample(SIGNALS).revision, 1);
});

test("partial samples do not advance stale values from unrelated providers", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  stabilizer.samplePartial({ interruptibility: SIGNALS.interruptibility });
  nowMs = 5_000;
  stabilizer.samplePartial({ activity: SIGNALS.activity, timeBand: SIGNALS.timeBand });
  assert.equal(stabilizer.getSnapshot().interruptibility.value, "unknown");
  nowMs = 15_000;
  stabilizer.samplePartial({ interruptibility: SIGNALS.interruptibility });
  assert.equal(stabilizer.getSnapshot().interruptibility.value, "allowed");
});

test("unrelated partial samples cannot hide a signal-specific sampling gap", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  stabilizer.samplePartial({ interruptibility: SIGNALS.interruptibility });
  for (nowMs = 5_000; nowMs <= 20_000; nowMs += 5_000) {
    stabilizer.samplePartial({ activity: SIGNALS.activity });
  }
  stabilizer.samplePartial({ interruptibility: SIGNALS.interruptibility });
  assert.equal(stabilizer.getSnapshot().interruptibility.value, "unknown");
  nowMs = 30_000;
  stabilizer.samplePartial({ interruptibility: SIGNALS.interruptibility });
  assert.equal(stabilizer.getSnapshot().interruptibility.value, "allowed");
});

test("jitter stays signal-local, while failed input, gaps, and time reversal reset pending candidates", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  stabilizer.sample(SIGNALS);
  nowMs = 1_000;
  stabilizer.sample({ ...SIGNALS, media: { ...SIGNALS.media, value: "playing" } });
  nowMs = 6_000;
  assert.equal(stabilizer.sample(SIGNALS).revision, 1);
  assert.equal(stabilizer.getSnapshot().media.value, "unknown");
  stabilizer.sample({ ...SIGNALS, media: { ...SIGNALS.media, title: "private" } } as any);
  nowMs = 11_000;
  stabilizer.sample(SIGNALS);
  nowMs = 16_000;
  assert.equal(stabilizer.sample(SIGNALS).revision, 2);
  nowMs = 17_000;
  stabilizer.sample({ ...SIGNALS, media: { ...SIGNALS.media, value: "playing" } });
  nowMs = 36_000;
  stabilizer.sample(SIGNALS);
  nowMs = 41_000;
  assert.equal(stabilizer.sample(SIGNALS).revision, 2);
  nowMs = 42_000;
  stabilizer.sample(SIGNALS);
  nowMs = 41_000;
  stabilizer.sample(SIGNALS);
  nowMs = 46_000;
  assert.equal(stabilizer.sample(SIGNALS).revision, 2);
});

test("lock and suspend latch immediately, while unlock and resume publish unknown then resample", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  assert.equal(stabilizer.lock().activity.value, "locked");
  nowMs = 1;
  assert.equal(stabilizer.unlock().activity.value, "unknown");
  nowMs = 2;
  assert.equal(stabilizer.suspend().activity.value, "suspended");
  nowMs = 3;
  assert.equal(stabilizer.resume().activity.value, "unknown");
  stabilizer.sample(SIGNALS);
  nowMs = 5_003;
  assert.equal(stabilizer.sample(SIGNALS).activity.value, "active");
});

test("reset and unsubscribe stop pending work and future notifications", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  let notificationCount = 0;
  const unsubscribe = stabilizer.subscribe(() => { notificationCount += 1; });
  stabilizer.sample(SIGNALS);
  stabilizer.reset();
  nowMs = 5_000;
  assert.equal(stabilizer.sample(SIGNALS).revision, 0);
  nowMs = 10_000;
  stabilizer.sample(SIGNALS);
  assert.equal(notificationCount, 1);
  unsubscribe();
  nowMs = 10_001;
  stabilizer.lock();
  assert.equal(notificationCount, 1);
  stabilizer.dispose();
  nowMs = 20_000;
  assert.equal(stabilizer.sample(SIGNALS).activity.value, "locked");
});

test("reset clears a pending game candidate with every other signal candidate", () => {
  let nowMs = 0;
  const stabilizer = createEnvironmentSignalStabilizer({ now: () => nowMs });
  stabilizer.samplePartial({
    game: { value: "active", source: "user-explicit", capability: "available", confidence: "low" }
  });
  stabilizer.reset();
  nowMs = 5_000;
  stabilizer.samplePartial({
    game: { value: "active", source: "user-explicit", capability: "available", confidence: "low" }
  });
  assert.equal(stabilizer.getSnapshot().game.value, "unknown");
});
