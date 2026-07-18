import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  ABSENT_PROTECTED_PATH,
  decodePng,
  encodeRgbaPng,
  hashProtectedPaths,
  protectedHashesEqual
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";
import {
  cleanupReviewArtifacts,
  finalizeReviewSummary,
  GREET_SMALL_ALLOWLIST,
  GREET_SMALL_PROTECTED_PATHS,
  injectGreetMotionPreset,
  injectGreetNativeLifecycleProbe,
  injectGreetOwnershipProbe,
  injectGreetPlayerLifecycleProbe,
  injectGreetReviewAction,
  injectGreetReviewTrigger,
  isProductionWorkspacePath,
  parseRunnerArgs,
  readCandidateDraft,
  summarizeFrameEvidence,
  summarizeLifecycle,
  summarizeOwnership,
  validateCandidateIdentity,
  validateCandidateMotion,
  writeContactSheets
} from "./p2-63c-5a-greet-small-runtime-manual-visual-review.mjs";

const CANDIDATE_BASENAME = "greet-small-20260714-145154-050.motion3.json";
const CANDIDATE_SHA256 = "c1aee5391b771f05cbe196703d1df6943964a0ba34418b5cdb79089acae66781";

function makeCurve(id: string, curveIndex: number, pointCount = 92, durationSeconds = 3.4) {
  const segments: number[] = [0, curveIndex / 100];
  for (let point = 1; point <= pointCount; point += 1) {
    segments.push(0, (durationSeconds * point) / pointCount, curveIndex / 100 + point / 1_000);
  }
  return { Target: "Parameter", Id: id, Segments: segments };
}

