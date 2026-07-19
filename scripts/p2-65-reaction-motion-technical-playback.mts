import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createInteractionActionPlayer } from "../src/renderer/pet/interaction-action-player.ts";
import {
  getInteractionActionCooldownSkipReason,
  getPetInteractionAction,
  getWindowShakeLightFeedbackSkipReason,
  isStrongInteractionAction,
  type PetInteractionAction,
  type PetInteractionActionType
} from "../src/renderer/pet/interaction-actions.ts";
import { createCubismMotionController } from "../src/renderer/pet/live2d/cubism-motion.ts";
import { getPetMotionPreset } from "../src/shared/pet-motion-presets.ts";
import { getPetActionTriggerActionType, type PetActionTriggerReason } from "../src/shared/pet-action-trigger.ts";
import { auditWitchMotionAssets } from "./live2d-motion-asset-audit.mts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const TECHNICAL_PLAYBACK_CASES = [
  { actionType: "doze", motionPresetId: "yawn-once", triggerReason: "state_sleep" },
  { actionType: "appearance", motionPresetId: "surprised-small", directReason: "startup_first_visible_frame" },
  { actionType: "softSmile", motionPresetId: "happy-small", triggerReason: "state_idle" },
  { actionType: "flusteredGlance", motionPresetId: "flustered-small", triggerReason: "rapid_touch_combo" },
  { actionType: "headPat", motionPresetId: "head-pat-linger", directReason: "click_head" },
  { actionType: "bodyAttentionTurn", motionPresetId: "body-attention-turn", directReason: "click_body" },
  { actionType: "dialogueOpenWelcome", motionPresetId: "dialogue-open-welcome", triggerReason: "chat_opened" },
  { actionType: "replyWarmSettle", motionPresetId: "reply-warm-settle", triggerReason: "chat_reply_completed" },
  { actionType: "musicListenSway", motionPresetId: "music-listen-sway", triggerReason: "state_music_playing_stable" },
  { actionType: "gamePresenceGlance", motionPresetId: "game-presence-glance", triggerReason: "state_game_presence_stable" },
  { actionType: "searchNoteSettle", motionPresetId: "search-note-settle", triggerReason: "state_search_cited" },
  { actionType: "returnFromIdle", motionPresetId: "return-from-idle", triggerReason: "return_from_idle" },
  { actionType: "eveningWindowGlance", motionPresetId: "evening-window-glance", triggerReason: "evening_companion_tick" },
  { actionType: "longWorkRecovery", motionPresetId: "long-work-recovery", triggerReason: "long_work_session_complete" }
] as const;

type TechnicalPlaybackStatus = "registered" | "loaded" | "started" | "completed" | "restored" | "released";

export type P265TechnicalPlaybackCaseResult = {
  actionType: string;
  motionPresetId: string;
  verificationMode: "production-action";
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
  unmappedRegisteredPresetIds: string[];
  cubismParsePresetIds: string[];
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

async function waitForNativeStartRequest(manager: TechnicalMotionManager, motionPresetId: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (manager.handles.length === 1) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`P2-77 technical playback native start request did not arrive: ${motionPresetId}`);
}

function resolveProductionAction(definition: typeof TECHNICAL_PLAYBACK_CASES[number]): PetInteractionAction {
  const actionType = "triggerReason" in definition
    ? getPetActionTriggerActionType(definition.triggerReason as PetActionTriggerReason)
    : definition.actionType;

  if (actionType !== definition.actionType) {
    throw new Error(`P2-77 technical playback dispatcher mismatch: ${definition.actionType}`);
  }

  return getPetInteractionAction(actionType as PetInteractionActionType);
}

async function runTechnicalPlaybackCase(
  definition: typeof TECHNICAL_PLAYBACK_CASES[number],
  registeredPresetIds: ReadonlySet<string>
): Promise<P265TechnicalPlaybackCaseResult> {
  const preset = getPetMotionPreset(definition.motionPresetId);
  if (!preset || !registeredPresetIds.has(definition.motionPresetId)) {
    throw new Error("P2-77 technical playback registration mismatch");
  }
  const action = resolveProductionAction(definition);
  if (action.motionPresetId !== definition.motionPresetId) {
    throw new Error("P2-77 technical playback action-preset mismatch");
  }

  const manager = new TechnicalMotionManager();
  const motion = new TechnicalMotion();
  const timers: TechnicalTimer[] = [];
  const telemetry: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let resourceLoadCount = 0;
  let motionCreateCount = 0;
  let restoreCount = 0;
  let temporaryAccessorySetCount = 0;
  let temporaryAccessoryRestoreCount = 0;
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
      setTemporaryAccessory: () => {
        temporaryAccessorySetCount += 1;
      },
      restoreTemporaryAccessory: () => {
        temporaryAccessoryRestoreCount += 1;
      },
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

    const reason = "triggerReason" in definition ? definition.triggerReason : definition.directReason;
    if (!player.playAction(action, reason)) {
      throw new Error("P2-65 technical playback action was skipped");
    }
    await waitForNativeStartRequest(manager, definition.motionPresetId);
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
    if (action.temporaryAccessoryId) {
      requireExactlyOnce(temporaryAccessorySetCount, "temporary accessory set");
      requireExactlyOnce(temporaryAccessoryRestoreCount, "temporary accessory restore");
    } else if (temporaryAccessorySetCount !== 0 || temporaryAccessoryRestoreCount !== 0) {
      throw new Error("P2-65 technical playback changed an accessory for an action without one");
    }
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
    verificationMode: "production-action",
    registrationStatus: "registered",
    loadStatus: "loaded",
    startStatus: "started",
    completionStatus: "completed",
    restoreStatus: "restored",
    cleanupStatus: "released"
  };
}

