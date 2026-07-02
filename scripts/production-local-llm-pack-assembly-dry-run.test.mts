import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assembleProductionLocalLlmPackDryRun,
  MODEL_CANDIDATE,
  RUNTIME_CANDIDATE
} from "./p2-20p-production-local-llm-pack-assembly-dry-run.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-20p-tests");

test("approved fixture assembles a local LLM pack and writes ready review artifacts", async () => {
  const fixtures = createFixtures("approved-ready");
  const workRoot = join(testRoot, "approved-ready", "work");
  const outputRoot = join(workRoot, "review");
  const packRoot = join(workRoot, "resources", "local-llm");
  const result = await assembleProductionLocalLlmPackDryRun({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    sourceRuntimeDir: fixtures.runtimeDir,
    modelCandidate: fixtures.modelCandidate,
    legalReviewStatus: "approved",
    keepTmp: true
  });

  assert.equal(result.status, "ready");
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(packRoot, "models", "model.gguf")), true);
  assert.equal(existsSync(join(packRoot, "runtime", "win32-x64", "llama-server.exe")), true);
  assert.equal(existsSync(join(packRoot, "runtime", "win32-x64", "llama.dll")), true);
  assert.equal(existsSync(join(outputRoot, "release-manifest.json")), true);
  assert.equal(existsSync(join(outputRoot, "SHA256SUMS.txt")), true);

  const manifest = JSON.parse(readFileSync(join(packRoot, "manifest.json"), "utf8"));
  const reviewManifest = JSON.parse(readFileSync(join(outputRoot, "release-manifest.json"), "utf8"));

  assert.equal(manifest.release.legalReviewStatus, "approved");
  assert.equal(manifest.release.model.revision, MODEL_CANDIDATE.revision);
  assert.notEqual(manifest.release.model.revision, "main");
  assert.notEqual(manifest.release.model.revision, "latest");
  assert.equal(manifest.release.runtime.releaseTag, RUNTIME_CANDIDATE.releaseTag);
  assert.notEqual(manifest.release.runtime.releaseTag, "latest");
  assert.equal(reviewManifest.status, "ready");
  assert.equal(reviewManifest.model.revision, MODEL_CANDIDATE.revision);
  assert.equal(reviewManifest.runtime.releaseTag, RUNTIME_CANDIDATE.releaseTag);
});

test("default pending legal review truthfully produces warning and writes review artifacts", async () => {
  const fixtures = createFixtures("pending-warning");
  const workRoot = join(testRoot, "pending-warning", "work");
  const result = await assembleProductionLocalLlmPackDryRun({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    sourceRuntimeDir: fixtures.runtimeDir,
    modelCandidate: fixtures.modelCandidate,
    keepTmp: true
  });
  const reviewManifestPath = join(workRoot, "review", "release-manifest.json");
  const reviewManifest = JSON.parse(readFileSync(reviewManifestPath, "utf8"));

  assert.equal(result.status, "warning");
  assert.equal(result.ok, false);
  assert.equal(result.summary.legalReviewStatus, "pending");
  assert.match(result.summary.review.warnings.join(","), /legal_review_not_approved/);
  assert.equal(reviewManifest.status, "warning");
  assert.equal(reviewManifest.ok, false);
  assert.equal(reviewManifest.legalReviewStatus, "pending");
  assert.match(reviewManifest.warnings.join(","), /legal_review_not_approved/);
});

test("fixture runtime zip path exercises the same extract path as the real dry run", async () => {
  const fixtures = createFixtures("fixture-runtime-zip");
  const runtimeZipPath = createRuntimeZipFixture(fixtures.runtimeDir, "fixture-runtime-zip");
  const workRoot = join(testRoot, "fixture-runtime-zip", "work");
  const result = await assembleProductionLocalLlmPackDryRun({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    sourceRuntimeZipPath: runtimeZipPath,
    runtimeCandidate: {
      ...RUNTIME_CANDIDATE,
      assetSizeBytes: statSync(runtimeZipPath).size,
      assetSha256: sha256(readFileSync(runtimeZipPath))
    },
    modelCandidate: fixtures.modelCandidate,
    legalReviewStatus: "approved",
    keepTmp: true
  });

  assert.equal(result.status, "ready");
  assert.equal(result.summary.runtime.source, "fixture_runtime_zip");
  assert.equal(existsSync(join(workRoot, "resources", "local-llm", "runtime", "win32-x64", "llama-server.exe")), true);
  assert.equal(existsSync(join(workRoot, "resources", "local-llm", "runtime", "win32-x64", "llama.dll")), true);
});

