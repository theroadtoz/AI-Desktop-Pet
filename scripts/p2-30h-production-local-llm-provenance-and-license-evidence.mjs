import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODEL_CANDIDATE, RUNTIME_CANDIDATE } from "./p2-20p-production-local-llm-pack-assembly-dry-run.mjs";

const PHASE = "P2-30H";
const AUDIT_NAME = "production_local_llm_provenance_and_license_evidence";
const SOURCE_ROOT_ENV = "AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT";
const DEFAULT_PACK_ROOT = ".tmp/p2-23c-qwen25-15b-local-llm";
const DEFAULT_OUTPUT_ROOT = ".tmp/p2-30h-production-local-llm-provenance-evidence";
const DRAFT_BASENAME = "production-local-llm-provenance-evidence-draft.md";
const EVIDENCE_BASENAME = "production-local-llm-provenance-evidence.json";
const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message|ai message|ai response)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|user memory body)/i;
const REQUIRED_PRODUCTION_BLOCKERS = [
  "production_ready_claim_forbidden",
  "legal_review_not_approved",
  "owner_release_approval_missing",
  "model_license_evidence_not_approved",
  "runtime_license_evidence_not_approved",
  "final_third_party_notices_missing",
  "production_release_not_approved"
];

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function auditProductionLocalLlmProvenanceAndLicenseEvidence(options = {}) {
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const env = options.env ?? process.env;
  const candidate = resolveCandidateRoot(repoRoot, env, options.resourceRoot);
  const modelCandidate = options.modelCandidate ?? MODEL_CANDIDATE;
  const runtimeCandidate = options.runtimeCandidate ?? RUNTIME_CANDIDATE;
  const readyChecks = [];
  const blockers = [...REQUIRED_PRODUCTION_BLOCKERS];
  const warnings = ["local_only_pack_not_production_artifact", "audit_only_no_release_approval"];
  let packState = {
    status: "missing",
    resourceSource: candidate.source,
    resourceRootName: basename(candidate.root)
  };
  let modelProvenance = { status: "blocked", blockers: ["manifest_unavailable"] };
  let runtimeProvenance = { status: "blocked", blockers: ["manifest_unavailable"] };
  let licenseEvidence = { status: "blocked", blockers: ["manifest_unavailable"] };

  if (!isExistingDirectory(candidate.root)) {
    blockers.push("source_pack_missing");
  } else {
    const manifestPath = join(candidate.root, "manifest.json");
    packState = {
      status: "present",
      resourceSource: candidate.source,
      resourceRootName: basename(candidate.root),
      manifest: isExistingFile(manifestPath) ? "present" : "missing"
    };

    if (!isExistingFile(manifestPath)) {
      blockers.push("manifest_missing");
    } else {
      const manifestRead = readJsonObject(manifestPath);

      if (!manifestRead.ok) {
        blockers.push(manifestRead.reason);
        packState = {
          ...packState,
          manifest: manifestRead.reason
        };
      } else {
        const manifest = manifestRead.value;
        modelProvenance = await auditModelProvenance(candidate.root, manifest, modelCandidate);
        runtimeProvenance = await auditRuntimeProvenance(candidate.root, manifest, runtimeCandidate);
        licenseEvidence = await auditLicenseEvidence(candidate.root, manifest, modelCandidate, runtimeCandidate);
        readyChecks.push(...modelProvenance.readyChecks, ...runtimeProvenance.readyChecks, ...licenseEvidence.readyChecks);
        blockers.push(...modelProvenance.blockers, ...runtimeProvenance.blockers, ...licenseEvidence.blockers);
        warnings.push(...modelProvenance.warnings, ...runtimeProvenance.warnings, ...licenseEvidence.warnings);
      }
    }
  }

  const summary = sanitizeForOutput(removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    packState,
    candidateEvidence: {
      model: safeModelCandidate(modelCandidate),
      runtime: safeRuntimeCandidate(runtimeCandidate)
    },
    modelProvenance: stripIssueLists(modelProvenance),
    runtimeProvenance: stripIssueLists(runtimeProvenance),
    licenseEvidence: stripIssueLists(licenseEvidence),
    readyChecks: uniqueIssueCodes(readyChecks),
    blockers: uniqueIssueCodes(blockers),
    warnings: uniqueIssueCodes(warnings),
    nextRequiredSteps: [
      "assemble_candidate_pack_from_pinned_assets_if_runtime_provenance_missing",
      "prepare_final_third_party_notices_for_review",
      "obtain_model_runtime_license_evidence_approval",
      "obtain_owner_and_legal_release_approval"
    ],
    writtenArtifacts: []
  }));
  const unsafeCodes = findUnsafeInputContent(summary);
  const finalSummary = unsafeCodes.length > 0
    ? sanitizeForOutput({
      ...summary,
      blockers: uniqueIssueCodes([...summary.blockers, ...unsafeCodes]),
      readyChecks: uniqueIssueCodes(summary.readyChecks),
      warnings: uniqueIssueCodes(summary.warnings)
    })
    : summary;

  if (options.write === true) {
    const outputRoot = resolveOutputRoot(repoRoot, options.outputRoot);
    assertSafeOutputRoot(repoRoot, outputRoot);
    const writtenArtifacts = writeDraftArtifacts(repoRoot, outputRoot, finalSummary);
    finalSummary.writtenArtifacts = writtenArtifacts;

    if (options.cleanup === true) {
      rmSync(outputRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      finalSummary.writtenArtifacts = writtenArtifacts.map((artifact) => ({
        ...artifact,
        status: "removed_after_cleanup"
      }));
      finalSummary.cleanup = {
        status: "removed",
        outputRootName: basename(outputRoot)
      };
    }
  } else if (options.cleanup === true) {
    const outputRoot = resolveOutputRoot(repoRoot, options.outputRoot);
    assertSafeOutputRoot(repoRoot, outputRoot);
    rmSync(outputRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    finalSummary.cleanup = {
      status: "removed",
      outputRootName: basename(outputRoot)
    };
  }

  return finalSummary;
}

function resolveCandidateRoot(repoRoot, env, explicitRoot) {
  const configuredRoot = readNonEmptyString(explicitRoot) ?? readNonEmptyString(env[SOURCE_ROOT_ENV]);

  if (configuredRoot) {
    return {
      root: resolve(configuredRoot),
      source: "localSourceEnv"
    };
  }

  return {
    root: resolve(repoRoot, DEFAULT_PACK_ROOT),
    source: "repoTmpDefault"
  };
}

async function auditModelProvenance(packRoot, manifest, modelCandidate) {
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const modelEntry = isPlainObject(manifest.model) ? manifest.model : firstPlainObject(manifest.models);
  const modelPath = readNonEmptyString(modelEntry?.path) ?? readNonEmptyString(manifest.modelPath);
  const resolvedModel = resolveManifestFile(packRoot, modelPath);

  if (!resolvedModel.ok) {
    blockers.push(resolvedModel.reason);
    return {
      status: "blocked",
      path: modelPath ? "invalid" : "missing",
      readyChecks,
      blockers,
      warnings
    };
  }

  if (!isExistingFile(resolvedModel.path)) {
    blockers.push("model_file_missing");
    return {
      status: "blocked",
      basename: basename(resolvedModel.path),
      relativePath: normalizeSlashes(relative(packRoot, resolvedModel.path)),
      readyChecks,
      blockers,
      warnings
    };
  }

  const integrity = await fileIntegrity(resolvedModel.path);
  const sizeMatched = integrity.sizeBytes === modelCandidate.sizeBytes;
  const shaMatched = integrity.sha256 === modelCandidate.sha256;
  const manifestSizeMatched = readPositiveInteger(modelEntry?.sizeBytes ?? manifest.modelSizeBytes) === integrity.sizeBytes;
  const manifestShaMatched = readNonEmptyString(modelEntry?.sha256 ?? manifest.modelSha256) === integrity.sha256;
  const releaseModel = isPlainObject(manifest.release?.model) ? manifest.release.model : null;
  const releaseMetadataStatus = releaseModel
    ? candidateModelReleaseMatches(releaseModel, modelCandidate) ? "matches_pinned_candidate" : "mismatch"
    : "missing";

  if (sizeMatched) {
    readyChecks.push("model_candidate_size_matched");
  } else {
    blockers.push("model_candidate_size_mismatch");
  }

  if (shaMatched) {
    readyChecks.push("model_candidate_sha256_matched");
  } else {
    blockers.push("model_candidate_sha256_mismatch");
  }

  if (manifestSizeMatched && manifestShaMatched) {
    readyChecks.push("model_manifest_integrity_matched");
  } else {
    blockers.push("model_manifest_integrity_mismatch");
  }

  if (releaseMetadataStatus === "matches_pinned_candidate") {
    readyChecks.push("model_release_metadata_matches_candidate");
  } else if (releaseMetadataStatus === "mismatch") {
    blockers.push("model_release_metadata_mismatch");
  } else {
    warnings.push("model_release_metadata_missing_but_artifact_matches_candidate");
  }

  return removeUndefined({
    status: blockers.length === 0 ? "matched_pinned_candidate" : "blocked",
    basename: basename(resolvedModel.path),
    relativePath: normalizeSlashes(relative(packRoot, resolvedModel.path)),
    sizeBytes: integrity.sizeBytes,
    sha256: integrity.sha256,
    candidate: safeModelCandidate(modelCandidate),
    releaseMetadataStatus,
    readyChecks,
    blockers,
    warnings
  });
}

async function auditRuntimeProvenance(packRoot, manifest, runtimeCandidate) {
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const runtimeEntry = readManifestRuntime(manifest);
  const resolvedRuntime = resolveManifestFile(packRoot, runtimeEntry.path);

  if (!resolvedRuntime.ok) {
    blockers.push(resolvedRuntime.reason);
    return {
      status: "blocked",
      executable: runtimeEntry.path ? "invalid" : "missing",
      readyChecks,
      blockers,
      warnings
    };
  }

  if (!isExistingFile(resolvedRuntime.path)) {
    blockers.push("runtime_executable_missing");
    return {
      status: "blocked",
      executableName: basename(resolvedRuntime.path),
      readyChecks,
      blockers,
      warnings
    };
  }

  const integrity = await fileIntegrity(resolvedRuntime.path);
  const manifestSizeMatched = readPositiveInteger(runtimeEntry.sizeBytes) === integrity.sizeBytes;
  const manifestShaMatched = readNonEmptyString(runtimeEntry.sha256) === integrity.sha256;
  const releaseRuntime = isPlainObject(manifest.release?.runtime) ? manifest.release.runtime : null;
  const releaseMetadataStatus = releaseRuntime
    ? candidateRuntimeReleaseMatches(releaseRuntime, runtimeCandidate) ? "matches_pinned_candidate" : "mismatch"
    : "missing";
  const runtimeDir = dirname(resolvedRuntime.path);
  const dllBasenames = listRuntimeDllBasenames(runtimeDir);

  if (manifestSizeMatched && manifestShaMatched) {
    readyChecks.push("runtime_manifest_integrity_matched");
  } else {
    blockers.push("runtime_manifest_integrity_mismatch");
  }

  if (dllBasenames.length > 0) {
    readyChecks.push("runtime_dll_basenames_present");
  } else {
    blockers.push("runtime_dlls_missing");
  }

  if (releaseMetadataStatus === "matches_pinned_candidate") {
    readyChecks.push("runtime_release_metadata_matches_candidate");
  } else if (releaseMetadataStatus === "mismatch") {
    blockers.push("runtime_release_metadata_mismatch");
  } else {
    blockers.push("runtime_release_metadata_missing");
    warnings.push("runtime_asset_zip_evidence_missing");
  }

  return removeUndefined({
    status: releaseMetadataStatus === "matches_pinned_candidate" && blockers.length === 0
      ? "matches_pinned_candidate"
      : releaseMetadataStatus === "missing"
        ? "blocked_missing_release_metadata"
        : "blocked",
    executableName: basename(resolvedRuntime.path),
    relativePath: normalizeSlashes(relative(packRoot, resolvedRuntime.path)),
    executableSha256: integrity.sha256,
    executableSizeBytes: integrity.sizeBytes,
    dllCount: dllBasenames.length,
    dllBasenames,
    candidate: safeRuntimeCandidate(runtimeCandidate),
    releaseMetadataStatus,
    readyChecks,
    blockers,
    warnings
  });
}

async function auditLicenseEvidence(packRoot, manifest, modelCandidate, runtimeCandidate) {
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const noticesPath = readNonEmptyString(manifest.licenseNotices);
  const resolvedNotices = resolveManifestFile(packRoot, noticesPath);

  if (!resolvedNotices.ok) {
    blockers.push(resolvedNotices.reason);
    return {
      status: "blocked",
      notices: noticesPath ? "invalid" : "missing",
      readyChecks,
      blockers,
      warnings
    };
  }

  if (!isExistingFile(resolvedNotices.path)) {
    blockers.push("third_party_notices_file_missing");
    return {
      status: "blocked",
      noticesBasename: basename(resolvedNotices.path),
      readyChecks,
      blockers,
      warnings
    };
  }

  const stat = statSync(resolvedNotices.path);
  const text = readFileSync(resolvedNotices.path, "utf8");
  const placeholder = isLikelyPlaceholderNotices(text);

  if (placeholder) {
    blockers.push("third_party_notices_placeholder");
  } else {
    readyChecks.push("third_party_notices_draft_shape_present");
  }

  if (text.includes(modelCandidate.repo) && text.includes(modelCandidate.license)) {
    readyChecks.push("model_notice_mentions_candidate_license");
  } else {
    blockers.push("model_notice_candidate_license_missing");
  }

  if (text.toLowerCase().includes("llama.cpp") && text.includes(runtimeCandidate.license)) {
    readyChecks.push("runtime_notice_mentions_candidate_license");
  } else {
    blockers.push("runtime_notice_candidate_license_missing");
  }

  warnings.push("license_evidence_shape_only_legal_review_pending");

  return removeUndefined({
    status: blockers.length === 0 ? "draft_shape_present_legal_pending" : "blocked",
    noticesBasename: basename(resolvedNotices.path),
    relativePath: normalizeSlashes(relative(packRoot, resolvedNotices.path)),
    sizeBytes: stat.size,
    sha256: await sha256File(resolvedNotices.path),
    finalNoticesApproval: "pending",
    legalReviewStatus: "pending",
    readyChecks,
    blockers,
    warnings
  });
}

function readManifestRuntime(manifest) {
  const platformRuntime = isPlainObject(manifest.platforms) && isPlainObject(manifest.platforms[PLATFORM_KEY])
    ? manifest.platforms[PLATFORM_KEY]
    : null;

  if (platformRuntime) {
    return {
      path: readNonEmptyString(platformRuntime.executable) ?? readNonEmptyString(platformRuntime.path),
      sizeBytes: platformRuntime.sizeBytes,
      sha256: platformRuntime.sha256
    };
  }

  if (isPlainObject(manifest.runtime)) {
    return {
      path: readNonEmptyString(manifest.runtime.executablePath)
        ?? readNonEmptyString(manifest.runtime.executable)
        ?? readNonEmptyString(manifest.runtime.path),
      sizeBytes: manifest.runtime.sizeBytes,
      sha256: manifest.runtime.sha256
    };
  }

  return {
    path: readNonEmptyString(manifest.executablePath) ?? readNonEmptyString(manifest.executable),
    sizeBytes: manifest.runtimeSizeBytes,
    sha256: manifest.runtimeSha256
  };
}

function candidateModelReleaseMatches(releaseModel, modelCandidate) {
  return safeRepo(releaseModel.repo) === modelCandidate.repo
    && safeBasename(releaseModel.file) === modelCandidate.file
    && readNonEmptyString(releaseModel.revision) === modelCandidate.revision
    && readNonEmptyString(releaseModel.license) === modelCandidate.license
    && readNonEmptyString(releaseModel.format) === modelCandidate.format
    && readNonEmptyString(releaseModel.quantization) === modelCandidate.quantization
    && readPositiveInteger(releaseModel.sizeBytes) === modelCandidate.sizeBytes
    && readNonEmptyString(releaseModel.sha256) === modelCandidate.sha256;
}

function candidateRuntimeReleaseMatches(releaseRuntime, runtimeCandidate) {
  return safeRepo(releaseRuntime.repo) === runtimeCandidate.repo
    && readNonEmptyString(releaseRuntime.releaseTag) === runtimeCandidate.releaseTag
    && readNonEmptyString(releaseRuntime.commit) === runtimeCandidate.commit
    && safeBasename(releaseRuntime.assetName) === runtimeCandidate.assetName
    && readPositiveInteger(releaseRuntime.assetSizeBytes) === runtimeCandidate.assetSizeBytes
    && readNonEmptyString(releaseRuntime.assetSha256) === runtimeCandidate.assetSha256
    && readNonEmptyString(releaseRuntime.platform) === runtimeCandidate.platform
    && readNonEmptyString(releaseRuntime.backend) === runtimeCandidate.backend
    && readNonEmptyString(releaseRuntime.license) === runtimeCandidate.license;
}

function resolveManifestFile(root, relativePath) {
  const safeRelativePath = readNonEmptyString(relativePath);

  if (!safeRelativePath) {
    return { ok: false, reason: "manifest_path_missing" };
  }

  if (isAbsolute(safeRelativePath)) {
    return { ok: false, reason: "manifest_unsafe_path" };
  }

  const resolved = resolve(root, safeRelativePath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;

  if (resolved === root || !resolved.startsWith(rootPrefix)) {
    return { ok: false, reason: "manifest_unsafe_path" };
  }

  return { ok: true, path: resolved };
}

function listRuntimeDllBasenames(runtimeDir) {
  if (!isExistingDirectory(runtimeDir)) {
    return [];
  }

  return readdirSafe(runtimeDir)
    .filter((name) => name.toLowerCase().endsWith(".dll"))
    .map(safeBasename)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function readdirSafe(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
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

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function readJsonObject(filePath) {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));

    if (!isPlainObject(value)) {
      return { ok: false, reason: "manifest_invalid_shape" };
    }

    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: error instanceof SyntaxError ? "manifest_invalid_json" : "manifest_read_failed" };
  }
}

