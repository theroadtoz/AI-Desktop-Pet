import type { PetActionLifecycleResult } from "../pet-action-dispatch-coordinator.ts";
import type { PetPresentationIntent } from "../../../shared/pet-role-state.ts";
import { publishAffectTerminalPresentation } from "./affect-presentation-crosswalk.ts";
import { createReplyCompletionAffectRetryScheduler } from "./reply-completion-affect-retry-scheduler.ts";

type DeferredReplyCompletionAffectAction = Readonly<{
  blockerRequestId: string;
  blockerReason: "chat_reply_waiting" | "state_local_model_busy";
  requestVersion: number;
  reason: "state_idle";
}>;

type DeferredReplyCompletionGenericAction = Readonly<{
  blockerRequestId: string;
  blockerReason: "chat_reply_waiting" | "state_local_model_busy";
  requestVersion: number;
  reason: "chat_reply_completed";
}>;

type DeferredReplyCompletionLifecycle = Readonly<{
  lifecycleResult: PetActionLifecycleResult;
  requestId: string | undefined;
  reason: string;
}>;

type AcceptedReplyCompletionAffectAction = Readonly<{
  requestId: string;
  requestVersion: number;
  reason: "state_idle";
}>;

export type GenericReplyCompletionDispatchResult =
  | Readonly<{ accepted: true; requestId: string }>
  | Readonly<{
    accepted: false;
    reason: "busy" | "throttled" | "send_failed" | "rejected" | "cooldown" | "skipped" | "failed";
  }>;

export type GenericReplyCompletionAdapters = Readonly<{
  readSnapshot(): GenericReplyCompletionLiveSnapshot;
  dispatch(): GenericReplyCompletionDispatchResult;
  publish(intent: PetPresentationIntent): void;
}>;

export type GenericReplyCompletionRegistrationInput = Readonly<{
  shouldRequestReplyWarmSettle: boolean;
  replyAction: "generic" | "affect" | "suppressed" | null;
  requestVersion: number;
  arbitration: Readonly<{ decision: "allow" | "suppress" | "defer"; reason: string }>;
  activeMainRequest: Readonly<{ requestId: string; reason: string }> | null;
  terminalIntent: PetPresentationIntent;
}>;

export type GenericReplyCompletionRegistrationResult =
  | Readonly<{ status: "ignored" }>
  | Readonly<{
    status: "pending" | "terminal";
    terminalIntent: PetPresentationIntent;
  }>;

export type GenericReplyCompletionLiveSnapshot = Readonly<{
  latestCompletedRequestVersion: number | null;
  activeRequestVersion: number | null;
  hasActiveStream: boolean;
  arbitration: Readonly<{ decision: "allow" | "suppress" | "defer"; reason: string }>;
}>;

export type GenericReplyCompletionLifecycleAdapters = Readonly<{
  readSnapshot(): GenericReplyCompletionLiveSnapshot;
  dispatch(): GenericReplyCompletionDispatchResult;
}>;

export type GenericReplyCompletionLifecycleResult =
  | Readonly<{ status: "ignored" | "scheduled" | "terminal" }>;

export type ReplyCompletionSchedulePurpose = "generic_initial_settle" | "affect_cooldown_retry";

type ReplyCompletionPurposeScheduler = Readonly<{
  schedule(purpose: ReplyCompletionSchedulePurpose, callback: () => void): boolean;
  cancel(): void;
}>;

type ReplyCompletionAffectActionControllerDependencies = Readonly<{
  scheduler?: ReplyCompletionPurposeScheduler;
}>;

export type ReplyCompletionAffectActionController = Readonly<{
  defer(action: DeferredReplyCompletionAffectAction): void;
  trackAccepted(action: AcceptedReplyCompletionAffectAction): void;
  cancel(): void;
  consumeAfterLifecycle(lifecycle: DeferredReplyCompletionLifecycle): DeferredReplyCompletionAffectAction | null;
  consumeGlobalCooldownSkip(input: Readonly<{ requestId: string | undefined; reason: string; skipReason: string | undefined }>): AcceptedReplyCompletionAffectAction | null;
  scheduleAffectCooldownRetry(callback: () => void): boolean;
  registerGenericCompletion(
    input: GenericReplyCompletionRegistrationInput,
    adapters: GenericReplyCompletionAdapters
  ): GenericReplyCompletionRegistrationResult;
  handleGenericLifecycle(
    lifecycle: DeferredReplyCompletionLifecycle,
    adapters: GenericReplyCompletionLifecycleAdapters
  ): GenericReplyCompletionLifecycleResult;
}>;

