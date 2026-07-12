import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ABSENT_PROTECTED_PATH,
  assertNoPreTriggerYawnLoad,
  classifyProbeOutcome,
  createExplicitDraftInputBlockedSummary,
  createPublicArtifactSummary,
  createIsolatedMotionFixture,
  createSourceGateBlockedSummary,
  deriveYawnProbeTiming,
  injectIsolatedCubismProbe,
  injectIsolatedMotionPreset,
  injectIsolatedStateSleepPath,
  isAcceptedProbeSummary,
  hashProtectedPaths,
  parseRunnerArgs,
  protectedHashesEqual,
  readExplicitDraftFromUserData,
  removeCurrentRunArtifacts,
  sanitizePublicText,
  shouldKeepP263BArtifacts,
  summarizeProbeOutcome,
  validateExplicitDraftMotion,
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
  assert.deepEqual(parseRunnerArgs(["--source-user-data", resolve("fixture-user-data")]), {
    mode: "explicit-draft",
    sourceUserDataRoot: resolve("fixture-user-data")
  });
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
  const summary = createPublicArtifactSummary({ runDir }, fixtureRoot, [
    join(runDir, "p2-63b-yawn-start-200ms.png"),
    join(runDir, "p2-63b-yawn-restored.png")
  ]);

  assert.deepEqual(summary, {
    runDirectory: ".tmp/p2-63a-runner/retained-run",
    fixturePath: "isolated-app/model-fixture/yawn.motion3.json",
    screenshotBasenames: ["p2-63b-yawn-start-200ms.png", "p2-63b-yawn-restored.png"]
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
  assert.equal(summary.phase, "explicit-draft-input");
  assert.equal(summary.realUi.launchAttempted, false);
  assert.equal(summary.manualVisualPass, false);
  assert.doesNotMatch(run.stdout, new RegExp(escapeRegExp(missingRoot), "u"));
});

test("explicit draft input catch sanitizes acceptance and error paths", () => {
  const summary = createExplicitDraftInputBlockedSummary(new Error(
    "failed C:\\Users\\private-user\\draft.json \\\\server\\share\\draft.json file:///D:/secret/draft.json"
  ));
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
  const probed = injectIsolatedCubismProbe(cubismSource, RUN_ID);
  for (const stage of ["load_attempt", "parse_attempt", "parser_blocked", "start_attempt", "watchdog_stop"]) {
    assert.match(probed, new RegExp(`"${stage}"`, "u"));
  }
  assert.match(probed, /runId: "unit-run"/u);
  assert.doesNotMatch(probed, /errorMessage|error\.message/u);
  assert.match(probed, /CubismMotion\.create\(buffer, buffer\.byteLength, undefined, undefined, true\)/u);
  assert.match(
    probed,
    /CubismMotion\.create\(buffer, buffer\.byteLength, undefined, undefined, true\)[\s\S]*motion\.setEffectIds\(\[\], \[\]\)[\s\S]*"parse_succeeded"/u
  );
  assert.doesNotMatch(probed, /PAUSE_MOTION_UPDATE|motion_resume/u);
  assert.match(probed, /"parse_succeeded", \{ motionPresetId, consistencyCheck: true \}/u);
});

test("canvas sampling waits for a renderer animation frame", () => {
  const runnerSource = readFileSync("scripts/p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs", "utf8");
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