test("wrong model size or sha is blocked before production review", async () => {
  const sizeFixtures = createFixtures("bad-size");
  const badSizeResult = await assembleProductionLocalLlmPackDryRun({
    repoRoot,
    workRoot: join(testRoot, "bad-size", "work"),
    sourceModelPath: sizeFixtures.modelPath,
    sourceRuntimeDir: sizeFixtures.runtimeDir,
    modelCandidate: {
      ...sizeFixtures.modelCandidate,
      sizeBytes: sizeFixtures.modelCandidate.sizeBytes + 1
    }
  });

  assert.equal(badSizeResult.status, "blocked");
  assert.match(badSizeResult.summary.blockers.join(","), /model_size_mismatch/);
  assert.equal(existsSync(join(testRoot, "bad-size", "work")), false);

  const shaFixtures = createFixtures("bad-sha");
  const badShaResult = await assembleProductionLocalLlmPackDryRun({
    repoRoot,
    workRoot: join(testRoot, "bad-sha", "work"),
    sourceModelPath: shaFixtures.modelPath,
    sourceRuntimeDir: shaFixtures.runtimeDir,
    modelCandidate: {
      ...shaFixtures.modelCandidate,
      sha256: "0".repeat(64)
    }
  });

  assert.equal(badShaResult.status, "blocked");
  assert.match(badShaResult.summary.blockers.join(","), /model_sha256_mismatch/);
  assert.equal(existsSync(join(testRoot, "bad-sha", "work")), false);
});

test("pack root outside repo tmp is rejected", async () => {
  const fixtures = createFixtures("unsafe-pack-root");

  await assert.rejects(
    () => assembleProductionLocalLlmPackDryRun({
      repoRoot,
      workRoot: join(testRoot, "unsafe-pack-root", "work"),
      packRoot: join(repoRoot, "resources", "local-llm"),
      sourceModelPath: fixtures.modelPath,
      sourceRuntimeDir: fixtures.runtimeDir,
      modelCandidate: fixtures.modelCandidate
    }),
    /p2_20p_pack_root_outside_repo_tmp/
  );
});

test("summary and generated review artifacts do not leak local paths or sensitive text", async () => {
  const fixtures = createFixtures("safe-output");
  const workRoot = join(testRoot, "safe-output", "work");
  const result = await assembleProductionLocalLlmPackDryRun({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    sourceRuntimeDir: fixtures.runtimeDir,
    modelCandidate: fixtures.modelCandidate,
    legalReviewStatus: "approved",
    keepTmp: true
  });
  const reviewManifestText = readFileSync(join(workRoot, "review", "release-manifest.json"), "utf8");
  const checksumsText = readFileSync(join(workRoot, "review", "SHA256SUMS.txt"), "utf8");
  const safeOutput = JSON.stringify({
    summary: result.summary,
    releaseManifest: result.review.releaseManifest,
    checksumsText,
    reviewManifestText
  });

  assert.equal(result.status, "ready");
  assert.doesNotMatch(safeOutput, new RegExp(escapeRegExp(workRoot)));

  for (const forbiddenPattern of [
    /[A-Za-z]:\\/,
    /Authorization/i,
    /api[_-]?key/i,
    /token/i,
    /prompt/i,
    /request body/i,
    /user message/i,
    /assistant message/i,
    /fact-card/i
  ]) {
    assert.doesNotMatch(safeOutput, forbiddenPattern);
  }
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createFixtures(name: string) {
  const root = join(testRoot, name, "fixtures");
  const runtimeDir = join(root, "runtime");
  const modelPath = join(root, "model.gguf");
  const executablePath = join(runtimeDir, "llama-server.exe");
  const dllPath = join(runtimeDir, "llama.dll");

  rmSync(join(testRoot, name), { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(modelPath, `fake qwen gguf bytes for ${name}\n`, "utf8");
  writeFileSync(executablePath, `fake llama server binary for ${name}\n`, "utf8");
  writeFileSync(dllPath, `fake runtime dll for ${name}\n`, "utf8");

  const modelBytes = readFileSync(modelPath);
  const modelCandidate = {
    ...MODEL_CANDIDATE,
    sizeBytes: statSync(modelPath).size,
    sha256: sha256(modelBytes)
  };

  return {
    runtimeDir,
    modelPath,
    modelCandidate
  };
}

function createRuntimeZipFixture(runtimeDir: string, name: string) {
  const zipPath = join(testRoot, name, "runtime.zip");
  rmSync(zipPath, { force: true });
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Compress-Archive -Path '${escapePowerShellSingleQuoted(join(runtimeDir, "*"))}' -DestinationPath '${escapePowerShellSingleQuoted(zipPath)}' -Force`
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(zipPath), true);

  return zipPath;
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapePowerShellSingleQuoted(value: string) {
  return value.replace(/'/g, "''");
}
