import {
  createCompanionEnvironmentSnapshotStore,
  type CompanionEnvironmentActivity,
  type CompanionEnvironmentSignal,
  type CompanionEnvironmentSignalInput,
  type CompanionEnvironmentSignalInputs,
  type CompanionEnvironmentSnapshot,
  type CompanionEnvironmentSnapshotSignals,
  type CompanionEnvironmentSnapshotStore,
  normalizeCompanionEnvironmentSignalInputs
} from "./companion-environment";

export const ENVIRONMENT_SIGNAL_STABLE_SAMPLE_COUNT = 2;
export const ENVIRONMENT_SIGNAL_STABLE_DURATION_MS = 5_000;
export const ENVIRONMENT_SIGNAL_MAX_SAMPLE_GAP_MS = 15_000;

export const COMPANION_ENVIRONMENT_ACTIVITY_PRIORITY = [
  "suspended",
  "locked",
  "away",
  "idle-long",
  "idle-short",
  "active",
  "unknown"
] as const satisfies readonly CompanionEnvironmentActivity[];

type SignalKey = keyof CompanionEnvironmentSnapshotSignals;
type Candidate = {
  input: CompanionEnvironmentSignalInput<string>;
  sinceMs: number;
  lastSampleAtMs: number;
  sampleCount: number;
};

export type EnvironmentSignalStabilizer = {
  sample(signals: CompanionEnvironmentSignalInputs): CompanionEnvironmentSnapshot;
  samplePartial(signals: Partial<CompanionEnvironmentSignalInputs>): CompanionEnvironmentSnapshot;
  lock(): CompanionEnvironmentSnapshot;
  suspend(): CompanionEnvironmentSnapshot;
  unlock(): CompanionEnvironmentSnapshot;
  resume(): CompanionEnvironmentSnapshot;
  reset(): void;
  getSnapshot(): CompanionEnvironmentSnapshot;
  subscribe(listener: (snapshot: CompanionEnvironmentSnapshot) => void): () => void;
  dispose(): void;
};

export function selectHighestPriorityActivity(
  values: readonly CompanionEnvironmentActivity[]
): CompanionEnvironmentActivity {
  for (const value of COMPANION_ENVIRONMENT_ACTIVITY_PRIORITY) {
    if (values.includes(value)) {
      return value;
    }
  }
  return "unknown";
}

