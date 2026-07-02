import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT_ENV = "AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT";
const BUNDLED_ROOT_ENV = "AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT";
const MANIFEST_NAME = "manifest.json";
const REVIEW_ROOT = ".tmp/p2-20o-release-review";
const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const REQUIRED_MODEL_RELEASE_FIELDS = ["repo", "file", "revision", "license", "format", "quantization"];
const REQUIRED_RUNTIME_RELEASE_FIELDS = ["repo", "releaseTag", "commit", "assetName", "platform", "backend", "license"];
const SOURCE_URLS = [
  "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct",
  "https://qwenlm.github.io/blog/qwen2.5/",
  "https://www.apache.org/licenses/LICENSE-2.0",
  "https://github.com/ggml-org/llama.cpp",
  "https://github.com/ggml-org/llama.cpp/releases",
  "https://github.com/ggml-org/llama.cpp/blob/master/LICENSE"
];

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function auditProductionLocalLlmArtifact(options = {}) {
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const env = options.env ?? process.env;
  const candidate = resolveResourceRoot(repoRoot, env, options.resourceRoot);
  const outputRoot = resolveOutputRoot(repoRoot, options.outputRoot);
  const blockers = [];
  const warnings = [];
  const artifacts = [];

  if (!isExistingDirectory(candidate.root)) {
    blockers.push("source_pack_missing");
    return finishReview({ candidate, blockers, warnings, artifacts, repoRoot, outputRoot, write: options.write === true });
  }

  const manifestPath = join(candidate.root, MANIFEST_NAME);

  if (!isExistingFile(manifestPath)) {
    blockers.push("manifest_missing");
    return finishReview({ candidate, blockers, warnings, artifacts, repoRoot, outputRoot, write: options.write === true });
  }

  const manifestRead = readJsonObject(manifestPath);

  if (!manifestRead.ok) {
    blockers.push(manifestRead.reason);
    return finishReview({ candidate, blockers, warnings, artifacts, repoRoot, outputRoot, write: options.write === true });
  }

  const manifest = manifestRead.value;
  const runtimeEntry = readManifestRuntime(manifest);
  const modelEntry = readManifestModel(manifest);
  const noticesRelativePath = readNonEmptyString(manifest.licenseNotices);
  const resolvedRuntime = resolveManifestFile(candidate.root, runtimeEntry.path);
  const resolvedModel = resolveManifestFile(candidate.root, modelEntry.path);
  const resolvedNotices = resolveManifestFile(candidate.root, noticesRelativePath);

  if (!runtimeEntry.path || !resolvedRuntime.ok) {
    blockers.push(resolvedRuntime.reason ?? "runtime_path_missing");
  }

  if (!modelEntry.path || !resolvedModel.ok) {
    blockers.push(resolvedModel.reason ?? "model_path_missing");
  }

  if (!noticesRelativePath || !resolvedNotices.ok) {
    blockers.push(resolvedNotices.reason ?? "notices_path_missing");
  }

  if (blockers.length === 0) {
    if (!isExistingFile(resolvedRuntime.path)) {
      blockers.push("runtime_executable_missing");
    }

    if (!isExistingFile(resolvedModel.path)) {
      blockers.push("model_file_missing");
    }

    if (!isExistingFile(resolvedNotices.path)) {
      blockers.push("notices_file_missing");
    } else if (isLikelyPlaceholderNotices(resolvedNotices.path)) {
      blockers.push("notices_placeholder");
    }
  }

  if (blockers.length === 0) {
    const runtimeArtifact = await buildArtifact(candidate.root, resolvedRuntime.path, "runtime_executable");
    const modelArtifact = await buildArtifact(candidate.root, resolvedModel.path, "model");
    const noticesArtifact = await buildArtifact(candidate.root, resolvedNotices.path, "notices");
    const manifestArtifact = await buildArtifact(candidate.root, manifestPath, "runtime_manifest");
    const dllArtifacts = await buildRuntimeDllArtifacts(candidate.root, dirname(resolvedRuntime.path));

    artifacts.push(runtimeArtifact, ...dllArtifacts, modelArtifact, noticesArtifact, manifestArtifact);
    validateExpectedIntegrity(runtimeEntry, runtimeArtifact, "runtime", blockers);
    validateExpectedIntegrity(modelEntry, modelArtifact, "model", blockers);
  }

  const release = manifest.release && typeof manifest.release === "object" && !Array.isArray(manifest.release)
    ? manifest.release
    : null;
  validateReleaseMetadata(release, blockers, warnings);

  return finishReview({
    candidate,
    blockers,
    warnings,
    artifacts,
    release,
    repoRoot,
    outputRoot,
    write: options.write === true
  });
}

