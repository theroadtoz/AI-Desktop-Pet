import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  downloadChunkedGgufModel,
  defaultChunkBytes,
  defaultChunkTimeoutMs,
  defaultMaxRetriesPerChunk
} from "./lib/p2-23c-chunked-gguf-downloader.mjs";

export const packRootEnv = "P2_23C_LOCAL_LLM_PACK_ROOT";
export const llamaServerPathEnv = "P2_23C_LLAMA_SERVER_PATH";
export const modelGgufPathEnv = "P2_23C_MODEL_GGUF_PATH";
export const modelDownloadTimeoutMsEnv = "P2_23C_MODEL_DOWNLOAD_TIMEOUT_MS";
export const modelDownloadChunkBytesEnv = "P2_23C_MODEL_DOWNLOAD_CHUNK_BYTES";
export const modelDownloadMaxRetriesEnv = "P2_23C_MODEL_DOWNLOAD_MAX_RETRIES";
export const modelDownloadMaxChunksEnv = "P2_23C_MODEL_DOWNLOAD_MAX_CHUNKS";
export const modelDownloadMaxBytesEnv = "P2_23C_MODEL_DOWNLOAD_MAX_BYTES";
export const modelDownloadMaxDurationMsEnv = "P2_23C_MODEL_DOWNLOAD_MAX_DURATION_MS";
export const packRootName = "p2-23c-qwen25-15b-local-llm";

const runtimeName = "llama.cpp";
const platformKey = "win32-x64";
const executableName = "llama-server.exe";
const modelRepo = "Qwen/Qwen2.5-1.5B-Instruct-GGUF";
const modelFileName = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const modelAlias = "qwen2.5-1.5b-instruct-q4_k_m";
const expectedModelSizeBytes = 1_117_320_736;
const modelDownloadURL =
  `https://huggingface.co/${modelRepo}/resolve/main/${modelFileName}?download=true`;

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function getDefaultPackRoot(repoRoot = getRepoRoot()) {
  return join(repoRoot, ".tmp", packRootName);
}

export async function prepareQwen25LocalLlmPack(options = {}) {
  const startedAt = Date.now();
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const env = options.env ?? process.env;
  const packRoot = resolvePackRoot(repoRoot, env);

  assertSafePackRoot(packRoot, repoRoot);

  const llamaServerPath = resolveLlamaServerPath(env);

  if (!llamaServerPath) {
    return {
      ok: false,
      summary: createSummary(packRoot, "blocked", {
        reason: "llama_server_missing",
        expectedExecutableName: executableName,
        durationMs: Date.now() - startedAt
      })
    };
  }

  const layout = createPackLayout(packRoot);

  rmSync(layout.runtimeRoot, { recursive: true, force: true });
  mkdirSync(layout.runtimeRoot, { recursive: true });
  mkdirSync(layout.modelsRoot, { recursive: true });
  mkdirSync(layout.licensesRoot, { recursive: true });

  const runtimeFiles = copyRuntimeFiles(llamaServerPath, layout.runtimeRoot);
  const modelExpectedSizeBytes = readPositiveInteger(options.expectedModelSizeBytes) ?? expectedModelSizeBytes;
  const modelResult = await ensureModelFile(layout.modelPath, {
    env,
    expectedSizeBytes: modelExpectedSizeBytes,
    fetchImpl: options.fetch,
    downloadURL: options.modelDownloadURL ?? modelDownloadURL,
    downloadTimeoutMs: resolveDownloadTimeoutMs(options.downloadTimeoutMs, env),
    downloadChunkBytes: resolveDownloadChunkBytes(options.downloadChunkBytes, env),
    downloadMaxRetriesPerChunk: resolveDownloadMaxRetriesPerChunk(options.downloadMaxRetriesPerChunk, env),
    downloadMaxChunks: resolveOptionalPositiveInteger(options.downloadMaxChunks, env[modelDownloadMaxChunksEnv]),
    downloadMaxBytes: resolveOptionalPositiveInteger(options.downloadMaxBytes, env[modelDownloadMaxBytesEnv]),
    downloadMaxDurationMs: resolveDownloadMaxDurationMs(options.downloadMaxDurationMs, env)
  });

  if (!modelResult.ok) {
    return {
      ok: false,
      summary: createSummary(packRoot, "blocked", {
        ...modelResult.summary,
        durationMs: Date.now() - startedAt
      })
    };
  }

  const modelSource = modelResult.source;
  const runtimeIntegrity = await fileIntegrity(layout.executablePath);
  const modelIntegrity = await fileIntegrity(layout.modelPath);

  if (modelIntegrity.sizeBytes !== modelExpectedSizeBytes) {
    return {
      ok: false,
      summary: createSummary(packRoot, "blocked", {
        reason: "model_size_mismatch",
        expectedModelSizeBytes: modelExpectedSizeBytes,
        actualModelSizeBytes: modelIntegrity.sizeBytes,
        modelName: basename(layout.modelPath),
        durationMs: Date.now() - startedAt
      })
    };
  }

  writeManifest(layout.manifestPath, {
    runtimeIntegrity,
    modelIntegrity
  });
  writeThirdPartyNotices(layout.noticesPath, {
    runtimeFiles,
    modelSha256: modelIntegrity.sha256,
    expectedModelSizeBytes: modelExpectedSizeBytes
  });

  return {
    ok: true,
    summary: createSummary(packRoot, "ready", {
      runtime: runtimeName,
      executableName: basename(layout.executablePath),
      runtimeDllCount: runtimeFiles.dlls.length,
      modelName: basename(layout.modelPath),
      modelSource,
      modelSourceBasename: modelResult.sourceBasename,
      modelSizeBytes: modelIntegrity.sizeBytes,
      modelSha256: modelIntegrity.sha256,
      runtimeSizeBytes: runtimeIntegrity.sizeBytes,
      runtimeSha256: runtimeIntegrity.sha256,
      manifestName: basename(layout.manifestPath),
      noticesName: basename(layout.noticesPath),
      durationMs: Date.now() - startedAt
    })
  };
}

