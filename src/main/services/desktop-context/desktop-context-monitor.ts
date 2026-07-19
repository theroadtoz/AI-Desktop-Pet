import type { EnvironmentActionSettings } from "../../../shared/environment-action-settings";
import type {
  DesktopContextProvider,
  DesktopContextSnapshot
} from "./windows-desktop-context-provider";

export type DesktopContextStableReason =
  | "state_music_playing_stable"
  | "state_game_presence_stable";

export type DesktopContextMonitor = {
  updateSettings(settings: EnvironmentActionSettings): void;
  pollNow(): Promise<void>;
  resetStability(): void;
  dispose(): void;
};

type StableSignalState = {
  activeSinceMs: number | null;
  emitted: boolean;
};

const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DESKTOP_CONTEXT_STABLE_DURATION_MS = 30_000;

export function createDesktopContextMonitor({
  provider,
  sendReason,
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  stableDurationMs = DESKTOP_CONTEXT_STABLE_DURATION_MS,
  maxSampleGapMs = pollIntervalMs * 3,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}: {
  provider: DesktopContextProvider;
  sendReason(reason: DesktopContextStableReason): void;
  now?: () => number;
  pollIntervalMs?: number;
  stableDurationMs?: number;
  maxSampleGapMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): DesktopContextMonitor {
  let settings: EnvironmentActionSettings = { musicEnabled: false, gameEnabled: false };
  let interval: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let pollInFlight: Promise<void> | null = null;
  let lastSampleAtMs: number | null = null;
  const musicState: StableSignalState = { activeSinceMs: null, emitted: false };
  const gameState: StableSignalState = { activeSinceMs: null, emitted: false };

  function resetSignal(state: StableSignalState): void {
    state.activeSinceMs = null;
    state.emitted = false;
  }

  function evaluateSignal(
    state: StableSignalState,
    active: boolean,
    timestampMs: number,
    reason: DesktopContextStableReason
  ): void {
    if (!active) {
      resetSignal(state);
      return;
    }

    if (state.activeSinceMs === null) {
      state.activeSinceMs = timestampMs;
      return;
    }

    if (!state.emitted && timestampMs - state.activeSinceMs >= stableDurationMs) {
      state.emitted = true;
      sendReason(reason);
    }
  }

  function consumeSnapshot(snapshot: DesktopContextSnapshot): void {
    if (disposed) {
      return;
    }

    const timestampMs = now();
    if (
      lastSampleAtMs !== null &&
      (timestampMs < lastSampleAtMs || timestampMs - lastSampleAtMs > maxSampleGapMs)
    ) {
      resetSignal(musicState);
      resetSignal(gameState);
    }
    lastSampleAtMs = timestampMs;
    if (settings.musicEnabled) {
      evaluateSignal(musicState, snapshot.mediaPlaying, timestampMs, "state_music_playing_stable");
    }
    if (settings.gameEnabled) {
      evaluateSignal(gameState, snapshot.gamePresence === "game", timestampMs, "state_game_presence_stable");
    }
  }

  async function pollNow(): Promise<void> {
    if (disposed || (!settings.musicEnabled && !settings.gameEnabled)) {
      return;
    }
    if (pollInFlight) {
      return pollInFlight;
    }

    pollInFlight = provider.sample()
      .then(consumeSnapshot)
      .catch(() => {
        consumeSnapshot({ mediaPlaying: false, gamePresence: "unknown" });
      })
      .finally(() => {
        pollInFlight = null;
      });
    return pollInFlight;
  }

  function stopPolling(): void {
    if (interval) {
      clearIntervalFn(interval);
      interval = null;
    }
    provider.cancelPending();
  }

  function startPolling(): void {
    if (interval || disposed || (!settings.musicEnabled && !settings.gameEnabled)) {
      return;
    }
    void pollNow();
    interval = setIntervalFn(() => {
      void pollNow();
    }, pollIntervalMs);
  }

  return {
    updateSettings(nextSettings) {
      const musicWasEnabled = settings.musicEnabled;
      const gameWasEnabled = settings.gameEnabled;
      settings = { ...nextSettings };

      if (!settings.musicEnabled || !musicWasEnabled) {
        resetSignal(musicState);
      }
      if (!settings.gameEnabled || !gameWasEnabled) {
        resetSignal(gameState);
      }

      if (!settings.musicEnabled && !settings.gameEnabled) {
        stopPolling();
        return;
      }
      startPolling();
    },
    pollNow,
    resetStability() {
      lastSampleAtMs = null;
      resetSignal(musicState);
      resetSignal(gameState);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopPolling();
      lastSampleAtMs = null;
      resetSignal(musicState);
      resetSignal(gameState);
      provider.dispose();
    }
  };
}
