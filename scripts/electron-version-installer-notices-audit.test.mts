import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditElectronVersionInstallerNotices } from "./p2-20x-electron-version-installer-notices-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const testRoot = join(repoRoot, ".tmp", "p2-20x-tests");
const scriptPath = join(repoRoot, "scripts", "p2-20x-electron-version-installer-notices-audit.mjs");

test("missing installed app stays blocked and safe", () => {
  const fixtureRepo = join(testRoot, "missing-installed-repo");
  const versionFile = createElectronDistVersionFile(fixtureRepo, "42.4.0");
  const result = auditElectronVersionInstallerNotices({
    repoRoot: fixtureRepo,
    packageJson: readyPackageJson("42.4.0"),
    packageLock: readyPackageLock("42.4.0"),
    builderConfig: readyBuilderConfig(),
    electronDistVersionFile: versionFile
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20X");
  assert.equal(result.audit, "electron_version_installer_notices");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.installedAppStatus, "missing");
  assert.match(blockers, /installed_app_root_missing/);
  assert.match(blockers, /production_release_not_approved/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(fixtureRepo)));
  assert.doesNotMatch(output, /[A-Za-z]:\\/);
});

test("installed notices shape uses source version evidence when installed version file is missing", () => {
  const fixtureRepo = join(testRoot, "source-version-repo");
  const installedRoot = join(testRoot, "installed-no-version", "app");
  const versionFile = createElectronDistVersionFile(fixtureRepo, "42.4.0");
  createInstalledAppShape(installedRoot, { includeVersionFile: false });

  const result = auditElectronVersionInstallerNotices({
    repoRoot: fixtureRepo,
    installedAppRoot: installedRoot,
    packageJson: readyPackageJson("42.4.0"),
    packageLock: readyPackageLock("42.4.0"),
    builderConfig: readyBuilderConfig(),
    electronDistVersionFile: versionFile
  });
  const readyChecks = result.readyChecks.join(",");
  const blockers = result.blockers.join(",");
  const warnings = result.warnings.join(",");

  assert.equal(result.installedAppStatus, "present");
  assert.equal(result.checks.installed_app.missingRequiredFileCount, 1);
  assert.equal(result.checks.installed_app.missingRequiredWithoutVersionCount, 0);
  assert.match(readyChecks, /installed_notices_shape_ready/);
  assert.match(readyChecks, /electron_version_source_evidence_present/);
  assert.match(readyChecks, /electron_builder_extra_files_electron_version_configured/);
  assert.doesNotMatch(blockers, /electron_version_file_missing/);
  assert.match(blockers, /production_release_not_approved/);
  assert.match(warnings, /installed_electron_version_file_missing_using_source_evidence/);
  assert.equal(result.electronVersionEvidence.distVersion, "42.4.0");
});

test("installed version file is accepted when it matches source evidence", () => {
  const fixtureRepo = join(testRoot, "installed-version-repo");
  const installedRoot = join(testRoot, "installed-with-version", "app");
  const versionFile = createElectronDistVersionFile(fixtureRepo, "42.4.0");
  createInstalledAppShape(installedRoot, { includeVersionFile: true, version: "42.4.0" });

  const result = auditElectronVersionInstallerNotices({
    repoRoot: fixtureRepo,
    installedAppRoot: installedRoot,
    packageJson: readyPackageJson("42.4.0"),
    packageLock: readyPackageLock("42.4.0"),
    builderConfig: readyBuilderConfig(),
    electronDistVersionFile: versionFile
  });
  const readyChecks = result.readyChecks.join(",");

  assert.match(readyChecks, /installed_electron_version_file_present/);
  assert.equal(result.checks.electron_version_evidence.installedVersion, "42.4.0");
  assert.equal(result.checks.installed_app.missingRequiredFileCount, 0);
});

test("missing source version evidence keeps electron version blocker", () => {
  const installedRoot = join(testRoot, "installed-no-source-version", "app");
  createInstalledAppShape(installedRoot, { includeVersionFile: false });

  const result = auditElectronVersionInstallerNotices({
    repoRoot,
    installedAppRoot: installedRoot,
    packageJson: readyPackageJson("42.4.0"),
    packageLock: readyPackageLock("42.4.0"),
    builderConfig: readyBuilderConfig(),
    electronDistVersionFile: join(testRoot, "missing-version-file")
  });
  const blockers = result.blockers.join(",");

  assert.match(blockers, /electron_version_dist_file_missing/);
  assert.match(blockers, /electron_version_source_evidence_missing/);
  assert.match(blockers, /electron_version_file_missing/);
  assert.equal(result.checks.electron_version_evidence.sourceEvidenceStatus, "blocked");
});

