import {
  deriveAutomaticPresenceState,
  type AutomaticConversationContextId,
  type AutomaticConversationSource,
  type AutomaticGamePresence,
  type AutomaticPresenceSource,
  type AutomaticSituationSnapshot,
  type ModelConversationContextId
} from "../../../shared/automatic-situation-context.ts";

export type AutomaticSituationClassificationStatus =
  | "classified"
  | "low-confidence"
  | "invalid-output"
  | "timeout"
  | "unavailable"
  | "failed";

export type AutomaticSituationClassifierResult = {
  contextId: ModelConversationContextId;
  confidence: number | null;
  status: AutomaticSituationClassificationStatus;
};

export type AutomaticSituationClassifier = {
  classify(input: { text: string; signal?: AbortSignal }): Promise<AutomaticSituationClassifierResult>;
};

export type AutomaticPresenceLifecycleInput = {
  appActive: boolean;
  quietRequested: boolean;
  localTimeBand: "morning" | "afternoon" | "evening" | "night";
  systemIdleMs: number;
};

export type AutomaticSituationCoordinator = {
  classifyLatest(input: { messageId: string; text: string }): Promise<{
    accepted: boolean;
    reason: AutomaticSituationClassificationStatus | "late-result" | "disposed";
    snapshot: AutomaticSituationSnapshot;
  }>;
  updateStableGamePresence(presence: AutomaticGamePresence): AutomaticSituationSnapshot;
  updatePresenceLifecycle(input: AutomaticPresenceLifecycleInput): AutomaticSituationSnapshot;
  cancelPendingClassification(): void;
  tick(): AutomaticSituationSnapshot;
  getSnapshot(): AutomaticSituationSnapshot;
  subscribe(listener: (snapshot: AutomaticSituationSnapshot) => void): () => void;
  dispose(): void;
};

const DEFAULT_CLASSIFICATION_TTL_MS = 10 * 60_000;
const DEFAULT_HYSTERESIS_MS = 350;

