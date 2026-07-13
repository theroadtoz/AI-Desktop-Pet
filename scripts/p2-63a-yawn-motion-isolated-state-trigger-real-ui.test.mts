import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import ts from "typescript";
import {
  ABSENT_PROTECTED_PATH,
  assertCapturedFrameVisible,
  assertNoPreTriggerYawnLoad,
  classifyProbeOutcome,
  createExplicitDraftInputBlockedSummary,
  createPublicArtifactSummary,
  createIsolatedMotionFixture,
  createSourceGateBlockedSummary,
  deriveYawnProbeTiming,
  diagnoseStateSleepFailure,
  injectFramePipelineProbe,
  injectIsolatedMotionPreset,
  injectIsolatedStateSleepPath,
  injectNativeLifecycleProbe,
  injectPlayerLifecycleProbe,
  isAcceptedProbeSummary,
  hashProtectedPaths,
  parseRunnerArgs,
  P2_63B2_CAPTURE_INTERVAL_MS,
  P2_63B2_MAX_CAPTURE_FRAMES,
  P2_63B2_MAX_SCREENCAST_BYTES,
  P2_63B2_MAX_SCREENCAST_FRAMES,
  P2_63B2_MAX_SCREENCAST_HEIGHT,
  P2_63B2_MAX_SCREENCAST_WIDTH,
  P2_63B2_MAX_STATIC_RUN_FRAMES,
  P2_63B2_MIN_CHANGED_PAIR_COVERAGE,
  P2_63B2_MIN_CHANGED_PIXEL_RATIO,
  P2_63B2_RUN_TIMEOUT_MS,
  protectedHashesEqual,
  readExplicitDraftFromUserData,
  readModelCandidateFromRoot,
  removeCurrentRunArtifacts,
  captureVisiblePageFrame,
  createScreencastFrameCollector,
  sanitizePublicText,
  setPetPointerInputIsolation,
  shouldKeepP263BArtifacts,
  sourceModeForRunnerArgs,
  summarizeCapturedPng,
  summarizeContinuousEvidence,
  summarizeLifecycleEvidence,
  summarizeParameterEvidence,
  summarizeProbeOutcome,
  selectScreencastFrames,
  startScreencastCapture,
  waitForEvent,
  writeSelectedScreencastFrames,
  validateExplicitDraftMotion,
  withHardTimeout,
  YAWN_SEMANTIC_ALLOWLIST
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";

const RUN_ID = "unit-run";
const TIMING = deriveYawnProbeTiming(4.986);
const CANONICALIZATION = {
  sourceVersion: 0,
  outputVersion: 3,
  sourceCurveCount: 237,
  retainedCurveCount: 9,
  retainedSegmentCount: 106,
  retainedPointCount: 327,
  consistencyCheck: true,
  semanticMotionVariation: true,
  variedParameterCount: 3,
  variedParameterIds: ["ParamAngleY", "ParamEyeLOpen", "ParamMouthOpenY"]
};
const CLEANUP_OK = {
  electronStopped: true,
  tmpRemoved: true,
  protectedFilesRestored: true,
  screenshotResidue: [],
  errors: []
};

test("strict source Meta gate blocks the current yawn before it becomes a canonical candidate", () => {
  const source = JSON.parse(readFileSync("model/yawn.motion3.json", "utf8"));
  const displayInfo = JSON.parse(readFileSync("model/魔女.cdi3.json", "utf8"));
  const result = createIsolatedMotionFixture(source, displayInfo.Parameters.map(({ Id }: { Id: string }) => Id));

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.summary, {
    safeSummaryOnly: true,
    status: "blocked",
    sourceVersion: 0,
    outputVersion: null,
    sourceCurveCount: 237,
    sourceSegmentCount: 3361,
    sourcePointCount: 10320,
    retainedCurveCount: 0,
    retainedSegmentCount: 0,
    retainedPointCount: 0,
    consistencyCheck: false,
    blockers: ["source-meta-count-mismatch"]
  });
  assert.equal(source.Version, 0);
});

test("blocked source summary routes to VTS recorder without a real UI launch or renderer probe", () => {
  const summary = createSourceGateBlockedSummary({
    sourceVersion: 0,
    sourceCurveCount: 237,
    sourceSegmentCount: 3361,
    sourcePointCount: 10320,
    blockers: ["source-meta-count-mismatch", "E:\\private\\motion", '{"Curves":[]}'],
    rawSource: { Curves: ["must-not-leak"] },
    sourcePath: "E:\\private\\yawn.motion3.json"
  }, 12);

  assert.equal(summary.status, "blocked");
  assert.equal(summary.acceptance, "source-meta-count-mismatch");
  assert.equal(summary.realUi.launchAttempted, false);
  assert.equal(summary.rendererProbe.created, false);
  assert.deepEqual(summary.rendererProbe.events, []);
  assert.equal(summary.fallback.status, "vts-recorder-required");
  assert.equal(summary.fallback.inspectCommand, "npm run vts:motion-recorder -- inspect");
  assert.equal(summary.fallback.recordingRequiresExplicitConfirmation, true);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /must-not-leak|E:\\\\private|Curves/u);
});

test("runner exits at the source gate with a sanitized truthful blocked summary", () => {
  const run = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs"
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(run.status, 1);
  assert.equal(run.stderr, "");
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.status, "blocked");
  assert.equal(summary.acceptance, "source-meta-count-mismatch");
  assert.equal(summary.realUi.launchAttempted, false);
  assert.equal(summary.rendererProbe.created, false);
  assert.deepEqual(summary.rendererProbe.events, []);
  assert.equal(summary.fallback.status, "vts-recorder-required");
  assert.doesNotMatch(run.stdout, /[A-Z]:[\\/]|"Curves"|"Segments"/u);
});

test("source-user-data CLI is narrow and requires an absolute root", () => {
  assert.deepEqual(parseRunnerArgs([]), { mode: "default" });
  assert.deepEqual(parseRunnerArgs(["--source-model-candidate"]), {
    mode: "model-candidate",
    timeoutControl: false
  });
  assert.deepEqual(parseRunnerArgs(["--source-model-candidate", "--timeout-control"]), {
    mode: "model-candidate",
    timeoutControl: true
  });
  assert.deepEqual(parseRunnerArgs(["--source-user-data", resolve("fixture-user-data")]), {
    mode: "explicit-draft",
    sourceUserDataRoot: resolve("fixture-user-data"),
    timeoutControl: false
  });
  assert.deepEqual(parseRunnerArgs(["--timeout-control", "--source-user-data", resolve("fixture-user-data")]), {
    mode: "explicit-draft",
    sourceUserDataRoot: resolve("fixture-user-data"),
    timeoutControl: true
  });
  assert.equal(sourceModeForRunnerArgs(parseRunnerArgs([])), "default-source");
  assert.equal(sourceModeForRunnerArgs(parseRunnerArgs(["--source-user-data", resolve("fixture-user-data")])), "user-data-draft");
  assert.equal(sourceModeForRunnerArgs(parseRunnerArgs(["--source-model-candidate"])), "model-candidate");
  assert.deepEqual(
    (({ phase, sourceMode, explicitDraftMode }) => ({ phase, sourceMode, explicitDraftMode }))(
      createExplicitDraftInputBlockedSummary(new Error("blocked"), "model-candidate")
    ),
    { phase: "model-candidate-input", sourceMode: "model-candidate", explicitDraftMode: false }
  );
  assert.throws(() => parseRunnerArgs(["--timeout-control"]), /invalid-cli-arguments/u);
  assert.throws(() => parseRunnerArgs(["--source-model-candidate", resolve("candidate.json")]), /invalid-cli-arguments/u);
  assert.throws(() => parseRunnerArgs(["--source-model-candidate", "--source-model-candidate"]), /invalid-cli-arguments/u);
  assert.throws(
    () => parseRunnerArgs(["--source-model-candidate", "--source-user-data", resolve("fixture-user-data")]),
    /invalid-cli-arguments/u
  );
  assert.throws(() => parseRunnerArgs(["--source-user-data", "relative-root"]), /must-be-absolute/u);
  assert.throws(() => parseRunnerArgs(["--source-user-data"]), /invalid-cli-arguments/u);
  assert.throws(() => parseRunnerArgs(["--candidate-draft", resolve("draft.json")]), /invalid-cli-arguments/u);
});

test("explicit Version 3 draft validation is strict and preserves the validated motion", () => {
  const motion = makeExplicitDraft();
  const modelIds = [...YAWN_SEMANTIC_ALLOWLIST, "ParamBreath"];
  const result = validateExplicitDraftMotion(motion, modelIds);

  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  assert.equal(result.motion, motion);
  assert.deepEqual(result.structure, {
    version: 3,
    durationSeconds: 5.1,
    fps: 30,
    loop: false,
    curveCount: 9,
    segmentCount: 9,
    pointCount: 18,
    consistencyCheck: true,
    semanticMotionVariation: true,
    variedParameterCount: 7,
    variedParameterIds: [
      "ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamEyeLOpen",
      "ParamEyeROpen", "ParamMouthForm", "ParamMouthOpenY"
    ]
  });

  const withPath = { ...motion, path: "E:\\private\\second.json" };
  assert.deepEqual(validateExplicitDraftMotion(withPath, modelIds), {
    status: "blocked",
    blockers: ["unsupported-motion-field"]
  });
  assert.equal(validateExplicitDraftMotion({ ...motion, Version: 0 }, modelIds).status, "blocked");
  assert.equal(validateExplicitDraftMotion({ ...motion, Meta: { ...motion.Meta, Loop: true } }, modelIds).status, "blocked");
});

