import type {
  EnvironmentActionRuntimeStatus,
  EnvironmentActionSettings
} from "../../../shared/environment-action-settings";
import {
  createEnvironmentSignalStabilizer,
  ENVIRONMENT_SIGNAL_MAX_SAMPLE_GAP_MS,
  type EnvironmentSignalStabilizer
} from "./environment-signal-stabilizer";
import type {
  CompanionEnvironmentInterruptibility,
  CompanionEnvironmentMedia,
  CompanionEnvironmentSignalInput,
  CompanionEnvironmentSignalInputs,
  CompanionEnvironmentSnapshot,
  CompanionEnvironmentTimeBand
} from "./companion-environment";
import {
  bucketIdleSeconds,
  type DesktopContextInterruptibilityProbeResult,
  type DesktopContextMediaProbeResult,
  type DesktopContextProvider,
  type DesktopContextProbeStatus
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
  getSnapshot(): CompanionEnvironmentSnapshot;
  lock(): void;
  unlock(): void;
  suspend(): void;
  resume(): void;
  resetStability(): void;
  dispose(): void;
};

type StableSignalState = {
  activeSinceMs: number | null;
  emitted: boolean;
  delivering: boolean;
  generation: number;
};

const DEFAULT_BASIC_SAMPLE_INTERVAL_MS = 5_000;
const DEFAULT_MEDIA_POLL_INTERVAL_MS = 5_000;
export const QUNS_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_FAILURE_BACKOFF_MS = 60_000;
const FAILURE_BACKOFF_MULTIPLIER = 2;
export const DESKTOP_CONTEXT_STABLE_DURATION_MS = 30_000;

const UNKNOWN_MEDIA_SIGNAL: CompanionEnvironmentSignalInput<CompanionEnvironmentMedia> = Object.freeze({
  value: "unknown",
  source: "none",
  capability: "unavailable",
  confidence: null
});

const UNKNOWN_INTERRUPTIBILITY_SIGNAL: CompanionEnvironmentSignalInput<CompanionEnvironmentInterruptibility> =
  Object.freeze({
    value: "unknown",
    source: "none",
    capability: "unavailable",
    confidence: null
  });

