import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-63c-3d-autonomous-breath-runtime-real-ui";
const SAMPLE_MS = 200;
const MIN_DURATION_MS = 11_200;
const MIN_OBSERVED_DURATION_MS = 10_500;
const MIN_SAMPLES = 50;
const STARTUP_QUIET_MS = 1_000;
export const ALLOWED_CONSOLE_WARNING_TEXTS = Object.freeze([
  [
    "%cElectron Security Warning (Insecure Content-Security-Policy)",
    "font-weight: bold;",
    `This renderer process has either no Content Security
  Policy set or a policy with "unsafe-eval" enabled. This exposes users of
  this app to unnecessary security risks.

For more information and help, consult
https://electronjs.org/docs/tutorial/security.
This warning will not show up
once the app is packaged.`
  ].join(" ")
]);
export const REGISTERED_YAWN_MOTION_RELATIVE_PATH = "resources/models/witch/motions/yawn-once.motion3.json";
export const WITCH_MODEL3_URL = "pet-model://witch/%E9%AD%94%E5%A5%B3.model3.json";

export function analyzeBreathSamples(samples) {
  const finite = samples.filter((sample) => [sample?.timestampMs, sample?.value, sample?.minimum, sample?.maximum]
    .every(Number.isFinite));
  const range = finite.length ? finite[0].maximum - finite[0].minimum : Number.NaN;
  const values = finite.map((sample) => sample.value);
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const observedAmplitude = maximumValue - minimumValue;
  const center = finite.length ? (finite[0].minimum + finite[0].maximum) / 2 : Number.NaN;
  const upwardCrossings = [];

  for (let index = 1; index < finite.length; index += 1) {
    const previous = finite[index - 1];
    const current = finite[index];
    if (previous.value < center && current.value >= center && current.value > previous.value) {
      const ratio = (center - previous.value) / (current.value - previous.value);
      upwardCrossings.push(previous.timestampMs + (current.timestampMs - previous.timestampMs) * ratio);
    }
  }

  const periodsMs = upwardCrossings.slice(1).map((crossing, index) => crossing - upwardCrossings[index]);
  const periodMs = periodsMs.length ? periodsMs.reduce((sum, period) => sum + period, 0) / periodsMs.length : null;
  const sampleIntervalsMs = finite.slice(1).map((sample, index) => sample.timestampMs - finite[index].timestampMs);
  const observedDurationMs = finite.length >= 2 ? finite[finite.length - 1].timestampMs - finite[0].timestampMs : 0;
  const sampleIntervalStats = {
    count: sampleIntervalsMs.length,
    minMs: sampleIntervalsMs.length ? Math.min(...sampleIntervalsMs) : null,
    maxMs: sampleIntervalsMs.length ? Math.max(...sampleIntervalsMs) : null,
    averageMs: sampleIntervalsMs.length
      ? sampleIntervalsMs.reduce((sum, interval) => sum + interval, 0) / sampleIntervalsMs.length
      : null
  };
  const upwardSteps = finite.filter((sample, index) => index > 0 && sample.value > finite[index - 1].value).length;
  const downwardSteps = finite.filter((sample, index) => index > 0 && sample.value < finite[index - 1].value).length;
  const vertexHashCount = new Set(finite.map((sample) => sample.vertexHash).filter(Boolean)).size;
  const canvasHashCount = new Set(finite.map((sample) => sample.canvasHash).filter(Boolean)).size;

  return {
    sampleCount: samples.length,
    finiteSampleCount: finite.length,
    range,
    minimumValue,
    maximumValue,
    observedAmplitude,
    expectedAmplitude: range * 0.16,
    upwardSteps,
    downwardSteps,
    upwardCrossings: upwardCrossings.length,
    cycleCount: upwardCrossings.length,
    periodMs,
    observedDurationMs,
    sampleIntervalStats,
    crossingTimestampsMs: upwardCrossings,
    periodIntervalsMs: periodsMs,
    vertexHashCount,
    canvasHashCount,
    finite: finite.length === samples.length && finite.length >= MIN_SAMPLES,
    observedLongEnough: observedDurationMs >= MIN_OBSERVED_DURATION_MS,
    inRange: finite.length > 0 && finite.every((sample) => sample.value >= sample.minimum && sample.value <= sample.maximum),
    movesBothWays: upwardSteps > 0 && downwardSteps > 0,
    periodic: periodsMs.length >= 2 &&
      periodsMs.every((period) => Math.abs(period - 3_500) <= 350) &&
      periodMs !== null && Math.abs(periodMs - 3_500) <= 350,
    enoughCycles: upwardCrossings.length >= 3,
    amplitudeReasonable: Number.isFinite(range) && range > 0 && observedAmplitude >= range * 0.08 && observedAmplitude <= range * 0.24,
    vertexChanged: vertexHashCount >= 2,
    canvasChanged: canvasHashCount >= 2
  };
}

