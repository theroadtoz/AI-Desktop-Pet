import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProductionLocalLlmArtifact } from "./p2-20o-production-local-llm-artifact-review.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-20o-tests");

test("fake complete production local LLM pack is ready and writes manifest/checksums", async () => {
  const root = createFakePack("happy");
  const outputRoot = join(testRoot, "happy-review");
  const result = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: root,
    outputRoot,
    write: true
  });

  assert.equal(result.status, "ready");
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(outputRoot, "release-manifest.json")), true);
  assert.equal(existsSync(join(outputRoot, "SHA256SUMS.txt")), true);

  const writtenManifest = JSON.parse(readFileSync(join(outputRoot, "release-manifest.json"), "utf8"));
  const writtenChecksums = readFileSync(join(outputRoot, "SHA256SUMS.txt"), "utf8");

  assert.equal(writtenManifest.status, "ready");
  assert.equal(writtenManifest.model.repo, "Qwen/Qwen2.5-1.5B-Instruct-GGUF");
  assert.equal(writtenManifest.model.license, "Apache-2.0");
  assert.equal(writtenManifest.runtime.repo, "ggml-org/llama.cpp");
  assert.match(writtenChecksums, /^[a-f0-9]{64}  models\/model\.gguf/m);
});

test("missing notices and placeholder notices block production review", async () => {
  const missingRoot = createFakePack("missing-notices", { skipNotices: true });
  const missingResult = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: missingRoot,
    outputRoot: join(testRoot, "missing-notices-review")
  });

  assert.equal(missingResult.status, "blocked");
  assert.match(missingResult.summary.blockers.join(","), /notices_file_missing/);

  const placeholderRoot = createFakePack("placeholder-notices", {
    noticesText: "# Third Party Notices\n\nTODO: replace-with final notices.\n"
  });
  const placeholderResult = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: placeholderRoot,
    outputRoot: join(testRoot, "placeholder-notices-review")
  });

  assert.equal(placeholderResult.status, "blocked");
  assert.match(placeholderResult.summary.blockers.join(","), /notices_placeholder/);
});

test("missing release metadata blocks production review", async () => {
  const root = createFakePack("missing-release", { release: null });
  const result = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: root,
    outputRoot: join(testRoot, "missing-release-review")
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary.blockers.join(","), /release_metadata_missing/);
});

test("unsafe manifest paths are rejected", async () => {
  const root = createFakePack("unsafe-path", {
    overrideManifest: (manifest) => ({
      ...manifest,
      model: {
        ...manifest.model,
        path: "../model.gguf"
      }
    })
  });
  const result = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: root,
    outputRoot: join(testRoot, "unsafe-path-review")
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary.blockers.join(","), /manifest_unsafe_path/);
});

test("safe summary and release manifest do not leak local paths or sensitive text", async () => {
  const root = createFakePack("safe-output", {
    noticesText: [
      "# Third Party Notices",
      "This line mentions SECRET_PROMPT_TEXT but should never be copied.",
      "USER_MESSAGE_TEXT ASSISTANT_MESSAGE_TEXT FACT_CARD_TEXT"
    ].join("\n")
  });
  const result = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: root,
    outputRoot: join(testRoot, "safe-output-review"),
    env: {
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: root,
      OPENAI_API_KEY: "DO_NOT_LEAK_TEST_API_KEY_VALUE"
    }
  });
  const safeOutput = JSON.stringify({
    summary: result.summary,
    releaseManifest: result.releaseManifest,
    checksumsText: result.checksumsText
  });

  assert.equal(result.status, "ready");
  assert.doesNotMatch(safeOutput, new RegExp(escapeRegExp(root)));
  assert.doesNotMatch(safeOutput, /DO_NOT_LEAK_TEST_API_KEY_VALUE/);
  assert.doesNotMatch(safeOutput, /SECRET_PROMPT_TEXT/);
  assert.doesNotMatch(safeOutput, /USER_MESSAGE_TEXT/);
  assert.doesNotMatch(safeOutput, /ASSISTANT_MESSAGE_TEXT/);
  assert.doesNotMatch(safeOutput, /FACT_CARD_TEXT/);
});

