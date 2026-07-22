import { contextBridge, ipcRenderer } from "electron";
import type {
  PetApi,
  PetWindowMotionFeedback,
  RenderHealth,
  PetDragDelta,
  PetFirstFrameInfo,
  PetOverlayHitRegion
} from "../shared/ipc-contract";
import type {
  ProactiveBubbleCandidateId,
  ProactiveSpeechBubbleActivation,
  ProactiveSpeechBubblePayload,
  ProactiveSpeechBubbleReason
} from "../shared/proactive-speech-bubble";
import type {
  PetActionTrigger,
  PetActionTriggerReason,
  PetActionTriggerSupersessionPolicy
} from "../shared/pet-action-trigger";
import type { AutomaticSituationSnapshot } from "../shared/automatic-situation-context";
import type { PetPresentationIntent, PetRoleState } from "../shared/pet-role-state";
import type { PetScaleAdjustmentIntent } from "../shared/pet-presentation";

const petRoleStates = [
  "idle",
  "listening",
  "thinking",
  "replying",
  "interrupted",
  "error"
] as const;
const emotionTags = ["neutral", "happy", "sad", "surprised", "confused", "angry"] as const;
const emotionIntensities = ["low", "medium", "high"] as const;
const automaticConversationContextIds = ["default", "work", "game", "reading"] as const;
const automaticConversationSources = ["default", "bundled-local-model", "user-explicit", "expired"] as const;
const automaticPresenceStateIds = ["default", "focus", "quiet", "sleep"] as const;
const automaticPresenceSources = ["default", "work-activity", "quiet-preference", "deterministic-sleep"] as const;
const petAccessoryCatalog = [
  { id: "ghost", group: "companion" },
  { id: "bow", group: "attire" },
  { id: "glasses", group: "facewear" },
  { id: "hat", group: "headwear" },
  { id: "staff", group: "held-prop" },
  { id: "game-controller", group: "held-prop" },
  { id: "microphone", group: "held-prop" }
] as const;
const petAccessoryGroups = ["companion", "attire", "facewear", "headwear", "held-prop"] as const;
const petAccessorySources = ["user", "mode", "action"] as const;
const proactiveSpeechBubbleLineIds = [
  "startup_presence_ready",
  "startup_presence_soft",
  "startup_presence_focus",
  "idle_presence_soft",
  "idle_presence_default",
  "idle_presence_focus",
  "idle_presence_quiet",
  "idle_presence_work",
  "idle_presence_game",
  "idle_presence_reading",
  "idle_presence_morning",
  "idle_presence_afternoon",
  "idle_presence_evening",
  "idle_presence_night",
  "idle_presence_work_morning",
  "idle_presence_work_afternoon",
  "idle_presence_reading_evening",
  "idle_presence_reading_night",
  "idle_presence_game_evening",
  "idle_presence_context_settle",
  "idle_presence_history_summary",
  "idle_presence_memory_safe",
  "idle_presence_search_citation",
  "environment_music_started",
  "environment_game_started",
  "environment_returned_from_away",
  "environment_long_work_recovery",
  "mode_presence_focus",
  "mode_presence_work",
  "mode_presence_game",
  "mode_presence_reading"
] as const;
const proactiveSpeechBubbleReasons = [
  "startup_presence",
  "idle_presence",
  "mode_presence",
  "music_presence",
  "game_presence",
  "return_presence",
  "work_recovery",
  "evening_presence",
  "silence_presence",
  "source_presence"
] as const;
const proactiveBubbleCandidateIds = [
  "idle_presence",
  "mode_presence",
  "startup_daily",
  "music_started",
  "explicit_game_started",
  "returned_from_away",
  "long_work_recovery",
  "evening_companion",
  "long_silence",
  "memory_safe",
  "search_citation_safe",
  "history_summary_safe"
] as const;
const petActionTriggerReasons = [
  "chat_opened",
  "chat_input_focus",
  "chat_reply_waiting",
  "pet_edge_settled",
  "rapid_touch_combo",
  "chat_reply_sustain",
  "chat_reply_completed",
  "state_music_playing_stable",
  "state_game_presence_stable",
  "return_from_idle",
  "evening_companion_tick",
  "long_work_session_complete",
  "state_idle",
  "state_greet",
  "state_listen",
  "state_think",
  "state_reply_sustain",
  "state_sleep",
  "state_work",
  "state_game",
  "state_read",
  "state_edge",
  "state_flustered",
  "state_local_model_busy",
  "state_memory_injected",
  "state_memory_skipped",
  "state_search_cited",
  "state_proactive_bubble_visible"
] as const satisfies readonly PetActionTriggerReason[];
const petActionTriggerRequestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const petActionTriggerSupersessionPolicies = ["replace_active"] as const satisfies readonly PetActionTriggerSupersessionPolicy[];
const petActionTriggerOrigin = "main_dispatch" as const;
const scaleWheelModifierPattern = /^(Ctrl|Alt|Shift|Meta)(\+(Ctrl|Alt|Shift|Meta))*$/;