export function createEnvironmentSignalStabilizer({
  now = Date.now,
  snapshotStore = createCompanionEnvironmentSnapshotStore(),
  stableDurationMs = ENVIRONMENT_SIGNAL_STABLE_DURATION_MS,
  maxSampleGapMs = ENVIRONMENT_SIGNAL_MAX_SAMPLE_GAP_MS
}: {
  now?: () => number;
  snapshotStore?: CompanionEnvironmentSnapshotStore;
  stableDurationMs?: number;
  maxSampleGapMs?: number;
} = {}): EnvironmentSignalStabilizer {
  const candidates = new Map<SignalKey, Candidate>();
  let lastSampleAtMs: number | null = null;
  let locked = false;
  let suspended = false;
  let disposed = false;

  function resetCandidates(): void {
    candidates.clear();
    lastSampleAtMs = null;
  }

  function currentTime(): number | null {
    const timestampMs = now();
    return isTimestamp(timestampMs) ? timestampMs : null;
  }

  function createActivityOverride(value: "locked" | "suspended" | "unknown"):
    CompanionEnvironmentSignalInput<CompanionEnvironmentActivity> {
    return {
      value,
      source: "power-monitor",
      capability: value === "unknown" ? "unknown" : "available",
      confidence: value === "unknown" ? null : "high"
    };
  }

  function effectiveActivity(activity: CompanionEnvironmentSignalInput<CompanionEnvironmentActivity>) {
    const value = selectHighestPriorityActivity([
      activity.value,
      ...(locked ? ["locked" as const] : []),
      ...(suspended ? ["suspended" as const] : [])
    ]);
    return value === activity.value
      ? activity
      : createActivityOverride(value as "locked" | "suspended" | "unknown");
  }

  function commitImmediately(
    key: SignalKey,
    input: CompanionEnvironmentSignalInput<string>,
    timestampMs: number
  ): CompanionEnvironmentSnapshot {
    const current = snapshotStore.getSnapshot();
    const signal: CompanionEnvironmentSignal<string> = {
      ...input,
      changedAtMs: timestampMs,
      stableSinceMs: timestampMs
    };
    return snapshotStore.commit(replaceSignal(current, key, signal), timestampMs);
  }

  function consider(
    key: SignalKey,
    input: CompanionEnvironmentSignalInput<string>,
    timestampMs: number
  ): CompanionEnvironmentSignal<string> | null {
    const candidate = candidates.get(key);
    if (!candidate || !sameInput(candidate.input, input)) {
      candidates.set(key, {
        input: { ...input },
        sinceMs: timestampMs,
        lastSampleAtMs: timestampMs,
        sampleCount: 1
      });
      return null;
    }
    candidate.lastSampleAtMs = timestampMs;
    candidate.sampleCount += 1;
    if (
      candidate.sampleCount < ENVIRONMENT_SIGNAL_STABLE_SAMPLE_COUNT ||
      timestampMs - candidate.sinceMs < stableDurationMs
    ) {
      return null;
    }
    candidates.delete(key);
    return {
      ...candidate.input,
      changedAtMs: timestampMs,
      stableSinceMs: candidate.sinceMs
    };
  }

  function transitionAfterLifecycleRelease(): CompanionEnvironmentSnapshot {
    resetCandidates();
    const timestampMs = currentTime();
    const value = suspended ? "suspended" : locked ? "locked" : "unknown";
    return timestampMs === null
      ? snapshotStore.getSnapshot()
      : commitImmediately("activity", createActivityOverride(value), timestampMs);
  }

  function sampleSignals(
    signals: Partial<CompanionEnvironmentSignalInputs>,
    keys: readonly SignalKey[]
  ): CompanionEnvironmentSnapshot {
    if (disposed) {
      return snapshotStore.getSnapshot();
    }
    const normalized = normalizePartialInputs(signals, keys);
    const timestampMs = currentTime();
    if (!normalized || timestampMs === null) {
      resetCandidates();
      return snapshotStore.getSnapshot();
    }
    if (
      lastSampleAtMs !== null &&
      (timestampMs < lastSampleAtMs || timestampMs - lastSampleAtMs > maxSampleGapMs)
    ) {
      resetCandidates();
    }
    if (keys.some((key) => {
      const candidate = candidates.get(key);
      return candidate !== undefined && timestampMs - candidate.lastSampleAtMs > maxSampleGapMs;
    })) {
      resetCandidates();
    }
    lastSampleAtMs = timestampMs;
    let nextSignals: CompanionEnvironmentSnapshotSignals | null = null;
    for (const key of keys) {
      const input = key === "activity"
        ? effectiveActivity(normalized.activity)
        : normalized[key];
      const stableSignal = consider(key, input, timestampMs);
      if (stableSignal) {
        nextSignals = replaceSignal(
          nextSignals ?? snapshotStore.getSnapshot(),
          key,
          stableSignal
        );
      }
    }
    if (nextSignals) {
      snapshotStore.commit(nextSignals, timestampMs);
    }
    return snapshotStore.getSnapshot();
  }

  return {
    sample(signals) {
      return sampleSignals(signals, SIGNAL_KEYS);
    },
    samplePartial(signals) {
      const keys = Object.keys(signals);
      if (keys.length === 0 || keys.some((key) => !SIGNAL_KEYS.includes(key as SignalKey))) {
        resetCandidates();
        return snapshotStore.getSnapshot();
      }
      return sampleSignals(signals, keys as SignalKey[]);
    },
    lock() {
      if (disposed) {
        return snapshotStore.getSnapshot();
      }
      locked = true;
      candidates.delete("activity");
      const timestampMs = currentTime();
      return timestampMs === null
        ? snapshotStore.getSnapshot()
        : commitImmediately("activity", createActivityOverride("locked"), timestampMs);
    },
    suspend() {
      if (disposed) {
        return snapshotStore.getSnapshot();
      }
      suspended = true;
      candidates.delete("activity");
      const timestampMs = currentTime();
      return timestampMs === null
        ? snapshotStore.getSnapshot()
        : commitImmediately("activity", createActivityOverride("suspended"), timestampMs);
    },
    unlock() {
      if (disposed) {
        return snapshotStore.getSnapshot();
      }
      locked = false;
      return transitionAfterLifecycleRelease();
    },
    resume() {
      if (disposed) {
        return snapshotStore.getSnapshot();
      }
      suspended = false;
      return transitionAfterLifecycleRelease();
    },
    reset: resetCandidates,
    getSnapshot: () => snapshotStore.getSnapshot(),
    subscribe(listener) {
      return disposed ? () => undefined : snapshotStore.subscribe(listener);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resetCandidates();
    }
  };
}

const SIGNAL_KEYS = ["activity", "interruptibility", "media", "game", "timeBand"] as const;

const UNKNOWN_INPUTS: CompanionEnvironmentSignalInputs = {
  activity: { value: "unknown", source: "none", capability: "unavailable", confidence: null },
  interruptibility: { value: "unknown", source: "none", capability: "unavailable", confidence: null },
  media: { value: "unknown", source: "none", capability: "unavailable", confidence: null },
  game: { value: "unknown", source: "none", capability: "unavailable", confidence: null },
  timeBand: { value: "unknown", source: "none", capability: "unavailable", confidence: null }
};

function normalizePartialInputs(
  signals: Partial<CompanionEnvironmentSignalInputs>,
  keys: readonly SignalKey[]
): CompanionEnvironmentSignalInputs | null {
  const normalized = normalizeCompanionEnvironmentSignalInputs({ ...UNKNOWN_INPUTS, ...signals });
  return normalized && keys.every((key) => signals[key] !== undefined) ? normalized : null;
}

function sameInput(
  left: CompanionEnvironmentSignalInput<string>,
  right: CompanionEnvironmentSignalInput<string>
): boolean {
  return left.value === right.value &&
    left.source === right.source &&
    left.capability === right.capability &&
    left.confidence === right.confidence;
}

function replaceSignal(
  snapshot: CompanionEnvironmentSnapshotSignals,
  key: SignalKey,
  signal: CompanionEnvironmentSignal<string>
): CompanionEnvironmentSnapshotSignals {
  return {
    activity: key === "activity" ? signal as CompanionEnvironmentSnapshotSignals["activity"] : snapshot.activity,
    interruptibility: key === "interruptibility"
      ? signal as CompanionEnvironmentSnapshotSignals["interruptibility"]
      : snapshot.interruptibility,
    media: key === "media" ? signal as CompanionEnvironmentSnapshotSignals["media"] : snapshot.media,
    game: key === "game" ? signal as CompanionEnvironmentSnapshotSignals["game"] : snapshot.game,
    timeBand: key === "timeBand" ? signal as CompanionEnvironmentSnapshotSignals["timeBand"] : snapshot.timeBand
  };
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