test("release manifest hashes and SHA256SUMS align with files", async () => {
  const root = createFakePack("checksum-align");
  const result = await auditProductionLocalLlmArtifact({
    repoRoot,
    resourceRoot: root,
    outputRoot: join(testRoot, "checksum-align-review"),
    write: true
  });
  const checksumLines = readFileSync(join(testRoot, "checksum-align-review", "SHA256SUMS.txt"), "utf8")
    .trim()
    .split(/\r?\n/);
  const checksumMap = new Map(checksumLines.map((line) => {
    const [sha256, relativePath] = line.split(/\s\s+/);
    return [relativePath, sha256];
  }));

  assert.equal(result.status, "ready");

  for (const artifact of result.releaseManifest.artifacts) {
    const filePath = join(root, artifact.relativePath);

    assert.equal(checksumMap.get(artifact.relativePath), artifact.sha256);
    assert.equal(sha256Text(readFileSync(filePath)), artifact.sha256);
    assert.equal(statSync(filePath).size, artifact.sizeBytes);
  }
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createFakePack(name: string, options: {
  skipNotices?: boolean;
  noticesText?: string;
  release?: Record<string, unknown> | null;
  overrideManifest?: (manifest: Record<string, any>) => Record<string, any>;
} = {}) {
  const root = join(testRoot, name, "resources", "local-llm");
  const runtimePath = join(root, "runtime", "win32-x64", "llama-server.exe");
  const dllPath = join(root, "runtime", "win32-x64", "llama.dll");
  const modelPath = join(root, "models", "model.gguf");
  const noticesPath = join(root, "licenses", "THIRD_PARTY_NOTICES.md");

  rmSync(join(testRoot, name), { recursive: true, force: true });
  mkdirSync(dirname(runtimePath), { recursive: true });
  mkdirSync(dirname(modelPath), { recursive: true });
  mkdirSync(dirname(noticesPath), { recursive: true });

  writeFileSync(runtimePath, "fake llama server binary\n", "utf8");
  writeFileSync(dllPath, "fake runtime dll\n", "utf8");
  writeFileSync(modelPath, "fake qwen gguf bytes\n", "utf8");

  if (!options.skipNotices) {
    writeFileSync(noticesPath, options.noticesText ?? [
      "# Third Party Notices",
      "Qwen/Qwen2.5-1.5B-Instruct-GGUF is Apache-2.0.",
      "llama.cpp is MIT licensed."
    ].join("\n"), "utf8");
  }

  const manifest = options.overrideManifest?.(baseManifest({
    runtimePath,
    modelPath,
    noticesPath,
    release: options.release
  })) ?? baseManifest({
    runtimePath,
    modelPath,
    noticesPath,
    release: options.release
  });

  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return root;
}

function baseManifest(paths: {
  runtimePath: string;
  modelPath: string;
  noticesPath: string;
  release?: Record<string, unknown> | null;
}) {
  const manifest: Record<string, any> = {
    version: 1,
    runtime: "llama.cpp",
    platforms: {
      "win32-x64": {
        executable: "runtime/win32-x64/llama-server.exe",
        sizeBytes: statSync(paths.runtimePath).size,
        sha256: sha256Text(readFileSync(paths.runtimePath))
      }
    },
    model: {
      path: "models/model.gguf",
      alias: "qwen2.5-1.5b-instruct-q4_k_m",
      displayName: "Qwen2.5 1.5B Instruct Q4_K_M",
      ctxSize: 2048,
      sizeBytes: statSync(paths.modelPath).size,
      sha256: sha256Text(readFileSync(paths.modelPath))
    },
    licenseNotices: "licenses/THIRD_PARTY_NOTICES.md"
  };

  if (paths.release !== null) {
    manifest.release = paths.release ?? {
      artifactKind: "production-local-llm",
      legalReviewStatus: "approved",
      model: {
        repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        baseModelRepo: "Qwen/Qwen2.5-1.5B-Instruct",
        file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        revision: "fixed-test-revision",
        license: "Apache-2.0",
        licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
        format: "GGUF",
        quantization: "Q4_K_M"
      },
      runtime: {
        name: "llama.cpp",
        repo: "ggml-org/llama.cpp",
        releaseTag: "b-test",
        commit: "fixed-test-commit",
        assetName: "llama-test-win-x64.zip",
        platform: "win-x64",
        backend: "CPU",
        license: "MIT",
        licenseUrl: "https://github.com/ggml-org/llama.cpp/blob/master/LICENSE"
      }
    };
  }

  return manifest;
}

function sha256Text(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
