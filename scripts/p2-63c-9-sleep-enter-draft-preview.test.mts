import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertManagedRegularFile,
  assertPinnedCandidatePath,
  injectSleepEnterAction,
  injectSleepEnterFrameProbes,
  injectSleepEnterMotionProbes,
  injectSleepEnterPlayerProbes,
  injectSleepEnterPreset,
  injectSleepEnterTrigger,
  parseRunnerArgs,
  prepareIsolatedSleepEnterApp,
  readSleepEnterCandidate,
  runWithAbort,
  SLEEP_ENTER_PROTECTED_PATHS,
  summarizeLifecycle
} from "./p2-63c-9-sleep-enter-draft-preview.mjs";

const ROOT = resolve(".");
const SOURCE = "C:/Users/1/AppData/Roaming/Electron/motion-drafts/vts-drafts/sleep-enter-20260715-081933-048.motion3.json";
const TMP_ROOT = join(ROOT, ".tmp", "p2-63c-9-sleep-enter-draft-preview");

function makeTaskTempDir(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, `${prefix}-`));
}

test("CLI is fixed to the pinned sleep draft", () => {
  assert.deepEqual(parseRunnerArgs([]), { candidatePath: SOURCE });
  assert.throws(() => parseRunnerArgs(["--candidate-draft", SOURCE]), /no-cli-arguments-supported/u);
});

test("source validation pins the regular non-reparse sleep draft", () => {
  assert.equal(assertPinnedCandidatePath(), resolve(SOURCE));
  assert.equal(lstatSync(SOURCE).isFile(), true);
  assert.deepEqual(readSleepEnterCandidate().summary, {
    safeSummaryOnly: true,
    basename: "sleep-enter-20260715-081933-048.motion3.json",
    sha256: "8f1b0a28f35cfe12ef6eb6075ec4c545ef921842ba7ab625e04c5c95cc92b478",
    durationSeconds: 3,
    fps: 30,
    loop: false,
    curveCount: 3,
    segmentCount: 222,
    pointCount: 225,
    allowlist: ["ParamAngleY", "ParamEyeLOpen", "ParamEyeROpen"]
  });
});

test("candidate checker rejects a symlink path when Windows permits the fixture", (t) => {
  const root = makeTaskTempDir("symlink");
  const linkPath = join(root, "candidate-link.motion3.json");
  try {
    symlinkSync(SOURCE, linkPath, "file");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("Windows policy does not permit creating a symlink fixture");
      return;
    }
    throw error;
  }
  try {
    assert.throws(() => assertManagedRegularFile(linkPath, root), /candidate-reparse-path-rejected/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixture injection stays in the task temp root and includes frame ownership probes", () => {
  const root = makeTaskTempDir("fixture");
  const sourceBytes = readFileSync(SOURCE);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  try {
    assert.throws(
      () => prepareIsolatedSleepEnterApp(join(ROOT, "outside-fixture"), "test", { bytes: sourceBytes }),
      /fixture-outside-task-tmp/u
    );
    prepareIsolatedSleepEnterApp(join(root, "isolated"), "test", { bytes: sourceBytes });
    assert.equal(createHash("sha256").update(readFileSync(SOURCE)).digest("hex"), sourceHash);
    assert.equal(readFileSync(join(root, "isolated", "resources", "models", "witch", "motions", "sleep-enter-draft-preview.motion3.json")).equals(sourceBytes), true);
    assert.notEqual(
      lstatSync(join(ROOT, "model", "魔女.model3.json")).ino,
      lstatSync(join(root, "isolated", "model-fixture", "魔女.model3.json")).ino
    );
    const sourceModelFiles = readFileSync(join(ROOT, "model", "魔女.model3.json"));
    const fixtureModelFiles = readFileSync(join(root, "isolated", "model-fixture", "魔女.model3.json"));
    assert.equal(fixtureModelFiles.equals(sourceModelFiles), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("injections are sleep-only and include lifecycle and ownership release probes", () => {
  assert.match(injectSleepEnterPreset(readFileSync("src/shared/pet-motion-presets.ts", "utf8")), /sleep-enter-draft-preview[\s\S]*semanticKind: "sleep"/u);
  assert.match(injectSleepEnterAction(readFileSync("src/renderer/pet/interaction-actions.ts", "utf8")), /durationMs: 3000/u);
  assert.match(
    injectSleepEnterTrigger(readFileSync("src/renderer/pet/main.ts", "utf8"), "r"),
    /SLEEP_ENTER_TRIGGER__[\s\S]*live2DReady[\s\S]*currentPresenceModeId !== "sleep"/u
  );
  const playerProbe = injectSleepEnterPlayerProbes(readFileSync("src/renderer/pet/interaction-action-player.ts", "utf8"), "r");
  assert.match(playerProbe, /watchdog_fired/u);
  assert.match(playerProbe, /restore_completed/u);
  assert.match(injectSleepEnterMotionProbes(readFileSync("src/renderer/pet/live2d/cubism-motion.ts", "utf8"), "r"), /motion_loaded[\s\S]*stop_all_motions/u);
  assert.match(injectSleepEnterFrameProbes(readFileSync("src/renderer/pet/live2d/cubism-frame-pipeline.ts", "utf8"), "r"), /ownership_applied[\s\S]*ownership_released/u);
});

test("lifecycle requires protected ownership and a later release", () => {
  const stages = [
    "motion_loaded",
    "queued",
    "started",
    "ownership_applied",
    "completed",
    "restore_started",
    "restore_completed",
    "ownership_released"
  ];
  const events = stages.map((stage, atMs) => ({
    stage,
    atMs,
    runId: "r",
    ...(stage === "motion_loaded" ? {
      controlledParameterCount: 3,
      controlledParameterIds: ["ParamAngleY", "ParamEyeLOpen", "ParamEyeROpen"]
    } : {}),
    ...(stage === "ownership_applied" ? {
      protectedLayerValuesPreserved: true,
      overwrittenParameterIndexCount: 0
    } : {}),
    ...(stage === "ownership_released" ? { controlledParameterCount: 0 } : {})
  }));
  assert.equal(summarizeLifecycle(events, "r").passed, true);
  events[3].protectedLayerValuesPreserved = false;
  assert.equal(summarizeLifecycle(events, "r").passed, false);
});

test("hard timeout returns before a late operation settles", async () => {
  const controller = new AbortController();
  let lateOperationSettled = false;
  const startedAt = performance.now();
  await assert.rejects(
    runWithAbort(
      () => new Promise((resolveLate) => setTimeout(() => {
        lateOperationSettled = true;
        resolveLate("late");
      }, 80)),
      10,
      controller,
      { buildChild: null, child: null }
    ),
    /runner-hard-timeout/u
  );
  assert.equal(controller.signal.aborted, true);
  assert.ok(performance.now() - startedAt < 60);
  assert.equal(lateOperationSettled, false);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.equal(lateOperationSettled, true);
});

test("production protection list excludes fixture-only files", () => {
  assert.equal(SLEEP_ENTER_PROTECTED_PATHS.includes("resources/models/witch/model-manifest.json"), true);
  assert.equal(SLEEP_ENTER_PROTECTED_PATHS.includes("src/renderer/pet/main.ts"), true);
  assert.equal(SLEEP_ENTER_PROTECTED_PATHS.some((path) => path.includes("sleep-enter-draft-preview")), false);
});
