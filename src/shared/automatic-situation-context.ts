export const AUTOMATIC_CONVERSATION_CONTEXT_IDS = [
  "default",
  "work",
  "game",
  "reading"
] as const;

export const MODEL_CONVERSATION_CONTEXT_IDS = ["default", "work", "reading"] as const;
export const AUTOMATIC_PRESENCE_STATE_IDS = ["default", "focus", "quiet", "sleep"] as const;

export type AutomaticConversationContextId = typeof AUTOMATIC_CONVERSATION_CONTEXT_IDS[number];
export type ModelConversationContextId = typeof MODEL_CONVERSATION_CONTEXT_IDS[number];
export type AutomaticPresenceStateId = typeof AUTOMATIC_PRESENCE_STATE_IDS[number];
export type AutomaticConversationSource =
  | "default"
  | "bundled-local-model"
  | "user-explicit"
  | "expired";

export type AutomaticPresenceSource =
  | "default"
  | "work-activity"
  | "quiet-preference"
  | "deterministic-sleep";

export type AutomaticSituationClassification = {
  label: ModelConversationContextId;
  confidence: number;
};

export type AutomaticSituationSnapshot = {
  conversationContextId: AutomaticConversationContextId;
  conversationSource: AutomaticConversationSource;
  presenceStateId: AutomaticPresenceStateId;
  presenceSource: AutomaticPresenceSource;
  confidence: number | null;
  revision: number;
  updatedAtMs: number;
  expiresAtMs: number | null;
};

export const AUTOMATIC_SLEEP_IDLE_THRESHOLD_MS = 90 * 60_000;

export function isAutomaticConversationContextId(value: unknown): value is AutomaticConversationContextId {
  return typeof value === "string" &&
    AUTOMATIC_CONVERSATION_CONTEXT_IDS.includes(value as AutomaticConversationContextId);
}

export function isAutomaticPresenceStateId(value: unknown): value is AutomaticPresenceStateId {
  return typeof value === "string" &&
    AUTOMATIC_PRESENCE_STATE_IDS.includes(value as AutomaticPresenceStateId);
}

export function parseAutomaticSituationClassification(value: unknown): AutomaticSituationClassification | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "confidence" || keys[1] !== "label") {
    return null;
  }
  if (
    typeof record.label !== "string" ||
    !MODEL_CONVERSATION_CONTEXT_IDS.includes(record.label as ModelConversationContextId) ||
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    return null;
  }

  return {
    label: record.label as ModelConversationContextId,
    confidence: record.confidence
  };
}

export function parseAutomaticSituationSnapshot(value: unknown): AutomaticSituationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<AutomaticSituationSnapshot>;
  if (
    !isAutomaticConversationContextId(snapshot.conversationContextId) ||
    !isAutomaticPresenceStateId(snapshot.presenceStateId) ||
    !isAutomaticConversationSource(snapshot.conversationSource) ||
    !isAutomaticPresenceSource(snapshot.presenceSource) ||
    (snapshot.confidence !== null && (
      typeof snapshot.confidence !== "number" ||
      !Number.isFinite(snapshot.confidence) ||
      snapshot.confidence < 0 ||
      snapshot.confidence > 1
    )) ||
    typeof snapshot.revision !== "number" ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
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

export function deriveAutomaticPresenceState(input: {
  conversationContextId: AutomaticConversationContextId;
  appActive: boolean;
  quietRequested: boolean;
  localTimeBand: "morning" | "afternoon" | "evening" | "night";
  systemIdleMs: number;
}): { stateId: AutomaticPresenceStateId; source: AutomaticPresenceSource } {
  if (
    input.localTimeBand === "night" &&
    Number.isFinite(input.systemIdleMs) &&
    input.systemIdleMs >= AUTOMATIC_SLEEP_IDLE_THRESHOLD_MS
  ) {
    return { stateId: "sleep", source: "deterministic-sleep" };
  }

  if (input.quietRequested) {
    return { stateId: "quiet", source: "quiet-preference" };
  }

  if (input.conversationContextId === "work" && input.appActive) {
    return { stateId: "focus", source: "work-activity" };
  }

  return { stateId: "default", source: "default" };
}

function isAutomaticConversationSource(value: unknown): value is AutomaticConversationSource {
  return value === "default" ||
    value === "bundled-local-model" ||
    value === "user-explicit" ||
    value === "expired";
}

function isAutomaticPresenceSource(value: unknown): value is AutomaticPresenceSource {
  return value === "default" ||
    value === "work-activity" ||
    value === "quiet-preference" ||
    value === "deterministic-sleep";
}
