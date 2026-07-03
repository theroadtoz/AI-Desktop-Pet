import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditProductionThirdPartyNoticesDraftAndEvidence } from "./p2-20v-production-third-party-notices-draft-and-evidence.mjs";
import {
  assertSafeP2_20JTmpRoot,
  getP2_20JPaths,
  getRepoRoot,
  packageOutputRootName
} from "./p2-20j-stage-electron-builder-extra-resources.mjs";

const require = createRequire(import.meta.url);
const repoRoot = getRepoRoot();
const PHASE = "P2-20W";
const AUDIT_NAME = "electron_chromium_notices_packaged_artifact";
const PACKAGED_APP_ROOT_ROLE = "p2_20j_package_output_win_unpacked";
const CUSTOM_PACKAGED_APP_ROOT_ROLE = "caller_supplied_packaged_app_root";
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
const REQUIRED_FILE_SPECS = [
  {
    key: "electron_license_file",
    role: "electron_license_file",
    relativeRole: "LICENSE",
    alternativeRelativeRoles: ["LICENSE.electron.txt"],
    basename: "LICENSE",
    missingBlocker: "electron_license_file_missing",
    readyCheck: "electron_license_file_present"
  },
  {
    key: "chromium_licenses_file",
    role: "chromium_licenses_file",
    relativeRole: "LICENSES.chromium.html",
    basename: "LICENSES.chromium.html",
    missingBlocker: "chromium_licenses_file_missing",
    readyCheck: "chromium_licenses_file_present"
  },
  {
    key: "ffmpeg_runtime_file",
    role: "ffmpeg_runtime_file",
    relativeRole: "ffmpeg.dll",
    basename: "ffmpeg.dll",
    missingBlocker: "ffmpeg_runtime_file_missing",
    readyCheck: "ffmpeg_runtime_file_present"
  },
  {
    key: "electron_version_file",
    role: "electron_version_file",
    relativeRole: "version",
    basename: "version",
    missingBlocker: "electron_version_file_missing",
    readyCheck: "electron_version_file_present"
  },
  {
    key: "packaged_app_asar",
    role: "packaged_app_asar",
    relativeRole: "resources/app.asar",
    basename: "app.asar",
    missingBlocker: "packaged_app_asar_missing",
    readyCheck: "packaged_app_asar_present"
  }
];

