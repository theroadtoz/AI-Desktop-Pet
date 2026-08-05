/** Closed, persistent telemetry contract. Runtime/IPC telemetry is separate. */
type EnumRule = { readonly kind: "enum"; readonly values: readonly string[] };
type BooleanRule = { readonly kind: "boolean" };
type NumberRule = { readonly kind: "number"; readonly min: number; readonly max: number; readonly integer?: boolean };
type FieldRule = EnumRule | BooleanRule | NumberRule;
type EventSchema = { readonly fields: Readonly<{ [key: string]: FieldRule }> };

const empty = { fields: {} } as const satisfies EventSchema;
const SOURCES = ["file", "env", "default", "ipc"] as const;
const ERROR_TYPES = ["validation", "parse", "read"] as const;
const HEALTH_STATUSES = [
  "ready", "invalid_config", "missing_api_key", "service_unreachable",
  "incompatible_response", "model_missing", "cancelled", "timeout"
] as const;
const ACTION_TYPES = [
  "appearance", "headPat", "bodyAttentionTurn", "dialogueOpenWelcome", "replyWarmSettle",
  "musicListenSway", "gamePresenceGlance", "searchNoteSettle", "returnFromIdle",
  "eveningWindowGlance", "longWorkRecovery", "greeting", "listen", "curiousTilt",
  "softSmile", "quietNod", "shySmile", "lookAway", "thinking", "replyThinking",
  "playGame", "gameReady", "gameCheerLite", "reading", "readingIdle", "readingThink",
  "focus", "workFocus", "doze", "sleepySettle", "edgeGlance", "flusteredGlance", "replySustain"
] as const;
const TERMINAL_STATUSES = ["completed", "interrupted", "timed_out", "failed"] as const;
const ACTION_SKIP_REASONS = [
  "active_action",
  "global_cooldown",
  "head_pat_cooldown",
  "same_action_cooldown",
  "window_shake_feedback_cooldown"
] as const;

