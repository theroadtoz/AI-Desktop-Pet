import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProductionReleaseChecklist } from "./p2-20q-production-release-checklist-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-20q-tests");
const ARTIFACT_NAME = "AI Desktop Pet-Setup-1.0.0-x64.exe";
const ARTIFACT_SHA = "a".repeat(64);
const MODEL_SHA = "b".repeat(64);
const RUNTIME_SHA = "c".repeat(64);

test("default repo summary is blocked and safe", () => {
  const result = auditProductionReleaseChecklist({
    repoRoot,
    env: {}
  });
  const output = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.match(result.blockers.join(","), /production_release_manifest_missing/);
  assert.match(result.blockers.join(","), /github_release_missing/);
  assert.match(result.blockers.join(","), /production_signing_missing/);
  assert.match(result.blockers.join(","), /production_attestation_missing/);
  assert.match(result.blockers.join(","), /production_legal_review_not_approved/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
});

test("complete fake release manifest can produce ready", () => {
  const manifestPath = writeManifest("ready", completeManifest());
  const result = auditProductionReleaseChecklist({
    repoRoot,
    releaseManifestPath: manifestPath,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig(),
    gitTrackedFiles: ["package.json", "scripts/p2-20q-production-release-checklist-audit.mjs"],
    env: {}
  });

  assert.equal(result.status, "ready");
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.releaseManifest.basename, "release-manifest.json");
  assert.equal(result.checks.github_release.url, "https://github.com/example/repo/releases/tag/v1.0.0");
});

test("pending legal review keeps production checklist blocked", () => {
  const manifestPath = writeManifest("pending-legal", completeManifest({
    legalReviewStatus: "pending"
  }));
  const result = auditReadyLike(manifestPath);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /production_legal_review_not_approved/);
});

test("SmartScreen pass claim without distribution evidence is blocked", () => {
  const manifestPath = writeManifest("smartscreen-passed", completeManifest({
    smartScreenClaim: "passed"
  }));
  const result = auditReadyLike(manifestPath);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /smartscreen_claim_not_supported_by_evidence/);
});

test("missing attestation or GitHub Release evidence is blocked", () => {
  const missingReleasePath = writeManifest("missing-release", completeManifest({
    githubRelease: undefined
  }));
  const missingRelease = auditReadyLike(missingReleasePath);

  assert.equal(missingRelease.status, "blocked");
  assert.match(missingRelease.blockers.join(","), /github_release_missing/);

  const missingAttestationPath = writeManifest("missing-attestation", completeManifest({
    attestation: undefined
  }));
  const missingAttestation = auditReadyLike(missingAttestationPath);

  assert.equal(missingAttestation.status, "blocked");
  assert.match(missingAttestation.blockers.join(","), /production_attestation_missing/);
});

test("hash and checksum mismatch is blocked", () => {
  const manifest = completeManifest({
    checksums: {
      file: "SHA256SUMS.txt",
      entries: [
        {
          name: ARTIFACT_NAME,
          sha256: "d".repeat(64),
          sizeBytes: 123
        }
      ]
    }
  });
  const manifestPath = writeManifest("checksum-mismatch", manifest);
  const result = auditReadyLike(manifestPath);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /sha256sums_sha256_mismatch/);
  assert.match(result.blockers.join(","), /sha256sums_size_mismatch/);
});

test("unsafe local paths and sensitive text in release manifest are blocked without leaking values", () => {
  const manifestPath = writeManifest("unsafe-sensitive", completeManifest({
    buildLogPath: "E:\\secret\\release.log",
    releaseNotes: {
      promptText: "SECRET_PROMPT_TEXT",
      requestBody: "REQUEST_BODY_TEXT",
      userMessage: "USER_MESSAGE_TEXT",
      assistantMessage: "ASSISTANT_MESSAGE_TEXT",
      factCardBody: "FACT_CARD_TEXT",
      apiKey: "DO_NOT_LEAK_TEST_API_KEY_VALUE"
    }
  }));
  const result = auditReadyLike(manifestPath);
  const output = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /privacy_local_path_leak/);
  assert.match(result.blockers.join(","), /privacy_secret_leak/);
  assert.match(result.blockers.join(","), /privacy_model_input_leak/);
  assert.match(result.blockers.join(","), /privacy_request_payload_leak/);
  assert.match(result.blockers.join(","), /privacy_conversation_body_leak/);
  assert.match(result.blockers.join(","), /privacy_fact_body_leak/);
  assert.doesNotMatch(output, /E:\\secret\\release\.log/);
  assert.doesNotMatch(output, /DO_NOT_LEAK_TEST_API_KEY_VALUE/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
  assert.doesNotMatch(output, /REQUEST_BODY_TEXT/);
  assert.doesNotMatch(output, /USER_MESSAGE_TEXT/);
  assert.doesNotMatch(output, /ASSISTANT_MESSAGE_TEXT/);
  assert.doesNotMatch(output, /FACT_CARD_TEXT/);
});