export function selectActionTelemetryEvents(events, startIndex = 0) {
  return events.slice(startIndex).filter((event) => event?.type?.startsWith("pet_interaction_action_"));
}

export function analyzePerformanceTelemetry(events) {
  const samples = events.filter((event) => event?.type === "pet_performance_sample");
  const positiveBreathRates = samples
    .map((event) => event.payload?.breathUpdatesPerSecond)
    .filter((value) => Number.isFinite(value) && value > 0);
  const cumulativeBreathUpdates = samples.reduce((sum, event) => (
    Number.isFinite(event.payload?.breathUpdates) ? sum + event.payload.breathUpdates : sum
  ), 0);
  return {
    performanceSampleCount: samples.length,
    positiveBreathRateSampleCount: positiveBreathRates.length,
    cumulativeBreathUpdates,
    breathUpdatesPerSecondMin: positiveBreathRates.length ? Math.min(...positiveBreathRates) : null,
    breathUpdatesPerSecondMax: positiveBreathRates.length ? Math.max(...positiveBreathRates) : null
  };
}

export function auditRegisteredYawnMotion({ exists, motion, sha256 }) {
  const curves = Array.isArray(motion?.Curves) ? motion.Curves : [];
  const controlledParameterIds = curves
    .filter((curve) => curve?.Target === "Parameter" && typeof curve.Id === "string" && curve.Id.length > 0)
    .map((curve) => curve.Id)
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort();
  const containsParamBreath = controlledParameterIds.includes("ParamBreath");
  const parseable = Boolean(motion && Array.isArray(motion.Curves) && curves.every((curve) => curve && typeof curve === "object"));
  return {
    path: REGISTERED_YAWN_MOTION_RELATIVE_PATH,
    exists: exists === true,
    parseable,
    sha256: typeof sha256 === "string" ? sha256.toLowerCase() : null,
    controlledParameterIds,
    containsParamBreath,
    ok: exists === true && parseable && controlledParameterIds.length > 0 && !containsParamBreath && typeof sha256 === "string"
  };
}

