import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MODEL_CANDIDATE,
  RUNTIME_CANDIDATE
} from "./p2-20p-production-local-llm-pack-assembly-dry-run.mjs";
import { assembleProductionCandidatePackFromPinnedAssets } from "./p2-30i-production-candidate-pack-assembly-from-pinned-assets.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-30i-tests");

test("assembles a candidate pack from hash-matched model and public runtime zip but stays production blocked", async () => {
  const fixtures = createFixtures("public-runtime");
  const workRoot = join(testRoot, "public-runtime", "work");
  const result = await assembleProductionCandidatePackFromPinnedAssets({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    modelCandidate: fixtures.modelCandidate,
    runtimeCandidate: fixtures.runtimeCandidate,
    fetch: fakeFetch(fixtures.runtimeZipBytes),
    keepTmp: true
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.assemblyResult.runtime.source, "downloaded_public_runtime_zip");
  assert.equal(result.provenance.modelProvenance.status, "matched_pinned_candidate");
  assert.equal(result.provenance.runtimeProvenance.status, "matches_pinned_candidate");
  assert.match(result.readyChecks.join(","), /runtime_public_release_zip_used/);
  assert.match(result.readyChecks.join(","), /runtime_release_metadata_matches_candidate/);
  assert.match(result.blockers.join(","), /legal_review_not_approved/);
  assert.match(result.blockers.join(","), /production_candidate_pack_not_release_approved/);
  assert.equal(existsSync(join(workRoot, "resources", "local-llm", "manifest.json")), true);
});

test("default cleanup removes the temporary candidate pack after audit", async () => {
  const fixtures = createFixtures("default-cleanup");
  const workRoot = join(testRoot, "default-cleanup", "work");
  const result = await assembleProductionCandidatePackFromPinnedAssets({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    modelCandidate: fixtures.modelCandidate,
    runtimeCandidate: fixtures.runtimeCandidate,
    fetch: fakeFetch(fixtures.runtimeZipBytes)
  });

  assert.equal(result.cleanup.tmp, "removed");
  assert.equal(existsSync(workRoot), false);
  assert.equal(result.provenance.runtimeProvenance.status, "matches_pinned_candidate");
});

test("runtime directory source is not accepted as pinned public release asset evidence", async () => {
  const fixtures = createFixtures("runtime-dir");
  const workRoot = join(testRoot, "runtime-dir", "work");
  const result = await assembleProductionCandidatePackFromPinnedAssets({
    repoRoot,
    workRoot,
    sourceModelPath: fixtures.modelPath,
    sourceRuntimeDir: fixtures.runtimeDir,
    modelCandidate: fixtures.modelCandidate,
    runtimeCandidate: fixtures.runtimeCandidate
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.assemblyResult.runtime.source, "fixture_runtime_dir");
  assert.match(result.blockers.join(","), /runtime_public_release_asset_not_used/);
  assert.doesNotMatch(result.readyChecks.join(","), /runtime_public_release_zip_used/);
});

test("missing source model is blocked without leaking local paths", async () => {
  const workRoot = join(testRoot, "missing-model", "work");
  const result = await assembleProductionCandidatePackFromPinnedAssets({
    repoRoot,
    workRoot,
    sourceModelPath: join(testRoot, "missing-model", "model.gguf")
  });
  const text = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /source_model_missing/);
  assert.doesNotMatch(text, /[A-Za-z]:\\/);
  assert.doesNotMatch(text, /Authorization|api[_-]?key|token/i);
});

test("package scripts expose P2-30I assembly and focused test", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  assert.match(
    packageJson.scripts["assemble:production-local-llm-candidate-pack"],
    /p2-30i-production-candidate-pack-assembly-from-pinned-assets\.mjs/
  );
  assert.match(
    packageJson.scripts["test:history"],
    /production-candidate-pack-assembly-from-pinned-assets\.test\.mts/
  );
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
  const zipPath = join(root, "runtime.zip");

  rmSync(join(testRoot, name), { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(modelPath, `fake qwen gguf bytes for ${name}\n`, "utf8");
  writeFileSync(executablePath, `fake llama server binary for ${name}\n`, "utf8");
  writeFileSync(dllPath, `fake runtime dll for ${name}\n`, "utf8");
  createRuntimeZip(runtimeDir, zipPath);

  const modelBytes = readFileSync(modelPath);
  const runtimeZipBytes = readFileSync(zipPath);
  const modelCandidate = {
    ...MODEL_CANDIDATE,
    sizeBytes: statSync(modelPath).size,
    sha256: sha256(modelBytes)
  };
  const runtimeCandidate = {
    ...RUNTIME_CANDIDATE,
    assetSizeBytes: statSync(zipPath).size,
    assetSha256: sha256(runtimeZipBytes)
  };

  return {
    runtimeDir,
    modelPath,
    runtimeZipBytes,
    modelCandidate,
    runtimeCandidate
  };
}

function createRuntimeZip(runtimeDir: string, zipPath: string) {
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
}

function fakeFetch(bytes: Buffer) {
  return async () => ({
    ok: true,
    body: Readable.from(bytes)
  });
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapePowerShellSingleQuoted(value: string) {
  return String(value).replace(/'/g, "''");
}
