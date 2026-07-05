import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  PET_EXPRESSION_PRESET_CATALOG,
  type PetExpressionPresetCategory,
  type PetExpressionPresetIntensity,
  type PetExpressionPresetRestorePolicy,
  type PetExpressionPresetVisualRisk
} from "../src/shared/interaction-action-catalog.ts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "resources/models/witch/model-manifest.json";
const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "confused"] as const;
const VALID_BLENDS = new Set(["Add", "Multiply", "Overwrite"]);

export type ExpressionUsage = "micro-candidate" | "emphasis-candidate" | "manual-only" | "needs-visual-review";
export type ExpressionCategory = "emotion" | "prop-or-costume" | "gesture-or-action" | "needs-visual-review";

type JsonRecord = Record<string, unknown>;

type Manifest = JsonRecord & {
  sourceDir: string;
  model3: string;
  displayInfo: string;
  expressions: Record<string, string>;
  emotionMap: Record<(typeof EMOTIONS)[number], string | null>;
};

type ExpressionParameter = {
  id: string;
  value: number;
  blend: "Add" | "Multiply" | "Overwrite";
};

export type ExpressionAuditEntry = {
  name: string;
  path: string;
  mappedEmotions: string[];
  parameters: ExpressionParameter[];
  fadeInTime: number | null;
  fadeOutTime: number | null;
  category: ExpressionCategory;
  suggestedUsage: ExpressionUsage;
  classificationBasis: "static-inference";
  evidence: string[];
  visualReviewRequired: true;
};

export type ExpressionPresetAuditEntry = {
  expressionName: string;
  category: PetExpressionPresetCategory;
  intensity: PetExpressionPresetIntensity;
  allowedPresenceModes: string[];
  allowedDialogueModes: string[];
  suggestedActionTypes: string[];
  visualRisk: PetExpressionPresetVisualRisk;
  restorePolicy: PetExpressionPresetRestorePolicy;
};

export type ExpressionAuditResult = {
  auditVersion: 1;
  manifestPath: string;
  model3Path: string;
  displayInfoPath: string;
  expressionAssetCount: number;
  mappedEmotionCount: number;
  entries: ExpressionAuditEntry[];
  expressionPresets: ExpressionPresetAuditEntry[];
  microExpressionParameterCandidates: Array<{
    id: string;
    name: string;
    reason: string;
    classificationBasis: "static-inference";
    visualReviewRequired: true;
  }>;
};

type Classification = Pick<ExpressionAuditEntry, "category" | "suggestedUsage" | "evidence">;

const CLASSIFICATIONS: Record<string, Classification> = {
  dark: {
    category: "needs-visual-review",
    suggestedUsage: "needs-visual-review",
    evidence: ["资源名 dark / 参数名 h 未提供可验证的面部语义"]
  },
  staff: {
    category: "prop-or-costume",
    suggestedUsage: "manual-only",
    evidence: ["资源名 staff", "CDI3 中存在“法杖”部件"]
  },
  ghost: {
    category: "prop-or-costume",
    suggestedUsage: "manual-only",
    evidence: ["资源名 ghost", "CDI3 中存在“小幽灵”部件"]
  },
  angry: {
    category: "emotion",
    suggestedUsage: "emphasis-candidate",
    evidence: ["资源名 angry", "参数包含眉形与眉上下"]
  },
  hat: {
    category: "prop-or-costume",
    suggestedUsage: "manual-only",
    evidence: ["资源名 hat", "CDI3 中存在帽子部件"]
  },
  sad: {
    category: "emotion",
    suggestedUsage: "emphasis-candidate",
    evidence: ["资源名 sad", "参数包含眉形与眉上下", "CDI3 中存在泪眼部件"]
  },
  bow: {
    category: "gesture-or-action",
    suggestedUsage: "manual-only",
    evidence: ["资源名 bow / 参数名 hdj 缺少可验证的情绪语义", "CDI3 中存在手部动作部件"]
  },
  glasses: {
    category: "prop-or-costume",
    suggestedUsage: "manual-only",
    evidence: ["资源名 glasses", "CDI3 中存在眼镜部件"]
  },
  excited: {
    category: "emotion",
    suggestedUsage: "emphasis-candidate",
    evidence: ["资源名 excited", "参数关联星星/心"]
  },
  happy: {
    category: "emotion",
    suggestedUsage: "emphasis-candidate",
    evidence: ["资源名 happy", "参数关联星星/心"]
  },
  gestureGame: {
    category: "gesture-or-action",
    suggestedUsage: "manual-only",
    evidence: ["资源名 gestureGame", "参数名 zs1/zs2，需 UI 走查确认具体手势"]
  },
  gestureMic: {
    category: "gesture-or-action",
    suggestedUsage: "manual-only",
    evidence: ["资源名 gestureMic", "CDI3 中存在麦克风和手部部件"]
  }
};

