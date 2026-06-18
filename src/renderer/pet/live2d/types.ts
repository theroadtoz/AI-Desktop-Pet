import type { CubismUserModel } from "./vendor/framework/model/cubismusermodel";
import type { EmotionTag } from "../../../shared/emotion";

export type Model3Json = {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
  };
};

export type LoadedLive2DModel = {
  userModel: CubismUserModel;
  update(deltaSeconds: number): void;
  setExpression(emotion: EmotionTag): Promise<void>;
  clearExpression(): void;
  getAvailableExpressions(): string[];
  setLookTarget(x: number, y: number): void;
  setLookPaused(paused: boolean): void;
  release(): void;
};

export type Live2DRenderer = {
  start(): void;
  stop(): void;
  release(): void;
};

export type Live2DFrameSample = {
  canvasWidth: number;
  canvasHeight: number;
  nonTransparentPixels: number;
  opaqueBlackPixels: number;
};

export const WITCH_MODEL3_URL = "pet-model://witch/%E9%AD%94%E5%A5%B3.model3.json";
