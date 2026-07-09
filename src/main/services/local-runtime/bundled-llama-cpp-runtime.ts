import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { LlamaCppRuntimeSafeSummary } from "../../../shared/llama-cpp-runtime";
import type { LlamaCppRuntimeConfig } from "./llama-cpp-runtime";

export type BundledLlamaCppResourceSource = "env" | "development" | "packaged";

export type BundledLlamaCppRuntimeConfig = LlamaCppRuntimeConfig & {
  enabled: true;
  executablePath: string;
  modelPath: string;
};

export type BundledLlamaCppRuntimeResolveStatus =
  | LlamaCppRuntimeSafeSummary["status"]
  | "ready"
  | "missing_root"
  | "missing_manifest"
  | "invalid_manifest"
  | "missing_binary"
  | "missing_model";

export type BundledLlamaCppRuntimeSafeSummary = Omit<
  LlamaCppRuntimeSafeSummary,
  "status" | "reason"
> & {
  bundled: true;
  status: BundledLlamaCppRuntimeResolveStatus;
  resourceSource: BundledLlamaCppResourceSource;
  resourceRootName?: string;
  manifestFound: boolean;
  reason?:
    | LlamaCppRuntimeSafeSummary["reason"]
    | "env_root_missing"
    | "resource_root_missing"
    | "manifest_missing"
    | "manifest_read_failed"
    | "manifest_invalid_json"
    | "manifest_missing_runtime"
    | "manifest_missing_model"
    | "manifest_unsafe_path"
    | "binary_missing"
    | "model_missing"
    | "invalid_model_extension";
};

export type BundledLlamaCppRuntimeResolveResult = {
  config: BundledLlamaCppRuntimeConfig | null;
  safeSummary: BundledLlamaCppRuntimeSafeSummary;
};

export type BundledLlamaCppRuntimeResolveOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  resourcesPath?: string;
};

type ManifestModel = {
  path?: unknown;
  modelPath?: unknown;
  alias?: unknown;
  displayName?: unknown;
  ctxSize?: unknown;
};

type ManifestRuntime = {
  path?: unknown;
  executablePath?: unknown;
};

type ManifestPlatformRuntime = {
  executable?: unknown;
  executablePath?: unknown;
  path?: unknown;
};

type Manifest = {
  runtime?: unknown;
  platforms?: unknown;
  executablePath?: unknown;
  executable?: unknown;
  model?: unknown;
  models?: unknown;
  modelPath?: unknown;
  alias?: unknown;
  host?: unknown;
  port?: unknown;
  ctxSize?: unknown;
  startupTimeoutMs?: unknown;
  stopTimeoutMs?: unknown;
  healthPollIntervalMs?: unknown;
};

type CandidateRoot = {
  root: string;
  source: BundledLlamaCppResourceSource;
  envOverride: boolean;
};

const BUNDLED_ROOT_ENV = "AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT";
const MANIFEST_NAME = "manifest.json";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_ALIAS = "ai-desktop-pet-local";
const DEFAULT_CTX_SIZE = 2048;
const MAX_ALIAS_LENGTH = 128;
const MAX_HOST_LENGTH = 253;

