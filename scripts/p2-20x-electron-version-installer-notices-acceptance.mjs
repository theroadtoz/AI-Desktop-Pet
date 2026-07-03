import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { auditElectronVersionInstallerNotices } from "./p2-20x-electron-version-installer-notices-audit.mjs";
import {
  assertSafeP2_20JTmpRoot,
  getP2_20JPaths,
  getRepoRoot,
  stageElectronBuilderLocalLlmExtraResources
} from "./p2-20j-stage-electron-builder-extra-resources.mjs";
import {
  assertSafeP2_20MTmpRoot,
  cleanupP2_20MTmpOnCompletion,
  findNsisInstaller,
  findUninstaller,
  getP2_20MPaths
} from "./p2-20m-nsis-installer-lifecycle.mjs";

const PHASE = "P2-20X";
const AUDIT_NAME = "electron_version_installer_notices_acceptance";
const sourceRootEnv = "AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT";
const installTimeoutMs = 240_000;
const uninstallTimeoutMs = 180_000;

async function main() {
  const repoRoot = getRepoRoot();
  const p2jPaths = getP2_20JPaths(repoRoot);
  const p2mPaths = getP2_20MPaths(repoRoot);
  const startedAt = Date.now();
  const summary = await runAcceptance(repoRoot, p2jPaths, p2mPaths, startedAt);

  printSummary(summary);
}

