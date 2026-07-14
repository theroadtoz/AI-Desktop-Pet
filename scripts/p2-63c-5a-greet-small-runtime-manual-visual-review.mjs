import { spawn, spawnSync } from "node:child_process";
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
  rmdirSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIsolatedRenderer,
  decodePng,
  encodeRgbaPng,
  hashProtectedPaths,
  protectedHashesEqual,
  sanitizePublicText,
  selectScreencastFrames,
  setPetPointerInputIsolation,
  startIsolatedElectron,
  startScreencastCapture,
  stopElectronAndVerify,
  validateExplicitDraftMotion,
  waitForEvent,
  withHardTimeout,
  writeSelectedScreencastFrames
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";
import {
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  setPresenceMode,
  sleep,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-63c-5a-greet-small-runtime-manual-visual-review";
const REVIEW_PRESET_ID = "greet-small-review";
const REVIEW_ACTION_ID = "greet-small-review";
const REVIEW_REASON = "greet_small_review";
const PROBE_GLOBAL = "__P2_63C_5A_GREET_SMALL_REVIEW__";
const TRIGGER_GLOBAL = "__P2_63C_5A_GREET_SMALL_TRIGGER__";
const EXPECTED_BASENAME = "greet-small-20260714-145154-050.motion3.json";
const EXPECTED_SHA256 = "c1aee5391b771f05cbe196703d1df6943964a0ba34418b5cdb79089acae66781";
const EXPECTED_BYTES = 59_849;
const EXPECTED_DURATION_SECONDS = 3.4;
const EXPECTED_DURATION_MS = 3_400;
const MOTION_DURATION_TOLERANCE_MS = 120;
const EXPECTED_FPS = 30;
const EXPECTED_CURVE_COUNT = 10;
const EXPECTED_SEGMENT_COUNT = 920;
const EXPECTED_POINT_COUNT = 930;
const REQUIRED_BASELINE_MS = 500;
const CAPTURE_BASELINE_MS = 600;
const REQUIRED_RESTORE_TAIL_MS = 600;
const CAPTURE_RESTORE_TAIL_MS = 700;
const TARGET_INTERVAL_MS = 1_000 / 30;
const MIN_EVIDENCE_FPS = 24;
const MAX_SELECTED_FRAMES = 160;
const RUN_TIMEOUT_MS = 90_000;
const CONTACT_OVERVIEW_PAGE_SIZE = 20;
const CONTACT_RISK_PAGE_SIZE = 6;
const CONTACT_RISK_WINDOWS = Object.freeze([
  { id: "1350-1550", startMs: 1_350, endMs: 1_550 },
  { id: "1550-2750", startMs: 1_550, endMs: 2_750 },
  { id: "2750-3200", startMs: 2_750, endMs: 3_200 }
]);

export const GREET_SMALL_ALLOWLIST = Object.freeze([
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamEyeLOpen",
  "ParamEyeROpen",
  "ParamEyeLSmile",
  "ParamEyeRSmile",
  "ParamBrowLY",
  "ParamBrowLForm",
  "ParamMouthForm"
]);

export const GREET_SMALL_PROTECTED_PATHS = Object.freeze([
  "package.json",
  "resources/models/witch/model-manifest.json",
  "model/魔女.model3.json",
  "model/魔女.cdi3.json",
  "src/shared/pet-motion-presets.ts",
  "src/shared/pet-motion-catalog.ts",
  "src/shared/interaction-action-catalog.ts",
  "src/renderer/pet/interaction-actions.ts",
  "src/renderer/pet/interaction-action-player.ts",
  "src/renderer/pet/main.ts",
  "src/renderer/pet/live2d/cubism-motion.ts",
  "src/renderer/pet/live2d/cubism-frame-pipeline.ts"
]);

export function parseRunnerArgs(argv) {
  let candidateDraft = null;
  let retainEvidence = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--retain-evidence") {
      if (retainEvidence) throw new Error("duplicate-retain-evidence");
      retainEvidence = true;
      continue;
    }
    if (argument === "--candidate-draft") {
      if (candidateDraft !== null || index + 1 >= argv.length) throw new Error("invalid-candidate-draft-argument");
      candidateDraft = argv[++index];
      continue;
    }
    throw new Error("invalid-cli-arguments");
  }
  if (!candidateDraft) throw new Error("candidate-draft-required");
  if (!isAbsolute(candidateDraft)) throw new Error("candidate-draft-must-be-absolute");
  return { candidateDraft: resolve(candidateDraft), retainEvidence };
}

function isPathWithin(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || !child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child);
}

export function isProductionWorkspacePath(candidatePath, workspaceRoot = ROOT) {
  return isPathWithin(workspaceRoot, candidatePath);
}

