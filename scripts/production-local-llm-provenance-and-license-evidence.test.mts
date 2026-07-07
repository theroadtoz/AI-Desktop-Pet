import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MODEL_CANDIDATE, RUNTIME_CANDIDATE } from "./p2-20p-production-local-llm-pack-assembly-dry-run.mjs";
import { auditProductionLocalLlmProvenanceAndLicenseEvidence } from "./p2-30h-production-local-llm-provenance-and-license-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-30h-tests");
const outputRoot = join(repoRoot, ".tmp", "p2-30h-production-local-llm-provenance-evidence");
const scriptPath = join(repoRoot, "scripts", "p2-30h-production-local-llm-provenance-and-license-evidence.mjs");
const defaultModelContent = "fake candidate model bytes\n";
const testModelCandidate = {
  ...MODEL_CANDIDATE,
  sizeBytes: Buffer.byteLength(defaultModelContent),
  sha256: sha256Text(defaultModelContent)
};
const testRuntimeCandidate = { ...RUNTIME_CANDIDATE };

test("local-only pack matches pinned model but stays blocked without runtime release metadata", async () => {
  const root = createPack("local-only", { release: null });
  const result = await auditProductionLocalLlmProvenanceAndLicenseEvidence({
    repoRoot,
    resourceRoot: root,
    modelCandidate: testModelCandidate,
    runtimeCandidate: testRuntimeCandidate
  });
  const blockers = result.blockers.join(",");
  const readyChecks = result.readyChecks.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-30H");
  assert.equal(result.audit, "production_local_llm_provenance_and_license_evidence");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.modelProvenance.status, "matched_pinned_candidate");
  assert.equal(result.runtimeProvenance.status, "blocked_missing_release_metadata");
  assert.equal(result.licenseEvidence.status, "draft_shape_present_legal_pending");
  assert.match(blockers, /runtime_release_metadata_missing/);
  assert.match(blockers, /legal_review_not_approved/);
  assert.match(blockers, /owner_release_approval_missing/);
  assert.match(blockers, /model_license_evidence_not_approved/);
  assert.match(blockers, /runtime_license_evidence_not_approved/);
  assert.match(readyChecks, /model_candidate_sha256_matched/);
  assert.match(readyChecks, /model_candidate_size_matched/);
  assert.match(readyChecks, /third_party_notices_draft_shape_present/);
  assertSafeOutput(result, [root, testRoot]);
});

test("runtime release metadata can match the pinned candidate but legal gates remain blocked", async () => {
  const root = createPack("release-metadata", {
    release: {
      artifactKind: "production-local-llm",
      legalReviewStatus: "pending",
      model: modelReleaseMetadata(),
      runtime: runtimeReleaseMetadata()
    }
  });
  const result = await auditProductionLocalLlmProvenanceAndLicenseEvidence({
    repoRoot,
    resourceRoot: root,
    modelCandidate: testModelCandidate,
    runtimeCandidate: testRuntimeCandidate
  });
  const blockers = result.blockers.join(",");
  const readyChecks = result.readyChecks.join(",");

  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeProvenance.status, "matches_pinned_candidate");
  assert.equal(result.runtimeProvenance.releaseMetadataStatus, "matches_pinned_candidate");
  assert.match(readyChecks, /runtime_release_metadata_matches_candidate/);
  assert.doesNotMatch(blockers, /runtime_release_metadata_missing/);
  assert.match(blockers, /legal_review_not_approved/);
  assert.match(blockers, /production_release_not_approved/);
  assertSafeOutput(result, [root, testRoot]);
});

test("mismatched model or placeholder notices block provenance evidence", async () => {
  const modelMismatch = createPack("model-mismatch", {
    modelContent: "wrong model bytes\n"
  });
  const modelResult = await auditProductionLocalLlmProvenanceAndLicenseEvidence({
    repoRoot,
    resourceRoot: modelMismatch,
    modelCandidate: testModelCandidate,
    runtimeCandidate: testRuntimeCandidate
  });

  assert.equal(modelResult.modelProvenance.status, "blocked");
  assert.match(modelResult.blockers.join(","), /model_candidate_sha256_mismatch/);

  const placeholder = createPack("placeholder-notices", {
    noticesText: "# Third Party Notices\n\nTODO: replace with final notices.\n"
  });
  const placeholderResult = await auditProductionLocalLlmProvenanceAndLicenseEvidence({
    repoRoot,
    resourceRoot: placeholder,
    modelCandidate: testModelCandidate,
    runtimeCandidate: testRuntimeCandidate
  });

  assert.equal(placeholderResult.licenseEvidence.status, "blocked");
  assert.match(placeholderResult.blockers.join(","), /third_party_notices_placeholder/);
});

test("CLI prints safe JSON and exits zero for blocked audit", () => {
  const root = createPack("cli-safe", { release: null });
  const cli = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: root
    },
    encoding: "utf8",
    windowsHide: true
  });
  const result = JSON.parse(cli.stdout);

  assert.equal(cli.status, 0);
  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assertSafeOutput(result, [root, testRoot]);
  assert.doesNotMatch(cli.stdout, /[A-Za-z]:\\/);
});

