import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { ModelManifest } from "../../shared/model-manifest";

export type LoadedModelManifest = {
  manifest: ModelManifest;
  manifestPath: string;
  sourceRoot: string;
  allowedRelativePaths: ReadonlySet<string>;
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

  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
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
  const allowedRelativePaths = new Set<string>();

  addManifestPath(allowedRelativePaths, manifest.model3, "model3");
  addManifestPath(allowedRelativePaths, manifest.moc3, "moc3");
  addManifestPath(allowedRelativePaths, manifest.physics, "physics");
  addManifestPath(allowedRelativePaths, manifest.displayInfo, "displayInfo");
  addManifestPath(allowedRelativePaths, manifest.idleMotion, "idleMotion");
  addManifestPathList(allowedRelativePaths, manifest.textures, "textures");
  addManifestPathMap(allowedRelativePaths, manifest.expressions, "expressions");

  return {
    manifest,
    manifestPath,
    sourceRoot,
    allowedRelativePaths
  };
}
