import "./styles.css";
import {
  PHONE_CHARM_ANCHOR_X,
  PHONE_CHARM_ANCHOR_Y,
  PHONE_CHARM_BASE_ANGLE_RAD,
  PHONE_CHARM_ROPE_LENGTH,
  createPhoneCharmMotionState,
  isPhoneCharmMotionSettled,
  stepPhoneCharmMotion,
  type PhoneCharmMotionDrive,
  type PhoneCharmWindowMotion
} from "../../shared/phone-charm-motion";

declare global {
  interface Window {
    phoneCharmApi?: {
      onWindowMotion(handler: (motion: PhoneCharmWindowMotion) => void): () => void;
    };
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Phone charm element is missing: ${selector}`);
  }

  return element;
}

const cord = requireElement<SVGPathElement>("#charm-cord");
const slider = requireElement<SVGGElement>("#charm-slider");
const pendant = requireElement<SVGGElement>("#charm-pendant");

const anchor = { x: PHONE_CHARM_ANCHOR_X, y: PHONE_CHARM_ANCHOR_Y };
const sliderProgress = 0.34;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let state = createPhoneCharmMotionState();
let drive: PhoneCharmMotionDrive = { velocityX: 0, velocityY: 0, active: false };
let lastMotionAtMs = Number.NEGATIVE_INFINITY;
let lastFrameAtMs = performance.now();
let animationFrameId: number | null = null;

function isWindowMotion(value: unknown): value is PhoneCharmWindowMotion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<PhoneCharmWindowMotion>;
  return Number.isFinite(candidate.velocityX) &&
    Number.isFinite(candidate.velocityY) &&
    Number.isFinite(candidate.timestampMs);
}

function renderCharm(): void {
  const angle = PHONE_CHARM_BASE_ANGLE_RAD + state.angleRad;
  const length = PHONE_CHARM_ROPE_LENGTH + state.stretchPx;
  const endX = anchor.x + Math.sin(angle) * length;
  const endY = anchor.y + Math.cos(angle) * length;
  const bendX = anchor.x + ((endX - anchor.x) * 0.34) - (state.angularVelocity * 4.5);
  const bendY = anchor.y + ((endY - anchor.y) * 0.52);

  cord.setAttribute("d", `M ${anchor.x} ${anchor.y} Q ${bendX.toFixed(2)} ${bendY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`);

  const inverseProgress = 1 - sliderProgress;
  const sliderX = (inverseProgress * inverseProgress * anchor.x) +
    (2 * inverseProgress * sliderProgress * bendX) +
    (sliderProgress * sliderProgress * endX);
  const sliderY = (inverseProgress * inverseProgress * anchor.y) +
    (2 * inverseProgress * sliderProgress * bendY) +
    (sliderProgress * sliderProgress * endY);
  const tangentX = (2 * inverseProgress * (bendX - anchor.x)) +
    (2 * sliderProgress * (endX - bendX));
  const tangentY = (2 * inverseProgress * (bendY - anchor.y)) +
    (2 * sliderProgress * (endY - bendY));
  const sliderRotation = (Math.atan2(tangentY, tangentX) * 180 / Math.PI) - 90;
  slider.setAttribute(
    "transform",
    `translate(${sliderX.toFixed(2)} ${sliderY.toFixed(2)}) rotate(${sliderRotation.toFixed(2)})`
  );

  const pendantRotation = state.angleRad * 180 / Math.PI * 0.55;
  pendant.setAttribute(
    "transform",
    `translate(${endX.toFixed(2)} ${endY.toFixed(2)}) rotate(${pendantRotation.toFixed(2)})`
  );
}

function requestMotionFrame(): void {
  if (animationFrameId === null) {
    lastFrameAtMs = performance.now();
    animationFrameId = window.requestAnimationFrame(updateMotion);
  }
}

function updateMotion(nowMs: number): void {
  animationFrameId = null;

  if (reducedMotion.matches) {
    state = createPhoneCharmMotionState();
    drive = { velocityX: 0, velocityY: 0, active: false };
    renderCharm();
    return;
  }

  drive.active = nowMs - lastMotionAtMs <= 90;
  state = stepPhoneCharmMotion(state, drive, nowMs - lastFrameAtMs);
  lastFrameAtMs = nowMs;
  renderCharm();

  if (drive.active || !isPhoneCharmMotionSettled(state)) {
    animationFrameId = window.requestAnimationFrame(updateMotion);
  }
}

window.phoneCharmApi?.onWindowMotion((motion) => {
  if (!isWindowMotion(motion) || reducedMotion.matches) {
    return;
  }

  drive = {
    velocityX: motion.velocityX,
    velocityY: motion.velocityY,
    active: true
  };
  lastMotionAtMs = performance.now();
  requestMotionFrame();
});

reducedMotion.addEventListener("change", () => {
  state = createPhoneCharmMotionState();
  drive = { velocityX: 0, velocityY: 0, active: false };
  renderCharm();
  if (!reducedMotion.matches) {
    requestMotionFrame();
  }
});

renderCharm();
