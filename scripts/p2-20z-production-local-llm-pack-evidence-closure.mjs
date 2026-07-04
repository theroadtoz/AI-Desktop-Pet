import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditProductionLocalLlmArtifact } from "./p2-20o-production-local-llm-artifact-review.mjs";
import { MODEL_CANDIDATE, RUNTIME_CANDIDATE } from "./p2-20p-production-local-llm-pack-assembly-dry-run.mjs";
import { auditProductionReleaseChecklist } from "./p2-20q-production-release-checklist-audit.mjs";
import { auditFinalNoticesEvidencePackageDraft } from "./p2-20y-final-notices-evidence-package-draft.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20Z";
const AUDIT_NAME = "production_local_llm_pack_evidence_closure";
const DEFAULT_OUTPUT_ROOT = ".tmp/p2-20z-production-local-llm-pack-evidence-closure";
const DRAFT_BASENAME = "production-local-llm-pack-evidence-closure-draft.md";
const EVIDENCE_BASENAME = "production-local-llm-pack-evidence-closure.json";
const FINAL_NOTICES_BASENAME = "THIRD_PARTY_NOTICES.md";
const LOCAL_LLM_ROOT = "resources/local-llm";
const REQUIRED_PRODUCTION_BLOCKERS = [
  "production_local_llm_pack_missing",
  "production_manifest_missing",
  "production_third_party_notices_missing",
  "model_file_missing",
  "runtime_executable_missing",
  "runtime_dlls_missing",
  "model_license_evidence_not_approved",
  "runtime_license_evidence_not_approved",
  "legal_review_not_approved",
  "owner_release_approval_missing",
  "production_release_not_approved",
  "final_third_party_notices_missing"
];
const SOURCE_ORDER = [
  ["productionLocalLlmArtifact", "P2-20O", "production_local_llm_artifact"],
  ["finalNoticesEvidencePackage", "P2-20Y", "final_notices_evidence_package_draft"],
  ["productionReleaseChecklist", "P2-20Q", "production_release_checklist"],
  ["productionLicenseInventory", "P2-20U", "production_distribution_license_inventory"],
  ["thirdPartyNoticesDraft", "P2-20V", "production_third_party_notices_draft_and_evidence"],
  ["electronVersionInstallerNotices", "P2-20X", "electron_version_installer_notices"]
];
const SOURCE_READY_CHECKS = Object.freeze({
  productionLocalLlmArtifact: "p2_20o_artifact_review_available",
  finalNoticesEvidencePackage: "p2_20y_final_notices_evidence_available",
  productionReleaseChecklist: "p2_20q_release_checklist_available",
  productionLicenseInventory: "p2_20u_license_inventory_available",
  thirdPartyNoticesDraft: "p2_20v_third_party_notices_draft_available",
  electronVersionInstallerNotices: "p2_20x_electron_version_installer_notices_available"
});
const REQUIRED_PACKAGE_COMMANDS = Object.freeze({
  validateLocalLlm: {
    script: "validate:local-llm",
    readyCheck: "p2_20h_validator_command_available"
  },
  dryRunProductionLocalLlmPack: {
    script: "dry-run:production-local-llm-pack",
    readyCheck: "p2_20p_dry_run_command_available"
  },
  stageOfflineLocalLlm: {
    script: "stage:offline-local-llm",
    readyCheck: "p2_20i_offline_layout_stage_command_available"
  },
  stageElectronBuilderLocalLlm: {
    script: "stage:electron-builder-local-llm",
    readyCheck: "p2_20j_electron_builder_stage_command_available"
  },
  acceptElectronBuilderLocalLlm: {
    script: "accept:electron-builder-local-llm",
    readyCheck: "p2_20j_packaged_chat_acceptance_command_available"
  },
  acceptNsisInstallerLifecycle: {
    script: "accept:nsis-installer-lifecycle",
    readyCheck: "p2_20m_nsis_lifecycle_acceptance_command_available"
  },
  generateProductionReleaseManifest: {
    script: "generate:production-release-manifest",
    readyCheck: "p2_20r_release_manifest_generator_available"
  }
});
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message|ai message|ai response)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|user memory body)/i;