export function resolveBundledLlamaCppRuntime(
  options: BundledLlamaCppRuntimeResolveOptions = {}
): BundledLlamaCppRuntimeResolveResult {
  const env = options.env ?? process.env;
  const candidate = findCandidateRoot(options);

  if (!candidate || !isExistingDirectory(candidate.root)) {
    return createMissingRootResult(candidate ?? createDefaultCandidate(options, env));
  }

  const manifestPath = join(candidate.root, MANIFEST_NAME);

  if (!isExistingFile(manifestPath)) {
    return createResult(candidate, "missing_manifest", {
      manifestFound: false,
      reason: "manifest_missing"
    });
  }

  const manifest = readManifest(manifestPath);

  if (!manifest.ok) {
    return createResult(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: manifest.reason
    });
  }

  const runtimePath = readManifestRuntimePath(manifest.value);
  const model = readManifestModel(manifest.value);

  if (!runtimePath) {
    return createResult(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: "manifest_missing_runtime"
    });
  }

  if (!model.path) {
    return createResult(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: "manifest_missing_model"
    });
  }

  const executablePath = resolveSafeResourcePath(candidate.root, runtimePath);
  const modelPath = resolveSafeResourcePath(candidate.root, model.path);

  if (!executablePath || !modelPath) {
    return createResult(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: "manifest_unsafe_path"
    });
  }

  if (!isExistingFile(executablePath)) {
    return createResult(candidate, "missing_binary", {
      manifestFound: true,
      reason: "binary_missing",
      executableName: basename(executablePath)
    });
  }

  if (!isExistingFile(modelPath)) {
    return createResult(candidate, "missing_model", {
      manifestFound: true,
      reason: "model_missing",
      executableName: basename(executablePath),
      modelName: basename(modelPath)
    });
  }

  if (!modelPath.toLowerCase().endsWith(".gguf")) {
    return createResult(candidate, "missing_model", {
      manifestFound: true,
      reason: "invalid_model_extension",
      executableName: basename(executablePath),
      modelName: basename(modelPath)
    });
  }

  const alias = normalizeAlias(model.alias ?? manifest.value.alias);
  const host = normalizeHost(manifest.value.host);
  const port = readPositiveInteger(manifest.value.port);
  const ctxSize = readPositiveInteger(model.ctxSize ?? manifest.value.ctxSize) ?? DEFAULT_CTX_SIZE;
  const startupTimeoutMs = readPositiveInteger(manifest.value.startupTimeoutMs);
  const stopTimeoutMs = readPositiveInteger(manifest.value.stopTimeoutMs);
  const healthPollIntervalMs = readPositiveInteger(manifest.value.healthPollIntervalMs);
  const config: BundledLlamaCppRuntimeConfig = {
    enabled: true,
    executablePath,
    modelPath,
    host,
    ...(port ? { port } : {}),
    ctxSize,
    alias,
    ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
    ...(stopTimeoutMs ? { stopTimeoutMs } : {}),
    ...(healthPollIntervalMs ? { healthPollIntervalMs } : {})
  };

  return {
    config,
    safeSummary: createSummary(candidate, "ready", {
      manifestFound: true,
      executableConfigured: true,
      modelConfigured: true,
      executableName: basename(executablePath),
      modelName: basename(modelPath),
      host,
      ...(port ? { port } : {}),
      ctxSize,
      alias
    })
  };
}

function findCandidateRoot(options: BundledLlamaCppRuntimeResolveOptions): CandidateRoot | null {
  const env = options.env ?? process.env;
  const envRoot = readNonEmptyString(env[BUNDLED_ROOT_ENV]);

  if (envRoot) {
    return {
      root: envRoot,
      source: "env",
      envOverride: true
    };
  }

  const cwd = options.cwd ?? process.cwd();
  const developmentRoot = join(cwd, "resources", "local-llm");
  const developmentCacheRoot = join(cwd, ".tmp", "p2-23c-qwen25-15b-local-llm");

  if (isExistingFile(join(developmentRoot, MANIFEST_NAME))) {
    return {
      root: developmentRoot,
      source: "development",
      envOverride: false
    };
  }

  if (isExistingFile(join(developmentCacheRoot, MANIFEST_NAME))) {
    return {
      root: developmentCacheRoot,
      source: "development",
      envOverride: false
    };
  }

  if (isExistingDirectory(developmentRoot)) {
    return {
      root: developmentRoot,
      source: "development",
      envOverride: false
    };
  }

  const resourcesPath = options.resourcesPath ?? readProcessResourcesPath();
  const packagedRoot = resourcesPath ? join(resourcesPath, "local-llm") : "";

  return {
    root: packagedRoot || developmentRoot,
    source: packagedRoot ? "packaged" : "development",
    envOverride: false
  };
}

function createDefaultCandidate(
  options: BundledLlamaCppRuntimeResolveOptions,
  env: NodeJS.ProcessEnv
): CandidateRoot {
  const envRoot = readNonEmptyString(env[BUNDLED_ROOT_ENV]);

  if (envRoot) {
    return {
      root: envRoot,
      source: "env",
      envOverride: true
    };
  }

  const resourcesPath = options.resourcesPath ?? readProcessResourcesPath();

  return {
    root: resourcesPath ? join(resourcesPath, "local-llm") : join(options.cwd ?? process.cwd(), "resources", "local-llm"),
    source: resourcesPath ? "packaged" : "development",
    envOverride: false
  };
}

function createMissingRootResult(candidate: CandidateRoot): BundledLlamaCppRuntimeResolveResult {
  return createResult(candidate, "missing_root", {
    manifestFound: false,
    reason: candidate.envOverride ? "env_root_missing" : "resource_root_missing"
  });
}

function createResult(
  candidate: CandidateRoot,
  status: Exclude<BundledLlamaCppRuntimeResolveStatus, "ready">,
  details: Partial<BundledLlamaCppRuntimeSafeSummary>
): BundledLlamaCppRuntimeResolveResult {
  return {
    config: null,
    safeSummary: createSummary(candidate, status, {
      executableConfigured: false,
      modelConfigured: false,
      ...details
    })
  };
}

