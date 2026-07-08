import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  closeSettingsPage,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  readPrivacyCheckText,
  setDialogueMode,
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { PET_EXPRESSION_PRESET_CATALOG } from "../src/shared/interaction-action-catalog.ts";
import { PET_MOTION_PRESET_IDS } from "../src/shared/pet-motion-presets.ts";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";
import {
  auditWitchMotionAssets,
  isProductionReadyMotionAssetLicenseStatus
} from "./live2d-motion-asset-audit.mts";

const RUN_NAME = "p2-51-expression-visual-sampling-motion-boundary-real-ui";
const VISUAL_SCOPE = "representative-runtime-sampling-not-full-exp3-review";
const SCREENSHOT_PERSISTENCE = "memory-only";
const SAMPLE_EXPRESSION_PRESET_IDS = ["dark", "happy", "glasses"];
const blockedMotionAssetLicenseStatuses = [
  "official-sample-reference-only",
  "blocked-missing-license"
];
const productionMotionAssetLicenseStatuses = [
  "project-owned",
  "user-provided"
];
const runContexts = [];
let context = null;

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /providerRequestBody/i,
  /factCardBody/i,
  /memoryContext\.cards/i,
  /rawSearchResult/i,
  /search query|safeQuery|snippet|domain|\burl\b|\btitle\b/i,
  /bubbleText|futureLlmText|messageText|textContent/i,
  /"messages"\s*:|messages\s*:/i,
  /"content"\s*:|content\s*:/i,
  /prompt/i,
  /apiKey|Authorization/i,
  /expressionName/i,
  /expressionPath/i,
  /motionPath/i,
  /resourcePath/i,
  /partId/i,
  /\.motion3\.json/i,
  /\.exp3\.json/i,
  /\b[A-Za-z]:[\\/]/
];

const telemetryAllowedFields = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const cases = [];
  let telemetryEvents = [];
  let unsafeTelemetryFields = [];

  try {
    const visualResult = await runRepresentativeVisualSampling(cases);
    telemetryEvents = visualResult.telemetryEvents;
    unsafeTelemetryFields = visualResult.unsafeTelemetryFields;
    const motionBoundary = createMotionBoundarySummary();

    checks.requiredVisualSamplesPassed = cases
      .filter((item) => item.required)
      .every((item) => item.status === "passed");
    checks.expressionSamplesHaveTelemetry = cases
      .filter((item) => item.expected.expressionPresetId)
      .every((item) => item.telemetry?.eventAfterIndex === true);
    checks.visualSamplesNonBlank = cases.every((item) => item.visualSample?.ok === true);
    checks.screenshotPersistenceMemoryOnly = cases.every((item) => (
      item.visualSample?.screenshot?.captured === true &&
      item.visualSample?.screenshot?.fileWritten === false
    ));
    checks.visualScopeHonest = VISUAL_SCOPE === "representative-runtime-sampling-not-full-exp3-review";
    checks.telemetryPayloadAllowlist = unsafeTelemetryFields.length === 0;
    checks.motionBoundarySafe = motionBoundary.currentSemanticMotionPresetCount === 0 &&
      motionBoundary.petMotionPresetIdCount === 0 &&
      motionBoundary.idleSemanticAllowed === false &&
      motionBoundary.safeSkipReason === "no-semantic-motion-presets" &&
      motionBoundary.blockedLicenseStatusesRejected === true &&
      motionBoundary.productionLicenseStatusesAccepted === true;

    const privacyText = stripKnownInternalRuntimeTelemetry(
      readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"])
    );
    checks.noForbiddenText = !containsForbiddenOutput(privacyText);

    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidueBeforeCleanup = residueBeforeCleanup.length === 0;

    const summary = {
      ok: false,
      safeSummaryOnly: true,
      providerFixture: "FakeProvider",
      visualScope: VISUAL_SCOPE,
      visualQaClaim: "representative-real-ui-sampling",
      fullExpressionAssetReview: false,
      screenshotPersistence: SCREENSHOT_PERSISTENCE,
      screenshotFilesWritten: 0,
      outputPathsPrinted: false,
      durationMs: Date.now() - startedAt,
      checks,
      sampledExpressionPresetIds: SAMPLE_EXPRESSION_PRESET_IDS,
      unsampledExpressionPresetIds: listUnsampledExpressionPresetIds(),
      cases,
      motionBoundary,
      unsafeTelemetryFieldCount: unsafeTelemetryFields.length,
      counts: countActionStarts(telemetryEvents)
    };
    checks.privacyOutputSafe = isSafeSummary(summary);
    summary.ok = Object.values(checks).every(Boolean);
    writeResult(summary);

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeResult({
      ok: false,
      safeSummaryOnly: true,
      providerFixture: "FakeProvider",
      visualScope: VISUAL_SCOPE,
      visualQaClaim: "representative-real-ui-sampling",
      fullExpressionAssetReview: false,
      screenshotPersistence: SCREENSHOT_PERSISTENCE,
      screenshotFilesWritten: 0,
      outputPathsPrinted: false,
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      failureCategory: classifyError(error),
      errorName: error instanceof Error ? error.name : "Error"
    });
    process.exitCode = 1;
  } finally {
    if (context) {
      await stopElectron(context);
      if (process.env.P2_51_KEEP_TMP !== "1") {
        cleanupRealUiRun(context);
      }
    }
  }
}