export function getRepoRoot() {
  return repoRoot;
}

export async function auditProductionLocalLlmPackEvidenceClosure(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const modelCandidate = options.modelCandidate ?? MODEL_CANDIDATE;
  const runtimeCandidate = options.runtimeCandidate ?? RUNTIME_CANDIDATE;
  const sourceAudits = options.sourceAudits ?? await collectSourceAudits(root, options);
  const candidateEvidence = auditCandidateEvidence(modelCandidate, runtimeCandidate);
  const repoPackState = auditRepoPackState(root);
  const commandEvidence = auditPackageCommandEvidence(root);
  const sourceSummaries = summarizeSourceAudits(sourceAudits);
  const sourceStatuses = Object.fromEntries(
    SOURCE_ORDER.map(([key]) => [key, safeStatus(sourceSummaries[key]?.status) ?? "unknown"])
  );
  const unsafeCodes = findUnsafeInputContent({
    sourceAudits,
    modelCandidate: options.modelCandidate,
    runtimeCandidate: options.runtimeCandidate
  });
  const readyChecks = uniqueIssueCodes([
    ...candidateEvidence.readyChecks,
    ...repoPackState.readyChecks,
    ...commandEvidence.readyChecks,
    ...sourceAvailabilityReadyChecks(sourceSummaries)
  ]);
  const blockers = uniqueIssueCodes([
    ...REQUIRED_PRODUCTION_BLOCKERS,
    ...candidateEvidence.blockers,
    ...repoPackState.blockers,
    ...commandEvidence.blockers,
    ...collectSourceIssueCodes(sourceAudits, "blockers"),
    ...unsafeCodes
  ]);
  const warnings = uniqueIssueCodes([
    "audit_only_no_download_performed",
    "tmp_draft_only",
    "production_ready_claim_forbidden",
    ...candidateEvidence.warnings,
    ...repoPackState.warnings,
    ...commandEvidence.warnings,
    ...collectSourceIssueCodes(sourceAudits, "warnings")
  ]);
  let summary = sanitizeForOutput(removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    candidateEvidence: candidateEvidence.summary,
    repoPackState: repoPackState.summary,
    commandEvidence: commandEvidence.summary,
    sourceStatuses,
    sourceSummaries,
    readyChecks,
    blockers,
    warnings,
    outputPolicy: {
      mode: "audit_only",
      writeRoot: DEFAULT_OUTPUT_ROOT,
      finalNoticesBasename: FINAL_NOTICES_BASENAME,
      finalNoticesWritePolicy: "forbidden_by_p2_20z"
    },
    writtenArtifacts: []
  }));

  if (options.write === true) {
    const outputRoot = resolveOutputRoot(root);
    assertSafeOutputRoot(root, outputRoot);
    const writtenArtifacts = plannedWrittenArtifacts(root, outputRoot);

    summary = sanitizeForOutput({
      ...summary,
      writtenArtifacts
    });

    writeDraftArtifacts(outputRoot, summary);

    if (options.cleanup === true) {
      cleanupOutputRoot(root, outputRoot);
      summary = sanitizeForOutput({
        ...summary,
        writtenArtifacts: writtenArtifacts.map((artifact) => ({
          ...artifact,
          status: "removed_after_cleanup"
        })),
        cleanup: {
          status: "removed",
          outputRoot: DEFAULT_OUTPUT_ROOT
        }
      });
    }
  } else if (options.cleanup === true) {
    const outputRoot = resolveOutputRoot(root);
    assertSafeOutputRoot(root, outputRoot);
    cleanupOutputRoot(root, outputRoot);
    summary = sanitizeForOutput({
      ...summary,
      cleanup: {
        status: "removed",
        outputRoot: DEFAULT_OUTPUT_ROOT
      }
    });
  }

  return sanitizeForOutput(removeUndefined(summary));
}

