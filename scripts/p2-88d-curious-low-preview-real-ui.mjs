import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import {
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  stopElectron,
  TargetDiscoveryError,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { cleanupP288dReviewRoot } from "./p2-88d-curious-low-preview-review-cleanup.mjs";

const FOCUS_CAPTURE_DELAY_MS = 220;
const SETTLE_CAPTURE_DELAY_MS = 560;
const RELEASE_CAPTURE_DELAY_MS = 1300;
const STABLE_MAIN_FIRST_FRAME_BARRIER_TIMEOUT_MS = 15_000;
const SAFE_TELEMETRY_COUNT_CAP = 8;
const RENDERER_GONE_EXIT_CODE_MIN = -2_147_483_648;
const RENDERER_GONE_EXIT_CODE_MAX = 2_147_483_647;
const RUN_NAME = "p2-88d-curious-low-preview-real-ui";
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OWNER_REVIEW_CHECKPOINTS = new Set(["baseline", "focus", "settle", "release"]);
const RENDERER_PROCESS_GONE_REASONS = [
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure"
];
const RENDERER_PROCESS_GONE_REASON_SET = new Set(RENDERER_PROCESS_GONE_REASONS);
const RENDERER_DIAGNOSTIC_MODE_SET = new Set(["disable-gpu", "no-unsafe-swiftshader", "opaque-pet-window", "chat-renderer-health"]);
const CHAT_RENDERER_DOCUMENT_READY_EXPRESSION = "document.readyState === 'interactive' || document.readyState === 'complete'";
const RUNNER_TEST_MODE_SET = new Set([
  "--test-owner-evidence-plan",
  "--test-owner-evidence-artifacts",
  "--test-owner-evidence-cleanup",
  "--test-pet-window-probe",
  "--test-stable-main-first-frame-barrier",
  "--test-renderer-diagnostic-mode",
  "--test-renderer-diagnostic-cleanup",
  "--test-chat-renderer-health-projection",
  "--test-chat-renderer-health-output",
  "--test-proactive-settings-preseed"
]);
const TARGET_DISCOVERY_CODES = new Set([
  "target_list_unreadable",
  "target_list_shape_invalid",
  "target_entry_shape_invalid",
  "target_not_found",
  "cdp_attach_failed"
]);
const PET_WINDOW_PROBE_CODES = new Set([
  ...TARGET_DISCOVERY_CODES,
  "preview_api_timeout",
  "preview_api_evaluate_failed",
  "preview_status_evaluate_failed",
  "startup_telemetry_io_failed"
]);

function createPetWindowProbe({ stage, operation, error, errorMessage, childExitedEarly, boundedTargetCount, targetConnected, previewApiReady }) {
  if (stage === "pet_target_discovery" && error instanceof TargetDiscoveryError) {
    const metadata = error.metadata ?? {};
    return {
      petWindowProbeCode: TARGET_DISCOVERY_CODES.has(error.code) ? error.code : "target_list_unreadable",
      childExitedEarly: childExitedEarly === true,
      boundedTargetCount: Math.min(8, Math.max(0, Number.isInteger(metadata.pageTargetCount) ? metadata.pageTargetCount : 0)),
      targetConnected: targetConnected === true,
      previewApiReady: previewApiReady === true,
      listReadable: metadata.listReadable === true,
      petTargetCount: Math.min(8, Math.max(0, Number.isInteger(metadata.petTargetCount) ? metadata.petTargetCount : 0)),
      chatTargetCount: Math.min(8, Math.max(0, Number.isInteger(metadata.chatTargetCount) ? metadata.chatTargetCount : 0)),
      otherPageTargetCount: Math.min(8, Math.max(0, Number.isInteger(metadata.otherPageTargetCount) ? metadata.otherPageTargetCount : 0)),
      invalidTargetCount: Math.min(8, Math.max(0, Number.isInteger(metadata.invalidTargetCount) ? metadata.invalidTargetCount : 0)),
      matchingCandidateCount: Math.min(8, Math.max(0, Number.isInteger(metadata.matchingCandidateCount) ? metadata.matchingCandidateCount : 0)),
      attemptedCandidateCount: Math.min(8, Math.max(0, Number.isInteger(metadata.attemptedCandidateCount) ? metadata.attemptedCandidateCount : 0)),
      attachPhase: ["open", "runtime", "page"].includes(metadata.attachPhase) ? metadata.attachPhase : null,
      attachFailureKind: ["session_closed", "transport_error", "protocol_error", "command_timeout", "unknown"].includes(metadata.attachFailureKind)
        ? metadata.attachFailureKind
        : null
    };
  }
  if (stage === "pet_target_discovery") {
    return {
      petWindowProbeCode: "target_list_unreadable",
      childExitedEarly: childExitedEarly === true,
      boundedTargetCount: 0,
      targetConnected: targetConnected === true,
      previewApiReady: previewApiReady === true,
      listReadable: false,
      petTargetCount: 0,
      chatTargetCount: 0,
      otherPageTargetCount: 0,
      invalidTargetCount: 0
    };
  }
  let petWindowProbeCode = null;
  if (stage === "pet_renderer_api") {
    petWindowProbeCode = operation === "preview_api"
      ? errorMessage?.startsWith("Timed out waiting for:") ? "preview_api_timeout" : "preview_api_evaluate_failed"
      : operation === "preview_status" ? "preview_status_evaluate_failed"
        : operation === "startup_telemetry" ? "startup_telemetry_io_failed" : null;
  }
  if (petWindowProbeCode !== null && !PET_WINDOW_PROBE_CODES.has(petWindowProbeCode)) throw new Error("invalid_pet_window_probe");
  return {
    petWindowProbeCode,
    childExitedEarly: childExitedEarly === true,
    boundedTargetCount: Math.min(8, Math.max(0, Number.isInteger(boundedTargetCount) ? boundedTargetCount : 0)),
    targetConnected: targetConnected === true,
    previewApiReady: previewApiReady === true
  };
}

function didChildExitEarly(context) {
  const child = context.child;
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null));
}

function invalidEvidenceBounds() {
  throw new Error("invalid_evidence_bounds");
}

