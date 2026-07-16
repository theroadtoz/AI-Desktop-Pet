import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModelManifest, ModelMotionPreset } from "../src/shared/model-manifest.ts";
import { validateMotionPresetPath } from "./live2d-motion-asset-audit.mts";
import { dryRunMotionResourceIntake, type MotionResourceDryRunSummary } from "./p2-52-motion-resource-dry-run-intake.mts";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const APPROVED_INTAKE_MANIFEST = "approved-motion-intake.json";
const MODEL_MANIFEST_PATH = "resources/models/witch/model-manifest.json";
const METADATA_REGISTRY_PATH = "resources/models/witch/motion-intake-metadata.json";
const RUNTIME_CATALOG_PATH = "src/shared/approved-motion-presets.ts";
const MANAGED_MOTION_ROOT = "resources/models/witch";

type JsonRecord = Record<string, unknown>;

type IntakeException = {
  intakeStatus: "user-authorized-vts-draft";
  userVisualReview: "passed";
  cubismRefined: false;
  runtimeEnabled: true;
};

type ApprovedIntakeEntry = {
  candidateDirectory: string;
  sourcePath: string;
  targetPath: string;
  expectedSha256: string;
  exception: IntakeException;
};

type ApprovedIntakeManifest = {
  intakeVersion: 1;
  modelId: "witch";
  authorization: "explicit-user-source-target-exception";
  entries: ApprovedIntakeEntry[];
};

type IntakeMetadataEntry = IntakeException & {
  presetId: string;
  targetPath: string;
  sourceBasename: string;
  sourceHashPrefix: string;
};

export type ApprovedMotionIntakeSummary = {
  intakeVersion: 1;
  safeSummaryOnly: true;
  candidateRootBasename: string | null;
  status: "blocked" | "ready-to-apply" | "applied";
  productWrites: boolean;
  entries: Array<{
    presetId: string | null;
    sourceBasename: string | null;
    targetBasename: string | null;
    dryRun: MotionResourceDryRunSummary | null;
    blockers: string[];
  }>;
  blockers: string[];
};

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || win32.isAbsolute(value) || value.includes("\\")) {
    return false;
  }

  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !normalized.split("/").some((part) => part === "" || part === "." || part === "..");
}

function resolveContainedRegularFile(root: string, relativePath: string): string | null {
  if (!isSafeRelativePath(relativePath)) {
    return null;
  }

  try {
    const rootRealPath = realpathSync(root);
    const candidatePath = resolve(rootRealPath, relativePath);
    const candidateStats = lstatSync(candidatePath);

    if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) {
      return null;
    }

    const candidateRealPath = realpathSync(candidatePath);
    const containment = relative(rootRealPath, candidateRealPath);
    return containment && !containment.startsWith("..") && !isAbsolute(containment) ? candidateRealPath : null;
  } catch {
    return null;
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const containment = relative(root, candidate);
  return containment === "" || (!containment.startsWith("..") && !isAbsolute(containment));
}

function isLinkOrReparsePoint(path: string): boolean {
  return lstatSync(path).isSymbolicLink();
}

function resolveContainedTarget(repositoryRoot: string, relativePath: string): string | null {
  let safeMotionPath: string;

  try {
    safeMotionPath = validateMotionPresetPath(relativePath);
  } catch {
    return null;
  }

  try {
    const managedRoot = resolve(repositoryRoot, MANAGED_MOTION_ROOT);
    if (isLinkOrReparsePoint(managedRoot)) {
      return null;
    }

    const target = resolve(managedRoot, safeMotionPath);
    if (!isContainedPath(managedRoot, target)) {
      return null;
    }

    let nearestExistingParent: string | null = null;
    for (let current = dirname(target); ; current = dirname(current)) {
      try {
        const stats = lstatSync(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          return null;
        }
        nearestExistingParent ??= current;
      } catch {
        // A not-yet-created directory is safe only when its existing ancestor is safe.
      }

      if (current === managedRoot) {
        break;
      }
    }

    if (!nearestExistingParent) {
      return null;
    }

    return isContainedPath(realpathSync(managedRoot), realpathSync(nearestExistingParent)) ? target : null;
  } catch {
    return null;
  }
}

