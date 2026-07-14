import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as runner from "./p2-63c-3d-autonomous-breath-runtime-real-ui.mjs";

const { analyzeBreathSamples, validateBreathSummary } = runner;

const source = readFileSync("scripts/p2-63c-3d-autonomous-breath-runtime-real-ui.mjs", "utf8");

function samples(cycles = 3.2, phaseMs = 0) {
  return Array.from({ length: Math.floor((cycles * 3500) / 200) + 1 }, (_, index) => {
    const timestampMs = index * 200;
    return { timestampMs, minimum: 0, maximum: 1, value: 0.5 + 0.08 * Math.sin(((timestampMs + phaseMs) / 3500) * Math.PI * 2), vertexHash: `v${index % 3}`, canvasHash: `c${index % 2}` };
  });
}

function validMotionAudit() {
  return runner.auditRegisteredYawnMotion({
    exists: true,
    motion: { Curves: [{ Target: "Parameter", Id: "ParamAngleX" }] },
    sha256: "abc"
  });
}

function validRuntimeHealth() {
  return { ok: true };
}

function runtimeHealthInput() {
  return {
    telemetryEvents: [
      { type: "first_frame", payload: { renderer: "live2d" } },
      { type: "pet_health", payload: { renderer: "live2d", nonTransparentPixels: 1200, isContextLost: false } }
    ],
    runtimeExceptions: [],
    consoleMessages: [],
    webglLostCount: 0,
    webglRestoredCount: 0,
    webglFinallyLost: false,
    rendererProcessGoneCount: 0,
    childProcessGoneCount: 0,
    observerErrors: [],
    model3Probe: {
      requestedUrl: "pet-model://witch/%E9%AD%94%E5%A5%B3.model3.json",
      responseUrl: "pet-model://witch/%E9%AD%94%E5%A5%B3.model3.json",
      hasVersion: true,
      moc: "魔女.moc3"
    },
    observer: { errors: [] }
  };
}

test("breath analysis accepts three crossings and two valid periods across an 11.2 second observation", () => {
  const result = analyzeBreathSamples(samples());
  assert.equal(result.finite, true);
  assert.equal(result.inRange, true);
  assert.equal(result.movesBothWays, true);
  assert.equal(result.periodic, true);
  assert.equal(result.enoughCycles, true);
  assert.equal(result.amplitudeReasonable, true);
  assert.equal(result.vertexChanged, true);
  assert.equal(result.canvasChanged, true);
  assert.equal(result.observedDurationMs, 11_200);
  assert.equal(result.sampleCount >= 50, true);
  assert.equal(result.upwardCrossings, 3);
  assert.equal(result.crossingTimestampsMs.length, 3);
  assert.equal(result.periodIntervalsMs.length, 2);
  assert.equal(result.periodIntervalsMs.every((period) => Math.abs(period - 3500) <= 350), true);
  assert.equal(result.sampleIntervalStats.averageMs, 200);
  assert.equal(result.observedLongEnough, true);
});

test("breath analysis rejects an observation with only two upward crossings", () => {
  const result = analyzeBreathSamples(samples(2.2));
  assert.equal(result.upwardCrossings, 2);
  assert.equal(result.periodIntervalsMs.length, 1);
  assert.equal(result.enoughCycles, false);
  assert.equal(result.periodic, false);
});

test("breath analysis rejects a short window even with three crossings and two valid intervals", () => {
  const result = analyzeBreathSamples(samples(10_000 / 3500, 1_000));
  assert.equal(result.upwardCrossings, 3);
  assert.equal(result.periodIntervalsMs.length, 2);
  assert.equal(result.periodic, true);
  assert.equal(result.finite, true);
  assert.equal(result.observedDurationMs, 10_000);
  assert.equal(result.observedLongEnough, false);
});

test("breath summary rejects invalid range, one-way values, actions, absent telemetry, errors, and incomplete cleanup", () => {
  const bad = samples(2.2).map((sample) => ({ ...sample, value: 1.2, vertexHash: "same", canvasHash: "same" }));
  const result = validateBreathSummary({ samples: bad, actionEvents: [{ type: "pet_interaction_action_started" }], observer: { errors: ["read failed"] }, cleanup: {}, error: { message: "failure" } });
  assert.equal(result.ok, false);
  assert.equal(result.checks.inRange, false);
  assert.equal(result.checks.movesBothWays, false);
  assert.equal(result.checks.noActionDuringSample, false);
  assert.equal(result.checks.telemetryBreathUpdates, false);
  assert.equal(result.checks.observerErrors, false);
  assert.equal(result.checks.prototypeRestored, false);
  assert.equal(result.checks.runDirRemoved, false);
});

