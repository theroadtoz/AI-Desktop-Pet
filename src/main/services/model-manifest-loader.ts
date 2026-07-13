import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { ModelManifest } from "../../shared/model-manifest";

export type LoadedModelManifest = {
  manifest: ModelManifest;
  manifestPath: string;
  sourceRoot: string;
  managedMotionRoot: string;
  sourceRelativePaths: ReadonlySet<string>;
  managedMotionRelativePaths: ReadonlySet<string>;
};

const MANIFEST_FILE_NAME = "model-manifest.json";

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid model manifest field: ${fieldName}`);
  }

  return value;
}

function normalizeModelRelativePath(relativePath: string): string {
  if (
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new Error(`invalid model manifest path: ${relativePath}`);
  }

  const normalized = path.posix.normalize(relativePath);

  if (
    normalized !== relativePath ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".."
  ) {
    throw new Error(`invalid model manifest path: ${relativePath}`);
  }

  return normalized;
}

function addManifestPath(allowedPaths: Set<string>, value: unknown, fieldName: string): void {
  allowedPaths.add(normalizeModelRelativePath(assertString(value, fieldName)));
}

function addManifestPathList(allowedPaths: Set<string>, value: unknown, fieldName: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`invalid model manifest field: ${fieldName}`);
  }

  value.forEach((entry, index) => {
    addManifestPath(allowedPaths, entry, `${fieldName}[${index}]`);
  });
}

function addManifestPathMap(allowedPaths: Set<string>, value: unknown, fieldName: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid model manifest field: ${fieldName}`);
  }

  Object.entries(value).forEach(([key, entry]) => {
    addManifestPath(allowedPaths, entry, `${fieldName}.${key}`);
  });
}

function addManifestMotionPresetPaths(allowedPaths: Set<string>, value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`invalid model manifest field: ${fieldName}`);
  }

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`invalid model manifest field: ${fieldName}[${index}]`);
    }

    const relativePath = normalizeModelRelativePath(
      assertString((entry as { path?: unknown }).path, `${fieldName}[${index}].path`)
    );

    if (!relativePath.endsWith(".motion3.json")) {
      throw new Error(`invalid model manifest path: ${fieldName}[${index}].path`);
    }

    allowedPaths.add(relativePath);
  });
}

function getManifestPath(modelId: string): string {
  if (!/^[a-z0-9-]+$/u.test(modelId)) {
    throw new Error(`invalid model id: ${modelId}`);
  }

  return path.resolve(process.cwd(), "resources", "models", modelId, MANIFEST_FILE_NAME);
}

export function loadModelManifest(modelId: string): LoadedModelManifest {
  const manifestPath = getManifestPath(modelId);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ModelManifest;
  const manifestDir = path.dirname(manifestPath);
  const sourceDir = assertString(manifest.sourceDir, "sourceDir");
  const sourceRoot = path.resolve(manifestDir, sourceDir);
  const sourceRelativePaths = new Set<string>();
  const managedMotionRelativePaths = new Set<string>();

  addManifestPath(sourceRelativePaths, manifest.model3, "model3");
  addManifestPath(sourceRelativePaths, manifest.moc3, "moc3");
  addManifestPath(sourceRelativePaths, manifest.physics, "physics");
  addManifestPath(sourceRelativePaths, manifest.displayInfo, "displayInfo");
  addManifestPath(sourceRelativePaths, manifest.idleMotion, "idleMotion");
  addManifestMotionPresetPaths(managedMotionRelativePaths, manifest.motionPresets, "motionPresets");
  addManifestPathList(sourceRelativePaths, manifest.textures, "textures");
  addManifestPathMap(sourceRelativePaths, manifest.expressions, "expressions");

  for (const relativePath of managedMotionRelativePaths) {
    if (sourceRelativePaths.has(relativePath)) {
      throw new Error(`ambiguous model manifest asset path: ${relativePath}`);
    }
  }

  return {
    manifest,
    manifestPath,
    sourceRoot,
    managedMotionRoot: manifestDir,
    sourceRelativePaths,
    managedMotionRelativePaths
  };
}