test("tracked heavy or generated artifacts are blocked through injectable git file list", () => {
  const manifestPath = writeManifest("tracked-heavy", completeManifest());
  const result = auditProductionReleaseChecklist({
    repoRoot,
    releaseManifestPath: manifestPath,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig(),
    gitTrackedFiles: [
      "package.json",
      "dist/AI Desktop Pet-Setup-1.0.0-x64.exe",
      "resources/local-llm/models/model.gguf",
      ".tmp/p2-20q/release-manifest.json"
    ],
    env: {}
  });
  const output = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /tracked_heavy_generated_artifacts/);
  assert.deepEqual(result.checks.tracked_artifacts.trackedHeavyArtifactBasenames, [
    "AI Desktop Pet-Setup-1.0.0-x64.exe",
    "model.gguf",
    "release-manifest.json"
  ]);
  assert.doesNotMatch(output, /resources\/local-llm\/models/);
  assert.doesNotMatch(output, /\.tmp\/p2-20q/);
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function auditReadyLike(manifestPath: string) {
  return auditProductionReleaseChecklist({
    repoRoot,
    releaseManifestPath: manifestPath,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig(),
    gitTrackedFiles: ["package.json"],
    env: {}
  });
}

function writeManifest(name: string, manifest: Record<string, unknown>) {
  const root = join(testRoot, name);
  const manifestPath = join(root, "release-manifest.json");

  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(removeUndefined(manifest), null, 2)}\n`, "utf8");

  return manifestPath;
}

function completeManifest(overrides: Record<string, unknown> = {}) {
  return {
    appName: "AI Desktop Pet",
    version: "1.0.0",
    commit: "abc1234",
    buildTimeUtc: "2026-07-02T00:00:00.000Z",
    artifactName: ARTIFACT_NAME,
    artifactKind: "nsis-installer",
    target: "nsis",
    arch: "x64",
    sha256: ARTIFACT_SHA,
    sizeBytes: 456_789,
    signed: true,
    signingStatus: "signed_timestamped_verified",
    publisher: "Example Publisher",
    timestamped: true,
    smartScreenClaim: "not_claimed",
    githubRelease: {
      url: "https://github.com/example/repo/releases/tag/v1.0.0",
      tag: "v1.0.0",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: ARTIFACT_NAME,
          sha256: ARTIFACT_SHA,
          sizeBytes: 456_789
        }
      ]
    },
    attestation: {
      status: "verified",
      url: "https://github.com/example/repo/attestations/1",
      subjectSha256: ARTIFACT_SHA,
      predicateType: "https://slsa.dev/provenance/v1"
    },
    legalReviewStatus: "approved",
    notices: {
      file: "THIRD_PARTY_NOTICES.md",
      included: true
    },
    model: {
      repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
      file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
      license: "Apache-2.0",
      sha256: MODEL_SHA,
      sizeBytes: 1_117_320_736
    },
    runtime: {
      name: "llama.cpp",
      license: "MIT",
      releaseTag: "b9859",
      sha256: RUNTIME_SHA,
      sizeBytes: 17_478_474
    },
    checksums: {
      file: "SHA256SUMS.txt",
      entries: [
        {
          name: ARTIFACT_NAME,
          sha256: ARTIFACT_SHA,
          sizeBytes: 456_789
        }
      ]
    },
    privacyRedaction: {
      localPaths: "forbidden",
      apiKeys: "forbidden",
      prompts: "forbidden",
      conversationText: "forbidden",
      userMemoryText: "forbidden"
    },
    ...overrides
  };
}

function readyPackageJson() {
  return {
    name: "ai-desktop-pet",
    version: "1.0.0",
    license: "MIT",
    scripts: {
      "package:win:nsis": "npm run build && electron-builder --win nsis --config electron-builder.config.cjs --publish never"
    }
  };
}

function readyBuilderConfig() {
  return {
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
    },
    nsis: {
      artifactName: "${productName}-Setup-${version}-${arch}.${ext}"
    },
    portable: {
      artifactName: "${productName}-Portable-${version}-${arch}.${ext}"
    }
  };
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
