import { getPetMotionPreset, PET_MOTION_PRESETS, type PetMotionPresetId } from "../../../shared/pet-motion-presets.ts";
import type { CubismModel } from "./vendor/framework/model/cubismmodel";
import type { CubismMotion } from "./vendor/framework/motion/cubismmotion";
import type { CubismMotionManager } from "./vendor/framework/motion/cubismmotionmanager";

type MotionLoad = Promise<CubismMotion | null>;

export type CubismMotionSkipReason =
  | "no_semantic_motion_presets"
  | "unknown_motion_preset"
  | "motion_load_failed"
  | "motion_start_failed";

export type CubismMotionPlaybackResult =
  | {
      status: "started";
      motionPresetId: PetMotionPresetId;
      durationMs: number;
    }
  | {
      status: "skipped";
      skipReason: CubismMotionSkipReason;
      motionPresetId?: PetMotionPresetId;
    };

export type CubismMotionController = {
  playMotionPreset(motionPresetId: PetMotionPresetId): Promise<CubismMotionPlaybackResult>;
  update(model: CubismModel, deltaSeconds: number): void;
  stop(): void;
  release(): void;
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

export async function createCubismMotionController(): Promise<CubismMotionController> {
  const [{ CubismMotion }, { CubismMotionManager }] = await Promise.all([
    import("./vendor/framework/motion/cubismmotion"),
    import("./vendor/framework/motion/cubismmotionmanager")
  ]);
  const manager = new CubismMotionManager();
  const motionCache = new Map<PetMotionPresetId, CubismMotion>();
  const motionLoads = new Map<PetMotionPresetId, MotionLoad>();

  async function loadMotion(motionPresetId: PetMotionPresetId): MotionLoad {
    const cached = motionCache.get(motionPresetId);

    if (cached) {
      return cached;
    }

    const pending = motionLoads.get(motionPresetId);

    if (pending) {
      return await pending;
    }

    const preset = getPetMotionPreset(motionPresetId);

    if (!preset) {
      return null;
    }

    const load = (async () => {
      const buffer = await fetchArrayBuffer(resolveModelAssetUrl(preset.path));
      const motion = CubismMotion.create(buffer, buffer.byteLength);

      if (!motion) {
        return null;
      }

      motion.setFadeInTime(preset.fadeInSeconds);
      motion.setFadeOutTime(preset.fadeOutSeconds);
      motion.setLoop(preset.loop);
      motionCache.set(motionPresetId, motion);
      return motion;
    })();
    motionLoads.set(motionPresetId, load);

    try {
      return await load;
    } finally {
      motionLoads.delete(motionPresetId);
    }
  }

  return {
    async playMotionPreset(motionPresetId): Promise<CubismMotionPlaybackResult> {
      if (PET_MOTION_PRESETS.length === 0) {
        return {
          status: "skipped",
          skipReason: "no_semantic_motion_presets"
        };
      }

      const preset = getPetMotionPreset(motionPresetId);

      if (!preset) {
        return {
          status: "skipped",
          skipReason: "unknown_motion_preset"
        };
      }

      let motion: CubismMotion | null = null;

      try {
        motion = await loadMotion(motionPresetId);
      } catch {
        return {
          status: "skipped",
          skipReason: "motion_load_failed",
          motionPresetId
        };
      }

      if (!motion) {
        return {
          status: "skipped",
          skipReason: "motion_load_failed",
          motionPresetId
        };
      }

      const handle = manager.startMotionPriority(motion, false, preset.priority);

      if (handle === -1) {
        return {
          status: "skipped",
          skipReason: "motion_start_failed",
          motionPresetId
        };
      }

      return {
        status: "started",
        motionPresetId,
        durationMs: Math.round(preset.durationHintSeconds * 1_000)
      };
    },
    update(model, deltaSeconds): void {
      manager.updateMotion(model, deltaSeconds);
    },
    stop(): void {
      manager.stopAllMotions();
    },
    release(): void {
      manager.stopAllMotions();
      manager.release();
      for (const motion of motionCache.values()) {
        motion.release();
      }
      motionCache.clear();
      motionLoads.clear();
    }
  };
}
