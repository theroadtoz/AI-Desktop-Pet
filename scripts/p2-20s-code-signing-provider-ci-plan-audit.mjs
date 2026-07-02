import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = "P2-20S";
const AUDIT_NAME = "code_signing_provider_ci_plan";
const PLANNED_BLOCKERS = [
  "code_signing_provider_not_procured",
  "release_workflow_not_created",
  "artifact_attestation_not_generated",
  "smartscreen_not_claimed"
];
const SIGNING_CONFIG_KEYS = [
  "win.azureSignOptions",
  "win.certificateFile",
  "win.certificateSubjectName",
  "win.certificateSha1",
  "win.signtoolOptions",
  "win.sign",
  "forceCodeSigning"
];
const WORKFLOW_MATCH_PATTERN = /^(?:release.*|.*sign.*)\.ya?ml$/i;
const SECRETISH_PATTERN = /(?:secret|token|api[_-]?key|password|private|prompt|request|message|fact|do_not_leak)/i;

export function auditCodeSigningProviderCiPlan(options = {}) {
  const root = options.repoRoot ? resolve(options.repoRoot) : repoRoot;
  const packageJson = options.packageJson ?? readJsonFile(join(root, "package.json"));
  const builderConfig = options.builderConfig ?? readBuilderConfig(root);
  const trackedFiles = normalizeFileList(options.gitTrackedFiles ?? gitLsFiles(root));
  const workflowFiles = normalizeFileList(options.workflowFiles ?? listWorkflowFiles(root, trackedFiles));

  const checks = [
    auditPlanning(),
    auditSigningConfig(builderConfig),
    auditNsisPublishPolicy(packageJson),
    auditTrackedArtifacts(trackedFiles),
    auditReleaseSigningWorkflows(workflowFiles)
  ];
  const blockers = uniqueIssueCodes([
    ...PLANNED_BLOCKERS,
    ...checks.flatMap((check) => check.blockers)
  ]);
  const warnings = uniqueIssueCodes(checks.flatMap((check) => check.warnings));
  const workflowCheck = checks.find((check) => check.name === "release_signing_workflows");

  return removeUndefined({
    ok: false,
    status: "blocked",
    phase: PHASE,
    audit: AUDIT_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    planning: {
      status: "ready"
    },
    providerPlan: {
      primary: "azure_artifact_signing",
      fallbacks: [
        "signpath_foundation",
        "digicert_keylocker",
        "sslcom_esigner",
        "traditional_ov_ca"
      ],
      decisionStatus: "planned_not_procured"
    },
    ciPlan: {
      workflowStatus: workflowCheck?.workflowStatus ?? "planned_not_created",
      releaseUpload: "deferred",
      attestation: "planned_not_generated"
    },
    blockers,
    warnings,
    checks: Object.fromEntries(checks.map((check) => [check.name, stripIssues(check)]))
  });
}

function auditPlanning() {
  return {
    name: "planning",
    status: "ready",
    providerDecision: "planned_not_procured",
    ciReleaseRoute: "planned_not_created",
    blockers: [],
    warnings: []
  };
}

function auditSigningConfig(builderConfig) {
  const detectedOptions = findSigningConfigOptions(builderConfig);
  const blockers = detectedOptions.length > 0 ? ["real_signing_config_detected"] : [];

  return {
    name: "electron_builder_signing_config",
    status: blockers.length > 0 ? "blocked" : "ready",
    configuredSigning: blockers.length > 0 ? "present" : "absent",
    detectedOptionCount: detectedOptions.length,
    blockers,
    warnings: []
  };
}

function auditNsisPublishPolicy(packageJson) {
  const nsisScript = typeof packageJson?.scripts?.["package:win:nsis"] === "string"
    ? packageJson.scripts["package:win:nsis"]
    : "";
  const publishNever = /\s--publish\s+never(?:\s|$)/.test(` ${nsisScript} `);
  const blockers = publishNever ? [] : ["package_win_nsis_publish_not_never"];

  return {
    name: "package_win_nsis_publish_policy",
    status: blockers.length > 0 ? "blocked" : "ready",
    packageWinNsis: nsisScript ? "present" : "missing",
    publishPolicy: publishNever ? "never" : nsisScript ? "not_never" : "missing",
    blockers,
    warnings: []
  };
}

