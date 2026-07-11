import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  resolveBundledLlamaCppRuntime
} = require("../dist/main/services/local-runtime/bundled-llama-cpp-runtime.js") as typeof import("../src/main/services/local-runtime/bundled-llama-cpp-runtime");

const FULL_PATH_MARKER = "DO_NOT_LEAK_BUNDLED_ROOT";

test("bundled resolver reports missing env root without leaking complete path", () => {
  const missingRoot = join(tmpdir(), FULL_PATH_MARKER, "missing-local-llm");
  const result = resolveBundledLlamaCppRuntime({
    env: { AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: missingRoot },
    cwd: tmpdir(),
    resourcesPath: ""
  });
  const output = JSON.stringify(result.safeSummary);

  assert.equal(result.config, null);
  assert.equal(result.safeSummary.status, "missing_root");
  assert.equal(result.safeSummary.resourceSource, "env");
  assert.equal(result.safeSummary.reason, "env_root_missing");
  assert.equal(output.includes(missingRoot), false);
});

test("bundled resolver reads manifest and returns runtime config with safe summary", () => {
  const fixture = createBundledFixture();

  try {
    const result = resolveBundledLlamaCppRuntime({
      env: { AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: fixture.root },
      cwd: tmpdir(),
      resourcesPath: ""
    });
    const output = JSON.stringify(result.safeSummary);

    assert.ok(result.config);
    assert.equal(result.config.executablePath, fixture.executablePath);
    assert.equal(result.config.modelPath, fixture.modelPath);
    assert.equal(result.config.alias, "pet-local");
    assert.equal(result.config.ctxSize, 1024);
    assert.equal(result.safeSummary.status, "ready");
    assert.equal(result.safeSummary.executableName, "llama-server.exe");
    assert.equal(result.safeSummary.modelName, "model.gguf");
    assert.equal(result.safeSummary.alias, "pet-local");
    assert.equal(output.includes(fixture.root), false);
    assert.equal(output.includes(fixture.executablePath), false);
    assert.equal(output.includes(fixture.modelPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("bundled resolver supports packaged platform manifest with UTF-8 BOM", () => {
  const fixture = createBundledFixture();

  try {
    writeFileSync(join(fixture.root, "manifest.json"), `\uFEFF${JSON.stringify({
      version: 1,
      runtime: "llama.cpp",
      platforms: {
        [`${process.platform}-${process.arch}`]: {
          executable: "runtime/win32-x64/llama-server.exe"
        }
      },
      model: {
        path: "models/model.gguf",
        alias: "pet-local",
        ctxSize: 1024
      }
    }, null, 2)}\n`, "utf8");

    const result = resolveBundledLlamaCppRuntime({
      env: { AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: fixture.root },
      cwd: tmpdir(),
      resourcesPath: ""
    });

    assert.ok(result.config);
    assert.equal(result.config.executablePath, fixture.executablePath);
    assert.equal(result.safeSummary.status, "ready");
    assert.equal(result.safeSummary.resourceSource, "env");
  } finally {
    fixture.cleanup();
  }
});

test("bundled resolver rejects absolute and parent traversal manifest paths", () => {
  const fixture = createBundledFixture();

  try {
    writeManifest(fixture.root, {
      runtime: { executablePath: fixture.executablePath },
      model: { path: "models/model.gguf" }
    });
    assert.equal(resolveBundledLlamaCppRuntime({
      env: { AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: fixture.root },
      cwd: tmpdir(),
      resourcesPath: ""
    }).safeSummary.reason, "manifest_unsafe_path");

    writeManifest(fixture.root, {
      runtime: { executablePath: "runtime/win32-x64/llama-server.exe" },
      model: { path: "../outside/model.gguf" }
    });
    assert.equal(resolveBundledLlamaCppRuntime({
      env: { AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: fixture.root },
      cwd: tmpdir(),
      resourcesPath: ""
    }).safeSummary.reason, "manifest_unsafe_path");
  } finally {
    fixture.cleanup();
  }
});

test("bundled resolver supports development and packaged local-llm roots", () => {
  const development = createBundledFixture(join(mkdtempSync(join(tmpdir(), "ai-pet-dev-")), "resources", "local-llm"));
  const packagedRoot = mkdtempSync(join(tmpdir(), "ai-pet-packaged-"));
  const packaged = createBundledFixture(join(packagedRoot, "local-llm"));

  try {
    const developmentResult = resolveBundledLlamaCppRuntime({
      env: {},
      cwd: join(development.root, "..", ".."),
      resourcesPath: ""
    });
    const packagedResult = resolveBundledLlamaCppRuntime({
      env: {},
      cwd: join(tmpdir(), "no-dev-root"),
      resourcesPath: packagedRoot
    });

    assert.equal(developmentResult.safeSummary.status, "ready");
    assert.equal(developmentResult.safeSummary.resourceSource, "development");
    assert.equal(packagedResult.safeSummary.status, "ready");
    assert.equal(packagedResult.safeSummary.resourceSource, "packaged");
  } finally {
    development.cleanup();
    packaged.cleanup();
    rmSync(packagedRoot, { recursive: true, force: true });
  }
});

test("bundled resolver does not use the prepared development cache implicitly", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ai-pet-dev-cache-"));
  const scaffoldRoot = join(cwd, "resources", "local-llm");
  createBundledFixture(join(cwd, ".tmp", "p2-23c-qwen25-15b-local-llm"));
  mkdirSync(scaffoldRoot, { recursive: true });

  try {
    const result = resolveBundledLlamaCppRuntime({
      env: {},
      cwd,
      resourcesPath: ""
    });

    assert.equal(result.config, null);
    assert.equal(result.safeSummary.status, "missing_manifest");
    assert.equal(result.safeSummary.resourceSource, "development");
    assert.equal(result.safeSummary.resourceRootName, "local-llm");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bundled resolver keeps explicit development manifest ahead of prepared cache", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ai-pet-dev-manifest-"));
  const development = createBundledFixture(join(cwd, "resources", "local-llm"));
  const cached = createBundledFixture(join(cwd, ".tmp", "p2-23c-qwen25-15b-local-llm"));

  try {
    const result = resolveBundledLlamaCppRuntime({
      env: {},
      cwd,
      resourcesPath: ""
    });

    assert.ok(result.config);
    assert.equal(result.config.executablePath, development.executablePath);
    assert.notEqual(result.config.executablePath, cached.executablePath);
    assert.equal(result.safeSummary.status, "ready");
    assert.equal(result.safeSummary.resourceRootName, "local-llm");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function createBundledFixture(root = mkdtempSync(join(tmpdir(), "ai-pet-bundled-"))): {
  root: string;
  executablePath: string;
  modelPath: string;
  cleanup(): void;
} {
  const executablePath = join(root, "runtime", "win32-x64", "llama-server.exe");
  const modelPath = join(root, "models", "model.gguf");
  mkdirSync(join(root, "runtime", "win32-x64"), { recursive: true });
  mkdirSync(join(root, "models"), { recursive: true });
  writeFileSync(executablePath, "fake exe", "utf8");
  writeFileSync(modelPath, "fake model", "utf8");
  writeManifest(root, {
    runtime: { executablePath: "runtime/win32-x64/llama-server.exe" },
    model: {
      path: "models/model.gguf",
      alias: "pet-local",
      ctxSize: 1024
    }
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
