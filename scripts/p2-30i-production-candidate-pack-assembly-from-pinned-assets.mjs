import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleProductionLocalLlmPackDryRun,
  assertSafeTmpRoot,
  MODEL_CANDIDATE,
  RUNTIME_CANDIDATE
} from "./p2-20p-production-local-llm-pack-assembly-dry-run.mjs";
import { auditProductionLocalLlmProvenanceAndLicenseEvidence } from "./p2-30h-production-local-llm-provenance-and-license-evidence.mjs";

const PHASE = "P2-30I";
const ASSEMBLY_NAME = "production_candidate_pack_assembly_from_pinned_assets";
const WORK_ROOT_NAME = "p2-30i-production-candidate-pack-assembly-from-pinned-assets";
const DEFAULT_SOURCE_ROOT_NAME = "p2-23c-qwen25-15b-local-llm";
const PUBLIC_RUNTIME_SOURCES = new Set(["downloaded_public_runtime_zip", "reused_public_runtime_zip"]);
const REQUIRED_PRODUCTION_BLOCKERS = Object.freeze([
  "final_third_party_notices_missing",
  "legal_review_not_approved",
  "model_license_evidence_not_approved",
  "owner_release_approval_missing",
  "production_candidate_pack_not_release_approved",
  "production_ready_claim_forbidden",
  "production_release_not_approved",
  "runtime_license_evidence_not_approved"
]);

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function assembleProductionCandidatePackFromPinnedAssets(options = {}) {
  const startedAt = Date.now();
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const env = options.env ?? process.env;
  const workRoot = options.workRoot ? resolve(options.workRoot) : join(repoRoot, ".tmp", WORK_ROOT_NAME);
  const packRoot = join(workRoot, "resources", "local-llm");
  const sourceRoot = options.sourceRoot
    ? resolve(options.sourceRoot)
    : env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT
      ? resolve(env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT)
      : join(repoRoot, ".tmp", DEFAULT_SOURCE_ROOT_NAME);
  const sourceModelPath = options.sourceModelPath ? resolve(options.sourceModelPath) : join(sourceRoot, "models", "model.gguf");
  const modelCandidate = options.modelCandidate ?? MODEL_CANDIDATE;
  const runtimeCandidate = options.runtimeCandidate ?? RUNTIME_CANDIDATE;
  const keepTmp = options.keepTmp === true;
  const blockers = [...REQUIRED_PRODUCTION_BLOCKERS];
  const warnings = [
    "candidate_pack_draft_only",
    "assembly_audit_only_no_release_approval"
  ];
  const readyChecks = [];
  let assembly = null;
  let provenance = null;
  let cleanup = null;

  assertSafeTmpRoot(workRoot, repoRoot, "p2_30i_work_root_outside_repo_tmp");

  try {
    if (!existsSync(sourceModelPath)) {
      blockers.push("source_model_missing");
      warnings.push("hash_matched_model_source_unavailable");
    } else {
      readyChecks.push("source_model_file_present");

      const assemblyResult = await assembleProductionLocalLlmPackDryRun({
        repoRoot,
        workRoot,
        sourceModelPath,
        sourceRuntimeDir: options.sourceRuntimeDir,
        sourceRuntimeZipPath: options.sourceRuntimeZipPath,
        fetch: options.fetch,
        modelCandidate,
        runtimeCandidate,
        legalReviewStatus: "pending",
        keepTmp: true
      });

      assembly = summarizeAssembly(assemblyResult);

      if (assemblyResult.status === "blocked") {
        blockers.push("candidate_pack_assembly_blocked", ...readIssueList(assemblyResult.summary?.blockers));
      } else {
        if (PUBLIC_RUNTIME_SOURCES.has(assembly.runtime?.source)) {
          readyChecks.push("runtime_public_release_zip_used");
        } else {
          blockers.push("runtime_public_release_asset_not_used");
          warnings.push("runtime_source_was_not_public_release_zip");
        }

        const provenanceResult = await auditProductionLocalLlmProvenanceAndLicenseEvidence({
          repoRoot,
          resourceRoot: packRoot,
          modelCandidate,
          runtimeCandidate
        });
        provenance = summarizeProvenance(provenanceResult);
        readyChecks.push(...readIssueList(provenanceResult.readyChecks));
        blockers.push(...readIssueList(provenanceResult.blockers));
        warnings.push(...readIssueList(provenanceResult.warnings));

        if (provenanceResult.runtimeProvenance?.status !== "matches_pinned_candidate") {
          blockers.push("candidate_runtime_release_metadata_not_matched");
        }
      }
    }
  } catch (error) {
    blockers.push("candidate_pack_assembly_exception");
    warnings.push(`assembly_exception_${sanitizeErrorName(error?.name)}`);
  }

  if (keepTmp) {
    cleanup = {
      tmp: "kept",
      workRootName: basename(workRoot)
    };
  } else {
    rmSync(workRoot, { recursive: true, force: true });
    cleanup = {
      tmp: "removed",
      workRootName: basename(workRoot)
    };
  }

  const summary = removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    assembly: ASSEMBLY_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    source: {
      modelSourceKind: existsSync(sourceModelPath) ? "hash_matched_pinned_model_source" : "missing",
      sourceRootName: basename(sourceRoot),
      modelBasename: basename(sourceModelPath)
    },
    candidateEvidence: {
      model: safeModelCandidate(modelCandidate),
      runtime: safeRuntimeCandidate(runtimeCandidate)
    },
    assemblyResult: assembly,
    provenance,
    readyChecks: uniqueIssueCodes(readyChecks),
    blockers: uniqueIssueCodes(blockers),
    warnings: uniqueIssueCodes(warnings),
    cleanup,
    nextRequiredSteps: [
      "prepare_final_third_party_notices_for_review",
      "obtain_model_runtime_license_evidence_approval",
      "obtain_owner_and_legal_release_approval",
      "run_release_candidate_packaging_after_approval"
    ],
    durationMs: Date.now() - startedAt
  });

  const unsafeCodes = findUnsafeInputContent(summary);

  if (unsafeCodes.length > 0) {
    return {
      ...summary,
      blockers: uniqueIssueCodes([...summary.blockers, ...unsafeCodes]),
      warnings: uniqueIssueCodes([...summary.warnings, "unsafe_summary_content_blocked"]),
      assemblyResult: undefined,
      provenance: undefined
    };
  }

  return summary;
}

