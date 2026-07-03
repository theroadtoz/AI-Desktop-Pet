import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditProductionDistributionLicenseInventory } from "./p2-20u-production-distribution-license-inventory-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20V";
const AUDIT_NAME = "production_third_party_notices_draft_and_evidence";
const DEFAULT_OUTPUT_ROOT = ".tmp/p2-20v-third-party-notices-draft";
const DRAFT_BASENAME = "THIRD_PARTY_NOTICES.draft.md";
const EVIDENCE_BASENAME = "third-party-notices-evidence.json";
const FINAL_NOTICES_BASENAME = "THIRD_PARTY_NOTICES.md";
const TEMPLATE_BASENAME = "THIRD_PARTY_NOTICES.template.md";
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|secret|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|user memory body)/i;
const REQUIRED_PRODUCTION_BLOCKERS = [
  "owner_release_approval_missing",
  "legal_review_not_approved",
  "third_party_notices_not_approved",
  "electron_chromium_notices_not_approved",
  "model_license_evidence_missing",
  "runtime_license_evidence_missing",
  "local_llm_production_pack_missing",
  "production_distribution_inventory_not_approved",
  "final_third_party_notices_missing"
];
const DRAFT_SECTIONS = [
  "draft/legal status",
  "application package metadata",
  "Electron runtime",
  "Chromium / Node / ffmpeg bundled notices pending",
  "pangu runtime dependency",
  "local LLM llama.cpp runtime candidate",
  "Qwen2.5 1.5B base / instruct / GGUF provenance",
  "additional runtime libraries / DLL evidence checklist",
  "build-time tools",
  "app-owned resources",
  "blocked production gates"
];
const SOURCE_URLS = Object.freeze({
  electronLicense: "https://github.com/electron/electron/blob/main/LICENSE",
  electronManifest: "https://github.com/electron/electron/blob/main/script/zip_manifests/dist_zip.win.x64.manifest",
  panguLicense: "https://github.com/vinta/pangu.js/blob/master/LICENSE",
  llamaCppLicense: "https://github.com/ggml-org/llama.cpp/blob/master/LICENSE",
  ggmlLicense: "https://github.com/ggml-org/ggml/blob/master/LICENSE",
  ggufSpec: "https://github.com/ggml-org/ggml/blob/master/docs/gguf.md",
  qwenBase: "https://huggingface.co/Qwen/Qwen2.5-1.5B",
  qwenInstruct: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct",
  qwenGguf: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  qwenBlog: "https://qwenlm.github.io/blog/qwen2.5/",
  apache20: "https://www.apache.org/licenses/LICENSE-2.0",
  electronBuildContents: "https://www.electron.build/docs/contents/"
});

