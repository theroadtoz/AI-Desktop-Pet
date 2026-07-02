import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditProductionLocalLlmArtifact } from "./p2-20o-production-local-llm-artifact-review.mjs";

export const MODEL_CANDIDATE = Object.freeze({
  repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  baseModelRepo: "Qwen/Qwen2.5-1.5B-Instruct",
  revision: "91cad51170dc346986eccefdc2dd33a9da36ead9",
  file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  sizeBytes: 1_117_320_736,
  sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
  license: "Apache-2.0",
  licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  format: "GGUF",
  quantization: "Q4_K_M",
  downloadUrl:
    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf"
});

export const RUNTIME_CANDIDATE = Object.freeze({
  name: "llama.cpp",
  repo: "ggml-org/llama.cpp",
  releaseTag: "b9859",
  commit: "4fc4ec5541b243957ae5099edb67372f8f3b550e",
  assetName: "llama-b9859-bin-win-cpu-x64.zip",
  assetSizeBytes: 17_478_474,
  assetSha256: "c9aa80f233a7d1749341860f11723b912d4cfd6eec19434c3d00bba0abc9f85c",
  platform: "win32-x64",
  backend: "CPU",
  license: "MIT",
  licenseUrl: "https://github.com/ggml-org/llama.cpp/blob/master/LICENSE",
  downloadUrl: "https://github.com/ggml-org/llama.cpp/releases/download/b9859/llama-b9859-bin-win-cpu-x64.zip"
});

const WORK_ROOT_NAME = "p2-20p-production-local-llm-pack-assembly-dry-run";
const PHASE = "P2-20P";
const ASSEMBLY_NAME = "production_local_llm_pack_assembly_dry_run";
const PLATFORM_KEY = "win32-x64";
const EXECUTABLE_NAME = "llama-server.exe";
const MODEL_ALIAS = "qwen2.5-1.5b-instruct-q4_k_m";

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function getDefaultWorkRoot(repoRoot = getRepoRoot()) {
  return join(repoRoot, ".tmp", WORK_ROOT_NAME);
}

export function getDefaultPackRoot(repoRoot = getRepoRoot()) {
  return join(getDefaultWorkRoot(repoRoot), "resources", "local-llm");
}