test("finalize rejects each cleanup failure after the run has finished", () => {
  const base = {
    samples: samples(),
    telemetryEvents: [{ type: "pet_performance_sample", payload: { breathUpdates: 10, breathUpdatesPerSecond: 30 } }],
    actionEvents: [],
    observer: { errors: [] },
    cleanup: { prototypeRestored: true, electronStopped: true, runDirRemoved: true, tmpResidue: true },
    motionAudit: validMotionAudit(),
    runtimeHealth: validRuntimeHealth(),
    error: null
  };

  for (const key of ["prototypeRestored", "electronStopped", "runDirRemoved", "tmpResidue"]) {
    const result = runner.finalizeBreathRun({
      ...base,
      cleanup: { ...base.cleanup, [key]: false }
    });
    assert.equal(result.ok, false, key);
    assert.equal(result.checks[key], false, key);
    assert.equal(result.checks.runtimeHealth, true, key);
    assert.deepEqual(
      Object.entries(result.checks).filter(([, passed]) => !passed).map(([name]) => name),
      [key],
      key
    );
  }
});

test("cleanup removes the exact run parent only after its timestamp directory leaves it empty", () => {
  const runParentDir = mkdtempSync(join(tmpdir(), "p2-63c-3d-empty-"));
  const runDir = join(runParentDir, "timestamp");
  const appDataDir = join(runDir, "user-data");
  mkdirSync(appDataDir, { recursive: true });
  writeFileSync(join(appDataDir, "runtime.log"), "fixture");

  const cleanup = runner.removeThisRun({ runParentDir, runDir, appDataDir });
  assert.equal(cleanup.runDirRemoved, true);
  assert.equal(cleanup.tmpResidue, true);
  assert.deepEqual(cleanup.preserved, []);
  assert.equal(existsSync(runParentDir), false);
});

test("cleanup preserves a nonempty run parent and fails the tmpResidue gate", () => {
  const runParentDir = mkdtempSync(join(tmpdir(), "p2-63c-3d-preserved-"));
  const runDir = join(runParentDir, "timestamp");
  const appDataDir = join(runDir, "user-data");
  const preservedDir = join(runParentDir, "other-run");
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(preservedDir);

  try {
    const cleanup = runner.removeThisRun({ runParentDir, runDir, appDataDir });
    assert.equal(cleanup.runDirRemoved, true);
    assert.equal(cleanup.tmpResidue, false);
    assert.deepEqual(cleanup.preserved, ["other-run"]);
    assert.equal(existsSync(runParentDir), true);
    assert.equal(existsSync(preservedDir), true);

    const summary = runner.finalizeBreathRun({
      samples: samples(),
      telemetryEvents: [{ type: "pet_performance_sample", payload: { breathUpdates: 10, breathUpdatesPerSecond: 30 } }],
      actionEvents: [],
      observer: { errors: [] },
      cleanup: { prototypeRestored: true, electronStopped: true, ...cleanup },
      motionAudit: validMotionAudit(),
      runtimeHealth: validRuntimeHealth(),
      error: null
    });
    assert.equal(summary.checks.tmpResidue, false);
    assert.equal(summary.ok, false);
  } finally {
    rmSync(runParentDir, { recursive: true, force: true });
  }
});

test("runtime health requires the real witch model3 identity, first frame, and nonblank Live2D health", () => {
  const valid = runner.summarizeRuntimeHealth(runtimeHealthInput());
  assert.equal(valid.ok, true);
  assert.equal(valid.model3.url, "pet-model://witch/%E9%AD%94%E5%A5%B3.model3.json");
  assert.equal(valid.model3.identity, "witch/魔女.model3.json");
  assert.equal(valid.renderEvidence.eventType, "pet_health");
  assert.equal(valid.checks.firstFramePresent, true);
  assert.equal(valid.checks.nonblankLive2DHealth, true);

  const wrongModel = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    model3Probe: { ...runtimeHealthInput().model3Probe, responseUrl: "pet-model://other/model.model3.json" }
  });
  assert.equal(wrongModel.checks.realWitchModel3, false);
});

test("runtime health rejects a missing independent first_frame event", () => {
  const missingFirstFrame = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    telemetryEvents: [{ type: "pet_health", payload: { renderer: "live2d", nonTransparentPixels: 1200 } }]
  });
  assert.equal(missingFirstFrame.checks.firstFramePresent, false);
  assert.equal(missingFirstFrame.checks.nonblankLive2DHealth, true);
  assert.equal(missingFirstFrame.ok, false);
});

