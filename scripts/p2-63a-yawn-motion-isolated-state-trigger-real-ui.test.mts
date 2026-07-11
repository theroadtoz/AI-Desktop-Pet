import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertNoPreTriggerYawnLoad,
  classifyProbeOutcome,
  createIsolatedMotionFixture,
  injectIsolatedCubismProbe,
  injectIsolatedMotionPreset,
  injectIsolatedStateSleepPath,
  isAcceptedProbeSummary,
  summarizeProbeOutcome
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";

const RUN_ID = "unit-run";
const CLEANUP_OK = {
  electronStopped: true,
  tmpRemoved: true,
  protectedFilesRestored: true,
  screenshotResidue: [],
  errors: []
};

test("isolated yawn fixture forces Loop false without rewriting Version", () => {
  const source = { Version: 0, Meta: { Duration: 4.98, Loop: true }, Curves: [] };
  const fixture = createIsolatedMotionFixture(source);

  assert.equal(fixture.Version, 0);
  assert.equal(fixture.Meta.Loop, false);
  assert.equal(source.Meta.Loop, true);
});

test("isolated transforms bind yawn only on the state_sleep path for the real duration", () => {
  const presetSource = readFileSync("src/shared/pet-motion-presets.ts", "utf8");
  const mainSource = readFileSync("src/renderer/pet/main.ts", "utf8");
  const interactionSource = readFileSync("src/renderer/pet/interaction-actions.ts", "utf8");
  const cubismSource = readFileSync("src/renderer/pet/live2d/cubism-motion.ts", "utf8");

  assert.match(injectIsolatedMotionPreset(presetSource), /id: "yawn-once"[\s\S]*durationHintSeconds: 4\.986[\s\S]*loop: false/u);
  const patchedMain = injectIsolatedStateSleepPath(mainSource, RUN_ID);
  assert.match(patchedMain, /trigger\.reason === "state_sleep"[\s\S]*durationMs: 4986[\s\S]*motionPresetId: "yawn-once"/u);
  assert.doesNotMatch(interactionSource, /motionPresetId: "yawn-once"/u);
  const probed = injectIsolatedCubismProbe(cubismSource, RUN_ID);
  for (const stage of ["load_attempt", "parse_attempt", "parser_blocked", "start_attempt", "watchdog_stop"]) {
    assert.match(probed, new RegExp(`"${stage}"`, "u"));
  }
  assert.match(probed, /runId: "unit-run"/u);
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
  assert.equal(acceptance.status, "needs-manual-review");
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

test("passed status and ok cannot diverge when manual visual evidence exists", () => {
  const acceptance = classifyProbeOutcome(
    makeOutcome({ parse: "parsed" }),
    {},
    CLEANUP_OK,
    { manualVisualEvidence: true }
  );

  assert.equal(acceptance.status, "passed");
  assert.equal(isAcceptedProbeSummary(acceptance), true);
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
      ? { stage: "parse_succeeded", atMs: 120, runId: RUN_ID, motionPresetId: "yawn-once" }
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
    fixtureMotion: { Version: 0, Meta: { Loop: false } },
    preTriggerProbeEvents: options.preTriggerProbeEvents ?? [],
    stateEvent: {
      payload: {
        reason: "state_sleep",
        stateId: "sleep",
        type: "doze",
        durationMs: 4_986,
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
