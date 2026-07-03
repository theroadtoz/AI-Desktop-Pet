import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditElectronChromiumNoticesPackagedArtifact } from "./p2-20w-electron-chromium-notices-packaged-artifact-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-20w-tests");
const scriptPath = join(repoRoot, "scripts", "p2-20w-electron-chromium-notices-packaged-artifact-audit.mjs");

test("default missing packaged artifact stays blocked and safe", () => {
  const fixtureRepo = join(testRoot, "missing-artifact-repo");
  const result = auditElectronChromiumNoticesPackagedArtifact({
    repoRoot: fixtureRepo,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig()
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20W");
  assert.equal(result.audit, "electron_chromium_notices_packaged_artifact");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.exitPolicy, "always_zero");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.packagedArtifactStatus, "missing");
  assert.equal(result.packagedArtifact.rootBasename, "win-unpacked");
  assert.equal(result.packagedArtifact.relativeRole, ".tmp/p2-20j-package-output/win-unpacked");
  assert.match(blockers, /packaged_app_artifact_missing/);
  assert.match(blockers, /electron_upstream_notices_evidence_missing/);
  assert.match(blockers, /production_release_not_approved/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(fixtureRepo)));
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
});

test("complete packaged artifact shape adds ready checks but stays production blocked", () => {
  const artifactRoot = join(testRoot, "complete-shape", "AI Desktop Pet-win32-x64");
  createCompletePackagedArtifact(artifactRoot);

  const result = auditElectronChromiumNoticesPackagedArtifact({
    repoRoot,
    packagedAppRoot: artifactRoot,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig()
  });
  const readyChecks = result.readyChecks.join(",");
  const blockers = result.blockers.join(",");
  const requiredStatuses = result.packagedArtifact.requiredEvidence.map((entry: any) => entry.status);

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.packagedArtifactStatus, "present");
  assert.equal(result.packagedArtifact.rootBasename, "AI Desktop Pet-win32-x64");
  assert.equal(result.packagedArtifact.rootRole, "caller_supplied_packaged_app_root");
  assert.equal(requiredStatuses.every((status: string) => status === "present"), true);
  assert.equal(
    result.packagedArtifact.requiredEvidence.find((entry: any) => entry.role === "electron_license_file").relativeRole,
    "LICENSE.electron.txt"
  );
  assert.match(readyChecks, /electron_upstream_notices_shape_ready/);
  assert.match(readyChecks, /electron_license_file_present/);
  assert.match(readyChecks, /chromium_licenses_file_present/);
  assert.match(readyChecks, /ffmpeg_runtime_file_present/);
  assert.match(readyChecks, /packaged_app_asar_present/);
  assert.doesNotMatch(blockers, /packaged_app_artifact_missing/);
  assert.match(blockers, /legal_review_not_approved/);
  assert.match(blockers, /third_party_notices_not_approved/);
  assert.match(blockers, /electron_chromium_notices_not_approved/);
  assert.match(blockers, /final_third_party_notices_missing/);
  assert.match(blockers, /production_release_not_approved/);
});

test("missing critical packaged files add focused blockers", () => {
  const artifactRoot = join(testRoot, "missing-critical", "win-unpacked");
  createCompletePackagedArtifact(artifactRoot);
  rmSync(join(artifactRoot, "LICENSES.chromium.html"), { force: true });
  rmSync(join(artifactRoot, "ffmpeg.dll"), { force: true });
  rmSync(join(artifactRoot, "resources", "app.asar"), { force: true });

  const result = auditElectronChromiumNoticesPackagedArtifact({
    repoRoot,
    packagedAppRoot: artifactRoot,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig()
  });
  const blockers = result.blockers.join(",");
  const missingRoles = result.packagedArtifact.requiredEvidence
    .filter((entry: any) => entry.status === "missing")
    .map((entry: any) => entry.role)
    .sort();

  assert.equal(result.packagedArtifactStatus, "present");
  assert.match(blockers, /chromium_licenses_file_missing/);
  assert.match(blockers, /ffmpeg_runtime_file_missing/);
  assert.match(blockers, /packaged_app_asar_missing/);
  assert.deepEqual(missingRoles, [
    "chromium_licenses_file",
    "ffmpeg_runtime_file",
    "packaged_app_asar"
  ]);
});

