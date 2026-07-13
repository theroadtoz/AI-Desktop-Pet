import {
  getPetMotionPreset,
  PET_MOTION_PRESETS,
  type PetMotionPresetId
} from "../../../shared/pet-motion-presets.ts";
import type { ModelMotionPreset } from "../../../shared/model-manifest";
import type { CubismModel } from "./vendor/framework/model/cubismmodel";
import type { CubismMotion } from "./vendor/framework/motion/cubismmotion";

type LoadedMotion = {
  motion: CubismMotion;
  controlledParameterIds: ReadonlySet<string>;
};

type MotionLoad = Promise<LoadedMotion | null>;
type MotionHandle = unknown;

type MotionManager = {
  startMotionPriority(motion: CubismMotion, autoDelete: boolean, priority: number): MotionHandle;
  updateMotion(model: CubismModel, deltaSeconds: number): boolean;
  getCubismMotionQueueEntry(handle: MotionHandle): { isStarted(): boolean } | null;
  isFinishedByHandle(handle: MotionHandle): boolean;
  stopAllMotions(): void;
  release(): void;
};

export type CubismMotionLifecycleState =
  | "queued"
  | "started"
  | "completed"
  | "interrupted"
  | "timed_out"
  | "failed";

export type CubismMotionTerminalState = Extract<
  CubismMotionLifecycleState,
  "completed" | "interrupted" | "timed_out" | "failed"
>;

export type CubismMotionStopReason = Extract<
  CubismMotionTerminalState,
  "interrupted" | "timed_out"
>;

export type CubismMotionTerminalResult = {
  status: CubismMotionTerminalState;
  motionPresetId: PetMotionPresetId;
};

export type CubismMotionPlayback = {
  readonly state: CubismMotionLifecycleState;
  readonly terminal: Promise<CubismMotionTerminalResult>;
  onStateChange(listener: (state: CubismMotionLifecycleState) => void): () => void;
  onTerminal(listener: (result: CubismMotionTerminalResult) => void): () => void;
};

export type CubismMotionSkipReason =
  | "no_semantic_motion_presets"
  | "unknown_motion_preset"
  | "motion_load_failed"
  | "motion_start_failed"
  | "motion_start_cancelled";

export type CubismMotionPlaybackResult =
  | {
      status: "started";
      motionPresetId: PetMotionPresetId;
      durationMs: number;
      playback: CubismMotionPlayback;
    }
  | {
      status: "skipped";
      skipReason: CubismMotionSkipReason;
      motionPresetId?: PetMotionPresetId;
    };

export type CubismMotionController = {
  playMotionPreset(motionPresetId: PetMotionPresetId): Promise<CubismMotionPlaybackResult>;
  update(model: CubismModel, deltaSeconds: number): ReadonlySet<string>;
  stop(reason: CubismMotionStopReason): void;
  release(): void;
};

export type CubismMotionControllerDependencies = {
  motionPresets?: readonly ModelMotionPreset[];
  getMotionPreset?: (motionPresetId: PetMotionPresetId) => ModelMotionPreset | null;
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>;
  createMotion?: (buffer: ArrayBuffer) => CubismMotion | null;
  manager?: MotionManager;
};

type PlaybackRecord = {
  handle: MotionHandle;
  controlledParameterIds: ReadonlySet<string>;
  playback: CubismMotionPlayback;
  transition(state: CubismMotionLifecycleState): void;
  settle(status: CubismMotionTerminalState): void;
};

