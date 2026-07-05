import type { DialogueModeId } from "../../shared/dialogue-style";
import type { EmotionPresentation } from "../../shared/emotion-presentation";
import type { PetAccessoryPresetId } from "../../shared/pet-accessory";
import type { PetActionStateId } from "../../shared/pet-action-state-machine";
import type { PetActionTriggerReason } from "../../shared/pet-action-trigger";
import type { PresenceModeId } from "../../shared/presence-mode";
import type {
  InteractionActionCooldownSkipReason,
  InteractionActionCooldownState,
  PetInteractionAction,
  PetInteractionActionType,
  WindowShakeLightFeedbackCooldownState,
  WindowShakeLightFeedbackSkipReason
} from "./interaction-actions";

type TimeoutHandle = ReturnType<typeof setTimeout>;

export type InteractionActionReason =
  | "startup_first_visible_frame"
  | "click_head"
  | "click_body"
  | "window_shake_feedback"
  | PetActionTriggerReason;

export type InteractionActionStrategy = {
  stateId?: PetActionStateId;
  modeId?: DialogueModeId;
  presenceModeId?: PresenceModeId;
  candidateActionTypes?: readonly PetInteractionActionType[];
};

type PersistentPresentation = {
  presentation: EmotionPresentation;
  accessoryPresetId: PetAccessoryPresetId;
};

type InteractionActionTelemetryType =
  | "pet_interaction_action_started"
  | "pet_interaction_action_finished"
  | "pet_interaction_action_skipped"
  | "pet_window_motion_feedback";

type ActiveInteractionAction = {
  action: PetInteractionAction;
  reason: InteractionActionReason;
  timeoutId: TimeoutHandle;
};

export type InteractionActionPlayer = {
  isActive(): boolean;
  getActiveActionType(): PetInteractionActionType | undefined;
  playAction(
    action: PetInteractionAction,
    reason: InteractionActionReason,
    strategy?: InteractionActionStrategy
  ): boolean;
  playWindowShakeLightFeedback(): boolean;
  dispose(): void;
};

export type InteractionActionPlayerOptions = {
  now?: () => number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearScheduledTimeout?: (handle: TimeoutHandle) => void;
  getAction(type: PetInteractionActionType): PetInteractionAction;
  getCooldownSkipReason(
    action: PetInteractionAction,
    nowMs: number,
    state: InteractionActionCooldownState
  ): InteractionActionCooldownSkipReason | null;
  getWindowShakeLightFeedbackSkipReason(
    action: PetInteractionAction,
    nowMs: number,
    state: WindowShakeLightFeedbackCooldownState
  ): WindowShakeLightFeedbackSkipReason | null;
  isStrongAction(type: PetInteractionActionType): boolean;
  boostInteraction(durationMs?: number): void;
  pauseLook(): void;
  resumeLook(): void;
  setLookTarget(x: number, y: number): void;
  resetLookTarget(): void;
  setPoseTarget(target: NonNullable<PetInteractionAction["poseTarget"]>): void;
  resetPoseTarget(): void;
  playMotionPreset(motionPresetId: NonNullable<PetInteractionAction["motionPresetId"]>): void;
  stopMotion(): void;
  applyTemporaryPartOpacities(partIds: readonly string[]): void;
  restoreTemporaryPartOpacities(): void;
  setExpression(expressionName: string): void;
  clearExpression(): void;
  applyPresentation(presentation: EmotionPresentation, accessoryPresetId: PetAccessoryPresetId): void;
  getPersistentPresentation(): PersistentPresentation;
  reportTelemetry(type: InteractionActionTelemetryType, payload: Record<string, unknown>): void;
};

