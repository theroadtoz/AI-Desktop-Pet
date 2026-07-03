import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20U";
const AUDIT_NAME = "production_distribution_license_inventory";
const LOCAL_LLM_RELATIVE_ROOT = "resources/local-llm";
const SECRETISH_PATTERN = /(?:authorization|api[_-]?key|token|cookie|secret|password|private key|pfx|p12|do_not_leak)/i;
const MODEL_INPUT_PATTERN = /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i;
const REQUEST_PATTERN = /(?:request_body|request body|raw request)/i;
const CONVERSATION_PATTERN = /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i;
const FACT_PATTERN = /(?:fact_card_text|fact-card|fact card body|user memory body)/i;
const KNOWN_LICENSE_IDS = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "WTFPL"
]);
const DIRECT_BUILD_TOOLS = ["electron-builder", "vite", "typescript"];

export function auditProductionDistributionLicenseInventory(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const packageJson = options.packageJson ?? readJsonFile(join(root, "package.json"));
  const packageLock = options.packageLock ?? readJsonFile(join(root, "package-lock.json"));
  const builderConfig = options.builderConfig ?? readBuilderConfig(root);
  const localLlmScaffold = options.localLlmScaffold ?? readLocalLlmScaffold(root);
  const policyEvidence = isPlainObject(options.policyEvidence) ? options.policyEvidence : {};
  const packageLockAudit = auditPackageLockLicenseCoverage(packageLock);
  const checks = [
    auditPackageMetadata(packageJson),
    packageLockAudit,
    auditElectronBuilderDistributionInputs(builderConfig, packageJson, localLlmScaffold),
    auditLocalLlmScaffold(localLlmScaffold),
    auditDistributionPolicyEvidence(packageJson, policyEvidence, localLlmScaffold)
  ];
  const inventory = buildInventory({
    packageJson,
    packageLock,
    packageLockAudit,
    builderConfig,
    localLlmScaffold,
    policyEvidence
  });
  const unsafeCodes = findUnsafeInputContent({
    packageJson,
    builderConfig,
    policyEvidence,
    localLlmScaffold
  }).concat(findUnsafePackageLockContent(packageLock));
  const blockers = uniqueIssueCodes([
    ...checks.flatMap((check) => check.blockers),
    ...unsafeCodes
  ]);
  const warnings = uniqueIssueCodes(checks.flatMap((check) => check.warnings));
  const readyChecks = uniqueIssueCodes(checks.flatMap((check) => check.readyChecks));
  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";

  inventory.counts.blockerCount = blockers.length;
  inventory.counts.warningCount = warnings.length;
  inventory.counts.readyCheckCount = readyChecks.length;

  return removeUndefined({
    ok: status === "ready",
    status,
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    inventory,
    readyChecks,
    blockers,
    warnings,
    checks: Object.fromEntries(checks.map((check) => [check.name, stripIssues(check)]))
  });
}

function auditPackageMetadata(packageJson) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];
  const version = readNonEmptyString(packageJson?.version);
  const license = readNonEmptyString(packageJson?.license);

  if (!packageJson) {
    blockers.push("package_json_missing_or_invalid");
  }

  if (!version) {
    blockers.push("package_version_missing");
  } else if (version === "0.0.0") {
    blockers.push("package_version_0_0_0");
  }

  if (!license || license === "UNLICENSED") {
    blockers.push("app_distribution_license_policy_pending");
  } else if (!readSafeLicenseExpression(license)) {
    blockers.push("package_license_invalid_or_unsafe");
  }

  return {
    name: "package_metadata",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    version: safePackageVersion(version),
    license: safeLicenseOrStatus(license),
    privatePackage: packageJson?.private === true ? "true" : "false",
    directDependencyCount: countObjectKeys(packageJson?.dependencies),
    directDevDependencyCount: countObjectKeys(packageJson?.devDependencies),
    blockers,
    warnings,
    readyChecks
  };
}

