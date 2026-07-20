export const COMPANION_ENVIRONMENT_SCHEMA_VERSION = 1 as const;

export const COMPANION_ENVIRONMENT_ACTIVITY_VALUES = [
  "active",
  "idle-short",
  "idle-long",
  "away",
  "locked",
  "suspended",
  "unknown"
] as const;
export const COMPANION_ENVIRONMENT_INTERRUPTIBILITY_VALUES = [
  "allowed",
  "suppressed",
  "presentation",
  "full-screen-activity",
  "unknown"
] as const;
export const COMPANION_ENVIRONMENT_MEDIA_VALUES = ["playing", "stopped", "unknown"] as const;
export const COMPANION_ENVIRONMENT_GAME_VALUES = ["active", "inactive", "unknown"] as const;
export const COMPANION_ENVIRONMENT_TIME_BAND_VALUES = [
  "morning",
  "daytime",
  "evening",
  "night",
  "unknown"
] as const;
export const COMPANION_ENVIRONMENT_CAPABILITY_VALUES = [
  "available",
  "unavailable",
  "unknown"
] as const;
export const COMPANION_ENVIRONMENT_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;
export const COMPANION_ENVIRONMENT_SOURCE_VALUES = [
  "power-monitor",
  "quns",
  "gsmtc",
  "user-explicit",
  "local-clock",
  "none"
] as const;

export type CompanionEnvironmentActivity = typeof COMPANION_ENVIRONMENT_ACTIVITY_VALUES[number];
export type CompanionEnvironmentInterruptibility =
  typeof COMPANION_ENVIRONMENT_INTERRUPTIBILITY_VALUES[number];
export type CompanionEnvironmentMedia = typeof COMPANION_ENVIRONMENT_MEDIA_VALUES[number];
export type CompanionEnvironmentGame = typeof COMPANION_ENVIRONMENT_GAME_VALUES[number];
export type CompanionEnvironmentTimeBand = typeof COMPANION_ENVIRONMENT_TIME_BAND_VALUES[number];
export type CompanionEnvironmentCapability = typeof COMPANION_ENVIRONMENT_CAPABILITY_VALUES[number];
export type CompanionEnvironmentConfidence = typeof COMPANION_ENVIRONMENT_CONFIDENCE_VALUES[number];
export type CompanionEnvironmentSource = typeof COMPANION_ENVIRONMENT_SOURCE_VALUES[number];

export type CompanionEnvironmentSignal<TValue extends string> = {
  value: TValue;
  source: CompanionEnvironmentSource;
  capability: CompanionEnvironmentCapability;
  confidence: CompanionEnvironmentConfidence | null;
  changedAtMs: number;
  stableSinceMs: number;
};

export type CompanionEnvironmentSignalInput<TValue extends string> = Omit<
  CompanionEnvironmentSignal<TValue>,
  "changedAtMs" | "stableSinceMs"
>;

export type CompanionEnvironmentSnapshot = {
  schemaVersion: typeof COMPANION_ENVIRONMENT_SCHEMA_VERSION;
  revision: number;
  updatedAtMs: number;
  activity: CompanionEnvironmentSignal<CompanionEnvironmentActivity>;
  interruptibility: CompanionEnvironmentSignal<CompanionEnvironmentInterruptibility>;
  media: CompanionEnvironmentSignal<CompanionEnvironmentMedia>;
  game: CompanionEnvironmentSignal<CompanionEnvironmentGame>;
  timeBand: CompanionEnvironmentSignal<CompanionEnvironmentTimeBand>;
};

export type CompanionEnvironmentSignalInputs = {
  activity: CompanionEnvironmentSignalInput<CompanionEnvironmentActivity>;
  interruptibility: CompanionEnvironmentSignalInput<CompanionEnvironmentInterruptibility>;
  media: CompanionEnvironmentSignalInput<CompanionEnvironmentMedia>;
  game: CompanionEnvironmentSignalInput<CompanionEnvironmentGame>;
  timeBand: CompanionEnvironmentSignalInput<CompanionEnvironmentTimeBand>;
};

export type CompanionEnvironmentSnapshotStore = {
  getSnapshot(): CompanionEnvironmentSnapshot;
  commit(signals: CompanionEnvironmentSnapshotSignals, updatedAtMs: number): CompanionEnvironmentSnapshot;
  subscribe(listener: (snapshot: CompanionEnvironmentSnapshot) => void): () => void;
};

export type CompanionEnvironmentSnapshotSignals = Pick<
  CompanionEnvironmentSnapshot,
  "activity" | "interruptibility" | "media" | "game" | "timeBand"
>;

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "revision",
  "updatedAtMs",
  "activity",
  "interruptibility",
  "media",
  "game",
  "timeBand"
] as const;
const SIGNAL_KEYS = [
  "value",
  "source",
  "capability",
  "confidence",
  "changedAtMs",
  "stableSinceMs"
] as const;
const SIGNAL_INPUT_KEYS = ["value", "source", "capability", "confidence"] as const;

