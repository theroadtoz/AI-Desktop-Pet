import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20T";
const AUDIT_NAME = "release_version_license_policy";
const PRODUCTION_TAG_PATTERN = "v{version}";
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|secret|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|user memory body)/i;

export function auditReleaseVersionLicensePolicy(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const packageJson = options.packageJson ?? readJsonFile(join(root, "package.json"));
  const builderConfig = options.builderConfig ?? readBuilderConfig(root);
  const releaseTag = Object.hasOwn(options, "releaseTag") ? options.releaseTag : null;
  const policyEvidence = isPlainObject(options.policyEvidence) ? options.policyEvidence : null;
  const checks = [
    auditPackageMetadata(packageJson),
    auditElectronBuilderArtifactNames(builderConfig),
    auditReleaseTagPolicy(packageJson, releaseTag),
    auditPolicyEvidence(packageJson, policyEvidence)
  ];
  const unsafeCodes = findUnsafeInputContent({
    packageJson,
    builderConfig,
    policyEvidence,
    releaseTag
  });
  const blockers = uniqueIssueCodes([
    ...checks.flatMap((check) => check.blockers),
    ...unsafeCodes
  ]);
  const warnings = uniqueIssueCodes(checks.flatMap((check) => check.warnings));
  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";
  const policyEvidenceCheck = checks.find((check) => check.name === "policy_evidence");

  return removeUndefined({
    ok: status === "ready",
    status,
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    policy: {
      status: status === "ready" ? "ready" : "planned",
      scope: "policy_audit_only",
      versioning: "semver",
      productionTagPattern: PRODUCTION_TAG_PATTERN,
      licenseDecisionStatus: policyEvidenceCheck?.licenseDecisionStatus === "approved"
        ? "approved"
        : "pending_owner_decision"
    },
    blockers,
    warnings,
    checks: Object.fromEntries(checks.map((check) => [check.name, stripIssues(check)]))
  });
}

function auditPackageMetadata(packageJson) {
  const blockers = [];
  const warnings = [];
  const version = readNonEmptyString(packageJson?.version);
  const parsedVersion = parseSemVer(version);
  const license = readNonEmptyString(packageJson?.license);

  if (!packageJson) {
    blockers.push("package_json_missing_or_invalid");
  }

  if (!version) {
    blockers.push("package_version_missing");
    blockers.push("production_version_not_declared");
  } else if (!parsedVersion) {
    blockers.push("package_version_not_semver");
    blockers.push("production_version_not_declared");
  } else if (version === "0.0.0") {
    blockers.push("package_version_0_0_0");
    blockers.push("production_version_not_declared");
  } else if (parsedVersion.major === 0) {
    blockers.push("production_version_not_declared");
  }

  if (!license) {
    blockers.push("package_license_missing");
    blockers.push("app_distribution_license_policy_pending");
  } else if (license === "UNLICENSED") {
    blockers.push("app_distribution_license_policy_pending");
  } else if (!readSafePublicText(license)) {
    blockers.push("package_license_invalid_or_unsafe");
  }

  return {
    name: "package_metadata",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    version: safeVersion(version),
    semver: parsedVersion ? "valid" : version ? "invalid" : "missing",
    productionVersion: parsedVersion && parsedVersion.major > 0 ? "declared" : "not_declared",
    privatePackage: packageJson?.private === true ? "true" : "false",
    license: safePublicTextOrStatus(license),
    blockers,
    warnings
  };
}

function auditElectronBuilderArtifactNames(builderConfig) {
  const entries = [
    ["artifactName", builderConfig?.artifactName],
    ["nsis", readArtifactName(builderConfig, "nsis")],
    ["portable", readArtifactName(builderConfig, "portable")]
  ];
  const blockers = [];
  const warnings = [];
  const artifactNames = {};

  if (!builderConfig) {
    blockers.push("electron_builder_config_missing");
  }

  for (const [label, value] of entries) {
    const summary = summarizeArtifactName(value);
    artifactNames[label] = summary;

    if (!readNonEmptyString(value)) {
      blockers.push(`${label}_artifact_name_missing`);
      continue;
    }

    if (!isBasenameOnly(value)) {
      blockers.push(`${label}_artifact_name_not_basename`);
    }

    if (!String(value).includes("${version}")) {
      blockers.push(`${label}_artifact_name_version_token_missing`);
    }
  }

  return {
    name: "electron_builder_artifact_version_patterns",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    artifactNames,
    blockers,
    warnings
  };
}

