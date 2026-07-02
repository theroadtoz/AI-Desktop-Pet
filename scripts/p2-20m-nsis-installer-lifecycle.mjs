import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import {
  assertSafeP2_20JTmpRoot,
  getP2_20JPaths,
  getRepoRoot,
  stageElectronBuilderLocalLlmExtraResources
} from "./p2-20j-stage-electron-builder-extra-resources.mjs";

const runtimeName = "llama.cpp";
const keepTmpEnv = "P2_20M_KEEP_TMP";
const installTimeoutMs = 240_000;
const uninstallTimeoutMs = 180_000;
const launchProbeMs = 8_000;
const shortcutName = "AI Desktop Pet.lnk";

export function shouldKeepP2_20MTmp(env = process.env) {
  return env[keepTmpEnv] === "1";
}

export function getP2_20MPaths(repoRoot = getRepoRoot()) {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const installParentRoot = join(tmpRoot, "p2-20m-installed-app");
  const installRoot = join(installParentRoot, "app");
  const userDataRoot = join(tmpRoot, "p2-20m-installed-user-data");

  return {
    tmpRoot,
    installParentRoot,
    installRoot,
    userDataRoot
  };
}

export function assertSafeP2_20MTmpRoot(candidateRoot, repoRoot = getRepoRoot()) {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const resolvedRoot = resolve(candidateRoot);
  const tmpPrefix = tmpRoot.endsWith(sep) ? tmpRoot : `${tmpRoot}${sep}`;

  if (resolvedRoot !== tmpRoot && !resolvedRoot.startsWith(tmpPrefix)) {
    throw new Error("p2_20m_destination_outside_repo_tmp");
  }
}

export function findNsisInstaller(packageOutputRoot) {
  if (!existsSync(packageOutputRoot)) {
    return null;
  }

  const candidates = readdirSync(packageOutputRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(packageOutputRoot, entry.name))
    .filter((entryPath) => {
      const lower = basename(entryPath).toLowerCase();
      return lower.endsWith(".exe") && !lower.startsWith("uninstall ");
    })
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  return candidates[0] ?? null;
}

export function findUninstaller(installRoot) {
  if (!existsSync(installRoot)) {
    return null;
  }

  const candidates = readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(installRoot, entry.name))
    .filter((entryPath) => {
      const lower = basename(entryPath).toLowerCase();
      return lower.startsWith("uninstall ") && lower.endsWith(".exe");
    })
    .sort((left, right) => basename(left).localeCompare(basename(right)));

  return candidates[0] ?? null;
}

export function cleanupP2_20MTmpOnCompletion(p2jPaths = getP2_20JPaths(), p2mPaths = getP2_20MPaths(), shortcutSnapshot = [], env = process.env) {
  if (shouldKeepP2_20MTmp(env)) {
    return {
      cleanupStatus: "kept"
    };
  }

  for (const root of [
    p2jPaths.stagingRoot,
    p2jPaths.packageOutputRoot,
    p2mPaths.installParentRoot,
    p2mPaths.userDataRoot
  ]) {
    assertSafeP2_20JTmpRoot(root);
    assertSafeP2_20MTmpRoot(root);
    rmSync(root, { recursive: true, force: true });
  }

  cleanupCreatedShortcuts(shortcutSnapshot);

  return {
    cleanupStatus: "removed"
  };
}

async function main() {
  const repoRoot = getRepoRoot();
  const p2jPaths = getP2_20JPaths(repoRoot);
  const p2mPaths = getP2_20MPaths(repoRoot);
  const shortcutSnapshot = createShortcutSnapshot();
  const summary = await runAcceptance(repoRoot, p2jPaths, p2mPaths, shortcutSnapshot);
  const cleanup = cleanupP2_20MTmpOnCompletion(p2jPaths, p2mPaths, shortcutSnapshot);

  printSummary({
    ...summary,
    shortcuts: summarizeShortcutLifecycle(shortcutSnapshot),
    cleanupStatus: cleanup.cleanupStatus
  });
}

