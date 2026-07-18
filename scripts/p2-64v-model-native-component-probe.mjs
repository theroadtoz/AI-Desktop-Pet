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
  rmdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-64v-model-native-component-probe";
const TRIGGER_GLOBAL = "__P2_64V_MODEL_NATIVE_COMPONENT_PROBE_TRIGGER__";
const PROBE_REASON = "p2_64v_model_native_component_probe";

export const P2_64V_TEAR_MOTION_ID = "p2-64v-native-tear-probe";
export const P2_64V_TEAR_MOTION_PATH = `motions/${P2_64V_TEAR_MOTION_ID}.motion3.json`;
export const P2_64V_TEAR_DURATION_MS = 2_400;
export const P2_64V_NEUTRAL_DURATION_MS = 1_000;
export const P2_64V_ANGRY_DURATION_MS = 2_600;
export const P2_64V_TEAR_PARAMETER_IDS = Object.freeze(["Param25", "Param26", "Param27"]);
export const P2_64V_EXPRESSION_APPLIED_SIGNAL = "__P2_64V_EXPRESSION_APPLIED__";

export const P2_64V_TEAR_STIMULUS = Object.freeze({
  Version: 3,
  Meta: {
    Duration: P2_64V_TEAR_DURATION_MS / 1_000,
    Fps: 30,
    Loop: false,
    CurveCount: P2_64V_TEAR_PARAMETER_IDS.length,
    TotalSegmentCount: P2_64V_TEAR_PARAMETER_IDS.length * 3,
    TotalPointCount: P2_64V_TEAR_PARAMETER_IDS.length * 4,
    UserDataCount: 0,
    TotalUserDataSize: 0
  },
  Curves: P2_64V_TEAR_PARAMETER_IDS.map((id) => ({
    Target: "Parameter",
    Id: id,
    Segments: [0, 0, 0, 0.6, 30, 0, 1.8, 30, 0, 2.4, 0]
  }))
});

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

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`expected exactly one ${label} marker`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

export function checkWindowsReparsePath(
  path,
  rejectionError,
  checkError,
  { platform = process.platform, spawnSyncFn = spawnSync } = {}
) {
  if (platform !== "win32") return;
  const result = spawnSyncFn("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$path = [Environment]::GetEnvironmentVariable('P2_64V_PATH')
while ($true) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
  $parent = [IO.Directory]::GetParent($path)
  if ($null -eq $parent) { break }
  $path = $parent.FullName
}`
  ], {
    env: { ...process.env, P2_64V_PATH: path },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 23) throw new Error(rejectionError);
  if (result.status !== 0) throw new Error(checkError);
}

export function checkWindowsReparseTree(
  path,
  rejectionError,
  checkError,
  { platform = process.platform, spawnSyncFn = spawnSync } = {}
) {
  if (platform !== "win32") return;
  const result = spawnSyncFn("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$root = [Environment]::GetEnvironmentVariable('P2_64V_PATH')
$pending = [System.Collections.Generic.Stack[string]]::new()
$pending.Push($root)
while ($pending.Count -gt 0) {
  $path = $pending.Pop()
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
  if (-not $item.PSIsContainer) { continue }
  foreach ($child in Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop) {
    if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 23 }
    if ($child.PSIsContainer) { $pending.Push($child.FullName) }
  }
}`
  ], {
    env: { ...process.env, P2_64V_PATH: path },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 23) throw new Error(rejectionError);
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

function assertRegularFile(path, reparseError, invalidError) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(invalidError);
  }
  if (stats.isSymbolicLink()) throw new Error(reparseError);
  if (!stats.isFile()) throw new Error(invalidError);
  checkWindowsReparsePath(path, reparseError, `${invalidError}-reparse-attribute-check-failed`);
}

export function assertRegularTree(
  path,
  reparseError,
  invalidError,
  {
    lstatSyncFn = lstatSync,
    readdirSyncFn = readdirSync,
    checkWindowsReparseTreeFn = checkWindowsReparseTree
  } = {}
) {
  const visit = (entryPath) => {
    let stats;
    try {
      stats = lstatSyncFn(entryPath);
    } catch {
      throw new Error(invalidError);
    }
    if (stats.isSymbolicLink()) throw new Error(reparseError);
    if (stats.isFile()) return;
    if (!stats.isDirectory()) throw new Error(invalidError);
    let entries;
    try {
      entries = readdirSyncFn(entryPath);
    } catch {
      throw new Error(invalidError);
    }
    for (const entry of entries) visit(join(entryPath, entry));
  };

  checkWindowsReparseTreeFn(path, reparseError, `${invalidError}-reparse-attribute-check-failed`);
  visit(path);
}