async function runAcceptance(repoRoot, p2jPaths, p2mPaths, startedAt) {
  const localLlmFixtureRoot = join(p2jPaths.tmpRoot, "p2-20x-local-llm-fixture");
  let cleanupStatus = "not_started";
  let uninstall = null;
  let step = "start";

  try {
    step = "platform_check";
    if (process.platform !== "win32") {
      return {
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        reason: "windows_only",
        safeSummaryOnly: true,
        productionReadyClaim: false,
        durationMs: Date.now() - startedAt
      };
    }

    step = "path_safety_check";
    assertSafeP2_20JTmpRoot(p2jPaths.packageOutputRoot, repoRoot);
    assertSafeP2_20MTmpRoot(p2mPaths.installParentRoot, repoRoot);
    assertSafeP2_20MTmpRoot(p2mPaths.userDataRoot, repoRoot);

    step = "initial_cleanup";
    cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot);
    mkdirSync(dirname(p2mPaths.installRoot), { recursive: true });
    step = "create_local_llm_fixture";
    createLocalLlmFixture(localLlmFixtureRoot, repoRoot);

    step = "stage_extra_resources";
    const stageResult = await stageElectronBuilderLocalLlmExtraResources({
      repoRoot,
      env: {
        ...process.env,
        [sourceRootEnv]: localLlmFixtureRoot
      }
    });

    if (!stageResult.ok) {
      cleanupStatus = cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot).cleanupStatus;

      return {
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        reason: "electron_builder_extra_resources_stage_failed",
        safeSummaryOnly: true,
        productionReadyClaim: false,
        stageStatus: stageResult.summary.status,
        stageReason: stageResult.summary.reason,
        cleanupStatus,
        durationMs: Date.now() - startedAt
      };
    }

    step = "package_nsis";
    const packageResult = runNpmScript(repoRoot, "package:win:nsis", 300_000);

    if (packageResult.status !== 0) {
      cleanupStatus = cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot).cleanupStatus;

      return {
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        reason: "package_win_nsis_failed",
        safeSummaryOnly: true,
        productionReadyClaim: false,
        packageExitCode: packageResult.status,
        packageStdoutBytes: packageResult.stdoutBytes,
        packageStderrBytes: packageResult.stderrBytes,
        cleanupStatus,
        durationMs: Date.now() - startedAt
      };
    }

    step = "find_installer";
    const installerPath = findNsisInstaller(p2jPaths.packageOutputRoot);

    if (!installerPath) {
      cleanupStatus = cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot).cleanupStatus;

      return {
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        reason: "nsis_installer_missing",
        safeSummaryOnly: true,
        productionReadyClaim: false,
        cleanupStatus,
        durationMs: Date.now() - startedAt
      };
    }

    step = "silent_install";
    const install = runProcess(installerPath, ["/S", `/D=${p2mPaths.installRoot}`], {
      cwd: p2jPaths.packageOutputRoot,
      timeoutMs: installTimeoutMs
    });

    if (install.status !== 0 || !existsSync(p2mPaths.installRoot)) {
      cleanupStatus = cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot).cleanupStatus;

      return {
        ok: false,
        status: "blocked",
        phase: PHASE,
        audit: AUDIT_NAME,
        reason: "silent_install_failed",
        safeSummaryOnly: true,
        productionReadyClaim: false,
        installerName: basename(installerPath),
        installExitCode: install.status,
        installStdoutBytes: install.stdoutBytes,
        installStderrBytes: install.stderrBytes,
        cleanupStatus,
        durationMs: Date.now() - startedAt
      };
    }

    step = "audit_installed_app";
    const audit = auditElectronVersionInstallerNotices({
      repoRoot,
      installedAppRoot: p2mPaths.installRoot
    });
    const uninstallerPath = findUninstaller(p2mPaths.installRoot);

    if (uninstallerPath) {
      step = "silent_uninstall";
      uninstall = runProcess(uninstallerPath, ["/currentuser", "/S"], {
        cwd: p2mPaths.installRoot,
        timeoutMs: uninstallTimeoutMs
      });
      sleep(2_000);
    }

    step = "final_cleanup";
    cleanupStatus = cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot).cleanupStatus;

    const ready = acceptanceReady(audit);

    return {
      ok: ready,
      status: ready ? "accepted_blocked_guardrail" : "blocked",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      productionReadyClaim: false,
      reason: ready ? undefined : "installed_evidence_audit_not_ready",
      installerName: basename(installerPath),
      installExitCode: install.status,
      uninstallExitCode: uninstall?.status,
      installedAudit: summarizeAudit(audit),
      checks: {
        installerEvidenceAuditExecuted: true,
        installedNoticesShapeReady: audit.readyChecks.includes("installed_notices_shape_ready"),
        electronVersionSourceEvidencePresent: audit.readyChecks.includes("electron_version_source_evidence_present"),
        productionReadyClaim: audit.productionReadyClaim
      },
      cleanupStatus,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const failedStep = step;
    step = "error_cleanup";
    cleanupStatus = cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot).cleanupStatus;

    return {
      ok: false,
      status: "script_failed",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      productionReadyClaim: false,
      failedStep,
      reason: error instanceof Error ? error.message : "unexpected_error",
      errorName: error instanceof Error ? error.name : undefined,
      uninstallExitCode: uninstall?.status,
      cleanupStatus,
      durationMs: Date.now() - startedAt
    };
  }
}

