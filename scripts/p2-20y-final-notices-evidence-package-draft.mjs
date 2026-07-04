import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditProductionLocalLlmArtifact } from "./p2-20o-production-local-llm-artifact-review.mjs";
import { auditProductionReleaseChecklist } from "./p2-20q-production-release-checklist-audit.mjs";
import { auditReleaseVersionLicensePolicy } from "./p2-20t-release-version-license-policy-audit.mjs";
import { auditProductionDistributionLicenseInventory } from "./p2-20u-production-distribution-license-inventory-audit.mjs";
import { auditProductionThirdPartyNoticesDraftAndEvidence } from "./p2-20v-production-third-party-notices-draft-and-evidence.mjs";
import { auditElectronChromiumNoticesPackagedArtifact } from "./p2-20w-electron-chromium-notices-packaged-artifact-audit.mjs";
import { auditElectronVersionInstallerNotices } from "./p2-20x-electron-version-installer-notices-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20Y";
const AUDIT_NAME = "final_notices_evidence_package_draft";
const DEFAULT_OUTPUT_ROOT = ".tmp/p2-20y-final-notices-evidence-package-draft";
const DRAFT_BASENAME = "final-notices-evidence-package-draft.md";
const EVIDENCE_BASENAME = "final-notices-evidence-package-draft.json";
const FINAL_NOTICES_BASENAME = "THIRD_PARTY_NOTICES.md";
const SOURCE_ORDER = [
  ["productionLocalLlmArtifact", "P2-20O", "Production local LLM artifact"],
  ["productionReleaseChecklist", "P2-20Q", "Production release checklist"],
  ["releaseVersionLicensePolicy", "P2-20T", "Release version/license policy"],
  ["productionLicenseInventory", "P2-20U", "Production license inventory"],
  ["thirdPartyNoticesDraft", "P2-20V", "Third-party notices draft"],
  ["electronChromiumPackagedArtifact", "P2-20W", "Electron/Chromium packaged artifact notices"],
  ["electronVersionInstallerNotices", "P2-20X", "Electron version installer notices"]
];
const REQUIRED_PRODUCTION_BLOCKERS = [
  "package_version_0_0_0",
  "app_distribution_license_policy_pending",
  "owner_release_approval_missing",
  "legal_review_not_approved",
  "third_party_notices_not_approved",
  "final_third_party_notices_missing",
  "electron_chromium_notices_not_approved",
  "model_license_evidence_missing",
  "runtime_license_evidence_missing",
  "local_llm_production_pack_missing",
  "production_release_not_approved"
];
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|user memory body)/i;

export async function auditFinalNoticesEvidencePackageDraft(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const sourceAudits = options.sourceAudits ?? await collectSourceAudits(root, options);
  const unsafeCodes = findUnsafeInputContent(sourceAudits);
  const sourceSummaries = summarizeSourceAudits(sourceAudits);
  const evidenceSources = Object.fromEntries(
    SOURCE_ORDER.map(([key]) => [key, safeStatus(sourceSummaries[key]?.status) ?? "unknown"])
  );
  const readyChecks = uniqueIssueCodes([
    "final_notices_evidence_package_draft_shape_ready",
    "final_notices_evidence_source_summaries_ready",
    ...collectIssueCodes(sourceAudits, "readyChecks")
  ]);
  const blockers = uniqueIssueCodes([
    ...REQUIRED_PRODUCTION_BLOCKERS,
    ...collectIssueCodes(sourceAudits, "blockers"),
    ...unsafeCodes
  ]);
  const warnings = uniqueIssueCodes([
    "final_notices_evidence_package_draft_only",
    "formal_third_party_notices_write_forbidden",
    ...collectIssueCodes(sourceAudits, "warnings")
  ]);
  let summary = sanitizeForOutput(removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    packageDraft: {
      status: "draft_only_legal_pending",
      outputPolicy: "tmp_draft_only",
      outputRoot: DEFAULT_OUTPUT_ROOT,
      markdownBasename: DRAFT_BASENAME,
      evidenceBasename: EVIDENCE_BASENAME,
      finalNoticesBasename: FINAL_NOTICES_BASENAME,
      finalNoticesWritePolicy: "forbidden_by_p2_20y",
      legalReviewStatus: "pending",
      ownerApprovalStatus: "missing",
      productionUse: "blocked"
    },
    evidenceSources,
    sourceSummaries,
    readyChecks,
    blockers,
    warnings,
    writtenArtifacts: []
  }));

  if (options.write === true) {
    const outputRoot = resolveOutputRoot(root);
    assertSafeOutputRoot(root, outputRoot);
    const writtenArtifacts = plannedWrittenArtifacts(root, outputRoot);

    summary = {
      ...summary,
      writtenArtifacts
    };

    writeDraftArtifacts(outputRoot, summary);

    if (options.cleanup === true) {
      cleanupOutputRoot(root, outputRoot);
      summary = {
        ...summary,
        writtenArtifacts: writtenArtifacts.map((artifact) => ({
          ...artifact,
          status: "removed_after_cleanup"
        })),
        cleanup: {
          status: "removed",
          outputRoot: DEFAULT_OUTPUT_ROOT
        }
      };
    }
  } else if (options.cleanup === true) {
    const outputRoot = resolveOutputRoot(root);
    assertSafeOutputRoot(root, outputRoot);
    cleanupOutputRoot(root, outputRoot);
    summary = {
      ...summary,
      cleanup: {
        status: "removed",
        outputRoot: DEFAULT_OUTPUT_ROOT
      }
    };
  }

  return sanitizeForOutput(removeUndefined(summary));
}

