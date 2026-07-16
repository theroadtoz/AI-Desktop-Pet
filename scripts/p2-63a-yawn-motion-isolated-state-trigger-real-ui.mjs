import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import ts from "typescript";
import { canonicalizeMotion3, parseMotion3Segments } from "./support/motion3-canonicalizer.mts";
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
const DRAFT_RELATIVE_PATH = Object.freeze(["motion-drafts", "vts-drafts", "yawn-draft.motion3.json"]);
const MODEL_CANDIDATE_RELATIVE_PATH = Object.freeze(["model", "yawn-once.motion3.json"]);
const MODEL_DISPLAY_INFO_RELATIVE_PATH = Object.freeze(["model", "魔女.cdi3.json"]);
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
  "model/yawn-once.motion3.json",
  "src/shared/pet-motion-presets.ts",
  "src/shared/pet-motion-catalog.ts",
  "src/shared/interaction-action-catalog.ts",
  "src/renderer/pet/interaction-actions.ts",
  "src/renderer/pet/main.ts",
  "src/renderer/pet/live2d/cubism-motion.ts"
];
export const ABSENT_PROTECTED_PATH = "absent";

const MOTION_FIELDS = new Set(["Version", "Meta", "Curves", "UserData"]);
const META_FIELDS = new Set([
  "Duration", "Fps", "Loop", "AreBeziersRestricted", "CurveCount",
  "TotalSegmentCount", "TotalPointCount", "UserDataCount", "TotalUserDataSize",
  "FadeInTime", "FadeOutTime"
]);
const CURVE_FIELDS = new Set(["Target", "Id", "Segments", "FadeInTime", "FadeOutTime"]);
const MOTION_VARIATION_PARAMETER_IDS = new Set([
  "ParamAngleX", "ParamAngleY", "ParamAngleZ",
  "ParamEyeLOpen", "ParamEyeROpen",
  "ParamMouthOpenY", "ParamMouthForm"
]);
const MOTION_VARIATION_THRESHOLD = 0.0001;
export const P2_63B2_CAPTURE_INTERVAL_MS = 1_000 / 12;
export const P2_63B2_MAX_CAPTURE_FRAMES = 80;
export const P2_63B2_MAX_SCREENCAST_FRAMES = 600;
export const P2_63B2_MAX_SCREENCAST_BYTES = 64 * 1024 * 1024;
export const P2_63B2_MAX_SCREENCAST_WIDTH = 420;
export const P2_63B2_MAX_SCREENCAST_HEIGHT = 600;
export const P2_63B2_RUN_TIMEOUT_MS = 90_000;
export const P2_63B2_MIN_CHANGED_PIXEL_RATIO = 0.002;
export const P2_63B2_MIN_CHANGED_PAIR_COVERAGE = 0.5;
export const P2_63B2_MAX_STATIC_RUN_FRAMES = 6;
const P2_63B2_RESTORE_TAIL_MS = 300;
const P2_63B2_MODEL_CANDIDATE_SHA256 = "eca4ad06bb4665c3d4ae2a619a1d6528360044935508d08b06310ea3125b52b4";
const P2_63B2_MIN_PARAMETER_SAMPLES = 30;
const P2_63B2_MAX_CHECKPOINT_DISTANCE_MS = 120;
const P2_63B2_MIN_EFFECTIVE_FPS = 10;
const P2_63B2_MAX_EFFECTIVE_FPS = 15;
const P2_63B2_MAX_P95_INTERVAL_MS = 150;
const P2_63B2_MAX_ABSOLUTE_GAP_MS = 200;
const PNG_CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});

export function parseRunnerArgs(argv) {
  if (argv.length === 0) return { mode: "default" };
  const timeoutControl = argv.includes("--timeout-control");
  const remaining = argv.filter((argument) => argument !== "--timeout-control");
  if (argv.filter((argument) => argument === "--timeout-control").length > 1) {
    throw new Error("invalid-cli-arguments");
  }
  if (remaining.length === 1 && remaining[0] === "--source-model-candidate") {
    return { mode: "model-candidate", timeoutControl };
  }
  if (remaining.length !== 2 || remaining[0] !== "--source-user-data" || typeof remaining[1] !== "string" || remaining[1].length === 0) {
    throw new Error("invalid-cli-arguments");
  }
  if (!isAbsolute(remaining[1])) throw new Error("source-user-data-must-be-absolute");
  return { mode: "explicit-draft", sourceUserDataRoot: remaining[1], timeoutControl };
}

export function sourceModeForRunnerArgs(args) {
  if (args.mode === "explicit-draft") return "user-data-draft";
  if (args.mode === "model-candidate") return "model-candidate";
  return "default-source";
}

export async function setPetPointerInputIsolation(page, enabled) {
  await evaluate(page, `
    (() => {
      const key = "__P2_63B2_POINTER_INPUT_BLOCKER__";
      const eventTypes = ["pointermove", "pointerdown", "pointerup", "pointercancel", "dblclick"];
      const existing = window[key];
      if (${JSON.stringify(enabled)}) {
        if (existing) return;
        const block = (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        const options = { capture: true };
        for (const type of eventTypes) window.addEventListener(type, block, options);
        window[key] = { block, options };
        return;
      }
      if (!existing) return;
      for (const type of eventTypes) window.removeEventListener(type, existing.block, existing.options);
      delete window[key];
    })()
  `);
}

export function diagnoseStateSleepFailure(events, telemetryStartIndex) {
  const relevantEvents = events.filter((event) => event.__index > telemetryStartIndex);
  const skippedIndex = relevantEvents.findIndex((event) => (
    event.type === "pet_interaction_action_skipped" &&
    event.payload?.reason === "state_sleep" &&
    event.payload?.skipReason === "active_action" &&
    typeof event.payload?.activeType === "string"
  ));
  if (skippedIndex < 0) return "telemetry-event-timeout:state_sleep";
  const skipped = relevantEvents[skippedIndex];
  const pointerAction = relevantEvents.slice(0, skippedIndex).find((event) => (
    event.type === "pet_interaction_action_started" &&
    /^click_(?:head|body)$/u.test(event.payload?.reason ?? "") &&
    event.payload?.type === skipped.payload.activeType
  ));
  return pointerAction
    ? `pointer-interference:state_sleep:${skipped.payload.activeType}`
    : "telemetry-event-timeout:state_sleep";
}

export function validateExplicitDraftMotion(candidate, modelParameterIds, constraints = {}) {
  const blockers = new Set();
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
  const optionalNonNegative = (value) => value === undefined || finite(value) && value >= 0;
  const hasOnly = (value, fields) => Object.keys(value).every((key) => fields.has(key));
  const modelIds = Array.isArray(modelParameterIds) ? new Set(modelParameterIds) : null;
  const semanticAllowlist = Array.isArray(constraints.semanticAllowlist)
    ? constraints.semanticAllowlist
    : YAWN_SEMANTIC_ALLOWLIST;
  const variationParameterIds = Array.isArray(constraints.variationParameterIds)
    ? new Set(constraints.variationParameterIds)
    : MOTION_VARIATION_PARAMETER_IDS;
  const allowlist = new Set(semanticAllowlist);

  if (!isRecord(candidate)) {
    return { status: "blocked", blockers: ["invalid-candidate"] };
  }
  if (candidate.Version !== 3) blockers.add("invalid-version");
  if (!hasOnly(candidate, MOTION_FIELDS)) blockers.add("unsupported-motion-field");

  const meta = isRecord(candidate.Meta) ? candidate.Meta : null;
  const curves = Array.isArray(candidate.Curves) ? candidate.Curves : null;
  if (!meta) {
    blockers.add("invalid-meta");
  } else {
    if (!hasOnly(meta, META_FIELDS)) blockers.add("unsupported-meta-field");
    if (!finite(meta.Duration) || meta.Duration <= 0) blockers.add("invalid-duration");
    if (!finite(meta.Fps) || meta.Fps <= 0) blockers.add("invalid-fps");
    if (constraints.durationSeconds !== undefined && meta.Duration !== constraints.durationSeconds) {
      blockers.add("unexpected-duration");
    }
    if (constraints.fps !== undefined && meta.Fps !== constraints.fps) blockers.add("unexpected-fps");
    if (meta.Loop !== false) blockers.add("invalid-loop");
    if (
      typeof meta.AreBeziersRestricted !== "boolean" ||
      !nonNegativeInteger(meta.CurveCount) ||
      !nonNegativeInteger(meta.TotalSegmentCount) ||
      !nonNegativeInteger(meta.TotalPointCount) ||
      meta.UserDataCount !== 0 ||
      meta.TotalUserDataSize !== 0 ||
      !optionalNonNegative(meta.FadeInTime) ||
      !optionalNonNegative(meta.FadeOutTime)
    ) blockers.add("invalid-meta");
  }
  if (!curves || curves.length === 0) blockers.add("invalid-curves");
  if (candidate.UserData !== undefined && (!Array.isArray(candidate.UserData) || candidate.UserData.length !== 0)) {
    blockers.add("non-empty-user-data");
  }
  if (!modelIds || [...modelIds].some((id) => typeof id !== "string" || id.length === 0)) {
    blockers.add("invalid-model-parameter-ids");
  }

  let segmentCount = 0;
  let pointCount = 0;
  const parameterIds = new Set();
  const variedParameterIds = new Set();
  if (curves) {
    for (const curve of curves) {
      if (!isRecord(curve)) {
        blockers.add("invalid-curve");
        continue;
      }
      if (!hasOnly(curve, CURVE_FIELDS)) blockers.add("unsupported-curve-field");
      if (curve.Target !== "Parameter") blockers.add("unsupported-curve-target");
      if (typeof curve.Id !== "string" || curve.Id.length === 0) {
        blockers.add("invalid-parameter-id");
      } else {
        if (parameterIds.has(curve.Id)) blockers.add("duplicate-parameter-id");
        parameterIds.add(curve.Id);
        if (!allowlist.has(curve.Id)) blockers.add("parameter-not-allowlisted");
        if (modelIds && !modelIds.has(curve.Id)) blockers.add("unknown-parameter-id");
      }
      if (!optionalNonNegative(curve.FadeInTime) || !optionalNonNegative(curve.FadeOutTime)) blockers.add("invalid-curve");
      const parsed = parseMotion3Segments(curve.Segments, meta?.Duration);
      segmentCount += parsed.segmentCount;
      pointCount += parsed.pointCount;
      if (!parsed.validEncoding) blockers.add("invalid-segments");
      if (!parsed.validTime) blockers.add("invalid-segment-time");
      if (
        parsed.validEncoding && parsed.validTime &&
        typeof curve.Id === "string" && variationParameterIds.has(curve.Id)
      ) {
        const values = extractValidatedMotion3PointValues(curve.Segments);
        if (values.length > 1 && Math.max(...values) - Math.min(...values) > MOTION_VARIATION_THRESHOLD) {
          variedParameterIds.add(curve.Id);
        }
      }
    }
  }
  for (const id of allowlist) {
    if (!parameterIds.has(id)) blockers.add("allowlist-id-not-present");
  }
  const consistencyCheck = Boolean(
    meta && curves && meta.CurveCount === curves.length &&
    meta.TotalSegmentCount === segmentCount && meta.TotalPointCount === pointCount
  );
  if (!consistencyCheck) blockers.add("meta-count-mismatch");
  if (meta && constraints.curveCount !== undefined && meta.CurveCount !== constraints.curveCount) {
    blockers.add("unexpected-curve-count");
  }
  if (meta && constraints.segmentCount !== undefined && meta.TotalSegmentCount !== constraints.segmentCount) {
    blockers.add("unexpected-segment-count");
  }
  if (meta && constraints.pointCount !== undefined && meta.TotalPointCount !== constraints.pointCount) {
    blockers.add("unexpected-point-count");
  }
  if (blockers.size > 0) return { status: "blocked", blockers: [...blockers].sort() };
  return {
    status: "validated",
    motion: candidate,
    structure: {
      version: 3,
      durationSeconds: meta.Duration,
      fps: meta.Fps,
      loop: false,
      curveCount: curves.length,
      segmentCount,
      pointCount,
      consistencyCheck: true,
      semanticMotionVariation: variedParameterIds.size > 0,
      variedParameterCount: variedParameterIds.size,
      variedParameterIds: [...variedParameterIds].sort()
    }
  };
}

