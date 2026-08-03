export type PhoneCharmMotionState = {
  angleRad: number;
  angularVelocity: number;
  stretchPx: number;
  stretchVelocity: number;
};

export type PhoneCharmMotionDrive = {
  velocityX: number;
  velocityY: number;
  active: boolean;
};

export type PhoneCharmWindowMotion = {
  velocityX: number;
  velocityY: number;
  timestampMs: number;
};

export type PhoneCharmApi = {
  onWindowMotion(handler: (motion: PhoneCharmWindowMotion) => void): () => void;
};

export const PHONE_CHARM_STAGE_WIDTH = 420;
export const PHONE_CHARM_STAGE_HEIGHT = 330;
export const PHONE_CHARM_ANCHOR_X = 160;
export const PHONE_CHARM_ANCHOR_Y = 14;
export const PHONE_CHARM_ROPE_LENGTH = 174;
export const PHONE_CHARM_BASE_ANGLE_RAD = Math.atan2(44, 168);
export const PHONE_CHARM_MOTION_SAMPLE_INTERVAL_MS = 16;

const MAX_ANGLE_RAD = Math.PI * 0.28;
const MAX_STRETCH_PX = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createPhoneCharmMotionState(): PhoneCharmMotionState {
  return {
    angleRad: 0,
    angularVelocity: 0,
    stretchPx: 0,
    stretchVelocity: 0
  };
}

export function stepPhoneCharmMotion(
  state: PhoneCharmMotionState,
  drive: PhoneCharmMotionDrive,
  elapsedMs: number
): PhoneCharmMotionState {
  const elapsedSeconds = clamp(elapsedMs / 1_000, 1 / 240, 1 / 30);
  const safeVelocityX = Number.isFinite(drive.velocityX) ? drive.velocityX : 0;
  const safeVelocityY = Number.isFinite(drive.velocityY) ? drive.velocityY : 0;
  const driveTorque = drive.active
    ? clamp(-safeVelocityX / 850, -1, 1) * 13
    : 0;
  const angularAcceleration = (-18 * Math.sin(state.angleRad)) -
    (6.4 * state.angularVelocity) +
    driveTorque;
  const angularVelocity = state.angularVelocity + angularAcceleration * elapsedSeconds;
  const angleRad = clamp(
    state.angleRad + angularVelocity * elapsedSeconds,
    -MAX_ANGLE_RAD,
    MAX_ANGLE_RAD
  );

  const stretchTarget = drive.active
    ? clamp(safeVelocityY / 120, -MAX_STRETCH_PX, MAX_STRETCH_PX)
    : 0;
  const stretchAcceleration = ((stretchTarget - state.stretchPx) * 28) -
    (9 * state.stretchVelocity);
  const stretchVelocity = state.stretchVelocity + stretchAcceleration * elapsedSeconds;
  const stretchPx = clamp(
    state.stretchPx + stretchVelocity * elapsedSeconds,
    -MAX_STRETCH_PX,
    MAX_STRETCH_PX
  );

  return {
    angleRad,
    angularVelocity,
    stretchPx,
    stretchVelocity
  };
}

export function isPhoneCharmMotionSettled(state: PhoneCharmMotionState): boolean {
  return Math.abs(state.angleRad) < 0.0015 &&
    Math.abs(state.angularVelocity) < 0.008 &&
    Math.abs(state.stretchPx) < 0.04 &&
    Math.abs(state.stretchVelocity) < 0.08;
}
