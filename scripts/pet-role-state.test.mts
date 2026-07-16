import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PET_ROLE_SNAPSHOT,
  isPetPresentationIntent,
  reducePetRoleState
} from "../src/shared/pet-role-state.ts";

function reduce(event: Parameters<typeof reducePetRoleState>[1]) {
  return reducePetRoleState(INITIAL_PET_ROLE_SNAPSHOT, event);
}

test("role state transitions through listening, thinking, replying, and idle", () => {
  const listening = reduce({ type: "chat:opened" });
  assert.equal(listening.snapshot.state, "listening");

  const thinking = reducePetRoleState(listening.snapshot, { type: "request:started", requestVersion: 1 });
  assert.equal(thinking.snapshot.state, "thinking");
  assert.equal(thinking.intent.workStatus, "thinking");

  const replying = reducePetRoleState(thinking.snapshot, { type: "reply:delta", requestVersion: 1 });
  assert.equal(replying.snapshot.state, "replying");

  const completed = reducePetRoleState(replying.snapshot, {
    type: "reply:completed",
    requestVersion: 1,
    expression: { emotion: "happy", intensity: "high", mode: "emphasis" }
  });
  assert.equal(completed.snapshot.state, "listening");
  assert.equal(completed.intent.expression.mode, "emphasis");
  assert.equal(completed.intent.allowEmphasisExpression, true);
  assert.equal(completed.intent.allowMicroExpression, true);
});

test("completed replies can apply their final presentation while the chat stays open", () => {
  const listening = reduce({ type: "chat:opened" });
  assert.equal(listening.intent.allowMicroExpression, false);
  assert.equal(listening.intent.allowEmphasisExpression, false);

  const thinking = reducePetRoleState(listening.snapshot, { type: "request:started", requestVersion: 1 });
  const replying = reducePetRoleState(thinking.snapshot, { type: "reply:delta", requestVersion: 1 });
  const completed = reducePetRoleState(replying.snapshot, {
    type: "reply:completed",
    requestVersion: 1,
    expression: { emotion: "confused", intensity: "medium", mode: "micro" }
  });

  assert.equal(completed.snapshot.state, "listening");
  assert.equal(completed.intent.expression.mode, "micro");
  assert.equal(completed.intent.allowMicroExpression, true);
  assert.equal(completed.intent.allowEmphasisExpression, true);
});

test("stale request events cannot replace the active presentation", () => {
  const active = reduce({ type: "request:started", requestVersion: 3 });
  const stale = reducePetRoleState(active.snapshot, { type: "reply:delta", requestVersion: 2 });

  assert.equal(stale.accepted, false);
  assert.equal(stale.snapshot, active.snapshot);

  const replacement = reducePetRoleState(active.snapshot, { type: "request:started", requestVersion: 4 });
  const oldCompletion = reducePetRoleState(replacement.snapshot, {
    type: "reply:completed",
    requestVersion: 3,
    expression: { emotion: "sad", intensity: "high", mode: "emphasis" }
  });
  assert.equal(oldCompletion.accepted, false);
  assert.equal(oldCompletion.snapshot.state, "thinking");
});

test("cancel and error clear working state and enforce neutral recovery", () => {
  const active = reduce({ type: "request:started", requestVersion: 1 });
  const cancelled = reducePetRoleState(active.snapshot, { type: "request:cancelled", requestVersion: 1 });
  assert.equal(cancelled.snapshot.state, "interrupted");
  assert.equal(cancelled.intent.workStatus, "idle");
  assert.equal(cancelled.intent.expression.emotion, "neutral");

  const failed = reducePetRoleState(active.snapshot, { type: "request:failed", requestVersion: 1 });
  assert.equal(failed.snapshot.state, "error");
  assert.equal(failed.intent.recovery, "safe-neutral");
  assert.equal(failed.intent.expression.emotion, "neutral");

  const reopened = reducePetRoleState(failed.snapshot, { type: "chat:opened" });
  assert.equal(reopened.snapshot.state, "error");
  const recovered = reducePetRoleState(reopened.snapshot, { type: "renderer:recovered" });
  assert.equal(recovered.snapshot.state, "listening");
});

test("presentation IPC is a closed, self-consistent contract", () => {
  const accessorySelection = {
    accessoryIds: ["glasses"],
    sourceByGroup: {
      companion: "user",
      attire: "user",
      facewear: "mode",
      headwear: "user",
      "held-prop": "user"
    }
  } as const;
  assert.equal(isPetPresentationIntent({
    state: "thinking",
    requestVersion: 1,
    gaze: "attentive",
    workStatus: "thinking",
    expression: { emotion: "neutral", intensity: "low", mode: "neutral" },
    accessorySelection,
    allowMicroExpression: false,
    allowEmphasisExpression: false,
    recovery: "normal"
  }), true);
  assert.equal(isPetPresentationIntent({
    state: "error",
    requestVersion: null,
    gaze: "attentive",
    workStatus: "idle",
    expression: { emotion: "happy", intensity: "high", mode: "emphasis" },
    accessorySelection,
    allowMicroExpression: false,
    allowEmphasisExpression: false,
    recovery: "safe-neutral"
  }), false);
  assert.equal(isPetPresentationIntent({
    state: "thinking",
    requestVersion: 1,
    gaze: "attentive",
    workStatus: "thinking",
    expression: { emotion: "neutral", intensity: "low", mode: "neutral" },
    accessorySelection: {
      ...accessorySelection,
      sourceByGroup: { ...accessorySelection.sourceByGroup, Param66: "mode" }
    },
    allowMicroExpression: false,
    allowEmphasisExpression: false,
    recovery: "normal"
  }), false);
});
