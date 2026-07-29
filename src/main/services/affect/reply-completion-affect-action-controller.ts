import type { PetActionLifecycleResult } from "../pet-action-dispatch-coordinator.ts";

type DeferredReplyCompletionAffectAction = Readonly<{
  blockerRequestId: string;
  blockerReason: "chat_reply_waiting" | "state_local_model_busy";
  requestVersion: number;
  reason: "state_idle";
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

export type ReplyCompletionAffectActionController = Readonly<{
  defer(action: DeferredReplyCompletionAffectAction): void;
  trackAccepted(action: AcceptedReplyCompletionAffectAction): void;
  cancel(): void;
  consumeAfterLifecycle(lifecycle: DeferredReplyCompletionLifecycle): DeferredReplyCompletionAffectAction | null;
  consumeGlobalCooldownSkip(input: Readonly<{ requestId: string | undefined; reason: string; skipReason: string | undefined }>): AcceptedReplyCompletionAffectAction | null;
}>;

export function createReplyCompletionAffectActionController(): ReplyCompletionAffectActionController {
  let pending: DeferredReplyCompletionAffectAction | null = null;
  let accepted: AcceptedReplyCompletionAffectAction | null = null;

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
      accepted = null;
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
    }
  };
}