async function collectSourceAudits(root, options) {
  const env = options.env ?? {};
  const productionLocalLlmArtifact = await auditProductionLocalLlmArtifact({
    repoRoot: root,
    env
  });
  const productionReleaseChecklist = auditProductionReleaseChecklist({
    repoRoot: root,
    env
  });
  const finalNoticesEvidencePackage = await auditFinalNoticesEvidencePackageDraft({
    repoRoot: root,
    env
  });

  return {
    productionLocalLlmArtifact,
    finalNoticesEvidencePackage,
    productionReleaseChecklist
  };
}

function auditCandidateEvidence(modelCandidate, runtimeCandidate) {
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const model = auditModelCandidate(modelCandidate, blockers, readyChecks);
  const runtime = auditRuntimeCandidate(runtimeCandidate, blockers, readyChecks);

  if (model.status === "ready" && runtime.status === "ready") {
    readyChecks.push("p2_20p_dry_run_candidate_available");
  }

  return {
    summary: {
      model,
      runtime
    },
    readyChecks,
    blockers,
    warnings
  };
}

function auditModelCandidate(candidate, blockers, readyChecks) {
  const repo = safeRepo(candidate?.repo);
  const baseModelRepo = safeRepo(candidate?.baseModelRepo);
  const file = safeBasename(candidate?.file);
  const revision = safeIdentifier(candidate?.revision);
  const sha256 = safeSha256(candidate?.sha256);
  const sizeBytes = readPositiveInteger(candidate?.sizeBytes);
  const license = safeLicense(candidate?.license);
  const licenseUrl = safeHttpsUrl(candidate?.licenseUrl);
  const format = safeIdentifier(candidate?.format);
  const quantization = safeIdentifier(candidate?.quantization);
  const downloadUrl = safeHttpsUrl(candidate?.downloadUrl);
  const metadataPinned = Boolean(
    repo
    && file
    && revision
    && isPinnedReference(revision)
    && license
    && format
    && quantization
  );

  if (metadataPinned) {
    readyChecks.push("model_candidate_metadata_pinned");
  } else {
    blockers.push("model_candidate_metadata_not_pinned");
  }

  if (sha256) {
    readyChecks.push("model_candidate_sha256_declared");
  } else {
    blockers.push("model_candidate_sha256_missing_or_invalid");
  }

  if (sizeBytes !== null) {
    readyChecks.push("model_candidate_size_declared");
  } else {
    blockers.push("model_candidate_size_missing_or_invalid");
  }

  if (downloadUrl) {
    readyChecks.push("model_candidate_download_url_declared");
  } else {
    blockers.push("model_candidate_download_url_missing_or_invalid");
  }

  if (!licenseUrl) {
    blockers.push("model_candidate_license_url_missing_or_invalid");
  }

  return removeUndefined({
    status: metadataPinned && sha256 && sizeBytes !== null && downloadUrl && licenseUrl ? "ready" : "blocked",
    repo,
    baseModelRepo,
    file,
    revision,
    sha256,
    sizeBytes,
    license,
    licenseUrl,
    format,
    quantization,
    downloadUrl
  });
}