function createP288dOwnerEvidencePlan({ checkpoint, screenshot, viewport, canvas }) {
  const values = [
    screenshot?.width, screenshot?.height,
    viewport?.width, viewport?.height,
    canvas?.x, canvas?.y, canvas?.width, canvas?.height
  ];
  if (!OWNER_REVIEW_CHECKPOINTS.has(checkpoint) || values.some((value) => !Number.isFinite(value))) {
    invalidEvidenceBounds();
  }
  if (screenshot.width <= 0 || screenshot.height <= 0 || viewport.width <= 0 || viewport.height <= 0 ||
      canvas.x < 0 || canvas.y < 0 || canvas.width <= 0 || canvas.height <= 0 ||
      canvas.x + canvas.width > viewport.width || canvas.y + canvas.height > viewport.height) {
    invalidEvidenceBounds();
  }

  const scaleX = screenshot.width / viewport.width;
  const scaleY = screenshot.height / viewport.height;
  const toPixelRect = (rect) => ({
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY)
  });
  const face = toPixelRect({
    x: canvas.x + canvas.width * 0.2,
    y: canvas.y + canvas.height * 0.04,
    width: canvas.width * 0.6,
    height: canvas.height * 0.42
  });
  if (face.x < 0 || face.y < 0 || face.width <= 0 || face.height <= 0 ||
      face.x + face.width > screenshot.width || face.y + face.height > screenshot.height) {
    invalidEvidenceBounds();
  }

  return {
    checkpoint,
    fullBody: {
      fileName: `${checkpoint}-full-body.png`
    },
    face: {
      fileName: `${checkpoint}-face.png`,
      rect: face
    }
  };
}

function readPngRgba(png) {
  const signature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== signature) throw new Error("invalid_png_capture");

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("invalid_png_capture");
    const data = png.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data.readUInt8(8) !== 8 || data.readUInt8(9) !== 6 || data.readUInt8(12) !== 0) {
        throw new Error("invalid_png_capture");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width <= 0 || height <= 0 || idat.length === 0) throw new Error("invalid_png_capture");

  const stride = width * 4;
  const packed = inflateSync(Buffer.concat(idat));
  if (packed.length !== height * (stride + 1)) throw new Error("invalid_png_capture");
  const pixels = Buffer.alloc(width * height * 4);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
      ? left
      : aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  for (let row = 0; row < height; row += 1) {
    const filter = packed[row * (stride + 1)];
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = packed[source + column];
      const left = column >= 4 ? pixels[target + column - 4] : 0;
      const above = row > 0 ? pixels[target + column - stride] : 0;
      const upperLeft = row > 0 && column >= 4 ? pixels[target + column - stride - 4] : 0;
      pixels[target + column] = filter === 0 ? raw
        : filter === 1 ? (raw + left) & 255
          : filter === 2 ? (raw + above) & 255
            : filter === 3 ? (raw + Math.floor((left + above) / 2)) & 255
              : filter === 4 ? (raw + paeth(left, above, upperLeft)) & 255
                : (() => { throw new Error("invalid_png_capture"); })();
    }
  }
  return { width, height, pixels };
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function createPngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, data.length + 8)) crc = PNG_CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}

function cropPngRgba(png, rect) {
  const source = readPngRgba(png);
  if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) || !Number.isInteger(rect.width) || !Number.isInteger(rect.height) ||
      rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
      rect.x + rect.width > source.width || rect.y + rect.height > source.height) {
    invalidEvidenceBounds();
  }
  const rowLength = rect.width * 4;
  const raw = Buffer.alloc(rect.height * (rowLength + 1));
  for (let row = 0; row < rect.height; row += 1) {
    const target = row * (rowLength + 1);
    raw[target] = 0;
    source.pixels.copy(raw, target + 1, ((rect.y + row) * source.width + rect.x) * 4, ((rect.y + row) * source.width + rect.x) * 4 + rowLength);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(rect.width, 0);
  header.writeUInt32BE(rect.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    createPngChunk("IHDR", header),
    createPngChunk("IDAT", deflateSync(raw)),
    createPngChunk("IEND", Buffer.alloc(0))
  ]);
}

async function alignCaptureToAnimationFrame(page) {
  await evaluate(page, "new Promise((resolve) => requestAnimationFrame(() => resolve(true)))");
}

function ownerReviewSurfaceSnapshotScript() {
  return `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const bubble = document.querySelector("#proactive-speech-bubble");
      if (!(canvas instanceof HTMLCanvasElement) || !(bubble instanceof HTMLButtonElement)) return null;
      const bubbleStyle = getComputedStyle(bubble);
      const renderable = Array.from(document.body.children).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      });
      const canvasRect = canvas.getBoundingClientRect();
      return {
        bubbleDataStateHidden: bubble.dataset.state === "hidden",
        bubbleAriaHidden: bubble.getAttribute("aria-hidden") === "true",
        bubbleVisibilityHidden: bubbleStyle.visibility === "hidden",
        bubbleOpacityZero: Number(bubbleStyle.opacity) === 0,
        bubblePointerEventsNone: bubbleStyle.pointerEvents === "none",
        bodyOnlyCanvasAndHiddenBubble: Array.from(document.body.children).every((element) => element === canvas || element === bubble || element.tagName === "SCRIPT"),
        onlyCanvasRenderable: renderable.length === 1 && renderable[0] === canvas,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: { x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height }
      };
    })()
  `;
}

async function observeOwnerReviewSurface(page) {
  return evaluate(page, ownerReviewSurfaceSnapshotScript());
}

function assertOwnerReviewSurface(surface) {
  if (!surface || !surface.bubbleDataStateHidden || !surface.bubbleAriaHidden || !surface.bubbleVisibilityHidden ||
      !surface.bubbleOpacityZero || !surface.bubblePointerEventsNone || !surface.bodyOnlyCanvasAndHiddenBubble ||
      !surface.onlyCanvasRenderable) {
    throw new Error("review_surface_not_clean");
  }
}

function hasStableCaptureGeometry(before, after) {
  return ["viewport", "canvas"].every((key) => (
    before?.[key] && after?.[key] && Object.keys(before[key]).every((field) => before[key][field] === after[key][field])
  ));
}

function writeOwnerEvidencePair(reviewDir, checkpoint, fullBody, surface) {
  const dimensions = readPngRgba(fullBody);
  const plan = createP288dOwnerEvidencePlan({
    checkpoint,
    screenshot: { width: dimensions.width, height: dimensions.height },
    viewport: surface.viewport,
    canvas: surface.canvas
  });
  writeFileSync(join(reviewDir, plan.fullBody.fileName), fullBody);
  writeFileSync(join(reviewDir, plan.face.fileName), cropPngRgba(fullBody, plan.face.rect));
  return { fullBody: true, face: true, sameSource: true, uiClean: true };
}

