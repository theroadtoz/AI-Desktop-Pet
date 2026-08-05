import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createReplyCompletionAffectActionController } from "../src/main/services/affect/reply-completion-affect-action-controller.ts";
import { createInteractionActionPlayer } from "../src/renderer/pet/interaction-action-player.ts";
import {
  getInteractionActionCooldownSkipReason,
  getPetInteractionAction,
  getWindowShakeLightFeedbackSkipReason,
  isStrongInteractionAction
} from "../src/renderer/pet/interaction-actions.ts";
import { applyPetPresentationIntent } from "../src/renderer/pet/presentation-intent-receiver.ts";
import type { EmotionPresentation } from "../src/shared/emotion-presentation.ts";
import {
  INITIAL_PET_ROLE_SNAPSHOT,
  reducePetRoleState,
  type PetPresentationIntent
} from "../src/shared/pet-role-state.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const replyExpression: EmotionPresentation = {
  emotion: "happy",
  intensity: "medium",
  mode: "micro"
};

function reachReplyTerminal() {
  const opened = reducePetRoleState(INITIAL_PET_ROLE_SNAPSHOT, { type: "chat:opened" });
  const thinking = reducePetRoleState(opened.snapshot, { type: "request:started", requestVersion: 91 });
  const replying = reducePetRoleState(thinking.snapshot, { type: "reply:delta", requestVersion: 91 });
  const terminal = reducePetRoleState(replying.snapshot, {
    type: "reply:completed",
    requestVersion: 91,
    expression: replyExpression
  });
  return { replying, terminal };
}

function createIntegrationPurposeClock() {
  let nowMs = 0;
  let nextId = 0;
  let activeId: number | null = null;
  const purposes: string[] = [];
  const timers: Array<{ id: number; at: number; callback: () => void; active: boolean }> = [];
  const runDue = () => {
    let ran = true;
    while (ran) {
      ran = false;
      for (const timer of timers) {
        if (timer.active && timer.at <= nowMs) {
          timer.active = false;
          if (activeId === timer.id) activeId = null;
          timer.callback();
          ran = true;
        }
      }
    }
  };
  return {
    scheduler: {
      schedule(purpose: "generic_initial_settle" | "affect_cooldown_retry", callback: () => void) {
        purposes.push(purpose);
        const timer = { id: ++nextId, at: nowMs + 701, callback, active: true };
        timers.push(timer);
        activeId = timer.id;
        return true;
      },
      cancel() {
        for (const timer of timers) timer.active = false;
        activeId = null;
      }
    },
    advanceBy(deltaMs: number) {
      nowMs += deltaMs;
      runDue();
    },
    get purposes() {
      return purposes;
    }
  };
}

function createRendererBoundary(initialIntent: PetPresentationIntent) {
  let persistentPresentation = initialIntent.expression;
  let persistentAccessorySelection = initialIntent.accessorySelection;
  let persistentIntent = initialIntent;
  const applied: EmotionPresentation[] = [];
  const telemetry: Array<Readonly<{ type: string; payload: Record<string, unknown> }>> = [];
  const timers: Array<() => void> = [];
  const dataset: Record<string, string> = {};
  const player = createInteractionActionPlayer({
    scheduleTimeout(callback) {
      timers.push(callback);
      return callback as unknown as ReturnType<typeof setTimeout>;
    },
    clearScheduledTimeout: () => {},
    getAction: getPetInteractionAction,
    getCooldownSkipReason: getInteractionActionCooldownSkipReason,
    getWindowShakeLightFeedbackSkipReason,
    isStrongAction: isStrongInteractionAction,
    boostInteraction: () => {},
    pauseLook: () => {},
    resumeLook: () => {},
    setLookTarget: () => {},
    resetLookTarget: () => {},
    setPoseTarget: () => {},
    resetPoseTarget: () => {},
    playMotionPreset: async (motionPresetId) => ({
      status: "skipped",
      skipReason: "motion_start_cancelled",
      motionPresetId
    }),
    stopMotion: () => {},
    applyTemporaryPartOpacities: () => {},
    restoreTemporaryPartOpacities: () => {},
    setTemporaryAccessory: () => {},
    restoreTemporaryAccessory: () => {},
    setExpression: () => {},
    clearExpression: () => {},
    applyPresentation: (presentation) => applied.push(presentation),
    getPersistentPresentation: () => ({
      presentation: persistentPresentation,
      accessorySelection: persistentAccessorySelection
    }),
    reportTelemetry: (type, payload) => telemetry.push({ type, payload })
  });

  const receive = (intent: PetPresentationIntent): void => {
    persistentIntent = intent;
    applyPetPresentationIntent(intent, {
      dataset: dataset as DOMStringMap,
      reportAppliedIntent: () => {},
      setPersistentAccessorySelection: (selection) => {
        persistentAccessorySelection = selection;
      },
      setPersistentPresentation: (presentation) => {
        persistentPresentation = presentation;
      },
      getPersistentPresentation: () => persistentPresentation,
      getPersistentAccessorySelection: () => persistentAccessorySelection,
      isInteractionActionActive: () => player.isActive(),
      applyPresentation: (presentation) => applied.push(presentation),
      boostInteraction: () => {}
    });
  };
  receive(initialIntent);
  return {
    player,
    timers,
    telemetry,
    dataset,
    receive,
    getPersistentIntent: () => persistentIntent,
    getPersistentPresentation: () => persistentPresentation
  };
}

