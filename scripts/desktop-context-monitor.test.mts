import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPowerShellDesktopContextCommandRunner,
  createWindowsDesktopContextProvider,
  parseDesktopContextProbeResult,
  resolvePowerShellExecutablePath,
  type DesktopContextCommandRunner,
  type DesktopContextProbeResult,
  type DesktopContextProvider,
  type DesktopContextSnapshot
} from "../src/main/services/desktop-context/windows-desktop-context-provider.ts";
import {
  createDesktopContextMonitor,
  DESKTOP_CONTEXT_STABLE_DURATION_MS
} from "../src/main/services/desktop-context/desktop-context-monitor.ts";

function availableProbe(snapshot: DesktopContextSnapshot): DesktopContextProbeResult {
  return {
    status: "available",
    snapshot,
    capabilities: { media: "available", game: "available" }
  };
}

test("Windows provider exposes only closed signals, capabilities, and is single-flight", async () => {
  let executeCount = 0;
  let resolveCommand: ((value: string) => void) | null = null;
  let disposed = false;
  let cancelled = false;
  const runner: DesktopContextCommandRunner = {
    execute() {
      executeCount += 1;
      return new Promise((resolve) => {
        resolveCommand = resolve;
      });
    },
    dispose() {
      disposed = true;
    },
    cancel() {
      cancelled = true;
    }
  };
  const provider = createWindowsDesktopContextProvider({ platform: "win32", commandRunner: runner });
  const first = provider.sample();
  const second = provider.sample();
  assert.equal(executeCount, 1);
  resolveCommand?.('{"mediaPlaying":true,"gamePresence":"unknown","mediaCapability":"available","gameCapability":"unavailable"}');
  const mediaOnlyProbe = {
    status: "available" as const,
    snapshot: { mediaPlaying: true, gamePresence: "unknown" as const },
    capabilities: { media: "available" as const, game: "unavailable" as const }
  };
  assert.deepEqual(await first, mediaOnlyProbe);
  assert.deepEqual(await second, mediaOnlyProbe);
  provider.dispose();
  assert.equal(disposed, true);
  assert.equal(cancelled, true);
  assert.deepEqual(await provider.sample(), {
    status: "unavailable",
    snapshot: { mediaPlaying: false, gamePresence: "unknown" },
    capabilities: { media: "unavailable", game: "unavailable" }
  });
});

test("provider rejects malformed or metadata-bearing output without exposing details", () => {
  assert.deepEqual(parseDesktopContextProbeResult("not-json").status, "failed");
  assert.deepEqual(parseDesktopContextProbeResult(
    '{"mediaPlaying":true,"gamePresence":"game","mediaCapability":"available","gameCapability":"available","title":"private"}'
  ).status, "failed");
  assert.deepEqual(parseDesktopContextProbeResult(
    '{"mediaPlaying":false,"gamePresence":"unknown","mediaCapability":"unavailable","gameCapability":"available"}'
  ).status, "failed");
});