function writeOwnerEvidenceArtifacts({ reviewDir, screenshot, before, after }) {
  assertOwnerReviewSurface(before);
  assertOwnerReviewSurface(after);
  if (!hasStableCaptureGeometry(before, after)) throw new Error("capture_geometry_changed");
  return [...OWNER_REVIEW_CHECKPOINTS].map((checkpoint) => writeOwnerEvidencePair(reviewDir, checkpoint, screenshot, before));
}

function verifyOwnerEvidenceArtifactSet(reviewDir) {
  const expected = [...OWNER_REVIEW_CHECKPOINTS]
    .flatMap((checkpoint) => [`${checkpoint}-full-body.png`, `${checkpoint}-face.png`])
    .sort();
  const actual = readdirSync(reviewDir).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error("invalid_evidence_artifacts");
  }
  return actual.length;
}

function cleanupFailedRunArtifacts({ reviewDir, runDir }) {
  rmSync(reviewDir, { recursive: true, force: true });
  rmSync(runDir, { recursive: true, force: true });
  return {
    reviewDirectoryRemoved: !existsSync(reviewDir),
    runDirectoryRemoved: !existsSync(runDir)
  };
}

async function capturePetEvidencePair(page, reviewDir, checkpoint) {
  const before = await observeOwnerReviewSurface(page);
  assertOwnerReviewSurface(before);
  await alignCaptureToAnimationFrame(page);
  const result = await page.cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  if (typeof result.data !== "string" || result.data.length === 0) {
    throw new Error("frame_capture_failed");
  }
  const fullBody = Buffer.from(result.data, "base64");
  const evidence = writeOwnerEvidencePair(reviewDir, checkpoint, fullBody, before);
  const after = await observeOwnerReviewSurface(page);
  assertOwnerReviewSurface(after);
  if (!hasStableCaptureGeometry(before, after)) throw new Error("capture_geometry_changed");
  return evidence;
}

