import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dryRunMotionResourceIntake } from "./p2-52-motion-resource-dry-run-intake.mts";

function makeFixture(): string {
  const root = join(tmpdir(), `p2-52-motion-intake-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "motions"), { recursive: true });
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validPreset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "soft-greeting",
    path: "motions/soft-greeting.motion3.json",
    semanticKind: "greeting",
    loop: false,
    fadeInSeconds: 0.2,
    fadeOutSeconds: 0.4,
    durationHintSeconds: 1.8,
    priority: 8,
    cooldownMs: 5000,
    restorePolicy: "restore-expression-pose-accessory",
    allowedStates: ["greet"],
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided",
    licenseEvidence: "LICENSE.txt",
    ...overrides
  };
}

function validMotion(): Record<string, unknown> {
  return {
    Version: 3,
    Meta: {
      Duration: 1.8,
      Fps: 60,
      Loop: false,
      CurveCount: 1,
      TotalSegmentCount: 1,
      TotalPointCount: 2
    },
    Curves: [
      {
        Target: "Parameter",
        Id: "ParamAngleX",
        Segments: [0, 0, 0, 1.8, 10]
      }
    ]
  };
}

test("motion intake returns a safe blocked summary when no candidate root is configured", () => {
  const previousRoot = process.env.AI_DESKTOP_PET_MOTION_INTAKE_ROOT;
  delete process.env.AI_DESKTOP_PET_MOTION_INTAKE_ROOT;

  try {
    const summary = dryRunMotionResourceIntake();

    assert.equal(summary.safeSummaryOnly, true);
    assert.equal(summary.dryRunOnly, true);
    assert.equal(summary.productManifestChanged, false);
    assert.equal(summary.runtimeCatalogChanged, false);
    assert.equal(summary.status, "blocked");
    assert.deepEqual(summary.blockers, ["missing-intake-root"]);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.AI_DESKTOP_PET_MOTION_INTAKE_ROOT;
    } else {
      process.env.AI_DESKTOP_PET_MOTION_INTAKE_ROOT = previousRoot;
    }
  }
});

test("motion intake marks a valid user-provided fixture ready for manifest review only", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), validMotion());

    const summary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(summary.status, "ready-for-manifest-review");
    assert.equal(summary.safeSummaryOnly, true);
    assert.equal(summary.dryRunOnly, true);
    assert.equal(summary.productManifestChanged, false);
    assert.equal(summary.runtimeCatalogChanged, false);
    assert.equal(summary.candidateRootBasename, root.split(/[\\/]/u).at(-1));
    assert.equal(summary.candidateFileBasename, "soft-greeting.motion3.json");
    assert.equal(summary.presetId, "soft-greeting");
    assert.equal(summary.semanticKind, "greeting");
    assert.equal(summary.durationSeconds, 1.8);
    assert.equal(summary.loop, false);
    assert.equal(summary.metaLoop, false);
    assert.equal(summary.parameterCount, 1);
    assert.match(summary.hashPrefix ?? "", /^[a-f0-9]{12}$/u);
    assert.deepEqual(summary.blockers, []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake safely blocks semantic motions longer than 60 seconds", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");

    const motion = validMotion();
    motion.Meta = {
      ...(motion.Meta as Record<string, unknown>),
      Duration: 60.001
    };
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), motion);

    const summary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(summary.status, "blocked");
    assert.equal(summary.safeSummaryOnly, true);
    assert.equal(summary.durationSeconds, 60.001);
    assert.deepEqual(summary.blockers, ["motion-duration-exceeds-safe-limit"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake blocks reference-only and missing-license statuses", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset({
        assetLicenseStatus: "official-sample-reference-only",
        licenseEvidence: "LICENSE.txt"
      })
    });
    writeFileSync(join(root, "LICENSE.txt"), "Reference only.\n", "utf8");
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), validMotion());

    const referenceOnly = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(referenceOnly.status, "blocked");
    assert.deepEqual(referenceOnly.blockers, ["blocked-license"]);

    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset({
        assetLicenseStatus: "blocked-missing-license"
      })
    });

    const missingLicense = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(missingLicense.status, "blocked");
    assert.deepEqual(missingLicense.blockers, ["blocked-license"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake blocks unsafe paths and does not leak raw motion output", () => {
  const root = makeFixture();
  const absoluteMotionPath = join(root, "motions", "soft-greeting.motion3.json");

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset({
        path: absoluteMotionPath,
        licenseEvidence: "../LICENSE.txt"
      })
    });

    const summaryText = JSON.stringify(dryRunMotionResourceIntake({ candidateRoot: root }));

    assert.equal(summaryText.includes(root), false);
    assert.equal(summaryText.includes(absoluteMotionPath), false);
    assert.equal(summaryText.includes("Curves"), false);
    assert.equal(summaryText.includes("Segments"), false);
    assert.equal(summaryText.includes("ParamAngleX"), false);
    assert.match(summaryText, /unsafe-motion-path/u);
    assert.match(summaryText, /unsafe-license-evidence-path/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake blocks unsafe state ids and missing motion curves", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset({
        allowedStates: ["greet", "E:\\private\\state"]
      })
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), validMotion());

    const unsafeStateSummaryText = JSON.stringify(dryRunMotionResourceIntake({ candidateRoot: root }));

    assert.match(unsafeStateSummaryText, /invalid-preset/u);
    assert.equal(unsafeStateSummaryText.includes("private"), false);

    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), {
      Version: 3,
      Meta: {
        Duration: 1.8,
        Loop: false
      }
    });

    const missingCurvesSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(missingCurvesSummary.status, "blocked");
    assert.equal(missingCurvesSummary.blockers.includes("invalid-motion-json"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake accepts complete standard Cubism segment encodings", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");

    const motion = validMotion();
    motion.Meta = {
      ...(motion.Meta as Record<string, unknown>),
      TotalSegmentCount: 4,
      TotalPointCount: 7
    };
    (motion.Curves as Array<Record<string, unknown>>)[0].Segments = [
      0, 0,
      1, 0.2, 1, 0.4, 2, 0.6, 3,
      2, 0.8, 4,
      3, 1, 5,
      0, 1.8, 6
    ];
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), motion);

    const summary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(summary.status, "ready-for-manifest-review");
    assert.equal(summary.curveCount, 1);
    assert.equal(summary.segmentCount, 4);
    assert.equal(summary.pointCount, 7);
    assert.deepEqual(summary.blockers, []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake truthfully blocks unsupported versions and Meta count mismatches", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");

    writeJson(join(root, "motions", "soft-greeting.motion3.json"), {
      ...validMotion(),
      Version: 0
    });

    const versionSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(versionSummary.status, "blocked");
    assert.equal(versionSummary.blockers.includes("invalid-motion-version"), true);

    const pointMismatchMotion = validMotion();
    pointMismatchMotion.Meta = {
      ...(pointMismatchMotion.Meta as Record<string, unknown>),
      TotalPointCount: 3
    };
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), pointMismatchMotion);

    const pointMismatchSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(pointMismatchSummary.status, "blocked");
    assert.equal(pointMismatchSummary.blockers.includes("motion-meta-count-mismatch"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake truthfully blocks malformed and non-finite segment encodings", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");

    const badSegmentMotion = validMotion();
    (badSegmentMotion.Curves as Array<Record<string, unknown>>)[0].Segments = [0, 0];
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), badSegmentMotion);

    const initialPointOnlySummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(initialPointOnlySummary.status, "blocked");
    assert.equal(initialPointOnlySummary.blockers.includes("invalid-motion-segments"), true);

    (badSegmentMotion.Curves as Array<Record<string, unknown>>)[0].Segments = [0, 0, 9, 1.8, 10];
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), badSegmentMotion);

    const badSegmentSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(badSegmentSummary.status, "blocked");
    assert.equal(badSegmentSummary.blockers.includes("invalid-motion-segments"), true);

    const truncatedSegmentMotion = validMotion();
    (truncatedSegmentMotion.Curves as Array<Record<string, unknown>>)[0].Segments = [0, 0, 1, 0.2, 1];
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), truncatedSegmentMotion);

    const truncatedSegmentSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(truncatedSegmentSummary.status, "blocked");
    assert.equal(truncatedSegmentSummary.blockers.includes("invalid-motion-segments"), true);

    const finiteMotionText = JSON.stringify(validMotion()).replace("[0,0,0,1.8,10]", "[0,0,0,1.8,1e400]");
    writeFileSync(join(root, "motions", "soft-greeting.motion3.json"), finiteMotionText, "utf8");

    const infinitySummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(infinitySummary.status, "blocked");
    assert.equal(infinitySummary.blockers.includes("invalid-motion-segments"), true);

    const nanMotionText = JSON.stringify(validMotion()).replace("[0,0,0,1.8,10]", "[0,0,0,1.8,NaN]");
    writeFileSync(join(root, "motions", "soft-greeting.motion3.json"), nanMotionText, "utf8");

    const nanSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(nanSummary.status, "blocked");
    assert.equal(nanSummary.blockers.includes("invalid-motion-json"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("motion intake truthfully blocks non-monotonic and out-of-duration segment times", () => {
  const root = makeFixture();

  try {
    writeJson(join(root, "motion-intake.json"), {
      intakeVersion: 1,
      preset: validPreset()
    });
    writeFileSync(join(root, "LICENSE.txt"), "User provided evidence.\n", "utf8");

    const nonMonotonicMotion = validMotion();
    nonMonotonicMotion.Meta = {
      ...(nonMonotonicMotion.Meta as Record<string, unknown>),
      TotalSegmentCount: 2,
      TotalPointCount: 3
    };
    (nonMonotonicMotion.Curves as Array<Record<string, unknown>>)[0].Segments = [
      0, 0,
      0, 1.2, 10,
      0, 0.8, 5
    ];
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), nonMonotonicMotion);

    const nonMonotonicSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(nonMonotonicSummary.status, "blocked");
    assert.equal(nonMonotonicSummary.blockers.includes("invalid-motion-segment-time"), true);

    const outOfDurationMotion = validMotion();
    (outOfDurationMotion.Curves as Array<Record<string, unknown>>)[0].Segments = [0, 0, 0, 1.81, 10];
    writeJson(join(root, "motions", "soft-greeting.motion3.json"), outOfDurationMotion);

    const outOfDurationSummary = dryRunMotionResourceIntake({ candidateRoot: root });

    assert.equal(outOfDurationSummary.status, "blocked");
    assert.equal(outOfDurationSummary.blockers.includes("invalid-motion-segment-time"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