function resolveResourceRoot(repoRoot, env, explicitRoot) {
  const sourceRoot = readNonEmptyString(explicitRoot) ?? readNonEmptyString(env[SOURCE_ROOT_ENV]);

  if (sourceRoot) {
    return {
      root: resolve(sourceRoot),
      source: "localSourceEnv"
    };
  }

  const bundledRoot = readNonEmptyString(env[BUNDLED_ROOT_ENV]);

  if (bundledRoot) {
    return {
      root: resolve(bundledRoot),
      source: "bundledEnv"
    };
  }

  return {
    root: join(repoRoot, "resources", "local-llm"),
    source: "repoDefault"
  };
}

function resolveOutputRoot(repoRoot, outputRoot) {
  return outputRoot ? resolve(outputRoot) : join(repoRoot, REVIEW_ROOT);
}

async function finishReview({ candidate, blockers, warnings, artifacts, release, repoRoot, outputRoot, write }) {
  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";
  const releaseManifest = createReleaseManifest({
    status,
    blockers,
    warnings,
    artifacts,
    release,
    sourceRootName: basename(candidate.root)
  });

  const leakCheck = assertNoUnsafeStrings(releaseManifest);

  if (!leakCheck.ok) {
    blockers.push("unsafe_release_manifest_content");
  }

  const finalStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";
  releaseManifest.status = finalStatus;
  releaseManifest.ok = finalStatus === "ready";
  releaseManifest.blockers = blockers;
  releaseManifest.warnings = warnings;

  const writtenArtifacts = write
    ? writeReviewArtifacts(repoRoot, outputRoot, releaseManifest, artifacts)
    : [];
  const summary = createSummary({
    candidate,
    status: finalStatus,
    blockers,
    warnings,
    artifacts,
    release,
    writtenArtifacts
  });

  return {
    ok: finalStatus === "ready",
    status: finalStatus,
    summary,
    releaseManifest,
    checksumsText: createSha256Sums(artifacts)
  };
}

function createSummary({ candidate, status, blockers, warnings, artifacts, release, writtenArtifacts }) {
  return removeUndefined({
    ok: status === "ready",
    status,
    phase: "P2-20O",
    audit: "production_local_llm_artifact",
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    resourceSource: candidate.source,
    resourceRootName: basename(candidate.root),
    blockers,
    warnings,
    model: release?.model ? safeReleaseModel(release.model) : undefined,
    runtime: release?.runtime ? safeReleaseRuntime(release.runtime) : undefined,
    legalReviewStatus: safeStatus(release?.legalReviewStatus),
    artifacts: artifacts.map(safeArtifactSummary),
    writtenArtifacts
  });
}

function createReleaseManifest({ status, blockers, warnings, artifacts, release, sourceRootName }) {
  return removeUndefined({
    manifestVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    artifactKind: "production-local-llm",
    ok: status === "ready",
    status,
    sourceRootName,
    model: release?.model ? {
      ...safeReleaseModel(release.model),
      sha256: findArtifact(artifacts, "model")?.sha256,
      sizeBytes: findArtifact(artifacts, "model")?.sizeBytes
    } : undefined,
    runtime: release?.runtime ? {
      ...safeReleaseRuntime(release.runtime),
      executable: safeArtifactSummary(findArtifact(artifacts, "runtime_executable")),
      dlls: artifacts.filter((artifact) => artifact.kind === "runtime_dll").map(safeArtifactSummary)
    } : undefined,
    notices: safeArtifactSummary(findArtifact(artifacts, "notices")),
    runtimeManifest: safeArtifactSummary(findArtifact(artifacts, "runtime_manifest")),
    artifacts: artifacts.map(safeArtifactSummary),
    privacyRedaction: {
      localPaths: "forbidden",
      secrets: "forbidden",
      modelInputs: "forbidden",
      conversationBodies: "forbidden",
      memoryBodies: "forbidden"
    },
    sources: SOURCE_URLS,
    verification: {
      commands: [
        "npm.cmd run audit:production-local-llm-artifact",
        "npm.cmd run validate:local-llm",
        "npm.cmd run verify"
      ],
      result: status
    },
    legalReviewStatus: safeStatus(release?.legalReviewStatus),
    blockers,
    warnings
  });
}