function auditReleaseTagPolicy(packageJson, releaseTag) {
  const blockers = [];
  const warnings = [];
  const version = readNonEmptyString(packageJson?.version);
  const parsedVersion = parseSemVer(version);
  const tag = readReleaseTagValue(releaseTag);
  const expectedTag = parsedVersion && parsedVersion.major > 0 ? `v${version}` : null;
  const safeTag = readSafeIdentifier(tag);

  if (!tag) {
    blockers.push("release_tag_not_created");
  } else if (!safeTag) {
    blockers.push("release_tag_invalid_or_unsafe");
  } else if (expectedTag && safeTag !== expectedTag) {
    blockers.push("release_tag_version_mismatch");
  }

  return {
    name: "release_tag_policy",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    expectedTag: expectedTag ? safeTagValue(expectedTag) : "pending_production_version",
    releaseTag: tag ? safeTagValue(tag) : "missing",
    tagPolicy: PRODUCTION_TAG_PATTERN,
    blockers,
    warnings
  };
}

function auditPolicyEvidence(packageJson, evidence) {
  const blockers = [];
  const warnings = [];
  const ownerApproval = normalizeApprovalStatus(
    evidence?.ownerApproval === true,
    evidence?.ownerApprovalStatus ?? evidence?.owner?.status
  );
  const legalReviewStatus = normalizeApprovalStatus(
    evidence?.legalReviewApproved === true,
    evidence?.legalReviewStatus ?? evidence?.legalReview?.status
  );
  const licenseDecisionStatus = normalizeApprovalStatus(
    evidence?.licenseDecisionApproved === true
      || evidence?.licensePolicy?.approved === true
      || evidence?.appDistributionLicense?.approved === true,
    evidence?.licenseDecisionStatus
      ?? evidence?.licensePolicy?.status
      ?? evidence?.appDistributionLicense?.status
  );
  const notices = summarizeNoticesEvidence(evidence?.thirdPartyNotices ?? evidence?.notices);
  const modelLicenses = summarizeLicenseEvidenceSet(evidence?.modelLicenses ?? evidence?.modelLicenseEvidence);
  const runtimeLicenses = summarizeLicenseEvidenceSet(evidence?.runtimeLicenses ?? evidence?.runtimeLicenseEvidence);

  if (ownerApproval !== "approved") {
    blockers.push("owner_release_approval_missing");
  }

  if (legalReviewStatus !== "approved") {
    blockers.push("legal_review_not_approved");
  }

  if (licenseDecisionStatus !== "approved") {
    blockers.push("license_policy_evidence_missing");
  }

  if (packageJson?.license === "UNLICENSED" && licenseDecisionStatus !== "approved") {
    blockers.push("app_distribution_license_policy_pending");
  }

  if (notices.status !== "approved") {
    blockers.push("third_party_notices_not_approved");
  }

  if (notices.fileStatus === "not_basename") {
    blockers.push("third_party_notices_file_not_basename");
  }

  if (modelLicenses.status !== "approved") {
    blockers.push("model_license_evidence_missing");
  }

  if (runtimeLicenses.status !== "approved") {
    blockers.push("runtime_license_evidence_missing");
  }

  return {
    name: "policy_evidence",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    ownerApproval,
    legalReviewStatus,
    licenseDecisionStatus,
    thirdPartyNotices: notices.summary,
    modelLicenses: modelLicenses.summary,
    runtimeLicenses: runtimeLicenses.summary,
    blockers,
    warnings
  };
}

function summarizeArtifactName(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return {
      status: "missing",
      versionToken: "missing"
    };
  }

  const includesVersion = text.includes("${version}");

  return removeUndefined({
    status: includesVersion ? "contains_version" : "missing_version_token",
    basename: safeBasename(text),
    pathShape: isBasenameOnly(text) ? "basename" : "path_or_unsafe",
    versionToken: includesVersion ? "present" : "missing"
  });
}

function summarizeNoticesEvidence(notices) {
  if (!isPlainObject(notices)) {
    return {
      status: "missing",
      fileStatus: "missing",
      summary: {
        status: "missing"
      }
    };
  }

  const file = readNonEmptyString(notices.file);
  const fileStatus = file ? isBasenameOnly(file) ? "basename" : "not_basename" : "missing";
  const approved = notices.approved === true || readSafeStatus(notices.status) === "approved";
  const included = notices.included === true;
  const status = approved && included && fileStatus === "basename" ? "approved" : "pending";

  return {
    status,
    fileStatus,
    summary: removeUndefined({
      status,
      included: included ? "true" : "false",
      file: file ? safeBasename(file) : undefined,
      fileStatus
    })
  };
}