function createLocalLlmFixture(root, repoRoot) {
  assertSafeP2_20JTmpRoot(root, repoRoot);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "runtime", "win32-x64"), { recursive: true });
  mkdirSync(join(root, "models"), { recursive: true });
  mkdirSync(join(root, "licenses"), { recursive: true });
  writeFileSync(join(root, "runtime", "win32-x64", "llama-server.exe"), "p2-20x runtime fixture\n", "utf8");
  writeFileSync(join(root, "models", "fixture.gguf"), "p2-20x model fixture\n", "utf8");
  writeFileSync(join(root, "licenses", "NOTICES.txt"), "P2-20X local LLM fixture notices\n", "utf8");
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({
    runtime: {
      path: "runtime/win32-x64/llama-server.exe"
    },
    model: {
      path: "models/fixture.gguf",
      alias: "p2-20x-fixture",
      ctxSize: 128
    },
    licenseNotices: "licenses/NOTICES.txt"
  }, null, 2)}\n`, "utf8");
}

function cleanupLocalLlmFixture(root, repoRoot) {
  assertSafeP2_20JTmpRoot(root, repoRoot);
  removeRootWithRetry(root);
}

function cleanupAcceptanceTmp(p2jPaths, p2mPaths, localLlmFixtureRoot, repoRoot) {
  try {
    const cleanup = cleanupP2_20MTmpOnCompletion(p2jPaths, p2mPaths);
    cleanupLocalLlmFixture(localLlmFixtureRoot, repoRoot);

    return cleanup;
  } catch {
    for (const root of [
      p2jPaths.stagingRoot,
      p2jPaths.packageOutputRoot,
      p2mPaths.installParentRoot,
      p2mPaths.userDataRoot,
      localLlmFixtureRoot
    ]) {
      assertSafeP2_20JTmpRoot(root, repoRoot);
      removeRootWithRetry(root);
    }

    return {
      cleanupStatus: "removed_after_retry"
    };
  }
}

function removeRootWithRetry(root) {
  let lastError = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      return;
    } catch (error) {
      lastError = error;
      sleep(250);
    }
  }

  throw lastError;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acceptanceReady(audit) {
  return audit.status === "blocked"
    && audit.productionReadyClaim === false
    && audit.readyChecks.includes("installed_notices_shape_ready")
    && audit.readyChecks.includes("electron_version_source_evidence_present")
    && audit.blockers.includes("production_release_not_approved")
    && !audit.blockers.includes("electron_version_file_missing")
    && audit.checks.installed_app.missingRequiredWithoutVersionCount === 0;
}

function summarizeAudit(audit) {
  return {
    phase: audit.phase,
    audit: audit.audit,
    status: audit.status,
    installedAppStatus: audit.installedAppStatus,
    productionReadyClaim: audit.productionReadyClaim,
    installedApp: {
      rootBasename: audit.installedApp.rootBasename,
      rootRole: audit.installedApp.rootRole,
      missingRequiredWithoutVersionCount: audit.checks.installed_app.missingRequiredWithoutVersionCount
    },
    electronVersionEvidence: audit.checks.electron_version_evidence,
    blockerCount: audit.blockers.length,
    warningCount: audit.warnings.length,
    readyChecks: audit.readyChecks.filter((check) => (
      check === "installed_notices_shape_ready"
      || check === "electron_version_source_evidence_present"
      || check === "electron_version_dist_file_present"
      || check === "electron_version_package_declared_present"
    )),
    expectedProductionBlockers: audit.blockers.filter((blocker) => blocker.endsWith("_not_approved")
      || blocker.endsWith("_missing")
      || blocker === "package_version_0_0_0"
      || blocker === "app_distribution_license_policy_pending"
      || blocker === "local_llm_production_pack_missing"
      || blocker === "production_release_not_approved").slice(0, 20),
    warnings: audit.warnings
  };
}

function runNpmScript(repoRoot, scriptName, timeoutMs) {
  return runProcess("cmd.exe", ["/d", "/s", "/c", `npm.cmd run ${scriptName}`], {
    cwd: repoRoot,
    timeoutMs
  });
}

function runProcess(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs,
    windowsHide: true
  });

  return {
    status: result.status,
    signal: result.signal,
    errorCode: result.error?.code,
    stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
    stderrBytes: Buffer.byteLength(result.stderr ?? "")
  };
}

function printSummary(summary) {
  if (summary.ok === false) {
    process.exitCode = 1;
  }

  process.stdout.write(`${JSON.stringify(removeUndefined(stripUnsafeStrings(summary)), null, 2)}\n`);
}

function stripUnsafeStrings(value) {
  if (Array.isArray(value)) {
    return value.map(stripUnsafeStrings);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      typeof entryValue === "string" && /[A-Za-z]:\\/.test(entryValue)
        ? basename(entryValue)
        : stripUnsafeStrings(entryValue)
    ])
  );
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    printSummary({
      ok: false,
      status: "script_failed",
      phase: PHASE,
      audit: AUDIT_NAME,
      safeSummaryOnly: true,
      productionReadyClaim: false,
      reason: error instanceof Error ? error.message : "unexpected_error"
    });
    process.exitCode = 1;
  });
}