export function auditElectronChromiumNoticesPackagedArtifact(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const p2_20jPaths = getP2_20JPaths(root);
  assertSafeP2_20JTmpRoot(p2_20jPaths.packageOutputRoot, root);

  const packageJson = options.packageJson ?? readJsonFile(join(root, "package.json"));
  const builderConfig = options.builderConfig ?? readBuilderConfig(root);
  const noticesAudit = options.noticesAudit ?? auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot: root,
    packageJson,
    packageLock: options.packageLock,
    builderConfig,
    localLlmScaffold: options.localLlmScaffold,
    policyEvidence: options.policyEvidence,
    evidence: options.evidence,
    modelEvidence: options.modelEvidence,
    runtimeEvidence: options.runtimeEvidence
  });
  const packagedRoot = resolvePackagedAppRoot({
    root,
    p2_20jPaths,
    packagedAppRoot: options.packagedAppRoot
  });
  const builderAudit = auditElectronBuilderConfig(builderConfig, p2_20jPaths);
  const artifactAudit = auditPackagedArtifact({
    packagedRoot,
    builderConfig,
    packageJson
  });
  const readyChecks = uniqueIssueCodes([
    "p2_20v_notices_audit_reused",
    ...(Array.isArray(noticesAudit.readyChecks) ? noticesAudit.readyChecks : []),
    ...builderAudit.readyChecks,
    ...artifactAudit.readyChecks
  ]);
  const blockers = uniqueIssueCodes([
    ...REQUIRED_PRODUCTION_BLOCKERS,
    ...(Array.isArray(noticesAudit.blockers) ? noticesAudit.blockers : []),
    ...builderAudit.blockers,
    ...artifactAudit.blockers
  ]);
  const warnings = uniqueIssueCodes([
    ...(Array.isArray(noticesAudit.warnings) ? noticesAudit.warnings : []),
    ...builderAudit.warnings,
    ...artifactAudit.warnings
  ]);

  return removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    packagedArtifactStatus: artifactAudit.status,
    packagedArtifact: artifactAudit.summary,
    electronBuilderConfig: builderAudit.summary,
    upstreamNoticesAudit: summarizeNoticesAudit(noticesAudit),
    readyChecks,
    blockers,
    warnings,
    checks: {
      packaged_artifact: {
        status: artifactAudit.status,
        rootBasename: packagedRoot.basename,
        rootRole: packagedRoot.role,
        requiredFileCount: artifactAudit.summary.requiredEvidence.length,
        missingRequiredFileCount: artifactAudit.summary.requiredEvidence
          .filter((entry) => entry.status === "missing").length
      },
      electron_builder_config: {
        status: builderAudit.summary.status,
        outputBasename: builderAudit.summary.directoriesOutput.basename,
        winTargets: builderAudit.summary.winTargets.values,
        customElectronDist: builderAudit.summary.hooks.electronDist,
        afterExtract: builderAudit.summary.hooks.afterExtract,
        afterPack: builderAudit.summary.hooks.afterPack
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

function resolvePackagedAppRoot({ root, p2_20jPaths, packagedAppRoot }) {
  if (readNonEmptyString(packagedAppRoot)) {
    const resolved = resolve(packagedAppRoot);

    return {
      path: resolved,
      role: CUSTOM_PACKAGED_APP_ROOT_ROLE,
      basename: safeBasename(resolved),
      relativeRole: CUSTOM_PACKAGED_APP_ROOT_ROLE
    };
  }

  const resolved = join(p2_20jPaths.packageOutputRoot, "win-unpacked");

  return {
    path: resolved,
    role: PACKAGED_APP_ROOT_ROLE,
    basename: "win-unpacked",
    relativeRole: normalizeSlashes(join(".tmp", packageOutputRootName, "win-unpacked"))
  };
}

function auditPackagedArtifact({ packagedRoot, builderConfig, packageJson }) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];
  const rootStatus = isExistingDirectory(packagedRoot.path) ? "present" : "missing";
  const requiredEvidence = [
    ...REQUIRED_FILE_SPECS.map((spec) => summarizeRequiredFile(packagedRoot.path, spec)),
    summarizeAppExecutable(packagedRoot.path, builderConfig, packageJson),
    summarizeRequiredDirectory(packagedRoot.path, {
      key: "packaged_local_llm_resources",
      role: "packaged_local_llm_resources",
      relativeRole: "resources/local-llm",
      basename: "local-llm",
      missingBlocker: "packaged_local_llm_resources_missing",
      readyCheck: "packaged_local_llm_resources_present"
    })
  ];

  if (rootStatus === "missing") {
    blockers.push("packaged_app_artifact_missing", "electron_upstream_notices_evidence_missing");
  }

  for (const entry of requiredEvidence) {
    if (entry.status === "missing") {
      blockers.push(entry.missingBlocker);
    } else {
      readyChecks.push(entry.readyCheck);
    }
  }

  if (rootStatus === "present") {
    readyChecks.push("packaged_app_artifact_present");
  }

  if (rootStatus === "present" && requiredEvidence.every((entry) => entry.status === "present")) {
    readyChecks.push("electron_upstream_notices_shape_ready");
  }

  return {
    status: rootStatus === "present" ? "present" : "missing",
    blockers,
    warnings,
    readyChecks,
    summary: {
      status: rootStatus,
      rootBasename: packagedRoot.basename,
      rootRole: packagedRoot.role,
      relativeRole: packagedRoot.relativeRole,
      requiredEvidence: requiredEvidence.map(stripInternalFields),
      optionalRuntimeEvidence: rootStatus === "present"
        ? collectOptionalPackagedEvidence(packagedRoot.path)
        : [],
      approvalStatus: "evidence_only_not_approved"
    }
  };
}

function summarizeRequiredFile(root, spec) {
  const relativeRoles = [spec.relativeRole, ...(spec.alternativeRelativeRoles ?? [])];
  let fileSummary = null;

  for (const relativeRole of relativeRoles) {
    const filePath = join(root, ...relativeRole.split("/"));
    const candidateSummary = summarizeFile(filePath, spec.role, relativeRole, relativeRole);

    if (candidateSummary.status === "present") {
      fileSummary = candidateSummary;
      break;
    }

    fileSummary ??= candidateSummary;
  }

  return {
    ...fileSummary,
    key: spec.key,
    acceptedRelativeRoles: relativeRoles,
    missingBlocker: spec.missingBlocker,
    readyCheck: spec.readyCheck
  };
}

