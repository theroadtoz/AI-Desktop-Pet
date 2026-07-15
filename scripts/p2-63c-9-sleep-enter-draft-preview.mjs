import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIsolatedRenderer,
  hashProtectedPaths,
  protectedHashesEqual,
  sanitizePublicText,
  setPetPointerInputIsolation,
  startIsolatedElectron,
  stopElectronAndVerify,
  validateExplicitDraftMotion,
  waitForEvent
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";
import {
  cleanupRealUiRun,
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
const DRAFT_ROOT = "C:/Users/1/AppData/Roaming/Electron/motion-drafts/vts-drafts";
const CANDIDATE_PATH = `${DRAFT_ROOT}/sleep-enter-20260715-081933-048.motion3.json`;
const CANDIDATE_NAME = "sleep-enter-20260715-081933-048.motion3.json";
const CANDIDATE_SHA256 = "8f1b0a28f35cfe12ef6eb6075ec4c545ef921842ba7ab625e04c5c95cc92b478";
const PREVIEW_ID = "sleep-enter-draft-preview";
const PROBE_GLOBAL = "__P2_63C_9_SLEEP_ENTER_EVENTS__";
const TRIGGER_GLOBAL = "__P2_63C_9_SLEEP_ENTER_TRIGGER__";
const STATE_GLOBAL = "__P2_63C_9_SLEEP_ENTER_STATE__";
const PREVIEW_DURATION_MS = 3_000;
const OWNED_PARAMETER_IDS = Object.freeze(["ParamAngleY", "ParamEyeLOpen", "ParamEyeROpen"]);
const TASK_TMP_PREFIX = "p2-63c-9-sleep-enter-draft-preview";

export const SLEEP_ENTER_PROTECTED_PATHS = Object.freeze([
  "package.json",
  "resources/models/witch/model-manifest.json",
  "src/shared/pet-motion-presets.ts",
  "src/shared/pet-motion-catalog.ts",
  "src/shared/interaction-action-catalog.ts",
  "src/renderer/pet/interaction-actions.ts",
  "src/renderer/pet/interaction-action-player.ts",
  "src/renderer/pet/main.ts",
  "src/renderer/pet/live2d/cubism-motion.ts",
  "src/renderer/pet/live2d/cubism-frame-pipeline.ts"
]);

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function sanitizeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: sanitizePublicText(error instanceof Error ? error.message : String(error)).slice(0, 300)
  };
}

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`expected exactly one ${label} marker`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