function ensureRegularDirectory(path, reparseError, invalidError) {
  if (!existsSync(path)) mkdirSync(path);
  assertRegularDirectory(path, reparseError, invalidError);
}

function sameResolvedPath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function removeOwnedEntry(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    unlinkSync(path);
    return;
  }
  if (stats.isFile()) {
    checkWindowsReparsePath(path, "probe-run-reparse-rejected", "probe-run-reparse-attribute-check-failed");
    unlinkSync(path);
    return;
  }
  if (!stats.isDirectory()) throw new Error("probe-run-non-regular-entry");
  checkWindowsReparsePath(path, "probe-run-reparse-rejected", "probe-run-reparse-attribute-check-failed");
  for (const entry of readdirSync(path)) removeOwnedEntry(join(path, entry));
  rmdirSync(path);
}

function patchFile(path, transform) {
  writeFileSync(path, transform(readFileSync(path, "utf8")), "utf8");
}

function collectDeclaredModelFixturePaths(manifest) {
  const references = new Set();
  const addReference = (value, label) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string" || value.length === 0) throw new Error(`model-manifest-${label}-invalid`);
    references.add(value);
  };

  for (const label of ["model3", "moc3", "physics", "displayInfo", "idleMotion"]) {
    addReference(manifest?.[label], label);
  }
  if (!Array.isArray(manifest?.textures)) throw new Error("model-manifest-textures-invalid");
  for (const texture of manifest.textures) addReference(texture, "texture");
  if (!manifest?.expressions || typeof manifest.expressions !== "object" || Array.isArray(manifest.expressions)) {
    throw new Error("model-manifest-expressions-invalid");
  }
  for (const expression of Object.values(manifest.expressions)) addReference(expression, "expression");
  return [...references];
}

function copyDeclaredModelFixtureFiles(sourceRoot, targetRoot, manifest) {
  assertRegularDirectory(sourceRoot, "model-fixture-source-reparse-rejected", "model-fixture-source-invalid");
  assertRegularDirectory(dirname(targetRoot), "model-fixture-target-reparse-rejected", "model-fixture-target-parent-invalid");
  mkdirSync(targetRoot);
  assertRegularDirectory(targetRoot, "model-fixture-target-reparse-rejected", "model-fixture-target-invalid");
  for (const reference of collectDeclaredModelFixturePaths(manifest)) {
    const sourcePath = resolve(sourceRoot, reference);
    if (!isWithin(sourceRoot, sourcePath)) throw new Error("model-fixture-path-outside-model-root");
    assertRegularFile(sourcePath, "model-fixture-source-reparse-rejected", "model-fixture-reference-not-regular-file");
    const targetPath = resolve(targetRoot, relative(sourceRoot, sourcePath));
    if (!isWithin(targetRoot, targetPath)) throw new Error("model-fixture-target-outside-root");
    mkdirSync(dirname(targetPath), { recursive: true });
    assertRegularDirectory(dirname(targetPath), "model-fixture-target-reparse-rejected", "model-fixture-target-invalid");
    copyFileSync(sourcePath, targetPath);
  }
}

export function readProbeManifest(workspaceRoot = ROOT) {
  const root = resolve(workspaceRoot);
  assertRegularDirectory(root, "workspace-root-reparse-rejected", "workspace-root-invalid");
  const manifestPath = join(root, "resources", "models", "witch", "model-manifest.json");
  assertRegularFile(manifestPath, "model-fixture-source-reparse-rejected", "model-manifest-invalid");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.expressions?.angry !== "sq.exp3.json") {
    throw new Error("probe-angry-expression-resource-invalid");
  }
  if (typeof manifest.sourceDir !== "string" || manifest.sourceDir.length === 0) {
    throw new Error("model-manifest-source-dir-invalid");
  }
  return { manifest, manifestPath, angryExpressionName: "angry", angryExpressionPath: "sq.exp3.json" };
}

export function injectComponentProbeMotionPreset(source) {
  const marker = "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = APPROVED_MOTION_PRESETS;";
  return replaceExactlyOnce(source, marker, `export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([
  {
    id: "${P2_64V_TEAR_MOTION_ID}",
    path: "${P2_64V_TEAR_MOTION_PATH}",
    semanticKind: "reaction",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: ${P2_64V_TEAR_DURATION_MS / 1_000},
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
]);`, "component probe motion preset");
}

