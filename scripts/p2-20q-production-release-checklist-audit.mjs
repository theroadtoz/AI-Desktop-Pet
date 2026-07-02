import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20Q";
const AUDIT_NAME = "production_release_checklist";
const RELEASE_MANIFEST_ENV_NAMES = [
  "AI_DESKTOP_PET_PRODUCTION_RELEASE_MANIFEST_PATH",
  "P2_20Q_RELEASE_MANIFEST_PATH"
];
const REQUIRED_MANIFEST_FIELDS = [
  "appName",
  "version",
  "commit",
  "buildTimeUtc",
  "artifactName",
  "artifactKind",
  "target",
  "arch",
  "sha256",
  "sizeBytes"
];
const REQUIRED_PRIVACY_REDACTION_FIELDS = [
  "localPaths",
  "apiKeys",
  "prompts",
  "conversationText",
  "userMemoryText"
];
const HEAVY_TRACKED_ARTIFACT_PATTERNS = [
  /(^|\/)release-manifest\.json$/i,
  /(^|\/)SHA256SUMS(?:\.txt)?$/i,
  /\.(?:gguf|blockmap)$/i,
  /\.(?:exe|dll)$/i,
  /\.(?:pfx|p12)$/i,
  /(^|\/)\.tmp\//i
];

export function auditProductionReleaseChecklist(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const env = options.env ?? process.env;
  const packageJson = options.packageJson ?? readPackageJson(root);
  const builderConfig = options.builderConfig ?? readBuilderConfig(root);
  const releaseManifestRead = readReleaseManifest(root, env, options);
  const manifest = releaseManifestRead.value;
  const manifestInfo = releaseManifestRead.summary;
  const trackedFiles = options.gitTrackedFiles ?? gitLsFiles(root);
  const checks = [
    auditPackageMetadata(packageJson, manifest),
    auditElectronBuilder(builderConfig, packageJson),
    auditReleaseManifestSchema(releaseManifestRead),
    auditArtifactIntegrity(manifest),
    auditSha256SumsAlignment(manifest),
    auditLegalReview(manifest),
    auditSigningAndTimestamp(manifest),
    auditSmartScreenBoundary(manifest),
    auditGitHubReleaseEvidence(manifest),
    auditAttestationEvidence(manifest),
    auditNoticesModelRuntime(manifest),
    auditPrivacyRedaction(manifest, releaseManifestRead.rawText),
    auditTrackedArtifacts(trackedFiles)
  ];
  const blockers = uniqueIssueCodes(checks.flatMap((check) => check.blockers));
  const warnings = uniqueIssueCodes(checks.flatMap((check) => check.warnings));
  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";

  return removeUndefined({
    ok: status === "ready",
    status,
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    releaseManifest: manifestInfo,
    blockers,
    warnings,
    checks: Object.fromEntries(checks.map((check) => [check.name, stripIssues(check)]))
  });
}

function auditPackageMetadata(packageJson, manifest) {
  const blockers = [];
  const warnings = [];
  const version = readNonEmptyString(packageJson?.version);
  const license = readNonEmptyString(packageJson?.license);
  const manifestVersion = readNonEmptyString(manifest?.version);

  if (!packageJson) {
    blockers.push("package_json_missing_or_invalid");
  } else if (!version) {
    blockers.push("package_version_missing");
  } else if (version === "0.0.0") {
    blockers.push("package_version_0_0_0");
  }

  if (!license || license === "UNLICENSED") {
    warnings.push("package_license_unlicensed");
  }

  if (version && manifestVersion && version !== manifestVersion) {
    blockers.push("package_manifest_version_mismatch");
  }

  if (blockers.includes("package_version_0_0_0")) {
    warnings.push("release_readiness_blocked");
  }

  return {
    name: "package_metadata",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    version: safeIdentifier(version),
    license: safeIdentifier(license),
    blockers,
    warnings
  };
}