function extractValidatedMotion3PointValues(segments) {
  const pointCountsBySegmentType = [1, 3, 1, 1];
  const values = [segments[1]];
  let cursor = 2;
  while (cursor < segments.length) {
    const pointCount = pointCountsBySegmentType[segments[cursor]];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      values.push(segments[cursor + 2 + pointIndex * 2]);
    }
    cursor += 1 + pointCount * 2;
  }
  return values;
}

export function readExplicitDraftFromUserData(sourceUserDataRoot) {
  if (!isAbsolute(sourceUserDataRoot)) throw new Error("source-user-data-must-be-absolute");
  const root = resolve(sourceUserDataRoot);
  const candidatePath = join(root, ...DRAFT_RELATIVE_PATH);
  const relativeCandidate = relative(root, candidatePath);
  if (relativeCandidate.startsWith(`..${sep}`) || relativeCandidate === ".." || isAbsolute(relativeCandidate)) {
    throw new Error("draft-path-escape");
  }
  let current = root;
  for (const component of DRAFT_RELATIVE_PATH) {
    assertRegularNonReparsePath(current, "directory");
    current = join(current, component);
  }
  assertRegularNonReparsePath(current, "file");
  let realRoot;
  let realCandidate;
  try {
    realRoot = realpathSync.native(root);
    realCandidate = realpathSync.native(candidatePath);
  } catch {
    throw new Error("draft-path-resolution-failed");
  }
  const realRelative = relative(realRoot, realCandidate);
  if (realRelative.startsWith(`..${sep}`) || realRelative === ".." || isAbsolute(realRelative)) {
    throw new Error("draft-path-escape");
  }
  let sourceBytes;
  try {
    sourceBytes = readFileSync(candidatePath);
  } catch {
    throw new Error("draft-file-read-failed");
  }
  let candidate;
  try {
    candidate = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("draft-invalid-json");
  }
  const displayInfo = JSON.parse(readFileSync(join(ROOT, "model", "魔女.cdi3.json"), "utf8"));
  const validation = validateExplicitDraftMotion(candidate, displayInfo.Parameters.map(({ Id }) => Id));
  if (validation.status !== "validated") throw new Error(validation.blockers[0] ?? "draft-validation-blocked");
  return {
    sourceUserDataRoot: root,
    sourcePath: candidatePath,
    sourceBytes,
    motion: validation.motion,
    summary: {
      safeSummaryOnly: true,
      basename: basename(candidatePath),
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      byteLength: sourceBytes.byteLength,
      structure: validation.structure
    }
  };
}

export function readModelCandidateFromRoot(sourceRoot) {
  const root = resolve(sourceRoot);
  const candidatePath = join(root, ...MODEL_CANDIDATE_RELATIVE_PATH);
  const displayInfoPath = join(root, ...MODEL_DISPLAY_INFO_RELATIVE_PATH);
  for (const path of [root, join(root, "model")]) {
    assertRegularNonReparsePath(path, "directory", "model-candidate");
  }
  for (const path of [candidatePath, displayInfoPath]) {
    assertRegularNonReparsePath(path, "file", "model-candidate");
    assertRealPathWithinRoot(root, path, "model-candidate");
  }

  let sourceBytes;
  let candidate;
  let displayInfo;
  try {
    sourceBytes = readFileSync(candidatePath);
  } catch {
    throw new Error("model-candidate-file-read-failed");
  }
  try {
    candidate = JSON.parse(sourceBytes.toString("utf8"));
    displayInfo = JSON.parse(readFileSync(displayInfoPath, "utf8"));
  } catch {
    throw new Error("model-candidate-invalid-json");
  }
  const validation = validateExplicitDraftMotion(candidate, displayInfo.Parameters.map(({ Id }) => Id));
  if (validation.status !== "validated") throw new Error(validation.blockers[0] ?? "model-candidate-validation-blocked");
  const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sha256 !== P2_63B2_MODEL_CANDIDATE_SHA256) throw new Error("model-candidate-sha256-mismatch");
  return {
    sourcePath: candidatePath,
    sourceBytes,
    motion: validation.motion,
    summary: {
      origin: "model-candidate",
      basename: basename(candidatePath),
      sha256
    }
  };
}

function assertRegularNonReparsePath(path, expectedType, errorPrefix = "draft") {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(expectedType === "file" ? `${errorPrefix}-file-missing` : `${errorPrefix}-parent-missing`);
  }
  if (stats.isSymbolicLink()) throw new Error(`${errorPrefix}-reparse-path-rejected`);
  if (expectedType === "file" ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(expectedType === "file" ? `${errorPrefix}-not-regular-file` : `${errorPrefix}-parent-not-directory`);
  }
}

function assertRealPathWithinRoot(root, path, errorPrefix) {
  let realRoot;
  let realPath;
  try {
    realRoot = realpathSync.native(root);
    realPath = realpathSync.native(path);
  } catch {
    throw new Error(`${errorPrefix}-path-resolution-failed`);
  }
  const realRelative = relative(realRoot, realPath);
  if (realRelative.startsWith(`..${sep}`) || realRelative === ".." || isAbsolute(realRelative)) {
    throw new Error(`${errorPrefix}-path-escape`);
  }
}

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