function createTimedRendererBoundary(initialIntent: PetPresentationIntent) {
  let nowMs = 0;
  let nextTimerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let controllerTimer: number | null = null;
  let persistentPresentation = initialIntent.expression;
  let persistentAccessorySelection = initialIntent.accessorySelection;
  let persistentIntent = initialIntent;
  const applied: EmotionPresentation[] = [];
  const telemetry: Array<Readonly<{ type: string; payload: Record<string, unknown> }>> = [];
  const dataset: Record<string, string> = {};
  const scheduleTimer = (callback: () => void, delayMs: number) => {
    const id = ++nextTimerId;
    timers.set(id, { at: nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimer = (handle: ReturnType<typeof setTimeout>) => {
    timers.delete(handle as unknown as number);
  };
  const runDue = () => {
    let ran = true;
    while (ran) {
      ran = false;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= nowMs) {
          timers.delete(id);
          timer.callback();
          ran = true;
        }
      }
    }
  };
  const player = createInteractionActionPlayer({
    now: () => nowMs,
    scheduleTimeout: scheduleTimer,
    clearScheduledTimeout: clearTimer,
    getAction: getPetInteractionAction,
    getCooldownSkipReason: getInteractionActionCooldownSkipReason,
    getWindowShakeLightFeedbackSkipReason,
    isStrongAction: isStrongInteractionAction,
    boostInteraction: () => {},
    pauseLook: () => {},
    resumeLook: () => {},
    setLookTarget: () => {},
    resetLookTarget: () => {},
    setPoseTarget: () => {},
    resetPoseTarget: () => {},
    playMotionPreset: async (motionPresetId) => ({
      status: "skipped",
      skipReason: "motion_start_cancelled",
      motionPresetId
    }),
    stopMotion: () => {},
    applyTemporaryPartOpacities: () => {},
    restoreTemporaryPartOpacities: () => {},
    setTemporaryAccessory: () => {},
    restoreTemporaryAccessory: () => {},
    setExpression: () => {},
    clearExpression: () => {},
    applyPresentation: (presentation) => applied.push(presentation),
    getPersistentPresentation: () => ({
      presentation: persistentPresentation,
      accessorySelection: persistentAccessorySelection
    }),
    reportTelemetry: (type, payload) => telemetry.push({ type, payload })
  });
  const receive = (intent: PetPresentationIntent): void => {
    persistentIntent = intent;
    applyPetPresentationIntent(intent, {
      dataset: dataset as DOMStringMap,
      reportAppliedIntent: () => {},
      setPersistentAccessorySelection: (selection) => {
        persistentAccessorySelection = selection;
      },
      setPersistentPresentation: (presentation) => {
        persistentPresentation = presentation;
      },
      getPersistentPresentation: () => persistentPresentation,
      getPersistentAccessorySelection: () => persistentAccessorySelection,
      isInteractionActionActive: () => player.isActive(),
      applyPresentation: (presentation) => applied.push(presentation),
      boostInteraction: () => {}
    });
  };
  receive(initialIntent);
  return {
    player,
    telemetry,
    dataset,
    receive,
    scheduler: {
      schedule(_purpose: "generic_initial_settle" | "affect_cooldown_retry", callback: () => void) {
        controllerTimer = scheduleTimer(() => {
          controllerTimer = null;
          callback();
        }, 701) as unknown as number;
        return true;
      },
      cancel() {
        if (controllerTimer !== null) timers.delete(controllerTimer);
        controllerTimer = null;
      }
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
      runDue();
    },
    async advanceBy(deltaMs: number) {
      nowMs += deltaMs;
      runDue();
      await Promise.resolve();
      await Promise.resolve();
      runDue();
    },
    getPersistentIntent: () => persistentIntent,
    getPersistentPresentation: () => persistentPresentation
  };
}

test("P2-91C1 production controller registers the exact generic blocker and publishes one neutral terminal", () => {
  const { replying, terminal } = reachReplyTerminal();
  const renderer = createRendererBoundary(replying.intent);
  const settleClock = createIntegrationPurposeClock();
  const controller = createReplyCompletionAffectActionController({ scheduler: settleClock.scheduler });
  let dispatchCount = 0;
  let publishCount = 0;

  const result = controller.registerGenericCompletion({
    shouldRequestReplyWarmSettle: true,
    replyAction: "generic",
    requestVersion: 91,
    arbitration: { decision: "suppress", reason: "presentation_busy" },
    activeMainRequest: { requestId: "waiting-main-1", reason: "chat_reply_waiting" },
    terminalIntent: terminal.intent
  }, {
    dispatch() {
      dispatchCount += 1;
      return { accepted: true, requestId: "generic-main-2" };
    },
    publish(intent) {
      publishCount += 1;
      renderer.receive(intent);
    }
  });

  assert.equal(result.status, "pending");
  assert.equal(dispatchCount, 0);
  assert.equal(publishCount, 1);
  assert.equal(result.terminalIntent.requestVersion, null);
  assert.equal(result.terminalIntent.expression.mode, "neutral");
  assert.equal(renderer.dataset.roleState, "listening");
  assert.equal(renderer.getPersistentIntent().requestVersion, null);
  assert.notEqual(renderer.getPersistentIntent().state, replying.intent.state);
});

test("P2-91C1 production player cooldown is crossed by the controller-owned 701ms direct settle", async () => {
  const { replying, terminal } = reachReplyTerminal();
  const renderer = createTimedRendererBoundary(replying.intent);
  const replyThinking = getPetInteractionAction("replyThinking");
  assert.equal(renderer.player.playMainAction(replyThinking, {
    requestId: "reply-thinking-1",
    reason: "chat_reply_waiting"
  }), true);
  await renderer.flush();
  await renderer.advanceBy(replyThinking.durationMs);
  assert.equal(renderer.player.isActive(), false);
  assert.equal(
    renderer.telemetry.filter((event) =>
      event.type === "pet_interaction_action_finished" &&
      event.payload.reason === "chat_reply_waiting" &&
      event.payload.terminalStatus === "completed"
    ).length,
    1
  );

  const controller = createReplyCompletionAffectActionController({ scheduler: renderer.scheduler });
  let dispatchCount = 0;
  let publishedCount = 0;
  const registration = controller.registerGenericCompletion({
    shouldRequestReplyWarmSettle: true,
    replyAction: "generic",
    requestVersion: 91,
    arbitration: { decision: "allow", reason: "allowed" },
    activeMainRequest: null,
    terminalIntent: terminal.intent
  }, {
    readSnapshot: () => ({
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "allow", reason: "allowed" }
    }),
    dispatch() {
      dispatchCount += 1;
      const started = renderer.player.playMainAction(
        getPetInteractionAction("replyWarmSettle"),
        { requestId: "generic-direct-1", reason: "chat_reply_completed" }
      );
      return started
        ? { accepted: true, requestId: "generic-direct-1" }
        : { accepted: false, reason: "skipped" };
    },
    publish(intent) {
      publishedCount += 1;
      renderer.receive(intent);
    }
  });
  assert.equal(registration.status, "pending");
  assert.equal(publishedCount, 1);
  assert.equal(dispatchCount, 0);
  assert.equal(renderer.getPersistentIntent().requestVersion, null);
  assert.equal(renderer.getPersistentIntent().expression.mode, "neutral");
  assert.notEqual(renderer.getPersistentIntent().state, replying.intent.state);

  await renderer.advanceBy(700);
  assert.equal(dispatchCount, 0);
  await renderer.advanceBy(1);
  assert.equal(dispatchCount, 1);
  assert.equal(renderer.player.isActive(), true);
  assert.equal(
    Number(renderer.player.isActive()) +
      Number(renderer.getPersistentIntent().expression.mode !== "neutral"),
    1
  );
  await renderer.flush();
  await renderer.advanceBy(getPetInteractionAction("replyWarmSettle").durationMs);
  assert.equal(renderer.player.isActive(), false);
  assert.equal(renderer.getPersistentIntent().requestVersion, null);
  assert.equal(renderer.getPersistentPresentation().mode, "neutral");
  assert.equal(
    renderer.telemetry.filter((event) =>
      event.type === "pet_interaction_action_started" &&
      event.payload.reason === "chat_reply_completed"
    ).length,
    1
  );
  assert.equal(
    renderer.telemetry.filter((event) =>
      event.type === "pet_interaction_action_finished" &&
      event.payload.reason === "chat_reply_completed" &&
      event.payload.terminalStatus === "completed"
    ).length,
    1
  );
});

