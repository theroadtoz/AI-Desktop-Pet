import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditFinalNoticesEvidencePackageDraft } from "./p2-20y-final-notices-evidence-package-draft.mjs";
import { auditProductionThirdPartyNoticesDraftAndEvidence } from "./p2-20v-production-third-party-notices-draft-and-evidence.mjs";
import { auditProductionDistributionLicenseInventory } from "./p2-20u-production-distribution-license-inventory-audit.mjs";
import { auditReleaseVersionLicensePolicy } from "./p2-20t-release-version-license-policy-audit.mjs";
import { auditProductionReleaseChecklist } from "./p2-20q-production-release-checklist-audit.mjs";
import { auditProductionLocalLlmProvenanceAndLicenseEvidence } from "./p2-30h-production-local-llm-provenance-and-license-evidence.mjs";

const PHASE = "P2-30J";
const AUDIT_NAME = "final_notices_release_approval_gate_draft";
const DEFAULT_OUTPUT_ROOT = ".tmp/p2-30j-final-notices-release-approval-gate-draft";
const DRAFT_BASENAME = "final-notices-release-approval-gate-draft.md";
const EVIDENCE_BASENAME = "final-notices-release-approval-gate-draft.json";
const SOURCE_ORDER = [
  ["finalNoticesEvidencePackage", "P2-20Y", "Final notices evidence package draft"],
  ["thirdPartyNoticesDraft", "P2-20V", "Third-party notices draft"],
  ["productionLicenseInventory", "P2-20U", "Production distribution license inventory"],
  ["releaseVersionLicensePolicy", "P2-20T", "Release version/license policy"],
  ["productionReleaseChecklist", "P2-20Q", "Production release checklist"],
  ["localLlmProvenanceEvidence", "P2-30H", "Production local LLM provenance evidence"]
];
const REQUIRED_GATE_BLOCKERS = Object.freeze([
  "app_distribution_license_policy_pending",
  "final_third_party_notices_missing",
  "legal_review_not_approved",
  "model_license_evidence_not_approved",
  "owner_release_approval_missing",
  "production_local_llm_pack_not_approved",
  "production_ready_claim_forbidden",
  "production_release_not_approved",
  "runtime_license_evidence_not_approved",
  "third_party_notices_not_approved"
]);
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request|provider request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|memory card|user memory body)/i;

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function auditFinalNoticesReleaseApprovalGateDraft(options = {}) {
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const sourceAudits = options.sourceAudits ?? await collectSourceAudits(repoRoot, options);
  const unsafeCodes = findUnsafeInputContent(sourceAudits);
  const sourceSummaries = summarizeSourceAudits(sourceAudits);
  const gate = buildGate(sourceAudits);
  const readyChecks = uniqueIssueCodes([
    "release_approval_gate_draft_shape_ready",
    "release_approval_gate_source_summaries_ready",
    ...collectIssueCodes(sourceAudits, "readyChecks")
  ]);
  const blockers = uniqueIssueCodes([
    ...REQUIRED_GATE_BLOCKERS,
    ...gate.blockers,
    ...collectIssueCodes(sourceAudits, "blockers"),
    ...unsafeCodes
  ]);
  const warnings = uniqueIssueCodes([
    "approval_gate_draft_only",
    "formal_final_notices_write_forbidden",
    "manual_owner_legal_review_required",
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
    gate: stripGateIssues(gate),
    sourceSummaries,
    requiredManualApprovals: [
      "owner_release_approval",
      "legal_review_approval",
      "license_policy_decision",
      "model_license_evidence_approval",
      "runtime_license_evidence_approval",
      "final_third_party_notices_approval",
      "production_release_approval"
    ],
    readyChecks,
    blockers,
    warnings,
    writtenArtifacts: [],
    nextRequiredSteps: [
      "prepare_owner_legal_approval_template",
      "prepare_final_third_party_notices_for_review",
      "attach_model_runtime_license_evidence_for_review",
      "approve_release_manifest_after_installer_artifacts_exist"
    ]
  }));

  if (options.write === true) {
    const outputRoot = resolveOutputRoot(repoRoot, options.outputRoot);
    assertSafeOutputRoot(repoRoot, outputRoot);
    const artifacts = plannedWrittenArtifacts(repoRoot, outputRoot);
    summary = {
      ...summary,
      writtenArtifacts: artifacts
    };
    writeDraftArtifacts(outputRoot, summary);

    if (options.cleanup === true) {
      cleanupOutputRoot(repoRoot, outputRoot);
      summary = {
        ...summary,
        writtenArtifacts: artifacts.map((artifact) => ({
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
    const outputRoot = resolveOutputRoot(repoRoot, options.outputRoot);
    assertSafeOutputRoot(repoRoot, outputRoot);
    cleanupOutputRoot(repoRoot, outputRoot);
    summary = {
      ...summary,
      cleanup: {
        status: "removed",
        outputRoot: DEFAULT_OUTPUT_ROOT
      }
    };
  }

  return summary;
}

async function collectSourceAudits(repoRoot, options) {
  const productionLicenseInventory = options.productionLicenseInventory
    ?? auditProductionDistributionLicenseInventory({ repoRoot });
  const thirdPartyNoticesDraft = options.thirdPartyNoticesDraft
    ?? auditProductionThirdPartyNoticesDraftAndEvidence({
      repoRoot,
      inventoryAudit: productionLicenseInventory
    });
  const releaseVersionLicensePolicy = options.releaseVersionLicensePolicy
    ?? auditReleaseVersionLicensePolicy({ repoRoot });
  const productionReleaseChecklist = options.productionReleaseChecklist
    ?? auditProductionReleaseChecklist({ repoRoot });
  const localLlmProvenanceEvidence = options.localLlmProvenanceEvidence
    ?? await auditProductionLocalLlmProvenanceAndLicenseEvidence({ repoRoot });
  const finalNoticesEvidencePackage = options.finalNoticesEvidencePackage
    ?? await auditFinalNoticesEvidencePackageDraft({
      repoRoot,
      sourceAudits: {
        productionReleaseChecklist,
        releaseVersionLicensePolicy,
        productionLicenseInventory,
        thirdPartyNoticesDraft,
        localLlmProvenanceEvidence
      }
    });

  return {
    finalNoticesEvidencePackage,
    thirdPartyNoticesDraft,
    productionLicenseInventory,
    releaseVersionLicensePolicy,
    productionReleaseChecklist,
    localLlmProvenanceEvidence
  };
}

function buildGate(sourceAudits) {
  const finalNotices = normalizeFinalNotices(sourceAudits);
  const ownerApproval = normalizeApproval(sourceAudits, "owner");
  const legalReview = normalizeApproval(sourceAudits, "legal");
  const licensePolicy = normalizeApproval(sourceAudits, "license");
  const modelLicenseEvidence = normalizeModelRuntimeEvidence(sourceAudits, "model");
  const runtimeLicenseEvidence = normalizeModelRuntimeEvidence(sourceAudits, "runtime");
  const releaseApproval = normalizeReleaseApproval(sourceAudits);
  const blockers = uniqueIssueCodes([
    ...statusBlocker(finalNotices.status, "final_third_party_notices_missing"),
    ...statusBlocker(ownerApproval.status, "owner_release_approval_missing"),
    ...statusBlocker(legalReview.status, "legal_review_not_approved"),
    ...statusBlocker(licensePolicy.status, "app_distribution_license_policy_pending"),
    ...statusBlocker(modelLicenseEvidence.status, "model_license_evidence_not_approved"),
    ...statusBlocker(runtimeLicenseEvidence.status, "runtime_license_evidence_not_approved"),
    ...statusBlocker(releaseApproval.status, "production_release_not_approved")
  ]);

  return {
    status: "blocked_draft",
    finalNotices,
    ownerApproval,
    legalReview,
    licensePolicy,
    modelLicenseEvidence,
    runtimeLicenseEvidence,
    releaseApproval,
    blockers
  };
}

function normalizeFinalNotices(sourceAudits) {
  const finalPackage = normalizeAudit(sourceAudits.finalNoticesEvidencePackage);
  const thirdParty = normalizeAudit(sourceAudits.thirdPartyNoticesDraft);
  const finalStatus = safeStatus(thirdParty.final_third_party_notices?.approvalStatus)
    ?? safeStatus(thirdParty.final_third_party_notices?.present)
    ?? safeStatus(finalPackage.packageDraft?.productionUse)
    ?? "pending";
  const draftStatus = safeStatus(finalPackage.packageDraft?.status)
    ?? safeStatus(thirdParty.draft_notices_shape?.status)
    ?? "unknown";

  return {
    status: finalStatus === "approved" ? "approved" : "pending",
    draftStatus,
    finalNoticesBasename: "THIRD_PARTY_NOTICES.md",
    writePolicy: "forbidden_until_owner_legal_approval"
  };
}

function normalizeApproval(sourceAudits, kind) {
  const releasePolicy = normalizeAudit(sourceAudits.releaseVersionLicensePolicy);
  const inventory = normalizeAudit(sourceAudits.productionLicenseInventory);
  const finalPackage = normalizeAudit(sourceAudits.finalNoticesEvidencePackage);
  const policy = releasePolicy.policy ?? {};
  const distributionPolicy = inventory.checks?.distribution_policy_evidence ?? {};

  if (kind === "owner") {
    const status = safeStatus(policy.ownerApproval)
      ?? safeStatus(distributionPolicy.ownerApproval)
      ?? safeStatus(finalPackage.packageDraft?.ownerApprovalStatus)
      ?? "missing";

    return approvalSummary(status);
  }

  if (kind === "legal") {
    const status = safeStatus(policy.legalReviewStatus)
      ?? safeStatus(distributionPolicy.legalReviewStatus)
      ?? safeStatus(finalPackage.packageDraft?.legalReviewStatus)
      ?? "pending";

    return approvalSummary(status === "missing" ? "pending" : status);
  }

  const status = safeStatus(policy.licenseDecisionStatus)
    ?? safeStatus(distributionPolicy.licenseDecisionStatus)
    ?? "pending";

  return approvalSummary(status);
}

function normalizeModelRuntimeEvidence(sourceAudits, kind) {
  const localLlm = normalizeAudit(sourceAudits.localLlmProvenanceEvidence);
  const provenance = kind === "model"
    ? localLlm.modelProvenance
    : localLlm.runtimeProvenance;
  const evidenceStatus = safeStatus(provenance?.status) ?? "pending";
  const releaseMetadataStatus = safeStatus(provenance?.releaseMetadataStatus) ?? "missing";
  const artifactEvidence = releaseMetadataStatus === "matches_pinned_candidate" || evidenceStatus === "matched_pinned_candidate"
    ? "shape_ready"
    : "pending";

  return {
    status: "pending_approval",
    artifactEvidence,
    releaseMetadataStatus
  };
}

function normalizeReleaseApproval(sourceAudits) {
  const releaseChecklist = normalizeAudit(sourceAudits.productionReleaseChecklist);
  const manifestStatus = safeStatus(releaseChecklist.releaseManifest?.status) ?? "missing";

  return {
    status: "missing",
    releaseManifestStatus: manifestStatus,
    approvalPolicy: "manual_owner_release_approval_required"
  };
}

function approvalSummary(status) {
  const normalized = safeStatus(status) ?? "missing";

  return {
    status: normalized === "approved" ? "approved" : normalized,
    approvalPolicy: normalized === "approved" ? "approved_evidence_required" : "manual_approval_required"
  };
}

function statusBlocker(status, blocker) {
  return status === "approved" ? [] : [blocker];
}

function summarizeSourceAudits(sourceAudits) {
  return Object.fromEntries(SOURCE_ORDER.map(([key, phase, label]) => {
    const audit = normalizeAudit(sourceAudits?.[key]);

    return [key, {
      phase: safeIdentifier(audit.phase) ?? phase,
      audit: safeIdentifier(audit.audit) ?? key,
      label,
      status: safeStatus(audit.status) ?? "unknown",
      ok: audit.ok === true,
      productionReadyClaim: audit.productionReadyClaim === true,
      blockerCount: countIssueCodes(audit.blockers),
      warningCount: countIssueCodes(audit.warnings),
      readyCheckCount: countIssueCodes(audit.readyChecks)
    }];
  }));
}

function collectIssueCodes(sourceAudits, field) {
  const codes = [];

  for (const [key] of SOURCE_ORDER) {
    const audit = normalizeAudit(sourceAudits?.[key]);
    codes.push(...readIssueList(audit[field]));
  }

  return codes;
}

function countIssueCodes(value) {
  return readIssueList(value).length;
}

function readIssueList(value) {
  return Array.isArray(value)
    ? value.map(safeIssueCode).filter(Boolean)
    : [];
}

function stripGateIssues(gate) {
  const { blockers: _blockers, ...rest } = gate;
  return rest;
}

function normalizeAudit(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function plannedWrittenArtifacts(repoRoot, outputRoot) {
  return [
    {
      basename: DRAFT_BASENAME,
      relativePath: safeRelativePath(repoRoot, join(outputRoot, DRAFT_BASENAME)),
      role: "final_notices_release_approval_gate_markdown_draft",
      status: "planned"
    },
    {
      basename: EVIDENCE_BASENAME,
      relativePath: safeRelativePath(repoRoot, join(outputRoot, EVIDENCE_BASENAME)),
      role: "safe_release_approval_gate_json_draft",
      status: "planned"
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
  const gateLines = [
    `- Final notices: ${summary.gate.finalNotices.status}`,
    `- Owner approval: ${summary.gate.ownerApproval.status}`,
    `- Legal review: ${summary.gate.legalReview.status}`,
    `- License policy: ${summary.gate.licensePolicy.status}`,
    `- Model license evidence: ${summary.gate.modelLicenseEvidence.status}`,
    `- Runtime license evidence: ${summary.gate.runtimeLicenseEvidence.status}`,
    `- Release approval: ${summary.gate.releaseApproval.status}`
  ];
  const blockerLines = summary.blockers.map((blocker) => `- ${blocker}`);
  const nextLines = summary.nextRequiredSteps.map((step) => `- ${step}`);

  return [
    "# P2-30J Final Notices And Release Approval Gate Draft",
    "",
    "This is a draft gate summary only. It is not a final THIRD_PARTY_NOTICES file and not a production release approval.",
    "",
    "## Gate Status",
    "",
    `- Status: ${summary.status}`,
    `- Production ready claim: ${summary.productionReadyClaim}`,
    "",
    "## Required Gate Items",
    "",
    ...gateLines,
    "",
    "## Source Audits",
    "",
    ...sourceLines,
    "",
    "## Blockers",
    "",
    ...blockerLines,
    "",
    "## Next Required Steps",
    "",
    ...nextLines,
    ""
  ].join("\n");
}

function resolveOutputRoot(repoRoot, outputRoot) {
  return outputRoot ? resolve(outputRoot) : join(repoRoot, DEFAULT_OUTPUT_ROOT);
}

function assertSafeOutputRoot(repoRoot, outputRoot) {
  const relativeToTmp = relative(join(repoRoot, ".tmp"), outputRoot).replace(/\\/g, "/");

  if (relativeToTmp === "p2-30j-final-notices-release-approval-gate-draft") {
    return;
  }

  throw new Error("unsafe_output_root");
}

function cleanupOutputRoot(repoRoot, outputRoot) {
  assertSafeOutputRoot(repoRoot, outputRoot);
  rmSync(outputRoot, { recursive: true, force: true });
}

function safeRelativePath(root, value) {
  const relativePath = relative(root, value).replace(/\\/g, "/");

  return relativePath.startsWith("../") || relativePath.includes("..")
    ? "redacted_unsafe_relative_path"
    : relativePath;
}

function findUnsafeInputContent(value) {
  const text = JSON.stringify(value);
  const blockers = [];

  if (/[A-Za-z]:\\/.test(text) || /(^|")\/(?:Users|home|tmp|var)\//i.test(text)) {
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

function safeIssueCode(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && /^[a-z0-9_:-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function safeIdentifier(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function safeStatus(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && /^[a-z0-9_-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function isUnsafeText(value) {
  return typeof value === "string" && (
    SECRETISH_PATTERN.test(value)
    || MODEL_INPUT_PATTERN.test(value)
    || REQUEST_PATTERN.test(value)
    || CONVERSATION_PATTERN.test(value)
    || FACT_PATTERN.test(value)
    || /[A-Za-z]:\\/.test(value)
    || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(value)
  );
}

function uniqueIssueCodes(values) {
  return [...new Set(values.map(safeIssueCode).filter(Boolean))].sort();
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

function sanitizeForOutput(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForOutput);
  }

  if (!value || typeof value !== "object") {
    return typeof value === "string" && isUnsafeText(value) ? "redacted_unsafe_text" : value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeForOutput(entry)]));
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  auditFinalNoticesReleaseApprovalGateDraft(parseCliArgs(process.argv.slice(2)))
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
        reason: "final_notices_release_approval_gate_exception",
        errorName: safeIdentifier(error?.name) ?? "unknown"
      });
    });
}
