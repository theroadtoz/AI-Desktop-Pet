import {
  createCalmXitaAffect,
  getXitaAffectVector,
  type AffectConfidence,
  type PerceivedUserAffect,
  type XitaAffectIntensity,
  type XitaAffectSnapshot,
  type XitaAffectState,
  type XitaAffectTransitionReason
} from "../../../shared/companion-affect.ts";
import type { AutomaticPresenceStateId } from "../../../shared/automatic-situation-context.ts";

export const XITA_AFFECT_DECAY_MS = 6 * 60_000;
export const XITA_AFFECT_CALM_MS = 20 * 60_000;
export const XITA_AFFECT_HYSTERESIS_TTL_MS = XITA_AFFECT_DECAY_MS;

export type XitaAffectCoordinator = {
  applyUserAffect(affect: PerceivedUserAffect): XitaAffectSnapshot;
  updatePresenceState(presenceStateId: AutomaticPresenceStateId): XitaAffectSnapshot;
  tick(): XitaAffectSnapshot;
  getSnapshot(): XitaAffectSnapshot;
  subscribe(listener: (snapshot: XitaAffectSnapshot) => void): () => void;
};

export function createXitaAffectCoordinator({
  initialState,
  now = Date.now,
  decayMs = XITA_AFFECT_DECAY_MS,
  calmMs = XITA_AFFECT_CALM_MS,
  hysteresisTtlMs = XITA_AFFECT_HYSTERESIS_TTL_MS
}: {
  initialState?: XitaAffectSnapshot;
  now?: () => number;
  decayMs?: number;
  calmMs?: number;
  hysteresisTtlMs?: number;
} = {}): XitaAffectCoordinator {
  const listeners = new Set<(snapshot: XitaAffectSnapshot) => void>();
  let snapshot = initialState ? { ...initialState } : createCalmXitaAffect(now());
  let pendingMediumState: XitaAffectState | null = null;
  let pendingMediumCount = 0;
  let pendingMediumStartedAtMs: number | null = null;
  let decayAppliedForReinforcement = false;

  function publish(
    state: XitaAffectState,
    intensity: XitaAffectIntensity,
    reason: XitaAffectTransitionReason,
    reinforced: boolean
  ): XitaAffectSnapshot {
    const timestampMs = now();
    const vector = getXitaAffectVector(state);
    snapshot = {
      state,
      intensity,
      valence: vector.valence,
      arousal: vector.arousal,
      transitionReason: reason,
      updatedAtMs: timestampMs,
      lastReinforcedAtMs: reinforced ? timestampMs : snapshot.lastReinforcedAtMs
    };
    if (reinforced) {
      decayAppliedForReinforcement = false;
    }
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  function clearMediumCandidate(): void {
    pendingMediumState = null;
    pendingMediumCount = 0;
    pendingMediumStartedAtMs = null;
  }

  function expireMediumCandidate(timestampMs: number): void {
    if (
      pendingMediumStartedAtMs !== null &&
      (
        !Number.isFinite(timestampMs) ||
        timestampMs < pendingMediumStartedAtMs ||
        timestampMs - pendingMediumStartedAtMs >= Math.max(1, hysteresisTtlMs)
      )
    ) {
      clearMediumCandidate();
    }
  }

  function applyTarget(
    targetState: XitaAffectState,
    confidence: AffectConfidence,
    requiresHysteresis: boolean
  ): XitaAffectSnapshot {
    const timestampMs = now();
    expireMediumCandidate(timestampMs);
    if (targetState === snapshot.state) {
      clearMediumCandidate();
      return publish(
        targetState,
        targetState === "calm"
          ? "low"
          : strongerIntensity(snapshot.intensity, confidenceToIntensity(confidence)),
        "conversation",
        true
      );
    }

    if (requiresHysteresis && confidence === "medium") {
      if (pendingMediumState === targetState) {
        pendingMediumCount += 1;
      } else {
        pendingMediumState = targetState;
        pendingMediumCount = 1;
        pendingMediumStartedAtMs = timestampMs;
      }
      if (pendingMediumCount < 2) {
        return snapshot;
      }
    } else if (requiresHysteresis && confidence === "low") {
      clearMediumCandidate();
      return snapshot;
    }

    clearMediumCandidate();
    return publish(
      targetState,
      targetState === "calm" ? "low" : confidenceToIntensity(confidence),
      "conversation",
      true
    );
  }

  return {
    applyUserAffect(affect) {
      if (affect.source === "user-correction") {
        clearMediumCandidate();
        return publish("calm", "low", "user-correction", true);
      }

      const targetState = targetStateForUserAffect(affect);
      if (!targetState) {
        clearMediumCandidate();
        return snapshot;
      }
      const confidence = affect.source === "conversational-inference" &&
        affect.confidence === "high"
        ? "medium"
        : affect.confidence;
      return applyTarget(
        targetState,
        confidence,
        affect.source === "conversational-inference"
      );
    },
    updatePresenceState(presenceStateId) {
      if (presenceStateId === "sleep") {
        if (snapshot.state === "sleepy") {
          return snapshot;
        }
        clearMediumCandidate();
        return publish("sleepy", "low", "environment-safe", true);
      }
      if (snapshot.state === "sleepy") {
        clearMediumCandidate();
        return publish("calm", "low", "environment-safe", true);
      }
      return snapshot;
    },
    tick() {
      const timestampMs = now();
      expireMediumCandidate(timestampMs);
      const elapsedMs = timestampMs - snapshot.lastReinforcedAtMs;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return snapshot;
      }
      if (elapsedMs >= Math.max(1, calmMs) && snapshot.state !== "calm") {
        clearMediumCandidate();
        return publish("calm", "low", "idle-decay", false);
      }
      if (
        elapsedMs >= Math.max(1, decayMs) &&
        !decayAppliedForReinforcement &&
        snapshot.intensity !== "low"
      ) {
        decayAppliedForReinforcement = true;
        return publish(snapshot.state, lowerIntensity(snapshot.intensity), "idle-decay", false);
      }
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

function targetStateForUserAffect(affect: PerceivedUserAffect): XitaAffectState | null {
  switch (affect.kind) {
    case "calm":
      return "calm";
    case "positive":
    case "excited":
      return "happy";
    case "low":
    case "tired":
      return "concerned";
    case "tense":
      return "serious";
    case "unknown":
      return null;
  }
}

function confidenceToIntensity(confidence: AffectConfidence): XitaAffectIntensity {
  return confidence;
}

function strongerIntensity(
  current: XitaAffectIntensity,
  next: XitaAffectIntensity
): XitaAffectIntensity {
  const rank: Record<XitaAffectIntensity, number> = { low: 0, medium: 1, high: 2 };
  return rank[next] > rank[current] ? next : current;
}

function lowerIntensity(intensity: XitaAffectIntensity): XitaAffectIntensity {
  return intensity === "high" ? "medium" : "low";
}
