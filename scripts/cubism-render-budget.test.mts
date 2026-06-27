import assert from "node:assert/strict";
import test from "node:test";
import { getCubismRenderBudget } from "../src/renderer/pet/live2d/cubism-render-budget.ts";

test("getCubismRenderBudget keeps visible interaction frames active", () => {
  const budget = getCubismRenderBudget({
    nowMs: 1_000,
    lastRenderMs: 980,
    isVisible: true,
    interactionBoostUntilMs: 1_500
  });

  assert.equal(budget.mode, "active");
  assert.equal(budget.targetFramesPerSecond, 60);
  assert.equal(budget.shouldRender, true);
});

test("getCubismRenderBudget sheds idle visible frames to 30fps", () => {
  const early = getCubismRenderBudget({
    nowMs: 1_000,
    lastRenderMs: 980,
    isVisible: true,
    interactionBoostUntilMs: 900
  });
  const due = getCubismRenderBudget({
    nowMs: 1_014,
    lastRenderMs: 980,
    isVisible: true,
    interactionBoostUntilMs: 900
  });

  assert.equal(early.mode, "idle");
  assert.equal(early.targetFramesPerSecond, 30);
  assert.equal(early.shouldRender, false);
  assert.equal(due.shouldRender, true);
});

test("getCubismRenderBudget applies presence mode frame budgets", () => {
  const cases = [
    { presenceModeId: "default", active: 60, idle: 30 },
    { presenceModeId: "focus", active: 60, idle: 24 },
    { presenceModeId: "quiet", active: 45, idle: 20 },
    { presenceModeId: "sleep", active: 30, idle: 12 }
  ] as const;

  for (const item of cases) {
    const active = getCubismRenderBudget({
      nowMs: 1_000,
      lastRenderMs: 900,
      isVisible: true,
      interactionBoostUntilMs: 1_500,
      presenceModeId: item.presenceModeId
    });
    const idle = getCubismRenderBudget({
      nowMs: 1_000,
      lastRenderMs: 900,
      isVisible: true,
      interactionBoostUntilMs: 900,
      presenceModeId: item.presenceModeId
    });
    const background = getCubismRenderBudget({
      nowMs: 1_000,
      lastRenderMs: 0,
      isVisible: false,
      interactionBoostUntilMs: 1_500,
      presenceModeId: item.presenceModeId
    });

    assert.equal(active.targetFramesPerSecond, item.active);
    assert.equal(idle.targetFramesPerSecond, item.idle);
    assert.equal(background.targetFramesPerSecond, 2);
  }
});

test("getCubismRenderBudget heavily sheds hidden renderer frames", () => {
  const early = getCubismRenderBudget({
    nowMs: 1_000,
    lastRenderMs: 800,
    isVisible: false,
    interactionBoostUntilMs: 1_500
  });
  const due = getCubismRenderBudget({
    nowMs: 1_301,
    lastRenderMs: 800,
    isVisible: false,
    interactionBoostUntilMs: 1_500
  });

  assert.equal(early.mode, "background");
  assert.equal(early.targetFramesPerSecond, 2);
  assert.equal(early.shouldRender, false);
  assert.equal(due.shouldRender, true);
});
