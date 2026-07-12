import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve, win32, posix } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ModelMotionAssetLicenseStatus,
  ModelMotionPreset,
  ModelMotionRestorePolicy,
  ModelMotionSemanticKind,
  ModelMotionVisualRisk
} from "../src/shared/model-manifest.ts";
import {
  isProductionReadyMotionAssetLicenseStatus,
  validateMotionPresetPath
} from "./live2d-motion-asset-audit.mts";
import { parseMotion3Segments } from "./support/motion3-canonicalizer.mts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const WITCH_DISPLAY_INFO_PATH = "model/魔女.cdi3.json";
const DEFAULT_INTAKE_MANIFEST_NAME = "motion-intake.json";

type JsonRecord = Record<string, unknown>;
type IntakeBlockerCode =
  | "missing-intake-root"
  | "missing-intake-manifest"
  | "invalid-intake-manifest-json"
  | "invalid-intake-version"
  | "invalid-preset"
  | "unsafe-motion-path"
  | "missing-motion-file"
  | "invalid-motion-json"
  | "invalid-motion-version"
  | "invalid-motion-meta"
  | "invalid-motion-duration"
  | "motion-duration-exceeds-safe-limit"
  | "motion-meta-count-mismatch"
  | "invalid-motion-segments"
  | "invalid-motion-segment-time"
  | "motion-loop-mismatch"
  | "unsupported-curve-target"
  | "unknown-parameter-id"
  | "blocked-license"
  | "missing-license-evidence"
  | "unsafe-license-evidence-path";

type IntakePreset = ModelMotionPreset & {
  licenseEvidence?: string;
};

export type MotionResourceDryRunSummary = {
  intakeVersion: 1;
  safeSummaryOnly: true;
  dryRunOnly: true;
  productManifestChanged: false;
  runtimeCatalogChanged: false;
  status: "blocked" | "ready-for-manifest-review";
  candidateRootBasename: string | null;
  candidateFileBasename: string | null;
  presetId: string | null;
  semanticKind: ModelMotionSemanticKind | null;
  loop: boolean | null;
  metaLoop: boolean | null;
  durationSeconds: number | null;
  curveCount: number;
  segmentCount: number;
  pointCount: number;
  parameterCount: number;
  hashPrefix: string | null;
  assetLicenseStatus: ModelMotionAssetLicenseStatus | null;
  restorePolicy: ModelMotionRestorePolicy | null;
  allowedStates: string[];
  allowedPresenceModes: string[];
  allowedDialogueModes: string[];
  visualRisk: ModelMotionVisualRisk | null;
  blockers: IntakeBlockerCode[];
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
const MAX_SEMANTIC_MOTION_DURATION_SECONDS = 60;

function createBaseSummary(candidateRoot: string | undefined): MotionResourceDryRunSummary {
  return {
    intakeVersion: 1,
    safeSummaryOnly: true,
    dryRunOnly: true,
    productManifestChanged: false,
    runtimeCatalogChanged: false,
    status: "blocked",
    candidateRootBasename: candidateRoot ? basename(candidateRoot) : null,
    candidateFileBasename: null,
    presetId: null,
    semanticKind: null,
    loop: null,
    metaLoop: null,
    durationSeconds: null,
    curveCount: 0,
    segmentCount: 0,
    pointCount: 0,
    parameterCount: 0,
    hashPrefix: null,
    assetLicenseStatus: null,
    restorePolicy: null,
    allowedStates: [],
    allowedPresenceModes: [],
    allowedDialogueModes: [],
    visualRisk: null,
    blockers: []
  };
}

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function requireRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function requireString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function requireBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function requireStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
}

function requireSafeIdArray(value: unknown): string[] | null {
  const values = requireStringArray(value);

  if (!values || values.some((item) => !/^[a-z][a-z0-9-]*$/u.test(item))) {
    return null;
  }

  return values;
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function requireStringArrayFrom<const T extends readonly string[]>(value: unknown, allowed: T): T[number][] | null {
  const values = requireStringArray(value);

  if (!values || values.some((item) => !allowed.includes(item as T[number]))) {
    return null;
  }

  return values as T[number][];
}

function validateSafeEvidencePath(relativePath: string): string {
  if (
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new Error("unsafe license evidence path");
  }

  const normalized = posix.normalize(relativePath);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.endsWith("/")
  ) {
    throw new Error("unsafe license evidence path");
  }

  return normalized;
}

function readWitchParameterIds(repositoryRoot: string): Set<string> {
  const displayInfo = readJson(resolve(repositoryRoot, WITCH_DISPLAY_INFO_PATH));
  const parameters = Array.isArray(displayInfo.Parameters) ? displayInfo.Parameters : [];

  return new Set(parameters.flatMap((item) => {
    const entry = requireRecord(item);
    const id = entry ? requireString(entry.Id) : null;
    return id ? [id] : [];
  }));
}