export function createReplyCompletionAffectActionController(
  dependencies: ReplyCompletionAffectActionControllerDependencies = {}
): ReplyCompletionAffectActionController {
  const defaultScheduler = createReplyCompletionAffectRetryScheduler();
  const scheduler = dependencies.scheduler ?? {
    schedule(_purpose: ReplyCompletionSchedulePurpose, callback: () => void) {
      return defaultScheduler.schedule(callback);
    },
    cancel() {
      defaultScheduler.cancel();
    }
  };
  let pending: DeferredReplyCompletionAffectAction | null = null;
  let pendingGeneric: DeferredReplyCompletionGenericAction | null = null;
  let accepted: AcceptedReplyCompletionAffectAction | null = null;
  let scheduledPurpose: ReplyCompletionSchedulePurpose | null = null;
  let scheduleGeneration = 0;

  const cancelScheduledPurpose = (): void => {
    scheduleGeneration += 1;
    scheduledPurpose = null;
    scheduler.cancel();
  };

  const replaceScheduledPurpose = (
    purpose: ReplyCompletionSchedulePurpose,
    callback: () => void
  ): boolean => {
    cancelScheduledPurpose();
    const generation = scheduleGeneration;
    scheduledPurpose = purpose;
    const scheduled = scheduler.schedule(purpose, () => {
      if (generation !== scheduleGeneration || scheduledPurpose !== purpose) return;
      scheduledPurpose = null;
      callback();
    });
    if (!scheduled) scheduledPurpose = null;
    return scheduled;
  };

  const scheduleGenericInitialSettle = (
    requestVersion: number,
    adapters: Pick<GenericReplyCompletionAdapters, "readSnapshot" | "dispatch">
  ): boolean => replaceScheduledPurpose("generic_initial_settle", () => {
    let snapshot: GenericReplyCompletionLiveSnapshot;
    try {
      snapshot = adapters.readSnapshot();
    } catch {
      return;
    }
    if (
      snapshot.latestCompletedRequestVersion !== requestVersion ||
      snapshot.activeRequestVersion !== null ||
      snapshot.hasActiveStream ||
      snapshot.arbitration.decision !== "allow"
    ) {
      return;
    }
    try {
      adapters.dispatch();
    } catch {
      // A generic initial-settle dispatch is terminal regardless of outcome.
    }
  });

  return {
    defer(action) {
      if (action.reason !== "state_idle") {
        throw new Error("Only state_idle may be deferred after reply completion");
      }
      pending = action;
    },
    trackAccepted(action) {
      accepted = action;
    },
    cancel() {
      pending = null;
      pendingGeneric = null;
      accepted = null;
      cancelScheduledPurpose();
    },
    consumeAfterLifecycle(lifecycle) {
      if (
        !pending ||
        lifecycle.reason !== pending.blockerReason ||
        lifecycle.requestId !== pending.blockerRequestId ||
        lifecycle.lifecycleResult !== "main_terminal"
      ) {
        return null;
      }

      const action = pending;
      pending = null;
      return action;
    },
    consumeGlobalCooldownSkip(input) {
      if (
        !accepted ||
        input.requestId !== accepted.requestId ||
        input.reason !== accepted.reason ||
        input.skipReason !== "global_cooldown"
      ) {
        return null;
      }
      const action = accepted;
      accepted = null;
      return action;
    },
    scheduleAffectCooldownRetry(callback) {
      pendingGeneric = null;
      return replaceScheduledPurpose("affect_cooldown_retry", callback);
    },
    registerGenericCompletion(input, adapters) {
      if (
        !input.shouldRequestReplyWarmSettle ||
        input.replyAction === "affect" ||
        input.replyAction === "suppressed"
      ) {
        return { status: "ignored" };
      }

      const terminalIntent = publishAffectTerminalPresentation(
        { kind: "none" },
        input.terminalIntent,
        adapters.publish
      );
      pendingGeneric = null;
      if (
        input.arbitration.decision === "suppress" &&
        input.arbitration.reason === "presentation_busy" &&
        input.activeMainRequest &&
        (input.activeMainRequest.reason === "chat_reply_waiting" ||
          input.activeMainRequest.reason === "state_local_model_busy")
      ) {
        cancelScheduledPurpose();
        pendingGeneric = {
          blockerRequestId: input.activeMainRequest.requestId,
          blockerReason: input.activeMainRequest.reason,
          requestVersion: input.requestVersion,
          reason: "chat_reply_completed"
        };
        return { status: "pending", terminalIntent };
      }

      if (input.arbitration.decision !== "allow") {
        cancelScheduledPurpose();
        return { status: "terminal", terminalIntent };
      }
      return scheduleGenericInitialSettle(input.requestVersion, adapters)
        ? { status: "pending", terminalIntent }
        : { status: "terminal", terminalIntent };
    },
    handleGenericLifecycle(lifecycle, adapters) {
      if (
        !pendingGeneric ||
        lifecycle.reason !== pendingGeneric.blockerReason ||
        lifecycle.requestId !== pendingGeneric.blockerRequestId ||
        lifecycle.lifecycleResult !== "main_terminal"
      ) {
        return { status: "ignored" };
      }

      const deferred = pendingGeneric;
      pendingGeneric = null;
      return scheduleGenericInitialSettle(deferred.requestVersion, adapters)
        ? { status: "scheduled" }
        : { status: "terminal" };
    }
  };
}
