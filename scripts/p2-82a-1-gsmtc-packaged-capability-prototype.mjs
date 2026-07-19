import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const taskRoot = join(projectRoot, ".tmp", "p2-82a-1-gsmtc-capability");
const packageOutputRoot = join(taskRoot, "package-output");
const builderConfigPath = join(taskRoot, "electron-builder.p2-82a-1.config.cjs");
const builderCliPath = join(projectRoot, "node_modules", "electron-builder", "out", "cli", "cli.js");
const localLlmSourceRoot = join(projectRoot, "resources", "local-llm");
const targets = ["dev", "win-unpacked", "installer"];
const prototypeAppId = "com.ai-desktop-pet.p282a1-prototype";
const prototypeProductName = "AI Desktop Pet P2-82A-1 Prototype";
const prototypeShortcutName = "AI Desktop Pet P2-82A-1 Prototype";
const shortcutName = `${prototypeShortcutName}.lnk`;
const uninstallerName = `Uninstall ${prototypeProductName}.exe`;
const uninstallRegistryRoots = [
  String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`
];

export function resolveInstallerExecutable(root) {
  return join(
    resolve(root),
    ".tmp",
    "p2-82a-1-gsmtc-capability",
    "installed",
    "app",
    `${prototypeProductName}.exe`
  );
}

export function inspectSpawnOutcome(result) {
  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, failureCode: "probe-timeout" };
  }
  if (result.error || result.signal || result.status !== 0) {
    return { ok: false, failureCode: "host-failed" };
  }
  return { ok: true };
}

export function selectSpawnBoundResult(outcome, parsedResult) {
  if (!outcome.ok) {
    return {
      capability: "unknown",
      status: "unknown",
      health: "error",
      failureCode: outcome.failureCode
    };
  }
  if (!parsedResult) {
    return {
      capability: "unknown",
      status: "unknown",
      health: "error",
      failureCode: "invalid-output"
    };
  }
  return {
    capability: parsedResult.capability,
    status: parsedResult.status,
    health: parsedResult.health,
    failureCode: parsedResult.failureCode
  };
}

export function isArtifactFresh(stats, runStartedAtMs) {
  return Number.isFinite(stats?.mtimeMs) && stats.mtimeMs >= runStartedAtMs;
}

export function parseRegistryProbeStatus(value) {
  return value === "clear" || value === "present" || value === "error"
    ? value
    : null;
}

export function isInstallerLifecyclePass(state) {
  return state.appProbeOk === true &&
    state.uninstallOk === true &&
    state.installDirectoryRemoved === true &&
    state.registryClearAfterUninstaller === true &&
    state.existingShortcutsRestored === true &&
    state.shortcutCleanupOk === true &&
    state.shortcutsRemoved === true &&
    state.installedRootRemoved === true;
}

export function cleanupCreatedShortcuts(shortcutSnapshot) {
  let ok = true;
  for (const entry of shortcutSnapshot) {
    if (entry.existedBefore || entry.afterInstall !== true || !existsSync(entry.shortcutPath)) {
      continue;
    }
    try {
      rmSync(entry.shortcutPath, { force: true });
    } catch {
      ok = false;
    }
    if (existsSync(entry.shortcutPath)) {
      ok = false;
    }
  }
  return ok;
}

export function restoreExistingShortcuts(shortcutSnapshot) {
  let ok = true;
  for (const entry of shortcutSnapshot) {
    if (!entry.existedBefore || !entry.backupPath || !existsSync(entry.backupPath)) {
      continue;
    }
    try {
      copyFileSync(entry.backupPath, entry.shortcutPath);
    } catch {
      ok = false;
    }
    if (!existsSync(entry.shortcutPath)) {
      ok = false;
    }
  }
  return ok;
}

if (isDirectExecution()) {
  await main();
}

async function main() {
  const requestedTarget = process.argv.find((value) => value.startsWith("--target="))?.slice(9);
  if (requestedTarget && !targets.includes(requestedTarget)) {
    process.exitCode = 2;
    return;
  }
  if (process.argv.includes("--cleanup")) {
    removeTaskOwnedRoot();
    return;
  }

  const selectedTargets = requestedTarget ? [requestedTarget] : targets;
  const runStartedAtMs = Date.now();
  prepareFreshRunRoots();

  const buildOutcome = inspectSpawnOutcome(runNpmScript("build", 180_000));
  if (!buildOutcome.ok) {
    writeBootstrapFailures(selectedTargets);
    process.exitCode = 1;
    return;
  }

  const runtime = await loadCanonicalRuntime(runStartedAtMs);
  if (!runtime) {
    writeBootstrapFailures(selectedTargets);
    process.exitCode = 1;
    return;
  }

  if (selectedTargets.includes("dev")) {
    publishExecution(runAppTarget("dev", getDevLaunch(runStartedAtMs), runtime));
  }

  const packagedTargets = selectedTargets.filter((target) => target !== "dev");
  if (packagedTargets.length === 0) {
    return;
  }

  const localLlmValidation = inspectSpawnOutcome(
    runNpmScript("validate:local-llm", 300_000)
  );
  if (!localLlmValidation.ok || !writePrototypeBuilderConfig()) {
    for (const target of packagedTargets) {
      publishExecution(createErrorExecution(target, runtime, "host-failed"));
    }
    return;
  }

  if (selectedTargets.includes("win-unpacked")) {
    const packageOutcome = inspectSpawnOutcome(runElectronBuilder("dir", 300_000));
    const executable = join(packageOutputRoot, "win-unpacked", `${prototypeProductName}.exe`);
    const launch = packageOutcome.ok && isFreshFile(executable, runStartedAtMs)
      ? { executable, kind: "packaged" }
      : null;
    publishExecution(launch
      ? runAppTarget("win-unpacked", launch, runtime)
      : createErrorExecution("win-unpacked", runtime, "host-failed"));
  }

  if (selectedTargets.includes("installer")) {
    publishExecution(await runInstallerTarget(runStartedAtMs, runtime));
  }
}

async function loadCanonicalRuntime(runStartedAtMs) {
  const prototypePath = join(
    projectRoot,
    "dist",
    "main",
    "services",
    "desktop-context",
    "gsmtc-capability-prototype.js"
  );
  const settingsPath = join(projectRoot, "dist", "shared", "environment-action-settings.js");
  if (
    !isFreshFile(prototypePath, runStartedAtMs) ||
    !isFreshFile(settingsPath, runStartedAtMs)
  ) {
    return null;
  }

  try {
    const prototypeModule = await import(pathToFileURL(prototypePath).href);
    const settingsModule = await import(pathToFileURL(settingsPath).href);
    if (
      typeof prototypeModule.parseGsmtcCapabilityPrototypeResult !== "function" ||
      typeof prototypeModule.createGsmtcCapabilityPrototypeResult !== "function" ||
      typeof prototypeModule.writeGsmtcCapabilityPrototypeResult !== "function" ||
      typeof settingsModule.createEnvironmentActionSettingsRecord !== "function"
    ) {
      return null;
    }
    return {
      parse: prototypeModule.parseGsmtcCapabilityPrototypeResult,
      createResult: prototypeModule.createGsmtcCapabilityPrototypeResult,
      writeResult: prototypeModule.writeGsmtcCapabilityPrototypeResult,
      createSettingsRecord: settingsModule.createEnvironmentActionSettingsRecord
    };
  } catch {
    return null;
  }
}

async function runInstallerTarget(runStartedAtMs, runtime) {
  const packageOutcome = inspectSpawnOutcome(runElectronBuilder("nsis", 600_000));
  const installerPath = packageOutcome.ok ? findFreshInstaller(runStartedAtMs) : null;
  if (!installerPath) {
    return createErrorExecution("installer", runtime, "host-failed");
  }

  const installedRoot = join(taskRoot, "installed");
  const appRoot = join(installedRoot, "app");
  const shortcutSnapshot = createShortcutSnapshot();
  if (!shortcutSnapshot.ok || !removeInstalledRoot(installedRoot)) {
    return createErrorExecution("installer", runtime, "host-failed");
  }
  const registryBeforeInstall = runPrototypeRegistryAction("query");
  if (registryBeforeInstall === "present") {
    runPrototypeRegistryAction("cleanup");
  }
  if (runPrototypeRegistryAction("query") !== "clear") {
    return createErrorExecution("installer", runtime, "host-failed");
  }
  mkdirSync(installedRoot, { recursive: true });
  const installOutcome = inspectSpawnOutcome(spawnSync(installerPath, [
    "/S",
    `/D=${appRoot}`
  ], {
    cwd: projectRoot,
    windowsHide: true,
    timeout: 180_000,
    stdio: "ignore"
  }));
  const executable = resolveInstallerExecutable(projectRoot);
  const uninstallerPath = findUninstaller(appRoot);
  const installComplete = installOutcome.ok &&
    existsSync(appRoot) &&
    existsSync(executable) &&
    Boolean(uninstallerPath);
  recordShortcutState(shortcutSnapshot.entries, "afterInstall");

  let appExecution = null;
  let uninstallOutcome = { ok: false, failureCode: "host-failed" };
  let installDirectoryRemoved = false;
  let registryClearAfterUninstaller = false;
  let finalRegistryClear = false;
  let shortcutCleanupOk = false;
  let existingShortcutsRestored = false;
  let shortcutsRemoved = false;
  let installedRootRemoved = false;
  try {
    if (installComplete) {
      appExecution = runAppTarget("installer", { executable, kind: "packaged" }, runtime);
    }
  } finally {
    if (uninstallerPath) {
      uninstallOutcome = inspectSpawnOutcome(spawnSync(uninstallerPath, [
        "/currentuser",
        "/S"
      ], {
        cwd: appRoot,
        windowsHide: true,
        timeout: 180_000,
        stdio: "ignore"
      }));
      installDirectoryRemoved = await waitForPathRemoval(appRoot, 30_000);
    }
    const registryAfterUninstaller = runPrototypeRegistryAction("query");
    registryClearAfterUninstaller = registryAfterUninstaller === "clear";
    if (!registryClearAfterUninstaller) {
      runPrototypeRegistryAction("cleanup");
    }
    finalRegistryClear = runPrototypeRegistryAction("query") === "clear";
    recordShortcutState(shortcutSnapshot.entries, "afterUninstall");
    existingShortcutsRestored = restoreExistingShortcuts(shortcutSnapshot.entries);
    shortcutCleanupOk = cleanupCreatedShortcuts(shortcutSnapshot.entries);
    shortcutsRemoved = shortcutSnapshot.entries.every((entry) => (
      entry.existedBefore || entry.afterInstall !== true || !existsSync(entry.shortcutPath)
    ));
    installedRootRemoved = removeInstalledRoot(installedRoot);
  }

  const lifecycleOk = installComplete &&
    finalRegistryClear &&
    isInstallerLifecyclePass({
      appProbeOk: appExecution?.ok,
      uninstallOk: uninstallOutcome.ok,
      installDirectoryRemoved,
      registryClearAfterUninstaller,
      existingShortcutsRestored,
      shortcutCleanupOk,
      shortcutsRemoved,
      installedRootRemoved
    });
  if (!lifecycleOk || !appExecution?.ok) {
    return createErrorExecution("installer", runtime, "host-failed");
  }
  return {
    ok: true,
    result: writeClosedResult(runtime, "installer", {
      capability: appExecution.result.capability,
      status: appExecution.result.status,
      health: appExecution.result.health,
      failureCode: appExecution.result.failureCode
    })
  };
}

function runAppTarget(target, launch, runtime) {
  if (!launch) {
    return createErrorExecution(target, runtime, "host-failed");
  }
  const offUserData = join(taskRoot, "user-data", `${target}-off`);
  const enabledUserData = join(taskRoot, "user-data", `${target}-enabled`);
  resetTaskDirectory(offUserData);
  resetTaskDirectory(enabledUserData);
  writeDisabledSettings(offUserData, runtime);

  const offPhase = runPhase(target, launch, offUserData, runtime);
  const offVerified = offPhase.outcome.ok &&
    offPhase.result.capability === "unknown" &&
    offPhase.result.status === "unknown" &&
    offPhase.result.health === "stopped" &&
    offPhase.result.failureCode === "settings-disabled";

  const enabledPhase = runPhase(target, launch, enabledUserData, runtime);
  if (!offVerified) {
    return createErrorExecution(
      target,
      runtime,
      offPhase.outcome.ok ? "host-failed" : offPhase.outcome.failureCode
    );
  }
  return {
    ok: enabledPhase.outcome.ok && enabledPhase.result.health !== "error",
    result: enabledPhase.result
  };
}

function runPhase(target, launch, userDataPath, runtime) {
  const outputPath = join(taskRoot, `${target}.json`);
  rmSync(outputPath, { force: true });
  const userDataSwitch = `--user-data-dir=${userDataPath}`;
  const args = launch.kind === "dev"
    ? [userDataSwitch, projectRoot]
    : [userDataSwitch];
  const spawned = spawnSync(launch.executable, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      P2_82A_1_GSMTC_PROTOTYPE: "1",
      P2_82A_1_TARGET: target
    },
    windowsHide: true,
    timeout: 15_000,
    stdio: "ignore"
  });
  const outcome = inspectSpawnOutcome(spawned);
  const parsed = existsSync(outputPath)
    ? runtime.parse(readFileSync(outputPath, "utf8"))
    : null;
  const acceptedParsed = parsed?.target === target ? parsed : null;
  const result = writeClosedResult(
    runtime,
    target,
    selectSpawnBoundResult(outcome, acceptedParsed)
  );
  return { outcome, result };
}

function getDevLaunch(runStartedAtMs) {
  const executable = join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
  const appEntry = join(projectRoot, "dist", "main", "app.js");
  return existsSync(executable) && isFreshFile(appEntry, runStartedAtMs)
    ? { executable, kind: "dev" }
    : null;
}

function findFreshInstaller(runStartedAtMs) {
  if (!existsSync(packageOutputRoot)) {
    return null;
  }
  const candidates = readdirSync(packageOutputRoot)
    .filter((name) => /-Setup-.*\.exe$/i.test(name))
    .map((name) => join(packageOutputRoot, name))
    .filter((candidate) => isFreshFile(candidate, runStartedAtMs))
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
    .filter((candidate) => basename(candidate).toLowerCase() === uninstallerName.toLowerCase())
    .sort((left, right) => left.localeCompare(right));
  return candidates[0] ?? null;
}

function runPrototypeRegistryAction(action) {
  if (process.platform !== "win32" || (action !== "query" && action !== "cleanup")) {
    return "error";
  }
  const rootsLiteral = uninstallRegistryRoots
    .map((root) => `'${root.replaceAll("'", "''")}'`)
    .join(",");
  const script = `
$ErrorActionPreference = 'Stop'
$roots = @(${rootsLiteral})
function Find-PrototypeUninstallEntries {
  $found = @()
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($entry in Get-ChildItem -LiteralPath $root -ErrorAction Stop) {
      $properties = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction Stop
      if ($properties.DisplayName -ceq '${prototypeProductName}' -or $entry.PSChildName -ceq '${prototypeAppId}') {
        $found += $entry
      }
    }
  }
  return @($found)
}
try {
  $matches = @(Find-PrototypeUninstallEntries)
  if ('${action}' -ceq 'cleanup') {
    foreach ($match in $matches) {
      Remove-Item -LiteralPath $match.PSPath -Recurse -Force -ErrorAction Stop
    }
    $matches = @(Find-PrototypeUninstallEntries)
  }
  if ($matches.Count -eq 0) {
    [Console]::Out.Write('clear')
  } else {
    [Console]::Out.Write('present')
  }
} catch {
  [Console]::Out.Write('error')
}
`;
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000
  });
  if (!inspectSpawnOutcome(result).ok || typeof result.stdout !== "string") {
    return "error";
  }
  return parseRegistryProbeStatus(result.stdout) ?? "error";
}