export function createDesktopContextMonitor({
  provider,
  sendReason,
  getSystemIdleTime = () => 0,
  now = Date.now,
  stabilizer = createEnvironmentSignalStabilizer({ now }),
  basicSampleIntervalMs = DEFAULT_BASIC_SAMPLE_INTERVAL_MS,
  mediaPollIntervalMs = DEFAULT_MEDIA_POLL_INTERVAL_MS,
  qunsPollIntervalMs = QUNS_POLL_INTERVAL_MS,
  stableDurationMs = DESKTOP_CONTEXT_STABLE_DURATION_MS,
  maxSampleGapMs = ENVIRONMENT_SIGNAL_MAX_SAMPLE_GAP_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  maxFailureBackoffMs = DEFAULT_MAX_FAILURE_BACKOFF_MS
}: {
  provider: DesktopContextProvider;
  sendReason(reason: DesktopContextStableReason): DesktopContextStableReasonDelivery;
  getSystemIdleTime?: () => number;
  now?: () => number;
  stabilizer?: EnvironmentSignalStabilizer;
  basicSampleIntervalMs?: number;
  mediaPollIntervalMs?: number;
  qunsPollIntervalMs?: number;
  stableDurationMs?: number;
  maxSampleGapMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  maxFailureBackoffMs?: number;
}): DesktopContextMonitor {
  let settings: EnvironmentActionSettings = {
    basicEnabled: false,
    musicEnabled: false,
    gameEnabled: false
  };
  let disposed = false;
  let suspended = false;
  let rendererReady = false;
  let basicInterval: ReturnType<typeof setInterval> | null = null;
  let mediaInterval: ReturnType<typeof setInterval> | null = null;
  let qunsInterval: ReturnType<typeof setInterval> | null = null;
  let mediaRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  let qunsRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  let mediaPollInFlight: Promise<void> | null = null;
  let qunsPollInFlight: Promise<void> | null = null;
  let basicGeneration = 0;
  let mediaGeneration = 0;
  let lastCollectionAtMs: number | null = null;
  let mediaFailureCount = 0;
  let qunsFailureCount = 0;
  let mediaStatus: DesktopContextProbeStatus | "unknown" = "unknown";
  let qunsStatus: DesktopContextProbeStatus | "unknown" = "unknown";
  let mediaSignal = { ...UNKNOWN_MEDIA_SIGNAL };
  let interruptibilitySignal = { ...UNKNOWN_INTERRUPTIBILITY_SIGNAL };
  const musicState: StableSignalState = {
    activeSinceMs: null,
    emitted: false,
    delivering: false,
    generation: 0
  };

  function resetSignal(state: StableSignalState): void {
    state.generation += 1;
    state.activeSinceMs = null;
    state.emitted = false;
    state.delivering = false;
  }

  function cancelSignalDelivery(state: StableSignalState): void {
    state.generation += 1;
    state.delivering = false;
  }

  function resetAllCandidates(): void {
    lastCollectionAtMs = null;
    stabilizer.reset();
    resetSignal(musicState);
  }

  function clearIntervalTimer(
    timer: ReturnType<typeof setInterval> | null
  ): null {
    if (timer) {
      clearIntervalFn(timer);
    }
    return null;
  }

  function clearRetryTimer(
    timer: ReturnType<typeof setTimeout> | null
  ): null {
    if (timer) {
      clearTimeoutFn(timer);
    }
    return null;
  }

  function stopBasicCollection(): void {
    basicGeneration += 1;
    basicInterval = clearIntervalTimer(basicInterval);
    qunsInterval = clearIntervalTimer(qunsInterval);
    qunsRetryTimeout = clearRetryTimer(qunsRetryTimeout);
    qunsPollInFlight = null;
    provider.cancelBasicPending();
    interruptibilitySignal = { ...UNKNOWN_INTERRUPTIBILITY_SIGNAL };
    qunsStatus = "unknown";
    qunsFailureCount = 0;
  }

  function stopMediaCollection(): void {
    mediaGeneration += 1;
    mediaInterval = clearIntervalTimer(mediaInterval);
    mediaRetryTimeout = clearRetryTimer(mediaRetryTimeout);
    mediaPollInFlight = null;
    provider.cancelMediaPending();
    mediaSignal = { ...UNKNOWN_MEDIA_SIGNAL };
    mediaStatus = "unknown";
    mediaFailureCount = 0;
  }

  function createProbeSignal<TValue extends CompanionEnvironmentMedia | CompanionEnvironmentInterruptibility>(
    result: { value: TValue; capability: "available" | "unavailable" | "unknown" },
    source: "gsmtc" | "quns"
  ): CompanionEnvironmentSignalInput<TValue> {
    if (result.value === "unknown" && result.capability === "unavailable") {
      return {
        value: result.value,
        source: "none",
        capability: "unavailable",
        confidence: null
      };
    }
    return {
      value: result.value,
      source,
      capability: result.capability,
      confidence: result.value === "unknown" ? null : "medium"
    };
  }

  function readActivitySignal(): CompanionEnvironmentSignalInputs["activity"] {
    if (!settings.basicEnabled) {
      return { value: "unknown", source: "none", capability: "unavailable", confidence: null };
    }
    try {
      const value = bucketIdleSeconds(getSystemIdleTime());
      return {
        value,
        source: "power-monitor",
        capability: value === "unknown" ? "unknown" : "available",
        confidence: value === "unknown" ? null : "high"
      };
    } catch {
      return { value: "unknown", source: "power-monitor", capability: "unknown", confidence: null };
    }
  }

  function readTimeBandSignal(timestampMs: number): CompanionEnvironmentSignalInputs["timeBand"] {
    if (!settings.basicEnabled) {
      return { value: "unknown", source: "none", capability: "unavailable", confidence: null };
    }
    const value = getLocalTimeBand(timestampMs);
    return {
      value,
      source: "local-clock",
      capability: value === "unknown" ? "unknown" : "available",
      confidence: value === "unknown" ? null : "high"
    };
  }

  async function evaluateMusicAction(value: CompanionEnvironmentMedia, timestampMs: number): Promise<void> {
    if (!settings.musicEnabled || value !== "playing") {
      resetSignal(musicState);
      return;
    }
    if (musicState.activeSinceMs === null) {
      musicState.activeSinceMs = timestampMs;
      return;
    }
    if (!rendererReady || musicState.emitted || musicState.delivering ||
      timestampMs - musicState.activeSinceMs < stableDurationMs) {
      return;
    }
    musicState.delivering = true;
    const generation = musicState.generation;
    try {
      if (await sendReason("state_music_playing_stable") &&
        musicState.generation === generation && settings.musicEnabled) {
        musicState.emitted = true;
      }
    } catch {
      // Keep a stable, approved reason eligible for retry after delivery failure.
    } finally {
      if (musicState.generation === generation) {
        musicState.delivering = false;
      }
    }
  }

  function prepareSampleTimestamp(): number | null {
    let timestampMs: number;
    try {
      timestampMs = now();
    } catch {
      resetAllCandidates();
      return null;
    }
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
      resetAllCandidates();
      return null;
    }
    if (lastCollectionAtMs !== null &&
      (timestampMs < lastCollectionAtMs || timestampMs - lastCollectionAtMs > maxSampleGapMs)) {
      resetAllCandidates();
    }
    lastCollectionAtMs = timestampMs;
    return timestampMs;
  }

  function collectBasicSignals(): CompanionEnvironmentSnapshot {
    const timestampMs = prepareSampleTimestamp();
    return timestampMs === null
      ? stabilizer.getSnapshot()
      : stabilizer.samplePartial({
      activity: readActivitySignal(),
      timeBand: readTimeBandSignal(timestampMs)
    });
  }

  function collectInterruptibilitySignal(): CompanionEnvironmentSnapshot {
    return prepareSampleTimestamp() === null
      ? stabilizer.getSnapshot()
      : stabilizer.samplePartial({ interruptibility: interruptibilitySignal });
  }

  function collectMediaSignal(): CompanionEnvironmentSnapshot {
    const timestampMs = prepareSampleTimestamp();
    if (timestampMs === null) {
      return stabilizer.getSnapshot();
    }
    const snapshot = stabilizer.samplePartial({ media: mediaSignal });
    void evaluateMusicAction(settings.musicEnabled ? mediaSignal.value : "unknown", timestampMs);
    return snapshot;
  }

  function handleProviderFailure(): void {
    resetAllCandidates();
  }

  function startQunsInterval(): void {
    qunsRetryTimeout = clearRetryTimer(qunsRetryTimeout);
    if (qunsInterval || disposed || suspended || !settings.basicEnabled) {
      return;
    }
    qunsInterval = setIntervalFn(() => {
      void pollQuns();
    }, qunsPollIntervalMs);
  }

  function startMediaInterval(): void {
    mediaRetryTimeout = clearRetryTimer(mediaRetryTimeout);
    if (mediaInterval || disposed || suspended || !settings.musicEnabled) {
      return;
    }
    mediaInterval = setIntervalFn(() => {
      void pollMedia();
    }, mediaPollIntervalMs);
  }

  function scheduleQunsRetry(): void {
    if (qunsRetryTimeout || disposed || suspended || !settings.basicEnabled) {
      return;
    }
    const delayMs = Math.min(
      maxFailureBackoffMs,
      qunsPollIntervalMs * (FAILURE_BACKOFF_MULTIPLIER ** Math.max(0, qunsFailureCount - 1))
    );
    qunsRetryTimeout = setTimeoutFn(() => {
      qunsRetryTimeout = null;
      void pollQuns();
    }, delayMs);
  }

  function scheduleMediaRetry(): void {
    if (mediaRetryTimeout || disposed || suspended || !settings.musicEnabled) {
      return;
    }
    const delayMs = Math.min(
      maxFailureBackoffMs,
      mediaPollIntervalMs * (FAILURE_BACKOFF_MULTIPLIER ** Math.max(0, mediaFailureCount - 1))
    );
    mediaRetryTimeout = setTimeoutFn(() => {
      mediaRetryTimeout = null;
      void pollMedia();
    }, delayMs);
  }

  function acceptQunsResult(result: DesktopContextInterruptibilityProbeResult): void {
    qunsStatus = result.status;
    interruptibilitySignal = createProbeSignal(result, "quns");
    if (result.status === "failed") {
      qunsFailureCount += 1;
      qunsInterval = clearIntervalTimer(qunsInterval);
      handleProviderFailure();
      scheduleQunsRetry();
      return;
    }
    qunsFailureCount = 0;
    startQunsInterval();
  }

  function acceptMediaResult(result: DesktopContextMediaProbeResult): void {
    mediaStatus = result.status;
    mediaSignal = createProbeSignal(result, "gsmtc");
    if (result.status === "failed") {
      mediaFailureCount += 1;
      mediaInterval = clearIntervalTimer(mediaInterval);
      handleProviderFailure();
      scheduleMediaRetry();
      return;
    }
    mediaFailureCount = 0;
    startMediaInterval();
  }

  function pollQuns(): Promise<void> {
    if (disposed || suspended || !settings.basicEnabled) {
      return Promise.resolve();
    }
    if (qunsPollInFlight) {
      return qunsPollInFlight;
    }
    const generation = basicGeneration;
    const request = Promise.resolve()
      .then(() => provider.sampleInterruptibility())
      .then((result) => {
        if (!disposed && !suspended && settings.basicEnabled && generation === basicGeneration) {
          acceptQunsResult(result);
          collectInterruptibilitySignal();
        }
      })
      .catch(() => {
        if (!disposed && !suspended && settings.basicEnabled && generation === basicGeneration) {
          acceptQunsResult({ status: "failed", value: "unknown", capability: "unknown" });
          collectInterruptibilitySignal();
        }
      })
      .finally(() => {
        if (qunsPollInFlight === request) {
          qunsPollInFlight = null;
        }
      });
    qunsPollInFlight = request;
    return request;
  }

  function pollMedia(): Promise<void> {
    if (disposed || suspended || !settings.musicEnabled) {
      return Promise.resolve();
    }
    if (mediaPollInFlight) {
      return mediaPollInFlight;
    }
    const generation = mediaGeneration;
    const request = Promise.resolve()
      .then(() => provider.sampleMedia())
      .then((result) => {
        if (!disposed && !suspended && settings.musicEnabled && generation === mediaGeneration) {
          acceptMediaResult(result);
          collectMediaSignal();
        }
      })
      .catch(() => {
        if (!disposed && !suspended && settings.musicEnabled && generation === mediaGeneration) {
          acceptMediaResult({ status: "failed", value: "unknown", capability: "unknown" });
          collectMediaSignal();
        }
      })
      .finally(() => {
        if (mediaPollInFlight === request) {
          mediaPollInFlight = null;
        }
      });
    mediaPollInFlight = request;
    return request;
  }

  function startBasicCollection(): void {
    if (disposed || suspended || !settings.basicEnabled) {
      return;
    }
    if (!basicInterval) {
      basicInterval = setIntervalFn(collectBasicSignals, basicSampleIntervalMs);
    }
    void pollQuns();
    startQunsInterval();
    collectBasicSignals();
  }

  function startMediaCollection(): void {
    if (disposed || suspended || !settings.musicEnabled) {
      return;
    }
    void pollMedia();
    startMediaInterval();
  }

  function startCollection(): void {
    startBasicCollection();
    startMediaCollection();
  }

  function stopAllCollection(): void {
    stopBasicCollection();
    stopMediaCollection();
  }

  function getProviderStatus(): EnvironmentActionRuntimeStatus["providerStatus"] {
    const statuses = [
      ...(settings.basicEnabled ? [qunsStatus] : []),
      ...(settings.musicEnabled ? [mediaStatus] : [])
    ];
    if (statuses.length === 0) {
      return "unavailable";
    }
    if (statuses.includes("failed")) {
      return "failed";
    }
    if (statuses.includes("unknown")) {
      return "unknown";
    }
    return statuses.every((status) => status === "available") ? "available" : "unavailable";
  }

  return {
    updateSettings(nextSettings) {
      if (disposed) {
        return;
      }
      const basicChanged = settings.basicEnabled !== nextSettings.basicEnabled;
      const musicChanged = settings.musicEnabled !== nextSettings.musicEnabled;
      const gameChanged = settings.gameEnabled !== nextSettings.gameEnabled;
      if (!basicChanged && !musicChanged && !gameChanged) {
        return;
      }
      if (basicChanged) {
        stopBasicCollection();
      }
      if (musicChanged) {
        stopMediaCollection();
      }
      const disabledSetting = (settings.basicEnabled && !nextSettings.basicEnabled) ||
        (settings.musicEnabled && !nextSettings.musicEnabled) ||
        (settings.gameEnabled && !nextSettings.gameEnabled);
      if (disabledSetting) {
        resetAllCandidates();
      } else if (basicChanged || musicChanged) {
        stabilizer.reset();
      }
      settings = { ...nextSettings };
      if (basicChanged) {
        startBasicCollection();
      }
      if (musicChanged) {
        startMediaCollection();
      }
    },
    setRendererReady(ready) {
      if (disposed) {
        return;
      }
      rendererReady = ready;
      if (!rendererReady) {
        cancelSignalDelivery(musicState);
        return;
      }
      let timestampMs: number;
      try {
        timestampMs = now();
      } catch {
        resetAllCandidates();
        return;
      }
      if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
        resetAllCandidates();
        return;
      }
      void evaluateMusicAction(mediaSignal.value, timestampMs);
    },
    async pollNow() {
      if (disposed || suspended) {
        return;
      }
      await Promise.all([
        settings.basicEnabled ? pollQuns() : Promise.resolve(),
        settings.musicEnabled ? pollMedia() : Promise.resolve()
      ]);
      if (settings.basicEnabled) {
        collectBasicSignals();
      }
    },
    getStatus() {
      const enabled = settings.basicEnabled || settings.musicEnabled;
      return {
        providerStatus: getProviderStatus(),
        monitorStatus: !enabled || suspended
          ? "stopped"
          : qunsRetryTimeout || mediaRetryTimeout
            ? "backoff"
            : "polling",
        mediaCapability: settings.musicEnabled ? mediaSignal.capability : "unavailable",
        gameCapability: "unavailable"
      };
    },
    getSnapshot: () => stabilizer.getSnapshot(),
    lock() {
      if (!disposed) {
        stabilizer.lock();
      }
    },
    unlock() {
      if (!disposed) {
        stabilizer.unlock();
        if (settings.basicEnabled && !suspended) {
          collectBasicSignals();
        }
      }
    },
    suspend() {
      if (disposed || suspended) {
        return;
      }
      suspended = true;
      stabilizer.suspend();
      stopAllCollection();
      resetAllCandidates();
    },
    resume() {
      if (disposed || !suspended) {
        return;
      }
      suspended = false;
      resetAllCandidates();
      stabilizer.resume();
      startCollection();
    },
    resetStability() {
      if (!disposed) {
        resetAllCandidates();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopAllCollection();
      resetAllCandidates();
      stabilizer.dispose();
      provider.dispose();
    }
  };
}

export function getLocalTimeBand(timestampMs: number): CompanionEnvironmentTimeBand {
  const date = new Date(timestampMs);
  const hour = date.getHours();
  if (!Number.isInteger(hour)) {
    return "unknown";
  }
  if (hour >= 5 && hour < 12) {
    return "morning";
  }
  if (hour >= 12 && hour < 18) {
    return "daytime";
  }
  if (hour >= 18 && hour < 22) {
    return "evening";
  }
  return "night";
}