function isException(value: unknown): value is IntakeException {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const exception = value as JsonRecord;
  return exception.intakeStatus === "user-authorized-vts-draft" &&
    exception.userVisualReview === "passed" &&
    exception.cubismRefined === false &&
    exception.runtimeEnabled === true;
}

function parseManifest(manifestValue: JsonRecord): ApprovedIntakeManifest | null {
  if (
    manifestValue.intakeVersion !== 1 ||
    manifestValue.modelId !== "witch" ||
    manifestValue.authorization !== "explicit-user-source-target-exception" ||
    !Array.isArray(manifestValue.entries) ||
    manifestValue.entries.length === 0
  ) {
    return null;
  }

  const entries: ApprovedIntakeEntry[] = [];

  for (const entryValue of manifestValue.entries) {
    if (!entryValue || typeof entryValue !== "object" || Array.isArray(entryValue)) {
      return null;
    }

    const entry = entryValue as JsonRecord;
    if (
      !isSafeRelativePath(entry.candidateDirectory) ||
      !isSafeRelativePath(entry.sourcePath) ||
      !isSafeRelativePath(entry.targetPath) ||
      typeof entry.expectedSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.expectedSha256) ||
      !isException(entry.exception)
    ) {
      return null;
    }

    entries.push({
      candidateDirectory: entry.candidateDirectory,
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
      expectedSha256: entry.expectedSha256,
      exception: entry.exception
    });
  }

  return { intakeVersion: 1, modelId: "witch", authorization: "explicit-user-source-target-exception", entries };
}

function readCandidatePreset(candidateRoot: string, candidateDirectory: string): ModelMotionPreset | null {
  try {
    const candidatePath = resolve(candidateRoot, candidateDirectory);
    const intake = readJson(resolve(candidatePath, "motion-intake.json"));
    const candidatePreset = intake.preset;
    if (!candidatePreset || typeof candidatePreset !== "object" || Array.isArray(candidatePreset)) {
      return null;
    }

    const { licenseEvidence: _licenseEvidence, ...preset } = candidatePreset as ModelMotionPreset & { licenseEvidence?: unknown };
    return preset;
  } catch {
    return null;
  }
}

function createSummary(candidateRoot: string | undefined): ApprovedMotionIntakeSummary {
  return {
    intakeVersion: 1,
    safeSummaryOnly: true,
    candidateRootBasename: candidateRoot ? basename(candidateRoot) : null,
    status: "blocked",
    productWrites: false,
    entries: [],
    blockers: []
  };
}

function sameText(path: string, expected: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8") === expected;
}

function rollback(changes: Array<{ target: string; backup: string | null }>, rename: typeof renameSync): void {
  for (const change of [...changes].reverse()) {
    rmSync(change.target, { force: true });
    if (change.backup && existsSync(change.backup)) {
      rename(change.backup, change.target);
    }
  }
}

function renderRuntimeCatalog(presets: readonly ModelMotionPreset[]): string {
  return `import type { ModelMotionPreset } from "./model-manifest";\n\n// Generated from resources/models/witch/model-manifest.json by P2-65.\nexport const APPROVED_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze(\n${JSON.stringify(presets, null, 2)}\n);\n`;
}

