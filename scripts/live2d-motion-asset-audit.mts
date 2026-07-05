import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, win32, posix } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ModelMotionPreset,
  ModelMotionAssetLicenseStatus,
  ModelMotionRestorePolicy,
  ModelMotionSemanticKind,
  ModelMotionVisualRisk
} from "../src/shared/model-manifest.ts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "resources/models/witch/model-manifest.json";

type JsonRecord = Record<string, unknown>;

type MotionManifest = {
  sourceDir: string;
  model3: string;
  displayInfo: string;
  idleMotion: string;
  motionPresets?: unknown;
};

export type MotionPresetAuditEntry = {
  id: string;
  path: string;
  semanticKind: ModelMotionSemanticKind;
  loop: boolean;
  metaLoop: boolean;
  durationSeconds: number;
  durationHintSeconds: number;
  priority: number;
  cooldownMs: number;
  restorePolicy: ModelMotionRestorePolicy;
  allowedStates: string[];
  visualRisk: ModelMotionVisualRisk;
  assetLicenseStatus: ModelMotionAssetLicenseStatus;
  parameterIds: string[];
  status: "ready";
};

export type MotionAssetAuditResult = {
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
    semanticAllowed: false;
  };
  semanticMotionPresetCount: number;
  semanticMotionPresets: MotionPresetAuditEntry[];
  safeSkip: {
    status: "expected-safe-skip";
    reason: "no-semantic-motion-presets";
  } | null;
};

const MOTION_SEMANTIC_KINDS: readonly ModelMotionSemanticKind[] = [
  "idle",
  "greeting",
  "reaction",
  "thinking",
  "reading",
  "game",
  "sleep",
  "transition"
];
const MOTION_RESTORE_POLICIES: readonly ModelMotionRestorePolicy[] = [
  "restore-expression-pose-accessory",
  "restore-current-state"
];
const MOTION_VISUAL_RISKS: readonly ModelMotionVisualRisk[] = [
  "low",
  "medium",
  "needs-visual-check"
];
const MOTION_ASSET_LICENSE_STATUSES: readonly ModelMotionAssetLicenseStatus[] = [
  "project-owned",
  "user-provided",
  "official-sample-reference-only",
  "blocked-missing-license"
];
const PRESENCE_MODE_IDS = ["default", "focus", "quiet", "sleep"] as const;
const DIALOGUE_MODE_IDS = ["default", "work", "game", "reading"] as const;

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} 必须是非空字符串`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数值`);
  }

  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} 必须是布尔值`);
  }

  return value;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }

  return value as JsonRecord;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是数组`);
  }

  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireStringArrayFrom<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number][] {
  return requireStringArray(value, label).map((item, index) => {
    if (!allowed.includes(item as T[number])) {
      throw new Error(`${label}[${index}] 不在允许列表中`);
    }

    return item as T[number];
  });
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = requireString(value, label);

  if (!allowed.includes(text as T)) {
    throw new Error(`${label} 不在允许列表中`);
  }

  return text as T;
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

export function validateMotionPresetPath(relativePath: string, label = "motionPreset.path"): string {
  if (
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new Error(`${label} 必须是 manifest 内的 POSIX 相对路径`);
  }

  const normalized = posix.normalize(relativePath);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    !normalized.endsWith(".motion3.json")
  ) {
    throw new Error(`${label} 必须指向安全的 .motion3.json`);
  }

  return normalized;
}

function readDisplayInfoIds(displayInfo: JsonRecord): Set<string> {
  const parameters = displayInfo.Parameters;

  if (!Array.isArray(parameters)) {
    throw new Error("CDI3.Parameters 必须是数组");
  }

  return new Set(parameters.map((item, index) => {
    const entry = requireRecord(item, `CDI3.Parameters[${index}]`);
    return requireString(entry.Id, `CDI3.Parameters[${index}].Id`);
  }));
}

