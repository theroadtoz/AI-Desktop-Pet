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
    actionEntry("listen", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用视线/头部小幅抬起和 neutral 微表情表现倾听，不绑定新 motion。",
      risk: "只有参数层反馈，动作差异依赖真实 UI 截图和 telemetry 复核。"
    }),
    actionEntry("curiousTilt", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用低幅 look target 与 poseTarget 表现好奇侧头；不要写成原生侧头 motion。",
      risk: "单个姿态目标不是完整侧头动画，视觉语义需要真实 UI 观察确认。"
    }),
    actionEntry("softSmile", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [expressionReference("happy", manifest, modelDirectory, repositoryRoot)],
      parameters: faceParameters.slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用 happy 微表情参数做轻微开心，避免高强度强调表情常态化。",
      risk: "如果 happy 资产过强，运行时应保留微表情降级而不是强表情。"
    }),
    actionEntry("quietNod", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用短时低幅姿态变化表达听懂后的轻点头；文案与验收不得宣称原生点头 motion。",
      risk: "当前 action 模型不是多关键帧点头序列，动作幅度必须保持克制。"
    }),
    actionEntry("shySmile", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [expressionReference("happy", manifest, modelDirectory, repositoryRoot)],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用低强度 happy、侧下方视线和轻微躲闪姿态做浅笑候选；不替代 rapid_touch_combo 的 flusteredGlance。",
      risk: "happy 资产可能偏强，必须受普通 body pool 权重和 quiet/sleep 过滤约束。"
    }),
    actionEntry("lookAway", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用短时 look target 偏移表现移开视线，结束后回正。",
      risk: "没有独立害羞/走神 motion，不能承诺复杂姿态。"
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
    actionEntry("replyThinking", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [expressionReference("dark", manifest, modelDirectory, repositoryRoot)],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "复用低强度 confused 参数和短视线偏移，作为比 thinking 更短、更安静的思考变体。",
      risk: "暂不绑定聊天生成生命周期，只作为白名单语义动作可被本地权重选中。"
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
    actionEntry("gameReady", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("gestureGame", manifest, modelDirectory, repositoryRoot)],
      parameters: bodyParameters.slice(0, 8),
      parts: gameParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "复用 gestureGame/手柄部件做短促准备动作，并受强配件 cooldown 保护。",
      risk: "没有单独准备动作 motion，只能作为 playGame 的轻量变体。"
    }),
    actionEntry("gameCheerLite", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("gestureGame", manifest, modelDirectory, repositoryRoot)],
      parameters: bodyParameters.slice(0, 8),
      parts: gameParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "复用 gestureGame/手柄部件和小幅身体姿态，作为游戏模式轻庆祝候选，并受强配件 cooldown 保护。",
      risk: "gestureGame 不是庆祝 motion；只能记录为游戏配件增强的降级表现。"
    }),
    actionEntry("reading", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("glasses", manifest, modelDirectory, repositoryRoot)],
      parameters: faceParameters.slice(0, 8),
      parts: glassesParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "V1 可用 glasses 表达式/眼镜部件 + 安静 neutral 表现；书本资产未发现。",
      risk: "未发现书本相关 part/expression，不能承诺完整看书语义。"
    }),
    actionEntry("readingIdle", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("glasses", manifest, modelDirectory, repositoryRoot)],
      parameters: faceParameters.slice(0, 8),
      parts: glassesParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "复用 glasses 和低幅视线下移，作为读书模式的安静 idle 变体。",
      risk: "仍没有翻页/书本资产，必须记录为眼镜加注视的降级实现。"
    }),
    actionEntry("readingThink", "accessory-enhanced", {
      nativeMotions: [],
      expressions: [expressionReference("glasses", manifest, modelDirectory, repositoryRoot)],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: glassesParts,
      hitAreas: bodyHitArea,
      implementationRecommendation: "复用 glasses、低头视线和小幅身体姿态，作为资料/读书模式下的思考候选。",
      risk: "无书本或翻页 motion，不能宣称完整阅读动作。"
    }),
    actionEntry("focus", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: faceParameters.slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "Use a neutral low-amplitude parameter composition only; do not bind expression, part, or native motion.",
      risk: "No native focus motion or prop is available, so the visual difference may be weak and must stay documented as a fallback."
    }),
    actionEntry("workFocus", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "复用 focus 的 neutral 低幅表现，并加入短时视线稳定目标，作为工作模式偏好的专注变体。",
      risk: "与 focus 共享资产能力，视觉差异需要保持克制并靠权重区分。"
    }),
    actionEntry("doze", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: faceParameters.slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用低打扰 neutral + 视线下移表现小憩，不使用未验证闭眼 motion。",
      risk: "当前无睡眠 motion 或闭眼专用资产，只能作为低幅参数降级。"
    }),
    actionEntry("sleepySettle", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用低幅视线下移和身体收束姿态，作为安静/睡前收束候选。",
      risk: "无睡眠 motion 或闭眼资产，sleep/quiet 下必须保持低频低幅。"
    }),
    actionEntry("edgeGlance", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用短时 look target 横向偏移表现看回屏幕内侧；首版只进入白名单动作池。",
      risk: "尚未绑定窗口靠边检测，不能宣称已实现边缘触发。"
    }),
    actionEntry("flusteredGlance", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [expressionReference("happy", manifest, modelDirectory, repositoryRoot)],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用固定 rapid_touch_combo 触发低强度 surprised/happy 微表现，叠加短时侧下方视线和轻微躲闪姿态；不开放任意动作参数。",
      risk: "没有原生害羞或躲闪 motion，只能作为参数组合降级；连续触摸触发必须继续受 active action 和 cooldown 保护。"
    }),
    actionEntry("replySustain", "expression-parameter-composition", {
      nativeMotions: [],
      expressions: [],
      parameters: [...faceParameters, ...bodyParameters].slice(0, 8),
      parts: [],
      hitAreas: bodyHitArea,
      implementationRecommendation: "使用固定 chat_reply_sustain 触发低幅视线/身体姿态目标，表现回复生成中的持续微动作；不从 LLM 或 IPC 接收任意 payload。",
      risk: "没有长回复等待专用 motion，sleep/quiet 下必须保持低打扰，并依赖运行时过滤避免过度活跃。"
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
