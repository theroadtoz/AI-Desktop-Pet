import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeMotion3 } from "./support/motion3-canonicalizer.mts";
import {
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  setPresenceMode,
  sleep,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-63a-yawn-motion-isolated-state-trigger-real-ui";
const YAWN_PRESET_ID = "yawn-once";
export const YAWN_SEMANTIC_ALLOWLIST = Object.freeze([
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamEyeLOpen",
  "ParamEyeROpen",
  "ParamBrowLY",
  "ParamBrowLForm",
  "ParamMouthOpenY",
  "ParamMouthForm"
]);
const PROTECTED_PATHS = [
  "resources/models/witch/model-manifest.json",
  "model/yawn.motion3.json",
  "src/shared/pet-motion-presets.ts",
  "src/shared/interaction-action-catalog.ts",
  "src/renderer/pet/interaction-actions.ts",
  "src/renderer/pet/main.ts",
  "src/renderer/pet/live2d/cubism-motion.ts"
];

export function createIsolatedMotionFixture(sourceMotion, modelParameterIds) {
  return canonicalizeMotion3(sourceMotion, modelParameterIds, YAWN_SEMANTIC_ALLOWLIST);
}

export function createSourceGateBlockedSummary(sourceGate, durationMs = 0) {
  const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const safeSourceVersion = Number.isFinite(sourceGate.sourceVersion) ? sourceGate.sourceVersion : null;
  const safeSourceGate = {
    safeSummaryOnly: true,
    status: "blocked",
    sourceVersion: safeSourceVersion,
    outputVersion: null,
    sourceCurveCount: safeCount(sourceGate.sourceCurveCount),
    sourceSegmentCount: safeCount(sourceGate.sourceSegmentCount),
    sourcePointCount: safeCount(sourceGate.sourcePointCount),
    retainedCurveCount: safeCount(sourceGate.retainedCurveCount),
    retainedSegmentCount: safeCount(sourceGate.retainedSegmentCount),
    retainedPointCount: safeCount(sourceGate.retainedPointCount),
    consistencyCheck: false,
    blockers: Array.isArray(sourceGate.blockers)
      ? sourceGate.blockers.filter((blocker) => typeof blocker === "string" && /^[a-z0-9-]{1,64}$/u.test(blocker))
      : []
  };
  const acceptance = safeSourceGate.blockers[0] ?? "source-motion-gate-blocked";
  return {
    safeSummaryOnly: true,
    ok: false,
    status: "blocked",
    acceptance,
    phase: "source-meta-gate",
    isolatedFixture: false,
    diagnosticOnly: true,
    productionCatalogModified: false,
    durationMs: safeCount(durationMs),
    sourceGate: safeSourceGate,
    realUi: {
      launchAttempted: false,
      status: "not-started-source-gate-blocked"
    },
    rendererProbe: {
      created: false,
      events: []
    },
    fallback: {
      status: "vts-recorder-required",
      runner: "vts-motion-recorder",
      inspectCommand: "npm run vts:motion-recorder -- inspect",
      recordingRequiresExplicitConfirmation: true
    }
  };
}

export function deriveYawnProbeTiming(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("canonical yawn duration must be a positive finite number");
  }
  const durationMs = Math.round(durationSeconds * 1_000);
  const roundTo100 = (value) => Math.round(value / 100) * 100;
  return Object.freeze({
    durationSeconds,
    durationMs,
    watchdogMinMs: Math.max(1, durationMs - 300),
    watchdogMaxMs: durationMs + 800,
    sampleOffsetsMs: Object.freeze([
      roundTo100(durationMs * 0.04),
      roundTo100(durationMs * 0.5),
      roundTo100(durationMs * 0.98)
    ])
  });
}

export function shouldKeepP263BArtifacts(env = process.env) {
  return env.P2_63B_KEEP_ARTIFACTS === "1";
}

export function injectIsolatedMotionPreset(source, timing) {
  const marker = "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([]);";
  const replacement = `export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([
  {
    id: "${YAWN_PRESET_ID}",
    path: "yawn.motion3.json",
    durationHintSeconds: ${timing.durationSeconds},
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    loop: false,
    priority: 3,
    allowedStates: ["sleep"]
  }
]);`;

  return replaceExactlyOnce(source, marker, replacement, "motion preset catalog");
}

