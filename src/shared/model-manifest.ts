import type { EmotionTag } from "./emotion";

export type ModelManifest = {
  id: string;
  displayName: string;
  usage: string;
  sourceDir: string;
  model3: string;
  moc3: string;
  physics: string;
  displayInfo: string;
  idleMotion: string;
  textures: string[];
  expressions: ModelExpressionMap;
  emotionMap: ModelEmotionMap;
  hitAreas: ModelHitAreas;
  capabilities: ModelCapabilities;
  performanceNotes: ModelPerformanceNotes;
};

export type ModelExpressionMap = Record<string, string>;

export type ModelEmotionMap = Record<EmotionTag, string | null>;

export type ModelHitAreas = Record<string, ModelHitArea>;

export type ModelHitArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ModelTextureInfo = {
  path: string;
  width: number;
  height: number;
};

export type ModelCapabilities = {
  hasPhysics: boolean;
  hasDisplayInfo: boolean;
  hasIdleMotion: boolean;
  hasExpressions: boolean;
  hasModelHitAreas: boolean;
  usesProjectSideHitAreas: boolean;
};

export type ModelPerformanceNotes = {
  textureCount: number;
  textureSizes: ModelTextureInfo[];
  note: string;
};