async function runRepresentativeVisualSampling(cases) {
  context = createRealUiRunContext({
    runName: RUN_NAME,
    port: Number(process.env.P2_51_CDP_PORT || 9652),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_51_IDLE_INTERVAL_MS || "60000"
    }
  });
  runContexts.push(context);
  log(context, "scenario=representative-expression-visual-sampling provider=FakeProvider");

  const { pet } = await startApp();
  cases.push(await captureBaselineCase(pet));

  const chat = await openChatFromPet(pet);
  await settleInteractionWindow(chat);

  cases.push(await runExpressionVisualCase(pet, {
    caseId: "default-think-dark-visual-sample",
    reason: "chat_reply_waiting",
    stateId: "think",
    actionType: "replyThinking",
    modeId: "default",
    presenceModeId: "default",
    expressionPresetId: "dark",
    timeoutMs: 8_000,
    trigger: () => submitChatTurnNoWait(chat, "p2-51 default think visual sampling")
  }));
  await settleInteractionWindow(chat);

  cases.push(await runExpressionVisualCase(pet, {
    caseId: "default-listen-happy-visual-sample",
    reason: "chat_input_focus",
    stateId: "listen",
    actionType: "listen",
    modeId: "default",
    presenceModeId: "default",
    expressionPresetId: "happy",
    timeoutMs: 8_000,
    trigger: () => focusChatInput(chat)
  }));
  await settleInteractionWindow(chat);

  await applyPresenceMode(chat, "focus");
  await settleInteractionWindow(chat);
  cases.push(await runExpressionVisualCase(pet, {
    caseId: "focus-work-glasses-visual-sample",
    reason: "state_work",
    stateId: "work",
    actionType: "workFocus",
    modeId: "work",
    presenceModeId: "focus",
    expressionPresetId: "glasses",
    timeoutMs: 10_000,
    trigger: () => applyDialogueMode(chat, "work")
  }));

  const telemetryEvents = readTelemetryEvents(context);
  return {
    telemetryEvents,
    unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents)
  };
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await sleep(4_200);
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
  return chat;
}

async function applyDialogueMode(chat, modeId) {
  await setDialogueMode(chat, modeId);
  await closeSettingsPage(chat);
  await sleep(700);
}

async function applyPresenceMode(chat, modeId) {
  await setPresenceMode(chat, modeId);
  await closeSettingsPage(chat);
  await sleep(700);
}

async function submitChatTurnNoWait(chat, text) {
  await setChatInputValueWithoutFocus(chat, text);
  await evaluate(chat, `
    (() => {
      const form = document.querySelector("#chat-form");
      if (!form) throw new Error("missing-chat-form");
      form.requestSubmit();
      return true;
    })()
  `);
  await sleep(120);
}