export function summarizeRuntimeHealth({
  telemetryEvents = [],
  model3Probe = {},
  runtimeExceptions = [],
  consoleMessages = [],
  allowedConsoleWarningTexts = ALLOWED_CONSOLE_WARNING_TEXTS,
  webglLostCount = 0,
  webglRestoredCount = 0,
  webglFinallyLost = false,
  rendererProcessGoneCount = 0,
  childProcessGoneCount = 0,
  observerErrors = []
}) {
  const safeRuntimeExceptions = Array.isArray(runtimeExceptions) ? runtimeExceptions : ["runtime-exceptions-not-array"];
  const safeObserverErrors = Array.isArray(observerErrors) ? observerErrors : ["observer-errors-not-array"];
  const consoleWarningErrors = Array.isArray(consoleMessages)
    ? consoleMessages.filter((message) => message?.type === "warning" || message?.type === "error")
    : [{ type: "error", text: "console-messages-not-array" }];
  const allowedConsoleMessages = consoleWarningErrors.filter((message) => (
    message.type === "warning" && allowedConsoleWarningTexts.includes(message.text)
  ));
  const unexpectedConsoleMessages = consoleWarningErrors.filter((message) => !allowedConsoleMessages.includes(message));
  const firstFrameEvent = telemetryEvents.find((event) => event?.type === "first_frame");
  const renderEvent = telemetryEvents.find((event) => (
    event?.type === "pet_health" &&
    event.payload?.renderer === "live2d" &&
    Number.isFinite(event.payload?.nonTransparentPixels) &&
    event.payload.nonTransparentPixels > 0
  ));
  const model3Url = readUrl(model3Probe.responseUrl);
  const checks = {
    realWitchModel3: model3Probe.requestedUrl === WITCH_MODEL3_URL &&
      model3Probe.responseUrl === WITCH_MODEL3_URL &&
      model3Url?.hostname === "witch" &&
      decodeURIComponent(model3Url.pathname) === "/魔女.model3.json" &&
      model3Probe.hasVersion === true &&
      typeof model3Probe.moc === "string" && model3Probe.moc.length > 0,
    firstFramePresent: Boolean(firstFrameEvent),
    nonblankLive2DHealth: Boolean(renderEvent),
    noRuntimeExceptions: safeRuntimeExceptions.length === 0,
    consoleWarningErrorsClean: unexpectedConsoleMessages.length === 0,
    webglBalancedAndRestored: webglLostCount === webglRestoredCount && webglFinallyLost === false,
    noRendererProcessGone: rendererProcessGoneCount === 0,
    noChildProcessGone: childProcessGoneCount === 0,
    observerErrors: safeObserverErrors.length === 0
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    model3: {
      url: model3Probe.responseUrl ?? null,
      identity: model3Url ? `${model3Url.hostname}${decodeURIComponent(model3Url.pathname)}` : null,
      requestedUrl: model3Probe.requestedUrl ?? null,
      hasVersion: model3Probe.hasVersion === true,
      moc: typeof model3Probe.moc === "string" ? model3Probe.moc : null
    },
    renderEvidence: renderEvent ? { eventType: renderEvent.type, ...renderEvent.payload } : null,
    cdp: {
      runtimeExceptions: safeRuntimeExceptions,
      runtimeExceptionCount: safeRuntimeExceptions.length
    },
    console: {
      warningErrorCount: consoleWarningErrors.length,
      allowedWarningTexts: [...allowedConsoleWarningTexts],
      allowedMessages: allowedConsoleMessages,
      allowedCount: allowedConsoleMessages.length,
      unexpectedMessages: unexpectedConsoleMessages,
      unexpectedCount: unexpectedConsoleMessages.length
    },
    webgl: {
      lostCount: webglLostCount,
      restoredCount: webglRestoredCount,
      balanced: webglLostCount === webglRestoredCount,
      finallyLost: webglFinallyLost
    },
    processes: { rendererProcessGoneCount, childProcessGoneCount },
    observerErrors: safeObserverErrors,
    observerErrorCount: safeObserverErrors.length
  };
}

function readUrl(value) {
  try {
    return typeof value === "string" ? new URL(value) : null;
  } catch {
    return null;
  }
}

export function validateBreathSummary({ samples, telemetryEvents = [], actionEvents = [], observer = {}, cleanup = {}, motionAudit = {}, runtimeHealth = {}, error = null }) {
  const analysis = analyzeBreathSamples(samples);
  const telemetry = analyzePerformanceTelemetry(telemetryEvents);
  const checks = {
    finite: analysis.finite,
    observedLongEnough: analysis.observedLongEnough,
    inRange: analysis.inRange,
    movesBothWays: analysis.movesBothWays,
    periodic: analysis.periodic,
    enoughCycles: analysis.enoughCycles,
    amplitudeReasonable: analysis.amplitudeReasonable,
    vertexChanged: analysis.vertexChanged,
    canvasChanged: analysis.canvasChanged,
    noActionDuringSample: actionEvents.length === 0,
    performanceSamplePresent: telemetry.performanceSampleCount > 0,
    positiveBreathRate: telemetry.positiveBreathRateSampleCount > 0,
    telemetryBreathUpdates: telemetry.cumulativeBreathUpdates > 0,
    registeredYawnExcludesParamBreath: motionAudit.ok === true &&
      motionAudit.path === REGISTERED_YAWN_MOTION_RELATIVE_PATH &&
      motionAudit.containsParamBreath === false,
    runtimeHealth: runtimeHealth.ok === true,
    observerErrors: Array.isArray(observer.errors) && observer.errors.length === 0,
    prototypeRestored: cleanup.prototypeRestored === true,
    electronStopped: cleanup.electronStopped === true,
    runDirRemoved: cleanup.runDirRemoved === true,
    tmpResidue: cleanup.tmpResidue === true,
    noError: error === null
  };
  return { ok: Object.values(checks).every(Boolean), checks, analysis, telemetry, motionAudit, runtimeHealth, telemetryBreathUpdates: telemetry.cumulativeBreathUpdates };
}

export function finalizeBreathRun(input) {
  return validateBreathSummary(input);
}

