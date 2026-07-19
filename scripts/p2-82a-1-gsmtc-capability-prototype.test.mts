import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createGsmtcCapabilityPrototypeResult,
  parseGsmtcCapabilityPrototypeResult,
  resolveGsmtcCapabilityPrototypeOutputPath,
  runGsmtcCapabilityPrototype,
  type GsmtcCapabilityPrototypeCommandRunner
} from "../src/main/services/desktop-context/gsmtc-capability-prototype.ts";

const VALID_RESULT = {
  target: "dev",
  capability: "available",
  status: "stopped",
  health: "ready",
  failureCode: "none"
} as const;

test("prototype parser accepts exactly the five closed contract keys", () => {
  assert.deepEqual(
    parseGsmtcCapabilityPrototypeResult(JSON.stringify(VALID_RESULT)),
    VALID_RESULT
  );

  for (const value of [
    "not-json",
    `${JSON.stringify(VALID_RESULT)}\nfree text`,
    JSON.stringify({ ...VALID_RESULT, title: "private" }),
    JSON.stringify({ ...VALID_RESULT, sourceApp: "private" }),
    JSON.stringify({ ...VALID_RESULT, registryStatus: "clear" }),
    JSON.stringify({ ...VALID_RESULT, target: "portable" }),
    JSON.stringify({ ...VALID_RESULT, status: "unavailable" }),
    JSON.stringify({ ...VALID_RESULT, health: "error", failureCode: "settings-disabled" }),
    JSON.stringify({ ...VALID_RESULT, health: "error", failureCode: "target-not-run" }),
    JSON.stringify({
      target: "dev",
      capability: "available",
      status: "stopped",
      health: "ready"
    })
  ]) {
    assert.equal(parseGsmtcCapabilityPrototypeResult(value), null);
  }
});

test("disabled music returns a closed stopped result without invoking the command runner", async () => {
  let executeCount = 0;
  let disposeCount = 0;
  const commandRunner: GsmtcCapabilityPrototypeCommandRunner = {
    async execute() {
      executeCount += 1;
      return JSON.stringify(VALID_RESULT);
    },
    cancel() {},
    dispose() {
      disposeCount += 1;
    }
  };

  assert.deepEqual(await runGsmtcCapabilityPrototype({
    target: "dev",
    musicEnabled: false,
    platform: "win32",
    commandRunner
  }), createGsmtcCapabilityPrototypeResult("dev", {
    capability: "unknown",
    status: "unknown",
    health: "stopped",
    failureCode: "settings-disabled"
  }));
  assert.equal(executeCount, 0);
  assert.equal(disposeCount, 1);
});

test("enabled prototype invokes one probe and rejects mismatched or malformed output", async () => {
  let executeCount = 0;
  const commandRunner: GsmtcCapabilityPrototypeCommandRunner = {
    async execute() {
      executeCount += 1;
      return JSON.stringify(VALID_RESULT);
    },
    cancel() {},
    dispose() {}
  };
  assert.deepEqual(await runGsmtcCapabilityPrototype({
    target: "dev",
    musicEnabled: true,
    platform: "win32",
    commandRunner
  }), VALID_RESULT);
  assert.equal(executeCount, 1);

  const mismatchedRunner: GsmtcCapabilityPrototypeCommandRunner = {
    async execute() {
      return JSON.stringify({ ...VALID_RESULT, target: "installer" });
    },
    cancel() {},
    dispose() {}
  };
  assert.deepEqual(await runGsmtcCapabilityPrototype({
    target: "win-unpacked",
    musicEnabled: true,
    platform: "win32",
    commandRunner: mismatchedRunner
  }), createGsmtcCapabilityPrototypeResult("win-unpacked", {
    capability: "unknown",
    status: "unknown",
    health: "error",
    failureCode: "invalid-output"
  }));
});

test("unsupported platforms and targets that cannot run remain honest", async () => {
  assert.deepEqual(await runGsmtcCapabilityPrototype({
    target: "installer",
    musicEnabled: true,
    platform: "linux"
  }), createGsmtcCapabilityPrototypeResult("installer", {
    capability: "unavailable",
    status: "unknown",
    health: "error",
    failureCode: "unsupported-platform"
  }));

  assert.deepEqual(createGsmtcCapabilityPrototypeResult("win-unpacked", {
    capability: "unknown",
    status: "unknown",
    health: "not-run",
    failureCode: "target-not-run"
  }), {
    target: "win-unpacked",
    capability: "unknown",
    status: "unknown",
    health: "not-run",
    failureCode: "target-not-run"
  });
});

test("prototype output is constrained to the task-specific .tmp directory", () => {
  const projectRoot = resolve("E:/Work-26/AI_Desktop_Pet");
  assert.equal(
    resolveGsmtcCapabilityPrototypeOutputPath(projectRoot, "installer"),
    join(projectRoot, ".tmp", "p2-82a-1-gsmtc-capability", "installer.json")
  );
  assert.throws(() => resolveGsmtcCapabilityPrototypeOutputPath(
    projectRoot,
    "../outside" as never
  ));
});

