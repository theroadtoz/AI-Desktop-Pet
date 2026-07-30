import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CURIOUS_FOCUS_PULSE_PROFILE,
  getCuriousFocusPulseProfileDigest,
  isCuriousFocusPulseProfile
} from "../src/renderer/pet/p2-88d-curious-low-preview-profile.ts";
import { createCuriousFocusPulsePreviewController } from "../src/renderer/pet/p2-88d-curious-low-preview-controller.ts";
import { cleanupP288dReviewRoot } from "./p2-88d-curious-low-preview-review-cleanup.mjs";

function createDirectoryJunction(target, linkPath) {
  symlinkSync(target, linkPath, "junction");
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true, "test setup must create a directory reparse point");
}

function removeDirectoryJunction(linkPath) {
  try {
    unlinkSync(linkPath);
  } catch {
    // The test may have removed the temporary target; a dangling junction still needs best-effort cleanup.
  }
}

test("P2-88D profile freezes the candidate schema and look-only curve", () => {
  assert.deepEqual(CURIOUS_FOCUS_PULSE_PROFILE, {
    schemaVersion: 1,
    id: "curious-focus-pulse-v1",
    status: "candidate",
    durationMs: 1150,
    lookTarget: [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 160, x: 0.18, y: 0.1 },
      { atMs: 620, x: 0.05, y: 0.03 }
    ]
  });
  assert.match(getCuriousFocusPulseProfileDigest(), /^[a-f0-9]{64}$/u);
  assert.equal(Object.keys(CURIOUS_FOCUS_PULSE_PROFILE).join(","), "schemaVersion,id,status,durationMs,lookTarget");
  assert.equal(
    CURIOUS_FOCUS_PULSE_PROFILE.lookTarget.every(({ atMs, x, y }) =>
      Number.isFinite(atMs) && Number.isFinite(x) && Number.isFinite(y)
    ),
    true
  );
});

test("P2-88D profile rejects non-finite values and every non-look extension", () => {
  assert.equal(isCuriousFocusPulseProfile(CURIOUS_FOCUS_PULSE_PROFILE), true);
  assert.equal(isCuriousFocusPulseProfile({ ...CURIOUS_FOCUS_PULSE_PROFILE, poseTarget: { x: 1 } }), false);
  assert.equal(isCuriousFocusPulseProfile({ ...CURIOUS_FOCUS_PULSE_PROFILE, expressionName: "happy" }), false);
  assert.equal(isCuriousFocusPulseProfile({ ...CURIOUS_FOCUS_PULSE_PROFILE, motionPresetId: "curious-peek" }), false);
  assert.equal(isCuriousFocusPulseProfile({
    ...CURIOUS_FOCUS_PULSE_PROFILE,
    lookTarget: [{ atMs: 0, x: Number.NaN, y: 0 }]
  }), false);
});

test("P2-88D preview applies the frozen focus curve and releases at 1150ms", () => {
  const calls: Array<[number, number]> = [];
  const scheduled = new Map<number, () => void>();
  let sequence = 0;
  const controller = createCuriousFocusPulsePreviewController({
    isLive2D: () => true,
    isInteractionActionActive: () => false,
    isRecoveringContext: () => false,
    setLookTarget: (x, y) => calls.push([x, y]),
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return ++sequence;
    },
    clearScheduledTimeout: () => undefined
  });

  assert.equal(controller.start(), true);
  assert.deepEqual(calls, [[0, 0]]);
  scheduled.get(160)!();
  scheduled.get(620)!();
  scheduled.get(1150)!();
  assert.deepEqual(calls, [[0, 0], [0.18, 0.1], [0.05, 0.03], [0, 0]]);
  assert.equal(controller.isActive(), false);
});