function parsePetOverlayHitRegion(value: unknown): PetOverlayHitRegion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const region = value as Partial<PetOverlayHitRegion>;
  if (Object.keys(region).length !== 4 ||
    ![region.left, region.top, region.right, region.bottom].every((item) =>
      typeof item === "number" && Number.isFinite(item) && item >= 0) ||
    region.right! <= region.left! || region.bottom! <= region.top!) {
    return null;
  }
  return {
    left: region.left!,
    top: region.top!,
    right: region.right!,
    bottom: region.bottom!
  };
}

function parseAutomaticSituationSnapshot(value: unknown): AutomaticSituationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const snapshot = value as Partial<AutomaticSituationSnapshot>;
  if (
    !automaticConversationContextIds.includes(snapshot.conversationContextId as never) ||
    !automaticConversationSources.includes(snapshot.conversationSource as never) ||
    !automaticPresenceStateIds.includes(snapshot.presenceStateId as never) ||
    !automaticPresenceSources.includes(snapshot.presenceSource as never) ||
    (snapshot.confidence !== null && (
      typeof snapshot.confidence !== "number" ||
      !Number.isFinite(snapshot.confidence) ||
      snapshot.confidence < 0 ||
      snapshot.confidence > 1
    )) ||
    !Number.isSafeInteger(snapshot.revision) ||
    typeof snapshot.updatedAtMs !== "number" ||
    !Number.isFinite(snapshot.updatedAtMs) ||
    (snapshot.expiresAtMs !== null && (
      typeof snapshot.expiresAtMs !== "number" ||
      !Number.isFinite(snapshot.expiresAtMs)
    ))
  ) {
    return null;
  }
  return snapshot as AutomaticSituationSnapshot;
}

function isRequestVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isEmotionPresentation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const expression = value as {
    emotion?: unknown;
    intensity?: unknown;
    mode?: unknown;
  };
  const isEmotion = typeof expression.emotion === "string" && emotionTags.includes(expression.emotion as typeof emotionTags[number]);
  const isIntensity = typeof expression.intensity === "string" &&
    emotionIntensities.includes(expression.intensity as typeof emotionIntensities[number]);
  const emotion = typeof expression.emotion === "string" ? expression.emotion : "";
  const expectedMode = expression.emotion === "neutral"
    ? "neutral"
    : expression.intensity === "high" && ["happy", "sad", "angry", "surprised"].includes(emotion)
      ? "emphasis"
      : "micro";

  return isEmotion && isIntensity && expression.mode === expectedMode;
}

function parsePetAccessorySelection(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > petAccessoryGroups.length) {
    return null;
  }

  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const candidate of value) {
    const item = petAccessoryCatalog.find((entry) => entry.id === candidate);
    if (!item || ids.has(item.id) || groups.has(item.group)) {
      return null;
    }
    ids.add(item.id);
    groups.add(item.group);
  }

  const canonical = petAccessoryCatalog.flatMap((item) => ids.has(item.id) ? [item.id] : []);
  return canonical.every((id, index) => id === value[index]) ? canonical : null;
}

function isPetAccessoryResolution(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const resolution = value as {
    accessoryIds?: unknown;
    sourceByGroup?: Record<string, unknown>;
  };
  const accessoryIds = parsePetAccessorySelection(resolution.accessoryIds);
  return Boolean(
    accessoryIds &&
    resolution.sourceByGroup &&
    Object.keys(resolution.sourceByGroup).length === petAccessoryGroups.length &&
    petAccessoryGroups.every((group) =>
      petAccessorySources.includes(
        resolution.sourceByGroup?.[group] as (typeof petAccessorySources)[number]
      )
    )
  );
}