function assertNoReparseComponents(candidatePath) {
  const parsed = parse(candidatePath);
  const components = candidatePath.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean);
  let current = parsed.root;
  let sawWindowsSymbolicLink = false;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      throw new Error(index === components.length - 1 ? "candidate-file-missing" : "candidate-parent-missing");
    }
    if (stats.isSymbolicLink()) {
      if (process.platform !== "win32") throw new Error("candidate-reparse-path-rejected");
      sawWindowsSymbolicLink = true;
      continue;
    }
    if (index < components.length - 1 && !stats.isDirectory()) throw new Error("candidate-parent-not-directory");
    if (index === components.length - 1 && !stats.isFile()) throw new Error("candidate-not-regular-file");
  }
  if (process.platform === "win32") {
    const attributeCheck = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$path = [Environment]::GetEnvironmentVariable('P2_63C_5A_REPARSE_PATH')
while ($true) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
  $parent = [IO.Directory]::GetParent($path)
  if ($null -eq $parent) { break }
  $path = $parent.FullName
}`
    ], {
      env: { ...process.env, P2_63C_5A_REPARSE_PATH: candidatePath },
      encoding: "utf8",
      windowsHide: true
    });
    if (attributeCheck.status === 23) throw new Error("candidate-reparse-path-rejected");
    if (attributeCheck.status !== 0) throw new Error("candidate-reparse-attribute-check-failed");
    if (sawWindowsSymbolicLink) throw new Error("candidate-reparse-path-rejected");
  }
}

export function validateCandidateIdentity(identity) {
  const blockers = [];
  if (identity.basename !== EXPECTED_BASENAME) blockers.push("candidate-filename-not-allowed");
  if (identity.sha256 !== EXPECTED_SHA256) blockers.push("candidate-sha256-mismatch");
  if (identity.byteLength !== EXPECTED_BYTES) blockers.push("candidate-byte-length-mismatch");
  return { passed: blockers.length === 0, blockers };
}

export function validateCandidateMotion(motion, modelParameterIds) {
  return validateExplicitDraftMotion(motion, modelParameterIds, {
    semanticAllowlist: GREET_SMALL_ALLOWLIST,
    variationParameterIds: GREET_SMALL_ALLOWLIST,
    durationSeconds: EXPECTED_DURATION_SECONDS,
    fps: EXPECTED_FPS,
    curveCount: EXPECTED_CURVE_COUNT,
    segmentCount: EXPECTED_SEGMENT_COUNT,
    pointCount: EXPECTED_POINT_COUNT
  });
}

export function readCandidateDraft(candidatePath, workspaceRoot = ROOT) {
  if (!isAbsolute(candidatePath)) throw new Error("candidate-draft-must-be-absolute");
  const resolvedPath = resolve(candidatePath);
  if (basename(resolvedPath) !== EXPECTED_BASENAME) throw new Error("candidate-filename-not-allowed");
  if (isProductionWorkspacePath(resolvedPath, workspaceRoot)) throw new Error("candidate-production-path-rejected");
  assertNoReparseComponents(resolvedPath);

  let realCandidate;
  try {
    realCandidate = realpathSync.native(resolvedPath);
  } catch {
    throw new Error("candidate-path-resolution-failed");
  }
  if (resolve(realCandidate).toLowerCase() !== resolvedPath.toLowerCase() || isProductionWorkspacePath(realCandidate, workspaceRoot)) {
    throw new Error("candidate-reparse-path-rejected");
  }

  const sourceBytes = readFileSync(resolvedPath);
  const identity = {
    basename: basename(resolvedPath),
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    byteLength: sourceBytes.byteLength
  };
  const identityGate = validateCandidateIdentity(identity);
  if (!identityGate.passed) throw new Error(identityGate.blockers[0]);

  let motion;
  try {
    motion = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("candidate-invalid-json");
  }
  const displayInfo = JSON.parse(readFileSync(join(workspaceRoot, "model", "魔女.cdi3.json"), "utf8"));
  const validation = validateCandidateMotion(motion, displayInfo.Parameters.map(({ Id }) => Id));
  if (validation.status !== "validated") throw new Error(validation.blockers[0] ?? "candidate-structure-blocked");

  return {
    sourcePath: resolvedPath,
    sourceBytes,
    motion: validation.motion,
    summary: {
      safeSummaryOnly: true,
      ...identity,
      structure: validation.structure
    }
  };
}

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`expected exactly one ${label} marker`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

function probeReporterSource(runId) {
  return `function reportGreetSmallReview(stage: string, detail: Record<string, unknown> = {}): void {
  const target = globalThis as typeof globalThis & { ${PROBE_GLOBAL}?: Array<Record<string, unknown>> };
  const events = target.${PROBE_GLOBAL} ?? [];
  events.push({ stage, atMs: Math.round(performance.now()), runId: ${JSON.stringify(runId)}, ...detail });
  target.${PROBE_GLOBAL} = events;
}`;
}

export function injectGreetMotionPreset(source) {
  const marker = "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([";
  const replacement = `${marker}
  {
    id: "${REVIEW_PRESET_ID}",
    path: "motions/greet-small-review.motion3.json",
    semanticKind: "greeting",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: ${EXPECTED_DURATION_SECONDS},
    priority: 50,
    cooldownMs: 2_000,
    restorePolicy: "restore-current-state",
    allowedStates: ["idle"],
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  },`;
  return replaceExactlyOnce(source, marker, replacement, "motion preset catalog");
}

export function injectGreetReviewAction(source) {
  let output = replaceExactlyOnce(
    source,
    "export const PET_INTERACTION_ACTION_TYPES = [",
    `export const PET_INTERACTION_ACTION_TYPES = [\n  "${REVIEW_ACTION_ID}",`,
    "interaction action type catalog"
  );
  output = replaceExactlyOnce(
    output,
    "export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [",
    `export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [
  {
    type: "${REVIEW_ACTION_ID}",
    weight: 0,
    durationMs: ${EXPECTED_DURATION_MS},
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    motionPresetId: "${REVIEW_PRESET_ID}"
  },`,
    "interaction action catalog"
  );
  return output;
}

export function injectGreetReviewTrigger(source) {
  const marker = `
});

function applyBasePresentation(`;
  const replacement = `
});