test("P2-91C1 exact owner terminal uses the live snapshot and restores the neutral terminal after one real action", async () => {
  const { replying, terminal } = reachReplyTerminal();
  const renderer = createRendererBoundary(replying.intent);
  const settleClock = createIntegrationPurposeClock();
  const controller = createReplyCompletionAffectActionController({ scheduler: settleClock.scheduler });
  controller.registerGenericCompletion({
    shouldRequestReplyWarmSettle: true,
    replyAction: "generic",
    requestVersion: 91,
    arbitration: { decision: "suppress", reason: "presentation_busy" },
    activeMainRequest: { requestId: "local-model-1", reason: "state_local_model_busy" },
    terminalIntent: terminal.intent
  }, {
    readSnapshot: () => ({
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "allow", reason: "allowed" }
    }),
    dispatch: () => ({ accepted: false, reason: "failed" }),
    publish: renderer.receive
  });

  let dispatchCount = 0;
  let snapshotReadCount = 0;
  let liveSnapshot = {
    latestCompletedRequestVersion: 90,
    activeRequestVersion: null as number | null,
    hasActiveStream: false,
    arbitration: { decision: "allow" as const, reason: "allowed" }
  };
  const wrong = controller.handleGenericLifecycle({
    lifecycleResult: "main_started",
    requestId: "local-model-1",
    reason: "state_local_model_busy"
  }, {
    readSnapshot() {
      snapshotReadCount += 1;
      return liveSnapshot;
    },
    dispatch() {
      dispatchCount += 1;
      return { accepted: false, reason: "failed" };
    }
  });
  assert.equal(wrong.status, "ignored");
  assert.equal(snapshotReadCount, 0);

  liveSnapshot = {
    latestCompletedRequestVersion: 91,
    activeRequestVersion: null,
    hasActiveStream: false,
    arbitration: { decision: "allow", reason: "allowed" }
  };
  const exact = controller.handleGenericLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "local-model-1",
    reason: "state_local_model_busy"
  }, {
    readSnapshot() {
      snapshotReadCount += 1;
      return liveSnapshot;
    },
    dispatch() {
      dispatchCount += 1;
      const started = renderer.player.playMainAction(
        getPetInteractionAction("replyWarmSettle"),
        { requestId: "generic-action-1", reason: "chat_reply_completed" }
      );
      return started
        ? { accepted: true, requestId: "generic-action-1" }
        : { accepted: false, reason: "skipped" };
    }
  });

  assert.equal(exact.status, "scheduled");
  assert.equal(snapshotReadCount, 0);
  assert.equal(dispatchCount, 0);
  settleClock.advanceBy(700);
  assert.equal(dispatchCount, 0);
  settleClock.advanceBy(1);
  assert.equal(snapshotReadCount, 1);
  assert.equal(dispatchCount, 1);
  assert.equal(renderer.player.isActive(), true);
  assert.equal(Number(renderer.player.isActive()) + Number(renderer.getPersistentIntent().expression.mode !== "neutral"), 1);
  renderer.timers.at(-1)!();
  await Promise.resolve();
  assert.equal(renderer.player.isActive(), false);
  assert.equal(renderer.getPersistentIntent().requestVersion, null);
  assert.equal(renderer.getPersistentPresentation().mode, "neutral");
  assert.notEqual(renderer.getPersistentIntent().state, replying.intent.state);
  assert.equal(Number(renderer.player.isActive()) + Number(renderer.getPersistentIntent().expression.mode !== "neutral"), 0);
  assert.equal(renderer.telemetry.filter((event) => event.type === "pet_interaction_action_started").length, 1);
  assert.equal(renderer.telemetry.filter((event) => event.type === "pet_interaction_action_finished").length, 1);

  const duplicate = controller.handleGenericLifecycle({
    lifecycleResult: "main_terminal",
    requestId: "local-model-1",
    reason: "state_local_model_busy"
  }, {
    readSnapshot: () => liveSnapshot,
    dispatch: () => {
      dispatchCount += 1;
      return { accepted: true, requestId: "duplicate" };
    }
  });
  assert.equal(duplicate.status, "ignored");
  assert.equal(dispatchCount, 1);
});