function auditElectronBuilder(builderConfig, packageJson) {
  const blockers = [];
  const warnings = [];
  const targets = readWinTargets(builderConfig);
  const targetNames = targets.map((target) => target.target);
  const nsisArtifactName = readArtifactName(builderConfig, "nsis");
  const portableArtifactName = readArtifactName(builderConfig, "portable");
  const nsisScript = readNonEmptyString(packageJson?.scripts?.["package:win:nsis"]) ?? "";
  const publishPolicy = nsisScript.includes("--publish never") || builderConfig?.publish === "never"
    ? "disabled_for_manual_release"
    : builderConfig?.publish
      ? "configured"
      : "unspecified";

  if (!builderConfig) {
    blockers.push("electron_builder_config_missing");
  }

  if (!targetNames.includes("nsis")) {
    blockers.push("missing_win_target_nsis");
  }

  if (targetNames.includes("portable") && !portableArtifactName) {
    blockers.push("portable_artifact_name_missing");
  }

  if (!nsisArtifactName) {
    blockers.push("nsis_artifact_name_missing");
  } else if (!/setup/i.test(nsisArtifactName)) {
    blockers.push("nsis_artifact_name_missing_setup_marker");
  }

  if (portableArtifactName && !/portable/i.test(portableArtifactName)) {
    warnings.push("portable_artifact_name_missing_portable_marker");
  }

  return {
    name: "electron_builder",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    winTargets: targetNames,
    artifactNames: {
      nsis: nsisArtifactName ? "configured_setup" : "missing",
      portable: portableArtifactName ? "configured_portable" : targetNames.includes("portable") ? "missing" : "not_configured"
    },
    publishPolicy,
    blockers,
    warnings
  };
}

function auditReleaseManifestSchema(readResult) {
  const blockers = [...readResult.blockers];
  const warnings = [];
  const manifest = readResult.value;

  if (!manifest) {
    blockers.push("production_release_manifest_missing");
    warnings.push("production_local_llm_artifact_missing");
    return {
      name: "release_manifest_schema",
      status: "blocked",
      manifest: readResult.summary,
      blockers,
      warnings
    };
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (field === "sizeBytes") {
      if (readPositiveInteger(manifest[field]) === null) {
        blockers.push(`release_manifest_${field}_missing_or_invalid`);
      }
    } else if (field === "sha256") {
      if (!readSha256(manifest[field])) {
        blockers.push(`release_manifest_${field}_missing_or_invalid`);
      }
    } else if (!readNonEmptyString(manifest[field])) {
      blockers.push(`release_manifest_${field}_missing`);
    }
  }

  const artifactName = readNonEmptyString(manifest.artifactName);

  if (artifactName && !isBasenameOnly(artifactName)) {
    blockers.push("release_manifest_artifact_name_not_basename");
  }

  if (artifactName && !/\.exe$/i.test(artifactName)) {
    blockers.push("release_manifest_artifact_name_not_windows_exe");
  }

  if (manifest.target !== "nsis") {
    blockers.push("release_manifest_target_not_nsis");
  }

  if (manifest.artifactKind !== "nsis-installer") {
    blockers.push("release_manifest_artifact_kind_not_nsis_installer");
  }

  return {
    name: "release_manifest_schema",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    manifest: readResult.summary,
    artifact: safeArtifactFromManifest(manifest),
    blockers,
    warnings
  };
}

function auditArtifactIntegrity(manifest) {
  const blockers = [];
  const warnings = [];

  if (!manifest) {
    return {
      name: "artifact_integrity",
      status: "blocked",
      blockers: ["artifact_integrity_missing"],
      warnings
    };
  }

  if (!readSha256(manifest.sha256)) {
    blockers.push("artifact_sha256_missing_or_invalid");
  }

  if (readPositiveInteger(manifest.sizeBytes) === null) {
    blockers.push("artifact_size_missing_or_invalid");
  }

  return {
    name: "artifact_integrity",
    status: blockers.length > 0 ? "blocked" : "ready",
    artifact: safeArtifactFromManifest(manifest),
    blockers,
    warnings
  };
}