export function auditProductionThirdPartyNoticesDraftAndEvidence(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const inventoryAudit = options.inventoryAudit ?? auditProductionDistributionLicenseInventory({
    repoRoot: root,
    packageJson: options.packageJson,
    packageLock: options.packageLock,
    builderConfig: options.builderConfig,
    localLlmScaffold: options.localLlmScaffold,
    policyEvidence: options.policyEvidence
  });
  const noticesFiles = readLocalLlmNoticesFiles(root, options.localLlmScaffold);
  const evidenceInput = readEvidenceInput(options);
  const evidenceChecklist = buildEvidenceChecklist({
    inventoryAudit,
    evidenceInput
  });
  const readyChecks = uniqueIssueCodes([
    ...(Array.isArray(inventoryAudit.readyChecks) ? inventoryAudit.readyChecks : []),
    "draft_notices_shape_ready",
    "evidence_checklist_shape_ready",
    evidenceChecklist.qwen25.gGufArtifact.status === "shape_ready_legal_pending"
      ? "qwen25_gguf_evidence_shape_ready"
      : null,
    evidenceChecklist.llamaCppRuntime.status === "shape_ready_legal_pending"
      ? "llama_cpp_runtime_evidence_shape_ready"
      : null
  ]);
  const unsafeCodes = findUnsafeInputContent({
    packageJson: options.packageJson,
    packageLock: options.packageLock,
    builderConfig: options.builderConfig,
    localLlmScaffold: options.localLlmScaffold,
    policyEvidence: options.policyEvidence,
    evidence: options.evidence,
    modelEvidence: options.modelEvidence,
    runtimeEvidence: options.runtimeEvidence
  });
  const blockers = uniqueIssueCodes([
    ...REQUIRED_PRODUCTION_BLOCKERS,
    ...(Array.isArray(inventoryAudit.blockers) ? inventoryAudit.blockers : []),
    ...unsafeCodes
  ]);
  const warnings = uniqueIssueCodes(Array.isArray(inventoryAudit.warnings) ? inventoryAudit.warnings : []);
  const draft = createDraftSummary(noticesFiles);
  const checks = {
    draft_notices_shape: {
      status: "ready",
      basename: DRAFT_BASENAME,
      legalReviewStatus: "pending",
      finalNoticesWritePolicy: "forbidden_by_p2_20v"
    },
    evidence_checklist_shape: {
      status: "ready",
      basename: EVIDENCE_BASENAME,
      qwenGgufEvidence: evidenceChecklist.qwen25.gGufArtifact.status,
      llamaCppRuntimeEvidence: evidenceChecklist.llamaCppRuntime.status
    },
    final_third_party_notices: {
      status: "blocked",
      basename: FINAL_NOTICES_BASENAME,
      present: noticesFiles.finalPresent ? "present_not_approved" : "missing",
      templateTreatedAsFinal: "false"
    },
    inventory_audit: {
      status: safeStatus(inventoryAudit.status) ?? "unknown",
      audit: safeIdentifier(inventoryAudit.audit) ?? "unknown",
      blockerCount: Array.isArray(inventoryAudit.blockers) ? inventoryAudit.blockers.length : 0
    },
    safety: {
      status: unsafeCodes.length > 0 ? "blocked" : "ready",
      localPaths: "forbidden",
      credentials: "forbidden",
      modelInputs: "forbidden",
      requestPayloads: "forbidden",
      conversationBodies: "forbidden",
      factCardBodies: "forbidden"
    }
  };
  const draftText = createDraftText({
    inventoryAudit,
    evidenceChecklist,
    blockers,
    warnings
  });
  const writtenArtifacts = options.write === true
    ? writeDraftArtifacts({
      repoRoot: root,
      outputRoot: resolveOutputRoot(root, options.outputRoot),
      draftText,
      evidenceChecklist
    })
    : [];

  return removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    draft,
    evidenceChecklist,
    readyChecks,
    blockers,
    warnings,
    checks,
    writtenArtifacts
  });
}

function createDraftSummary(noticesFiles) {
  return {
    status: "draft_only_legal_pending",
    basename: DRAFT_BASENAME,
    finalNoticesBasename: FINAL_NOTICES_BASENAME,
    templateBasename: noticesFiles.templatePresent ? TEMPLATE_BASENAME : "missing",
    finalNoticesWritePolicy: "never_write_final_notices_in_p2_20v",
    legalReviewStatus: "pending",
    productionUse: "blocked",
    sections: DRAFT_SECTIONS
  };
}