test("explicit draft validation rejects malformed segments and inconsistent Meta counts", () => {
  const modelIds = [...YAWN_SEMANTIC_ALLOWLIST, "ParamBreath"];
  const nonFinite = structuredClone(makeExplicitDraft());
  nonFinite.Curves[0].Segments[4] = Number.NaN;
  assert.match(validateExplicitDraftMotion(nonFinite, modelIds).blockers?.join(",") ?? "", /invalid-segments/u);

  const malformed = structuredClone(makeExplicitDraft());
  malformed.Curves[0].Segments = [0, 0, 4, 5.1, 1];
  assert.match(validateExplicitDraftMotion(malformed, modelIds).blockers?.join(",") ?? "", /invalid-segments/u);

  const countMismatch = structuredClone(makeExplicitDraft());
  countMismatch.Meta.TotalPointCount += 1;
  assert.match(validateExplicitDraftMotion(countMismatch, modelIds).blockers?.join(",") ?? "", /meta-count-mismatch/u);
});

test("explicit draft validation rejects duplicate, unknown, and non-allowlisted parameter ids", () => {
  const modelIds = [...YAWN_SEMANTIC_ALLOWLIST, "ParamBreath"];
  const duplicate = structuredClone(makeExplicitDraft());
  duplicate.Curves[1].Id = duplicate.Curves[0].Id;
  assert.match(validateExplicitDraftMotion(duplicate, modelIds).blockers?.join(",") ?? "", /duplicate-parameter-id/u);

  const unknown = structuredClone(makeExplicitDraft());
  unknown.Curves[0].Id = "ParamUnknown";
  const unknownBlockers = validateExplicitDraftMotion(unknown, modelIds).blockers?.join(",") ?? "";
  assert.match(unknownBlockers, /unknown-parameter-id/u);
  assert.match(unknownBlockers, /parameter-not-allowlisted/u);

  const nonAllowlisted = structuredClone(makeExplicitDraft());
  nonAllowlisted.Curves[0].Id = "ParamBreath";
  const nonAllowlistedBlockers = validateExplicitDraftMotion(nonAllowlisted, modelIds).blockers?.join(",") ?? "";
  assert.match(nonAllowlistedBlockers, /parameter-not-allowlisted/u);
  assert.doesNotMatch(nonAllowlistedBlockers, /unknown-parameter-id/u);
});