function auditTrackedArtifacts(trackedFiles) {
  const artifacts = trackedFiles.map(classifyTrackedArtifact).filter(Boolean);
  const blockers = artifacts.length > 0 ? ["tracked_signing_or_release_artifacts"] : [];

  return {
    name: "tracked_signing_and_release_artifacts",
    status: blockers.length > 0 ? "blocked" : "ready",
    trackedArtifactCount: artifacts.length,
    trackedSigningMaterialCount: artifacts.filter((artifact) => artifact.kind === "signing_material").length,
    trackedReleaseArtifactCount: artifacts.filter((artifact) => artifact.kind === "release_artifact").length,
    trackedArtifactBasenames: uniqueStable(artifacts.map((artifact) => artifact.basename)).slice(0, 20),
    blockers,
    warnings: []
  };
}

function auditReleaseSigningWorkflows(workflowFiles) {
  const matchingBasenames = workflowFiles
    .map((entry) => basename(entry))
    .filter((name) => WORKFLOW_MATCH_PATTERN.test(name))
    .map(safeBasename)
    .filter(Boolean);
  const blockers = matchingBasenames.length > 0 ? ["release_or_signing_workflow_present"] : [];

  return {
    name: "release_signing_workflows",
    status: blockers.length > 0 ? "blocked" : "ready",
    workflowStatus: matchingBasenames.length > 0 ? "unexpected_workflow_present" : "planned_not_created",
    matchingWorkflowCount: matchingBasenames.length,
    matchingWorkflowBasenames: uniqueStable(matchingBasenames).slice(0, 20),
    blockers,
    warnings: []
  };
}

function findSigningConfigOptions(builderConfig) {
  if (!builderConfig || typeof builderConfig !== "object") {
    return [];
  }

  const detected = [];
  const win = builderConfig.win && typeof builderConfig.win === "object" ? builderConfig.win : {};
  const candidates = [
    ["win.azureSignOptions", win.azureSignOptions],
    ["win.certificateFile", win.certificateFile],
    ["win.certificateSubjectName", win.certificateSubjectName],
    ["win.certificateSha1", win.certificateSha1],
    ["win.signtoolOptions", win.signtoolOptions],
    ["win.sign", win.sign],
    ["forceCodeSigning", builderConfig.forceCodeSigning === true || win.forceCodeSigning === true]
  ];

  for (const [name, value] of candidates) {
    if (SIGNING_CONFIG_KEYS.includes(name) && hasMeaningfulValue(value)) {
      detected.push(name);
    }
  }

  return detected.sort();
}

function classifyTrackedArtifact(entry) {
  const name = basename(entry);

  if (!name) {
    return null;
  }

  if (/\.(?:pfx|p12|key|pem)$/i.test(name) && /(?:pfx|p12|sign|code.?sign|private|key|cert)/i.test(entry)) {
    return {
      kind: "signing_material",
      basename: "redacted_signing_material"
    };
  }

  if (/\.(?:exe|dll|blockmap)$/i.test(name) || /^release-manifest\.json$/i.test(name) || /^SHA256SUMS(?:\.txt)?$/i.test(name)) {
    return {
      kind: "release_artifact",
      basename: safeBasename(name)
    };
  }

  return null;
}

function listWorkflowFiles(root, trackedFiles) {
  const trackedWorkflows = trackedFiles.filter((entry) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(entry));
  const workflowRoot = join(root, ".github", "workflows");

  if (!existsSync(workflowRoot)) {
    return trackedWorkflows;
  }

  try {
    const diskWorkflows = readdirSync(workflowRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => `.github/workflows/${entry.name}`);
    return uniqueStable([...trackedWorkflows, ...diskWorkflows]);
  } catch {
    return trackedWorkflows;
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

function normalizeFileList(files) {
  return Array.isArray(files)
    ? files.map((entry) => String(entry).replace(/\\/g, "/")).filter(Boolean)
    : [];
}

function hasMeaningfulValue(value) {
  if (value === true) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "function") {
    return true;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return false;
}

function safeBasename(value) {
  const name = basename(String(value).replace(/\\/g, "/"));

  if (!name) {
    return undefined;
  }

  return SECRETISH_PATTERN.test(name) ? "redacted_sensitive_basename" : name;
}

function stripIssues(check) {
  const { blockers, warnings, ...safeCheck } = check;
  return safeCheck;
}

function uniqueIssueCodes(codes) {
  return uniqueStable(codes.filter(Boolean)).sort();
}

function uniqueStable(values) {
  return Array.from(new Set(values.filter(Boolean)));
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
    printJson(auditCodeSigningProviderCiPlan());
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