export function createAutomaticSituationCoordinator({
  classifier,
  now = Date.now,
  classificationTtlMs = DEFAULT_CLASSIFICATION_TTL_MS,
  hysteresisMs = DEFAULT_HYSTERESIS_MS,
  delay = defaultDelay
}: {
  classifier: AutomaticSituationClassifier;
  now?: () => number;
  classificationTtlMs?: number;
  hysteresisMs?: number;
  delay?: (durationMs: number) => Promise<void>;
}): AutomaticSituationCoordinator {
  const listeners = new Set<(snapshot: AutomaticSituationSnapshot) => void>();
  let disposed = false;
  let requestSequence = 0;
  let baseContextId: ModelConversationContextId = "default";
  let baseSource: AutomaticConversationSource = "default";
  let baseConfidence: number | null = null;
  let baseExpiresAtMs: number | null = null;
  let stableGamePresence: AutomaticGamePresence = "unknown";
  let activeClassificationController: AbortController | null = null;
  let lifecycle: AutomaticPresenceLifecycleInput = {
    appActive: false,
    quietRequested: false,
    localTimeBand: "afternoon",
    systemIdleMs: 0
  };
  let snapshot = createSnapshot(0, now(), "default", "default", null, null, "default", "default");

  function publishIfChanged(next: Omit<AutomaticSituationSnapshot, "revision" | "updatedAtMs">): AutomaticSituationSnapshot {
    if (
      snapshot.conversationContextId === next.conversationContextId &&
      snapshot.conversationSource === next.conversationSource &&
      snapshot.presenceStateId === next.presenceStateId &&
      snapshot.presenceSource === next.presenceSource &&
      snapshot.confidence === next.confidence &&
      snapshot.expiresAtMs === next.expiresAtMs
    ) {
      return snapshot;
    }

    snapshot = {
      ...next,
      revision: snapshot.revision + 1,
      updatedAtMs: now()
    };
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  function recompute(): AutomaticSituationSnapshot {
    const gameActive = stableGamePresence === "game";
    const conversationContextId: AutomaticConversationContextId = gameActive ? "game" : baseContextId;
    const conversationSource: AutomaticConversationSource = gameActive ? "stable-game-signal" : baseSource;
    const presence = deriveAutomaticPresenceState({
      conversationContextId,
      ...lifecycle
    });

    return publishIfChanged({
      conversationContextId,
      conversationSource,
      presenceStateId: presence.stateId,
      presenceSource: presence.source,
      confidence: gameActive ? null : baseConfidence,
      expiresAtMs: gameActive ? null : baseExpiresAtMs
    });
  }

  function expireStaleState(): void {
    const timestampMs = now();
    if (baseExpiresAtMs !== null && baseExpiresAtMs <= timestampMs) {
      baseContextId = "default";
      baseSource = "expired";
      baseConfidence = null;
      baseExpiresAtMs = null;
    }
  }

  return {
    async classifyLatest({ text }) {
      if (disposed) {
        return { accepted: false, reason: "disposed", snapshot };
      }

      const sequence = ++requestSequence;
      activeClassificationController?.abort();
      const controller = new AbortController();
      activeClassificationController = controller;
      let result: AutomaticSituationClassifierResult;
      try {
        result = await classifier.classify({ text, signal: controller.signal });
      } catch {
        result = { contextId: "default", confidence: null, status: "failed" };
      } finally {
        if (activeClassificationController === controller) {
          activeClassificationController = null;
        }
      }

      if (disposed) {
        return { accepted: false, reason: "disposed", snapshot };
      }
      if (sequence !== requestSequence) {
        return { accepted: false, reason: "late-result", snapshot };
      }

      if (result.status === "classified" && result.contextId !== baseContextId && hysteresisMs > 0) {
        await delay(hysteresisMs);
        if (disposed) {
          return { accepted: false, reason: "disposed", snapshot };
        }
        if (sequence !== requestSequence) {
          return { accepted: false, reason: "late-result", snapshot };
        }
      }

      if (result.status === "classified") {
        baseContextId = result.contextId;
        baseSource = "bundled-local-model";
        baseConfidence = result.confidence;
        baseExpiresAtMs = now() + Math.max(1, classificationTtlMs);
      } else {
        baseContextId = "default";
        baseSource = "default";
        baseConfidence = null;
        baseExpiresAtMs = null;
      }

      return { accepted: true, reason: result.status, snapshot: recompute() };
    },
    updateStableGamePresence(presence) {
      if (disposed) {
        return snapshot;
      }
      if (presence === "game") {
        stableGamePresence = "game";
      } else if (presence === "non-game") {
        stableGamePresence = "non-game";
      }
      return recompute();
    },
    updatePresenceLifecycle(input) {
      if (disposed) {
        return snapshot;
      }
      lifecycle = { ...input };
      expireStaleState();
      return recompute();
    },
    cancelPendingClassification() {
      requestSequence += 1;
      activeClassificationController?.abort();
      activeClassificationController = null;
    },
    tick() {
      if (disposed) {
        return snapshot;
      }
      expireStaleState();
      return recompute();
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      requestSequence += 1;
      activeClassificationController?.abort();
      activeClassificationController = null;
      listeners.clear();
    }
  };
}

function createSnapshot(
  revision: number,
  updatedAtMs: number,
  conversationContextId: AutomaticConversationContextId,
  conversationSource: AutomaticConversationSource,
  confidence: number | null,
  expiresAtMs: number | null,
  presenceStateId: AutomaticSituationSnapshot["presenceStateId"],
  presenceSource: AutomaticPresenceSource
): AutomaticSituationSnapshot {
  return {
    conversationContextId,
    conversationSource,
    presenceStateId,
    presenceSource,
    confidence,
    revision,
    updatedAtMs,
    expiresAtMs
  };
}

function defaultDelay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    timer.unref?.();
  });
}
