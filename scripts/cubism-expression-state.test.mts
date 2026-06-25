import assert from "node:assert/strict";
import test from "node:test";
import { ExpressionIntentCoordinator } from "../src/renderer/pet/live2d/cubism-expression-state.ts";

function loadAction(coordinator: ExpressionIntentCoordinator, emotion: Exclude<Parameters<ExpressionIntentCoordinator["request"]>[0], "neutral">) {
  const action = coordinator.request(emotion);
  assert.equal(action.type, "load");
  return action.request;
}

test("expression intent starts neutral", () => {
  const coordinator = new ExpressionIntentCoordinator();

  assert.deepEqual(coordinator.getState(), {
    intent: "neutral",
    applied: "neutral",
    loading: null,
    isRestoringNeutral: false,
    isReleased: false
  });
});

test("duplicate expression requests do not create another load", () => {
  const coordinator = new ExpressionIntentCoordinator();
  const happy = loadAction(coordinator, "happy");

  assert.deepEqual(coordinator.request("happy"), { type: "none" });
  assert.equal(coordinator.completeLoad(happy), true);
  assert.deepEqual(coordinator.request("happy"), { type: "none" });
});

test("a late load cannot replace a newer intent", () => {
  const coordinator = new ExpressionIntentCoordinator();
  const happy = loadAction(coordinator, "happy");
  const sad = loadAction(coordinator, "sad");

  assert.equal(coordinator.completeLoad(happy), false);
  assert.equal(coordinator.completeLoad(sad), true);
  assert.deepEqual(coordinator.getState(), {
    intent: "sad",
    applied: "sad",
    loading: null,
    isRestoringNeutral: false,
    isReleased: false
  });
});

test("neutral preempts an in-flight expression and clears once", () => {
  const coordinator = new ExpressionIntentCoordinator();
  const happy = loadAction(coordinator, "happy");

  assert.deepEqual(coordinator.request("neutral"), { type: "clear" });
  assert.deepEqual(coordinator.request("neutral"), { type: "none" });
  assert.equal(coordinator.completeLoad(happy), false);
  assert.deepEqual(coordinator.getState(), {
    intent: "neutral",
    applied: "neutral",
    loading: null,
    isRestoringNeutral: true,
    isReleased: false
  });
});

test("missing resources and load failures fall back to neutral", () => {
  const coordinator = new ExpressionIntentCoordinator();
  const confused = loadAction(coordinator, "confused");

  assert.equal(coordinator.failLoad(confused), true);
  assert.deepEqual(coordinator.getState(), {
    intent: "neutral",
    applied: "neutral",
    loading: null,
    isRestoringNeutral: true,
    isReleased: false
  });
});

test("application failures fall back to neutral", () => {
  const coordinator = new ExpressionIntentCoordinator();
  const surprised = loadAction(coordinator, "surprised");

  assert.equal(coordinator.completeLoad(surprised), true);
  coordinator.failApply();
  assert.deepEqual(coordinator.getState(), {
    intent: "neutral",
    applied: "neutral",
    loading: null,
    isRestoringNeutral: true,
    isReleased: false
  });
});

test("release invalidates pending loads and rejects later requests", () => {
  const coordinator = new ExpressionIntentCoordinator();
  const angry = loadAction(coordinator, "angry");

  coordinator.release();

  assert.equal(coordinator.completeLoad(angry), false);
  assert.deepEqual(coordinator.request("happy"), { type: "none" });
  assert.deepEqual(coordinator.getState(), {
    intent: "neutral",
    applied: "neutral",
    loading: null,
    isRestoringNeutral: true,
    isReleased: true
  });
});