function makeCandidateMotion() {
  return {
    Version: 3,
    Meta: {
      Duration: 3.4,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: true,
      CurveCount: 10,
      TotalSegmentCount: 920,
      TotalPointCount: 930,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: GREET_SMALL_ALLOWLIST.map((id, index) => makeCurve(id, index)),
    UserData: []
  };
}

function event(stage: string, atMs: number, detail: Record<string, unknown> = {}) {
  return { stage, atMs, runId: "run-1", ...detail };
}

function frameIndex(fps: number) {
  const intervalMs = 1_000 / fps;
  const frameCount = Math.ceil(4_500 / intervalMs) + 1;
  return Array.from({ length: frameCount }, (_, index) => ({
    offsetMs: -500 + index * intervalMs,
    pngValid: true,
    nonTransparentPixels: 1_500
  }));
}

function contactFrames() {
  return Array.from({ length: 46 }, (_, frameNumber) => {
    const pixels = Buffer.alloc(4 * 4 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = frameNumber * 7 % 255;
      pixels[index + 1] = 120;
      pixels[index + 2] = 220;
      pixels[index + 3] = 255;
    }
    const png = encodeRgbaPng(4, 4, pixels);
    return {
      data: png.toString("base64"),
      byteLength: png.length,
      offsetMs: -500 + frameNumber * 100
    };
  });
}

test("CLI requires one absolute pinned candidate and exposes an explicit retention switch", () => {
  const candidate = resolve(tmpdir(), CANDIDATE_BASENAME);
  assert.deepEqual(parseRunnerArgs(["--candidate-draft", candidate]), {
    candidateDraft: candidate,
    retainEvidence: false
  });
  assert.deepEqual(parseRunnerArgs(["--retain-evidence", "--candidate-draft", candidate]), {
    candidateDraft: candidate,
    retainEvidence: true
  });
  assert.throws(() => parseRunnerArgs([]), /candidate-draft-required/u);
  assert.throws(() => parseRunnerArgs(["--candidate-draft", "relative.motion3.json"]), /must-be-absolute/u);
  assert.throws(() => parseRunnerArgs(["--candidate-draft", candidate, "--unknown"]), /invalid-cli/u);
  assert.throws(
    () => parseRunnerArgs(["--candidate-draft", candidate, "--candidate-draft", candidate]),
    /invalid-candidate-draft/u
  );
});

test("candidate identity pins basename, SHA-256, and bytes independently", () => {
  assert.deepEqual(validateCandidateIdentity({
    basename: CANDIDATE_BASENAME,
    sha256: CANDIDATE_SHA256,
    byteLength: 59_849
  }), { passed: true, blockers: [] });
  assert.deepEqual(validateCandidateIdentity({
    basename: "greet-small-20260714-114327-647.motion3.json",
    sha256: "f456d88757ab7650631364f201fb43812332d903599ef4bc4f751d193ca87bfa",
    byteLength: 40_675
  }).blockers, [
    "candidate-filename-not-allowed",
    "candidate-sha256-mismatch",
    "candidate-byte-length-mismatch"
  ]);
});

test("candidate loader rejects old names, wrong hashes, production paths, and reparse files before UI launch", (t) => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-5a-input-"));
  try {
    const wrongName = join(root, "greet-small-old.motion3.json");
    writeFileSync(wrongName, "{}", "utf8");
    assert.throws(() => readCandidateDraft(wrongName), /filename-not-allowed/u);

    const wrongHash = join(root, CANDIDATE_BASENAME);
    writeFileSync(wrongHash, JSON.stringify(makeCandidateMotion()), "utf8");
    assert.throws(() => readCandidateDraft(wrongHash), /sha256-mismatch/u);

    assert.equal(isProductionWorkspacePath(resolve("model", CANDIDATE_BASENAME)), true);
    assert.equal(isProductionWorkspacePath(wrongHash), false);

    const target = join(root, "target.motion3.json");
    const linkRoot = join(root, "linked");
    mkdirSync(linkRoot);
    writeFileSync(target, "{}", "utf8");
    const link = join(linkRoot, CANDIDATE_BASENAME);
    try {
      symlinkSync(target, link, "file");
      assert.throws(() => readCandidateDraft(link), /reparse-path-rejected/u);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") t.diagnostic("symlink privilege unavailable");
      else throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows candidate gate rejects an intermediate directory junction by reparse attribute", {
  skip: process.platform !== "win32"
}, () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-5a-junction-"));
  try {
    const targetDir = join(root, "target");
    const junctionDir = join(root, "junction");
    mkdirSync(targetDir);
    writeFileSync(join(targetDir, CANDIDATE_BASENAME), "{}", "utf8");
    symlinkSync(targetDir, junctionDir, "junction");
    assert.throws(
      () => readCandidateDraft(join(junctionDir, CANDIDATE_BASENAME)),
      /candidate-reparse-path-rejected/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Motion3 gate accepts exactly 10 approved curves and rejects timing or ownership drift", () => {
  const motion = makeCandidateMotion();
  const validated = validateCandidateMotion(motion, GREET_SMALL_ALLOWLIST);
  assert.equal(validated.status, "validated");
  assert.deepEqual(validated.motion, motion);
  assert.deepEqual(validated.structure, {
    version: 3,
    durationSeconds: 3.4,
    fps: 30,
    loop: false,
    curveCount: 10,
    segmentCount: 920,
    pointCount: 930,
    consistencyCheck: true,
    semanticMotionVariation: true,
    variedParameterCount: 10,
    variedParameterIds: [...GREET_SMALL_ALLOWLIST].sort()
  });

  const oldV1Motion = structuredClone(motion);
  oldV1Motion.Meta.Duration = 2.4;
  oldV1Motion.Meta.TotalSegmentCount = 620;
  oldV1Motion.Meta.TotalPointCount = 630;
  oldV1Motion.Curves = GREET_SMALL_ALLOWLIST.map((id, index) => makeCurve(id, index, 62, 2.4));
  assert.deepEqual(validateCandidateMotion(oldV1Motion, GREET_SMALL_ALLOWLIST).blockers, [
    "unexpected-duration",
    "unexpected-point-count",
    "unexpected-segment-count"
  ]);

  const missingCurve = structuredClone(motion);
  missingCurve.Curves.pop();
  missingCurve.Meta.CurveCount = 9;
  missingCurve.Meta.TotalSegmentCount = 828;
  missingCurve.Meta.TotalPointCount = 837;
  assert.match(validateCandidateMotion(missingCurve, GREET_SMALL_ALLOWLIST).blockers?.join(",") ?? "", /allowlist-id-not-present/u);

  const extra = structuredClone(motion);
  extra.Curves[9].Id = "ParamMouthOpenY";
  assert.match(validateCandidateMotion(extra, [...GREET_SMALL_ALLOWLIST, "ParamMouthOpenY"]).blockers?.join(",") ?? "", /parameter-not-allowlisted/u);
});

test("fixture transforms register a neutral greet-only trigger and observable natural lifecycle", () => {
  const preset = injectGreetMotionPreset(readFile("src/shared/pet-motion-presets.ts"));
  assert.match(preset, /const approvedReviewPresetCount = APPROVED_MOTION_PRESETS\.filter\(\(preset\) => preset\.id === "greet-small-review"\)\.length;/u);
  assert.match(preset, /id: "greet-small-review"[\s\S]*semanticKind: "greeting"[\s\S]*allowedStates: \["idle"\]/u);
  assert.match(preset, /\.\.\.APPROVED_MOTION_PRESETS/u);
  assert.doesNotMatch(preset.slice(0, preset.indexOf("},") + 2), /sleep|doze|yawn/u);

  const action = injectGreetReviewAction(readFile("src/renderer/pet/interaction-actions.ts"));
  assert.match(action, /type: "greet-small-review"[\s\S]*emotion: "neutral"[\s\S]*motionPresetId: "greet-small-review"/u);
  const trigger = injectGreetReviewTrigger(readFile("src/renderer/pet/main.ts"));
  assert.match(trigger, /GREET_SMALL_TRIGGER__[\s\S]*greet_small_review[\s\S]*stateId: "idle"/u);

  const player = injectGreetPlayerLifecycleProbe(readFile("src/renderer/pet/interaction-action-player.ts"), "run-1");
  assert.match(player, /restore_started[\s\S]*restore_completed/u);
  assert.equal((player.match(/"watchdog_fired"/gu) ?? []).length, 2);
  const nativeSource = readFile("src/renderer/pet/live2d/cubism-motion.ts");
  const native = injectGreetNativeLifecycleProbe(nativeSource, "run-1");
  assert.match(native, /ownership_parsed[\s\S]*"queued"[\s\S]*"started"[\s\S]*"completed"/u);
  assert.equal(
    (native.match(/reportGreetSmallReview\("stop_all_motions"/gu) ?? []).length,
    (nativeSource.match(/manager\.stopAllMotions\(\);/gu) ?? []).length
  );
  assert.equal(
    (native.match(/reportGreetSmallReview\("stop_all_motions"[\s\S]*?manager\.stopAllMotions\(\);/gu) ?? []).length,
    (nativeSource.match(/manager\.stopAllMotions\(\);/gu) ?? []).length
  );
  const ownership = injectGreetOwnershipProbe(readFile("src/renderer/pet/live2d/cubism-frame-pipeline.ts"), "run-1");
  assert.match(
    ownership,
    /layers\.applyMotion[\s\S]*restoreReleasedMotionParameterDefaults[\s\S]*layers\.applyLook[\s\S]*layers\.applyBreath[\s\S]*layers\.applyAccessory[\s\S]*ownership_applied/u
  );
  assert.match(ownership, /protectedLayerValuesPreserved[\s\S]*overwrittenParameterIndexCount/u);

  for (const [name, transformed] of Object.entries({ preset, action, trigger, player, native, ownership })) {
    const transpiled = ts.transpileModule(transformed, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: `${name}.ts`,
      reportDiagnostics: true
    });
    assert.deepEqual(transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), [], name);
  }
});

test("lifecycle requires exactly queued -> started -> completed -> restore_started -> restore_completed", () => {
  const good = summarizeLifecycle([
    event("queued", 10),
    event("started", 20),
    event("completed", 3_420),
    event("restore_started", 3_421),
    event("restore_completed", 3_430)
  ], "run-1");
  assert.equal(good.passed, true);
  assert.deepEqual(good.stages, good.requiredStages);
  assert.deepEqual(good.durationGate, {
    expectedMs: 3_400,
    toleranceMs: 120,
    actualMs: 3_400,
    passed: true
  });

  const earlyCompletion = summarizeLifecycle([
    event("queued", 10),
    event("started", 20),
    event("completed", 1_620),
    event("restore_started", 1_621),
    event("restore_completed", 1_630)
  ], "run-1");
  assert.equal(earlyCompletion.durationGate.actualMs, 1_600);
  assert.equal(earlyCompletion.durationGate.passed, false);
  assert.equal(earlyCompletion.passed, false);

  assert.equal(summarizeLifecycle([
    event("queued", 10),
    event("started", 20),
    event("restore_started", 3_421),
    event("completed", 3_422),
    event("restore_completed", 3_430)
  ], "run-1").passed, false);
  assert.equal(summarizeLifecycle([
    event("queued", 10), event("started", 20), event("completed", 3_420),
    event("watchdog_fired", 3_421), event("stop_all_motions", 3_422),
    event("restore_started", 3_423), event("restore_completed", 3_430)
  ], "run-1").passed, false);
  const stopAfterCompletion = summarizeLifecycle([
    event("queued", 10), event("started", 20), event("completed", 3_420),
    event("restore_started", 3_421), event("restore_completed", 3_430),
    event("stop_all_motions", 3_431, { callIndex: 3 })
  ], "run-1");
  assert.equal(stopAfterCompletion.forbidden.stopAllMotions, 1);
  assert.equal(stopAfterCompletion.passed, false);
});

test("ownership requires both parser and frame pipeline to report the exact 10-curve allowlist", () => {
  const ids = [...GREET_SMALL_ALLOWLIST].sort();
  const good = summarizeOwnership([
    event("ownership_parsed", 10, { controlledParameterCount: 10, controlledParameterIds: ids }),
    event("ownership_applied", 20, {
      controlledParameterCount: 10,
      controlledParameterIds: ids,
      controlledParameterIndexCount: 10,
      protectedLayerValuesPreserved: true,
      overwrittenParameterIndexCount: 0
    })
  ], "run-1");
  assert.equal(good.passed, true);

  const missingRuntimeParameter = summarizeOwnership([
    event("ownership_parsed", 10, { controlledParameterCount: 10, controlledParameterIds: ids }),
    event("ownership_applied", 20, {
      controlledParameterCount: 10,
      controlledParameterIds: ids,
      controlledParameterIndexCount: 9,
      protectedLayerValuesPreserved: true,
      overwrittenParameterIndexCount: 0
    })
  ], "run-1");
  assert.equal(missingRuntimeParameter.checks.ownership_applied.controlledParameterIndexCount, 9);
  assert.equal(missingRuntimeParameter.passed, false);

  const laterLayerOverwrite = summarizeOwnership([
    event("ownership_parsed", 10, { controlledParameterCount: 10, controlledParameterIds: ids }),
    event("ownership_applied", 20, {
      controlledParameterCount: 10,
      controlledParameterIds: ids,
      controlledParameterIndexCount: 10,
      protectedLayerValuesPreserved: false,
      overwrittenParameterIndexCount: 1
    })
  ], "run-1");
  assert.equal(laterLayerOverwrite.checks.ownership_applied.protectedLayerValuesPreserved, false);
  assert.equal(laterLayerOverwrite.passed, false);
});

test("continuous evidence covers 0.5s baseline, full 3.4s motion, 0.6s restore, and the 24fps boundary", () => {
  const at30 = summarizeFrameEvidence(frameIndex(30), {
    nativeStartedAtMs: 1_000,
    completedAtMs: 4_400,
    restoreCompletedAtMs: 4_400
  });
  assert.equal(at30.passed, true);
  assert.equal(at30.effectiveFps, 30);
  assert.equal(at30.baselineCoverageMs, 500);
  assert.equal(at30.motionCoverageMs, 3_400);
  assert.equal(at30.restoreCoverageMs, 600);
  assert.equal(at30.holes.length, 0);

  const earlyCompletion = summarizeFrameEvidence(frameIndex(30), {
    nativeStartedAtMs: 1_000,
    completedAtMs: 2_600,
    restoreCompletedAtMs: 4_400
  });
  assert.equal(earlyCompletion.motionCoverageMs, 1_600);
  assert.equal(earlyCompletion.gates.fullMotion, false);

  const at24 = summarizeFrameEvidence(frameIndex(24), {
    nativeStartedAtMs: 1_000,
    completedAtMs: 4_400,
    restoreCompletedAtMs: 4_400
  });
  assert.equal(at24.gates.evidenceRate, true);
  const below24 = summarizeFrameEvidence(frameIndex(23), {
    nativeStartedAtMs: 1_000,
    completedAtMs: 4_400,
    restoreCompletedAtMs: 4_400
  });
  assert.equal(below24.evidenceRateBlocked, true);
  assert.equal(finalizeReviewSummary({
    lifecycle: { passed: true },
    ownership: { passed: true },
    frameEvidence: below24,
    capture: { limitReached: false },
    cleanup: {
      electronStopped: true,
      protectedFilesRestored: true,
      candidateHashUnchanged: true,
      screenshotResidue: [],
      errors: [],
      runDirRemoved: true
    }
  }).acceptance, "blocked-evidence-rate");
});

test("contact sheets cover every selected frame and enlarge all three high-risk windows", () => {
  const runDir = mkdtempSync(join(tmpdir(), "p2-63c-5a-contact-"));
  try {
    const frames = contactFrames();
    const index = writeContactSheets(runDir, frames);
    assert.equal(index.passed, true);
    assert.equal(index.coverageComplete, true);
    assert.deepEqual(index.overviewFrameNumbers, frames.map((_frame, frameNumber) => frameNumber));
    assert.equal(index.riskCoverage["1350-1550"].length, 2);
    assert.equal(index.riskCoverage["1550-2750"].length, 12);
    assert.equal(index.riskCoverage["2750-3200"].length, 5);
    assert.equal(index.sheets.filter(({ kind }) => kind === "overview").length, 3);
    assert.equal(index.sheets.some(({ filename }) => filename.startsWith("contact-sheet-risk-1350-1550-")), true);
    assert.equal(index.sheets.some(({ filename }) => filename.startsWith("contact-sheet-risk-1550-2750-")), true);
    assert.equal(index.sheets.some(({ filename }) => filename.startsWith("contact-sheet-risk-2750-3200-")), true);
    assert.equal(existsSync(join(runDir, "contact-sheet-index.json")), true);
    const artifactIndex = JSON.parse(readFileSync(join(runDir, "contact-sheet-index.json"), "utf8"));
    assert.equal(artifactIndex.selectedFrameCount, frames.length);
    assert.equal(artifactIndex.passed, true);
    const cleanup = {
      electronStopped: true,
      protectedFilesRestored: true,
      candidateHashUnchanged: true,
      screenshotResidue: [],
      errors: [],
      runDirRemoved: true
    };
    const frameEvidence = summarizeFrameEvidence(frameIndex(30), {
      nativeStartedAtMs: 1_000,
      completedAtMs: 4_400,
      restoreCompletedAtMs: 4_400
    });
    assert.equal(finalizeReviewSummary({
      lifecycle: { passed: true },
      ownership: { passed: true },
      frameEvidence,
      capture: { limitReached: false, contactSheets: index },
      cleanup
    }).ok, true);
    assert.equal(finalizeReviewSummary({
      lifecycle: { passed: true },
      ownership: { passed: true },
      frameEvidence,
      capture: { limitReached: false },
      cleanup
    }).ok, false);
    for (const sheet of index.sheets) {
      const path = join(runDir, sheet.filename);
      assert.equal(existsSync(path), true);
      const decoded = decodePng(readFileSync(path), { maxWidth: 700, maxHeight: 800 });
      assert.equal(decoded.width, sheet.width);
      assert.equal(decoded.height, sheet.height);
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("protected hashes detect mutation and cleanup defaults to exact-run removal with explicit retention", () => {
  assert.equal(GREET_SMALL_PROTECTED_PATHS.includes("src/shared/pet-motion-catalog.ts"), true);
  assert.equal(GREET_SMALL_PROTECTED_PATHS.includes("src/shared/interaction-action-catalog.ts"), true);
  const workspaceProtected = hashProtectedPaths(resolve("."), GREET_SMALL_PROTECTED_PATHS);
  assert.equal(workspaceProtected["src/shared/pet-motion-catalog.ts"], ABSENT_PROTECTED_PATH);
  assert.notEqual(workspaceProtected["src/shared/interaction-action-catalog.ts"], ABSENT_PROTECTED_PATH);

  const root = mkdtempSync(join(tmpdir(), "p2-63c-5a-cleanup-"));
  try {
    const sharedDir = join(root, "src", "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, "interaction-action-catalog.ts"), "before", "utf8");
    const paths = ["src/shared/pet-motion-catalog.ts", "src/shared/interaction-action-catalog.ts"];
    const before = hashProtectedPaths(root, paths);
    assert.equal(before["src/shared/pet-motion-catalog.ts"], ABSENT_PROTECTED_PATH);
    assert.equal(protectedHashesEqual(before, hashProtectedPaths(root, paths), paths), true);
    writeFileSync(join(sharedDir, "pet-motion-catalog.ts"), "unexpected", "utf8");
    assert.equal(protectedHashesEqual(before, hashProtectedPaths(root, paths), paths), false);

    const runParentDir = join(root, "run-parent");
    const runDir = join(runParentDir, "timestamp");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "continuous-0000.png"), "evidence");
    const removed = cleanupReviewArtifacts({ runParentDir, runDir }, false, root);
    assert.equal(removed.runDirRemoved, true);
    assert.equal(removed.runParentRemoved, true);

    const retainedParent = join(root, "retained-parent");
    const retainedRun = join(retainedParent, "timestamp");
    mkdirSync(retainedRun, { recursive: true });
    const retained = cleanupReviewArtifacts({ runParentDir: retainedParent, runDir: retainedRun }, true);
    assert.equal(retained.artifactsRetained, true);
    assert.equal(existsSync(retainedRun), true);
    assert.throws(
      () => cleanupReviewArtifacts({ runParentDir: retainedParent, runDir: retainedRun }, false, join(root, "different-root")),
      /invalid-review-run-directory/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}
