import { REPLY_COMPLETION_AFFECT_GLOBAL_COOLDOWN_RETRY_DELAY_MS } from "../../../shared/pet-interaction-cooldown.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

type ReplyCompletionAffectRetrySchedulerDependencies = Readonly<{
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}>;

export type ReplyCompletionAffectRetryScheduler = Readonly<{
  schedule(callback: () => void): boolean;
  cancel(): void;
}>;

export function createReplyCompletionAffectRetryScheduler(
  dependencies: ReplyCompletionAffectRetrySchedulerDependencies = {}
): ReplyCompletionAffectRetryScheduler {
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  let state: "idle" | "pending" | "consumed" = "idle";
  let timer: TimerHandle | null = null;

  return {
    schedule(callback) {
      if (state !== "idle") return false;
      state = "pending";
      timer = setTimer(() => {
        if (state !== "pending") return;
        state = "consumed";
        timer = null;
        callback();
      }, REPLY_COMPLETION_AFFECT_GLOBAL_COOLDOWN_RETRY_DELAY_MS);
      return true;
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      state = "idle";
    }
  };
}
