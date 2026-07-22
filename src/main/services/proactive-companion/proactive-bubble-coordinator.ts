import type { DialogueModeId } from "../../../shared/dialogue-style";
import type { PetActionTriggerReason } from "../../../shared/pet-action-trigger";
import type {
  ProactiveBubbleCandidateId,
  ProactiveSpeechBubbleLineId,
  ProactiveSpeechBubblePayload,
  ProactiveSpeechBubbleReason
} from "../../../shared/proactive-speech-bubble";
import { PROACTIVE_BUBBLE_CANDIDATE_IDS } from "../../../shared/proactive-speech-bubble";
import type {
  ProactiveCompanionCadence,
  ProactiveCompanionSettings
} from "../../../shared/proactive-companion-settings";
import type { CoarseUserState } from "../automatic-situation/coarse-user-state-coordinator";
import type {
  ProactiveBubbleCandidateClass,
  ProactiveBubbleLedgerStore
} from "../config/proactive-bubble-ledger-store";

export { PROACTIVE_BUBBLE_CANDIDATE_IDS } from "../../../shared/proactive-speech-bubble";
export type { ProactiveBubbleCandidateId } from "../../../shared/proactive-speech-bubble";
export type ProactiveBubbleCandidateState = "queued" | "attempted" | "shown" | "skipped" | "expired";
export type ProactiveBubbleSourceEventId = "memory_safe" | "search_citation_safe" | "history_summary_safe";

export type ProactiveBubbleRuntimeGates = {
  petReady: boolean;
  petWindowAvailable: boolean;
  chatVisible: boolean;
  interactionActive: boolean;
  modelBusy: boolean;
  highPriorityActionActive: boolean;
  highPriorityActionReason?: PetActionTriggerReason | null;
};

export type ProactiveBubbleCoordinatorDecision = {
  candidateId: ProactiveBubbleCandidateId;
  state: ProactiveBubbleCandidateState;
  skipReason?: string;
  lineId: ProactiveSpeechBubbleLineId;
  reason: ProactiveSpeechBubbleReason;
};

export type ProactiveBubbleCoordinator = {
  updateCoarseState(state: Readonly<CoarseUserState>): void;
  updateDialogueMode(modeId: DialogueModeId): void;
  updateRuntimeGates(gates: ProactiveBubbleRuntimeGates): void;
  updateSettings(settings: ProactiveCompanionSettings): void;
  onFirstFrame(): void;
  onUserMessage(): void;
  queueSource(eventId: ProactiveBubbleSourceEventId, actionReason?: PetActionTriggerReason): void;
  queuePresence(
    candidateId: "idle_presence" | "mode_presence",
    payload: ProactiveSpeechBubblePayload,
    actionReason: PetActionTriggerReason
  ): void;
  queueSafeCandidateForAcceptance(candidateId: ProactiveBubbleCandidateId): void;
  onActionLifecycle(event: { status: "started" | "skipped"; reason: PetActionTriggerReason; requestId?: string }): void;
  onBubbleHidden(): void;
  activateBubble(value: unknown): boolean;
  tick(): void;
  clear(): void;
  dispose(): void;
};

type ActionRequestResult = string | null;

type CandidateDefinition = {
  budgetClass: ProactiveBubbleCandidateClass;
  mutexGroup: "startup" | "environment" | "silence" | "source";
  supersessionPolicy: "higher_priority_only";
  priority: number;
  lineId: ProactiveSpeechBubbleLineId;
  reason: ProactiveSpeechBubbleReason;
  actionReason: PetActionTriggerReason;
};

type Candidate = CandidateDefinition & {
  sequence: number;
  candidateId: ProactiveBubbleCandidateId;
  state: ProactiveBubbleCandidateState;
  queuedAtMs: number;
  expiresAtMs: number;
  mayWaitForChatClose: boolean;
  waitedForChatClose: boolean;
  actionRequestId?: string;
};

export const PROACTIVE_BUBBLE_ACTION_HANDSHAKE_TIMEOUT_MS = 2_000;
export const PROACTIVE_BUBBLE_SOURCE_TTL_MS = 15 * 60_000;
export const PROACTIVE_BUBBLE_LONG_SILENCE_MS = 120 * 60_000;
export const PROACTIVE_BUBBLE_LONG_WORK_MS = 90 * 60_000;