function isPetPresentationIntent(value: unknown): value is PetPresentationIntent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const intent = value as Partial<PetPresentationIntent>;
  const requestVersion = intent.requestVersion;

  return Boolean(
    typeof intent.state === "string" &&
    petRoleStates.includes(intent.state as PetRoleState) &&
    (requestVersion === null || (typeof requestVersion === "number" && isRequestVersion(requestVersion))) &&
    (intent.gaze === "ambient" || intent.gaze === "attentive") &&
    (intent.workStatus === "idle" || intent.workStatus === "thinking") &&
    isEmotionPresentation(intent.expression) &&
    isPetAccessoryResolution(intent.accessorySelection) &&
    typeof intent.allowMicroExpression === "boolean" &&
    typeof intent.allowEmphasisExpression === "boolean" &&
    (intent.recovery === "normal" || intent.recovery === "safe-neutral") &&
    (intent.recovery !== "safe-neutral" || intent.expression?.emotion === "neutral")
  );
}

function isScaleWheelModifierAccelerator(value: unknown): value is string {
  if (typeof value !== "string" || !scaleWheelModifierPattern.test(value)) {
    return false;
  }

  const parts = value.split("+");
  return new Set(parts).size === parts.length;
}

function isPetWindowMotionFeedback(value: unknown): value is PetWindowMotionFeedback {
  return Boolean(
    typeof value === "object" &&
    value !== null &&
    (value as Partial<PetWindowMotionFeedback>).type === "shake_light_feedback"
  );
}

function parsePetActionTrigger(value: unknown): PetActionTrigger | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const trigger = value as Partial<PetActionTrigger>;
  if (Object.hasOwn(trigger, "origin")) {
    return null;
  }
  if (
    typeof trigger.reason !== "string" ||
    !petActionTriggerReasons.includes(trigger.reason as PetActionTriggerReason)
  ) {
    return null;
  }
  if (trigger.requestId === undefined && trigger.supersessionPolicy === undefined) {
    return { reason: trigger.reason, origin: petActionTriggerOrigin };
  }
  if (
    typeof trigger.requestId !== "string" ||
    !petActionTriggerRequestIdPattern.test(trigger.requestId)
  ) {
    return null;
  }
  if (trigger.supersessionPolicy === undefined) {
    return {
      reason: trigger.reason,
      requestId: trigger.requestId,
      origin: petActionTriggerOrigin
    };
  }
  return trigger.reason === "chat_opened" &&
    petActionTriggerSupersessionPolicies.includes(trigger.supersessionPolicy)
    ? {
        reason: trigger.reason,
        requestId: trigger.requestId,
        supersessionPolicy: trigger.supersessionPolicy,
        origin: petActionTriggerOrigin
      }
    : null;
}

function parseProactiveSpeechBubblePayload(value: unknown): ProactiveSpeechBubblePayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ProactiveSpeechBubblePayload>;
  const durationMs = payload.durationMs;
  const lineId = typeof payload.lineId === "string" &&
    proactiveSpeechBubbleLineIds.includes(payload.lineId as (typeof proactiveSpeechBubbleLineIds)[number])
    ? payload.lineId as ProactiveSpeechBubblePayload["lineId"]
    : null;
  const reason = typeof payload.reason === "string" &&
    proactiveSpeechBubbleReasons.includes(payload.reason as ProactiveSpeechBubbleReason)
    ? payload.reason as ProactiveSpeechBubbleReason
    : null;

  if (!lineId || !reason || typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return null;
  }

  if (durationMs < 1_000 || durationMs > 10_000) {
    return null;
  }

  return {
    lineId,
    reason,
    durationMs: Math.round(durationMs)
  };
}