function auditSha256SumsAlignment(manifest) {
  const blockers = [];
  const warnings = [];

  if (!manifest) {
    return {
      name: "sha256sums_alignment",
      status: "blocked",
      blockers: ["sha256sums_missing"],
      warnings
    };
  }

  const evidence = readChecksumEvidence(manifest);

  if (!evidence.entries.length) {
    blockers.push("sha256sums_missing");
  }

  if (evidence.file && !isBasenameOnly(evidence.file)) {
    blockers.push("sha256sums_file_not_basename");
  }

  const artifactName = readNonEmptyString(manifest.artifactName);
  const artifactSha256 = readSha256(manifest.sha256);
  const artifactSize = readPositiveInteger(manifest.sizeBytes);
  const artifactEntry = evidence.entries.find((entry) => entry.name === artifactName);

  if (evidence.entries.length > 0 && !artifactEntry) {
    blockers.push("sha256sums_artifact_missing");
  }

  if (artifactEntry) {
    if (artifactEntry.sha256 !== artifactSha256) {
      blockers.push("sha256sums_sha256_mismatch");
    }

    if (artifactEntry.sizeBytes === null) {
      blockers.push("sha256sums_size_missing");
    } else if (artifactSize !== null && artifactEntry.sizeBytes !== artifactSize) {
      blockers.push("sha256sums_size_mismatch");
    }
  }

  return {
    name: "sha256sums_alignment",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    checksumFile: evidence.file ? basename(evidence.file) : undefined,
    checksumEntryCount: evidence.entries.length,
    blockers,
    warnings
  };
}

function auditLegalReview(manifest) {
  const blockers = [];
  const warnings = [];
  const status = readSafeStatus(manifest?.legalReviewStatus);

  if (status !== "approved") {
    blockers.push("production_legal_review_not_approved");
  }

  return {
    name: "legal_review",
    status: blockers.length > 0 ? "blocked" : "ready",
    legalReviewStatus: status ?? "missing",
    blockers,
    warnings
  };
}

function auditSigningAndTimestamp(manifest) {
  const blockers = [];
  const warnings = [];
  const signed = manifest?.signed === true;
  const timestamped = manifest?.timestamped === true;
  const signingStatus = readSafeStatus(manifest?.signingStatus);
  const publisher = readNonEmptyString(manifest?.publisher);

  if (!signed || !["signed_timestamped_verified", "signed_verified"].includes(signingStatus ?? "")) {
    blockers.push("production_signing_missing");
  }

  if (!timestamped || signingStatus !== "signed_timestamped_verified") {
    blockers.push("production_timestamp_missing");
  }

  if (!publisher) {
    blockers.push("production_publisher_missing");
  }

  return {
    name: "signing_timestamp",
    status: blockers.length > 0 ? "blocked" : "ready",
    signed: signed ? "true" : "false",
    signingStatus: signingStatus ?? "missing",
    timestamped: timestamped ? "true" : "false",
    publisher: publisher ? "present" : "missing",
    blockers,
    warnings
  };
}

function auditSmartScreenBoundary(manifest) {
  const blockers = [];
  const warnings = [];
  const claim = readSafeStatus(manifest?.smartScreenClaim);

  if (!manifest || !claim) {
    warnings.push("smartscreen_not_claimed");
  } else if (claim === "not_claimed") {
    // Truthful for a local/static checklist: no local pass claim is made.
  } else if (claim === "observed_risk") {
    warnings.push("smartscreen_observed_risk");
  } else {
    blockers.push("smartscreen_claim_not_supported_by_evidence");
  }

  return {
    name: "smartscreen_boundary",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    smartScreenClaim: claim ?? "missing",
    blockers,
    warnings
  };
}