test("safe summary does not leak local absolute paths through options or CLI", () => {
  const artifactRoot = join(testRoot, "safe-output", "win-unpacked");
  createCompletePackagedArtifact(artifactRoot);

  const result = auditElectronChromiumNoticesPackagedArtifact({
    repoRoot,
    packagedAppRoot: artifactRoot,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig()
  });
  const directOutput = JSON.stringify(result);
  const cli = spawnSync(process.execPath, [scriptPath, "--packaged-app-root", artifactRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });
  const cliOutput = cli.stdout;
  const cliResult = JSON.parse(cliOutput);

  assert.equal(cli.status, 0);
  assert.equal(cliResult.ok, false);
  assert.equal(cliResult.status, "blocked");
  assert.equal(cliResult.exitPolicy, "always_zero");
  assert.equal(cliResult.packagedArtifact.rootBasename, "win-unpacked");

  for (const output of [directOutput, cliOutput]) {
    assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
    assert.doesNotMatch(output, new RegExp(escapeRegExp(testRoot)));
    assert.doesNotMatch(output, /[A-Za-z]:\\/);
  }
});

test("builder config summary captures output, resources, targets, and absent hooks", () => {
  const artifactRoot = join(testRoot, "builder-config", "win-unpacked");
  createCompletePackagedArtifact(artifactRoot);

  const result = auditElectronChromiumNoticesPackagedArtifact({
    repoRoot,
    packagedAppRoot: artifactRoot,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig()
  });
  const readyChecks = result.readyChecks.join(",");

  assert.equal(result.electronBuilderConfig.directoriesOutput.basename, "p2-20j-package-output");
  assert.deepEqual(result.electronBuilderConfig.winTargets.values, ["dir", "nsis", "portable"]);
  assert.equal(result.electronBuilderConfig.extraResources.localLlm, "configured");
  assert.equal(result.electronBuilderConfig.hooks.electronDist, "absent");
  assert.equal(result.electronBuilderConfig.hooks.afterExtract, "absent");
  assert.equal(result.electronBuilderConfig.hooks.afterPack, "absent");
  assert.match(readyChecks, /electron_builder_win_dir_target_configured/);
  assert.match(readyChecks, /electron_builder_after_pack_hook_absent/);
});

test("package scripts expose packaged artifact audit and include focused test in history", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["audit:electron-chromium-notices-packaged-artifact"],
    "node scripts/p2-20w-electron-chromium-notices-packaged-artifact-audit.mjs"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/production-electron-chromium-notices-packaged-artifact-audit\.test\.mts/
  );
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createCompletePackagedArtifact(root: string) {
  mkdirSync(join(root, "resources", "local-llm"), { recursive: true });
  mkdirSync(join(root, "resources", "icons"), { recursive: true });
  mkdirSync(join(root, "locales"), { recursive: true });
  writeFileSync(join(root, "LICENSE.electron.txt"), "Electron MIT license fixture\n", "utf8");
  writeFileSync(join(root, "LICENSES.chromium.html"), "<html>Chromium notices fixture</html>\n", "utf8");
  writeFileSync(join(root, "ffmpeg.dll"), "ffmpeg fixture\n", "utf8");
  writeFileSync(join(root, "version"), "42.4.0\n", "utf8");
  writeFileSync(join(root, "AI Desktop Pet.exe"), "exe fixture\n", "utf8");
  writeFileSync(join(root, "resources", "app.asar"), "asar fixture\n", "utf8");
  writeFileSync(join(root, "resources", "local-llm", "manifest.json"), "{}\n", "utf8");
  writeFileSync(join(root, "resources", "icons", "app-icon-256.png"), "png fixture\n", "utf8");
  writeFileSync(join(root, "resources.pak"), "pak fixture\n", "utf8");
  writeFileSync(join(root, "locales", "en-US.pak"), "locale fixture\n", "utf8");
}

function readyPackageJson() {
  return {
    name: "ai-desktop-pet",
    version: "0.0.0",
    private: true,
    license: "UNLICENSED",
    dependencies: {
      pangu: "^7.2.1"
    },
    devDependencies: {
      electron: "42.4.0",
      "electron-builder": "^26.15.3",
      typescript: "^5.9.3",
      vite: "^8.0.16"
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