function summarizeAssembly(result) {
  if (!result) {
    return null;
  }

  return removeUndefined({
    ok: result.ok,
    status: result.status,
    legalReviewStatus: result.summary?.legalReviewStatus,
    model: result.summary?.model ? {
      repo: result.summary.model.repo,
      file: result.summary.model.file,
      revision: result.summary.model.revision,
      sha256: result.summary.model.sha256,
      sizeBytes: result.summary.model.sizeBytes,
      license: result.summary.model.license,
      source: result.summary.model.source
    } : undefined,
    runtime: result.summary?.runtime ? {
      repo: result.summary.runtime.repo,
      releaseTag: result.summary.runtime.releaseTag,
      commit: result.summary.runtime.commit,
      assetName: result.summary.runtime.assetName,
      assetSha256: result.summary.runtime.assetSha256,
      assetSizeBytes: result.summary.runtime.assetSizeBytes,
      platform: result.summary.runtime.platform,
      backend: result.summary.runtime.backend,
      license: result.summary.runtime.license,
      executableName: result.summary.runtime.executableName,
      dllCount: result.summary.runtime.dllCount,
      dllBasenames: result.summary.runtime.dllBasenames,
      source: result.summary.runtime.source
    } : undefined,
    review: result.summary?.review ? {
      ok: result.summary.review.ok,
      status: result.summary.review.status,
      blockers: readIssueList(result.summary.review.blockers),
      warnings: readIssueList(result.summary.review.warnings),
      writtenArtifacts: readIssueList(result.summary.review.writtenArtifacts)
    } : undefined
  });
}

function summarizeProvenance(result) {
  if (!result) {
    return null;
  }

  return removeUndefined({
    ok: result.ok,
    status: result.status,
    modelProvenance: {
      status: result.modelProvenance?.status,
      releaseMetadataStatus: result.modelProvenance?.releaseMetadataStatus,
      basename: result.modelProvenance?.basename,
      sha256: result.modelProvenance?.sha256,
      sizeBytes: result.modelProvenance?.sizeBytes
    },
    runtimeProvenance: {
      status: result.runtimeProvenance?.status,
      releaseMetadataStatus: result.runtimeProvenance?.releaseMetadataStatus,
      executableName: result.runtimeProvenance?.executableName,
      executableSha256: result.runtimeProvenance?.executableSha256,
      executableSizeBytes: result.runtimeProvenance?.executableSizeBytes,
      dllCount: result.runtimeProvenance?.dllCount,
      dllBasenames: result.runtimeProvenance?.dllBasenames
    },
    licenseEvidence: {
      status: result.licenseEvidence?.status,
      noticesBasename: result.licenseEvidence?.noticesBasename,
      sha256: result.licenseEvidence?.sha256,
      sizeBytes: result.licenseEvidence?.sizeBytes,
      finalNoticesApproval: result.licenseEvidence?.finalNoticesApproval,
      legalReviewStatus: result.licenseEvidence?.legalReviewStatus
    }
  });
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

function readIssueList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
}

function uniqueIssueCodes(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function sanitizeErrorName(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60);
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined).filter((entry) => entry !== undefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, removeUndefined(entry)])
      .filter(([, entry]) => entry !== undefined)
  );
}

function findUnsafeInputContent(value) {
  const text = JSON.stringify(value);
  const blockers = [];

  if (/[A-Za-z]:\\/.test(text) || /\/Users\/|\/home\//i.test(text)) {
    blockers.push("privacy_local_path_leak");
  }

  if (/Authorization|Bearer\s+[A-Za-z0-9._-]+|api[_-]?key|token/i.test(text)) {
    blockers.push("privacy_secret_leak");
  }

  if (/prompt|provider request|request body/i.test(text)) {
    blockers.push("privacy_request_payload_leak");
  }

  if (/user message|assistant message|conversation body/i.test(text)) {
    blockers.push("privacy_conversation_body_leak");
  }

  if (/fact card|memory card/i.test(text)) {
    blockers.push("privacy_fact_body_leak");
  }

  return blockers;
}

function parseCliOptions(args) {
  return {
    keepTmp: args.includes("--keep")
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  assembleProductionCandidatePackFromPinnedAssets(parseCliOptions(process.argv.slice(2)))
    .then((summary) => {
      printJson(summary);
    })
    .catch((error) => {
      printJson({
        ok: false,
        status: "blocked",
        phase: PHASE,
        assembly: ASSEMBLY_NAME,
        safeSummaryOnly: true,
        exitPolicy: "always_zero",
        productionReadyClaim: false,
        reason: "candidate_pack_assembly_exception",
        errorName: sanitizeErrorName(error?.name),
        blockers: [
          "candidate_pack_assembly_exception",
          "production_ready_claim_forbidden"
        ]
      });
    });
}