function auditPackageLockLicenseCoverage(packageLock) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];
  const entries = readPackageLockEntries(packageLock);
  const missing = [];
  const unknown = [];
  const unsafe = [];
  const licenseCounts = {};

  if (!packageLock) {
    blockers.push("package_lock_missing_or_invalid");
  }

  for (const entry of entries) {
    const license = readNonEmptyString(entry.license);

    if (!license) {
      missing.push(entry.packageName);
      continue;
    }

    const safeLicense = readSafeLicenseExpression(license);

    if (!safeLicense) {
      unsafe.push(entry.packageName);
      continue;
    }

    licenseCounts[safeLicense] = (licenseCounts[safeLicense] ?? 0) + 1;

    if (!isKnownLicenseExpression(safeLicense)) {
      unknown.push({
        packageName: entry.packageName,
        license: safeLicense
      });
    }
  }

  if (missing.length > 0) {
    blockers.push("package_lock_license_fields_missing");
  }

  if (unsafe.length > 0) {
    blockers.push("package_lock_license_fields_unsafe");
  }

  if (unknown.length > 0) {
    blockers.push("package_lock_unknown_license");
  }

  if (entries.length > 0 && missing.length === 0 && unknown.length === 0 && unsafe.length === 0) {
    readyChecks.push("package_lock_license_fields_present");
  }

  return {
    name: "package_lock_license_coverage",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    packageCount: entries.length,
    licensePresentCount: entries.length - missing.length - unsafe.length,
    missingLicenseCount: missing.length,
    unknownLicenseCount: unknown.length,
    unsafeLicenseCount: unsafe.length,
    licenseCounts: sortObject(licenseCounts),
    missingLicensePackages: missing.map(safePackageName).filter(Boolean).slice(0, 20),
    unknownLicenses: unknown.map((entry) => ({
      packageName: safePackageName(entry.packageName),
      license: safeLicenseOrStatus(entry.license)
    })).slice(0, 20),
    blockers,
    warnings,
    readyChecks
  };
}

function auditElectronBuilderDistributionInputs(builderConfig, packageJson, localLlmScaffold) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];
  const files = Array.isArray(builderConfig?.files) ? builderConfig.files.map(String) : [];
  const extraResources = Array.isArray(builderConfig?.extraResources) ? builderConfig.extraResources : [];
  const hasPanguDependency = Boolean(packageJson?.dependencies?.pangu);
  const buildToolsIdentified = DIRECT_BUILD_TOOLS.every((toolName) => Boolean(packageJson?.devDependencies?.[toolName]));
  const packagesPangu = files.some((entry) => normalizeSlashes(entry).includes("node_modules/pangu"));
  const includesLocalLlmExtraResource = extraResources.some((entry) => {
    if (typeof entry === "string") {
      return normalizeSlashes(entry).includes("local-llm");
    }

    return normalizeSlashes(String(entry?.from ?? "")).includes("local-llm")
      || normalizeSlashes(String(entry?.to ?? "")) === "local-llm";
  });
  const hasIconResource = Boolean(builderConfig?.win?.icon)
    || extraResources.some((entry) => normalizeSlashes(String(entry?.to ?? entry ?? "")).includes("icons/"));

  if (!builderConfig) {
    blockers.push("electron_builder_config_missing");
  }

  if (!hasPanguDependency || !packagesPangu) {
    blockers.push("runtime_dependency_pangu_not_identified");
  } else {
    readyChecks.push("runtime_dependency_pangu_identified");
  }

  if (files.length > 0 && includesLocalLlmExtraResource) {
    readyChecks.push("electron_builder_distribution_inputs_identified");
  } else {
    blockers.push("electron_builder_distribution_inputs_missing");
  }

  if (buildToolsIdentified) {
    readyChecks.push("build_time_tools_identified");
  } else {
    blockers.push("build_time_tools_missing");
  }

  if (localLlmScaffold.scaffoldPresent && includesLocalLlmExtraResource) {
    readyChecks.push("local_llm_scaffold_present");
  }

  return {
    name: "electron_builder_distribution_inputs",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    filesConfigured: files.length > 0 ? "true" : "false",
    panguPackaged: packagesPangu ? "true" : "false",
    buildTimeTools: buildToolsIdentified ? "identified" : "missing",
    localLlmExtraResources: includesLocalLlmExtraResource ? "configured" : "missing",
    iconResources: hasIconResource ? "configured" : "missing",
    blockers,
    warnings,
    readyChecks
  };
}