test("P2-91C1 generic dispatch outcomes are terminal and never enter affect or timed retry", () => {
  const { terminal } = reachReplyTerminal();
  const outcomes = [
    { accepted: true, requestId: "accepted-1" } as const,
    { accepted: false, reason: "busy" } as const,
    { accepted: false, reason: "throttled" } as const,
    { accepted: false, reason: "send_failed" } as const,
    { accepted: false, reason: "rejected" } as const,
    { accepted: false, reason: "cooldown" } as const,
    { accepted: false, reason: "skipped" } as const,
    { accepted: false, reason: "failed" } as const
  ];

  for (const outcome of outcomes) {
    const settleClock = createIntegrationPurposeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: settleClock.scheduler });
    let dispatchCount = 0;
    let publishCount = 0;
    let affectTrackCount = 0;
    let affectCooldownConsumeCount = 0;
    const mutableController = controller as unknown as {
      trackAccepted: typeof controller.trackAccepted;
      consumeGlobalCooldownSkip: typeof controller.consumeGlobalCooldownSkip;
    };
    mutableController.trackAccepted = () => {
      affectTrackCount += 1;
    };
    mutableController.consumeGlobalCooldownSkip = () => {
      affectCooldownConsumeCount += 1;
      return null;
    };
    const result = controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 91,
      arbitration: { decision: "allow", reason: "allowed" },
      activeMainRequest: null,
      terminalIntent: terminal.intent
    }, {
      readSnapshot: () => ({
        latestCompletedRequestVersion: 91,
        activeRequestVersion: null,
        hasActiveStream: false,
        arbitration: { decision: "allow", reason: "allowed" }
      }),
      dispatch() {
        dispatchCount += 1;
        return outcome;
      },
      publish() {
        publishCount += 1;
      }
    });
    assert.equal(result.status, "pending", JSON.stringify(outcome));
    assert.equal(dispatchCount, 0, JSON.stringify(outcome));
    settleClock.advanceBy(700);
    assert.equal(dispatchCount, 0, JSON.stringify(outcome));
    settleClock.advanceBy(1);
    assert.equal(dispatchCount, 1, JSON.stringify(outcome));
    assert.equal(publishCount, 1, JSON.stringify(outcome));
    assert.equal(affectTrackCount, 0, JSON.stringify(outcome));
    assert.equal(affectCooldownConsumeCount, 0, JSON.stringify(outcome));
  }

  const settleClock = createIntegrationPurposeClock();
  const controller = createReplyCompletionAffectActionController({ scheduler: settleClock.scheduler });
  let throwDispatchCount = 0;
  const thrown = controller.registerGenericCompletion({
    shouldRequestReplyWarmSettle: true,
    replyAction: null,
    requestVersion: 91,
    arbitration: { decision: "allow", reason: "allowed" },
    activeMainRequest: null,
    terminalIntent: terminal.intent
  }, {
    readSnapshot: () => ({
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "allow", reason: "allowed" }
    }),
    dispatch() {
      throwDispatchCount += 1;
      throw new Error("sentinel must not escape");
    },
    publish() {}
  });
  assert.equal(thrown.status, "pending");
  settleClock.advanceBy(701);
  assert.equal(throwDispatchCount, 1);
  settleClock.advanceBy(10_000);
  assert.equal(throwDispatchCount, 1);
});

