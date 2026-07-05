import type { DialogueModeId } from "./dialogue-style";
import type { PresenceModeId } from "./presence-mode";
import { PET_MOTION_PRESET_IDS } from "./pet-motion-presets.ts";

export const PET_TELEMETRY_EVENT_TYPES = [
  "pet_health",
  "pet_performance_sample",
  "pet_presentation_intent_applied",
  "webgl_context_lost",
  "webgl_context_restored",
  "recovery_started",
  "recovery_succeeded",
  "recovery_failed",
  "renderer_process_gone",
  "child_process_gone",
  "pet_interaction_action_started",
  "pet_interaction_action_finished",
  "pet_interaction_action_skipped",
  "pet_window_motion_detected",
  "pet_window_motion_feedback",
  "pet_scale_adjusted"
] as const;

export const PET_RENDERER_TELEMETRY_EVENT_TYPES = [
  "pet_performance_sample",
  "pet_presentation_intent_applied",
  "webgl_context_lost",
  "webgl_context_restored",
  "recovery_started",
  "recovery_succeeded",
  "recovery_failed",
  "pet_interaction_action_started",
  "pet_interaction_action_finished",
  "pet_interaction_action_skipped",
  "pet_window_motion_feedback"
] as const satisfies readonly PetTelemetryEventType[];

export const PET_TELEMETRY_ALLOWED_FIELDS = [
  "type",
  "reason",
  "durationMs",
  "eventType",
  "feedbackType",
  "result",
  "skipReason",
  "cooldownState",
  "stateId",
  "modeId",
  "presenceModeId",
  "candidateActionTypes",
  "selectedActionType",
  "activeType",
  "expressionPresetId",
  "motionPresetId",
  "restoredAccessoryPresetId",
  "isLocked",
  "isDragging",
  "scale",
  "petScale",
  "source",
  "renderer",
  "window",
  "recoveryCount",
  "isContextLost",
  "exitCode",
  "framesPerSecond",
  "canvasWidth",
  "canvasHeight",
  "nonTransparentPixels",
  "opaqueBlackPixels",
  "firstFrameMs",
  "renderStartMs",
  "rendererTimestamp",
  "mode",
  "state",
  "requestVersion",
  "emotion",
  "intensity",
  "recovery",
  "allowMicroExpression",
  "allowEmphasisExpression",
  "targetFramesPerSecond",
  "rafCallbacks",
  "renderedFrames",
  "skippedFrames",
  "live2DUpdates",
  "physicsUpdates",
  "breathUpdates",
  "rafFramesPerSecond",
  "renderedFramesPerSecond",
  "skippedFramesPerSecond",
  "live2DUpdatesPerSecond",
  "physicsUpdatesPerSecond",
  "breathUpdatesPerSecond",
  "directionChanges",
  "distancePx"
] as const;

export type PetTelemetryEventType = typeof PET_TELEMETRY_EVENT_TYPES[number];
export type PetRendererTelemetryEventType = typeof PET_RENDERER_TELEMETRY_EVENT_TYPES[number];
export type PetTelemetryPayloadValue = string | number | boolean | null | readonly string[];
export type PetTelemetryPayload = Record<string, PetTelemetryPayloadValue>;

export type PetTelemetryEvent = {
  type: PetTelemetryEventType;
  payload?: PetTelemetryPayload;
};

type PetTelemetryEventInput = {
  type: PetTelemetryEventType;
  payload?: unknown;
};

const PET_TELEMETRY_EVENT_TYPE_SET = new Set<string>(PET_TELEMETRY_EVENT_TYPES);
const PET_RENDERER_TELEMETRY_EVENT_TYPE_SET = new Set<string>(PET_RENDERER_TELEMETRY_EVENT_TYPES);