function summarizeLicenseEvidenceSet(value) {
  if (!isPlainObject(value)) {
    return {
      status: "missing",
      summary: {
        status: "missing",
        entryCount: 0
      }
    };
  }

  const entries = Array.isArray(value.entries) ? value.entries : [];
  const approved = value.approved === true || readSafeStatus(value.status) === "approved";
  const status = approved && entries.length > 0 ? "approved" : "pending";

  return {
    status,
    summary: {
      status,
      entryCount: entries.length
    }
  };
}

function normalizeApprovalStatus(approvedFlag, statusValue) {
  if (approvedFlag) {
    return "approved";
  }

  const status = readSafeStatus(statusValue);
  return status === "approved" ? "approved" : status ?? "missing";
}

function readArtifactName(builderConfig, targetName) {
  const target = readWinTargets(builderConfig).find((candidate) => candidate.target === targetName);
  return target?.artifactName ?? builderConfig?.[targetName]?.artifactName ?? null;
}

function readWinTargets(builderConfig) {
  const rawTargets = builderConfig?.win?.target;
  const targets = Array.isArray(rawTargets) ? rawTargets : rawTargets ? [rawTargets] : [];
  return targets.map((target) => {
    if (typeof target === "string") {
      return { target };
    }

    return {
      target: target?.target,
      artifactName: target?.artifactName
    };
  }).filter((target) => target.target);
}

function readReleaseTagValue(value) {
  if (typeof value === "string") {
    return readNonEmptyString(value);
  }

  if (isPlainObject(value)) {
    return readNonEmptyString(value.tag) ?? readNonEmptyString(value.name);
  }

  return null;
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

    const joinedPath = path.join(".");

    if (/[A-Za-z]:\\/.test(entry) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(entry)) {
      codes.add("privacy_local_path_leak");
    }

    if (SECRETISH_PATTERN.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_secret_leak");
    }

    if (MODEL_INPUT_PATTERN.test(entry)) {
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

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readBuilderConfig(root) {
  try {
    return require(resolve(root, "electron-builder.config.cjs"));
  } catch {
    return null;
  }
}

function parseSemVer(value) {
  const text = readNonEmptyString(value);
  const match = text?.match(SEMVER_PATTERN);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readSafeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function readSafeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function readSafePublicText(value) {
  const text = readNonEmptyString(value);

  if (!text || isUnsafeText(text) || /[A-Za-z]:\\/.test(text) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(text)) {
    return null;
  }

  return /^[a-z0-9_ ./:@+${}()<>,.-]+$/i.test(text) ? text : null;
}

function safeVersion(value) {
  const text = readNonEmptyString(value);
  return text && SEMVER_PATTERN.test(text) && !isUnsafeText(text) ? text : text ? "invalid_or_redacted" : "missing";
}

function safeTagValue(value) {
  const text = readNonEmptyString(value);
  return text && readSafeIdentifier(text) ? text : "invalid_or_redacted";
}

function safePublicTextOrStatus(value) {
  const text = readSafePublicText(value);
  return text ?? (readNonEmptyString(value) ? "invalid_or_redacted" : "missing");
}

function safeBasename(value) {
  const name = basename(String(value).replace(/\\/g, "/"));

  if (!name) {
    return undefined;
  }

  if (isUnsafeText(name)) {
    return "redacted_sensitive_basename";
  }

  return /^[a-z0-9_ .${}()@+\-[\].]+$/i.test(name) ? name : "redacted_unsafe_basename";
}

function isBasenameOnly(value) {
  const text = readNonEmptyString(value);
  return Boolean(text) && basename(text.replace(/\\/g, "/")) === text && !/[\\/]/.test(text) && !/[A-Za-z]:/.test(text);
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

function stripIssues(check) {
  const { blockers, warnings, ...safeCheck } = check;
  return safeCheck;
}

function uniqueIssueCodes(codes) {
  return Array.from(new Set(codes.filter(Boolean))).sort();
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
    printJson(auditReleaseVersionLicensePolicy());
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
