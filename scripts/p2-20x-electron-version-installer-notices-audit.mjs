import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditElectronChromiumNoticesPackagedArtifact } from "./p2-20w-electron-chromium-notices-packaged-artifact-audit.mjs";
import { getRepoRoot } from "./p2-20j-stage-electron-builder-extra-resources.mjs";
import { getP2_20MPaths } from "./p2-20m-nsis-installer-lifecycle.mjs";

const PHASE = "P2-20X";
const AUDIT_NAME = "electron_version_installer_notices";
const require = createRequire(import.meta.url);
const REQUIRED_PRODUCTION_BLOCKERS = [
  "package_version_0_0_0",
  "app_distribution_license_policy_pending",
  "owner_release_approval_missing",
  "legal_review_not_approved",
  "third_party_notices_not_approved",
  "electron_chromium_notices_not_approved",
  "final_third_party_notices_missing",
  "model_license_evidence_missing",
  "runtime_license_evidence_missing",
  "local_llm_production_pack_missing",
  "production_release_not_approved"
];

export function auditElectronVersionInstallerNotices(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const packageJson = options.packageJson ?? readJsonFile(join(root, "package.json"));
  const packageLock = options.packageLock ?? readJsonFile(join(root, "package-lock.json"));
  const builderConfig = options.builderConfig ?? readBuilderConfig(root);
  const p2mPaths = getP2_20MPaths(root);
  const installedRoot = resolveInstalledAppRoot({
    root,
    p2mPaths,
    installedAppRoot: options.installedAppRoot
  });
  const p2wAudit = options.packagedAudit ?? auditElectronChromiumNoticesPackagedArtifact({
    repoRoot: root,
    packagedAppRoot: installedRoot.path,
    packageJson,
    builderConfig,
    noticesAudit: options.noticesAudit,
    localLlmScaffold: options.localLlmScaffold,
    policyEvidence: options.policyEvidence,
    evidence: options.evidence,
    modelEvidence: options.modelEvidence,
    runtimeEvidence: options.runtimeEvidence
  });
  const electronVersionEvidence = auditElectronVersionEvidence({
    root,
    packageJson,
    packageLock,
    installedRoot,
    electronDistVersionFile: options.electronDistVersionFile
  });
  const builderVersionEvidence = auditElectronBuilderVersionExtraFiles(builderConfig);
  const installedEvidence = summarizeInstalledEvidence({
    installedRoot,
    packagedAudit: p2wAudit,
    electronVersionEvidence
  });
  const versionSourceReady = electronVersionEvidence.status === "ready";
  const readyChecks = uniqueIssueCodes([
    ...(Array.isArray(p2wAudit.readyChecks) ? p2wAudit.readyChecks : []),
    ...electronVersionEvidence.readyChecks,
    ...builderVersionEvidence.readyChecks,
    ...installedEvidence.readyChecks
  ]);
  const blockers = uniqueIssueCodes([
    ...REQUIRED_PRODUCTION_BLOCKERS,
    ...(Array.isArray(p2wAudit.blockers) ? p2wAudit.blockers : [])
      .filter((code) => code !== "electron_version_file_missing" || !versionSourceReady),
    ...electronVersionEvidence.blockers,
    ...builderVersionEvidence.blockers,
    ...installedEvidence.blockers
  ]);
  const warnings = uniqueIssueCodes([
    ...(Array.isArray(p2wAudit.warnings) ? p2wAudit.warnings : []),
    ...electronVersionEvidence.warnings,
    ...builderVersionEvidence.warnings,
    ...installedEvidence.warnings
  ]);

  return removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    installedAppStatus: installedEvidence.status,
    installedApp: installedEvidence.summary,
    electronVersionEvidence: electronVersionEvidence.summary,
    electronBuilderVersionEvidence: builderVersionEvidence.summary,
    upstreamNoticesAudit: {
      phase: safeIdentifier(p2wAudit.phase) ?? "unknown",
      audit: safeIdentifier(p2wAudit.audit) ?? "unknown",
      status: safeIdentifier(p2wAudit.status) ?? "unknown",
      blockerCount: Array.isArray(p2wAudit.blockers) ? p2wAudit.blockers.length : 0,
      warningCount: Array.isArray(p2wAudit.warnings) ? p2wAudit.warnings.length : 0,
      readyCheckCount: Array.isArray(p2wAudit.readyChecks) ? p2wAudit.readyChecks.length : 0
    },
    readyChecks,
    blockers,
    warnings,
    checks: {
      installed_app: {
        status: installedEvidence.status,
        rootBasename: installedRoot.basename,
        rootRole: installedRoot.role,
        missingRequiredFileCount: installedEvidence.missingRequiredFileCount,
        missingRequiredWithoutVersionCount: installedEvidence.missingRequiredWithoutVersionCount
      },
      electron_version_evidence: {
        status: electronVersionEvidence.status,
        declaredVersion: electronVersionEvidence.summary.declaredVersion,
        lockVersion: electronVersionEvidence.summary.lockVersion,
        distVersion: electronVersionEvidence.summary.distVersion,
        installedVersion: electronVersionEvidence.summary.installedVersion,
        installedVersionFileStatus: electronVersionEvidence.summary.installedVersionFile.status,
        sourceEvidenceStatus: electronVersionEvidence.summary.sourceEvidenceStatus
      },
      electron_builder_version_evidence: {
        status: builderVersionEvidence.summary.status,
        extraFilesCount: builderVersionEvidence.summary.extraFiles.count,
        versionFile: builderVersionEvidence.summary.required.versionFile,
        electronLicenseFile: builderVersionEvidence.summary.required.electronLicenseFile,
        chromiumLicensesFile: builderVersionEvidence.summary.required.chromiumLicensesFile
      },
      production_boundary: {
        status: "blocked",
        productionReadyClaim: false,
        legalReview: "not_approved",
        finalThirdPartyNotices: "not_approved",
        electronChromiumNotices: "not_approved"
      }
    }
  });
}

