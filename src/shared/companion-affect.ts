export const USER_AFFECT_KINDS = [
  "unknown",
  "calm",
  "positive",
  "excited",
  "low",
  "tense",
  "tired"
] as const;

export const AFFECT_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const USER_AFFECT_SOURCES = [
  "explicit-text",
  "conversational-inference",
  "user-correction"
] as const;
export const XITA_AFFECT_STATES = [
  "calm",
  "happy",
  "curious",
  "concerned",
  "playful",
  "embarrassed",
  "serious",
  "sleepy"
] as const;
export const XITA_AFFECT_INTENSITIES = ["low", "medium", "high"] as const;
export const XITA_AFFECT_TRANSITION_REASONS = [
  "conversation",
  "environment-safe",
  "idle-decay",
  "user-correction",
  "restart-recovery"
] as const;
export const AFFECT_DIALOGUE_CONTEXT_IDS = [
  "warm-positive",
  "gentle-curious",
  "quiet-support",
  "steady-serious",
  "light-playful",
  "gentle-embarrassed",
  "slow-sleepy"
] as const;

export type UserAffectKind = typeof USER_AFFECT_KINDS[number];
export type AffectConfidence = typeof AFFECT_CONFIDENCE_LEVELS[number];
export type UserAffectSource = typeof USER_AFFECT_SOURCES[number];
export type XitaAffectState = typeof XITA_AFFECT_STATES[number];
export type XitaAffectIntensity = typeof XITA_AFFECT_INTENSITIES[number];
export type XitaAffectTransitionReason = typeof XITA_AFFECT_TRANSITION_REASONS[number];
export type AffectDialogueContextId = typeof AFFECT_DIALOGUE_CONTEXT_IDS[number];

export type PerceivedUserAffect = {
  kind: UserAffectKind;
  confidence: AffectConfidence;
  source: UserAffectSource;
  observedAtMs: number;
};

export type UserAffectClassification = {
  label: UserAffectKind;
  confidence: number;
};

export type XitaAffectSnapshot = {
  state: XitaAffectState;
  intensity: XitaAffectIntensity;
  valence: number;
  arousal: number;
  transitionReason: XitaAffectTransitionReason;
  updatedAtMs: number;
  lastReinforcedAtMs: number;
};

const XITA_AFFECT_VECTORS: Record<XitaAffectState, { valence: number; arousal: number }> = {
  calm: { valence: 0, arousal: 0 },
  happy: { valence: 0.75, arousal: 0.55 },
  curious: { valence: 0.25, arousal: 0.35 },
  concerned: { valence: -0.45, arousal: 0.25 },
  playful: { valence: 0.65, arousal: 0.7 },
  embarrassed: { valence: -0.1, arousal: 0.5 },
  serious: { valence: -0.15, arousal: 0.4 },
  sleepy: { valence: 0.05, arousal: -0.7 }
};

export function createUnknownUserAffect(
  observedAtMs: number,
  source: UserAffectSource = "conversational-inference"
): PerceivedUserAffect {
  return {
    kind: "unknown",
    confidence: "low",
    source,
    observedAtMs
  };
}

export function createCalmXitaAffect(
  timestampMs: number,
  transitionReason: XitaAffectTransitionReason = "restart-recovery"
): XitaAffectSnapshot {
  return {
    state: "calm",
    intensity: "low",
    valence: 0,
    arousal: 0,
    transitionReason,
    updatedAtMs: timestampMs,
    lastReinforcedAtMs: timestampMs
  };
}

export function getXitaAffectVector(
  state: XitaAffectState
): { valence: number; arousal: number } {
  return { ...XITA_AFFECT_VECTORS[state] };
}

export function isUserAffectKind(value: unknown): value is UserAffectKind {
  return typeof value === "string" && USER_AFFECT_KINDS.includes(value as UserAffectKind);
}

export function isAffectConfidence(value: unknown): value is AffectConfidence {
  return typeof value === "string" &&
    AFFECT_CONFIDENCE_LEVELS.includes(value as AffectConfidence);
}

export function isXitaAffectState(value: unknown): value is XitaAffectState {
  return typeof value === "string" && XITA_AFFECT_STATES.includes(value as XitaAffectState);
}

export function isXitaAffectIntensity(value: unknown): value is XitaAffectIntensity {
  return typeof value === "string" &&
    XITA_AFFECT_INTENSITIES.includes(value as XitaAffectIntensity);
}

export function isAffectDialogueContextId(value: unknown): value is AffectDialogueContextId {
  return typeof value === "string" &&
    AFFECT_DIALOGUE_CONTEXT_IDS.includes(value as AffectDialogueContextId);
}

export function parseUserAffectClassification(value: unknown): UserAffectClassification | null {
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
    !isUserAffectKind(record.label) ||
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    return null;
  }

  return {
    label: record.label,
    confidence: record.confidence
  };
}