const SIGNAL_SOURCES = {
  activity: ["power-monitor"],
  interruptibility: ["quns"],
  media: ["gsmtc"],
  game: ["user-explicit"],
  timeBand: ["local-clock"]
} as const satisfies Record<keyof CompanionEnvironmentSnapshotSignals, readonly CompanionEnvironmentSource[]>;

export function parseCompanionEnvironmentSnapshot(value: string): CompanionEnvironmentSnapshot | null {
  try {
    return normalizeCompanionEnvironmentSnapshot(JSON.parse(value.trim().replace(/^\uFEFF/, "")));
  } catch {
    return null;
  }
}

export function normalizeCompanionEnvironmentSnapshot(value: unknown): CompanionEnvironmentSnapshot | null {
  if (!hasExactKeys(value, SNAPSHOT_KEYS) || value.schemaVersion !== COMPANION_ENVIRONMENT_SCHEMA_VERSION) {
    return null;
  }
  const revision = value.revision;
  const updatedAtMs = value.updatedAtMs;
  if (!isTimestamp(revision) || !isTimestamp(updatedAtMs)) {
    return null;
  }

  const activity = normalizeSignal("activity", value.activity) as CompanionEnvironmentSnapshot["activity"] | null;
  const interruptibility = normalizeSignal(
    "interruptibility",
    value.interruptibility
  ) as CompanionEnvironmentSnapshot["interruptibility"] | null;
  const media = normalizeSignal("media", value.media) as CompanionEnvironmentSnapshot["media"] | null;
  const game = normalizeSignal("game", value.game) as CompanionEnvironmentSnapshot["game"] | null;
  const timeBand = normalizeSignal("timeBand", value.timeBand) as CompanionEnvironmentSnapshot["timeBand"] | null;
  if (!activity || !interruptibility || !media || !game || !timeBand) {
    return null;
  }

  const signals = { activity, interruptibility, media, game, timeBand };
  if (Object.values(signals).some((signal) => signal.changedAtMs > updatedAtMs)) {
    return null;
  }

  return freezeSnapshot({
    schemaVersion: COMPANION_ENVIRONMENT_SCHEMA_VERSION,
    revision,
    updatedAtMs,
    ...signals
  });
}

export function normalizeCompanionEnvironmentSignalInputs(
  value: unknown
): CompanionEnvironmentSignalInputs | null {
  if (!hasExactKeys(value, ["activity", "interruptibility", "media", "game", "timeBand"])) {
    return null;
  }
  const activity = normalizeSignalInput(
    "activity",
    value.activity
  ) as CompanionEnvironmentSignalInputs["activity"] | null;
  const interruptibility = normalizeSignalInput(
    "interruptibility",
    value.interruptibility
  ) as CompanionEnvironmentSignalInputs["interruptibility"] | null;
  const media = normalizeSignalInput("media", value.media) as CompanionEnvironmentSignalInputs["media"] | null;
  const game = normalizeSignalInput("game", value.game) as CompanionEnvironmentSignalInputs["game"] | null;
  const timeBand = normalizeSignalInput(
    "timeBand",
    value.timeBand
  ) as CompanionEnvironmentSignalInputs["timeBand"] | null;
  return activity && interruptibility && media && game && timeBand
    ? { activity, interruptibility, media, game, timeBand }
    : null;
}

export function createUnknownCompanionEnvironmentSnapshot(
  updatedAtMs = 0,
  revision = 0
): CompanionEnvironmentSnapshot {
  if (!isTimestamp(updatedAtMs) || !isTimestamp(revision)) {
    throw new TypeError("Companion environment snapshot timestamps must be non-negative integers");
  }
  const unknown = createUnknownSignal(updatedAtMs);
  return freezeSnapshot({
    schemaVersion: COMPANION_ENVIRONMENT_SCHEMA_VERSION,
    revision,
    updatedAtMs,
    activity: { ...unknown },
    interruptibility: { ...unknown },
    media: { ...unknown },
    game: { ...unknown },
    timeBand: { ...unknown }
  });
}