function readTelemetryEvents(context) {
  const logDirectory = join(context.appDataDir, "logs");
  if (!existsSync(logDirectory)) return [];

  return readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readFileSync(join(logDirectory, name), "utf8").split(/\r?\n/))
    .flatMap((line) => {
      try {
        return line.trim() ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
}

function capSafeTelemetryCount(value) {
  return Math.min(SAFE_TELEMETRY_COUNT_CAP, value);
}

function createRendererGoneReasonHistogram() {
  return Object.fromEntries(RENDERER_PROCESS_GONE_REASONS.map((reason) => [reason, 0]));
}

function isSafeRendererGoneExitCode(value) {
  return Number.isSafeInteger(value) && value >= RENDERER_GONE_EXIT_CODE_MIN && value <= RENDERER_GONE_EXIT_CODE_MAX;
}

function resolveRendererDiagnosticMode(value) {
  if (value === undefined) return null;
  if (!RENDERER_DIAGNOSTIC_MODE_SET.has(value)) throw new Error("invalid_renderer_diagnostic_mode");
  return value;
}

function getRendererDiagnosticElectronArgs(mode) {
  const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  if (mode === null) return args;
  if (mode === "disable-gpu") return [...args, "--disable-gpu"];
  if (mode === "no-unsafe-swiftshader") return args.filter((arg) => arg !== "--enable-unsafe-swiftshader");
  if (mode === "opaque-pet-window") return args;
  if (mode === "chat-renderer-health") return args;
  throw new Error("invalid_renderer_diagnostic_mode");
}

function safeChatRendererHealthAttachMetadata(error) {
  const metadata = error instanceof TargetDiscoveryError ? error.metadata ?? {} : {};
  return {
    chatAttachCode: error instanceof TargetDiscoveryError && TARGET_DISCOVERY_CODES.has(error.code)
      ? error.code
      : null,
    chatTargetListReadable: metadata.listReadable === true,
    chatTargetCount: Math.min(8, Math.max(0, Number.isInteger(metadata.chatTargetCount) ? metadata.chatTargetCount : 0)),
    chatAttemptedCandidateCount: Math.min(8, Math.max(0, Number.isInteger(metadata.attemptedCandidateCount) ? metadata.attemptedCandidateCount : 0)),
    chatAttachPhase: ["open", "runtime", "page"].includes(metadata.attachPhase) ? metadata.attachPhase : null,
    chatAttachFailureKind: ["session_closed", "transport_error", "protocol_error", "command_timeout", "unknown"].includes(metadata.attachFailureKind)
      ? metadata.attachFailureKind
      : null
  };
}

function createChatRendererHealthChecks({ chatTargetAttached, chatRuntimeReady, chatDocumentReady, error }) {
  return {
    chatTargetAttached: chatTargetAttached === true,
    chatRuntimeReady: chatRuntimeReady === true,
    chatDocumentReady: chatDocumentReady === true,
    ...safeChatRendererHealthAttachMetadata(error)
  };
}

function createChatRendererHealthOutput(summary) {
  const checks = summary.checks ?? {};
  const output = {
    diagnosticOnly: true,
    mode: "chat-renderer-health",
    diagnosticPassed: summary.diagnosticPassed === true,
    chatTargetAttached: checks.chatTargetAttached === true,
    chatRuntimeReady: checks.chatRuntimeReady === true,
    chatDocumentReady: checks.chatDocumentReady === true,
    chatAttachCode: TARGET_DISCOVERY_CODES.has(checks.chatAttachCode) ? checks.chatAttachCode : null,
    chatTargetListReadable: checks.chatTargetListReadable === true,
    chatTargetCount: Math.min(8, Math.max(0, Number.isInteger(checks.chatTargetCount) ? checks.chatTargetCount : 0)),
    chatAttemptedCandidateCount: Math.min(8, Math.max(0, Number.isInteger(checks.chatAttemptedCandidateCount) ? checks.chatAttemptedCandidateCount : 0)),
    chatAttachPhase: ["open", "runtime", "page"].includes(checks.chatAttachPhase) ? checks.chatAttachPhase : null,
    chatAttachFailureKind: ["session_closed", "transport_error", "protocol_error", "command_timeout", "unknown"].includes(checks.chatAttachFailureKind)
      ? checks.chatAttachFailureKind
      : null
  };
  return summary.failure && [
    "target_list_unreadable",
    "target_list_shape_invalid",
    "target_entry_shape_invalid",
    "target_not_found",
    "cdp_attach_failed",
    "chat_document_not_ready",
    "chat_document_ready_timeout",
    "chat_document_ready_failed",
    "diagnostic_cleanup_failed",
    "cleanup_failed"
  ].includes(summary.failure)
    ? { ...output, failure: summary.failure }
    : output;
}

function resolveChatRendererHealthFailure({ stage, error, chatDocumentReady }) {
  if (stage === undefined || stage === null) return null;
  if (stage === "chat_target_discovery") {
    return error instanceof TargetDiscoveryError && TARGET_DISCOVERY_CODES.has(error.code)
      ? error.code
      : "target_list_unreadable";
  }
  if (stage === "chat_document_ready") {
    if (chatDocumentReady === false && error instanceof Error && error.message === "chat_document_not_ready") {
      return "chat_document_not_ready";
    }
    if (error instanceof Error && (error.message.includes("command_timeout") || error.message.startsWith("Timed out waiting for:"))) {
      return "chat_document_ready_timeout";
    }
    return "chat_document_ready_failed";
  }
  return "runner_error";
}

function resolveRendererDiagnosticCompletion({
  diagnosticBarrierPassed,
  pageCleanupCompleted,
  processCleanupCompleted,
  reviewDirectoryRemoved,
  runDirectoryRemoved,
  cleanupErrors
}) {
  return diagnosticBarrierPassed === true &&
    pageCleanupCompleted === true &&
    processCleanupCompleted === true &&
    reviewDirectoryRemoved === true &&
    runDirectoryRemoved === true &&
    Array.isArray(cleanupErrors) && cleanupErrors.length === 0;
}

function resolveRunnerInvocation(args) {
  if (args.length === 0) return { kind: "main" };
  if (args.length === 2 && RUNNER_TEST_MODE_SET.has(args[0])) {
    return { kind: "test", testMode: args[0], testInput: args[1] };
  }
  return null;
}

function resolveIsolatedProactiveSettingsPath(runContext) {
  if (typeof runContext.appDataDir !== "string" || !isAbsolute(runContext.appDataDir)) {
    throw new Error("proactive_settings_user_data_path_invalid");
  }
  const userDataPath = resolve(runContext.appDataDir);
  const settingsPath = resolve(userDataPath, "config", "proactive-companion-settings.json");
  const relativeSettingsPath = relative(userDataPath, settingsPath);
  if (
    !isAbsolute(userDataPath) ||
    relativeSettingsPath === "" ||
    relativeSettingsPath.startsWith("..") ||
    isAbsolute(relativeSettingsPath)
  ) {
    throw new Error("proactive_settings_path_outside_user_data");
  }
  return settingsPath;
}

function prepareIsolatedProactiveCadenceOff(runContext, rendererDiagnosticMode, fileOperations = {}) {
  const settingsPath = resolveIsolatedProactiveSettingsPath(runContext);
  if (rendererDiagnosticMode !== null) {
    return {
      preseeded: false,
      settingsPathInsideUserData: true,
      settings: null,
      tempResidueCount: 0
    };
  }

  const settings = {
    cadence: "off",
    memorySourceBubbles: true,
    searchSourceBubbles: true
  };
  const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  const writeSettingsFile = fileOperations.writeFileSync ?? writeFileSync;
  const replaceSettingsFile = fileOperations.renameSync ?? renameSync;
  const readSettingsFile = fileOperations.readFileSync ?? readFileSync;
  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeSettingsFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    replaceSettingsFile(temporaryPath, settingsPath);
    const persisted = JSON.parse(readSettingsFile(settingsPath, "utf8"));
    if (
      !persisted ||
      typeof persisted !== "object" ||
      Array.isArray(persisted) ||
      Object.keys(persisted).sort().join(",") !== "cadence,memorySourceBubbles,searchSourceBubbles" ||
      persisted.cadence !== "off" ||
      persisted.memorySourceBubbles !== true ||
      persisted.searchSourceBubbles !== true
    ) {
      throw new Error("proactive_settings_preseed_verification_failed");
    }
    return {
      preseeded: true,
      settingsPathInsideUserData: true,
      settings: persisted,
      tempResidueCount: 0
    };
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function summarizeStableMainFirstFrameTelemetry(events) {
  let mainFirstFrameCount = 0;
  let lastMainFirstFrameIndex = -1;
  let latestRendererReplacementIndex = -1;
  let lastRendererGoneExitCode = null;
  let rendererProcessGoneRecoveryStartedCount = 0;
  let recoveryLimitReachedCount = 0;
  const rendererGoneReasonHistogram = createRendererGoneReasonHistogram();

  for (const [index, event] of events.entries()) {
    if (event?.type === "first_frame") {
      mainFirstFrameCount = capSafeTelemetryCount(mainFirstFrameCount + 1);
      lastMainFirstFrameIndex = index;
      continue;
    }
    if (event?.type === "renderer_process_gone") {
      latestRendererReplacementIndex = index;
      const reason = event.payload?.reason;
      if (typeof reason === "string" && RENDERER_PROCESS_GONE_REASON_SET.has(reason)) {
        rendererGoneReasonHistogram[reason] = capSafeTelemetryCount(rendererGoneReasonHistogram[reason] + 1);
        if (isSafeRendererGoneExitCode(event.payload?.exitCode)) {
          lastRendererGoneExitCode = event.payload.exitCode;
        }
      }
      continue;
    }
    if (event?.type === "recovery_started" && event.payload?.source === "renderer_process_gone") {
      latestRendererReplacementIndex = index;
      rendererProcessGoneRecoveryStartedCount = capSafeTelemetryCount(rendererProcessGoneRecoveryStartedCount + 1);
      continue;
    }
    if (event?.type === "recovery_limit_reached") {
      recoveryLimitReachedCount = capSafeTelemetryCount(recoveryLimitReachedCount + 1);
    }
  }

  return {
    mainFirstFrameCount,
    stableMainFirstFrameObserved: lastMainFirstFrameIndex > latestRendererReplacementIndex,
    rendererGoneReasonHistogram,
    lastRendererGoneExitCode,
    rendererProcessGoneRecoveryStartedCount,
    recoveryLimitReachedCount
  };
}

async function waitForStableMainFirstFrameBarrier(context, startIndex, timeoutMs, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const sleepForRetry = dependencies.sleep ?? sleep;
  const readEvents = dependencies.readEvents ?? readTelemetryEvents;
  const deadline = now() + timeoutMs;
  let summary = summarizeStableMainFirstFrameTelemetry(readEvents(context).slice(startIndex));
  while (!summary.stableMainFirstFrameObserved && now() < deadline) {
    await sleepForRetry(Math.min(100, Math.max(0, deadline - now())));
    summary = summarizeStableMainFirstFrameTelemetry(readEvents(context).slice(startIndex));
  }
  return summary;
}

async function waitForTelemetryEvent(context, startIndex, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readTelemetryEvents(context).slice(startIndex).some(predicate)) return true;
    await sleep(100);
  }
  return false;
}

async function waitForRecoveryTerminal(context, startIndex, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let contextRestoredObserved = false;
  while (Date.now() < deadline) {
    const events = readTelemetryEvents(context).slice(startIndex);
    contextRestoredObserved ||= events.some((event) => event?.type === "webgl_context_restored");
    if (events.some((event) => event?.type === "recovery_succeeded")) {
      return { recoveryTerminal: "succeeded", contextRestoredObserved };
    }
    if (events.some((event) => event?.type === "recovery_failed")) {
      return { recoveryTerminal: "failed", contextRestoredObserved };
    }
    await sleep(100);
  }
  return { recoveryTerminal: "timeout", contextRestoredObserved };
}

async function readPreviewStatus(pet) {
  return evaluate(pet, `
    (() => {
      const status = document.querySelector("#pet-canvas")?.dataset.p288dPreviewStatus;
      return ["idle", "active", "blocked-owner", "blocked-recovery", "blocked-repeat", "released", "disposed"].includes(status)
        ? status
        : "";
    })()
  `);
}

async function waitForPreviewStatus(pet, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await readPreviewStatus(pet) === expected) return true;
    await sleep(50);
  }
  return false;
}