function writeReviewArtifacts(repoRoot, outputRoot, releaseManifest, artifacts) {
  mkdirSync(outputRoot, { recursive: true });
  const manifestPath = join(outputRoot, "release-manifest.json");
  const checksumsPath = join(outputRoot, "SHA256SUMS.txt");

  writeFileSync(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");
  writeFileSync(checksumsPath, createSha256Sums(artifacts), "utf8");

  return [
    { basename: "release-manifest.json", relativePath: normalizeForManifest(relative(repoRoot, manifestPath)), status: "written" },
    { basename: "SHA256SUMS.txt", relativePath: normalizeForManifest(relative(repoRoot, checksumsPath)), status: "written" }
  ];
}

function createSha256Sums(artifacts) {
  return artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.relativePath}`)
    .sort((left, right) => left.localeCompare(right))
    .join("\n") + (artifacts.length > 0 ? "\n" : "");
}

function readManifestRuntime(manifest) {
  const platformRuntime = readPlatformRuntime(manifest.platforms);

  if (platformRuntime.path) {
    return platformRuntime;
  }

  if (manifest.runtime && typeof manifest.runtime === "object" && !Array.isArray(manifest.runtime)) {
    return {
      path: readNonEmptyString(manifest.runtime.executablePath) ?? readNonEmptyString(manifest.runtime.executable) ?? readNonEmptyString(manifest.runtime.path),
      sizeBytes: manifest.runtime.sizeBytes,
      sha256: manifest.runtime.sha256
    };
  }

  const explicitPath = readNonEmptyString(manifest.executablePath) ?? readNonEmptyString(manifest.executable);

  return {
    path: explicitPath,
    sizeBytes: manifest.runtimeSizeBytes,
    sha256: manifest.runtimeSha256
  };
}

function readPlatformRuntime(platforms) {
  if (!platforms || typeof platforms !== "object") {
    return { path: null };
  }

  const entry = platforms[PLATFORM_KEY] ?? platforms["win32-x64"];

  if (typeof entry === "string") {
    return { path: readNonEmptyString(entry) };
  }

  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return {
      path: readNonEmptyString(entry.executable) ?? readNonEmptyString(entry.executablePath) ?? readNonEmptyString(entry.path),
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256
    };
  }

  return { path: null };
}

function readManifestModel(manifest) {
  const firstModel = Array.isArray(manifest.models) ? manifest.models[0] : manifest.model;

  if (typeof firstModel === "string") {
    return {
      path: readNonEmptyString(firstModel),
      sizeBytes: manifest.modelSizeBytes,
      sha256: manifest.modelSha256
    };
  }

  if (firstModel && typeof firstModel === "object") {
    return {
      path: readNonEmptyString(firstModel.path) ?? readNonEmptyString(firstModel.modelPath),
      sizeBytes: firstModel.sizeBytes,
      sha256: firstModel.sha256
    };
  }

  return {
    path: readNonEmptyString(manifest.modelPath),
    sizeBytes: manifest.modelSizeBytes,
    sha256: manifest.modelSha256
  };
}

function validateReleaseMetadata(release, blockers, warnings) {
  if (!release) {
    blockers.push("release_metadata_missing");
    return;
  }

  if (!readNonEmptyString(release.legalReviewStatus)) {
    blockers.push("legal_review_status_missing");
  } else if (release.legalReviewStatus !== "approved") {
    warnings.push("legal_review_not_approved");
  }

  for (const field of REQUIRED_MODEL_RELEASE_FIELDS) {
    if (!readNonEmptyString(release.model?.[field])) {
      blockers.push(`model_release_${field}_missing`);
    }
  }

  for (const field of REQUIRED_RUNTIME_RELEASE_FIELDS) {
    if (!readNonEmptyString(release.runtime?.[field])) {
      blockers.push(`runtime_release_${field}_missing`);
    }
  }
}

function validateExpectedIntegrity(entry, artifact, prefix, blockers) {
  const expectedSize = readNonNegativeInteger(entry.sizeBytes);
  const expectedSha256 = readSha256(entry.sha256);

  if (expectedSize === null) {
    blockers.push(`${prefix}_size_missing_or_invalid`);
  } else if (expectedSize !== artifact.sizeBytes) {
    blockers.push(`${prefix}_size_mismatch`);
  }

  if (!expectedSha256) {
    blockers.push(`${prefix}_sha256_missing_or_invalid`);
  } else if (expectedSha256 !== artifact.sha256) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
}

async function buildRuntimeDllArtifacts(root, runtimeDirectory) {
  const entries = readdirSync(runtimeDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".dll")
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => buildArtifact(root, join(runtimeDirectory, entry.name), "runtime_dll"));

  return Promise.all(entries);
}

async function buildArtifact(root, filePath, kind) {
  const stat = statSync(filePath);
  return {
    kind,
    basename: basename(filePath),
    relativePath: normalizeForManifest(relative(root, filePath)),
    sha256: await sha256File(filePath),
    sizeBytes: stat.size,
    status: "present"
  };
}

function resolveManifestFile(root, relativePath) {
  const value = readNonEmptyString(relativePath);

  if (!value) {
    return { ok: false, reason: "manifest_path_missing" };
  }

  if (isAbsolute(value) || value.includes("\0")) {
    return { ok: false, reason: "manifest_unsafe_path" };
  }

  const normalized = normalize(value).replace(/[\\/]+/g, sep);

  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    return { ok: false, reason: "manifest_unsafe_path" };
  }

  const rootPath = resolve(root);
  const resolvedPath = resolve(rootPath, normalized);
  const rootPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;

  if (resolvedPath !== rootPath && !resolvedPath.startsWith(rootPrefix)) {
    return { ok: false, reason: "manifest_unsafe_path" };
  }

  return {
    ok: true,
    path: resolvedPath,
    relativePath: normalizeForManifest(relative(rootPath, resolvedPath))
  };
}

function isLikelyPlaceholderNotices(filePath) {
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  return text.length === 0 ||
    /Fill this file before packaging/i.test(text) ||
    /template/i.test(text) ||
    /TODO|TBD|replace-with/i.test(text);
}

function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "manifest_invalid_json" };
    }

    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof SyntaxError ? "manifest_invalid_json" : "manifest_read_failed" };
  }
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

function safeArtifactSummary(artifact) {
  if (!artifact) {
    return undefined;
  }

  return {
    kind: artifact.kind,
    basename: artifact.basename,
    relativePath: artifact.relativePath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    status: artifact.status
  };
}

function safeReleaseModel(model) {
  return {
    repo: readNonEmptyString(model.repo),
    baseModelRepo: readNonEmptyString(model.baseModelRepo),
    file: readNonEmptyString(model.file),
    revision: readNonEmptyString(model.revision),
    license: readNonEmptyString(model.license),
    licenseUrl: readNonEmptyString(model.licenseUrl),
    format: readNonEmptyString(model.format),
    quantization: readNonEmptyString(model.quantization)
  };
}

function safeReleaseRuntime(runtime) {
  return {
    name: readNonEmptyString(runtime.name),
    repo: readNonEmptyString(runtime.repo),
    releaseTag: readNonEmptyString(runtime.releaseTag),
    commit: readNonEmptyString(runtime.commit),
    assetName: readNonEmptyString(runtime.assetName),
    platform: readNonEmptyString(runtime.platform),
    backend: readNonEmptyString(runtime.backend),
    license: readNonEmptyString(runtime.license),
    licenseUrl: readNonEmptyString(runtime.licenseUrl)
  };
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

function findArtifact(artifacts, kind) {
  return artifacts.find((artifact) => artifact.kind === kind);
}

function normalizeForManifest(path) {
  return path.replace(/\\/g, "/");
}

function safeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) ? text : undefined;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditProductionLocalLlmArtifact({
    write: process.argv.includes("--write")
  })
    .then((result) => printJson(result.summary))
    .catch((error) => {
      printJson({
        ok: false,
        status: "script_failed",
        phase: "P2-20O",
        audit: "production_local_llm_artifact",
        safeSummaryOnly: true,
        reason: error instanceof Error ? error.name : "unexpected_error"
      });
    });
}