export function injectIsolatedStateSleepPath(source, timing, runId = "p2-63a-test-run") {
  const actionMarker = `  interactionActionPlayer.playAction(
    getPetInteractionAction(actionType),
    trigger.reason,`;
  const actionReplacement = `  const action = getPetInteractionAction(actionType);
  const isolatedAction = trigger.reason === "state_sleep"
    ? { ...action, durationMs: ${timing.durationMs}, motionPresetId: "${YAWN_PRESET_ID}" as const }
    : action;
  if (trigger.reason === "state_sleep") {
    const target = globalThis as typeof globalThis & { __P2_63A_YAWN_PROBE__?: Array<Record<string, unknown>> };
    const events = target.__P2_63A_YAWN_PROBE__ ?? [];
    events.push({ stage: "state_sleep_trigger", atMs: Math.round(performance.now()), runId: ${JSON.stringify(runId)} });
    target.__P2_63A_YAWN_PROBE__ = events;
  }
  interactionActionPlayer.playAction(
    isolatedAction,
    trigger.reason,`;

  return replaceExactlyOnce(source, actionMarker, actionReplacement, "isolated state_sleep action path");
}

export function injectIsolatedCubismProbe(source, runId = "p2-63a-test-run") {
  const helperMarker = "export async function createCubismMotionController(): Promise<CubismMotionController> {";
  const helper = `function reportP263AProbe(stage: string, detail: Record<string, unknown> = {}): void {
  const target = globalThis as typeof globalThis & { __P2_63A_YAWN_PROBE__?: Array<Record<string, unknown>> };
  const events = target.__P2_63A_YAWN_PROBE__ ?? [];
  events.push({ stage, atMs: Math.round(performance.now()), runId: ${JSON.stringify(runId)}, ...detail });
  target.__P2_63A_YAWN_PROBE__ = events;
}

${helperMarker}`;
  let output = replaceExactlyOnce(source, helperMarker, helper, "probe helper");

  output = replaceExactlyOnce(
    output,
    `    const load = (async () => {
      const buffer = await fetchArrayBuffer(resolveModelAssetUrl(preset.path));
      const motion = CubismMotion.create(buffer, buffer.byteLength);

      if (!motion) {
        return null;
      }`,
    `    const load = (async () => {
      reportP263AProbe("load_attempt", { motionPresetId, loop: preset.loop });
      const buffer = await fetchArrayBuffer(resolveModelAssetUrl(preset.path));
      reportP263AProbe("load_succeeded", { motionPresetId, byteLength: buffer.byteLength });
      reportP263AProbe("parse_attempt", { motionPresetId });
      let motion: CubismMotion | null = null;

      try {
        motion = CubismMotion.create(buffer, buffer.byteLength, undefined, undefined, true);
      } catch (error) {
        reportP263AProbe("parser_blocked", {
          motionPresetId,
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message.slice(0, 180) : "unknown"
        });
        throw error;
      }

      if (!motion) {
        reportP263AProbe("parser_blocked", { motionPresetId, errorName: "null-motion" });
        return null;
      }
      reportP263AProbe("parse_succeeded", { motionPresetId, consistencyCheck: true });`,
    "Cubism load/parse probe"
  );

  output = replaceExactlyOnce(
    output,
    "  const motionLoads = new Map<PetMotionPresetId, MotionLoad>();",
    "  const motionLoads = new Map<PetMotionPresetId, MotionLoad>();\n  let activeProbeMotionPresetId: PetMotionPresetId | null = null;",
    "active probe state"
  );

  output = replaceExactlyOnce(
    output,
    `      const handle = manager.startMotionPriority(motion, false, preset.priority);

      if (handle === -1) {`,
    `      reportP263AProbe("start_attempt", { motionPresetId, priority: preset.priority });
      const handle = manager.startMotionPriority(motion, false, preset.priority);

      if (handle === -1) {
        reportP263AProbe("start_blocked", { motionPresetId });`,
    "Cubism start attempt probe"
  );

  output = replaceExactlyOnce(
    output,
    `      return {
        status: "started",
        motionPresetId,`,
    `      activeProbeMotionPresetId = motionPresetId;
      reportP263AProbe("start_succeeded", { motionPresetId });
      return {
        status: "started",
        motionPresetId,`,
    "Cubism start success probe"
  );

  output = replaceExactlyOnce(
    output,
    `    stop(): void {
      manager.stopAllMotions();
    },`,
    `    stop(): void {
      reportP263AProbe("watchdog_stop", {
        motionPresetId: "${YAWN_PRESET_ID}",
        hadActiveNativeMotion: activeProbeMotionPresetId === "${YAWN_PRESET_ID}",
        nativeCompleted: false
      });
      activeProbeMotionPresetId = null;
      manager.stopAllMotions();
    },`,
    "watchdog stop probe"
  );

  return output;
}