function readMotionSummary(motion: JsonRecord, parameterIds: Set<string>, label: string): {
  loop: boolean;
  durationSeconds: number;
  usedParameterIds: string[];
} {
  const meta = requireRecord(motion.Meta, `${label}.Meta`);
  const durationSeconds = requireNumber(meta.Duration, `${label}.Meta.Duration`);
  const loop = requireBoolean(meta.Loop, `${label}.Meta.Loop`);

  if (durationSeconds <= 0) {
    throw new Error(`${label}.Meta.Duration 必须大于 0`);
  }

  const curves = motion.Curves;

  if (!Array.isArray(curves)) {
    throw new Error(`${label}.Curves 必须是数组`);
  }

  const usedParameterIds: string[] = [];

  curves.forEach((item, index) => {
    const curve = requireRecord(item, `${label}.Curves[${index}]`);
    const target = requireString(curve.Target, `${label}.Curves[${index}].Target`);
    const id = requireString(curve.Id, `${label}.Curves[${index}].Id`);

    if (target !== "Parameter") {
      return;
    }

    if (!parameterIds.has(id)) {
      throw new Error(`${label}.Curves[${index}].Id 未在 CDI3.Parameters 中声明：${id}`);
    }

    usedParameterIds.push(id);
  });

  return {
    loop,
    durationSeconds,
    usedParameterIds: [...new Set(usedParameterIds)].sort()
  };
}

function readMotionPresets(value: unknown): ModelMotionPreset[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("manifest.motionPresets 必须是数组");
  }

  const seenIds = new Set<string>();

  return value.map((item, index) => {
    const entry = requireRecord(item, `manifest.motionPresets[${index}]`);
    const id = requireString(entry.id, `manifest.motionPresets[${index}].id`);

    if (!/^[a-z][a-z0-9-]*$/u.test(id)) {
      throw new Error(`manifest.motionPresets[${index}].id 必须是安全 ID`);
    }

    if (seenIds.has(id)) {
      throw new Error(`manifest.motionPresets id 重复：${id}`);
    }

    seenIds.add(id);

    return {
      id,
      path: validateMotionPresetPath(requireString(entry.path, `manifest.motionPresets[${index}].path`), `manifest.motionPresets[${index}].path`),
      semanticKind: requireOneOf(entry.semanticKind, MOTION_SEMANTIC_KINDS, `manifest.motionPresets[${index}].semanticKind`),
      loop: requireBoolean(entry.loop, `manifest.motionPresets[${index}].loop`),
      fadeInSeconds: requireNumber(entry.fadeInSeconds, `manifest.motionPresets[${index}].fadeInSeconds`),
      fadeOutSeconds: requireNumber(entry.fadeOutSeconds, `manifest.motionPresets[${index}].fadeOutSeconds`),
      durationHintSeconds: requireNumber(entry.durationHintSeconds, `manifest.motionPresets[${index}].durationHintSeconds`),
      priority: requireNumber(entry.priority, `manifest.motionPresets[${index}].priority`),
      cooldownMs: requireNumber(entry.cooldownMs, `manifest.motionPresets[${index}].cooldownMs`),
      restorePolicy: requireOneOf(entry.restorePolicy, MOTION_RESTORE_POLICIES, `manifest.motionPresets[${index}].restorePolicy`),
      allowedStates: requireStringArray(entry.allowedStates, `manifest.motionPresets[${index}].allowedStates`),
      allowedPresenceModes: requireStringArrayFrom(entry.allowedPresenceModes, PRESENCE_MODE_IDS, `manifest.motionPresets[${index}].allowedPresenceModes`),
      allowedDialogueModes: requireStringArrayFrom(entry.allowedDialogueModes, DIALOGUE_MODE_IDS, `manifest.motionPresets[${index}].allowedDialogueModes`),
      visualRisk: requireOneOf(entry.visualRisk, MOTION_VISUAL_RISKS, `manifest.motionPresets[${index}].visualRisk`),
      assetLicenseStatus: requireOneOf(entry.assetLicenseStatus, MOTION_ASSET_LICENSE_STATUSES, `manifest.motionPresets[${index}].assetLicenseStatus`)
    };
  });
}

