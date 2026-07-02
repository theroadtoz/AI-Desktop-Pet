import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const builderConfig = require("../electron-builder.config.cjs");
const {
  resolveBundledLlamaCppRuntime
} = require("../dist/main/services/local-runtime/bundled-llama-cpp-runtime.js") as typeof import("../src/main/services/local-runtime/bundled-llama-cpp-runtime");

const repoRoot = join(import.meta.dirname, "..");
const fullPathMarker = "DO_NOT_LEAK_P2_20J_ROOT";
const stageScript = join(repoRoot, "scripts", "p2-20j-stage-electron-builder-extra-resources.mjs");
const packageJsonPath = join(repoRoot, "package.json");

test("electron-builder config copies P2-20J staged local-llm as Windows dir extraResources", () => {
  assert.equal(builderConfig.directories.output, ".tmp/p2-20j-package-output");
  assert.deepEqual(builderConfig.win.target, [
    {
      target: "dir",
      arch: ["x64"]
    }
  ]);
  assert.equal(builderConfig.extraResources.length, 1);
  assert.equal(builderConfig.extraResources[0].from, ".tmp/p2-20j-extra-resources/local-llm");
  assert.equal(builderConfig.extraResources[0].to, "local-llm");
  assert.notEqual(builderConfig.extraResources[0].from, "resources/local-llm");
  assert.notEqual(builderConfig.extraResources[0].from, "resources\\local-llm");
  assert.equal(builderConfig.extraResources[0].from.startsWith("resources/"), false);
  assert.equal(builderConfig.extraResources[0].from.startsWith("resources\\"), false);
});

test("electron-builder staging validates fake pack, copies resources, and prints safe summary", () => {
  const fixture = createResourcePackFixture({ includeIntegrity: true });

  try {
    cleanupP2_20JTmp();
    const result = runStage(fixture.root);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"status": "ready"/);
    assert.match(result.stdout, /"sourceKind": "localSourceEnv"/);
    assert.match(result.stdout, /"destinationRootName": "p2-20j-extra-resources"/);
    assert.match(result.stdout, /"fileCount": 5/);
    assert.match(result.stdout, /"sha256Status": "matched"/);
    assert.equal(result.stdout.includes(fixture.root), false);
    assert.equal(result.stdout.includes(fixture.executablePath), false);
    assert.equal(result.stdout.includes(fixture.modelPath), false);
    assert.equal(result.stdout.includes(fullPathMarker), false);
    assert.ok(readFileSync(join(stagedLocalLlmRoot(), "manifest.json"), "utf8"));
  } finally {
    cleanupP2_20JTmp();
    fixture.cleanup();
  }
});

test("electron-builder packaged resources locator feeds packaged resolver without env or cwd source", async () => {
  const stageModule = await import("./p2-20j-stage-electron-builder-extra-resources.mjs");
  const acceptanceModule = await import("./p2-20j-packaged-app-extra-resources-real-chat.mjs");
  const fixture = createResourcePackFixture();

  try {
    cleanupP2_20JTmp();
    const stage = runStage(fixture.root);

    assert.equal(stage.status, 0);

    const fakeResourcesPath = join(packageOutputRoot(), "win-unpacked", "resources");
    cpSync(stagedLocalLlmRoot(), join(fakeResourcesPath, "local-llm"), {
      recursive: true,
      force: true,
      errorOnExist: false
    });

    const locatedResourcesPath = acceptanceModule.findElectronBuilderPackagedResourcesPath(stageModule.getP2_20JPaths(repoRoot).packageOutputRoot);

    assert.equal(locatedResourcesPath, fakeResourcesPath);

    const result = resolveBundledLlamaCppRuntime({
      env: {},
      cwd: join(tmpdir(), fullPathMarker, "unrelated-cwd"),
      resourcesPath: locatedResourcesPath
    });
    const output = JSON.stringify(result.safeSummary);

    assert.ok(result.config);
    assert.equal(result.safeSummary.status, "ready");
    assert.equal(result.safeSummary.resourceSource, "packaged");
    assert.equal(output.includes(packageOutputRoot()), false);
    assert.equal(output.includes(fixture.root), false);
    assert.equal(output.includes(fullPathMarker), false);
  } finally {
    cleanupP2_20JTmp();
    fixture.cleanup();
  }
});