export function summarizeProbeOutcome({ fixtureMotion, canonicalization, timing, preTriggerProbeEvents, stateEvent, probeEvents, frameSamples, restoredFrame, runId }) {
  const findStage = (stage) => probeEvents.find((event) => event.stage === stage) ?? null;
  const loadAttempt = findStage("load_attempt");
  const parseBlocked = findStage("parser_blocked");
  const parseSucceeded = findStage("parse_succeeded");
  const startAttempt = findStage("start_attempt");
  const startSucceeded = findStage("start_succeeded");
  const watchdogStop = findStage("watchdog_stop");
  const watchdogElapsedMs = Number.isFinite(loadAttempt?.atMs) && Number.isFinite(watchdogStop?.atMs)
    ? watchdogStop.atMs - loadAttempt.atMs
    : null;
  const visibleSamples = frameSamples.filter((sample) => sample.nonTransparentPixels > 1_000);
  const changedHashes = new Set(frameSamples.map((sample) => sample.frameHash));
  const successfulStageNames = [
    "state_sleep_trigger",
    "load_attempt",
    "load_succeeded",
    "parse_attempt",
    "parse_succeeded",
    "start_attempt",
    "start_succeeded",
    "watchdog_stop"
  ];
  const successfulStages = successfulStageNames.map((stage) => {
    const index = probeEvents.findIndex((event) => event.stage === stage);
    return { event: index >= 0 ? probeEvents[index] : null, index };
  });
  const eventCorrelation = Boolean(
    stateEvent?.payload?.reason === "state_sleep" &&
    stateEvent?.payload?.stateId === "sleep" &&
    stateEvent?.payload?.type === "doze" &&
    stateEvent?.payload?.durationMs === timing.durationMs &&
    stateEvent?.payload?.selectedActionType === "doze" &&
    Array.isArray(stateEvent?.payload?.candidateActionTypes) &&
    stateEvent.payload.candidateActionTypes.length === 1 &&
    stateEvent.payload.candidateActionTypes[0] === "doze"
  );
  const probeCorrelation = successfulStages.every(({ event }) => event?.runId === runId);
  const strictEventOrder = successfulStages.every(({ index }, stageIndex) => (
    index >= 0 && (stageIndex === 0 || index > successfulStages[stageIndex - 1].index)
  ));
  const preTriggerNoYawnLoad = !preTriggerProbeEvents.some((event) => (
    event.stage === "load_attempt" && event.motionPresetId === YAWN_PRESET_ID
  ));
  const requiredSampleOffsets = timing.sampleOffsetsMs;
  const sampleTimingCovered = frameSamples.length === requiredSampleOffsets.length && frameSamples.every((sample, index) => (
    Number.isFinite(sample.offsetMs) && Math.abs(sample.offsetMs - requiredSampleOffsets[index]) <= 120
  ));

  return {
    stateSelection: {
      proven: Boolean(
        preTriggerNoYawnLoad &&
        eventCorrelation &&
        probeCorrelation &&
        strictEventOrder &&
        loadAttempt?.motionPresetId === YAWN_PRESET_ID &&
        loadAttempt?.loop === false
      ),
      preTriggerNoYawnLoad,
      eventCorrelation,
      probeCorrelation,
      strictEventOrder,
      reason: stateEvent?.payload?.reason ?? null,
      stateId: stateEvent?.payload?.stateId ?? null,
      actionType: stateEvent?.payload?.type ?? null,
      motionPresetId: YAWN_PRESET_ID
    },
    fixture: {
      sourceVersion: canonicalization.sourceVersion,
      outputVersion: fixtureMotion.Version ?? null,
      sourceCurveCount: canonicalization.sourceCurveCount,
      retainedCurveCount: canonicalization.retainedCurveCount,
      retainedSegmentCount: canonicalization.retainedSegmentCount,
      retainedPointCount: canonicalization.retainedPointCount,
      canonicalConsistencyCheck: canonicalization.consistencyCheck,
      cubismConsistencyCheck: parseSucceeded?.consistencyCheck === true,
      loopForcedFalse: fixtureMotion.Meta?.Loop === false,
      diagnosticOnly: true
    },
    load: {
      attempted: Boolean(findStage("load_attempt")),
      loaded: Boolean(findStage("load_succeeded")),
      detail: findStage("load_succeeded")
    },
    parse: {
      attempted: Boolean(findStage("parse_attempt")),
      status: parseSucceeded ? "parsed" : parseBlocked ? "blocked" : "not-observed",
      detail: parseSucceeded ?? parseBlocked
    },
    startAttempt: {
      attempted: Boolean(startAttempt),
      status: startSucceeded ? "started" : startAttempt ? "blocked" : parseBlocked ? "not-reached-parser-blocked" : "not-observed",
      nativeCompleted: false
    },
    visual: {
      visibleFrameObserved: visibleSamples.length > 0,
      frameChangeObserved: changedHashes.size > 1,
      evidenceLevel: "canvas-diagnostic-only",
      sampleTimingCovered,
      sampleCount: frameSamples.length,
      distinctFrameHashes: changedHashes.size,
      requiredOffsetsMs: requiredSampleOffsets,
      sampledOffsetsMs: frameSamples.map((sample) => sample.offsetMs ?? null)
    },
    watchdogStop: {
      observed: Boolean(watchdogStop),
      elapsedMs: watchdogElapsedMs,
      minMs: timing.watchdogMinMs,
      maxMs: timing.watchdogMaxMs,
      bounded: watchdogElapsedMs !== null && watchdogElapsedMs >= timing.watchdogMinMs && watchdogElapsedMs <= timing.watchdogMaxMs,
      nativeCompleted: false,
      detail: watchdogStop
    },
    restored: {
      visible: Boolean(restoredFrame && restoredFrame.nonTransparentPixels > 1_000),
      sampledAfterStopMs: restoredFrame?.afterStopMs ?? null,
      timely: Number.isFinite(restoredFrame?.afterStopMs) && restoredFrame.afterStopMs >= 250 && restoredFrame.afterStopMs <= 650,
      frame: restoredFrame
    }
  };
}