function isLikelyPlaceholderNotices(text) {
  return /(?:TODO|placeholder|replace-with|draft only do not ship)/i.test(text);
}

function writeDraftArtifacts(repoRoot, outputRoot, summary) {
  mkdirSync(outputRoot, { recursive: true });
  const draftPath = join(outputRoot, DRAFT_BASENAME);
  const evidencePath = join(outputRoot, EVIDENCE_BASENAME);
  const draft = [
    "# P2-30H Production Local LLM Provenance Evidence Draft",
    "",
    "Draft only.",
    "Production ready claim: false.",
    "",
    `- Status: ${summary.status}`,
    `- Model provenance: ${summary.modelProvenance.status}`,
    `- Runtime provenance: ${summary.runtimeProvenance.status}`,
    `- License evidence: ${summary.licenseEvidence.status}`,
    "",
    "## Required Next Steps",
    "",
    ...summary.nextRequiredSteps.map((step) => `- ${step}`),
    "",
    "## Blockers",
    "",
    ...summary.blockers.map((blocker) => `- ${blocker}`),
    ""
  ].join("\n");

  writeFileSync(draftPath, draft, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  return [
    {
      basename: DRAFT_BASENAME,
      relativePath: normalizeSlashes(relative(repoRoot, draftPath)),
      status: "written"
    },
    {
      basename: EVIDENCE_BASENAME,
      relativePath: normalizeSlashes(relative(repoRoot, evidencePath)),
      status: "written"
    }
  ];
}

function resolveOutputRoot(root, outputRoot) {
  return outputRoot ? resolve(outputRoot) : resolve(root, DEFAULT_OUTPUT_ROOT);
}

function assertSafeOutputRoot(root, outputRoot) {
  const expected = resolve(root, DEFAULT_OUTPUT_ROOT);

  if (resolve(outputRoot) !== expected) {
    throw new Error("unsafe_output_root");
  }
}

function stripIssueLists(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  const { readyChecks: _readyChecks, blockers: _blockers, warnings: _warnings, ...rest } = value;
  return rest;
}

function safeModelCandidate(candidate) {
  return {
    repo: candidate.repo,
    baseModelRepo: candidate.baseModelRepo,
    file: candidate.file,
    revision: candidate.revision,
    sha256: candidate.sha256,
    sizeBytes: candidate.sizeBytes,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    format: candidate.format,
    quantization: candidate.quantization
  };
}

function safeRuntimeCandidate(candidate) {
  return {
    name: candidate.name,
    repo: candidate.repo,
    releaseTag: candidate.releaseTag,
    commit: candidate.commit,
    assetName: candidate.assetName,
    assetSha256: candidate.assetSha256,
    assetSizeBytes: candidate.assetSizeBytes,
    platform: candidate.platform,
    backend: candidate.backend,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl
  };
}

function findUnsafeInputContent(value) {
  const text = JSON.stringify(value);
  const blockers = [];

  if (/[A-Za-z]:\\/.test(text) || text.includes("\\Users\\") || text.includes("/Users/")) {
    blockers.push("privacy_local_path_leak");
  }

  if (SECRETISH_PATTERN.test(text)) {
    blockers.push("privacy_secret_leak");
  }

  if (MODEL_INPUT_PATTERN.test(text)) {
    blockers.push("privacy_model_input_leak");
  }

  if (REQUEST_PATTERN.test(text)) {
    blockers.push("privacy_request_payload_leak");
  }

  if (CONVERSATION_PATTERN.test(text)) {
    blockers.push("privacy_conversation_body_leak");
  }

  if (FACT_PATTERN.test(text)) {
    blockers.push("privacy_fact_body_leak");
  }

  return blockers;
}

function sanitizeForOutput(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "string") {
      return entry
        .replace(/[A-Za-z]:\\[^"]+/g, "[redacted-local-path]")
        .replace(/\\Users\\[^"]+/g, "\\Users\\[redacted]")
        .replace(/\/Users\/[^"]+/g, "/Users/[redacted]");
    }

    return entry;
  }));
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function firstPlainObject(value) {
  return Array.isArray(value) ? value.find(isPlainObject) ?? null : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExistingFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function safeBasename(value) {
  const safeValue = readNonEmptyString(value);

  if (!safeValue || safeValue.includes("/") || safeValue.includes("\\") || safeValue.includes("..")) {
    return null;
  }

  return basename(safeValue);
}

function safeRepo(value) {
  const safeValue = readNonEmptyString(value);

  return safeValue && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(safeValue) ? safeValue : null;
}

function uniqueIssueCodes(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && /^[a-z0-9_]+$/.test(value)))).sort();
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined).filter((entry) => entry !== undefined);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefined(entry)])
    );
  }

  return value;
}

function parseCliArgs(args) {
  return {
    write: args.includes("--write"),
    cleanup: args.includes("--cleanup")
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditProductionLocalLlmProvenanceAndLicenseEvidence(parseCliArgs(process.argv.slice(2)))
    .then(printJson)
    .catch((error) => {
      printJson({
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        safeSummaryOnly: true,
        productionReadyClaim: false,
        error: error instanceof Error ? error.message : "unknown_error"
      });
      process.exitCode = 1;
    });
}