function createSummary(
  candidate: CandidateRoot,
  status: BundledLlamaCppRuntimeResolveStatus,
  details: Partial<BundledLlamaCppRuntimeSafeSummary>
): BundledLlamaCppRuntimeSafeSummary {
  return removeUndefined({
    runtime: "llama.cpp",
    bundled: true,
    enabled: true,
    status,
    safeSummaryOnly: true,
    resourceSource: candidate.source,
    resourceRootName: basename(candidate.root),
    manifestFound: false,
    executableConfigured: false,
    modelConfigured: false,
    ...details
  }) as BundledLlamaCppRuntimeSafeSummary;
}

function readManifest(filePath: string): {
  ok: true;
  value: Manifest;
} | {
  ok: false;
  reason: "manifest_read_failed" | "manifest_invalid_json";
} {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return { ok: false, reason: "manifest_invalid_json" };
    }

    return {
      ok: true,
      value: parsed as Manifest
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof SyntaxError ? "manifest_invalid_json" : "manifest_read_failed"
    };
  }
}

function readManifestRuntimePath(manifest: Manifest): string | null {
  const platformRuntimePath = readPlatformRuntimePath(manifest.platforms);

  if (platformRuntimePath) {
    return platformRuntimePath;
  }

  if (manifest.runtime && typeof manifest.runtime === "object") {
    const runtime = manifest.runtime as ManifestRuntime;
    return readNonEmptyString(runtime.executablePath) ?? readNonEmptyString(runtime.path);
  }

  const explicitPath = readNonEmptyString(manifest.executablePath) ?? readNonEmptyString(manifest.executable);

  if (explicitPath) {
    return explicitPath;
  }

  const runtimeValue = readNonEmptyString(manifest.runtime);

  return runtimeValue && (runtimeValue.includes("/") || runtimeValue.includes("\\") || runtimeValue.endsWith(".exe"))
    ? runtimeValue
    : null;
}

function readPlatformRuntimePath(platforms: unknown): string | null {
  if (!platforms || typeof platforms !== "object") {
    return null;
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const platformRuntime = (platforms as Record<string, unknown>)[platformKey];

  if (typeof platformRuntime === "string") {
    return readNonEmptyString(platformRuntime);
  }

  if (platformRuntime && typeof platformRuntime === "object") {
    const runtime = platformRuntime as ManifestPlatformRuntime;
    return readNonEmptyString(runtime.executable) ??
      readNonEmptyString(runtime.executablePath) ??
      readNonEmptyString(runtime.path);
  }

  return null;
}

function readManifestModel(manifest: Manifest): {
  path: string | null;
  alias?: unknown;
  ctxSize?: unknown;
} {
  const firstModel = Array.isArray(manifest.models) ? manifest.models[0] : manifest.model;

  if (typeof firstModel === "string") {
    return {
      path: readNonEmptyString(firstModel),
      alias: manifest.alias,
      ctxSize: manifest.ctxSize
    };
  }

  if (firstModel && typeof firstModel === "object") {
    const model = firstModel as ManifestModel;

    return {
      path: readNonEmptyString(model.path) ?? readNonEmptyString(model.modelPath),
      alias: model.alias ?? model.displayName ?? manifest.alias,
      ctxSize: model.ctxSize ?? manifest.ctxSize
    };
  }

  return {
    path: readNonEmptyString(manifest.modelPath),
    alias: manifest.alias,
    ctxSize: manifest.ctxSize
  };
}

function resolveSafeResourcePath(root: string, relativePath: string): string | null {
  if (isAbsolute(relativePath) || relativePath.includes("\0")) {
    return null;
  }

  const normalizedRelativePath = normalize(relativePath).replace(/[\\/]+/g, sep);

  if (
    normalizedRelativePath === "." ||
    normalizedRelativePath.startsWith(`..${sep}`) ||
    normalizedRelativePath === ".."
  ) {
    return null;
  }

  const rootPath = resolve(root);
  const resolvedPath = resolve(rootPath, normalizedRelativePath);
  const rootPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;

  return resolvedPath === rootPath || resolvedPath.startsWith(rootPrefix)
    ? resolvedPath
    : null;
}

function isExistingDirectory(path: string): boolean {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(path: string): boolean {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function readProcessResourcesPath(): string | null {
  const value = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return readNonEmptyString(value);
}

function normalizeHost(value: unknown): string {
  const host = readNonEmptyString(value);

  if (
    !host ||
    host.length > MAX_HOST_LENGTH ||
    /[\u0000-\u001f\u007f/:\\\s]/.test(host)
  ) {
    return DEFAULT_HOST;
  }

  return host;
}

function normalizeAlias(value: unknown): string {
  const alias = readNonEmptyString(value);

  if (
    !alias ||
    alias.length > MAX_ALIAS_LENGTH ||
    /^[A-Za-z]:/.test(alias) ||
    /[\u0000-\u001f\u007f\\/]/.test(alias)
  ) {
    return DEFAULT_ALIAS;
  }

  return alias;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}