function createShortcutSnapshot() {
  const backupRoot = join(taskRoot, "shortcut-backups");
  mkdirSync(backupRoot, { recursive: true });
  const folders = [
    ["desktop", "DesktopDirectory"],
    ["startMenu", "Programs"],
    ["commonDesktop", "CommonDesktopDirectory"],
    ["commonStartMenu", "CommonPrograms"]
  ].map(([kind, name]) => ({ kind, folder: readWindowsSpecialFolder(name) }));
  if (folders.some((entry) => !entry.folder)) {
    return { ok: false, entries: [] };
  }

  const seen = new Set();
  const entries = [];
  for (const entry of folders) {
    const shortcutPath = join(entry.folder, shortcutName);
    const key = shortcutPath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const existedBefore = existsSync(shortcutPath);
    const backupPath = existedBefore
      ? join(backupRoot, `${entry.kind}.lnk`)
      : null;
    if (backupPath) {
      try {
        copyFileSync(shortcutPath, backupPath);
      } catch {
        return { ok: false, entries: [] };
      }
    }
    entries.push({
      kind: entry.kind,
      shortcutPath,
      existedBefore,
      backupPath,
      afterInstall: undefined,
      afterUninstall: undefined
    });
  }
  return { ok: true, entries };
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
    windowsHide: true,
    timeout: 10_000
  });
  const outcome = inspectSpawnOutcome(result);
  const value = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return outcome.ok && value.length > 0 ? value : null;
}

