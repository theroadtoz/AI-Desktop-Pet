import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { approvedMotionResourceIntake } from "./p2-65-approved-motion-intake.mts";

type FixtureEntry = {
  id: string;
  sourcePath: string;
  targetPath: string;
};

type Fixture = {
  candidateRoot: string;
  repositoryRoot: string;
  manifestPath: string;
  registryPath: string;
  runtimeCatalogPath: string;
  entries: FixtureEntry[];
};

function fixtureRoot(label: string): string {
  const root = join(tmpdir(), `p2-65-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function motion(): Record<string, unknown> {
  return {
    Version: 3,
    Meta: { Duration: 1.2, Fps: 60, Loop: false, CurveCount: 1, TotalSegmentCount: 1, TotalPointCount: 2 },
    Curves: [{ Target: "Parameter", Id: "ParamAngleX", Segments: [0, 0, 0, 1.2, 5] }]
  };
}

function preset(id: string, path: string): Record<string, unknown> {
  return {
    id,
    path,
    semanticKind: "reaction",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: 1.2,
    priority: 20,
    cooldownMs: 800,
    restorePolicy: "restore-expression-pose-accessory",
    allowedStates: ["idle"],
    allowedPresenceModes: ["default", "focus", "quiet"],
    allowedDialogueModes: ["default", "work", "game", "reading"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided",
    licenseEvidence: "AUTHORIZATION.txt"
  };
}

function createFixture(): Fixture {
  const candidateRoot = fixtureRoot("candidate");
  const repositoryRoot = fixtureRoot("product");
  const manifestPath = join(repositoryRoot, "resources", "models", "witch", "model-manifest.json");
  const registryPath = join(repositoryRoot, "resources", "models", "witch", "motion-intake-metadata.json");
  const runtimeCatalogPath = join(repositoryRoot, "src", "shared", "approved-motion-presets.ts");
  const definitions = ["happy-small", "surprised-small", "flustered-small"];
  const entries: FixtureEntry[] = [];

  mkdirSync(join(repositoryRoot, "resources", "models", "witch", "motions"), { recursive: true });
  mkdirSync(join(repositoryRoot, "model"), { recursive: true });
  mkdirSync(join(repositoryRoot, "src", "shared"), { recursive: true });
  writeJson(join(repositoryRoot, "model", "魔女.cdi3.json"), { Parameters: [{ Id: "ParamAngleX" }] });
  writeJson(manifestPath, { id: "witch", motionPresets: [] });
  writeJson(registryPath, { registryVersion: 1, modelId: "witch", entries: [] });
  writeFileSync(runtimeCatalogPath, "export const APPROVED_MOTION_PRESETS = Object.freeze([]);\n", "utf8");

  const approvedEntries = definitions.map((id) => {
    const candidateDirectory = `candidates/${id}`;
    const sourceRelativePath = `${candidateDirectory}/motions/${id}.motion3.json`;
    const targetPath = `motions/${id}.motion3.json`;
    const sourcePath = join(candidateRoot, ...sourceRelativePath.split("/"));
    mkdirSync(join(candidateRoot, ...candidateDirectory.split("/"), "motions"), { recursive: true });
    writeJson(sourcePath, motion());
    writeFileSync(join(candidateRoot, ...candidateDirectory.split("/"), "AUTHORIZATION.txt"), "Explicit user authorization.\n", "utf8");
    writeJson(join(candidateRoot, ...candidateDirectory.split("/"), "motion-intake.json"), { intakeVersion: 1, preset: preset(id, `motions/${id}.motion3.json`) });
    entries.push({ id, sourcePath, targetPath: join(repositoryRoot, "resources", "models", "witch", ...targetPath.split("/")) });
    return {
      candidateDirectory,
      sourcePath: sourceRelativePath,
      targetPath,
      expectedSha256: hash(sourcePath),
      exception: { intakeStatus: "user-authorized-vts-draft", userVisualReview: "passed", cubismRefined: false, runtimeEnabled: true }
    };
  });

  writeJson(join(candidateRoot, "approved-motion-intake.json"), {
    intakeVersion: 1,
    modelId: "witch",
    authorization: "explicit-user-source-target-exception",
    entries: approvedEntries
  });
  return { candidateRoot, repositoryRoot, manifestPath, registryPath, runtimeCatalogPath, entries };
}

function productSnapshot(fixture: Fixture): Record<string, string> {
  return {
    manifest: readFileSync(fixture.manifestPath, "utf8"),
    registry: readFileSync(fixture.registryPath, "utf8"),
    runtimeCatalog: readFileSync(fixture.runtimeCatalogPath, "utf8")
  };
}

function assertProductUnchanged(fixture: Fixture, original: Record<string, string>): void {
  assert.equal(readFileSync(fixture.manifestPath, "utf8"), original.manifest);
  assert.equal(readFileSync(fixture.registryPath, "utf8"), original.registry);
  assert.equal(readFileSync(fixture.runtimeCatalogPath, "utf8"), original.runtimeCatalog);
  for (const entry of fixture.entries) {
    assert.equal(existsSync(entry.targetPath), false);
  }
}

function readRuntimeCatalog(path: string): Array<{ id: string; path: string }> {
  const match = /Object\.freeze\(\n([\s\S]+)\n\);\n$/u.exec(readFileSync(path, "utf8"));
  assert.ok(match);
  return JSON.parse(match[1]) as Array<{ id: string; path: string }>;
}

test("approved intake commits a three-entry asset, manifest, metadata, and runtime-catalog batch", () => {
  const fixture = createFixture();
  try {
    const result = approvedMotionResourceIntake({ candidateRoot: fixture.candidateRoot, repositoryRoot: fixture.repositoryRoot, apply: true });
    assert.equal(result.status, "applied");
    assert.equal(result.productWrites, true);
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    const registry = JSON.parse(readFileSync(fixture.registryPath, "utf8"));
    const catalog = readRuntimeCatalog(fixture.runtimeCatalogPath);
    const expectedIds = fixture.entries.map((entry) => entry.id);
    assert.deepEqual(manifest.motionPresets.map((entry: { id: string }) => entry.id), expectedIds);
    assert.deepEqual(registry.entries.map((entry: { presetId: string }) => entry.presetId), expectedIds);
    assert.deepEqual(catalog.map((entry) => entry.id), expectedIds);
    assert.deepEqual(catalog.map((entry) => entry.path), manifest.motionPresets.map((entry: { path: string }) => entry.path));
    for (const entry of fixture.entries) {
      assert.equal(hash(entry.sourcePath), hash(entry.targetPath));
    }
    assert.equal(registry.entries.every((entry: { intakeStatus: string; cubismRefined: boolean }) => entry.intakeStatus === "user-authorized-vts-draft" && entry.cubismRefined === false), true);
  } finally {
    rmSync(fixture.candidateRoot, { recursive: true, force: true });
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("approved intake rejects an invalid three-entry batch without changing product files", () => {
  const fixture = createFixture();
  try {
    const approvedPath = join(fixture.candidateRoot, "approved-motion-intake.json");
    const approved = JSON.parse(readFileSync(approvedPath, "utf8"));
    approved.entries[1].expectedSha256 = "0".repeat(64);
    writeJson(approvedPath, approved);
    const original = productSnapshot(fixture);

    const result = approvedMotionResourceIntake({ candidateRoot: fixture.candidateRoot, repositoryRoot: fixture.repositoryRoot, apply: true });
    assert.equal(result.status, "blocked");
    assert.equal(result.blockers.includes("source-hash-mismatch"), true);
    assertProductUnchanged(fixture, original);
  } finally {
    rmSync(fixture.candidateRoot, { recursive: true, force: true });
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("approved intake restores every product file when staged manifest installation fails after its backup move", () => {
  const fixture = createFixture();
  try {
    const original = productSnapshot(fixture);
    const result = approvedMotionResourceIntake({
      candidateRoot: fixture.candidateRoot,
      repositoryRoot: fixture.repositoryRoot,
      apply: true,
      fileOperations: {
        renameSync(source, target) {
          if (target === fixture.manifestPath && basename(source) === "model-manifest.json" && source !== fixture.manifestPath) {
            throw new Error("deterministic staged manifest move failure");
          }
          renameSync(source, target);
        }
      }
    });
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["apply-failed"]);
    assertProductUnchanged(fixture, original);
  } finally {
    rmSync(fixture.candidateRoot, { recursive: true, force: true });
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("approved intake rejects a motions junction that resolves outside the managed root", () => {
  const fixture = createFixture();
  const outsideRoot = fixtureRoot("outside");
  try {
    const motionsPath = join(fixture.repositoryRoot, "resources", "models", "witch", "motions");
    rmSync(motionsPath, { recursive: true, force: true });
    symlinkSync(outsideRoot, motionsPath, "junction");
    const original = productSnapshot(fixture);

    const result = approvedMotionResourceIntake({ candidateRoot: fixture.candidateRoot, repositoryRoot: fixture.repositoryRoot, apply: true });
    assert.equal(result.status, "blocked");
    assert.equal(result.blockers.includes("unsafe-target-path"), true);
    assertProductUnchanged(fixture, original);
  } finally {
    rmSync(fixture.candidateRoot, { recursive: true, force: true });
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});
