import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const compiledDirectory = mkdtempSync(join(tmpdir(), "p2-82b-desktop-context-"));
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
  resolve("src/shared/environment-action-settings.ts"),
  resolve("src/main/services/desktop-context/companion-environment.ts"),
  resolve("src/main/services/desktop-context/environment-signal-stabilizer.ts"),
  resolve("src/main/services/desktop-context/windows-desktop-context-provider.ts"),
  resolve("src/main/services/desktop-context/desktop-context-monitor.ts")
], { stdio: "pipe" });
const require = createRequire(join(compiledDirectory, "main", "services", "desktop-context", "test.js"));
const {
  bucketIdleSeconds,
  createWindowsDesktopContextProvider,
  mapQunsState,
  parseMediaProbeResult,
  parseQunsProbeResult,
  WINDOWS_QUNS_SCRIPT
} = require("./windows-desktop-context-provider.js") as typeof import(
  "../src/main/services/desktop-context/windows-desktop-context-provider.ts"
);
const {
  createDesktopContextMonitor,
  QUNS_POLL_INTERVAL_MS
} = require("./desktop-context-monitor.js") as typeof import(
  "../src/main/services/desktop-context/desktop-context-monitor.ts"
);
import type {
  DesktopContextCommandRunner,
  DesktopContextProvider
} from "../src/main/services/desktop-context/windows-desktop-context-provider.ts";

function resolvedRunner(output: string, calls: { count: number; cancel: number; dispose: number }):
DesktopContextCommandRunner {
  return {
    async execute() {
      calls.count += 1;
      return output;
    },
    cancel() {
      calls.cancel += 1;
    },
    dispose() {
      calls.dispose += 1;
    }
  };
}

function createProviderCounters() {
  const counts = { media: 0, quns: 0, cancelMedia: 0, cancelBasic: 0, dispose: 0 };
  const provider: DesktopContextProvider = {
    async sampleMedia() {
      counts.media += 1;
      return { status: "available", value: "playing", capability: "available" };
    },
    async sampleInterruptibility() {
      counts.quns += 1;
      return { status: "available", value: "allowed", capability: "available" };
    },
    cancelMediaPending() {
      counts.cancelMedia += 1;
    },
    cancelBasicPending() {
      counts.cancelBasic += 1;
    },
    dispose() {
      counts.dispose += 1;
    }
  };
  return { counts, provider };
}