function auditGitHubReleaseEvidence(manifest) {
  const blockers = [];
  const warnings = [];
  const release = manifest?.githubRelease && typeof manifest.githubRelease === "object" && !Array.isArray(manifest.githubRelease)
    ? manifest.githubRelease
    : null;
  const artifactName = readNonEmptyString(manifest?.artifactName);
  const artifactSha256 = readSha256(manifest?.sha256);
  const artifactSize = readPositiveInteger(manifest?.sizeBytes);

  if (!release) {
    blockers.push("github_release_missing");
    return {
      name: "github_release",
      status: "blocked",
      blockers,
      warnings
    };
  }

  const url = readPublicUrl(release.url);
  const tag = readNonEmptyString(release.tag);
  const assets = Array.isArray(release.assets) ? release.assets.map(normalizeReleaseAsset).filter(Boolean) : [];
  const artifactAsset = assets.find((asset) => asset.name === artifactName);

  if (!url || !isGitHubReleaseUrl(url)) {
    blockers.push("github_release_url_invalid");
  }

  if (!tag) {
    blockers.push("github_release_tag_missing");
  }

  if (release.draft !== false) {
    blockers.push("github_release_draft");
  }

  if (release.prerelease !== false) {
    blockers.push("github_release_prerelease");
  }

  if (!assets.length) {
    blockers.push("github_release_assets_missing");
  } else if (!artifactAsset) {
    blockers.push("github_release_asset_missing");
  }

  if (artifactAsset) {
    if (artifactAsset.sha256 !== artifactSha256) {
      blockers.push("github_release_asset_sha256_mismatch");
    }

    if (artifactAsset.sizeBytes === null) {
      blockers.push("github_release_asset_size_missing");
    } else if (artifactSize !== null && artifactAsset.sizeBytes !== artifactSize) {
      blockers.push("github_release_asset_size_mismatch");
    }
  }

  return {
    name: "github_release",
    status: blockers.length > 0 ? "blocked" : "ready",
    url,
    tag: safeIdentifier(tag),
    draft: release.draft === false ? "false" : "true_or_missing",
    prerelease: release.prerelease === false ? "false" : "true_or_missing",
    assetBasenames: assets.map((asset) => asset.name),
    blockers,
    warnings
  };
}

function auditAttestationEvidence(manifest) {
  const blockers = [];
  const warnings = [];
  const attestation = manifest?.attestation && typeof manifest.attestation === "object" && !Array.isArray(manifest.attestation)
    ? manifest.attestation
    : null;
  const artifactSha256 = readSha256(manifest?.sha256);

  if (!attestation) {
    blockers.push("production_attestation_missing");
    return {
      name: "attestation",
      status: "blocked",
      blockers,
      warnings
    };
  }

  const status = readSafeStatus(attestation.status);
  const url = readPublicUrl(attestation.url);
  const subjectSha256 = readSha256(attestation.subjectSha256);
  const predicateType = readPublicUrl(attestation.predicateType);

  if (status !== "verified") {
    blockers.push("production_attestation_not_verified");
  }

  if (!url) {
    blockers.push("production_attestation_url_missing_or_invalid");
  }

  if (!subjectSha256 || subjectSha256 !== artifactSha256) {
    blockers.push("production_attestation_subject_mismatch");
  }

  if (!predicateType) {
    blockers.push("production_attestation_predicate_missing");
  }

  return {
    name: "attestation",
    status: blockers.length > 0 ? "blocked" : "ready",
    attestationStatus: status ?? "missing",
    url,
    subjectSha256,
    predicateType,
    blockers,
    warnings
  };
}