test("P2-91C1 revalidation failures atomically consume pending without dispatch or requeue", () => {
  const { terminal } = reachReplyTerminal();
  const snapshots = [
    {
      latestCompletedRequestVersion: 90,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "allow" as const, reason: "allowed" }
    },
    {
      latestCompletedRequestVersion: 91,
      activeRequestVersion: 92,
      hasActiveStream: false,
      arbitration: { decision: "allow" as const, reason: "allowed" }
    },
    {
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: true,
      arbitration: { decision: "allow" as const, reason: "allowed" }
    },
    {
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "suppress" as const, reason: "presentation_busy" }
    },
    {
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "suppress" as const, reason: "lifecycle_unavailable" }
    },
    {
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "suppress" as const, reason: "focus_suppressed" }
    },
    {
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "defer" as const, reason: "presentation_busy" }
    }
  ];

  for (const snapshot of snapshots) {
    const settleClock = createIntegrationPurposeClock();
    const controller = createReplyCompletionAffectActionController({ scheduler: settleClock.scheduler });
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 91,
      arbitration: { decision: "suppress", reason: "presentation_busy" },
      activeMainRequest: { requestId: "waiting-revalidate", reason: "chat_reply_waiting" },
      terminalIntent: terminal.intent
    }, {
      readSnapshot: () => snapshot,
      dispatch: () => ({ accepted: false, reason: "failed" }),
      publish() {}
    });
    let dispatchCount = 0;
    const adapters = {
      readSnapshot: () => snapshot,
      dispatch() {
        dispatchCount += 1;
        return { accepted: true as const, requestId: "must-not-dispatch" };
      }
    };
    assert.equal(controller.handleGenericLifecycle({
      lifecycleResult: "main_terminal",
      requestId: "waiting-revalidate",
      reason: "chat_reply_waiting"
    }, adapters).status, "scheduled");
    assert.equal(controller.handleGenericLifecycle({
      lifecycleResult: "main_terminal",
      requestId: "waiting-revalidate",
      reason: "chat_reply_waiting"
    }, adapters).status, "ignored");
    settleClock.advanceBy(701);
    assert.equal(dispatchCount, 0);
  }
});