const noTimer = (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval;
const clearNoTimer = (() => undefined) as typeof clearInterval;

test("idle seconds are discarded into strict mutually exclusive boundaries", () => {
  assert.equal(bucketIdleSeconds(0), "active");
  assert.equal(bucketIdleSeconds(59), "active");
  assert.equal(bucketIdleSeconds(60), "idle-short");
  assert.equal(bucketIdleSeconds(299), "idle-short");
  assert.equal(bucketIdleSeconds(300), "idle-long");
  assert.equal(bucketIdleSeconds(1_799), "idle-long");
  assert.equal(bucketIdleSeconds(1_800), "away");
  assert.equal(bucketIdleSeconds(-1), "unknown");
  assert.equal(bucketIdleSeconds(59.5), "unknown");
});

test("QUNS parser and mapping are closed to the approved enum", () => {
  for (const state of [1, 2, 6, 7]) {
    assert.equal(mapQunsState(state), "suppressed");
  }
  assert.equal(mapQunsState(3), "full-screen-activity");
  assert.equal(mapQunsState(4), "presentation");
  assert.equal(mapQunsState(5), "allowed");
  assert.equal(mapQunsState(0), "unknown");
  assert.deepEqual(parseQunsProbeResult('{"state":5}'), {
    status: "available",
    value: "allowed",
    capability: "available"
  });
  for (const output of [
    "not-json",
    '{"state":8}',
    '{"state":5,"path":"private"}',
    '{"state":"5"}',
    '{"error":"free text"}'
  ]) {
    assert.deepEqual(parseQunsProbeResult(output), {
      status: "failed",
      value: "unknown",
      capability: "unknown"
    });
  }
});

test("QUNS source is an in-memory PowerShell 5.1 P/Invoke with bounded hidden execution", () => {
  const providerSource = readFileSync(
    "src/main/services/desktop-context/windows-desktop-context-provider.ts",
    "utf8"
  );
  assert.match(WINDOWS_QUNS_SCRIPT, /Add-Type -TypeDefinition/);
  assert.match(WINDOWS_QUNS_SCRIPT, /public static class CompanionQunsNative/);
  assert.match(WINDOWS_QUNS_SCRIPT, /public static extern int SHQueryUserNotificationState\(out int state\)/);
  assert.match(WINDOWS_QUNS_SCRIPT, /SHQueryUserNotificationState/);
  assert.match(WINDOWS_QUNS_SCRIPT, /\$callCode -eq 0/);
  assert.doesNotMatch(WINDOWS_QUNS_SCRIPT, /OutputAssembly|Get-Process|Win32_Process|GetForegroundWindow/);
  assert.doesNotMatch(WINDOWS_QUNS_SCRIPT, /HRESULT|StackTrace|Exception|Write-Error/);
  assert.match(providerSource, /createPowerShellQunsCommandRunner\(\{[\s\S]*timeoutMs = 2_000/);
  assert.match(providerSource, /-WindowStyle", "Hidden"/);
  assert.match(providerSource, /windowsHide: true/);
  assert.match(providerSource, /timeout: timeoutMs/);
});

test("QUNS and GSMTC provider calls are independent single-flight generations", async () => {
  let resolveQuns: ((output: string) => void) | null = null;
  let qunsCalls = 0;
  const mediaCalls = { count: 0, cancel: 0, dispose: 0 };
  const qunsCallsState = { count: 0, cancel: 0, dispose: 0 };
  const qunsRunner: DesktopContextCommandRunner = {
    execute() {
      qunsCalls += 1;
      qunsCallsState.count += 1;
      return new Promise((resolve) => {
        resolveQuns = resolve;
      });
    },
    cancel() { qunsCallsState.cancel += 1; },
    dispose() { qunsCallsState.dispose += 1; }
  };
  const provider = createWindowsDesktopContextProvider({
    platform: "win32",
    mediaCommandRunner: resolvedRunner(
      '{"mediaPlaying":false,"mediaCapability":"available"}',
      mediaCalls
    ),
    interruptibilityCommandRunner: qunsRunner
  });
  const first = provider.sampleInterruptibility();
  const second = provider.sampleInterruptibility();
  assert.equal(qunsCalls, 1);
  assert.deepEqual(await provider.sampleMedia(), {
    status: "available",
    value: "stopped",
    capability: "available"
  });
  assert.equal(mediaCalls.count, 1);
  resolveQuns?.('{"state":3}');
  assert.deepEqual(await first, await second);

  const late = provider.sampleInterruptibility();
  provider.cancelBasicPending();
  resolveQuns?.('{"state":5}');
  assert.equal((await late).status, "failed");
  assert.equal(qunsCallsState.cancel, 1);
  provider.dispose();
  assert.equal(mediaCalls.dispose, 1);
  assert.equal(qunsCallsState.dispose, 1);
});

test("media parser rejects metadata and inconsistent capability output", () => {
  assert.deepEqual(parseMediaProbeResult('{"mediaPlaying":true,"mediaCapability":"available"}'), {
    status: "available",
    value: "playing",
    capability: "available"
  });
  assert.equal(parseMediaProbeResult(
    '{"mediaPlaying":true,"mediaCapability":"available","title":"private"}'
  ).status, "failed");
  assert.equal(parseMediaProbeResult(
    '{"mediaPlaying":true,"mediaCapability":"unavailable"}'
  ).status, "failed");
});

test("basic, media, and explicit-game settings do not cross-start external probes", async () => {
  const { counts, provider } = createProviderCounters();
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });

  monitor.updateSettings({ basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: true });
  await monitor.pollNow();
  assert.deepEqual({ media: counts.media, quns: counts.quns }, { media: 0, quns: 0 });

  monitor.updateSettings({ basicEnabled: true, musicEnabled: false, explicitGameContextEnabled: true });
  await monitor.pollNow();
  assert.equal(counts.media, 0);
  assert.ok(counts.quns >= 1);

  const qunsBeforeMediaOnly = counts.quns;
  monitor.updateSettings({ basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: true });
  await monitor.pollNow();
  assert.ok(counts.media >= 1);
  assert.equal(counts.quns, qunsBeforeMediaOnly);
  assert.equal(monitor.getSnapshot().game.value, "unknown");
  assert.equal(monitor.getSnapshot().game.capability, "unavailable");
  monitor.dispose();
});

test("changing one setting does not cancel or restart unrelated probes", async () => {
  const { counts, provider } = createProviderCounters();
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });
  monitor.updateSettings({ basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true });
  await monitor.pollNow();

  const started = { ...counts };
  monitor.updateSettings({ basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: false });
  monitor.updateSettings({ basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true });
  await Promise.resolve();
  assert.deepEqual(counts, started);

  monitor.updateSettings({ basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: true });
  await Promise.resolve();
  assert.equal(counts.cancelBasic, started.cancelBasic + 1);
  assert.equal(counts.cancelMedia, started.cancelMedia);
  assert.equal(counts.media, started.media);

  const beforeMusicOff = { ...counts };
  monitor.updateSettings({ basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: true });
  await Promise.resolve();
  assert.equal(counts.cancelBasic, beforeMusicOff.cancelBasic);
  assert.equal(counts.cancelMedia, beforeMusicOff.cancelMedia + 1);
  assert.equal(counts.quns, beforeMusicOff.quns);
  monitor.dispose();
});