async function main() {
  const context = createRealUiRunContext({ runName: RUN_NAME, port: Number(process.env.P2_63C_3D_CDP_PORT || 9665) });
  const startedAt = Date.now();
  const cleanup = { prototypeRestored: false, electronStopped: false, runDirRemoved: false, tmpResidue: false, preserved: [] };
  let pet = null;
  let error = null;
  let telemetryStartIndex = 0;
  let electronPid = null;
  let observed = { samples: [], errors: ["not-sampled"] };
  let observedTelemetry = [];
  let observedActionEvents = [];
  let runtimeTelemetry = [];
  let model3Probe = { requestedUrl: WITCH_MODEL3_URL, responseUrl: null, hasVersion: false, moc: null };
  const cdpObserver = { exceptions: [], consoleMessages: [] };
  const removeCdpListeners = [];
  const motionAudit = readRegisteredYawnMotionAudit();
  const startupSynchronization = {
    appearanceFinished: false,
    edgeGlanceStarted: false,
    edgeGlanceFinished: false,
    quietMs: STARTUP_QUIET_MS,
    quietActionEvents: null
  };

  try {
    electronPid = startElectron(context).pid ?? null;
    await connectToElectron(context, 40_000);
    pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    removeCdpListeners.push(pet.cdp.on("Runtime.exceptionThrown", (params) => {
      const details = params?.exceptionDetails;
      cdpObserver.exceptions.push({
        text: String(details?.exception?.description ?? details?.text ?? "Runtime exception").slice(0, 500),
        lineNumber: Number.isFinite(details?.lineNumber) ? details.lineNumber : null,
        columnNumber: Number.isFinite(details?.columnNumber) ? details.columnNumber : null
      });
    }));
    removeCdpListeners.push(pet.cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params?.type !== "warning" && params?.type !== "error") return;
      const text = (Array.isArray(params.args) ? params.args : []).map((argument) => {
        if (argument?.value !== undefined) return String(argument.value);
        return String(argument?.description ?? argument?.type ?? "unknown");
      }).join(" ").slice(0, 500);
      cdpObserver.consoleMessages.push({ type: params.type, text });
    }));
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    model3Probe = await probeWitchModel3(pet);
    await requireTelemetry(context, (event) => event.type === "pet_interaction_action_finished" && event.payload?.type === "appearance", 15_000, "appearance-finished");
    startupSynchronization.appearanceFinished = true;
    const edgeTelemetryStartIndex = readTelemetryEvents(context).length;
    await requireTelemetry(context, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.type === "edgeGlance" &&
      event.payload?.reason === "pet_edge_settled"
    ), 10_000, "edge-glance-started", edgeTelemetryStartIndex);
    startupSynchronization.edgeGlanceStarted = true;
    await requireTelemetry(context, (event) => (
      event.type === "pet_interaction_action_finished" &&
      event.payload?.type === "edgeGlance" &&
      event.payload?.reason === "pet_edge_settled"
    ), 10_000, "edge-glance-finished", edgeTelemetryStartIndex);
    startupSynchronization.edgeGlanceFinished = true;
    const quietTelemetryStartIndex = readTelemetryEvents(context).length;
    await sleep(STARTUP_QUIET_MS);
    const quietActionEvents = selectActionTelemetryEvents(readTelemetryEvents(context), quietTelemetryStartIndex);
    startupSynchronization.quietActionEvents = quietActionEvents.length;
    if (quietActionEvents.length > 0) throw new Error("startup-action-quiet-window-violated");
    telemetryStartIndex = readTelemetryEvents(context).length;
    await installBreathObserver(pet, resolveBreathResourceUrl());
    await sleep(MIN_DURATION_MS + SAMPLE_MS);
    observed = await readBreathObserver(pet) ?? { samples: [], errors: ["observer-missing"] };
    observedTelemetry = readTelemetryEvents(context).slice(telemetryStartIndex);
    observedActionEvents = selectActionTelemetryEvents(observedTelemetry);
  } catch (caught) {
    error = sanitizeError(caught);
  } finally {
    runtimeTelemetry = readTelemetryEvents(context);
    if (pet) {
      try {
        cleanup.prototypeRestored = await restoreBreathObserver(pet);
      } catch (caught) {
        error ??= sanitizeError(caught);
      }
    }
    for (const removeListener of removeCdpListeners) removeListener();
    try {
      await stopElectron(context);
    } catch (caught) {
      error ??= sanitizeError(caught);
    }
    cleanup.electronStopped = await waitForElectronStopped(context.port, electronPid);
    try {
      Object.assign(cleanup, removeThisRun(context));
    } catch (caught) {
      error ??= sanitizeError(caught);
    }
  }

  const webglLostCount = runtimeTelemetry.filter((event) => event.type === "webgl_context_lost").length;
  const webglRestoredCount = runtimeTelemetry.filter((event) => event.type === "webgl_context_restored").length;
  let webglFinallyLost = false;
  for (const event of runtimeTelemetry) {
    if (event.type === "webgl_context_lost") webglFinallyLost = true;
    if (event.type === "webgl_context_restored") webglFinallyLost = false;
  }
  const rendererProcessGoneCount = runtimeTelemetry.filter((event) => event.type === "renderer_process_gone").length;
  const childProcessGoneCount = runtimeTelemetry.filter((event) => event.type === "child_process_gone").length;
  const runtimeHealth = summarizeRuntimeHealth({
    telemetryEvents: runtimeTelemetry,
    model3Probe,
    runtimeExceptions: cdpObserver.exceptions,
    consoleMessages: cdpObserver.consoleMessages,
    webglLostCount,
    webglRestoredCount,
    webglFinallyLost,
    rendererProcessGoneCount,
    childProcessGoneCount,
    observerErrors: observed.errors
  });

  const finalSummary = finalizeBreathRun({
    samples: observed.samples,
    telemetryEvents: observedTelemetry,
    actionEvents: observedActionEvents,
    observer: observed,
    cleanup,
    motionAudit,
    runtimeHealth,
    error
  });
  Object.assign(finalSummary, {
    durationMs: Date.now() - startedAt,
    sampleIntervalMs: SAMPLE_MS,
    startupSynchronization,
    actionWindow: { eventCount: observedActionEvents.length },
    cleanup,
    failure: error,
    productionApp: true,
    sourceInjection: false
  });
  console.log(JSON.stringify(finalSummary, null, 2));
  if (!finalSummary.ok) process.exitCode = 1;
}