function readJson(path: string): JsonRecord {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  } catch (error) {
    throw new Error(`无法解析 JSON：${path}`, { cause: error });
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as JsonRecord;
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function validateFade(value: unknown, label: string): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须是非负有限数值`);
  }
  return value;
}

export function validateExpressionAsset(expression: JsonRecord, knownParameterIds: Iterable<string>, label: string): {
  parameters: ExpressionParameter[];
  fadeInTime: number | null;
  fadeOutTime: number | null;
} {
  const knownIds = new Set(knownParameterIds);
  if (!Array.isArray(expression.Parameters) || expression.Parameters.length === 0) {
    throw new Error(`${label}.Parameters 必须是非空数组`);
  }

  const parameters = expression.Parameters.map((item, index) => {
    const parameter = requireRecord(item, `${label}.Parameters[${index}]`);
    const id = requireString(parameter.Id, `${label}.Parameters[${index}].Id`);
    const value = parameter.Value;
    const blend = parameter.Blend ?? "Add";

    if (!knownIds.has(id)) {
      throw new Error(`${label} 使用了 CDI3 中不存在的参数：${id}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${label}.Parameters[${index}].Value 必须是有限数值`);
    }
    if (typeof blend !== "string" || !VALID_BLENDS.has(blend)) {
      throw new Error(`${label}.Parameters[${index}].Blend 非法：${String(blend)}`);
    }

    return { id, value, blend: blend as ExpressionParameter["blend"] };
  });

  return {
    parameters,
    fadeInTime: validateFade(expression.FadeInTime, `${label}.FadeInTime`),
    fadeOutTime: validateFade(expression.FadeOutTime, `${label}.FadeOutTime`)
  };
}

function getCdiParameters(displayInfo: JsonRecord): Map<string, string> {
  if (!Array.isArray(displayInfo.Parameters)) {
    throw new Error("CDI3.Parameters 必须是数组");
  }

  return new Map(displayInfo.Parameters.map((item, index) => {
    const parameter = requireRecord(item, `CDI3.Parameters[${index}]`);
    return [requireString(parameter.Id, `CDI3.Parameters[${index}].Id`), requireString(parameter.Name, `CDI3.Parameters[${index}].Name`)];
  }));
}

function validateModel3(model3: JsonRecord, model3Path: string): void {
  const fileReferences = requireRecord(model3.FileReferences, "model3.FileReferences");
  const modelDirectory = dirname(model3Path);
  const filePaths = [
    requireString(fileReferences.Moc, "model3.FileReferences.Moc"),
    requireString(fileReferences.DisplayInfo, "model3.FileReferences.DisplayInfo"),
    requireString(fileReferences.Physics, "model3.FileReferences.Physics")
  ];

  if (!Array.isArray(fileReferences.Textures) || fileReferences.Textures.some((texture) => typeof texture !== "string")) {
    throw new Error("model3.FileReferences.Textures 必须是字符串数组");
  }

  filePaths.push(...fileReferences.Textures);
  for (const filePath of filePaths) {
    if (!existsSync(resolve(modelDirectory, filePath))) {
      throw new Error(`model3 引用的文件不存在：${filePath}`);
    }
  }
}

export function auditWitchExpressionAssets(repositoryRoot = REPOSITORY_ROOT): ExpressionAuditResult {
  const manifestPath = resolve(repositoryRoot, MANIFEST_PATH);
  const manifest = readJson(manifestPath) as Manifest;
  const modelDirectory = resolve(dirname(manifestPath), requireString(manifest.sourceDir, "manifest.sourceDir"));
  const model3Path = resolve(modelDirectory, requireString(manifest.model3, "manifest.model3"));
  const displayInfoPath = resolve(modelDirectory, requireString(manifest.displayInfo, "manifest.displayInfo"));

  if (!existsSync(modelDirectory) || !existsSync(model3Path) || !existsSync(displayInfoPath)) {
    throw new Error("manifest 指向的模型目录、model3 或 CDI3 文件不存在");
  }

  validateModel3(readJson(model3Path), model3Path);
  const cdiParameters = getCdiParameters(readJson(displayInfoPath));
  const expressions = requireRecord(manifest.expressions, "manifest.expressions") as Record<string, string>;
  const emotionMap = requireRecord(manifest.emotionMap, "manifest.emotionMap") as Manifest["emotionMap"];

  for (const emotion of EMOTIONS) {
    if (!(emotion in emotionMap)) {
      throw new Error(`emotionMap 缺少聊天情绪：${emotion}`);
    }
    const expressionName = emotionMap[emotion];
    if (expressionName !== null && !(expressionName in expressions)) {
      throw new Error(`emotionMap.${emotion} 引用了不存在的表达式：${expressionName}`);
    }
  }

  const manifestExpressionPaths = new Set(Object.values(expressions));
  const entries = Object.entries(expressions).map(([name, expressionPath]) => {
    const classification = CLASSIFICATIONS[name];
    if (!classification) {
      throw new Error(`表达式 ${name} 未配置静态审计分类`);
    }

    const assetPath = resolve(modelDirectory, requireString(expressionPath, `manifest.expressions.${name}`));
    if (!assetPath.endsWith(".exp3.json") || !existsSync(assetPath)) {
      throw new Error(`manifest.expressions.${name} 指向的表达式文件不存在：${expressionPath}`);
    }

    const expression = validateExpressionAsset(readJson(assetPath), cdiParameters.keys(), expressionPath);
    const mappedEmotions = EMOTIONS.filter((emotion) => emotionMap[emotion] === name);
    return {
      name,
      path: relativePath(repositoryRoot, assetPath),
      mappedEmotions: [...mappedEmotions],
      parameters: expression.parameters,
      fadeInTime: expression.fadeInTime,
      fadeOutTime: expression.fadeOutTime,
      ...classification,
      classificationBasis: "static-inference" as const,
      visualReviewRequired: true as const
    };
  });

  const physicalExpressionPaths = new Set(
    [...manifestExpressionPaths].map((expressionPath) => relativePath(repositoryRoot, resolve(modelDirectory, expressionPath)))
  );
  if (entries.some((entry) => !physicalExpressionPaths.has(entry.path))) {
    throw new Error("表达式审计条目与 manifest 路径不一致");
  }

  const expressionPresets = Object.values(PET_EXPRESSION_PRESET_CATALOG).map((preset) => {
    if (!(preset.expressionName in expressions)) {
      throw new Error(`expression preset 引用了不存在的表达式：${preset.expressionName}`);
    }

    return {
      expressionName: preset.expressionName,
      category: preset.category,
      intensity: preset.intensity,
      allowedPresenceModes: [...preset.allowedPresenceModes],
      allowedDialogueModes: [...preset.allowedDialogueModes],
      suggestedActionTypes: [...preset.suggestedActionTypes],
      visualRisk: preset.visualRisk,
      restorePolicy: preset.restorePolicy
    };
  });

  return {
    auditVersion: 1,
    manifestPath: relativePath(repositoryRoot, manifestPath),
    model3Path: relativePath(repositoryRoot, model3Path),
    displayInfoPath: relativePath(repositoryRoot, displayInfoPath),
    expressionAssetCount: entries.length,
    mappedEmotionCount: EMOTIONS.length,
    entries,
    expressionPresets,
    microExpressionParameterCandidates: [
      {
        id: "ParamEyeLSmile",
        name: cdiParameters.get("ParamEyeLSmile") ?? "",
        reason: "CDI3 标注为左眼微笑；仅可作为后续低幅度、可逆微表情候选。",
        classificationBasis: "static-inference",
        visualReviewRequired: true
      },
      {
        id: "ParamEyeRSmile",
        name: cdiParameters.get("ParamEyeRSmile") ?? "",
        reason: "CDI3 标注为右眼微笑；仅可作为后续低幅度、可逆微表情候选。",
        classificationBasis: "static-inference",
        visualReviewRequired: true
      },
      {
        id: "ParamBrowLY",
        name: cdiParameters.get("ParamBrowLY") ?? "",
        reason: "CDI3 标注为眉上下；当前强调表情已使用，后续仅能以更低幅度单独评估。",
        classificationBasis: "static-inference",
        visualReviewRequired: true
      }
    ]
  };
}