function auditRuntimeCandidate(candidate, blockers, readyChecks) {
  const name = safeIdentifier(candidate?.name);
  const repo = safeRepo(candidate?.repo);
  const releaseTag = safeIdentifier(candidate?.releaseTag);
  const commit = safeIdentifier(candidate?.commit);
  const assetName = safeBasename(candidate?.assetName);
  const assetSha256 = safeSha256(candidate?.assetSha256);
  const assetSizeBytes = readPositiveInteger(candidate?.assetSizeBytes);
  const platform = safeIdentifier(candidate?.platform);
  const backend = safeIdentifier(candidate?.backend);
  const license = safeLicense(candidate?.license);
  const licenseUrl = safeHttpsUrl(candidate?.licenseUrl);
  const downloadUrl = safeHttpsUrl(candidate?.downloadUrl);
  const releasePinned = Boolean(
    name
    && repo
    && releaseTag
    && isPinnedReference(releaseTag)
    && commit
    && isShaLikeCommit(commit)
    && assetName
    && platform
    && backend
    && license
  );

  if (releasePinned) {
    readyChecks.push("runtime_candidate_release_pinned");
  } else {
    blockers.push("runtime_candidate_release_not_pinned");
  }

  if (assetSha256) {
    readyChecks.push("runtime_candidate_sha256_declared");
  } else {
    blockers.push("runtime_candidate_sha256_missing_or_invalid");
  }

  if (assetSizeBytes !== null) {
    readyChecks.push("runtime_candidate_size_declared");
  } else {
    blockers.push("runtime_candidate_size_missing_or_invalid");
  }

  if (downloadUrl) {
    readyChecks.push("runtime_candidate_download_url_declared");
  } else {
    blockers.push("runtime_candidate_download_url_missing_or_invalid");
  }

  if (!licenseUrl) {
    blockers.push("runtime_candidate_license_url_missing_or_invalid");
  }

  return removeUndefined({
    status: releasePinned && assetSha256 && assetSizeBytes !== null && downloadUrl && licenseUrl ? "ready" : "blocked",
    name,
    repo,
    releaseTag,
    commit,
    assetName,
    assetSha256,
    assetSizeBytes,
    platform,
    backend,
    license,
    licenseUrl,
    downloadUrl
  });
}

function auditRepoPackState(root) {
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const localRoot = join(root, LOCAL_LLM_ROOT);
  const runtimeRoot = join(localRoot, "runtime", "win32-x64");
  const gitignorePresent = isExistingFile(join(localRoot, ".gitignore"));
  const scaffoldRootPresent = isExistingDirectory(localRoot);
  const manifestExamplePresent = isExistingFile(join(localRoot, "manifest.example.json"));
  const productionManifestPresent = isExistingFile(join(localRoot, "manifest.json"));
  const noticesTemplatePresent = isExistingFile(join(localRoot, "licenses", "THIRD_PARTY_NOTICES.template.md"));
  const productionNoticesPresent = isExistingFile(join(localRoot, "licenses", FINAL_NOTICES_BASENAME));
  const runtimeExecutablePresent = isExistingFile(join(runtimeRoot, "llama-server.exe"));
  const runtimeDllBasenames = isExistingDirectory(runtimeRoot)
    ? safeReadDir(runtimeRoot)
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".dll")
      .map((entry) => safeBasename(entry.name))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
    : [];
  const modelFilePresent = isExistingFile(join(localRoot, "models", "model.gguf"));
  const scaffoldPresent = scaffoldRootPresent && (gitignorePresent || manifestExamplePresent || noticesTemplatePresent);
  const productionPackFilesPresent = productionManifestPresent
    && productionNoticesPresent
    && runtimeExecutablePresent
    && runtimeDllBasenames.length > 0
    && modelFilePresent;

  if (scaffoldPresent) {
    readyChecks.push("local_llm_scaffold_present");
  } else {
    blockers.push("local_llm_scaffold_missing");
  }

  if (manifestExamplePresent) {
    readyChecks.push("manifest_example_present");
  } else {
    blockers.push("manifest_example_missing");
  }

  if (noticesTemplatePresent) {
    readyChecks.push("notices_template_present");
  } else {
    blockers.push("notices_template_missing");
  }

  if (gitignorePresent) {
    readyChecks.push("local_llm_gitignore_present");
  } else {
    blockers.push("local_llm_gitignore_missing");
  }

  return {
    summary: {
      status: productionPackFilesPresent ? "production_files_present_not_approved" : scaffoldPresent ? "scaffold_only" : "missing",
      relativeRoot: LOCAL_LLM_ROOT,
      scaffold: scaffoldPresent ? "present" : "missing",
      gitignore: gitignorePresent ? "present" : "missing",
      manifestExample: manifestExamplePresent ? "present" : "missing",
      noticesTemplate: noticesTemplatePresent ? "present" : "missing",
      productionManifest: productionManifestPresent ? "present_not_approved" : "missing",
      productionNotices: productionNoticesPresent ? "present_not_approved" : "missing",
      runtimeExecutable: runtimeExecutablePresent ? "present_not_approved" : "missing",
      runtimeDlls: runtimeDllBasenames.length > 0 ? "present_not_approved" : "missing",
      runtimeDllBasenames,
      modelFile: modelFilePresent ? "present_not_approved" : "missing",
      productionPack: productionPackFilesPresent ? "present_not_approved" : "missing"
    },
    readyChecks,
    blockers,
    warnings
  };
}