/** Literal registry is the single runtime and compile-time event authority. */
export const PERSISTENT_TELEMETRY_CATALOG = {
  second_instance_received: empty,
  pet_window_duplicate_prevented: empty,
  pet_window_reuse: empty,
  pet_window_created: empty,
  pet_window_rebuilt: empty,
  bundled_llama_cpp_runtime_resolved: empty,
  bundled_llama_cpp_runtime_status: empty,
  bundled_llama_cpp_provider_handoff: empty,
  llama_cpp_runtime_status: empty,
  llama_cpp_provider_handoff: empty,
  llama_cpp_runtime_stopped: empty,
  local_model_diagnostic_completed: empty,
  automatic_situation_changed: empty,
  automatic_situation_classified: empty,
  automatic_situation_snapshot_used: empty,
  chat_context_semantic_summary: empty,
  chat_stream_started: empty,
  chat_stream_completed: empty,
  chat_stream_aborted: empty,
  chat_stream_failed: empty,
  diagnostic_shortcut_registration: empty,
  diagnostic_shortcut_triggered: empty,
  dialogue_affect_action_dispatch: empty,
  dialogue_affect_decision: empty,
  first_frame: empty,
  low_frequency_companion_event: empty,
  memory_auto_capture: empty,
  memory_auto_capture_failed: empty,
  performance_heartbeat: empty,
  pet_health: empty,
  pet_lock_changed: empty,
  pet_lock_shortcut_registration: empty,
  pet_lock_shortcut_triggered: empty,
  pet_role_transition: empty,
  proactive_bubble_candidate: empty,
  proactive_bubble_overlay_hit_changed: empty,
  proactive_bubble_overlay_region_changed: empty,
  proactive_companion_settings_changed: empty,
  proactive_speech_bubble: empty,
  recovery_limit_reached: empty,
  startup: empty,
  web_search_blocked: empty,
  web_search_completed: empty,
  web_search_connection_tested: empty,
  web_search_failed: empty,
  web_search_settings_updated: empty,
  web_search_started: empty,
  web_search_startup_connection_skipped: empty,
  web_search_startup_connection_tested: empty,
  window_snapshot: empty,
  xita_affect_transition: empty,
  xita_interaction_cue_shadow_observed: empty,
  bundled_llama_cpp_chat_wait_started: empty,
  bundled_llama_cpp_chat_wait_completed: empty,
  provider_selected: empty,
  provider_unavailable: empty,
  provider_unavailable_reply_blocked: empty,
  provider_local_exact_reply_completed: empty,
  provider_request_started: empty,
  provider_request_completed: empty,
  provider_request_failed: empty,
  pet_performance_sample: empty,
  pet_presentation_intent_applied: empty,
  webgl_context_lost: empty,
  webgl_context_restored: empty,
  recovery_started: empty,
  recovery_succeeded: empty,
  recovery_failed: empty,
  renderer_process_gone: empty,
  child_process_gone: empty,
  pet_window_motion_detected: empty,
  pet_window_motion_feedback: empty,
  pet_scale_adjusted: empty,
  provider_config_loaded: { fields: { source: { kind: "enum", values: SOURCES }, configured: { kind: "boolean" } } },
  provider_config_saved: { fields: { source: { kind: "enum", values: SOURCES }, configured: { kind: "boolean" } } },
  provider_config_invalid: { fields: { source: { kind: "enum", values: SOURCES }, errorType: { kind: "enum", values: ERROR_TYPES } } },
  provider_config_migrated: { fields: { source: { kind: "enum", values: SOURCES }, configured: { kind: "boolean" } } },
  secure_key_saved: { fields: { configured: { kind: "boolean" } } },
  secure_key_deleted: { fields: { configured: { kind: "boolean" } } },
  secure_key_store_unencrypted_fallback: { fields: { configured: { kind: "boolean" } } },
  user_profile_loaded: { fields: { source: { kind: "enum", values: SOURCES }, configured: { kind: "boolean" } } },
  user_profile_invalid: { fields: { source: { kind: "enum", values: SOURCES }, errorType: { kind: "enum", values: ERROR_TYPES } } },
  user_profile_saved: { fields: { configured: { kind: "boolean" } } },
  user_profile_cleared: { fields: { configured: { kind: "boolean" } } },
  provider_health_checked: { fields: { status: { kind: "enum", values: HEALTH_STATUSES }, latencyBucketMs: { kind: "number", min: 0, max: 600_000, integer: true } } },
  pet_interaction_action_started: { fields: { actionType: { kind: "enum", values: ACTION_TYPES } } },
  pet_interaction_action_finished: { fields: { actionType: { kind: "enum", values: ACTION_TYPES }, terminalStatus: { kind: "enum", values: TERMINAL_STATUSES } } },
  pet_interaction_action_skipped: { fields: {
    actionType: { kind: "enum", values: ACTION_TYPES },
    skipReason: { kind: "enum", values: ACTION_SKIP_REASONS }
  } }
} as const satisfies Readonly<{ [key: string]: EventSchema }>;

export type TelemetryEventType = keyof typeof PERSISTENT_TELEMETRY_CATALOG;
declare const persistentTelemetryEventBrand: unique symbol;
/** Opaque: callers cannot construct writer input without runtime validation. */
export type PersistentTelemetryEvent = { readonly [persistentTelemetryEventBrand]: true };
export type PersistentTelemetryLogger = (event: PersistentTelemetryEvent) => void;

type Primitive = string | number | boolean;
type InternalPersistentTelemetryEvent = {
  readonly type: TelemetryEventType;
  readonly payload: { readonly [key: string]: Primitive };
};

