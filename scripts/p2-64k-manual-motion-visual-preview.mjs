import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startIsolatedElectron,
  stopElectronAndVerify
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";
import {
  connectToElectron,
  evaluate,
  sleep,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { parseMotion3Segments } from "./support/motion3-canonicalizer.mts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-64k-manual-motion-visual-preview";
const TRIGGER_GLOBAL = "__P2_64K_MANUAL_MOTION_VISUAL_PREVIEW_TRIGGER__";
const PREVIEW_STATUS_GLOBAL = "__P2_64K_MANUAL_MOTION_VISUAL_PREVIEW_STATUS__";
const PREVIEW_STATUS_GETTER = "__P2_64K_MANUAL_MOTION_VISUAL_PREVIEW_STATUS_GETTER__";
const PREVIEW_REASON = "p2_64k_manual_motion_visual_preview";
const REPLAY_GAP_MS = 1_000;
const PREVIEW_PROBE_EPSILON = 0.0001;
const SAFE_CUBISM_PARAMETER_ID = /^[A-Za-z][A-Za-z0-9_]{0,127}$/u;

export const P2_64K_DRAFT_ROOT = "C:/Users/1/AppData/Roaming/Electron/motion-drafts/vts-drafts";
export const P2_64J_MOTION_PROFILES = Object.freeze([
  { id: "listen-soft", durationSeconds: 2.4 },
  { id: "think-soft", durationSeconds: 2.8 },
  { id: "quiet-acknowledge", durationSeconds: 2.2 },
  { id: "focus-settle", durationSeconds: 2.8 },
  { id: "curious-peek", durationSeconds: 2.6 },
  { id: "look-away-soft", durationSeconds: 2.2 },
  { id: "sleepy-settle", durationSeconds: 2.8 },
  { id: "joy-bright", durationSeconds: 3 },
  { id: "surprised-big", durationSeconds: 2.6 },
  { id: "flustered-big", durationSeconds: 4.2 },
  { id: "serious-focus", durationSeconds: 2.8 },
  { id: "concern-soft", durationSeconds: 2.8 },
  { id: "playful-protest", durationSeconds: 2.4 }
]);

export const P2_64J_PROFILE_IDS = Object.freeze(P2_64J_MOTION_PROFILES.map(({ id }) => id));

export const P2_64Z_MOTION_PROFILES = Object.freeze([
  { id: "head-pat-linger", label: "摸头后安心回应", durationSeconds: 6.4 },
  { id: "body-attention-turn", label: "身体点击后认真看向你", durationSeconds: 6.2 },
  { id: "dialogue-open-welcome", label: "打开对话时迎接", durationSeconds: 6.4 },
  { id: "reply-warm-settle", label: "回复后的温和收束", durationSeconds: 6.2 },
  { id: "music-listen-sway", label: "听见背景音乐的轻摆", durationSeconds: 8.4 },
  { id: "game-presence-glance", label: "察觉游戏运行后的陪伴注视", durationSeconds: 7.2 },
  { id: "search-note-settle", label: "找到资料后的整理回应", durationSeconds: 6.4 },
  { id: "return-from-idle", label: "久未互动后的重新见面", durationSeconds: 6.6 },
  { id: "evening-window-glance", label: "夜间安静远望", durationSeconds: 7.8 },
  { id: "long-work-recovery", label: "长时间工作后的恢复安顿", durationSeconds: 7.6 }
]);

export const P2_64Z_PROFILE_IDS = Object.freeze(P2_64Z_MOTION_PROFILES.map(({ id }) => id));
export const P2_64K_MOTION_PROFILES = Object.freeze([
  ...P2_64J_MOTION_PROFILES,
  ...P2_64Z_MOTION_PROFILES
]);
export const P2_64K_PROFILE_IDS = Object.freeze(P2_64K_MOTION_PROFILES.map(({ id }) => id));

function isWithin(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function publicError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: String(error instanceof Error ? error.message : error).slice(0, 300)
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function extractMotion3CurveProbeSummary(curveSegments, durationSeconds) {
  if (!Array.isArray(curveSegments) || !finiteNumber(durationSeconds) || durationSeconds <= 0) return null;
  if (curveSegments.length < 5 || !curveSegments.every(finiteNumber)) return null;

  const values = [];
  const summary = parseMotion3Segments(curveSegments, durationSeconds);
  if (!summary.validEncoding || !summary.validTime) return null;

  const duration = Math.max(0, durationSeconds);
  let cursor = 0;
  let previousTime = curveSegments[cursor];
  if (previousTime < 0 || previousTime > duration) return null;
  values.push(curveSegments[cursor + 1]);
  let hasContinuousSegment = false;

  cursor = 2;
  while (cursor < curveSegments.length) {
    const segmentType = curveSegments[cursor];
    const segmentLength = segmentType === 0 ? 3 : segmentType === 1 ? 7 : segmentType === 2 ? 3 : segmentType === 3 ? 3 : undefined;
    if (!Number.isInteger(segmentType) || segmentLength === undefined || cursor + segmentLength > curveSegments.length) {
      return null;
    }
    if (segmentType === 0 || segmentType === 1) hasContinuousSegment = true;
    for (let pointOffset = 1; pointOffset < segmentLength; pointOffset += 2) {
      const currentTime = curveSegments[cursor + pointOffset];
      const currentValue = curveSegments[cursor + pointOffset + 1];
      if (currentTime < previousTime || currentTime < 0 || currentTime > duration || !finiteNumber(currentValue)) {
        return null;
      }
      previousTime = currentTime;
      values.push(currentValue);
    }
    cursor += segmentLength;
  }

  return cursor === curveSegments.length ? { values, hasContinuousSegment } : null;
}

function selectFirstVisibleProbeParameterId(candidateBytes, fallbackDurationSeconds) {
  let motion;
  try {
    motion = JSON.parse(candidateBytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!motion || typeof motion !== "object" || !Array.isArray(motion.Curves)) return null;
  const durationSeconds = finiteNumber(motion?.Meta?.Duration) ? motion.Meta.Duration : fallbackDurationSeconds;

  for (const curve of motion.Curves) {
    if (!curve || typeof curve !== "object") continue;
    if (curve.Target !== "Parameter" || typeof curve.Id !== "string" || !SAFE_CUBISM_PARAMETER_ID.test(curve.Id)) continue;
    const probeSummary = extractMotion3CurveProbeSummary(curve.Segments, durationSeconds);
    if (!probeSummary?.hasContinuousSegment || probeSummary.values.length < 2) continue;
    const { values } = probeSummary;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (Number.isFinite(min) && Number.isFinite(max) && max - min > PREVIEW_PROBE_EPSILON) {
      return curve.Id;
    }
  }

  return null;
}

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`expected exactly one ${label} marker`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

function checkWindowsReparsePath(path, rejectionError, checkError) {
  if (process.platform !== "win32") return;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$path = [Environment]::GetEnvironmentVariable('P2_64K_PATH')
while ($true) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
  $parent = [IO.Directory]::GetParent($path)
  if ($null -eq $parent) { break }
  $path = $parent.FullName
}`
  ], {
    env: { ...process.env, P2_64K_PATH: path },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 23) throw new Error(rejectionError);
  if (result.status !== 0) throw new Error(checkError);
}

function assertNoReparseComponents(candidatePath) {
  const resolvedPath = resolve(candidatePath);
  const parsed = parse(resolvedPath);
  const components = resolvedPath.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      throw new Error(index === components.length - 1 ? "candidate-file-missing" : "candidate-parent-missing");
    }
    if (stats.isSymbolicLink()) throw new Error("candidate-reparse-path-rejected");
    if (index < components.length - 1 && !stats.isDirectory()) throw new Error("candidate-parent-not-directory");
    if (index === components.length - 1 && !stats.isFile()) throw new Error("candidate-not-regular-file");
  }
  checkWindowsReparsePath(
    resolvedPath,
    "candidate-reparse-path-rejected",
    "candidate-reparse-attribute-check-failed"
  );
}

function assertRegularDirectory(path, reparseError, invalidError) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(invalidError);
  }
  if (stats.isSymbolicLink()) throw new Error(reparseError);
  if (!stats.isDirectory()) throw new Error(invalidError);
  checkWindowsReparsePath(path, reparseError, `${invalidError}-reparse-attribute-check-failed`);
}

function ensureRegularDirectory(path, reparseError, invalidError) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      mkdirSync(path);
    } else {
      throw new Error(invalidError);
    }
  }
  assertRegularDirectory(path, reparseError, invalidError);
}

function sameResolvedPath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isWindowsDirectoryReparsePoint(path, stats) {
  if (process.platform !== "win32" || !stats.isDirectory()) return false;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$item = Get-Item -LiteralPath ([Environment]::GetEnvironmentVariable('P2_64K_PATH')) -Force -ErrorAction Stop\nif (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }"
  ], {
    env: { ...process.env, P2_64K_PATH: path },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 23) return true;
  if (result.status !== 0) throw new Error("preview-reparse-attribute-check-failed");
  return false;
}

export function parseRunnerArgs(argv) {
  let profile = null;
  let candidateDraft = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile") {
      if (profile !== null || index + 1 >= argv.length) throw new Error("invalid-profile-argument");
      profile = argv[++index];
      continue;
    }
    if (argument === "--candidate-draft") {
      if (candidateDraft !== null || index + 1 >= argv.length) throw new Error("invalid-candidate-draft-argument");
      candidateDraft = argv[++index];
      continue;
    }
    throw new Error("invalid-cli-arguments");
  }
  if (!P2_64K_PROFILE_IDS.includes(profile)) throw new Error("p2-64j-profile-not-allowed");
  if (typeof candidateDraft !== "string" || candidateDraft.length === 0) throw new Error("candidate-draft-required");
  if (!isAbsolute(candidateDraft)) throw new Error("candidate-draft-must-be-absolute");
  return { profile, candidateDraft: resolve(candidateDraft) };
}

export function readVisualOnlyCandidate({ profile, candidateDraft }, draftRoot = P2_64K_DRAFT_ROOT) {
  const profileContract = P2_64K_MOTION_PROFILES.find((candidate) => candidate.id === profile);
  if (!profileContract) throw new Error("p2-64j-profile-not-allowed");
  if (typeof candidateDraft !== "string" || !isAbsolute(candidateDraft)) {
    throw new Error("candidate-draft-must-be-absolute");
  }

  const root = resolve(draftRoot);
  const candidatePath = resolve(candidateDraft);
  if (!isWithin(root, candidatePath)) throw new Error("candidate-outside-managed-root");
  const candidateName = basename(candidatePath);
  if (!candidateName.startsWith(`${profile}-`) || !candidateName.endsWith(".motion3.json")) {
    throw new Error("candidate-filename-profile-mismatch");
  }
  assertNoReparseComponents(candidatePath);

  let realRoot;
  let realCandidate;
  try {
    realRoot = realpathSync.native(root);
    realCandidate = realpathSync.native(candidatePath);
  } catch {
    throw new Error("candidate-path-resolution-failed");
  }
  if (!isWithin(realRoot, realCandidate) || !sameResolvedPath(realCandidate, candidatePath)) {
    throw new Error("candidate-reparse-path-rejected");
  }

  const probeParameterId = selectFirstVisibleProbeParameterId(readFileSync(candidatePath), profileContract.durationSeconds);
  if (!probeParameterId) {
    throw new Error("candidate-motion-has-no-observable-curve");
  }

  return {
    sourcePath: candidatePath,
    bytes: readFileSync(candidatePath),
    profile,
    durationSeconds: profileContract.durationSeconds,
    durationMs: Math.round(profileContract.durationSeconds * 1_000),
    probeParameterId,
    summary: {
      visualOnly: true,
      profile,
      basename: candidateName,
      playbackDurationSeconds: profileContract.durationSeconds
    }
  };
}

function previewConfig(candidate) {
  const id = `p2-64k-manual-preview-${candidate.profile}`;
  return {
    id,
    motionPath: `motions/${id}.motion3.json`,
    durationSeconds: candidate.durationSeconds,
    durationMs: candidate.durationMs,
    probeParameterId: candidate.probeParameterId
  };
}

export function injectManualPreviewPreset(source, config) {
  const marker = "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = APPROVED_MOTION_PRESETS;";
  return replaceExactlyOnce(source, marker, `export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([
  {
    id: "${config.id}",
    path: "${config.motionPath}",
    semanticKind: "reaction",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: ${config.durationSeconds},
    priority: 50,
    cooldownMs: 0,
    restorePolicy: "restore-current-state",
    allowedStates: ["idle"],
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  },
  ...APPROVED_MOTION_PRESETS
]);`, "manual preview motion preset");
}

export function injectManualPreviewAction(source, config) {
  const withType = replaceExactlyOnce(
    source,
    "export const PET_INTERACTION_ACTION_TYPES = [",
    `export const PET_INTERACTION_ACTION_TYPES = [\n  "${config.id}",`,
    "manual preview action type"
  );
  return replaceExactlyOnce(
    withType,
    "export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [",
    `export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [
  {
    type: "${config.id}",
    weight: 0,
    durationMs: ${config.durationMs},
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    motionPresetId: "${config.id}"
  },`,
    "manual preview action"
  );
}

export function injectManualPreviewTrigger(source, config) {
  const marker = "\n});\n\nfunction applyBasePresentation(";
  const replacement = `
});

type P2_64KPreviewStatus = {
  windowReady: boolean;
  modelReady: boolean;
  motionStarted: boolean;
  parameterObserved: boolean;
};
type P2_64KPreviewGlobal = typeof globalThis & {
  ${PREVIEW_STATUS_GLOBAL}?: P2_64KPreviewStatus;
  ${PREVIEW_STATUS_GETTER}?: () => P2_64KPreviewStatus;
  ${TRIGGER_GLOBAL}?: () => boolean;
};
const p2_64kManualMotionPreviewStatus: P2_64KPreviewStatus = {
  get windowReady() {
    return true;
  },
  get modelReady() {
    return Boolean(live2DModel);
  },
  motionStarted: false,
  parameterObserved: false
};
(globalThis as P2_64KPreviewGlobal).${PREVIEW_STATUS_GLOBAL} = p2_64kManualMotionPreviewStatus;
(globalThis as P2_64KPreviewGlobal).${PREVIEW_STATUS_GETTER} = () => p2_64kManualMotionPreviewStatus;
(globalThis as P2_64KPreviewGlobal).${TRIGGER_GLOBAL} = () => {
  if (!p2_64kManualMotionPreviewStatus.modelReady) return false;
  p2_64kManualMotionPreviewStatus.motionStarted = false;
  p2_64kManualMotionPreviewStatus.parameterObserved = false;
  return interactionActionPlayer.playAction(
    getPetInteractionAction("${config.id}"),
    "${PREVIEW_REASON}",
    { stateId: "idle", modeId: "default", presenceModeId: "default", candidateActionTypes: ["${config.id}"] }
  );
};

function applyBasePresentation(`;
  return replaceExactlyOnce(source, marker, replacement, "manual preview trigger");
}

export function injectManualPreviewReason(source) {
  return replaceExactlyOnce(
    source,
    "  | \"startup_first_visible_frame\"",
    `  | "${PREVIEW_REASON}"\n  | "startup_first_visible_frame"`,
    "manual preview reason"
  );
}

export function injectManualPreviewPlayerLifecyclePatch(source, config) {
  const marker = `        activeAction.playbackPhase = "started";
        if (activeAction.timeoutId !== undefined) {
          clearScheduledTimeout(activeAction.timeoutId);
          delete activeAction.timeoutId;
        }
        reportActionStarted(activeAction);`;
  return replaceExactlyOnce(
    source,
    marker,
    `        activeAction.playbackPhase = "started";
      if (
        activeAction.reason === "${PREVIEW_REASON}" &&
        activeAction.action.type === "${config.id}"
      ) {
        const previewGlobal = globalThis as typeof globalThis & {
          ${PREVIEW_STATUS_GLOBAL}?: { motionStarted?: boolean; }
        };
        const previewStatus = previewGlobal.${PREVIEW_STATUS_GLOBAL};
        if (previewStatus) {
          previewStatus.motionStarted = true;
        }
      }
      if (activeAction.timeoutId !== undefined) {
        clearScheduledTimeout(activeAction.timeoutId);
        delete activeAction.timeoutId;
      }
      reportActionStarted(activeAction);`,
    "manual preview player lifecycle patch"
  );
}

export function injectManualPreviewFramePipelinePatch(source, probeParameterId) {
  const insertionMarker = `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  restoreReleasedMotionParameterDefaults(model, ownedParameterIds);
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);`;
  const patchedSource = replaceExactlyOnce(
    source,
    insertionMarker,
    `  const ownedParameterIds = layers.applyMotion?.(deltaSeconds) ?? EMPTY_PARAMETER_IDS;
  restoreReleasedMotionParameterDefaults(model, ownedParameterIds);
  const ownedParameterIndices = findOwnedParameterIndices(model, ownedParameterIds);`
    + "\n"
    + `  const previewGlobal = globalThis as typeof globalThis & {
    ${PREVIEW_STATUS_GLOBAL}?: { motionStarted?: boolean; parameterObserved?: boolean; }
  };
  const previewProbeParameterId = "${probeParameterId}";
  const previewMotionStarted = previewGlobal.${PREVIEW_STATUS_GLOBAL}?.motionStarted === true;
  const previewOwnedProbe = previewMotionStarted && previewProbeParameterId.length > 0 && ownedParameterIds.has(previewProbeParameterId);
  if (!previewOwnedProbe) {
    PREVIEW_PROBE_STATE_BY_MODEL.delete(model);
  }
  if (previewOwnedProbe) {
    const previewProbeIndices = findOwnedParameterIndices(model, new Set([previewProbeParameterId]));
    const previewProbeIndex = previewProbeIndices[0] ?? -1;
    if (previewProbeIndex >= 0) {
      const previewProbeValue = model.getParameterValueByIndex(previewProbeIndex);
      if (Number.isFinite(previewProbeValue)) {
        const existingProbeState = PREVIEW_PROBE_STATE_BY_MODEL.get(model);
        if (existingProbeState) {
          if (Math.abs(previewProbeValue - existingProbeState.baseline) > ${PREVIEW_PROBE_EPSILON}) {
            if (previewGlobal.${PREVIEW_STATUS_GLOBAL}) {
              previewGlobal.${PREVIEW_STATUS_GLOBAL}.parameterObserved = true;
            }
          }
        } else {
          PREVIEW_PROBE_STATE_BY_MODEL.set(model, { baseline: previewProbeValue });
        }
      }
    }
  }`,
    "manual preview probe motion sampling"
  );

  const headerMarker = "const previousMotionParameterIdsByModel = new WeakMap<object, ReadonlySet<string>>();";
  const headerPatched = replaceExactlyOnce(
    patchedSource,
    headerMarker,
    `const previousMotionParameterIdsByModel = new WeakMap<object, ReadonlySet<string>>();
const PREVIEW_PROBE_STATE_BY_MODEL = new WeakMap<object, { baseline: number; }>();`,
    "manual preview probe state map"
  );
  return headerPatched;
}

function patchFile(path, transform) {
  writeFileSync(path, transform(readFileSync(path, "utf8")), "utf8");
}

function collectDeclaredModelFixturePaths(manifest) {
  const references = new Set();
  const addReference = (value, label) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`model-manifest-${label}-invalid`);
    }
    references.add(value);
  };

  for (const label of ["model3", "moc3", "physics", "displayInfo", "idleMotion"]) {
    addReference(manifest?.[label], label);
  }
  if (manifest?.textures !== undefined) {
    if (!Array.isArray(manifest.textures)) throw new Error("model-manifest-textures-invalid");
    for (const texture of manifest.textures) addReference(texture, "texture");
  }
  if (manifest?.expressions !== undefined) {
    if (!manifest.expressions || typeof manifest.expressions !== "object" || Array.isArray(manifest.expressions)) {
      throw new Error("model-manifest-expressions-invalid");
    }
    for (const expression of Object.values(manifest.expressions)) addReference(expression, "expression");
  }
  return [...references];
}

function copyDeclaredModelFixtureFiles(sourceRoot, targetRoot, manifest) {
  mkdirSync(targetRoot, { recursive: true });
  for (const reference of collectDeclaredModelFixturePaths(manifest)) {
    const sourcePath = resolve(sourceRoot, reference);
    if (!isWithin(sourceRoot, sourcePath)) throw new Error("model-fixture-path-outside-model-root");
    const stats = lstatSync(sourcePath);
    if (stats.isSymbolicLink()) throw new Error("model-fixture-reparse-path-rejected");
    if (!stats.isFile()) throw new Error("model-fixture-reference-not-regular-file");
    checkWindowsReparsePath(
      sourcePath,
      "model-fixture-reparse-path-rejected",
      "model-fixture-reparse-attribute-check-failed"
    );

    const targetPath = resolve(targetRoot, relative(sourceRoot, sourcePath));
    if (!isWithin(targetRoot, targetPath)) throw new Error("model-fixture-target-outside-root");
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function binCommand(name) {
  return join(ROOT, "node_modules", ".bin", `${name}${process.platform === "win32" ? ".cmd" : ""}`);
}

export function getIsolatedManualPreviewBuildSteps() {
  return [
    { label: "main", command: binCommand("tsc"), args: ["-p", "tsconfig.main.json"] },
    { label: "preload", command: binCommand("tsc"), args: ["-p", "tsconfig.preload.json"] },
    { label: "renderer", command: binCommand("vite"), args: ["build", "--config", "vite.config.ts"] }
  ];
}

function buildIsolatedManualPreview(fixtureRoot) {
  for (const step of getIsolatedManualPreviewBuildSteps()) {
    const result = spawnSync(step.command, step.args, {
      cwd: fixtureRoot,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    if (result.error || result.status !== 0) throw new Error(`isolated-${step.label}-build-failed`);
  }
}

export function prepareIsolatedManualPreview(fixtureRoot, candidate, workspaceRoot = ROOT) {
  const targetRoot = resolve(fixtureRoot);
  const sourceRoot = resolve(workspaceRoot);
  if (existsSync(targetRoot)) throw new Error("fixture-path-must-be-absent");
  if (!candidate || !Buffer.isBuffer(candidate.bytes) || typeof candidate.sourcePath !== "string") {
    throw new Error("visual-only-candidate-invalid");
  }

  mkdirSync(targetRoot, { recursive: true });
  for (const entry of ["src", "public", "resources/models", "resources/icons", "model"]) {
    cpSync(join(sourceRoot, entry), join(targetRoot, entry), { recursive: true });
  }
  for (const file of [
    "package.json",
    "vite.config.ts",
    "tsconfig.base.json",
    "tsconfig.main.json",
    "tsconfig.preload.json",
    "tsconfig.renderer.json"
  ]) {
    copyFileSync(join(sourceRoot, file), join(targetRoot, file));
  }

  const config = previewConfig(candidate);
  const fixtureMotionPath = join(targetRoot, "resources", "models", "witch", config.motionPath);
  mkdirSync(dirname(fixtureMotionPath), { recursive: true });
  writeFileSync(fixtureMotionPath, candidate.bytes);
  const manifestPath = join(targetRoot, "resources", "models", "witch", "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourceManifestPath = join(sourceRoot, "resources", "models", "witch", "model-manifest.json");
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  const sourceModelRoot = resolve(dirname(sourceManifestPath), sourceManifest.sourceDir);
  if (!isWithin(sourceRoot, sourceModelRoot)) throw new Error("model-fixture-source-outside-workspace");
  copyDeclaredModelFixtureFiles(sourceModelRoot, join(targetRoot, "model-fixture"), sourceManifest);
  manifest.sourceDir = "../../../model-fixture";
  manifest.motionPresets = [{
    id: config.id,
    path: config.motionPath,
    semanticKind: "reaction",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: config.durationSeconds,
    priority: 50,
    cooldownMs: 0,
    restorePolicy: "restore-current-state",
    allowedStates: ["idle"],
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  }, ...(Array.isArray(manifest.motionPresets) ? manifest.motionPresets : [])];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  patchFile(join(targetRoot, "src", "shared", "pet-motion-presets.ts"), (source) => injectManualPreviewPreset(source, config));
  patchFile(join(targetRoot, "src", "renderer", "pet", "interaction-actions.ts"), (source) => injectManualPreviewAction(source, config));
  patchFile(join(targetRoot, "src", "renderer", "pet", "main.ts"), (source) => injectManualPreviewTrigger(source, config));
  patchFile(join(targetRoot, "src", "renderer", "pet", "interaction-action-player.ts"), (source) => injectManualPreviewPlayerLifecyclePatch(
    injectManualPreviewReason(source),
    config
  ));
  patchFile(
    join(targetRoot, "src", "renderer", "pet", "live2d", "cubism-frame-pipeline.ts"),
    (source) => injectManualPreviewFramePipelinePatch(source, config.probeParameterId)
  );

  return { config, fixtureMotionPath: relative(targetRoot, fixtureMotionPath).split(sep).join("/") };
}

export async function waitForManualPreviewTriggerAcceptance({
  trigger,
  timeoutMs = 10_000,
  intervalMs = 150,
  now = () => Date.now(),
  sleepFn = sleep
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    if (await trigger()) {
      return true;
    }
    if (now() >= deadline) {
      break;
    }
    await sleepFn(intervalMs);
  }
  throw new Error("preview-trigger-rejected");
}

export async function waitForManualPreviewRealStartGate({
  stages,
  readStatus,
  trigger,
  cleanupOnFailure = async () => undefined,
  timeoutMs = 12_000,
  intervalMs = 150,
  now = () => Date.now(),
  sleepFn = sleep,
  signal
}) {
  const deadline = now() + timeoutMs;

  try {
    while (now() <= deadline) {
      if (signal?.aborted) throw new Error("preview-start-aborted");
      const status = await readStatus();
      if (status?.windowReady === true) {
        stages.windowReady = true;
      }
      if (status?.modelReady === true) {
        stages.modelReady = true;
        break;
      }
      if (now() >= deadline) break;
      await sleepFn(intervalMs);
    }
    if (!stages.modelReady) {
      throw new Error("preview-model-not-ready");
    }

    let accepted = false;
    while (now() <= deadline) {
      if (signal?.aborted) throw new Error("preview-start-aborted");
      if (await trigger()) {
        accepted = true;
        break;
      }
      if (now() >= deadline) break;
      await sleepFn(intervalMs);
    }
    if (!accepted) {
      throw new Error("preview-trigger-rejected");
    }

    while (now() <= deadline) {
      if (signal?.aborted) throw new Error("preview-start-aborted");
      const status = await readStatus();
      stages.windowReady = status?.windowReady === true ? true : stages.windowReady;
      stages.motionStarted = status?.motionStarted === true;
      stages.parameterObserved = status?.parameterObserved === true;
      if (stages.motionStarted && stages.parameterObserved) {
        return status;
      }
      if (now() >= deadline) {
        break;
      }
      await sleepFn(intervalMs);
    }
    throw new Error("preview-motion-start-gate-timeout");
  } catch (error) {
    await cleanupOnFailure();
    throw error;
  }
}

export function createManualPreviewRunContext({ workspaceRoot = ROOT, port = 9696 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid-preview-port");
  const root = resolve(workspaceRoot);
  const tmpRoot = join(root, ".tmp");
  const runParentDir = join(tmpRoot, RUN_NAME);
  assertRegularDirectory(root, "run-reparse-path-rejected", "workspace-root-invalid");
  ensureRegularDirectory(tmpRoot, "run-reparse-path-rejected", "preview-tmp-root-invalid");
  ensureRegularDirectory(runParentDir, "run-reparse-path-rejected", "preview-run-parent-invalid");
  const runDir = mkdtempSync(join(runParentDir, "run-"));
  assertRegularDirectory(runDir, "run-reparse-path-rejected", "preview-run-directory-invalid");
  return {
    root,
    runName: RUN_NAME,
    runParentDir,
    runDir,
    appDataDir: join(runDir, "user-data"),
    port,
    child: null,
    pages: []
  };
}

function getOwnedRunPaths(context, workspaceRoot) {
  if (!context || context.runName !== RUN_NAME || typeof context.root !== "string"
    || typeof context.runParentDir !== "string" || typeof context.runDir !== "string") {
    throw new Error("invalid-preview-run-directory");
  }
  const root = resolve(workspaceRoot);
  const runParentDir = join(root, ".tmp", RUN_NAME);
  const runDir = resolve(context.runDir);
  if (!sameResolvedPath(context.root, root) || !sameResolvedPath(context.runParentDir, runParentDir)
    || !sameResolvedPath(dirname(runDir), runParentDir) || !basename(runDir).startsWith("run-")) {
    throw new Error("invalid-preview-run-directory");
  }
  return { root, tmpRoot: join(root, ".tmp"), runParentDir, runDir };
}

function removeOwnedEntry(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || isWindowsDirectoryReparsePoint(path, stats)) {
    try {
      unlinkSync(path);
    } catch (error) {
      if (process.platform !== "win32") throw error;
      rmdirSync(path);
    }
    return;
  }
  if (stats.isFile()) {
    unlinkSync(path);
    return;
  }
  if (!stats.isDirectory()) throw new Error("preview-run-non-regular-entry");
  for (const entry of readdirSync(path)) removeOwnedEntry(join(path, entry));
  rmdirSync(path);
}

export function cleanupOwnManualPreviewArtifacts(context, workspaceRoot = context?.root ?? ROOT) {
  const { root, tmpRoot, runParentDir, runDir } = getOwnedRunPaths(context, workspaceRoot);
  assertRegularDirectory(root, "run-ancestor-reparse-rejected", "workspace-root-invalid");
  assertRegularDirectory(tmpRoot, "run-ancestor-reparse-rejected", "preview-tmp-root-invalid");
  assertRegularDirectory(runParentDir, "run-ancestor-reparse-rejected", "preview-run-parent-invalid");
  assertRegularDirectory(runDir, "run-directory-reparse-rejected", "preview-run-directory-invalid");
  removeOwnedEntry(runDir);
  if (readdirSync(runParentDir).length === 0) rmdirSync(runParentDir);
  return {
    runDirRemoved: !existsSync(runDir),
    runParentRemoved: !existsSync(runParentDir)
  };
}

function waitForPreviewClose(context, signal) {
  return new Promise((resolveClose) => {
    const resolveOnce = () => resolveClose();
    if (context.child?.exitCode === null) context.child.once("exit", resolveOnce);
    else resolveOnce();
    signal.addEventListener("abort", resolveOnce, { once: true });
  });
}

async function main() {
  let candidate;
  try {
    candidate = readVisualOnlyCandidate(parseRunnerArgs(process.argv.slice(2)));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: "blocked", failure: publicError(error) }, null, 2));
    process.exitCode = 1;
    return;
  }

  let context = null;
  const controller = new AbortController();
  const stopForInterrupt = () => controller.abort();
  process.once("SIGINT", stopForInterrupt);
  let failure = null;
  let opened = false;
  let cleanup = { electronStopped: false, runDirRemoved: false, runParentRemoved: false };
  try {
    context = createManualPreviewRunContext({ port: Number(process.env.P2_64K_CDP_PORT ?? 9696) });
    const fixture = prepareIsolatedManualPreview(join(context.runDir, "isolated-app"), candidate);
    buildIsolatedManualPreview(join(context.runDir, "isolated-app"));
    startIsolatedElectron(context, join(context.runDir, "isolated-app"));
    await connectToElectron(context, 40_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
    await waitFor(pet, `typeof globalThis.${TRIGGER_GLOBAL} === "function"`, { timeoutMs: 10_000 });
    const previewStages = {
      windowReady: false,
      modelReady: false,
      motionStarted: false,
      parameterObserved: false
    };
    const readPreviewStatus = async () => evaluate(pet, `
      (typeof globalThis.${PREVIEW_STATUS_GETTER} === "function")
        ? globalThis.${PREVIEW_STATUS_GETTER}?.()
        : null
    `);
    await waitForManualPreviewRealStartGate({
      stages: previewStages,
      trigger: () => evaluate(pet, `globalThis.${TRIGGER_GLOBAL}()`),
      readStatus: readPreviewStatus,
      timeoutMs: 12_000,
      signal: controller.signal
    });
    opened = true;
    await evaluate(pet, `
      globalThis.setInterval(() => { void globalThis.${TRIGGER_GLOBAL}?.(); }, ${fixture.config.durationMs + REPLAY_GAP_MS});
    `);
    console.log(JSON.stringify({
      ok: true,
      status: "visual-review-open",
      candidate: candidate.summary,
      isolatedFixture: true,
      technicalValidation: "not-run",
      previewStages,
      replayEveryMs: fixture.config.durationMs + REPLAY_GAP_MS,
      close: "Close the isolated desktop pet window or press Ctrl+C to finish and clean this preview."
    }, null, 2));
    await waitForPreviewClose(context, controller.signal);
  } catch (error) {
    failure = publicError(error);
  } finally {
    process.removeListener("SIGINT", stopForInterrupt);
    if (context) {
      cleanup.electronStopped = await stopElectronAndVerify(context).catch(() => false);
      try {
        Object.assign(cleanup, cleanupOwnManualPreviewArtifacts(context));
      } catch (error) {
        failure ??= publicError(error);
      }
    }
  }

  const ok = opened && !failure && cleanup.electronStopped && cleanup.runDirRemoved;
  console.log(JSON.stringify({
    ok,
    status: ok ? "preview-closed" : "failed",
    candidate: candidate.summary,
    isolatedFixture: true,
    technicalValidation: "not-run",
    cleanup,
    ...(failure ? { failure } : {})
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