function auditElectronBuilderVersionExtraFiles(builderConfig) {
  const readyChecks = [];
  const blockers = [];
  const warnings = [];
  const extraFiles = Array.isArray(builderConfig?.extraFiles) ? builderConfig.extraFiles : [];
  const required = {
    versionFile: findExtraFile(extraFiles, {
      from: "node_modules/electron/dist/version",
      to: "version"
    }),
    electronLicenseFile: findExtraFile(extraFiles, {
      from: "node_modules/electron/dist/LICENSE",
      to: "LICENSE.electron.txt"
    }),
    chromiumLicensesFile: findExtraFile(extraFiles, {
      from: "node_modules/electron/dist/LICENSES.chromium.html",
      to: "LICENSES.chromium.html"
    })
  };

  if (!builderConfig) {
    blockers.push("electron_builder_config_missing");
  }

  if (extraFiles.length === 0) {
    blockers.push("electron_builder_extra_files_missing");
  } else {
    readyChecks.push("electron_builder_extra_files_configured");
  }

  if (required.versionFile.status === "present") {
    readyChecks.push("electron_builder_extra_files_electron_version_configured");
  } else {
    blockers.push("electron_builder_extra_files_electron_version_missing");
  }

  if (required.electronLicenseFile.status === "present") {
    readyChecks.push("electron_builder_extra_files_electron_license_configured");
  } else {
    warnings.push("electron_builder_extra_files_electron_license_missing");
  }

  if (required.chromiumLicensesFile.status === "present") {
    readyChecks.push("electron_builder_extra_files_chromium_licenses_configured");
  } else {
    warnings.push("electron_builder_extra_files_chromium_licenses_missing");
  }

  return {
    readyChecks,
    blockers,
    warnings,
    summary: {
      status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
      extraFiles: {
        role: "electron_builder.extraFiles",
        status: extraFiles.length > 0 ? "present" : "missing",
        count: extraFiles.length,
        entries: extraFiles.map(summarizeExtraFile).slice(0, 30)
      },
      required
    }
  };
}

function findExtraFile(extraFiles, expected) {
  const match = extraFiles.find((entry) => {
    const from = normalizeSlashes(String(entry?.from ?? entry ?? ""));
    const to = normalizeSlashes(String(entry?.to ?? ""));

    return from === expected.from && to === expected.to;
  });

  if (!match) {
    return {
      status: "missing",
      from: safeRelativeRole(expected.from),
      to: safeRelativeRole(expected.to)
    };
  }

  return {
    status: "present",
    from: safeRelativeRole(match.from ?? match),
    to: safeRelativeRole(match.to ?? "")
  };
}

function summarizeExtraFile(entry) {
  if (typeof entry === "string") {
    return {
      role: "extraFiles.entry",
      status: "present",
      from: safeRelativeRole(entry),
      to: "missing"
    };
  }

  return {
    role: "extraFiles.entry",
    status: "present",
    from: safeRelativeRole(entry?.from),
    to: safeRelativeRole(entry?.to)
  };
}

