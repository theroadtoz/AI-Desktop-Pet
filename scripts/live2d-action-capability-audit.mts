import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { PET_INTERACTION_ACTION_TYPES, type PetInteractionActionType } from "../src/renderer/pet/interaction-actions.ts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "resources/models/witch/model-manifest.json";

type JsonRecord = Record<string, unknown>;
type SupportLevel = "native-motion" | "expression-parameter-composition" | "accessory-enhanced" | "placeholder-required";

type Manifest = {
  sourceDir: string;
  model3: string;
  displayInfo: string;
  idleMotion: string;
  expressions: Record<string, string>;
  hitAreas: Record<string, { x: number; y: number; width: number; height: number }>;
};

type NamedReference = {
  name: string;
  path?: string;
  id?: string;
  evidence: string;
};

export type ActionCapabilityEntry = {
  action: PetInteractionActionType;
  supportLevel: SupportLevel;
  nativeMotions: NamedReference[];
  expressions: NamedReference[];
  parameters: NamedReference[];
  parts: NamedReference[];
  hitAreas: NamedReference[];
  implementationRecommendation: string;
  risk: string;
};

export type ActionCapabilityAuditResult = {
  auditVersion: 1;
  manifestPath: string;
  model3Path: string;
  displayInfoPath: string;
  model3DeclaredMotionGroups: string[];
  physicalMotionFiles: string[];
  idleMotion: {
    path: string;
    loop: boolean;
    durationSeconds: number;
    parameterIds: string[];
  };
  expressionNames: string[];
  targetActions: ActionCapabilityEntry[];
};

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
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

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数值`);
  }

  return value;
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function listFilesByExtension(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return listFilesByExtension(path, extension);
    }

    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

function readCdiEntries(displayInfo: JsonRecord, key: "Parameters" | "Parts"): Map<string, string> {
  const entries = displayInfo[key];

  if (!Array.isArray(entries)) {
    throw new Error(`CDI3.${key} 必须是数组`);
  }

  return new Map(entries.map((item, index) => {
    const entry = requireRecord(item, `CDI3.${key}[${index}]`);
    return [
      requireString(entry.Id, `CDI3.${key}[${index}].Id`),
      requireString(entry.Name, `CDI3.${key}[${index}].Name`)
    ];
  }));
}

function expressionReference(name: string, manifest: Manifest, modelDirectory: string, repositoryRoot: string): NamedReference {
  const expressionPath = requireString(manifest.expressions[name], `manifest.expressions.${name}`);
  const absolutePath = resolve(modelDirectory, expressionPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`表达式文件不存在：${expressionPath}`);
  }

  return {
    name,
    path: relativePath(repositoryRoot, absolutePath),
    evidence: `manifest.expressions.${name}`
  };
}

function namedMatches(entries: Map<string, string>, pattern: RegExp, evidence: string): NamedReference[] {
  return [...entries.entries()]
    .filter(([, name]) => pattern.test(name))
    .map(([id, name]) => ({ id, name, evidence }));
}

function actionEntry(
  action: PetInteractionActionType,
  supportLevel: SupportLevel,
  fields: Omit<ActionCapabilityEntry, "action" | "supportLevel">
): ActionCapabilityEntry {
  return { action, supportLevel, ...fields };
}

export function auditWitchActionCapabilities(repositoryRoot = REPOSITORY_ROOT): ActionCapabilityAuditResult {
  const manifestPath = resolve(repositoryRoot, MANIFEST_PATH);
  const manifest = readJson(manifestPath) as Manifest;
  const modelDirectory = resolve(dirname(manifestPath), requireString(manifest.sourceDir, "manifest.sourceDir"));
  const model3Path = resolve(modelDirectory, requireString(manifest.model3, "manifest.model3"));
  const displayInfoPath = resolve(modelDirectory, requireString(manifest.displayInfo, "manifest.displayInfo"));
  const idleMotionPath = resolve(modelDirectory, requireString(manifest.idleMotion, "manifest.idleMotion"));
  const model3 = readJson(model3Path);
  const fileReferences = requireRecord(model3.FileReferences, "model3.FileReferences");
  const displayInfo = readJson(displayInfoPath);
  const parameters = readCdiEntries(displayInfo, "Parameters");
  const parts = readCdiEntries(displayInfo, "Parts");
  const idleMotion = readJson(idleMotionPath);
  const idleCurves = Array.isArray(idleMotion.Curves) ? idleMotion.Curves : [];
  const model3Motions = fileReferences.Motions;
  const model3DeclaredMotionGroups = model3Motions && typeof model3Motions === "object" && !Array.isArray(model3Motions)
    ? Object.keys(model3Motions as JsonRecord)
    : [];
  const physicalMotionFiles = listFilesByExtension(modelDirectory, ".motion3.json")
    .map((path) => relativePath(repositoryRoot, path))
    .sort();
  const expressionNames = Object.keys(requireRecord(manifest.expressions, "manifest.expressions")).sort();
  const idleMotionReference: NamedReference = {
    name: "idleMotion",
    path: relativePath(repositoryRoot, idleMotionPath),
    evidence: "manifest.idleMotion 是循环待机 motion，不是可直接复用的语义动作。"
  };
  const headHitArea = manifest.hitAreas.head
    ? [{
        name: "head",
        path: `${relativePath(repositoryRoot, manifestPath)}#hitAreas.head`,
        evidence: "项目侧头部命中区可用于摸头语义。"
      }]
    : [];
  const bodyHitArea = manifest.hitAreas.body
    ? [{
        name: "body",
        path: `${relativePath(repositoryRoot, manifestPath)}#hitAreas.body`,
        evidence: "项目侧身体命中区可用于普通点击语义。"
      }]
    : [];

  const glassesParts = namedMatches(parts, /眼镜/, "CDI3.Parts");
  const gameParts = namedMatches(parts, /手柄/, "CDI3.Parts");
  const micParts = namedMatches(parts, /麦克风/, "CDI3.Parts");
  const staffParts = namedMatches(parts, /法杖/, "CDI3.Parts");
  const hatParts = namedMatches(parts, /帽子/, "CDI3.Parts");
  const faceParameters = namedMatches(parameters, /眼|眉|嘴|口/, "CDI3.Parameters");
  const bodyParameters = namedMatches(parameters, /角度|身体|手|发|头/, "CDI3.Parameters");

  const targetActions = [
    actionEntry("appearance", "expression-parameter-composition", {
      nativeMotions: [idleMotionReference],
      expressions: [expressionReference("excited", manifest, modelDirectory, repositoryRoot)],
      parameters: bodyParameters.slice(0, 8),
      parts: [...staffParts, ...hatParts].slice(0, 6),
      hitAreas: bodyHitArea,
      implementationRecommendation: "V1 使用缩放/透明度缓入 + excited 表情；不要把 idle 循环当出场动作直接播放。",
      risk: "缺少独立出场 motion，真实出场感需要后续补 motion 或参数序列。"
    }),
    actionEntry("headPat", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [expressionReference("happy", manifest, modelDirectory, repositoryRoot)],
      parameters: faceParameters.slice(0, 8),
      parts: [],
      hitAreas: headHitArea,
      implementationRecommendation: "头部命中后播放 happy 表情，并叠加小幅头部/身体参数反应。",
      risk: "缺少原生摸头反应 motion；命中区为项目侧矩形，需要真实 UI 复核。"
    }),
    actionEntry("greeting", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("gestureMic", manifest, modelDirectory, repositoryRoot), expressionReference("happy", manifest, modelDirectory, repositoryRoot)],
      parameters: bodyParameters.slice(0, 8),
      parts: micParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "优先试 gestureMic/手部参数作为打招呼降级；若视觉像拿麦克风而非挥手，退回 happy + 身体轻摆。",
      risk: "当前没有明确挥手 motion，gestureMic 需要视觉验收确认语义。"
    }),
    actionEntry("thinking", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [expressionReference("dark", manifest, modelDirectory, repositoryRoot)],
      parameters: faceParameters.slice(0, 8),
      parts: glassesParts.slice(0, 2),
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用 dark/confused 微表情 + 低频视线游移；眼镜只能作为可选增强。",
      risk: "dark 的语义之前已标记需视觉复核，不能直接等同思考。"
    }),
    actionEntry("playGame", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("gestureGame", manifest, modelDirectory, repositoryRoot), expressionReference("excited", manifest, modelDirectory, repositoryRoot)],
      parameters: bodyParameters.slice(0, 8),
      parts: gameParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用 gestureGame + 手柄相关部件做玩游戏动作候选，动作结束必须恢复原状态。",
      risk: "手柄部件存在，但当前运行时还没有部件显隐状态管理。"
    }),
    actionEntry("reading", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("glasses", manifest, modelDirectory, repositoryRoot)],
      parameters: faceParameters.slice(0, 8),
      parts: glassesParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "V1 可用 glasses 表达式/眼镜部件 + 安静 neutral 表现；书本资产未发现。",
      risk: "未发现书本相关 part/expression，不能承诺完整看书语义。"
    })
  ];

  const missingActions = PET_INTERACTION_ACTION_TYPES.filter((action) => (
    !targetActions.some((entry) => entry.action === action)
  ));

  if (missingActions.length > 0) {
    throw new Error(`动作能力审计缺少目标动作：${missingActions.join(", ")}`);
  }

  return {
    auditVersion: 1,
    manifestPath: relativePath(repositoryRoot, manifestPath),
    model3Path: relativePath(repositoryRoot, model3Path),
    displayInfoPath: relativePath(repositoryRoot, displayInfoPath),
    model3DeclaredMotionGroups,
    physicalMotionFiles,
    idleMotion: {
      path: relativePath(repositoryRoot, idleMotionPath),
      loop: Boolean(requireRecord(idleMotion.Meta, "idleMotion.Meta").Loop),
      durationSeconds: requireNumber(requireRecord(idleMotion.Meta, "idleMotion.Meta").Duration, "idleMotion.Meta.Duration"),
      parameterIds: idleCurves.map((curve, index) => {
        const item = requireRecord(curve, `idleMotion.Curves[${index}]`);
        return requireString(item.Id, `idleMotion.Curves[${index}].Id`);
      })
    },
    expressionNames,
    targetActions
  };
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  process.stdout.write(`${JSON.stringify(auditWitchActionCapabilities(), null, 2)}\n`);
}