function resolveModelAssetUrl(relativePath: string): string {
  return `pet-model://witch/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }

  return await response.arrayBuffer();
}

export function parseControlledParameterIds(buffer: ArrayBuffer): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(buffer));

  if (!parsed || typeof parsed !== "object" || !("Curves" in parsed) || !Array.isArray(parsed.Curves)) {
    throw new Error("motion JSON must contain a Curves array");
  }

  const parameterIds = new Set<string>();

  for (const curve of parsed.Curves) {
    if (
      curve &&
      typeof curve === "object" &&
      "Target" in curve &&
      curve.Target === "Parameter" &&
      "Id" in curve &&
      typeof curve.Id === "string" &&
      curve.Id.length > 0
    ) {
      parameterIds.add(curve.Id);
    }
  }

  return parameterIds;
}

function createPlaybackRecord(
  handle: MotionHandle,
  motionPresetId: PetMotionPresetId,
  controlledParameterIds: ReadonlySet<string>
): PlaybackRecord {
  let state: CubismMotionLifecycleState = "queued";
  let terminalResult: CubismMotionTerminalResult | null = null;
  let settleTerminal: (result: CubismMotionTerminalResult) => void = () => undefined;
  const listeners = new Set<(nextState: CubismMotionLifecycleState) => void>();
  const terminalListeners = new Set<(result: CubismMotionTerminalResult) => void>();
  const terminal = new Promise<CubismMotionTerminalResult>((resolve) => {
    settleTerminal = resolve;
  });
  const playback: CubismMotionPlayback = {
    get state() {
      return state;
    },
    terminal,
    onStateChange(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    onTerminal(listener) {
      if (terminalResult) {
        listener(terminalResult);
        return () => undefined;
      }

      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    }
  };

  function transition(nextState: CubismMotionLifecycleState): void {
    if (state === nextState || state === "completed" || state === "interrupted" || state === "timed_out" || state === "failed") {
      return;
    }

    state = nextState;
    for (const listener of listeners) {
      listener(state);
    }
  }

  return {
    handle,
    controlledParameterIds,
    playback,
    transition,
    settle(status) {
      if (state === "completed" || state === "interrupted" || state === "timed_out" || state === "failed") {
        return;
      }

      transition(status);
      const result = { status, motionPresetId };
      terminalResult = result;
      settleTerminal(result);
      for (const listener of terminalListeners) {
        listener(result);
      }
      terminalListeners.clear();
    }
  };
}

export async function createCubismMotionController(
  dependencies: CubismMotionControllerDependencies = {}
): Promise<CubismMotionController> {
  let manager = dependencies.manager;
  let createMotion = dependencies.createMotion;

  if (!manager || !createMotion) {
    const [{ CubismMotion }, { CubismMotionManager }] = await Promise.all([
      import("./vendor/framework/motion/cubismmotion"),
      import("./vendor/framework/motion/cubismmotionmanager")
    ]);
    manager ??= new CubismMotionManager();
    createMotion ??= (buffer) => CubismMotion.create(buffer, buffer.byteLength);
  }

  if (!manager || !createMotion) {
    throw new Error("Cubism motion runtime failed to initialize");
  }

  const motionPresets = dependencies.motionPresets ?? PET_MOTION_PRESETS;
  const resolvePreset = dependencies.getMotionPreset ?? getPetMotionPreset;
  const fetchMotionBuffer = dependencies.fetchArrayBuffer ?? fetchArrayBuffer;
  const motionCache = new Map<PetMotionPresetId, LoadedMotion>();
  const motionLoads = new Map<PetMotionPresetId, MotionLoad>();
  const activeMotions = new Map<MotionHandle, PlaybackRecord>();
  const instantiateMotion = createMotion;
  let requestGeneration = 0;
  let released = false;

  async function loadMotion(motionPresetId: PetMotionPresetId): MotionLoad {
    const cached = motionCache.get(motionPresetId);

    if (cached) {
      return cached;
    }

    const pending = motionLoads.get(motionPresetId);

    if (pending) {
      return await pending;
    }

    const preset = resolvePreset(motionPresetId);

    if (!preset) {
      return null;
    }

    const load = (async () => {
      const buffer = await fetchMotionBuffer(resolveModelAssetUrl(preset.path));
      const controlledParameterIds = parseControlledParameterIds(buffer);

      if (released) {
        return null;
      }

      const motion = instantiateMotion(buffer);

      if (!motion) {
        return null;
      }

      motion.setEffectIds([], []);
      motion.setFadeInTime(preset.fadeInSeconds);
      motion.setFadeOutTime(preset.fadeOutSeconds);
      motion.setLoop(preset.loop);
      const loadedMotion = { motion, controlledParameterIds };
      motionCache.set(motionPresetId, loadedMotion);
      return loadedMotion;
    })();
    motionLoads.set(motionPresetId, load);

    try {
      return await load;
    } finally {
      motionLoads.delete(motionPresetId);
    }
  }

  function stopActiveMotions(reason: CubismMotionStopReason): void {
    for (const activeMotion of activeMotions.values()) {
      const terminalState = reason === "timed_out" && activeMotion.playback.state !== "started"
        ? "interrupted"
        : reason;
      activeMotion.settle(terminalState);
    }
  }

  return {
    async playMotionPreset(motionPresetId): Promise<CubismMotionPlaybackResult> {
      if (motionPresets.length === 0) {
        return {
          status: "skipped",
          skipReason: "no_semantic_motion_presets"
        };
      }

      const preset = resolvePreset(motionPresetId);

      if (!preset) {
        return {
          status: "skipped",
          skipReason: "unknown_motion_preset"
        };
      }

      const generation = ++requestGeneration;
      let loadedMotion: LoadedMotion | null = null;

      try {
        loadedMotion = await loadMotion(motionPresetId);
      } catch {
        return {
          status: "skipped",
          skipReason: "motion_load_failed",
          motionPresetId
        };
      }

      if (released || generation !== requestGeneration) {
        return {
          status: "skipped",
          skipReason: "motion_start_cancelled",
          motionPresetId
        };
      }

      if (!loadedMotion) {
        return {
          status: "skipped",
          skipReason: "motion_load_failed",
          motionPresetId
        };
      }

      const handle = manager.startMotionPriority(loadedMotion.motion, false, preset.priority);

      if (handle === -1) {
        return {
          status: "skipped",
          skipReason: "motion_start_failed",
          motionPresetId
        };
      }

      stopActiveMotions("interrupted");
      const record = createPlaybackRecord(handle, motionPresetId, loadedMotion.controlledParameterIds);
      activeMotions.set(handle, record);

      return {
        status: "started",
        motionPresetId,
        durationMs: Math.round(preset.durationHintSeconds * 1_000),
        playback: record.playback
      };
    },
    update(model, deltaSeconds): ReadonlySet<string> {
      const ownedParameterIds = new Set<string>();

      for (const activeMotion of activeMotions.values()) {
        for (const parameterId of activeMotion.controlledParameterIds) {
          ownedParameterIds.add(parameterId);
        }
      }

      try {
        manager.updateMotion(model, deltaSeconds);
      } catch (error) {
        for (const activeMotion of activeMotions.values()) {
          activeMotion.settle("failed");
        }
        try {
          manager.stopAllMotions();
        } finally {
          activeMotions.clear();
        }
        throw error;
      }

      for (const [handle, activeMotion] of activeMotions) {
        const entry = manager.getCubismMotionQueueEntry(handle);

        if (activeMotion.playback.state === "queued" && entry?.isStarted()) {
          activeMotion.transition("started");
        }

        if (!manager.isFinishedByHandle(handle)) {
          continue;
        }

        if (activeMotion.playback.state === "started") {
          activeMotion.settle("completed");
        } else if (activeMotion.playback.state === "queued") {
          activeMotion.settle("failed");
        }
        activeMotions.delete(handle);
      }

      return ownedParameterIds;
    },
    stop(reason): void {
      ++requestGeneration;
      stopActiveMotions(reason);
      activeMotions.clear();
      manager.stopAllMotions();
    },
    release(): void {
      ++requestGeneration;
      released = true;
      stopActiveMotions("interrupted");
      activeMotions.clear();
      manager.stopAllMotions();
      manager.release();
      for (const loadedMotion of motionCache.values()) {
        loadedMotion.motion.release();
      }
      motionCache.clear();
      motionLoads.clear();
    }
  };
}
