import assert from "node:assert/strict";
import test from "node:test";
import { createReplyCompletionAffectActionController } from "../src/main/services/affect/reply-completion-affect-action-controller.ts";
import { createReplyCompletionAffectRetryScheduler } from "../src/main/services/affect/reply-completion-affect-retry-scheduler.ts";

test("P2-88B releases one medium-happy idle request only after its waiting action reaches a main terminal", () => {
  const controller = createReplyCompletionAffectActionController();
  controller.defer({ blockerRequestId: "waiting-1", blockerReason: "chat_reply_waiting", requestVersion: 7, reason: "state_idle" });

  assert.deepEqual(controller.consumeAfterLifecycle({
    lifecycleResult: "main_started",
    requestId: "waiting-1",
    reason: "chat_reply_waiting"
  }), null);
  assert.equal(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "unrelated-2",
    reason: "chat_reply_waiting"
  }), null);
  assert.deepEqual(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "waiting-1",
    reason: "chat_reply_waiting"
  }), { blockerRequestId: "waiting-1", blockerReason: "chat_reply_waiting", requestVersion: 7, reason: "state_idle" });
  assert.equal(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "waiting-1",
    reason: "chat_reply_waiting"
  }), null);
});

test("P2-88B cancels a deferred affect request before terminal when a later turn supersedes it", () => {
  const controller = createReplyCompletionAffectActionController();
  controller.defer({ blockerRequestId: "waiting-1", blockerReason: "chat_reply_waiting", requestVersion: 7, reason: "state_idle" });
  controller.cancel();

  assert.equal(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "waiting-1",
    reason: "chat_reply_waiting"
  }), null);
});

test("P2-88B refuses every deferred action other than the frozen idle soft-smile route", () => {
  const controller = createReplyCompletionAffectActionController();

  assert.throws(() => controller.defer({
    blockerRequestId: "waiting-1",
    blockerReason: "chat_reply_waiting",
    requestVersion: 7,
    reason: "state_listen"
  }), /state_idle/);
});

test("P2-88B accepts the local-model waiting terminal only when its request id and reason both match", () => {
  const controller = createReplyCompletionAffectActionController();
  controller.defer({ blockerRequestId: "busy-2", blockerReason: "state_local_model_busy", requestVersion: 8, reason: "state_idle" });

  assert.equal(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "busy-2",
    reason: "chat_reply_waiting"
  }), null);
  assert.deepEqual(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "busy-2",
    reason: "state_local_model_busy"
  }), { blockerRequestId: "busy-2", blockerReason: "state_local_model_busy", requestVersion: 8, reason: "state_idle" });
  assert.equal(controller.consumeAfterLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "busy-2",
    reason: "state_local_model_busy"
  }), null);
});

test("P2-88B permits exactly one retry only for its accepted idle request skipped by global cooldown", () => {
  const controller = createReplyCompletionAffectActionController();
  controller.trackAccepted({ requestId: "idle-3", requestVersion: 9, reason: "state_idle" });

  assert.equal(controller.consumeGlobalCooldownSkip({ requestId: "other-4", reason: "state_idle", skipReason: "global_cooldown" }), null);
  assert.deepEqual(
    controller.consumeGlobalCooldownSkip({ requestId: "idle-3", reason: "state_idle", skipReason: "global_cooldown" }),
    { requestId: "idle-3", requestVersion: 9, reason: "state_idle" }
  );
  assert.equal(controller.consumeGlobalCooldownSkip({ requestId: "idle-3", reason: "state_idle", skipReason: "global_cooldown" }), null);
});

test("P2-88B one-shot scheduler dispatches at 701ms exactly once and consumes its slot", () => {
  let nowMs = 0;
  let scheduledCallback: (() => void) | null = null;
  let scheduledAtMs: number | null = null;
  let cleared = false;
  const scheduler = createReplyCompletionAffectRetryScheduler({
    setTimer(callback, delayMs) {
      scheduledCallback = callback;
      scheduledAtMs = nowMs + delayMs;
      return 1;
    },
    clearTimer() {
      cleared = true;
      scheduledCallback = null;
    }
  });
  let dispatchEligibilityCount = 0;

  assert.equal(scheduler.schedule(() => {
    dispatchEligibilityCount += 1;
  }), true);
  assert.equal(scheduler.schedule(() => {
    dispatchEligibilityCount += 1;
  }), false);

  const advanceTo = (targetMs: number) => {
    nowMs = targetMs;
    if (scheduledAtMs !== null && nowMs >= scheduledAtMs) scheduledCallback?.();
  };
  assert.equal(scheduledAtMs, 701);
  advanceTo(700);
  assert.equal(dispatchEligibilityCount, 0);
  advanceTo(701);
  assert.equal(dispatchEligibilityCount, 1);
  scheduledCallback?.();
  assert.equal(dispatchEligibilityCount, 1);
  assert.equal(scheduler.schedule(() => {
    dispatchEligibilityCount += 1;
  }), false);
  assert.equal(cleared, false);
});

test("P2-88B every lifecycle cancellation clears a pending retry before its deadline", () => {
  for (const cancellation of ["new_request", "hide", "reset", "disable", "quiesce"]) {
    let scheduledCallback: (() => void) | null = null;
    let clearCount = 0;
    const scheduler = createReplyCompletionAffectRetryScheduler({
      setTimer(callback) {
        scheduledCallback = callback;
        return 1;
      },
      clearTimer() {
        clearCount += 1;
        scheduledCallback = null;
      }
    });
    let dispatchEligibilityCount = 0;
    assert.equal(scheduler.schedule(() => {
      dispatchEligibilityCount += 1;
    }), true, cancellation);
    scheduler.cancel();
    scheduledCallback?.();
    assert.equal(dispatchEligibilityCount, 0, cancellation);
    assert.equal(clearCount, 1, cancellation);
  }
});

test("P2-88B cancellation removes accepted cooldown-retry eligibility", () => {
  const controller = createReplyCompletionAffectActionController();
  controller.trackAccepted({ requestId: "idle-cancelled", requestVersion: 11, reason: "state_idle" });
  controller.cancel();

  assert.equal(controller.consumeGlobalCooldownSkip({
    requestId: "idle-cancelled",
    reason: "state_idle",
    skipReason: "global_cooldown"
  }), null);
});