function recordShortcutState(shortcutSnapshot, key) {
  for (const entry of shortcutSnapshot) {
    entry[key] = existsSync(entry.shortcutPath);
  }
}

function removeInstalledRoot(installedRoot) {
  try {
    safeRemove(installedRoot, taskRoot);
    return !existsSync(installedRoot);
  } catch {
    return false;
  }
}

async function waitForPathRemoval(path, timeoutMs) {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    if (!existsSync(path)) {
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return !existsSync(path);
}

function writePrototypeBuilderConfig() {
  const formalConfigPath = join(projectRoot, "electron-builder.config.cjs");
  if (
    !existsSync(formalConfigPath) ||
    !existsSync(builderCliPath) ||
    !existsSync(localLlmSourceRoot)
  ) {
    return false;
  }

  const configSource = `
const base = require(${JSON.stringify(formalConfigPath)});
const localLlmSourceRoot = ${JSON.stringify(localLlmSourceRoot)};
const packageOutputRoot = ${JSON.stringify(packageOutputRoot)};
const baseExtraResources = Array.isArray(base.extraResources) ? base.extraResources : [];
const extraResources = baseExtraResources.map((entry) => (
  entry && entry.to === "local-llm"
    ? { ...entry, from: localLlmSourceRoot }
    : entry
));
if (!extraResources.some((entry) => entry && entry.to === "local-llm")) {
  extraResources.push({ from: localLlmSourceRoot, to: "local-llm" });
}

module.exports = {
  ...base,
  appId: ${JSON.stringify(prototypeAppId)},
  productName: ${JSON.stringify(prototypeProductName)},
  directories: {
    ...(base.directories || {}),
    output: packageOutputRoot
  },
  extraResources,
  nsis: {
    ...(base.nsis || {}),
    shortcutName: ${JSON.stringify(prototypeShortcutName)}
  }
};
`;
  try {
    writeFileSync(builderConfigPath, configSource, "utf8");
    return existsSync(builderConfigPath);
  } catch {
    return false;
  }
}

function runElectronBuilder(target, timeout) {
  return spawnSync(process.execPath, [
    builderCliPath,
    "--win",
    target,
    "--config",
    builderConfigPath,
    "--publish",
    "never"
  ], {
    cwd: projectRoot,
    windowsHide: true,
    timeout,
    stdio: "ignore"
  });
}

function writeDisabledSettings(userDataPath, runtime) {
  const configRoot = join(userDataPath, "config");
  mkdirSync(configRoot, { recursive: true });
  const record = runtime.createSettingsRecord(
    { musicEnabled: false, gameEnabled: true },
    { musicEnabled: true, gameEnabled: false }
  );
  writeFileSync(
    join(configRoot, "environment-action-settings.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

function createErrorExecution(target, runtime, failureCode) {
  return {
    ok: false,
    result: writeClosedResult(runtime, target, {
      capability: "unknown",
      status: "unknown",
      health: "error",
      failureCode
    })
  };
}

function writeClosedResult(runtime, target, values) {
  const result = runtime.createResult(target, values);
  runtime.writeResult(projectRoot, result);
  return result;
}

function publishExecution(execution) {
  process.stdout.write(`${JSON.stringify(execution.result)}\n`);
  if (!execution.ok) {
    process.exitCode = 1;
  }
}

function runNpmScript(scriptName, timeout) {
  const npmArgs = ["run", scriptName];
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return spawnSync(process.execPath, [npmExecPath, ...npmArgs], {
      cwd: projectRoot,
      windowsHide: true,
      timeout,
      stdio: "ignore"
    });
  }
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, {
    cwd: projectRoot,
    windowsHide: true,
    timeout,
    stdio: "ignore"
  });
}

function prepareFreshRunRoots() {
  removeTaskOwnedRoot();
  mkdirSync(taskRoot, { recursive: true });
}

function removeTaskOwnedRoot() {
  safeRemove(taskRoot, join(projectRoot, ".tmp"));
}

function resetTaskDirectory(directoryPath) {
  safeRemove(directoryPath, taskRoot);
  mkdirSync(directoryPath, { recursive: true });
}

function safeRemove(candidate, allowedRoot) {
  assertContained(allowedRoot, candidate);
  rmSync(candidate, { recursive: true, force: true });
}

function assertContained(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Path is outside the allowed acceptance root");
  }
}

function isFreshFile(path, runStartedAtMs) {
  return existsSync(path) && isArtifactFresh(statSync(path), runStartedAtMs);
}

function writeBootstrapFailures(selectedTargets) {
  mkdirSync(taskRoot, { recursive: true });
  for (const target of selectedTargets) {
    const result = {
      target,
      capability: "unknown",
      status: "unknown",
      health: "error",
      failureCode: "host-failed"
    };
    writeFileSync(join(taskRoot, `${target}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}
