import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInteractionActionPlayer } from "../src/renderer/pet/interaction-action-player.ts";
import {
  getInteractionActionCooldownSkipReason,
  getPetInteractionAction,
  getWindowShakeLightFeedbackSkipReason,
  isStrongInteractionAction
} from "../src/renderer/pet/interaction-actions.ts";
import { createCubismMotionController } from "../src/renderer/pet/live2d/cubism-motion.ts";
import { getPetMotionPreset } from "../src/shared/pet-motion-presets.ts";
import { auditWitchMotionAssets } from "./live2d-motion-asset-audit.mts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const REACTION_CASES = [
  { actionType: "headPat", motionPresetId: "happy-small", reason: "click_head" },
  { actionType: "appearance", motionPresetId: "surprised-small", reason: "startup_first_visible_frame" },
  { actionType: "flusteredGlance", motionPresetId: "flustered-small", reason: "rapid_touch_combo" }
] as const;

type TechnicalPlaybackStatus = "registered" | "loaded" | "started" | "completed" | "restored" | "released";

export type P265TechnicalPlaybackCaseResult = {
  actionType: string;
  motionPresetId: string;
  registrationStatus: Extract<TechnicalPlaybackStatus, "registered">;
  loadStatus: Extract<TechnicalPlaybackStatus, "loaded">;
  startStatus: Extract<TechnicalPlaybackStatus, "started">;
  completionStatus: Extract<TechnicalPlaybackStatus, "completed">;
  restoreStatus: Extract<TechnicalPlaybackStatus, "restored">;
  cleanupStatus: Extract<TechnicalPlaybackStatus, "released">;
};

export type P265TechnicalPlaybackSummary = {
  ok: true;
  safeSummaryOnly: true;
  cases: P265TechnicalPlaybackCaseResult[];
};

type TechnicalTimer = {
  callback: () => void;
  cleared: boolean;
};

class TechnicalMotion {
  releaseCount = 0;

  setEffectIds(): void {}
  setFadeInTime(): void {}
  setFadeOutTime(): void {}
  setLoop(): void {}

  release(): void {
    this.releaseCount += 1;
  }
}

class TechnicalMotionManager {
  readonly handles: object[] = [];
  readonly started = new Set<object>();
  readonly finished = new Set<object>();
  releaseCount = 0;

  startMotionPriority(): object {
    const handle = {};
    this.handles.push(handle);
    return handle;
  }

  updateMotion(): boolean {
    return true;
  }

  getCubismMotionQueueEntry(handle: object): { isStarted(): boolean } | null {
    return this.finished.has(handle) ? null : { isStarted: () => this.started.has(handle) };
  }

  isFinishedByHandle(handle: object): boolean {
    return this.finished.has(handle);
  }

  stopAllMotions(): void {}

  release(): void {
    this.releaseCount += 1;
  }
}