test("electron-builder P2-20J cleanup removes staging and package output unless keep flag is explicit", async () => {
  const stageModule = await import("./p2-20j-stage-electron-builder-extra-resources.mjs");
  const acceptanceModule = await import("./p2-20j-packaged-app-extra-resources-real-chat.mjs");
  const paths = stageModule.getP2_20JPaths(repoRoot);
  const stageMarker = join(paths.stagingRoot, "local-llm", "manifest.json");
  const packageMarker = join(paths.packageOutputRoot, "win-unpacked", "resources", "local-llm", "manifest.json");

  cleanupP2_20JTmp();
  mkdirSync(dirname(stageMarker), { recursive: true });
  mkdirSync(dirname(packageMarker), { recursive: true });
  writeFileSync(stageMarker, "{}\n", "utf8");
  writeFileSync(packageMarker, "{}\n", "utf8");
  assert.equal(acceptanceModule.cleanupP2_20JTmpOnCompletion(paths, {}).cleanupStatus, "removed");
  assert.equal(fileExists(stageMarker), false);
  assert.equal(fileExists(packageMarker), false);

  mkdirSync(dirname(stageMarker), { recursive: true });
  mkdirSync(dirname(packageMarker), { recursive: true });
  writeFileSync(stageMarker, "{}\n", "utf8");
  writeFileSync(packageMarker, "{}\n", "utf8");
  assert.equal(acceptanceModule.cleanupP2_20JTmpOnCompletion(paths, { P2_20J_KEEP_TMP: "1" }).cleanupStatus, "kept");
  assert.equal(fileExists(stageMarker), true);
  assert.equal(fileExists(packageMarker), true);
  cleanupP2_20JTmp();
});

test("package commands register P2-20J staging, Windows dir packaging, acceptance, and history test", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.equal(packageJson.scripts["stage:electron-builder-local-llm"], "node scripts/p2-20j-stage-electron-builder-extra-resources.mjs");
  assert.equal(packageJson.scripts["package:win:dir"], "npm run build && electron-builder --win dir --config electron-builder.config.cjs");
  assert.equal(packageJson.scripts["accept:electron-builder-local-llm"], "node scripts/p2-20j-packaged-app-extra-resources-real-chat.mjs");
  assert.match(packageJson.scripts["test:history"], /scripts\/electron-builder-local-llm-resources\.test\.mts/);
});

function runStage(root: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  return spawnSync(process.execPath, [stageScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: root
    },
    encoding: "utf8"
  });
}

function createResourcePackFixture(options: {
  root?: string;
  includeIntegrity?: boolean;
} = {}): {
  root: string;
  executablePath: string;
  modelPath: string;
  cleanup(): void;
} {
  const root = options.root ?? join(mkdtempSync(join(tmpdir(), `ai-pet-${fullPathMarker}-`)), "local-llm");
  const executablePath = join(root, "runtime", "win32-x64", "llama-server.exe");
  const dllPath = join(root, "runtime", "win32-x64", "llama.dll");
  const modelPath = join(root, "models", "model.gguf");
  const noticesPath = join(root, "licenses", "THIRD_PARTY_NOTICES.md");
  const executableContent = "fake exe";
  const modelContent = "fake model";
  mkdirSync(dirname(executablePath), { recursive: true });
  mkdirSync(dirname(modelPath), { recursive: true });
  mkdirSync(dirname(noticesPath), { recursive: true });
  writeFileSync(executablePath, executableContent, "utf8");
  writeFileSync(dllPath, "fake dll", "utf8");
  writeFileSync(modelPath, modelContent, "utf8");
  writeFileSync(noticesPath, "Third Party Notices\n", "utf8");
  writeManifest(root, {
    version: 1,
    runtime: "llama.cpp",
    platforms: {
      [`${process.platform}-${process.arch}`]: {
        executable: "runtime/win32-x64/llama-server.exe",
        ...(options.includeIntegrity
          ? {
              sizeBytes: Buffer.byteLength(executableContent),
              sha256: sha256(executableContent)
            }
          : {})
      }
    },
    model: {
      path: "models/model.gguf",
      alias: "pet-local",
      ctxSize: 1024,
      ...(options.includeIntegrity
        ? {
            sizeBytes: Buffer.byteLength(modelContent),
            sha256: sha256(modelContent)
          }
        : {})
    },
    licenseNotices: "licenses/THIRD_PARTY_NOTICES.md"
  });

  return {
    root,
    executablePath,
    modelPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function writeManifest(root: string, manifest: unknown): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stagedLocalLlmRoot(): string {
  return join(repoRoot, ".tmp", "p2-20j-extra-resources", "local-llm");
}

function packageOutputRoot(): string {
  return join(repoRoot, ".tmp", "p2-20j-package-output");
}

function cleanupP2_20JTmp(): void {
  rmSync(join(repoRoot, ".tmp", "p2-20j-extra-resources"), { recursive: true, force: true });
  rmSync(packageOutputRoot(), { recursive: true, force: true });
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
