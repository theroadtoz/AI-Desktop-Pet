import type { PetActionTriggerReason } from "../../../shared/pet-action-trigger";

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimer = (callback: () => void, delayMs: number) => TimerHandle;
type ClearTimer = (timer: TimerHandle) => void;

export type ChatReplySustainTriggerController = {
  observeReplyLength(replyLength: number): void;
  clear(): void;
  hasPending(): boolean;
};

export function createChatReplySustainTriggerController(options: {
  minChars: number;
  delayMs: number;
  sendReason: (reason: PetActionTriggerReason) => void;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}): ChatReplySustainTriggerController {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: TimerHandle | null = null;

  function schedule(): void {
    if (timer) {
      return;
    }

    timer = setTimer(() => {
      timer = null;
      options.sendReason("chat_reply_sustain");
    }, options.delayMs);
  }

  return {
    observeReplyLength(replyLength) {
      if (replyLength >= options.minChars) {
        schedule();
      }
    },
    clear() {
      if (!timer) {
        return;
      }

      clearTimer(timer);
      timer = null;
    },
    hasPending() {
      return timer !== null;
    }
  };
}
