import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, resolve, sep } from "node:path";

const SOURCE_ROOT_ENV = "AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT";
const BUNDLED_ROOT_ENV = "AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT";
const MANIFEST_NAME = "manifest.json";
const runtimeName = "llama.cpp";

async function main() {
  const startedAt = Date.now();
  const candidate = resolveResourceRoot();
  const result = await validateResourcePack(candidate);

  printSummary({
    ...result.summary,
    durationMs: Date.now() - startedAt
  });

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function validateResourcePack(candidate) {
  if (!isExistingDirectory(candidate.root)) {
    return failure(candidate, "missing_root", {
      manifestFound: false,
      reason: candidate.source === "localSourceEnv" || candidate.source === "bundledEnv"
        ? "env_root_missing"
        : "resource_root_missing"
    });
  }

  const manifestPath = join(candidate.root, MANIFEST_NAME);

  if (!isExistingFile(manifestPath)) {
    return failure(candidate, "missing_manifest", {
      manifestFound: false,
      reason: "manifest_missing"
    });
  }

  const manifest = readManifest(manifestPath);

  if (!manifest.ok) {
    return failure(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: manifest.reason
    });
  }

  const runtime = readManifestRuntime(manifest.value);
  const model = readManifestModel(manifest.value);

  if (!runtime.path) {
    return failure(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: "manifest_missing_runtime"
    });
  }

  if (!model.path) {
    return failure(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: "manifest_missing_model"
    });
  }

  const executablePath = resolveSafeResourcePath(candidate.root, runtime.path);
  const modelPath = resolveSafeResourcePath(candidate.root, model.path);
  const noticesPath = readNonEmptyString(manifest.value.licenseNotices);
  const resolvedNoticesPath = noticesPath ? resolveSafeResourcePath(candidate.root, noticesPath) : null;

  if (!executablePath || !modelPath || (noticesPath && !resolvedNoticesPath)) {
    return failure(candidate, "invalid_manifest", {
      manifestFound: true,
      reason: "manifest_unsafe_path"
    });
  }

  if (!isExistingFile(executablePath)) {
    return failure(candidate, "missing_binary", {
      manifestFound: true,
      reason: "binary_missing",
      executableName: basename(executablePath),
      modelName: basename(modelPath)
    });
  }

  if (!isExistingFile(modelPath)) {
    return failure(candidate, "missing_model", {
      manifestFound: true,
      reason: "model_missing",
      executableName: basename(executablePath),
      modelName: basename(modelPath)
    });
  }

  if (!modelPath.toLowerCase().endsWith(".gguf")) {
    return failure(candidate, "missing_model", {
      manifestFound: true,
      reason: "invalid_model_extension",
      executableName: basename(executablePath),
      modelName: basename(modelPath)
    });
  }

  const runtimeIntegrity = await validateIntegrity(executablePath, runtime);
  const modelIntegrity = await validateIntegrity(modelPath, model);

  if (runtimeIntegrity.status === "mismatch" || modelIntegrity.status === "mismatch") {
    return failure(candidate, "integrity_failed", {
      manifestFound: true,
      reason: runtimeIntegrity.status === "mismatch" ? runtimeIntegrity.reason : modelIntegrity.reason,
      executableName: basename(executablePath),
      modelName: basename(modelPath),
      runtimeIntegrity,
      modelIntegrity
    });
  }

  return {
    ok: true,
    summary: createSummary(candidate, "ready", {
      manifestFound: true,
      executableConfigured: true,
      modelConfigured: true,
      executableName: basename(executablePath),
      modelName: basename(modelPath),
      alias: normalizeAlias(model.alias ?? manifest.value.alias),
      ctxSize: readPositiveInteger(model.ctxSize ?? manifest.value.ctxSize),
      runtimeIntegrity,
      modelIntegrity,
      licenseNotices: resolvedNoticesPath
        ? {
            configured: true,
            found: isExistingFile(resolvedNoticesPath),
            name: basename(resolvedNoticesPath)
          }
        : { configured: false }
    })
  };
}

function resolveResourceRoot() {
  const sourceRoot = readNonEmptyString(process.env[SOURCE_ROOT_ENV]);

  if (sourceRoot) {
    return {
      root: sourceRoot,
      source: "localSourceEnv"
    };
  }

  const bundledRoot = readNonEmptyString(process.env[BUNDLED_ROOT_ENV]);

  if (bundledRoot) {
    return {
      root: bundledRoot,
      source: "bundledEnv"
    };
  }

  return {
    root: join(process.cwd(), "resources", "local-llm"),
    source: "repoDefault"
  };
}

function failure(candidate, status, details) {
  return {
    ok: false,
    summary: createSummary(candidate, status, {
      executableConfigured: false,
      modelConfigured: false,
      ...details
    })
  };
}

function createSummary(candidate, status, details) {
  return removeUndefined({
    ok: status === "ready",
    runtime: runtimeName,
    status,
    safeSummaryOnly: true,
    resourceSource: candidate.source,
    resourceRootName: basename(candidate.root),
    manifestFound: false,
    executableConfigured: false,
    modelConfigured: false,
    ...details
  });
}

function readManifest(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "manifest_invalid_json" };
    }

    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof SyntaxError ? "manifest_invalid_json" : "manifest_read_failed"
    };
  }
}