function auditLocalLlmScaffold(localLlmScaffold) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];

  if (localLlmScaffold.scaffoldPresent) {
    readyChecks.push("local_llm_scaffold_present");
  } else {
    blockers.push("local_llm_scaffold_missing");
  }

  if (!localLlmScaffold.thirdPartyNoticesPresent) {
    blockers.push("third_party_notices_file_missing");
  } else if (localLlmScaffold.thirdPartyNoticesPlaceholder) {
    blockers.push("third_party_notices_placeholder");
  }

  if (!localLlmScaffold.productionPackPresent) {
    blockers.push("local_llm_production_pack_missing");
  }

  return {
    name: "local_llm_scaffold",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    manifestExample: localLlmScaffold.manifestExamplePresent ? "present" : "missing",
    productionManifest: localLlmScaffold.manifestJsonPresent ? "present" : "missing",
    noticesTemplate: localLlmScaffold.noticesTemplatePresent ? "present" : "missing",
    thirdPartyNotices: localLlmScaffold.thirdPartyNoticesPresent
      ? localLlmScaffold.thirdPartyNoticesPlaceholder ? "placeholder" : "present"
      : "missing",
    runtimeBinary: localLlmScaffold.runtimePresent ? "present" : "missing",
    modelFile: localLlmScaffold.modelPresent ? "present" : "missing",
    productionPack: localLlmScaffold.productionPackPresent ? "present" : "missing",
    blockers,
    warnings,
    readyChecks
  };
}

function auditDistributionPolicyEvidence(packageJson, evidence, localLlmScaffold) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];
  const ownerApproval = normalizeApprovalStatus(
    evidence.ownerApproval === true || evidence.ownerReleaseApproval === true,
    evidence.ownerApprovalStatus ?? evidence.ownerReleaseApprovalStatus ?? evidence.owner?.status
  );
  const legalReviewStatus = normalizeApprovalStatus(
    evidence.legalReviewApproved === true,
    evidence.legalReviewStatus ?? evidence.legalReview?.status
  );
  const licenseDecisionStatus = normalizeApprovalStatus(
    evidence.licenseDecisionApproved === true
      || evidence.licensePolicy?.approved === true
      || evidence.appDistributionLicense?.approved === true,
    evidence.licenseDecisionStatus
      ?? evidence.licensePolicy?.status
      ?? evidence.appDistributionLicense?.status
  );
  const notices = summarizeNoticesEvidence(evidence.thirdPartyNotices ?? evidence.notices);
  const electronChromiumNotices = normalizeApprovalStatus(
    evidence.electronChromiumNoticesApproved === true
      || evidence.electronChromiumNotices?.approved === true,
    evidence.electronChromiumNoticesStatus ?? evidence.electronChromiumNotices?.status
  );
  const modelLicenses = summarizeLicenseEvidenceSet(evidence.modelLicenses ?? evidence.modelLicenseEvidence);
  const runtimeLicenses = summarizeLicenseEvidenceSet(evidence.runtimeLicenses ?? evidence.runtimeLicenseEvidence);
  const inventoryApproval = normalizeApprovalStatus(
    evidence.productionDistributionInventoryApproved === true
      || evidence.productionDistributionInventory?.approved === true,
    evidence.productionDistributionInventoryStatus ?? evidence.productionDistributionInventory?.status
  );
  const localLlmPackStatus = localLlmScaffold.productionPackPresent ? "present" : "missing";

  if (ownerApproval !== "approved") {
    blockers.push("owner_release_approval_missing");
  }

  if (legalReviewStatus !== "approved") {
    blockers.push("legal_review_not_approved");
  }

  if (licenseDecisionStatus !== "approved" || packageJson?.license === "UNLICENSED") {
    blockers.push("app_distribution_license_policy_pending");
  }

  if (notices.status !== "approved") {
    blockers.push("third_party_notices_not_approved");
  }

  if (electronChromiumNotices !== "approved") {
    blockers.push("electron_chromium_notices_not_approved");
  }

  if (modelLicenses.status !== "approved") {
    blockers.push("model_license_evidence_missing");
  }

  if (runtimeLicenses.status !== "approved") {
    blockers.push("runtime_license_evidence_missing");
  }

  if (localLlmPackStatus !== "present") {
    blockers.push("local_llm_production_pack_missing");
  }

  if (inventoryApproval !== "approved") {
    blockers.push("production_distribution_inventory_not_approved");
  }

  return {
    name: "distribution_policy_evidence",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    ownerApproval,
    legalReviewStatus,
    licenseDecisionStatus,
    thirdPartyNotices: notices.summary,
    electronChromiumNotices,
    modelLicenses: modelLicenses.summary,
    runtimeLicenses: runtimeLicenses.summary,
    localLlmProductionPack: localLlmPackStatus,
    productionDistributionInventory: inventoryApproval,
    blockers,
    warnings,
    readyChecks
  };
}