async function runAcceptance(repoRoot, p2jPaths, p2mPaths, shortcutSnapshot) {
  const startedAt = Date.now();
  let stagedThisRun = false;
  let packagedThisRun = false;
  let installedThisRun = false;
  let launch = null;
  let uninstallResult = null;

  try {
    if (process.platform !== "win32") {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "windows_only",
        durationMs: Date.now() - startedAt
      };
    }

    assertSafeP2_20JTmpRoot(p2jPaths.packageOutputRoot, repoRoot);
    assertSafeP2_20MTmpRoot(p2mPaths.installParentRoot, repoRoot);
    assertSafeP2_20MTmpRoot(p2mPaths.userDataRoot, repoRoot);

    rmSync(p2jPaths.packageOutputRoot, { recursive: true, force: true });
    rmSync(p2mPaths.installParentRoot, { recursive: true, force: true });
    rmSync(p2mPaths.userDataRoot, { recursive: true, force: true });
    mkdirSync(dirname(p2mPaths.installRoot), { recursive: true });

    const stageResult = await stageElectronBuilderLocalLlmExtraResources({ repoRoot });
    stagedThisRun = stageResult.ok;

    if (!stageResult.ok) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "electron_builder_extra_resources_stage_failed",
        stageStatus: stageResult.summary.status,
        stageReason: stageResult.summary.reason,
        stagedThisRun,
        packagedThisRun,
        installedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    const packageResult = runPackageWinNsis(repoRoot);
    packagedThisRun = packageResult.status === 0;

    if (packageResult.status !== 0) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "package_win_nsis_failed",
        packageExitCode: packageResult.status,
        packageErrorCode: packageResult.error?.code,
        packageStdoutBytes: Buffer.byteLength(packageResult.stdout ?? ""),
        packageStderrBytes: Buffer.byteLength(packageResult.stderr ?? ""),
        stagedThisRun,
        packagedThisRun,
        installedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    const installerPath = findNsisInstaller(p2jPaths.packageOutputRoot);

    if (!installerPath) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "nsis_installer_missing",
        stagedThisRun,
        packagedThisRun,
        installedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    const installResult = runProcess(installerPath, ["/S", `/D=${p2mPaths.installRoot}`], {
      cwd: p2jPaths.packageOutputRoot,
      timeoutMs: installTimeoutMs
    });
    installedThisRun = installResult.status === 0;
    recordShortcutState(shortcutSnapshot, "afterInstall");

    if (installResult.status !== 0) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "silent_install_failed",
        installerName: basename(installerPath),
        installExitCode: installResult.status,
        installErrorCode: installResult.errorCode,
        installStdoutBytes: installResult.stdoutBytes,
        installStderrBytes: installResult.stderrBytes,
        stagedThisRun,
        packagedThisRun,
        installedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    const installedLayout = inspectInstalledLayout(p2mPaths.installRoot);

    if (!installedLayout.ok) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "installed_layout_incomplete",
        installerName: basename(installerPath),
        installExitCode: installResult.status,
        installedLayout,
        stagedThisRun,
        packagedThisRun,
        installedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    launch = await launchInstalledApp(installedLayout.appExecutablePath, p2mPaths.userDataRoot);

    if (launch.status !== "started") {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "installed_app_launch_failed",
        installerName: basename(installerPath),
        installExitCode: installResult.status,
        installedLayout: stripInternalPathsFromLayout(installedLayout),
        launch,
        stagedThisRun,
        packagedThisRun,
        installedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    uninstallResult = runProcess(installedLayout.uninstallerPath, ["/currentuser", "/S"], {
      cwd: p2mPaths.installRoot,
      timeoutMs: uninstallTimeoutMs
    });
    await waitForPathRemoval(p2mPaths.installRoot, 30_000);
    recordShortcutState(shortcutSnapshot, "afterUninstall");

    const uninstallChecks = inspectUninstallResult(p2mPaths.installRoot, installedLayout);
    const ok = uninstallResult.status === 0 && uninstallChecks.ok;

    return {
      ok,
      status: ok ? "ready" : "blocked",
      runtime: runtimeName,
      reason: ok ? undefined : "silent_uninstall_incomplete",
      installerName: basename(installerPath),
      installDirectoryName: basename(p2mPaths.installRoot),
      userDataIsolation: launch.userDataIsolation,
      installExitCode: installResult.status,
      uninstallExitCode: uninstallResult.status,
      installedLayout: stripInternalPathsFromLayout(installedLayout),
      launch,
      uninstallChecks,
      stagedThisRun,
      packagedThisRun,
      installedThisRun,
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (launch?.pidObserved && launch.stopStatus !== "terminated") {
      stopProcessTree(launch.pid);
    }
  }
}

function runPackageWinNsis(repoRoot) {
  const command = "cmd.exe";
  const args = ["/d", "/s", "/c", "npm.cmd run package:win:nsis"];

  return spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

function runProcess(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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

function inspectInstalledLayout(installRoot) {
  const appExecutablePath = join(installRoot, "AI Desktop Pet.exe");
  const uninstallerPath = findUninstaller(installRoot);
  const localLlmManifestPath = join(installRoot, "resources", "local-llm", "manifest.json");
  const windowIconPath = join(installRoot, "resources", "icons", "app-icon-256.png");
  const checks = {
    appExecutable: existsSync(appExecutablePath),
    uninstaller: Boolean(uninstallerPath),
    localLlmManifest: existsSync(localLlmManifestPath),
    packagedWindowIcon: existsSync(windowIconPath)
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    appExecutablePath,
    uninstallerPath,
    resourceNames: {
      localLlm: "local-llm",
      icon: "app-icon-256.png"
    }
  };
}

function stripInternalPathsFromLayout(layout) {
  return {
    ok: layout.ok,
    checks: layout.checks,
    executableName: layout.appExecutablePath ? basename(layout.appExecutablePath) : undefined,
    uninstallerName: layout.uninstallerPath ? basename(layout.uninstallerPath) : undefined,
    resourceNames: layout.resourceNames
  };
}

async function launchInstalledApp(appExecutablePath, userDataRoot) {
  const startedAt = Date.now();
  assertSafeP2_20MTmpRoot(userDataRoot);
  rmSync(userDataRoot, { recursive: true, force: true });
  mkdirSync(userDataRoot, { recursive: true });

  const child = spawn(appExecutablePath, [], {
    cwd: dirname(appExecutablePath),
    env: {
      ...process.env,
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_ALLOW_PACKAGED_USER_DATA_OVERRIDE: "1",
      AI_DESKTOP_PET_USER_DATA_PATH: userDataRoot
    },
    stdio: "ignore",
    windowsHide: false
  });
  let exitStatus = null;

  child.once("exit", (code, signal) => {
    exitStatus = { code, signal };
  });

  await delay(launchProbeMs);

  const started = Boolean(child.pid) && exitStatus === null;
  const stopStatus = child.pid ? stopProcessTree(child.pid) : "skipped";

  return {
    status: started ? "started" : "exited_early",
    pidObserved: Boolean(child.pid),
    pid: child.pid,
    userDataIsolation: "packaged_acceptance_override",
    durationMs: Date.now() - startedAt,
    exitCode: exitStatus?.code,
    exitSignal: exitStatus?.signal,
    stopStatus
  };
}

function stopProcessTree(pid) {
  if (!pid) {
    return "skipped";
  }

  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true
  });

  return result.status === 0 ? "terminated" : "not_running_or_failed";
}

function inspectUninstallResult(installRoot, installedLayout) {
  const checks = {
    installDirectoryRemoved: !existsSync(installRoot),
    appExecutableRemoved: installedLayout.appExecutablePath ? !existsSync(installedLayout.appExecutablePath) : false,
    localLlmRemoved: !existsSync(join(installRoot, "resources", "local-llm", "manifest.json")),
    uninstallerRemoved: installedLayout.uninstallerPath ? !existsSync(installedLayout.uninstallerPath) : false
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks
  };
}

function createShortcutSnapshot() {
  const candidates = [
    ["desktop", readWindowsSpecialFolder("DesktopDirectory")],
    ["startMenu", readWindowsSpecialFolder("Programs")],
    ["commonDesktop", readWindowsSpecialFolder("CommonDesktopDirectory")],
    ["commonStartMenu", readWindowsSpecialFolder("CommonPrograms")]
  ]
    .filter(([, folder]) => typeof folder === "string" && folder.length > 0)
    .map(([kind, folder]) => ({
      kind,
      shortcutPath: join(folder, shortcutName),
      existedBefore: existsSync(join(folder, shortcutName)),
      afterInstall: undefined,
      afterUninstall: undefined,
      afterCleanup: undefined,
      cleanupStatus: "not_needed"
    }));

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.shortcutPath.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function readWindowsSpecialFolder(name) {
  if (process.platform !== "win32") {
    return null;
  }

  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `[Environment]::GetFolderPath('${name}')`
  ], {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function recordShortcutState(shortcutSnapshot, key) {
  for (const entry of shortcutSnapshot) {
    entry[key] = existsSync(entry.shortcutPath);
  }
}

function cleanupCreatedShortcuts(shortcutSnapshot) {
  for (const entry of shortcutSnapshot) {
    if (entry.existedBefore || !existsSync(entry.shortcutPath)) {
      entry.cleanupStatus = "not_needed";
      continue;
    }

    try {
      rmSync(entry.shortcutPath, { force: true });
      entry.cleanupStatus = existsSync(entry.shortcutPath) ? "failed" : "removed";
    } catch {
      entry.cleanupStatus = "failed";
    }
  }

  for (const entry of shortcutSnapshot) {
    entry.afterCleanup = existsSync(entry.shortcutPath);
  }
}

function summarizeShortcutLifecycle(shortcutSnapshot) {
  return shortcutSnapshot.map((entry) => ({
    kind: entry.kind,
    existedBefore: entry.existedBefore,
    afterInstall: entry.afterInstall,
    afterUninstall: entry.afterUninstall,
    afterCleanup: entry.afterCleanup,
    cleanupStatus: entry.cleanupStatus
  }));
}

async function waitForPathRemoval(path, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!existsSync(path)) {
      return true;
    }

    await delay(500);
  }

  return !existsSync(path);
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function printSummary(summary) {
  if (summary.ok === false) {
    process.exitCode = 1;
  }

  const safeSummary = removeUndefined({
    ...summary,
    safeSummaryOnly: true
  });

  console.log(JSON.stringify(stripUnsafeStrings(safeSummary), null, 2));
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
    const cleanup = cleanupP2_20MTmpOnCompletion();
    printSummary({
      ok: false,
      status: "script_failed",
      runtime: runtimeName,
      reason: error instanceof Error ? error.message : "unexpected_error",
      cleanupStatus: cleanup.cleanupStatus
    });
    process.exitCode = 1;
  });
}