function summarizeRequiredDirectory(root, spec) {
  const directoryPath = join(root, ...spec.relativeRole.split("/"));
  const status = isExistingDirectory(directoryPath) ? "present" : "missing";
  const childCounts = status === "present" ? countImmediateChildren(directoryPath) : {};

  return {
    key: spec.key,
    role: spec.role,
    relativeRole: spec.relativeRole,
    basename: spec.basename,
    entryType: "directory",
    status,
    ...childCounts,
    missingBlocker: spec.missingBlocker,
    readyCheck: spec.readyCheck
  };
}

function summarizeAppExecutable(root, builderConfig, packageJson) {
  const candidates = expectedExecutableBasenames(builderConfig, packageJson);
  const selected = findFirstExistingExecutable(root, candidates);
  const relativeRole = selected ? selected.basename : candidates[0] ?? "app.exe";
  const summary = selected
    ? summarizeFile(selected.path, "packaged_app_executable", relativeRole, selected.basename)
    : {
      role: "packaged_app_executable",
      relativeRole,
      basename: safeBasename(relativeRole),
      status: "missing"
    };

  return {
    ...summary,
    key: "packaged_app_executable",
    missingBlocker: "packaged_app_executable_missing",
    readyCheck: "packaged_app_executable_present"
  };
}

function expectedExecutableBasenames(builderConfig, packageJson) {
  const names = [
    builderConfig?.productName,
    packageJson?.productName,
    packageJson?.name
  ]
    .map(readNonEmptyString)
    .filter(Boolean)
    .map((name) => `${name}.exe`);

  return Array.from(new Set([...names, "AI Desktop Pet.exe"]));
}

function findFirstExistingExecutable(root, preferredBasenames) {
  for (const candidate of preferredBasenames) {
    const candidatePath = join(root, candidate);

    if (isExistingFile(candidatePath)) {
      return {
        path: candidatePath,
        basename: safeBasename(candidate)
      };
    }
  }

  if (!isExistingDirectory(root)) {
    return null;
  }

  for (const entry of safeReadDir(root)) {
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".exe" && !/^uninstall/i.test(entry.name)) {
      return {
        path: join(root, entry.name),
        basename: safeBasename(entry.name)
      };
    }
  }

  return null;
}

function collectOptionalPackagedEvidence(root) {
  const entries = [];

  for (const name of ["resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin"]) {
    entries.push(summarizeFile(join(root, name), "electron_runtime_optional_file", name, name));
  }

  for (const entry of safeReadDir(root)) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();

    if (extension === ".dll" || extension === ".pak") {
      entries.push(summarizeFile(
        join(root, entry.name),
        "electron_runtime_root_file",
        entry.name,
        entry.name
      ));
    }
  }

  for (const entry of safeReadDir(join(root, "locales"))) {
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".pak") {
      entries.push(summarizeFile(
        join(root, "locales", entry.name),
        "electron_runtime_locale_file",
        normalizeSlashes(join("locales", entry.name)),
        entry.name
      ));
    }
  }

  const appAsarUnpacked = join(root, "resources", "app.asar.unpacked");

  if (isExistingDirectory(appAsarUnpacked)) {
    entries.push({
      role: "packaged_app_asar_unpacked",
      relativeRole: "resources/app.asar.unpacked",
      basename: "app.asar.unpacked",
      entryType: "directory",
      status: "present",
      ...countImmediateChildren(appAsarUnpacked)
    });
  }

  entries.push(summarizeFile(
    join(root, "resources", "icons", "app-icon-256.png"),
    "packaged_icon_resource",
    "resources/icons/app-icon-256.png",
    "app-icon-256.png"
  ));

  const uniqueByRole = new Map();

  for (const entry of entries) {
    uniqueByRole.set(`${entry.role}:${entry.relativeRole}`, entry);
  }

  return Array.from(uniqueByRole.values())
    .filter((entry) => entry.status === "present")
    .sort((a, b) => a.relativeRole.localeCompare(b.relativeRole))
    .slice(0, 80);
}