test("P2-88D preview fails closed for conflicts and has idempotent exception and disposal cleanup", () => {
  const calls: Array<[number, number]> = [];
  const scheduled = new Map<number, () => void>();
  let sequence = 0;
  let interactionActive = false;
  let recovering = false;
  let throwOnSet = false;
  const controller = createCuriousFocusPulsePreviewController({
    isLive2D: () => true,
    isInteractionActionActive: () => interactionActive,
    isRecoveringContext: () => recovering,
    setLookTarget: (x, y) => {
      if (throwOnSet) throw new Error("look_failed");
      calls.push([x, y]);
    },
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return ++sequence;
    },
    clearScheduledTimeout: () => undefined
  });

  controller.release();
  assert.deepEqual(calls, []);
  interactionActive = true;
  assert.equal(controller.start(), false);
  interactionActive = false;
  recovering = true;
  assert.equal(controller.start(), false);
  recovering = false;
  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  interactionActive = true;
  calls.push([0.7, -0.2]);
  scheduled.get(160)!();
  assert.equal(controller.isActive(), false);
  assert.deepEqual(calls, [[0, 0], [0.7, -0.2]]);
  controller.release();
  assert.deepEqual(calls, [[0, 0], [0.7, -0.2]]);

  interactionActive = false;
  throwOnSet = true;
  assert.equal(controller.start(), false);
  assert.equal(controller.isActive(), false);
  assert.deepEqual(calls, [[0, 0], [0.7, -0.2], [0, 0]]);
});

test("P2-88D preserves a new action owner that takes look control after focus", () => {
  const calls: Array<[number, number]> = [];
  const scheduled = new Map<number, () => void>();
  let interactionActive = false;
  const controller = createCuriousFocusPulsePreviewController({
    isLive2D: () => true,
    isInteractionActionActive: () => interactionActive,
    isRecoveringContext: () => false,
    setLookTarget: (x, y) => calls.push([x, y]),
    releaseLookTarget: () => calls.push([0, 0]),
    scheduleTimeout: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return delayMs;
    },
    clearScheduledTimeout: () => undefined
  });

  assert.equal(controller.start(), true);
  scheduled.get(160)!();
  interactionActive = true;
  calls.push([-0.6, 0.4]);
  scheduled.get(620)!();
  scheduled.get(1150)!();

  assert.equal(controller.isActive(), false);
  assert.deepEqual(calls, [[0, 0], [0.18, 0.1], [-0.6, 0.4]]);
});

test("P2-88D exposes only closed preview states for repeat, owner, recovery, release, and disposal", () => {
  const states: string[] = [];
  let interactionActive = false;
  let recovering = false;
  const controller = createCuriousFocusPulsePreviewController({
    isLive2D: () => true,
    isInteractionActionActive: () => interactionActive,
    isRecoveringContext: () => recovering,
    setLookTarget: () => undefined,
    releaseLookTarget: () => undefined,
    scheduleTimeout: () => 1,
    clearScheduledTimeout: () => undefined,
    reportStatus: (status) => states.push(status)
  });

  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  controller.release();
  interactionActive = true;
  assert.equal(controller.start(), false);
  interactionActive = false;
  recovering = true;
  assert.equal(controller.start(), false);
  controller.dispose();

  assert.deepEqual(states, [
    "idle",
    "active",
    "blocked-repeat",
    "released",
    "blocked-owner",
    "blocked-recovery",
    "disposed"
  ]);
});

