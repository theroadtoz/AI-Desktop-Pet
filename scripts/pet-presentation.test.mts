import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateInitialPetBounds,
  calculatePetVisibleRegion,
  calculateScaledPetBounds,
  canApplyPetScaleAdjustment,
  clampPetBounds,
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  getAdjustedPetScale,
  normalizePetScale,
  PET_INITIAL_RIGHT_MARGIN_PX,
  PET_WAIST_BOTTOM_OVERHANG_PX,
  parsePetScaleAdjustmentIntent,
  parsePetPresentationPreferences,
  parseStoredPetPresentationPreferences
} from "../src/shared/pet-presentation.ts";

function assertApproximatelyEqual(actual: number, expected: number, tolerance = 1): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance}px of ${expected}`
  );
}

test("normalizePetScale accepts only the configured range and step", () => {
  assert.equal(normalizePetScale(0.7), 0.7);
  assert.equal(normalizePetScale(1), 1);
  assert.equal(normalizePetScale(1.35), 1.35);
  assert.equal(normalizePetScale(0.69), null);
  assert.equal(normalizePetScale(1.36), null);
  assert.equal(normalizePetScale(0.73), null);
  assert.equal(normalizePetScale(Number.NaN), null);
});

test("scale adjustment accepts only one discrete step and clamps at the configured bounds", () => {
  assert.deepEqual(parsePetScaleAdjustmentIntent({ steps: 1 }), { steps: 1 });
  assert.deepEqual(parsePetScaleAdjustmentIntent({ steps: -1 }), { steps: -1 });
  assert.equal(parsePetScaleAdjustmentIntent({ steps: 2 }), null);
  assert.equal(parsePetScaleAdjustmentIntent({ steps: 0 }), null);
  assert.equal(parsePetScaleAdjustmentIntent(null), null);
  assert.equal(getAdjustedPetScale(1, { steps: 1 }), 1.05);
  assert.equal(getAdjustedPetScale(1, { steps: -1 }), 0.95);
  assert.equal(getAdjustedPetScale(1.35, { steps: 1 }), 1.35);
  assert.equal(getAdjustedPetScale(0.7, { steps: -1 }), 0.7);
});

test("scale adjustment is rejected while drag or chat interaction owns the pet", () => {
  assert.equal(canApplyPetScaleAdjustment({
    hasPresentationStore: true,
    isChatInteractionActive: false,
    isDragging: false,
    intent: { steps: 1 }
  }), true);
  assert.equal(canApplyPetScaleAdjustment({
    hasPresentationStore: true,
    isChatInteractionActive: false,
    isDragging: true,
    intent: { steps: 1 }
  }), false);
  assert.equal(canApplyPetScaleAdjustment({
    hasPresentationStore: true,
    isChatInteractionActive: true,
    isDragging: false,
    intent: { steps: 1 }
  }), false);
  assert.equal(canApplyPetScaleAdjustment({
    hasPresentationStore: false,
    isChatInteractionActive: false,
    isDragging: false,
    intent: { steps: 1 }
  }), false);
});

test("calculateScaledPetBounds preserves the visible waist center before clamping", () => {
  const bounds = calculateScaledPetBounds(
    { x: 100, y: 200, width: 420, height: 600 },
    0.7,
    { x: 0, y: 0, width: 1920, height: 1080 }
  );
  const region = calculatePetVisibleRegion(bounds);

  assert.deepEqual(bounds, { x: 163, y: 302, width: 294, height: 420 });
  assert.equal(bounds.x + bounds.width / 2, 310);
  assertApproximatelyEqual(bounds.y + region.waistY, 538.4);
});

test("calculateScaledPetBounds stays idempotent for repeated application of the same scale", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const first = calculateScaledPetBounds(
    { x: 100, y: 200, width: 420, height: 600 },
    1.35,
    workArea
  );
  const second = calculateScaledPetBounds(first, 1.35, workArea);

  assert.equal(second.width, first.width);
  assert.equal(second.height, first.height);
});

test("calculateScaledPetBounds allows the visible left and top edges to touch the work area", () => {
  const bounds = calculateScaledPetBounds(
    { x: -80, y: -60, width: 420, height: 600 },
    1.35,
    { x: 0, y: 0, width: 1280, height: 900 }
  );
  const region = calculatePetVisibleRegion(bounds);

  assert.deepEqual(bounds, { x: -56, y: -81, width: 567, height: 810 });
  assertApproximatelyEqual(bounds.x + region.visibleLeft, 0);
  assertApproximatelyEqual(bounds.y + region.visibleTop, 0);
});

test("calculateScaledPetBounds reduces only the rendered scale when the work area is smaller", () => {
  const bounds = calculateScaledPetBounds(
    { x: 100, y: 100, width: 420, height: 600 },
    1.35,
    { x: 0, y: 0, width: 1280, height: 768 }
  );

  assert.deepEqual(bounds, { x: 41, y: 5, width: 538, height: 768 });
});

test("clampPetBounds lets the visible side edges touch the work area", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const left = clampPetBounds({ x: -999, y: 100, width: 420, height: 600 }, workArea);
  const right = clampPetBounds({ x: 9999, y: 100, width: 420, height: 600 }, workArea);
  const leftRegion = calculatePetVisibleRegion(left);
  const rightRegion = calculatePetVisibleRegion(right);

  assertApproximatelyEqual(left.x + leftRegion.visibleLeft, workArea.x);
  assertApproximatelyEqual(right.x + rightRegion.visibleRight, workArea.x + workArea.width);
});

test("clampPetBounds lets the visible top edge touch and allows the waist line to sink below the work area", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const top = clampPetBounds({ x: 100, y: -999, width: 420, height: 600 }, workArea);
  const bottom = clampPetBounds({ x: 100, y: 9999, width: 420, height: 600 }, workArea);
  const topRegion = calculatePetVisibleRegion(top);
  const bottomRegion = calculatePetVisibleRegion(bottom);

  assertApproximatelyEqual(top.y + topRegion.visibleTop, workArea.y);
  assertApproximatelyEqual(
    bottom.y + bottomRegion.waistY,
    workArea.y + workArea.height + PET_WAIST_BOTTOM_OVERHANG_PX
  );
  assert.ok(bottom.y + bottom.height > workArea.y + workArea.height);
});

test("calculateInitialPetBounds places the pet half-body with an approximately 50px right margin", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = calculateInitialPetBounds(1, workArea);
  const region = calculatePetVisibleRegion(bounds);

  assert.deepEqual(bounds, { x: 1492, y: 837, width: 420, height: 600 });
  assertApproximatelyEqual(
    workArea.x + workArea.width - (bounds.x + region.visibleRight),
    PET_INITIAL_RIGHT_MARGIN_PX
  );
  assertApproximatelyEqual(
    bounds.y + region.waistY,
    workArea.y + workArea.height + PET_WAIST_BOTTOM_OVERHANG_PX
  );
  assert.ok(bounds.y + bounds.height > workArea.y + workArea.height);
});

test("calculateInitialPetBounds keeps the half-body placement across scales and work areas", () => {
  const workAreas = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 1366, height: 768 },
    { x: -1280, y: 0, width: 1280, height: 900 }
  ];

  for (const workArea of workAreas) {
    for (const scale of [0.7, 1, 1.35]) {
      const bounds = calculateInitialPetBounds(scale, workArea);
      const region = calculatePetVisibleRegion(bounds);

      assertApproximatelyEqual(
        workArea.x + workArea.width - (bounds.x + region.visibleRight),
        PET_INITIAL_RIGHT_MARGIN_PX
      );
      assertApproximatelyEqual(
        bounds.y + region.waistY,
        workArea.y + workArea.height + PET_WAIST_BOTTOM_OVERHANG_PX
      );
      assert.ok(bounds.x + region.visibleLeft >= workArea.x);
      assert.ok(bounds.y + region.visibleTop >= workArea.y);
      assert.ok(bounds.y + bounds.height > workArea.y + workArea.height);
    }
  }
});

test("parsePetPresentationPreferences rejects missing and invalid scales", () => {
  assert.deepEqual(parsePetPresentationPreferences({ petScale: 1.1 }), {
    petScale: 1.1,
    accessoryPresetId: "none"
  });
  assert.equal(parsePetPresentationPreferences({}), null);
  assert.equal(parsePetPresentationPreferences({ petScale: 1.02 }), null);
  assert.equal(parsePetPresentationPreferences({ petScale: Number.NaN }), null);
});

test("stored pet presentation data falls back safely on invalid content", () => {
  assert.deepEqual(parseStoredPetPresentationPreferences("not json"), DEFAULT_PET_PRESENTATION_PREFERENCES);
  assert.deepEqual(parseStoredPetPresentationPreferences("{}"), DEFAULT_PET_PRESENTATION_PREFERENCES);
  assert.deepEqual(
    parseStoredPetPresentationPreferences(JSON.stringify({ petScale: 1.02 })),
    DEFAULT_PET_PRESENTATION_PREFERENCES
  );
  assert.deepEqual(parseStoredPetPresentationPreferences(JSON.stringify({ petScale: 1.25 })), {
    petScale: 1.25,
    accessoryPresetId: "none"
  });
});