const FORBIDDEN_KEY = /(?:^|[_-])(conversation|request|action|instance|version|line|event|candidate)?id$|(?:path|screen|display|window|canvas|bounds|scale|coordinate|pid|process|frame|raf|cpu|gpu|rss|host|port|model|provider|prompt|message|body|query|snippet|title|url|key|token|metadata|timestamp)/iu;
const FORBIDDEN_VALUE = /(?:prompt|body|path|request|conversation|action|model|host|port|key|metadata)[_-]?sentinel|^c1_/iu;

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAllowedValue(value: unknown, rule: FieldRule): value is Primitive {
  if (rule.kind === "boolean") return typeof value === "boolean";
  if (rule.kind === "enum") return typeof value === "string" && rule.values.includes(value) && !FORBIDDEN_VALUE.test(value);
  return typeof value === "number" && Number.isFinite(value) && (!rule.integer || Number.isInteger(value)) && value >= rule.min && value <= rule.max;
}

function brand(event: InternalPersistentTelemetryEvent): PersistentTelemetryEvent {
  return event as unknown as PersistentTelemetryEvent;
}

export function parsePersistentTelemetryEvent(value: unknown): PersistentTelemetryEvent | null {
  if (!isPlainObject(value) || typeof value.type !== "string" || !isPlainObject(value.payload)) return null;
  if (!isPersistentTelemetryEventType(value.type)) return null;
  const schema: EventSchema = PERSISTENT_TELEMETRY_CATALOG[value.type];
  const keys = Object.keys(value.payload);
  const allowedKeys = Object.keys(schema.fields);
  if (keys.length !== allowedKeys.length || keys.some((key) => FORBIDDEN_KEY.test(key) || !(key in schema.fields))) return null;
  const payload: { [key: string]: Primitive } = {};
  for (const key of allowedKeys) {
    const rule = schema.fields[key];
    const fieldValue = value.payload[key];
    if (!rule || !Object.prototype.hasOwnProperty.call(value.payload, key) || !isAllowedValue(fieldValue, rule)) return null;
    payload[key] = fieldValue;
  }
  return brand({ type: value.type, payload });
}

function isOperationalId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function parseActionOperationalInput(type: TelemetryEventType, payload: unknown): PersistentTelemetryEvent | null {
  if (!isPlainObject(payload)) return null;
  const terminal = type === "pet_interaction_action_finished";
  const skipped = type === "pet_interaction_action_skipped";
  const allowed = new Set(terminal
    ? ["type", "terminalStatus", "requestId", "actionInstanceId"]
    : skipped
      ? ["type", "skipReason", "requestId", "actionInstanceId"]
      : ["type", "requestId", "actionInstanceId"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;
  for (const key of ["requestId", "actionInstanceId"] as const) {
    if (key in payload && !isOperationalId(payload[key])) return null;
  }
  return parsePersistentTelemetryEvent({
    type,
    payload: terminal
      ? { actionType: payload.type, terminalStatus: payload.terminalStatus }
      : skipped
        ? { actionType: payload.type, skipReason: payload.skipReason }
        : { actionType: payload.type }
  });
}

/** Exact producer boundary. Only three action events may strip two known operational IDs. */
export function toPersistentTelemetryEvent(
  type: TelemetryEventType,
  payload: unknown = {}
): PersistentTelemetryEvent | null {
  if (type === "pet_interaction_action_started" || type === "pet_interaction_action_finished" || type === "pet_interaction_action_skipped") {
    return parseActionOperationalInput(type, payload);
  }
  return parsePersistentTelemetryEvent({ type, payload });
}

export function isPersistentTelemetryEventType(value: unknown): value is TelemetryEventType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PERSISTENT_TELEMETRY_CATALOG, value);
}

/** Only the writer uses this opaque unwrap after validation. */
export function encodePersistentTelemetryEvent(event: PersistentTelemetryEvent, timestamp: string): string | null {
  const parsed = parsePersistentTelemetryEvent(event);
  if (!parsed) return null;
  const internal = parsed as unknown as InternalPersistentTelemetryEvent;
  return JSON.stringify({ timestamp, type: internal.type, payload: internal.payload });
}