export async function assembleProductionLocalLlmPackDryRun(options = {}) {
  const startedAt = Date.now();
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const workRoot = options.workRoot ? resolve(options.workRoot) : getDefaultWorkRoot(repoRoot);
  const packRoot = options.packRoot ? resolve(options.packRoot) : join(workRoot, "resources", "local-llm");
  const outputRoot = options.outputRoot ? resolve(options.outputRoot) : join(workRoot, "review");
  const downloadsRoot = join(workRoot, "downloads");
  const extractRoot = join(workRoot, "extracted-runtime");
  const keepTmp = options.keepTmp === true;
  const legalReviewStatus = readSafeStatus(options.legalReviewStatus) ?? "pending";
  const modelCandidate = normalizeModelCandidate(options.modelCandidate);
  const runtimeCandidate = normalizeRuntimeCandidate(options.runtimeCandidate);
  const cleanupTargets = [extractRoot, outputRoot, packRoot, workRoot];
  let finalResult;

  assertSafeTmpRoot(workRoot, repoRoot, "p2_20p_work_root_outside_repo_tmp");
  assertSafeTmpRoot(packRoot, repoRoot, "p2_20p_pack_root_outside_repo_tmp");
  assertSafeTmpRoot(outputRoot, repoRoot, "p2_20p_output_root_outside_repo_tmp");

  try {
    const identityBlocker = validateProductionIdentity(modelCandidate, runtimeCandidate);

    if (identityBlocker) {
      finalResult = createBlockedResult({
        reason: identityBlocker,
        modelCandidate,
        runtimeCandidate,
        legalReviewStatus,
        workRoot,
        durationMs: Date.now() - startedAt
      });
      return finalResult;
    }

    const layout = createPackLayout(packRoot);

    rmSync(packRoot, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
    rmSync(extractRoot, { recursive: true, force: true });
    mkdirSync(layout.runtimeRoot, { recursive: true });
    mkdirSync(layout.modelsRoot, { recursive: true });
    mkdirSync(layout.licensesRoot, { recursive: true });
    mkdirSync(downloadsRoot, { recursive: true });

    const modelSource = await stageModel({
      candidate: modelCandidate,
      downloadsRoot,
      destinationPath: layout.modelPath,
      sourceModelPath: options.sourceModelPath ?? options.modelSourcePath,
      fetchImpl: options.fetch
    });

    if (!modelSource.ok) {
      finalResult = createBlockedResult({
        reason: modelSource.reason,
        blockers: modelSource.blockers,
        modelCandidate,
        runtimeCandidate,
        legalReviewStatus,
        modelSource,
        workRoot,
        durationMs: Date.now() - startedAt
      });
      return finalResult;
    }

    const runtimeSource = await stageRuntime({
      candidate: runtimeCandidate,
      downloadsRoot,
      extractRoot,
      destinationRoot: layout.runtimeRoot,
      sourceRuntimeDir: options.sourceRuntimeDir ?? options.runtimeSourceDir,
      sourceRuntimeZipPath: options.sourceRuntimeZipPath ?? options.runtimeZipPath,
      fetchImpl: options.fetch
    });

    if (!runtimeSource.ok) {
      finalResult = createBlockedResult({
        reason: runtimeSource.reason,
        blockers: runtimeSource.blockers,
        modelCandidate,
        runtimeCandidate,
        legalReviewStatus,
        modelSource,
        runtimeSource,
        workRoot,
        durationMs: Date.now() - startedAt
      });
      return finalResult;
    }

    const runtimeIntegrity = await fileIntegrity(layout.executablePath);
    const modelIntegrity = await fileIntegrity(layout.modelPath);

    writeThirdPartyNotices(layout.noticesPath, {
      modelCandidate,
      runtimeCandidate,
      modelIntegrity,
      runtimeIntegrity,
      runtimeDllNames: runtimeSource.dllNames
    });
    writeManifest(layout.manifestPath, {
      modelCandidate,
      runtimeCandidate,
      runtimeIntegrity,
      modelIntegrity,
      legalReviewStatus
    });

    const review = await auditProductionLocalLlmArtifact({
      repoRoot,
      resourceRoot: packRoot,
      outputRoot,
      write: true
    });
    const summary = createSummary({
      status: review.status,
      ok: review.ok,
      modelCandidate,
      runtimeCandidate,
      legalReviewStatus,
      modelSource,
      runtimeSource,
      review,
      workRoot,
      packRoot,
      outputRoot,
      keepTmp,
      durationMs: Date.now() - startedAt
    });
    const safeCheck = assertNoUnsafeStrings({
      summary,
      releaseManifest: review.releaseManifest,
      checksumsText: review.checksumsText
    });

    if (!safeCheck.ok) {
      rmSync(outputRoot, { recursive: true, force: true });
      finalResult = createBlockedResult({
        reason: "unsafe_dry_run_output_content",
        modelCandidate,
        runtimeCandidate,
        legalReviewStatus,
        modelSource,
        runtimeSource,
        workRoot,
        durationMs: Date.now() - startedAt
      });
      return finalResult;
    }

    finalResult = {
      ok: review.ok,
      status: review.status,
      summary,
      review
    };

    return finalResult;
  } finally {
    if (keepTmp) {
      if (finalResult?.summary) {
        finalResult.summary.cleanup = {
          tmp: "kept",
          workRootName: basename(workRoot)
        };
      }
    } else {
      cleanupRunTargets(cleanupTargets, repoRoot);

      if (finalResult?.summary) {
        finalResult.summary.cleanup = {
          tmp: "removed",
          workRootName: basename(workRoot)
        };
      }
    }
  }
}

export function assertSafeTmpRoot(candidateRoot, repoRoot = getRepoRoot(), reason = "p2_20p_root_outside_repo_tmp") {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const resolvedRoot = resolve(candidateRoot);
  const tmpPrefix = tmpRoot.endsWith(sep) ? tmpRoot : `${tmpRoot}${sep}`;

  if (resolvedRoot === tmpRoot || !resolvedRoot.startsWith(tmpPrefix)) {
    throw new Error(reason);
  }
}

function createPackLayout(packRoot) {
  const runtimeRoot = join(packRoot, "runtime", PLATFORM_KEY);
  const modelsRoot = join(packRoot, "models");
  const licensesRoot = join(packRoot, "licenses");

  return {
    runtimeRoot,
    modelsRoot,
    licensesRoot,
    executablePath: join(runtimeRoot, EXECUTABLE_NAME),
    modelPath: join(modelsRoot, "model.gguf"),
    noticesPath: join(licensesRoot, "THIRD_PARTY_NOTICES.md"),
    manifestPath: join(packRoot, "manifest.json")
  };
}

async function stageModel({ candidate, downloadsRoot, destinationPath, sourceModelPath, fetchImpl }) {
  const sourcePath = readNonEmptyString(sourceModelPath)
    ? resolve(sourceModelPath)
    : join(downloadsRoot, candidate.file);
  const sourceKind = readNonEmptyString(sourceModelPath) ? "fixture" : "public_download";
  let downloaded = false;

  if (sourceKind === "public_download") {
    const existingCheck = await checkCandidateFile(sourcePath, candidate);

    if (!existingCheck.ok) {
      rmSync(sourcePath, { force: true });
      await downloadFile(candidate.downloadUrl, sourcePath, fetchImpl, "model");
      downloaded = true;
    }
  }

  if (!isExistingFile(sourcePath)) {
    return {
      ok: false,
      reason: "model_source_missing",
      blockers: ["model_source_missing"]
    };
  }

  const integrityCheck = await checkCandidateFile(sourcePath, candidate);

  if (!integrityCheck.ok) {
    return {
      ok: false,
      reason: integrityCheck.reason,
      blockers: [integrityCheck.reason],
      expectedSizeBytes: candidate.sizeBytes,
      actualSizeBytes: integrityCheck.actualSizeBytes,
      expectedSha256: candidate.sha256,
      actualSha256: integrityCheck.actualSha256
    };
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);

  return {
    ok: true,
    source: sourceKind === "fixture" ? "fixture_model_file" : downloaded ? "downloaded_public_model" : "reused_public_model",
    basename: basename(candidate.file),
    sha256: candidate.sha256,
    sizeBytes: candidate.sizeBytes
  };
}

async function stageRuntime({
  candidate,
  downloadsRoot,
  extractRoot,
  destinationRoot,
  sourceRuntimeDir,
  sourceRuntimeZipPath,
  fetchImpl
}) {
  const sourceDir = readNonEmptyString(sourceRuntimeDir)
    ? resolve(sourceRuntimeDir)
    : null;

  if (sourceDir) {
    return copyRuntimeFromDirectory(sourceDir, destinationRoot, "fixture_runtime_dir");
  }

  const zipPath = readNonEmptyString(sourceRuntimeZipPath)
    ? resolve(sourceRuntimeZipPath)
    : join(downloadsRoot, candidate.assetName);
  const zipKind = readNonEmptyString(sourceRuntimeZipPath) ? "fixture_runtime_zip" : "public_runtime_zip";
  let downloaded = false;

  if (zipKind === "public_runtime_zip") {
    const existingCheck = await checkRuntimeZip(zipPath, candidate);

    if (!existingCheck.ok) {
      rmSync(zipPath, { force: true });
      await downloadFile(candidate.downloadUrl, zipPath, fetchImpl, "runtime_zip");
      downloaded = true;
    }
  }

  if (!isExistingFile(zipPath)) {
    return {
      ok: false,
      reason: "runtime_zip_missing",
      blockers: ["runtime_zip_missing"]
    };
  }

  const zipCheck = await checkRuntimeZip(zipPath, candidate);

  if (!zipCheck.ok) {
    return {
      ok: false,
      reason: zipCheck.reason,
      blockers: [zipCheck.reason],
      expectedAssetSizeBytes: candidate.assetSizeBytes,
      actualAssetSizeBytes: zipCheck.actualSizeBytes,
      expectedAssetSha256: candidate.assetSha256,
      actualAssetSha256: zipCheck.actualSha256
    };
  }

  expandZip(zipPath, extractRoot);

  const executablePath = findFileRecursive(extractRoot, EXECUTABLE_NAME);

  if (!executablePath) {
    return {
      ok: false,
      reason: "runtime_executable_missing_in_zip",
      blockers: ["runtime_executable_missing_in_zip"]
    };
  }

  return copyRuntimeFromDirectory(dirname(executablePath), destinationRoot, zipKind === "fixture_runtime_zip"
    ? "fixture_runtime_zip"
    : downloaded
      ? "downloaded_public_runtime_zip"
      : "reused_public_runtime_zip");
}

function copyRuntimeFromDirectory(sourceDir, destinationRoot, source) {
  const executablePath = join(sourceDir, EXECUTABLE_NAME);

  if (!isExistingFile(executablePath)) {
    return {
      ok: false,
      reason: "runtime_executable_missing_in_source",
      blockers: ["runtime_executable_missing_in_source"]
    };
  }

  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true });
  copyFileSync(executablePath, join(destinationRoot, EXECUTABLE_NAME));

  const dllNames = readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".dll")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const dllName of dllNames) {
    copyFileSync(join(sourceDir, dllName), join(destinationRoot, dllName));
  }

  return {
    ok: true,
    source,
    executableName: EXECUTABLE_NAME,
    dllNames,
    dllCount: dllNames.length
  };
}