function auditNoticesModelRuntime(manifest) {
  const blockers = [];
  const warnings = [];

  if (!manifest) {
    return {
      name: "notices_model_runtime",
      status: "warning",
      blockers,
      warnings: ["production_local_llm_artifact_missing"]
    };
  }

  const notices = manifest.notices && typeof manifest.notices === "object" && !Array.isArray(manifest.notices)
    ? manifest.notices
    : null;
  const model = manifest.model && typeof manifest.model === "object" && !Array.isArray(manifest.model)
    ? manifest.model
    : null;
  const runtime = manifest.runtime && typeof manifest.runtime === "object" && !Array.isArray(manifest.runtime)
    ? manifest.runtime
    : null;

  if (!notices) {
    blockers.push("third_party_notices_missing");
  } else {
    const noticeFile = readNonEmptyString(notices.file);

    if (notices.included !== true) {
      blockers.push("third_party_notices_not_included");
    }

    if (!noticeFile || !isBasenameOnly(noticeFile)) {
      blockers.push("third_party_notices_file_missing_or_not_basename");
    }
  }

  if (!model) {
    blockers.push("model_release_metadata_missing");
  } else {
    validateObjectFields(model, ["repo", "file", "license", "sha256", "sizeBytes"], "model", blockers);
  }

  if (!runtime) {
    blockers.push("runtime_release_metadata_missing");
  } else {
    const releaseIdentity = readNonEmptyString(runtime.releaseTag) ?? readNonEmptyString(runtime.releaseOrCommit);

    validateObjectFields(runtime, ["name", "license", "sha256"], "runtime", blockers);

    if (!releaseIdentity) {
      blockers.push("runtime_release_identity_missing");
    }
  }

  return {
    name: "notices_model_runtime",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    notices: notices ? {
      file: readNonEmptyString(notices.file) ? basename(readNonEmptyString(notices.file)) : undefined,
      included: notices.included === true ? "true" : "false"
    } : undefined,
    model: model ? safeModelRuntimeSummary(model, ["repo", "file", "license", "sha256", "sizeBytes"]) : undefined,
    runtime: runtime ? safeModelRuntimeSummary(runtime, ["name", "license", "releaseTag", "releaseOrCommit", "sha256", "sizeBytes"]) : undefined,
    blockers,
    warnings
  };
}

function auditPrivacyRedaction(manifest, rawText) {
  const blockers = [];
  const warnings = [];

  if (!manifest) {
    return {
      name: "privacy_redaction",
      status: "blocked",
      blockers: ["privacy_redaction_missing"],
      warnings
    };
  }

  const privacy = manifest.privacyRedaction && typeof manifest.privacyRedaction === "object" && !Array.isArray(manifest.privacyRedaction)
    ? manifest.privacyRedaction
    : null;

  if (!privacy) {
    blockers.push("privacy_redaction_missing");
  } else {
    for (const field of REQUIRED_PRIVACY_REDACTION_FIELDS) {
      if (privacy[field] !== "forbidden") {
        blockers.push("privacy_redaction_incomplete");
        break;
      }
    }
  }

  const unsafeCodes = findUnsafeManifestContent(manifest, rawText);
  blockers.push(...unsafeCodes);

  return {
    name: "privacy_redaction",
    status: blockers.length > 0 ? "blocked" : "ready",
    privacyRedaction: privacy ? "configured" : "missing",
    blockers,
    warnings
  };
}

function auditTrackedArtifacts(trackedFiles) {
  const blockers = [];
  const warnings = [];
  const trackedHeavy = trackedFiles
    .map((entry) => normalizeSlashes(String(entry)))
    .filter((entry) => HEAVY_TRACKED_ARTIFACT_PATTERNS.some((pattern) => pattern.test(entry)));

  if (trackedHeavy.length > 0) {
    blockers.push("tracked_heavy_generated_artifacts");
  }

  return {
    name: "tracked_artifacts",
    status: blockers.length > 0 ? "blocked" : "ready",
    trackedHeavyArtifactCount: trackedHeavy.length,
    trackedHeavyArtifactBasenames: trackedHeavy.map((entry) => basename(entry)).slice(0, 20),
    blockers,
    warnings
  };
}