test("runtime health rejects a missing or invalid nonblank Live2D pet_health event", () => {
  for (const payload of [
    null,
    { renderer: "placeholder", nonTransparentPixels: 1200 },
    { renderer: "live2d", nonTransparentPixels: 0 }
  ]) {
    const missingFrame = runner.summarizeRuntimeHealth({
      ...runtimeHealthInput(),
      telemetryEvents: [
        { type: "first_frame", payload: { renderer: "live2d" } },
        ...(payload ? [{ type: "pet_health", payload }] : [])
      ]
    });
    assert.equal(missingFrame.checks.firstFramePresent, true);
    assert.equal(missingFrame.checks.nonblankLive2DHealth, false);
    assert.equal(missingFrame.ok, false);
  }
});

test("runtime health rejects any CDP Runtime.exceptionThrown event", () => {
  const result = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    runtimeExceptions: [{ text: "uncaught", lineNumber: 10, columnNumber: 2 }]
  });
  assert.equal(result.checks.noRuntimeExceptions, false);
  assert.equal(result.cdp.runtimeExceptionCount, 1);
  assert.equal(result.ok, false);
});

test("runtime health applies an exact console warning whitelist and rejects non-whitelisted text", () => {
  const allowedText = runner.ALLOWED_CONSOLE_WARNING_TEXTS[0];
  const allowed = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    consoleMessages: [{ type: "warning", text: allowedText }]
  });
  assert.equal(allowed.checks.consoleWarningErrorsClean, true);
  assert.equal(allowed.console.allowedCount, 1);
  assert.equal(allowed.console.unexpectedCount, 0);

  const unexpected = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    consoleMessages: [{ type: "warning", text: `${allowedText} extra` }]
  });
  assert.equal(unexpected.checks.consoleWarningErrorsClean, false);
  assert.equal(unexpected.console.allowedCount, 0);
  assert.equal(unexpected.console.unexpectedCount, 1);
  assert.equal(unexpected.ok, false);
});

test("runtime health rejects unbalanced WebGL events and a balanced but finally-lost context", () => {
  const unbalanced = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    webglLostCount: 1,
    webglRestoredCount: 0,
    webglFinallyLost: true
  });
  assert.equal(unbalanced.webgl.balanced, false);
  assert.equal(unbalanced.checks.webglBalancedAndRestored, false);
  assert.equal(unbalanced.ok, false);

  const finallyLost = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    webglLostCount: 1,
    webglRestoredCount: 1,
    webglFinallyLost: true
  });
  assert.equal(finallyLost.webgl.balanced, true);
  assert.equal(finallyLost.webgl.finallyLost, true);
  assert.equal(finallyLost.checks.webglBalancedAndRestored, false);
  assert.equal(finallyLost.ok, false);
});

test("runtime health rejects renderer_process_gone telemetry", () => {
  const result = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    rendererProcessGoneCount: 1
  });
  assert.equal(result.checks.noRendererProcessGone, false);
  assert.equal(result.processes.rendererProcessGoneCount, 1);
  assert.equal(result.processes.childProcessGoneCount, 0);
  assert.equal(result.ok, false);
});

test("runtime health rejects child_process_gone telemetry", () => {
  const result = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    childProcessGoneCount: 1
  });
  assert.equal(result.checks.noChildProcessGone, false);
  assert.equal(result.processes.rendererProcessGoneCount, 0);
  assert.equal(result.processes.childProcessGoneCount, 1);
  assert.equal(result.ok, false);
});

test("runtime health preserves and rejects observer errors", () => {
  const result = runner.summarizeRuntimeHealth({
    ...runtimeHealthInput(),
    observerErrors: ["canvas-read-failed"]
  });
  assert.equal(result.checks.observerErrors, false);
  assert.deepEqual(result.observerErrors, ["canvas-read-failed"]);
  assert.equal(result.observerErrorCount, 1);
  assert.equal(result.ok, false);
});

