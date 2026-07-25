import type { P285AcceptanceScenarioId } from "../../../shared/ipc-contract";
import type { PetActionTriggerReason } from "../../../shared/pet-action-trigger";
import type {
  PetActionDispatchResult,
  PetActionLifecycleResult
} from "../pet-action-dispatch-coordinator";
import type { ProactiveBubbleLedgerStore } from "../config/proactive-bubble-ledger-store";
import {
  createProactiveBubbleCoordinator,
  PROACTIVE_BUBBLE_SOURCE_TTL_MS,
  type ProactiveBubbleCoordinatorDecision,
  type ProactiveBubbleRuntimeGates
} from "../proactive-companion/proactive-bubble-coordinator";
import {
  resolveCompanionContextArbitration,
  type CompanionContextArbitrationInput,
  type CompanionContextArbitrationResult
} from "./companion-context-arbitration-policy";

export type P285AcceptanceRuntimeBoundary =
  | "live_renderer_chain"
  | "live_global_p2_83a_fixture"
  | "deterministic_main_module_contract";

export type P285AcceptanceObservation = Readonly<{
  scenarioId: P285AcceptanceScenarioId;
  runtimeBoundary: P285AcceptanceRuntimeBoundary;
  actionAttempted: boolean;
  requestId?: string;
  replacedRequestId?: string;
  replacementAccepted?: boolean;
  lateLifecycleIgnored?: boolean;
  terminalObserved?: boolean;
  affectActionAttempted?: boolean;
  genericReplyActionAttempted?: boolean;
  actionRequestCount?: number;
  streamCompleted?: boolean;
  proactiveCandidateId?: "explicit_game_started";
  proactiveCandidateCount?: number;
  proactiveCandidateOutcome?: ProactiveBubbleCoordinatorDecision["state"];
  automaticModeActionCount?: number;
  suppressedTerminal?: boolean;
  deferredOnce?: boolean;
  deferredReplayed?: boolean;
  ttlExtended?: boolean;
  deferQueuedAtMs?: number;
  originalExpiresAtMs?: number;
  firstBeyondOriginalTtlTickAtMs?: number;
  terminalAtMs?: number;
  tickCount?: number;
}>;

export type P285AcceptanceScenarioResult = Readonly<{
  observation: P285AcceptanceObservation;
}>;

export const P2_85_ACCEPTANCE_REJECTION_REASONS = [
  "pending_observation",
  "baseline_pending",
  "baseline_not_closed",
  "state_listen_rejected",
  "chat_open_failed",
  "chat_open_replacement_missing",
  "affect_not_suppressed",
  "reply_not_allowed",
  "reply_dispatch_rejected",
  "explicit_game_fixture_disabled",
  "controller_unavailable",
  "controller_threw"
] as const;

export type P285AcceptanceRejectionReason =
  (typeof P2_85_ACCEPTANCE_REJECTION_REASONS)[number];

export type P285AcceptanceScenarioStartResult = Readonly<{
  accepted: boolean;
  rejectionReason: P285AcceptanceRejectionReason | null;
}>;

export type P285AcceptanceScenarioAdapters = Readonly<{
  dispatchAction(reason: PetActionTriggerReason): PetActionDispatchResult;
  cancelAction(requestId?: string): void;
  getActiveMainRequest(): Readonly<{ requestId: string; reason: string }> | null;
  openChatWindow(): void;
  resetLiveBaseline(): Promise<boolean>;
  clearProactiveCandidate(): void;
  queueExplicitGameCandidate(): void;
  resolveArbitration(input: CompanionContextArbitrationInput): CompanionContextArbitrationResult;
  reportObservation(observation: P285AcceptanceObservation): void;
}>;

export type P285AcceptanceScenarioController = Readonly<{
  runScenario(scenarioId: P285AcceptanceScenarioId): P285AcceptanceScenarioStartResult;
  resetBaseline(): Promise<P285AcceptanceScenarioStartResult>;
  observeRendererActionLifecycle(
    status: "started" | "finished" | "skipped",
    reason: string,
    requestId: string | undefined,
    lifecycleResult: PetActionLifecycleResult
  ): void;
  observeProactiveDecision(decision: ProactiveBubbleCoordinatorDecision): void;
  dispose(): void;
}>;

type TimedDecision = Readonly<{
  decision: ProactiveBubbleCoordinatorDecision;
  atMs: number;
}>;

type PendingReplaceObservation = {
  scenarioId: "chat_opened_replace_active";
  timeout: NodeJS.Timeout;
  replacedRequestId: string;
  requestId: string;
  lateLifecycleIgnored: boolean;
  terminalObserved: boolean;
};

