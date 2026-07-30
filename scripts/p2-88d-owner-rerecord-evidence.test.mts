import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync, inflateSync } from "node:zlib";

function createP288dOwnerEvidencePlan(input: unknown) {
  const result = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-88d-curious-low-preview-real-ui.mjs",
    "--test-owner-evidence-plan",
    JSON.stringify(input)
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "evidence_plan_failed");
  }
  return JSON.parse(result.stdout.trim());
}

function runProactiveSettingsPreseedFixture(input: unknown) {
  return spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-88d-curious-low-preview-real-ui.mjs",
    "--test-proactive-settings-preseed",
    JSON.stringify(input)
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000
  });
}

function runOwnerEvidenceFixture(mode: string, input: unknown) {
  const result = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-88d-curious-low-preview-real-ui.mjs",
    mode,
    JSON.stringify(input)
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "evidence_fixture_failed");
  return JSON.parse(result.stdout.trim());
}

function readPetWindowProbe(input: unknown) {
  return runOwnerEvidenceFixture("--test-pet-window-probe", input);
}

function readStableMainFirstFrameBarrier(input: unknown) {
  return runOwnerEvidenceFixture("--test-stable-main-first-frame-barrier", input);
}

function readRendererDiagnosticMode(input: unknown) {
  return runOwnerEvidenceFixture("--test-renderer-diagnostic-mode", input);
}

function readRendererDiagnosticCleanup(input: unknown) {
  return runOwnerEvidenceFixture("--test-renderer-diagnostic-cleanup", input);
}

function readChatRendererHealthProjection(input: unknown) {
  return runOwnerEvidenceFixture("--test-chat-renderer-health-projection", input);
}

function readChatRendererHealthOutput(input: unknown) {
  return runOwnerEvidenceFixture("--test-chat-renderer-health-output", input);
}

function runRunnerCli(args: string[], environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-88d-curious-low-preview-real-ui.mjs",
    ...args
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...environment }
  });
}

function runRendererEntrypoint(environment: NodeJS.ProcessEnv) {
  return runRunnerCli([], environment);
}


function makeFixturePng() {
  const width = 10;
  const height = 10;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      raw[pixel] = x * 10;
      raw[pixel + 1] = y * 10;
      raw[pixel + 2] = (x + y) * 10;
      raw[pixel + 3] = 255;
    }
  }
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[index] = value >>> 0;
  }
  const chunk = (type: string, data: Buffer) => {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0);
    result.write(type, 4, 4, "ascii");
    data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, data.length + 8)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function readFixturePng(png: Buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    assert.equal(packed[row * (width * 4 + 1)], 0, "fixture PNG uses unfiltered rows");
    packed.copy(pixels, row * width * 4, row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1));
  }
  return { width, height, pixels };
}

test("P2-88D rerecord plan derives full-body and face evidence from one viewport capture", () => {
  const plan = createP288dOwnerEvidencePlan({
    checkpoint: "focus",
    screenshot: { width: 2_000, height: 1_200 },
    viewport: { width: 1_000, height: 600 },
    canvas: { x: 100, y: 50, width: 800, height: 500 }
  });

  assert.deepEqual(plan, {
    checkpoint: "focus",
    fullBody: {
      fileName: "focus-full-body.png"
    },
    face: {
      fileName: "focus-face.png",
      rect: { x: 520, y: 140, width: 960, height: 420 }
    }
  });
});

test("P2-88D rerecord plan rejects a canvas that is outside its captured viewport", () => {
  assert.throws(
    () => createP288dOwnerEvidencePlan({
      checkpoint: "baseline",
      screenshot: { width: 2_000, height: 1_200 },
      viewport: { width: 1_000, height: 600 },
      canvas: { x: 850, y: 50, width: 200, height: 500 }
    }),
    /invalid_evidence_bounds/
  );
});

