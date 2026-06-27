import type { CubismUserModel } from "./vendor/framework/model/cubismusermodel";
import type { EmotionPresentation } from "../../../shared/emotion-presentation";
import type { PresenceModeId } from "../../../shared/presence-mode";

export type Model3Json = {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
  };
};

export type LoadedLive2DModel = {
  userModel: CubismUserModel;
  update(deltaSeconds: number): Live2DUpdateSample;
  setEmotionPresentation(presentation: EmotionPresentation): Promise<void>;
  setExpression(name: string): Promise<void>;
  clearExpression(): void;
  getAvailableExpressions(): string[];
  applyTemporaryPartOpacities(partIds: readonly string[], opacity: number): void;
  restoreTemporaryPartOpacities(): void;
  setLookTarget(x: number, y: number): void;
  setLookPaused(paused: boolean): void;
  startDragPhysics(): void;
  sampleDragPhysics(deltaX: number, deltaY: number, timestampMs: number): void;
  endDragPhysics(): void;
  release(): void;
};

export type Live2DRenderer = {
  start(): void;
  resize(width: number, height: number): void;
  boostInteraction(durationMs?: number): void;
  setVisible(isVisible: boolean): void;
  setPresenceMode(modeId: PresenceModeId): void;
  stop(): void;
  release(): void;
};

export type Live2DUpdateSample = {
  live2DUpdates: number;
  physicsUpdates: number;
  breathUpdates: number;
};

export type Live2DFrameSample = {
  canvasWidth: number;
  canvasHeight: number;
  nonTransparentPixels: number;
  opaqueBlackPixels: number;
};

export const WITCH_MODEL3_URL = "pet-model://witch/%E9%AD%94%E5%A5%B3.model3.json";