function summarizeFile(filePath, role, relativeRole, fallbackBasename) {
  if (!isExistingFile(filePath)) {
    return {
      role,
      relativeRole,
      basename: safeBasename(fallbackBasename),
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

function auditElectronBuilderConfig(builderConfig, p2_20jPaths) {
  const blockers = [];
  const warnings = [];
  const readyChecks = [];
  const directoriesOutput = summarizeConfigPath(
    builderConfig?.directories?.output,
    "directories.output"
  );
  const files = Array.isArray(builderConfig?.files) ? builderConfig.files : [];
  const extraResources = Array.isArray(builderConfig?.extraResources) ? builderConfig.extraResources : [];
  const winTargets = readWinTargets(builderConfig?.win?.target);
  const hooks = {
    electronDist: builderConfig?.electronDist ? "custom_override_present" : "absent",
    afterExtract: builderConfig?.afterExtract ? "hook_present" : "absent",
    afterPack: builderConfig?.afterPack ? "hook_present" : "absent",
    ffmpegCustomization: findMatchingKeys(builderConfig, /ffmpeg/i).length > 0 ? "present" : "absent"
  };
  const expectedOutputBasename = safeBasename(p2_20jPaths.packageOutputRoot);
  const outputMatchesP2_20J = directoriesOutput.basename === expectedOutputBasename;
  const localLlmExtraResource = extraResources.some((entry) => (
    normalizeSlashes(String(entry?.to ?? entry ?? "")).includes("local-llm")
    || normalizeSlashes(String(entry?.from ?? "")).includes("local-llm")
  ));

  if (!builderConfig) {
    blockers.push("electron_builder_config_missing");
  }

  if (directoriesOutput.status === "missing") {
    blockers.push("electron_builder_output_directory_missing");
  } else {
    readyChecks.push("electron_builder_output_directory_configured");
  }

  if (directoriesOutput.status !== "missing" && !outputMatchesP2_20J) {
    warnings.push("electron_builder_output_directory_not_p2_20j");
  }

  if (files.length === 0) {
    blockers.push("electron_builder_files_missing");
  } else {
    readyChecks.push("electron_builder_files_configured");
  }

  if (!localLlmExtraResource) {
    blockers.push("electron_builder_extra_resources_local_llm_missing");
  } else {
    readyChecks.push("electron_builder_extra_resources_local_llm_configured");
  }

  if (!winTargets.includes("dir")) {
    blockers.push("electron_builder_win_dir_target_missing");
  }

  for (const target of ["dir", "portable", "nsis"]) {
    if (winTargets.includes(target)) {
      readyChecks.push(`electron_builder_win_${target}_target_configured`);
    } else if (target !== "dir") {
      warnings.push(`electron_builder_win_${target}_target_missing`);
    }
  }

  if (hooks.electronDist === "custom_override_present") {
    blockers.push("electron_builder_electron_dist_custom_override_present");
  } else {
    readyChecks.push("electron_builder_electron_dist_absent");
  }

  if (hooks.afterExtract === "hook_present") {
    warnings.push("electron_builder_after_extract_hook_present");
  } else {
    readyChecks.push("electron_builder_after_extract_hook_absent");
  }

  if (hooks.afterPack === "hook_present") {
    warnings.push("electron_builder_after_pack_hook_present");
  } else {
    readyChecks.push("electron_builder_after_pack_hook_absent");
  }

  if (hooks.ffmpegCustomization === "present") {
    warnings.push("electron_builder_ffmpeg_customization_present");
  }

  return {
    blockers,
    warnings,
    readyChecks,
    summary: {
      status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
      directoriesOutput,
      files: {
        role: "files",
        status: files.length > 0 ? "present" : "missing",
        count: files.length,
        entries: files.map((entry) => summarizeConfigEntry(entry)).slice(0, 30)
      },
      extraResources: {
        role: "extraResources",
        status: extraResources.length > 0 ? "present" : "missing",
        count: extraResources.length,
        localLlm: localLlmExtraResource ? "configured" : "missing",
        entries: extraResources.map(summarizeExtraResource).slice(0, 30)
      },
      winTargets: {
        role: "win.target",
        status: winTargets.length > 0 ? "present" : "missing",
        values: winTargets
      },
      hooks
    }
  };
}

function summarizeConfigPath(value, role) {
  const text = readNonEmptyString(value);

  if (!text) {
    return {
      role,
      status: "missing",
      basename: "missing",
      relativeRole: role
    };
  }

  if (isAbsolute(text)) {
    return {
      role,
      status: "present",
      basename: safeBasename(text),
      relativeRole: "redacted_absolute_path"
    };
  }

  return {
    role,
    status: "present",
    basename: safeBasename(text),
    relativeRole: safeRelativeRole(text)
  };
}

function summarizeConfigEntry(entry) {
  if (typeof entry === "string") {
    return summarizeConfigPath(entry, "files.entry");
  }

  return {
    role: "files.entry",
    status: "present",
    valueType: Array.isArray(entry) ? "array" : typeof entry
  };
}

function summarizeExtraResource(entry) {
  if (typeof entry === "string") {
    return {
      role: "extraResources.entry",
      status: "present",
      from: summarizeConfigPath(entry, "from")
    };
  }

  return {
    role: "extraResources.entry",
    status: "present",
    from: summarizeConfigPath(entry?.from, "from"),
    to: summarizeConfigPath(entry?.to, "to")
  };
}

function readWinTargets(value) {
  const rawTargets = Array.isArray(value) ? value : readNonEmptyString(value) ? [value] : [];
  const targets = [];

  for (const entry of rawTargets) {
    const target = typeof entry === "string" ? entry : entry?.target;
    const safeTarget = safeIdentifier(target);

    if (safeTarget) {
      targets.push(safeTarget);
    }
  }

  return Array.from(new Set(targets)).sort();
}

function summarizeNoticesAudit(noticesAudit) {
  return {
    phase: safeIdentifier(noticesAudit?.phase) ?? "unknown",
    audit: safeIdentifier(noticesAudit?.audit) ?? "unknown",
    status: safeIdentifier(noticesAudit?.status) ?? "unknown",
    blockerCount: Array.isArray(noticesAudit?.blockers) ? noticesAudit.blockers.length : 0,
    warningCount: Array.isArray(noticesAudit?.warnings) ? noticesAudit.warnings.length : 0,
    readyCheckCount: Array.isArray(noticesAudit?.readyChecks) ? noticesAudit.readyChecks.length : 0,
    electronPackagedRuntimeNotices: safeIdentifier(
      noticesAudit?.evidenceChecklist?.electronPackagedRuntimeNotices?.status
    ) ?? "unknown",
    finalNoticesWritePolicy: safeIdentifier(noticesAudit?.draft?.finalNoticesWritePolicy) ?? "unknown"
  };
}

function findMatchingKeys(value, pattern, keys = []) {
  if (!value || typeof value !== "object") {
    return keys;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (pattern.test(key)) {
      keys.push(key);
    }

    if (entry && typeof entry === "object") {
      findMatchingKeys(entry, pattern, keys);
    }
  }

  return keys;
}

function readBuilderConfig(root) {
  try {
    return require(resolve(root, "electron-builder.config.cjs"));
  } catch {
    return null;
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
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

function countImmediateChildren(path) {
  let fileCount = 0;
  let directoryCount = 0;

  for (const entry of safeReadDir(path)) {
    if (entry.isFile()) {
      fileCount += 1;
    } else if (entry.isDirectory()) {
      directoryCount += 1;
    }
  }

  return {
    immediateFileCount: fileCount,
    immediateDirectoryCount: directoryCount
  };
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stripInternalFields(entry) {
  const { key, missingBlocker, readyCheck, ...publicEntry } = entry;
  return publicEntry;
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

    if (arg === "--packaged-app-root") {
      const next = args[index + 1];

      if (!readNonEmptyString(next)) {
        throw new Error("missing_packaged_app_root_value");
      }

      options.packagedAppRoot = next;
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
    printJson(auditElectronChromiumNoticesPackagedArtifact(parseCliArgs(process.argv.slice(2))));
  } catch (error) {
    printJson({
      ok: false,
      status: "blocked",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      exitPolicy: "always_zero",
      productionReadyClaim: false,
      packagedArtifactStatus: "unknown",
      reason: error instanceof Error ? error.message : "unexpected_error"
    });
  }
}