async function probeWitchModel3(pet) {
  return evaluate(pet, `
    (async () => {
      const requestedUrl = ${JSON.stringify(WITCH_MODEL3_URL)};
      const response = await fetch(requestedUrl);
      if (!response.ok) throw new Error(\`witch-model3-http-\${response.status}\`);
      const model3 = await response.json();
      return {
        requestedUrl,
        responseUrl: response.url,
        hasVersion: Object.hasOwn(model3, "Version"),
        moc: model3?.FileReferences?.Moc ?? null
      };
    })()
  `);
}

function resolveBreathResourceUrl() {
  const assetsDir = join(ROOT, "dist", "renderer", "assets");
  if (!existsSync(assetsDir)) throw new Error("cubismbreath-assets-dir-not-found");
  const candidates = readdirSync(assetsDir).filter((name) => /^cubismbreath-[^/]+\.js$/u.test(name));
  if (candidates.length !== 1) throw new Error(`cubismbreath-build-asset-count:${candidates.length}`);
  return pathToFileURL(join(assetsDir, candidates[0])).href;
}

function readRegisteredYawnMotionAudit() {
  const path = join(ROOT, ...REGISTERED_YAWN_MOTION_RELATIVE_PATH.split("/"));
  if (!existsSync(path)) return auditRegisteredYawnMotion({ exists: false, motion: null, sha256: null });
  const source = readFileSync(path);
  const sha256 = createHash("sha256").update(source).digest("hex");
  try {
    return auditRegisteredYawnMotion({ exists: true, motion: JSON.parse(source.toString("utf8")), sha256 });
  } catch {
    return auditRegisteredYawnMotion({ exists: true, motion: null, sha256 });
  }
}

