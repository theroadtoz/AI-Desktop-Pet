import type {
  EnvironmentActionRuntimeStatus,
  EnvironmentActionSettings
} from "../../../shared/environment-action-settings";
import type {
  DesktopContextProbeResult,
  DesktopContextProvider,
  DesktopContextSnapshot
} from "./windows-desktop-context-provider";

export type DesktopContextStableReason =
  | "state_music_playing_stable"
  | "state_game_presence_stable";

export type DesktopContextStableReasonDelivery = boolean | void | Promise<boolean | void>;

export type DesktopContextMonitor = {
  updateSettings(settings: EnvironmentActionSettings): void;
  setRendererReady(ready: boolean): void;
  pollNow(): Promise<void>;
  getStatus(): EnvironmentActionRuntimeStatus;
  resetStability(): void;
  dispose(): void;
};

type StableSignalState = {
  activeSinceMs: number | null;
  emitted: boolean;
  delivering: boolean;
};

type StableGamePresenceState = {
  stable: "game" | "non-game" | "unknown";
  candidate: "game" | "non-game" | null;
  candidateSinceMs: number | null;
};

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_FAILURE_BACKOFF_MS = 60_000;
const FAILURE_BACKOFF_MULTIPLIER = 2;
export const DESKTOP_CONTEXT_STABLE_DURATION_MS = 30_000;