export function injectIsolatedMotionPreset(source, timing, timeoutControl = false) {
  const marker = "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = APPROVED_MOTION_PRESETS;";
  const replacement = `const isolatedYawnPresetCount = APPROVED_MOTION_PRESETS.filter((preset) => preset.id === "${YAWN_PRESET_ID}").length;
if (isolatedYawnPresetCount !== 1) throw new Error("expected exactly one approved yawn preset");

export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze(
  APPROVED_MOTION_PRESETS.map((preset) => (
    preset.id === "${YAWN_PRESET_ID}"
      ? {
          ...preset,
          id: "${YAWN_PRESET_ID}",
          path: "motions/yawn-once.motion3.json",
          semanticKind: "sleep",
          durationHintSeconds: ${timing.durationSeconds},
          loop: ${timeoutControl}
        }
      : preset
  ))
);`;
  return replaceExactlyOnce(source, marker, replacement, "pet motion preset export");
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
    const target = globalThis as typeof globalThis & { __P2_63B2_YAWN_PROBE__?: Array<Record<string, unknown>> };
    const events = target.__P2_63B2_YAWN_PROBE__ ?? [];
    events.push({ stage: "state_sleep_trigger", atMs: Math.round(performance.now()), runId: ${JSON.stringify(runId)} });
    target.__P2_63B2_YAWN_PROBE__ = events;
  }
  interactionActionPlayer.playAction(
    isolatedAction,
    trigger.reason,`;

  return replaceExactlyOnce(source, actionMarker, actionReplacement, "isolated state_sleep action path");
}

function probeReporterSource(runId) {
  return `function reportP263B2Probe(stage: string, detail: Record<string, unknown> = {}): void {
  const target = globalThis as typeof globalThis & { __P2_63B2_YAWN_PROBE__?: Array<Record<string, unknown>> };
  const events = target.__P2_63B2_YAWN_PROBE__ ?? [];
  events.push({ stage, atMs: Math.round(performance.now()), runId: ${JSON.stringify(runId)}, ...detail });
  target.__P2_63B2_YAWN_PROBE__ = events;
}`;
}

export function injectNativeLifecycleProbe(source, runId = "p2-63b2-test-run") {
  let output = replaceExactlyOnce(
    source,
    "export async function createCubismMotionController(",
    `${probeReporterSource(runId)}\n\nexport async function createCubismMotionController(`,
    "native lifecycle reporter"
  );
  output = replaceExactlyOnce(
    output,
    `      const buffer = await fetchMotionBuffer(resolveModelAssetUrl(preset.path));
      const controlledParameterIds = parseControlledParameterIds(buffer);`,
    `      reportP263B2Probe("load_attempt", { motionPresetId, loop: preset.loop });
      const buffer = await fetchMotionBuffer(resolveModelAssetUrl(preset.path));
      reportP263B2Probe("load_succeeded", { motionPresetId, byteLength: buffer.byteLength });
      reportP263B2Probe("parse_attempt", { motionPresetId });
      let controlledParameterIds: ReadonlySet<string>;
      try {
        controlledParameterIds = parseControlledParameterIds(buffer);
      } catch (error) {
        reportP263B2Probe("parser_blocked", { motionPresetId, errorName: error instanceof Error ? error.name : "unknown" });
        throw error;
      }
      reportP263B2Probe("parse_succeeded", { motionPresetId, controlledParameterCount: controlledParameterIds.size });`,
    "controlled parameter parse observation"
  );
  output = replaceExactlyOnce(
    output,
    "      const handle = manager.startMotionPriority(loadedMotion.motion, false, preset.priority);",
    `      reportP263B2Probe("start_attempt", { motionPresetId, priority: preset.priority });
      const handle = manager.startMotionPriority(loadedMotion.motion, false, preset.priority);`,
    "native start attempt observation"
  );
  output = replaceExactlyOnce(
    output,
    `      const record = createPlaybackRecord(handle, motionPresetId, loadedMotion.controlledParameterIds);
      activeMotions.set(handle, record);`,
    `      const record = createPlaybackRecord(handle, motionPresetId, loadedMotion.controlledParameterIds);
      activeMotions.set(handle, record);
      reportP263B2Probe("queued", { motionPresetId });
      record.playback.onStateChange((state) => {
        if (state === "started") reportP263B2Probe("native_started", { motionPresetId });
      });
      record.playback.onTerminal((result) => {
        reportP263B2Probe("terminal_status", { motionPresetId, status: result.status });
      });`,
    "queued and terminal observation"
  );
  output = replaceExactlyOnce(
    output,
    `        if (!manager.isFinishedByHandle(handle)) {
          continue;
        }

        if (activeMotion.playback.state === "started") {`,
    `        if (!manager.isFinishedByHandle(handle)) {
          continue;
        }

        reportP263B2Probe("handle_finished_after_update", {
          motionPresetId: activeMotion.motionPresetId,
          lifecycleState: activeMotion.playback.state
        });
        if (activeMotion.playback.state === "started") {`,
    "finished handle observation"
  );
  output = replaceExactlyOnce(
    output,
    `type PlaybackRecord = {
  handle: MotionHandle;`,
    `type PlaybackRecord = {
  handle: MotionHandle;
  motionPresetId: PetMotionPresetId;`,
    "playback record preset identity type"
  );
  output = replaceExactlyOnce(
    output,
    `    handle,
    controlledParameterIds,`,
    `    handle,
    motionPresetId,
    controlledParameterIds,`,
    "playback record preset identity"
  );
  output = replaceExactlyOnce(
    output,
    `    stop(reason): void {
      ++requestGeneration;
      stopActiveMotions(reason);
      activeMotions.clear();
      manager.stopAllMotions();
    },`,
    `    stop(reason): void {
      ++requestGeneration;
      const stoppingMotionPresetIds = [...activeMotions.values()]
        .map((activeMotion) => activeMotion.motionPresetId);
      stopActiveMotions(reason);
      activeMotions.clear();
      for (const motionPresetId of stoppingMotionPresetIds) {
        reportP263B2Probe("stop_all_motions", { motionPresetId });
      }
      manager.stopAllMotions();
    },`,
    "actual stop-all observation"
  );
  return output;
}

function findPlayerWatchdog(sourceFile, variableName, delayExpression, ownerName) {
  const declarations = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (declarations.length !== 1) {
    throw new Error(`expected exactly one ${variableName} declaration`);
  }
  const declaration = declarations[0];
  const call = declaration.initializer;
  if (
    !call ||
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "scheduleTimeout" ||
    call.arguments.length !== 2
  ) {
    throw new Error(`${variableName} must be a scheduleTimeout call`);
  }
  const callback = call.arguments[0];
  const delay = call.arguments[1];
  if (
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body) ||
    delay.getText(sourceFile) !== delayExpression
  ) {
    throw new Error(`${variableName} has an invalid callback or delay`);
  }

  let owner = declaration.parent;
  while (owner && !ts.isFunctionDeclaration(owner)) {
    owner = owner.parent;
  }
  if (!owner?.name || owner.name.text !== ownerName) {
    throw new Error(`${variableName} must belong to ${ownerName}`);
  }

  const callbackText = callback.body.getText(sourceFile);
  if (
    !callbackText.includes("activeInteractionAction !== activeAction") ||
    !callbackText.includes(`activeAction.timeoutId !== ${variableName}`)
  ) {
    throw new Error(`${variableName} must retain active action and timer identity guards`);
  }

  const directStops = callback.body.statements.filter((statement) => (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    statement.expression.expression.text === "stopMotion" &&
    statement.expression.arguments.length === 1 &&
    ts.isStringLiteral(statement.expression.arguments[0]) &&
    statement.expression.arguments[0].text === "timed_out"
  ));
  if (directStops.length !== 1) {
    throw new Error(`${variableName} must directly cancel loading, queued, or started motion`);
  }
  const declarationStatement = declaration.parent.parent;
  if (!ts.isVariableStatement(declarationStatement)) {
    throw new Error(`${variableName} must be declared as a watchdog statement`);
  }

  return {
    declarationStatement,
    stopStatement: directStops[0]
  };
}

function getPlayerWatchdogStructure(source) {
  const sourceFile = ts.createSourceFile(
    "interaction-action-player.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error("interaction action player source must parse before watchdog inspection");
  }
  const playbackPhases = new Set();
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile) === "playbackPhase" &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === "loading"
    ) {
      playbackPhases.add("loading");
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(sourceFile) === "activeAction.playbackPhase" &&
      ts.isStringLiteral(node.right) &&
      ["queued", "started"].includes(node.right.text)
    ) {
      playbackPhases.add(node.right.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const phase of ["loading", "queued", "started"]) {
    if (!playbackPhases.has(phase)) {
      throw new Error(`missing native motion ${phase} phase`);
    }
  }

  return {
    sourceFile,
    start: findPlayerWatchdog(
      sourceFile,
      "startWatchdogId",
      "NATIVE_MOTION_START_WATCHDOG_MS",
      "playAction"
    ),
    runtime: findPlayerWatchdog(
      sourceFile,
      "runtimeWatchdogId",
      "watchdogBudgetMs",
      "waitForNativeMotion"
    )
  };
}

export function inspectPlayerWatchdogStructure(source) {
  getPlayerWatchdogStructure(source);
  return {
    playbackPhases: ["loading", "queued", "started"],
    startWatchdog: {
      owner: "playAction",
      delay: "NATIVE_MOTION_START_WATCHDOG_MS",
      directlyCancelsPendingStart: true
    },
    runtimeWatchdog: {
      owner: "waitForNativeMotion",
      delay: "watchdogBudgetMs",
      directlyCancelsStartedMotion: true
    }
  };
}

function insertPlayerProbeObservations(source, observations) {
  const edits = observations.map(({ node, statement }) => {
    const position = node.getStart();
    const lineStart = source.lastIndexOf("\n", position - 1) + 1;
    const indent = source.slice(lineStart, position);
    return { position, text: `${statement}\n${indent}` };
  }).sort((left, right) => right.position - left.position);

  let output = source;
  for (const edit of edits) {
    output = `${output.slice(0, edit.position)}${edit.text}${output.slice(edit.position)}`;
  }
  return output;
}

export function injectPlayerLifecycleProbe(source, runId = "p2-63b2-test-run") {
  let output = replaceExactlyOnce(
    source,
    "export function createInteractionActionPlayer({",
    `${probeReporterSource(runId)}\n\nexport function createInteractionActionPlayer({`,
    "player lifecycle reporter"
  );
  output = replaceExactlyOnce(
    output,
    `    const { action, reason } = activeAction;
    clearActiveActionScheduling(activeAction);
    activeInteractionAction = null;
    restoreTemporaryPartOpacities();`,
    `    const { action, reason } = activeAction;
    clearActiveActionScheduling(activeAction);
    activeInteractionAction = null;
    reportP263B2Probe("restore_started", { actionType: action.type, motionPresetId: action.motionPresetId ?? null });
    restoreTemporaryPartOpacities();`,
    "restore start observation"
  );
  output = replaceExactlyOnce(
    output,
    `    reportTelemetry("pet_interaction_action_finished", {`,
    `    reportP263B2Probe("restore_completed", { actionType: action.type, motionPresetId: action.motionPresetId ?? null });
    reportTelemetry("pet_interaction_action_finished", {`,
    "restore completion observation"
  );
  const watchdogs = getPlayerWatchdogStructure(output);
  return insertPlayerProbeObservations(output, [
    {
      node: watchdogs.start.declarationStatement,
      statement: `reportP263B2Probe("player_start_watchdog_armed", { motionPresetId: action.motionPresetId ?? null });`
    },
    {
      node: watchdogs.start.stopStatement,
      statement: `reportP263B2Probe("player_start_watchdog_fired", { motionPresetId: action.motionPresetId ?? null });`
    },
    {
      node: watchdogs.runtime.declarationStatement,
      statement: `reportP263B2Probe("player_runtime_watchdog_armed", { durationMs: result.durationMs, motionPresetId: result.motionPresetId });`
    },
    {
      node: watchdogs.runtime.stopStatement,
      statement: `reportP263B2Probe("player_runtime_watchdog_fired", { durationMs: result.durationMs, motionPresetId: result.motionPresetId });`
    }
  ]);
}

export function injectFramePipelineProbe(source, runId = "p2-63b2-test-run") {
  let output = replaceExactlyOnce(
    source,
    "export function updateCubismFrame(",
    `${probeReporterSource(runId)}\n\nconst P2_63B2_ANGLE_Y_IDS: ReadonlySet<string> = new Set(["ParamAngleY"]);\n\nexport function updateCubismFrame(`,
    "frame pipeline reporter"
  );
  output = replaceExactlyOnce(
    output,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);`,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  const angleYIndex = findOwnedParameterIndices(model, P2_63B2_ANGLE_Y_IDS)[0] ?? -1;
  const sourceAngleY = angleYIndex >= 0 ? model.getParameterValueByIndex(angleYIndex) : null;
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);`,
    "motion source parameter sample"
  );
  output = replaceExactlyOnce(
    output,
    `  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  model.update();`,
    `  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  reportP263B2Probe("frame_parameter_sample", {
    owned: ownedParameterIds.has("ParamAngleY"),
    sourceAngleY,
    runtimeAngleY: angleYIndex >= 0 ? model.getParameterValueByIndex(angleYIndex) : null
  });
  model.update();`,
    "protected runtime parameter sample"
  );
  return output;
}

export function injectIsolatedCubismProbe(source, runId = "p2-63a-test-run") {
  return injectNativeLifecycleProbe(source, runId);
}

export function summarizeProbeOutcome({ fixtureMotion, canonicalization, timing, preTriggerProbeEvents, stateEvent, probeEvents, frameSamples, restoredFrame, runId }) {
  const findStage = (stage) => probeEvents.find((event) => event.stage === stage) ?? null;
  const loadAttempt = findStage("load_attempt");
  const parseBlocked = findStage("parser_blocked");
  const parseSucceeded = findStage("parse_succeeded");
  const startAttempt = findStage("start_attempt");
  const startSucceeded = findStage("start_succeeded");
  const watchdogStop = findStage("watchdog_stop");
  const watchdogElapsedMs = Number.isFinite(startSucceeded?.atMs) && Number.isFinite(watchdogStop?.atMs)
    ? watchdogStop.atMs - startSucceeded.atMs
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
    sample.referenceName === "start_succeeded" &&
    Number.isFinite(sample.offsetMs) &&
    Math.abs(sample.offsetMs - requiredSampleOffsets[index]) <= 120
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
      explicitDraftMode: canonicalization.explicitDraftMode === true,
      sourceVersion: canonicalization.sourceVersion,
      outputVersion: fixtureMotion.Version ?? null,
      sourceCurveCount: canonicalization.sourceCurveCount,
      retainedCurveCount: canonicalization.retainedCurveCount,
      retainedSegmentCount: canonicalization.retainedSegmentCount,
      retainedPointCount: canonicalization.retainedPointCount,
      semanticMotionVariation: canonicalization.semanticMotionVariation === true,
      variedParameterCount: canonicalization.variedParameterCount ?? 0,
      variedParameterIds: canonicalization.variedParameterIds ?? [],
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
      (outcome.fixture.explicitDraftMode
        ? outcome.fixture.sourceVersion === 3 &&
          outcome.fixture.sourceCurveCount === 9 &&
          outcome.fixture.retainedCurveCount === 9
        : outcome.fixture.sourceVersion === 0 &&
          outcome.fixture.sourceCurveCount === 237 &&
          outcome.fixture.retainedCurveCount === 9 &&
          outcome.fixture.retainedSegmentCount === 106 &&
          outcome.fixture.retainedPointCount === 327) &&
      outcome.fixture.outputVersion === 3 &&
      outcome.fixture.canonicalConsistencyCheck &&
      outcome.fixture.cubismConsistencyCheck &&
      outcome.fixture.diagnosticOnly
    ),
    loop: outcome.fixture.loopForcedFalse,
    semanticMotionVariation: outcome.fixture.semanticMotionVariation,
    sampling: outcome.visual.sampleTimingCovered,
    motionVisible: outcome.visual.visibleFrameObserved,
    motionChanged: outcome.visual.frameChangeObserved,
    watchdog: outcome.watchdogStop.bounded,
    restore: outcome.restored.visible && outcome.restored.timely,
    cleanup: cleanupPassed
  };
  const blockerEvidence = {
    sourceVersion: outcome.fixture.sourceVersion,
    parserStatus: outcome.parse.status,
    rendererError,
    semanticMotionVariation: outcome.fixture.semanticMotionVariation,
    variedParameterCount: outcome.fixture.variedParameterCount,
    variedParameterIds: outcome.fixture.variedParameterIds,
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

export function createExplicitDraftInputBlockedSummary(error, sourceMode) {
  const sanitizedError = sanitizeError(error);
  return {
    safeSummaryOnly: true,
    ok: false,
    status: "blocked",
    acceptance: sanitizedError.message || "explicit-draft-input-blocked",
    error: sanitizedError,
    phase: `${sourceMode}-input`,
    sourceMode,
    explicitDraftMode: sourceMode === "user-data-draft",
    diagnosticOnly: true,
    manualVisualPass: false,
    realUi: { launchAttempted: false }
  };
}

function roundEvidence(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : null;
}

export function summarizeParameterEvidence(probeEvents, nativeStartedAtMs, durationMs) {
  const samples = probeEvents.filter((event) => (
    event.stage === "frame_parameter_sample" &&
    event.owned === true &&
    Number.isFinite(event.sourceAngleY) &&
    Number.isFinite(event.runtimeAngleY) &&
    Number.isFinite(event.atMs) &&
    event.atMs >= nativeStartedAtMs &&
    event.atMs <= nativeStartedAtMs + durationMs
  ));
  const summarize = (key) => {
    const values = samples.map((sample) => sample[key]);
    const min = values.length > 0 ? Math.min(...values) : null;
    const max = values.length > 0 ? Math.max(...values) : null;
    return { min: roundEvidence(min), max: roundEvidence(max), span: roundEvidence(max === null ? null : max - min) };
  };
  const source = summarize("sourceAngleY");
  const runtime = summarize("runtimeAngleY");
  const runtimeSourceSpanRatio = source.span > 0 ? runtime.span / source.span : null;
  const checkpoints = [0, 2_500, 4_270, durationMs].map((offsetMs) => {
    const sample = samples.reduce((closest, candidate) => (
      !closest || Math.abs(candidate.atMs - nativeStartedAtMs - offsetMs) < Math.abs(closest.atMs - nativeStartedAtMs - offsetMs)
        ? candidate
        : closest
    ), null);
    return {
      offsetMs,
      sampleDistanceMs: Number.isFinite(sample?.atMs)
        ? Math.round(Math.abs(sample.atMs - nativeStartedAtMs - offsetMs))
        : null,
      source: roundEvidence(sample?.sourceAngleY),
      runtime: roundEvidence(sample?.runtimeAngleY)
    };
  });
  const sampleCountGatePassed = samples.length >= P2_63B2_MIN_PARAMETER_SAMPLES;
  const checkpointDistanceGatePassed = checkpoints.every((checkpoint) => (
    checkpoint.sampleDistanceMs !== null && checkpoint.sampleDistanceMs <= P2_63B2_MAX_CHECKPOINT_DISTANCE_MS
  ));
  const polarityGatePassed = checkpoints[1].source > 0 && checkpoints[1].runtime > 0 &&
    checkpoints[2].source < 0 && checkpoints[2].runtime < 0;
  return {
    sampleCount: samples.length,
    source,
    runtime,
    runtimeSourceSpanRatio: roundEvidence(runtimeSourceSpanRatio),
    checkpoints,
    sampleCountGatePassed,
    checkpointDistanceGatePassed,
    polarityGatePassed,
    checkpointGatePassed: sampleCountGatePassed && checkpointDistanceGatePassed && polarityGatePassed,
    directionPreserved: Boolean(
      checkpoints[1].source > checkpoints[0].source && checkpoints[1].runtime > checkpoints[0].runtime &&
      checkpoints[2].source < checkpoints[1].source && checkpoints[2].runtime < checkpoints[1].runtime
    ),
    spanGatePassed: runtimeSourceSpanRatio !== null && runtimeSourceSpanRatio >= 0.8
  };
}

export function summarizeLifecycleEvidence(probeEvents, timeoutControl = false) {
  const countIn = (events, stage, status) => events.filter((event) => (
    event.stage === stage && (status === undefined || event.status === status)
  )).length;
  const targetEvents = probeEvents.filter((event) => event.motionPresetId === YAWN_PRESET_ID);
  const firstIndex = (stage, status) => targetEvents.findIndex((event) => (
    event.stage === stage && (status === undefined || event.status === status)
  ));
  const makeCounts = (events) => ({
    queued: countIn(events, "queued"),
    nativeStarted: countIn(events, "native_started"),
    handleFinishedAfterUpdate: countIn(events, "handle_finished_after_update"),
    completed: countIn(events, "terminal_status", "completed"),
    timedOut: countIn(events, "terminal_status", "timed_out"),
    stopAllMotions: countIn(events, "stop_all_motions"),
    startWatchdogArmed: countIn(events, "player_start_watchdog_armed"),
    startWatchdogFired: countIn(events, "player_start_watchdog_fired"),
    runtimeWatchdogArmed: countIn(events, "player_runtime_watchdog_armed"),
    runtimeWatchdogFired: countIn(events, "player_runtime_watchdog_fired"),
    restoreStarted: countIn(events, "restore_started"),
    restoreCompleted: countIn(events, "restore_completed")
  });
  const terminalStatus = timeoutControl ? "timed_out" : "completed";
  const orderedStages = timeoutControl
    ? [["queued"], ["native_started"], ["player_start_watchdog_armed"], ["player_runtime_watchdog_armed"], ["player_runtime_watchdog_fired"], ["terminal_status", "timed_out"], ["stop_all_motions"], ["restore_started"], ["restore_completed"]]
    : [["queued"], ["native_started"], ["player_start_watchdog_armed"], ["player_runtime_watchdog_armed"], ["handle_finished_after_update"], ["terminal_status", "completed"], ["restore_started"], ["restore_completed"]];
  const indices = orderedStages.map(([stage, status]) => firstIndex(stage, status));
  const strictOrder = indices.every((index, position) => index >= 0 && (position === 0 || index > indices[position - 1]));
  const counts = makeCounts(targetEvents);
  const observedGlobalCounts = makeCounts(probeEvents);
  const passed = timeoutControl
    ? strictOrder && counts.queued === 1 && counts.nativeStarted === 1 &&
      counts.startWatchdogArmed === 1 && counts.startWatchdogFired === 0 &&
      counts.runtimeWatchdogArmed === 1 && counts.runtimeWatchdogFired === 1 &&
      counts.timedOut === 1 && counts.completed === 0 &&
      counts.stopAllMotions === 1 && counts.restoreStarted === 1 && counts.restoreCompleted === 1
    : strictOrder && counts.queued === 1 && counts.nativeStarted === 1 && counts.handleFinishedAfterUpdate === 1 &&
      counts.completed === 1 && counts.timedOut === 0 && counts.stopAllMotions === 0 &&
      counts.startWatchdogArmed === 1 && counts.startWatchdogFired === 0 &&
      counts.runtimeWatchdogArmed === 1 && counts.runtimeWatchdogFired === 0 &&
      counts.restoreStarted === 1 && counts.restoreCompleted === 1;
  return {
    mode: timeoutControl ? "timeout-control" : "normal",
    targetMotionPresetId: YAWN_PRESET_ID,
    terminalStatus,
    strictOrder,
    counts,
    observedGlobalCounts,
    passed
  };
}

export function summarizeContinuousEvidence(index, nativeStartedAtMs, restoreCompletedAtMs, durationMs) {
  const offsets = index.map((frame) => (
    Number.isFinite(frame.offsetMs) ? frame.offsetMs : frame.atMs - nativeStartedAtMs
  )).filter(Number.isFinite).sort((left, right) => left - right);
  const intervals = offsets.slice(1).map((offset, index) => offset - offsets[index]);
  const coveredMs = offsets.length > 0 ? offsets[offsets.length - 1] - offsets[0] : 0;
  const maxIntervalMs = intervals.length > 0 ? Math.max(...intervals) : null;
  const sortedIntervals = [...intervals].sort((left, right) => left - right);
  const p95IntervalMs = sortedIntervals.length > 0
    ? sortedIntervals[Math.ceil(sortedIntervals.length * 0.95) - 1]
    : null;
  const effectiveFps = coveredMs > 0 ? (offsets.length - 1) * 1_000 / coveredMs : 0;
  const restoreCoverageMs = Number.isFinite(restoreCompletedAtMs) && offsets.length > 0
    ? nativeStartedAtMs + offsets[offsets.length - 1] - restoreCompletedAtMs
    : 0;
  let validPngFrames = 0;
  let visiblePngFrames = 0;
  let changedPairs = 0;
  let currentStaticRunFrames = index.length > 0 ? 1 : 0;
  let maxStaticRunFrames = currentStaticRunFrames;
  let dimensionsConsistent = true;
  let previous = null;
  const frameHashes = new Set();
  for (const frame of index) {
    const evidence = summarizePngFrameEvidence(frame);
    if (evidence.pngValid) validPngFrames += 1;
    if (evidence.nonTransparentPixels > 1_000) visiblePngFrames += 1;
    if (evidence.pngSha256) frameHashes.add(evidence.pngSha256);
    if (previous) {
      const sameDimensions = previous.width === evidence.width && previous.height === evidence.height;
      dimensionsConsistent &&= sameDimensions;
      const changedPixelRatio = sameDimensions ? calculateChangedPixelRatio(previous, evidence) : 0;
      if (changedPixelRatio >= P2_63B2_MIN_CHANGED_PIXEL_RATIO) {
        changedPairs += 1;
        currentStaticRunFrames = 1;
      } else {
        currentStaticRunFrames += 1;
        maxStaticRunFrames = Math.max(maxStaticRunFrames, currentStaticRunFrames);
      }
    }
    previous = evidence;
  }
  const adjacentPairCount = Math.max(0, index.length - 1);
  const changedPairCoverage = adjacentPairCount > 0 ? changedPairs / adjacentPairCount : 0;
  const distinctFrameHashes = frameHashes.size;
  const timingGates = {
    effectiveFps: effectiveFps >= P2_63B2_MIN_EFFECTIVE_FPS && effectiveFps <= P2_63B2_MAX_EFFECTIVE_FPS,
    p95Interval: p95IntervalMs !== null && p95IntervalMs <= P2_63B2_MAX_P95_INTERVAL_MS,
    absoluteMaxGap: maxIntervalMs !== null && maxIntervalMs <= P2_63B2_MAX_ABSOLUTE_GAP_MS
  };
  const timingFailureReasons = [
    ...(!timingGates.effectiveFps ? ["effective-fps-out-of-range"] : []),
    ...(!timingGates.p95Interval ? ["p95-interval-exceeded"] : []),
    ...(!timingGates.absoluteMaxGap ? ["absolute-max-gap-exceeded"] : [])
  ];
  return {
    frameCount: offsets.length,
    coveredMs: Math.round(coveredMs),
    effectiveFps: roundEvidence(effectiveFps),
    maxIntervalMs: maxIntervalMs === null ? null : Math.round(maxIntervalMs),
    p95IntervalMs: p95IntervalMs === null ? null : Math.round(p95IntervalMs),
    absoluteMaxGapMs: maxIntervalMs === null ? null : Math.round(maxIntervalMs),
    timingGates,
    timingFailureReasons,
    restoreCoverageMs: Math.round(restoreCoverageMs),
    validPngFrames,
    visiblePngFrames,
    distinctFrameHashes,
    changedPairs,
    adjacentPairCount,
    changedPairCoverage: roundEvidence(changedPairCoverage),
    maxStaticRunFrames,
    dimensionsConsistent,
    passed: timingFailureReasons.length === 0 &&
      coveredMs >= durationMs + 300 && restoreCoverageMs >= 300 &&
      validPngFrames === index.length && visiblePngFrames === index.length && dimensionsConsistent &&
      distinctFrameHashes >= 2 && changedPairCoverage >= P2_63B2_MIN_CHANGED_PAIR_COVERAGE &&
      maxStaticRunFrames <= P2_63B2_MAX_STATIC_RUN_FRAMES
  };
}

function calculateChangedPixelRatio(previous, current) {
  if (!previous.pixels || !current.pixels || previous.pixels.length !== current.pixels.length) return 0;
  let changedPixels = 0;
  for (let index = 0; index < previous.pixels.length; index += 4) {
    if (
      Math.abs(previous.pixels[index] - current.pixels[index]) > 8 ||
      Math.abs(previous.pixels[index + 1] - current.pixels[index + 1]) > 8 ||
      Math.abs(previous.pixels[index + 2] - current.pixels[index + 2]) > 8 ||
      Math.abs(previous.pixels[index + 3] - current.pixels[index + 3]) > 8
    ) {
      changedPixels += 1;
    }
  }
  return changedPixels / Math.max(previous.nonTransparentPixels, current.nonTransparentPixels, 1);
}

function summarizePngFrameEvidence(frame) {
  if (typeof frame.data !== "string") {
    return { pngValid: false, pngSha256: null, width: 0, height: 0, nonTransparentPixels: 0, pixels: null };
  }
  const bytes = Buffer.from(frame.data, "base64");
  try {
    const png = decodePng(bytes, {
      maxWidth: P2_63B2_MAX_SCREENCAST_WIDTH,
      maxHeight: P2_63B2_MAX_SCREENCAST_HEIGHT
    });
    return {
      pngValid: true,
      pngSha256: createHash("sha256").update(bytes).digest("hex"),
      width: png.width,
      height: png.height,
      nonTransparentPixels: countVisiblePngPixels(png.pixels),
      pixels: png.pixels
    };
  } catch {
    return { pngValid: false, pngSha256: null, width: 0, height: 0, nonTransparentPixels: 0, pixels: null };
  }
}

export function createScreencastFrameCollector({
  acknowledge,
  maxFrames = P2_63B2_MAX_SCREENCAST_FRAMES,
  maxBytes = P2_63B2_MAX_SCREENCAST_BYTES
}) {
  const frames = [];
  const ackPromises = [];
  let retainedBytes = 0;
  let observedFrames = 0;
  let limitReached = false;

  function onFrame(event) {
    observedFrames += 1;
    let ack;
    try {
      ack = Promise.resolve(acknowledge(event.sessionId));
    } catch (error) {
      ack = Promise.reject(error);
    }
    ackPromises.push(ack);
    void ack.catch(() => undefined);

    const timestamp = event.metadata?.timestamp;
    if (typeof event.data !== "string" || !Number.isFinite(timestamp)) return;
    const byteLength = Buffer.byteLength(event.data, "base64");
    if (frames.length >= maxFrames || retainedBytes + byteLength > maxBytes) {
      limitReached = true;
      return;
    }
    frames.push({ data: event.data, timestamp, byteLength });
    retainedBytes += byteLength;
  }

  return {
    onFrame,
    getFrames: () => frames.slice(),
    getSummary: () => ({ observedFrames, retainedFrames: frames.length, retainedBytes, limitReached }),
    async settleAcks() {
      const results = await Promise.allSettled(ackPromises);
      const rejected = results.filter((result) => result.status === "rejected");
      if (rejected.length > 0) throw new Error(`screencast-frame-ack-failed:${rejected.length}`);
    }
  };
}

export async function startScreencastCapture(cdp) {
  const collector = createScreencastFrameCollector({
    acknowledge: (sessionId) => cdp.send("Page.screencastFrameAck", { sessionId })
  });
  const listener = (event) => collector.onFrame(event);
  const unsubscribe = cdp.on("Page.screencastFrame", listener);
  let stopped = false;
  let terminalError = null;
  try {
    await cdp.send("Page.startScreencast", {
      format: "png",
      maxWidth: P2_63B2_MAX_SCREENCAST_WIDTH,
      maxHeight: P2_63B2_MAX_SCREENCAST_HEIGHT,
      everyNthFrame: 1
    });
  } catch (error) {
    unsubscribe();
    throw error;
  }

  return {
    collector,
    async stop() {
      if (terminalError) throw terminalError;
      if (stopped) return collector.getSummary();
      await cdp.send("Page.stopScreencast");
      stopped = true;
      try {
        unsubscribe();
        await collector.settleAcks();
      } catch (error) {
        terminalError = error;
        throw error;
      }
      return collector.getSummary();
    }
  };
}

export function selectScreencastFrames({
  frames,
  performanceTimeOrigin,
  nativeStartedAtMs,
  restoreCompletedAtMs,
  intervalMs = P2_63B2_CAPTURE_INTERVAL_MS,
  maxFrames = P2_63B2_MAX_CAPTURE_FRAMES,
  baselineMs = 0,
  restoreTailMs = P2_63B2_RESTORE_TAIL_MS
}) {
  const windowStartMs = performanceTimeOrigin + nativeStartedAtMs - baselineMs;
  const windowEndMs = performanceTimeOrigin + restoreCompletedAtMs + restoreTailMs;
  const selected = [];
  let lastSlot = -1;
  for (const frame of frames) {
    const timestampMs = frame.timestamp * 1_000;
    if (timestampMs < windowStartMs || timestampMs > windowEndMs + intervalMs) continue;
    const slot = Math.max(0, Math.floor((timestampMs - windowStartMs) / intervalMs));
    if (slot === lastSlot) continue;
    selected.push({ ...frame, timestampMs, offsetMs: timestampMs - (performanceTimeOrigin + nativeStartedAtMs), slot });
    lastSlot = slot;
    if (selected.length === maxFrames) break;
  }
  return selected;
}

export function writeSelectedScreencastFrames(runDir, frames) {
  const index = frames.map((frame, frameNumber) => {
    const filename = `continuous-${String(frameNumber).padStart(4, "0")}.png`;
    writeFileSync(join(runDir, filename), Buffer.from(frame.data, "base64"));
    const { pixels: _pixels, ...pngEvidence } = summarizePngFrameEvidence(frame);
    return {
      filename,
      offsetMs: roundEvidence(frame.offsetMs),
      metadataTimestamp: frame.timestamp,
      imageBytes: frame.byteLength,
      slot: frame.slot,
      ...pngEvidence
    };
  });
  writeFileSync(join(runDir, "continuous-frame-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

async function main() {
  const startedAt = Date.now();
  let runnerArgs;
  let sourceMode;
  let source = null;
  try {
    runnerArgs = parseRunnerArgs(process.argv.slice(2));
    sourceMode = sourceModeForRunnerArgs(runnerArgs);
    if (runnerArgs.mode === "explicit-draft") {
      source = readExplicitDraftFromUserData(runnerArgs.sourceUserDataRoot);
    } else if (runnerArgs.mode === "model-candidate") {
      source = readModelCandidateFromRoot(ROOT);
    }
  } catch (error) {
    console.log(JSON.stringify(
      createExplicitDraftInputBlockedSummary(
        error,
        sourceMode ?? (process.argv.includes("--source-model-candidate") ? "model-candidate" : "user-data-draft")
      ),
      null,
      2
    ));
    process.exitCode = 1;
    return;
  }

  if (runnerArgs.mode === "default") {
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
  let canonicalization = null;
  let timing = null;
  let continuousIndex = [];
  let continuousEvidence = null;
  let anchorPaths = [];
  let lifecycle = null;
  let parameterEvidence = null;
  let stateSelection = null;
  let runtimeDiagnostics = {};
  let screencastCapture = null;
  let pet = null;
  let pointerInputIsolated = false;
  const runController = new AbortController();
  const cleanup = {
    screencastStopped: true,
    screencastUnsubscribed: true,
    screencastAcksSettled: true,
    electronStopped: false,
    tmpRemoved: false,
    artifactsRetained: false,
    protectedFilesRestored: false,
    screenshotResidue: [],
    errors: []
  };

  try {
    await withHardTimeout(async () => {
    const prepared = prepareIsolatedApp(fixtureRoot, runId, source, runnerArgs.timeoutControl);
    canonicalization = prepared.canonicalization;
    timing = prepared.timing;
    await buildIsolatedRenderer(fixtureRoot, context);
    runController.signal.throwIfAborted();
    startIsolatedElectron(context, fixtureRoot);
    await connectToElectron(context, 40_000);
    runController.signal.throwIfAborted();
    pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
    await sleep(3_000);
    runController.signal.throwIfAborted();

    await evaluate(pet, "window.petApi?.openChat()");
    const chat = await waitForWindow(context, "renderer/chat/index.html", 20_000);
    await waitFor(chat, "Boolean(document.querySelector('#chat-page'))", { timeoutMs: 15_000 });
    await setPresenceMode(chat, "default");
    await sleep(2_000);
    runController.signal.throwIfAborted();
    const preTriggerProbeEvents = await readProbeEvents(pet);
    assertNoPreTriggerYawnLoad(preTriggerProbeEvents);
    const telemetryStartIndex = readTelemetryEvents(context).length - 1;
    const performanceTimeOrigin = await evaluate(pet, "performance.timeOrigin");
    await setPetPointerInputIsolation(pet, true);
    pointerInputIsolated = true;
    screencastCapture = await startScreencastCapture(pet.cdp);
    cleanup.screencastStopped = false;
    cleanup.screencastUnsubscribed = false;
    cleanup.screencastAcksSettled = false;
    await setPresenceMode(chat, "sleep");

    const stateEvent = await waitForTelemetry(context, (event) => (
      event.__index > telemetryStartIndex &&
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "state_sleep" &&
      event.payload?.stateId === "sleep" &&
      event.payload?.type === "doze" &&
      event.payload?.durationMs === timing.durationMs &&
      event.payload?.selectedActionType === "doze"
    ), 8_000, runController.signal);
    if (!stateEvent) {
      throw new Error(diagnoseStateSleepFailure(readTelemetryEvents(context), telemetryStartIndex));
    }
    const nativeStarted = await waitForTargetProbeStage(pet, "native_started", 10_000, runController.signal);
    if (!nativeStarted) throw new Error("probe-stage-timeout:native_started");
    runController.signal.throwIfAborted();
    const anchorCapture = captureTimedScreenshots(
      pet,
      context,
      nativeStarted.atMs,
      timing.sampleOffsetsMs,
      runController.signal
    );
    const restoreCompleted = await waitForTargetProbeStage(
      pet,
      "restore_completed",
      timing.durationMs + 2_500,
      runController.signal
    );
    if (!restoreCompleted) throw new Error("probe-stage-timeout:restore_completed");
    anchorPaths = await anchorCapture;
    await waitForEvent(() => {
      const lastFrame = screencastCapture.collector.getFrames().at(-1);
      const targetTimestamp = (performanceTimeOrigin + restoreCompleted.atMs + P2_63B2_RESTORE_TAIL_MS) / 1_000;
      return lastFrame?.timestamp >= targetTimestamp ? lastFrame : null;
    }, { timeoutMs: 1_500, intervalMs: 20, signal: runController.signal });
    const screencastSummary = await screencastCapture.stop();
    cleanup.screencastStopped = true;
    cleanup.screencastUnsubscribed = true;
    cleanup.screencastAcksSettled = true;
    const selectedFrames = selectScreencastFrames({
      frames: screencastCapture.collector.getFrames(),
      performanceTimeOrigin,
      nativeStartedAtMs: nativeStarted.atMs,
      restoreCompletedAtMs: restoreCompleted.atMs
    });
    continuousEvidence = summarizeContinuousEvidence(
      selectedFrames,
      nativeStarted.atMs,
      restoreCompleted.atMs,
      timing.durationMs
    );
    continuousIndex = keepArtifacts
      ? writeSelectedScreencastFrames(context.runDir, selectedFrames)
      : selectedFrames.map((frame) => {
        const { pixels: _pixels, ...pngEvidence } = summarizePngFrameEvidence(frame);
        return { offsetMs: frame.offsetMs, ...pngEvidence };
      });
    const probeEvents = await readProbeEvents(pet);
    lifecycle = summarizeLifecycleEvidence(probeEvents, runnerArgs.timeoutControl);
    parameterEvidence = summarizeParameterEvidence(probeEvents, nativeStarted.atMs, timing.durationMs);
    stateSelection = {
      reason: stateEvent?.payload?.reason ?? null,
      stateId: stateEvent?.payload?.stateId ?? null,
      actionType: stateEvent?.payload?.type ?? null,
      remainedSleepUntilRestore: stateEvent?.payload?.stateId === "sleep" && Boolean(restoreCompleted),
      preTriggerNoYawnLoad: true
    };
    await setPetPointerInputIsolation(pet, false);
    pointerInputIsolated = false;
    await setPresenceMode(chat, "default");
    await sleep(300);
    runtimeDiagnostics = readRuntimeDiagnostics(context);
    summary = {
      ok: false,
      status: "pending-cleanup",
      acceptance: "pending-cleanup",
      isolatedFixture: true,
      diagnosticOnly: true,
      sourceMode,
      explicitDraftMode: sourceMode === "user-data-draft",
      mode: runnerArgs.timeoutControl ? "timeout-control" : "normal",
      sourceDraft: source?.summary ?? null,
      canonicalization,
      timing,
      fixture: { loop: prepared.fixtureLoop },
      productionCatalogModified: false,
      stateSelection,
      lifecycle,
      parameterEvidence,
      continuousEvidence,
      capture: {
        ...screencastSummary,
        selectedFrames: continuousIndex.length,
        anchorCount: anchorPaths.length,
        restoreObserved: true
      },
      runtimeDiagnostics,
      postRestoreModeSwitch: "default",
      durationMs: Date.now() - startedAt,
    };
    }, P2_63B2_RUN_TIMEOUT_MS, runController);
  } catch (error) {
    runtimeDiagnostics = readRuntimeDiagnostics(context);
    summary = {
      ok: false,
      status: "failed",
      acceptance: "probe-failed",
      isolatedFixture: true,
      diagnosticOnly: true,
      sourceMode,
      explicitDraftMode: sourceMode === "user-data-draft",
      mode: runnerArgs?.timeoutControl ? "timeout-control" : "normal",
      sourceDraft: source?.summary ?? null,
      canonicalization,
      timing,
      productionCatalogModified: false,
      durationMs: Date.now() - startedAt,
      failure: sanitizeError(error),
      runtimeDiagnostics
    };
  } finally {
    await runCleanupStep(cleanup, "pointer-input-isolation", async () => {
      if (!pet || !pointerInputIsolated) return;
      await setPetPointerInputIsolation(pet, false);
      pointerInputIsolated = false;
    });
    await runCleanupStep(cleanup, "screencast-stop", async () => {
      if (!screencastCapture) return;
      await screencastCapture.stop();
      cleanup.screencastStopped = true;
      cleanup.screencastUnsubscribed = true;
      cleanup.screencastAcksSettled = true;
    });
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
      cleanup.tmpRemoved = removeCurrentRunArtifacts(context);
      if (!cleanup.tmpRemoved) throw new Error("run temp directory remained");
    });
    await runCleanupStep(cleanup, "protected-paths", async () => {
      cleanup.protectedFilesRestored = protectedHashesEqual(protectedBefore, hashProtectedPaths());
      if (!cleanup.protectedFilesRestored) throw new Error("protected production path changed");
    });
  }

  summary.cleanup = cleanup;
  const cleanupPassed = cleanup.screencastStopped && cleanup.screencastUnsubscribed && cleanup.screencastAcksSettled &&
    cleanup.electronStopped && (cleanup.tmpRemoved || cleanup.artifactsRetained) &&
    cleanup.protectedFilesRestored && cleanup.screenshotResidue.length === 0 && cleanup.errors.length === 0;
  const continuousPassed = summary.continuousEvidence?.passed === true && summary.capture?.limitReached === false;
  const rendererError = /Uncaught (?:TypeError|Error):/u.test(Object.values(runtimeDiagnostics).join("\n"));
  const passed = Boolean(lifecycle?.passed && parameterEvidence?.spanGatePassed &&
    parameterEvidence?.directionPreserved && parameterEvidence?.checkpointGatePassed &&
    stateSelection?.remainedSleepUntilRestore && cleanupPassed && continuousPassed && !rendererError);
  summary.status = passed ? "passed" : summary.status === "failed" ? "failed" : "blocked";
  summary.acceptance = passed ? "real-ui-evidence-contract-passed" : summary.acceptance === "probe-failed"
    ? "probe-failed"
    : "required-gate-failed";
  summary.ok = passed;
  summary.artifacts = keepArtifacts
    ? createPublicArtifactSummary(context, fixtureRoot, continuousIndex, anchorPaths)
    : null;
  if (keepArtifacts) {
    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

export function prepareIsolatedApp(fixtureRoot, runId, source = null, timeoutControl = false) {
  const sourceYawnPath = source?.sourcePath ?? join(ROOT, "model", "yawn.motion3.json");
  const sourceBytes = source?.sourceBytes ?? readFileSync(sourceYawnPath);
  const sourceHashBefore = createHash("sha256").update(sourceBytes).digest("hex");
  const displayInfo = JSON.parse(readFileSync(join(ROOT, "model", "魔女.cdi3.json"), "utf8"));
  const modelParameterIds = displayInfo.Parameters.map(({ Id }) => Id);
  const canonicalResult = source
    ? createValidatedDraftFixture(source.motion, modelParameterIds)
    : createIsolatedMotionFixture(JSON.parse(sourceBytes.toString("utf8")), modelParameterIds);
  if (canonicalResult.status !== "canonicalized") throw new Error("yawn-source-gate-blocked");
  const timing = deriveYawnProbeTiming(canonicalResult.motion.Meta.Duration);
  const fixtureMotion = structuredClone(canonicalResult.motion);
  fixtureMotion.Meta.Loop = timeoutControl;

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
    explicitDraftMode: source !== null,
    sourceHashBefore,
    sourceHashAfter,
    sourceHashUnchanged: true,
    diagnosticOnly: true
  };
  const yawnPath = join(fixtureRoot, "resources", "models", "witch", "motions", "yawn-once.motion3.json");
  writeFileSync(yawnPath, `${JSON.stringify(fixtureMotion)}\n`, "utf8");

  const manifestPath = join(fixtureRoot, "resources", "models", "witch", "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sourceDir = "../../../model-fixture";
  manifest.motionPresets = [{
    id: YAWN_PRESET_ID,
    path: "motions/yawn-once.motion3.json",
    semanticKind: "sleep",
    loop: timeoutControl,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: timing.durationSeconds,
    priority: 3,
    cooldownMs: 2_000,
    restorePolicy: "restore-current-state",
    allowedStates: ["sleep"],
    allowedPresenceModes: ["sleep"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  }];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  patchFile(join(fixtureRoot, "src", "shared", "pet-motion-presets.ts"), (source) => injectIsolatedMotionPreset(source, timing, timeoutControl));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "main.ts"), (source) => injectIsolatedStateSleepPath(source, timing, runId));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-motion.ts"), (source) => injectNativeLifecycleProbe(source, runId));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "interaction-action-player.ts"), (source) => injectPlayerLifecycleProbe(source, runId));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-frame-pipeline.ts"), (source) => injectFramePipelineProbe(source, runId));
  return { canonicalization, timing, fixtureLoop: timeoutControl };
}

export function removeCurrentRunArtifacts(context) {
  const runParentDir = resolve(context.runParentDir);
  const runDir = resolve(context.runDir);
  const relativeRunDir = relative(runParentDir, runDir);
  if (!relativeRunDir || relativeRunDir.startsWith(`..${sep}`) || relativeRunDir === ".." || isAbsolute(relativeRunDir)) {
    throw new Error("invalid-current-run-directory");
  }
  rmSync(runDir, { force: true, recursive: true });
  return !existsSync(runDir);
}

export function createPublicArtifactSummary(context, fixtureRoot, continuousIndex, anchorPaths = []) {
  return {
    runDirectory: relative(ROOT, context.runDir).split(sep).join("/"),
    fixturePath: relative(context.runDir, join(fixtureRoot, "model-fixture", "yawn.motion3.json")).split(sep).join("/"),
    continuousFrameCount: continuousIndex.length,
    continuousFormat: "png",
    timeIndex: "continuous-frame-index.json",
    anchorFrameCount: anchorPaths.length,
    anchorFormat: "png"
  };
}

function createValidatedDraftFixture(motion, modelParameterIds) {
  const validation = validateExplicitDraftMotion(motion, modelParameterIds);
  if (validation.status !== "validated") return { status: "blocked", summary: { blockers: validation.blockers } };
  return {
    status: "canonicalized",
    motion,
    summary: {
      safeSummaryOnly: true,
      status: "validated-draft",
      sourceVersion: 3,
      outputVersion: 3,
      sourceCurveCount: validation.structure.curveCount,
      sourceSegmentCount: validation.structure.segmentCount,
      sourcePointCount: validation.structure.pointCount,
      retainedCurveCount: validation.structure.curveCount,
      retainedSegmentCount: validation.structure.segmentCount,
      retainedPointCount: validation.structure.pointCount,
      semanticMotionVariation: validation.structure.semanticMotionVariation,
      variedParameterCount: validation.structure.variedParameterCount,
      variedParameterIds: validation.structure.variedParameterIds,
      consistencyCheck: validation.structure.consistencyCheck,
      blockers: []
    }
  };
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

export function buildIsolatedRenderer(fixtureRoot, context) {
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

export function startIsolatedElectron(context, fixtureRoot) {
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
      const captureRenderedFrame = async (label, offsetMs, referenceAtMs, referenceName) => {
        const deadline = performance.now() + 250;
        let sample = null;
        do {
          await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
          sample = capture(label, offsetMs, referenceAtMs, referenceName);
          if (sample.nonTransparentPixels > 1_000) return sample;
        } while (performance.now() < deadline);
        return sample;
      };
      globalThis.__P2_63A_TIMED_FRAME_SAMPLES__ = (async () => {
        const trigger = await waitForStage("start_succeeded", 10000);
        const motion = [];
        for (const offsetMs of sampleOffsetsMs) {
          await sleepFor(trigger.atMs + offsetMs - performance.now());
          motion.push(await captureRenderedFrame("motion-" + offsetMs + "ms", offsetMs, trigger.atMs, "start_succeeded"));
        }
        return motion;
      })();
      return true;
    })()
  `);
}

async function captureTimedScreenshots(pet, context, nativeStartedAtMs, sampleOffsetsMs, signal) {
  const paths = [];
  const labels = ["start", "mid", "end"];
  for (const [index, offsetMs] of sampleOffsetsMs.entries()) {
    signal?.throwIfAborted();
    await evaluate(pet, `(async () => {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ${nativeStartedAtMs + offsetMs} - performance.now())));
      await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    })()`);
    paths.push((await captureScreenshot(pet, context, `${labels[index]}-${offsetMs}ms`, signal)).path);
  }
  return paths;
}

async function captureScreenshot(pet, context, label, signal) {
  const frame = await captureVisiblePageFrame({
    signal,
    waitForVisibleFrame: () => waitForVisibleRendererFrame(pet),
    capturePageScreenshot: async () => {
      const result = await pet.cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      return Buffer.from(result.data, "base64");
    }
  });
  const path = join(context.runDir, `p2-63b-yawn-${label}.png`);
  writeFileSync(path, frame.data);
  return {
    path,
    imageBytes: frame.byteLength,
    visiblePixels: frame.pngNonTransparentPixels,
    rendererVisiblePixels: frame.rendererNonTransparentPixels
  };
}

export function assertCapturedFrameVisible({ pngNonTransparentPixels, rendererNonTransparentPixels }) {
  if (
    !Number.isSafeInteger(pngNonTransparentPixels) || pngNonTransparentPixels <= 1_000 ||
    !Number.isSafeInteger(rendererNonTransparentPixels) || rendererNonTransparentPixels <= 1_000
  ) {
    throw new Error("captured-frame-model-not-visible");
  }
}

export async function captureVisiblePageFrame({
  waitForVisibleFrame,
  capturePageScreenshot,
  summarizeScreenshot = summarizeCapturedPng,
  now = Date.now,
  sleepFor = sleep,
  signal
}) {
  signal?.throwIfAborted();
  const renderer = await waitForVisibleFrame();
  const deadline = now() + 250;
  let screenshotAttempts = 0;
  let firstPngNonTransparentPixels = null;
  let image = Buffer.alloc(0);
  let png = { width: 0, height: 0, nonTransparentPixels: 0 };

  do {
    signal?.throwIfAborted();
    image = await capturePageScreenshot();
    screenshotAttempts += 1;
    png = summarizeScreenshot(image);
    firstPngNonTransparentPixels ??= png.nonTransparentPixels;
    try {
      assertCapturedFrameVisible({
        pngNonTransparentPixels: png.nonTransparentPixels,
        rendererNonTransparentPixels: renderer.nonTransparentPixels
      });
      return {
        data: image,
        byteLength: image.length,
        width: png.width,
        height: png.height,
        pngNonTransparentPixels: png.nonTransparentPixels,
        rendererNonTransparentPixels: renderer.nonTransparentPixels,
        rendererContextLost: renderer.contextLost,
        rendererProbeAttempts: renderer.attempts,
        screenshotAttempts
      };
    } catch (error) {
      if (now() >= deadline) break;
    }
    await sleepFor(Math.min(P2_63B2_CAPTURE_INTERVAL_MS, deadline - now()));
  } while (now() <= deadline);

  const captureSummary = {
    firstRendererNonTransparentPixels: renderer.firstNonTransparentPixels,
    rendererNonTransparentPixels: renderer.nonTransparentPixels,
    firstPngNonTransparentPixels,
    pngNonTransparentPixels: png.nonTransparentPixels,
    rendererProbeAttempts: renderer.attempts,
    screenshotAttempts
  };
  const error = new Error(`captured-frame-model-not-visible:${JSON.stringify(captureSummary)}`);
  error.captureSummary = captureSummary;
  throw error;
}

export async function waitForVisibleRendererFrame(pet) {
  return evaluate(pet, `
    (async () => {
      const canvas = document.querySelector("#pet-canvas");
      const gl = canvas?.getContext("webgl2");
      if (!canvas || !gl) throw new Error("missing-webgl2-pet-canvas");
      const deadline = performance.now() + 250;
      let attempts = 0;
      let firstNonTransparentPixels = null;
      let nonTransparentPixels = 0;
      do {
        await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        attempts += 1;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        nonTransparentPixels = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if ((pixels[index] ?? 0) > 8) nonTransparentPixels += 1;
        }
        firstNonTransparentPixels ??= nonTransparentPixels;
        if (nonTransparentPixels > 1_000) break;
      } while (performance.now() < deadline);
      return {
        firstNonTransparentPixels,
        nonTransparentPixels,
        attempts,
        contextLost: gl.isContextLost()
      };
    })()
  `);
}

export function summarizeCapturedPng(buffer) {
  const png = decodePng(buffer);
  return { width: png.width, height: png.height, nonTransparentPixels: countVisiblePngPixels(png.pixels) };
}

function countVisiblePngPixels(pixels) {
  let nonTransparentPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const hasColor = (pixels[index] ?? 0) > 8 ||
      (pixels[index + 1] ?? 0) > 8 ||
      (pixels[index + 2] ?? 0) > 8;
    if ((pixels[index + 3] ?? 0) > 8 && hasColor) nonTransparentPixels += 1;
  }
  return nonTransparentPixels;
}

export function decodePng(buffer, { maxWidth = 630, maxHeight = 900 } = {}) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("invalid-png-signature");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let sawHeader = false;
  let sawEnd = false;
  const idatChunks = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error("invalid-png-chunk-boundary");
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("invalid-png-chunk-boundary");
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(buffer.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`invalid-png-chunk-crc:${type}`);
    const data = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error("invalid-png-header");
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || offset !== buffer.length) throw new Error("invalid-png-end");
      sawEnd = true;
      break;
    }
  }
  if (!sawHeader || !sawEnd || idatChunks.length === 0) throw new Error("incomplete-png");
  if (width <= 0 || height <= 0 || bitDepth !== 8) throw new Error("unsupported-png-shape");
  if (width > maxWidth || height > maxHeight) throw new Error("png-dimensions-exceed-limit");
  const bytesPerPixel = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!bytesPerPixel) throw new Error("unsupported-png-color-type");
  const stride = width * bytesPerPixel;
  const expectedInflatedBytes = height * (stride + 1);
  const maxInflatedBytes = maxHeight * (maxWidth * 4 + 1);
  if (!Number.isSafeInteger(expectedInflatedBytes) || expectedInflatedBytes > maxInflatedBytes) {
    throw new Error("png-inflated-size-exceeds-limit");
  }
  const compressed = Buffer.concat(idatChunks);
  const inflated = inflateSync(compressed, { maxOutputLength: maxInflatedBytes });
  if (inflated.length !== expectedInflatedBytes) throw new Error("invalid-png-scanline-length");
  const pixels = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset] ?? 0;
    sourceOffset += 1;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x] ?? 0;
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0;
      row[x] = (raw + pngFilterPrediction(filter, left, up, upLeft)) & 0xff;
    }
    sourceOffset += stride;
    for (let x = 0; x < width; x += 1) {
      const input = x * bytesPerPixel;
      const output = (y * width + x) * 4;
      const gray = row[input] ?? 0;
      pixels[output] = colorType <= 4 && colorType !== 2 ? gray : row[input] ?? 0;
      pixels[output + 1] = colorType <= 4 && colorType !== 2 ? gray : row[input + 1] ?? 0;
      pixels[output + 2] = colorType <= 4 && colorType !== 2 ? gray : row[input + 2] ?? 0;
      pixels[output + 3] = colorType === 6 ? row[input + 3] ?? 255 : colorType === 4 ? row[input + 1] ?? 255 : 255;
    }
    previous = row;
  }
  return { width, height, pixels };
}