function resolveInstalledAppRoot({ p2mPaths, installedAppRoot }) {
  if (readNonEmptyString(installedAppRoot)) {
    const resolved = resolve(installedAppRoot);

    return {
      path: resolved,
      role: "caller_supplied_installed_app_root",
      basename: safeBasename(resolved),
      relativeRole: "caller_supplied_installed_app_root"
    };
  }

  return {
    path: p2mPaths.installRoot,
    role: "p2_20m_installed_app_root",
    basename: safeBasename(p2mPaths.installRoot),
    relativeRole: ".tmp/p2-20m-installed-app/app"
  };
}

function auditElectronVersionEvidence({ root, packageJson, packageLock, installedRoot, electronDistVersionFile }) {
  const declaredVersion = safeVersion(packageJson?.devDependencies?.electron ?? packageJson?.dependencies?.electron);
  const lockEntry = findPackageLockEntry(packageLock, "electron");
  const lockVersion = safeVersion(lockEntry?.version);
  const distVersionPath = electronDistVersionFile
    ? resolve(electronDistVersionFile)
    : join(root, "node_modules", "electron", "dist", "version");
  const installedVersionPath = join(installedRoot.path, "version");
  const distVersionFile = summarizeVersionFile(distVersionPath, "electron_dist_version_file", "node_modules/electron/dist/version");
  const installedVersionFile = summarizeVersionFile(installedVersionPath, "installed_electron_version_file", "version");
  const distVersion = safeVersion(distVersionFile.version);
  const installedVersion = safeVersion(installedVersionFile.version);
  const readyChecks = [];
  const blockers = [];
  const warnings = [];

  if (declaredVersion) {
    readyChecks.push("electron_version_package_declared_present");
  } else {
    blockers.push("electron_version_package_declared_missing");
  }

  if (lockVersion) {
    readyChecks.push("electron_version_lock_entry_present");
  } else {
    warnings.push("electron_version_lock_entry_missing");
  }

  if (distVersionFile.status === "present" && distVersion) {
    readyChecks.push("electron_version_dist_file_present");
  } else {
    blockers.push("electron_version_dist_file_missing");
  }

  if (installedVersionFile.status === "present" && installedVersion) {
    readyChecks.push("installed_electron_version_file_present");
  }

  const packageSourceMatches = Boolean(
    distVersion
    && (lockVersion === distVersion || stripVersionRange(declaredVersion) === distVersion)
  );

  if (packageSourceMatches) {
    readyChecks.push("electron_version_source_evidence_present");
  } else {
    blockers.push("electron_version_source_evidence_missing");
  }

  if (installedVersionFile.status === "present" && installedVersion && installedVersion !== distVersion) {
    blockers.push("installed_electron_version_mismatch");
  }

  if (installedVersionFile.status === "missing" && packageSourceMatches) {
    warnings.push("installed_electron_version_file_missing_using_source_evidence");
  } else if (installedVersionFile.status === "missing") {
    blockers.push("electron_version_file_missing");
  }

  return {
    status: packageSourceMatches ? "ready" : "blocked",
    readyChecks,
    blockers,
    warnings,
    summary: {
      status: packageSourceMatches ? "ready" : "blocked",
      sourceEvidenceStatus: packageSourceMatches ? "ready" : "blocked",
      declaredVersion,
      lockVersion,
      distVersion,
      installedVersion,
      packageSourceMatches,
      distVersionFile,
      installedVersionFile,
      approvalStatus: "evidence_only_not_approved"
    }
  };
}

function summarizeInstalledEvidence({ installedRoot, packagedAudit, electronVersionEvidence }) {
  const requiredEvidence = Array.isArray(packagedAudit?.packagedArtifact?.requiredEvidence)
    ? packagedAudit.packagedArtifact.requiredEvidence
    : [];
  const missingRequired = requiredEvidence.filter((entry) => entry.status === "missing");
  const missingRequiredWithoutVersion = missingRequired.filter((entry) => entry.role !== "electron_version_file");
  const rootPresent = isExistingDirectory(installedRoot.path);
  const readyChecks = [];
  const blockers = [];
  const warnings = [];

  if (rootPresent) {
    readyChecks.push("installed_app_root_present");
  } else {
    blockers.push("installed_app_root_missing");
  }

  if (rootPresent && missingRequiredWithoutVersion.length === 0 && electronVersionEvidence.status === "ready") {
    readyChecks.push("installed_notices_shape_ready");
  }

  if (missingRequiredWithoutVersion.length > 0) {
    blockers.push("installed_notices_required_evidence_missing");
  }

  if (rootPresent && missingRequired.some((entry) => entry.role === "electron_version_file")) {
    warnings.push("installed_electron_version_file_missing");
  }

  return {
    status: rootPresent ? "present" : "missing",
    readyChecks,
    blockers,
    warnings,
    missingRequiredFileCount: missingRequired.length,
    missingRequiredWithoutVersionCount: missingRequiredWithoutVersion.length,
    summary: {
      status: rootPresent ? "present" : "missing",
      rootBasename: installedRoot.basename,
      rootRole: installedRoot.role,
      relativeRole: installedRoot.relativeRole,
      requiredEvidence,
      missingRequiredWithoutVersion: missingRequiredWithoutVersion.map((entry) => ({
        role: entry.role,
        relativeRole: entry.relativeRole,
        status: entry.status
      })),
      optionalRuntimeEvidence: collectInstalledOptionalEvidence(installedRoot.path),
      approvalStatus: "evidence_only_not_approved"
    }
  };
}