test("main-only snapshot subscription forwards stable lifecycle changes and supports unsubscribe", () => {
  const { provider } = createProviderCounters();
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });
  const activityValues: string[] = [];
  const unsubscribe = monitor.subscribe((snapshot) => {
    activityValues.push(snapshot.activity.value);
  });

  monitor.lock();
  assert.deepEqual(activityValues, ["locked"]);
  unsubscribe();
  monitor.unlock();
  assert.deepEqual(activityValues, ["locked"]);
  monitor.dispose();
});

test("late media samples from a cancelled generation cannot update public status", async () => {
  const resolvers: Array<(result: Awaited<ReturnType<DesktopContextProvider["sampleMedia"]>>) => void> = [];
  let mediaCalls = 0;
  const provider: DesktopContextProvider = {
    sampleMedia() {
      mediaCalls += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
    async sampleInterruptibility() {
      return { status: "available", value: "allowed", capability: "available" };
    },
    cancelMediaPending() {},
    cancelBasicPending() {},
    dispose() {}
  };
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });
  monitor.updateSettings({ basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: false });
  const firstPoll = monitor.pollNow();
  await Promise.resolve();
  assert.equal(mediaCalls, 1);

  monitor.updateSettings({ basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: false });
  monitor.updateSettings({ basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: false });
  const secondPoll = monitor.pollNow();
  await Promise.resolve();
  assert.equal(mediaCalls, 2);

  resolvers[0]?.({ status: "available", value: "playing", capability: "available" });
  await firstPoll;
  assert.equal(monitor.getStatus().mediaCapability, "unavailable");
  resolvers[1]?.({ status: "available", value: "stopped", capability: "available" });
  await secondPoll;
  assert.equal(monitor.getStatus().mediaCapability, "available");
  monitor.dispose();
});

test("collection starts without renderer and renderer only gates retryable action delivery", async () => {
  let nowMs = 0;
  const reasons: string[] = [];
  const { provider } = createProviderCounters();
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason(reason) {
      reasons.push(reason);
      return reasons.length > 1;
    },
    getSystemIdleTime: () => 60,
    now: () => nowMs,
    stableDurationMs: 5_000,
    maxSampleGapMs: 60_000,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });
  monitor.updateSettings({ basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: true });
  await monitor.pollNow();
  nowMs = 5_000;
  await monitor.pollNow();
  assert.equal(monitor.getSnapshot().activity.value, "idle-short");
  assert.equal(monitor.getSnapshot().media.value, "playing");
  assert.deepEqual(reasons, []);

  monitor.setRendererReady(true);
  await Promise.resolve();
  assert.deepEqual(reasons, ["state_music_playing_stable"]);
  nowMs = 10_000;
  await monitor.pollNow();
  assert.deepEqual(reasons, ["state_music_playing_stable", "state_music_playing_stable"]);

  const revision = monitor.getSnapshot().revision;
  monitor.setRendererReady(false);
  assert.equal(monitor.getSnapshot().revision, revision);
  await monitor.pollNow();
  assert.equal(monitor.getSnapshot().revision, revision);
  monitor.dispose();
});