function readReleaseManifest(root, env, options) {
  const explicitPath = readNonEmptyString(options.releaseManifestPath)
    ?? RELEASE_MANIFEST_ENV_NAMES.map((name) => readNonEmptyString(env[name])).find(Boolean);

  if (!explicitPath) {
    return {
      value: null,
      rawText: "",
      blockers: [],
      summary: {
        status: "missing"
      }
    };
  }

  const manifestPath = resolve(root, explicitPath);
  const manifestName = basename(manifestPath);

  if (normalizeSlashes(manifestPath).toLowerCase().includes(".env.local")) {
    return {
      value: null,
      rawText: "",
      blockers: ["release_manifest_path_forbidden"],
      summary: {
        basename: manifestName,
        status: "forbidden"
      }
    };
  }

  if (!existsSync(manifestPath)) {
    return {
      value: null,
      rawText: "",
      blockers: ["release_manifest_read_failed"],
      summary: {
        basename: manifestName,
        status: "missing"
      }
    };
  }

  try {
    const rawText = readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(rawText);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        value: null,
        rawText,
        blockers: ["release_manifest_invalid_json"],
        summary: {
          basename: manifestName,
          status: "invalid"
        }
      };
    }

    return {
      value: parsed,
      rawText,
      blockers: [],
      summary: {
        basename: manifestName,
        status: "present"
      }
    };
  } catch (error) {
    return {
      value: null,
      rawText: "",
      blockers: ["release_manifest_invalid_json"],
      summary: {
        basename: manifestName,
        status: "invalid"
      }
    };
  }
}

function readPackageJson(root) {
  try {
    return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
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

function readArtifactName(builderConfig, targetName) {
  const target = readWinTargets(builderConfig).find((candidate) => candidate.target === targetName);
  return target?.artifactName ?? builderConfig?.[targetName]?.artifactName ?? null;
}

function gitLsFiles(root) {
  const result = spawnSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function readChecksumEvidence(manifest) {
  const checksumBlock = manifest.checksums && typeof manifest.checksums === "object" && !Array.isArray(manifest.checksums)
    ? manifest.checksums
    : {};
  const rawEntries = Array.isArray(manifest.sha256Sums)
    ? manifest.sha256Sums
    : Array.isArray(checksumBlock.entries)
      ? checksumBlock.entries
      : [];

  return {
    file: readNonEmptyString(checksumBlock.file) ?? readNonEmptyString(manifest.sha256SumsFile),
    entries: rawEntries.map(normalizeChecksumEntry).filter(Boolean)
  };
}

function normalizeChecksumEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const name = readNonEmptyString(entry.name) ?? readNonEmptyString(entry.artifactName) ?? readNonEmptyString(entry.file);
  const sha256 = readSha256(entry.sha256);
  const sizeBytes = readPositiveInteger(entry.sizeBytes);

  if (!name || !isBasenameOnly(name) || !sha256) {
    return null;
  }

  return {
    name: basename(name),
    sha256,
    sizeBytes
  };
}

function normalizeReleaseAsset(asset) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    return null;
  }

  const name = readNonEmptyString(asset.name);
  const sha256 = readSha256(asset.sha256);
  const sizeBytes = readPositiveInteger(asset.sizeBytes);

  if (!name || !isBasenameOnly(name)) {
    return null;
  }

  return {
    name: basename(name),
    sha256,
    sizeBytes
  };
}

function validateObjectFields(object, fields, prefix, blockers) {
  for (const field of fields) {
    if (field === "sha256") {
      if (!readSha256(object[field])) {
        blockers.push(`${prefix}_${field}_missing_or_invalid`);
      }
    } else if (field === "sizeBytes") {
      if (readPositiveInteger(object[field]) === null) {
        blockers.push(`${prefix}_${field}_missing_or_invalid`);
      }
    } else if (!readNonEmptyString(object[field])) {
      blockers.push(`${prefix}_${field}_missing`);
    }
  }
}

