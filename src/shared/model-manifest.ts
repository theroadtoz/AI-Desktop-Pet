import type { EmotionTag } from "./emotion";
import type { DialogueModeId } from "./dialogue-style";
import type { PresenceModeId } from "./presence-mode";

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
  motionPresets?: ModelMotionPreset[];
  textures: string[];
  expressions: ModelExpressionMap;
  emotionMap: ModelEmotionMap;
  hitAreas: ModelHitAreas;
  capabilities: ModelCapabilities;
  performanceNotes: ModelPerformanceNotes;
};

export type ModelExpressionMap = Record<string, string>;

export type ModelEmotionMap = Record<EmotionTag, string | null>;

export type ModelMotionSemanticKind =
  | "idle"
  | "greeting"
  | "reaction"
  | "thinking"
  | "reading"
  | "game"
  | "sleep"
  | "transition";

export type ModelMotionRestorePolicy =
  | "restore-expression-pose-accessory"
  | "restore-current-state";

export type ModelMotionVisualRisk = "low" | "medium" | "needs-visual-check";
export type ModelMotionAssetLicenseStatus =
  | "project-owned"
  | "user-provided"
  | "official-sample-reference-only"
  | "blocked-missing-license";

export type ModelMotionPreset = {
  id: string;
  path: string;
  semanticKind: ModelMotionSemanticKind;
  loop: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  durationHintSeconds: number;
  priority: number;
  cooldownMs: number;
  restorePolicy: ModelMotionRestorePolicy;
  allowedStates: string[];
  allowedPresenceModes: PresenceModeId[];
  allowedDialogueModes: DialogueModeId[];
  visualRisk: ModelMotionVisualRisk;
  assetLicenseStatus: ModelMotionAssetLicenseStatus;
};

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