const DEFINITIONS: Readonly<Record<ProactiveBubbleCandidateId, CandidateDefinition>> = {
  idle_presence: {
    budgetClass: "silence", mutexGroup: "silence", supersessionPolicy: "higher_priority_only", priority: 10, lineId: "idle_presence_soft",
    reason: "idle_presence", actionReason: "state_proactive_bubble_visible"
  },
  mode_presence: {
    budgetClass: "environment", mutexGroup: "environment", supersessionPolicy: "higher_priority_only", priority: 50, lineId: "mode_presence_focus",
    reason: "mode_presence", actionReason: "state_proactive_bubble_visible"
  },
  startup_daily: {
    budgetClass: "startup", mutexGroup: "startup", supersessionPolicy: "higher_priority_only", priority: 40, lineId: "startup_presence_ready",
    reason: "startup_presence", actionReason: "state_greet"
  },
  music_started: {
    budgetClass: "environment", mutexGroup: "environment", supersessionPolicy: "higher_priority_only", priority: 60, lineId: "environment_music_started",
    reason: "music_presence", actionReason: "state_music_playing_stable"
  },
  explicit_game_started: {
    budgetClass: "environment", mutexGroup: "environment", supersessionPolicy: "higher_priority_only", priority: 60, lineId: "environment_game_started",
    reason: "game_presence", actionReason: "state_game_presence_stable"
  },
  returned_from_away: {
    budgetClass: "environment", mutexGroup: "environment", supersessionPolicy: "higher_priority_only", priority: 70, lineId: "environment_returned_from_away",
    reason: "return_presence", actionReason: "return_from_idle"
  },
  long_work_recovery: {
    budgetClass: "environment", mutexGroup: "environment", supersessionPolicy: "higher_priority_only", priority: 70, lineId: "environment_long_work_recovery",
    reason: "work_recovery", actionReason: "long_work_session_complete"
  },
  evening_companion: {
    budgetClass: "environment", mutexGroup: "environment", supersessionPolicy: "higher_priority_only", priority: 40, lineId: "idle_presence_evening",
    reason: "evening_presence", actionReason: "evening_companion_tick"
  },
  long_silence: {
    budgetClass: "silence", mutexGroup: "silence", supersessionPolicy: "higher_priority_only", priority: 20, lineId: "idle_presence_soft",
    reason: "silence_presence", actionReason: "state_listen"
  },
  memory_safe: {
    budgetClass: "source", mutexGroup: "source", supersessionPolicy: "higher_priority_only", priority: 80, lineId: "idle_presence_memory_safe",
    reason: "source_presence", actionReason: "state_memory_injected"
  },
  search_citation_safe: {
    budgetClass: "source", mutexGroup: "source", supersessionPolicy: "higher_priority_only", priority: 90, lineId: "idle_presence_search_citation",
    reason: "source_presence", actionReason: "state_search_cited"
  },
  history_summary_safe: {
    budgetClass: "source", mutexGroup: "source", supersessionPolicy: "higher_priority_only", priority: 80, lineId: "idle_presence_history_summary",
    reason: "source_presence", actionReason: "state_proactive_bubble_visible"
  }
};

const INITIAL_COARSE_STATE: Readonly<CoarseUserState> = Object.freeze({
  activity: "unknown",
  interruptibility: "unknown",
  media: "unknown",
  timeBand: "unknown",
  explicitGameContext: "inactive",
  engagement: "unknown"
});