const PET_INTERACTION_ACTION_TYPES = [
  "appearance",
  "headPat",
  "greeting",
  "listen",
  "curiousTilt",
  "softSmile",
  "quietNod",
  "shySmile",
  "lookAway",
  "thinking",
  "replyThinking",
  "playGame",
  "gameReady",
  "gameCheerLite",
  "reading",
  "readingIdle",
  "readingThink",
  "focus",
  "workFocus",
  "doze",
  "sleepySettle",
  "edgeGlance",
  "flusteredGlance",
  "replySustain"
] as const;
const PET_ACTION_STATE_IDS = [
  "idle",
  "greet",
  "listen",
  "think",
  "reply-sustain",
  "sleep",
  "work",
  "game",
  "read",
  "edge",
  "flustered",
  "local-model-busy"
] as const;
const PET_EXPRESSION_PRESET_IDS = [
  "dark",
  "staff",
  "ghost",
  "angry",
  "hat",
  "sad",
  "bow",
  "glasses",
  "excited",
  "happy",
  "gestureGame",
  "gestureMic"
] as const;

const DIALOGUE_MODE_IDS = ["default", "work", "game", "reading"] as const;
const PRESENCE_MODE_IDS = ["default", "focus", "quiet", "sleep"] as const;
const PET_ACCESSORY_PRESET_IDS = ["none", "glasses"] as const;
const PET_INTERACTION_REASONS = [
  "startup_first_visible_frame",
  "click_head",
  "click_body",
  "window_shake_feedback",
  "chat_opened",
  "chat_input_focus",
  "chat_reply_waiting",
  "pet_edge_settled",
  "rapid_touch_combo",
  "chat_reply_sustain",
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
  "state_local_model_busy"
] as const;
const PET_INTERACTION_SKIP_REASONS = [
  "active_action",
  "global_cooldown",
  "head_pat_cooldown",
  "same_action_cooldown",
  "window_shake_feedback_cooldown"
] as const;
const PET_WINDOW_MOTION_EVENT_TYPES = ["window_shake_candidate", "window_move_observed"] as const;
const PET_WINDOW_MOTION_REASONS = ["drag_direction_changes", "fast_linear_drag"] as const;
const PET_WINDOW_MOTION_FEEDBACK_TYPES = ["shake_light_feedback"] as const;
const PET_WINDOW_MOTION_FEEDBACK_RESULTS = ["started", "skipped"] as const;
const PET_TELEMETRY_COOLDOWN_STATES = ["available", "cooling_down"] as const;
const PET_RENDERERS = ["live2d", "placeholder"] as const;
const PET_WINDOWS = ["pet"] as const;
const PET_RENDER_BUDGET_MODES = ["active", "idle", "background"] as const;
const PET_ROLE_STATES = ["idle", "listening", "thinking", "replying", "interrupted", "error"] as const;
const PET_EMOTIONS = ["neutral", "happy", "sad", "surprised", "confused", "angry"] as const;
const PET_EMOTION_INTENSITIES = ["low", "medium", "high"] as const;
const PET_EMOTION_MODES = ["neutral", "micro", "emphasis"] as const;
const PET_RECOVERY_STATES = ["normal", "safe-neutral"] as const;
const PET_RECOVERY_SOURCES = ["webgl_context_lost", "webgl_context_restored", "renderer_process_gone"] as const;
const CHILD_PROCESS_TYPES = ["Utility", "Zygote", "Sandbox helper", "GPU", "Pepper Plugin", "Pepper Plugin Broker", "Unknown"] as const;
const PROCESS_GONE_REASONS = [
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringFrom<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : undefined;
}

function readDialogueModeId(value: unknown): DialogueModeId | undefined {
  return readStringFrom(value, DIALOGUE_MODE_IDS);
}

function readPresenceModeId(value: unknown): PresenceModeId | undefined {
  return readStringFrom(value, PRESENCE_MODE_IDS);
}

function readActionTypes(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > PET_INTERACTION_ACTION_TYPES.length) {
    return undefined;
  }

  const actionTypes = value.filter((item) => readStringFrom(item, PET_INTERACTION_ACTION_TYPES));
  return actionTypes.length === value.length ? actionTypes : undefined;
}

function putString<const T extends readonly string[]>(
  target: PetTelemetryPayload,
  payload: Record<string, unknown>,
  key: string,
  allowed: T
): void {
  const value = readStringFrom(payload[key], allowed);
  if (value !== undefined) {
    target[key] = value;
  }
}

function putDialogueModeId(target: PetTelemetryPayload, payload: Record<string, unknown>, key: string): void {
  const value = readDialogueModeId(payload[key]);
  if (value !== undefined) {
    target[key] = value;
  }
}

