import assert from "node:assert/strict";
import test from "node:test";
import { createReplyCompletionAffectActionController } from "../src/main/services/affect/reply-completion-affect-action-controller.ts";
import { createReplyCompletionAffectRetryScheduler } from "../src/main/services/affect/reply-completion-affect-retry-scheduler.ts";
import { createPetPresentationIntent, INITIAL_PET_ROLE_SNAPSHOT } from "../src/shared/pet-role-state.ts";

const genericTerminalIntent = createPetPresentationIntent(INITIAL_PET_ROLE_SNAPSHOT);
const allowedLiveSnapshot = {
  latestCompletedRequestVersion: 12,
  activeRequestVersion: null,
  hasActiveStream: false,
  arbitration: { decision: "allow" as const, reason: "allowed" }
};

function createGenericFakeClock() {
  let nowMs = 0;
  let nextId = 0;
  let currentId: number | null = null;
  let clearCount = 0;
  const purposes: string[] = [];
  const entries: Array<{ id: number; at: number; callback: () => void; fired: boolean }> = [];
  return {
    scheduler: {
      schedule(purpose: "generic_initial_settle" | "affect_cooldown_retry", callback: () => void) {
        purposes.push(purpose);
        const entry = { id: ++nextId, at: nowMs + 701, callback, fired: false };
        entries.push(entry);
        currentId = entry.id;
        return true;
      },
      cancel() {
        clearCount += 1;
        currentId = null;
      }
    },
    advanceBy(deltaMs: number) {
      nowMs += deltaMs;
      for (const entry of entries) {
        if (!entry.fired && entry.id === currentId && entry.at <= nowMs) {
          entry.fired = true;
          currentId = null;
          entry.callback();
        }
      }
    },
    fireLate(index: number) {
      entries[index]?.callback();
    },
    get purposes() {
      return purposes;
    },
    get clearCount() {
      return clearCount;
    },
    get activeCount() {
      return currentId === null ? 0 : 1;
    }
  };
}

function registerGenericPending(
  controller: ReturnType<typeof createReplyCompletionAffectActionController>,
  blockerReason: "chat_reply_waiting" | "state_local_model_busy" = "chat_reply_waiting"
) {
  return controller.registerGenericCompletion({
    shouldRequestReplyWarmSettle: true,
    replyAction: "generic",
    requestVersion: 12,
    arbitration: { decision: "suppress", reason: "presentation_busy" },
    activeMainRequest: { requestId: "waiting-generic-1", reason: blockerReason },
    terminalIntent: genericTerminalIntent
  }, {
    dispatch: () => ({ accepted: false, reason: "failed" }),
    publish() {}
  });
}

test("P2-91C1 production generic policy admits only warm generic presentation-busy with a frozen blocker", () => {
  for (const blockerReason of ["chat_reply_waiting", "state_local_model_busy"] as const) {
    const controller = createReplyCompletionAffectActionController();
    assert.equal(registerGenericPending(controller, blockerReason).status, "pending");
  }

  for (const invalid of [
    { shouldRequestReplyWarmSettle: false },
    { replyAction: "affect" as const },
    { replyAction: "suppressed" as const },
    { arbitration: { decision: "suppress" as const, reason: "focus_suppressed" } },
    { arbitration: { decision: "defer" as const, reason: "presentation_busy" } },
    { activeMainRequest: null },
    { activeMainRequest: { requestId: "waiting-generic-1", reason: "state_idle" } }
  ]) {
    const controller = createReplyCompletionAffectActionController();
    let dispatchCount = 0;
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 12,
      arbitration: { decision: "suppress", reason: "presentation_busy" },
      activeMainRequest: { requestId: "waiting-generic-1", reason: "chat_reply_waiting" },
      terminalIntent: genericTerminalIntent,
      ...invalid
    }, {
      dispatch: () => {
        dispatchCount += 1;
        return { accepted: true, requestId: "must-not-dispatch" };
      },
      publish() {}
    });
    const late = controller.handleGenericLifecycle({
      lifecycleResult: "main_terminal",
      requestId: "waiting-generic-1",
      reason: "chat_reply_waiting"
    }, {
      readSnapshot: () => allowedLiveSnapshot,
      dispatch: () => {
        dispatchCount += 1;
        return { accepted: true, requestId: "late" };
      }
    });
    assert.equal(late.status, "ignored", JSON.stringify(invalid));
    assert.equal(dispatchCount, 0, JSON.stringify(invalid));
  }
});