export function injectComponentProbeAction(source) {
  const withType = replaceExactlyOnce(
    source,
    "export const PET_INTERACTION_ACTION_TYPES = [",
    `export const PET_INTERACTION_ACTION_TYPES = [\n  "${P2_64V_TEAR_MOTION_ID}",`,
    "component probe action type"
  );
  return replaceExactlyOnce(
    withType,
    "export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [",
    `export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [
  {
    type: "${P2_64V_TEAR_MOTION_ID}",
    weight: 0,
    durationMs: ${P2_64V_TEAR_DURATION_MS},
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    motionPresetId: "${P2_64V_TEAR_MOTION_ID}"
  },`,
    "component probe action"
  );
}

export function injectComponentProbeReason(source) {
  return replaceExactlyOnce(
    source,
    "  | \"startup_first_visible_frame\"",
    `  | "${PROBE_REASON}"\n  | "startup_first_visible_frame"`,
    "component probe reason"
  );
}

export function injectComponentProbeExpressionAppliedSignal(source) {
  const marker = "  public async setExpressionAsset(expressionName: string): Promise<void> {";
  const signalAccess = `(globalThis as typeof globalThis & { ${P2_64V_EXPRESSION_APPLIED_SIGNAL}?: string | null }).${P2_64V_EXPRESSION_APPLIED_SIGNAL}`;
  const withSignalReset = replaceExactlyOnce(
    source,
    marker,
    `${marker}\n    ${signalAccess} = null;`,
    "component probe expression signal reset"
  );
  return replaceExactlyOnce(
    withSignalReset,
    "      this.clearExpressionQueue();\n      this.manager.startMotion(motion, false);\n    } catch (error: unknown) {\n      console.warn(\"[pet-expression] failed to apply expression asset\", {",
    `      this.clearExpressionQueue();\n      this.manager.startMotion(motion, false);\n      ${signalAccess} = expressionName;\n    } catch (error: unknown) {\n      console.warn(\"[pet-expression] failed to apply expression asset\", {`,
    "component probe expression signal success"
  );
}