test("safe CLI output does not leak local absolute paths", () => {
  const fixtureRepo = join(testRoot, "cli-safe-repo");
  const installedRoot = join(testRoot, "cli-safe-installed", "app");
  const versionFile = createElectronDistVersionFile(fixtureRepo, "42.4.0");
  createInstalledAppShape(installedRoot, { includeVersionFile: false });

  const cli = spawnSync(process.execPath, [
    scriptPath,
    "--installed-app-root",
    installedRoot
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined
    },
    encoding: "utf8",
    windowsHide: true
  });
  const cliOutput = cli.stdout;
  const cliResult = JSON.parse(cliOutput);

  assert.equal(cli.status, 0);
  assert.equal(cliResult.ok, false);
  assert.equal(cliResult.status, "blocked");
  assert.equal(cliResult.exitPolicy, "always_zero");
  assert.equal(cliResult.installedApp.rootBasename, "app");

  assert.doesNotMatch(cliOutput, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(cliOutput, new RegExp(escapeRegExp(testRoot)));
  assert.doesNotMatch(cliOutput, new RegExp(escapeRegExp(fixtureRepo)));
  assert.doesNotMatch(cliOutput, new RegExp(escapeRegExp(versionFile)));
  assert.doesNotMatch(cliOutput, /[A-Za-z]:\\/);
});

test("package scripts expose P2-20X audit, acceptance, and focused test", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const builderConfig = require(resolve(repoRoot, "electron-builder.config.cjs"));
  const extraFiles = JSON.stringify(builderConfig.extraFiles);

  assert.equal(
    packageJson.scripts["audit:electron-version-installer-notices"],
    "node scripts/p2-20x-electron-version-installer-notices-audit.mjs"
  );
  assert.equal(
    packageJson.scripts["accept:p2-20x-electron-version-installer-notices"],
    "node scripts/p2-20x-electron-version-installer-notices-acceptance.mjs"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/electron-version-installer-notices-audit\.test\.mts/
  );
  assert.match(extraFiles, /node_modules\/electron\/dist\/version/);
  assert.match(extraFiles, /LICENSE\.electron\.txt/);
  assert.match(extraFiles, /LICENSES\.chromium\.html/);
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createInstalledAppShape(root: string, options: { includeVersionFile: boolean; version?: string }) {
  mkdirSync(join(root, "resources", "local-llm"), { recursive: true });
  mkdirSync(join(root, "resources", "icons"), { recursive: true });
  writeFileSync(join(root, "LICENSE.electron.txt"), "Electron MIT license fixture\n", "utf8");
  writeFileSync(join(root, "LICENSES.chromium.html"), "<html>Chromium notices fixture</html>\n", "utf8");
  writeFileSync(join(root, "ffmpeg.dll"), "ffmpeg fixture\n", "utf8");
  writeFileSync(join(root, "AI Desktop Pet.exe"), "exe fixture\n", "utf8");
  writeFileSync(join(root, "resources", "app.asar"), "asar fixture\n", "utf8");
  writeFileSync(join(root, "resources", "local-llm", "manifest.json"), "{}\n", "utf8");
  writeFileSync(join(root, "resources", "icons", "app-icon-256.png"), "png fixture\n", "utf8");

  if (options.includeVersionFile) {
    writeFileSync(join(root, "version"), `${options.version ?? "42.4.0"}\n`, "utf8");
  }
}

function createElectronDistVersionFile(root: string, version: string) {
  const file = join(root, "node_modules", "electron", "dist", "version");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${version}\n`, "utf8");
  return file;
}

function readyPackageJson(electronVersion: string) {
  return {
    name: "ai-desktop-pet",
    version: "0.0.0",
    private: true,
    license: "UNLICENSED",
    devDependencies: {
      electron: electronVersion,
      "electron-builder": "^26.15.3",
      typescript: "^5.9.3",
      vite: "^8.0.16"
    },
    dependencies: {
      pangu: "^7.2.1"
    }
  };
}

function readyPackageLock(electronVersion: string) {
  return {
    packages: {
      "node_modules/electron": {
        version: electronVersion,
        license: "MIT"
      }
    }
  };
}

function readyBuilderConfig() {
  return {
    productName: "AI Desktop Pet",
    directories: {
      output: ".tmp/p2-20j-package-output"
    },
    files: [
      "dist/**/*",
      "package.json",
      "node_modules/pangu/**/*"
    ],
    extraResources: [
      {
        from: ".tmp/p2-20j-extra-resources/local-llm",
        to: "local-llm"
      },
      {
        from: "resources/icons/app-icon-256.png",
        to: "icons/app-icon-256.png"
      }
    ],
    extraFiles: [
      {
        from: "node_modules/electron/dist/version",
        to: "version"
      },
      {
        from: "node_modules/electron/dist/LICENSE",
        to: "LICENSE.electron.txt"
      },
      {
        from: "node_modules/electron/dist/LICENSES.chromium.html",
        to: "LICENSES.chromium.html"
      }
    ],
    win: {
      target: [
        {
          target: "dir",
          arch: ["x64"]
        },
        {
          target: "portable",
          arch: ["x64"]
        },
        {
          target: "nsis",
          arch: ["x64"]
        }
      ]
    }
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
