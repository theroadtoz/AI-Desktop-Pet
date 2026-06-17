export type PetWindowCommand =
  | { type: "pet:first-frame" }
  | { type: "pet:health"; payload: RenderHealth }
  | { type: "pet:pointer-hit-change"; payload: PetPointerHitState }
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
};

export type PetPointerHitState = {
  isHit: boolean;
};

export type PetDragDelta = {
  deltaX: number;
  deltaY: number;
};

export type PetApi = {
  reportFirstFrame(): void;
  reportRenderHealth(state: RenderHealth): void;
  setPointerHit(isHit: boolean): void;
  openChat(): void;
  startDrag(): void;
  moveDrag(delta: PetDragDelta): void;
  endDrag(): void;
};

export type ChatApi = {
  focusInput(): void;
};