type PendingReplyObservation = {
  scenarioId: "reply_visible_generic_once";
  timeout: NodeJS.Timeout;
  requestId: string;
  actionRequestCount: number;
};

type PendingProactiveObservation = {
  scenarioId: "explicit_game_single_presentation";
  timeout: NodeJS.Timeout;
  proactiveCandidateCount: number;
  automaticModeActionCount: number;
  actionAttempted: boolean;
  proactiveCandidateOutcome?: ProactiveBubbleCoordinatorDecision["state"];
  completionScheduled: boolean;
};

type PendingAcceptanceObservation =
  | PendingReplaceObservation
  | PendingReplyObservation
  | PendingProactiveObservation;

const P2_85_ACCEPTANCE_OBSERVATION_TIMEOUT_MS = 12_000;
const READY_GATES: ProactiveBubbleRuntimeGates = Object.freeze({
  petReady: true,
  petWindowAvailable: true,
  chatVisible: false,
  interactionActive: false,
  modelBusy: false,
  highPriorityActionActive: false
});

function arbitrationInput(
  update: Partial<CompanionContextArbitrationInput> = {}
): CompanionContextArbitrationInput {
  return {
    channel: "proactive-source",
    lifecycle: "ready",
    interaction: "idle",
    engagement: "allowed",
    dialogueMode: "default",
    dialogueSource: "default",
    presenceMode: "default",
    affectBand: "default",
    presentationBusy: false,
    proactiveCadence: "normal",
    affectEnabled: true,
    relevantSourceEnabled: true,
    environmentEnabled: true,
    ...update
  };
}

function createInMemoryLedger(): ProactiveBubbleLedgerStore {
  return {
    canShow() {
      return null;
    },
    recordShown() {},
    getLedgerPath() {
      return "";
    }
  };
}

function runProactiveSuppressSingleDefer(): P285AcceptanceScenarioResult {
  let wallClockMs = 1_000;
  let monotonicClockMs = 500;
  let chatVisible = false;
  const decisions: TimedDecision[] = [];
  const tickTimestamps: number[] = [];
  const coordinator = createProactiveBubbleCoordinator({
    ledger: createInMemoryLedger(),
    getRuntimeGates: () => ({ ...READY_GATES, chatVisible }),
    requestAction: () => null,
    showBubble: () => false,
    clearBubble() {},
    openChat() {},
    reportDecision(decision) {
      decisions.push({ decision, atMs: wallClockMs });
    },
    resolveContextGate(candidateId) {
      return candidateId === "music_started"
        ? resolveCompanionContextArbitration(arbitrationInput({
            channel: "proactive-environment",
            affectBand: "focused"
          }))
        : resolveCompanionContextArbitration(arbitrationInput({
            channel: "proactive-source",
            interaction: "chat-visible"
          }));
    },
    now: () => wallClockMs,
    monotonicNow: () => monotonicClockMs
  });

  coordinator.queueSafeCandidateForAcceptance("music_started");
  chatVisible = true;
  coordinator.queueSafeCandidateForAcceptance("explicit_game_started");

  const explicitQueued = decisions.find((item) =>
    item.decision.candidateId === "explicit_game_started" &&
    item.decision.state === "queued"
  );
  if (!explicitQueued) {
    coordinator.dispose();
    throw new Error("p2_85_defer_candidate_not_queued");
  }

  const originalExpiresAtMs = explicitQueued.atMs + PROACTIVE_BUBBLE_SOURCE_TTL_MS;
  const tickAt = (timestampMs: number) => {
    monotonicClockMs += Math.max(0, timestampMs - wallClockMs);
    wallClockMs = timestampMs;
    tickTimestamps.push(timestampMs);
    coordinator.tick();
  };
  tickAt(explicitQueued.atMs + Math.floor(PROACTIVE_BUBBLE_SOURCE_TTL_MS / 3));
  tickAt(explicitQueued.atMs + Math.floor(PROACTIVE_BUBBLE_SOURCE_TTL_MS * 2 / 3));
  tickAt(originalExpiresAtMs);
  tickAt(originalExpiresAtMs + 1);
  tickAt(originalExpiresAtMs + 2);
  coordinator.dispose();

  const musicDecisions = decisions.filter((item) => item.decision.candidateId === "music_started");
  const explicitDecisions = decisions.filter((item) => item.decision.candidateId === "explicit_game_started");
  const explicitQueuedEvents = explicitDecisions.filter((item) => item.decision.state === "queued");
  const explicitTerminal = explicitDecisions.find((item) =>
    item.decision.state === "expired" || item.decision.state === "skipped"
  );
  const firstBeyondOriginalTtlTickAtMs = tickTimestamps.find((timestampMs) => timestampMs > originalExpiresAtMs);
  if (firstBeyondOriginalTtlTickAtMs === undefined) {
    throw new Error("p2_85_missing_beyond_ttl_tick");
  }

  const replayedEvents = explicitDecisions.filter((item, index) =>
    index > 0 && ["queued", "attempted", "shown"].includes(item.decision.state)
  );
  const deferredOnce = explicitQueuedEvents.length === 1 &&
    explicitTerminal?.decision.state === "expired" &&
    explicitTerminal.atMs === firstBeyondOriginalTtlTickAtMs;
  const deferredReplayed = explicitQueuedEvents.length > 1 || replayedEvents.length > 0;
  const ttlExtended = explicitTerminal === undefined || explicitTerminal.atMs > firstBeyondOriginalTtlTickAtMs;
  const suppressedTerminal = musicDecisions.some((item) =>
    item.decision.state === "skipped" || item.decision.state === "expired"
  );

  return {
    observation: {
      scenarioId: "proactive_suppress_single_defer",
      runtimeBoundary: "deterministic_main_module_contract",
      actionAttempted: explicitDecisions.some((item) => item.decision.state === "attempted"),
      suppressedTerminal,
      deferredOnce,
      deferredReplayed,
      ttlExtended,
      deferQueuedAtMs: explicitQueued.atMs,
      originalExpiresAtMs,
      firstBeyondOriginalTtlTickAtMs,
      ...(explicitTerminal ? { terminalAtMs: explicitTerminal.atMs } : {}),
      tickCount: tickTimestamps.length
    }
  };
}