function checkWindowsReparsePath(candidatePath) {
  if (process.platform !== "win32") return;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$path = [Environment]::GetEnvironmentVariable('P2_63C_9_CANDIDATE_PATH')
while ($true) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
  $parent = [IO.Directory]::GetParent($path)
  if ($null -eq $parent) { break }
  $path = $parent.FullName
}`
  ], {
    env: { ...process.env, P2_63C_9_CANDIDATE_PATH: candidatePath },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 23) throw new Error("candidate-reparse-path-rejected");
  if (result.status !== 0) throw new Error("candidate-reparse-attribute-check-failed");
}

export function assertManagedRegularFile(candidatePath, managedRoot = DRAFT_ROOT) {
  const resolvedCandidate = resolve(candidatePath);
  const resolvedRoot = resolve(managedRoot);
  if (!isWithin(resolvedRoot, resolvedCandidate)) throw new Error("candidate-outside-managed-root");

  const pieces = resolvedCandidate.slice(resolve(resolvedCandidate).slice(0, 3).length).split(/[\\/]+/u).filter(Boolean);
  let current = resolve(resolvedCandidate).slice(0, 3);
  for (let index = 0; index < pieces.length; index += 1) {
    current = join(current, pieces[index]);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      throw new Error(index === pieces.length - 1 ? "candidate-file-missing" : "candidate-parent-missing");
    }
    if (stats.isSymbolicLink()) throw new Error("candidate-reparse-path-rejected");
    if (index < pieces.length - 1 && !stats.isDirectory()) throw new Error("candidate-parent-not-directory");
    if (index === pieces.length - 1 && !stats.isFile()) throw new Error("candidate-not-regular-file");
  }
  checkWindowsReparsePath(resolvedCandidate);

  let resolvedRealPath;
  let rootRealPath;
  try {
    resolvedRealPath = realpathSync.native(resolvedCandidate);
    rootRealPath = realpathSync.native(resolvedRoot);
  } catch {
    throw new Error("candidate-path-resolution-failed");
  }
  if (!isWithin(rootRealPath, resolvedRealPath) || resolve(resolvedRealPath).toLowerCase() !== resolvedCandidate.toLowerCase()) {
    throw new Error("candidate-reparse-path-rejected");
  }
  return resolvedCandidate;
}

export function assertPinnedCandidatePath(candidatePath = CANDIDATE_PATH) {
  const resolvedCandidate = resolve(candidatePath);
  if (resolvedCandidate !== resolve(CANDIDATE_PATH) || basename(resolvedCandidate) !== CANDIDATE_NAME) {
    throw new Error("candidate-path-not-allowed");
  }
  return assertManagedRegularFile(resolvedCandidate);
}

export function parseRunnerArgs(argv) {
  if (argv.length !== 0) throw new Error("no-cli-arguments-supported");
  return { candidatePath: CANDIDATE_PATH };
}

export function validateSleepEnterCandidate(bytes) {
  if (hashBytes(bytes) !== CANDIDATE_SHA256) throw new Error("candidate-sha256-mismatch");
  let motion;
  try {
    motion = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("candidate-invalid-json");
  }
  const modelParameters = JSON.parse(readFileSync(join(ROOT, "model", "魔女.cdi3.json"), "utf8"))
    .Parameters
    .map(({ Id }) => Id);
  const validation = validateExplicitDraftMotion(motion, modelParameters, {
    semanticAllowlist: OWNED_PARAMETER_IDS,
    variationParameterIds: OWNED_PARAMETER_IDS,
    durationSeconds: 3,
    fps: 30,
    curveCount: 3,
    segmentCount: 222,
    pointCount: 225
  });
  if (validation.status !== "validated" || validation.motion.Meta.Loop !== false) {
    throw new Error(validation.blockers?.[0] ?? "candidate-motion-blocked");
  }
  return {
    bytes,
    motion: validation.motion,
    summary: {
      safeSummaryOnly: true,
      basename: CANDIDATE_NAME,
      sha256: CANDIDATE_SHA256,
      durationSeconds: 3,
      fps: 30,
      loop: false,
      curveCount: 3,
      segmentCount: 222,
      pointCount: 225,
      allowlist: [...OWNED_PARAMETER_IDS]
    }
  };
}

export function readSleepEnterCandidate(candidatePath = CANDIDATE_PATH) {
  const pinnedPath = assertPinnedCandidatePath(candidatePath);
  return validateSleepEnterCandidate(readFileSync(pinnedPath));
}

function hashDirectory(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = join(directory, entry.name);
      const relativePath = relative(root, fullPath).split(sep).join("/");
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        entries.push([relativePath, `sha256:${hashBytes(readFileSync(fullPath))}`]);
      } else {
        throw new Error("model-tree-non-regular-entry");
      }
    }
  };
  walk(root);
  return Object.fromEntries(entries);
}

function directoryHashesEqual(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys)
    && leftKeys.every((key) => left[key] === right[key]);
}

function copyModelTree(sourceRoot, targetRoot) {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      copyModelTree(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) throw new Error("model-tree-non-regular-entry");
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
  mkdirSync(targetRoot, { recursive: true });
}

function patchFile(path, transform) {
  writeFileSync(path, transform(readFileSync(path, "utf8")), "utf8");
}

function probeReporterSource(runId) {
  return `function reportSleepEnterPreview(stage: string, detail: Record<string, unknown> = {}): void {
  const target = globalThis as typeof globalThis & { ${PROBE_GLOBAL}?: Array<Record<string, unknown>> };
  (target.${PROBE_GLOBAL} ??= []).push({ stage, atMs: Math.round(performance.now()), runId: ${JSON.stringify(runId)}, ...detail });
}`;
}

export function injectSleepEnterPreset(source) {
  const marker = "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([";
  return replaceExactlyOnce(source, marker, `${marker}
  {
    id: "${PREVIEW_ID}",
    path: "motions/sleep-enter-draft-preview.motion3.json",
    semanticKind: "sleep",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: 3,
    priority: 50,
    cooldownMs: 2_000,
    restorePolicy: "restore-current-state",
    allowedStates: ["sleep"],
    allowedPresenceModes: ["sleep"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  },`, "sleep preview preset");
}

export function injectSleepEnterAction(source) {
  const withType = replaceExactlyOnce(
    source,
    "export const PET_INTERACTION_ACTION_TYPES = [",
    `export const PET_INTERACTION_ACTION_TYPES = [
  "${PREVIEW_ID}",`,
    "sleep preview action type"
  );
  return replaceExactlyOnce(
    withType,
    "export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [",
    `export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [
  {
    type: "${PREVIEW_ID}",
    weight: 0,
    durationMs: ${PREVIEW_DURATION_MS},
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    motionPresetId: "${PREVIEW_ID}"
  },`,
    "sleep preview action"
  );
}

export function injectSleepEnterTrigger(source, runId) {
  const marker = `
});

function applyBasePresentation(`;
  const replacement = `
});

