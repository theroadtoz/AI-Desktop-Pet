import type { EmotionTag } from "./emotion";

export type PetWindowCommand =
  | { type: "pet:first-frame"; payload?: PetFirstFrameInfo }
  | { type: "pet:health"; payload: RenderHealth }
  | { type: "pet:telemetry"; payload: PetTelemetryEvent }
  | { type: "pet:pointer-hit-change"; payload: PetPointerHitState }
  | { type: "pet:apply-emotion"; payload: EmotionTag }
  | { type: "pet:inject-webgl-context-loss" }
  | { type: "pet:open-chat" }
  | { type: "pet:drag-start" }
  | { type: "pet:drag-move"; payload: PetDragDelta }
  | { type: "pet:drag-end" };

export type ChatWindowCommand =
  | { type: "chat:focus-input" };

export type RenderHealth = {
  framesPerSecond: number;
  isContextLost: boolean;
  timestamp: number;
  renderer?: "live2d" | "placeholder";
  message?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  nonTransparentPixels?: number;
  opaqueBlackPixels?: number;
  firstFrameMs?: number;
  renderStartMs?: number;
  recoveryCount?: number;
};

export type PetFirstFrameInfo = {
  firstFrameMs: number;
  renderStartMs: number;
  renderer: "live2d" | "placeholder";
  recoveryCount: number;
};

export type PetTelemetryEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

export type PetPointerHitState = {
  isHit: boolean;
};

export type PetDragDelta = {
  deltaX: number;
  deltaY: number;
};

export type PetApi = {
  reportFirstFrame(info: PetFirstFrameInfo): void;
  reportRenderHealth(state: RenderHealth): void;
  reportTelemetry(type: string, payload?: Record<string, unknown>): void;
  setPointerHit(isHit: boolean): void;
  onApplyEmotion(handler: (emotion: EmotionTag) => void): () => void;
  onInjectWebGLContextLoss(handler: () => void): () => void;
  openChat(): void;
  startDrag(): void;
  moveDrag(delta: PetDragDelta): void;
  endDrag(): void;
};

export type ChatApi = {
  focusInput(): void;
  reportReplyEmotion(emotion: EmotionTag): void;
};