async function setChatInputValueWithoutFocus(chat, text) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      if (!input) throw new Error("Missing chat input");
      input.blur();
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await waitFor(chat, "document.querySelector('#send-button')?.disabled === false");
}

async function focusChatInput(chat) {
  await closeSettingsPage(chat);
  await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
  await sleep(300);
  await evaluate(chat, "document.querySelector('#chat-input')?.focus()");
}

async function settleInteractionWindow(chat) {
  await closeSettingsPage(chat);
  await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
  await sleep(2_650);
}

async function captureBaselineCase(pet) {
  const visualSample = await captureVisualSample(pet, {
    caseId: "baseline-settled-frame-visual-sample",
    expressionPresetId: null
  });
  return {
    caseId: "baseline-settled-frame-visual-sample",
    required: true,
    status: visualSample.ok ? "passed" : "failed",
    covered: visualSample.ok,
    expected: {
      visualState: "settled-live2d-frame",
      expressionPresetId: null
    },
    observed: null,
    visualSample
  };
}

async function runExpressionVisualCase(pet, definition) {
  const afterIndex = lastTelemetryIndex(context);
  try {
    await definition.trigger();
  } catch {
    return buildVisualCaseResult({
      ...definition,
      afterIndex,
      event: null,
      status: "failed",
      skipReason: "trigger-error",
      visualSample: null
    });
  }

  const event = await waitForAction({ ...definition, afterIndex });
  if (!event) {
    return buildVisualCaseResult({
      ...definition,
      afterIndex,
      event: null,
      status: "failed",
      skipReason: "not-observed",
      visualSample: null
    });
  }

  await sleep(220);
  const visualSample = await captureVisualSample(pet, definition);
  return buildVisualCaseResult({
    ...definition,
    afterIndex,
    event,
    visualSample,
    status: visualSample.ok ? "passed" : "failed",
    skipReason: visualSample.ok ? undefined : "blank-or-unsafe-sample"
  });
}

function buildVisualCaseResult(definition) {
  const eventIndex = definition.event?.__index ?? null;
  return {
    caseId: definition.caseId,
    required: true,
    covered: definition.status === "passed",
    status: definition.status,
    ...(definition.skipReason ? { skipReason: definition.skipReason } : {}),
    expected: {
      stateId: definition.stateId,
      reason: definition.reason,
      actionType: definition.actionType,
      modeId: definition.modeId,
      presenceModeId: definition.presenceModeId,
      expressionPresetId: definition.expressionPresetId
    },
    observed: summarizeAction(definition.event),
    telemetry: {
      afterIndex: definition.afterIndex,
      eventIndex,
      eventAfterIndex: typeof eventIndex === "number" && eventIndex > definition.afterIndex
    },
    visualSample: definition.visualSample
  };
}

async function waitForAction({
  actionType,
  reason,
  stateId,
  modeId,
  presenceModeId,
  expressionPresetId,
  afterIndex,
  timeoutMs
}) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason &&
    event.payload?.stateId === stateId &&
    event.payload?.modeId === modeId &&
    event.payload?.presenceModeId === presenceModeId &&
    event.payload?.expressionPresetId === expressionPresetId
  ), timeoutMs);
}

async function waitForTelemetry(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readTelemetryEvents(context).find(predicate);
    if (event) {
      return event;
    }
    await sleep(150);
  }
  return null;
}

async function captureVisualSample(pet, definition) {
  const surface = await readPetSurface(pet, definition.caseId);
  const screenshot = await captureScreenshotSummary(pet);
  const ok = surface.contextLost === false &&
    screenshot.captured === true &&
    screenshot.width > 0 &&
    screenshot.height > 0 &&
    screenshot.visibleColorPixels > 1_000;

  return {
    label: definition.caseId,
    expressionPresetId: definition.expressionPresetId,
    ok,
    surface,
    screenshot
  };
}