export function auditWitchMotionAssets(repositoryRoot = REPOSITORY_ROOT): MotionAssetAuditResult {
  const manifestPath = resolve(repositoryRoot, MANIFEST_PATH);
  const manifest = readJson(manifestPath) as MotionManifest;
  const modelDirectory = resolve(dirname(manifestPath), requireString(manifest.sourceDir, "manifest.sourceDir"));
  const model3Path = resolve(modelDirectory, requireString(manifest.model3, "manifest.model3"));
  const displayInfoPath = resolve(modelDirectory, requireString(manifest.displayInfo, "manifest.displayInfo"));
  const idleMotionRelativePath = validateMotionPresetPath(requireString(manifest.idleMotion, "manifest.idleMotion"), "manifest.idleMotion");
  const idleMotionPath = resolve(modelDirectory, idleMotionRelativePath);
  const model3 = readJson(model3Path);
  const fileReferences = requireRecord(model3.FileReferences, "model3.FileReferences");
  const model3Motions = fileReferences.Motions;
  const model3DeclaredMotionGroups = model3Motions && typeof model3Motions === "object" && !Array.isArray(model3Motions)
    ? Object.keys(model3Motions as JsonRecord).sort()
    : [];
  const displayInfo = readJson(displayInfoPath);
  const parameterIds = readDisplayInfoIds(displayInfo);
  const idleMotion = readMotionSummary(readJson(idleMotionPath), parameterIds, "idleMotion");
  const motionPresets = readMotionPresets(manifest.motionPresets);
  const semanticMotionPresets = motionPresets.map((preset) => {
    if (preset.path === idleMotionRelativePath) {
      throw new Error(`semantic motion preset 不得复用 idleMotion：${preset.id}`);
    }

    const motionPath = resolve(modelDirectory, preset.path);

    if (!existsSync(motionPath)) {
      throw new Error(`motion preset 文件不存在：${preset.id}`);
    }

    const summary = readMotionSummary(readJson(motionPath), parameterIds, `motionPresets.${preset.id}`);

    if (summary.loop !== preset.loop) {
      throw new Error(`motion preset loop 与 motion Meta.Loop 不一致：${preset.id}`);
    }

    return {
      id: preset.id,
      path: relativePath(repositoryRoot, motionPath),
      semanticKind: preset.semanticKind,
      loop: preset.loop,
      metaLoop: summary.loop,
      durationSeconds: summary.durationSeconds,
      durationHintSeconds: preset.durationHintSeconds,
      priority: preset.priority,
      cooldownMs: preset.cooldownMs,
      restorePolicy: preset.restorePolicy,
      allowedStates: [...preset.allowedStates],
      visualRisk: preset.visualRisk,
      assetLicenseStatus: preset.assetLicenseStatus,
      parameterIds: summary.usedParameterIds,
      status: "ready" as const
    };
  });

  return {
    auditVersion: 1,
    manifestPath: MANIFEST_PATH,
    model3Path: relativePath(repositoryRoot, model3Path),
    displayInfoPath: relativePath(repositoryRoot, displayInfoPath),
    model3DeclaredMotionGroups,
    physicalMotionFiles: listFilesByExtension(modelDirectory, ".motion3.json")
      .map((path) => relativePath(repositoryRoot, path))
      .sort(),
    idleMotion: {
      path: relativePath(repositoryRoot, idleMotionPath),
      loop: idleMotion.loop,
      durationSeconds: idleMotion.durationSeconds,
      parameterIds: idleMotion.usedParameterIds,
      semanticAllowed: false
    },
    semanticMotionPresetCount: semanticMotionPresets.length,
    semanticMotionPresets,
    safeSkip: semanticMotionPresets.length === 0
      ? {
          status: "expected-safe-skip",
          reason: "no-semantic-motion-presets"
        }
      : null
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(auditWitchMotionAssets(), null, 2));
}