function buildInventory({ packageJson, packageLock, packageLockAudit, builderConfig, localLlmScaffold, policyEvidence }) {
  const runtimeShippedEntries = buildRuntimeShippedEntries(packageJson, packageLock, builderConfig, localLlmScaffold);
  const buildTimeEntries = buildBuildTimeEntries(packageJson, packageLock);
  const localLlmEntries = buildLocalLlmEntries(localLlmScaffold, policyEvidence);

  return {
    packageMetadata: {
      name: safePackageName(packageJson?.name),
      version: safePackageVersion(packageJson?.version),
      privatePackage: packageJson?.private === true ? "true" : "false",
      license: safeLicenseOrStatus(packageJson?.license),
      directDependencies: safeDependencyEntries(packageJson?.dependencies),
      directDevDependencies: safeDependencyEntries(packageJson?.devDependencies),
      packageLockLicenseCoverage: {
        status: packageLockAudit.status,
        packageCount: packageLockAudit.packageCount,
        licensePresentCount: packageLockAudit.licensePresentCount,
        missingLicenseCount: packageLockAudit.missingLicenseCount,
        unknownLicenseCount: packageLockAudit.unknownLicenseCount,
        unsafeLicenseCount: packageLockAudit.unsafeLicenseCount,
        licenseCounts: packageLockAudit.licenseCounts
      }
    },
    runtimeShippedEntries,
    buildTimeEntries,
    localLlmEntries,
    counts: {
      directDependencyCount: countObjectKeys(packageJson?.dependencies),
      directDevDependencyCount: countObjectKeys(packageJson?.devDependencies),
      packageLockNonRootPackageCount: packageLockAudit.packageCount,
      packageLockLicensePresentCount: packageLockAudit.licensePresentCount,
      packageLockMissingLicenseCount: packageLockAudit.missingLicenseCount,
      packageLockUnknownLicenseCount: packageLockAudit.unknownLicenseCount,
      runtimeShippedEntryCount: runtimeShippedEntries.length,
      buildTimeEntryCount: buildTimeEntries.length,
      localLlmEntryCount: localLlmEntries.length
    }
  };
}

function buildRuntimeShippedEntries(packageJson, packageLock, builderConfig, localLlmScaffold) {
  const files = Array.isArray(builderConfig?.files) ? builderConfig.files.map(String) : [];
  const extraResources = Array.isArray(builderConfig?.extraResources) ? builderConfig.extraResources : [];
  const electronLock = findPackageLockEntry(packageLock, "electron");
  const panguLock = findPackageLockEntry(packageLock, "pangu");
  const hasPanguDependency = Boolean(packageJson?.dependencies?.pangu);
  const packagesPangu = files.some((entry) => normalizeSlashes(entry).includes("node_modules/pangu"));
  const includesLocalLlmExtraResource = extraResources.some((entry) => {
    if (typeof entry === "string") {
      return normalizeSlashes(entry).includes("local-llm");
    }

    return normalizeSlashes(String(entry?.from ?? "")).includes("local-llm")
      || normalizeSlashes(String(entry?.to ?? "")) === "local-llm";
  });
  const hasIconResource = Boolean(builderConfig?.win?.icon)
    || extraResources.some((entry) => normalizeSlashes(String(entry?.to ?? entry ?? "")).includes("icons/"));

  return [
    {
      id: "electron-runtime",
      name: "Electron runtime",
      kind: "runtime",
      source: "electron-builder packaged runtime",
      packageName: "electron",
      version: safePackageVersion(packageJson?.devDependencies?.electron ?? electronLock?.version),
      license: safeLicenseOrStatus(electronLock?.license ?? "MIT"),
      distributionRole: "runtime_shipped",
      notices: "electron_chromium_notices_pending",
      status: packageJson?.devDependencies?.electron ? "identified" : "missing"
    },
    {
      id: "pangu-runtime-dependency",
      name: "pangu",
      kind: "npm_dependency",
      source: "package dependency packaged by electron-builder files",
      packageName: "pangu",
      version: safePackageVersion(packageJson?.dependencies?.pangu ?? panguLock?.version),
      license: safeLicenseOrStatus(panguLock?.license),
      distributionRole: "runtime_shipped",
      status: hasPanguDependency && packagesPangu ? "identified" : "missing"
    },
    {
      id: "local-llm-extra-resources",
      name: "local-LLM scaffold extraResources",
      kind: "extra_resource",
      source: LOCAL_LLM_RELATIVE_ROOT,
      distributionRole: "runtime_resource_scaffold",
      scaffold: localLlmScaffold.scaffoldPresent ? "present" : "missing",
      productionPack: localLlmScaffold.productionPackPresent ? "present" : "missing",
      status: includesLocalLlmExtraResource ? "identified" : "missing"
    },
    {
      id: "app-icon-resources",
      name: "app icon resources",
      kind: "app_owned_resource",
      distributionRole: "packaged_resource",
      status: hasIconResource ? "identified" : "missing"
    }
  ];
}