export function classifyProbeOutcome(outcome, runtimeDiagnostics, cleanup, visualEvidence = {}) {
  const runtimeText = Object.values(runtimeDiagnostics).join("\n");
  const rendererError = /Uncaught (?:TypeError|Error):/u.test(runtimeText);
  const cleanupPassed = Boolean(
    cleanup?.electronStopped &&
    (cleanup?.tmpRemoved || cleanup?.artifactsRetained) &&
    cleanup?.protectedFilesRestored &&
    cleanup?.screenshotResidue?.length === 0 &&
    cleanup?.errors?.length === 0
  );
  const gates = {
    state: outcome.stateSelection.proven,
    canonicalRuntime: Boolean(
      outcome.fixture.sourceVersion === 0 &&
      outcome.fixture.outputVersion === 3 &&
      outcome.fixture.sourceCurveCount === 237 &&
      outcome.fixture.retainedCurveCount === 9 &&
      outcome.fixture.retainedSegmentCount === 106 &&
      outcome.fixture.retainedPointCount === 327 &&
      outcome.fixture.canonicalConsistencyCheck &&
      outcome.fixture.cubismConsistencyCheck &&
      outcome.fixture.diagnosticOnly
    ),
    loop: outcome.fixture.loopForcedFalse,
    sampling: outcome.visual.sampleTimingCovered,
    watchdog: outcome.watchdogStop.bounded,
    restore: outcome.restored.visible && outcome.restored.timely,
    cleanup: cleanupPassed
  };
  const blockerEvidence = {
    sourceVersion: outcome.fixture.sourceVersion,
    parserStatus: outcome.parse.status,
    rendererError,
    visibleFrameObserved: outcome.visual.visibleFrameObserved,
    frameChangeObserved: outcome.visual.frameChangeObserved,
    gates
  };

  if (rendererError) {
    return { status: "blocked", code: "renderer-error", blockerEvidence, gates };
  }
  if (outcome.parse.status === "blocked") {
    return { status: "blocked", code: "cubism-parser-rejected-local-yawn", blockerEvidence, gates };
  }
  if (outcome.parse.status !== "parsed" || outcome.startAttempt.status !== "started") {
    return { status: "blocked", code: "native-motion-start-not-proven", blockerEvidence, gates };
  }
  if (Object.values(gates).some((passed) => !passed)) {
    return { status: "blocked", code: "required-gate-failed", blockerEvidence, gates };
  }
  return {
    status: "needs-manual-visual-review",
    code: visualEvidence.manualVisualEvidence ? "manual-evidence-recorded-diagnostic-only" : "native-started-visual-unproven",
    blockerEvidence,
    gates
  };
}

export function isAcceptedProbeSummary(acceptance) {
  return acceptance.status === "passed" && Object.values(acceptance.gates).every(Boolean);
}