test("PowerShell runner resolves an absolute SystemRoot executable and retains safety options", () => {
  assert.equal(
    resolvePowerShellExecutablePath(String.raw`C:\Windows`),
    String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
  );

  const runnerSource = createPowerShellDesktopContextCommandRunner.toString();
  assert.match(runnerSource, /resolvePowerShellExecutablePath/);
  assert.match(runnerSource, /-WindowStyle["'],\s*["']Hidden/);
  assert.match(runnerSource, /windowsHide:\s*true/);
  assert.match(runnerSource, /timeout:\s*timeoutMs/);
  const providerSource = readFileSync("src/main/services/desktop-context/windows-desktop-context-provider.ts", "utf8");
  assert.doesNotMatch(providerSource, /Get-Process|GameConfigStore|MatchedExeFullPath|process\.Path/);
});

test("monitor does not poll while disabled and emits only after 30 stable seconds", async () => {
  let nowMs = 0;
  let sampleCount = 0;
  let disposed = false;
  let cancelled = false;
  let snapshot: DesktopContextSnapshot = { mediaPlaying: true, gamePresence: "game" };
  const provider: DesktopContextProvider = {
    async sample() {
      sampleCount += 1;
      return availableProbe(snapshot);
    },
    dispose() {
      disposed = true;
    },
    cancelPending() {
      cancelled = true;
    }
  };
  const reasons: string[] = [];
  let intervalCallback: (() => void) | null = null;
  let intervalCleared = false;
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: (reason) => {
      reasons.push(reason);
      return true;
    },
    now: () => nowMs,
    setIntervalFn: ((callback: () => void) => {
      intervalCallback = callback;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: (() => {
      intervalCleared = true;
      intervalCallback = null;
    }) as typeof clearInterval
  });

  await monitor.pollNow();
  assert.equal(sampleCount, 0);
  monitor.updateSettings({ musicEnabled: true, gameEnabled: true });
  await monitor.pollNow();
  assert.equal(sampleCount, 0);
  monitor.setRendererReady(true);
  await monitor.pollNow();
  assert.equal(sampleCount, 1);
  for (nowMs = 5_000; nowMs < DESKTOP_CONTEXT_STABLE_DURATION_MS; nowMs += 5_000) {
    await monitor.pollNow();
  }
  assert.deepEqual(reasons, []);
  nowMs = DESKTOP_CONTEXT_STABLE_DURATION_MS;
  await monitor.pollNow();
  assert.deepEqual(reasons, ["state_music_playing_stable", "state_game_presence_stable"]);

  await monitor.pollNow();
  assert.equal(reasons.length, 2);
  snapshot = { mediaPlaying: false, gamePresence: "unknown" };
  await monitor.pollNow();
  monitor.updateSettings({ musicEnabled: false, gameEnabled: false });
  assert.equal(intervalCleared, true);
  assert.equal(intervalCallback, null);
  assert.equal(cancelled, true);
  monitor.dispose();
  assert.equal(disposed, true);
});

test("monitor resets stability after abnormal sample gaps and explicit resume", async () => {
  let nowMs = 0;
  const reasons: string[] = [];
  const provider: DesktopContextProvider = {
    async sample() {
      return availableProbe({ mediaPlaying: true, gamePresence: "non-game" });
    },
    cancelPending() {},
    dispose() {}
  };
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: (reason) => {
      reasons.push(reason);
      return true;
    },
    now: () => nowMs,
    pollIntervalMs: 5_000,
    stableDurationMs: 10_000,
    setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval
  });

  monitor.updateSettings({ musicEnabled: true, gameEnabled: false });
  monitor.setRendererReady(true);
  await monitor.pollNow();
  nowMs = 20_000;
  await monitor.pollNow();
  assert.deepEqual(reasons, []);
  nowMs = 25_000;
  await monitor.pollNow();
  monitor.resetStability();
  nowMs = 35_000;
  await monitor.pollNow();
  assert.deepEqual(reasons, []);
  nowMs = 40_000;
  await monitor.pollNow();
  nowMs = 45_000;
  await monitor.pollNow();
  assert.deepEqual(reasons, ["state_music_playing_stable"]);
  monitor.dispose();
});

test("monitor emits only stable game entry and stable non-game exit transitions", async () => {
  let nowMs = 0;
  let snapshot: DesktopContextSnapshot = { mediaPlaying: false, gamePresence: "game" };
  const transitions: string[] = [];
  const monitor = createDesktopContextMonitor({
    provider: {
      async sample() { return availableProbe(snapshot); },
      cancelPending() {},
      dispose() {}
    },
    sendReason: () => true,
    onStableGamePresence: (presence) => { transitions.push(presence); },
    now: () => nowMs,
    stableDurationMs: 10,
    maxSampleGapMs: 100,
    setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval
  });
  monitor.updateSettings({ musicEnabled: false, gameEnabled: true });
  monitor.setRendererReady(true);
  await monitor.pollNow();
  nowMs = 10;
  await monitor.pollNow();
  assert.deepEqual(transitions, ["game"]);
  snapshot = { mediaPlaying: false, gamePresence: "non-game" };
  nowMs = 15;
  await monitor.pollNow();
  assert.deepEqual(transitions, ["game"]);
  nowMs = 25;
  await monitor.pollNow();
  assert.deepEqual(transitions, ["game", "non-game"]);
  monitor.dispose();
});