export function createInteractionActionPlayer({
  now = () => performance.now(),
  scheduleTimeout = setTimeout,
  clearScheduledTimeout = clearTimeout,
  getAction,
  getCooldownSkipReason,
  getWindowShakeLightFeedbackSkipReason,
  isStrongAction,
  boostInteraction,
  pauseLook,
  resumeLook,
  setLookTarget,
  resetLookTarget,
  setPoseTarget,
  resetPoseTarget,
  playMotionPreset,
  stopMotion,
  applyTemporaryPartOpacities,
  restoreTemporaryPartOpacities,
  setExpression,
  clearExpression,
  applyPresentation,
  getPersistentPresentation,
  reportTelemetry
}: InteractionActionPlayerOptions): InteractionActionPlayer {
  let activeInteractionAction: ActiveInteractionAction | null = null;
  let lastInteractionActionFinishedAtMs: number | undefined;
  let lastHeadPatFinishedAtMs: number | undefined;
  let lastWindowShakeFeedbackStartedAtMs: number | undefined;
  const lastStrongInteractionActionFinishedAtMsByType: Partial<Record<PetInteractionActionType, number>> = {};

  function createStrategyTelemetry(strategy: InteractionActionStrategy | undefined, action: PetInteractionAction): Record<string, unknown> {
    if (!strategy) {
      return {};
    }

    return {
      ...(strategy.stateId ? { stateId: strategy.stateId } : {}),
      ...(strategy.modeId ? { modeId: strategy.modeId } : {}),
      ...(strategy.presenceModeId ? { presenceModeId: strategy.presenceModeId } : {}),
      ...(strategy.candidateActionTypes ? {
        candidateActionTypes: strategy.candidateActionTypes,
        selectedActionType: action.type
      } : {})
    };
  }

  function finishActiveAction(action: PetInteractionAction): boolean {
    if (activeInteractionAction?.action !== action) {
      return false;
    }

    const reason = activeInteractionAction.reason;
    activeInteractionAction = null;
    restoreTemporaryPartOpacities();
    if (action.motionPresetId) {
      stopMotion();
    }
    clearExpression();
    resetLookTarget();
    if (action.poseTarget) {
      resetPoseTarget();
    }
    resumeLook();

    const persistent = getPersistentPresentation();
    applyPresentation(persistent.presentation, persistent.accessoryPresetId);

    const finishedAtMs = now();
    lastInteractionActionFinishedAtMs = finishedAtMs;
    if (action.type === "headPat") {
      lastHeadPatFinishedAtMs = finishedAtMs;
    }
    if (isStrongAction(action.type)) {
      lastStrongInteractionActionFinishedAtMsByType[action.type] = finishedAtMs;
    }

    reportTelemetry("pet_interaction_action_finished", {
      type: action.type,
      reason,
      restoredAccessoryPresetId: persistent.accessoryPresetId
    });
    return true;
  }

  function playAction(
    action: PetInteractionAction,
    reason: InteractionActionReason,
    strategy?: InteractionActionStrategy
  ): boolean {
    const skipReason = getCooldownSkipReason(action, now(), {
      activeType: activeInteractionAction?.action.type,
      lastActionFinishedAtMs: lastInteractionActionFinishedAtMs,
      lastHeadPatFinishedAtMs,
      strongActionFinishedAtMsByType: lastStrongInteractionActionFinishedAtMsByType
    });

    if (skipReason) {
      reportTelemetry("pet_interaction_action_skipped", {
        type: action.type,
        reason,
        skipReason,
        ...createStrategyTelemetry(strategy, action),
        ...(activeInteractionAction ? { activeType: activeInteractionAction.action.type } : {})
      });
      return false;
    }

    reportTelemetry("pet_interaction_action_started", {
      type: action.type,
      reason,
      durationMs: action.durationMs,
      ...createStrategyTelemetry(strategy, action)
    });
    boostInteraction(action.durationMs + 250);
    if (action.lookTarget) {
      resumeLook();
      setLookTarget(action.lookTarget.x, action.lookTarget.y);
    } else {
      pauseLook();
      resetLookTarget();
    }
    if (action.poseTarget) {
      setPoseTarget(action.poseTarget);
    }
    if (action.motionPresetId) {
      playMotionPreset(action.motionPresetId);
    }
    applyTemporaryPartOpacities(action.accessoryPartIds ?? []);

    if (action.expressionName) {
      setExpression(action.expressionName);
    } else {
      applyPresentation(action.presentation, getPersistentPresentation().accessoryPresetId);
    }

    const timeoutId = scheduleTimeout(() => {
      finishActiveAction(action);
    }, action.durationMs);

    activeInteractionAction = { action, reason, timeoutId };
    return true;
  }

  function playWindowShakeLightFeedback(): boolean {
    const action = getAction("thinking");
    const nowMs = now();
    const skipReason = getWindowShakeLightFeedbackSkipReason(action, nowMs, {
      activeType: activeInteractionAction?.action.type,
      lastActionFinishedAtMs: lastInteractionActionFinishedAtMs,
      lastHeadPatFinishedAtMs,
      strongActionFinishedAtMsByType: lastStrongInteractionActionFinishedAtMsByType,
      lastWindowShakeFeedbackStartedAtMs
    });

    if (skipReason) {
      reportTelemetry("pet_window_motion_feedback", {
        eventType: "window_shake_candidate",
        reason: "window_shake_feedback",
        feedbackType: "shake_light_feedback",
        result: "skipped",
        skipReason,
        cooldownState: skipReason === "window_shake_feedback_cooldown" ? "cooling_down" : "available",
        durationMs: action.durationMs
      });
      return false;
    }

    if (!playAction(action, "window_shake_feedback")) {
      return false;
    }

    lastWindowShakeFeedbackStartedAtMs = nowMs;
    reportTelemetry("pet_window_motion_feedback", {
      eventType: "window_shake_candidate",
      reason: "window_shake_feedback",
      feedbackType: "shake_light_feedback",
      result: "started",
      cooldownState: "available",
      durationMs: action.durationMs
    });
    return true;
  }

  return {
    isActive(): boolean {
      return activeInteractionAction !== null;
    },
    getActiveActionType(): PetInteractionActionType | undefined {
      return activeInteractionAction?.action.type;
    },
    playAction,
    playWindowShakeLightFeedback,
    dispose(): void {
      if (!activeInteractionAction) {
        return;
      }

      clearScheduledTimeout(activeInteractionAction.timeoutId);
      if (activeInteractionAction.action.motionPresetId) {
        stopMotion();
      }
      activeInteractionAction = null;
    }
  };
}
