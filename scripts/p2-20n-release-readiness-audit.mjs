import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localLlmRoot = join(repoRoot, "resources", "local-llm");
const signingEnvNames = [
  "CSC_LINK",
  "CSC_NAME",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
  "AZURE_TRUSTED_SIGNING_ENDPOINT"
];

function main() {
  const packageJson = readJson(join(repoRoot, "package.json"));
  const builderConfig = require(join(repoRoot, "electron-builder.config.cjs"));
  const checks = [
    auditPackageMetadata(packageJson),
    auditElectronBuilder(builderConfig, packageJson),
    auditLocalLlmScaffold(),
    auditSigningReadiness(builderConfig, process.env)
  ];
  const blockers = checks.flatMap((check) => check.blockers ?? []);
  const warnings = checks.flatMap((check) => check.warnings ?? []);

  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";

  printJson({
    ok: status === "ready",
    status,
    phase: "P2-20N",
    audit: "release_readiness",
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    blockers,
    warnings,
    checks: Object.fromEntries(checks.map((check) => [check.name, stripIssues(check)]))
  });
}

function auditPackageMetadata(packageJson) {
  const blockers = [];
  const warnings = [];

  if (packageJson.version === "0.0.0") {
    blockers.push("package_version_0_0_0");
  }

  if (packageJson.license === "UNLICENSED") {
    warnings.push("package_license_unlicensed");
  }

  return {
    name: "package_metadata",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    version: packageJson.version,
    license: packageJson.license,
    blockers,
    warnings
  };
}

function auditElectronBuilder(builderConfig, packageJson) {
  const blockers = [];
  const warnings = [];
  const targets = readWinTargets(builderConfig);
  const targetNames = targets.map((target) => target.target);
  const nsisScript = packageJson.scripts?.["package:win:nsis"] ?? "";
  const nsisArtifactName = readArtifactName(builderConfig, "nsis");
  const portableArtifactName = readArtifactName(builderConfig, "portable");

  for (const expected of ["dir", "portable", "nsis"]) {
    if (!targetNames.includes(expected)) {
      blockers.push(`missing_win_target_${expected}`);
    }
  }

  if (!nsisScript.includes("--publish never") && builderConfig.publish !== "never") {
    blockers.push("nsis_publish_not_explicitly_disabled");
  }

  if (!nsisArtifactName || !portableArtifactName || nsisArtifactName === portableArtifactName) {
    blockers.push("artifact_names_do_not_distinguish_setup_and_portable");
  }

  if (nsisArtifactName && !/setup/i.test(nsisArtifactName)) {
    warnings.push("nsis_artifact_name_missing_setup_marker");
  }

  if (portableArtifactName && !/portable/i.test(portableArtifactName)) {
    warnings.push("portable_artifact_name_missing_portable_marker");
  }

  return {
    name: "electron_builder",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    winTargets: targetNames,
    nsisPublish: nsisScript.includes("--publish never") || builderConfig.publish === "never" ? "disabled" : "not_disabled",
    artifactNames: {
      nsis: nsisArtifactName ? "configured_setup" : "missing",
      portable: portableArtifactName ? "configured_portable" : "missing"
    },
    blockers,
    warnings
  };
}

function auditLocalLlmScaffold() {
  const blockers = [];
  const warnings = [];
  const templatePath = join(localLlmRoot, "manifest.example.json");
  const manifestPath = join(localLlmRoot, "manifest.json");
  const runtimePath = join(localLlmRoot, "runtime");
  const modelsPath = join(localLlmRoot, "models");
  const noticesTemplatePath = join(localLlmRoot, "licenses", "THIRD_PARTY_NOTICES.template.md");
  const noticesPath = join(localLlmRoot, "licenses", "THIRD_PARTY_NOTICES.md");
  const trackedFiles = gitLsFiles("resources/local-llm");
  const trackedProductionNames = trackedFiles
    .filter((entry) => /^resources\/local-llm\/(manifest\.json|runtime\/|models\/)/.test(entry.replaceAll("\\", "/")))
    .map((entry) => basename(entry));

  if (!existsSync(templatePath)) {
    blockers.push("local_llm_manifest_template_missing");
  }

  if (!existsSync(noticesTemplatePath)) {
    blockers.push("third_party_notices_template_missing");
  }

  if (trackedProductionNames.length > 0) {
    blockers.push("production_local_llm_resources_tracked");
  }

  if (!existsSync(manifestPath)) {
    warnings.push("production_manifest_missing");
  }

  if (!existsSync(noticesPath)) {
    warnings.push("third_party_notices_missing");
  } else if (isLikelyPlaceholderNotices(noticesPath)) {
    warnings.push("third_party_notices_unfilled");
  }

  return {
    name: "local_llm_scaffold",
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    scaffold: {
      manifestTemplate: existsSync(templatePath) ? "present" : "missing",
      noticesTemplate: existsSync(noticesTemplatePath) ? "present" : "missing"
    },
    localProductionResources: {
      manifest: summarizeLocalEntry(manifestPath),
      runtime: summarizeLocalEntry(runtimePath),
      models: summarizeLocalEntry(modelsPath),
      notices: summarizeLocalEntry(noticesPath)
    },
    trackedProductionResourceNames: trackedProductionNames,
    blockers,
    warnings
  };
}

function auditSigningReadiness(builderConfig, env) {
  const configuredSigning = [
    builderConfig.win?.certificateFile,
    builderConfig.win?.certificateSubjectName,
    builderConfig.win?.certificateSha1,
    builderConfig.win?.sign,
    builderConfig.win?.signtoolOptions,
    builderConfig.win?.azureSignOptions
  ].some(Boolean);
  const presentEnvNames = signingEnvNames.filter((name) => readNonEmpty(env[name]));
  const azureEnvCount = presentEnvNames.filter((name) => name.startsWith("AZURE_")).length;
  const cscEnvCount = presentEnvNames.filter((name) => name.includes("CSC")).length;

  return {
    name: "signing_readiness",
    status: configuredSigning || presentEnvNames.length > 0 ? "signing_inputs_detected" : "unsigned_preview",
    configuredSigning: configuredSigning ? "present" : "absent",
    environment: {
      azure: azureEnvCount > 0 ? "present" : "absent",
      csc: cscEnvCount > 0 ? "present" : "absent"
    },
    blockers: [],
    warnings: configuredSigning || presentEnvNames.length > 0 ? [] : ["unsigned_preview"]
  };
}

function readWinTargets(builderConfig) {
  const rawTargets = builderConfig.win?.target;
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
  return target?.artifactName ?? builderConfig[targetName]?.artifactName ?? null;
}

function gitLsFiles(pathspec) {
  const result = spawnSync("git", ["ls-files", "--", pathspec], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function summarizeLocalEntry(path) {
  if (!existsSync(path)) {
    return {
      name: basename(path),
      status: "missing"
    };
  }

  const stat = statSync(path);
  return {
    name: basename(path),
    status: stat.isDirectory() ? "directory_present" : "file_present",
    childCount: stat.isDirectory() ? safeChildCount(path) : undefined
  };
}

function safeChildCount(path) {
  try {
    return readdirSync(path).length;
  } catch {
    return undefined;
  }
}

function isLikelyPlaceholderNotices(path) {
  const text = readFileSync(path, "utf8").trim();
  return text.length === 0 || /Fill this file before packaging/i.test(text) || /Project:\s*\n/.test(text);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readNonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripIssues(check) {
  const { blockers, warnings, ...safeCheck } = check;
  return safeCheck;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
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
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

main();