test("P2-88D IPC is a fixed no-payload development acceptance command behind all three gates", () => {
  const main = readFileSync("src/main/app.ts", "utf8");
  const preload = readFileSync("src/preload/pet-preload.ts", "utf8");
  const contract = readFileSync("src/shared/ipc-contract.ts", "utf8");

  assert.match(contract, /P2_88D_CURIOUS_FOCUS_PULSE_PREVIEW_CHANNEL/);
  assert.match(contract, /type: "pet:p2-88d-curious-focus-pulse-preview"/);
  assert.match(preload, /ipcRenderer\.invoke\(P2_88D_CURIOUS_FOCUS_PULSE_PREVIEW_CHANNEL\)/);
  assert.match(preload, /ipcRenderer\.on\(P2_88D_CURIOUS_FOCUS_PULSE_PREVIEW_CHANNEL, listener\)/);
  assert.match(main, /!app\.isPackaged[\s\S]*AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1"[\s\S]*AI_DESKTOP_PET_P2_88D_CURIOUS_LOW_PREVIEW === "1"/);
  assert.match(main, /ipcMain\.handle\(P2_88D_CURIOUS_FOCUS_PULSE_PREVIEW_CHANNEL, \(event, \.\.\.payload: unknown\[\]\) =>/);
  assert.match(main, /payload\.length !== 0/);
});

test("P2-88D exposes focused and real-UI commands with a privacy-safe runner skeleton", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const cleanupHelper = readFileSync("scripts/p2-88d-curious-low-preview-review-cleanup.mjs", "utf8");

  assert.equal(
    packageJson.scripts["test:p2-88d-curious-low-preview"],
    "npm run build && node --test --experimental-strip-types scripts/p2-88d-curious-low-preview.test.mts scripts/p2-88d-recovery-first-frame-waiter.test.mts"
  );
  assert.equal(
    packageJson.scripts["accept:p2-88d-curious-low-preview"],
    "npm run build && node --no-warnings scripts/p2-88d-curious-low-preview-real-ui.mjs"
  );
  assert.match(runner, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY:\s*"1"/);
  assert.match(runner, /AI_DESKTOP_PET_P2_88D_CURIOUS_LOW_PREVIEW:\s*"1"/);
  assert.match(runner, /baseline/);
  assert.match(runner, /focusWindow/);
  assert.match(runner, /settleWindow/);
  assert.match(runner, /releaseWindow/);
  assert.match(runner, /Page\.captureScreenshot/);
  assert.match(runner, /p288dPreviewStatus/);
  assert.match(runner, /blocked-repeat/);
  assert.match(runner, /blocked-owner/);
  assert.match(runner, /blocked-recovery/);
  assert.match(runner, /WEBGL_lose_context/);
  assert.match(runner, /Page\.close/);
  assert.match(runner, /petPageClosed/);
  assert.match(runner, /runDirectoryRemoved/);
  assert.match(runner, /reviewDisposition/);
  assert.match(runner, /AI_DESKTOP_PET_P2_88D_REVIEW_DISPOSITION/);
  assert.match(runner, /const RELEASE_CAPTURE_DELAY_MS = 1300;/);
  assert.match(runner, /cleanupP288dReviewRoot/);
  assert.match(cleanupHelper, /relative\(taskRoot, reviewRoot\) !== "review"/);
  assert.ok(runner.indexOf('if (reviewDisposition === "cleanup")') < runner.indexOf("startElectron(context)"));
  assert.doesNotMatch(runner, /cleanupRealUiRun\(context\)/);
  assert.doesNotMatch(runner, /screenshotPath|requestId|POSITIVE_MESSAGE|typeText\(/);
});

test("P2-88D runner waits for renderer readiness and startup owner release before visual and repeat gates", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const readyIndex = runner.indexOf('waitForPreviewStatus(pet, "idle"');
  const startupTerminalIndex = runner.indexOf('reason === "startup_first_visible_frame"');
  const baselineIndex = runner.indexOf('summary.failureStage = "baseline"');
  const firstRepeatIndex = runner.indexOf('const firstRepeatRequestAccepted');
  const firstActiveIndex = runner.indexOf('waitForPreviewStatus(pet, "active")', firstRepeatIndex);
  const secondRepeatIndex = runner.indexOf('const secondRepeatRequestAccepted');
  const blockedRepeatIndex = runner.indexOf('waitForPreviewStatus(pet, "blocked-repeat")');

  assert.ok(readyIndex >= 0 && readyIndex < baselineIndex);
  assert.ok(startupTerminalIndex >= 0 && startupTerminalIndex < baselineIndex);
  assert.ok(firstRepeatIndex >= 0 && firstRepeatIndex < firstActiveIndex);
  assert.ok(firstActiveIndex >= 0 && firstActiveIndex < secondRepeatIndex);
  assert.ok(secondRepeatIndex >= 0 && secondRepeatIndex < blockedRepeatIndex);
});

test("P2-88D cleanup disposition decides before run stamp creation and leaves no task-root residue", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const cleanupHelper = readFileSync("scripts/p2-88d-curious-low-preview-review-cleanup.mjs", "utf8");
  const cleanupBranchIndex = runner.indexOf('if (reviewDisposition === "cleanup")');
  const contextCreationIndex = runner.indexOf("const context = createRealUiRunContext");

  assert.ok(cleanupBranchIndex >= 0 && cleanupBranchIndex < contextCreationIndex);
  assert.match(runner, /cleanupP288dReviewRoot\(\{\s*taskRoot: runParentDir,\s*frozenTaskRoot: runParentDir/);
  assert.match(cleanupHelper, /function resolveFrozenTaskRoot/);
  assert.match(cleanupHelper, /lstatSync/);
  assert.match(cleanupHelper, /RUN_STAMP_PATTERN/);
  assert.match(cleanupHelper, /rmdirSync/);
  assert.doesNotMatch(cleanupHelper, /rmSync\(resolvedTaskRoot,\s*\{\s*recursive:\s*true/);
  assert.match(runner, /taskRootCleaned/);
});

test("P2-88D runner reports only a closed recovery terminal and restored observation without lowering success", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const recoveryStartIndex = runner.indexOf("const recoveryTelemetryStart");
  const recoveryTerminalIndex = runner.indexOf("waitForRecoveryTerminal(context, recoveryTelemetryStart, 10_000)");

  assert.match(runner, /function waitForRecoveryTerminal\(context, startIndex, timeoutMs\)/);
  assert.match(runner, /"succeeded"/);
  assert.match(runner, /"failed"/);
  assert.match(runner, /"timeout"/);
  assert.match(runner, /contextRestoredObserved/);
  assert.ok(recoveryStartIndex >= 0 && recoveryStartIndex < recoveryTerminalIndex);
  assert.match(runner, /recoveryTerminal !== "succeeded"/);
});

test("P2-88D cleanup helper removes only review and an empty run stamp from its frozen root", () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  try {
    mkdirSync(join(taskRoot, "review"), { recursive: true });
    writeFileSync(join(taskRoot, "review", "frame.png"), "fixture");
    mkdirSync(join(taskRoot, "2026-07-30T02-27-02-454Z"));

    const result = cleanupP288dReviewRoot({
      taskRoot,
      frozenTaskRoot: taskRoot
    });

    assert.deepEqual(result, { reviewArtifactsCleaned: true, taskRootCleaned: true });
    assert.equal(existsSync(taskRoot), false);
  } finally {
    rmSync(taskRoot, { recursive: true, force: true });
  }
});

test("P2-88D cleanup helper fails closed without deleting review when an unknown nonempty item remains", () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  try {
    mkdirSync(join(taskRoot, "review"), { recursive: true });
    writeFileSync(join(taskRoot, "review", "frame.png"), "fixture");
    mkdirSync(join(taskRoot, "unexpected"));
    writeFileSync(join(taskRoot, "unexpected", "evidence.txt"), "keep");

    const result = cleanupP288dReviewRoot({
      taskRoot,
      frozenTaskRoot: taskRoot
    });

    assert.deepEqual(result, { reviewArtifactsCleaned: false, taskRootCleaned: false });
    assert.equal(existsSync(taskRoot), true);
    assert.equal(readFileSync(join(taskRoot, "review", "frame.png"), "utf8"), "fixture");
    assert.equal(readFileSync(join(taskRoot, "unexpected", "evidence.txt"), "utf8"), "keep");
  } finally {
    rmSync(taskRoot, { recursive: true, force: true });
  }
});

test("P2-88D cleanup helper rejects a mismatched frozen root before deletion", () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  const otherRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  try {
    mkdirSync(join(taskRoot, "review"), { recursive: true });
    writeFileSync(join(taskRoot, "review", "frame.png"), "fixture");

    assert.throws(
      () => cleanupP288dReviewRoot({ taskRoot, frozenTaskRoot: otherRoot }),
      /unsafe_task_root/
    );
    assert.equal(readFileSync(join(taskRoot, "review", "frame.png"), "utf8"), "fixture");
  } finally {
    rmSync(taskRoot, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test("P2-88D cleanup helper rejects a task-root junction without touching its target", () => {
  const junctionParent = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-junction-test-"));
  const targetRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-junction-target-"));
  const taskRoot = join(junctionParent, "task-root");
  try {
    mkdirSync(join(targetRoot, "review"), { recursive: true });
    writeFileSync(join(targetRoot, "review", "frame.png"), "target-fixture");
    createDirectoryJunction(targetRoot, taskRoot);

    assert.throws(
      () => cleanupP288dReviewRoot({ taskRoot, frozenTaskRoot: taskRoot }),
      /unsafe_task_root/
    );
    assert.equal(readFileSync(join(targetRoot, "review", "frame.png"), "utf8"), "target-fixture");
  } finally {
    removeDirectoryJunction(taskRoot);
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(junctionParent, { recursive: true, force: true });
  }
});

test("P2-88D cleanup helper rejects a review junction without deleting external or local evidence", () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  const externalReview = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-junction-target-"));
  const reviewLink = join(taskRoot, "review");
  try {
    writeFileSync(join(externalReview, "frame.png"), "external-review");
    mkdirSync(join(taskRoot, "z-other-review-evidence"));
    writeFileSync(join(taskRoot, "z-other-review-evidence", "keep.txt"), "local-evidence");
    createDirectoryJunction(externalReview, reviewLink);

    assert.throws(
      () => cleanupP288dReviewRoot({ taskRoot, frozenTaskRoot: taskRoot }),
      /unsafe_review_root/
    );
    assert.equal(readFileSync(join(externalReview, "frame.png"), "utf8"), "external-review");
    assert.equal(readFileSync(join(taskRoot, "z-other-review-evidence", "keep.txt"), "utf8"), "local-evidence");
  } finally {
    removeDirectoryJunction(reviewLink);
    rmSync(taskRoot, { recursive: true, force: true });
    rmSync(externalReview, { recursive: true, force: true });
  }
});

test("P2-88D cleanup helper rejects an ISO stamp junction with zero deletion", () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  const externalStamp = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-junction-target-"));
  const stampName = "2026-07-30T02-27-02-454Z";
  const stampLink = join(taskRoot, stampName);
  try {
    mkdirSync(join(taskRoot, "review"), { recursive: true });
    writeFileSync(join(taskRoot, "review", "frame.png"), "review-evidence");
    writeFileSync(join(externalStamp, "stamp.txt"), "external-stamp");
    createDirectoryJunction(externalStamp, stampLink);

    const result = cleanupP288dReviewRoot({ taskRoot, frozenTaskRoot: taskRoot });

    assert.deepEqual(result, { reviewArtifactsCleaned: false, taskRootCleaned: false });
    assert.equal(readFileSync(join(taskRoot, "review", "frame.png"), "utf8"), "review-evidence");
    assert.equal(readFileSync(join(externalStamp, "stamp.txt"), "utf8"), "external-stamp");
  } finally {
    removeDirectoryJunction(stampLink);
    rmSync(taskRoot, { recursive: true, force: true });
    rmSync(externalStamp, { recursive: true, force: true });
  }
});

test("P2-88D cleanup helper preserves review and a nonempty legal ISO stamp", () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "p2-88d-curious-low-preview-cleanup-test-"));
  const stampName = "2026-07-30T02-27-02-454Z";
  try {
    mkdirSync(join(taskRoot, "review"), { recursive: true });
    writeFileSync(join(taskRoot, "review", "frame.png"), "review-evidence");
    mkdirSync(join(taskRoot, stampName));
    writeFileSync(join(taskRoot, stampName, "evidence.txt"), "stamp-evidence");

    const result = cleanupP288dReviewRoot({ taskRoot, frozenTaskRoot: taskRoot });

    assert.deepEqual(result, { reviewArtifactsCleaned: false, taskRootCleaned: false });
    assert.equal(readFileSync(join(taskRoot, "review", "frame.png"), "utf8"), "review-evidence");
    assert.equal(readFileSync(join(taskRoot, stampName, "evidence.txt"), "utf8"), "stamp-evidence");
  } finally {
    rmSync(taskRoot, { recursive: true, force: true });
  }
});