function buildBuildTimeEntries(packageJson, packageLock) {
  return DIRECT_BUILD_TOOLS.map((toolName) => {
    const lockEntry = findPackageLockEntry(packageLock, toolName);
    const requestedVersion = packageJson?.devDependencies?.[toolName];

    return {
      id: `${toolName}-build-time`,
      name: toolName,
      kind: "build_time_tool",
      packageName: toolName,
      version: safePackageVersion(requestedVersion ?? lockEntry?.version),
      license: safeLicenseOrStatus(lockEntry?.license),
      distributionRole: "build_time_only",
      status: requestedVersion || lockEntry ? "identified" : "missing"
    };
  });
}

function buildLocalLlmEntries(localLlmScaffold, evidence) {
  const modelLicenses = summarizeLicenseEvidenceSet(evidence.modelLicenses ?? evidence.modelLicenseEvidence);
  const runtimeLicenses = summarizeLicenseEvidenceSet(evidence.runtimeLicenses ?? evidence.runtimeLicenseEvidence);

  return [
    {
      id: "llama-cpp-runtime-candidate",
      name: "llama.cpp runtime candidate",
      kind: "runtime_candidate",
      repo: "ggml-org/llama.cpp",
      license: "MIT",
      evidenceStatus: runtimeLicenses.status,
      status: runtimeLicenses.status === "approved" && localLlmScaffold.runtimePresent ? "ready" : "missing_evidence_or_binary"
    },
    {
      id: "qwen25-15b-gguf-candidate",
      name: "Qwen2.5 1.5B GGUF candidate",
      kind: "model_candidate",
      repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
      upstreamRepo: "Qwen/Qwen2.5-1.5B-Instruct",
      license: "Apache-2.0",
      evidenceStatus: modelLicenses.status,
      status: modelLicenses.status === "approved" && localLlmScaffold.modelPresent ? "ready" : "missing_evidence_or_model"
    },
    {
      id: "qwen25-15b-upstream-base-model",
      name: "Qwen2.5 1.5B upstream base model",
      kind: "upstream_model",
      repo: "Qwen/Qwen2.5-1.5B-Instruct",
      license: "Apache-2.0",
      evidenceStatus: modelLicenses.status,
      status: modelLicenses.status === "approved" ? "identified" : "missing_evidence"
    },
    {
      id: "local-llm-manifest-scaffold",
      name: "local LLM manifest scaffold",
      kind: "scaffold",
      basename: localLlmScaffold.manifestJsonPresent ? "manifest.json" : "manifest.example.json",
      example: localLlmScaffold.manifestExamplePresent ? "present" : "missing",
      productionManifest: localLlmScaffold.manifestJsonPresent ? "present" : "missing",
      status: localLlmScaffold.manifestJsonPresent ? "production_manifest_present" : "example_only"
    },
    {
      id: "local-llm-notices-scaffold",
      name: "local LLM notices scaffold",
      kind: "scaffold",
      basename: localLlmScaffold.thirdPartyNoticesPresent
        ? "THIRD_PARTY_NOTICES.md"
        : "THIRD_PARTY_NOTICES.template.md",
      template: localLlmScaffold.noticesTemplatePresent ? "present" : "missing",
      productionNotices: localLlmScaffold.thirdPartyNoticesPresent
        ? localLlmScaffold.thirdPartyNoticesPlaceholder ? "placeholder" : "present"
        : "missing",
      status: localLlmScaffold.thirdPartyNoticesPresent && !localLlmScaffold.thirdPartyNoticesPlaceholder
        ? "production_notices_present"
        : "scaffold_only"
    }
  ];
}