export function encodeRgbaPng(width, height, pixels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("invalid-png-output-dimensions");
  }
  if (!(pixels instanceof Uint8Array) || pixels.byteLength !== width * height * 4) {
    throw new Error("invalid-png-output-pixels");
  }
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (width * 4 + 1);
    scanlines[targetOffset] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4)
      .copy(scanlines, targetOffset + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type, "ascii");
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length, 0);
    typeBytes.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), output.length - 4);
    return output;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = PNG_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngFilterPrediction(filter, left, up, upLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter !== 4) throw new Error("unsupported-png-filter");
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

async function captureCurrentFrame(pet, label, afterStopMs) {
  return evaluate(pet, `
    (async () => {
      const canvas = document.querySelector("#pet-canvas");
      const gl = canvas?.getContext("webgl2");
      if (!canvas || !gl) throw new Error("missing-webgl2-pet-canvas");
      const deadline = performance.now() + 250;
      let nonTransparentPixels = 0;
      let frameHash = "00000000";
      do {
        await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        nonTransparentPixels = 0;
        let hash = 2166136261;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] ?? 0;
          if (alpha > 8) nonTransparentPixels += 1;
          if (index % 64 === 0) {
            hash ^= (pixels[index] ?? 0) + ((pixels[index + 1] ?? 0) << 8) + ((pixels[index + 2] ?? 0) << 16) + (alpha << 24);
            hash = Math.imul(hash, 16777619) >>> 0;
          }
        }
        frameHash = hash.toString(16).padStart(8, "0");
        if (nonTransparentPixels > 1_000) break;
      } while (performance.now() < deadline);
      return {
        label: ${JSON.stringify(label)},
        width: canvas.width,
        height: canvas.height,
        contextLost: gl.isContextLost(),
        nonTransparentPixels,
        frameHash,
        afterStopMs: ${afterStopMs}
      };
    })()
  `);
}