async function collectSourceAudits(root, options) {
  const env = options.env ?? {};
  const productionLicenseInventory = auditProductionDistributionLicenseInventory({
    repoRoot: root
  });
  const thirdPartyNoticesDraft = auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot: root,
    inventoryAudit: productionLicenseInventory
  });

  return {
    productionLocalLlmArtifact: await auditProductionLocalLlmArtifact({
      repoRoot: root,
      env
    }),
    productionReleaseChecklist: auditProductionReleaseChecklist({
      repoRoot: root,
      env
    }),
    releaseVersionLicensePolicy: auditReleaseVersionLicensePolicy({
      repoRoot: root
    }),
    productionLicenseInventory,
    thirdPartyNoticesDraft,
    electronChromiumPackagedArtifact: auditElectronChromiumNoticesPackagedArtifact({
      repoRoot: root,
      packagedAppRoot: options.packagedAppRoot,
      noticesAudit: thirdPartyNoticesDraft
    }),
    electronVersionInstallerNotices: auditElectronVersionInstallerNotices({
      repoRoot: root,
      installedAppRoot: options.installedAppRoot,
      noticesAudit: thirdPartyNoticesDraft
    })
  };
}

function summarizeSourceAudits(sourceAudits) {
  return Object.fromEntries(SOURCE_ORDER.map(([key, phase, label]) => {
    const audit = normalizeAudit(sourceAudits?.[key]);

    return [key, removeUndefined({
      phase: safeIdentifier(audit.phase) ?? phase,
      audit: safeIdentifier(audit.audit) ?? key,
      label,
      status: safeStatus(audit.status) ?? "unknown",
      ok: audit.ok === true,
      productionReadyClaim: audit.productionReadyClaim === true,
      blockerCount: countIssueCodes(audit.blockers),
      warningCount: countIssueCodes(audit.warnings),
      readyCheckCount: countIssueCodes(audit.readyChecks),
      keyEvidenceStatus: summarizeKeyEvidenceStatus(key, audit)
    })];
  }));
}

function normalizeAudit(value) {
  if (isPlainObject(value?.summary)) {
    return value.summary;
  }

  return isPlainObject(value) ? value : {};
}

function summarizeKeyEvidenceStatus(key, audit) {
  if (key === "productionLocalLlmArtifact") {
    return safeStatus(audit.resourceSource) ?? "unknown";
  }

  if (key === "productionReleaseChecklist") {
    return safeStatus(audit.releaseManifest?.status) ?? "unknown";
  }

  if (key === "releaseVersionLicensePolicy") {
    return safeStatus(audit.policy?.licenseDecisionStatus) ?? "unknown";
  }

  if (key === "productionLicenseInventory") {
    return safeStatus(audit.inventory?.packageMetadata?.packageLockLicenseCoverage?.status) ?? "unknown";
  }

  if (key === "thirdPartyNoticesDraft") {
    return safeStatus(audit.draft?.status) ?? "unknown";
  }

  if (key === "electronChromiumPackagedArtifact") {
    return safeStatus(audit.packagedArtifactStatus) ?? "unknown";
  }

  if (key === "electronVersionInstallerNotices") {
    return safeStatus(audit.installedAppStatus) ?? "unknown";
  }

  return "unknown";
}

function collectIssueCodes(sourceAudits, field) {
  const codes = [];

  for (const [key] of SOURCE_ORDER) {
    const audit = normalizeAudit(sourceAudits?.[key]);
    const entries = Array.isArray(audit[field]) ? audit[field] : [];
    codes.push(...entries.map(safeIssueCode).filter(Boolean));
  }

  return codes;
}

function countIssueCodes(codes) {
  return Array.isArray(codes) ? codes.map(safeIssueCode).filter(Boolean).length : 0;
}

