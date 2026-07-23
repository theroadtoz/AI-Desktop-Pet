import {
  createCalmXitaAffect,
  getXitaAffectVector,
  isXitaAffectIntensity,
  isXitaAffectState,
  type XitaAffectSnapshot
} from "../../../shared/companion-affect.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

export const XITA_AFFECT_STORE_VERSION = 1 as const;
export const XITA_AFFECT_RESTART_RECOVERY_MS = 15 * 60_000;

type StoredXitaAffect = {
  version: typeof XITA_AFFECT_STORE_VERSION;
  state: XitaAffectSnapshot["state"];
  intensity: Exclude<XitaAffectSnapshot["intensity"], "high">;
  timestampMs: number;
};

export type XitaAffectStore = {
  load(): XitaAffectSnapshot;
  save(snapshot: XitaAffectSnapshot): void;
  getStatePath(): string;
};

export function createXitaAffectStore({
  userDataPath,
  now = Date.now,
  recoveryMs = XITA_AFFECT_RESTART_RECOVERY_MS
}: {
  userDataPath: string;
  now?: () => number;
  recoveryMs?: number;
}): XitaAffectStore {
  const statePath = join(userDataPath, "config", "xita-affect-state.json");

  return {
    load() {
      const timestampMs = now();
      const stored = readStoredState(statePath);
      if (
        !stored ||
        stored.timestampMs > timestampMs ||
        timestampMs - stored.timestampMs > Math.max(1, recoveryMs)
      ) {
        return createCalmXitaAffect(timestampMs);
      }

      const vector = getXitaAffectVector(stored.state);
      return {
        state: stored.state,
        intensity: stored.intensity,
        valence: vector.valence,
        arousal: vector.arousal,
        transitionReason: "restart-recovery",
        updatedAtMs: timestampMs,
        lastReinforcedAtMs: stored.timestampMs
      };
    },
    save(snapshot) {
      const stored: StoredXitaAffect = snapshot.intensity === "high"
        ? {
            version: XITA_AFFECT_STORE_VERSION,
            state: "calm",
            intensity: "low",
            timestampMs: snapshot.lastReinforcedAtMs
          }
        : {
            version: XITA_AFFECT_STORE_VERSION,
            state: snapshot.state,
            intensity: snapshot.intensity,
            timestampMs: snapshot.lastReinforcedAtMs
          };
      writeAtomically(statePath, `${JSON.stringify(stored, null, 2)}\n`);
    },
    getStatePath() {
      return statePath;
    }
  };
}

function readStoredState(path: string): StoredXitaAffect | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseStoredState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function parseStoredState(value: unknown): StoredXitaAffect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "intensity" ||
    keys[1] !== "state" ||
    keys[2] !== "timestampMs" ||
    keys[3] !== "version" ||
    record.version !== XITA_AFFECT_STORE_VERSION ||
    !isXitaAffectState(record.state) ||
    !isXitaAffectIntensity(record.intensity) ||
    record.intensity === "high" ||
    typeof record.timestampMs !== "number" ||
    !Number.isSafeInteger(record.timestampMs) ||
    record.timestampMs < 0
  ) {
    return null;
  }
  return record as StoredXitaAffect;
}

function writeAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, content, "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
}