function findUnsafeManifestContent(value, rawText) {
  const codes = new Set();

  if (/[A-Za-z]:\\/.test(rawText) || /(^|["'\s])\/(?:Users|home|tmp|var)\//i.test(rawText)) {
    codes.add("privacy_local_path_leak");
  }

  visitValue(value, [], (path, entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const joinedPath = path.join(".");
    const lowerPath = joinedPath.toLowerCase();
    const allowedPrivacyEnum = lowerPath.startsWith("privacyredaction.") && entry === "forbidden";

    if (/[A-Za-z]:\\/.test(entry) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(entry)) {
      codes.add("privacy_local_path_leak");
    }

    if (!allowedPrivacyEnum && /(?:authorization|api[_-]?key|token|cookie|private key|pfx|p12|password|pin)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_secret_leak");
    }

    if (!allowedPrivacyEnum && /(?:secret_prompt_text|system prompt|full prompt|prompt text)/i.test(entry)) {
      codes.add("privacy_model_input_leak");
    }

    if (!allowedPrivacyEnum && /(?:request_body|request body|raw request)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_request_payload_leak");
    }

    if (!allowedPrivacyEnum && /(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_conversation_body_leak");
    }

    if (!allowedPrivacyEnum && /(?:fact_card_text|fact-card|fact card body|user memory body)/i.test(`${joinedPath} ${entry}`)) {
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

function safeArtifactFromManifest(manifest) {
  return manifest ? removeUndefined({
    basename: readNonEmptyString(manifest.artifactName) ? basename(readNonEmptyString(manifest.artifactName)) : undefined,
    kind: safeIdentifier(manifest.artifactKind),
    target: safeIdentifier(manifest.target),
    arch: safeIdentifier(manifest.arch),
    sha256: readSha256(manifest.sha256),
    sizeBytes: readPositiveInteger(manifest.sizeBytes),
    status: "declared"
  }) : undefined;
}

function safeModelRuntimeSummary(value, fields) {
  return removeUndefined(Object.fromEntries(fields.map((field) => {
    if (field === "file") {
      const file = readNonEmptyString(value[field]);
      return [field, file ? basename(file) : undefined];
    }

    if (field === "sha256") {
      return [field, readSha256(value[field])];
    }

    if (field === "sizeBytes") {
      return [field, readPositiveInteger(value[field])];
    }

    return [field, safeIdentifier(value[field])];
  })));
}

function stripIssues(check) {
  const { blockers, warnings, ...safeCheck } = check;
  return safeCheck;
}

function uniqueIssueCodes(codes) {
  return Array.from(new Set(codes.filter(Boolean))).sort();
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function readSafeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) ? text : null;
}

function readPublicUrl(value) {
  const text = readNonEmptyString(value);

  if (!text) {
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

function isGitHubReleaseUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "github.com" && /\/releases\/tag\//.test(url.pathname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname) {
  return /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(hostname);
}

function isBasenameOnly(value) {
  const text = readNonEmptyString(value);
  return Boolean(text) && basename(text) === text && !/[\\/]/.test(text) && !/[A-Za-z]:/.test(text);
}

function safeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) ? text : undefined;
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
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

function parseCliOptions(argv) {
  const releaseManifestArg = argv.find((arg) => arg.startsWith("--release-manifest="));
  const releaseManifestIndex = argv.indexOf("--release-manifest");

  return {
    releaseManifestPath: releaseManifestArg
      ? releaseManifestArg.slice("--release-manifest=".length)
      : releaseManifestIndex >= 0
        ? argv[releaseManifestIndex + 1]
        : undefined
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    printJson(auditProductionReleaseChecklist(parseCliOptions(process.argv.slice(2))));
  } catch (error) {
    printJson({
      ok: false,
      status: "script_failed",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      exitPolicy: "always_zero",
      reason: error instanceof Error ? error.name : "unexpected_error"
    });
  }
}