async function readPetSurface(pet, label) {
  return evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("missing-pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const gl = canvas.getContext("webgl2");
      if (!gl) throw new Error("missing-webgl2");
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      let nonTransparentPixels = 0;
      let opaqueBlackPixels = 0;
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        if (alpha > 8) {
          nonTransparentPixels += 1;
        }
        if (alpha > 240 && red < 5 && green < 5 && blue < 5) {
          opaqueBlackPixels += 1;
        }
      }
      return {
        label: ${JSON.stringify(label)},
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        nonTransparentPixels,
        opaqueBlackPixels,
        contextLost: gl.isContextLost()
      };
    })()
  `);
}

async function captureScreenshotSummary(pet) {
  const result = await pet.cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  const buffer = Buffer.from(result.data, "base64");
  const png = summarizePng(buffer);
  return {
    captured: true,
    fileWritten: false,
    byteLength: buffer.length,
    hashPrefix: createHash("sha256").update(buffer).digest("hex").slice(0, 12),
    ...png
  };
}

function summarizePng(buffer) {
  const png = decodePng(buffer);
  let nonTransparentPixels = 0;
  let visibleColorPixels = 0;
  let opaqueBlackPixels = 0;

  for (let index = 0; index < png.pixels.length; index += 4) {
    const red = png.pixels[index] ?? 0;
    const green = png.pixels[index + 1] ?? 0;
    const blue = png.pixels[index + 2] ?? 0;
    const alpha = png.pixels[index + 3] ?? 255;
    if (alpha > 8) {
      nonTransparentPixels += 1;
    }
    if (alpha > 8 && (red > 12 || green > 12 || blue > 12)) {
      visibleColorPixels += 1;
    }
    if (alpha > 240 && red < 5 && green < 5 && blue < 5) {
      opaqueBlackPixels += 1;
    }
  }

  return {
    width: png.width,
    height: png.height,
    colorType: png.colorType,
    bitDepth: png.bitDepth,
    nonTransparentPixels,
    visibleColorPixels,
    opaqueBlackPixels
  };
}

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("invalid-png-signature");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      continue;
    }

    if (type === "IDAT") {
      idatChunks.push(data);
      continue;
    }

    if (type === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8) {
    throw new Error("unsupported-png-shape");
  }

  const bytesPerPixel = getBytesPerPixel(colorType);
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rows = unfilterPngRows(inflated, width, height, bytesPerPixel);
  return {
    width,
    height,
    bitDepth,
    colorType,
    pixels: convertPngRowsToRgba(rows, width, height, bytesPerPixel, colorType)
  };
}

function getBytesPerPixel(colorType) {
  if (colorType === 6) {
    return 4;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 4) {
    return 2;
  }
  if (colorType === 0) {
    return 1;
  }
  throw new Error("unsupported-png-color-type");
}

function unfilterPngRows(inflated, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const rows = [];
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset] ?? 0;
    sourceOffset += 1;
    const source = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const raw = source[x] ?? 0;
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0;
      row[x] = (raw + getPngFilterPrediction(filter, left, up, upLeft)) & 0xff;
    }

    rows.push(row);
    previous = row;
  }

  return rows;
}

function getPngFilterPrediction(filter, left, up, upLeft) {
  if (filter === 0) {
    return 0;
  }
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return up;
  }
  if (filter === 3) {
    return Math.floor((left + up) / 2);
  }
  if (filter === 4) {
    return paethPredictor(left, up, upLeft);
  }
  throw new Error("unsupported-png-filter");
}

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) {
    return left;
  }
  return pb <= pc ? up : upLeft;
}

function convertPngRowsToRgba(rows, width, height, bytesPerPixel, colorType) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const input = x * bytesPerPixel;
      const output = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[output] = row[input] ?? 0;
        rgba[output + 1] = row[input + 1] ?? 0;
        rgba[output + 2] = row[input + 2] ?? 0;
        rgba[output + 3] = row[input + 3] ?? 255;
      } else if (colorType === 2) {
        rgba[output] = row[input] ?? 0;
        rgba[output + 1] = row[input + 1] ?? 0;
        rgba[output + 2] = row[input + 2] ?? 0;
        rgba[output + 3] = 255;
      } else if (colorType === 4) {
        const gray = row[input] ?? 0;
        rgba[output] = gray;
        rgba[output + 1] = gray;
        rgba[output + 2] = gray;
        rgba[output + 3] = row[input + 1] ?? 255;
      } else if (colorType === 0) {
        const gray = row[input] ?? 0;
        rgba[output] = gray;
        rgba[output + 1] = gray;
        rgba[output + 2] = gray;
        rgba[output + 3] = 255;
      }
    }
  }
  return rgba;
}

function createMotionBoundarySummary() {
  const audit = auditWitchMotionAssets();
  return {
    currentSemanticMotionPresetCount: audit.semanticMotionPresetCount,
    petMotionPresetIdCount: PET_MOTION_PRESET_IDS.length,
    idleSemanticAllowed: audit.idleMotion.semanticAllowed,
    safeSkipReason: audit.safeSkip?.reason ?? "none",
    blockedLicenseStatusesRejected: blockedMotionAssetLicenseStatuses.every((status) => (
      !isProductionReadyMotionAssetLicenseStatus(status)
    )),
    productionLicenseStatusesAccepted: productionMotionAssetLicenseStatuses.every((status) => (
      isProductionReadyMotionAssetLicenseStatus(status)
    ))
  };
}

function readTelemetryEvents(targetContext) {
  const logDirectory = join(targetContext.appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return [];
  }

  const events = [];
  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();

  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore a partial telemetry line from the running app.
      }
    }
  }

  return events.map((event, index) => ({ ...event, __index: index }));
}

function lastTelemetryIndex(targetContext) {
  return readTelemetryEvents(targetContext).length - 1;
}

function summarizeAction(event) {
  if (!event) {
    return null;
  }

  const payload = event.payload ?? {};
  const summary = {
    eventType: event.type === "pet_interaction_action_started" ? "started" : event.type,
    type: payload.type,
    reason: payload.reason,
    stateId: payload.stateId,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    selectedActionType: payload.selectedActionType,
    candidateActionTypes: payload.candidateActionTypes,
    durationMs: payload.durationMs
  };
  if (payload.expressionPresetId !== undefined) {
    summary.expressionPresetId = payload.expressionPresetId;
  }
  return summary;
}

function findUnsafeInteractionTelemetryFields(events) {
  const unsafe = new Set();
  for (const event of events) {
    if (!String(event.type).startsWith("pet_interaction_action_") || !event.payload) {
      continue;
    }
    for (const key of Object.keys(event.payload)) {
      if (!telemetryAllowedFields.has(key)) {
        unsafe.add(key);
      }
    }
  }
  return [...unsafe].sort();
}

function countActionStarts(events) {
  const counts = {};
  for (const event of events) {
    if (event.type !== "pet_interaction_action_started") {
      continue;
    }
    const expression = event.payload?.expressionPresetId ?? "none";
    const key = `${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId ?? "none"}:${expression}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function listUnsampledExpressionPresetIds() {
  return Object.keys(PET_EXPRESSION_PRESET_CATALOG)
    .filter((presetId) => !SAMPLE_EXPRESSION_PRESET_IDS.includes(presetId))
    .sort();
}

function isSafeSummary(value) {
  return !containsForbiddenOutput(JSON.stringify(value));
}

function containsForbiddenOutput(text) {
  return forbiddenOutputPatterns.some((pattern) => pattern.test(text));
}

function stripKnownInternalRuntimeTelemetry(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !(line.includes('"type":"startup"') && line.includes('"userDataPath"')))
    .filter((line) => !(line.includes('"type":"provider_request_') && line.includes('"promptTemplateProfile"')))
    .join("\n");
}

function writeResult(summary) {
  if (context) {
    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out|timeout/i.test(message)) {
    return "timeout";
  }
  if (/Screenshot residue/i.test(message)) {
    return "screenshot_residue";
  }
  if (/png/i.test(message)) {
    return "screenshot_parse";
  }
  if (/CDP timeout|WebSocket/i.test(message)) {
    return "browser_control";
  }
  return "script_failed";
}

await main();
