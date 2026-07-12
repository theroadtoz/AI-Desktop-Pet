import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertNoPreTriggerYawnLoad,
  classifyProbeOutcome,
  createIsolatedMotionFixture,
  createSourceGateBlockedSummary,
  deriveYawnProbeTiming,
  injectIsolatedCubismProbe,
  injectIsolatedMotionPreset,
  injectIsolatedStateSleepPath,
  isAcceptedProbeSummary,
  shouldKeepP263BArtifacts,
  summarizeProbeOutcome
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
  consistencyCheck: true
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
  assert.match(probed, /CubismMotion\.create\(buffer, buffer\.byteLength, undefined, undefined, true\)/u);
  assert.match(probed, /"parse_succeeded", \{ motionPresetId, consistencyCheck: true \}/u);
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
  assert.equal(outcome.watchdogStop.elapsedMs, 4_990);
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
    canonicalization: CANONICALIZATION,
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
    frameSamples: [
      { nonTransparentPixels: 2_000, frameHash: "a", offsetMs: 200 },
      { nonTransparentPixels: 2_100, frameHash: "b", offsetMs: 2_500 },
      { nonTransparentPixels: 2_050, frameHash: "c", offsetMs: 4_900 }
    ],
    restoredFrame: { nonTransparentPixels: 2_000, frameHash: "d", afterStopMs: 300 },
    runId: RUN_ID
  });
}