function buildEvidenceChecklist({ inventoryAudit, evidenceInput }) {
  const packageMetadata = inventoryAudit.inventory?.packageMetadata ?? {};
  const qwenEvidence = firstPlainObject(
    evidenceInput.qwen25Gguf,
    evidenceInput.qwenGguf,
    evidenceInput.model,
    evidenceInput.modelEvidence,
    firstArrayEntry(evidenceInput.modelLicenses?.entries),
    firstArrayEntry(evidenceInput.modelLicenseEvidence?.entries)
  );
  const runtimeEvidence = firstPlainObject(
    evidenceInput.llamaCppRuntime,
    evidenceInput.runtime,
    evidenceInput.runtimeEvidence,
    firstArrayEntry(evidenceInput.runtimeLicenses?.entries),
    firstArrayEntry(evidenceInput.runtimeLicenseEvidence?.entries)
  );
  const qwenGguf = summarizeQwenGgufEvidence(qwenEvidence);
  const llamaRuntime = summarizeLlamaCppRuntimeEvidence(runtimeEvidence);

  return {
    status: "draft_legal_pending",
    packageLockLicenseCoverage: removeUndefined({
      status: safeStatus(packageMetadata.packageLockLicenseCoverage?.status),
      packageCount: safeNonNegativeInteger(packageMetadata.packageLockLicenseCoverage?.packageCount),
      licensePresentCount: safeNonNegativeInteger(packageMetadata.packageLockLicenseCoverage?.licensePresentCount),
      missingLicenseCount: safeNonNegativeInteger(packageMetadata.packageLockLicenseCoverage?.missingLicenseCount),
      unknownLicenseCount: safeNonNegativeInteger(packageMetadata.packageLockLicenseCoverage?.unknownLicenseCount),
      unsafeLicenseCount: safeNonNegativeInteger(packageMetadata.packageLockLicenseCoverage?.unsafeLicenseCount)
    }),
    npmLicensePolicy: {
      packageLicense: safeLicenseOrStatus(packageMetadata.license),
      spdxExpressionUse: "pending_legal_review",
      unlicensedAppPolicy: "distribution_policy_pending"
    },
    mitNoticePreservation: [
      {
        role: "electron_runtime_mit_notice",
        basename: "LICENSE",
        license: "MIT",
        url: SOURCE_URLS.electronLicense,
        status: "pending_packaged_app_evidence"
      },
      {
        role: "pangu_runtime_dependency_notice",
        packageName: "pangu",
        license: "MIT",
        url: SOURCE_URLS.panguLicense,
        status: readRuntimeEntryStatus(inventoryAudit, "pangu-runtime-dependency")
      },
      {
        role: "llama_cpp_runtime_notice",
        license: "MIT",
        url: SOURCE_URLS.llamaCppLicense,
        status: llamaRuntime.status
      },
      {
        role: "ggml_runtime_notice",
        license: "MIT",
        url: SOURCE_URLS.ggmlLicense,
        status: "pending_runtime_pack_evidence"
      },
      {
        role: "electron_builder_build_tool_notice",
        packageName: "electron-builder",
        license: "MIT",
        status: readBuildToolStatus(inventoryAudit, "electron-builder")
      }
    ],
    electronPackagedRuntimeNotices: {
      status: "pending_packaged_app_evidence",
      runtimeRole: "electron_builder_packaged_runtime",
      requiredBasenames: ["LICENSE", "LICENSES.chromium.html", "ffmpeg.dll"],
      pendingComponents: ["Chromium", "Node", "ffmpeg"],
      url: SOURCE_URLS.electronManifest
    },
    qwen25: {
      baseModel: {
        role: "upstream_base_model",
        repo: "Qwen/Qwen2.5-1.5B",
        url: SOURCE_URLS.qwenBase,
        license: "Apache-2.0",
        status: "pending_legal_review"
      },
      instructModel: {
        role: "instruct_model",
        repo: "Qwen/Qwen2.5-1.5B-Instruct",
        url: SOURCE_URLS.qwenInstruct,
        license: "Apache-2.0",
        status: "pending_legal_review"
      },
      gGufArtifact: qwenGguf
    },
    llamaCppRuntime: llamaRuntime,
    additionalRuntimeLibraries: {
      role: "runtime_dll_evidence_checklist",
      basenames: llamaRuntime.runtimeDllBasenames,
      status: llamaRuntime.runtimeDllBasenames.length > 0
        ? "shape_ready_legal_pending"
        : "pending_runtime_pack_evidence"
    },
    electronBuilderResources: {
      filesConfigured: readInventoryCheckStatus(inventoryAudit, "electron_builder_distribution_inputs"),
      extraResourcesRole: "local-llm",
      packagedResourcesPathRole: "resources/local-llm",
      url: SOURCE_URLS.electronBuildContents,
      status: "pending_packaged_app_evidence"
    },
    buildTimeTools: safeBuildTimeEntries(inventoryAudit),
    appOwnedResources: [
      {
        role: "app_icon_resources",
        status: readRuntimeEntryStatus(inventoryAudit, "app-icon-resources")
      }
    ],
    safetySummary: {
      basenamesOnly: "required_for_local_files",
      localPaths: "forbidden",
      credentials: "forbidden",
      modelInputs: "forbidden",
      requestPayloads: "forbidden",
      conversationBodies: "forbidden",
      factCardBodies: "forbidden"
    }
  };
}

