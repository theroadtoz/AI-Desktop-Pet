import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import vm from "node:vm";
import { validateExpressionAsset } from "./live2d-expression-asset-audit.mts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "resources/models/witch/model-manifest.json";
const CUBISM_CORE_PATH = "public/cubism/live2dcubismcore.min.js";

type JsonRecord = Record<string, unknown>;
type CapabilityCategory = "switchable-preset" | "presentation-only" | "drawing-component" | "unconfirmed";
type SourceType = "manifest-expression" | "manifest-idle-motion" | "model3-file-reference" | "project-hit-area";

type Manifest = {
  sourceDir: string;
  model3: string;
  displayInfo: string;
  idleMotion: string;
  expressions: Record<string, string>;
  emotionMap: Record<string, string | null>;
  hitAreas: Record<string, { x: number; y: number; width: number; height: number }>;
};

type ParameterRange = {
  id: string;
  name: string;
  minimum: number;
  maximum: number;
  default: number;
};

export type AccessoryCapabilityAuditEntry = {
  name: string;
  path: string;
  sourceType: SourceType;
  parameters: ParameterRange[];
  loadable: boolean;
  staticChecks: {
    manifestReference: boolean;
    cdiParameterExists: boolean;
    parameterValuesInRange: boolean;
    expressionBlendAndFadeValid: boolean | null;
  };
  category: CapabilityCategory;
  risk: string;
};

export type AccessoryCapabilityAuditResult = {
  auditVersion: 1;
  manifestPath: string;
  model3Path: string;
  cdi3Path: string;
  model3Declarations: {
    hasMotions: boolean;
    hasUserData: boolean;
    hasHitAreas: boolean;
  };
  modelParameterCount: number;
  entries: AccessoryCapabilityAuditEntry[];
  switchablePresetCount: number;
  p25dScope: "do-not-implement-accessory-selector";
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

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function getCdiParameterNames(displayInfo: JsonRecord): Map<string, string> {
  if (!Array.isArray(displayInfo.Parameters)) {
    throw new Error("CDI3.Parameters 必须是数组");
  }

  return new Map(displayInfo.Parameters.map((item, index) => {
    const parameter = requireRecord(item, `CDI3.Parameters[${index}]`);
    return [
      requireString(parameter.Id, `CDI3.Parameters[${index}].Id`),
      requireString(parameter.Name, `CDI3.Parameters[${index}].Name`)
    ];
  }));
}

async function waitForCubismCore(core: { Version?: { csmGetVersion?: () => number } }): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      if (core.Version?.csmGetVersion?.()) {
        return;
      }
    } catch {
      // The embedded Core runtime initializes asynchronously.
    }

    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10));
  }

  throw new Error("Cubism Core 初始化超时");
}

async function readModelParameterRanges(mocPath: string, displayNames: Map<string, string>): Promise<Map<string, ParameterRange>> {
  const corePath = resolve(REPOSITORY_ROOT, CUBISM_CORE_PATH);
  const context = {
    Buffer,
    TextDecoder,
    WebAssembly,
    clearTimeout,
    console: { error() {}, log() {}, warn() {} },
    setTimeout
  };

  vm.runInNewContext(readFileSync(corePath, "utf8"), context, { filename: corePath });
  const core = (context as { Live2DCubismCore?: {
    Moc: { fromArrayBuffer(buffer: ArrayBuffer): { _release(): void } | null };
    Model: { fromMoc(moc: object): { parameters: {
      ids: string[];
      minimumValues: Float32Array;
      maximumValues: Float32Array;
      defaultValues: Float32Array;
    }; release(): void } | null };
    Version?: { csmGetVersion?: () => number };
  } }).Live2DCubismCore;

  if (!core) {
    throw new Error("Cubism Core 未导出");
  }

  await waitForCubismCore(core);
  const mocBytes = readFileSync(mocPath);
  const buffer = mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength);
  const moc = core.Moc.fromArrayBuffer(buffer);

  if (!moc) {
    throw new Error("无法解析 MOC3 参数范围");
  }

  const model = core.Model.fromMoc(moc);

  if (!model) {
    moc._release();
    throw new Error("无法从 MOC3 创建模型");
  }

  try {
    return new Map(model.parameters.ids.map((id, index) => [id, {
      id,
      name: displayNames.get(id) ?? "",
      minimum: model.parameters.minimumValues[index],
      maximum: model.parameters.maximumValues[index],
      default: model.parameters.defaultValues[index]
    }]));
  } finally {
    model.release();
    moc._release();
  }
}

function classifyExpression(name: string): Pick<AccessoryCapabilityAuditEntry, "category" | "risk"> {
  if (["happy", "sad", "angry", "excited"].includes(name)) {
    return {
      category: "presentation-only",
      risk: "已由 P2-5B 情绪层级使用；不是持续配件状态。"
    };
  }

  if (["bow", "gestureGame", "gestureMic"].includes(name)) {
    return {
      category: "presentation-only",
      risk: "手势或动作资源只适合短时表现，不能作为持续配件状态。"
    };
  }

  return {
    category: "unconfirmed",
    risk: "资源虽被 manifest 引用，但当前运行时没有独立、已验证的持续切换入口；不得进入选择器。"
  };
}

function assertParameterRange(parameter: ParameterRange, value: number, label: string): void {
  if (value < parameter.minimum || value > parameter.maximum) {
    throw new Error(`${label} 参数值超出 MOC3 范围：${parameter.id}`);
  }
}