/**
 * Acceptance-only orchestration. The app supplies closed runtime adapters;
 * this controller never reads renderer payloads or ordinary app state.
 */
export function createP285AcceptanceScenarioController(
  adapters: P285AcceptanceScenarioAdapters
): P285AcceptanceScenarioController {
  let pending: PendingAcceptanceObservation | null = null;
  let baselineResetPending = false;

  function accepted(): P285AcceptanceScenarioStartResult {
    return { accepted: true, rejectionReason: null };
  }

  function rejected(rejectionReason: P285AcceptanceRejectionReason): P285AcceptanceScenarioStartResult {
    return { accepted: false, rejectionReason };
  }

  function expirePending(): void {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimeout(current.timeout);
    if (current.scenarioId === "explicit_game_single_presentation") {
      adapters.clearProactiveCandidate();
      return;
    }
    adapters.cancelAction(current.requestId);
  }

  function complete(
    current: PendingAcceptanceObservation,
    observation: P285AcceptanceObservation,
    clearProactiveCandidate = false
  ): void {
    if (pending !== current) return;
    pending = null;
    clearTimeout(current.timeout);
    adapters.reportObservation(observation);
    if (clearProactiveCandidate) adapters.clearProactiveCandidate();
  }

  function createTimeout(): NodeJS.Timeout {
    const timeout = setTimeout(expirePending, P2_85_ACCEPTANCE_OBSERVATION_TIMEOUT_MS);
    timeout.unref?.();
    return timeout;
  }

  function startChatOpenedReplaceActive(): P285AcceptanceScenarioStartResult {
    if (pending) return rejected("pending_observation");
    const active = adapters.dispatchAction("state_listen");
    if (!active.accepted) return rejected("state_listen_rejected");
    try {
      adapters.openChatWindow();
    } catch {
      adapters.cancelAction(active.requestId);
      return rejected("chat_open_failed");
    }
    const replacement = adapters.getActiveMainRequest();
    if (!replacement || replacement.reason !== "chat_opened" || replacement.requestId === active.requestId) {
      adapters.cancelAction();
      return rejected("chat_open_replacement_missing");
    }
    pending = {
      scenarioId: "chat_opened_replace_active",
      timeout: createTimeout(),
      replacedRequestId: active.requestId,
      requestId: replacement.requestId,
      lateLifecycleIgnored: false,
      terminalObserved: false
    };
    return accepted();
  }

  function startReplyVisibleGenericOnce(): P285AcceptanceScenarioStartResult {
    if (pending) return rejected("pending_observation");
    const affectDecision = adapters.resolveArbitration(arbitrationInput({
      channel: "affect-action",
      interaction: "chat-visible"
    }));
    const replyDecision = adapters.resolveArbitration(arbitrationInput({
      channel: "reply-completion-action",
      interaction: "chat-visible"
    }));
    if (affectDecision.decision === "allow") return rejected("affect_not_suppressed");
    if (replyDecision.decision !== "allow") return rejected("reply_not_allowed");
    const reply = adapters.dispatchAction("chat_reply_completed");
    if (!reply.accepted) return rejected("reply_dispatch_rejected");
    pending = {
      scenarioId: "reply_visible_generic_once",
      timeout: createTimeout(),
      requestId: reply.requestId,
      actionRequestCount: 1
    };
    return accepted();
  }

  function startExplicitGameSinglePresentation(): P285AcceptanceScenarioStartResult {
    if (pending) return rejected("pending_observation");
    const automaticDecision = adapters.resolveArbitration(arbitrationInput({
      channel: "automatic-mode-action",
      dialogueMode: "game",
      dialogueSource: "user-explicit"
    }));
    pending = {
      scenarioId: "explicit_game_single_presentation",
      timeout: createTimeout(),
      proactiveCandidateCount: 0,
      automaticModeActionCount: automaticDecision.decision === "allow" ? 1 : 0,
      actionAttempted: false,
      completionScheduled: false
    };
    adapters.queueExplicitGameCandidate();
    return accepted();
  }

  return {
    runScenario(scenarioId) {
      if (baselineResetPending) return rejected("baseline_pending");
      if (pending) return rejected("pending_observation");
      if (scenarioId === "proactive_suppress_single_defer") {
        adapters.reportObservation(runProactiveSuppressSingleDefer().observation);
        return accepted();
      }
      if (scenarioId === "chat_opened_replace_active") return startChatOpenedReplaceActive();
      if (scenarioId === "reply_visible_generic_once") return startReplyVisibleGenericOnce();
      return startExplicitGameSinglePresentation();
    },
    async resetBaseline() {
      expirePending();
      baselineResetPending = true;
      try {
        return (await adapters.resetLiveBaseline()) ? accepted() : rejected("baseline_not_closed");
      } finally {
        baselineResetPending = false;
      }
    },
    observeRendererActionLifecycle(status, reason, requestId, lifecycleResult) {
      if (status === "started" || requestId === undefined) return;
      const current = pending;
      if (!current || current.scenarioId === "explicit_game_single_presentation") return;
      if (current.scenarioId === "chat_opened_replace_active") {
        if (requestId === current.replacedRequestId && reason === "state_listen" && lifecycleResult === "ignored") {
          current.lateLifecycleIgnored = true;
        } else if (requestId === current.requestId && reason === "chat_opened" && lifecycleResult === "main_terminal") {
          current.terminalObserved = true;
        }
        if (current.lateLifecycleIgnored && current.terminalObserved) {
          complete(current, {
            scenarioId: current.scenarioId,
            runtimeBoundary: "live_renderer_chain",
            actionAttempted: true,
            requestId: current.requestId,
            replacedRequestId: current.replacedRequestId,
            replacementAccepted: true,
            lateLifecycleIgnored: true,
            terminalObserved: true
          });
        }
        return;
      }
      if (requestId === current.requestId && reason === "chat_reply_completed" && lifecycleResult === "main_terminal") {
        complete(current, {
          scenarioId: current.scenarioId,
          runtimeBoundary: "live_renderer_chain",
          actionAttempted: true,
          requestId: current.requestId,
          terminalObserved: true,
          affectActionAttempted: false,
          genericReplyActionAttempted: true,
          actionRequestCount: current.actionRequestCount,
          streamCompleted: true
        });
      }
    },
    observeProactiveDecision(decision) {
      const current = pending;
      if (current?.scenarioId !== "explicit_game_single_presentation" || decision.candidateId !== "explicit_game_started") {
        return;
      }
      if (decision.state === "queued") {
        current.proactiveCandidateCount += 1;
        return;
      }
      current.proactiveCandidateOutcome = decision.state;
      if (decision.state === "attempted") current.actionAttempted = true;
      if (current.completionScheduled) return;
      current.completionScheduled = true;
      queueMicrotask(() => {
        if (pending !== current || !current.proactiveCandidateOutcome) return;
        complete(current, {
          scenarioId: current.scenarioId,
          runtimeBoundary: "live_global_p2_83a_fixture",
          actionAttempted: current.actionAttempted,
          proactiveCandidateId: "explicit_game_started",
          proactiveCandidateCount: current.proactiveCandidateCount,
          proactiveCandidateOutcome: current.proactiveCandidateOutcome,
          automaticModeActionCount: current.automaticModeActionCount
        }, true);
      });
    },
    dispose() {
      expirePending();
    }
  };
}

export function runP285AcceptanceScenario(
  scenarioId: P285AcceptanceScenarioId
): P285AcceptanceScenarioResult {
  if (scenarioId !== "proactive_suppress_single_defer") {
    throw new Error("p2_85_live_scenario_requires_app_runtime");
  }
  return runProactiveSuppressSingleDefer();
}