test("P2-91C1 production generic policy consumes only its exact main owner terminal once", () => {
  const clock = createGenericFakeClock();
  const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
  registerGenericPending(controller);
  let dispatchCount = 0;
  const adapters = {
    readSnapshot: () => allowedLiveSnapshot,
    dispatch: () => {
      dispatchCount += 1;
      return { accepted: true as const, requestId: "generic-dispatch-1" };
    }
  };
  for (const lifecycle of [
    { lifecycleResult: "local_terminal" as const, requestId: "waiting-generic-1", reason: "chat_reply_waiting" },
    { lifecycleResult: "main_started" as const, requestId: "waiting-generic-1", reason: "chat_reply_waiting" },
    { lifecycleResult: "main_terminal" as const, requestId: "other", reason: "chat_reply_waiting" },
    { lifecycleResult: "main_terminal" as const, requestId: "waiting-generic-1", reason: "state_local_model_busy" }
  ]) {
    assert.equal(controller.handleGenericLifecycle(lifecycle, adapters).status, "ignored");
  }
  assert.equal(controller.handleGenericLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "waiting-generic-1",
    reason: "chat_reply_waiting"
  }, adapters).status, "scheduled");
  assert.equal(controller.handleGenericLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "waiting-generic-1",
    reason: "chat_reply_waiting"
  }, adapters).status, "ignored");
  assert.equal(dispatchCount, 0);
  clock.advanceBy(701);
  assert.equal(dispatchCount, 1);
});

test("P2-91C1 production generic cancellation clears every lifecycle exit", () => {
  for (const cancellation of ["new", "abort", "hide", "close", "rebuild", "destroy", "reset", "disable", "quiesce"]) {
    const controller = createReplyCompletionAffectActionController();
    registerGenericPending(controller, "state_local_model_busy");
    controller.cancel();
    assert.equal(controller.handleGenericLifecycle({
      lifecycleResult: "main_terminal",
      requestId: "waiting-generic-1",
      reason: "state_local_model_busy"
    }, {
      readSnapshot: () => allowedLiveSnapshot,
      dispatch: () => ({ accepted: true, requestId: "late" })
    }).status, "ignored", cancellation);
  }
});

test("P2-91C1 direct and owner-deferred generic initial settle dispatch at 701ms exactly once", () => {
  for (const mode of ["direct", "deferred"] as const) {
    const clock = createGenericFakeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
    let dispatchCount = 0;
    const adapters = {
      readSnapshot: () => allowedLiveSnapshot,
      dispatch: () => {
        dispatchCount += 1;
        return { accepted: true as const, requestId: `${mode}-generic` };
      },
      publish() {}
    };
    const registration = controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 12,
      arbitration: mode === "direct"
        ? { decision: "allow", reason: "allowed" }
        : { decision: "suppress", reason: "presentation_busy" },
      activeMainRequest: mode === "direct"
        ? null
        : { requestId: "waiting-generic-1", reason: "chat_reply_waiting" },
      terminalIntent: genericTerminalIntent
    }, adapters);
    assert.equal(registration.status, "pending", mode);
    assert.equal(dispatchCount, 0, mode);
    if (mode === "deferred") {
      clock.advanceBy(5_000);
      assert.equal(dispatchCount, 0);
      assert.equal(controller.handleGenericLifecycle({
        lifecycleResult: "main_terminal",
        requestId: "waiting-generic-1",
        reason: "chat_reply_waiting"
      }, adapters).status, "scheduled");
    }
    clock.advanceBy(700);
    assert.equal(dispatchCount, 0, `${mode} @700ms`);
    clock.advanceBy(1);
    assert.equal(dispatchCount, 1, `${mode} @701ms`);
    clock.advanceBy(10_000);
    assert.equal(dispatchCount, 1, `${mode} one-shot`);
    assert.deepEqual(clock.purposes, ["generic_initial_settle"]);
  }
});

