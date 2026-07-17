import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  stopElectronAndVerify,
  validateExplicitDraftMotion
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";
import {
  connectToElectron,
  evaluate,
  sleep,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REACTION_DRAFT_ROOT = "C:/Users/1/AppData/Roaming/Electron/motion-drafts/vts-drafts";
const RUN_NAME = "p2-63c-12-reaction-draft-visual-preview";
const TRIGGER_GLOBAL = "__P2_63C_12_REACTION_DRAFT_TRIGGER__";
const PREVIEW_REASON = "reaction_draft_visual_preview";
const MAX_DURATION_SECONDS = 60;

export const REACTION_DRAFT_PROFILES = Object.freeze([
  "happy-small",
  "surprised-small",
  "flustered-small"
]);

export const GREET_SMALL_V3_PROFILE = "greet-small-v3";
export const GREET_SMALL_V3_PARAMETER_ALLOWLIST = Object.freeze([
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
const GREET_SMALL_V3_DURATION_SECONDS = 3.4;
const GREET_SMALL_V3_FPS = 30;

export const MANAGED_VISUAL_PREVIEW_PROFILES = Object.freeze([
  ...REACTION_DRAFT_PROFILES,
  "arrival-settle",
  GREET_SMALL_V3_PROFILE
]);

function isWithin(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: String(error instanceof Error ? error.message : error).slice(0, 300)
  };
}

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`expected exactly one ${label} marker`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

function checkWindowsReparsePath(candidatePath, reparseError, checkError) {
  if (process.platform !== "win32") return;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$path = [Environment]::GetEnvironmentVariable('P2_63C_12_REACTION_DRAFT_PATH')
while ($true) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
  $parent = [IO.Directory]::GetParent($path)
  if ($null -eq $parent) { break }
  $path = $parent.FullName
}`
  ], {
    env: { ...process.env, P2_63C_12_REACTION_DRAFT_PATH: candidatePath },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 23) throw new Error(reparseError);
  if (result.status !== 0) throw new Error(checkError);
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

function isWindowsDirectoryReparsePoint(path, stats) {
  if (process.platform !== "win32" || !stats.isDirectory()) return false;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$item = Get-Item -LiteralPath ([Environment]::GetEnvironmentVariable('P2_63C_12_REACTION_DRAFT_PATH')) -Force -ErrorAction Stop\nif (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }"
  ], {
    env: { ...process.env, P2_63C_12_REACTION_DRAFT_PATH: path },
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
  if (!MANAGED_VISUAL_PREVIEW_PROFILES.includes(profile)) throw new Error("reaction-profile-not-allowed");
  if (!candidateDraft) throw new Error("candidate-draft-required");
  if (typeof candidateDraft !== "string" || !isAbsolute(candidateDraft)) throw new Error("candidate-draft-must-be-absolute");
  return { profile, candidateDraft: resolve(candidateDraft) };
}

function assertNoReparseComponents(candidatePath) {
  const parsed = parse(candidatePath);
  const components = candidatePath.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean);
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
    candidatePath,
    "candidate-reparse-path-rejected",
    "candidate-reparse-attribute-check-failed"
  );
}

function readCurrentModelParameterIds(workspaceRoot) {
  const manifestPath = join(workspaceRoot, "resources", "models", "witch", "model-manifest.json");
  let manifest;
  let displayInfo;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sourceRoot = resolve(dirname(manifestPath), manifest.sourceDir);
    const displayInfoPath = resolve(sourceRoot, manifest.displayInfo);
    if (!isWithin(workspaceRoot, sourceRoot) || !isWithin(sourceRoot, displayInfoPath)) {
      throw new Error("model-display-info-outside-workspace");
    }
    displayInfo = JSON.parse(readFileSync(displayInfoPath, "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message === "model-display-info-outside-workspace") throw error;
    throw new Error("current-model-display-info-invalid");
  }
  if (!Array.isArray(displayInfo?.Parameters)) throw new Error("current-model-parameter-ids-invalid");
  const parameterIds = displayInfo.Parameters.map((parameter) => parameter?.Id);
  if (parameterIds.length === 0 || parameterIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("current-model-parameter-ids-invalid");
  }
  return parameterIds;
}

function validateReactionDraftMotion(motion, workspaceRoot, profile) {
  const candidateParameterIds = Array.isArray(motion?.Curves)
    ? motion.Curves.flatMap((curve) => typeof curve?.Id === "string" ? [curve.Id] : [])
    : [];
  const isGreetSmallV3 = profile === GREET_SMALL_V3_PROFILE;
  const validation = validateExplicitDraftMotion(
    motion,
    readCurrentModelParameterIds(workspaceRoot),
    {
      semanticAllowlist: isGreetSmallV3 ? GREET_SMALL_V3_PARAMETER_ALLOWLIST : candidateParameterIds,
      variationParameterIds: [],
      ...(isGreetSmallV3 ? {
        durationSeconds: GREET_SMALL_V3_DURATION_SECONDS,
        fps: GREET_SMALL_V3_FPS
      } : {})
    }
  );
  if (validation.status !== "validated") {
    throw new Error(`candidate-motion3-structural-validation-failed:${validation.blockers.join(",")}`);
  }
  return validation;
}

export function readReactionDraft(
  { profile, candidateDraft },
  draftRoot = REACTION_DRAFT_ROOT,
  workspaceRoot = ROOT
) {
  if (!MANAGED_VISUAL_PREVIEW_PROFILES.includes(profile)) throw new Error("reaction-profile-not-allowed");
  if (!isAbsolute(candidateDraft)) throw new Error("candidate-draft-must-be-absolute");
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
  if (!isWithin(realRoot, realCandidate) || resolve(realCandidate).toLowerCase() !== candidatePath.toLowerCase()) {
    throw new Error("candidate-reparse-path-rejected");
  }

  const bytes = readFileSync(candidatePath);
  let motion;
  try {
    motion = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("candidate-invalid-json");
  }
  const validation = validateReactionDraftMotion(motion, workspaceRoot, profile);
  const durationSeconds = validation.structure.durationSeconds;
  if (durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error("candidate-duration-invalid");
  }
  return {
    sourcePath: candidatePath,
    bytes,
    sha256: hashBytes(bytes),
    profile,
    motion,
    durationSeconds,
    durationMs: Math.max(1, Math.round(durationSeconds * 1_000)),
    summary: {
      safeSummaryOnly: true,
      profile,
      basename: candidateName,
      durationSeconds
    }
  };
}

function previewConfig(candidate) {
  const id = `reaction-draft-preview-${candidate.profile}`;
  return {
    id,
    motionPath: `motions/${id}.motion3.json`,
    durationSeconds: candidate.durationSeconds,
    durationMs: candidate.durationMs
  };
}

export function injectReactionMotionPreset(source, config) {
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
]);`, "reaction preview motion preset");
}