export function createProactiveBubbleCoordinator(options: {
  ledger: ProactiveBubbleLedgerStore;
  getRuntimeGates: () => ProactiveBubbleRuntimeGates;
  requestAction: (reason: PetActionTriggerReason) => ActionRequestResult;
  showBubble: (payload: ProactiveSpeechBubblePayload) => boolean;
  clearBubble: () => void;
  openChat: () => void;
  reportDecision?: (decision: ProactiveBubbleCoordinatorDecision) => void;
  now?: () => number;
  monotonicNow?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  actionHandshakeTimeoutMs?: number;
  longSilenceMs?: number;
  longWorkMs?: number;
  acceptanceInjectionOnly?: boolean;
}): ProactiveBubbleCoordinator {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const actionHandshakeTimeoutMs = options.actionHandshakeTimeoutMs ?? PROACTIVE_BUBBLE_ACTION_HANDSHAKE_TIMEOUT_MS;
  const longSilenceMs = options.longSilenceMs ?? PROACTIVE_BUBBLE_LONG_SILENCE_MS;
  const longWorkMs = options.longWorkMs ?? PROACTIVE_BUBBLE_LONG_WORK_MS;
  const acceptanceInjectionOnly = options.acceptanceInjectionOnly === true;
  let settings: ProactiveCompanionSettings = {
    cadence: "normal",
    memorySourceBubbles: true,
    searchSourceBubbles: true
  };
  let coarseState = INITIAL_COARSE_STATE;
  let dialogueModeId: DialogueModeId = "default";
  let runtimeGates = options.getRuntimeGates();
  let pending: Candidate[] = [];
  let activeAttempt: Candidate | null = null;
  let visiblePayload: ProactiveSpeechBubblePayload | null = null;
  let visibleCandidate: Candidate | null = null;
  let actionTimer: ReturnType<typeof setTimeout> | null = null;
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;
  let disposed = false;
  let hasCoarseBaseline = false;
  let musicArmed = false;
  let workStartedAtMonoMs: number | null = null;
  let lastMonoMs = 0;
  let lastUserMessageAtMs: number | null = null;
  let silenceQueuedForMessageAtMs: number | null = null;

  function safeMonotonicNow(): number {
    const next = monotonicNow();
    if (Number.isFinite(next) && next >= lastMonoMs) {
      lastMonoMs = next;
    }
    return lastMonoMs;
  }

  function report(candidate: Candidate, state: ProactiveBubbleCandidateState, skipReason?: string): void {
    candidate.state = state;
    options.reportDecision?.({
      candidateId: candidate.candidateId,
      state,
      ...(skipReason ? { skipReason } : {}),
      lineId: candidate.lineId,
      reason: candidate.reason
    });
  }

  function clearActionTimer(): void {
    if (actionTimer) {
      clearTimeoutFn(actionTimer);
      actionTimer = null;
    }
  }

  function clearBubbleTimer(): void {
    if (bubbleTimer) {
      clearTimeoutFn(bubbleTimer);
      bubbleTimer = null;
    }
  }

  function removePending(candidate: Candidate): void {
    pending = pending.filter((item) => item.sequence !== candidate.sequence);
  }

  function terminal(candidate: Candidate, state: "skipped" | "expired", reason: string): void {
    removePending(candidate);
    if (activeAttempt?.sequence === candidate.sequence) {
      activeAttempt = null;
      clearActionTimer();
    }
    report(candidate, state, reason);
  }

  function queue(candidateId: ProactiveBubbleCandidateId, config: {
    ttlMs?: number;
    mayWaitForChatClose?: boolean;
    actionReason?: PetActionTriggerReason;
    lineId?: ProactiveSpeechBubbleLineId;
    reason?: ProactiveSpeechBubbleReason;
  } = {}): void {
    if (disposed || settings.cadence === "off") {
      return;
    }
    const definition = DEFINITIONS[candidateId];
    const queuedAtMs = now();
    const candidate: Candidate = {
      ...definition,
      ...(config.actionReason ? { actionReason: config.actionReason } : {}),
      ...(config.lineId ? { lineId: config.lineId } : {}),
      ...(config.reason ? { reason: config.reason } : {}),
      sequence: ++sequence,
      candidateId,
      state: "queued",
      queuedAtMs,
      expiresAtMs: queuedAtMs + (config.ttlMs ?? 30_000),
      mayWaitForChatClose: config.mayWaitForChatClose ?? false,
      waitedForChatClose: false
    };
    if (activeAttempt?.mutexGroup === candidate.mutexGroup) {
      report(candidate, "skipped", "same_mutex_group_attempt_in_progress");
      return;
    }
    const sameGroupPending = pending.filter((existing) => existing.mutexGroup === candidate.mutexGroup);
    if (sameGroupPending.length > 0) {
      const highestPending = sameGroupPending.reduce((highest, item) =>
        item.priority > highest.priority ||
        (item.priority === highest.priority && item.sequence < highest.sequence) ? item : highest
      );
      if (candidate.supersessionPolicy === "higher_priority_only" && candidate.priority > highestPending.priority) {
        for (const existing of sameGroupPending) {
          terminal(existing, "skipped", "replaced_by_higher_priority");
        }
      } else {
        report(
          candidate,
          "skipped",
          candidate.priority === highestPending.priority ? "same_priority_stable" : "lower_priority_candidate"
        );
        return;
      }
    }
    pending.push(candidate);
    report(candidate, "queued");
    processPending();
  }

  function runtimeSkipReason(candidate: Candidate): string | null {
    runtimeGates = options.getRuntimeGates();
    if (!runtimeGates.petReady) return "pet_not_ready";
    if (!runtimeGates.petWindowAvailable) return "pet_window_missing";
    if (settings.cadence === "off") return "proactive_bubbles_off";
    const mayProceedWithUnknown = candidate.candidateId === "startup_daily" ||
      candidate.budgetClass === "source";
    if (coarseState.engagement === "suppressed" || coarseState.engagement === "defer") {
      return "engagement_blocked";
    }
    if (coarseState.activity === "locked" || coarseState.activity === "suspended") return "system_unavailable";
    if (runtimeGates.chatVisible) return "chat_visible";
    if (runtimeGates.interactionActive) return "chat_interaction_active";
    if (runtimeGates.modelBusy) return "model_busy";
    if (runtimeGates.highPriorityActionActive) return "high_priority_action_active";
    if (visiblePayload) return "bubble_visible";
    if (!mayProceedWithUnknown &&
      (coarseState.interruptibility !== "allowed" || coarseState.engagement !== "allowed")) {
      return "interruptibility_not_allowed";
    }
    return null;
  }

  function processPending(): void {
    if (disposed || activeAttempt || visiblePayload || pending.length === 0) {
      return;
    }
    const currentNow = now();
    for (const candidate of [...pending]) {
      if (currentNow > candidate.expiresAtMs) {
        terminal(candidate, "expired", "ttl_expired");
      }
    }
    const candidate = [...pending].sort((left, right) =>
      right.priority - left.priority || left.sequence - right.sequence)[0];
    if (!candidate) {
      return;
    }
    const skipReason = runtimeSkipReason(candidate);
    if (skipReason) {
      if ((skipReason === "chat_visible" || skipReason === "chat_interaction_active") &&
        candidate.mayWaitForChatClose) {
        candidate.waitedForChatClose = true;
        return;
      }
      terminal(candidate, "skipped", skipReason);
      processPending();
      return;
    }
    const cadence = settings.cadence as Exclude<ProactiveCompanionCadence, "off">;
    const budgetReason = options.ledger.canShow({
      cadence,
      candidateClass: candidate.budgetClass,
      lineId: candidate.lineId,
      nowMs: currentNow,
      dateKey: getLocalDateKey(currentNow)
    });
    if (budgetReason) {
      terminal(candidate, "skipped", budgetReason);
      processPending();
      return;
    }
    removePending(candidate);
    activeAttempt = candidate;
    report(candidate, "attempted");
    const actionRequestId = options.requestAction(candidate.actionReason);
    if (!actionRequestId) {
      terminal(candidate, "skipped", "action_request_rejected");
      processPending();
      return;
    }
    candidate.actionRequestId = actionRequestId;
    actionTimer = setTimeoutFn(() => {
      actionTimer = null;
      if (activeAttempt?.sequence === candidate.sequence) {
        terminal(candidate, "skipped", "action_handshake_timeout");
        processPending();
      }
    }, Math.max(1, actionHandshakeTimeoutMs));
    actionTimer.unref?.();
  }

  function clearVisible(): void {
    visiblePayload = null;
    visibleCandidate = null;
    clearBubbleTimer();
    options.clearBubble();
  }

  function clearAll(): void {
    for (const candidate of pending) {
      report(candidate, "skipped", "cleared");
    }
    pending = [];
    if (activeAttempt) {
      report(activeAttempt, "skipped", "cleared");
      activeAttempt = null;
    }
    clearActionTimer();
    clearVisible();
  }

  function resetLatches(): void {
    hasCoarseBaseline = false;
    musicArmed = false;
    workStartedAtMonoMs = null;
    lastMonoMs = 0;
    lastUserMessageAtMs = null;
    silenceQueuedForMessageAtMs = null;
  }

  function isHardCoarseSuppression(state: Readonly<CoarseUserState>): boolean {
    return state.engagement === "suppressed" || state.engagement === "defer" ||
      state.activity === "locked" || state.activity === "suspended";
  }

  function isHardRuntimeSuppression(gates: ProactiveBubbleRuntimeGates): boolean {
    const ownVisibleAction = Boolean(
      visibleCandidate &&
      gates.highPriorityActionReason === visibleCandidate.actionReason
    );
    return gates.chatVisible || gates.interactionActive || gates.modelBusy ||
      (gates.highPriorityActionActive && !ownVisibleAction);
  }

  return {
    updateCoarseState(nextState) {
      if (disposed) return;
      const previous = coarseState;
      coarseState = Object.freeze({ ...nextState });
      if (isHardCoarseSuppression(coarseState) && visiblePayload) {
        clearVisible();
      }
      if (acceptanceInjectionOnly) return;
      if (!hasCoarseBaseline) {
        hasCoarseBaseline = true;
        musicArmed = coarseState.media === "stopped";
        return;
      }
      if (coarseState.media === "stopped") {
        musicArmed = true;
      } else if (previous.media === "stopped" && coarseState.media === "playing" && musicArmed) {
        musicArmed = false;
        queue("music_started");
      }
      if (previous.explicitGameContext !== "active" && coarseState.explicitGameContext === "active") {
        queue("explicit_game_started", { ttlMs: PROACTIVE_BUBBLE_SOURCE_TTL_MS, mayWaitForChatClose: true });
      }
      if ((previous.activity === "away" || previous.activity === "idle-long") &&
        (coarseState.activity === "active" || coarseState.activity === "idle-short") &&
        coarseState.engagement === "allowed") {
        queue("returned_from_away");
      }
      const wasEvening = previous.timeBand === "evening" || previous.timeBand === "night";
      const isEvening = coarseState.timeBand === "evening" || coarseState.timeBand === "night";
      if (!wasEvening && isEvening) {
        queue("evening_companion");
      }
      processPending();
    },
    updateDialogueMode(nextModeId) {
      if (disposed || nextModeId === dialogueModeId) return;
      const monoNow = safeMonotonicNow();
      const previous = dialogueModeId;
      dialogueModeId = nextModeId;
      if (acceptanceInjectionOnly) {
        workStartedAtMonoMs = null;
        return;
      }
      if (nextModeId === "work") {
        workStartedAtMonoMs = monoNow;
      } else if (previous === "work" && workStartedAtMonoMs !== null) {
        const elapsed = Math.max(0, monoNow - workStartedAtMonoMs);
        workStartedAtMonoMs = null;
        if (elapsed >= longWorkMs) {
          queue("long_work_recovery");
        }
      }
    },
    updateRuntimeGates(nextGates) {
      const wasChatBlocked = runtimeGates.chatVisible || runtimeGates.interactionActive;
      runtimeGates = { ...nextGates };
      const isChatBlocked = nextGates.chatVisible || nextGates.interactionActive;
      if (!wasChatBlocked && isChatBlocked) {
        const chatSkipReason = nextGates.chatVisible ? "chat_visible" : "chat_interaction_active";
        for (const candidate of [...pending]) {
          if (candidate.mayWaitForChatClose && candidate.waitedForChatClose) {
            terminal(candidate, "skipped", chatSkipReason);
          }
        }
        if (activeAttempt?.mayWaitForChatClose && activeAttempt.waitedForChatClose) {
          terminal(activeAttempt, "skipped", chatSkipReason);
        }
      }
      if (isHardRuntimeSuppression(nextGates)) {
        if (visiblePayload) clearVisible();
      } else {
        processPending();
      }
    },
    updateSettings(nextSettings) {
      settings = { ...nextSettings };
      if (settings.cadence === "off") {
        clearAll();
        resetLatches();
      } else {
        pending = pending.filter((candidate) => {
          if (candidate.candidateId === "memory_safe" && !settings.memorySourceBubbles) {
            report(candidate, "skipped", "source_disabled");
            return false;
          }
          if (candidate.candidateId === "search_citation_safe" && !settings.searchSourceBubbles) {
            report(candidate, "skipped", "source_disabled");
            return false;
          }
          return true;
        });
        processPending();
      }
    },
    onFirstFrame() {
      if (acceptanceInjectionOnly) return;
      queue("startup_daily");
    },
    onUserMessage() {
      if (acceptanceInjectionOnly) {
        if (visiblePayload) clearVisible();
        return;
      }
      lastUserMessageAtMs = now();
      silenceQueuedForMessageAtMs = null;
      if (visiblePayload) clearVisible();
    },
    queueSource(eventId, actionReason) {
      if (acceptanceInjectionOnly) return;
      if (eventId === "memory_safe" && !settings.memorySourceBubbles) return;
      if (eventId === "search_citation_safe" && !settings.searchSourceBubbles) return;
      queue(eventId, {
        ttlMs: PROACTIVE_BUBBLE_SOURCE_TTL_MS,
        mayWaitForChatClose: true,
        ...(actionReason ? { actionReason } : {})
      });
    },
    queuePresence(candidateId, payload, actionReason) {
      if (acceptanceInjectionOnly) return;
      queue(candidateId, {
        actionReason,
        lineId: payload.lineId,
        reason: payload.reason,
        mayWaitForChatClose: candidateId === "mode_presence"
      });
    },
    queueSafeCandidateForAcceptance(candidateId) {
      if (PROACTIVE_BUBBLE_CANDIDATE_IDS.includes(candidateId)) {
        coarseState = Object.freeze({
          activity: "active",
          interruptibility: "allowed",
          media: "stopped",
          timeBand: "daytime",
          explicitGameContext: "inactive",
          engagement: "allowed"
        });
        queue(candidateId, {
          ttlMs: PROACTIVE_BUBBLE_SOURCE_TTL_MS,
          mayWaitForChatClose: true
        });
      }
    },
    onActionLifecycle(event) {
      const candidate = activeAttempt;
      if (!candidate || !event.requestId || candidate.actionReason !== event.reason || candidate.actionRequestId !== event.requestId) return;
      clearActionTimer();
      activeAttempt = null;
      if (event.status === "skipped") {
        report(candidate, "skipped", "action_skipped");
        processPending();
        return;
      }
      const payload: ProactiveSpeechBubblePayload = {
        lineId: candidate.lineId,
        reason: candidate.reason,
        durationMs: 4_200
      };
      if (!options.showBubble(payload)) {
        report(candidate, "skipped", "bubble_send_failed");
        processPending();
        return;
      }
      visiblePayload = payload;
      visibleCandidate = candidate;
      const shownAtMs = now();
      options.ledger.recordShown({
        candidateClass: candidate.budgetClass,
        lineId: candidate.lineId,
        nowMs: shownAtMs,
        dateKey: getLocalDateKey(shownAtMs)
      });
      report(candidate, "shown");
      bubbleTimer = setTimeoutFn(() => {
        bubbleTimer = null;
        visiblePayload = null;
        visibleCandidate = null;
        options.clearBubble();
        processPending();
      }, payload.durationMs);
      bubbleTimer.unref?.();
    },
    onBubbleHidden() {
      visiblePayload = null;
      visibleCandidate = null;
      clearBubbleTimer();
      processPending();
    },
    activateBubble(value) {
      if (!visiblePayload || !isRecord(value) || value.lineId !== visiblePayload.lineId ||
        value.reason !== visiblePayload.reason || Object.keys(value).length !== 2) {
        return false;
      }
      clearVisible();
      options.openChat();
      return true;
    },
    tick() {
      if (disposed) return;
      if (acceptanceInjectionOnly) {
        processPending();
        return;
      }
      if (lastUserMessageAtMs !== null && silenceQueuedForMessageAtMs !== lastUserMessageAtMs &&
        now() - lastUserMessageAtMs >= longSilenceMs) {
        silenceQueuedForMessageAtMs = lastUserMessageAtMs;
        queue("long_silence");
      }
      processPending();
    },
    clear() {
      clearAll();
    },
    dispose() {
      if (disposed) return;
      clearAll();
      resetLatches();
      disposed = true;
    }
  };
}

export function getLocalDateKey(nowMs: number): string {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