export function createCompanionEnvironmentSnapshotStore({
  initialSnapshot = createUnknownCompanionEnvironmentSnapshot()
}: {
  initialSnapshot?: CompanionEnvironmentSnapshot;
} = {}): CompanionEnvironmentSnapshotStore {
  const normalizedInitial = normalizeCompanionEnvironmentSnapshot(initialSnapshot);
  if (!normalizedInitial) {
    throw new TypeError("Invalid initial companion environment snapshot");
  }
  let current = normalizedInitial;
  const listeners = new Set<(snapshot: CompanionEnvironmentSnapshot) => void>();

  return {
    getSnapshot() {
      return current;
    },
    commit(signals, updatedAtMs) {
      if (!isTimestamp(updatedAtMs) || updatedAtMs < current.updatedAtMs) {
        return current;
      }
      const candidate = normalizeCompanionEnvironmentSnapshot({
        schemaVersion: COMPANION_ENVIRONMENT_SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAtMs,
        ...signals
      });
      if (!candidate || haveSameSignalValues(current, candidate)) {
        return current;
      }
      current = candidate;
      for (const listener of listeners) {
        listener(current);
      }
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

function normalizeSignal(
  key: keyof CompanionEnvironmentSnapshotSignals,
  value: unknown
): CompanionEnvironmentSignal<string> | null {
  if (!hasExactKeys(value, SIGNAL_KEYS) || !isTimestamp(value.changedAtMs) || !isTimestamp(value.stableSinceMs)) {
    return null;
  }
  if (value.stableSinceMs > value.changedAtMs) {
    return null;
  }
  const input = normalizeSignalInput(key, {
    value: value.value,
    source: value.source,
    capability: value.capability,
    confidence: value.confidence
  });
  return input ? {
    ...input,
    changedAtMs: value.changedAtMs,
    stableSinceMs: value.stableSinceMs
  } : null;
}

function normalizeSignalInput(
  key: keyof CompanionEnvironmentSnapshotSignals,
  value: unknown
): CompanionEnvironmentSignalInput<string> | null {
  if (!hasExactKeys(value, SIGNAL_INPUT_KEYS)) {
    return null;
  }
  if (!isSignalValue(key, value.value) || !isCompanionEnvironmentSource(value.source) ||
    !isCompanionEnvironmentCapability(value.capability) || !isConfidence(value.confidence)) {
    return null;
  }

  if (value.source === "none") {
    return value.value === "unknown" && value.capability === "unavailable" && value.confidence === null
      ? { value: value.value, source: value.source, capability: value.capability, confidence: value.confidence }
      : null;
  }
  if (!SIGNAL_SOURCES[key].includes(value.source as never)) {
    return null;
  }
  if (value.value === "unknown") {
    return value.capability === "unknown" && value.confidence === null
      ? { value: value.value, source: value.source, capability: value.capability, confidence: value.confidence }
      : null;
  }
  return value.capability === "available" && value.confidence !== null
    ? { value: value.value, source: value.source, capability: value.capability, confidence: value.confidence }
    : null;
}

function createUnknownSignal(timestampMs: number): CompanionEnvironmentSignal<"unknown"> {
  return {
    value: "unknown",
    source: "none",
    capability: "unavailable",
    confidence: null,
    changedAtMs: timestampMs,
    stableSinceMs: timestampMs
  };
}

function freezeSnapshot(snapshot: CompanionEnvironmentSnapshot): CompanionEnvironmentSnapshot {
  return Object.freeze({
    ...snapshot,
    activity: Object.freeze({ ...snapshot.activity }),
    interruptibility: Object.freeze({ ...snapshot.interruptibility }),
    media: Object.freeze({ ...snapshot.media }),
    game: Object.freeze({ ...snapshot.game }),
    timeBand: Object.freeze({ ...snapshot.timeBand })
  });
}

function haveSameSignalValues(
  left: CompanionEnvironmentSnapshot,
  right: CompanionEnvironmentSnapshot
): boolean {
  return (Object.keys(SIGNAL_SOURCES) as (keyof CompanionEnvironmentSnapshotSignals)[]).every((key) => {
    const leftSignal = left[key];
    const rightSignal = right[key];
    return leftSignal.value === rightSignal.value &&
      leftSignal.source === rightSignal.source &&
      leftSignal.capability === rightSignal.capability &&
      leftSignal.confidence === rightSignal.confidence;
  });
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const objectKeys = Object.keys(value);
  return objectKeys.length === keys.length && keys.every((key) => objectKeys.includes(key));
}

function isSignalValue(key: keyof CompanionEnvironmentSnapshotSignals, value: unknown): value is string {
  const values = key === "activity"
    ? COMPANION_ENVIRONMENT_ACTIVITY_VALUES
    : key === "interruptibility"
      ? COMPANION_ENVIRONMENT_INTERRUPTIBILITY_VALUES
      : key === "media"
        ? COMPANION_ENVIRONMENT_MEDIA_VALUES
        : key === "game"
          ? COMPANION_ENVIRONMENT_GAME_VALUES
          : COMPANION_ENVIRONMENT_TIME_BAND_VALUES;
  return values.includes(value as never);
}

function isCompanionEnvironmentSource(value: unknown): value is CompanionEnvironmentSource {
  return COMPANION_ENVIRONMENT_SOURCE_VALUES.includes(value as CompanionEnvironmentSource);
}

function isCompanionEnvironmentCapability(value: unknown): value is CompanionEnvironmentCapability {
  return COMPANION_ENVIRONMENT_CAPABILITY_VALUES.includes(value as CompanionEnvironmentCapability);
}

function isConfidence(value: unknown): value is CompanionEnvironmentConfidence | null {
  return value === null || COMPANION_ENVIRONMENT_CONFIDENCE_VALUES.includes(value as CompanionEnvironmentConfidence);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
