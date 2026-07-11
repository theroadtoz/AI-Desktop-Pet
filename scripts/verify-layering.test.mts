import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inspectLive2dAssets } from "./verify-local-assets.mjs";
import { inspectLocalLlmAssets } from "./verify-local-llm-assets.mjs";
import { validatePackagedAssets } from "./verify-packaged-assets.mjs";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const LOCAL_LIVE2D_TESTS = [
  "scripts/live2d-expression-asset-audit.test.mts",
  "scripts/live2d-accessory-capability-audit.test.mts",
  "scripts/live2d-action-capability-audit.test.mts",
  "scripts/live2d-motion-asset-audit.test.mts",
  "scripts/p2-52-motion-resource-dry-run-intake.test.mts"
];

function testFiles(scriptName: string): string[] {
  const script = packageJson.scripts[scriptName];
  assert.equal(typeof script, "string", `missing package script: ${scriptName}`);
  return [...script.matchAll(/scripts\/[\w-]+\.test\.mts/gu)].map(([path]) => path);
}

test("verification scripts keep local assets outside core and register security tests", () => {
  const coreTests = new Set(testFiles("test:live2d-core"));
  const localTests = new Set(testFiles("test:live2d-local-assets"));
  const historyTests = new Set(testFiles("test:history"));

  for (const path of LOCAL_LIVE2D_TESTS) {
    assert.equal(localTests.has(path), true, `${path} must be local-assets`);
    assert.equal(coreTests.has(path), false, `${path} must not be core`);
  }

  for (const path of [
    "scripts/app-shutdown-coordinator.test.mts",
    "scripts/trusted-ipc-sender.test.mts",
    "scripts/trusted-window-policy.test.mts"
  ]) {
    assert.equal(historyTests.has(path), true, `${path} must run through verify:core`);
  }

  assert.match(packageJson.scripts["verify:core"], /npm run test:live2d-core/u);
  assert.match(packageJson.scripts["verify:core"], /npm run test:history/u);
  assert.match(packageJson.scripts["verify:local-assets"], /verify-local-assets\.mjs/u);
  assert.match(packageJson.scripts["verify:local-llm-assets"], /verify-local-llm-assets\.mjs/u);
  assert.match(packageJson.scripts["verify:packaged-assets"], /verify-packaged-assets\.mjs/u);
  assert.doesNotMatch(packageJson.scripts.verify, /local-llm|packaged-assets/u);
});