async function clickPetBody(pet) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas?.getBoundingClientRect();
      if (!canvas || !rect) throw new Error("pet_canvas_unavailable");
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 88,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 88,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
}

async function loseAndRestoreWebGLContext(pet) {
  return evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? canvas?.getContext("experimental-webgl");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension || gl.isContextLost()) return false;
      extension.loseContext();
      window.setTimeout(() => {
        if (gl.isContextLost()) extension.restoreContext();
      }, 1_000);
      return true;
    })()
  `);
}

async function main() {
  let rendererDiagnosticMode;
  try {
    rendererDiagnosticMode = resolveRendererDiagnosticMode(process.env.AI_DESKTOP_PET_P2_88D_RENDERER_DIAG_MODE);
  } catch {
    process.stdout.write(`${JSON.stringify({
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
    })}\n`);
    process.exitCode = 1;
    return;
  }
  const isRendererDiagnosticRun = rendererDiagnosticMode !== null;
  const reviewDisposition = process.env.AI_DESKTOP_PET_P2_88D_REVIEW_DISPOSITION === "cleanup"
    ? "cleanup"
    : "preserve";
  const runParentDir = join(PROJECT_ROOT, ".tmp", RUN_NAME);
  const reviewRoot = join(runParentDir, "review");

  if (reviewDisposition === "cleanup") {
    const cleanup = cleanupP288dReviewRoot({ taskRoot: runParentDir, frozenTaskRoot: runParentDir });
    const taskRootCleaned = cleanup.taskRootCleaned;
    const summary = {
      ok: taskRootCleaned,
      runtimePath: "not_started",
      reviewDisposition,
      checks: { reviewArtifactsCleaned: cleanup.reviewArtifactsCleaned, taskRootCleaned, cleanupCompleted: taskRootCleaned }
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!summary.ok) process.exitCode = 1;
    return;
  }

  const context = createRealUiRunContext({
    runName: RUN_NAME,
    port: 9745,
    env: {
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_P2_88D_CURIOUS_LOW_PREVIEW: "1"
    },
    tmpResiduePatterns: [/^p2-88d-curious-low-preview-real-ui$/i]
  });
  if (context.runParentDir !== runParentDir) throw new Error("unexpected_run_parent_dir");
  const mainFirstFrameTelemetryStart = readTelemetryEvents(context).length;
  const reviewDir = join(reviewRoot, context.stamp);
  context.electronArgs = getRendererDiagnosticElectronArgs(rendererDiagnosticMode);

  let summary = {
    ok: false,
    runtimePath: "production_electron",
    ...(isRendererDiagnosticRun ? {
      diagnosticOnly: true,
      diagnosticMode: rendererDiagnosticMode,
      diagnosticPassed: false
    } : {}),
    failureStage: "entry",
    checks: {
      cleanupCompleted: false,
      ...summarizeStableMainFirstFrameTelemetry([])
    }
  };
  let petPageClosed = false;
  let recoveryDiagnostics = null;
  const evidenceCaptures = [];
  let petWindowProbe = null;
  let targetConnected = false;
  let previewApiReady = false;
  let chat = null;
  let chatPageClosed = false;
  let chatTargetAttached = false;
  let chatRuntimeReady = false;
  let chatDocumentReady = false;
  let electronStarted = false;
  try {
    if (!isRendererDiagnosticRun) {
      mkdirSync(reviewDir, { recursive: true });
    }
    summary.failureStage = "proactive_settings_preseed";
    try {
      prepareIsolatedProactiveCadenceOff(context, rendererDiagnosticMode);
    } catch {
      throw new Error("proactive_settings_preseed_failed");
    }
    if (electronStarted !== false) throw new Error("electron_started_before_preseed");
    startElectron(context);
    electronStarted = true;
    summary.failureStage = "cdp_connect";
    await connectToElectron(context, 30_000);
    if (rendererDiagnosticMode === "chat-renderer-health") {
      summary.failureStage = "chat_target_discovery";
      chat = await waitForWindow(context, "renderer/chat/index.html", 30_000);
      chatTargetAttached = true;
      chatRuntimeReady = true;
      summary.failureStage = "chat_document_ready";
      chatDocumentReady = await evaluate(chat, CHAT_RENDERER_DOCUMENT_READY_EXPRESSION);
      if (chatDocumentReady !== true) throw new Error("chat_document_not_ready");
      summary = {
        ok: false,
        runtimePath: "production_electron",
        diagnosticOnly: true,
        diagnosticMode: rendererDiagnosticMode,
        chatRendererHealthCheckPassed: true,
        diagnosticPassed: false,
        checks: createChatRendererHealthChecks({
          chatTargetAttached,
          chatRuntimeReady,
          chatDocumentReady
        })
      };
    } else {
      summary.failureStage = "stable_main_first_frame_barrier";
      const stableMainFirstFrameTelemetry = await waitForStableMainFirstFrameBarrier(
        context,
        mainFirstFrameTelemetryStart,
        STABLE_MAIN_FIRST_FRAME_BARRIER_TIMEOUT_MS
      );
      summary.checks = { ...summary.checks, ...stableMainFirstFrameTelemetry };
      if (!stableMainFirstFrameTelemetry.stableMainFirstFrameObserved) throw new Error("stable_main_first_frame_timeout");
      if (isRendererDiagnosticRun) {
      summary = {
        ok: false,
        runtimePath: "production_electron",
        diagnosticOnly: true,
        diagnosticMode: rendererDiagnosticMode,
        diagnosticBarrierPassed: true,
        diagnosticPassed: false,
        diagnosticResult: "stable_main_first_frame_observed",
        checks: {
          ...stableMainFirstFrameTelemetry,
          reviewArtifactsCreated: false,
          petPageClosed: false,
          pageCleanupCompleted: true,
          runDirectoryRemoved: false,
          cleanupCompleted: false
        }
      };
    } else {
    summary.failureStage = "pet_target_discovery";
    let pet;
    try {
      pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
      targetConnected = true;
    } catch (error) {
      petWindowProbe = createPetWindowProbe({
        stage: "pet_target_discovery",
        error,
        errorMessage: error instanceof Error ? error.message : "",
        childExitedEarly: didChildExitEarly(context),
        boundedTargetCount: 0,
        targetConnected,
        previewApiReady
      });
      throw error;
    }
    summary.failureStage = "pet_renderer_api";
    try {
      await waitFor(pet, "Boolean(window.petApi?.triggerCuriousFocusPulsePreviewForAcceptance)", {
        timeoutMs: 15_000
      });
      previewApiReady = true;
    } catch (error) {
      petWindowProbe = createPetWindowProbe({
        stage: "pet_renderer_api",
        operation: "preview_api",
        errorMessage: error instanceof Error ? error.message : "",
        childExitedEarly: didChildExitEarly(context),
        boundedTargetCount: context.pages.length,
        targetConnected,
        previewApiReady
      });
      throw error;
    }
    let rendererReady;
    try {
      rendererReady = await waitForPreviewStatus(pet, "idle", 15_000);
    } catch (error) {
      petWindowProbe = createPetWindowProbe({
        stage: "pet_renderer_api",
        operation: "preview_status",
        errorMessage: error instanceof Error ? error.message : "",
        childExitedEarly: didChildExitEarly(context),
        boundedTargetCount: context.pages.length,
        targetConnected,
        previewApiReady
      });
      throw error;
    }
    if (!rendererReady) {
      petWindowProbe = createPetWindowProbe({
        stage: "pet_renderer_api",
        operation: "known_timeout",
        childExitedEarly: didChildExitEarly(context),
        boundedTargetCount: context.pages.length,
        targetConnected,
        previewApiReady
      });
      throw new Error("preview_renderer_not_ready");
    }
    let startupActionFinished;
    try {
      startupActionFinished = await waitForTelemetryEvent(context, 0, (event) => (
        event?.type === "pet_interaction_action_finished" &&
        event.payload?.reason === "startup_first_visible_frame"
      ), 10_000);
    } catch (error) {
      petWindowProbe = createPetWindowProbe({
        stage: "pet_renderer_api",
        operation: "startup_telemetry",
        errorMessage: error instanceof Error ? error.message : "",
        childExitedEarly: didChildExitEarly(context),
        boundedTargetCount: context.pages.length,
        targetConnected,
        previewApiReady
      });
      throw error;
    }
    if (!startupActionFinished) {
      petWindowProbe = createPetWindowProbe({
        stage: "pet_renderer_api",
        operation: "known_timeout",
        childExitedEarly: didChildExitEarly(context),
        boundedTargetCount: context.pages.length,
        targetConnected,
        previewApiReady
      });
      throw new Error("startup_action_not_finished");
    }

    summary.failureStage = "baseline";
    evidenceCaptures.push(await capturePetEvidencePair(pet, reviewDir, "baseline"));
    const previewAccepted = await evaluate(pet, "window.petApi.triggerCuriousFocusPulsePreviewForAcceptance()");
    if (previewAccepted !== true) {
      throw new Error("preview_request_rejected");
    }
    if (!await waitForPreviewStatus(pet, "active")) throw new Error("preview_not_started");

    summary.failureStage = "focus_window";
    await sleep(FOCUS_CAPTURE_DELAY_MS);
    evidenceCaptures.push(await capturePetEvidencePair(pet, reviewDir, "focus"));
    summary.failureStage = "settle_window";
    await sleep(SETTLE_CAPTURE_DELAY_MS - FOCUS_CAPTURE_DELAY_MS);
    evidenceCaptures.push(await capturePetEvidencePair(pet, reviewDir, "settle"));
    summary.failureStage = "release_window";
    await sleep(RELEASE_CAPTURE_DELAY_MS - SETTLE_CAPTURE_DELAY_MS);
    evidenceCaptures.push(await capturePetEvidencePair(pet, reviewDir, "release"));
    const evidenceArtifactCount = verifyOwnerEvidenceArtifactSet(reviewDir);

    summary.failureStage = "repeat_gate";
    const firstRepeatRequestAccepted = await evaluate(pet, "window.petApi.triggerCuriousFocusPulsePreviewForAcceptance()");
    if (firstRepeatRequestAccepted !== true || !await waitForPreviewStatus(pet, "active")) {
      throw new Error("preview_repeat_first_not_started");
    }
    const secondRepeatRequestAccepted = await evaluate(pet, "window.petApi.triggerCuriousFocusPulsePreviewForAcceptance()");
    const repeatBlocked = firstRepeatRequestAccepted === true && secondRepeatRequestAccepted === true &&
      await waitForPreviewStatus(pet, "blocked-repeat");
    if (!repeatBlocked) throw new Error("preview_repeat_not_blocked");
    if (!await waitForPreviewStatus(pet, "released")) throw new Error("preview_repeat_not_released");

    summary.failureStage = "action_owner_gate";
    const actionTelemetryStart = readTelemetryEvents(context).length;
    await clickPetBody(pet);
    const actionStarted = await waitForTelemetryEvent(context, actionTelemetryStart, (event) => (
      event?.type === "pet_interaction_action_started" && event.payload?.reason === "click_body"
    ), 3_000);
    if (!actionStarted) throw new Error("pet_action_not_started");
    const ownerRequestAccepted = await evaluate(pet, "window.petApi.triggerCuriousFocusPulsePreviewForAcceptance()");
    const ownerBlocked = ownerRequestAccepted === true && await waitForPreviewStatus(pet, "blocked-owner");
    if (!ownerBlocked) throw new Error("preview_owner_not_blocked");
    const actionFinished = await waitForTelemetryEvent(context, actionTelemetryStart, (event) => (
      event?.type === "pet_interaction_action_finished" && event.payload?.reason === "click_body"
    ), 8_000);
    if (!actionFinished) throw new Error("pet_action_not_finished");

    summary.failureStage = "recovery_gate";
    const recoveryTelemetryStart = readTelemetryEvents(context).length;
    const contextLossTriggered = await loseAndRestoreWebGLContext(pet);
    if (contextLossTriggered !== true) throw new Error("webgl_context_loss_unavailable");
    const recoveryStarted = await waitForTelemetryEvent(context, recoveryTelemetryStart, (event) => (
      event?.type === "recovery_started"
    ), 3_000);
    if (!recoveryStarted) throw new Error("recovery_not_started");
    const recoveryRequestAccepted = await evaluate(pet, "window.petApi.triggerCuriousFocusPulsePreviewForAcceptance()");
    const recoveryBlocked = recoveryRequestAccepted === true && await waitForPreviewStatus(pet, "blocked-recovery");
    if (!recoveryBlocked) throw new Error("preview_recovery_not_blocked");
    recoveryDiagnostics = await waitForRecoveryTerminal(context, recoveryTelemetryStart, 10_000);
    if (recoveryDiagnostics.recoveryTerminal !== "succeeded") {
      throw new Error("recovery_not_succeeded");
    }

    summary.failureStage = "page_close";
    await pet.cdp.send("Page.close");
    petPageClosed = true;

    summary = {
      ok: true,
      runtimePath: "production_electron",
      evidenceBoundary: "pet-only frame capture for Owner visual review; no semantic action, affect, or production enablement claim",
      reviewDisposition,
      checks: {
        ...stableMainFirstFrameTelemetry,
        baseline: true,
        previewRequestAccepted: true,
        focusWindow: true,
        settleWindow: true,
        releaseWindow: true,
        reviewFrameCount: 4,
        reviewFullBodyCount: evidenceCaptures.filter((capture) => capture.fullBody).length,
        reviewFaceCropCount: evidenceCaptures.filter((capture) => capture.face).length,
        sameSourcePairCount: evidenceCaptures.filter((capture) => capture.sameSource).length,
        uiCleanCaptureCount: evidenceCaptures.filter((capture) => capture.uiClean).length,
        reviewArtifactCount: evidenceArtifactCount,
        full: evidenceCaptures.filter((capture) => capture.fullBody).length,
        face: evidenceCaptures.filter((capture) => capture.face).length,
        sameSource: evidenceCaptures.filter((capture) => capture.sameSource).length,
        uiClean: evidenceCaptures.filter((capture) => capture.uiClean).length,
        repeatBlocked: true,
        actionStarted: true,
        actionOwnerBlocked: true,
        contextLossTriggered: true,
        recoveryBlocked: true,
        recoverySucceeded: recoveryDiagnostics.recoveryTerminal === "succeeded",
        recoveryTerminal: recoveryDiagnostics.recoveryTerminal,
        contextRestoredObserved: recoveryDiagnostics.contextRestoredObserved,
        petPageClosed,
        runDirectoryRemoved: false,
        cleanupCompleted: false
      }
    };
      }
    }
  } catch (error) {
    if (rendererDiagnosticMode === "chat-renderer-health") {
      summary = {
        ...summary,
        ok: false,
        failure: resolveChatRendererHealthFailure({
          stage: summary.failureStage,
          error,
          chatDocumentReady
        }),
        checks: createChatRendererHealthChecks({
          chatTargetAttached,
          chatRuntimeReady,
          chatDocumentReady,
          error
        })
      };
    } else {
    const failure = error instanceof TargetDiscoveryError
      ? error.code
      : error instanceof Error && [
      "frame_capture_failed",
      "invalid_png_capture",
      "invalid_evidence_bounds",
      "review_surface_not_clean",
      "capture_geometry_changed",
      "invalid_evidence_artifacts",
      "preview_renderer_not_ready",
      "startup_action_not_finished",
      "preview_request_rejected",
      "preview_not_started",
      "preview_repeat_first_not_started",
      "preview_repeat_not_blocked",
      "preview_repeat_not_released",
      "pet_action_not_started",
      "preview_owner_not_blocked",
      "pet_action_not_finished",
      "webgl_context_loss_unavailable",
      "recovery_not_started",
      "preview_recovery_not_blocked",
      "recovery_not_succeeded",
      "proactive_settings_preseed_failed",
      "stable_main_first_frame_timeout"
    ].includes(error.message)
      ? error.message
      : "runner_error";
    summary = {
      ...summary,
      ok: false,
      failure,
      checks: { ...summary.checks, ...(recoveryDiagnostics ?? {}), ...(petWindowProbe ?? {}) }
    };
    }
  } finally {
    const cleanupErrors = [];
    if (rendererDiagnosticMode === "chat-renderer-health" && chat !== null) {
      try {
        await chat.cdp.send("Page.close");
        chatPageClosed = true;
      } catch {
        cleanupErrors.push("chat_page_close_failed");
      }
    }
    try {
      await stopElectron(context);
    } catch {
      cleanupErrors.push("stop_electron_failed");
    }
    let cleanup = { reviewDirectoryRemoved: false, runDirectoryRemoved: false };
    try {
      if (!summary.ok || cleanupErrors.length > 0) {
        cleanup = cleanupFailedRunArtifacts({ reviewDir, runDir: context.runDir });
      } else {
        rmSync(context.runDir, { recursive: true, force: true });
        cleanup.runDirectoryRemoved = !existsSync(context.runDir);
      }
    } catch {
      cleanupErrors.push("artifact_cleanup_failed");
    }
    const cleanupCompleted = cleanup.runDirectoryRemoved && cleanupErrors.length === 0;
    const processCleanupCompleted = cleanupErrors.length === 0;
    const pageCleanupCompleted = rendererDiagnosticMode === "chat-renderer-health"
      ? chat === null || chatPageClosed
      : summary.checks.pageCleanupCompleted === true;
    const diagnosticPassed = summary.diagnosticOnly === true && resolveRendererDiagnosticCompletion({
      diagnosticBarrierPassed: summary.diagnosticBarrierPassed === true || summary.chatRendererHealthCheckPassed === true,
      pageCleanupCompleted,
      processCleanupCompleted,
      reviewDirectoryRemoved: cleanup.reviewDirectoryRemoved,
      runDirectoryRemoved: cleanup.runDirectoryRemoved,
      cleanupErrors
    });
    if (cleanupErrors.length > 0) {
      summary = { ...summary, ok: false, failure: summary.failure ?? "cleanup_failed" };
    }
    if (summary.diagnosticOnly === true && !diagnosticPassed) {
      summary = {
        ...summary,
        diagnosticPassed: false,
        failure: summary.failure ?? "diagnostic_cleanup_failed"
      };
    }
    if (summary.diagnosticOnly === true && diagnosticPassed) {
      summary = { ...summary, diagnosticPassed: true };
    }
    summary = {
      ...summary,
      checks: {
        ...summary.checks,
        electronStarted,
        petPageClosed,
        reviewDirectoryRemoved: cleanup.reviewDirectoryRemoved,
        runDirectoryRemoved: cleanup.runDirectoryRemoved,
        cleanupCompleted,
        cleanupErrors,
        ...(summary.diagnosticOnly === true ? {
          pageCleanupCompleted,
          processCleanupCompleted
        } : {})
      }
    };
  }

  const output = rendererDiagnosticMode === "chat-renderer-health"
    ? createChatRendererHealthOutput(summary)
    : summary;
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!summary.ok && summary.diagnosticPassed !== true) process.exitCode = 1;
}

const runnerInvocation = resolveRunnerInvocation(process.argv.slice(2));
if (runnerInvocation === null) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    runtimePath: "not_started",
    failure: "invalid_runner_arguments",
    checks: {
      electronStarted: false,
      cleanupCompleted: true
    }
  })}\n`);
  process.exitCode = 1;
} else {
  const testMode = runnerInvocation.kind === "test" ? runnerInvocation.testMode : null;
  const testInput = runnerInvocation.kind === "test" ? runnerInvocation.testInput : "";
  if (testMode === "--test-owner-evidence-plan") {
  try {
    const input = JSON.parse(testInput);
    process.stdout.write(`${JSON.stringify(createP288dOwnerEvidencePlan(input))}\n`);
  } catch {
    process.stderr.write("invalid_evidence_bounds\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-owner-evidence-artifacts") {
  try {
    const input = JSON.parse(testInput);
    const captures = writeOwnerEvidenceArtifacts({
      reviewDir: input.reviewDir,
      screenshot: Buffer.from(input.screenshotBase64, "base64"),
      before: input.before,
      after: input.after
    });
    verifyOwnerEvidenceArtifactSet(input.reviewDir);
    process.stdout.write(`${JSON.stringify({
      full: captures.filter((capture) => capture.fullBody).length,
      face: captures.filter((capture) => capture.face).length,
      sameSource: captures.filter((capture) => capture.sameSource).length,
      uiClean: captures.filter((capture) => capture.uiClean).length
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "evidence_fixture_failed"}\n`);
    process.exitCode = 1;
  }
} else if (testMode === "--test-owner-evidence-cleanup") {
  try {
    const input = JSON.parse(testInput);
    process.stdout.write(`${JSON.stringify(cleanupFailedRunArtifacts(input))}\n`);
  } catch {
    process.stderr.write("cleanup_failed\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-pet-window-probe") {
  try {
    const input = JSON.parse(testInput);
    const error = input.targetDiscoveryCode
      ? new TargetDiscoveryError(input.targetDiscoveryCode, input.targetMetadata)
      : undefined;
    process.stdout.write(`${JSON.stringify(createPetWindowProbe({ ...input, error }))}\n`);
  } catch {
    process.stderr.write("invalid_pet_window_probe\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-stable-main-first-frame-barrier") {
  try {
    const input = JSON.parse(testInput);
    let now = 0;
    let batchIndex = 0;
    const result = await waitForStableMainFirstFrameBarrier({}, 0, input.timeoutMs, {
      now: () => now,
      sleep: async () => {
        now += input.tickMs;
        batchIndex += 1;
      },
      readEvents: () => input.batches[Math.min(batchIndex, input.batches.length - 1)] ?? []
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("invalid_stable_main_first_frame_barrier\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-renderer-diagnostic-mode") {
  try {
    const input = JSON.parse(testInput);
    const mode = resolveRendererDiagnosticMode(input.mode);
    process.stdout.write(`${JSON.stringify({
      diagnosticOnly: mode !== null,
      mode,
      electronArgs: getRendererDiagnosticElectronArgs(mode)
    })}\n`);
  } catch {
    process.stderr.write("invalid_renderer_diagnostic_mode\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-renderer-diagnostic-cleanup") {
  try {
    const input = JSON.parse(testInput);
    process.stdout.write(`${JSON.stringify({
      diagnosticPassed: resolveRendererDiagnosticCompletion(input)
    })}\n`);
  } catch {
    process.stderr.write("invalid_renderer_diagnostic_cleanup\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-chat-renderer-health-projection") {
  try {
    const input = JSON.parse(testInput);
    const error = input.errorCode
      ? new TargetDiscoveryError(input.errorCode, input.targetMetadata)
      : input.errorMessage ? new Error(input.errorMessage) : undefined;
    process.stdout.write(`${JSON.stringify({
      failure: resolveChatRendererHealthFailure({
        stage: input.stage,
        error,
        chatDocumentReady: input.chatDocumentReady
      }),
      checks: createChatRendererHealthChecks({
        chatTargetAttached: input.chatTargetAttached,
        chatRuntimeReady: input.chatRuntimeReady,
        chatDocumentReady: input.chatDocumentReady,
        error
      })
    })}\n`);
  } catch {
    process.stderr.write("invalid_chat_renderer_health_projection\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-chat-renderer-health-output") {
  try {
    const input = JSON.parse(testInput);
    process.stdout.write(`${JSON.stringify(createChatRendererHealthOutput(input))}\n`);
  } catch {
    process.stderr.write("invalid_chat_renderer_health_output\n");
    process.exitCode = 1;
  }
} else if (testMode === "--test-proactive-settings-preseed") {
  try {
    const input = JSON.parse(testInput);
    const fixtureFileOperations = {
      writeFileSync(path, content, options) {
        writeFileSync(path, content, options);
        if (input.failurePhase === "write") throw new Error("fixture_write_failed");
      },
      renameSync(source, target) {
        if (input.failurePhase === "rename") throw new Error("fixture_rename_failed");
        renameSync(source, target);
      },
      readFileSync(path, encoding) {
        return input.failurePhase === "parse" ? "{" : readFileSync(path, encoding);
      }
    };
    process.stdout.write(`${JSON.stringify({
      ...prepareIsolatedProactiveCadenceOff(
        { appDataDir: input.appDataDir },
        input.diagnosticMode,
        fixtureFileOperations
      ),
      electronStarted: false
    })}\n`);
  } catch {
    process.stderr.write("proactive_settings_preseed_failed\n");
    process.exitCode = 1;
  }
} else {
  await main();
}
}