async function installBreathObserver(pet, resourceUrl) {
  return evaluate(pet, `
    (async () => {
      const key = "__P2_63C_3D_BREATH_OBSERVER__";
      const resourceUrl = ${JSON.stringify(resourceUrl)};
      const { CubismBreath } = await import(resourceUrl);
      const original = CubismBreath.prototype.updateParameters;
      if (typeof original !== "function") throw new Error("cubismbreath-updateParameters-not-found");
      const observer = { samples: [], errors: [], original, CubismBreath, lastAt: -Infinity };
      const hash = (values, scale = 10000) => {
        let value = 2166136261;
        for (const item of values) value = Math.imul(value ^ Math.round(item * scale), 16777619);
        return (value >>> 0).toString(16);
      };
      const capture = (model) => {
        const now = performance.now();
        if (now - observer.lastAt < ${SAMPLE_MS}) return;
        observer.lastAt = now;
        try {
          let parameterIndex = -1;
          for (let index = 0; index < model.getParameterCount(); index += 1) {
            const id = model.getParameterId(index);
            if (id?.isEqual?.("ParamBreath") || id?.getString?.() === "ParamBreath" || String(id) === "ParamBreath") { parameterIndex = index; break; }
          }
          if (parameterIndex < 0) throw new Error("ParamBreath-not-found");
          const vertices = [];
          for (let drawable = 0; drawable < Math.min(model.getDrawableCount(), 8); drawable += 1) {
            const positions = model.getDrawableVertices(drawable);
            for (let index = 0; index < Math.min(positions?.length ?? 0, 32); index += 1) vertices.push(positions[index]);
          }
          const sample = { timestampMs: now, value: model.getParameterValueByIndex(parameterIndex), minimum: model.getParameterMinimumValue(parameterIndex), maximum: model.getParameterMaximumValue(parameterIndex), vertexHash: hash(vertices) };
          queueMicrotask(() => {
            try {
              const canvas = document.querySelector("#pet-canvas");
              const gl = canvas?.getContext("webgl2");
              if (!canvas || !gl) throw new Error("pet-canvas-webgl2-not-found");
              const width = Math.min(canvas.width, 256);
              const height = Math.min(canvas.height, 256);
              const x = Math.floor((canvas.width - width) / 2);
              const y = Math.floor((canvas.height - height) / 2);
              const pixels = new Uint8Array(width * height * 4);
              gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              observer.samples.push({ ...sample, canvasHash: hash(pixels, 1) });
            } catch (caught) { observer.errors.push(String(caught?.message ?? caught)); }
          });
        } catch (caught) { observer.errors.push(String(caught?.message ?? caught)); }
      };
      CubismBreath.prototype.updateParameters = function(model, deltaSeconds) { const result = original.call(this, model, deltaSeconds); capture(model); return result; };
      globalThis[key] = observer;
      return { resourceUrl };
    })()
  `);
}

async function readBreathObserver(pet) {
  return evaluate(pet, `(() => { const value = globalThis.__P2_63C_3D_BREATH_OBSERVER__; return value ? { samples: value.samples, errors: value.errors } : null; })()`);
}

async function restoreBreathObserver(pet) {
  return evaluate(pet, `(() => { const key = "__P2_63C_3D_BREATH_OBSERVER__"; const value = globalThis[key]; if (!value?.CubismBreath || !value?.original) return false; value.CubismBreath.prototype.updateParameters = value.original; delete globalThis[key]; return true; })()`);
}

function readTelemetryEvents(context) {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir).filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl")).sort().flatMap((name) => readFileSync(join(logDir, name), "utf8").split(/\r?\n/u).flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } }));
}

async function requireTelemetry(context, predicate, timeoutMs, label, startIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readTelemetryEvents(context).slice(startIndex).find(predicate);
    if (match) return match;
    await sleep(150);
  }
  throw new Error(`telemetry-timeout:${label}`);
}

async function waitForElectronStopped(port, pid) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    const cdpClosed = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => false).catch(() => true);
    let stopped = true;
    if (pid) try { process.kill(pid, 0); stopped = false; } catch {}
    if (cdpClosed && stopped) return true;
    await sleep(200);
  }
  return false;
}

export function removeThisRun(context) {
  rmSync(context.appDataDir, { recursive: true, force: true });
  rmSync(context.runDir, { recursive: true, force: true });
  const preserved = existsSync(context.runParentDir) ? readdirSync(context.runParentDir).sort() : [];
  if (preserved.length === 0 && existsSync(context.runParentDir)) rmdirSync(context.runParentDir);
  return {
    runDirRemoved: !existsSync(context.runDir) && !existsSync(context.appDataDir),
    tmpResidue: !existsSync(context.runParentDir),
    preserved
  };
}

function sanitizeError(error) {
  return { name: error instanceof Error ? error.name : "Error", message: String(error instanceof Error ? error.message : error).slice(0, 500) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