function readPackageLockEntries(packageLock) {
  if (!isPlainObject(packageLock?.packages)) {
    return [];
  }

  return Object.entries(packageLock.packages)
    .filter(([packagePath]) => packagePath !== "")
    .map(([packagePath, value]) => ({
      packagePath,
      packageName: packageNameFromLockPath(packagePath),
      version: value?.version,
      license: value?.license
    }));
}

function findPackageLockEntry(packageLock, packageName) {
  return readPackageLockEntries(packageLock).find((entry) => entry.packageName === packageName);
}

function packageNameFromLockPath(packagePath) {
  const normalized = normalizeSlashes(packagePath);
  const marker = "node_modules/";
  const lastIndex = normalized.lastIndexOf(marker);

  if (lastIndex < 0) {
    return basename(normalized);
  }

  return normalized.slice(lastIndex + marker.length);
}

function readLocalLlmScaffold(root) {
  const localRoot = join(root, LOCAL_LLM_RELATIVE_ROOT);
  const manifestExamplePath = join(localRoot, "manifest.example.json");
  const manifestJsonPath = join(localRoot, "manifest.json");
  const noticesTemplatePath = join(localRoot, "licenses", "THIRD_PARTY_NOTICES.template.md");
  const noticesPath = join(localRoot, "licenses", "THIRD_PARTY_NOTICES.md");
  const runtimePath = join(localRoot, "runtime", "win32-x64", "llama-server.exe");
  const modelPath = join(localRoot, "models", "model.gguf");
  const manifestExamplePresent = isExistingFile(manifestExamplePath);
  const manifestJsonPresent = isExistingFile(manifestJsonPath);
  const noticesTemplatePresent = isExistingFile(noticesTemplatePath);
  const thirdPartyNoticesPresent = isExistingFile(noticesPath);
  const runtimePresent = isExistingFile(runtimePath);
  const modelPresent = isExistingFile(modelPath);

  return {
    scaffoldPresent: manifestExamplePresent || noticesTemplatePresent,
    manifestExamplePresent,
    manifestJsonPresent,
    noticesTemplatePresent,
    noticesTemplatePlaceholder: noticesTemplatePresent ? isLikelyPlaceholderText(readSmallText(noticesTemplatePath)) : false,
    thirdPartyNoticesPresent,
    thirdPartyNoticesPlaceholder: thirdPartyNoticesPresent ? isLikelyPlaceholderText(readSmallText(noticesPath)) : false,
    runtimePresent,
    modelPresent,
    productionPackPresent: manifestJsonPresent
      && thirdPartyNoticesPresent
      && !isLikelyPlaceholderText(readSmallText(noticesPath))
      && runtimePresent
      && modelPresent
  };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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

function summarizeNoticesEvidence(notices) {
  if (!isPlainObject(notices)) {
    return {
      status: "missing",
      summary: {
        status: "missing"
      }
    };
  }

  const approved = notices.approved === true || readSafeStatus(notices.status) === "approved";
  const included = notices.included === true;
  const file = readNonEmptyString(notices.file);
  const fileStatus = file ? isBasenameOnly(file) ? "basename" : "not_basename" : "missing";
  const status = approved && included && fileStatus === "basename" ? "approved" : "pending";

  return {
    status,
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

    if (/[A-Za-z]:\\/.test(entry) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(entry)) {
      codes.add("privacy_local_path_leak");
    }

    if (SECRETISH_PATTERN.test(entry) || SECRETISH_PATTERN.test(currentKey)) {
      codes.add("privacy_secret_leak");
    }

    if (MODEL_INPUT_PATTERN.test(entry) || MODEL_INPUT_PATTERN.test(currentKey)) {
      codes.add("privacy_model_input_leak");
    }

    if (REQUEST_PATTERN.test(entry) || REQUEST_PATTERN.test(currentKey)) {
      codes.add("privacy_request_payload_leak");
    }

    if (CONVERSATION_PATTERN.test(entry) || CONVERSATION_PATTERN.test(currentKey)) {
      codes.add("privacy_conversation_body_leak");
    }

    if (FACT_PATTERN.test(entry) || FACT_PATTERN.test(currentKey)) {
      codes.add("privacy_fact_body_leak");
    }
  });

  return Array.from(codes);
}