function putPresenceModeId(target: PetTelemetryPayload, payload: Record<string, unknown>, key: string): void {
  const value = readPresenceModeId(payload[key]);
  if (value !== undefined) {
    target[key] = value;
  }
}

function putNumber(target: PetTelemetryPayload, payload: Record<string, unknown>, key: string): void {
  const value = readNumber(payload[key]);
  if (value !== undefined) {
    target[key] = value;
  }
}

function putBoolean(target: PetTelemetryPayload, payload: Record<string, unknown>, key: string): void {
  const value = readBoolean(payload[key]);
  if (value !== undefined) {
    target[key] = value;
  }
}

function putActionTypes(target: PetTelemetryPayload, payload: Record<string, unknown>, key: string): void {
  const value = readActionTypes(payload[key]);
  if (value !== undefined) {
    target[key] = value;
  }
}

function sanitizeHealthPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "renderer", PET_RENDERERS);
  for (const key of [
    "framesPerSecond",
    "canvasWidth",
    "canvasHeight",
    "nonTransparentPixels",
    "opaqueBlackPixels",
    "firstFrameMs",
    "renderStartMs",
    "recoveryCount",
    "rendererTimestamp"
  ]) {
    putNumber(safe, payload, key);
  }
  putBoolean(safe, payload, "isContextLost");
  return safe;
}

function sanitizePerformancePayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "mode", PET_RENDER_BUDGET_MODES);
  putPresenceModeId(safe, payload, "presenceModeId");
  for (const key of [
    "targetFramesPerSecond",
    "rafCallbacks",
    "renderedFrames",
    "skippedFrames",
    "live2DUpdates",
    "physicsUpdates",
    "breathUpdates",
    "rafFramesPerSecond",
    "renderedFramesPerSecond",
    "skippedFramesPerSecond",
    "live2DUpdatesPerSecond",
    "physicsUpdatesPerSecond",
    "breathUpdatesPerSecond"
  ]) {
    putNumber(safe, payload, key);
  }
  return safe;
}

function sanitizePresentationPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "state", PET_ROLE_STATES);
  putNumber(safe, payload, "requestVersion");
  putString(safe, payload, "emotion", PET_EMOTIONS);
  putString(safe, payload, "intensity", PET_EMOTION_INTENSITIES);
  putString(safe, payload, "mode", PET_EMOTION_MODES);
  putBoolean(safe, payload, "allowMicroExpression");
  putBoolean(safe, payload, "allowEmphasisExpression");
  putString(safe, payload, "recovery", PET_RECOVERY_STATES);
  return safe;
}

function sanitizeContextPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "renderer", PET_RENDERERS);
  putNumber(safe, payload, "recoveryCount");
  putBoolean(safe, payload, "isContextLost");
  return safe;
}

function sanitizeRecoveryPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "source", PET_RECOVERY_SOURCES);
  putString(safe, payload, "renderer", PET_RENDERERS);
  putString(safe, payload, "window", PET_WINDOWS);
  putNumber(safe, payload, "recoveryCount");
  return safe;
}

function sanitizeRendererGonePayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "window", PET_WINDOWS);
  putString(safe, payload, "reason", PROCESS_GONE_REASONS);
  putNumber(safe, payload, "exitCode");
  return safe;
}

function sanitizeChildProcessGonePayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "type", CHILD_PROCESS_TYPES);
  putString(safe, payload, "reason", PROCESS_GONE_REASONS);
  return safe;
}

function sanitizeInteractionActionPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "type", PET_INTERACTION_ACTION_TYPES);
  putString(safe, payload, "reason", PET_INTERACTION_REASONS);
  putString(safe, payload, "stateId", PET_ACTION_STATE_IDS);
  putNumber(safe, payload, "durationMs");
  putDialogueModeId(safe, payload, "modeId");
  putPresenceModeId(safe, payload, "presenceModeId");
  putActionTypes(safe, payload, "candidateActionTypes");
  putString(safe, payload, "selectedActionType", PET_INTERACTION_ACTION_TYPES);
  putString(safe, payload, "activeType", PET_INTERACTION_ACTION_TYPES);
  putString(safe, payload, "expressionPresetId", PET_EXPRESSION_PRESET_IDS);
  putString(safe, payload, "motionPresetId", PET_MOTION_PRESET_IDS);
  putString(safe, payload, "restoredAccessoryPresetId", PET_ACCESSORY_PRESET_IDS);
  putString(safe, payload, "skipReason", PET_INTERACTION_SKIP_REASONS);
  return safe;
}

function sanitizeWindowMotionDetectedPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "eventType", PET_WINDOW_MOTION_EVENT_TYPES);
  putString(safe, payload, "reason", PET_WINDOW_MOTION_REASONS);
  putNumber(safe, payload, "directionChanges");
  putNumber(safe, payload, "distancePx");
  putNumber(safe, payload, "durationMs");
  putString(safe, payload, "cooldownState", PET_TELEMETRY_COOLDOWN_STATES);
  putBoolean(safe, payload, "isLocked");
  putBoolean(safe, payload, "isDragging");
  return safe;
}

function sanitizeWindowMotionFeedbackPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putString(safe, payload, "eventType", PET_WINDOW_MOTION_EVENT_TYPES);
  putString(safe, payload, "reason", PET_INTERACTION_REASONS);
  putString(safe, payload, "feedbackType", PET_WINDOW_MOTION_FEEDBACK_TYPES);
  putString(safe, payload, "result", PET_WINDOW_MOTION_FEEDBACK_RESULTS);
  putString(safe, payload, "skipReason", PET_INTERACTION_SKIP_REASONS);
  putString(safe, payload, "cooldownState", PET_TELEMETRY_COOLDOWN_STATES);
  putNumber(safe, payload, "durationMs");
  return safe;
}

function sanitizeScaleAdjustedPayload(payload: Record<string, unknown>): PetTelemetryPayload {
  const safe: PetTelemetryPayload = {};
  putNumber(safe, payload, "scale");
  putNumber(safe, payload, "petScale");
  putString(safe, payload, "source", ["wheel"] as const);
  return safe;
}

function sanitizePayload(type: PetTelemetryEventType, payload: Record<string, unknown>): PetTelemetryPayload {
  switch (type) {
    case "pet_health":
      return sanitizeHealthPayload(payload);
    case "pet_performance_sample":
      return sanitizePerformancePayload(payload);
    case "pet_presentation_intent_applied":
      return sanitizePresentationPayload(payload);
    case "webgl_context_lost":
    case "webgl_context_restored":
      return sanitizeContextPayload(payload);
    case "recovery_started":
    case "recovery_succeeded":
    case "recovery_failed":
      return sanitizeRecoveryPayload(payload);
    case "renderer_process_gone":
      return sanitizeRendererGonePayload(payload);
    case "child_process_gone":
      return sanitizeChildProcessGonePayload(payload);
    case "pet_interaction_action_started":
    case "pet_interaction_action_finished":
    case "pet_interaction_action_skipped":
      return sanitizeInteractionActionPayload(payload);
    case "pet_window_motion_detected":
      return sanitizeWindowMotionDetectedPayload(payload);
    case "pet_window_motion_feedback":
      return sanitizeWindowMotionFeedbackPayload(payload);
    case "pet_scale_adjusted":
      return sanitizeScaleAdjustedPayload(payload);
  }
}

export function isPetTelemetryEventType(value: unknown): value is PetTelemetryEventType {
  return typeof value === "string" && PET_TELEMETRY_EVENT_TYPE_SET.has(value);
}

export function isPetRendererTelemetryEventType(value: unknown): value is PetRendererTelemetryEventType {
  return typeof value === "string" && PET_RENDERER_TELEMETRY_EVENT_TYPE_SET.has(value);
}

export function sanitizePetTelemetryEvent(event: PetTelemetryEventInput): PetTelemetryEvent {
  const payload = isRecord(event.payload) ? sanitizePayload(event.type, event.payload) : {};

  return Object.keys(payload).length > 0
    ? { type: event.type, payload }
    : { type: event.type };
}

export function parsePetTelemetryEvent(value: unknown): PetTelemetryEvent | null {
  if (!isRecord(value) || !isPetTelemetryEventType(value.type)) {
    return null;
  }

  return sanitizePetTelemetryEvent({
    type: value.type,
    payload: value.payload
  });
}

export function parsePetRendererTelemetryEvent(value: unknown): PetTelemetryEvent | null {
  const event = parsePetTelemetryEvent(value);
  return event && isPetRendererTelemetryEventType(event.type) ? event : null;
}
