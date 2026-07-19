import type { DialogueModeId } from "../../shared/dialogue-style";
import type { EmotionPresentation } from "../../shared/emotion-presentation";
import {
  getPetExpressionPresetExpressionName,
  type PetExpressionPresetId
} from "../../shared/interaction-action-catalog.ts";
import type { PetAccessoryResolution } from "../../shared/pet-accessory";
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
import type {
  CubismMotionPlaybackResult,
  CubismMotionStopReason,
  CubismMotionTerminalState
} from "./live2d/cubism-motion";

type TimeoutHandle = ReturnType<typeof setTimeout>;
type NativeMotionPlaybackPhase = "loading" | "queued" | "started";
const NATIVE_MOTION_START_WATCHDOG_MS = 2_000;
const NATIVE_MOTION_WATCHDOG_GRACE_MS = 500;

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
  expressionPresetId?: PetExpressionPresetId;
  candidateActionTypes?: readonly PetInteractionActionType[];
};

type PersistentPresentation = {
  presentation: EmotionPresentation;
  accessorySelection: PetAccessoryResolution;
};

type InteractionActionTelemetryType =
  | "pet_interaction_action_started"
  | "pet_interaction_action_finished"
  | "pet_interaction_action_skipped"
  | "pet_window_motion_feedback";

type ActiveInteractionAction = {
  action: PetInteractionAction;
  reason: InteractionActionReason;
  strategy?: InteractionActionStrategy;
  playbackPhase?: NativeMotionPlaybackPhase;
  timeoutId?: TimeoutHandle;
  unsubscribeMotionState?: () => void;
};

