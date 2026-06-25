import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateScaledPetBounds,
  canApplyPetScaleAdjustment,
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  getAdjustedPetScale,
  normalizePetScale,
  parsePetScaleAdjustmentIntent,
  parsePetPresentationPreferences,
  parseStoredPetPresentationPreferences
} from "../src/shared/pet-presentation.ts";

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

test("calculateScaledPetBounds preserves the bottom center before clamping", () => {
  const bounds = calculateScaledPetBounds(
    { x: 100, y: 200, width: 420, height: 600 },
    0.7,
    { x: 0, y: 0, width: 1920, height: 1080 }
  );

  assert.deepEqual(bounds, { x: 163, y: 380, width: 294, height: 420 });
  assert.equal(bounds.x + bounds.width / 2, 310);
  assert.equal(bounds.y + bounds.height, 800);
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

test("calculateScaledPetBounds keeps the window inside the display work area", () => {
  const bounds = calculateScaledPetBounds(
    { x: -80, y: -60, width: 420, height: 600 },
    1.35,
    { x: 0, y: 0, width: 1280, height: 900 }
  );

  assert.deepEqual(bounds, { x: 0, y: 0, width: 567, height: 810 });
});

test("calculateScaledPetBounds reduces only the rendered scale when the work area is smaller", () => {
  const bounds = calculateScaledPetBounds(
    { x: 100, y: 100, width: 420, height: 600 },
    1.35,
    { x: 0, y: 0, width: 1280, height: 768 }
  );

  assert.deepEqual(bounds, { x: 41, y: 0, width: 538, height: 768 });
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
