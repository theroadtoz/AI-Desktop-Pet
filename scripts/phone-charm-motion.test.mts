import assert from "node:assert/strict";
import test from "node:test";
import {
  PHONE_CHARM_ANCHOR_X,
  PHONE_CHARM_ANCHOR_Y,
  PHONE_CHARM_BASE_ANGLE_RAD,
  PHONE_CHARM_MOTION_SAMPLE_INTERVAL_MS,
  PHONE_CHARM_ROPE_LENGTH,
  PHONE_CHARM_STAGE_HEIGHT,
  PHONE_CHARM_STAGE_WIDTH,
  createPhoneCharmMotionState,
  isPhoneCharmMotionSettled,
  stepPhoneCharmMotion
} from "../src/shared/phone-charm-motion.ts";

test("window motion sampling supports a 60 FPS animation budget", () => {
  assert.ok(PHONE_CHARM_MOTION_SAMPLE_INTERVAL_MS <= 1_000 / 60);
});

test("the transparent stage contains the pendant throughout maximum swings", () => {
  for (const velocityX of [-20_000, 20_000]) {
    let state = createPhoneCharmMotionState();
    for (let frame = 0; frame < 120; frame += 1) {
      state = stepPhoneCharmMotion(state, { velocityX, velocityY: 20_000, active: true }, 16.67);
    }

    const ropeAngle = PHONE_CHARM_BASE_ANGLE_RAD + state.angleRad;
    const ropeLength = PHONE_CHARM_ROPE_LENGTH + state.stretchPx;
    const endX = PHONE_CHARM_ANCHOR_X + Math.sin(ropeAngle) * ropeLength;
    const endY = PHONE_CHARM_ANCHOR_Y + Math.cos(ropeAngle) * ropeLength;
    const pendantAngle = state.angleRad * 0.55;
    const pendantCorners = [
      { x: -8, y: -8 },
      { x: 78, y: -8 },
      { x: 78, y: 83 },
      { x: -8, y: 83 }
    ].map(({ x, y }) => ({
      x: endX + (x * Math.cos(pendantAngle)) - (y * Math.sin(pendantAngle)),
      y: endY + (x * Math.sin(pendantAngle)) + (y * Math.cos(pendantAngle))
    }));

    assert.ok(Math.min(...pendantCorners.map(({ x }) => x)) >= 0);
    assert.ok(Math.max(...pendantCorners.map(({ x }) => x)) <= PHONE_CHARM_STAGE_WIDTH);
    assert.ok(Math.min(...pendantCorners.map(({ y }) => y)) >= 0);
    assert.ok(Math.max(...pendantCorners.map(({ y }) => y)) <= PHONE_CHARM_STAGE_HEIGHT);
  }
});

test("phone charm remains settled without window movement", () => {
  let state = createPhoneCharmMotionState();
  for (let frame = 0; frame < 60; frame += 1) {
    state = stepPhoneCharmMotion(state, { velocityX: 0, velocityY: 0, active: false }, 16.67);
  }

  assert.equal(state.angleRad, 0);
  assert.equal(state.stretchPx, 0);
  assert.equal(isPhoneCharmMotionSettled(state), true);
});

test("moving the chat window right makes the pendant lag left", () => {
  let state = createPhoneCharmMotionState();
  for (let frame = 0; frame < 8; frame += 1) {
    state = stepPhoneCharmMotion(state, { velocityX: 900, velocityY: 0, active: true }, 16.67);
  }

  assert.ok(state.angleRad < -0.04);
});

test("vertical window motion stretches the soft cord within its limit", () => {
  let state = createPhoneCharmMotionState();
  for (let frame = 0; frame < 20; frame += 1) {
    state = stepPhoneCharmMotion(state, { velocityX: 0, velocityY: 2_000, active: true }, 16.67);
  }

  assert.ok(state.stretchPx > 1);
  assert.ok(state.stretchPx <= 8);
});

test("the pendant converges back to rest after release", () => {
  let state = createPhoneCharmMotionState();
  for (let frame = 0; frame < 12; frame += 1) {
    state = stepPhoneCharmMotion(state, { velocityX: -1_100, velocityY: 600, active: true }, 16.67);
  }
  for (let frame = 0; frame < 360; frame += 1) {
    state = stepPhoneCharmMotion(state, { velocityX: 0, velocityY: 0, active: false }, 16.67);
  }

  assert.equal(isPhoneCharmMotionSettled(state), true);
});