function summarizeQwenGgufEvidence(evidence) {
  const fileBasename = safeBasename(evidence?.file ?? evidence?.fileBasename ?? evidence?.basename);
  const revision = safeIdentifier(evidence?.revision ?? evidence?.commit);
  const license = safeLicenseOrStatus(evidence?.license ?? "Apache-2.0");
  const sha256 = safeSha256(evidence?.sha256);
  const sizeBytes = safePositiveInteger(evidence?.sizeBytes ?? evidence?.size);
  const repo = safeRepo(evidence?.repo) ?? "Qwen/Qwen2.5-1.5B-Instruct-GGUF";
  const hasRequiredShape = repo
    && isUsableBasename(fileBasename)
    && revision
    && license === "Apache-2.0"
    && sha256 !== "missing"
    && sizeBytes !== undefined;

  return removeUndefined({
    role: "gguf_artifact",
    repo,
    url: safeHttpsUrl(evidence?.url) ?? SOURCE_URLS.qwenGguf,
    fileBasename,
    revision: revision ?? "missing",
    license,
    licenseUrl: safeHttpsUrl(evidence?.licenseUrl) ?? SOURCE_URLS.apache20,
    format: safeIdentifier(evidence?.format) ?? "GGUF",
    quantization: safeIdentifier(evidence?.quantization) ?? undefined,
    sha256,
    sizeBytes,
    provenanceStatus: "base_instruct_gguf_split_pending_legal_review",
    status: hasRequiredShape ? "shape_ready_legal_pending" : "pending_evidence"
  });
}

function summarizeLlamaCppRuntimeEvidence(evidence) {
  const assetBasename = safeBasename(evidence?.assetName ?? evidence?.assetBasename ?? evidence?.file);
  const releaseTag = safeIdentifier(evidence?.releaseTag ?? evidence?.tag);
  const commit = safeIdentifier(evidence?.commit ?? evidence?.releaseOrCommit);
  const platform = safeIdentifier(evidence?.platform);
  const backend = safeIdentifier(evidence?.backend);
  const license = safeLicenseOrStatus(evidence?.license ?? "MIT");
  const sha256 = safeSha256(evidence?.sha256);
  const runtimeExeBasenames = safeBasenameArray(
    evidence?.runtimeExeBasenames
      ?? evidence?.executableBasenames
      ?? evidence?.executables
      ?? evidence?.runtimeExecutables
  );
  const runtimeDllBasenames = safeBasenameArray(
    evidence?.runtimeDllBasenames
      ?? evidence?.dllBasenames
      ?? evidence?.dlls
      ?? evidence?.runtimeDlls
  );
  const hasRequiredShape = releaseTag
    && commit
    && isUsableBasename(assetBasename)
    && platform
    && backend
    && license === "MIT"
    && sha256 !== "missing"
    && runtimeExeBasenames.length > 0;

  return removeUndefined({
    role: "llama_cpp_runtime_candidate",
    repo: safeRepo(evidence?.repo) ?? "ggml-org/llama.cpp",
    url: safeHttpsUrl(evidence?.url) ?? "https://github.com/ggml-org/llama.cpp/releases",
    releaseTag: releaseTag ?? "missing",
    commit: commit ?? "missing",
    assetBasename,
    platform: platform ?? "missing",
    backend: backend ?? "missing",
    license,
    licenseUrl: safeHttpsUrl(evidence?.licenseUrl) ?? SOURCE_URLS.llamaCppLicense,
    sha256,
    runtimeExeBasenames,
    runtimeDllBasenames,
    status: hasRequiredShape ? "shape_ready_legal_pending" : "pending_evidence"
  });
}

