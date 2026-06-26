export type WindowMotionDetectorInput = {
  deltaX: number;
  deltaY: number;
  nowMs: number;
  isLocked: boolean;
  isDragging: boolean;
  isScaleGestureActive: boolean;
  isChatInteractionActive: boolean;
};

export type WindowMotionTelemetryCandidate = {
  eventType: "window_shake_candidate" | "window_move_observed";
  reason: "drag_direction_changes" | "fast_linear_drag";
  directionChanges: number;
  distancePx: number;
  durationMs: number;
  cooldownState: "available" | "cooling_down";
  isLocked: boolean;
  isDragging: boolean;
};

export type WindowMotionDetectorOptions = {
  sampleWindowMs?: number;
  minDurationMs?: number;
  minShakeDistancePx?: number;
  minTurnAxisDistancePx?: number;
  minDirectionChanges?: number;
  maxShakeNetDistanceRatio?: number;
  fastMoveMaxDurationMs?: number;
  fastMoveMinDistancePx?: number;
  fastMoveMinNetDistanceRatio?: number;
  fastMoveMaxDirectionChanges?: number;
  cooldownMs?: number;
  sampleGapResetMs?: number;
};

type Axis = "x" | "y";
type Direction = -1 | 1;

type MotionState = {
  startTimeMs: number | null;
  lastEventAtMs: number | null;
  distancePx: number;
  netX: number;
  netY: number;
  directionChanges: number;
  lastAxis: Axis | null;
  lastDirection: Direction | null;
  axisDistanceSinceTurn: number;
};

const DEFAULT_OPTIONS = {
  sampleWindowMs: 700,
  minDurationMs: 240,
  minShakeDistancePx: 260,
  minTurnAxisDistancePx: 35,
  minDirectionChanges: 4,
  maxShakeNetDistanceRatio: 0.55,
  fastMoveMaxDurationMs: 900,
  fastMoveMinDistancePx: 700,
  fastMoveMinNetDistanceRatio: 0.78,
  fastMoveMaxDirectionChanges: 2,
  cooldownMs: 8_000,
  sampleGapResetMs: 180
} satisfies Required<WindowMotionDetectorOptions>;

function createEmptyState(): MotionState {
  return {
    startTimeMs: null,
    lastEventAtMs: null,
    distancePx: 0,
    netX: 0,
    netY: 0,
    directionChanges: 0,
    lastAxis: null,
    lastDirection: null,
    axisDistanceSinceTurn: 0
  };
}

function isMotionAllowed(input: WindowMotionDetectorInput): boolean {
  return !input.isLocked &&
    input.isDragging &&
    !input.isScaleGestureActive &&
    !input.isChatInteractionActive &&
    Number.isFinite(input.deltaX) &&
    Number.isFinite(input.deltaY) &&
    Number.isFinite(input.nowMs);
}

export function createWindowMotionDetector(options: WindowMotionDetectorOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let state = createEmptyState();
  let lastTelemetryAtMs: number | null = null;

  function reset(): void {
    state = createEmptyState();
  }

  function observe(input: WindowMotionDetectorInput): WindowMotionTelemetryCandidate | null {
    if (!isMotionAllowed(input)) {
      reset();
      return null;
    }

    if (
      state.lastEventAtMs !== null &&
      input.nowMs - state.lastEventAtMs > config.sampleGapResetMs
    ) {
      reset();
    }

    const stepDistance = Math.hypot(input.deltaX, input.deltaY);

    if (stepDistance < 2) {
      state.lastEventAtMs = input.nowMs;
      return null;
    }

    if (state.startTimeMs === null) {
      state.startTimeMs = input.nowMs;
    }

    state.lastEventAtMs = input.nowMs;
    state.distancePx += stepDistance;
    state.netX += input.deltaX;
    state.netY += input.deltaY;

    const axis: Axis = Math.abs(input.deltaX) >= Math.abs(input.deltaY) ? "x" : "y";
    const axisDelta = axis === "x" ? input.deltaX : input.deltaY;
    const direction: Direction = axisDelta >= 0 ? 1 : -1;

    if (
      state.lastAxis === axis &&
      state.lastDirection !== null &&
      state.lastDirection !== direction &&
      state.axisDistanceSinceTurn >= config.minTurnAxisDistancePx
    ) {
      state.directionChanges += 1;
      state.axisDistanceSinceTurn = 0;
    }

    state.lastAxis = axis;
    state.lastDirection = direction;
    state.axisDistanceSinceTurn += Math.abs(axisDelta);

    const durationMs = input.nowMs - state.startTimeMs;
    const netDistance = Math.hypot(state.netX, state.netY);
    const isCoolingDown = lastTelemetryAtMs !== null && input.nowMs - lastTelemetryAtMs < config.cooldownMs;

    if (durationMs > config.sampleWindowMs) {
      reset();
      return null;
    }

    const baseCandidate = {
      directionChanges: state.directionChanges,
      distancePx: Math.round(state.distancePx),
      durationMs: Math.round(durationMs),
      cooldownState: isCoolingDown ? "cooling_down" : "available",
      isLocked: input.isLocked,
      isDragging: input.isDragging
    } as const;

    const shakeCandidate = durationMs >= config.minDurationMs &&
      state.distancePx >= config.minShakeDistancePx &&
      state.directionChanges >= config.minDirectionChanges &&
      netDistance <= state.distancePx * config.maxShakeNetDistanceRatio;

    if (shakeCandidate) {
      reset();
      if (isCoolingDown) {
        return null;
      }
      lastTelemetryAtMs = input.nowMs;
      return {
        ...baseCandidate,
        eventType: "window_shake_candidate",
        reason: "drag_direction_changes"
      };
    }

    const fastMoveCandidate = durationMs <= config.fastMoveMaxDurationMs &&
      state.distancePx >= config.fastMoveMinDistancePx &&
      netDistance >= state.distancePx * config.fastMoveMinNetDistanceRatio &&
      state.directionChanges <= config.fastMoveMaxDirectionChanges;

    if (fastMoveCandidate) {
      reset();
      if (isCoolingDown) {
        return null;
      }
      lastTelemetryAtMs = input.nowMs;
      return {
        ...baseCandidate,
        eventType: "window_move_observed",
        reason: "fast_linear_drag"
      };
    }

    return null;
  }

  return {
    observe,
    reset
  };
}
