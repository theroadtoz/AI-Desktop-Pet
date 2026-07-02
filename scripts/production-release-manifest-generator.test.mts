import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProductionReleaseChecklist } from "./p2-20q-production-release-checklist-audit.mjs";
import { generateProductionReleaseManifest } from "./p2-20r-production-release-manifest-generator.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-20r-tests");

test("default fixture writes manifest and checksum while P2-20Q remains blocked", async () => {
  const workRoot = join(testRoot, "default-blocked", "work");
  const outputRoot = join(workRoot, "release");
  const result = await generateProductionReleaseManifest({
    repoRoot,
    workRoot,
    outputRoot,
    keepTmp: true,
    buildTimeUtc: "2026-07-02T00:00:00.000Z",
    commit: "abc1234"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.summary.productionReadyClaim, false);
  assert.equal(existsSync(join(outputRoot, "release-manifest.json")), true);
  assert.equal(existsSync(join(outputRoot, "SHA256SUMS.txt")), true);

  const audit = auditProductionReleaseChecklist({
    repoRoot,
    releaseManifestPath: join(outputRoot, "release-manifest.json"),
    env: {}
  });

  assert.equal(audit.status, "blocked");
  assert.equal(audit.checks.artifact_integrity.status, "ready");
  assert.equal(audit.checks.sha256sums_alignment.status, "ready");
  assert.match(audit.blockers.join(","), /production_signing_missing/);
  assert.match(audit.blockers.join(","), /github_release_missing/);
  assert.match(audit.blockers.join(","), /production_attestation_missing/);
  assert.match(audit.blockers.join(","), /production_legal_review_not_approved/);
});

test("generated checksum aligns with fixture artifact hash and size", async () => {
  const workRoot = join(testRoot, "checksum-align", "work");
  const outputRoot = join(workRoot, "release");
  await generateProductionReleaseManifest({
    repoRoot,
    workRoot,
    outputRoot,
    keepTmp: true,
    buildTimeUtc: "2026-07-02T00:00:00.000Z",
    commit: "abc1234"
  });
  const manifest = JSON.parse(readFileSync(join(outputRoot, "release-manifest.json"), "utf8"));
  const checksumsText = readFileSync(join(outputRoot, "SHA256SUMS.txt"), "utf8");
  const artifactPath = join(workRoot, "fixture-artifact", manifest.artifactName);
  const artifactHash = sha256(readFileSync(artifactPath));

  assert.equal(manifest.sha256, artifactHash);
  assert.equal(manifest.sizeBytes, statSync(artifactPath).size);
  assert.match(checksumsText, new RegExp(`^${manifest.sha256}  ${escapeRegExp(manifest.artifactName)}\\r?$`, "m"));
  assert.deepEqual(manifest.checksums.entries, [
    {
      name: manifest.artifactName,
      sha256: manifest.sha256,
      sizeBytes: manifest.sizeBytes
    }
  ]);
});

test("safe fake complete evidence creates a P2-20Q-ready manifest shape", async () => {
  const workRoot = join(testRoot, "fake-ready", "work");
  const outputRoot = join(workRoot, "release");
  const artifactName = "AI Desktop Pet-Setup-1.0.0-x64.exe";
  const result = await generateProductionReleaseManifest({
    repoRoot,
    workRoot,
    outputRoot,
    keepTmp: true,
    fakeReadyEvidence: true,
    version: "1.0.0",
    artifactName,
    buildTimeUtc: "2026-07-02T00:00:00.000Z",
    commit: "abc1234"
  });
  const manifest = JSON.parse(readFileSync(join(outputRoot, "release-manifest.json"), "utf8"));
  const audit = auditProductionReleaseChecklist({
    repoRoot,
    releaseManifestPath: join(outputRoot, "release-manifest.json"),
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig(),
    gitTrackedFiles: ["package.json", "scripts/p2-20r-production-release-manifest-generator.mjs"],
    env: {}
  });

  assert.equal(result.status, "warning");
  assert.equal(manifest.productionReadyClaim, false);
  assert.equal(manifest.githubRelease.assets[0].name, artifactName);
  assert.equal(manifest.githubRelease.assets[0].sha256, manifest.sha256);
  assert.equal(manifest.attestation.subjectSha256, manifest.sha256);
  assert.equal(audit.status, "ready");
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.blockers, []);
});

test("unsafe artifact names and output outside repo tmp are rejected", async () => {
  await assert.rejects(
    () => generateProductionReleaseManifest({
      repoRoot,
      workRoot: join(testRoot, "unsafe-name", "work"),
      artifactName: "../bad.exe"
    }),
    /p2_20r_artifact_name_not_basename/
  );

  await assert.rejects(
    () => generateProductionReleaseManifest({
      repoRoot,
      workRoot: join(testRoot, "unsafe-output", "work"),
      outputRoot: join(repoRoot, "release-output")
    }),
    /p2_20r_output_root_outside_repo_tmp/
  );

  await assert.rejects(
    () => generateProductionReleaseManifest({
      repoRoot,
      workRoot: join(testRoot, "env-local", "work"),
      artifactPath: join(repoRoot, ".env.local")
    }),
    /p2_20r_artifact_path_forbidden/
  );
});

test("summary and manifest do not leak paths or sensitive text", async () => {
  const root = join(testRoot, "safe-output");
  const artifactPath = join(root, "input", "AI Desktop Pet-Setup-0.0.0-x64.exe");
  const outputRoot = join(root, "work", "release");

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    "SECRET_PROMPT_TEXT REQUEST_BODY_TEXT USER_MESSAGE_TEXT ASSISTANT_MESSAGE_TEXT FACT_CARD_TEXT DO_NOT_LEAK_TEST_API_KEY_VALUE\n",
    "utf8"
  );

  const result = await generateProductionReleaseManifest({
    repoRoot,
    workRoot: join(root, "work"),
    outputRoot,
    artifactPath,
    keepTmp: true,
    signing: {
      publisher: "DO_NOT_LEAK_TEST_API_KEY_VALUE"
    },
    model: {
      repo: "SECRET_PROMPT_TEXT",
      file: "../model.gguf"
    },
    notices: {
      file: "../FACT_CARD_TEXT.md"
    },
    buildTimeUtc: "2026-07-02T00:00:00.000Z",
    commit: "abc1234"
  });
  const manifestText = readFileSync(join(outputRoot, "release-manifest.json"), "utf8");
  const checksumsText = readFileSync(join(outputRoot, "SHA256SUMS.txt"), "utf8");
  const safeOutput = JSON.stringify({
    summary: result.summary,
    manifestText,
    checksumsText
  });

  assert.equal(result.status, "blocked");
  assert.doesNotMatch(safeOutput, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(safeOutput, new RegExp(escapeRegExp(root)));

  for (const forbidden of [
    /SECRET_PROMPT_TEXT/,
    /REQUEST_BODY_TEXT/,
    /USER_MESSAGE_TEXT/,
    /ASSISTANT_MESSAGE_TEXT/,
    /FACT_CARD_TEXT/,
    /DO_NOT_LEAK_TEST_API_KEY_VALUE/
  ]) {
    assert.doesNotMatch(safeOutput, forbidden);
  }
});

test("default cleanup removes this run's fixture output", async () => {
  const workRoot = join(testRoot, "cleanup-default", "work");
  const result = await generateProductionReleaseManifest({
    repoRoot,
    workRoot,
    buildTimeUtc: "2026-07-02T00:00:00.000Z",
    commit: "abc1234"
  });

  assert.equal(result.summary.cleanup.tmp, "removed");
  assert.equal(existsSync(workRoot), false);
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

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

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