function createDraftText({ inventoryAudit, evidenceChecklist, blockers, warnings }) {
  const packageMetadata = inventoryAudit.inventory?.packageMetadata ?? {};
  const panguEntry = readRuntimeEntry(inventoryAudit, "pangu-runtime-dependency");
  const electronEntry = readRuntimeEntry(inventoryAudit, "electron-runtime");

  return [
    "# Third Party Notices Draft",
    "",
    "Draft only.",
    "Legal review pending.",
    `Do not ship as final ${FINAL_NOTICES_BASENAME}.`,
    "",
    "## Draft / Legal Status",
    "",
    `- Phase: ${PHASE}`,
    "- Status: blocked",
    "- Production ready claim: false",
    "- Final notices approval: pending",
    "",
    "## Application Package Metadata",
    "",
    `- Package name: ${safeIdentifier(packageMetadata.name) ?? "missing"}`,
    `- Version: ${safeVersion(packageMetadata.version)}`,
    `- Private package: ${safeStatus(packageMetadata.privatePackage) ?? "missing"}`,
    `- App license: ${safeLicenseOrStatus(packageMetadata.license)}`,
    "",
    "## Electron Runtime",
    "",
    `- Package: electron`,
    `- Version: ${safeVersion(electronEntry?.version)}`,
    `- License: ${safeLicenseOrStatus(electronEntry?.license ?? "MIT")}`,
    `- Evidence URL: ${SOURCE_URLS.electronLicense}`,
    "",
    "## Chromium / Node / ffmpeg Bundled Notices Pending",
    "",
    "- Required packaged runtime evidence: LICENSE, LICENSES.chromium.html, ffmpeg.dll or equivalent notice files.",
    "- Chromium, Node, and ffmpeg notices are pending approval.",
    "",
    "## pangu Runtime Dependency",
    "",
    `- Package: pangu`,
    `- Version: ${safeVersion(panguEntry?.version)}`,
    `- License: ${safeLicenseOrStatus(panguEntry?.license ?? "MIT")}`,
    `- Evidence URL: ${SOURCE_URLS.panguLicense}`,
    "",
    "## local LLM llama.cpp Runtime Candidate",
    "",
    `- Repo: ${evidenceChecklist.llamaCppRuntime.repo}`,
    `- Release tag: ${evidenceChecklist.llamaCppRuntime.releaseTag}`,
    `- Commit: ${evidenceChecklist.llamaCppRuntime.commit}`,
    `- Asset basename: ${evidenceChecklist.llamaCppRuntime.assetBasename}`,
    `- License: ${evidenceChecklist.llamaCppRuntime.license}`,
    `- SHA-256: ${evidenceChecklist.llamaCppRuntime.sha256}`,
    "- Runtime executable and DLL evidence remains pending legal review.",
    "",
    "## Qwen2.5 1.5B Base / Instruct / GGUF Provenance",
    "",
    `- Base model: ${evidenceChecklist.qwen25.baseModel.repo} (${evidenceChecklist.qwen25.baseModel.license})`,
    `- Instruct model: ${evidenceChecklist.qwen25.instructModel.repo} (${evidenceChecklist.qwen25.instructModel.license})`,
    `- GGUF repo: ${evidenceChecklist.qwen25.gGufArtifact.repo}`,
    `- GGUF file basename: ${evidenceChecklist.qwen25.gGufArtifact.fileBasename}`,
    `- GGUF revision: ${evidenceChecklist.qwen25.gGufArtifact.revision}`,
    `- GGUF SHA-256: ${evidenceChecklist.qwen25.gGufArtifact.sha256}`,
    "- Apache-2.0 model evidence remains pending legal review.",
    "",
    "## Additional Runtime Libraries / DLL Evidence Checklist",
    "",
    `- DLL basenames: ${evidenceChecklist.additionalRuntimeLibraries.basenames.join(", ") || "pending"}`,
    "- DLL license and provenance review remains pending.",
    "",
    "## Build-Time Tools",
    "",
    ...evidenceChecklist.buildTimeTools.map((entry) => (
      `- ${entry.packageName}: ${entry.license} (${entry.status})`
    )),
    "",
    "## App-Owned Resources",
    "",
    "- App icon and project-owned resources require owner confirmation before production release.",
    "",
    "## Blocked Production Gates",
    "",
    ...blockers.map((blocker) => `- ${blocker}`),
    ...(warnings.length > 0 ? ["", "## Warnings", "", ...warnings.map((warning) => `- ${warning}`)] : []),
    ""
  ].join("\n");
}

