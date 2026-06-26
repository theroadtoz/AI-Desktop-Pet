import assert from "node:assert/strict";
import test from "node:test";
import { createScaleWheelNormalizer, hasScaleWheelModifiers } from "../src/renderer/pet/scale-wheel.ts";

test("scale wheel defaults to exactly Ctrl+Shift", () => {
  assert.equal(hasScaleWheelModifiers({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }), true);
  assert.equal(hasScaleWheelModifiers({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), false);
  assert.equal(hasScaleWheelModifiers({ ctrlKey: true, shiftKey: true, altKey: true, metaKey: false }), false);
});

test("scale wheel can use a configured modifier combination", () => {
  assert.equal(hasScaleWheelModifiers({ ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }, "Ctrl+Alt"), true);
  assert.equal(hasScaleWheelModifiers({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }, "Ctrl+Alt"), false);
  assert.equal(hasScaleWheelModifiers({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: false }, "Ctrl+Alt"), false);
});

test("scale wheel normalizes a traditional wheel to one signed scale step", () => {
  const normalizer = createScaleWheelNormalizer();

  assert.equal(normalizer.push({ deltaY: -100, deltaMode: 0, viewportHeight: 600, timestamp: 0 }), 1);
  assert.equal(normalizer.push({ deltaY: 100, deltaMode: 0, viewportHeight: 600, timestamp: 100 }), -1);
});

test("scale wheel accumulates high-resolution deltas without jumping steps", () => {
  const normalizer = createScaleWheelNormalizer();

  assert.equal(normalizer.push({ deltaY: -25, deltaMode: 0, viewportHeight: 600, timestamp: 0 }), 0);
  assert.equal(normalizer.push({ deltaY: -25, deltaMode: 0, viewportHeight: 600, timestamp: 20 }), 0);
  assert.equal(normalizer.push({ deltaY: -25, deltaMode: 0, viewportHeight: 600, timestamp: 40 }), 0);
  assert.equal(normalizer.push({ deltaY: -25, deltaMode: 0, viewportHeight: 600, timestamp: 60 }), 1);
  assert.equal(normalizer.push({ deltaY: -100, deltaMode: 0, viewportHeight: 600, timestamp: 80 }), 0);
  assert.equal(normalizer.push({ deltaY: -1, deltaMode: 0, viewportHeight: 600, timestamp: 140 }), 1);
});

test("scale wheel resets partial input after idle time or direction changes", () => {
  const normalizer = createScaleWheelNormalizer();

  assert.equal(normalizer.push({ deltaY: -60, deltaMode: 0, viewportHeight: 600, timestamp: 0 }), 0);
  assert.equal(normalizer.push({ deltaY: -60, deltaMode: 0, viewportHeight: 600, timestamp: 200 }), 0);
  assert.equal(normalizer.push({ deltaY: 60, deltaMode: 0, viewportHeight: 600, timestamp: 220 }), 0);
  assert.equal(normalizer.push({ deltaY: 40, deltaMode: 0, viewportHeight: 600, timestamp: 280 }), -1);
});