export type InteractionActionPlayer = {
  isActive(): boolean;
  getActiveActionType(): PetInteractionActionType | undefined;
  playAction(
    action: PetInteractionAction,
    reason: InteractionActionReason,
    strategy?: InteractionActionStrategy
  ): boolean;
  interruptActiveMotionAction(): boolean;
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
  playMotionPreset(
    motionPresetId: NonNullable<PetInteractionAction["motionPresetId"]>
  ): Promise<CubismMotionPlaybackResult>;
  stopMotion(reason: CubismMotionStopReason): void;
  applyTemporaryPartOpacities(partIds: readonly string[]): void;
  restoreTemporaryPartOpacities(): void;
  setTemporaryAccessory(accessoryId: NonNullable<PetInteractionAction["temporaryAccessoryId"]>): void;
  restoreTemporaryAccessory(): void;
  setExpression(expressionName: string): void;
  clearExpression(): void;
  applyPresentation(presentation: EmotionPresentation, accessorySelection: PetAccessoryResolution): void;
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
  setTemporaryAccessory,
  restoreTemporaryAccessory,
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
  const lastActionFinishedAtMsByType: Partial<Record<PetInteractionActionType, number>> = {};

  function createStrategyTelemetry(strategy: InteractionActionStrategy | undefined, action: PetInteractionAction): Record<string, unknown> {
    if (!strategy) {
      return {};
    }

    return {
      ...(strategy.stateId ? { stateId: strategy.stateId } : {}),
      ...(strategy.modeId ? { modeId: strategy.modeId } : {}),
      ...(strategy.presenceModeId ? { presenceModeId: strategy.presenceModeId } : {}),
      ...(strategy.expressionPresetId ? { expressionPresetId: strategy.expressionPresetId } : {}),
      ...(strategy.candidateActionTypes ? {
        candidateActionTypes: strategy.candidateActionTypes,
        selectedActionType: action.type
      } : {})
    };
  }

  function clearActiveActionScheduling(activeAction: ActiveInteractionAction): void {
    if (activeAction.timeoutId !== undefined) {
      clearScheduledTimeout(activeAction.timeoutId);
      delete activeAction.timeoutId;
    }
    activeAction.unsubscribeMotionState?.();
    delete activeAction.unsubscribeMotionState;
  }

  function finishActiveAction(
    activeAction: ActiveInteractionAction,
    terminalStatus?: CubismMotionTerminalState
  ): boolean {
    if (activeInteractionAction !== activeAction) {
      return false;
    }

    const { action, reason } = activeAction;
    clearActiveActionScheduling(activeAction);
    activeInteractionAction = null;
    restoreTemporaryPartOpacities();
    restoreActionPresentation(action, false);

    const finishedAtMs = now();
    lastInteractionActionFinishedAtMs = finishedAtMs;
    lastActionFinishedAtMsByType[action.type] = finishedAtMs;
    if (action.type === "headPat") {
      lastHeadPatFinishedAtMs = finishedAtMs;
    }
    if (isStrongAction(action.type)) {
      lastStrongInteractionActionFinishedAtMsByType[action.type] = finishedAtMs;
    }

    reportTelemetry("pet_interaction_action_finished", {
      type: action.type,
      reason,
      ...(action.motionPresetId ? { motionPresetId: action.motionPresetId } : {}),
      ...(terminalStatus ? { terminalStatus } : {})
    });
    return true;
  }

  function restoreActionPresentation(
    action: PetInteractionAction,
    shouldRestoreTemporaryParts = true
  ): void {
    if (shouldRestoreTemporaryParts) {
      restoreTemporaryPartOpacities();
    }
    if (action.temporaryAccessoryId) {
      restoreTemporaryAccessory();
    }
    clearExpression();
    resetLookTarget();
    if (action.poseTarget) {
      resetPoseTarget();
    }
    resumeLook();

    const persistent = getPersistentPresentation();
    applyPresentation(persistent.presentation, persistent.accessorySelection);
  }

  function reportActionStarted(activeAction: ActiveInteractionAction): void {
    const { action, reason, strategy } = activeAction;
    reportTelemetry("pet_interaction_action_started", {
      type: action.type,
      reason,
      durationMs: action.durationMs,
      ...createStrategyTelemetry(strategy, action),
      ...(action.motionPresetId ? { motionPresetId: action.motionPresetId } : {})
    });
  }

  function fallBackToDeclaredActionDuration(activeAction: ActiveInteractionAction): void {
    if (activeInteractionAction !== activeAction) {
      return;
    }

    if (activeAction.timeoutId !== undefined) {
      clearScheduledTimeout(activeAction.timeoutId);
      delete activeAction.timeoutId;
    }
    delete activeAction.playbackPhase;
    reportActionStarted(activeAction);
    activeAction.timeoutId = scheduleTimeout(() => {
      finishActiveAction(activeAction);
    }, activeAction.action.durationMs);
  }

  function waitForNativeMotion(
    activeAction: ActiveInteractionAction,
    pendingPlayback: Promise<CubismMotionPlaybackResult>
  ): void {
    void pendingPlayback.then((result) => {
      if (activeInteractionAction !== activeAction) {
        return;
      }

      if (result.status !== "started") {
        fallBackToDeclaredActionDuration(activeAction);
        return;
      }

      activeAction.playbackPhase = "queued";
      activeAction.unsubscribeMotionState = result.playback.onStateChange((state) => {
        if (
          state !== "started" ||
          activeInteractionAction !== activeAction ||
          activeAction.playbackPhase === "started"
        ) {
          return;
        }

        activeAction.playbackPhase = "started";
        if (activeAction.timeoutId !== undefined) {
          clearScheduledTimeout(activeAction.timeoutId);
          delete activeAction.timeoutId;
        }
        reportActionStarted(activeAction);
        const watchdogBudgetMs = result.durationMs + NATIVE_MOTION_WATCHDOG_GRACE_MS;
        boostInteraction(watchdogBudgetMs);
        const runtimeWatchdogId = scheduleTimeout(() => {
          if (
            activeInteractionAction !== activeAction ||
            activeAction.timeoutId !== runtimeWatchdogId
          ) {
            return;
          }

          stopMotion("timed_out");
          finishActiveAction(activeAction, "timed_out");
        }, watchdogBudgetMs);
        activeAction.timeoutId = runtimeWatchdogId;
      });

      void result.playback.terminal.then(
        (terminal) => finishActiveAction(
          activeAction,
          terminal.status === "interrupted" && activeAction.playbackPhase !== "started"
            ? undefined
            : terminal.status
        ),
        () => fallBackToDeclaredActionDuration(activeAction)
      );
    }, () => fallBackToDeclaredActionDuration(activeAction));
  }

  function playAction(
    action: PetInteractionAction,
    reason: InteractionActionReason,
    strategy?: InteractionActionStrategy
  ): boolean {
    const welcomeFollowupListen =
      activeInteractionAction?.action.type === "dialogueOpenWelcome" && action.type === "listen";
    const modeTransitionInterruptsReplySettle =
      activeInteractionAction?.action.type === "replyWarmSettle" &&
      (
        reason === "state_idle" ||
        reason === "state_work" ||
        reason === "state_game" ||
        reason === "state_read" ||
        reason === "state_sleep"
      );
    const interruptedActiveAction = Boolean(
      !welcomeFollowupListen &&
      (
        modeTransitionInterruptsReplySettle ||
        (
          activeInteractionAction?.action.interruptible &&
          (action.runtimePriority ?? 30) > (activeInteractionAction.action.runtimePriority ?? 30)
        )
      )
    );

    if (interruptedActiveAction && activeInteractionAction) {
      const activeAction = activeInteractionAction;
      if (activeAction.action.motionPresetId) {
        stopMotion("interrupted");
      }
      finishActiveAction(
        activeAction,
        !activeAction.action.motionPresetId || activeAction.playbackPhase === "started"
          ? "interrupted"
          : undefined
      );
    }

    const skipReason = getCooldownSkipReason(action, now(), {
      activeType: activeInteractionAction?.action.type,
      lastActionFinishedAtMs: interruptedActiveAction ? undefined : lastInteractionActionFinishedAtMs,
      lastHeadPatFinishedAtMs,
      strongActionFinishedAtMsByType: lastStrongInteractionActionFinishedAtMsByType,
      actionFinishedAtMsByType: lastActionFinishedAtMsByType
    });

    if (skipReason) {
      reportTelemetry("pet_interaction_action_skipped", {
        type: action.type,
        reason,
        skipReason,
        ...createStrategyTelemetry(strategy, action),
        ...(activeInteractionAction ? { activeType: activeInteractionAction.action.type } : {}),
        ...(activeInteractionAction?.action.motionPresetId || action.motionPresetId
          ? { motionPresetId: activeInteractionAction?.action.motionPresetId ?? action.motionPresetId }
          : {})
      });
      return false;
    }

    const activeAction: ActiveInteractionAction = {
      action,
      reason,
      ...(strategy ? { strategy } : {}),
      ...(action.motionPresetId ? { playbackPhase: "loading" } : {})
    };
    activeInteractionAction = activeAction;
    if (action.motionPresetId) {
      const startWatchdogId = scheduleTimeout(() => {
        if (
          activeInteractionAction !== activeAction ||
          activeAction.timeoutId !== startWatchdogId
        ) {
          return;
        }

        stopMotion("timed_out");
        finishActiveAction(activeAction, "timed_out");
      }, NATIVE_MOTION_START_WATCHDOG_MS);
      activeAction.timeoutId = startWatchdogId;
    } else {
      reportActionStarted(activeAction);
    }
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
    let pendingNativePlayback: Promise<CubismMotionPlaybackResult> | undefined;
    let nativeMotionStartFailed = false;
    if (action.motionPresetId) {
      try {
        pendingNativePlayback = playMotionPreset(action.motionPresetId);
      } catch {
        nativeMotionStartFailed = true;
      }
    }
    applyTemporaryPartOpacities(action.accessoryPartIds ?? []);
    if (action.temporaryAccessoryId) {
      setTemporaryAccessory(action.temporaryAccessoryId);
    }

    if (action.expressionName) {
      setExpression(action.expressionName);
    } else if (strategy?.expressionPresetId) {
      setExpression(getPetExpressionPresetExpressionName(strategy.expressionPresetId));
    } else {
      applyPresentation(action.presentation, getPersistentPresentation().accessorySelection);
    }

    if (action.motionPresetId) {
      if (nativeMotionStartFailed || !pendingNativePlayback) {
        fallBackToDeclaredActionDuration(activeAction);
      } else {
        waitForNativeMotion(activeAction, pendingNativePlayback);
      }
    } else {
      activeAction.timeoutId = scheduleTimeout(() => {
        finishActiveAction(activeAction);
      }, action.durationMs);
    }
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
    interruptActiveMotionAction(): boolean {
      if (!activeInteractionAction?.action.motionPresetId) {
        return false;
      }

      const activeAction = activeInteractionAction;
      stopMotion("interrupted");
      return finishActiveAction(
        activeAction,
        activeAction.playbackPhase === "started" ? "interrupted" : undefined
      );
    },
    playWindowShakeLightFeedback,
    dispose(): void {
      if (!activeInteractionAction) {
        return;
      }

      const activeAction = activeInteractionAction;
      activeInteractionAction = null;
      clearActiveActionScheduling(activeAction);
      if (activeAction.action.motionPresetId) {
        stopMotion("interrupted");
      }
      restoreActionPresentation(activeAction.action);
    }
  };
}