test("Live2D adapter accepts only the canonical repository model directory", () => {
  const root = mkdtempSync(join(tmpdir(), "ai-pet-live2d-layering-"));
  const manifestPath = join(root, "resources", "models", "witch", "model-manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });

  try {
    writeFileSync(manifestPath, JSON.stringify({ sourceDir: "../../../model" }), "utf8");
    assert.equal(inspectLive2dAssets(root).reason, "model_root_missing_or_linked");

    mkdirSync(join(root, "model"));
    assert.deepEqual(inspectLive2dAssets(root), { status: "validate" });

    writeFileSync(manifestPath, JSON.stringify({ sourceDir: "../../../../outside" }), "utf8");
    assert.equal(inspectLive2dAssets(root).reason, "manifest_source_dir_not_allowed");

    writeFileSync(manifestPath, JSON.stringify({ sourceDir: join(root, "model") }), "utf8");
    assert.equal(inspectLive2dAssets(root).reason, "manifest_source_dir_not_allowed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Live2D adapter rejects a model junction", () => {
  const root = mkdtempSync(join(tmpdir(), "ai-pet-live2d-junction-"));
  const outside = mkdtempSync(join(tmpdir(), "ai-pet-live2d-outside-"));
  const manifestPath = join(root, "resources", "models", "witch", "model-manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ sourceDir: "../../../model" }), "utf8");
  symlinkSync(outside, join(root, "model"), "junction");

  try {
    assert.equal(inspectLive2dAssets(root).reason, "model_root_missing_or_linked");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("Live2D adapter rejects a junction nested inside the model root", () => {
  const root = mkdtempSync(join(tmpdir(), "ai-pet-live2d-nested-junction-"));
  const outside = mkdtempSync(join(tmpdir(), "ai-pet-live2d-nested-outside-"));
  const manifestPath = join(root, "resources", "models", "witch", "model-manifest.json");
  const nestedDirectory = join(root, "model", "textures");
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ sourceDir: "../../../model" }), "utf8");
  symlinkSync(outside, join(nestedDirectory, "escaped"), "junction");

  try {
    assert.equal(inspectLive2dAssets(root).reason, "model_tree_contains_link");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("strict local LLM gate blocks an unconfigured source root", () => {
  assert.deepEqual(inspectLocalLlmAssets({}), {
    status: "blocked",
    reason: "source_root_not_configured"
  });

  const env = { ...process.env };
  delete env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT;
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "verify-local-llm-assets.mjs")], {
    cwd: repoRoot,
    env,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"status":"blocked"/u);
});

test("packaged asset verifier accepts a strict synthetic fixture", () => {
  const fixture = createPackagedFixture();

  try {
    assert.deepEqual(validatePackagedAssets(fixture.root), {
      ok: true,
      status: "ready",
      declaredFileCount: 5
    });
    const commandResult = spawnSync(process.execPath, [
      join(repoRoot, "scripts", "verify-packaged-assets.mjs"),
      fixture.root
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.equal(commandResult.status, 0);
    assert.match(commandResult.stdout, /"status":"ready"/u);
  } finally {
    fixture.cleanup();
  }
});

test("packaged asset verifier rejects schema, unsafe paths, integrity and approvals", () => {
  assertPackagedFailure((manifest) => { manifest.version = 2; }, "manifest_schema_invalid");
  assertPackagedFailure((manifest) => { manifest.model.path = "../outside.gguf"; }, "manifest_unsafe_path");
  assertPackagedFailure((manifest) => { manifest.model.sizeBytes += 1; }, "size_mismatch");
  assertPackagedFailure((manifest) => { manifest.model.sha256 = "0".repeat(64); }, "sha256_mismatch");
  assertPackagedFailure((manifest) => { manifest.licenses[0].approved = false; }, "licenses_not_approved");
  assertPackagedFailure((manifest) => { manifest.licenseNotices.approved = false; }, "notices_not_approved");
});

test("packaged asset verifier rejects undeclared files and junctions", () => {
  const undeclared = createPackagedFixture();
  const linked = createPackagedFixture();
  const outside = mkdtempSync(join(tmpdir(), "ai-pet-packaged-outside-"));

  try {
    writeFileSync(join(undeclared.root, "extra.bin"), "extra", "utf8");
    assert.equal(validatePackagedAssets(undeclared.root).reason, "undeclared_file");

    symlinkSync(outside, join(linked.root, "linked"), "junction");
    assert.equal(validatePackagedAssets(linked.root).reason, "symlink_or_junction");
  } finally {
    undeclared.cleanup();
    linked.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("packaged asset gate exits nonzero when root is missing", () => {
  const env = { ...process.env };
  delete env.AI_DESKTOP_PET_PACKAGED_ASSETS_ROOT;
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "verify-packaged-assets.mjs")], {
    cwd: repoRoot,
    env,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /packaged_root_missing_or_linked/u);
});

function assertPackagedFailure(mutate: (manifest: any) => void, reason: string): void {
  const fixture = createPackagedFixture();

  try {
    const manifest = JSON.parse(readFileSync(join(fixture.root, "manifest.json"), "utf8"));
    mutate(manifest);
    writeFileSync(join(fixture.root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    assert.equal(validatePackagedAssets(fixture.root).reason, reason);
  } finally {
    fixture.cleanup();
  }
}

function createPackagedFixture(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "ai-pet-packaged-fixture-"));
  const files = {
    runtime: { path: join("runtime", "llama-server.exe"), content: "runtime" },
    model: { path: join("models", "model.gguf"), content: "model" },
    notices: { path: join("licenses", "THIRD_PARTY_NOTICES.md"), content: "notices" },
    license: { path: join("licenses", "MODEL_LICENSE.txt"), content: "license" }
  };

  for (const file of Object.values(files)) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, "utf8");
  }

  const integrity = (file: { path: string; content: string }) => ({
    sizeBytes: Buffer.byteLength(file.content),
    sha256: createHash("sha256").update(file.content).digest("hex")
  });
  const manifest = {
    version: 1,
    platforms: {
      [`${process.platform}-${process.arch}`]: {
        executable: files.runtime.path,
        ...integrity(files.runtime)
      }
    },
    model: { path: files.model.path, ...integrity(files.model) },
    licenseNotices: { path: files.notices.path, approved: true, ...integrity(files.notices) },
    licenses: [{ path: files.license.path, approved: true, ...integrity(files.license) }]
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}