function parsePreset(value: unknown): IntakePreset | null {
  const entry = requireRecord(value);

  if (!entry) {
    return null;
  }

  const id = requireString(entry.id);
  const path = requireString(entry.path);
  const semanticKind = requireOneOf(entry.semanticKind, MOTION_SEMANTIC_KINDS);
  const loop = requireBoolean(entry.loop);
  const fadeInSeconds = requireNumber(entry.fadeInSeconds);
  const fadeOutSeconds = requireNumber(entry.fadeOutSeconds);
  const durationHintSeconds = requireNumber(entry.durationHintSeconds);
  const priority = requireNumber(entry.priority);
  const cooldownMs = requireNumber(entry.cooldownMs);
  const restorePolicy = requireOneOf(entry.restorePolicy, MOTION_RESTORE_POLICIES);
  const allowedStates = requireSafeIdArray(entry.allowedStates);
  const allowedPresenceModes = requireStringArrayFrom(entry.allowedPresenceModes, PRESENCE_MODE_IDS);
  const allowedDialogueModes = requireStringArrayFrom(entry.allowedDialogueModes, DIALOGUE_MODE_IDS);
  const visualRisk = requireOneOf(entry.visualRisk, MOTION_VISUAL_RISKS);
  const assetLicenseStatus = requireOneOf(entry.assetLicenseStatus, MOTION_ASSET_LICENSE_STATUSES);
  const licenseEvidence = entry.licenseEvidence === undefined ? undefined : requireString(entry.licenseEvidence);

  if (
    !id ||
    !/^[a-z][a-z0-9-]*$/u.test(id) ||
    !path ||
    !semanticKind ||
    loop === null ||
    fadeInSeconds === null ||
    fadeOutSeconds === null ||
    durationHintSeconds === null ||
    priority === null ||
    cooldownMs === null ||
    !restorePolicy ||
    !allowedStates ||
    !allowedPresenceModes ||
    !allowedDialogueModes ||
    !visualRisk ||
    !assetLicenseStatus ||
    entry.licenseEvidence !== undefined && !licenseEvidence
  ) {
    return null;
  }

  return {
    id,
    path,
    semanticKind,
    loop,
    fadeInSeconds,
    fadeOutSeconds,
    durationHintSeconds,
    priority,
    cooldownMs,
    restorePolicy,
    allowedStates,
    allowedPresenceModes,
    allowedDialogueModes,
    visualRisk,
    assetLicenseStatus,
    licenseEvidence
  };
}

function summarizeMotion(motion: JsonRecord, parameterIds: Set<string>, blockers: Set<IntakeBlockerCode>): {
  durationSeconds: number | null;
  loop: boolean | null;
  curveCount: number;
  segmentCount: number;
  pointCount: number;
  parameterCount: number;
} {
  const meta = requireRecord(motion.Meta);
  const durationSeconds = meta ? requireNumber(meta.Duration) : null;
  const loop = meta ? requireBoolean(meta.Loop) : null;
  const fps = meta ? requireNumber(meta.Fps) : null;
  const declaredCurveCount = meta ? requireNonNegativeInteger(meta.CurveCount) : null;
  const declaredSegmentCount = meta ? requireNonNegativeInteger(meta.TotalSegmentCount) : null;
  const declaredPointCount = meta ? requireNonNegativeInteger(meta.TotalPointCount) : null;

  if (motion.Version !== 3) {
    blockers.add("invalid-motion-version");
  }

  if (durationSeconds === null || durationSeconds <= 0) {
    blockers.add("invalid-motion-duration");
  }

  if (
    durationSeconds !== null &&
    durationSeconds > MAX_SEMANTIC_MOTION_DURATION_SECONDS
  ) {
    blockers.add("motion-duration-exceeds-safe-limit");
  }

  if (
    !meta ||
    loop === null ||
    fps === null ||
    fps <= 0 ||
    declaredCurveCount === null ||
    declaredSegmentCount === null ||
    declaredPointCount === null
  ) {
    blockers.add("invalid-motion-meta");
  }

  const usedParameterIds = new Set<string>();

  if (!Array.isArray(motion.Curves)) {
    blockers.add("invalid-motion-json");

    return {
      durationSeconds,
      loop,
      curveCount: 0,
      segmentCount: 0,
      pointCount: 0,
      parameterCount: 0
    };
  }

  const curves = motion.Curves;
  let segmentCount = 0;
  let pointCount = 0;

  for (const item of curves) {
    const curve = requireRecord(item);
    const target = curve ? requireString(curve.Target) : null;
    const id = curve ? requireString(curve.Id) : null;
    const segmentSummary = parseMotion3Segments(curve?.Segments, durationSeconds ?? Number.NaN);

    segmentCount += segmentSummary.segmentCount;
    pointCount += segmentSummary.pointCount;

    if (!segmentSummary.validEncoding) {
      blockers.add("invalid-motion-segments");
    }

    if (!segmentSummary.validTime) {
      blockers.add("invalid-motion-segment-time");
    }

    if (target !== "Parameter") {
      blockers.add("unsupported-curve-target");
      continue;
    }

    if (!id || !parameterIds.has(id)) {
      blockers.add("unknown-parameter-id");
      continue;
    }

    usedParameterIds.add(id);
  }

  if (
    declaredCurveCount !== null && declaredCurveCount !== curves.length ||
    declaredSegmentCount !== null && declaredSegmentCount !== segmentCount ||
    declaredPointCount !== null && declaredPointCount !== pointCount
  ) {
    blockers.add("motion-meta-count-mismatch");
  }

  return {
    durationSeconds,
    loop,
    curveCount: curves.length,
    segmentCount,
    pointCount,
    parameterCount: usedParameterIds.size
  };
}