export function injectReactionPreviewAction(source, config) {
  const withType = replaceExactlyOnce(
    source,
    "export const PET_INTERACTION_ACTION_TYPES = [",
    `export const PET_INTERACTION_ACTION_TYPES = [\n  "${config.id}",`,
    "reaction preview action type"
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
    "reaction preview action"
  );
}

export function injectReactionPreviewTrigger(source, config) {
  const marker = "\n});\n\nfunction applyBasePresentation(";
  const replacement = `
});

type ReactionDraftPreviewGlobal = typeof globalThis & { ${TRIGGER_GLOBAL}?: () => boolean };
(globalThis as ReactionDraftPreviewGlobal).${TRIGGER_GLOBAL} = () => interactionActionPlayer.playAction(
  getPetInteractionAction("${config.id}"),
  "${PREVIEW_REASON}",
  { stateId: "idle", modeId: "default", presenceModeId: "default", candidateActionTypes: ["${config.id}"] }
);

function applyBasePresentation(`;
  return replaceExactlyOnce(source, marker, replacement, "reaction preview trigger");
}

export function injectReactionPreviewReason(source) {
  return replaceExactlyOnce(
    source,
    "  | \"startup_first_visible_frame\"",
    `  | "${PREVIEW_REASON}"\n  | "startup_first_visible_frame"`,
    "reaction preview reason"
  );
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

export function getIsolatedReactionPreviewBuildSteps(fixtureRoot) {
  return [
    { label: "main", command: binCommand("tsc"), args: ["-p", "tsconfig.main.json"] },
    { label: "preload", command: binCommand("tsc"), args: ["-p", "tsconfig.preload.json"] },
    { label: "renderer", command: binCommand("vite"), args: ["build", "--config", "vite.config.ts"] }
  ];
}

function buildIsolatedReactionPreview(fixtureRoot) {
  for (const step of getIsolatedReactionPreviewBuildSteps(fixtureRoot)) {
    const result = spawnSync(step.command, step.args, {
      cwd: fixtureRoot,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    if (result.error || result.status !== 0) throw new Error(`isolated-${step.label}-build-failed`);
  }
}

export function prepareIsolatedReactionPreview(fixtureRoot, candidate, workspaceRoot = ROOT) {
  const sourceHashBefore = hashBytes(readFileSync(candidate.sourcePath));
  mkdirSync(fixtureRoot, { recursive: true });
  for (const entry of ["src", "public", "resources/models", "resources/icons"]) {
    cpSync(join(workspaceRoot, entry), join(fixtureRoot, entry), { recursive: true });
  }
  for (const file of [
    "package.json",
    "vite.config.ts",
    "tsconfig.base.json",
    "tsconfig.main.json",
    "tsconfig.preload.json",
    "tsconfig.renderer.json"
  ]) {
    copyFileSync(join(workspaceRoot, file), join(fixtureRoot, file));
  }

  const config = previewConfig(candidate);
  const fixtureMotionPath = join(fixtureRoot, "resources", "models", "witch", config.motionPath);
  mkdirSync(dirname(fixtureMotionPath), { recursive: true });
  writeFileSync(fixtureMotionPath, candidate.bytes);

  const manifestPath = join(fixtureRoot, "resources", "models", "witch", "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourceManifestPath = join(workspaceRoot, "resources", "models", "witch", "model-manifest.json");
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  const sourceModelRoot = resolve(dirname(sourceManifestPath), sourceManifest.sourceDir);
  if (!isWithin(workspaceRoot, sourceModelRoot)) throw new Error("model-fixture-source-outside-workspace");
  copyDeclaredModelFixtureFiles(sourceModelRoot, join(fixtureRoot, "model-fixture"), sourceManifest);
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
  }];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  patchFile(join(fixtureRoot, "src", "shared", "pet-motion-presets.ts"), (source) => injectReactionMotionPreset(source, config));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "interaction-actions.ts"), (source) => injectReactionPreviewAction(source, config));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "main.ts"), (source) => injectReactionPreviewTrigger(source, config));
  patchFile(join(fixtureRoot, "src", "renderer", "pet", "interaction-action-player.ts"), injectReactionPreviewReason);

  if (hashBytes(readFileSync(candidate.sourcePath)) !== sourceHashBefore || sourceHashBefore !== candidate.sha256) {
    throw new Error("candidate-hash-changed-during-fixture-preparation");
  }
  return { config, fixtureMotionPath: relative(fixtureRoot, fixtureMotionPath).split(sep).join("/") };
}