export function approvedMotionResourceIntake(options: {
  candidateRoot?: string;
  repositoryRoot?: string;
  apply?: boolean;
  fileOperations?: {
    renameSync?: typeof renameSync;
  };
} = {}): ApprovedMotionIntakeSummary {
  const candidateRoot = options.candidateRoot;
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const summary = createSummary(candidateRoot);

  if (!candidateRoot || !resolveContainedRegularFile(candidateRoot, APPROVED_INTAKE_MANIFEST)) {
    summary.blockers = ["missing-approved-intake-manifest"];
    return summary;
  }

  let approvedManifest: ApprovedIntakeManifest | null;

  try {
    approvedManifest = parseManifest(readJson(resolve(candidateRoot, APPROVED_INTAKE_MANIFEST)));
  } catch {
    approvedManifest = null;
  }

  if (!approvedManifest) {
    summary.blockers = ["invalid-approved-intake-manifest"];
    return summary;
  }

  const productManifestPath = resolve(repositoryRoot, MODEL_MANIFEST_PATH);
  const registryPath = resolve(repositoryRoot, METADATA_REGISTRY_PATH);
  const runtimeCatalogPath = resolve(repositoryRoot, RUNTIME_CATALOG_PATH);
  const rename = options.fileOperations?.renameSync ?? renameSync;
  let productManifest: ModelManifest;
  let existingRegistry: JsonRecord | null = null;

  try {
    productManifest = readJson(productManifestPath) as ModelManifest;
    existingRegistry = existsSync(registryPath) ? readJson(registryPath) : null;
  } catch {
    summary.blockers = ["invalid-product-manifest"];
    return summary;
  }

  const existingPresets = new Map((productManifest.motionPresets ?? []).map((preset) => [preset.id, preset]));
  const existingRegistryEntries = Array.isArray(existingRegistry?.entries) ? existingRegistry.entries : [];
  const seenIds = new Set<string>();
  const seenTargets = new Set<string>();
  const prepared: Array<{ entry: ApprovedIntakeEntry; preset: ModelMotionPreset; sourcePath: string; targetPath: string }> = [];

  for (const entry of approvedManifest.entries) {
    const dryRun = dryRunMotionResourceIntake({
      candidateRoot: resolve(candidateRoot, entry.candidateDirectory),
      repositoryRoot
    });
    const preset = readCandidatePreset(candidateRoot, entry.candidateDirectory);
    const sourcePath = resolveContainedRegularFile(candidateRoot, entry.sourcePath);
    const targetPath = resolveContainedTarget(repositoryRoot, entry.targetPath);
    const entrySummary = {
      presetId: preset?.id ?? dryRun.presetId,
      sourceBasename: sourcePath ? basename(sourcePath) : null,
      targetBasename: targetPath ? basename(targetPath) : null,
      dryRun,
      blockers: [] as string[]
    };

    if (dryRun.status !== "ready-for-manifest-review") entrySummary.blockers.push("p2-52-dry-run-blocked");
    if (!sourcePath) entrySummary.blockers.push("missing-or-unsafe-regular-source");
    if (!targetPath) entrySummary.blockers.push("unsafe-target-path");
    const sourcePathFromCandidate = isSafeRelativePath(entry.sourcePath)
      ? relative(entry.candidateDirectory, entry.sourcePath).replaceAll("\\", "/")
      : null;
    if (!preset || preset.path !== sourcePathFromCandidate || preset.path !== entry.targetPath) entrySummary.blockers.push("candidate-source-target-mismatch");
    if (sourcePath && sha256(sourcePath) !== entry.expectedSha256) entrySummary.blockers.push("source-hash-mismatch");
    if (!preset || seenIds.has(preset.id) || existingPresets.has(preset?.id ?? "")) entrySummary.blockers.push("manifest-preset-id-collision");
    if (!preset || seenTargets.has(entry.targetPath) || [...existingPresets.values()].some((item) => item.path === entry.targetPath)) entrySummary.blockers.push("manifest-preset-path-collision");
    if (existingRegistryEntries.some((item) => (item as JsonRecord).presetId === preset?.id)) entrySummary.blockers.push("metadata-preset-id-collision");
    if (targetPath && existsSync(targetPath)) entrySummary.blockers.push("target-already-exists");

    summary.entries.push(entrySummary);
    if (entrySummary.blockers.length === 0 && preset && sourcePath && targetPath) {
      seenIds.add(preset.id);
      seenTargets.add(entry.targetPath);
      prepared.push({ entry, preset, sourcePath, targetPath });
    }
  }

  summary.blockers = [...new Set(summary.entries.flatMap((entry) => entry.blockers))].sort();
  if (summary.blockers.length > 0 || prepared.length !== approvedManifest.entries.length) {
    return summary;
  }

  if (!options.apply) {
    summary.status = "ready-to-apply";
    return summary;
  }

  const originalProductManifest = readFileSync(productManifestPath, "utf8");
  const originalRegistry = existsSync(registryPath) ? readFileSync(registryPath, "utf8") : null;
  const originalRuntimeCatalog = existsSync(runtimeCatalogPath) ? readFileSync(runtimeCatalogPath, "utf8") : null;
  const nextManifest: ModelManifest = {
    ...productManifest,
    motionPresets: [...(productManifest.motionPresets ?? []), ...prepared.map(({ preset }) => preset)]
  };
  const nextRegistry = {
    registryVersion: 1,
    modelId: "witch",
    entries: [
      ...existingRegistryEntries,
      ...prepared.map(({ entry, preset, sourcePath }): IntakeMetadataEntry => ({
        presetId: preset.id,
        targetPath: entry.targetPath,
        sourceBasename: basename(sourcePath),
        sourceHashPrefix: entry.expectedSha256.slice(0, 12),
        ...entry.exception
      }))
    ]
  };
  const nextRuntimeCatalog = renderRuntimeCatalog(nextManifest.motionPresets ?? []);
  const managedRoot = resolve(repositoryRoot, MANAGED_MOTION_ROOT);
  const stageRoot = resolve(managedRoot, `.p2-65-approved-intake-${randomUUID()}`);
  const changes: Array<{ target: string; backup: string | null }> = [];

  try {
    mkdirSync(stageRoot, { recursive: true });
    for (const preparedEntry of prepared) {
      const stagePath = resolve(stageRoot, preparedEntry.entry.targetPath);
      mkdirSync(resolve(stagePath, ".."), { recursive: true });
      copyFileSync(preparedEntry.sourcePath, stagePath);
      if (sha256(stagePath) !== preparedEntry.entry.expectedSha256 || sha256(stagePath) !== sha256(preparedEntry.sourcePath)) {
        throw new Error("staged source-target hash mismatch");
      }
    }
    writeJson(resolve(stageRoot, "model-manifest.json"), nextManifest);
    writeJson(resolve(stageRoot, "motion-intake-metadata.json"), nextRegistry);
    writeFileSync(resolve(stageRoot, "approved-motion-presets.ts"), nextRuntimeCatalog, "utf8");

    if (
      !sameText(productManifestPath, originalProductManifest) ||
      (originalRegistry === null ? existsSync(registryPath) : !sameText(registryPath, originalRegistry)) ||
      (originalRuntimeCatalog === null ? existsSync(runtimeCatalogPath) : !sameText(runtimeCatalogPath, originalRuntimeCatalog))
    ) {
      throw new Error("product manifest changed during staging");
    }

    for (const preparedEntry of prepared) {
      rename(resolve(stageRoot, preparedEntry.entry.targetPath), preparedEntry.targetPath);
      changes.push({ target: preparedEntry.targetPath, backup: null });
    }

    for (const replacement of [
      { staged: resolve(stageRoot, "model-manifest.json"), target: productManifestPath },
      { staged: resolve(stageRoot, "motion-intake-metadata.json"), target: registryPath },
      { staged: resolve(stageRoot, "approved-motion-presets.ts"), target: runtimeCatalogPath }
    ]) {
      const backup = existsSync(replacement.target) ? resolve(stageRoot, `${basename(replacement.target)}.backup`) : null;
      if (backup) {
        rename(replacement.target, backup);
        changes.push({ target: replacement.target, backup });
      } else {
        changes.push({ target: replacement.target, backup: null });
      }
      rename(replacement.staged, replacement.target);
    }

    for (const preparedEntry of prepared) {
      if (sha256(preparedEntry.sourcePath) !== sha256(preparedEntry.targetPath)) {
        throw new Error("installed source-target hash mismatch");
      }
    }

    summary.status = "applied";
    summary.productWrites = true;
  } catch {
    rollback(changes, rename);
    summary.blockers = ["apply-failed"];
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }

  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const candidateRoot = process.argv[2];
  const apply = process.argv.includes("--apply");
  console.log(JSON.stringify(approvedMotionResourceIntake({ candidateRoot, apply }), null, 2));
}