test("P2-91C1 generic initial settle reads live state at fire and never requeues failures", () => {
  for (const snapshot of [
    { ...allowedLiveSnapshot, latestCompletedRequestVersion: 11 },
    { ...allowedLiveSnapshot, activeRequestVersion: 13 },
    { ...allowedLiveSnapshot, hasActiveStream: true },
    { ...allowedLiveSnapshot, arbitration: { decision: "suppress" as const, reason: "chat_hidden" } },
    { ...allowedLiveSnapshot, arbitration: { decision: "suppress" as const, reason: "renderer_recovering" } },
    { ...allowedLiveSnapshot, arbitration: { decision: "defer" as const, reason: "presentation_busy" } }
  ]) {
    const clock = createGenericFakeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
    let dispatchCount = 0;
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 12,
      arbitration: { decision: "allow", reason: "allowed" },
      activeMainRequest: null,
      terminalIntent: genericTerminalIntent
    }, {
      readSnapshot: () => snapshot,
      dispatch: () => {
        dispatchCount += 1;
        return { accepted: true, requestId: "must-not-dispatch" };
      },
      publish() {}
    });
    clock.advanceBy(701);
    clock.advanceBy(20_000);
    assert.equal(dispatchCount, 0, JSON.stringify(snapshot));
    assert.equal(clock.activeCount, 0);
  }

  for (const outcome of ["busy", "throttled", "send_failed", "rejected", "cooldown", "skipped", "failed", "threw"] as const) {
    const clock = createGenericFakeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
    let dispatchCount = 0;
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 12,
      arbitration: { decision: "allow", reason: "allowed" },
      activeMainRequest: null,
      terminalIntent: genericTerminalIntent
    }, {
      readSnapshot: () => allowedLiveSnapshot,
      dispatch: () => {
        dispatchCount += 1;
        if (outcome === "threw") throw new Error("sentinel");
        return { accepted: false as const, reason: outcome };
      },
      publish() {}
    });
    clock.advanceBy(701);
    clock.advanceBy(20_000);
    assert.equal(dispatchCount, 1, outcome);
    assert.deepEqual(clock.purposes, ["generic_initial_settle"], outcome);
  }
});

test("P2-91C1 shared scheduler purposes replace bidirectionally and cancel stale callbacks", () => {
  const directAdapters = (dispatch: () => { accepted: true; requestId: string }) => ({
    readSnapshot: () => allowedLiveSnapshot,
    dispatch,
    publish() {}
  });

  {
    const clock = createGenericFakeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
    let genericDispatch = 0;
    let affectDispatch = 0;
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 12,
      arbitration: { decision: "allow", reason: "allowed" },
      activeMainRequest: null,
      terminalIntent: genericTerminalIntent
    }, directAdapters(() => ({ accepted: true, requestId: `generic-${++genericDispatch}` })));
    assert.equal(controller.scheduleAffectCooldownRetry(() => { affectDispatch += 1; }), true);
    assert.equal(clock.activeCount, 1);
    clock.fireLate(0);
    assert.equal(genericDispatch, 0);
    clock.advanceBy(701);
    assert.equal(affectDispatch, 1);
    assert.deepEqual(clock.purposes, ["generic_initial_settle", "affect_cooldown_retry"]);
  }

  {
    const clock = createGenericFakeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
    let genericDispatch = 0;
    let affectDispatch = 0;
    assert.equal(controller.scheduleAffectCooldownRetry(() => { affectDispatch += 1; }), true);
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 12,
      arbitration: { decision: "allow", reason: "allowed" },
      activeMainRequest: null,
      terminalIntent: genericTerminalIntent
    }, directAdapters(() => ({ accepted: true, requestId: `generic-${++genericDispatch}` })));
    clock.fireLate(0);
    assert.equal(affectDispatch, 0);
    clock.advanceBy(701);
    assert.equal(genericDispatch, 1);
    assert.deepEqual(clock.purposes, ["affect_cooldown_retry", "generic_initial_settle"]);
  }
});

test("P2-91C1 generic blocker and initial-settle cancellation are late-callback safe", () => {
  for (const cancellation of ["new", "abort", "hide", "close", "rebuild", "destroy", "reset", "disable", "quiesce"]) {
    for (const stage of ["blocker", "settle"] as const) {
      const clock = createGenericFakeClock();
      const controller = createReplyCompletionAffectActionController({ scheduler: clock.scheduler });
      let dispatchCount = 0;
      const adapters = {
        readSnapshot: () => allowedLiveSnapshot,
        dispatch: () => ({ accepted: true as const, requestId: `late-${++dispatchCount}` }),
        publish() {}
      };
      controller.registerGenericCompletion({
        shouldRequestReplyWarmSettle: true,
        replyAction: "generic",
        requestVersion: 12,
        arbitration: stage === "blocker"
          ? { decision: "suppress", reason: "presentation_busy" }
          : { decision: "allow", reason: "allowed" },
        activeMainRequest: stage === "blocker"
          ? { requestId: "waiting-generic-1", reason: "state_local_model_busy" }
          : null,
        terminalIntent: genericTerminalIntent
      }, adapters);
      controller.cancel();
      controller.cancel();
      controller.handleGenericLifecycle({
        lifecycleResult: "main_terminal",
        requestId: "waiting-generic-1",
        reason: "state_local_model_busy"
      }, adapters);
      clock.fireLate(0);
      clock.advanceBy(20_000);
      assert.equal(dispatchCount, 0, `${cancellation}:${stage}`);
    }
  }
});

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