async function main() {
  const startedAt = Date.now();
  let sourceGate;
  try {
    sourceGate = readCurrentYawnSourceGate();
  } catch {
    sourceGate = {
      status: "blocked",
      summary: {
        safeSummaryOnly: true,
        status: "blocked",
        sourceVersion: null,
        outputVersion: null,
        sourceCurveCount: 0,
        sourceSegmentCount: 0,
        sourcePointCount: 0,
        retainedCurveCount: 0,
        retainedSegmentCount: 0,
        retainedPointCount: 0,
        consistencyCheck: false,
        blockers: ["source-motion-gate-unavailable"]
      }
    };
  }
  if (sourceGate.status !== "canonicalized") {
    const summary = createSourceGateBlockedSummary(sourceGate.summary, Date.now() - startedAt);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }

  const protectedBefore = hashProtectedPaths();
  const context = createRealUiRunContext({
    runName: RUN_NAME,
    port: Number(process.env.P2_63A_CDP_PORT || 9663),
    tmpResiduePatterns: [/^p2-63a-/i]
  });
  const fixtureRoot = join(context.runDir, "isolated-app");
  const keepArtifacts = shouldKeepP263BArtifacts();
  const runId = context.stamp;
  let summary = null;
  let outcome = null;
  let runtimeDiagnostics = {};
  let canonicalization = null;
  let timing = null;
  let screenshotPaths = [];
  const cleanup = {
    electronStopped: false,
    tmpRemoved: false,
    artifactsRetained: false,
    protectedFilesRestored: false,
    screenshotResidue: [],
    errors: []
  };

  try {
    const prepared = prepareIsolatedApp(fixtureRoot, runId);
    canonicalization = prepared.canonicalization;
    timing = prepared.timing;
    await buildIsolatedRenderer(fixtureRoot, context);
    startIsolatedElectron(context, fixtureRoot);
    await connectToElectron(context, 40_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
    await sleep(3_000);

    await evaluate(pet, "window.petApi?.openChat()");
    const chat = await waitForWindow(context, "renderer/chat/index.html", 20_000);
    await waitFor(chat, "Boolean(document.querySelector('#chat-page'))", { timeoutMs: 15_000 });
    await setPresenceMode(chat, "default");
    await sleep(2_000);
    const preTriggerProbeEvents = await readProbeEvents(pet);
    assertNoPreTriggerYawnLoad(preTriggerProbeEvents);
    await armTimedFrameSampler(pet, runId, timing.sampleOffsetsMs);
    const screenshotPromise = captureTimedScreenshots(pet, context, runId, timing.sampleOffsetsMs);
    const telemetryStartIndex = readTelemetryEvents(context).length - 1;
    await setPresenceMode(chat, "sleep");

    const stateEvent = await waitForTelemetry(context, (event) => (
      event.__index > telemetryStartIndex &&
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "state_sleep" &&
      event.payload?.stateId === "sleep" &&
      event.payload?.type === "doze" &&
      event.payload?.durationMs === timing.durationMs &&
      event.payload?.selectedActionType === "doze"
    ), 8_000);

    const [samples, capturedScreenshots] = await Promise.all([readTimedFrameSamples(pet), screenshotPromise]);
    screenshotPaths = capturedScreenshots;
    await waitForProbeStage(pet, "watchdog_stop", timing.watchdogMaxMs + 1_000);
    const probeEvents = await readProbeEvents(pet);
    await setPresenceMode(chat, "default");
    outcome = summarizeProbeOutcome({
      fixtureMotion: JSON.parse(readFileSync(join(fixtureRoot, "model-fixture", "yawn.motion3.json"), "utf8")),
      canonicalization,
      timing,
      preTriggerProbeEvents,
      stateEvent,
      probeEvents,
      frameSamples: samples.motion,
      restoredFrame: samples.restored,
      runId
    });
    runtimeDiagnostics = readRuntimeDiagnostics(context);
    summary = {
      ok: false,
      status: "pending-cleanup",
      acceptance: "pending-cleanup",
      isolatedFixture: true,
      diagnosticOnly: true,
      canonicalization,
      timing,
      productionCatalogModified: false,
      screenshotPersistence: keepArtifacts ? "retained-by-explicit-env" : "temporary-cleaned-by-default",
      durationMs: Date.now() - startedAt,
      outcome,
      probeEvents,
      runtimeDiagnostics
    };
  } catch (error) {
    runtimeDiagnostics = readRuntimeDiagnostics(context);
    summary = {
      ok: false,
      status: "failed",
      acceptance: "probe-failed",
      isolatedFixture: true,
      diagnosticOnly: true,
      canonicalization,
      timing,
      productionCatalogModified: false,
      screenshotPersistence: keepArtifacts ? "retained-by-explicit-env" : "temporary-cleaned-by-default",
      durationMs: Date.now() - startedAt,
      failure: sanitizeError(error),
      runtimeDiagnostics
    };
  } finally {
    await runCleanupStep(cleanup, "electron-stop", async () => {
      cleanup.electronStopped = await stopElectronAndVerify(context);
      if (!cleanup.electronStopped) throw new Error("Electron process or CDP endpoint remained alive");
    });
    await runCleanupStep(cleanup, "screenshot-residue", async () => {
      cleanup.screenshotResidue = findScreenshotResidue(context)
        .filter((path) => !path.includes(context.runParentDir))
        .map((path) => relative(ROOT, path));
      if (cleanup.screenshotResidue.length > 0) throw new Error("screenshot residue detected");
    });
    await runCleanupStep(cleanup, "tmp-remove", async () => {
      if (keepArtifacts) {
        cleanup.artifactsRetained = true;
        return;
      }
      rmSync(context.runParentDir, { force: true, recursive: true });
      cleanup.tmpRemoved = !existsSync(context.runParentDir);
      if (!cleanup.tmpRemoved) throw new Error("run temp directory remained");
    });
    await runCleanupStep(cleanup, "protected-paths", async () => {
      cleanup.protectedFilesRestored = protectedHashesEqual(protectedBefore, hashProtectedPaths());
      if (!cleanup.protectedFilesRestored) throw new Error("protected production path changed");
    });
  }

  summary.cleanup = cleanup;
  if (outcome) {
    const acceptance = classifyProbeOutcome(outcome, runtimeDiagnostics, cleanup);
    summary.status = acceptance.status;
    summary.acceptance = acceptance.code;
    summary.blockerEvidence = acceptance.blockerEvidence;
    summary.gates = acceptance.gates;
    summary.ok = isAcceptedProbeSummary(acceptance);
  }
  summary.artifacts = keepArtifacts ? {
    runDirectory: context.runDir,
    fixturePath: join(fixtureRoot, "model-fixture", "yawn.motion3.json"),
    screenshotPaths
  } : null;
  if (keepArtifacts) {
    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

export function prepareIsolatedApp(fixtureRoot, runId) {
  const sourceYawnPath = join(ROOT, "model", "yawn.motion3.json");
  const sourceBytes = readFileSync(sourceYawnPath);
  const sourceHashBefore = createHash("sha256").update(sourceBytes).digest("hex");
  const displayInfo = JSON.parse(readFileSync(join(ROOT, "model", "魔女.cdi3.json"), "utf8"));
  const modelParameterIds = displayInfo.Parameters.map(({ Id }) => Id);
  const canonicalResult = createIsolatedMotionFixture(JSON.parse(sourceBytes.toString("utf8")), modelParameterIds);
  if (canonicalResult.status !== "canonicalized") {
    throw new Error(`yawn source gate blocked: ${canonicalResult.summary.blockers.join(",") || "unknown"}`);
  }
  const timing = deriveYawnProbeTiming(canonicalResult.motion.Meta.Duration);

  mkdirSync(fixtureRoot, { recursive: true });
  for (const entry of ["dist", "public", "resources", "src"]) {
    cpSync(join(ROOT, entry), join(fixtureRoot, entry), { recursive: true });
  }
  for (const file of ["package.json", "vite.config.ts", "tsconfig.base.json", "tsconfig.renderer.json"]) {
    cpSync(join(ROOT, file), join(fixtureRoot, file));
  }
  symlinkSync(join(ROOT, "node_modules"), join(fixtureRoot, "node_modules"), "junction");
  createModelFixture(join(ROOT, "model"), join(fixtureRoot, "model-fixture"));

  const sourceHashAfter = createHash("sha256").update(readFileSync(sourceYawnPath)).digest("hex");
  if (sourceHashBefore !== sourceHashAfter) {
    throw new Error("source yawn hash changed during canonicalization");
  }
  const canonicalization = {
    ...canonicalResult.summary,
    sourceHashBefore,
    sourceHashAfter,
    sourceHashUnchanged: true,
    diagnosticOnly: true
  };
  const yawnPath = join(fixtureRoot, "model-fixture", "yawn.motion3.json");
  writeFileSync(yawnPath, `${JSON.stringify(canonicalResult.motion)}\n`, "utf8");

  const manifestPath = join(fixtureRoot, "resources", "models", "witch", "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sourceDir = "../../../model-fixture";
  manifest.motionPresets = [{
    id: YAWN_PRESET_ID,
    path: "yawn.motion3.json",
    durationHintSeconds: timing.durationSeconds,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    loop: false,
    priority: 3,
    allowedStates: ["sleep"]
  }];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  patchFile(join(fixtureRoot, "src", "shared", "pet-motion-presets.ts"), (source) => injectIsolatedMotionPreset(source, timing));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "main.ts"), (source) => injectIsolatedStateSleepPath(source, timing, runId));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-motion.ts"), (source) => injectIsolatedCubismProbe(source, runId));
  return { canonicalization, timing };
}

function readCurrentYawnSourceGate() {
  const sourceMotion = JSON.parse(readFileSync(join(ROOT, "model", "yawn.motion3.json"), "utf8"));
  const displayInfo = JSON.parse(readFileSync(join(ROOT, "model", "魔女.cdi3.json"), "utf8"));
  return createIsolatedMotionFixture(sourceMotion, displayInfo.Parameters.map(({ Id }) => Id));
}

function createModelFixture(sourceRoot, targetRoot) {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === "yawn.motion3.json" || entry.name === "model.zip") {
      continue;
    }
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      createModelFixture(sourcePath, targetPath);
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    linkSync(sourcePath, targetPath);
  }
  mkdirSync(targetRoot, { recursive: true });
}