function auditPackageCommandEvidence(root) {
  const packageJson = readPackageJson(root);
  const scripts = isPlainObject(packageJson?.scripts) ? packageJson.scripts : {};
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const commands = Object.fromEntries(
    Object.entries(REQUIRED_PACKAGE_COMMANDS).map(([key, config]) => {
      const present = typeof scripts[config.script] === "string" && scripts[config.script].trim().length > 0;

      if (present) {
        readyChecks.push(config.readyCheck);
      } else {
        blockers.push(`${config.script.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_missing`);
      }

      return [key, {
        script: config.script,
        status: present ? "available" : "missing"
      }];
    })
  );

  if (!packageJson) {
    blockers.push("package_json_missing_or_invalid");
  }

  return {
    summary: {
      status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
      commands
    },
    readyChecks,
    blockers,
    warnings
  };
}

function summarizeSourceAudits(sourceAudits) {
  const finalSummary = normalizeAudit(sourceAudits?.finalNoticesEvidencePackage);

  return Object.fromEntries(SOURCE_ORDER.map(([key, phase, auditName]) => {
    const direct = normalizeAudit(sourceAudits?.[key]);
    const nested = isPlainObject(finalSummary.sourceSummaries?.[key])
      ? finalSummary.sourceSummaries[key]
      : {};
    const value = isPlainObject(direct) && direct.status ? direct : nested;
    const blockers = Array.isArray(value.blockers) ? value.blockers : [];
    const warnings = Array.isArray(value.warnings) ? value.warnings : [];
    const readyChecks = Array.isArray(value.readyChecks) ? value.readyChecks : [];

    return [key, removeUndefined({
      phase: safeIdentifier(value.phase) ?? phase,
      audit: safeIdentifier(value.audit) ?? auditName,
      status: safeStatus(value.status) ?? "unknown",
      ok: value.ok === true,
      productionReadyClaim: value.productionReadyClaim === true,
      blockerCount: readNonNegativeInteger(value.blockerCount) ?? countIssueCodes(blockers),
      warningCount: readNonNegativeInteger(value.warningCount) ?? countIssueCodes(warnings),
      readyCheckCount: readNonNegativeInteger(value.readyCheckCount) ?? countIssueCodes(readyChecks)
    })];
  }));
}

function sourceAvailabilityReadyChecks(sourceSummaries) {
  return SOURCE_ORDER
    .map(([key]) => sourceSummaries[key]?.status !== "unknown" ? SOURCE_READY_CHECKS[key] : null)
    .filter(Boolean);
}

function normalizeAudit(value) {
  if (isPlainObject(value?.summary)) {
    return value.summary;
  }

  return isPlainObject(value) ? value : {};
}

function collectSourceIssueCodes(sourceAudits, field) {
  const codes = [];

  for (const value of Object.values(isPlainObject(sourceAudits) ? sourceAudits : {})) {
    const audit = normalizeAudit(value);
    const entries = Array.isArray(audit[field]) ? audit[field] : [];
    codes.push(...entries.map(safeIssueCode).filter(Boolean));
  }

  return codes;
}