test("P2-88D rerecord evidence closes its owner review set to four paired checkpoints", () => {
  const checkpoints = ["baseline", "focus", "settle", "release"];

  const fileNames = checkpoints.flatMap((checkpoint) => {
    const plan = createP288dOwnerEvidencePlan({
      checkpoint,
      screenshot: { width: 1_000, height: 600 },
      viewport: { width: 1_000, height: 600 },
      canvas: { x: 100, y: 50, width: 800, height: 500 }
    });
    return [plan.fullBody.fileName, plan.face.fileName];
  });

  assert.deepEqual(fileNames, [
    "baseline-full-body.png", "baseline-face.png",
    "focus-full-body.png", "focus-face.png",
    "settle-full-body.png", "settle-face.png",
    "release-full-body.png", "release-face.png"
  ]);
});

test("P2-88D rerecord writes eight paired PNGs from one source per checkpoint without mutating the observed UI", () => {
  const reviewDir = mkdtempSync(join(tmpdir(), "p2-88d-evidence-"));
  try {
    const source = makeFixturePng();
    const surface = {
      bubbleDataStateHidden: true,
      bubbleAriaHidden: true,
      bubbleVisibilityHidden: true,
      bubbleOpacityZero: true,
      bubblePointerEventsNone: true,
      bodyOnlyCanvasAndHiddenBubble: true,
      onlyCanvasRenderable: true,
      viewport: { width: 10, height: 10 },
      canvas: { x: 0, y: 0, width: 10, height: 10 }
    };
    const result = runOwnerEvidenceFixture("--test-owner-evidence-artifacts", {
      reviewDir,
      screenshotBase64: source.toString("base64"),
      before: surface,
      after: surface
    });

    assert.deepEqual(result, { full: 4, face: 4, sameSource: 4, uiClean: 4 });
    assert.deepEqual(readdirSync(reviewDir).sort(), [
      "baseline-face.png", "baseline-full-body.png",
      "focus-face.png", "focus-full-body.png",
      "release-face.png", "release-full-body.png",
      "settle-face.png", "settle-full-body.png"
    ]);
    const full = readFixturePng(readFileSync(join(reviewDir, "focus-full-body.png")));
    const face = readFixturePng(readFileSync(join(reviewDir, "focus-face.png")));
    assert.deepEqual({ width: face.width, height: face.height }, { width: 6, height: 4 });
    assert.deepEqual(Array.from(face.pixels.subarray(0, 4)), Array.from(full.pixels.subarray((0 * full.width + 2) * 4, (0 * full.width + 3) * 4)));
    const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
    const petHtml = readFileSync("src/renderer/pet/index.html", "utf8");
    const petStyles = readFileSync("src/renderer/pet/styles.css", "utf8");
    assert.match(petHtml, /<button id="proactive-speech-bubble" type="button" data-state="hidden" aria-hidden="true" tabindex="-1"><\/button>/);
    assert.match(petStyles, /#proactive-speech-bubble\s*\{[\s\S]*?pointer-events:\s*none;[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;/);
    assert.doesNotMatch(runner, /bubbleHidden/);
    assert.match(runner, /bubbleDataStateHidden/);
    assert.doesNotMatch(runner, /bubbleStyle\.display\s*===\s*"none"/);
    assert.doesNotMatch(runner, /bubble\.hidden\s*=/);
    assert.doesNotMatch(runner, /bubble\.style\./);
    assert.doesNotMatch(runner, /bubble\.setAttribute\(/);
  } finally {
    rmSync(reviewDir, { recursive: true, force: true });
  }
});

test("P2-88D rerecord failure cleanup removes stamped evidence and run directories", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-88d-cleanup-"));
  const reviewDir = join(root, "review", "stamp");
  const runDir = join(root, "run");
  try {
    mkdirSync(reviewDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(reviewDir, "failure.png"), "evidence", { flag: "w" });
    writeFileSync(join(runDir, "telemetry.jsonl"), "telemetry", { flag: "w" });
    const result = runOwnerEvidenceFixture("--test-owner-evidence-cleanup", { reviewDir, runDir });
    assert.deepEqual(result, { reviewDirectoryRemoved: true, runDirectoryRemoved: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P2-88D rerecord fails closed when capture geometry changes after the screenshot", () => {
  const reviewDir = mkdtempSync(join(tmpdir(), "p2-88d-geometry-"));
  try {
    const source = makeFixturePng();
    const before = {
      bubbleDataStateHidden: true, bubbleAriaHidden: true, bubbleVisibilityHidden: true,
      bubbleOpacityZero: true, bubblePointerEventsNone: true,
      bodyOnlyCanvasAndHiddenBubble: true, onlyCanvasRenderable: true,
      viewport: { width: 10, height: 10 }, canvas: { x: 0, y: 0, width: 10, height: 10 }
    };
    assert.throws(() => runOwnerEvidenceFixture("--test-owner-evidence-artifacts", {
      reviewDir,
      screenshotBase64: source.toString("base64"),
      before,
      after: { ...before, canvas: { ...before.canvas, width: 9 } }
    }), /capture_geometry_changed/);
  } finally {
    rmSync(reviewDir, { recursive: true, force: true });
  }
});

test("P2-88D pet-window probe maps only closed discovery and renderer readiness codes", () => {
  const cases = [
    [{ stage: "pet_renderer_api", operation: "preview_api", errorMessage: "Timed out waiting for: Boolean(window.petApi?.triggerCuriousFocusPulsePreviewForAcceptance)" }, "preview_api_timeout"],
    [{ stage: "pet_renderer_api", operation: "preview_api", errorMessage: "Runtime.evaluate failed" }, "preview_api_evaluate_failed"],
    [{ stage: "pet_renderer_api", operation: "preview_status", errorMessage: "Runtime.evaluate failed" }, "preview_status_evaluate_failed"],
    [{ stage: "pet_renderer_api", operation: "startup_telemetry", errorMessage: "EACCES" }, "startup_telemetry_io_failed"]
  ] as const;

  for (const [input, petWindowProbeCode] of cases) {
    const probe = readPetWindowProbe({ ...input, childExitedEarly: true, boundedTargetCount: 99, targetConnected: true, previewApiReady: true });
    assert.deepEqual(probe, {
      petWindowProbeCode,
      childExitedEarly: true,
      boundedTargetCount: 8,
      targetConnected: true,
      previewApiReady: true
    });
  }
});

test("P2-88D pet-window probe directly projects structured discovery codes and safe counts", () => {
  const probe = readPetWindowProbe({
    stage: "pet_target_discovery",
    targetDiscoveryCode: "target_entry_shape_invalid",
    targetMetadata: {
      listReadable: true,
      pageTargetCount: 12,
      petTargetCount: 1,
      chatTargetCount: 1,
      otherPageTargetCount: 10,
      invalidTargetCount: 2,
      matchingCandidateCount: 11,
      attemptedCandidateCount: 9,
      attachPhase: "page",
      attachFailureKind: "protocol_error",
      url: "file:///secret/never-output.html",
      title: "secret"
    },
    childExitedEarly: false,
    targetConnected: false,
    previewApiReady: false
  });
  assert.deepEqual(probe, {
    petWindowProbeCode: "target_entry_shape_invalid",
    childExitedEarly: false,
    boundedTargetCount: 8,
    targetConnected: false,
    previewApiReady: false,
    listReadable: true,
    petTargetCount: 1,
    chatTargetCount: 1,
    otherPageTargetCount: 8,
    invalidTargetCount: 2,
    matchingCandidateCount: 8,
    attemptedCandidateCount: 8,
    attachPhase: "page",
    attachFailureKind: "protocol_error"
  });
  assert.equal(JSON.stringify(probe).includes("secret"), false);

  const unknownCodeProbe = readPetWindowProbe({
    stage: "pet_target_discovery",
    targetDiscoveryCode: "file:///secret/not-a-diagnostic-code",
    targetMetadata: {},
    childExitedEarly: false,
    targetConnected: false,
    previewApiReady: false
  });
  assert.equal(unknownCodeProbe.petWindowProbeCode, "target_list_unreadable");
  assert.equal(JSON.stringify(unknownCodeProbe).includes("secret"), false);
});

test("P2-88D stable main first-frame barrier rejects an old first_frame before renderer loss and accepts a later replacement first_frame", () => {
  const result = readStableMainFirstFrameBarrier({
    timeoutMs: 200,
    tickMs: 100,
    batches: [
      [
        { type: "first_frame", payload: { url: "file:///old-first-frame" } },
        { type: "renderer_process_gone", payload: { reason: "crashed", exitCode: 137, title: "secret" } }
      ],
      [
        { type: "first_frame", payload: { url: "file:///old-first-frame" } },
        { type: "renderer_process_gone", payload: { reason: "crashed", exitCode: 137, title: "secret" } },
        { type: "recovery_started", payload: { source: "webgl_context_restored", url: "file:///not-main-recovery" } },
        { type: "recovery_limit_reached", payload: { path: "E:/secret" } },
        { type: "first_frame", payload: { text: "replacement-first-frame" } }
      ]
    ]
  });
  assert.deepEqual(result, {
    mainFirstFrameCount: 2,
    stableMainFirstFrameObserved: true,
    rendererGoneReasonHistogram: {
      "clean-exit": 0,
      "abnormal-exit": 0,
      killed: 0,
      crashed: 1,
      oom: 0,
      "launch-failed": 0,
      "integrity-failure": 0
    },
    lastRendererGoneExitCode: 137,
    rendererProcessGoneRecoveryStartedCount: 0,
    recoveryLimitReachedCount: 1
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("replacement-first-frame"), false);

  assert.deepEqual(readStableMainFirstFrameBarrier({
    timeoutMs: 100,
    tickMs: 100,
    batches: [[
      { type: "first_frame", payload: { text: "old" } },
      { type: "renderer_process_gone", payload: { reason: "oom", exitCode: 9 } }
    ]]
  }), {
    mainFirstFrameCount: 1,
    stableMainFirstFrameObserved: false,
    rendererGoneReasonHistogram: {
      "clean-exit": 0,
      "abnormal-exit": 0,
      killed: 0,
      crashed: 0,
      oom: 1,
      "launch-failed": 0,
      "integrity-failure": 0
    },
    lastRendererGoneExitCode: 9,
    rendererProcessGoneRecoveryStartedCount: 0,
    recoveryLimitReachedCount: 0
  });
});

test("P2-88D stable main first-frame barrier filters recovery source and fails closed for unknown renderer-gone reasons or unsafe exit codes", () => {
  const result = readStableMainFirstFrameBarrier({
    timeoutMs: 100,
    tickMs: 100,
    batches: [[
      { type: "first_frame", payload: { text: "fresh" } },
      { type: "recovery_started", payload: { source: "webgl_context_restored" } },
      { type: "renderer_process_gone", payload: { reason: "file:///secret-not-a-reason", exitCode: 2 ** 40 } },
      { type: "recovery_started", payload: { source: "renderer_process_gone", message: "secret" } },
      { type: "first_frame", payload: { url: "file:///replacement" } }
    ]]
  });

  assert.deepEqual(result, {
    mainFirstFrameCount: 2,
    stableMainFirstFrameObserved: true,
    rendererGoneReasonHistogram: {
      "clean-exit": 0,
      "abnormal-exit": 0,
      killed: 0,
      crashed: 0,
      oom: 0,
      "launch-failed": 0,
      "integrity-failure": 0
    },
    lastRendererGoneExitCode: null,
    rendererProcessGoneRecoveryStartedCount: 1,
    recoveryLimitReachedCount: 0
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("P2-88D stable main first-frame barrier caps closed aggregate counts and times out without a qualifying first_frame", () => {
  const rendererGoneEvents = Array.from({ length: 9 }, () => ({
    type: "renderer_process_gone",
    payload: { reason: "crashed", exitCode: 1 }
  }));
  const rendererRecoveryEvents = Array.from({ length: 9 }, () => ({
    type: "recovery_started",
    payload: { source: "renderer_process_gone" }
  }));
  const recoveryLimitEvents = Array.from({ length: 9 }, () => ({ type: "recovery_limit_reached", payload: {} }));
  const result = readStableMainFirstFrameBarrier({
    timeoutMs: 100,
    tickMs: 100,
    batches: [[...rendererGoneEvents, ...rendererRecoveryEvents, ...recoveryLimitEvents]]
  });

  assert.deepEqual(result, {
    mainFirstFrameCount: 0,
    stableMainFirstFrameObserved: false,
    rendererGoneReasonHistogram: {
      "clean-exit": 0,
      "abnormal-exit": 0,
      killed: 0,
      crashed: 8,
      oom: 0,
      "launch-failed": 0,
      "integrity-failure": 0
    },
    lastRendererGoneExitCode: 1,
    rendererProcessGoneRecoveryStartedCount: 8,
    recoveryLimitReachedCount: 8
  });
});

test("P2-88D R7 renderer diagnostic mode has only mutually exclusive runner-only launch variants", () => {
  assert.deepEqual(readRendererDiagnosticMode({}), {
    diagnosticOnly: false,
    mode: null,
    electronArgs: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  assert.deepEqual(readRendererDiagnosticMode({ mode: "disable-gpu" }), {
    diagnosticOnly: true,
    mode: "disable-gpu",
    electronArgs: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"]
  });
  assert.deepEqual(readRendererDiagnosticMode({ mode: "no-unsafe-swiftshader" }), {
    diagnosticOnly: true,
    mode: "no-unsafe-swiftshader",
    electronArgs: ["--use-angle=swiftshader"]
  });
  assert.deepEqual(readRendererDiagnosticMode({ mode: "opaque-pet-window" }), {
    diagnosticOnly: true,
    mode: "opaque-pet-window",
    electronArgs: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  assert.deepEqual(readRendererDiagnosticMode({ mode: "chat-renderer-health" }), {
    diagnosticOnly: true,
    mode: "chat-renderer-health",
    electronArgs: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  assert.throws(
    () => readRendererDiagnosticMode({ mode: "file:///secret/unsupported" }),
    /invalid_renderer_diagnostic_mode/
  );
});

test("P2-88D R7 rejects an unknown renderer diagnostic mode before Electron without leaking the supplied value", () => {
  const result = runRendererEntrypoint({
    AI_DESKTOP_PET_P2_88D_RENDERER_DIAG_MODE: "file:///secret/unsupported"
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    ok: false,
    runtimePath: "not_started",
    diagnosticOnly: true,
    diagnosticMode: null,
    diagnosticPassed: false,
    failure: "invalid_renderer_diagnostic_mode",
    checks: {
      electronStarted: false,
      reviewArtifactsCreated: false,
      cleanupCompleted: true
    }
  });
  assert.equal(`${result.stdout}${result.stderr}`.includes("secret"), false);
});

test("P2-88D R7 diagnostic mode rejects before Electron and stops after the stable main first-frame barrier without evidence or acceptance", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const modeResolveIndex = runner.indexOf("rendererDiagnosticMode = resolveRendererDiagnosticMode");
  const electronStartIndex = runner.indexOf("startElectron(context)");
  const barrierIndex = runner.indexOf('summary.failureStage = "stable_main_first_frame_barrier"');
  const diagnosticBranchStart = runner.indexOf("if (isRendererDiagnosticRun) {");
  const diagnosticBranchEnd = runner.indexOf("} else {", diagnosticBranchStart);
  const targetDiscoveryIndex = runner.indexOf('summary.failureStage = "pet_target_discovery"');
  const diagnosticBranch = runner.slice(diagnosticBranchStart, diagnosticBranchEnd);

  assert.ok(modeResolveIndex >= 0 && modeResolveIndex < electronStartIndex);
  assert.ok(barrierIndex >= 0 && barrierIndex < diagnosticBranchStart && diagnosticBranchStart < targetDiscoveryIndex);
  assert.match(runner, /if \(!isRendererDiagnosticRun\) \{\s*mkdirSync\(reviewDir, \{ recursive: true \}\);/);
  assert.match(diagnosticBranch, /diagnosticOnly: true/);
  assert.match(diagnosticBranch, /diagnosticBarrierPassed: true/);
  assert.match(diagnosticBranch, /diagnosticPassed: false/);
  assert.match(diagnosticBranch, /reviewArtifactsCreated: false/);
  assert.doesNotMatch(diagnosticBranch, /waitForWindow|capturePetEvidencePair|triggerCuriousFocusPulsePreviewForAcceptance|clickPetBody|loseAndRestoreWebGLContext|Page\.close/);
  assert.match(runner, /const diagnosticPassed = summary\.diagnosticOnly === true && resolveRendererDiagnosticCompletion/);
  assert.match(runner, /diagnosticPassed !== true/);
  assert.match(runner, /invalid_renderer_diagnostic_mode/);
});

test("P2-88D R7 declares a strict CLI dispatcher and diagnostic cleanup completion gate before using the runner entrypoint", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  assert.match(runner, /function resolveRunnerInvocation\(args\)/);
  assert.match(runner, /function resolveRendererDiagnosticCompletion\(/);
  assert.match(runner, /resolveRunnerInvocation\(process\.argv\.slice\(2\)\)/);
  assert.match(runner, /const diagnosticPassed = summary\.diagnosticOnly === true && resolveRendererDiagnosticCompletion/);
  assert.match(runner, /if \(args\.length === 0\) return \{ kind: "main" \};/);
  assert.match(runner, /args\.length === 2 && RUNNER_TEST_MODE_SET\.has\(args\[0\]\)/);
  assert.ok(runner.indexOf("const runnerInvocation = resolveRunnerInvocation") < runner.lastIndexOf("await main()"));
});

test("P2-88D R7 rejects unknown and over-specified CLI invocations before Electron", () => {
  const cases = [
    ["--test-unrecognized", JSON.stringify({ path: "file:///secret/unknown" })],
    ["--test-renderer-diagnostic-mode", "{}", "--unexpected-extra"],
    ["--test-owner-evidence-plan", "{}", "--test-renderer-diagnostic-mode", "{}"]
  ];
  for (const args of cases) {
    const result = runRunnerCli(args);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      ok: false,
      runtimePath: "not_started",
      failure: "invalid_runner_arguments",
      checks: {
        electronStarted: false,
        cleanupCompleted: true
      }
    });
    assert.equal(`${result.stdout}${result.stderr}`.includes("secret"), false);
  }
});

test("P2-88D R7 diagnostic completion needs a clean stop and complete directory cleanup", () => {
  const clean = {
    diagnosticBarrierPassed: true,
    pageCleanupCompleted: true,
    processCleanupCompleted: true,
    reviewDirectoryRemoved: true,
    runDirectoryRemoved: true,
    cleanupErrors: []
  };
  assert.deepEqual(readRendererDiagnosticCleanup(clean), { diagnosticPassed: true });
  assert.deepEqual(readRendererDiagnosticCleanup({
    ...clean,
    processCleanupCompleted: false,
    cleanupErrors: ["stop_electron_failed"]
  }), { diagnosticPassed: false });
  assert.deepEqual(readRendererDiagnosticCleanup({
    ...clean,
    reviewDirectoryRemoved: false
  }), { diagnosticPassed: false });
  assert.deepEqual(readRendererDiagnosticCleanup({
    ...clean,
    runDirectoryRemoved: false
  }), { diagnosticPassed: false });
});

test("P2-88D R8 chat renderer health projects only safe ready state and attach metadata", () => {
  assert.deepEqual(readChatRendererHealthProjection({
    chatTargetAttached: true,
    chatRuntimeReady: true,
    chatDocumentReady: true
  }), {
    failure: null,
    checks: {
      chatTargetAttached: true,
      chatRuntimeReady: true,
      chatDocumentReady: true,
      chatAttachCode: null,
      chatTargetListReadable: false,
      chatTargetCount: 0,
      chatAttemptedCandidateCount: 0,
      chatAttachPhase: null,
      chatAttachFailureKind: null
    }
  });

  const attachFailure = readChatRendererHealthProjection({
    stage: "chat_target_discovery",
    errorCode: "cdp_attach_failed",
    targetMetadata: {
      listReadable: true,
      chatTargetCount: 1,
      attemptedCandidateCount: 1,
      attachPhase: "runtime",
      attachFailureKind: "command_timeout",
      url: "file:///secret/chat.html",
      title: "secret title"
    }
  });
  assert.deepEqual(attachFailure, {
    failure: "cdp_attach_failed",
    checks: {
      chatTargetAttached: false,
      chatRuntimeReady: false,
      chatDocumentReady: false,
      chatAttachCode: "cdp_attach_failed",
      chatTargetListReadable: true,
      chatTargetCount: 1,
      chatAttemptedCandidateCount: 1,
      chatAttachPhase: "runtime",
      chatAttachFailureKind: "command_timeout"
    }
  });
  assert.equal(JSON.stringify(attachFailure).includes("secret"), false);
});

test("P2-88D R8 chat renderer health fails closed for a false document result or an evaluation timeout", () => {
  assert.deepEqual(readChatRendererHealthProjection({
    stage: "chat_document_ready",
    chatTargetAttached: true,
    chatRuntimeReady: true,
    chatDocumentReady: false,
    errorMessage: "chat_document_not_ready"
  }), {
    failure: "chat_document_not_ready",
    checks: {
      chatTargetAttached: true,
      chatRuntimeReady: true,
      chatDocumentReady: false,
      chatAttachCode: null,
      chatTargetListReadable: false,
      chatTargetCount: 0,
      chatAttemptedCandidateCount: 0,
      chatAttachPhase: null,
      chatAttachFailureKind: null
    }
  });
  assert.equal(readChatRendererHealthProjection({
    stage: "chat_document_ready",
    errorMessage: "command_timeout file:///secret"
  }).failure, "chat_document_ready_timeout");
});

test("P2-88D R8 chat mode attaches the chat target after CDP and bypasses the pet stable-frame barrier", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const chatBranchStart = runner.indexOf('if (rendererDiagnosticMode === "chat-renderer-health") {');
  const chatBranchEnd = runner.indexOf("} else {", chatBranchStart);
  const chatBranch = runner.slice(chatBranchStart, chatBranchEnd);

  assert.ok(chatBranchStart >= 0 && chatBranchEnd > chatBranchStart);
  assert.ok(runner.indexOf("await connectToElectron(context, 30_000)") < chatBranchStart);
  assert.match(chatBranch, /waitForWindow\(context, "renderer\/chat\/index\.html", 30_000\)/);
  assert.match(chatBranch, /CHAT_RENDERER_DOCUMENT_READY_EXPRESSION/);
  assert.doesNotMatch(chatBranch, /waitForStableMainFirstFrameBarrier|renderer\/pet\/index\.html|capturePetEvidencePair|triggerCuriousFocusPulsePreviewForAcceptance|Page\.close/);
});

test("P2-88D R8 chat renderer stdout contains only health booleans, diagnostic status, and safe attach metadata", () => {
  const output = readChatRendererHealthOutput({
    diagnosticMode: "chat-renderer-health",
    diagnosticPassed: true,
    checks: {
      chatTargetAttached: true,
      chatRuntimeReady: true,
      chatDocumentReady: true,
      chatAttachCode: null,
      chatTargetListReadable: true,
      chatTargetCount: 1,
      chatAttemptedCandidateCount: 1,
      chatAttachPhase: "page",
      chatAttachFailureKind: null,
      url: "file:///secret/chat.html",
      title: "secret"
    }
  });
  assert.deepEqual(output, {
    diagnosticOnly: true,
    mode: "chat-renderer-health",
    diagnosticPassed: true,
    chatTargetAttached: true,
    chatRuntimeReady: true,
    chatDocumentReady: true,
    chatAttachCode: null,
    chatTargetListReadable: true,
    chatTargetCount: 1,
    chatAttemptedCandidateCount: 1,
    chatAttachPhase: "page",
    chatAttachFailureKind: null
  });
  assert.equal(JSON.stringify(output).includes("secret"), false);
});

test("P2-88D pet-window probe never serializes raw errors, targets, DOM, or paths", () => {
  const probe = readPetWindowProbe({
    stage: "pet_renderer_api",
    operation: "preview_api",
    errorMessage: "file:///E:/private/prompt.txt token=secret",
    childExitedEarly: false,
    boundedTargetCount: -1,
    targetConnected: false,
    previewApiReady: false
  });
  assert.deepEqual(Object.keys(probe), [
    "petWindowProbeCode", "childExitedEarly", "boundedTargetCount", "targetConnected", "previewApiReady"
  ]);
  assert.equal(JSON.stringify(probe).includes("secret"), false);
  assert.equal(JSON.stringify(probe).includes("prompt.txt"), false);
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  assert.match(runner, /"preview_renderer_not_ready"/);
  assert.match(runner, /"startup_action_not_finished"/);
  assert.deepEqual(readPetWindowProbe({
    stage: "pet_renderer_api",
    operation: "known_timeout",
    childExitedEarly: false,
    boundedTargetCount: 1,
    targetConnected: true,
    previewApiReady: true
  }), {
    petWindowProbeCode: null,
    childExitedEarly: false,
    boundedTargetCount: 1,
    targetConnected: true,
    previewApiReady: true
  });
});

test("P2-88D R9 preloads the complete cadence-off settings inside isolated userData", () => {
  const appDataDir = mkdtempSync(join(tmpdir(), "p2-88d-r9-settings-"));
  try {
    const result = runProactiveSettingsPreseedFixture({ appDataDir, diagnosticMode: null });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      preseeded: true,
      settingsPathInsideUserData: true,
      settings: {
        cadence: "off",
        memorySourceBubbles: true,
        searchSourceBubbles: true
      },
      tempResidueCount: 0,
      electronStarted: false
    });
    assert.deepEqual(
      JSON.parse(readFileSync(join(appDataDir, "config", "proactive-companion-settings.json"), "utf8")),
      {
        cadence: "off",
        memorySourceBubbles: true,
        searchSourceBubbles: true
      }
    );
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }
});

test("P2-88D R9 leaves every renderer diagnostic mode without a proactive settings preseed", () => {
  for (const diagnosticMode of ["disable-gpu", "no-unsafe-swiftshader", "opaque-pet-window", "chat-renderer-health"]) {
    const appDataDir = mkdtempSync(join(tmpdir(), "p2-88d-r9-diagnostic-"));
    try {
      const result = runProactiveSettingsPreseedFixture({ appDataDir, diagnosticMode });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()), {
        preseeded: false,
        settingsPathInsideUserData: true,
        settings: null,
        tempResidueCount: 0,
        electronStarted: false
      });
      assert.equal(
        readdirSync(appDataDir, { recursive: true }).some((entry) => String(entry).includes("proactive-companion-settings")),
        false
      );
    } finally {
      rmSync(appDataDir, { recursive: true, force: true });
    }
  }
});

test("P2-88D R9 fail-closes the full owner run before Electron without opening the P2-83A injection gate", () => {
  const runner = readFileSync("scripts/p2-88d-curious-low-preview-real-ui.mjs", "utf8");
  const mainStart = runner.indexOf("async function main()");
  const mainEnd = runner.indexOf("const runnerInvocation", mainStart);
  const mainBody = runner.slice(mainStart, mainEnd);
  const preseedIndex = mainBody.indexOf("prepareIsolatedProactiveCadenceOff(context, rendererDiagnosticMode)");
  const electronStartIndex = mainBody.indexOf("startElectron(context)");

  assert.ok(preseedIndex >= 0);
  assert.ok(electronStartIndex > preseedIndex);
  assert.match(mainBody.slice(preseedIndex, electronStartIndex), /electronStarted\s*!==\s*false/);
  assert.doesNotMatch(runner, /AI_DESKTOP_PET_P2_83A_SAFE_INJECTION|injectProactiveBubbleCandidateForAcceptance|pet:p2-83a-inject-candidate/);
});

test("P2-88D R9 removes atomic temp files and rejects write rename parse or unsafe-path failures", () => {
  for (const failurePhase of ["write", "rename", "parse"]) {
    const appDataDir = mkdtempSync(join(tmpdir(), `p2-88d-r9-${failurePhase}-`));
    try {
      const result = runProactiveSettingsPreseedFixture({ appDataDir, diagnosticMode: null, failurePhase });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.trim(), "proactive_settings_preseed_failed");
      assert.equal(
        readdirSync(appDataDir, { recursive: true }).some((entry) => String(entry).endsWith(".tmp")),
        false
      );
    } finally {
      rmSync(appDataDir, { recursive: true, force: true });
    }
  }

  const relativePathResult = runProactiveSettingsPreseedFixture({
    appDataDir: "relative-user-data",
    diagnosticMode: null
  });
  assert.equal(relativePathResult.status, 1);
  assert.equal(relativePathResult.stdout, "");
  assert.equal(relativePathResult.stderr.trim(), "proactive_settings_preseed_failed");
});
