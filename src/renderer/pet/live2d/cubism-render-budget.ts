export type CubismRenderMode = "active" | "idle" | "background";

export type CubismRenderBudgetInput = {
  nowMs: number;
  lastRenderMs: number;
  isVisible: boolean;
  interactionBoostUntilMs: number;
};

export type CubismRenderBudget = {
  mode: CubismRenderMode;
  targetFramesPerSecond: number;
  shouldRender: boolean;
};

const ACTIVE_FPS = 60;
const IDLE_FPS = 30;
const BACKGROUND_FPS = 2;

function frameIntervalMs(framesPerSecond: number): number {
  return 1000 / framesPerSecond;
}

export function getCubismRenderBudget(input: CubismRenderBudgetInput): CubismRenderBudget {
  const isActive = input.nowMs <= input.interactionBoostUntilMs;
  const mode: CubismRenderMode = input.isVisible ? (isActive ? "active" : "idle") : "background";
  const targetFramesPerSecond = mode === "active"
    ? ACTIVE_FPS
    : mode === "idle"
      ? IDLE_FPS
      : BACKGROUND_FPS;
  const elapsedMs = input.nowMs - input.lastRenderMs;

  return {
    mode,
    targetFramesPerSecond,
    shouldRender: input.lastRenderMs === 0 || elapsedMs >= frameIntervalMs(targetFramesPerSecond)
  };
}