function readManifestRuntime(manifest) {
  const platformRuntime = readPlatformRuntime(manifest.platforms);

  if (platformRuntime.path) {
    return platformRuntime;
  }

  if (manifest.runtime && typeof manifest.runtime === "object") {
    return {
      path: readNonEmptyString(manifest.runtime.executablePath) ?? readNonEmptyString(manifest.runtime.path),
      sizeBytes: manifest.runtime.sizeBytes,
      sha256: manifest.runtime.sha256
    };
  }

  const explicitPath = readNonEmptyString(manifest.executablePath) ?? readNonEmptyString(manifest.executable);

  if (explicitPath) {
    return {
      path: explicitPath,
      sizeBytes: manifest.runtimeSizeBytes,
      sha256: manifest.runtimeSha256
    };
  }

  const runtimeValue = readNonEmptyString(manifest.runtime);

  return {
    path: runtimeValue && (runtimeValue.includes("/") || runtimeValue.includes("\\") || runtimeValue.endsWith(".exe"))
      ? runtimeValue
      : null,
    sizeBytes: manifest.runtimeSizeBytes,
    sha256: manifest.runtimeSha256
  };
}

function readPlatformRuntime(platforms) {
  if (!platforms || typeof platforms !== "object") {
    return { path: null };
  }

  const platformRuntime = platforms[`${process.platform}-${process.arch}`];

  if (typeof platformRuntime === "string") {
    return { path: readNonEmptyString(platformRuntime) };
  }

  if (platformRuntime && typeof platformRuntime === "object") {
    return {
      path: readNonEmptyString(platformRuntime.executable) ??
        readNonEmptyString(platformRuntime.executablePath) ??
        readNonEmptyString(platformRuntime.path),
      sizeBytes: platformRuntime.sizeBytes,
      sha256: platformRuntime.sha256
    };
  }

  return { path: null };
}

function readManifestModel(manifest) {
  const firstModel = Array.isArray(manifest.models) ? manifest.models[0] : manifest.model;

  if (typeof firstModel === "string") {
    return {
      path: readNonEmptyString(firstModel),
      alias: manifest.alias,
      ctxSize: manifest.ctxSize,
      sizeBytes: manifest.modelSizeBytes,
      sha256: manifest.modelSha256
    };
  }

  if (firstModel && typeof firstModel === "object") {
    return {
      path: readNonEmptyString(firstModel.path) ?? readNonEmptyString(firstModel.modelPath),
      alias: firstModel.alias ?? firstModel.displayName ?? manifest.alias,
      ctxSize: firstModel.ctxSize ?? manifest.ctxSize,
      sizeBytes: firstModel.sizeBytes,
      sha256: firstModel.sha256
    };
  }

  return {
    path: readNonEmptyString(manifest.modelPath),
    alias: manifest.alias,
    ctxSize: manifest.ctxSize,
    sizeBytes: manifest.modelSizeBytes,
    sha256: manifest.modelSha256
  };
}

async function validateIntegrity(filePath, manifestEntry) {
  const hasSizeBytes = typeof manifestEntry.sizeBytes !== "undefined";
  const hasSha256 = typeof manifestEntry.sha256 !== "undefined";
  const expectedSize = readNonNegativeInteger(manifestEntry.sizeBytes);
  const expectedSha256 = readSha256(manifestEntry.sha256);

  if (hasSizeBytes && expectedSize === null) {
    return {
      status: "mismatch",
      sizeStatus: "invalid",
      sha256Status: hasSha256 ? "not_checked" : "skipped",
      reason: "invalid_size_bytes"
    };
  }

  if (hasSha256 && !expectedSha256) {
    return {
      status: "mismatch",
      sizeStatus: expectedSize === null ? "skipped" : "not_checked",
      sha256Status: "invalid",
      reason: "invalid_sha256"
    };
  }

  const actualSize = statSync(filePath).size;
  const sizeStatus = expectedSize === null
    ? "skipped"
    : expectedSize === actualSize ? "matched" : "mismatch";

  if (sizeStatus === "mismatch") {
    return {
      status: "mismatch",
      sizeStatus,
      sha256Status: expectedSha256 ? "not_checked" : "skipped",
      reason: "size_mismatch"
    };
  }

  if (!expectedSha256) {
    return {
      status: "ready",
      sizeStatus,
      sha256Status: "skipped"
    };
  }

  const actualSha256 = await sha256File(filePath);
  const sha256Status = actualSha256 === expectedSha256 ? "matched" : "mismatch";

  return {
    status: sha256Status === "matched" ? "ready" : "mismatch",
    sizeStatus,
    sha256Status,
    reason: sha256Status === "mismatch" ? "sha256_mismatch" : undefined
  };
}

function sha256File(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function resolveSafeResourcePath(root, relativePath) {
  if (isAbsolute(relativePath) || relativePath.includes("\0")) {
    return null;
  }

  const normalizedRelativePath = normalize(relativePath).replace(/[\\/]+/g, sep);

  if (
    normalizedRelativePath === "." ||
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith(`..${sep}`)
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

function normalizeAlias(value) {
  const alias = readNonEmptyString(value);
  return alias && !/[\\/]/.test(alias) ? alias : undefined;
}

function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isExistingDirectory(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function printSummary(summary) {
  console.log(JSON.stringify(stripUnsafeStrings(removeUndefined(summary)), null, 2));
}

function stripUnsafeStrings(value) {
  if (Array.isArray(value)) {
    return value.map(stripUnsafeStrings);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      typeof entryValue === "string" && /[A-Za-z]:\\/.test(entryValue)
        ? basename(entryValue)
        : stripUnsafeStrings(entryValue)
    ])
  );
}

function removeUndefined(value) {
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

main().catch((error) => {
  printSummary({
    ok: false,
    runtime: runtimeName,
    status: "script_failed",
    safeSummaryOnly: true,
    reason: error instanceof Error ? error.name : "unexpected_error"
  });
  process.exitCode = 1;
});