function plannedWrittenArtifacts(root, outputRoot) {
  return [
    {
      basename: DRAFT_BASENAME,
      relativePath: normalizeSlashes(relative(root, join(outputRoot, DRAFT_BASENAME))),
      role: "final_notices_evidence_package_markdown_draft",
      status: "written"
    },
    {
      basename: EVIDENCE_BASENAME,
      relativePath: normalizeSlashes(relative(root, join(outputRoot, EVIDENCE_BASENAME))),
      role: "safe_evidence_package_json_draft",
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
  const sourceLines = SOURCE_ORDER.map(([key, phase, label]) => {
    const source = summary.sourceSummaries[key];
    return `- ${phase} ${label}: ${source.status}; blockers=${source.blockerCount}; warnings=${source.warningCount}; readyChecks=${source.readyCheckCount}`;
  });
  const blockerLines = summary.blockers.map((blocker) => `- ${blocker}`);
  const warningLines = summary.warnings.map((warning) => `- ${warning}`);
  const readyCheckLines = summary.readyChecks.map((readyCheck) => `- ${readyCheck}`);

  return [
    "# P2-20Y Final Notices Evidence Package Draft",
    "",
    "Draft only.",
    "Legal review pending.",
    `Do not ship as final ${FINAL_NOTICES_BASENAME}.`,
    "Production ready claim: false.",
    "",
    "## Package Draft Status",
    "",
    `- Status: ${summary.packageDraft.status}`,
    `- Output policy: ${summary.packageDraft.outputPolicy}`,
    `- Final notices write policy: ${summary.packageDraft.finalNoticesWritePolicy}`,
    `- Legal review status: ${summary.packageDraft.legalReviewStatus}`,
    "",
    "## Evidence Sources",
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
    "## Manual Review Checklist",
    "",
    "- Legal review approval is required before any final notices file is created.",
    "- Owner release approval is required before any production release claim.",
    "- Model/runtime license evidence and production local LLM pack evidence remain required.",
    "- GitHub Release, signing, timestamping, and attestation remain required.",
    ""
  ].join("\n");
}

function resolveOutputRoot(root) {
  return join(root, DEFAULT_OUTPUT_ROOT);
}

function assertSafeOutputRoot(root, outputRoot) {
  const tmpRoot = resolve(root, ".tmp");
  const resolvedOutput = resolve(outputRoot);
  const relativeToTmp = relative(tmpRoot, resolvedOutput);

  if (relativeToTmp === "p2-20y-final-notices-evidence-package-draft") {
    return;
  }

  throw new Error("unsafe_output_root");
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

  if (isSafeIssueCode(value) || isExpectedSafePublicText(value)) {
    return value;
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

function containsLocalPath(value) {
  return /[A-Za-z]:\\/.test(value) || /(^|["'\s])\/(?:Users|home|tmp|var)\//i.test(value);
}

function safeIssueCode(value) {
  const text = readNonEmptyString(value);

  if (!text || !isSafeIssueCode(text)) {
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

function isSafeIssueCode(value) {
  return /^[a-z0-9_./:@+-]+$/i.test(value);
}

function isExpectedSafePublicText(value) {
  return /^[a-z0-9_./:@+${}() \-[\]]+$/i.test(value) || /^https:\/\/[a-z0-9./:@?&=+%#_-]+$/i.test(value);
}

function safeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) ? text : null;
}

function safeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) ? text : null;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueIssueCodes(codes) {
  return Array.from(new Set(codes.map(safeIssueCode).filter(Boolean))).sort();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--write") {
      options.write = true;
      continue;
    }

    if (arg === "--cleanup") {
      options.cleanup = true;
      continue;
    }

    if (arg === "--packaged-app-root") {
      const next = args[index + 1];

      if (!readNonEmptyString(next)) {
        throw new Error("missing_packaged_app_root_value");
      }

      options.packagedAppRoot = next;
      index += 1;
      continue;
    }

    if (arg === "--installed-app-root") {
      const next = args[index + 1];

      if (!readNonEmptyString(next)) {
        throw new Error("missing_installed_app_root_value");
      }

      options.installedAppRoot = next;
      index += 1;
    }
  }

  return options;
}

function safeErrorReason(error) {
  const raw = error instanceof Error ? error.message : "unexpected_error";
  return sanitizeString(raw) === raw && /^[a-z0-9_./:@+ -]+$/i.test(raw) ? raw : "unexpected_error";
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(sanitizeForOutput(removeUndefined(value)), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditFinalNoticesEvidencePackageDraft(parseCliArgs(process.argv.slice(2)))
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
