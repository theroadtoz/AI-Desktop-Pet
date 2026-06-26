import assert from "node:assert/strict";
import test from "node:test";
import { createWindowMotionDetector } from "../src/main/services/window-motion-detector.ts";

function input(deltaX: number, deltaY: number, nowMs: number, overrides = {}) {
  return {
    deltaX,
    deltaY,
    nowMs,
    isLocked: false,
    isDragging: true,
    isScaleGestureActive: false,
    isChatInteractionActive: false,
    ...overrides
  };
}

test("short ordinary drag does not produce a motion candidate", () => {
  const detector = createWindowMotionDetector();

  assert.equal(detector.observe(input(20, 5, 0)), null);
  assert.equal(detector.observe(input(30, 5, 80)), null);
  assert.equal(detector.observe(input(25, 4, 160)), null);
});

test("fast long linear drag produces window_move_observed", () => {
  const detector = createWindowMotionDetector();
  let candidate = null;

  for (let index = 0; index < 8; index += 1) {
    candidate = detector.observe(input(95, 0, index * 70));
  }

  assert.deepEqual(candidate, {
    eventType: "window_move_observed",
    reason: "fast_linear_drag",
    directionChanges: 0,
    distancePx: 760,
    durationMs: 490,
    cooldownState: "available",
    isLocked: false,
    isDragging: true
  });
});

test("repeated direction changes produce window_shake_candidate", () => {
  const detector = createWindowMotionDetector();
  const deltas = [60, -60, 60, -60, 60, -60];
  let candidate = null;

  for (let index = 0; index < deltas.length; index += 1) {
    candidate ??= detector.observe(input(deltas[index], 0, index * 60));
  }

  assert.deepEqual(candidate, {
    eventType: "window_shake_candidate",
    reason: "drag_direction_changes",
    directionChanges: 4,
    distancePx: 300,
    durationMs: 240,
    cooldownState: "available",
    isLocked: false,
    isDragging: true
  });
});

test("cooldown suppresses duplicate candidates", () => {
  const detector = createWindowMotionDetector();
  const deltas = [60, -60, 60, -60, 60, -60];
  let first = null;

  for (let index = 0; index < deltas.length; index += 1) {
    first ??= detector.observe(input(deltas[index], 0, index * 60));
  }
  assert.equal(first?.eventType, "window_shake_candidate");

  let duplicate = null;
  for (let index = 0; index < deltas.length; index += 1) {
    duplicate = detector.observe(input(deltas[index], 0, 1_000 + index * 60));
  }

  assert.equal(duplicate, null);
});

test("sample gap resets the active window", () => {
  const detector = createWindowMotionDetector();

  assert.equal(detector.observe(input(60, 0, 0)), null);
  assert.equal(detector.observe(input(-60, 0, 60)), null);
  assert.equal(detector.observe(input(60, 0, 260)), null);
  assert.equal(detector.observe(input(-60, 0, 320)), null);
  assert.equal(detector.observe(input(60, 0, 380)), null);
  assert.equal(detector.observe(input(-60, 0, 440)), null);
});

test("guards disable candidates", () => {
  const guardCases = [
    { isLocked: true },
    { isDragging: false },
    { isScaleGestureActive: true },
    { isChatInteractionActive: true }
  ];

  for (const guardCase of guardCases) {
    const detector = createWindowMotionDetector();
    let candidate = null;

    for (let index = 0; index < 6; index += 1) {
      candidate = detector.observe(input(index % 2 === 0 ? 60 : -60, 0, index * 60, guardCase));
    }

    assert.equal(candidate, null);
  }
});

test("non-finite delta does not throw or emit telemetry", () => {
  const detector = createWindowMotionDetector();

  assert.equal(detector.observe(input(Number.NaN, 0, 0)), null);
  assert.equal(detector.observe(input(0, Number.POSITIVE_INFINITY, 60)), null);
});

test("candidate payload only contains safe summary fields", () => {
  const detector = createWindowMotionDetector();
  const allowedKeys = new Set([
    "eventType",
    "reason",
    "directionChanges",
    "distancePx",
    "durationMs",
    "cooldownState",
    "isLocked",
    "isDragging"
  ]);
  let candidate = null;

  for (let index = 0; index < 6; index += 1) {
    candidate ??= detector.observe(input(index % 2 === 0 ? 60 : -60, 0, index * 60));
  }

  assert(candidate);
  assert.deepEqual(Object.keys(candidate).sort(), [...allowedKeys].sort());
});