type GreetSmallReviewGlobal = typeof globalThis & { ${TRIGGER_GLOBAL}?: () => boolean };
(globalThis as GreetSmallReviewGlobal).${TRIGGER_GLOBAL} = () => interactionActionPlayer.playAction(
  getPetInteractionAction("${REVIEW_ACTION_ID}"),
  "${REVIEW_REASON}",
  { stateId: "idle", modeId: "default", presenceModeId: "default", candidateActionTypes: ["${REVIEW_ACTION_ID}"] }
);

function applyBasePresentation(`;
  return replaceExactlyOnce(source, marker, replacement, "review trigger");
}

export function injectGreetPlayerLifecycleProbe(source, runId = "greet-small-review-test") {
  let output = replaceExactlyOnce(
    source,
    "export function createInteractionActionPlayer({",
    `${probeReporterSource(runId)}\n\nexport function createInteractionActionPlayer({`,
    "player probe reporter"
  );
  output = replaceExactlyOnce(
    output,
    "  | \"startup_first_visible_frame\"",
    `  | "${REVIEW_REASON}"\n  | "startup_first_visible_frame"`,
    "review reason"
  );
  output = replaceExactlyOnce(
    output,
    `    activeInteractionAction = null;
    restoreTemporaryPartOpacities();`,
    `    activeInteractionAction = null;
    if (action.type === "${REVIEW_ACTION_ID}") reportGreetSmallReview("restore_started", { actionType: action.type, motionPresetId: action.motionPresetId ?? null });
    restoreTemporaryPartOpacities();`,
    "restore start"
  );
  output = replaceExactlyOnce(
    output,
    `    reportTelemetry("pet_interaction_action_finished", {`,
    `    if (action.type === "${REVIEW_ACTION_ID}") reportGreetSmallReview("restore_completed", { actionType: action.type, motionPresetId: action.motionPresetId ?? null });
    reportTelemetry("pet_interaction_action_finished", {`,
    "restore completion"
  );
  let watchdogCount = 0;
  output = output.replace(/^(\s*)stopMotion\("timed_out"\);$/gmu, (_match, indent) => {
    watchdogCount += 1;
    return `${indent}if (activeAction.action.type === "${REVIEW_ACTION_ID}") reportGreetSmallReview("watchdog_fired", { actionType: activeAction.action.type });\n${indent}stopMotion("timed_out");`;
  });
  if (watchdogCount !== 2) throw new Error("expected exactly 2 watchdog fire markers");
  return output;
}

export function injectGreetNativeLifecycleProbe(source, runId = "greet-small-review-test") {
  let output = replaceExactlyOnce(
    source,
    "export async function createCubismMotionController(",
    `${probeReporterSource(runId)}\n\nexport async function createCubismMotionController(`,
    "native probe reporter"
  );
  output = replaceExactlyOnce(
    output,
    `      const buffer = await fetchMotionBuffer(resolveModelAssetUrl(preset.path));
      const controlledParameterIds = parseControlledParameterIds(buffer);`,
    `      const buffer = await fetchMotionBuffer(resolveModelAssetUrl(preset.path));
      const controlledParameterIds = parseControlledParameterIds(buffer);
      if (motionPresetId === "${REVIEW_PRESET_ID}") reportGreetSmallReview("ownership_parsed", {
        motionPresetId,
        controlledParameterCount: controlledParameterIds.size,
        controlledParameterIds: [...controlledParameterIds].sort()
      });`,
    "native ownership parse"
  );
  output = replaceExactlyOnce(
    output,
    `      const record = createPlaybackRecord(handle, motionPresetId, loadedMotion.controlledParameterIds);
      activeMotions.set(handle, record);`,
    `      const record = createPlaybackRecord(handle, motionPresetId, loadedMotion.controlledParameterIds);
      activeMotions.set(handle, record);
      if (motionPresetId === "${REVIEW_PRESET_ID}") {
        reportGreetSmallReview("queued", { motionPresetId });
        record.playback.onStateChange((state) => {
          if (state === "started") reportGreetSmallReview("started", { motionPresetId });
        });
        record.playback.onTerminal((result) => {
          reportGreetSmallReview(result.status === "completed" ? "completed" : "terminal_rejected", {
            motionPresetId,
            terminalStatus: result.status
          });
        });
      }`,
    "native lifecycle"
  );
  let stopAllCallCount = 0;
  output = output.replace(/^(\s*)manager\.stopAllMotions\(\);$/gmu, (_match, indent) => {
    stopAllCallCount += 1;
    return `${indent}reportGreetSmallReview("stop_all_motions", { callIndex: ${stopAllCallCount} });\n${indent}manager.stopAllMotions();`;
  });
  const expectedStopAllCallCount = (source.match(/manager\.stopAllMotions\(\);/gu) ?? []).length;
  if (stopAllCallCount === 0 || stopAllCallCount !== expectedStopAllCallCount) {
    throw new Error("every stopAllMotions call must be observed");
  }
  return output;
}

export function injectGreetOwnershipProbe(source, runId = "greet-small-review-test") {
  let output = replaceExactlyOnce(
    source,
    "export function updateCubismFrame(",
    `${probeReporterSource(runId)}\n\nlet greetSmallOwnershipReported = false;\n\nexport function updateCubismFrame(`,
    "frame ownership reporter"
  );
  output = replaceExactlyOnce(
    output,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);`,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);
  const greetSmallOwnedValuesBeforeLayers = !greetSmallOwnershipReported && ownedParameterIds.size > 0
    ? new Map(ownedParameterIndices.map((index) => [index, model.getParameterValueByIndex(index)] as const))
    : null;`,
    "frame ownership snapshot"
  );
  output = replaceExactlyOnce(
    output,
    `  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  model.update();`,
    `  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  if (greetSmallOwnedValuesBeforeLayers) {
    const overwrittenParameterIndices = [...greetSmallOwnedValuesBeforeLayers]
      .filter(([index, value]) => !Object.is(model.getParameterValueByIndex(index), value))
      .map(([index]) => index);
    greetSmallOwnershipReported = true;
    reportGreetSmallReview("ownership_applied", {
      controlledParameterCount: ownedParameterIds.size,
      controlledParameterIds: [...ownedParameterIds].sort(),
      controlledParameterIndexCount: ownedParameterIndices.length,
      protectedLayerValuesPreserved: overwrittenParameterIndices.length === 0,
      overwrittenParameterIndexCount: overwrittenParameterIndices.length
    });
  }
  model.update();`,
    "post-layer ownership observation"
  );
  return output;
}

function patchFile(path, transform) {
  writeFileSync(path, transform(readFileSync(path, "utf8")), "utf8");
}

function createModelFixture(sourceRoot, targetRoot) {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === "model.zip") continue;
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

export function prepareIsolatedGreetApp(fixtureRoot, runId, candidate, workspaceRoot = ROOT) {
  const sourceHashBefore = createHash("sha256").update(readFileSync(candidate.sourcePath)).digest("hex");
  mkdirSync(fixtureRoot, { recursive: true });
  for (const entry of ["dist", "public", "resources", "src"]) {
    cpSync(join(workspaceRoot, entry), join(fixtureRoot, entry), { recursive: true });
  }
  for (const file of ["package.json", "vite.config.ts", "tsconfig.base.json", "tsconfig.renderer.json"]) {
    cpSync(join(workspaceRoot, file), join(fixtureRoot, file));
  }
  symlinkSync(join(workspaceRoot, "node_modules"), join(fixtureRoot, "node_modules"), "junction");
  createModelFixture(join(workspaceRoot, "model"), join(fixtureRoot, "model-fixture"));

  const fixtureMotionPath = join(
    fixtureRoot,
    "resources",
    "models",
    "witch",
    "motions",
    "greet-small-review.motion3.json"
  );
  writeFileSync(fixtureMotionPath, candidate.sourceBytes);

  const manifestPath = join(fixtureRoot, "resources", "models", "witch", "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sourceDir = "../../../model-fixture";
  manifest.motionPresets = [{
    id: REVIEW_PRESET_ID,
    path: "motions/greet-small-review.motion3.json",
    semanticKind: "greeting",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: EXPECTED_DURATION_SECONDS,
    priority: 50,
    cooldownMs: 2_000,
    restorePolicy: "restore-current-state",
    allowedStates: ["idle"],
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  }];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  patchFile(join(fixtureRoot, "src", "shared", "pet-motion-presets.ts"), injectGreetMotionPreset);
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "interaction-actions.ts"), injectGreetReviewAction);
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "main.ts"), injectGreetReviewTrigger);
  patchFile(
    join(fixtureRoot, "src", "renderer", "pet", "interaction-action-player.ts"),
    (source) => injectGreetPlayerLifecycleProbe(source, runId)
  );
  patchFile(
    join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-motion.ts"),
    (source) => injectGreetNativeLifecycleProbe(source, runId)
  );
  patchFile(
    join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-frame-pipeline.ts"),
    (source) => injectGreetOwnershipProbe(source, runId)
  );

  const sourceHashAfter = createHash("sha256").update(readFileSync(candidate.sourcePath)).digest("hex");
  if (sourceHashBefore !== sourceHashAfter || sourceHashAfter !== EXPECTED_SHA256) {
    throw new Error("candidate-hash-changed-during-fixture-preparation");
  }
  return { fixtureMotionPath: relative(fixtureRoot, fixtureMotionPath).split(sep).join("/") };
}

function chunkItems(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => (
    items.slice(index * size, (index + 1) * size)
  ));
}

function renderContactSheet(frames, { columns, cellWidth, cellHeight }) {
  const rows = Math.ceil(frames.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 24;
    pixels[index + 1] = 24;
    pixels[index + 2] = 24;
    pixels[index + 3] = 255;
  }
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    const scale = Math.min(cellWidth / frame.width, cellHeight / frame.height);
    const targetWidth = Math.max(1, Math.floor(frame.width * scale));
    const targetHeight = Math.max(1, Math.floor(frame.height * scale));
    const cellX = frameIndex % columns * cellWidth;
    const cellY = Math.floor(frameIndex / columns) * cellHeight;
    const targetX = cellX + Math.floor((cellWidth - targetWidth) / 2);
    const targetY = cellY + Math.floor((cellHeight - targetHeight) / 2);
    for (let y = 0; y < targetHeight; y += 1) {
      const sourceY = Math.min(frame.height - 1, Math.floor(y * frame.height / targetHeight));
      for (let x = 0; x < targetWidth; x += 1) {
        const sourceX = Math.min(frame.width - 1, Math.floor(x * frame.width / targetWidth));
        const sourceOffset = (sourceY * frame.width + sourceX) * 4;
        const targetOffset = ((targetY + y) * width + targetX + x) * 4;
        frame.pixels.copy(pixels, targetOffset, sourceOffset, sourceOffset + 4);
      }
    }
  }
  return { width, height, png: encodeRgbaPng(width, height, pixels) };
}

export function writeContactSheets(runDir, frames) {
  const decodedFrames = frames.map((frame, frameNumber) => {
    const decoded = decodePng(Buffer.from(frame.data, "base64"), { maxWidth: 420, maxHeight: 600 });
    return { ...decoded, frameNumber, offsetMs: frame.offsetMs };
  });
  const sheets = [];
  const writePages = ({ kind, id, selected, pageSize, columns, cellWidth, cellHeight, range = null }) => {
    for (const [pageNumber, page] of chunkItems(selected, pageSize).entries()) {
      const rendered = renderContactSheet(page, { columns, cellWidth, cellHeight });
      const filename = kind === "overview"
        ? `contact-sheet-overview-${String(pageNumber).padStart(3, "0")}.png`
        : `contact-sheet-risk-${id}-${String(pageNumber).padStart(3, "0")}.png`;
      writeFileSync(join(runDir, filename), rendered.png);
      sheets.push({
        kind,
        ...(range ? { range } : {}),
        filename,
        width: rendered.width,
        height: rendered.height,
        frameNumbers: page.map(({ frameNumber }) => frameNumber),
        offsetsMs: page.map(({ offsetMs }) => roundEvidence(offsetMs))
      });
    }
  };

  writePages({
    kind: "overview",
    id: "all",
    selected: decodedFrames,
    pageSize: CONTACT_OVERVIEW_PAGE_SIZE,
    columns: 5,
    cellWidth: 126,
    cellHeight: 180
  });
  const riskCoverage = {};
  for (const range of CONTACT_RISK_WINDOWS) {
    const selected = decodedFrames.filter(({ offsetMs }) => offsetMs >= range.startMs && offsetMs <= range.endMs);
    riskCoverage[range.id] = selected.map(({ frameNumber }) => frameNumber);
    writePages({
      kind: "risk",
      id: range.id,
      selected,
      pageSize: CONTACT_RISK_PAGE_SIZE,
      columns: 3,
      cellWidth: 210,
      cellHeight: 300,
      range
    });
  }
  const overviewFrameNumbers = sheets
    .filter(({ kind }) => kind === "overview")
    .flatMap(({ frameNumbers }) => frameNumbers);
  const expectedFrameNumbers = decodedFrames.map(({ frameNumber }) => frameNumber);
  const coverageComplete = overviewFrameNumbers.length === expectedFrameNumbers.length &&
    overviewFrameNumbers.every((frameNumber, index) => frameNumber === expectedFrameNumbers[index]);
  const riskWindowsComplete = CONTACT_RISK_WINDOWS.every(({ id }) => riskCoverage[id].length > 0);
  const index = {
    version: 1,
    selectedFrameCount: decodedFrames.length,
    overviewFrameNumbers,
    riskCoverage,
    coverageComplete,
    riskWindowsComplete,
    passed: coverageComplete && riskWindowsComplete,
    sheets
  };
  writeFileSync(join(runDir, "contact-sheet-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1)];
}

function roundEvidence(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

export function summarizeFrameEvidence(index, {
  nativeStartedAtMs,
  completedAtMs,
  restoreCompletedAtMs,
  durationMs = EXPECTED_DURATION_MS
}) {
  const offsets = index
    .map((frame) => Number(frame.offsetMs))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const intervals = offsets.slice(1).map((offset, indexValue) => offset - offsets[indexValue]);
  const sortedIntervals = [...intervals].sort((left, right) => left - right);
  const firstOffsetMs = offsets[0] ?? null;
  const lastOffsetMs = offsets.at(-1) ?? null;
  const coveredMs = firstOffsetMs === null || lastOffsetMs === null ? 0 : lastOffsetMs - firstOffsetMs;
  const effectiveFps = coveredMs > 0 ? (offsets.length - 1) * 1_000 / coveredMs : 0;
  const completedOffsetMs = completedAtMs - nativeStartedAtMs;
  const restoreOffsetMs = restoreCompletedAtMs - nativeStartedAtMs;
  const baselineCoverageMs = firstOffsetMs === null ? 0 : Math.max(0, -firstOffsetMs);
  const restoreCoverageMs = lastOffsetMs === null ? 0 : Math.max(0, lastOffsetMs - restoreOffsetMs);
  const motionCoverageMs = firstOffsetMs === null || lastOffsetMs === null
    ? 0
    : Math.max(0, Math.min(lastOffsetMs, completedOffsetMs, durationMs) - Math.max(firstOffsetMs, 0));
  const p50IntervalMs = percentile(sortedIntervals, 0.5);
  const p95IntervalMs = percentile(sortedIntervals, 0.95);
  const maxIntervalMs = sortedIntervals.at(-1) ?? null;
  const holes = intervals
    .map((intervalMs, indexValue) => ({
      fromOffsetMs: offsets[indexValue],
      toOffsetMs: offsets[indexValue + 1],
      intervalMs
    }))
    .filter(({ intervalMs }) => intervalMs > 100);
  const validPngFrames = index.filter((frame) => frame.pngValid !== false).length;
  const visiblePngFrames = index.filter((frame) => (
    frame.pngValid !== false && (frame.nonTransparentPixels === undefined || frame.nonTransparentPixels > 1_000)
  )).length;
  const evidenceRateBlocked = effectiveFps < MIN_EVIDENCE_FPS;
  const gates = {
    baseline: baselineCoverageMs >= REQUIRED_BASELINE_MS,
    fullMotion: motionCoverageMs >= durationMs - MOTION_DURATION_TOLERANCE_MS,
    restoreTail: restoreCoverageMs >= REQUIRED_RESTORE_TAIL_MS,
    evidenceRate: !evidenceRateBlocked,
    p95Interval: p95IntervalMs !== null && p95IntervalMs <= 60,
    maxInterval: maxIntervalMs !== null && maxIntervalMs <= 100,
    noHoles: holes.length === 0,
    pngValid: index.length > 0 && validPngFrames === index.length,
    visiblePixels: index.length > 0 && visiblePngFrames === index.length
  };
  return {
    targetFps: 30,
    minimumEvidenceFps: MIN_EVIDENCE_FPS,
    frameCount: offsets.length,
    firstOffsetMs: roundEvidence(firstOffsetMs),
    lastOffsetMs: roundEvidence(lastOffsetMs),
    coveredMs: roundEvidence(coveredMs),
    baselineCoverageMs: roundEvidence(baselineCoverageMs),
    completedOffsetMs: roundEvidence(completedOffsetMs),
    motionCoverageMs: roundEvidence(motionCoverageMs),
    restoreCoverageMs: roundEvidence(restoreCoverageMs),
    effectiveFps: roundEvidence(effectiveFps),
    p50IntervalMs: roundEvidence(p50IntervalMs),
    p95IntervalMs: roundEvidence(p95IntervalMs),
    maxIntervalMs: roundEvidence(maxIntervalMs),
    holes: holes.map((hole) => ({
      fromOffsetMs: roundEvidence(hole.fromOffsetMs),
      toOffsetMs: roundEvidence(hole.toOffsetMs),
      intervalMs: roundEvidence(hole.intervalMs)
    })),
    validPngFrames,
    visiblePngFrames,
    evidenceRateBlocked,
    gates,
    passed: Object.values(gates).every(Boolean)
  };
}

export function summarizeLifecycle(events, runId) {
  const relevant = events.filter((event) => event.runId === runId);
  const requiredStages = ["queued", "started", "completed", "restore_started", "restore_completed"];
  const lifecycleEvents = relevant.filter((event) => requiredStages.includes(event.stage));
  const stages = lifecycleEvents.map((event) => event.stage);
  const counts = Object.fromEntries(requiredStages.map((stage) => [
    stage,
    lifecycleEvents.filter((event) => event.stage === stage).length
  ]));
  const forbidden = {
    watchdog: relevant.filter((event) => event.stage === "watchdog_fired").length,
    timeout: relevant.filter((event) => event.stage === "terminal_rejected" && event.terminalStatus === "timed_out").length,
    stopAllMotions: relevant.filter((event) => event.stage === "stop_all_motions").length
  };
  const startedAtMs = lifecycleEvents.find((event) => event.stage === "started")?.atMs;
  const completedAtMs = lifecycleEvents.find((event) => event.stage === "completed")?.atMs;
  const completedDurationMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
    ? completedAtMs - startedAtMs
    : null;
  const durationGate = {
    expectedMs: EXPECTED_DURATION_MS,
    toleranceMs: MOTION_DURATION_TOLERANCE_MS,
    actualMs: completedDurationMs,
    passed: completedDurationMs !== null &&
      Math.abs(completedDurationMs - EXPECTED_DURATION_MS) <= MOTION_DURATION_TOLERANCE_MS
  };
  const passed = requiredStages.every((stage) => counts[stage] === 1) &&
    stages.length === requiredStages.length && stages.every((stage, index) => stage === requiredStages[index]) &&
    Object.values(forbidden).every((count) => count === 0) && durationGate.passed;
  return {
    requiredStages,
    stages,
    counts,
    forbidden,
    durationGate,
    events: lifecycleEvents.map(({ stage, atMs }) => ({ stage, atMs })),
    passed
  };
}

export function summarizeOwnership(events, runId) {
  const expected = [...GREET_SMALL_ALLOWLIST].sort();
  const ownershipEvents = events.filter((event) => (
    event.runId === runId && ["ownership_parsed", "ownership_applied"].includes(event.stage)
  ));
  const checks = Object.fromEntries(["ownership_parsed", "ownership_applied"].map((stage) => {
    const matching = ownershipEvents.filter((event) => event.stage === stage);
    const event = matching[0];
    const ids = Array.isArray(event?.controlledParameterIds) ? [...event.controlledParameterIds].sort() : [];
    const runtimeIndicesExact = stage !== "ownership_applied" || event?.controlledParameterIndexCount === expected.length;
    const protectedLayersPreserved = stage !== "ownership_applied" ||
      event?.protectedLayerValuesPreserved === true && event?.overwrittenParameterIndexCount === 0;
    return [stage, {
      observedCount: matching.length,
      controlledParameterCount: event?.controlledParameterCount ?? null,
      controlledParameterIds: ids,
      ...(stage === "ownership_applied" ? {
        controlledParameterIndexCount: event?.controlledParameterIndexCount ?? null,
        protectedLayerValuesPreserved: event?.protectedLayerValuesPreserved === true,
        overwrittenParameterIndexCount: event?.overwrittenParameterIndexCount ?? null
      } : {}),
      exactAllowlist: matching.length === 1 && event.controlledParameterCount === expected.length &&
        ids.length === expected.length && ids.every((id, index) => id === expected[index]) &&
        runtimeIndicesExact && protectedLayersPreserved
    }];
  }));
  return {
    expectedCurveCount: expected.length,
    expectedParameterIds: expected,
    checks,
    passed: checks.ownership_parsed.exactAllowlist && checks.ownership_applied.exactAllowlist
  };
}

export function cleanupReviewArtifacts(context, retainEvidence, tmpRoot = join(ROOT, ".tmp")) {
  if (retainEvidence) {
    return { runDirRemoved: false, runParentRemoved: false, artifactsRetained: true, siblingEntries: [] };
  }
  if (
    !isPathWithin(tmpRoot, context.runParentDir) ||
    !isPathWithin(context.runParentDir, context.runDir) ||
    resolve(context.runParentDir) === resolve(context.runDir)
  ) {
    throw new Error("invalid-review-run-directory");
  }
  rmSync(context.runDir, { recursive: true, force: true });
  const siblingEntries = existsSync(context.runParentDir) ? readdirSync(context.runParentDir) : [];
  if (siblingEntries.length === 0 && existsSync(context.runParentDir)) rmdirSync(context.runParentDir);
  return {
    runDirRemoved: !existsSync(context.runDir),
    runParentRemoved: !existsSync(context.runParentDir),
    artifactsRetained: false,
    siblingEntries
  };
}

export function finalizeReviewSummary({ lifecycle, ownership, frameEvidence, capture, cleanup, error = null }) {
  const cleanupPassed = Boolean(
    cleanup?.electronStopped && cleanup?.protectedFilesRestored && cleanup?.candidateHashUnchanged &&
    cleanup?.screenshotResidue?.length === 0 && cleanup?.errors?.length === 0 &&
    (cleanup?.runDirRemoved || cleanup?.artifactsRetained)
  );
  const evidenceRateBlocked = frameEvidence?.evidenceRateBlocked === true;
  const evidencePassed = frameEvidence?.passed === true && capture?.limitReached === false &&
    capture?.contactSheets?.passed === true;
  const contractPassed = !error && lifecycle?.passed && ownership?.passed && evidencePassed && cleanupPassed;
  const status = evidenceRateBlocked
    ? "blocked"
    : contractPassed ? "evidence-ready-for-manual-review" : error ? "failed" : "blocked";
  const acceptance = evidenceRateBlocked
    ? "blocked-evidence-rate"
    : contractPassed ? "manual-visual-review-required" : error ? "runner-failed" : "required-gate-failed";
  return { ok: contractPassed, status, acceptance, cleanupPassed };
}

function readProbeEvents(pet) {
  return evaluate(pet, `globalThis.${PROBE_GLOBAL} ?? []`);
}

function waitForProbeStage(pet, stage, runId, timeoutMs, signal) {
  return waitForEvent(async () => (
    (await readProbeEvents(pet)).find((event) => event.runId === runId && event.stage === stage) ?? null
  ), { timeoutMs, intervalMs: 50, signal });
}

function publicError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: sanitizePublicText(error instanceof Error ? error.message : String(error)).slice(0, 500)
  };
}

async function cleanupStep(cleanup, label, operation) {
  try {
    Object.assign(cleanup, await operation());
  } catch (error) {
    cleanup.errors.push({ label, ...publicError(error) });
  }
}

async function main() {
  const startedAt = Date.now();
  let args;
  let candidate;
  try {
    args = parseRunnerArgs(process.argv.slice(2));
    candidate = readCandidateDraft(args.candidateDraft);
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      status: "blocked",
      acceptance: "candidate-input-rejected",
      isolatedFixture: false,
      realUiLaunchAttempted: false,
      failure: publicError(error)
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const protectedBefore = hashProtectedPaths(ROOT, GREET_SMALL_PROTECTED_PATHS);
  const context = createRealUiRunContext({
    runName: RUN_NAME,
    port: Number(process.env.P2_63C_5A_CDP_PORT || 9675),
    tmpResiduePatterns: [/^p2-63c-5a-/iu],
    screenshotPatterns: [
      /^continuous-\d{4}\.png$/iu,
      /^contact-sheet-.*\.png$/iu,
      /^p2-63c-5a-.*\.(?:png|jpg|mp4)$/iu
    ]
  });
  const fixtureRoot = join(context.runDir, "isolated-app");
  const runId = context.stamp;
  const controller = new AbortController();
  let pet = null;
  let screencastCapture = null;
  let pointerInputIsolated = false;
  let lifecycle = null;
  let ownership = null;
  let frameEvidence = null;
  let capture = null;
  let error = null;
  let selectedIndex = [];
  const cleanup = {
    electronStopped: false,
    runDirRemoved: false,
    artifactsRetained: false,
    protectedFilesRestored: false,
    candidateHashUnchanged: false,
    screenshotResidue: [],
    errors: []
  };

  try {
    await withHardTimeout(async () => {
      prepareIsolatedGreetApp(fixtureRoot, runId, candidate);
      await buildIsolatedRenderer(fixtureRoot, context);
      controller.signal.throwIfAborted();
      startIsolatedElectron(context, fixtureRoot);
      await connectToElectron(context, 40_000);
      pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
      await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
      await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
      await sleep(3_000);

      await evaluate(pet, "window.petApi?.openChat()");
      const chat = await waitForWindow(context, "renderer/chat/index.html", 20_000);
      await waitFor(chat, "Boolean(document.querySelector('#chat-page'))", { timeoutMs: 15_000 });
      await setPresenceMode(chat, "default");
      await sleep(500);

      await setPetPointerInputIsolation(pet, true);
      pointerInputIsolated = true;
      const performanceTimeOrigin = await evaluate(pet, "performance.timeOrigin");
      screencastCapture = await startScreencastCapture(pet.cdp);
      await sleep(CAPTURE_BASELINE_MS + 100);
      await waitForEvent(async () => (
        await evaluate(pet, `globalThis.${TRIGGER_GLOBAL}?.() === true`) ? true : null
      ), { timeoutMs: 3_000, intervalMs: 100, signal: controller.signal });

      const started = await waitForProbeStage(pet, "started", runId, 10_000, controller.signal);
      const completed = await waitForProbeStage(
        pet,
        "completed",
        runId,
        EXPECTED_DURATION_MS + 2_000,
        controller.signal
      );
      const restoreCompleted = await waitForProbeStage(
        pet,
        "restore_completed",
        runId,
        EXPECTED_DURATION_MS + 3_000,
        controller.signal
      );
      await waitForEvent(() => {
        const lastFrame = screencastCapture.collector.getFrames().at(-1);
        const target = (performanceTimeOrigin + restoreCompleted.atMs + CAPTURE_RESTORE_TAIL_MS) / 1_000;
        return lastFrame?.timestamp >= target ? lastFrame : null;
      }, { timeoutMs: 2_000, intervalMs: 20, signal: controller.signal });

      const captureSummary = await screencastCapture.stop();
      const selectedFrames = selectScreencastFrames({
        frames: screencastCapture.collector.getFrames(),
        performanceTimeOrigin,
        nativeStartedAtMs: started.atMs,
        restoreCompletedAtMs: restoreCompleted.atMs,
        intervalMs: TARGET_INTERVAL_MS,
        maxFrames: MAX_SELECTED_FRAMES,
        baselineMs: CAPTURE_BASELINE_MS,
        restoreTailMs: CAPTURE_RESTORE_TAIL_MS
      });
      selectedIndex = writeSelectedScreencastFrames(context.runDir, selectedFrames);
      const contactSheets = writeContactSheets(context.runDir, selectedFrames);
      const events = await readProbeEvents(pet);
      lifecycle = summarizeLifecycle(events, runId);
      ownership = summarizeOwnership(events, runId);
      frameEvidence = summarizeFrameEvidence(selectedIndex, {
        nativeStartedAtMs: started.atMs,
        completedAtMs: completed.atMs,
        restoreCompletedAtMs: restoreCompleted.atMs
      });
      capture = {
        source: "electron-desktop-pet-cdp-screencast",
        targetFps: 30,
        ...captureSummary,
        selectedFrames: selectedIndex.length,
        limitReached: captureSummary.limitReached,
        contactSheets
      };
      writeFileSync(join(context.runDir, "lifecycle.json"), `${JSON.stringify({ lifecycle, ownership }, null, 2)}\n`, "utf8");
      writeFileSync(join(context.runDir, "summary.json"), `${JSON.stringify({
        status: "pending-cleanup",
        sourceDraft: candidate.summary,
        lifecycle,
        ownership,
        frameEvidence,
        capture
      }, null, 2)}\n`, "utf8");
      await setPetPointerInputIsolation(pet, false);
      pointerInputIsolated = false;
    }, RUN_TIMEOUT_MS, controller);
  } catch (caught) {
    error = publicError(caught);
  } finally {
    await cleanupStep(cleanup, "pointer-input-isolation", async () => {
      if (!pet || !pointerInputIsolated) return {};
      await setPetPointerInputIsolation(pet, false);
      pointerInputIsolated = false;
      return {};
    });
    await cleanupStep(cleanup, "screencast-stop", async () => {
      if (!screencastCapture) return {};
      await screencastCapture.stop();
      return {};
    });
    await cleanupStep(cleanup, "electron-stop", async () => ({
      electronStopped: await stopElectronAndVerify(context)
    }));
    await cleanupStep(cleanup, "protected-paths", async () => ({
      protectedFilesRestored: protectedHashesEqual(
        protectedBefore,
        hashProtectedPaths(ROOT, GREET_SMALL_PROTECTED_PATHS),
        GREET_SMALL_PROTECTED_PATHS
      ),
      candidateHashUnchanged: createHash("sha256").update(readFileSync(candidate.sourcePath)).digest("hex") === EXPECTED_SHA256
    }));
    await cleanupStep(cleanup, "screenshot-residue", async () => ({
      screenshotResidue: findScreenshotResidue(context)
        .filter((path) => !isPathWithin(context.runParentDir, path))
        .map((path) => relative(ROOT, path).split(sep).join("/"))
    }));
    await cleanupStep(cleanup, "run-artifacts", async () => cleanupReviewArtifacts(context, args.retainEvidence));
  }

  const finalized = finalizeReviewSummary({ lifecycle, ownership, frameEvidence, capture, cleanup, error });
  const summary = {
    ...finalized,
    isolatedFixture: true,
    productionCatalogModified: false,
    sourceDraft: candidate.summary,
    trigger: { actionId: REVIEW_ACTION_ID, presetId: REVIEW_PRESET_ID, reason: REVIEW_REASON, neutralState: true },
    evidenceWindow: {
      requiredBaselineMs: REQUIRED_BASELINE_MS,
      motionDurationMs: EXPECTED_DURATION_MS,
      requiredRestoreTailMs: REQUIRED_RESTORE_TAIL_MS
    },
    lifecycle,
    ownership,
    frameEvidence,
    capture,
    cleanup,
    artifacts: cleanup.artifactsRetained ? {
      runDirectory: relative(ROOT, context.runDir).split(sep).join("/"),
      continuousPngCount: selectedIndex.length,
      frameIndex: "continuous-frame-index.json",
      contactSheetIndex: "contact-sheet-index.json",
      contactSheets: capture?.contactSheets?.sheets?.map(({ filename }) => filename) ?? [],
      lifecycle: "lifecycle.json",
      summary: "summary.json"
    } : null,
    ...(error ? { failure: error } : {}),
    durationMs: Date.now() - startedAt
  };
  if (cleanup.artifactsRetained) {
    writeFileSync(join(context.runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
