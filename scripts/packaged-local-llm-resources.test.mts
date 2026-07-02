import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  resolveBundledLlamaCppRuntime
} = require("../dist/main/services/local-runtime/bundled-llama-cpp-runtime.js") as typeof import("../src/main/services/local-runtime/bundled-llama-cpp-runtime");

const repoRoot = join(import.meta.dirname, "..");
const fullPathMarker = "DO_NOT_LEAK_P2_20H_ROOT";

test("local LLM scaffold keeps templates tracked and heavy resources ignored", () => {
  const scaffoldRoot = join(repoRoot, "resources", "local-llm");
  const readme = readFileSync(join(scaffoldRoot, "README.md"), "utf8");
  const manifestExample = readFileSync(join(scaffoldRoot, "manifest.example.json"), "utf8");
  const ignoreRules = readFileSync(join(scaffoldRoot, ".gitignore"), "utf8");
  const notices = readFileSync(join(scaffoldRoot, "licenses", "THIRD_PARTY_NOTICES.template.md"), "utf8");

  assert.match(readme, /manifest\.example\.json/);
  assert.match(manifestExample, /runtime\/win32-x64\/llama-server\.exe/);
  assert.match(manifestExample, /models\/model\.gguf/);
  assert.match(ignoreRules, /^manifest\.json$/m);
  assert.match(ignoreRules, /^runtime\/$/m);
  assert.match(ignoreRules, /^models\/$/m);
  assert.match(ignoreRules, /^archives\/$/m);
  assert.match(ignoreRules, /^installers\/$/m);
  assert.match(notices, /Third Party Notices/);
});

test("validator accepts fake resource pack and prints only safe summary", () => {
  const fixture = createResourcePackFixture({ includeIntegrity: true });

  try {
    const result = runValidator(fixture.root);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"status": "ready"/);
    assert.match(result.stdout, /"resourceSource": "localSourceEnv"/);
    assert.match(result.stdout, /"sha256Status": "matched"/);
    assert.equal(result.stdout.includes(fixture.root), false);
    assert.equal(result.stdout.includes(fixture.executablePath), false);
    assert.equal(result.stdout.includes(fixture.modelPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("validator rejects unsafe manifest paths without leaking absolute paths", () => {
  const fixture = createResourcePackFixture();

  try {
    writeManifest(fixture.root, {
      runtime: { executablePath: fixture.executablePath },
      model: { path: "models/model.gguf" }
    });
    const absoluteResult = runValidator(fixture.root);

    assert.notEqual(absoluteResult.status, 0);
    assert.match(absoluteResult.stdout, /"reason": "manifest_unsafe_path"/);
    assert.equal(absoluteResult.stdout.includes(fixture.root), false);
    assert.equal(absoluteResult.stdout.includes(fixture.executablePath), false);

    writeManifest(fixture.root, {
      runtime: { executablePath: "runtime/win32-x64/llama-server.exe" },
      model: { path: "../outside/model.gguf" }
    });
    const traversalResult = runValidator(fixture.root);

    assert.notEqual(traversalResult.status, 0);
    assert.match(traversalResult.stdout, /"reason": "manifest_unsafe_path"/);
    assert.equal(traversalResult.stdout.includes(fixture.root), false);
  } finally {
    fixture.cleanup();
  }
});

test("validator rejects malformed optional integrity metadata", () => {
  const fixture = createResourcePackFixture();

  try {
    writeManifest(fixture.root, {
      runtime: { executablePath: "runtime/win32-x64/llama-server.exe" },
      model: {
        path: "models/model.gguf",
        sha256: "replace-with-model-sha256"
      }
    });
    const result = runValidator(fixture.root);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /"reason": "invalid_sha256"/);
    assert.equal(result.stdout.includes(fixture.root), false);
    assert.equal(result.stdout.includes(fixture.modelPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("bundled resolver uses packaged resourcesPath for staged local-llm root", () => {
  const resourcesRoot = mkdtempSync(join(tmpdir(), "ai-pet-p2-20h-resources-"));
  const fixture = createResourcePackFixture({
    root: join(resourcesRoot, "local-llm")
  });

  try {
    const result = resolveBundledLlamaCppRuntime({
      env: {},
      cwd: join(tmpdir(), fullPathMarker, "unrelated-cwd"),
      resourcesPath: resourcesRoot
    });
    const output = JSON.stringify(result.safeSummary);

    assert.ok(result.config);
    assert.equal(result.safeSummary.status, "ready");
    assert.equal(result.safeSummary.resourceSource, "packaged");
    assert.equal(output.includes(resourcesRoot), false);
    assert.equal(output.includes(fixture.root), false);
  } finally {
    fixture.cleanup();
    rmSync(resourcesRoot, { recursive: true, force: true });
  }
});

function runValidator(root: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  return spawnSync(process.execPath, [join(repoRoot, "scripts", "p2-20h-validate-local-llm-resources.mjs")], {
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
  const modelPath = join(root, "models", "model.gguf");
  const executableContent = "fake exe";
  const modelContent = "fake model";
  mkdirSync(join(root, "runtime", "win32-x64"), { recursive: true });
  mkdirSync(join(root, "models"), { recursive: true });
  writeFileSync(executablePath, executableContent, "utf8");
  writeFileSync(modelPath, modelContent, "utf8");
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
