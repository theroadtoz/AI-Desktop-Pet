import assert from "node:assert/strict";
import test from "node:test";
import {
  createPowerShellDesktopContextCommandRunner,
  createWindowsDesktopContextProvider,
  parseDesktopContextSnapshot,
  resolvePowerShellExecutablePath,
  type DesktopContextCommandRunner,
  type DesktopContextProvider,
  type DesktopContextSnapshot
} from "../src/main/services/desktop-context/windows-desktop-context-provider.ts";
import {
  createDesktopContextMonitor,
  DESKTOP_CONTEXT_STABLE_DURATION_MS
} from "../src/main/services/desktop-context/desktop-context-monitor.ts";

test("Windows provider exposes only closed signals and is single-flight", async () => {
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
  resolveCommand?.('{"mediaPlaying":true,"gamePresence":"game"}');
  assert.deepEqual(await first, { mediaPlaying: true, gamePresence: "game" });
  assert.deepEqual(await second, { mediaPlaying: true, gamePresence: "game" });
  provider.dispose();
  assert.equal(disposed, true);
  assert.equal(cancelled, true);
  assert.deepEqual(await provider.sample(), { mediaPlaying: false, gamePresence: "unknown" });
});

test("provider rejects malformed or metadata-bearing output", () => {
  assert.deepEqual(parseDesktopContextSnapshot("not-json"), {
    mediaPlaying: false,
    gamePresence: "unknown"
  });
  assert.deepEqual(parseDesktopContextSnapshot(
    '{"mediaPlaying":true,"gamePresence":"game","title":"private"}'
  ), {
    mediaPlaying: false,
    gamePresence: "unknown"
  });
});

test("PowerShell runner resolves an absolute SystemRoot executable and retains safety options", async () => {
  assert.equal(
    resolvePowerShellExecutablePath(String.raw`C:\Windows`),
    String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
  );

  const runnerSource = createPowerShellDesktopContextCommandRunner.toString();
  assert.match(runnerSource, /resolvePowerShellExecutablePath/);
  assert.match(runnerSource, /-WindowStyle["'],\s*["']Hidden/);
  assert.match(runnerSource, /windowsHide:\s*true/);
  assert.match(runnerSource, /timeout:\s*timeoutMs/);
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
      return snapshot;
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
    sendReason: (reason) => reasons.push(reason),
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
      return { mediaPlaying: true, gamePresence: "non-game" };
    },
    cancelPending() {},
    dispose() {}
  };
  const monitor = createDesktopContextMonitor({
    provider,
    sendReason: (reason) => reasons.push(reason),
    now: () => nowMs,
    pollIntervalMs: 5_000,
    stableDurationMs: 10_000,
    setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval
  });

  monitor.updateSettings({ musicEnabled: true, gameEnabled: false });
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

test("monitor ignores a sample that resolves after dispose", async () => {
  let nowMs = 0;
  let resolveSample: ((snapshot: DesktopContextSnapshot) => void) | null = null;
  let sampleCount = 0;
  const provider: DesktopContextProvider = {
    sample() {
      sampleCount += 1;
      if (sampleCount === 1) {
        return Promise.resolve({ mediaPlaying: true, gamePresence: "non-game" });
      }
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
    sendReason: (reason) => reasons.push(reason),
    now: () => nowMs,
    stableDurationMs: 1,
    setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval
  });

  monitor.updateSettings({ musicEnabled: true, gameEnabled: false });
  await monitor.pollNow();
  nowMs = 1;
  const latePoll = monitor.pollNow();
  monitor.dispose();
  resolveSample?.({ mediaPlaying: true, gamePresence: "non-game" });
  await latePoll;
  assert.deepEqual(reasons, []);
});