async function readTimedFrameSamples(pet) {
  return evaluate(pet, "globalThis.__P2_63A_TIMED_FRAME_SAMPLES__");
}

async function readProbeEvents(pet) {
  return evaluate(pet, "globalThis.__P2_63B2_YAWN_PROBE__ ?? []");
}

async function waitForTargetProbeStage(pet, stage, timeoutMs, signal) {
  return waitForEvent(
    async () => (await readProbeEvents(pet)).find((candidate) => (
      candidate.stage === stage && candidate.motionPresetId === YAWN_PRESET_ID
    )) ?? null,
    { timeoutMs, intervalMs: 100, signal }
  );
}

export async function waitForEvent(readEvent, {
  timeoutMs,
  intervalMs = 100,
  signal,
  sleepFor = sleep,
  now = Date.now
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    signal?.throwIfAborted();
    const event = await readEvent();
    if (event) return event;
    await sleepFor(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  signal?.throwIfAborted();
  return null;
}

export async function withHardTimeout(operation, timeoutMs, controller = new AbortController()) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error("runner-hard-timeout");
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function stopElectronAndVerify(context) {
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

async function waitForTelemetry(context, predicate, timeoutMs, signal) {
  return waitForEvent(
    () => readTelemetryEvents(context).find(predicate) ?? null,
    { timeoutMs, intervalMs: 120, signal }
  );
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

export function hashProtectedPaths(root = ROOT, paths = PROTECTED_PATHS) {
  return Object.fromEntries(paths.map((path) => {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) return [path, ABSENT_PROTECTED_PATH];
    const content = readFileSync(absolutePath);
    return [path, `sha256:${createHash("sha256").update(content).digest("hex")}`];
  }));
}

export function protectedHashesEqual(left, right, paths = PROTECTED_PATHS) {
  return paths.every((path) => left[path] === right[path]);
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name: error instanceof Error ? error.name : "Error",
    message: sanitizePublicText(message).slice(0, 800)
  };
}

export function sanitizePublicText(value) {
  return String(value)
    .replaceAll(ROOT, "<workspace>")
    .replace(/file:\/\/\/[A-Za-z]:\/[^\s"'<>]*/giu, "<absolute-path>")
    .replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^\s"'<>]*/gu, "<absolute-path>")
    .replace(/\\\\[^\\\s"'<>]+\\[^\s"'<>]*/gu, "<absolute-path>");
}

function readRuntimeDiagnostics(context) {
  return Object.fromEntries(["electron.stdout.log", "electron.stderr.log"].map((name) => {
    const path = join(context.runDir, name);
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    return [name, sanitizePublicText(text).slice(-1_500)];
  }));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