test("prototype source does not cross declassification boundaries", () => {
  const source = readFileSync(
    "src/main/services/desktop-context/gsmtc-capability-prototype.ts",
    "utf8"
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(ipc|preload|renderer|telemetry|chat|search|action|automatic-situation)/i);
  assert.doesNotMatch(source, /ipcMain|BrowserWindow|webContents/);
  assert.doesNotMatch(source, /TryGetMediaPropertiesAsync|Title|Artist|Thumbnail|SourceAppUserModelId|TimelineProperties/);
  assert.match(source, /-NoProfile/);
  assert.match(source, /-NonInteractive/);
  assert.match(source, /windowsHide:\s*true/);
});

test("app acceptance branch short-circuits before normal initialization and window creation", () => {
  const source = readFileSync("src/main/app.ts", "utf8");
  const branchIndex = source.indexOf('process.env.P2_82A_1_GSMTC_PROTOTYPE === "1"');
  const normalInitializationIndex = source.indexOf("telemetry = createTelemetryService()", branchIndex);
  const firstWindowIndex = source.indexOf('ensurePetWindow("startup")', branchIndex);
  assert.ok(branchIndex > 0);
  assert.ok(normalInitializationIndex > branchIndex);
  assert.ok(firstWindowIndex > normalInitializationIndex);
  assert.match(source.slice(branchIndex, normalInitializationIndex), /app\.exit\(/);
  assert.match(source.slice(branchIndex, normalInitializationIndex), /createEnvironmentActionSettingsStore/);
  assert.match(source.slice(branchIndex, normalInitializationIndex), /app\.getPath\("userData"\)/);
  assert.doesNotMatch(source, /P2_82A_1_PROJECT_ROOT|P2_82A_1_MUSIC_ENABLED/);
  assert.doesNotMatch(source.slice(0, branchIndex), /gsmtc-capability-prototype/);
});

test("packaged runner uses canonical parser, fixed installer root, and isolated user data", async () => {
  const runnerSource = readFileSync(
    "scripts/p2-82a-1-gsmtc-packaged-capability-prototype.mjs",
    "utf8"
  );
  assert.doesNotMatch(
    runnerSource,
    /function\s+parseResult|P2_82A_1_INSTALLER_APP_EXE|fresh-installer/
  );
  assert.match(runnerSource, /dist["'],\s*["']main["'],\s*["']services["'],\s*["']desktop-context/);
  assert.match(runnerSource, /parseGsmtcCapabilityPrototypeResult/);
  assert.match(runnerSource, /--user-data-dir=/);
  assert.match(runnerSource, /com\.ai-desktop-pet\.p282a1-prototype/);
  assert.match(runnerSource, /AI Desktop Pet P2-82A-1 Prototype/);
  assert.match(runnerSource, /const targets = \["dev", "win-unpacked", "installer"\]/);
  assert.match(runnerSource, /validate:local-llm/);
  assert.match(runnerSource, /resources["'],\s*["']local-llm/);
  assert.match(runnerSource, /module\.exports = \{[\s\S]*\.\.\.base,[\s\S]*extraResources/);
  assert.match(runnerSource, /baseExtraResources\.map/);
  assert.match(runnerSource, /entry\.to === ["']local-llm["']/);
  assert.doesNotMatch(runnerSource, /\n\s*extraFiles\s*:/);
  assert.match(runnerSource, /runElectronBuilder\(["']dir["']/);
  assert.match(runnerSource, /runElectronBuilder\(["']nsis["']/);
  assert.match(runnerSource, /findUninstaller/);
  assert.match(runnerSource, /\/currentuser["'],\s*["']\/S/);
  assert.match(runnerSource, /waitForPathRemoval/);
  assert.match(runnerSource, /DesktopDirectory|CommonDesktopDirectory|CommonPrograms|Programs/);
  assert.doesNotMatch(runnerSource, /findUninstaller\([^)]*installStartedAtMs/);
  assert.match(runnerSource, /HKCU:[^\n]*CurrentVersion\\Uninstall/);
  assert.match(runnerSource, /HKLM:[^\n]*CurrentVersion\\Uninstall/);
  assert.match(runnerSource, /DisplayName/);
  assert.match(runnerSource, /properties\.DisplayName -ceq/);
  assert.match(runnerSource, /PSChildName -ceq/);
  assert.match(runnerSource, /Remove-Item\s+-LiteralPath/);
  assert.match(
    runnerSource,
    /if \(!registryClearAfterUninstaller\) \{\s*runPrototypeRegistryAction\("cleanup"\)/
  );
  assert.doesNotMatch(
    runnerSource,
    /stage:electron-builder-local-llm|p2-20j|createNotRunExecution|shortcutName\s*=\s*["']AI Desktop Pet\.lnk["']/
  );
  assert.match(runnerSource, /writeBootstrapFailures\(selectedTargets\)/);
  const prepareIndex = runnerSource.indexOf("prepareFreshRunRoots();");
  const buildIndex = runnerSource.indexOf('runNpmScript("build",');
  const canonicalLoadIndex = runnerSource.indexOf("const runtime = await loadCanonicalRuntime");
  assert.ok(prepareIndex >= 0);
  assert.ok(buildIndex > prepareIndex);
  assert.ok(canonicalLoadIndex > buildIndex);
  assert.match(runnerSource, /packageOutputRoot\s*=\s*join\(taskRoot,\s*["']package-output["']\)/);
  const validateIndex = runnerSource.indexOf('runNpmScript("validate:local-llm",');
  const configIndex = runnerSource.indexOf("writePrototypeBuilderConfig()");
  assert.ok(validateIndex >= 0);
  assert.ok(configIndex > validateIndex);

  const runner = await import("./p2-82a-1-gsmtc-packaged-capability-prototype.mjs");
  const projectRoot = resolve("E:/Work-26/AI_Desktop_Pet");
  assert.equal(
    runner.resolveInstallerExecutable(projectRoot),
    join(
      projectRoot,
      ".tmp",
      "p2-82a-1-gsmtc-capability",
      "installed",
      "app",
      "AI Desktop Pet P2-82A-1 Prototype.exe"
    )
  );
  assert.deepEqual(runner.inspectSpawnOutcome({ status: 0, signal: null }), { ok: true });
  assert.deepEqual(runner.inspectSpawnOutcome({ status: 2, signal: null }), {
    ok: false,
    failureCode: "host-failed"
  });
  assert.deepEqual(runner.inspectSpawnOutcome({ status: null, signal: "SIGTERM" }), {
    ok: false,
    failureCode: "host-failed"
  });
  assert.deepEqual(runner.inspectSpawnOutcome({
    status: null,
    signal: null,
    error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
  }), {
    ok: false,
    failureCode: "probe-timeout"
  });

  const staleReady = { ...VALID_RESULT };
  assert.deepEqual(
    runner.selectSpawnBoundResult(
      runner.inspectSpawnOutcome({ status: 2, signal: null }),
      staleReady
    ),
    {
      capability: "unknown",
      status: "unknown",
      health: "error",
      failureCode: "host-failed"
    }
  );
  assert.equal(runner.isArtifactFresh({ mtimeMs: 99 }, 100), false);
  assert.equal(runner.isArtifactFresh({ mtimeMs: 100 }, 100), true);
  assert.equal(runner.isArtifactFresh({ mtimeMs: 101 }, 100), true);
  assert.equal(runner.parseRegistryProbeStatus("clear"), "clear");
  assert.equal(runner.parseRegistryProbeStatus("present"), "present");
  assert.equal(runner.parseRegistryProbeStatus("error"), "error");
  assert.equal(runner.parseRegistryProbeStatus("clear\nprivate-path"), null);
  assert.equal(runner.isInstallerLifecyclePass({
    appProbeOk: true,
    uninstallOk: true,
    installDirectoryRemoved: true,
    registryClearAfterUninstaller: false,
    existingShortcutsRestored: true,
    shortcutCleanupOk: true,
    shortcutsRemoved: true,
    installedRootRemoved: true
  }), false);

  const oldUninstallerRoot = mkdtempSync(join(tmpdir(), "p2-82a-1-old-uninstaller-"));
  try {
    const oldUninstaller = join(
      oldUninstallerRoot,
      "Uninstall AI Desktop Pet P2-82A-1 Prototype.exe"
    );
    writeFileSync(oldUninstaller, "old", "utf8");
    utimesSync(oldUninstaller, new Date(0), new Date(0));
    assert.equal(runner.findUninstaller(oldUninstallerRoot), oldUninstaller);
  } finally {
    rmSync(oldUninstallerRoot, { recursive: true, force: true });
  }

  const shortcutRoot = mkdtempSync(join(tmpdir(), "p2-82a-1-shortcuts-"));
  try {
    const existingShortcut = join(shortcutRoot, "existing.lnk");
    const createdShortcut = join(shortcutRoot, "created.lnk");
    const existingBackup = join(shortcutRoot, "existing-backup.lnk");
    writeFileSync(existingShortcut, "existing", "utf8");
    writeFileSync(existingBackup, "existing", "utf8");
    writeFileSync(createdShortcut, "created", "utf8");
    writeFileSync(existingShortcut, "modified-by-installer", "utf8");
    const snapshot = [
      {
        shortcutPath: existingShortcut,
        existedBefore: true,
        backupPath: existingBackup,
        afterInstall: true
      },
      {
        shortcutPath: createdShortcut,
        existedBefore: false,
        afterInstall: true
      }
    ];
    assert.equal(runner.restoreExistingShortcuts(snapshot), true);
    const cleanup = runner.cleanupCreatedShortcuts(snapshot);
    assert.equal(cleanup, true);
    assert.equal(existsSync(existingShortcut), true);
    assert.equal(readFileSync(existingShortcut, "utf8"), "existing");
    assert.equal(existsSync(createdShortcut), false);
  } finally {
    rmSync(shortcutRoot, { recursive: true, force: true });
  }
});