function requireExactlyOnce(value: number, label: string): void {
  if (value !== 1) {
    throw new Error(`P2-65 technical playback expected one ${label}`);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForNativeStartRequest(manager: TechnicalMotionManager): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (manager.handles.length === 1) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error("P2-65 technical playback native start request did not arrive");
}

async function runReactionCase(
  definition: typeof REACTION_CASES[number],
  registeredPresetIds: ReadonlySet<string>
): Promise<P265TechnicalPlaybackCaseResult> {
  const action = getPetInteractionAction(definition.actionType);
  const preset = getPetMotionPreset(definition.motionPresetId);
  if (!preset || action.motionPresetId !== definition.motionPresetId || !registeredPresetIds.has(definition.motionPresetId)) {
    throw new Error("P2-65 reaction registration mismatch");
  }

  const manager = new TechnicalMotionManager();
  const motion = new TechnicalMotion();
  const timers: TechnicalTimer[] = [];
  const telemetry: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let resourceLoadCount = 0;
  let motionCreateCount = 0;
  let restoreCount = 0;
  const controller = await createCubismMotionController({
    motionPresets: [preset],
    getMotionPreset: (id) => id === preset.id ? preset : null,
    fetchArrayBuffer: async () => {
      resourceLoadCount += 1;
      const bytes = await readFile(resolve(REPOSITORY_ROOT, "resources/models/witch", preset.path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    createMotion: () => {
      motionCreateCount += 1;
      return motion as never;
    },
    manager: manager as never
  });

  try {
    const player = createInteractionActionPlayer({
      now: () => 1_000,
      scheduleTimeout: (callback) => {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer as never;
      },
      clearScheduledTimeout: (handle) => {
        (handle as unknown as TechnicalTimer).cleared = true;
      },
      getAction: getPetInteractionAction,
      getCooldownSkipReason: getInteractionActionCooldownSkipReason,
      getWindowShakeLightFeedbackSkipReason,
      isStrongAction: isStrongInteractionAction,
      boostInteraction: () => undefined,
      pauseLook: () => undefined,
      resumeLook: () => undefined,
      setLookTarget: () => undefined,
      resetLookTarget: () => undefined,
      setPoseTarget: () => undefined,
      resetPoseTarget: () => undefined,
      playMotionPreset: (motionPresetId) => controller.playMotionPreset(motionPresetId),
      stopMotion: (reason) => controller.stop(reason),
      applyTemporaryPartOpacities: () => undefined,
      restoreTemporaryPartOpacities: () => {
        restoreCount += 1;
      },
      setExpression: () => undefined,
      clearExpression: () => undefined,
      applyPresentation: () => undefined,
      getPersistentPresentation: () => ({
        presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
        accessoryPresetId: "none"
      }),
      reportTelemetry: (type, payload) => {
        telemetry.push({ type, payload });
      }
    });

    if (!player.playAction(action, definition.reason)) {
      throw new Error("P2-65 technical playback action was skipped");
    }
    await waitForNativeStartRequest(manager);
    await flushMicrotasks();
    requireExactlyOnce(resourceLoadCount, "resource load");
    requireExactlyOnce(motionCreateCount, "motion construction");
    requireExactlyOnce(manager.handles.length, "native start request");

    const handle = manager.handles[0]!;
    manager.started.add(handle);
    controller.update({} as never, 0.016);
    requireExactlyOnce(telemetry.filter((event) => event.type === "pet_interaction_action_started").length, "started telemetry");
    if (!timers[0]?.cleared) {
      throw new Error("P2-65 technical playback start watchdog was not cleared");
    }

    manager.finished.add(handle);
    controller.update({} as never, 0.016);
    await flushMicrotasks();
    requireExactlyOnce(telemetry.filter((event) => event.type === "pet_interaction_action_finished").length, "completion telemetry");
    requireExactlyOnce(restoreCount, "presentation restore");
    if (telemetry.at(-1)?.payload.terminalStatus !== "completed" || player.isActive()) {
      throw new Error("P2-65 technical playback did not complete normally");
    }
  } finally {
    controller.release();
  }

  requireExactlyOnce(manager.releaseCount, "runtime release");
  requireExactlyOnce(motion.releaseCount, "motion release");
  return {
    actionType: definition.actionType,
    motionPresetId: definition.motionPresetId,
    registrationStatus: "registered",
    loadStatus: "loaded",
    startStatus: "started",
    completionStatus: "completed",
    restoreStatus: "restored",
    cleanupStatus: "released"
  };
}

export async function runP265ReactionMotionTechnicalPlayback(): Promise<P265TechnicalPlaybackSummary> {
  const audit = auditWitchMotionAssets();
  const registeredPresetIds = new Set(
    audit.semanticMotionPresets
      .filter((preset) => preset.semanticKind === "reaction" && preset.status === "ready")
      .map((preset) => preset.id)
  );

  const cases: P265TechnicalPlaybackCaseResult[] = [];
  for (const definition of REACTION_CASES) {
    cases.push(await runReactionCase(definition, registeredPresetIds));
  }

  return {
    ok: true,
    safeSummaryOnly: true,
    cases
  };
}

if (process.argv[1]?.endsWith("p2-65-reaction-motion-technical-playback.mts")) {
  void runP265ReactionMotionTechnicalPlayback().then(
    (summary) => console.log(JSON.stringify(summary)),
    () => {
      console.log(JSON.stringify({ ok: false, safeSummaryOnly: true, status: "failed" }));
      process.exitCode = 1;
    }
  );
}