test("write cleanup removes only the P2-30H tmp evidence output", async () => {
  const root = createPack("write-cleanup", { release: null });

  rmSync(outputRoot, { recursive: true, force: true });
  const result = await auditProductionLocalLlmProvenanceAndLicenseEvidence({
    repoRoot,
    resourceRoot: root,
    modelCandidate: testModelCandidate,
    runtimeCandidate: testRuntimeCandidate,
    write: true,
    cleanup: true
  });

  assert.equal(result.cleanup.status, "removed");
  assert.equal(existsSync(outputRoot), false);
  assert.equal(result.writtenArtifacts.every((entry: any) => entry.status === "removed_after_cleanup"), true);
});

test("package scripts expose P2-30H audit and focused test", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["audit:production-local-llm-provenance-evidence"],
    "node scripts/p2-30h-production-local-llm-provenance-and-license-evidence.mjs"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/production-local-llm-provenance-and-license-evidence\.test\.mts/
  );
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

function createPack(name: string, options: {
  release?: Record<string, unknown> | null;
  modelContent?: string;
  noticesText?: string;
} = {}) {
  const root = join(testRoot, name, "local-llm");
  const runtimePath = join(root, "runtime", "win32-x64", "llama-server.exe");
  const dllPath = join(root, "runtime", "win32-x64", "llama.dll");
  const modelPath = join(root, "models", "model.gguf");
  const noticesPath = join(root, "licenses", "THIRD_PARTY_NOTICES.md");
  const modelContent = options.modelContent ?? defaultModelContent;

  rmSync(root, { recursive: true, force: true });
  writeFile(runtimePath, "fake runtime executable\n");
  writeFile(dllPath, "fake runtime dll\n");
  writeFile(modelPath, modelContent);
  writeFile(noticesPath, options.noticesText ?? [
    "# Third Party Notices",
    "Qwen/Qwen2.5-1.5B-Instruct-GGUF uses Apache-2.0.",
    "llama.cpp uses MIT."
  ].join("\n"));

  const manifest: Record<string, any> = {
    version: 1,
    runtime: "llama.cpp",
    platforms: {
      "win32-x64": {
        executable: "runtime/win32-x64/llama-server.exe",
        sizeBytes: statSync(runtimePath).size,
        sha256: sha256Text(readFileSync(runtimePath))
      }
    },
    model: {
      path: "models/model.gguf",
      alias: "qwen2.5-1.5b-instruct-q4_k_m",
      sizeBytes: Buffer.byteLength(modelContent),
      sha256: sha256Text(modelContent)
    },
    licenseNotices: "licenses/THIRD_PARTY_NOTICES.md"
  };

  if (options.modelContent === undefined) {
    manifest.model.sizeBytes = testModelCandidate.sizeBytes;
    manifest.model.sha256 = testModelCandidate.sha256;
  }

  if (options.release !== null && options.release !== undefined) {
    manifest.release = options.release;
  }

  writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

function modelReleaseMetadata() {
  return {
    repo: MODEL_CANDIDATE.repo,
    baseModelRepo: MODEL_CANDIDATE.baseModelRepo,
    file: MODEL_CANDIDATE.file,
    revision: MODEL_CANDIDATE.revision,
    license: MODEL_CANDIDATE.license,
    licenseUrl: MODEL_CANDIDATE.licenseUrl,
    format: MODEL_CANDIDATE.format,
    quantization: MODEL_CANDIDATE.quantization,
    sizeBytes: testModelCandidate.sizeBytes,
    sha256: testModelCandidate.sha256
  };
}

function runtimeReleaseMetadata() {
  return {
    name: RUNTIME_CANDIDATE.name,
    repo: RUNTIME_CANDIDATE.repo,
    releaseTag: RUNTIME_CANDIDATE.releaseTag,
    commit: RUNTIME_CANDIDATE.commit,
    assetName: RUNTIME_CANDIDATE.assetName,
    assetSizeBytes: RUNTIME_CANDIDATE.assetSizeBytes,
    assetSha256: RUNTIME_CANDIDATE.assetSha256,
    platform: RUNTIME_CANDIDATE.platform,
    backend: RUNTIME_CANDIDATE.backend,
    license: RUNTIME_CANDIDATE.license,
    licenseUrl: RUNTIME_CANDIDATE.licenseUrl
  };
}

function writeFile(path: string, content: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function sha256Text(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSafeOutput(value: unknown, forbiddenValues: string[]) {
  const text = JSON.stringify(value);

  assert.doesNotMatch(text, /[A-Za-z]:\\/);
  assert.doesNotMatch(text, /Authorization/i);
  assert.doesNotMatch(text, /Bearer/i);
  assert.doesNotMatch(text, /api[_-]?key/i);
  assert.doesNotMatch(text, /SECRET_PROMPT_TEXT/);
  assert.doesNotMatch(text, /REQUEST_BODY_TEXT/);
  assert.doesNotMatch(text, /USER_MESSAGE_TEXT/);
  assert.doesNotMatch(text, /ASSISTANT_MESSAGE_TEXT/);
  assert.doesNotMatch(text, /FACT_CARD_TEXT/);

  for (const forbidden of forbiddenValues) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
}
