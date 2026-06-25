const WHEEL_DELTA_PER_STEP = 100;
const WHEEL_LINE_HEIGHT_PX = 40;
const INPUT_IDLE_RESET_MS = 180;
const STEP_THROTTLE_MS = 60;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

export type ScaleWheelInput = {
  deltaY: number;
  deltaMode: number;
  viewportHeight: number;
  timestamp: number;
};

export function hasScaleWheelModifiers(event: Pick<WheelEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): boolean {
  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
}

export function createScaleWheelNormalizer(): { push(input: ScaleWheelInput): -1 | 0 | 1; reset(): void } {
  let accumulatedDelta = 0;
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let lastStepAt = Number.NEGATIVE_INFINITY;

  function reset(): void {
    accumulatedDelta = 0;
    lastInputAt = Number.NEGATIVE_INFINITY;
    lastStepAt = Number.NEGATIVE_INFINITY;
  }

  return {
    push({ deltaY, deltaMode, viewportHeight, timestamp }) {
      if (!Number.isFinite(deltaY) || deltaY === 0 || !Number.isFinite(timestamp)) {
        return 0;
      }

      if (timestamp - lastInputAt > INPUT_IDLE_RESET_MS || accumulatedDelta * deltaY < 0) {
        accumulatedDelta = 0;
      }

      lastInputAt = timestamp;
      accumulatedDelta += normalizeDelta(deltaY, deltaMode, viewportHeight);

      if (timestamp - lastStepAt < STEP_THROTTLE_MS || Math.abs(accumulatedDelta) < WHEEL_DELTA_PER_STEP) {
        return 0;
      }

      const step = accumulatedDelta < 0 ? 1 : -1;
      accumulatedDelta -= Math.sign(accumulatedDelta) * WHEEL_DELTA_PER_STEP;
      lastStepAt = timestamp;
      return step;
    },
    reset
  };
}

function normalizeDelta(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === DOM_DELTA_LINE) {
    return deltaY * WHEEL_LINE_HEIGHT_PX;
  }

  if (deltaMode === DOM_DELTA_PAGE) {
    return deltaY * Math.max(viewportHeight, WHEEL_DELTA_PER_STEP);
  }

  return deltaY;
}