export function createReactionPreviewRunContext({ workspaceRoot = ROOT, port = 9692 } = {}) {
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
    stamp: basename(runDir),
    runParentDir,
    runDir,
    appDataDir: join(runDir, "user-data"),
    resultPath: join(runDir, "result.json"),
    progressPath: join(runDir, "progress.log"),
    port,
    env: {},
    child: null,
    pages: [],
    screenshotPatterns: [/^p2-63c-12-.*\.(png|jpg)$/iu],
    tmpResiduePatterns: [/^p2-63c-12-reaction-draft-visual-preview$/iu]
  };
}

function getOwnedPreviewRunPaths(context, workspaceRoot) {
  if (!context || typeof context !== "object" || context.runName !== RUN_NAME
    || typeof context.root !== "string" || typeof context.runParentDir !== "string" || typeof context.runDir !== "string") {
    throw new Error("invalid-preview-run-directory");
  }
  const root = resolve(workspaceRoot);
  const tmpRoot = join(root, ".tmp");
  const runParentDir = join(tmpRoot, RUN_NAME);
  const runDir = resolve(context.runDir);
  if (resolve(context.root) !== root || resolve(context.runParentDir) !== runParentDir
    || dirname(runDir) !== runParentDir || !basename(runDir).startsWith("run-")) {
    throw new Error("invalid-preview-run-directory");
  }
  return { root, tmpRoot, runParentDir, runDir };
}