export async function auditWitchAccessoryCapabilities(
  repositoryRoot = REPOSITORY_ROOT
): Promise<AccessoryCapabilityAuditResult> {
  const manifestPath = resolve(repositoryRoot, MANIFEST_PATH);
  const manifest = readJson(manifestPath) as Manifest;
  const modelDirectory = resolve(dirname(manifestPath), requireString(manifest.sourceDir, "manifest.sourceDir"));
  const model3Path = resolve(modelDirectory, requireString(manifest.model3, "manifest.model3"));
  const cdi3Path = resolve(modelDirectory, requireString(manifest.displayInfo, "manifest.displayInfo"));
  const model3 = readJson(model3Path);
  const fileReferences = requireRecord(model3.FileReferences, "model3.FileReferences");
  const cdiNames = getCdiParameterNames(readJson(cdi3Path));
  const mocPath = resolve(modelDirectory, requireString(fileReferences.Moc, "model3.FileReferences.Moc"));
  const parameterRanges = await readModelParameterRanges(mocPath, cdiNames);

  const expressionEntries = Object.entries(manifest.expressions).map(([name, expressionPath]) => {
    const path = resolve(modelDirectory, expressionPath);

    if (!existsSync(path)) {
      throw new Error(`manifest.expressions.${name} 指向的文件不存在`);
    }

    const expression = validateExpressionAsset(readJson(path), cdiNames.keys(), expressionPath);
    const parameters = expression.parameters.map((parameter) => {
      const range = parameterRanges.get(parameter.id);

      if (!range) {
        throw new Error(`MOC3 中不存在表达式参数：${parameter.id}`);
      }

      assertParameterRange(range, parameter.value, expressionPath);
      return range;
    });
    const classification = classifyExpression(name);

    return {
      name,
      path: relativePath(repositoryRoot, path),
      sourceType: "manifest-expression" as const,
      parameters,
      loadable: true,
      staticChecks: {
        manifestReference: true,
        cdiParameterExists: true,
        parameterValuesInRange: true,
        expressionBlendAndFadeValid: true
      },
      ...classification
    };
  });

  const idleMotionPath = resolve(modelDirectory, requireString(manifest.idleMotion, "manifest.idleMotion"));
  const idleMotion = readJson(idleMotionPath);
  const curves = Array.isArray(idleMotion.Curves) ? idleMotion.Curves : [];
  const motionParameters = curves.map((curve, index) => {
    const item = requireRecord(curve, `idleMotion.Curves[${index}]`);
    const id = requireString(item.Id, `idleMotion.Curves[${index}].Id`);
    const range = parameterRanges.get(id);

    if (!range || !cdiNames.has(id)) {
      throw new Error(`idleMotion 使用了未声明参数：${id}`);
    }

    return range;
  });

  const fileReferenceEntries = ["Moc", "Textures", "Physics", "DisplayInfo"].flatMap((key) => {
    const referenced = fileReferences[key];
    const paths = Array.isArray(referenced) ? referenced : [referenced];

    return paths.map((value, index) => {
      const assetPath = resolve(modelDirectory, requireString(value, `model3.FileReferences.${key}[${index}]`));

      if (!existsSync(assetPath)) {
        throw new Error(`model3 引用的文件不存在：${key}`);
      }

      return {
        name: `${key}[${index}]`,
        path: relativePath(repositoryRoot, assetPath),
        sourceType: "model3-file-reference" as const,
        parameters: [],
        loadable: true,
        staticChecks: {
          manifestReference: true,
          cdiParameterExists: true,
          parameterValuesInRange: true,
          expressionBlendAndFadeValid: null
        },
        category: "drawing-component" as const,
        risk: "模型渲染或物理组成文件，不是独立可切换配件。"
      };
    });
  });

  const hitAreaEntries = Object.entries(manifest.hitAreas).map(([name, hitArea]) => ({
    name,
    path: `${relativePath(repositoryRoot, manifestPath)}#hitAreas.${name}`,
    sourceType: "project-hit-area" as const,
    parameters: [],
    loadable: true,
    staticChecks: {
      manifestReference: true,
      cdiParameterExists: true,
      parameterValuesInRange: true,
      expressionBlendAndFadeValid: null
    },
    category: "drawing-component" as const,
    risk: `项目侧命中区（${hitArea.x}, ${hitArea.y}, ${hitArea.width}, ${hitArea.height}），不对应模型可切换部件。`
  }));

  const entries: AccessoryCapabilityAuditEntry[] = [
    ...expressionEntries,
    {
      name: "idleMotion",
      path: relativePath(repositoryRoot, idleMotionPath),
      sourceType: "manifest-idle-motion",
      parameters: motionParameters,
      loadable: true,
      staticChecks: {
        manifestReference: true,
        cdiParameterExists: true,
        parameterValuesInRange: true,
        expressionBlendAndFadeValid: null
      },
      category: "presentation-only",
      risk: "循环待机动作会改写哭泣和招手参数，不能作为持续配件状态。"
    },
    ...fileReferenceEntries,
    ...hitAreaEntries
  ];

  return {
    auditVersion: 1,
    manifestPath: relativePath(repositoryRoot, manifestPath),
    model3Path: relativePath(repositoryRoot, model3Path),
    cdi3Path: relativePath(repositoryRoot, cdi3Path),
    model3Declarations: {
      hasMotions: Array.isArray(fileReferences.Motions) && fileReferences.Motions.length > 0,
      hasUserData: typeof fileReferences.UserData === "string" && fileReferences.UserData.length > 0,
      hasHitAreas: Array.isArray(model3.HitAreas) && model3.HitAreas.length > 0
    },
    modelParameterCount: parameterRanges.size,
    entries,
    switchablePresetCount: entries.filter((entry) => entry.category === "switchable-preset").length,
    p25dScope: "do-not-implement-accessory-selector"
  };
}