export function injectComponentProbeTrigger(source, angryExpressionName) {
  if (angryExpressionName !== "angry") throw new Error("probe-angry-expression-name-invalid");
  const marker = "\nfunction applyBasePresentation(";
  const replacement = `
type P2_64VComponentProbeGlobal = typeof globalThis & { ${TRIGGER_GLOBAL}?: () => boolean };
let p2_64vComponentProbeTimer: number | null = null;

function setP264VComponentProbeStage(stage: string, label: string): void {
  const elementId = "p2-64v-component-probe-stage";
  const labelElement = document.getElementById(elementId) ?? (() => {
    const element = document.createElement("div");
    element.id = elementId;
    element.setAttribute("aria-live", "polite");
    element.style.cssText = "position:fixed;left:16px;top:16px;z-index:9999;padding:8px 10px;background:#1d2030;color:#ffffff;font:600 14px/1.35 system-ui,sans-serif;border:1px solid #7d89b8;pointer-events:none";
    document.body.append(element);
    return element;
  })();
  labelElement.dataset.stage = stage;
  labelElement.textContent = label;
}

function scheduleP264VComponentProbe(callback: () => void, delayMs: number): void {
  if (p2_64vComponentProbeTimer !== null) window.clearTimeout(p2_64vComponentProbeTimer);
  p2_64vComponentProbeTimer = window.setTimeout(callback, delayMs);
}

function runP264VComponentProbe(): boolean {
  live2DModel?.stopMotion("interrupted");
  live2DModel?.clearExpression();
  setP264VComponentProbeStage("tear-parameters", "P2-64V 测试：泪眼参数曲线 Param25 / Param26 / Param27");
  const started = interactionActionPlayer.playAction(
    getPetInteractionAction("${P2_64V_TEAR_MOTION_ID}"),
    "${PROBE_REASON}",
    { stateId: "idle", modeId: "default", presenceModeId: "default", candidateActionTypes: ["${P2_64V_TEAR_MOTION_ID}"] }
  );
  if (!started) return false;
  scheduleP264VComponentProbe(() => {
    live2DModel?.stopMotion("interrupted");
    live2DModel?.clearExpression();
    setP264VComponentProbeStage("neutral-after-tear", "P2-64V 测试：中性复位");
    scheduleP264VComponentProbe(() => {
      setP264VComponentProbeStage("angry-expression-loading", "P2-64V 测试：正在加载生气表达式 manifest angry -> sq.exp3.json");
      const scheduleNeutralAfterAngry = () => {
        live2DModel?.clearExpression();
        setP264VComponentProbeStage("neutral-after-angry", "P2-64V 测试：中性复位");
        scheduleP264VComponentProbe(() => { void runP264VComponentProbe(); }, ${P2_64V_NEUTRAL_DURATION_MS});
      };
       const expressionLoad = live2DModel?.setExpression("${angryExpressionName}");
      if (!expressionLoad) {
        live2DModel?.clearExpression();
        setP264VComponentProbeStage("angry-expression-failed", "P2-64V 测试：生气表达式加载失败，未进入展示");
        scheduleNeutralAfterAngry();
        return;
      }
       void Promise.resolve(expressionLoad).then(() => {
         if (globalThis.${P2_64V_EXPRESSION_APPLIED_SIGNAL} !== "${angryExpressionName}") {
           live2DModel?.clearExpression();
           setP264VComponentProbeStage("angry-expression-failed", "P2-64V 测试：生气表达式未成功应用，未进入展示");
           scheduleNeutralAfterAngry();
           return;
         }
         setP264VComponentProbeStage("angry-expression", "P2-64V 测试：生气表达式 manifest angry -> sq.exp3.json");
        scheduleP264VComponentProbe(scheduleNeutralAfterAngry, ${P2_64V_ANGRY_DURATION_MS});
      }).catch(() => {
        live2DModel?.clearExpression();
        setP264VComponentProbeStage("angry-expression-failed", "P2-64V 测试：生气表达式加载失败，未进入展示");
        scheduleP264VComponentProbe(scheduleNeutralAfterAngry, ${P2_64V_NEUTRAL_DURATION_MS});
      });
    }, ${P2_64V_NEUTRAL_DURATION_MS});
  }, ${P2_64V_TEAR_DURATION_MS});
  return true;
}

(globalThis as P2_64VComponentProbeGlobal).${TRIGGER_GLOBAL} = runP264VComponentProbe;

function applyBasePresentation(`;
  return replaceExactlyOnce(source, marker, replacement, "component probe trigger");
}

function binCommand(name) {
  return join(ROOT, "node_modules", ".bin", `${name}${process.platform === "win32" ? ".cmd" : ""}`);
}

export function getIsolatedComponentProbeBuildSteps() {
  return [
    { label: "main", command: binCommand("tsc"), args: ["-p", "tsconfig.main.json"] },
    { label: "preload", command: binCommand("tsc"), args: ["-p", "tsconfig.preload.json"] },
    { label: "renderer", command: binCommand("vite"), args: ["build", "--config", "vite.config.ts"] }
  ];
}

