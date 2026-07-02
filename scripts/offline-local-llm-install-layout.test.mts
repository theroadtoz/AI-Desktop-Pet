import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  resolveBundledLlamaCppRuntime
} = require("../dist/main/services/local-runtime/bundled-llama-cpp-runtime.js") as typeof import("../src/main/services/local-runtime/bundled-llama-cpp-runtime");

const repoRoot = join(import.meta.dirname, "..");
const fullPathMarker = "DO_NOT_LEAK_P2_20I_ROOT";
const stageScript = join(repoRoot, "scripts", "p2-20i-stage-offline-local-llm-install-layout.mjs");
const packageJsonPath = join(repoRoot, "package.json");

test("install-layout staging validates fake pack, copies resources, and prints safe summary", () => {
  const fixture = createResourcePackFixture({ includeIntegrity: true });

  try {
    cleanupInstallLayout();
    const result = runStage(fixture.root);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"status": "ready"/);
    assert.match(result.stdout, /"sourceKind": "localSourceEnv"/);
    assert.match(result.stdout, /"destinationRootName": "p2-20i-install-layout"/);
    assert.match(result.stdout, /"fileCount": 5/);
    assert.match(result.stdout, /"sha256Status": "matched"/);
    assert.equal(result.stdout.includes(fixture.root), false);
    assert.equal(result.stdout.includes(fixture.executablePath), false);
    assert.equal(result.stdout.includes(fixture.modelPath), false);
    assert.equal(result.stdout.includes(fullPathMarker), false);
    assert.ok(readFileSync(join(installLocalLlmRoot(), "manifest.json"), "utf8"));
  } finally {
    cleanupInstallLayout();
    fixture.cleanup();
  }
});

test("install-layout resolver reports packaged from staged resourcesPath", () => {
  const fixture = createResourcePackFixture();

  try {
    cleanupInstallLayout();
    const stage = runStage(fixture.root);

    assert.equal(stage.status, 0);

    const result = resolveBundledLlamaCppRuntime({
      env: {},
      cwd: join(tmpdir(), fullPathMarker, "unrelated-cwd"),
      resourcesPath: installResourcesPath()
    });
    const output = JSON.stringify(result.safeSummary);

    assert.ok(result.config);
    assert.equal(result.safeSummary.status, "ready");
    assert.equal(result.safeSummary.resourceSource, "packaged");
    assert.equal(output.includes(installRoot()), false);
    assert.equal(output.includes(fixture.root), false);
    assert.equal(output.includes(fullPathMarker), false);
  } finally {
    cleanupInstallLayout();
    fixture.cleanup();
  }
});

test("install-layout destination guard refuses paths outside repo .tmp", async () => {
  const stageModule = await import("./p2-20i-stage-offline-local-llm-install-layout.mjs");

  assert.throws(
    () => stageModule.assertSafeInstallLayoutRoot(join(tmpdir(), fullPathMarker, "outside"), repoRoot),
    /install_layout_destination_outside_repo_tmp/
  );
});

test("install-layout cleanup removes staging unless keep flag is explicit", async () => {
  const installModule = await import("./p2-20i-install-layout-embedded-runtime-real-chat.mjs");
  const cleanupRoot = join(repoRoot, ".tmp", "p2-20i-cleanup-test");
  const marker = join(cleanupRoot, "resources", "local-llm", "manifest.json");

  rmSync(cleanupRoot, { recursive: true, force: true });
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, "{}\n", "utf8");
  assert.equal(installModule.cleanupP2_20IStagingOnSuccess(cleanupRoot, {}).cleanupStatus, "removed");
  assert.equal(fileExists(marker), false);

  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, "{}\n", "utf8");
  assert.equal(installModule.cleanupP2_20IStagingOnSuccess(cleanupRoot, { P2_20I_KEEP_TMP: "1" }).cleanupStatus, "kept");
  assert.equal(fileExists(marker), true);
  rmSync(cleanupRoot, { recursive: true, force: true });
});

test("package commands register P2-20I staging, acceptance, and history test", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.equal(packageJson.scripts["stage:offline-local-llm"], "node scripts/p2-20i-stage-offline-local-llm-install-layout.mjs");
  assert.equal(packageJson.scripts["accept:offline-local-llm-install-layout"], "node scripts/p2-20i-install-layout-embedded-runtime-real-chat.mjs");
  assert.match(packageJson.scripts["test:history"], /scripts\/offline-local-llm-install-layout\.test\.mts/);
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

function installRoot(): string {
  return join(repoRoot, ".tmp", "p2-20i-install-layout");
}

function installResourcesPath(): string {
  return join(installRoot(), "resources");
}

function installLocalLlmRoot(): string {
  return join(installResourcesPath(), "local-llm");
}

function cleanupInstallLayout(): void {
  rmSync(installRoot(), { recursive: true, force: true });
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