function plannedWrittenArtifacts(root, outputRoot) {
  return [
    {
      basename: DRAFT_BASENAME,
      relativePath: normalizeSlashes(relative(root, join(outputRoot, DRAFT_BASENAME))),
      role: "production_local_llm_pack_evidence_closure_markdown_draft",
      status: "written"
    },
    {
      basename: EVIDENCE_BASENAME,
      relativePath: normalizeSlashes(relative(root, join(outputRoot, EVIDENCE_BASENAME))),
      role: "safe_evidence_closure_json",
      status: "written"
    }
  ];
}

function writeDraftArtifacts(outputRoot, summary) {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, DRAFT_BASENAME), createDraftMarkdown(summary), "utf8");
  writeFileSync(join(outputRoot, EVIDENCE_BASENAME), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function createDraftMarkdown(summary) {
  const sourceLines = SOURCE_ORDER.map(([key, phase]) => {
    const source = summary.sourceSummaries[key];
    return `- ${phase}: ${source.status}; blockers=${source.blockerCount}; warnings=${source.warningCount}; readyChecks=${source.readyCheckCount}`;
  });
  const readyCheckLines = summary.readyChecks.map((entry) => `- ${entry}`);
  const blockerLines = summary.blockers.map((entry) => `- ${entry}`);
  const warningLines = summary.warnings.map((entry) => `- ${entry}`);

  return [
    "# P2-20Z Production Local LLM Pack Evidence Closure Draft",
    "",
    "Draft only.",
    "Audit only.",
    "Production ready claim: false.",
    `Do not ship as final ${FINAL_NOTICES_BASENAME}.`,
    "",
    "## Candidate Evidence",
    "",
    `- Model candidate: ${summary.candidateEvidence.model.status}`,
    `- Runtime candidate: ${summary.candidateEvidence.runtime.status}`,
    "",
    "## Repo Pack State",
    "",
    `- State: ${summary.repoPackState.status}`,
    `- Production manifest: ${summary.repoPackState.productionManifest}`,
    `- Production notices: ${summary.repoPackState.productionNotices}`,
    `- Runtime executable: ${summary.repoPackState.runtimeExecutable}`,
    `- Model file: ${summary.repoPackState.modelFile}`,
    "",
    "## Source Audits",
    "",
    ...sourceLines,
    "",
    "## Ready Checks",
    "",
    ...readyCheckLines,
    "",
    "## Blockers",
    "",
    ...blockerLines,
    "",
    "## Warnings",
    "",
    ...warningLines,
    "",
    "## Manual Closure Requirements",
    "",
    "- Owner release approval remains required.",
    "- Legal review remains required.",
    "- Model and runtime license evidence remains required.",
    "- Production local LLM pack files remain required.",
    "- Final third-party notices must be approved before any production release.",
    ""
  ].join("\n");
}

function resolveOutputRoot(root) {
  return join(root, DEFAULT_OUTPUT_ROOT);
}

function assertSafeOutputRoot(root, outputRoot) {
  const expected = resolve(root, DEFAULT_OUTPUT_ROOT);

  if (resolve(outputRoot) !== expected) {
    throw new Error("unsafe_output_root");
  }
}

function cleanupOutputRoot(root, outputRoot) {
  assertSafeOutputRoot(root, outputRoot);
  rmSync(outputRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}

function findUnsafeInputContent(value) {
  const codes = new Set();
  const rawText = JSON.stringify(value);

  if (!rawText) {
    return [];
  }

  if (containsLocalPath(rawText)) {
    codes.add("privacy_local_path_leak");
  }

  visitValue(value, [], (path, entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const currentKey = path.at(-1) ?? "";
    const joinedPath = path.join(".");
    const combined = `${joinedPath} ${currentKey} ${entry}`;

    if (containsLocalPath(entry)) {
      codes.add("privacy_local_path_leak");
    }

    if (SECRETISH_PATTERN.test(combined)) {
      codes.add("privacy_secret_leak");
    }

    if (MODEL_INPUT_PATTERN.test(combined)) {
      codes.add("privacy_model_input_leak");
    }

    if (REQUEST_PATTERN.test(combined)) {
      codes.add("privacy_request_payload_leak");
    }

    if (CONVERSATION_PATTERN.test(combined)) {
      codes.add("privacy_conversation_body_leak");
    }

    if (FACT_PATTERN.test(combined)) {
      codes.add("privacy_fact_body_leak");
    }
  });

  return Array.from(codes);
}

function sanitizeForOutput(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForOutput);
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, sanitizeForOutput(entryValue)])
  );
}