test("telemetry gate requires a real performance sample with a positive breath update rate", () => {
  const base = {
    samples: samples(),
    actionEvents: [],
    observer: { errors: [] },
    cleanup: { prototypeRestored: true, electronStopped: true, runDirRemoved: true, tmpResidue: true },
    error: null
  };
  const missing = validateBreathSummary({ ...base, telemetryEvents: [] });
  const zeroRate = validateBreathSummary({
    ...base,
    telemetryEvents: [{ type: "pet_performance_sample", payload: { breathUpdates: 12, breathUpdatesPerSecond: 0 } }]
  });
  const positive = validateBreathSummary({
    ...base,
    telemetryEvents: [{ type: "pet_performance_sample", payload: { breathUpdates: 12, breathUpdatesPerSecond: 30 } }]
  });

  assert.equal(missing.checks.performanceSamplePresent, false);
  assert.equal(missing.checks.positiveBreathRate, false);
  assert.equal(zeroRate.checks.performanceSamplePresent, true);
  assert.equal(zeroRate.checks.positiveBreathRate, false);
  assert.equal(positive.checks.performanceSamplePresent, true);
  assert.equal(positive.checks.positiveBreathRate, true);
  assert.equal(positive.telemetry.cumulativeBreathUpdates, 12);
});

test("registered yawn motion audit uses the production path and rejects missing or ParamBreath curves", () => {
  assert.equal(
    runner.REGISTERED_YAWN_MOTION_RELATIVE_PATH,
    "resources/models/witch/motions/yawn-once.motion3.json"
  );
  const missing = runner.auditRegisteredYawnMotion({ exists: false, motion: null, sha256: null });
  const containsBreath = runner.auditRegisteredYawnMotion({
    exists: true,
    motion: { Curves: [{ Target: "Parameter", Id: "ParamBreath" }] },
    sha256: "abc"
  });
  const safe = runner.auditRegisteredYawnMotion({
    exists: true,
    motion: { Curves: [
      { Target: "Parameter", Id: "ParamAngleX" },
      { Target: "Parameter", Id: "ParamEyeLOpen" },
      { Target: "Model", Id: "Opacity" }
    ] },
    sha256: "def"
  });

  assert.equal(missing.ok, false);
  assert.equal(containsBreath.ok, false);
  assert.equal(containsBreath.containsParamBreath, true);
  assert.equal(safe.ok, true);
  assert.deepEqual(safe.controlledParameterIds, ["ParamAngleX", "ParamEyeLOpen"]);
});

test("runner dynamically imports the loaded CubismBreath module, restores its prototype, and only removes its timestamp run", () => {
  assert.match(source, /readdirSync\(assetsDir\)/u);
  assert.match(source, /pathToFileURL/u);
  assert.doesNotMatch(source, /performance\.getEntriesByType\("resource"\)/u);
  assert.match(source, /await import\(resourceUrl\)/u);
  assert.match(source, /CubismBreath\.prototype\.updateParameters/u);
  assert.match(source, /original\.call\(this, model, deltaSeconds\)/u);
  assert.match(source, /model\.getParameterValueByIndex/u);
  assert.match(source, /model\.getDrawableVertices/u);
  assert.match(source, /gl\.readPixels/u);
  assert.match(source, /summarizeRuntimeHealth\(\{[\s\S]*runtimeExceptions:[\s\S]*consoleMessages:[\s\S]*webglLostCount[\s\S]*webglRestoredCount[\s\S]*webglFinallyLost[\s\S]*rendererProcessGoneCount[\s\S]*childProcessGoneCount[\s\S]*observerErrors:/u);
  assert.doesNotMatch(source, /Object\.assign\(runtimeHealth/u);
  assert.match(source, /rmSync\(context\.runDir/u);
  assert.doesNotMatch(source, /cleanupRealUiRun/u);
  assert.doesNotMatch(source, /Page\.captureScreenshot/u);
});

test("canvas samples are completed in a microtask after the parameter update", () => {
  assert.match(source, /queueMicrotask\(\(\) => \{[\s\S]*gl\.readPixels[\s\S]*observer\.samples\.push/u);
});

test("quiet-window filtering excludes startup actions before the cursor and retains later native motion telemetry", () => {
  const events = [
    { type: "pet_interaction_action_finished", payload: { type: "appearance" } },
    { type: "pet_interaction_action_started", payload: { type: "edgeGlance", reason: "pet_edge_settled" } },
    { type: "pet_interaction_action_finished", payload: { type: "edgeGlance", reason: "pet_edge_settled" } },
    { type: "pet_performance_sample", payload: { breathUpdates: 10 } },
    { type: "pet_interaction_action_started", payload: { type: "doze", motionPresetId: "yawn-once", nativePhase: "started" } }
  ];

  assert.deepEqual(runner.selectActionTelemetryEvents(events, 3), [events[4]]);
});