async function checkCandidateFile(filePath, candidate) {
  if (!isExistingFile(filePath)) {
    return {
      ok: false,
      reason: "model_source_missing"
    };
  }

  const integrity = await fileIntegrity(filePath);

  if (integrity.sizeBytes !== candidate.sizeBytes) {
    return {
      ok: false,
      reason: "model_size_mismatch",
      actualSizeBytes: integrity.sizeBytes,
      actualSha256: integrity.sha256
    };
  }

  if (integrity.sha256 !== candidate.sha256) {
    return {
      ok: false,
      reason: "model_sha256_mismatch",
      actualSizeBytes: integrity.sizeBytes,
      actualSha256: integrity.sha256
    };
  }

  return {
    ok: true,
    existing: true,
    actualSizeBytes: integrity.sizeBytes,
    actualSha256: integrity.sha256
  };
}

async function checkRuntimeZip(filePath, candidate) {
  if (!isExistingFile(filePath)) {
    return {
      ok: false,
      reason: "runtime_zip_missing"
    };
  }

  const integrity = await fileIntegrity(filePath);

  if (integrity.sizeBytes !== candidate.assetSizeBytes) {
    return {
      ok: false,
      reason: "runtime_zip_size_mismatch",
      actualSizeBytes: integrity.sizeBytes,
      actualSha256: integrity.sha256
    };
  }

  if (integrity.sha256 !== candidate.assetSha256) {
    return {
      ok: false,
      reason: "runtime_zip_sha256_mismatch",
      actualSizeBytes: integrity.sizeBytes,
      actualSha256: integrity.sha256
    };
  }

  return {
    ok: true,
    existing: true,
    actualSizeBytes: integrity.sizeBytes,
    actualSha256: integrity.sha256
  };
}