export function createDesktopContextMonitor({
  provider,
  sendReason,
  onStableGamePresence = () => undefined,
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  stableDurationMs = DESKTOP_CONTEXT_STABLE_DURATION_MS,
  maxSampleGapMs = pollIntervalMs * 3,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  maxFailureBackoffMs = DEFAULT_MAX_FAILURE_BACKOFF_MS
}: {
  provider: DesktopContextProvider;
  sendReason(reason: DesktopContextStableReason): DesktopContextStableReasonDelivery;
  onStableGamePresence?(presence: "game" | "non-game"): void | Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  stableDurationMs?: number;
  maxSampleGapMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  maxFailureBackoffMs?: number;
}): DesktopContextMonitor {
  let settings: EnvironmentActionSettings = { musicEnabled: false, gameEnabled: false };
  let interval: ReturnType<typeof setInterval> | null = null;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let rendererReady = false;
  let pollInFlight: Promise<void> | null = null;
  let lastSampleAtMs: number | null = null;
  let sampleGeneration = 0;
  let consecutiveFailures = 0;
  let providerStatus: EnvironmentActionRuntimeStatus["providerStatus"] = "unknown";
  let mediaCapability: EnvironmentActionRuntimeStatus["mediaCapability"] = "unknown";
  let gameCapability: EnvironmentActionRuntimeStatus["gameCapability"] = "unknown";
  const musicState: StableSignalState = { activeSinceMs: null, emitted: false, delivering: false };
  const gameState: StableSignalState = { activeSinceMs: null, emitted: false, delivering: false };
  const stableGamePresenceState: StableGamePresenceState = {
    stable: "unknown",
    candidate: null,
    candidateSinceMs: null
  };

  function resetSignal(state: StableSignalState): void {
    state.activeSinceMs = null;
    state.emitted = false;
    state.delivering = false;
  }

  function resetGameCandidate(): void {
    stableGamePresenceState.candidate = null;
    stableGamePresenceState.candidateSinceMs = null;
  }

  async function evaluateStableGamePresence(
    presence: DesktopContextSnapshot["gamePresence"],
    timestampMs: number
  ): Promise<void> {
    if (presence === "unknown") {
      resetGameCandidate();
      return;
    }
    if (presence === stableGamePresenceState.stable) {
      resetGameCandidate();
      return;
    }
    if (presence !== stableGamePresenceState.candidate) {
      stableGamePresenceState.candidate = presence;
      stableGamePresenceState.candidateSinceMs = timestampMs;
      return;
    }
    if (
      stableGamePresenceState.candidateSinceMs === null ||
      timestampMs - stableGamePresenceState.candidateSinceMs < stableDurationMs
    ) {
      return;
    }

    try {
      await onStableGamePresence(presence);
      stableGamePresenceState.stable = presence;
      resetGameCandidate();
    } catch {
      // Keep the stable candidate eligible for delivery on the next sample.
    }
  }

  async function evaluateSignal(
    state: StableSignalState,
    active: boolean,
    timestampMs: number,
    reason: DesktopContextStableReason
  ): Promise<void> {
    if (!active) {
      resetSignal(state);
      return;
    }

    if (state.activeSinceMs === null) {
      state.activeSinceMs = timestampMs;
      return;
    }

    if (!state.emitted && !state.delivering && timestampMs - state.activeSinceMs >= stableDurationMs) {
      state.delivering = true;
      try {
        if (await sendReason(reason)) {
          state.emitted = true;
        }
      } catch {
        // A failed delivery remains eligible for the next stable sample.
      } finally {
        state.delivering = false;
      }
    }
  }

  async function consumeSnapshot(snapshot: DesktopContextSnapshot): Promise<void> {
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
      resetGameCandidate();
    }
    lastSampleAtMs = timestampMs;
    if (settings.musicEnabled) {
      await evaluateSignal(musicState, snapshot.mediaPlaying, timestampMs, "state_music_playing_stable");
    }
    if (settings.gameEnabled) {
      await evaluateStableGamePresence(snapshot.gamePresence, timestampMs);
      await evaluateSignal(gameState, snapshot.gamePresence === "game", timestampMs, "state_game_presence_stable");
    }
  }

  function isProbeUsable(result: DesktopContextProbeResult): boolean {
    return result.status === "available" && (
      (settings.musicEnabled && result.capabilities.media === "available") ||
      (settings.gameEnabled && result.capabilities.game === "available")
    );
  }

  function clearRetryTimeout(): void {
    if (retryTimeout) {
      clearTimeoutFn(retryTimeout);
      retryTimeout = null;
    }
  }

  function startNormalPolling(): void {
    clearRetryTimeout();
    if (interval || disposed || !rendererReady || (!settings.musicEnabled && !settings.gameEnabled)) {
      return;
    }
    interval = setIntervalFn(() => {
      void pollNow();
    }, pollIntervalMs);
  }

  function scheduleRetry(): void {
    if (retryTimeout || disposed || !rendererReady || (!settings.musicEnabled && !settings.gameEnabled)) {
      return;
    }
    const delayMs = Math.min(
      maxFailureBackoffMs,
      pollIntervalMs * (FAILURE_BACKOFF_MULTIPLIER ** Math.max(0, consecutiveFailures - 1))
    );
    retryTimeout = setTimeoutFn(() => {
      retryTimeout = null;
      void pollNow();
    }, delayMs);
  }

  function handleProbeFailure(): void {
    consecutiveFailures += 1;
    lastSampleAtMs = null;
    resetSignal(musicState);
    resetSignal(gameState);
    if (interval) {
      clearIntervalFn(interval);
      interval = null;
    }
    scheduleRetry();
  }

  function handleProbeSuccess(): void {
    consecutiveFailures = 0;
    startNormalPolling();
  }

  async function pollNow(): Promise<void> {
    if (disposed || !rendererReady || (!settings.musicEnabled && !settings.gameEnabled)) {
      return;
    }
    if (pollInFlight) {
      return pollInFlight;
    }

    const generation = sampleGeneration;
    pollInFlight = provider.sample()
      .then(async (result) => {
        if (disposed || generation !== sampleGeneration) {
          return;
        }
        providerStatus = result.status;
        mediaCapability = result.capabilities.media;
        gameCapability = result.capabilities.game;
        if (!isProbeUsable(result)) {
          handleProbeFailure();
          return;
        }
        handleProbeSuccess();
        await consumeSnapshot(result.snapshot);
      })
      .catch(() => {
        if (!disposed && generation === sampleGeneration) {
          handleProbeFailure();
        }
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
    clearRetryTimeout();
    sampleGeneration += 1;
    provider.cancelPending();
  }

  function startPolling(): void {
    if (interval || disposed || !rendererReady || (!settings.musicEnabled && !settings.gameEnabled)) {
      return;
    }
    void pollNow();
    startNormalPolling();
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
        stableGamePresenceState.stable = "unknown";
        resetGameCandidate();
      }

      if (!settings.musicEnabled && !settings.gameEnabled) {
        stopPolling();
        return;
      }
      startPolling();
    },
    setRendererReady(ready) {
      if (disposed || rendererReady === ready) {
        return;
      }
      rendererReady = ready;
      if (!rendererReady) {
        stopPolling();
        lastSampleAtMs = null;
        resetSignal(musicState);
        resetSignal(gameState);
        resetGameCandidate();
        return;
      }
      startPolling();
    },
    pollNow,
    getStatus() {
      const enabled = settings.musicEnabled || settings.gameEnabled;
      const monitorStatus: EnvironmentActionRuntimeStatus["monitorStatus"] = !enabled
        ? "stopped"
        : !rendererReady
          ? "waiting-for-renderer"
          : retryTimeout
            ? "backoff"
            : "polling";
      return {
        providerStatus,
        monitorStatus,
        mediaCapability,
        gameCapability
      };
    },
    resetStability() {
      lastSampleAtMs = null;
      sampleGeneration += 1;
      resetSignal(musicState);
      resetSignal(gameState);
      resetGameCandidate();
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
      resetGameCandidate();
      provider.dispose();
    }
  };
}