export function assertSafePackRoot(candidateRoot, repoRoot = getRepoRoot()) {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const resolvedRoot = resolve(candidateRoot);
  const tmpPrefix = tmpRoot.endsWith(sep) ? tmpRoot : `${tmpRoot}${sep}`;

  if (resolvedRoot === tmpRoot || !resolvedRoot.startsWith(tmpPrefix)) {
    throw new Error("p2_23c_pack_root_outside_repo_tmp");
  }
}

function resolvePackRoot(repoRoot, env) {
  const envRoot = readNonEmpty(env[packRootEnv]);
  return envRoot ? resolve(process.cwd(), envRoot) : getDefaultPackRoot(repoRoot);
}

function resolveLlamaServerPath(env) {
  const envPath = readNonEmpty(env[llamaServerPathEnv]);
  const resolvedEnvPath = envPath ? resolve(process.cwd(), envPath) : null;

  if (resolvedEnvPath && isExistingFile(resolvedEnvPath) && basename(resolvedEnvPath).toLowerCase() === executableName) {
    return resolvedEnvPath;
  }

  const discovered = findOnPath(executableName, env);
  return discovered && isExistingFile(discovered) ? discovered : null;
}

function findOnPath(command, env) {
  const where = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(where, [command], {
    env: createChildEnv(env),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

function createPackLayout(packRoot) {
  const runtimeRoot = join(packRoot, "runtime", platformKey);
  const modelsRoot = join(packRoot, "models");
  const licensesRoot = join(packRoot, "licenses");

  return {
    runtimeRoot,
    modelsRoot,
    licensesRoot,
    executablePath: join(runtimeRoot, executableName),
    modelPath: join(modelsRoot, "model.gguf"),
    manifestPath: join(packRoot, "manifest.json"),
    noticesPath: join(licensesRoot, "THIRD_PARTY_NOTICES.md")
  };
}

function copyRuntimeFiles(llamaServerPath, runtimeRoot) {
  const sourceDir = dirname(llamaServerPath);
  const files = readdirSync(sourceDir, { withFileTypes: true });
  const copiedDlls = [];

  copyFile(llamaServerPath, join(runtimeRoot, executableName));

  for (const file of files) {
    if (!file.isFile() || extname(file.name).toLowerCase() !== ".dll") {
      continue;
    }

    copyFile(join(sourceDir, file.name), join(runtimeRoot, file.name));
    copiedDlls.push(file.name);
  }

  copiedDlls.sort((left, right) => left.localeCompare(right));

  return {
    executable: executableName,
    dlls: copiedDlls
  };
}

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

async function ensureModelFile(modelPath, details) {
  if (isExistingFile(modelPath) && statSync(modelPath).size === details.expectedSizeBytes) {
    return {
      ok: true,
      source: "reused",
      sourceBasename: basename(modelPath)
    };
  }

  const importPath = readNonEmpty(details.env[modelGgufPathEnv]);

  if (importPath) {
    return importModelFile(modelPath, importPath, details.expectedSizeBytes);
  }

  rmSync(modelPath, { force: true });
  return downloadModel(modelPath, details);
}

async function importModelFile(modelPath, sourcePath, expectedSizeBytes) {
  const resolvedSourcePath = resolve(process.cwd(), sourcePath);
  const sourceBasename = basename(resolvedSourcePath);

  if (extname(sourceBasename).toLowerCase() !== ".gguf") {
    return createBlockedModelResult("model_import_not_gguf", {
      source: "import_env",
      sourceBasename,
      expectedModelSizeBytes: expectedSizeBytes
    });
  }

  if (!isExistingFile(resolvedSourcePath)) {
    return createBlockedModelResult("model_import_missing", {
      source: "import_env",
      sourceBasename,
      expectedModelSizeBytes: expectedSizeBytes
    });
  }

  const sourceIntegrity = await fileIntegrity(resolvedSourcePath);

  if (sourceIntegrity.sizeBytes !== expectedSizeBytes) {
    return createBlockedModelResult("model_import_size_mismatch", {
      source: "import_env",
      sourceBasename,
      expectedModelSizeBytes: expectedSizeBytes,
      actualModelSizeBytes: sourceIntegrity.sizeBytes,
      modelSha256: sourceIntegrity.sha256
    });
  }

  mkdirSync(dirname(modelPath), { recursive: true });
  copyFileSync(resolvedSourcePath, modelPath);

  return {
    ok: true,
    source: "imported",
    sourceBasename,
    sizeBytes: sourceIntegrity.sizeBytes,
    sha256: sourceIntegrity.sha256
  };
}

async function downloadModel(modelPath, details) {
  return downloadChunkedGgufModel({
    destinationPath: modelPath,
    expectedSizeBytes: details.expectedSizeBytes,
    fetchImpl: details.fetchImpl ?? globalThis.fetch,
    downloadURL: details.downloadURL,
    chunkBytes: details.downloadChunkBytes,
    maxRetriesPerChunk: details.downloadMaxRetriesPerChunk,
    timeoutMs: details.downloadTimeoutMs,
    maxChunks: details.downloadMaxChunks,
    maxBytes: details.downloadMaxBytes,
    maxDurationMs: details.downloadMaxDurationMs
  });
}

function createBlockedModelResult(reason, details) {
  return {
    ok: false,
    summary: removeUndefined({
      reason,
      modelName: "model.gguf",
      ...details
    })
  };
}

async function fileIntegrity(filePath) {
  return {
    sizeBytes: statSync(filePath).size,
    sha256: await sha256File(filePath)
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

function writeManifest(manifestPath, integrity) {
  const manifest = {
    version: 1,
    runtime: runtimeName,
    platforms: {
      [platformKey]: {
        executable: `runtime/${platformKey}/${executableName}`,
        sizeBytes: integrity.runtimeIntegrity.sizeBytes,
        sha256: integrity.runtimeIntegrity.sha256
      }
    },
    model: {
      path: "models/model.gguf",
      alias: modelAlias,
      displayName: "Qwen2.5 1.5B Instruct Q4_K_M",
      ctxSize: 2048,
      sizeBytes: integrity.modelIntegrity.sizeBytes,
      sha256: integrity.modelIntegrity.sha256
    },
    startupTimeoutMs: 90000,
    stopTimeoutMs: 5000,
    healthPollIntervalMs: 200,
    licenseNotices: "licenses/THIRD_PARTY_NOTICES.md",
    summary: {
      safeSummaryOnly: true,
      runtime: runtimeName,
      platform: platformKey,
      executableName,
      modelRepo,
      modelFileName,
      modelSizeBytes: integrity.modelIntegrity.sizeBytes,
      modelSha256: integrity.modelIntegrity.sha256
    }
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function writeThirdPartyNotices(noticesPath, details) {
  const dllList = details.runtimeFiles.dlls.length > 0
    ? details.runtimeFiles.dlls.map((name) => `- ${name}`).join("\n")
    : "- No DLL files were copied.";

  const content = `# Third Party Notices

Generated for the P2-23C local-only Qwen2.5 1.5B local LLM pack.

This notice intentionally records package names, source URLs, and checksums only.
It does not include local absolute paths.

## llama.cpp runtime

- Project: llama.cpp
- License: MIT
- Source URL: https://github.com/ggerganov/llama.cpp
- Packaged executable: ${details.runtimeFiles.executable}
- Binary provenance: copied from the local machine-provided llama.cpp runtime directory.

## Qwen2.5 1.5B Instruct GGUF model

- Model repository: ${modelRepo}
- Model file: ${modelFileName}
- Packaged file: models/model.gguf
- Expected size: ${details.expectedModelSizeBytes} bytes
- Packaged SHA-256: ${details.modelSha256}
- License: Apache-2.0, per the upstream Qwen2.5 model repository metadata.
- Source URL: https://huggingface.co/${modelRepo}
- Redistribution notes: verify the upstream model card and license before shipping a public installer.

## Additional runtime libraries

${dllList}
`;

  writeFileSync(noticesPath, content, "utf8");
}

function createSummary(packRoot, status, details) {
  const summary = removeUndefined({
    ok: status === "ready",
    status,
    safeSummaryOnly: true,
    ...details
  });

  return status === "blocked" ? filterSafeBlockedSummary(summary) : summary;
}

function filterSafeBlockedSummary(summary) {
  const allowedKeys = new Set([
    "ok",
    "status",
    "reason",
    "modelName",
    "modelSource",
    "source",
    "partialSizeBytes",
    "expectedModelSizeBytes",
    "chunkStartBytes",
    "chunkEndBytes",
    "chunkBytes",
    "attempt",
    "maxRetriesPerChunk",
    "timeoutMs",
    "errorName",
    "durationMs",
    "safeSummaryOnly"
  ]);

  return Object.fromEntries(
    Object.entries(summary).filter(([key]) => allowedKeys.has(key))
  );
}

function createChildEnv(sourceEnv) {
  const env = {};

  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec"]) {
    if (typeof sourceEnv[key] === "string") {
      env[key] = sourceEnv[key];
    }
  }

  return env;
}

function isExistingFile(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function readNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveDownloadTimeoutMs(optionValue, env) {
  return readPositiveInteger(optionValue)
    ?? readPositiveIntegerText(env[modelDownloadTimeoutMsEnv])
    ?? defaultChunkTimeoutMs;
}

function resolveDownloadChunkBytes(optionValue, env) {
  return readPositiveInteger(optionValue)
    ?? readPositiveIntegerText(env[modelDownloadChunkBytesEnv])
    ?? defaultChunkBytes;
}

function resolveDownloadMaxRetriesPerChunk(optionValue, env) {
  return readPositiveInteger(optionValue)
    ?? readPositiveIntegerText(env[modelDownloadMaxRetriesEnv])
    ?? defaultMaxRetriesPerChunk;
}

function resolveDownloadMaxDurationMs(optionValue, env) {
  return readPositiveInteger(optionValue)
    ?? readPositiveIntegerText(env[modelDownloadMaxDurationMsEnv])
    ?? resolveDownloadTimeoutMs(undefined, env);
}

function resolveOptionalPositiveInteger(optionValue, envValue) {
  return readPositiveInteger(optionValue)
    ?? readPositiveIntegerText(envValue)
    ?? undefined;
}

function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readPositiveIntegerText(value) {
  const text = readNonEmpty(value);

  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function printSummary(summary) {
  if (summary.ok === false) {
    process.exitCode = 1;
  }

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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareQwen25LocalLlmPack()
    .then((result) => printSummary(result.summary))
    .catch((error) => {
      printSummary({
        ok: false,
        status: "script_failed",
        runtime: runtimeName,
        safeSummaryOnly: true,
        reason: error instanceof Error && error.message === "p2_23c_pack_root_outside_repo_tmp"
          ? error.message
          : classifyScriptError(error)
      });
      process.exitCode = 1;
    });
}

function classifyScriptError(error) {
  if (error instanceof Error && /^model_download_http_\d+$/.test(error.message)) {
    return error.message;
  }

  return error instanceof Error ? error.name : "unexpected_error";
}
