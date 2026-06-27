import type { PresenceModeId } from "../../../shared/presence-mode";

export type CubismRenderMode = "active" | "idle" | "background";

export type CubismRenderBudgetInput = {
  nowMs: number;
  lastRenderMs: number;
  isVisible: boolean;
  interactionBoostUntilMs: number;
  presenceModeId?: PresenceModeId;
};

export type CubismRenderBudget = {
  mode: CubismRenderMode;
  targetFramesPerSecond: number;
  shouldRender: boolean;
};

const PRESENCE_RENDER_BUDGET_FPS: Readonly<Record<PresenceModeId, Readonly<Record<CubismRenderMode, number>>>> = {
  default: {
    active: 60,
    idle: 30,
    background: 2
  },
  focus: {
    active: 60,
    idle: 24,
    background: 2
  },
  quiet: {
    active: 45,
    idle: 20,
    background: 2
  },
  sleep: {
    active: 30,
    idle: 12,
    background: 2
  }
};
const DEFAULT_RENDER_PRESENCE_MODE_ID: PresenceModeId = "default";

function frameIntervalMs(framesPerSecond: number): number {
  return 1000 / framesPerSecond;
}

export function getCubismRenderBudget(input: CubismRenderBudgetInput): CubismRenderBudget {
  const isActive = input.nowMs <= input.interactionBoostUntilMs;
  const mode: CubismRenderMode = input.isVisible ? (isActive ? "active" : "idle") : "background";
  const presenceModeId = input.presenceModeId ?? DEFAULT_RENDER_PRESENCE_MODE_ID;
  const targetFramesPerSecond = PRESENCE_RENDER_BUDGET_FPS[presenceModeId][mode];
  const elapsedMs = input.nowMs - input.lastRenderMs;

  return {
    mode,
    targetFramesPerSecond,
    shouldRender: input.lastRenderMs === 0 || elapsedMs >= frameIntervalMs(targetFramesPerSecond)
  };
}