function buildIsolatedRenderer(fixtureRoot, context) {
  const viteCmd = join(ROOT, "node_modules", ".bin", "vite.cmd");
  const child = spawn(viteCmd, ["build", "--config", join(fixtureRoot, "vite.config.ts")], {
    cwd: fixtureRoot,
    env: process.env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.buildChild = child;
  return waitForChild(child, context, "isolated-renderer-build");
}

function startIsolatedElectron(context, fixtureRoot) {
  const electronExe = join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  const child = spawn(electronExe, [fixtureRoot, `--remote-debugging-port=${context.port}`], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      APPDATA: context.appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: context.appDataDir,
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: "60000"
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => writeFileSync(join(context.runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(context.runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  context.child = child;
}

async function waitForChild(child, context, label) {
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  writeFileSync(join(context.runDir, `${label}.stdout.log`), Buffer.concat(stdout), "utf8");
  writeFileSync(join(context.runDir, `${label}.stderr.log`), Buffer.concat(stderr), "utf8");
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}: ${Buffer.concat(stderr).toString("utf8").slice(-500)}`);
  }
}

export function assertNoPreTriggerYawnLoad(probeEvents) {
  const earlyLoad = probeEvents.find((event) => (
    event.stage === "load_attempt" && event.motionPresetId === YAWN_PRESET_ID
  ));
  if (earlyLoad) {
    throw new Error("yawn load observed before state_sleep trigger");
  }
}

async function armTimedFrameSampler(pet, runId, sampleOffsetsMs) {
  await evaluate(pet, `
    (() => {
      const runId = ${JSON.stringify(runId)};
      const sampleOffsetsMs = ${JSON.stringify(sampleOffsetsMs)};
      const sleepFor = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ms)));
      const findStage = (stage) => (globalThis.__P2_63A_YAWN_PROBE__ ?? [])
        .find((event) => event.runId === runId && event.stage === stage);
      const waitForStage = async (stage, timeoutMs) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          const event = findStage(stage);
          if (event) return event;
          await sleepFor(10);
        }
        throw new Error("timed-frame-sampler-timeout:" + stage);
      };
      const capture = (label, offsetMs, referenceAtMs, referenceName) => {
        const canvas = document.querySelector("#pet-canvas");
        const gl = canvas?.getContext("webgl2");
        if (!canvas || !gl) throw new Error("missing-webgl2-pet-canvas");
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let nonTransparentPixels = 0;
        let hash = 2166136261;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] ?? 0;
          if (alpha > 8) nonTransparentPixels += 1;
          if (index % 64 === 0) {
            hash ^= (pixels[index] ?? 0) + ((pixels[index + 1] ?? 0) << 8) + ((pixels[index + 2] ?? 0) << 16) + (alpha << 24);
            hash = Math.imul(hash, 16777619) >>> 0;
          }
        }
        const sampledAtMs = Math.round(performance.now());
        return {
          label,
          width: canvas.width,
          height: canvas.height,
          contextLost: gl.isContextLost(),
          nonTransparentPixels,
          frameHash: hash.toString(16).padStart(8, "0"),
          sampledAtMs,
          offsetMs: sampledAtMs - referenceAtMs,
          referenceName
        };
      };
      globalThis.__P2_63A_TIMED_FRAME_SAMPLES__ = (async () => {
        const trigger = await waitForStage("state_sleep_trigger", 10000);
        const motion = [];
        for (const offsetMs of sampleOffsetsMs) {
          await sleepFor(trigger.atMs + offsetMs - performance.now());
          motion.push(capture("sleep-" + offsetMs + "ms", offsetMs, trigger.atMs, "state_sleep_trigger"));
        }
        const stop = await waitForStage("watchdog_stop", 1500);
        await sleepFor(stop.atMs + 300 - performance.now());
        const restored = capture("stop-plus-300ms", 300, stop.atMs, "watchdog_stop");
        restored.afterStopMs = restored.offsetMs;
        return { motion, restored };
      })();
      return true;
    })()
  `);
}

async function captureTimedScreenshots(pet, context, runId, sampleOffsetsMs) {
  const trigger = await evaluate(pet, `
    (async () => {
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        const event = (globalThis.__P2_63A_YAWN_PROBE__ ?? [])
          .find((item) => item.runId === ${JSON.stringify(runId)} && item.stage === "state_sleep_trigger");
        if (event) return event;
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 10));
      }
      throw new Error("timed-screenshot-trigger-timeout");
    })()
  `);
  const paths = [];
  for (const offsetMs of sampleOffsetsMs) {
    await evaluate(pet, `new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ${trigger.atMs + offsetMs} - performance.now())))`);
    const screenshot = await pet.cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const path = join(context.runDir, `p2-63b-yawn-${offsetMs}ms.png`);
    writeFileSync(path, Buffer.from(screenshot.data, "base64"));
    paths.push(path);
  }
  return paths;
}

async function readTimedFrameSamples(pet) {
  return evaluate(pet, "globalThis.__P2_63A_TIMED_FRAME_SAMPLES__");
}

async function readProbeEvents(pet) {
  return evaluate(pet, "globalThis.__P2_63A_YAWN_PROBE__ ?? []");
}

async function waitForProbeStage(pet, stage, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readProbeEvents(pet);
    if (events.some((event) => event.stage === stage)) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

async function stopElectronAndVerify(context) {
  const child = context.child;
  const exitPromise = child && child.exitCode === null
    ? new Promise((resolveExit) => child.once("exit", () => resolveExit(true)))
    : Promise.resolve(true);
  await stopElectron(context);
  const exited = await Promise.race([exitPromise, sleep(4_000).then(() => false)]);
  const cdpClosed = await waitForCdpClosed(context.port, 4_000);
  return exited && cdpClosed;
}

async function waitForCdpClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
    } catch {
      return true;
    }
    await sleep(100);
  }
  return false;
}

async function runCleanupStep(cleanup, label, operation) {
  try {
    await operation();
  } catch (error) {
    cleanup.errors.push({ label, ...sanitizeError(error) });
  }
}

function readTelemetryEvents(context) {
  const logDirectory = join(context.appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return [];
  }
  const events = [];
  for (const name of readdirSync(logDirectory).filter((entry) => entry.startsWith("telemetry-") && entry.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(logDirectory, name), "utf8").split(/\r?\n/u)) {
      try {
        if (line.trim()) events.push(JSON.parse(line));
      } catch {
        // The running process may leave one partial final line.
      }
    }
  }
  return events.map((event, index) => ({ ...event, __index: index }));
}

async function waitForTelemetry(context, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readTelemetryEvents(context).find(predicate);
    if (event) return event;
    await sleep(120);
  }
  return null;
}

function patchFile(path, transform) {
  writeFileSync(path, transform(readFileSync(path, "utf8")), "utf8");
}

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`expected exactly one ${label} marker`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

function hashProtectedPaths() {
  return Object.fromEntries(PROTECTED_PATHS.map((path) => {
    const content = readFileSync(join(ROOT, path));
    return [path, createHash("sha256").update(content).digest("hex")];
  }));
}

function protectedHashesEqual(left, right) {
  return PROTECTED_PATHS.every((path) => left[path] === right[path]);
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name: error instanceof Error ? error.name : "Error",
    message: message.replaceAll(ROOT, "<workspace>").slice(0, 800)
  };
}

function readRuntimeDiagnostics(context) {
  return Object.fromEntries(["electron.stdout.log", "electron.stderr.log"].map((name) => {
    const path = join(context.runDir, name);
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    return [name, text.replaceAll(ROOT, "<workspace>").slice(-1_500)];
  }));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