function writeDraftArtifacts({ repoRoot, outputRoot, draftText, evidenceChecklist }) {
  mkdirSync(outputRoot, { recursive: true });

  const draftPath = join(outputRoot, DRAFT_BASENAME);
  const evidencePath = join(outputRoot, EVIDENCE_BASENAME);

  writeFileSync(draftPath, draftText, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(removeUndefined(evidenceChecklist), null, 2)}\n`, "utf8");

  return [
    {
      basename: DRAFT_BASENAME,
      relativePath: normalizeSlashes(relative(repoRoot, draftPath)),
      role: "draft_notices",
      status: "written"
    },
    {
      basename: EVIDENCE_BASENAME,
      relativePath: normalizeSlashes(relative(repoRoot, evidencePath)),
      role: "safe_evidence_checklist",
      status: "written"
    }
  ];
}

function resolveOutputRoot(root, outputRoot) {
  const resolved = outputRoot ? resolve(outputRoot) : join(root, DEFAULT_OUTPUT_ROOT);
  const tmpRoot = resolve(root, ".tmp");
  const relativeToTmp = relative(tmpRoot, resolved);

  if (relativeToTmp === "" || (!relativeToTmp.startsWith("..") && !isAbsolute(relativeToTmp))) {
    return resolved;
  }

  throw new Error("unsafe_output_root");
}

function readEvidenceInput(options) {
  if (isPlainObject(options.evidence)) {
    return options.evidence;
  }

  if (isPlainObject(options.policyEvidence)) {
    return options.policyEvidence;
  }

  return removeUndefined({
    modelEvidence: options.modelEvidence,
    runtimeEvidence: options.runtimeEvidence
  });
}

function readLocalLlmNoticesFiles(root, injectedScaffold) {
  if (isPlainObject(injectedScaffold)) {
    return {
      templatePresent: injectedScaffold.noticesTemplatePresent === true,
      finalPresent: injectedScaffold.thirdPartyNoticesPresent === true,
      finalPlaceholder: injectedScaffold.thirdPartyNoticesPlaceholder === true
    };
  }

  const licenseRoot = join(root, "resources", "local-llm", "licenses");
  const templatePath = join(licenseRoot, TEMPLATE_BASENAME);
  const finalPath = join(licenseRoot, FINAL_NOTICES_BASENAME);
  const finalPresent = isExistingFile(finalPath);

  return {
    templatePresent: isExistingFile(templatePath),
    finalPresent,
    finalPlaceholder: finalPresent ? isLikelyPlaceholderText(readSmallText(finalPath)) : false
  };
}

function safeBuildTimeEntries(inventoryAudit) {
  const entries = Array.isArray(inventoryAudit.inventory?.buildTimeEntries)
    ? inventoryAudit.inventory.buildTimeEntries
    : [];

  return entries.map((entry) => removeUndefined({
    role: "build_time_only",
    packageName: safePackageName(entry.packageName ?? entry.name),
    license: safeLicenseOrStatus(entry.license),
    status: safeStatus(entry.status) ?? "unknown"
  })).filter((entry) => entry.packageName);
}

function readRuntimeEntry(inventoryAudit, id) {
  return Array.isArray(inventoryAudit.inventory?.runtimeShippedEntries)
    ? inventoryAudit.inventory.runtimeShippedEntries.find((entry) => entry.id === id)
    : undefined;
}

function readRuntimeEntryStatus(inventoryAudit, id) {
  return safeStatus(readRuntimeEntry(inventoryAudit, id)?.status) ?? "pending_evidence";
}

function readBuildToolStatus(inventoryAudit, packageName) {
  const entry = Array.isArray(inventoryAudit.inventory?.buildTimeEntries)
    ? inventoryAudit.inventory.buildTimeEntries.find((candidate) => candidate.packageName === packageName)
    : undefined;

  return safeStatus(entry?.status) ?? "pending_evidence";
}

function readInventoryCheckStatus(inventoryAudit, name) {
  return safeStatus(inventoryAudit.checks?.[name]?.status) ?? "unknown";
}

function findUnsafeInputContent(value) {
  const codes = new Set();
  const rawText = JSON.stringify(value);

  if (!rawText) {
    return [];
  }

  if (/[A-Za-z]:\\/.test(rawText) || /(^|["'\s])\/(?:Users|home|tmp|var)\//i.test(rawText)) {
    codes.add("privacy_local_path_leak");
  }

  visitValue(value, [], (path, entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const currentKey = path.at(-1) ?? "";
    const joinedPath = path.join(".");

    if (/[A-Za-z]:\\/.test(entry) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(entry)) {
      codes.add("privacy_local_path_leak");
    }

    if (SECRETISH_PATTERN.test(`${joinedPath} ${currentKey} ${entry}`)) {
      codes.add("privacy_secret_leak");
    }

    if (MODEL_INPUT_PATTERN.test(`${currentKey} ${entry}`)) {
      codes.add("privacy_model_input_leak");
    }

    if (REQUEST_PATTERN.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_request_payload_leak");
    }

    if (CONVERSATION_PATTERN.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_conversation_body_leak");
    }

    if (FACT_PATTERN.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_fact_body_leak");
    }
  });

  return Array.from(codes);
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

function firstPlainObject(...values) {
  return values.find(isPlainObject) ?? {};
}

function firstArrayEntry(value) {
  return Array.isArray(value) ? value.find(isPlainObject) : undefined;
}

function readSmallText(path) {
  try {
    return readFileSync(path, "utf8").replace(/^\uFEFF/, "").slice(0, 32_000);
  } catch {
    return "";
  }
}

function isLikelyPlaceholderText(text) {
  const trimmed = readNonEmptyString(text);
  return !trimmed || /Fill this file before packaging/i.test(trimmed) || /TODO|TBD|replace-with|template/i.test(trimmed);
}

function isExistingFile(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function safeBasenameArray(value) {
  const values = Array.isArray(value) ? value : readNonEmptyString(value) ? [value] : [];

  return values
    .map(safeBasename)
    .filter(isUsableBasename)
    .slice(0, 50);
}

function isUsableBasename(value) {
  return Boolean(value)
    && value !== "missing"
    && value !== "redacted_sensitive_basename"
    && value !== "redacted_unsafe_basename";
}

function safeBasename(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return "missing";
  }

  const name = basename(text.replace(/\\/g, "/"));

  if (!name) {
    return "missing";
  }

  if (isUnsafeText(name)) {
    return "redacted_sensitive_basename";
  }

  return /^[a-z0-9_ .${}()@+\-[\].]+$/i.test(name) ? name : "redacted_unsafe_basename";
}

function safeRepo(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function safePackageName(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_@./+-]+$/i.test(text) && !isUnsafeText(text) ? text : undefined;
}

function safeVersion(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_.~^*<>=| -]+$/i.test(text) && !isUnsafeText(text) ? text : text ? "invalid_or_redacted" : "missing";
}

function safeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function safeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function safeLicenseOrStatus(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return "missing";
  }

  if (isUnsafeText(text) || /[A-Za-z]:\\/.test(text) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(text)) {
    return "invalid_or_redacted";
  }

  return /^[a-z0-9 .()+-]+$/i.test(text) ? text : "invalid_or_redacted";
}

function safeSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : "missing";
}

function safePositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function safeNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safeHttpsUrl(value) {
  const text = readNonEmptyString(value);

  if (!text || isUnsafeText(text)) {
    return null;
  }

  try {
    const url = new URL(text);

    if (url.protocol !== "https:" || url.username || url.password || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isUnsafeText(value) {
  return SECRETISH_PATTERN.test(value)
    || MODEL_INPUT_PATTERN.test(value)
    || REQUEST_PATTERN.test(value)
    || CONVERSATION_PATTERN.test(value)
    || FACT_PATTERN.test(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueIssueCodes(codes) {
  return Array.from(new Set(codes.filter(Boolean))).sort();
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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    printJson(auditProductionThirdPartyNoticesDraftAndEvidence({
      write: process.argv.includes("--write")
    }));
  } catch (error) {
    printJson({
      ok: false,
      status: "script_failed",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      exitPolicy: "always_zero",
      productionReadyClaim: false,
      reason: error instanceof Error ? error.name : "unexpected_error"
    });
  }
}