${probeReporterSource(runId)}
type SleepEnterPreviewGlobal = typeof globalThis & {
  ${TRIGGER_GLOBAL}?: () => boolean;
  ${STATE_GLOBAL}?: () => { dialogueModeId: string; presenceModeId: string; live2DReady: boolean };
};
globalThis.addEventListener("error", () => reportSleepEnterPreview("window_error"));
globalThis.addEventListener("unhandledrejection", () => reportSleepEnterPreview("unhandled_rejection"));
(globalThis as SleepEnterPreviewGlobal).${STATE_GLOBAL} = () => ({
  dialogueModeId: currentDialogueModeId,
  presenceModeId: currentPresenceModeId,
  live2DReady: Boolean(live2DModel)
});
(globalThis as SleepEnterPreviewGlobal).${TRIGGER_GLOBAL} = () => {
  if (!live2DModel || currentDialogueModeId !== "default" || currentPresenceModeId !== "sleep") return false;
  return interactionActionPlayer.playAction(
    getPetInteractionAction("${PREVIEW_ID}"),
    "sleep_enter_draft_preview",
    { stateId: "sleep", modeId: "default", presenceModeId: "sleep", candidateActionTypes: ["${PREVIEW_ID}"] }
  );
};

function applyBasePresentation(`;
  return replaceExactlyOnce(source, marker, replacement, "sleep preview trigger");
}

export function injectSleepEnterPlayerProbes(source, runId) {
  let output = replaceExactlyOnce(
    source,
    "export function createInteractionActionPlayer({",
    `${probeReporterSource(runId)}

export function createInteractionActionPlayer({`,
    "sleep preview player reporter"
  );
  output = replaceExactlyOnce(
    output,
    "  | \"startup_first_visible_frame\"",
    `  | "sleep_enter_draft_preview"
  | "startup_first_visible_frame"`,
    "sleep preview reason"
  );
  output = replaceExactlyOnce(
    output,
    "    const skipReason = getCooldownSkipReason(",
    "    let skipReason = getCooldownSkipReason(",
    "sleep preview cooldown declaration"
  );
  output = replaceExactlyOnce(
    output,
    `    if (skipReason) {
      reportTelemetry("pet_interaction_action_skipped", {`,
    `    if (action.type === "${PREVIEW_ID}") skipReason = null;
    if (skipReason) {
      reportTelemetry("pet_interaction_action_skipped", {`,
    "sleep preview cooldown bypass"
  );
  output = replaceExactlyOnce(
    output,
    `    activeInteractionAction = null;
    restoreTemporaryPartOpacities();`,
    `    activeInteractionAction = null;
    if (action.type === "${PREVIEW_ID}") reportSleepEnterPreview("restore_started");
    restoreTemporaryPartOpacities();`,
    "sleep preview restore start"
  );
  output = replaceExactlyOnce(
    output,
    `    reportTelemetry("pet_interaction_action_finished", {`,
    `    if (action.type === "${PREVIEW_ID}") reportSleepEnterPreview("restore_completed");
    reportTelemetry("pet_interaction_action_finished", {`,
    "sleep preview restore completion"
  );
  let watchdogCount = 0;
  output = output.replace(/^(\s*)stopMotion\("timed_out"\);$/gmu, (_match, indent) => {
    watchdogCount += 1;
    return `${indent}if (activeAction.action.type === "${PREVIEW_ID}") reportSleepEnterPreview("watchdog_fired");\n${indent}stopMotion("timed_out");`;
  });
  if (watchdogCount !== 2) throw new Error("sleep-preview-watchdog-marker-mismatch");
  return output;
}

export function injectSleepEnterMotionProbes(source, runId) {
  let output = replaceExactlyOnce(
    source,
    "export async function createCubismMotionController(",
    `${probeReporterSource(runId)}

export async function createCubismMotionController(`,
    "sleep preview motion reporter"
  );
  output = replaceExactlyOnce(
    output,
    `      const controlledParameterIds = parseControlledParameterIds(buffer);`,
    `      const controlledParameterIds = parseControlledParameterIds(buffer);
      if (motionPresetId === "${PREVIEW_ID}") reportSleepEnterPreview("motion_loaded", {
        controlledParameterCount: controlledParameterIds.size,
        controlledParameterIds: [...controlledParameterIds].sort()
      });`,
    "sleep preview ownership parse"
  );
  output = replaceExactlyOnce(
    output,
    `      activeMotions.set(handle, record);`,
    `      activeMotions.set(handle, record);
      if (motionPresetId === "${PREVIEW_ID}") {
        reportSleepEnterPreview("queued");
        record.playback.onStateChange((state) => {
          if (state === "started") reportSleepEnterPreview("started");
        });
        record.playback.onTerminal((result) => {
          reportSleepEnterPreview(result.status === "completed" ? "completed" : "terminal_rejected", {
            terminalStatus: result.status
          });
        });
      }`,
    "sleep preview native lifecycle"
  );
  let stopAllCount = 0;
  output = output.replace(/^(\s*)manager\.stopAllMotions\(\);$/gmu, (_match, indent) => {
    stopAllCount += 1;
    return `${indent}reportSleepEnterPreview("stop_all_motions");\n${indent}manager.stopAllMotions();`;
  });
  if (stopAllCount === 0) throw new Error("sleep-preview-stop-all-marker-missing");
  return output;
}

export function injectSleepEnterFrameProbes(source, runId) {
  let output = replaceExactlyOnce(
    source,
    "export function updateCubismFrame(",
    `${probeReporterSource(runId)}

let sleepPreviewOwnershipObserved = false;
let sleepPreviewOwnershipReleased = false;

export function updateCubismFrame(`,
    "sleep preview frame reporter"
  );
  output = replaceExactlyOnce(
    output,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);`,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);
  const sleepPreviewValuesBeforeLayers = !sleepPreviewOwnershipObserved && ownedParameterIds.size > 0
    ? new Map(ownedParameterIndices.map((index) => [index, model.getParameterValueByIndex(index)] as const))
    : null;`,
    "sleep preview frame ownership snapshot"
  );
  output = replaceExactlyOnce(
    output,
    `  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  model.update();`,
    `  applyProtectedLayer(model, ownedParameterIndices, deltaSeconds, layers.applyBreath);
  if (sleepPreviewValuesBeforeLayers) {
    const overwrittenParameterIndices = [...sleepPreviewValuesBeforeLayers]
      .filter(([index, value]) => !Object.is(model.getParameterValueByIndex(index), value))
      .map(([index]) => index);
    sleepPreviewOwnershipObserved = true;
    reportSleepEnterPreview("ownership_applied", {
      controlledParameterCount: ownedParameterIds.size,
      controlledParameterIds: [...ownedParameterIds].sort(),
      protectedLayerValuesPreserved: overwrittenParameterIndices.length === 0,
      overwrittenParameterIndexCount: overwrittenParameterIndices.length
    });
  }
  if (sleepPreviewOwnershipObserved && !sleepPreviewOwnershipReleased && ownedParameterIds.size === 0) {
    sleepPreviewOwnershipReleased = true;
    reportSleepEnterPreview("ownership_released", { controlledParameterCount: 0 });
  }
  model.update();`,
    "sleep preview frame ownership observation"
  );
  return output;
}

function assertFixturePath(fixtureRoot) {
  const temporaryRoot = join(ROOT, ".tmp", TASK_TMP_PREFIX);
  mkdirSync(temporaryRoot, { recursive: true });
  const resolvedFixtureRoot = resolve(fixtureRoot);
  const resolvedTemporaryRoot = realpathSync.native(temporaryRoot);
  if (!isWithin(resolvedTemporaryRoot, resolvedFixtureRoot)) throw new Error("fixture-outside-task-tmp");
  checkWindowsReparsePath(resolvedTemporaryRoot);
  if (existsSync(resolvedFixtureRoot)) throw new Error("fixture-path-must-be-absent");
}

export function prepareIsolatedSleepEnterApp(fixtureRoot, runId, candidate, workspaceRoot = ROOT) {
  assertFixturePath(fixtureRoot);
  const candidateHashBefore = hashBytes(readFileSync(CANDIDATE_PATH));
  if (candidateHashBefore !== CANDIDATE_SHA256) throw new Error("candidate-hash-changed-before-fixture");

  mkdirSync(fixtureRoot, { recursive: true });
  for (const entry of ["dist", "public", "resources", "src"]) {
    cpSync(join(workspaceRoot, entry), join(fixtureRoot, entry), { recursive: true });
  }
  for (const file of ["package.json", "vite.config.ts", "tsconfig.base.json", "tsconfig.renderer.json"]) {
    copyFileSync(join(workspaceRoot, file), join(fixtureRoot, file));
  }
  symlinkSync(join(workspaceRoot, "node_modules"), join(fixtureRoot, "node_modules"), "junction");
  const sourceModelRoot = join(workspaceRoot, "model");
  const fixtureModelRoot = join(fixtureRoot, "model-fixture");
  copyModelTree(sourceModelRoot, fixtureModelRoot);
  if (!directoryHashesEqual(hashDirectory(sourceModelRoot), hashDirectory(fixtureModelRoot))) {
    throw new Error("model-fixture-hash-mismatch");
  }

  const fixtureMotionPath = join(
    fixtureRoot,
    "resources",
    "models",
    "witch",
    "motions",
    "sleep-enter-draft-preview.motion3.json"
  );
  writeFileSync(fixtureMotionPath, candidate.bytes);

  const manifestPath = join(fixtureRoot, "resources", "models", "witch", "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sourceDir = "../../../model-fixture";
  manifest.motionPresets = [{
    id: PREVIEW_ID,
    path: "motions/sleep-enter-draft-preview.motion3.json",
    semanticKind: "sleep",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: 3,
    priority: 50,
    cooldownMs: 2_000,
    restorePolicy: "restore-current-state",
    allowedStates: ["sleep"],
    allowedPresenceModes: ["sleep"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  }];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  patchFile(join(fixtureRoot, "src", "shared", "pet-motion-presets.ts"), injectSleepEnterPreset);
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "interaction-actions.ts"), injectSleepEnterAction);
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "main.ts"), (source) => injectSleepEnterTrigger(source, runId));
  patchFile(
    join(fixtureRoot, "src", "renderer", "pet", "interaction-action-player.ts"),
    (source) => injectSleepEnterPlayerProbes(source, runId)
  );
  patchFile(
    join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-motion.ts"),
    (source) => injectSleepEnterMotionProbes(source, runId)
  );
  patchFile(
    join(fixtureRoot, "src", "renderer", "pet", "live2d", "cubism-frame-pipeline.ts"),
    (source) => injectSleepEnterFrameProbes(source, runId)
  );

  if (hashBytes(readFileSync(CANDIDATE_PATH)) !== candidateHashBefore) {
    throw new Error("candidate-hash-changed-during-fixture-preparation");
  }
  return { fixtureMotionPath: relative(fixtureRoot, fixtureMotionPath).split(sep).join("/") };
}

export function summarizeLifecycle(events, runId) {
  const matchingEvents = events.filter((event) => event.runId === runId);
  const requiredStages = [
    "motion_loaded",
    "queued",
    "started",
    "ownership_applied",
    "completed",
    "restore_started",
    "restore_completed",
    "ownership_released"
  ];
  const stages = matchingEvents.map(({ stage }) => stage).filter((stage) => requiredStages.includes(stage));
  const loaded = matchingEvents.find(({ stage }) => stage === "motion_loaded");
  const applied = matchingEvents.find(({ stage }) => stage === "ownership_applied");
  const released = matchingEvents.find(({ stage }) => stage === "ownership_released");
  const forbiddenStageCount = matchingEvents.filter(({ stage, terminalStatus }) => (
    stage === "watchdog_fired" || stage === "stop_all_motions" || stage === "window_error"
      || stage === "unhandled_rejection" || terminalStatus === "timed_out"
  )).length;
  let priorStageIndex = -1;
  const lifecyclePassed = requiredStages.every((stage) => {
    const nextStageIndex = stages.indexOf(stage, priorStageIndex + 1);
    priorStageIndex = nextStageIndex;
    return nextStageIndex >= 0;
  });
  return {
    stages,
    ownership: {
      loadedCount: loaded?.controlledParameterCount ?? null,
      loadedIds: loaded?.controlledParameterIds ?? [],
      protectedLayerValuesPreserved: applied?.protectedLayerValuesPreserved ?? false,
      overwrittenParameterIndexCount: applied?.overwrittenParameterIndexCount ?? null,
      releasedCount: released?.controlledParameterCount ?? null
    },
    forbiddenStageCount,
    passed: lifecyclePassed
      && loaded?.controlledParameterCount === OWNED_PARAMETER_IDS.length
      && JSON.stringify(loaded.controlledParameterIds) === JSON.stringify([...OWNED_PARAMETER_IDS].sort())
      && applied?.protectedLayerValuesPreserved === true
      && applied?.overwrittenParameterIndexCount === 0
      && released?.controlledParameterCount === 0
      && forbiddenStageCount === 0
  };
}

function abortIfNeeded(signal) {
  signal.throwIfAborted();
}

function terminateChildTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  child.kill();
}

export async function runWithAbort(operation, timeoutMs, controller, context) {
  let timeoutId;
  let timedOut = false;
  const operationPromise = Promise.resolve().then(operation);
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      const error = new Error("runner-hard-timeout");
      controller.abort(error);
      terminateChildTree(context.buildChild);
      terminateChildTree(context.child);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    if (timedOut) {
      void operationPromise.catch(() => undefined);
    }
  }
}

async function stopBuildChild(context) {
  const child = context.buildChild;
  if (!child || child.exitCode !== null) return true;
  const exited = new Promise((resolveExit) => child.once("exit", () => resolveExit(true)));
  terminateChildTree(child);
  return await Promise.race([exited, sleep(4_000).then(() => false)]);
}

async function waitForStage(page, stage, runId, signal) {
  return waitForEvent(
    async () => (await evaluate(page, `globalThis.${PROBE_GLOBAL} ?? []`))
      .find((event) => event.runId === runId && event.stage === stage) ?? null,
    { timeoutMs: 10_000, intervalMs: 50, signal }
  );
}

async function requireStage(page, stage, runId, signal) {
  const event = await waitForStage(page, stage, runId, signal);
  if (!event) throw new Error(`probe-stage-timeout:${stage}`);
  return event;
}

async function runPreview(candidate, context, controller) {
  const signal = controller.signal;
  const fixtureRoot = join(context.runDir, "isolated-app");
  abortIfNeeded(signal);
  prepareIsolatedSleepEnterApp(fixtureRoot, context.stamp, candidate);
  abortIfNeeded(signal);
  await buildIsolatedRenderer(fixtureRoot, context);
  abortIfNeeded(signal);
  startIsolatedElectron(context, fixtureRoot);
  abortIfNeeded(signal);
  await connectToElectron(context, 40_000);
  abortIfNeeded(signal);
  const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
  abortIfNeeded(signal);
  await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
  await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
  abortIfNeeded(signal);
  abortIfNeeded(signal);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html", 20_000);
  abortIfNeeded(signal);
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))", { timeoutMs: 15_000 });
  await setPresenceMode(chat, "sleep");
  const stateReady = await waitForEvent(
    async () => {
      const state = await evaluate(pet, `globalThis.${STATE_GLOBAL}?.()`);
      return state?.dialogueModeId === "default" && state?.presenceModeId === "sleep" && state?.live2DReady === true
        ? state
        : null;
    },
    { timeoutMs: 10_000, intervalMs: 50, signal }
  );
  if (!stateReady) throw new Error("preview-state-readiness-timeout");
  await sleep(250);
  abortIfNeeded(signal);
  await setPetPointerInputIsolation(pet, true);
  await waitFor(pet, `typeof globalThis.${TRIGGER_GLOBAL} === "function"`, { timeoutMs: 10_000 });
  const triggered = await evaluate(pet, `globalThis.${TRIGGER_GLOBAL}()`);
  if (triggered !== true) throw new Error("preview-trigger-rejected");

  for (const stage of ["motion_loaded", "queued", "started", "ownership_applied", "completed", "restore_started", "restore_completed", "ownership_released"]) {
    await requireStage(pet, stage, context.stamp, signal);
  }
  await sleep(250);
  abortIfNeeded(signal);
  const lifecycle = summarizeLifecycle(await evaluate(pet, `globalThis.${PROBE_GLOBAL} ?? []`), context.stamp);
  return { pet, lifecycle };
}

async function main() {
  let candidate;
  try {
    parseRunnerArgs(process.argv.slice(2));
    candidate = readSleepEnterCandidate();
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: "blocked", failure: sanitizeError(error) }, null, 2));
    process.exitCode = 1;
    return;
  }

  const productionHashesBefore = hashProtectedPaths(ROOT, SLEEP_ENTER_PROTECTED_PATHS);
  const modelHashesBefore = hashDirectory(join(ROOT, "model"));
  const context = createRealUiRunContext({
    runName: TASK_TMP_PREFIX,
    port: Number(process.env.P2_63C_9_CDP_PORT ?? 9689),
    screenshotPatterns: [/^p2-63c-9-.*\.(png|jpg)$/iu],
    tmpResiduePatterns: [/^p2-63c-9-sleep-enter-draft-preview$/iu]
  });
  const controller = new AbortController();
  let preview = null;
  let failure = null;
  try {
    preview = await runWithAbort(() => runPreview(candidate, context, controller), 90_000, controller, context);
    if (!preview.lifecycle.passed) {
      failure = { name: "Error", message: "lifecycle-or-ownership-gate-failed" };
    }
  } catch (error) {
    failure = sanitizeError(error);
  } finally {
    if (preview?.pet) {
      try {
        await setPetPointerInputIsolation(preview.pet, false);
      } catch {
        // Teardown is still required if the renderer has already closed.
      }
    }
  }

  const electronStopped = await stopElectronAndVerify(context).catch(() => false);
  const buildStopped = await stopBuildChild(context);
  const productionUnchanged = protectedHashesEqual(
    productionHashesBefore,
    hashProtectedPaths(ROOT, SLEEP_ENTER_PROTECTED_PATHS),
    SLEEP_ENTER_PROTECTED_PATHS
  );
  const modelUnchanged = directoryHashesEqual(modelHashesBefore, hashDirectory(join(ROOT, "model")));
  const candidateUnchanged = hashBytes(readFileSync(CANDIDATE_PATH)) === CANDIDATE_SHA256;
  cleanupRealUiRun(context);
  const residue = findScreenshotResidue(context);
  const cleanup = {
    electronStopped,
    buildStopped,
    runParentRemoved: !existsSync(context.runParentDir),
    protectedPathsUnchanged: productionUnchanged,
    modelTreeUnchanged: modelUnchanged,
    candidateUnchanged,
    screenshotResidueCount: residue.length
  };
  const ok = !failure && preview?.lifecycle?.passed && Object.values(cleanup).every((value) => value === true || value === 0);
  console.log(JSON.stringify({
    ok,
    status: ok ? "preview-complete" : "failed",
    candidate: candidate.summary,
    lifecycle: preview?.lifecycle ?? null,
    cleanup,
    ...(failure ? { failure } : {})
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