test("a cancelled renderer action confirmation cannot latch a later collection generation", async () => {
  let nowMs = 0;
  let sendCount = 0;
  let resolveFirstDelivery: ((delivered: boolean) => void) | null = null;
  const { provider } = createProviderCounters();
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason() {
      sendCount += 1;
      if (sendCount === 1) {
        return new Promise<boolean>((resolve) => {
          resolveFirstDelivery = resolve;
        });
      }
      return true;
    },
    now: () => nowMs,
    stableDurationMs: 0,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });
  monitor.setRendererReady(true);
  monitor.updateSettings({ basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: false });
  await monitor.pollNow();
  nowMs = 1;
  await monitor.pollNow();
  assert.equal(sendCount, 1);

  monitor.setRendererReady(false);
  monitor.updateSettings({ basicEnabled: false, musicEnabled: false, explicitGameContextEnabled: false });
  monitor.updateSettings({ basicEnabled: false, musicEnabled: true, explicitGameContextEnabled: false });
  monitor.setRendererReady(true);
  await monitor.pollNow();
  resolveFirstDelivery?.(true);
  await Promise.resolve();
  nowMs = 2;
  await monitor.pollNow();
  assert.equal(sendCount, 2);
  monitor.dispose();
});

test("lifecycle latches immediate states, cancels probes, and resumes through unknown", async () => {
  let nowMs = 0;
  const { counts, provider } = createProviderCounters();
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    now: () => nowMs,
    setIntervalFn: noTimer,
    clearIntervalFn: clearNoTimer
  });
  monitor.updateSettings({ basicEnabled: true, musicEnabled: true, explicitGameContextEnabled: false });
  await monitor.pollNow();
  nowMs = 1;
  monitor.lock();
  assert.equal(monitor.getSnapshot().activity.value, "locked");
  nowMs = 2;
  monitor.suspend();
  assert.equal(monitor.getSnapshot().activity.value, "suspended");
  monitor.unlock();
  assert.equal(monitor.getSnapshot().activity.value, "suspended");
  assert.ok(counts.cancelBasic > 0);
  assert.ok(counts.cancelMedia > 0);
  nowMs = 3;
  monitor.resume();
  assert.equal(monitor.getSnapshot().activity.value, "unknown");
  await monitor.pollNow();
  assert.equal(monitor.getStatus().monitorStatus, "polling");
  monitor.dispose();
  assert.equal(counts.dispose, 1);
});

test("QUNS retry timing starts at 15 seconds and caps at 60 seconds", async () => {
  assert.equal(QUNS_POLL_INTERVAL_MS, 15_000);
  let qunsCalls = 0;
  let nextTimerId = 0;
  const intervals = new Map<number, number>();
  const retries: Array<{ callback: () => void; delayMs: number }> = [];
  const provider: DesktopContextProvider = {
    async sampleMedia() {
      return { status: "unavailable", value: "unknown", capability: "unavailable" };
    },
    async sampleInterruptibility() {
      qunsCalls += 1;
      return qunsCalls <= 3
        ? { status: "failed", value: "unknown", capability: "unknown" }
        : { status: "available", value: "allowed", capability: "available" };
    },
    cancelMediaPending() {},
    cancelBasicPending() {},
    dispose() {}
  };
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    setIntervalFn: ((callback: () => void, delayMs: number) => {
      nextTimerId += 1;
      intervals.set(nextTimerId, delayMs);
      return nextTimerId as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: ((timer: NodeJS.Timeout) => {
      intervals.delete(timer as unknown as number);
    }) as typeof clearInterval,
    setTimeoutFn: ((callback: () => void, delayMs: number) => {
      nextTimerId += 1;
      retries.push({ callback, delayMs });
      return nextTimerId as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout
  });

  monitor.updateSettings({ basicEnabled: true, musicEnabled: false, explicitGameContextEnabled: false });
  await monitor.pollNow();
  assert.deepEqual(retries.map(({ delayMs }) => delayMs), [15_000]);
  retries[0]?.callback();
  await monitor.pollNow();
  assert.deepEqual(retries.map(({ delayMs }) => delayMs), [15_000, 30_000]);
  retries[1]?.callback();
  await monitor.pollNow();
  assert.deepEqual(retries.map(({ delayMs }) => delayMs), [15_000, 30_000, 60_000]);
  retries[2]?.callback();
  await monitor.pollNow();
  assert.equal(qunsCalls, 4);
  assert.equal([...intervals.values()].filter((delayMs) => delayMs === QUNS_POLL_INTERVAL_MS).length, 1);
  monitor.dispose();
});