test("P2-91C1 live snapshot failure is fail-closed and cannot requeue", () => {
  const { terminal } = reachReplyTerminal();
  const settleClock = createIntegrationPurposeClock();
  const controller = createReplyCompletionAffectActionController({ scheduler: settleClock.scheduler });
  controller.registerGenericCompletion({
    shouldRequestReplyWarmSettle: true,
    replyAction: "generic",
    requestVersion: 91,
    arbitration: { decision: "suppress", reason: "presentation_busy" },
    activeMainRequest: { requestId: "snapshot-failure", reason: "chat_reply_waiting" },
    terminalIntent: terminal.intent
  }, {
    readSnapshot() {
      throw new Error("registration snapshot must not run while blocked");
    },
    dispatch: () => ({ accepted: false, reason: "failed" }),
    publish() {}
  });
  const lifecycle = {
    lifecycleResult: "main_terminal" as const,
    requestId: "snapshot-failure",
    reason: "chat_reply_waiting"
  };
  assert.equal(controller.handleGenericLifecycle(lifecycle, {
    readSnapshot() {
      throw new Error("snapshot sentinel");
    },
    dispatch: () => ({ accepted: true, requestId: "must-not-dispatch" })
  }).status, "scheduled");
  assert.equal(controller.handleGenericLifecycle(lifecycle, {
    readSnapshot: () => ({
      latestCompletedRequestVersion: 91,
      activeRequestVersion: null,
      hasActiveStream: false,
      arbitration: { decision: "allow", reason: "allowed" }
    }),
    dispatch: () => ({ accepted: true, requestId: "late" })
  }).status, "ignored");
  settleClock.advanceBy(701);
});