const api: PetApi = {
  reportFirstFrame(info: PetFirstFrameInfo) {
    ipcRenderer.send("pet:first-frame", info);
  },
  reportRenderHealth(state: RenderHealth) {
    ipcRenderer.send("pet:health", state);
  },
  reportTelemetry(type: string, payload?: Record<string, unknown>) {
    ipcRenderer.send("pet:telemetry", { type, payload });
  },
  setPointerHit(isHit: boolean) {
    ipcRenderer.send("pet:pointer-hit-change", { isHit });
  },
  setBubblePointerHit(isHit: boolean) {
    ipcRenderer.send("pet:bubble-pointer-hit-change", { isHit });
  },
  setBubbleHitRegion(region: PetOverlayHitRegion | null) {
    if (region === null) {
      ipcRenderer.send("pet:bubble-hit-region-change", null);
      return;
    }
    const parsed = parsePetOverlayHitRegion(region);
    if (parsed) {
      ipcRenderer.send("pet:bubble-hit-region-change", parsed);
    }
  },
  presentationReady() {
    ipcRenderer.send("pet:presentation-ready");
  },
  onPresentationIntent(handler) {
    const listener = (_event: Electron.IpcRendererEvent, intent: unknown): void => {
      if (isPetPresentationIntent(intent)) {
        handler(intent);
      }
    };

    ipcRenderer.on("pet:apply-presentation", listener);

    return () => {
      ipcRenderer.removeListener("pet:apply-presentation", listener);
    };
  },
  onActionTrigger(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const trigger = parsePetActionTrigger(value);
      if (trigger) {
        handler(trigger);
      }
    };

    ipcRenderer.on("pet:action-trigger", listener);

    return () => {
      ipcRenderer.removeListener("pet:action-trigger", listener);
    };
  },
  onProactiveSpeechBubble(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parseProactiveSpeechBubblePayload(value);
      if (payload) {
        handler(payload);
      }
    };

    ipcRenderer.on("pet:proactive-speech-bubble", listener);

    return () => {
      ipcRenderer.removeListener("pet:proactive-speech-bubble", listener);
    };
  },
  onClearProactiveSpeechBubble(handler) {
    const listener = (): void => {
      handler();
    };

    ipcRenderer.on("pet:clear-proactive-speech-bubble", listener);

    return () => {
      ipcRenderer.removeListener("pet:clear-proactive-speech-bubble", listener);
    };
  },
  async activateProactiveSpeechBubble(payload: ProactiveSpeechBubbleActivation) {
    const result = await ipcRenderer.invoke("pet:activate-proactive-speech-bubble", payload);
    return result === true;
  },
  async injectProactiveBubbleCandidateForAcceptance(candidateId: ProactiveBubbleCandidateId) {
    if (!proactiveBubbleCandidateIds.includes(candidateId)) {
      return false;
    }
    const result = await ipcRenderer.invoke("pet:p2-83a-inject-candidate", candidateId);
    return result === true;
  },
  async getNativeWindowHandleForAcceptance() {
    const value = await ipcRenderer.invoke("pet:p2-83a-native-window-handle");
    return typeof value === "string" && /^\d{1,20}$/u.test(value) ? value : null;
  },
  onInjectWebGLContextLoss(handler: () => void) {
    const listener = (): void => {
      handler();
    };

    ipcRenderer.on("pet:inject-webgl-context-loss", listener);

    return () => {
      ipcRenderer.removeListener("pet:inject-webgl-context-loss", listener);
    };
  },
  onWindowMotionFeedback(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isPetWindowMotionFeedback(value)) {
        handler(value);
      }
    };

    ipcRenderer.on("pet:window-motion-feedback", listener);

    return () => {
      ipcRenderer.removeListener("pet:window-motion-feedback", listener);
    };
  },
  openChat() {
    void ipcRenderer.invoke("pet:open-chat");
  },
  startDrag() {
    ipcRenderer.send("pet:drag-start");
  },
  moveDrag(delta: PetDragDelta) {
    ipcRenderer.send("pet:drag-move", delta);
  },
  endDrag() {
    ipcRenderer.send("pet:drag-end");
  },
  adjustScale(intent: PetScaleAdjustmentIntent) {
    if (intent.steps !== -1 && intent.steps !== 1) {
      return;
    }

    ipcRenderer.send("pet:adjust-scale", intent);
  },
  async getScaleWheelModifier() {
    const accelerator = await ipcRenderer.invoke("shortcuts:get-scale-wheel-modifier");

    if (!isScaleWheelModifierAccelerator(accelerator)) {
      throw new Error("Invalid scale wheel modifier response");
    }

    return accelerator;
  },
  onScaleWheelModifierChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isScaleWheelModifierAccelerator(value)) {
        handler(value);
      }
    };

    ipcRenderer.on("shortcuts:scale-wheel-modifier-changed", listener);
    return () => {
      ipcRenderer.removeListener("shortcuts:scale-wheel-modifier-changed", listener);
    };
  },
  async getAutomaticSituation() {
    const snapshot = parseAutomaticSituationSnapshot(await ipcRenderer.invoke("automaticSituation:get"));
    if (!snapshot) {
      throw new Error("Invalid automatic situation response");
    }
    return snapshot;
  },
  onAutomaticSituationChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const snapshot = parseAutomaticSituationSnapshot(value);
      if (snapshot) {
        handler(snapshot);
      }
    };

    ipcRenderer.on("automaticSituation:changed", listener);
    return () => {
      ipcRenderer.removeListener("automaticSituation:changed", listener);
    };
  }
};

contextBridge.exposeInMainWorld("petApi", api);