function summarizeVersionFile(filePath, role, relativeRole) {
  if (!isExistingFile(filePath)) {
    return {
      role,
      relativeRole,
      basename: safeBasename(relativeRole),
      status: "missing"
    };
  }

  const stat = statSync(filePath);
  const raw = readFileSync(filePath, "utf8").split(/\r?\n/u)[0]?.trim() ?? "";

  return {
    role,
    relativeRole,
    basename: safeBasename(filePath),
    entryType: "file",
    sizeBytes: stat.size,
    sha256: sha256File(filePath),
    status: "present",
    version: safeVersion(raw)
  };
}

function collectInstalledOptionalEvidence(root) {
  if (!isExistingDirectory(root)) {
    return [];
  }

  const entries = [];

  for (const entry of safeReadDir(root)) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();

    if (extension === ".dll" || extension === ".pak") {
      entries.push(summarizeFile(join(root, entry.name), "installed_runtime_root_file", entry.name));
    }
  }

  for (const name of ["resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin"]) {
    const summary = summarizeFile(join(root, name), "installed_runtime_optional_file", name);

    if (summary.status === "present") {
      entries.push(summary);
    }
  }

  return entries
    .filter((entry) => entry.status === "present")
    .sort((left, right) => left.relativeRole.localeCompare(right.relativeRole))
    .slice(0, 80);
}

function summarizeFile(filePath, role, relativeRole) {
  if (!isExistingFile(filePath)) {
    return {
      role,
      relativeRole,
      basename: safeBasename(relativeRole),
      status: "missing"
    };
  }

  const stat = statSync(filePath);

  return {
    role,
    relativeRole,
    basename: safeBasename(filePath),
    entryType: "file",
    sizeBytes: stat.size,
    sha256: sha256File(filePath),
    status: "present"
  };
}

function findPackageLockEntry(packageLock, packageName) {
  if (!packageLock?.packages || typeof packageLock.packages !== "object") {
    return null;
  }

  const key = `node_modules/${packageName}`;
  const entry = packageLock.packages[key];

  if (!entry || typeof entry !== "object") {
    return null;
  }

  return entry;
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

function isExistingFile(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isDirectory();
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

  return /^[a-z0-9_ .${}()@+\-[\].]+$/i.test(name) ? name : "redacted_unsafe_basename";
}

function safeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) ? text : null;
}

function safeRelativeRole(value) {
  const text = normalizeSlashes(readNonEmptyString(value) ?? "");

  if (!text || /^[a-z]:\//i.test(text) || text.startsWith("/") || text.includes("..")) {
    return "redacted_unsafe_relative_role";
  }

  return /^[a-z0-9_./*${}()@+\-[\] ]+$/i.test(text) ? text : "redacted_unsafe_relative_role";
}

function safeVersion(value) {
  const text = readNonEmptyString(value);
  return text && /^v?\d+\.\d+\.\d+(?:[-+][a-z0-9._-]+)?$/i.test(text) ? text.replace(/^v/i, "") : null;
}

function stripVersionRange(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return null;
  }

  return safeVersion(text.replace(/^[~^]/u, ""));
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
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

function parseCliArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    printJson(auditElectronVersionInstallerNotices(parseCliArgs(process.argv.slice(2))));
  } catch (error) {
    printJson({
      ok: false,
      status: "blocked",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      exitPolicy: "always_zero",
      productionReadyClaim: false,
      installedAppStatus: "unknown",
      reason: error instanceof Error ? error.message : "unexpected_error"
    });
  }
}