type CubismMotionFactory = {
  create(buffer: ArrayBuffer, size: number): { release(): void } | null;
};

type CubismJsonValueFactory = {
  staticInitializeNotForClientCall(): void;
  staticReleaseNotForClientCall(): void;
};

type CubismFrameworkFactory = {
  startUp(): boolean;
  initialize(): void;
  dispose(): void;
  cleanUp(): void;
};

async function parseWithRealCubismMotion(presetIds: readonly string[]): Promise<string[]> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "p2-77-cubism-motion-"));
  const outputPath = join(temporaryRoot, "cubism-motion.mjs");

  try {
    await build({
      stdin: {
        contents: [
          `export { CubismMotion } from ${JSON.stringify(resolve(REPOSITORY_ROOT, "src/renderer/pet/live2d/vendor/framework/motion/cubismmotion.ts"))};`,
          `export { Value } from ${JSON.stringify(resolve(REPOSITORY_ROOT, "src/renderer/pet/live2d/vendor/framework/utils/cubismjson.ts"))};`,
          `export { CubismFramework } from ${JSON.stringify(resolve(REPOSITORY_ROOT, "src/renderer/pet/live2d/vendor/framework/live2dcubismframework.ts"))};`
        ].join("\n"),
        resolveDir: REPOSITORY_ROOT,
        sourcefile: "p2-77-cubism-motion-probe.ts"
      },
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: outputPath,
      logLevel: "silent"
    });
    const module = await import(`${pathToFileURL(outputPath).href}?p2_77=${Date.now()}`) as {
      CubismMotion: CubismMotionFactory;
      Value: CubismJsonValueFactory;
      CubismFramework: CubismFrameworkFactory;
    };
    const parsedPresetIds: string[] = [];

    const cubismCore = globalThis as typeof globalThis & {
      Live2DCubismCore?: {
        Version: { csmGetVersion(): number };
        Memory: { initializeAmountOfMemory(size: number): void };
        Logging: { csmGetLogFunction(): undefined; csmSetLogFunction(): void };
      };
    };
    cubismCore.Live2DCubismCore = {
      Version: { csmGetVersion: () => 0 },
      Memory: { initializeAmountOfMemory: () => undefined },
      Logging: { csmGetLogFunction: () => undefined, csmSetLogFunction: () => undefined }
    };
    module.CubismFramework.startUp();
    module.CubismFramework.initialize();
    try {
      for (const presetId of presetIds) {
        const preset = getPetMotionPreset(presetId as NonNullable<PetInteractionAction["motionPresetId"]>);
        if (!preset) {
          throw new Error(`P2-77 Cubism parse preset is not registered: ${presetId}`);
        }
        const bytes = await readFile(resolve(REPOSITORY_ROOT, "resources/models/witch", preset.path));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const motion = module.CubismMotion.create(buffer, bytes.byteLength);
        if (!motion) {
          throw new Error(`P2-77 CubismMotion.create returned null: ${presetId}`);
        }
        motion.release();
        parsedPresetIds.push(presetId);
      }
    } finally {
      module.Value.staticReleaseNotForClientCall();
      module.CubismFramework.cleanUp();
      delete cubismCore.Live2DCubismCore;
    }

    return parsedPresetIds;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function runP265ReactionMotionTechnicalPlayback(): Promise<P265TechnicalPlaybackSummary> {
  const audit = auditWitchMotionAssets();
  const registeredPresetIds = new Set(
    audit.semanticMotionPresets
      .filter((preset) => preset.status === "ready")
      .map((preset) => preset.id)
  );

  const cases: P265TechnicalPlaybackCaseResult[] = [];
  for (const definition of TECHNICAL_PLAYBACK_CASES) {
    cases.push(await runTechnicalPlaybackCase(definition, registeredPresetIds));
  }

  const mappedPresetIds = new Set(cases.map((entry) => entry.motionPresetId));
  const allRegisteredPresetIds = audit.semanticMotionPresets
    .filter((preset) => preset.status === "ready")
    .map((preset) => preset.id);

  return {
    ok: true,
    safeSummaryOnly: true,
    cases,
    unmappedRegisteredPresetIds: allRegisteredPresetIds.filter((presetId) => !mappedPresetIds.has(presetId)),
    cubismParsePresetIds: await parseWithRealCubismMotion(allRegisteredPresetIds)
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