test("fixed userData draft loader returns only basename, hash, size, and safe structure", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63b-user-data-"));
  try {
    const draftDir = join(root, "motion-drafts", "vts-drafts");
    mkdirSync(draftDir, { recursive: true });
    writeFileSync(join(draftDir, "yawn-draft.motion3.json"), JSON.stringify(makeExplicitDraft()), "utf8");

    const loaded = readExplicitDraftFromUserData(root);
    assert.equal(loaded.summary.basename, "yawn-draft.motion3.json");
    assert.match(loaded.summary.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(loaded.summary.structure.consistencyCheck, true);
    const serialized = JSON.stringify(loaded.summary);
    assert.doesNotMatch(serialized, new RegExp(escapeRegExp(root), "u"));
    assert.doesNotMatch(serialized, /Segments|Curves|sourcePath/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixed model candidate loader validates the fixed file and returns only origin, basename, and hash", () => {
  const loaded = readModelCandidateFromRoot(resolve("."));

  assert.deepEqual(loaded.summary, {
    origin: "model-candidate",
    basename: "yawn-once.motion3.json",
    sha256: "eca4ad06bb4665c3d4ae2a619a1d6528360044935508d08b06310ea3125b52b4"
  });
  assert.equal(loaded.motion.Version, 3);
  assert.doesNotMatch(JSON.stringify(loaded.summary), new RegExp(escapeRegExp(resolve(".")), "u"));
});

test("fixed model candidate loader rejects a valid motion with any hash other than the pinned candidate", () => {
  const root = createFixedModelCandidateRoot();
  try {
    assert.throws(() => readModelCandidateFromRoot(root), /model-candidate-sha256-mismatch/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixed model candidate loader rejects missing, non-file, invalid V3, and reparse candidates", (t) => {
  const missingRoot = mkdtempSync(join(tmpdir(), "p2-63b-model-candidate-missing-"));
  const nonFileRoot = mkdtempSync(join(tmpdir(), "p2-63b-model-candidate-directory-"));
  const invalidRoot = createFixedModelCandidateRoot({ Version: 2 });
  const reparseParent = mkdtempSync(join(tmpdir(), "p2-63b-model-candidate-reparse-"));
  const reparseRoot = join(reparseParent, "root");
  const externalModel = join(reparseParent, "external-model");
  mkdirSync(join(missingRoot, "model"));
  mkdirSync(join(nonFileRoot, "model", "yawn-once.motion3.json"), { recursive: true });
  mkdirSync(externalModel);
  writeFixedModelFiles(externalModel);
  mkdirSync(reparseRoot);

  try {
    assert.throws(() => readModelCandidateFromRoot(missingRoot), /model-candidate-file-missing/u);
    assert.throws(() => readModelCandidateFromRoot(nonFileRoot), /model-candidate-not-regular-file/u);
    assert.throws(() => readModelCandidateFromRoot(invalidRoot), /invalid-version/u);
    try {
      symlinkSync(externalModel, join(reparseRoot, "model"), "junction");
    } catch (error) {
      t.diagnostic(`junction creation unavailable: ${error instanceof Error ? error.name : "error"}`);
      return;
    }
    assert.throws(() => readModelCandidateFromRoot(reparseRoot), /model-candidate-reparse-path-rejected/u);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
    rmSync(nonFileRoot, { recursive: true, force: true });
    rmSync(invalidRoot, { recursive: true, force: true });
    rmSync(reparseParent, { recursive: true, force: true });
  }
});

test("fixed userData draft loader rejects missing files and reparse roots", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "p2-63b-path-gates-"));
  const realRoot = join(parent, "real");
  const linkedRoot = join(parent, "linked");
  mkdirSync(join(realRoot, "motion-drafts", "vts-drafts"), { recursive: true });
  assert.throws(() => readExplicitDraftFromUserData(realRoot), /draft-file-missing/u);
  try {
    symlinkSync(realRoot, linkedRoot, "junction");
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    t.skip(`junction creation unavailable: ${error instanceof Error ? error.name : "error"}`);
    return;
  }
  try {
    assert.equal(lstatSync(linkedRoot).isSymbolicLink(), true);
    assert.throws(() => readExplicitDraftFromUserData(linkedRoot), /draft-reparse-path-rejected/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("fixed userData draft loader rejects an intermediate directory junction", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "p2-63b-intermediate-junction-"));
  const root = join(parent, "root");
  const realDrafts = join(parent, "real-motion-drafts");
  mkdirSync(join(realDrafts, "vts-drafts"), { recursive: true });
  mkdirSync(root);
  writeFileSync(join(realDrafts, "vts-drafts", "yawn-draft.motion3.json"), JSON.stringify(makeExplicitDraft()), "utf8");
  try {
    symlinkSync(realDrafts, join(root, "motion-drafts"), "junction");
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    t.skip(`junction creation unavailable: ${error instanceof Error ? error.name : "error"}`);
    return;
  }
  try {
    assert.throws(() => readExplicitDraftFromUserData(root), /draft-reparse-path-rejected/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("fixed userData draft loader rejects a draft file symlink", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "p2-63b-file-symlink-"));
  const root = join(parent, "root");
  const draftDir = join(root, "motion-drafts", "vts-drafts");
  const realDraft = join(parent, "real-yawn.motion3.json");
  mkdirSync(draftDir, { recursive: true });
  writeFileSync(realDraft, JSON.stringify(makeExplicitDraft()), "utf8");
  try {
    symlinkSync(realDraft, join(draftDir, "yawn-draft.motion3.json"), "file");
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    t.skip(`file symlink creation unavailable: ${error instanceof Error ? error.name : "error"}`);
    return;
  }
  try {
    assert.throws(() => readExplicitDraftFromUserData(root), /draft-reparse-path-rejected/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("absent optional protected paths do not fail startup and must remain absent", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63b-protected-paths-"));
  const paths = ["required.txt", "optional.txt"];
  try {
    writeFileSync(join(root, "required.txt"), "protected", "utf8");
    const before = hashProtectedPaths(root, paths);
    assert.equal(before["optional.txt"], ABSENT_PROTECTED_PATH);
    assert.equal(protectedHashesEqual(before, hashProtectedPaths(root, paths), paths), true);

    writeFileSync(join(root, "optional.txt"), "unexpected", "utf8");
    const afterUnexpectedCreation = hashProtectedPaths(root, paths);
    assert.match(afterUnexpectedCreation["optional.txt"], /^sha256:[a-f0-9]{64}$/u);
    assert.equal(protectedHashesEqual(before, afterUnexpectedCreation, paths), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("current-run cleanup preserves sibling retained evidence", () => {
  const parent = mkdtempSync(join(tmpdir(), "p2-63b-run-parent-"));
  const retainedRun = join(parent, "retained-run");
  const currentRun = join(parent, "current-run");
  const retainedMarker = join(retainedRun, "result.json");
  try {
    mkdirSync(retainedRun);
    mkdirSync(currentRun);
    writeFileSync(retainedMarker, "retained evidence", "utf8");
    writeFileSync(join(currentRun, "temporary.png"), "temporary", "utf8");

    assert.equal(removeCurrentRunArtifacts({ runParentDir: parent, runDir: currentRun }), true);
    assert.equal(existsSync(currentRun), false);
    assert.equal(readFileSync(retainedMarker, "utf8"), "retained evidence");
    assert.throws(
      () => removeCurrentRunArtifacts({ runParentDir: parent, runDir: parent }),
      /invalid-current-run-directory/u
    );
    assert.throws(
      () => removeCurrentRunArtifacts({ runParentDir: parent, runDir: join(parent, "..", "outside-run") }),
      /invalid-current-run-directory/u
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("retained artifact summaries and diagnostics never expose absolute paths", () => {
  const runDir = join(process.cwd(), ".tmp", "p2-63a-runner", "retained-run");
  const fixtureRoot = join(runDir, "isolated-app");
  const summary = createPublicArtifactSummary(
    { runDir },
    fixtureRoot,
    [{ offsetMs: 0 }, { offsetMs: 83 }],
    [join(runDir, "p2-63b-yawn-start-200ms.png"), join(runDir, "p2-63b-yawn-end-4900ms.png")]
  );

  assert.deepEqual(summary, {
    runDirectory: ".tmp/p2-63a-runner/retained-run",
    fixturePath: "isolated-app/model-fixture/yawn.motion3.json",
    continuousFrameCount: 2,
    continuousFormat: "png",
    timeIndex: "continuous-frame-index.json",
    anchorFrameCount: 2,
    anchorFormat: "png"
  });
  const sanitized = sanitizePublicText(
    "C:\\Users\\private-user\\draft.json file:///D:/secret/trace.log \\\\server\\share\\record.txt https://example.com/help ws://127.0.0.1/devtools"
  );
  assert.doesNotMatch(JSON.stringify(summary), /[A-Z]:[\\/]|Users[\\/]/u);
  assert.doesNotMatch(sanitized, /[A-Z]:[\\/]|private-user|server[\\/]share/u);
  assert.match(sanitized, /https:\/\/example\.com\/help ws:\/\/127\.0\.0\.1\/devtools/u);
});

test("fixed userData draft loader rejects a directory in place of the draft file", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63b-non-file-"));
  try {
    mkdirSync(join(root, "motion-drafts", "vts-drafts", "yawn-draft.motion3.json"), { recursive: true });
    assert.throws(() => readExplicitDraftFromUserData(root), /draft-not-regular-file/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid explicit input blocks before launch without echoing the absolute root", () => {
  const missingRoot = resolve(".tmp", "private-user-profile-do-not-print");
  const run = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs",
    "--source-user-data",
    missingRoot
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(run.status, 1);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.phase, "user-data-draft-input");
  assert.equal(summary.realUi.launchAttempted, false);
  assert.equal(summary.manualVisualPass, false);
  assert.doesNotMatch(run.stdout, new RegExp(escapeRegExp(missingRoot), "u"));
});

test("explicit draft input catch sanitizes acceptance and error paths", () => {
  const summary = createExplicitDraftInputBlockedSummary(new Error(
    "failed C:\\Users\\private-user\\draft.json \\\\server\\share\\draft.json file:///D:/secret/draft.json"
  ), "user-data-draft");
  const serialized = JSON.stringify(summary);

  assert.equal(summary.acceptance, summary.error.message);
  assert.equal(summary.realUi.launchAttempted, false);
  assert.doesNotMatch(serialized, /[A-Z]:[\\/]|private-user|server[\\/]share|file:\/\/\//u);
  assert.match(summary.acceptance, /<absolute-path>/u);
});

test("probe timing and artifact retention are explicit and canonical-duration derived", () => {
  assert.deepEqual(TIMING, {
    durationSeconds: 4.986,
    durationMs: 4_986,
    watchdogMinMs: 4_686,
    watchdogMaxMs: 5_786,
    sampleOffsetsMs: [200, 2_500, 4_900]
  });
  assert.equal(shouldKeepP263BArtifacts({}), false);
  assert.equal(shouldKeepP263BArtifacts({ P2_63B_KEEP_ARTIFACTS: "1" }), true);
});

test("isolated transforms bind yawn only on the state_sleep path for the real duration", () => {
  const presetSource = readFileSync("src/shared/pet-motion-presets.ts", "utf8");
  const mainSource = readFileSync("src/renderer/pet/main.ts", "utf8");
  const interactionSource = readFileSync("src/renderer/pet/interaction-actions.ts", "utf8");
  const cubismSource = readFileSync("src/renderer/pet/live2d/cubism-motion.ts", "utf8");

  assert.match(injectIsolatedMotionPreset(presetSource, TIMING), /id: "yawn-once"[\s\S]*durationHintSeconds: 4\.986[\s\S]*loop: false/u);
  const patchedMain = injectIsolatedStateSleepPath(mainSource, TIMING, RUN_ID);
  assert.match(patchedMain, /trigger\.reason === "state_sleep"[\s\S]*durationMs: 4986[\s\S]*motionPresetId: "yawn-once"/u);
  assert.doesNotMatch(interactionSource, /motionPresetId: "yawn-once"/u);
  const probed = injectNativeLifecycleProbe(cubismSource, RUN_ID);
  for (const stage of [
    "load_attempt", "parse_attempt", "parser_blocked", "start_attempt", "queued",
    "native_started", "handle_finished_after_update", "terminal_status", "stop_all_motions"
  ]) {
    assert.match(probed, new RegExp(`"${stage}"`, "u"));
  }
  assert.match(probed, /runId: "unit-run"/u);
  assert.doesNotMatch(probed, /errorMessage|error\.message/u);
  assert.match(probed, /parseControlledParameterIds\(buffer\)/u);
  assert.match(probed, /activeMotions\.set\(handle, record\)/u);
  assert.match(probed, /manager\.isFinishedByHandle\(handle\)/u);
  assert.match(probed, /type PlaybackRecord = \{\s*handle: MotionHandle;\s*motionPresetId: PetMotionPresetId;/u);
  assert.match(
    probed,
    /const stoppingMotionPresetIds = \[\.\.\.activeMotions\.values\(\)\][\s\S]*stopActiveMotions\(reason\);[\s\S]*activeMotions\.clear\(\);[\s\S]*for \(const motionPresetId of stoppingMotionPresetIds\)[\s\S]*"stop_all_motions"[\s\S]*manager\.stopAllMotions\(\);/u
  );
  assert.doesNotMatch(
    probed,
    /activeMotions\.clear\(\);\s*for \(const activeMotion of activeMotions\.values\(\)\)/u
  );
  assert.doesNotMatch(probed, /CubismMotion\.create\(buffer, buffer\.byteLength, undefined, undefined, true\)/u);

  const timeoutPreset = injectIsolatedMotionPreset(presetSource, TIMING, true);
  assert.match(timeoutPreset, /loop: true/u);
  assert.match(injectIsolatedMotionPreset(presetSource, TIMING), /loop: false/u);
});

test("player and frame transforms observe the production watchdog, restore, and protected parameter pipeline", () => {
  const player = injectPlayerLifecycleProbe(
    readFileSync("src/renderer/pet/interaction-action-player.ts", "utf8"),
    RUN_ID
  );
  for (const stage of ["player_watchdog_armed", "player_watchdog_fired", "restore_started", "restore_completed"]) {
    assert.match(player, new RegExp(`"${stage}"`, "u"));
  }
  assert.match(player, /stopMotion\("timed_out"\)/u);

  const pipeline = injectFramePipelineProbe(
    readFileSync("src/renderer/pet/live2d/cubism-frame-pipeline.ts", "utf8"),
    RUN_ID
  );
  assert.match(
    pipeline,
    /layers\.applyMotion[\s\S]*sourceAngleY[\s\S]*applyProtectedLayer[\s\S]*layers\.applyBreath[\s\S]*runtimeAngleY/u
  );
  assert.match(pipeline, /ownedParameterIds\.has\("ParamAngleY"\)/u);

  for (const transformed of [
    injectNativeLifecycleProbe(readFileSync("src/renderer/pet/live2d/cubism-motion.ts", "utf8"), RUN_ID),
    player,
    pipeline
  ]) {
    const result = ts.transpileModule(transformed, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true
    });
    assert.deepEqual(result.diagnostics ?? [], []);
  }
});

test("normal lifecycle requires natural completion and forbids watchdog fire and stop-all", () => {
  const evidence = summarizeLifecycleEvidence([
    event("restore_started", 1, { motionPresetId: "wave-once" }),
    event("restore_completed", 2, { motionPresetId: "wave-once" }),
    event("queued", 10),
    event("native_started", 20),
    event("player_watchdog_armed", 21),
    event("handle_finished_after_update", 5_120),
    event("terminal_status", 5_121, { status: "completed" }),
    event("restore_started", 5_122),
    event("restore_completed", 5_123)
  ]);

  assert.equal(evidence.passed, true);
  assert.equal(evidence.counts.completed, 1);
  assert.equal(evidence.counts.watchdogFired, 0);
  assert.equal(evidence.counts.stopAllMotions, 0);
  assert.equal(evidence.counts.restoreCompleted, 1);
  assert.equal(evidence.observedGlobalCounts.restoreCompleted, 2);
  assert.equal(summarizeLifecycleEvidence([
    event("queued", 10), event("native_started", 20), event("player_watchdog_armed", 21),
    event("handle_finished_after_update", 5_120), event("terminal_status", 5_121, { status: "completed" }),
    event("restore_started", 5_122), event("restore_completed", 5_123), event("restore_completed", 5_124)
  ]).passed, false);
  assert.equal(summarizeLifecycleEvidence([
    event("queued", 10), event("native_started", 20), event("player_watchdog_armed", 21),
    event("player_watchdog_fired", 5_620), event("stop_all_motions", 5_621)
  ]).passed, false);
});

test("timeout control proves started to watchdog to timed_out to stop to restore without completed", () => {
  const evidence = summarizeLifecycleEvidence([
    event("queued", 10),
    event("native_started", 20),
    event("player_watchdog_armed", 21),
    event("player_watchdog_fired", 5_620),
    event("terminal_status", 5_621, { status: "timed_out" }),
    event("stop_all_motions", 5_622),
    event("restore_started", 5_623),
    event("restore_completed", 5_624)
  ], true);

  assert.equal(evidence.passed, true);
  assert.equal(evidence.counts.completed, 0);
  assert.equal(evidence.counts.timedOut, 1);
  assert.equal(evidence.counts.stopAllMotions, 1);
});

test("parameter evidence requires dense, nearby checkpoints with positive and negative peaks", () => {
  const samples = Array.from({ length: 52 }, (_, index) => {
    const offsetMs = index * 100;
    const sourceAngleY = offsetMs <= 2_500
      ? 12 * offsetMs / 2_500
      : offsetMs <= 4_300
        ? 12 - 20 * (offsetMs - 2_500) / 1_800
        : -8 + 8 * (offsetMs - 4_300) / 800;
    return event("frame_parameter_sample", 100 + offsetMs, {
      owned: true,
      sourceAngleY,
      runtimeAngleY: sourceAngleY * 0.9
    });
  });
  samples.push(
    event("frame_parameter_sample", 5_300, { owned: false, sourceAngleY: 99, runtimeAngleY: 99 })
  );
  const evidence = summarizeParameterEvidence(samples, 100, 5_100);

  assert.deepEqual(evidence.source, { min: -8, max: 12, span: 20 });
  assert.deepEqual(evidence.runtime, { min: -7.2, max: 10.8, span: 18 });
  assert.equal(evidence.runtimeSourceSpanRatio, 0.9);
  assert.equal(evidence.directionPreserved, true);
  assert.equal(evidence.spanGatePassed, true);
  assert.equal(evidence.sampleCountGatePassed, true);
  assert.equal(evidence.checkpointDistanceGatePassed, true);
  assert.equal(evidence.polarityGatePassed, true);
  assert.equal(evidence.checkpointGatePassed, true);
  assert.ok(evidence.checkpoints.every((checkpoint: any) => checkpoint.sampleDistanceMs <= 120));
  assert.equal(JSON.stringify(evidence).includes("frame_parameter_sample"), false);

  const compressed = summarizeParameterEvidence(samples.map((sample) => (
    sample.stage === "frame_parameter_sample" ? { ...sample, runtimeAngleY: (sample.runtimeAngleY as number) * 0.5 } : sample
  )), 100, 5_100);
  assert.equal(compressed.spanGatePassed, false);

  const sparse = summarizeParameterEvidence(samples.slice(0, 4), 100, 5_100);
  assert.equal(sparse.sampleCountGatePassed, false);
  assert.equal(sparse.checkpointDistanceGatePassed, false);
  assert.equal(sparse.checkpointGatePassed, false);

  const positiveOnly = summarizeParameterEvidence(samples.map((sample) => (
    sample.stage === "frame_parameter_sample"
      ? { ...sample, sourceAngleY: Math.abs(sample.sourceAngleY as number), runtimeAngleY: Math.abs(sample.runtimeAngleY as number) }
      : sample
  )), 100, 5_100);
  assert.equal(positiveOnly.polarityGatePassed, false);
  assert.equal(positiveOnly.checkpointGatePassed, false);
});

test("continuous evidence requires 10-15fps, bounded P95/max gaps, full motion, and 300ms restore tail", () => {
  const goodIndex = Array.from({ length: 67 }, (_, index) => makePngEvidenceFrame(100 + index * 83, index));
  const good = summarizeContinuousEvidence(goodIndex, 100, 5_200, 5_100);
  assert.equal(good.passed, true);
  assert.ok(good.effectiveFps >= 10 && good.effectiveFps <= 15);
  assert.ok((good.p95IntervalMs ?? 999) <= 150);
  assert.ok((good.absoluteMaxGapMs ?? 999) <= 200);
  assert.deepEqual(good.timingFailureReasons, []);
  assert.equal(good.validPngFrames, 67);
  assert.equal(good.visiblePngFrames, 67);

  const gapIndex = goodIndex.filter((_, index) => index !== 20 && index !== 21);
  assert.equal(summarizeContinuousEvidence(gapIndex, 100, 5_200, 5_100).passed, false);
  const staticIndex = goodIndex.map((frame) => ({ ...frame, data: goodIndex[0].data }));
  assert.equal(summarizeContinuousEvidence(staticIndex, 100, 5_200, 5_100).passed, false);
  const invalidIndex = goodIndex.map((frame) => ({
    ...frame,
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x45, 0x4e, 0x44]).toString("base64")
  }));
  assert.equal(summarizeContinuousEvidence(invalidIndex, 100, 5_200, 5_100).passed, false);
  assert.doesNotMatch(JSON.stringify(good), /filename|atMs|offsetMs|[A-Z]:[\\/]/u);
});

test("continuous evidence rejects one changed frame among an otherwise static sequence", () => {
  const base = makePngEvidenceFrame(100, 0);
  const changed = makePngEvidenceFrame(100, 1);
  const frames = Array.from({ length: 67 }, (_, index) => ({
    ...base,
    atMs: 100 + index * 83,
    data: index === 33 ? changed.data : base.data
  }));

  assert.equal(summarizeContinuousEvidence(frames, 100, 5_200, 5_100).passed, false);
});

test("continuous PNG evidence rejects a single blank frame", () => {
  const frames = makePngMotionSequence(() => true, 10);
  const blank = createRgbaPng(50, 50, () => [0, 0, 0, 0]);
  frames[30] = { ...frames[30], data: blank.toString("base64"), byteLength: blank.length };
  const evidence = summarizeContinuousEvidence(frames, 100, 5_200, 5_100);

  assert.equal(evidence.visiblePngFrames, 66);
  assert.equal(evidence.passed, false);
});

test("continuous PNG evidence rejects decoded pixels from files missing IEND", () => {
  const frames = makePngMotionSequence(() => true, 10).map((frame) => {
    const png = Buffer.from(frame.data, "base64");
    const truncated = png.subarray(0, -12);
    return { ...frame, data: truncated.toString("base64"), byteLength: truncated.length };
  });
  const evidence = summarizeContinuousEvidence(frames, 100, 5_200, 5_100);

  assert.equal(evidence.validPngFrames, 0);
  assert.equal(evidence.passed, false);
});

test("continuous PNG decoder rejects CRC tampering, damaged zlib, and oversized frames", () => {
  const valid = createRgbaPng(50, 50, () => [255, 255, 255, 255]);
  const crcTampered = Buffer.from(valid);
  crcTampered[crcTampered.length - 1] ^= 0x01;
  const damagedZlib = replacePngChunk(valid, "IDAT", (data) => {
    const damaged = Buffer.from(data);
    damaged[0] ^= 0x01;
    return damaged;
  });
  const oversized = createRgbaPng(421, 600, () => [255, 255, 255, 255]);
  const oversizedInflated = createPngWithRawScanlines(
    50,
    50,
    Buffer.alloc(P2_63B2_MAX_SCREENCAST_HEIGHT * (P2_63B2_MAX_SCREENCAST_WIDTH * 4 + 1) + 1)
  );

  for (const png of [crcTampered, damagedZlib, oversized, oversizedInflated]) {
    const evidence = summarizeContinuousEvidence([{
      atMs: 100,
      byteLength: png.length,
      data: png.toString("base64")
    }], 100, 5_200, 5_100);
    assert.equal(evidence.validPngFrames, 0);
  }
});

test("continuous pixel-change thresholds include their boundary and reject one step below", () => {
  assert.equal(P2_63B2_MIN_CHANGED_PIXEL_RATIO, 0.002);
  assert.equal(P2_63B2_MIN_CHANGED_PAIR_COVERAGE, 0.5);
  assert.equal(P2_63B2_MAX_STATIC_RUN_FRAMES, 6);

  const pixelBoundary = summarizeContinuousEvidence(makePngMotionSequence(() => true, 5), 100, 5_200, 5_100);
  const belowPixelBoundary = summarizeContinuousEvidence(makePngMotionSequence(() => true, 4), 100, 5_200, 5_100);
  assert.equal(pixelBoundary.passed, true);
  assert.equal(belowPixelBoundary.passed, false);

  const coverageBoundary = summarizeContinuousEvidence(
    makePngMotionSequence((pairIndex) => pairIndex % 2 === 0, 10), 100, 5_200, 5_100
  );
  const belowCoverageBoundary = summarizeContinuousEvidence(
    makePngMotionSequence((pairIndex) => pairIndex < 64 && pairIndex % 2 === 0, 10), 100, 5_200, 5_100
  );
  assert.equal(coverageBoundary.changedPairCoverage, 0.5);
  assert.equal(coverageBoundary.passed, true);
  assert.ok(belowCoverageBoundary.changedPairCoverage < 0.5);
  assert.equal(belowCoverageBoundary.passed, false);

  const staticRunBoundary = summarizeContinuousEvidence(
    makePngMotionSequence((pairIndex) => pairIndex >= 5, 10), 100, 5_200, 5_100
  );
  const aboveStaticRunBoundary = summarizeContinuousEvidence(
    makePngMotionSequence((pairIndex) => pairIndex >= 6, 10), 100, 5_200, 5_100
  );
  assert.equal(staticRunBoundary.maxStaticRunFrames, 6);
  assert.equal(staticRunBoundary.passed, true);
  assert.equal(aboveStaticRunBoundary.maxStaticRunFrames, 7);
  assert.equal(aboveStaticRunBoundary.passed, false);
});

test("continuous timing uses P95 plus an absolute max-gap guard", () => {
  const one159msGap = summarizeContinuousEvidence(
    withFrameIntervals(makePngMotionSequence(() => true, 10), makeIntervals([[20, 159]])),
    100,
    5_200,
    5_100
  );
  assert.equal(one159msGap.p95IntervalMs, 83);
  assert.equal(one159msGap.absoluteMaxGapMs, 159);
  assert.equal(one159msGap.timingGates.p95Interval, true);
  assert.equal(one159msGap.timingGates.absoluteMaxGap, true);
  assert.deepEqual(one159msGap.timingFailureReasons, []);
  assert.equal(one159msGap.passed, true);

  const p95TooHigh = summarizeContinuousEvidence(
    withFrameIntervals(makePngMotionSequence(() => true, 10), makeIntervals([
      [10, 151], [20, 151], [30, 151], [40, 151]
    ])),
    100,
    5_200,
    5_100
  );
  assert.equal(p95TooHigh.p95IntervalMs, 151);
  assert.equal(p95TooHigh.absoluteMaxGapMs, 151);
  assert.equal(p95TooHigh.passed, false);
  assert.deepEqual(p95TooHigh.timingFailureReasons, ["p95-interval-exceeded"]);

  const absoluteGapTooHigh = summarizeContinuousEvidence(
    withFrameIntervals(makePngMotionSequence(() => true, 10), makeIntervals([[20, 201]])),
    100,
    5_200,
    5_100
  );
  assert.equal(absoluteGapTooHigh.p95IntervalMs, 83);
  assert.equal(absoluteGapTooHigh.absoluteMaxGapMs, 201);
  assert.equal(absoluteGapTooHigh.passed, false);
  assert.deepEqual(absoluteGapTooHigh.timingFailureReasons, ["absolute-max-gap-exceeded"]);
});

test("screencast collector ACKs immediately and enforces frame and byte limits in memory", async () => {
  const acknowledged: number[] = [];
  const collector = createScreencastFrameCollector({
    acknowledge: (sessionId: number) => { acknowledged.push(sessionId); },
    maxFrames: 2,
    maxBytes: 5
  });
  collector.onFrame({ sessionId: 1, data: Buffer.from("ab").toString("base64"), metadata: { timestamp: 1 } });
  collector.onFrame({ sessionId: 2, data: Buffer.from("cd").toString("base64"), metadata: { timestamp: 2 } });
  collector.onFrame({ sessionId: 3, data: Buffer.from("ef").toString("base64"), metadata: { timestamp: 3 } });

  assert.deepEqual(acknowledged, [1, 2, 3]);
  assert.deepEqual(collector.getSummary(), {
    observedFrames: 3,
    retainedFrames: 2,
    retainedBytes: 4,
    limitReached: true
  });
  assert.equal(collector.getFrames().length, 2);
  assert.equal(P2_63B2_MAX_SCREENCAST_FRAMES, 600);
  assert.equal(P2_63B2_MAX_SCREENCAST_BYTES, 64 * 1024 * 1024);
  await collector.settleAcks();
});

test("screencast selection filters by absolute target lifecycle time and extracts about 12fps", () => {
  const performanceTimeOrigin = 1_000_000;
  const nativeStartedAtMs = 100;
  const restoreCompletedAtMs = 5_200;
  const frames = Array.from({ length: 360 }, (_, index) => {
    const absoluteMs = performanceTimeOrigin + index * (1_000 / 60);
    const png = createRgbaPng(50, 50, (pixelIndex) => (
      pixelIndex < 10 && Math.floor(index / 5) % 2 === 1 ? [255, 0, 0, 255] : [255, 255, 255, 255]
    ));
    return { data: png.toString("base64"), byteLength: png.length, timestamp: absoluteMs / 1_000 };
  });
  const selected = selectScreencastFrames({
    frames,
    performanceTimeOrigin,
    nativeStartedAtMs,
    restoreCompletedAtMs
  });
  const evidence = summarizeContinuousEvidence(selected, nativeStartedAtMs, restoreCompletedAtMs, 5_100);

  assert.ok(selected.length <= P2_63B2_MAX_CAPTURE_FRAMES);
  assert.ok(selected.every((frame: any) => frame.offsetMs >= 0));
  assert.equal(evidence.passed, true);
  assert.ok(evidence.effectiveFps >= 10 && evidence.effectiveFps <= 15);
  assert.ok((evidence.p95IntervalMs ?? 999) <= 150);
  assert.ok((evidence.absoluteMaxGapMs ?? 999) <= 200);
  assert.ok(evidence.restoreCoverageMs >= 300);
});

test("pointer input isolation brackets the target action window before sleep", () => {
  const runnerSource = readFileSync("scripts/p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs", "utf8");
  const installAt = runnerSource.indexOf("await setPetPointerInputIsolation(pet, true)");
  const sleepAt = runnerSource.indexOf('await setPresenceMode(chat, "sleep")');
  const restoreAt = runnerSource.indexOf("await setPetPointerInputIsolation(pet, false)", sleepAt);

  assert.ok(installAt >= 0 && installAt < sleepAt);
  assert.ok(restoreAt > sleepAt);
});

test("pointer input isolation blocks pointer actions only while enabled", async () => {
  const pageWindow = new EventTarget();
  const page = {
    cdp: {
      async send(method: string, params: { expression: string }) {
        assert.equal(method, "Runtime.evaluate");
        Function("window", params.expression)(pageWindow);
        return { result: { value: undefined } };
      }
    }
  };
  let pointerActions = 0;
  let ordinaryEvents = 0;

  await setPetPointerInputIsolation(page, true);
  pageWindow.addEventListener("pointerdown", () => { pointerActions += 1; });
  pageWindow.addEventListener("runner-ordinary-event", () => { ordinaryEvents += 1; });
  const blockedPointer = new Event("pointerdown", { cancelable: true });
  pageWindow.dispatchEvent(blockedPointer);
  pageWindow.dispatchEvent(new Event("runner-ordinary-event"));

  assert.equal(pointerActions, 0);
  assert.equal(blockedPointer.defaultPrevented, true);
  assert.equal(ordinaryEvents, 1);

  await setPetPointerInputIsolation(page, false);
  pageWindow.dispatchEvent(new Event("pointerdown", { cancelable: true }));
  assert.equal(pointerActions, 1);
});

test("state sleep timeout diagnoses correlated pointer interference", () => {
  const events = [
    { __index: 10, type: "pet_interaction_action_finished", payload: { type: "appearance" } },
    { __index: 12, type: "pet_interaction_action_started", payload: { type: "headPat", reason: "click_head" } },
    {
      __index: 13,
      type: "pet_interaction_action_skipped",
      payload: { type: "doze", reason: "state_sleep", activeType: "headPat", skipReason: "active_action" }
    }
  ];

  assert.equal(diagnoseStateSleepFailure(events, 10), "pointer-interference:state_sleep:headPat");
  assert.equal(diagnoseStateSleepFailure(events, 13), "telemetry-event-timeout:state_sleep");
  assert.equal(diagnoseStateSleepFailure(events.slice(0, 2), 10), "telemetry-event-timeout:state_sleep");
});

test("screencast stop orders stop, unsubscribe, then ACK convergence", async () => {
  const order: string[] = [];
  let listener: ((event: any) => void) | null = null;
  let resolveAck!: () => void;
  const ack = new Promise<void>((resolve) => { resolveAck = resolve; });
  const cdp = {
    on(method: string, nextListener: (event: any) => void) {
      assert.equal(method, "Page.screencastFrame");
      listener = nextListener;
      return () => { order.push("unsubscribe"); };
    },
    send(method: string, params?: Record<string, unknown>) {
      if (method === "Page.startScreencast") {
        assert.deepEqual(params, { format: "png", maxWidth: 420, maxHeight: 600, everyNthFrame: 1 });
        return Promise.resolve();
      }
      if (method === "Page.screencastFrameAck") {
        order.push("ack-started");
        return ack.then(() => { order.push("ack-settled"); });
      }
      order.push("stop");
      return Promise.resolve();
    }
  };
  const capture = await startScreencastCapture(cdp);
  listener?.({ sessionId: 7, data: "eA==", metadata: { timestamp: 1 } });
  const stopping = capture.stop();
  await Promise.resolve();
  assert.deepEqual(order, ["ack-started", "stop", "unsubscribe"]);
  resolveAck();
  await stopping;
  assert.deepEqual(order, ["ack-started", "stop", "unsubscribe", "ack-settled"]);
});

test("screencast stop retries after the first Page.stopScreencast failure", async () => {
  let stopAttempts = 0;
  let unsubscribeCalls = 0;
  const cdp = {
    on() {
      return () => { unsubscribeCalls += 1; };
    },
    send(method: string) {
      if (method === "Page.startScreencast") return Promise.resolve();
      if (method === "Page.stopScreencast" && ++stopAttempts === 1) {
        return Promise.reject(new Error("first-stop-failed"));
      }
      return Promise.resolve();
    }
  };
  const capture = await startScreencastCapture(cdp);

  await assert.rejects(capture.stop(), /first-stop-failed/u);
  assert.equal(unsubscribeCalls, 0);
  await assert.doesNotReject(capture.stop());
  assert.equal(stopAttempts, 2);
  assert.equal(unsubscribeCalls, 1);
  await assert.doesNotReject(capture.stop());
  assert.equal(stopAttempts, 2);
});

test("screencast stop preserves ACK convergence failure across idempotent cleanup", async () => {
  let listener: ((event: any) => void) | null = null;
  let stopAttempts = 0;
  let unsubscribeCalls = 0;
  const cdp = {
    on(_method: string, nextListener: (event: any) => void) {
      listener = nextListener;
      return () => { unsubscribeCalls += 1; };
    },
    send(method: string) {
      if (method === "Page.screencastFrameAck") return Promise.reject(new Error("ack-failed"));
      if (method === "Page.stopScreencast") stopAttempts += 1;
      return Promise.resolve();
    }
  };
  const capture = await startScreencastCapture(cdp);
  listener?.({ sessionId: 9, data: "eA==", metadata: { timestamp: 1 } });

  await assert.rejects(capture.stop(), /screencast-frame-ack-failed:1/u);
  await assert.rejects(capture.stop(), /screencast-frame-ack-failed:1/u);
  assert.equal(stopAttempts, 1);
  assert.equal(unsubscribeCalls, 1);
});

test("selected PNG evidence writes at most 80 files plus a relative index and cleans up", () => {
  const runDir = mkdtempSync(join(tmpdir(), "p2-63b2-screencast-"));
  try {
    const frames = Array.from({ length: P2_63B2_MAX_CAPTURE_FRAMES + 5 }, (_, index) => {
      const png = createRgbaPng(50, 50, (pixelIndex) => (
        pixelIndex < 10 && index % 2 === 1 ? [255, 0, 0, 255] : [255, 255, 255, 255]
      ));
      return {
      data: png.toString("base64"),
      byteLength: png.length,
      timestamp: 1 + index / 12,
      offsetMs: index * P2_63B2_CAPTURE_INTERVAL_MS,
      slot: index
      };
    }).slice(0, P2_63B2_MAX_CAPTURE_FRAMES);
    const index = writeSelectedScreencastFrames(runDir, frames);
    assert.equal(index.length, 80);
    assert.equal(existsSync(join(runDir, "continuous-0079.png")), true);
    assert.equal(existsSync(join(runDir, "continuous-frame-index.json")), true);
    assert.doesNotMatch(JSON.stringify(index), /"data":|[A-Z]:[\\/]/u);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
  assert.equal(existsSync(runDir), false);
});

test("event wait returns the matching event and remains bounded when no event arrives", async () => {
  let nowMs = 0;
  let reads = 0;
  const matching = { stage: "native_started", atMs: 166 };
  const found = await waitForEvent(
    async () => (++reads === 3 ? matching : null),
    {
      timeoutMs: 500,
      intervalMs: P2_63B2_CAPTURE_INTERVAL_MS,
      now: () => nowMs,
      sleepFor: async (ms: number) => { nowMs += ms; }
    }
  );
  assert.equal(found, matching);

  const missing = await waitForEvent(async () => null, {
    timeoutMs: 250,
    intervalMs: P2_63B2_CAPTURE_INTERVAL_MS,
    now: () => nowMs,
    sleepFor: async (ms: number) => { nowMs += ms; }
  });
  assert.equal(missing, null);
});

test("90s hard timeout wins an abort-resolved wait and always reaches finally cleanup", async () => {
  const controller = new AbortController();
  let cleanupRan = false;
  try {
    await assert.rejects(
      withHardTimeout(() => new Promise((resolve) => {
        controller.signal.addEventListener("abort", () => resolve("wait-returned"), { once: true });
      }), 5, controller),
      /runner-hard-timeout/u
    );
  } finally {
    cleanupRan = true;
  }
  assert.equal(controller.signal.aborted, true);
  assert.equal(cleanupRan, true);
  assert.equal(P2_63B2_RUN_TIMEOUT_MS, 90_000);
});

test("page screenshot visibility uses decoded PNG alpha together with the renderer frame probe", () => {
  const transparentPixel = createRgbaPng(1, 1, () => [0, 0, 0, 0]);
  const png = summarizeCapturedPng(transparentPixel);
  assert.equal(png.width, 1);
  assert.equal(png.height, 1);
  assert.equal(png.nonTransparentPixels, 0);

  assert.throws(() => assertCapturedFrameVisible({
    pngNonTransparentPixels: 0,
    rendererNonTransparentPixels: 163_247
  }), /model-not-visible/u);
  assert.throws(() => assertCapturedFrameVisible({
    pngNonTransparentPixels: 163_247,
    rendererNonTransparentPixels: 0
  }), /model-not-visible/u);
  assert.doesNotThrow(() => assertCapturedFrameVisible({
    pngNonTransparentPixels: 163_247,
    rendererNonTransparentPixels: 163_247
  }));
});

test("page screenshot retries blank captures within 250ms and records first-frame readings", async () => {
  let nowMs = 1_000;
  let captures = 0;
  const frame = await captureVisiblePageFrame({
    waitForVisibleFrame: async () => ({
      firstNonTransparentPixels: 163_247,
      nonTransparentPixels: 163_247,
      attempts: 1,
      contextLost: false
    }),
    capturePageScreenshot: async () => Buffer.from([++captures === 3 ? 2 : 0]),
    summarizeScreenshot: (image: Buffer) => ({
      width: 630,
      height: 900,
      nonTransparentPixels: image[0] === 2 ? 163_247 : 0
    }),
    now: () => nowMs,
    sleepFor: async (ms: number) => { nowMs += ms; }
  });
  assert.equal(captures, 3);
  assert.equal(frame.screenshotAttempts, 3);
  assert.equal(frame.pngNonTransparentPixels, 163_247);
  assert.equal(frame.rendererNonTransparentPixels, 163_247);
  assert.ok(nowMs <= 1_250);

  nowMs = 2_000;
  await assert.rejects(
    captureVisiblePageFrame({
      waitForVisibleFrame: async () => ({
        firstNonTransparentPixels: 0,
        nonTransparentPixels: 163_247,
        attempts: 2,
        contextLost: false
      }),
      capturePageScreenshot: async () => Buffer.from([0]),
      summarizeScreenshot: () => ({ width: 630, height: 900, nonTransparentPixels: 0 }),
      now: () => nowMs,
      sleepFor: async (ms: number) => { nowMs += ms; }
    }),
    (error: any) => {
      assert.match(error.message, /model-not-visible/u);
      assert.deepEqual(error.captureSummary, {
        firstRendererNonTransparentPixels: 0,
        rendererNonTransparentPixels: 163_247,
        firstPngNonTransparentPixels: 0,
        pngNonTransparentPixels: 0,
        rendererProbeAttempts: 2,
        screenshotAttempts: 4
      });
      return true;
    }
  );
});

test("canvas sampling waits for a renderer animation frame", () => {
  const runnerSource = readFileSync("scripts/p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs", "utf8");
  assert.match(runnerSource, /pet\.cdp\.send\("Page\.captureScreenshot"/u);
  assert.match(runnerSource, /captureBeyondViewport: false/u);
  assert.doesNotMatch(runnerSource, /toDataURL\(/u);
  assert.match(
    runnerSource,
    /sleepFor\(trigger\.atMs \+ offsetMs - performance\.now\(\)\);\s+motion\.push\(await captureRenderedFrame/u
  );
  assert.match(runnerSource, /waitForStage\("start_succeeded", 10000\)/u);
  assert.match(runnerSource, /referenceName === "start_succeeded"/u);
  assert.doesNotMatch(runnerSource, /waitForStage\("state_sleep_trigger", 10000\)/u);
  assert.match(runnerSource, /captureRenderedFrame[\s\S]*performance\.now\(\) \+ 250[\s\S]*nonTransparentPixels > 1_000/u);
  assert.match(
    runnerSource,
    /async function captureCurrentFrame[\s\S]*await new Promise\(\(resolveFrame\) => requestAnimationFrame/u
  );
});

test("pre-trigger gate rejects any yawn load before sleep", () => {
  assert.doesNotThrow(() => assertNoPreTriggerYawnLoad([]));
  assert.throws(
    () => assertNoPreTriggerYawnLoad([{ stage: "load_attempt", motionPresetId: "yawn-once" }]),
    /before state_sleep/u
  );
});

test("state event, successful probe chain and strict 4.986s timing are correlated", () => {
  const outcome = makeOutcome({ parse: "parsed" });

  assert.equal(outcome.stateSelection.preTriggerNoYawnLoad, true);
  assert.equal(outcome.stateSelection.eventCorrelation, true);
  assert.equal(outcome.stateSelection.probeCorrelation, true);
  assert.equal(outcome.stateSelection.strictEventOrder, true);
  assert.equal(outcome.stateSelection.proven, true);
  assert.equal(outcome.visual.sampleTimingCovered, true);
  assert.deepEqual(outcome.visual.requiredOffsetsMs, [200, 2_500, 4_900]);
  assert.equal(outcome.watchdogStop.elapsedMs, 4_965);
  assert.equal(outcome.watchdogStop.bounded, true);
  assert.equal(outcome.restored.timely, true);
  assert.equal(outcome.fixture.sourceVersion, 0);
  assert.equal(outcome.fixture.outputVersion, 3);
  assert.equal(outcome.fixture.cubismConsistencyCheck, true);
  assert.equal(classifyProbeOutcome(outcome, {}, CLEANUP_OK).code, "native-started-visual-unproven");
});

test("wrong run, event shape, order, and early loads cannot prove state selection", () => {
  const wrongRun = makeOutcome({ probeMutation: (events) => ({ ...events[1], runId: "other-run" }) });
  const wrongEvent = makeOutcome({ statePayload: { durationMs: 1_450 } });
  const wrongOrder = makeOutcome({
    parse: "parsed",
    probeEventsMutation: (events) => {
      [events[2], events[3]] = [events[3], events[2]];
    }
  });
  const earlyLoad = makeOutcome({ preTriggerProbeEvents: [{ stage: "load_attempt", motionPresetId: "yawn-once" }] });

  assert.equal(wrongRun.stateSelection.proven, false);
  assert.equal(wrongEvent.stateSelection.proven, false);
  assert.equal(wrongOrder.stateSelection.proven, false);
  assert.equal(earlyLoad.stateSelection.proven, false);
});

test("same-timestamp probe stages in reversed source order cannot prove state selection", () => {
  const outcome = makeOutcome({
    parse: "parsed",
    probeEventsMutation: (events) => {
      for (const event of events) event.atMs = 100;
      [events[2], events[3]] = [events[3], events[2]];
    }
  });

  assert.equal(outcome.stateSelection.strictEventOrder, false);
  assert.equal(outcome.stateSelection.proven, false);
});

test("renderer errors are always blocked even after native start", () => {
  const outcome = makeOutcome({ parse: "parsed" });
  const acceptance = classifyProbeOutcome(outcome, {
    "electron.stdout.log": "Uncaught TypeError: Cannot read properties of null (reading 'length')"
  }, CLEANUP_OK);

  assert.equal(acceptance.status, "blocked");
  assert.equal(acceptance.code, "renderer-error");
  assert.equal(isAcceptedProbeSummary(acceptance), false);
});

test("canvas visibility and hash changes alone require manual review", () => {
  const outcome = makeOutcome({ parse: "parsed" });
  const acceptance = classifyProbeOutcome(outcome, {}, CLEANUP_OK);

  assert.equal(outcome.visual.visibleFrameObserved, true);
  assert.equal(outcome.visual.frameChangeObserved, true);
  assert.equal(outcome.visual.evidenceLevel, "canvas-diagnostic-only");
  assert.equal(acceptance.status, "needs-manual-visual-review");
  assert.equal(acceptance.code, "native-started-visual-unproven");
  assert.equal(isAcceptedProbeSummary(acceptance), false);
});

test("blank or static motion frames are required-gate failures", () => {
  const blank = makeOutcome({
    parse: "parsed",
    frameSamples: makeFrameSamples([0, 0, 0], ["blank-a", "blank-b", "blank-c"])
  });
  const staticFrames = makeOutcome({
    parse: "parsed",
    frameSamples: makeFrameSamples([2_000, 2_000, 2_000], ["same", "same", "same"])
  });

  assert.equal(classifyProbeOutcome(blank, {}, CLEANUP_OK).code, "required-gate-failed");
  assert.equal(classifyProbeOutcome(blank, {}, CLEANUP_OK).gates.motionVisible, false);
  assert.equal(classifyProbeOutcome(staticFrames, {}, CLEANUP_OK).code, "required-gate-failed");
  assert.equal(classifyProbeOutcome(staticFrames, {}, CLEANUP_OK).gates.motionChanged, false);
});

test("static semantic motion is blocked even when background frame hashes change", () => {
  const staticMotion = makeExplicitDraft();
  for (const curve of staticMotion.Curves) {
    curve.Segments = [0, 0, 0, staticMotion.Meta.Duration, 0];
  }
  const validation = validateExplicitDraftMotion(staticMotion, [...YAWN_SEMANTIC_ALLOWLIST]);
  assert.equal(validation.status, "validated");
  if (validation.status !== "validated") return;
  assert.equal(validation.structure.semanticMotionVariation, false);
  assert.deepEqual(validation.structure.variedParameterIds, []);

  const outcome = makeOutcome({
    parse: "parsed",
    canonicalization: {
      ...CANONICALIZATION,
      semanticMotionVariation: false,
      variedParameterCount: 0,
      variedParameterIds: []
    },
    frameSamples: makeFrameSamples([2_000, 2_100, 2_050], ["background-a", "background-b", "background-c"])
  });
  const acceptance = classifyProbeOutcome(outcome, {}, CLEANUP_OK);
  assert.equal(outcome.visual.frameChangeObserved, true);
  assert.equal(acceptance.gates.semanticMotionVariation, false);
  assert.equal(acceptance.code, "required-gate-failed");
});

test("motion sample timing rejects a state-trigger anchor", () => {
  const outcome = makeOutcome({
    parse: "parsed",
    frameSamples: makeFrameSamples([2_000, 2_100, 2_050], ["a", "b", "c"], "state_sleep_trigger")
  });
  assert.equal(outcome.visual.sampleTimingCovered, false);
  assert.equal(classifyProbeOutcome(outcome, {}, CLEANUP_OK).code, "required-gate-failed");
});

test("state, loop, sampling, watchdog, restore, and cleanup are classification gates", () => {
  const mutations = [
    (outcome: any) => { outcome.stateSelection.proven = false; },
    (outcome: any) => { outcome.fixture.loopForcedFalse = false; },
    (outcome: any) => { outcome.visual.sampleTimingCovered = false; },
    (outcome: any) => { outcome.watchdogStop.bounded = false; },
    (outcome: any) => { outcome.restored.timely = false; }
  ];

  for (const mutate of mutations) {
    const outcome = makeOutcome({ parse: "parsed" });
    mutate(outcome);
    const acceptance = classifyProbeOutcome(outcome, {}, CLEANUP_OK, { manualVisualEvidence: true });
    assert.equal(acceptance.status, "blocked");
    assert.equal(acceptance.code, "required-gate-failed");
    assert.equal(isAcceptedProbeSummary(acceptance), false);
  }

  const cleanupFailed = { ...CLEANUP_OK, electronStopped: false };
  const acceptance = classifyProbeOutcome(makeOutcome({ parse: "parsed" }), {}, cleanupFailed, { manualVisualEvidence: true });
  assert.equal(acceptance.status, "blocked");
  assert.equal(acceptance.gates.cleanup, false);
});

test("manual visual evidence cannot auto-pass a diagnostic-only candidate", () => {
  const acceptance = classifyProbeOutcome(
    makeOutcome({ parse: "parsed" }),
    {},
    CLEANUP_OK,
    { manualVisualEvidence: true }
  );

  assert.equal(acceptance.status, "needs-manual-visual-review");
  assert.equal(acceptance.code, "manual-evidence-recorded-diagnostic-only");
  assert.equal(isAcceptedProbeSummary(acceptance), false);
});

test("explicitly retained artifacts satisfy cleanup policy without pretending tmp was removed", () => {
  const cleanup = { ...CLEANUP_OK, tmpRemoved: false, artifactsRetained: true };
  const acceptance = classifyProbeOutcome(makeOutcome({ parse: "parsed" }), {}, cleanup);

  assert.equal(acceptance.gates.cleanup, true);
  assert.equal(acceptance.status, "needs-manual-visual-review");
});

function makeOutcome(options: {
  parse?: "blocked" | "parsed";
  statePayload?: Record<string, unknown>;
  preTriggerProbeEvents?: Array<Record<string, unknown>>;
  probeMutation?: (events: Array<Record<string, unknown>>) => Record<string, unknown>;
  probeEventsMutation?: (events: Array<Record<string, unknown>>) => void;
  frameSamples?: Array<Record<string, unknown>>;
  canonicalization?: Record<string, unknown>;
} = {}) {
  const parse = options.parse ?? "blocked";
  const probeEvents: Array<Record<string, unknown>> = [
    { stage: "state_sleep_trigger", atMs: 100, runId: RUN_ID },
    { stage: "load_attempt", atMs: 105, runId: RUN_ID, motionPresetId: "yawn-once", loop: false },
    { stage: "load_succeeded", atMs: 110, runId: RUN_ID, motionPresetId: "yawn-once", byteLength: 123 },
    { stage: "parse_attempt", atMs: 115, runId: RUN_ID, motionPresetId: "yawn-once" },
    parse === "parsed"
      ? { stage: "parse_succeeded", atMs: 120, runId: RUN_ID, motionPresetId: "yawn-once", consistencyCheck: true }
      : { stage: "parser_blocked", atMs: 120, runId: RUN_ID, motionPresetId: "yawn-once", errorName: "unsupported-version" },
    ...(parse === "parsed" ? [
      { stage: "start_attempt", atMs: 125, runId: RUN_ID, motionPresetId: "yawn-once" },
      { stage: "start_succeeded", atMs: 130, runId: RUN_ID, motionPresetId: "yawn-once" }
    ] : []),
    { stage: "watchdog_stop", atMs: 5_095, runId: RUN_ID, motionPresetId: "yawn-once", nativeCompleted: false }
  ];
  if (options.probeMutation) {
    const replacement = options.probeMutation(probeEvents);
    const index = probeEvents.findIndex((event) => event.stage === replacement.stage);
    probeEvents[index] = replacement;
  }
  options.probeEventsMutation?.(probeEvents);

  return summarizeProbeOutcome({
    fixtureMotion: { Version: 3, Meta: { Loop: false } },
    canonicalization: options.canonicalization ?? CANONICALIZATION,
    timing: TIMING,
    preTriggerProbeEvents: options.preTriggerProbeEvents ?? [],
    stateEvent: {
      payload: {
        reason: "state_sleep",
        stateId: "sleep",
        type: "doze",
        durationMs: TIMING.durationMs,
        selectedActionType: "doze",
        candidateActionTypes: ["doze"],
        ...options.statePayload
      }
    },
    probeEvents,
    frameSamples: options.frameSamples ?? makeFrameSamples([2_000, 2_100, 2_050], ["a", "b", "c"]),
    restoredFrame: { nonTransparentPixels: 2_000, frameHash: "d", afterStopMs: 300 },
    runId: RUN_ID
  });
}

function makeFrameSamples(nonTransparentPixels: number[], hashes: string[], referenceName = "start_succeeded") {
  return [200, 2_500, 4_900].map((offsetMs, index) => ({
    nonTransparentPixels: nonTransparentPixels[index],
    frameHash: hashes[index],
    offsetMs,
    referenceName
  }));
}

function makePngEvidenceFrame(atMs: number, index: number) {
  const png = createRgbaPng(50, 50, (pixelIndex) => (
    pixelIndex < 10 && index % 2 === 1 ? [255, 0, 0, 255] : [255, 255, 255, 255]
  ));
  return {
    atMs,
    byteLength: png.length,
    data: png.toString("base64")
  };
}

function makePngMotionSequence(shouldChange: (pairIndex: number) => boolean, changedPixels: number) {
  let changedState = false;
  return Array.from({ length: 67 }, (_, frameIndex) => {
    if (frameIndex > 0 && shouldChange(frameIndex - 1)) changedState = !changedState;
    const png = createRgbaPng(50, 50, (pixelIndex) => (
      changedState && pixelIndex < changedPixels ? [255, 0, 0, 255] : [255, 255, 255, 255]
    ));
    return {
      atMs: 100 + frameIndex * 83,
      byteLength: png.length,
      data: png.toString("base64")
    };
  });
}

function makeIntervals(overrides: Array<[number, number]>) {
  const intervals = Array(66).fill(83);
  for (const [index, intervalMs] of overrides) intervals[index] = intervalMs;
  return intervals;
}

function withFrameIntervals(frames: Array<Record<string, any>>, intervals: number[]) {
  let atMs = 100;
  return frames.map((frame, index) => {
    if (index > 0) atMs += intervals[index - 1];
    return { ...frame, atMs };
  });
}

function createRgbaPng(width: number, height: number, pixelAt: (index: number) => number[]) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(y * width + x);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = pixel[0] ?? 0;
      raw[offset + 1] = pixel[1] ?? 0;
      raw[offset + 2] = pixel[2] ?? 0;
      raw[offset + 3] = pixel[3] ?? 0;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makePngChunk("IHDR", Buffer.from([
      ...uint32Bytes(width), ...uint32Bytes(height), 8, 6, 0, 0, 0
    ])),
    makePngChunk("IDAT", deflateSync(raw)),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createPngWithRawScanlines(width: number, height: number, raw: Buffer) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makePngChunk("IHDR", Buffer.from([
      ...uint32Bytes(width), ...uint32Bytes(height), 8, 6, 0, 0, 0
    ])),
    makePngChunk("IDAT", deflateSync(raw)),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

function makePngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  return Buffer.concat([
    Buffer.from(uint32Bytes(data.length)),
    typeBytes,
    data,
    Buffer.from(uint32Bytes(crc32(Buffer.concat([typeBytes, data]))))
  ]);
}

function replacePngChunk(buffer: Buffer, targetType: string, replace: (data: Buffer) => Buffer) {
  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    chunks.push(type === targetType
      ? makePngChunk(type, replace(buffer.subarray(dataStart, dataEnd)))
      : buffer.subarray(offset, dataEnd + 4));
    offset = dataEnd + 4;
  }
  return Buffer.concat(chunks);
}

function uint32Bytes(value: number) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function event(stage: string, atMs: number, detail: Record<string, unknown> = {}) {
  return { stage, atMs, runId: RUN_ID, motionPresetId: "yawn-once", ...detail };
}

function createFixedModelCandidateRoot(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "p2-63b-model-candidate-"));
  const modelRoot = join(root, "model");
  mkdirSync(modelRoot);
  writeFixedModelFiles(modelRoot, overrides);
  return root;
}

function writeFixedModelFiles(modelRoot: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(
    join(modelRoot, "yawn-once.motion3.json"),
    JSON.stringify({ ...makeExplicitDraft(), ...overrides }),
    "utf8"
  );
  writeFileSync(
    join(modelRoot, "魔女.cdi3.json"),
    JSON.stringify({ Parameters: YAWN_SEMANTIC_ALLOWLIST.map((Id) => ({ Id })) }),
    "utf8"
  );
}

function makeExplicitDraft() {
  const duration = 5.1;
  const curves = YAWN_SEMANTIC_ALLOWLIST.map((Id) => ({
    Target: "Parameter",
    Id,
    Segments: [0, 0, 0, duration, 1]
  }));
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: curves.length,
      TotalSegmentCount: curves.length,
      TotalPointCount: curves.length * 2,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: curves,
    UserData: []
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
