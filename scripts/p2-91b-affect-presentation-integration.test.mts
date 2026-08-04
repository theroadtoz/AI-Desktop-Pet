import assert from "node:assert/strict";
import test from "node:test";

import {
  publishAffectTerminalPresentation,
  selectAffectPresentationCrosswalk
} from "../src/main/services/affect/affect-presentation-crosswalk.ts";
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
  isPetPresentationIntent,
  reducePetRoleState,
  type PetPresentationIntent
} from "../src/shared/pet-role-state.ts";

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

function createRendererActionBoundary(initialIntent: PetPresentationIntent) {
  let persistentPresentation = initialIntent.expression;
  let persistentAccessorySelection = initialIntent.accessorySelection;
  let persistentIntent = initialIntent;
  const applied: EmotionPresentation[] = [];
  const appliedIntentTelemetry: Record<string, unknown>[] = [];
  const timers: Array<() => void> = [];
  const dataset: Record<string, string> = {};
  const player = createInteractionActionPlayer({
    scheduleTimeout: (callback) => {
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
    reportTelemetry: () => {}
  });

  const receivePublishedIntent = (intent: PetPresentationIntent): void => {
    assert.equal(isPetPresentationIntent(intent), true);
    persistentIntent = intent;
    applyPetPresentationIntent(intent, {
      dataset: dataset as DOMStringMap,
      reportAppliedIntent: (payload) => appliedIntentTelemetry.push(payload),
      setPersistentAccessorySelection: (accessorySelection) => {
      persistentAccessorySelection = accessorySelection;
      },
      setPersistentPresentation: (presentation) => {
      persistentPresentation = presentation;
      },
      getPersistentPresentation: () => persistentPresentation,
      getPersistentAccessorySelection: () => persistentAccessorySelection,
      isInteractionActionActive: () => player.isActive(),
      applyPresentation: (presentation, accessorySelection) => {
      applied.push(presentation);
      persistentAccessorySelection = accessorySelection;
      },
      boostInteraction: () => {}
    });
  };

  receivePublishedIntent(initialIntent);
  return {
    player,
    timers,
    applied,
    appliedIntentTelemetry,
    dataset,
    receivePublishedIntent(intent: PetPresentationIntent): void {
      receivePublishedIntent(intent);
    },
    getPersistentIntent: () => persistentIntent
  };
}

function countPrimaryVisuals(
  renderer: ReturnType<typeof createRendererActionBoundary>,
  intent: PetPresentationIntent
): number {
  return Number(renderer.player.isActive()) + Number(intent.expression.mode !== "neutral");
}

test("P2-91B accepted action restores the published terminal intent instead of old reply delta", () => {
  const { replying, terminal } = reachReplyTerminal();
  const renderer = createRendererActionBoundary(replying.intent);

  assert.equal(renderer.player.playAction(getPetInteractionAction("listen"), "state_listen"), true);
  const plan = selectAffectPresentationCrosswalk({
    acceptedAction: { reason: "state_listen" },
    emotion: replyExpression,
    xita: null
  });
  const published = publishAffectTerminalPresentation(
    plan,
    terminal.intent,
    renderer.receivePublishedIntent
  );
  assert.equal(published.state, "listening");
  assert.equal(published.requestVersion, null);
  assert.equal(published.expression.mode, "neutral");
  assert.equal(renderer.dataset.roleState, "listening");
  assert.equal(renderer.appliedIntentTelemetry.at(-1)?.requestVersion, null);
  assert.equal(countPrimaryVisuals(renderer, published), 1);

  renderer.timers.at(-1)!();
  assert.deepEqual(renderer.applied.at(-1), published.expression);
  assert.equal(renderer.getPersistentIntent().state, "listening");
  assert.equal(renderer.getPersistentIntent().requestVersion, null);
  assert.notEqual(renderer.getPersistentIntent().state, replying.intent.state);
  assert.notEqual(renderer.getPersistentIntent().requestVersion, replying.intent.requestVersion);
});

test("P2-91B deferred action keeps one neutral terminal and restores it after the later action", () => {
  const { replying, terminal } = reachReplyTerminal();
  const renderer = createRendererActionBoundary(replying.intent);
  const plan = selectAffectPresentationCrosswalk({
    acceptedAction: null,
    actionPending: true,
    emotion: replyExpression,
    xita: null
  });
  const published = publishAffectTerminalPresentation(
    plan,
    terminal.intent,
    renderer.receivePublishedIntent
  );

  assert.equal(published.state, "listening");
  assert.equal(published.requestVersion, null);
  assert.equal(published.expression.mode, "neutral");
  assert.equal(renderer.dataset.roleState, "listening");
  assert.equal(renderer.appliedIntentTelemetry.at(-1)?.requestVersion, null);
  assert.equal(countPrimaryVisuals(renderer, published), 0);
  assert.equal(renderer.player.playAction(getPetInteractionAction("replyWarmSettle"), "state_idle"), true);
  assert.equal(countPrimaryVisuals(renderer, published), 1);
  renderer.timers.at(-1)!();
  assert.deepEqual(renderer.applied.at(-1), published.expression);
  assert.equal(renderer.getPersistentIntent().state, "listening");
  assert.equal(renderer.getPersistentIntent().requestVersion, null);
  assert.equal(1 + Number(published.expression.mode !== "neutral"), 1);
});

test("P2-91B rejected action publishes exactly one expression as the persistent terminal", () => {
  const { replying, terminal } = reachReplyTerminal();
  const renderer = createRendererActionBoundary(replying.intent);
  const publishedIntents: PetPresentationIntent[] = [];
  const plan = selectAffectPresentationCrosswalk({
    acceptedAction: null,
    actionPending: false,
    emotion: replyExpression,
    xita: null
  });
  const published = publishAffectTerminalPresentation(plan, terminal.intent, (intent) => {
    publishedIntents.push(intent);
    renderer.receivePublishedIntent(intent);
  });

  assert.equal(publishedIntents.length, 1);
  assert.deepEqual(published.expression, replyExpression);
  assert.equal(published.state, "listening");
  assert.equal(published.requestVersion, null);
  assert.deepEqual(renderer.getPersistentIntent(), published);
  assert.equal(renderer.dataset.roleState, "listening");
  assert.equal(renderer.appliedIntentTelemetry.at(-1)?.requestVersion, null);
  assert.equal(countPrimaryVisuals(renderer, published), 1);
});