function sanitizeString(value) {
  if (
    containsLocalPath(value)
    || SECRETISH_PATTERN.test(value)
    || MODEL_INPUT_PATTERN.test(value)
    || REQUEST_PATTERN.test(value)
    || CONVERSATION_PATTERN.test(value)
    || FACT_PATTERN.test(value)
  ) {
    return "redacted_sensitive_text";
  }

  return value;
}

function visitValue(value, path, visit) {
  visit(path, value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitValue(entry, [...path, String(index)], visit));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      visitValue(entry, [...path, key], visit);
    }
  }
}

function safeIssueCode(value) {
  const text = readNonEmptyString(value);

  if (!text || !/^[a-z0-9_./:@+-]+$/i.test(text)) {
    return null;
  }

  if (
    containsLocalPath(text)
    || SECRETISH_PATTERN.test(text)
    || MODEL_INPUT_PATTERN.test(text)
    || REQUEST_PATTERN.test(text)
    || CONVERSATION_PATTERN.test(text)
    || FACT_PATTERN.test(text)
  ) {
    return null;
  }

  return text;
}

function readPackageJson(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^\uFEFF/, ""));

    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function countIssueCodes(codes) {
  return Array.isArray(codes) ? codes.map(safeIssueCode).filter(Boolean).length : 0;
}

function isPinnedReference(value) {
  const text = readNonEmptyString(value);
  return Boolean(text) && !/^(main|master|latest|head)$/i.test(text);
}

function isShaLikeCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function safeRepo(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(text) ? text : null;
}

function safeBasename(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return null;
  }

  const name = basename(text.replace(/\\/g, "/"));

  if (name !== text || containsLocalPath(text)) {
    return null;
  }

  return /^[a-z0-9_ .${}()@+\-[\].]+$/i.test(name) ? name : null;
}

function safeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) ? text : null;
}

function safeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) ? text : null;
}

function safeLicense(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9 .()+-]+$/i.test(text) ? text : null;
}

function safeSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function safeHttpsUrl(value) {
  const text = readNonEmptyString(value);

  if (!text || containsLocalPath(text) || SECRETISH_PATTERN.test(text)) {
    return null;
  }

  try {
    const url = new URL(text);

    if (url.protocol !== "https:" || url.username || url.password || isLocalHostname(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname) {
  return /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(hostname);
}

function containsLocalPath(value) {
  return /[A-Za-z]:\\/.test(value) || /(^|["'\s])\/(?:Users|home|tmp|var)\//i.test(value);
}

function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function safeReadDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function uniqueIssueCodes(codes) {
  return Array.from(new Set(codes.map(safeIssueCode).filter(Boolean))).sort();
}

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
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

function parseCliArgs(args) {
  return {
    write: args.includes("--write"),
    cleanup: args.includes("--cleanup")
  };
}

function safeErrorReason(error) {
  const raw = error instanceof Error ? error.message : "unexpected_error";
  return /^[a-z0-9_./:@+ -]+$/i.test(raw) && sanitizeString(raw) === raw ? raw : "unexpected_error";
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(sanitizeForOutput(removeUndefined(value)), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditProductionLocalLlmPackEvidenceClosure(parseCliArgs(process.argv.slice(2)))
    .then(printJson)
    .catch((error) => {
      printJson({
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        safeSummaryOnly: true,
        exitPolicy: "always_zero",
        productionReadyClaim: false,
        reason: safeErrorReason(error)
      });
    });
}