export function dryRunMotionResourceIntake(options: {
  candidateRoot?: string;
  repositoryRoot?: string;
} = {}): MotionResourceDryRunSummary {
  const candidateRoot = options.candidateRoot ?? process.env.AI_DESKTOP_PET_MOTION_INTAKE_ROOT;
  const summary = createBaseSummary(candidateRoot);
  const blockers = new Set<IntakeBlockerCode>();

  if (!candidateRoot) {
    summary.blockers = ["missing-intake-root"];
    return summary;
  }

  const candidateManifestPath = resolve(candidateRoot, DEFAULT_INTAKE_MANIFEST_NAME);

  if (!existsSync(candidateManifestPath)) {
    summary.blockers = ["missing-intake-manifest"];
    return summary;
  }

  let intakeManifest: JsonRecord;

  try {
    intakeManifest = readJson(candidateManifestPath);
  } catch {
    summary.blockers = ["invalid-intake-manifest-json"];
    return summary;
  }

  if (intakeManifest.intakeVersion !== 1) {
    blockers.add("invalid-intake-version");
  }

  const preset = parsePreset(intakeManifest.preset);

  if (!preset) {
    blockers.add("invalid-preset");
    summary.blockers = [...blockers].sort();
    return summary;
  }

  summary.presetId = preset.id;
  summary.semanticKind = preset.semanticKind;
  summary.loop = preset.loop;
  summary.assetLicenseStatus = preset.assetLicenseStatus;
  summary.restorePolicy = preset.restorePolicy;
  summary.allowedStates = [...preset.allowedStates];
  summary.allowedPresenceModes = [...preset.allowedPresenceModes];
  summary.allowedDialogueModes = [...preset.allowedDialogueModes];
  summary.visualRisk = preset.visualRisk;

  let motionRelativePath: string | null = null;

  try {
    motionRelativePath = validateMotionPresetPath(preset.path);
    summary.candidateFileBasename = basename(motionRelativePath);
  } catch {
    blockers.add("unsafe-motion-path");
  }

  if (!isProductionReadyMotionAssetLicenseStatus(preset.assetLicenseStatus)) {
    blockers.add("blocked-license");
  }

  if (isProductionReadyMotionAssetLicenseStatus(preset.assetLicenseStatus)) {
    if (!preset.licenseEvidence) {
      blockers.add("missing-license-evidence");
    } else {
      try {
        const evidencePath = validateSafeEvidencePath(preset.licenseEvidence);

        if (!existsSync(resolve(candidateRoot, evidencePath))) {
          blockers.add("missing-license-evidence");
        }
      } catch {
        blockers.add("unsafe-license-evidence-path");
      }
    }
  }

  if (motionRelativePath) {
    const motionPath = resolve(candidateRoot, motionRelativePath);

    if (!existsSync(motionPath)) {
      blockers.add("missing-motion-file");
    } else {
      let motionText: string;
      let motion: JsonRecord;

      try {
        motionText = readFileSync(motionPath, "utf8");
        motion = JSON.parse(motionText) as JsonRecord;
        summary.hashPrefix = createHash("sha256").update(motionText).digest("hex").slice(0, 12);
      } catch {
        blockers.add("invalid-motion-json");
        summary.blockers = [...blockers].sort();
        return summary;
      }

      const motionSummary = summarizeMotion(
        motion,
        readWitchParameterIds(options.repositoryRoot ?? REPOSITORY_ROOT),
        blockers
      );
      summary.metaLoop = motionSummary.loop;
      summary.durationSeconds = motionSummary.durationSeconds;
      summary.curveCount = motionSummary.curveCount;
      summary.segmentCount = motionSummary.segmentCount;
      summary.pointCount = motionSummary.pointCount;
      summary.parameterCount = motionSummary.parameterCount;

      if (motionSummary.loop !== null && motionSummary.loop !== preset.loop) {
        blockers.add("motion-loop-mismatch");
      }
    }
  }

  summary.blockers = [...blockers].sort();
  summary.status = summary.blockers.length === 0 ? "ready-for-manifest-review" : "blocked";
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(dryRunMotionResourceIntake(), null, 2));
}