async function downloadFile(url, destinationPath, fetchImpl, kind) {
  const fetchFn = fetchImpl ?? globalThis.fetch;

  if (typeof fetchFn !== "function") {
    throw new Error(`${kind}_download_unavailable`);
  }

  const tempPath = `${destinationPath}.download`;

  rmSync(tempPath, { force: true });
  mkdirSync(dirname(destinationPath), { recursive: true });

  const response = await fetchFn(url, {
    headers: {
      "User-Agent": "AI_Desktop_Pet/P2-20P production-local-llm-dry-run"
    }
  });

  if (!response?.ok || !response.body) {
    throw new Error(`${kind}_download_http_${Number.isInteger(response?.status) ? response.status : 0}`);
  }

  const sourceStream = typeof response.body.getReader === "function"
    ? Readable.fromWeb(response.body)
    : response.body;

  await pipeline(sourceStream, createWriteStream(tempPath));
  renameSync(tempPath, destinationPath);
}

function expandZip(zipPath, destinationRoot) {
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Expand-Archive -LiteralPath '${escapePowerShellSingleQuoted(zipPath)}' -DestinationPath '${escapePowerShellSingleQuoted(destinationRoot)}' -Force`
  ].join("; ");

  for (const command of ["powershell.exe", "pwsh"]) {
    const result = spawnSync(command, [
      "-NoProfile",
      "-Command",
      script
    ], {
      encoding: "utf8",
      windowsHide: true
    });

    if (result.error?.code === "ENOENT") {
      continue;
    }

    if (result.status === 0) {
      return;
    }
  }

  throw new Error("runtime_zip_extract_failed");
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function findFileRecursive(root, fileName) {
  if (!isExistingDirectory(root)) {
    return null;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);

    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const nested = findFileRecursive(entryPath, fileName);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function writeManifest(manifestPath, details) {
  const manifest = {
    version: 1,
    runtime: details.runtimeCandidate.name,
    platforms: {
      [PLATFORM_KEY]: {
        executable: `runtime/${PLATFORM_KEY}/${EXECUTABLE_NAME}`,
        sizeBytes: details.runtimeIntegrity.sizeBytes,
        sha256: details.runtimeIntegrity.sha256
      }
    },
    model: {
      path: "models/model.gguf",
      alias: MODEL_ALIAS,
      displayName: "Qwen2.5 1.5B Instruct Q4_K_M",
      ctxSize: 2048,
      sizeBytes: details.modelIntegrity.sizeBytes,
      sha256: details.modelIntegrity.sha256
    },
    startupTimeoutMs: 90000,
    stopTimeoutMs: 5000,
    healthPollIntervalMs: 200,
    licenseNotices: "licenses/THIRD_PARTY_NOTICES.md",
    release: {
      artifactKind: "production-local-llm",
      legalReviewStatus: details.legalReviewStatus,
      model: {
        repo: details.modelCandidate.repo,
        baseModelRepo: details.modelCandidate.baseModelRepo,
        file: details.modelCandidate.file,
        revision: details.modelCandidate.revision,
        license: details.modelCandidate.license,
        licenseUrl: details.modelCandidate.licenseUrl,
        format: details.modelCandidate.format,
        quantization: details.modelCandidate.quantization,
        downloadUrl: details.modelCandidate.downloadUrl,
        sizeBytes: details.modelCandidate.sizeBytes,
        sha256: details.modelCandidate.sha256
      },
      runtime: {
        name: details.runtimeCandidate.name,
        repo: details.runtimeCandidate.repo,
        releaseTag: details.runtimeCandidate.releaseTag,
        commit: details.runtimeCandidate.commit,
        assetName: details.runtimeCandidate.assetName,
        assetSizeBytes: details.runtimeCandidate.assetSizeBytes,
        assetSha256: details.runtimeCandidate.assetSha256,
        platform: details.runtimeCandidate.platform,
        backend: details.runtimeCandidate.backend,
        license: details.runtimeCandidate.license,
        licenseUrl: details.runtimeCandidate.licenseUrl,
        downloadUrl: details.runtimeCandidate.downloadUrl
      }
    },
    summary: {
      safeSummaryOnly: true,
      phase: PHASE,
      runtime: details.runtimeCandidate.name,
      platform: PLATFORM_KEY,
      executableName: EXECUTABLE_NAME,
      modelRepo: details.modelCandidate.repo,
      modelFileName: details.modelCandidate.file,
      modelRevision: details.modelCandidate.revision,
      modelSizeBytes: details.modelIntegrity.sizeBytes,
      modelSha256: details.modelIntegrity.sha256,
      runtimeReleaseTag: details.runtimeCandidate.releaseTag,
      runtimeAssetName: details.runtimeCandidate.assetName,
      legalReviewStatus: details.legalReviewStatus
    }
  };

  writeFileSync(manifestPath, `${JSON.stringify(removeUndefined(manifest), null, 2)}\n`, "utf8");
}

function writeThirdPartyNotices(noticesPath, details) {
  const dllList = details.runtimeDllNames.length > 0
    ? details.runtimeDllNames.map((name) => `- ${name}`).join("\n")
    : "- No DLL files were copied.";
  const content = `# Third Party Notices

Generated for the P2-20P production-like local LLM pack assembly dry run.

This notice records public package names, source URLs, fixed revisions, license names, checksums, and packaged basenames only.
It does not include local absolute paths, secrets, model inputs, conversation bodies, or memory bodies.

## llama.cpp runtime

- Project: llama.cpp
- Repository: https://github.com/${details.runtimeCandidate.repo}
- Release tag: ${details.runtimeCandidate.releaseTag}
- Commit: ${details.runtimeCandidate.commit}
- Release asset: ${details.runtimeCandidate.assetName}
- Release asset SHA-256: ${details.runtimeCandidate.assetSha256}
- Release asset size: ${details.runtimeCandidate.assetSizeBytes} bytes
- Platform: ${details.runtimeCandidate.platform}
- Backend: ${details.runtimeCandidate.backend}
- License: ${details.runtimeCandidate.license}
- License URL: ${details.runtimeCandidate.licenseUrl}
- Packaged executable: ${EXECUTABLE_NAME}
- Packaged executable SHA-256: ${details.runtimeIntegrity.sha256}
- Packaged executable size: ${details.runtimeIntegrity.sizeBytes} bytes

## Qwen2.5 1.5B Instruct GGUF model

- Repository: https://huggingface.co/${details.modelCandidate.repo}
- Base model repository: https://huggingface.co/${details.modelCandidate.baseModelRepo}
- Fixed revision: ${details.modelCandidate.revision}
- Source file: ${details.modelCandidate.file}
- Packaged file: models/model.gguf
- Expected SHA-256: ${details.modelCandidate.sha256}
- Expected size: ${details.modelCandidate.sizeBytes} bytes
- Format: ${details.modelCandidate.format}
- Quantization: ${details.modelCandidate.quantization}
- License: ${details.modelCandidate.license}
- License URL: ${details.modelCandidate.licenseUrl}

## Additional runtime libraries

${dllList}
`;

  writeFileSync(noticesPath, content, "utf8");
}

function createSummary({
  status,
  ok,
  modelCandidate,
  runtimeCandidate,
  legalReviewStatus,
  modelSource,
  runtimeSource,
  review,
  workRoot,
  packRoot,
  outputRoot,
  keepTmp,
  durationMs
}) {
  return removeUndefined({
    ok,
    status,
    phase: PHASE,
    dryRun: ASSEMBLY_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    packRootName: basename(packRoot),
    workRootName: basename(workRoot),
    reviewOutputRootName: basename(outputRoot),
    keepTmp,
    legalReviewStatus,
    model: {
      repo: modelCandidate.repo,
      baseModelRepo: modelCandidate.baseModelRepo,
      file: modelCandidate.file,
      revision: modelCandidate.revision,
      sha256: modelCandidate.sha256,
      sizeBytes: modelCandidate.sizeBytes,
      license: modelCandidate.license,
      source: modelSource.source
    },
    runtime: {
      repo: runtimeCandidate.repo,
      releaseTag: runtimeCandidate.releaseTag,
      commit: runtimeCandidate.commit,
      assetName: runtimeCandidate.assetName,
      assetSha256: runtimeCandidate.assetSha256,
      assetSizeBytes: runtimeCandidate.assetSizeBytes,
      platform: runtimeCandidate.platform,
      backend: runtimeCandidate.backend,
      license: runtimeCandidate.license,
      executableName: runtimeSource.executableName,
      dllCount: runtimeSource.dllCount,
      dllBasenames: runtimeSource.dllNames,
      source: runtimeSource.source
    },
    review: {
      ok: review.ok,
      status: review.status,
      blockers: review.summary.blockers,
      warnings: review.summary.warnings,
      writtenArtifacts: review.summary.writtenArtifacts
    },
    durationMs
  });
}

function createBlockedResult({
  reason,
  blockers,
  modelCandidate,
  runtimeCandidate,
  legalReviewStatus,
  modelSource,
  runtimeSource,
  workRoot,
  durationMs
}) {
  const summary = removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    dryRun: ASSEMBLY_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    reason,
    blockers: blockers ?? [reason],
    legalReviewStatus,
    workRootName: basename(workRoot),
    model: modelCandidate ? {
      repo: modelCandidate.repo,
      file: modelCandidate.file,
      revision: modelCandidate.revision,
      sha256: modelCandidate.sha256,
      sizeBytes: modelCandidate.sizeBytes,
      license: modelCandidate.license,
      source: modelSource?.source
    } : undefined,
    runtime: runtimeCandidate ? {
      repo: runtimeCandidate.repo,
      releaseTag: runtimeCandidate.releaseTag,
      commit: runtimeCandidate.commit,
      assetName: runtimeCandidate.assetName,
      assetSha256: runtimeCandidate.assetSha256,
      assetSizeBytes: runtimeCandidate.assetSizeBytes,
      platform: runtimeCandidate.platform,
      backend: runtimeCandidate.backend,
      license: runtimeCandidate.license,
      source: runtimeSource?.source
    } : undefined,
    durationMs
  });

  return {
    ok: false,
    status: "blocked",
    summary,
    review: null
  };
}

function validateProductionIdentity(modelCandidate, runtimeCandidate) {
  if (!readNonEmptyString(modelCandidate.revision) || /^(main|latest)$/i.test(modelCandidate.revision)) {
    return "model_revision_not_fixed";
  }

  if (!readNonEmptyString(runtimeCandidate.releaseTag) || /^(main|latest)$/i.test(runtimeCandidate.releaseTag)) {
    return "runtime_release_tag_not_fixed";
  }

  if (!readNonEmptyString(runtimeCandidate.commit) || /^(main|latest)$/i.test(runtimeCandidate.commit)) {
    return "runtime_commit_not_fixed";
  }

  return null;
}

function normalizeModelCandidate(overrides) {
  return {
    ...MODEL_CANDIDATE,
    ...(overrides ?? {}),
    sha256: readSha256(overrides?.sha256) ?? MODEL_CANDIDATE.sha256,
    sizeBytes: readNonNegativeInteger(overrides?.sizeBytes) ?? MODEL_CANDIDATE.sizeBytes
  };
}

function normalizeRuntimeCandidate(overrides) {
  return {
    ...RUNTIME_CANDIDATE,
    ...(overrides ?? {}),
    assetSha256: readSha256(overrides?.assetSha256) ?? RUNTIME_CANDIDATE.assetSha256,
    assetSizeBytes: readNonNegativeInteger(overrides?.assetSizeBytes) ?? RUNTIME_CANDIDATE.assetSizeBytes
  };
}

async function fileIntegrity(filePath) {
  const stat = statSync(filePath);

  return {
    sizeBytes: stat.size,
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

function cleanupRunTargets(targets, repoRoot) {
  const uniqueTargets = Array.from(new Set(targets.map((target) => resolve(target))))
    .sort((left, right) => right.length - left.length);

  for (const target of uniqueTargets) {
    assertSafeTmpRoot(target, repoRoot, "p2_20p_cleanup_target_outside_repo_tmp");
    rmSync(target, { recursive: true, force: true });
  }
}

function assertNoUnsafeStrings(value) {
  const text = JSON.stringify(value);
  const forbidden = [
    /[A-Za-z]:\\/,
    /Authorization/i,
    /api[_-]?key/i,
    /token/i,
    /prompt/i,
    /request body/i,
    /user message/i,
    /assistant message/i,
    /fact-card/i
  ];

  return {
    ok: !forbidden.some((pattern) => pattern.test(text))
  };
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

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readSafeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) ? text : null;
}

function readNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
}

function classifyScriptError(error) {
  if (error instanceof Error && /^p2_20p_[a-z0-9_]+$/.test(error.message)) {
    return error.message;
  }

  if (error instanceof Error && /^(model|runtime_zip)_download_(http_\d+|unavailable)$/.test(error.message)) {
    return error.message;
  }

  if (error instanceof Error && error.message === "runtime_zip_extract_failed") {
    return error.message;
  }

  return error instanceof Error ? error.name : "unexpected_error";
}

function parseCliOptions(argv) {
  return {
    keepTmp: argv.includes("--keep-tmp")
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assembleProductionLocalLlmPackDryRun(parseCliOptions(process.argv.slice(2)))
    .then((result) => printJson(result.summary))
    .catch((error) => {
      printJson({
        ok: false,
        status: "script_failed",
        phase: PHASE,
        dryRun: ASSEMBLY_NAME,
        safeSummaryOnly: true,
        exitPolicy: "always_zero",
        reason: classifyScriptError(error)
      });
    });
}