function removeReparseEntry(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    rmdirSync(path);
  }
}

function removeOwnedPreviewEntry(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || isWindowsDirectoryReparsePoint(path, stats)) {
    removeReparseEntry(path);
    return;
  }
  if (stats.isFile()) {
    unlinkSync(path);
    return;
  }
  if (!stats.isDirectory()) throw new Error("preview-run-non-regular-entry");
  for (const entry of readdirSync(path)) removeOwnedPreviewEntry(join(path, entry));
  rmdirSync(path);
}

export function cleanupOwnPreviewArtifacts(context, workspaceRoot = context?.root ?? ROOT) {
  const { root, tmpRoot, runParentDir, runDir } = getOwnedPreviewRunPaths(context, workspaceRoot);
  assertRegularDirectory(root, "run-ancestor-reparse-rejected", "workspace-root-invalid");
  assertRegularDirectory(tmpRoot, "run-ancestor-reparse-rejected", "preview-tmp-root-invalid");
  assertRegularDirectory(runParentDir, "run-ancestor-reparse-rejected", "preview-run-parent-invalid");
  assertRegularDirectory(runDir, "run-directory-reparse-rejected", "preview-run-directory-invalid");
  removeOwnedPreviewEntry(runDir);
  assertRegularDirectory(runParentDir, "run-ancestor-reparse-rejected", "preview-run-parent-invalid");
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
  let args;
  let candidate;
  try {
    args = parseRunnerArgs(process.argv.slice(2));
    candidate = readReactionDraft(args);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: "blocked", failure: publicError(error) }, null, 2));
    process.exitCode = 1;
    return;
  }

  const context = createReactionPreviewRunContext({
    port: Number(process.env.P2_63C_12_CDP_PORT ?? 9692)
  });
  const controller = new AbortController();
  const stopForInterrupt = () => controller.abort();
  process.once("SIGINT", stopForInterrupt);
  let failure = null;
  let launched = false;
  let cleanup = { electronStopped: false, runDirRemoved: false, runParentRemoved: false };

  try {
    const fixtureRoot = join(context.runDir, "isolated-app");
    const fixture = prepareIsolatedReactionPreview(fixtureRoot, candidate);
    buildIsolatedReactionPreview(fixtureRoot);
    startIsolatedElectron(context, fixtureRoot);
    await connectToElectron(context, 40_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
    await sleep(750);
    await waitFor(pet, `typeof globalThis.${TRIGGER_GLOBAL} === "function"`, { timeoutMs: 10_000 });
    if (await evaluate(pet, `globalThis.${TRIGGER_GLOBAL}()`) !== true) throw new Error("preview-trigger-rejected");
    launched = true;
    console.log(JSON.stringify({
      ok: true,
      status: "visual-review-open",
      candidate: candidate.summary,
      isolatedFixture: true,
      productionCatalogModified: false,
      replayEveryMs: fixture.config.durationMs + 1_000,
      close: "Close the desktop pet window or press Ctrl+C to finish and clean this preview."
    }, null, 2));
    await evaluate(pet, `
      globalThis.setInterval(() => { void globalThis.${TRIGGER_GLOBAL}?.(); }, ${fixture.config.durationMs + 1_000});
    `);
    await waitForPreviewClose(context, controller.signal);
  } catch (error) {
    failure = publicError(error);
  } finally {
    process.removeListener("SIGINT", stopForInterrupt);
    cleanup.electronStopped = await stopElectronAndVerify(context).catch(() => false);
    Object.assign(cleanup, cleanupOwnPreviewArtifacts(context));
  }

  const ok = launched && !failure && cleanup.electronStopped && cleanup.runDirRemoved;
  console.log(JSON.stringify({
    ok,
    status: ok ? "preview-closed" : "failed",
    candidate: candidate.summary,
    isolatedFixture: true,
    productionCatalogModified: false,
    cleanup,
    ...(failure ? { failure } : {})
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