test("P2-91C1 wrong lifecycle and every cancellation source leave no late generic dispatch", () => {
  const { terminal } = reachReplyTerminal();
  const cancellations = ["new", "abort", "hide", "close", "rebuild", "destroy", "reset", "disable", "quiesce"];
  for (const cancellation of cancellations) {
    const controller = createReplyCompletionAffectActionController();
    controller.registerGenericCompletion({
      shouldRequestReplyWarmSettle: true,
      replyAction: "generic",
      requestVersion: 91,
      arbitration: { decision: "suppress", reason: "presentation_busy" },
      activeMainRequest: { requestId: `waiting-${cancellation}`, reason: "chat_reply_waiting" },
      terminalIntent: terminal.intent
    }, {
      dispatch: () => ({ accepted: false, reason: "failed" }),
      publish() {}
    });
    controller.cancel();
    controller.cancel();
    let dispatchCount = 0;
    assert.equal(controller.handleGenericLifecycle({
      lifecycleResult: "main_terminal",
      requestId: `waiting-${cancellation}`,
      reason: "chat_reply_waiting"
    }, {
      readSnapshot: () => ({
        latestCompletedRequestVersion: 91,
        activeRequestVersion: null,
        hasActiveStream: false,
        arbitration: { decision: "allow", reason: "allowed" }
      }),
      dispatch: () => {
        dispatchCount += 1;
        return { accepted: true, requestId: "late" };
      }
    }).status, "ignored", cancellation);
    assert.equal(dispatchCount, 0, cancellation);
  }
});

function hasThinGenericAppDelegation(source: string, controllerSource: string): boolean {
  const occurrences = (needle: string) => source.split(needle).length - 1;
  return occurrences("replyCompletionAffectActionController.registerGenericCompletion({") === 1 &&
    occurrences("replyCompletionAffectActionController.handleGenericLifecycle({") === 1 &&
    occurrences("readSnapshot: readGenericReplyCompletionLiveSnapshot") === 2 &&
    occurrences("dispatch: dispatchGenericReplyCompletionAction") === 2 &&
    occurrences("publish: publishPetPresentation") === 1 &&
    occurrences("replyCompletionAffectActionController.scheduleAffectCooldownRetry(") === 1 &&
    controllerSource.includes('"generic_initial_settle"') &&
    controllerSource.includes('"affect_cooldown_retry"') &&
    controllerSource.includes("scheduleGenericInitialSettle") &&
    controllerSource.includes("snapshot = adapters.readSnapshot()") &&
    controllerSource.includes("adapters.dispatch()") &&
    !source.includes("deferReplyCompletionGenericActionIfEligible") &&
    !source.includes("dispatchDeferredReplyCompletionGenericAction") &&
    !source.includes(".deferGeneric(") &&
    !source.includes(".consumeGenericAfterLifecycle(");
}

test("P2-91C1 app thin-delegation gate fails when controller or live snapshot delegation is bypassed", () => {
  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  const controllerSource = readFileSync(
    join(repoRoot, "src/main/services/affect/reply-completion-affect-action-controller.ts"),
    "utf8"
  );
  assert.equal(hasThinGenericAppDelegation(appSource, controllerSource), true);
  for (const mutated of [
    appSource.replace("replyCompletionAffectActionController.registerGenericCompletion({", "({"),
    appSource.replace("replyCompletionAffectActionController.handleGenericLifecycle({", "({"),
    appSource.replace("readSnapshot: readGenericReplyCompletionLiveSnapshot", "readSnapshot: () => capturedSnapshot"),
    appSource.replace("dispatch: dispatchGenericReplyCompletionAction", "dispatch: () => requestPetActionTriggerWithResult(\"chat_reply_completed\")"),
    `${appSource}\nfunction deferReplyCompletionGenericActionIfEligible() {}`
  ]) {
    assert.equal(hasThinGenericAppDelegation(mutated, controllerSource), false);
  }
  assert.equal(hasThinGenericAppDelegation(
    appSource,
    controllerSource.replaceAll("scheduleGenericInitialSettle", "removedGenericInitialSettle")
  ), false);
});