function buildIsolatedComponentProbe(fixtureRoot) {
  for (const step of getIsolatedComponentProbeBuildSteps()) {
    const result = spawnSync(step.command, step.args, {
      cwd: fixtureRoot,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    if (result.error || result.status !== 0) throw new Error(`isolated-${step.label}-build-failed`);
  }
}

export function prepareIsolatedComponentProbe(fixtureRoot, workspaceRoot = ROOT) {
  const targetRoot = resolve(fixtureRoot);
  const sourceRoot = resolve(workspaceRoot);
  if (existsSync(targetRoot)) throw new Error("fixture-path-must-be-absent");
  assertRegularDirectory(sourceRoot, "workspace-root-reparse-rejected", "workspace-root-invalid");
  assertRegularDirectory(dirname(targetRoot), "model-fixture-target-reparse-rejected", "model-fixture-target-parent-invalid");
  const probeManifest = readProbeManifest(sourceRoot);

  mkdirSync(targetRoot);
  assertRegularDirectory(targetRoot, "model-fixture-target-reparse-rejected", "model-fixture-target-invalid");
  for (const entry of ["src", "public", "resources/models", "resources/icons"]) {
    assertRegularDirectory(join(sourceRoot, entry), "model-fixture-source-reparse-rejected", "model-fixture-source-invalid");
    assertRegularTree(join(sourceRoot, entry), "model-fixture-source-reparse-rejected", "model-fixture-source-invalid");
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
    const sourcePath = join(sourceRoot, file);
    assertRegularFile(sourcePath, "model-fixture-source-reparse-rejected", "model-fixture-source-invalid");
    copyFileSync(sourcePath, join(targetRoot, file));
  }

  const sourceManifestRoot = resolve(dirname(probeManifest.manifestPath), probeManifest.manifest.sourceDir);
  if (!isWithin(sourceRoot, sourceManifestRoot)) throw new Error("model-fixture-source-outside-workspace");
  assertRegularDirectory(sourceManifestRoot, "model-fixture-source-reparse-rejected", "model-fixture-source-invalid");
  copyDeclaredModelFixtureFiles(sourceManifestRoot, join(targetRoot, "model-fixture"), probeManifest.manifest);

  const fixtureManifestPath = join(targetRoot, "resources", "models", "witch", "model-manifest.json");
  const fixtureManifest = JSON.parse(readFileSync(fixtureManifestPath, "utf8"));
  fixtureManifest.sourceDir = "../../../model-fixture";
  fixtureManifest.motionPresets = [{
    id: P2_64V_TEAR_MOTION_ID,
    path: P2_64V_TEAR_MOTION_PATH,
    semanticKind: "reaction",
    loop: false,
    fadeInSeconds: 0.15,
    fadeOutSeconds: 0.2,
    durationHintSeconds: P2_64V_TEAR_DURATION_MS / 1_000,
    priority: 50,
    cooldownMs: 0,
    restorePolicy: "restore-current-state",
    allowedStates: ["idle"],
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    visualRisk: "needs-visual-check",
    assetLicenseStatus: "user-provided"
  }, ...(Array.isArray(fixtureManifest.motionPresets) ? fixtureManifest.motionPresets : [])];
  writeFileSync(fixtureManifestPath, `${JSON.stringify(fixtureManifest, null, 2)}\n`, "utf8");

  const fixtureMotionPath = join(targetRoot, "resources", "models", "witch", P2_64V_TEAR_MOTION_PATH);
  mkdirSync(dirname(fixtureMotionPath), { recursive: true });
  writeFileSync(fixtureMotionPath, `${JSON.stringify(P2_64V_TEAR_STIMULUS, null, 2)}\n`, "utf8");
  patchFile(join(targetRoot, "src", "shared", "pet-motion-presets.ts"), injectComponentProbeMotionPreset);
  patchFile(join(targetRoot, "src", "renderer", "pet", "interaction-actions.ts"), injectComponentProbeAction);
  patchFile(join(targetRoot, "src", "renderer", "pet", "interaction-action-player.ts"), injectComponentProbeReason);
  patchFile(join(targetRoot, "src", "renderer", "pet", "live2d", "cubism-expression.ts"), injectComponentProbeExpressionAppliedSignal);
  patchFile(join(targetRoot, "src", "renderer", "pet", "main.ts"), (source) => injectComponentProbeTrigger(source, probeManifest.angryExpressionName));

  return {
    angryExpressionName: probeManifest.angryExpressionName,
    angryExpressionPath: probeManifest.angryExpressionPath,
    fixtureMotionPath: relative(targetRoot, fixtureMotionPath).split(sep).join("/"),
    fixtureRoot: targetRoot,
    stageOrder: ["tear-parameters", "neutral-after-tear", "angry-expression", "neutral-after-angry"]
  };
}

export async function waitForComponentProbeTriggerAcceptance({
  trigger,
  timeoutMs = 10_000,
  intervalMs = 150,
  now = () => Date.now(),
  sleepFn = sleep
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    if (await trigger()) return true;
    if (now() >= deadline) break;
    await sleepFn(intervalMs);
  }
  throw new Error("component-probe-trigger-rejected");
}

export function createComponentProbeRunContext({ workspaceRoot = ROOT, port = 9697 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid-probe-port");
  const root = resolve(workspaceRoot);
  const tmpRoot = join(root, ".tmp");
  const runParentDir = join(tmpRoot, RUN_NAME);
  assertRegularDirectory(root, "workspace-root-reparse-rejected", "workspace-root-invalid");
  ensureRegularDirectory(tmpRoot, "probe-tmp-reparse-rejected", "probe-tmp-root-invalid");
  ensureRegularDirectory(runParentDir, "probe-run-parent-reparse-rejected", "probe-run-parent-invalid");
  const runDir = mkdtempSync(join(runParentDir, "run-"));
  assertRegularDirectory(runDir, "probe-run-directory-reparse-rejected", "probe-run-directory-invalid");
  return { root, runName: RUN_NAME, runParentDir, runDir, appDataDir: join(runDir, "user-data"), port, child: null, pages: [] };
}

export function cleanupOwnComponentProbeArtifacts(context, workspaceRoot = context?.root ?? ROOT) {
  if (!context || context.runName !== RUN_NAME || typeof context.root !== "string"
    || typeof context.runParentDir !== "string" || typeof context.runDir !== "string") {
    throw new Error("invalid-probe-run-directory");
  }
  const root = resolve(workspaceRoot);
  const runParentDir = join(root, ".tmp", RUN_NAME);
  const runDir = resolve(context.runDir);
  if (!sameResolvedPath(context.root, root) || !sameResolvedPath(context.runParentDir, runParentDir)
    || !sameResolvedPath(dirname(runDir), runParentDir) || !basename(runDir).startsWith("run-")) {
    throw new Error("invalid-probe-run-directory");
  }
  assertRegularDirectory(root, "workspace-root-reparse-rejected", "workspace-root-invalid");
  assertRegularDirectory(join(root, ".tmp"), "probe-tmp-reparse-rejected", "probe-tmp-root-invalid");
  assertRegularDirectory(runParentDir, "probe-run-parent-reparse-rejected", "probe-run-parent-invalid");
  assertRegularDirectory(runDir, "probe-run-directory-reparse-rejected", "probe-run-directory-invalid");
  removeOwnedEntry(runDir);
  if (readdirSync(runParentDir).length === 0) rmdirSync(runParentDir);
  return { runDirRemoved: !existsSync(runDir), runParentRemoved: !existsSync(runParentDir) };
}

function waitForProbeClose(context, signal) {
  return new Promise((resolveClose) => {
    const resolveOnce = () => resolveClose();
    if (context.child?.exitCode === null) context.child.once("exit", resolveOnce);
    else resolveOnce();
    signal.addEventListener("abort", resolveOnce, { once: true });
  });
}

async function main() {
  let context = null;
  const controller = new AbortController();
  const stopForInterrupt = () => controller.abort();
  process.once("SIGINT", stopForInterrupt);
  let failure = null;
  let opened = false;
  let fixture = null;
  let cleanup = { electronStopped: false, runDirRemoved: false, runParentRemoved: false };
  try {
    context = createComponentProbeRunContext({ port: Number(process.env.P2_64V_CDP_PORT ?? 9697) });
    fixture = prepareIsolatedComponentProbe(join(context.runDir, "isolated-app"));
    buildIsolatedComponentProbe(join(context.runDir, "isolated-app"));
    startIsolatedElectron(context, join(context.runDir, "isolated-app"));
    await connectToElectron(context, 40_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitFor(pet, "document.querySelector('#pet-canvas')?.width > 0", { timeoutMs: 20_000 });
    await waitFor(pet, `typeof globalThis.${TRIGGER_GLOBAL} === "function"`, { timeoutMs: 10_000 });
    await waitForComponentProbeTriggerAcceptance({
      trigger: () => evaluate(pet, `globalThis.${TRIGGER_GLOBAL}()`),
      timeoutMs: 12_000
    });
    opened = true;
    console.log(JSON.stringify({
      ok: true,
      status: "component-proof-open",
      isolatedFixture: true,
      stages: fixture.stageOrder,
      angryExpression: { name: fixture.angryExpressionName, resource: fixture.angryExpressionPath },
      visualDecision: "user-required",
      close: "Close the isolated desktop pet window or press Ctrl+C to finish and clean this probe."
    }, null, 2));
    await waitForProbeClose(context, controller.signal);
  } catch (error) {
    failure = publicError(error);
  } finally {
    process.removeListener("SIGINT", stopForInterrupt);
    if (context) {
      cleanup.electronStopped = await stopElectronAndVerify(context).catch(() => false);
      try {
        Object.assign(cleanup, cleanupOwnComponentProbeArtifacts(context));
      } catch (error) {
        failure ??= publicError(error);
      }
    }
  }
  const ok = opened && !failure && cleanup.electronStopped && cleanup.runDirRemoved;
  console.log(JSON.stringify({
    ok,
    status: ok ? "component-proof-closed" : "failed",
    isolatedFixture: true,
    visualDecision: "user-required",
    cleanup,
    ...(failure ? { failure } : {})
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