test("monitor retries a stable signal until the action delivery confirms success", async () => {
  let nowMs = 0;
  let deliveries = 0;
  const provider: DesktopContextProvider = {
    async sample() {
      return availableProbe({ mediaPlaying: true, gamePresence: "non-game" });
    },
    cancelPending() {},
    dispose() {}
  };
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => {
      deliveries += 1;
      return deliveries === 1 ? undefined : true;
    },
    now: () => nowMs,
    stableDurationMs: 1,
    setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval
  });

  monitor.updateSettings({ musicEnabled: true, gameEnabled: false });
  monitor.setRendererReady(true);
  await monitor.pollNow();
  nowMs = 1;
  await monitor.pollNow();
  nowMs = 2;
  await monitor.pollNow();
  nowMs = 3;
  await monitor.pollNow();
  assert.equal(deliveries, 2);
  monitor.dispose();
});

test("monitor backs off consecutive probe failures and restores normal polling on recovery", async () => {
  let sampleCount = 0;
  const retryDelays: number[] = [];
  let retryCallback: (() => void) | null = null;
  let clearedIntervals = 0;
  let normalIntervals = 0;
  const provider: DesktopContextProvider = {
    async sample() {
      sampleCount += 1;
      return sampleCount < 3
        ? { status: "failed", snapshot: { mediaPlaying: false, gamePresence: "unknown" }, capabilities: { media: "unavailable", game: "unavailable" } }
        : availableProbe({ mediaPlaying: false, gamePresence: "non-game" });
    },
    cancelPending() {},
    dispose() {}
  };
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: () => true,
    setIntervalFn: (() => {
      normalIntervals += 1;
      return normalIntervals as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: (() => {
      clearedIntervals += 1;
    }) as typeof clearInterval,
    setTimeoutFn: ((callback: () => void, delayMs: number) => {
      retryDelays.push(delayMs);
      retryCallback = callback;
      return retryDelays.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => {
      retryCallback = null;
    }) as typeof clearTimeout,
    maxFailureBackoffMs: 10_000
  });

  monitor.updateSettings({ musicEnabled: true, gameEnabled: false });
  monitor.setRendererReady(true);
  await monitor.pollNow();
  assert.deepEqual(retryDelays, [5_000]);
  retryCallback?.();
  await Promise.resolve();
  await monitor.pollNow();
  assert.deepEqual(retryDelays, [5_000, 10_000]);
  retryCallback?.();
  await Promise.resolve();
  await monitor.pollNow();
  assert.equal(sampleCount, 3);
  assert.equal(normalIntervals, 2);
  assert.equal(clearedIntervals, 1);
  monitor.dispose();
});

test("monitor remains single-flight and ignores a sample that resolves after dispose", async () => {
  let resolveSample: ((result: DesktopContextProbeResult) => void) | null = null;
  let sampleCount = 0;
  const provider: DesktopContextProvider = {
    sample() {
      sampleCount += 1;
      return new Promise((resolve) => {
        resolveSample = resolve;
      });
    },
    cancelPending() {},
    dispose() {}
  };
  const reasons: string[] = [];
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: (reason) => {
      reasons.push(reason);
      return true;
    },
    stableDurationMs: 1,
    setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval
  });

  monitor.updateSettings({ musicEnabled: true, gameEnabled: false });
  monitor.setRendererReady(true);
  const first = monitor.pollNow();
  const second = monitor.pollNow();
  assert.equal(sampleCount, 1);
  monitor.dispose();
  resolveSample?.(availableProbe({ mediaPlaying: true, gamePresence: "non-game" }));
  await Promise.all([first, second]);
  assert.deepEqual(reasons, []);
});