function findUnsafePackageLockContent(packageLock) {
  const codes = new Set();

  for (const entry of readPackageLockEntries(packageLock)) {
    if (/[A-Za-z]:\\/.test(entry.packagePath) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(entry.packagePath)) {
      codes.add("privacy_local_path_leak");
    }

    if (/do_not_leak/i.test(entry.packagePath)) {
      codes.add("privacy_secret_leak");
    }

    for (const value of [entry.license, entry.version]) {
      if (typeof value !== "string") {
        continue;
      }

      if (/[A-Za-z]:\\/.test(value) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(value)) {
        codes.add("privacy_local_path_leak");
      }

      if (SECRETISH_PATTERN.test(value)) {
        codes.add("privacy_secret_leak");
      }

      if (MODEL_INPUT_PATTERN.test(value)) {
        codes.add("privacy_model_input_leak");
      }

      if (REQUEST_PATTERN.test(value)) {
        codes.add("privacy_request_payload_leak");
      }

      if (CONVERSATION_PATTERN.test(value)) {
        codes.add("privacy_conversation_body_leak");
      }

      if (FACT_PATTERN.test(value)) {
        codes.add("privacy_fact_body_leak");
      }
    }
  }

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

function isKnownLicenseExpression(value) {
  const tokens = String(value).match(/[A-Za-z0-9.-]+/g) ?? [];
  const licenseIds = tokens.filter((token) => !["AND", "OR", "WITH"].includes(token.toUpperCase()));
  return licenseIds.length > 0 && licenseIds.every((token) => KNOWN_LICENSE_IDS.has(token));
}

function isLikelyPlaceholderText(text) {
  const trimmed = readNonEmptyString(text);
  return !trimmed || /Fill this file before packaging/i.test(trimmed) || /TODO|TBD|replace-with|template/i.test(trimmed);
}

function readSmallText(path) {
  try {
    return readFileSync(path, "utf8").replace(/^\uFEFF/, "").slice(0, 32_000);
  } catch {
    return "";
  }
}

function safeDependencyEntries(value) {
  if (!isPlainObject(value)) {
    return [];
  }

  return Object.entries(value)
    .map(([name, version]) => ({
      name: safePackageName(name),
      version: safePackageVersion(version)
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readSafeLicenseExpression(value) {
  const text = readNonEmptyString(value);

  if (!text || isUnsafeText(text) || /[A-Za-z]:\\/.test(text) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(text)) {
    return null;
  }

  return /^[a-z0-9 .()+-]+$/i.test(text) ? text : null;
}

function safeLicenseOrStatus(value) {
  const text = readSafeLicenseExpression(value);
  return text ?? (readNonEmptyString(value) ? "invalid_or_redacted" : "missing");
}

function safePackageName(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_@./+-]+$/i.test(text) && !isUnsafeText(text) ? text : undefined;
}

function safePackageVersion(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_.~^*<>=| -]+$/i.test(text) && !isUnsafeText(text) ? text : text ? "invalid_or_redacted" : "missing";
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

function readSafeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) && !isUnsafeText(text) ? text : null;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function countObjectKeys(value) {
  return isPlainObject(value) ? Object.keys(value).length : 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExistingFile(path) {
  try {
    return path.length > 0 && statSync(path).isFile();
  } catch {
    return false;
  }
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

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort((left, right) => left[0].localeCompare(right[0])));
}

function stripIssues(check) {
  const { blockers, warnings, readyChecks, ...safeCheck } = check;
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
    printJson(auditProductionDistributionLicenseInventory());
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
