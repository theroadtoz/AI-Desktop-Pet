import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const PET_VISIBLE_INSET_RATIO = 0.1;
const PET_WAIST_RATIO = 0.58;
const PET_INITIAL_RIGHT_MARGIN_PX = 50;
const PET_WAIST_BOTTOM_OVERHANG_PX = 96;
const GEOMETRY_TOLERANCE_PX = 16;

const context = createRealUiRunContext({
  runName: "p2-25b-edge-positioning-half-body-presence-real-ui",
  port: Number(process.env.P2_25B_CDP_PORT || 9626),
  env: {
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_25B_IDLE_INTERVAL_MS || "60000"
  }
});

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider 请求正文|完整 prompt|fact card|用户全文|AI 全文|request body/i,
  /model\.gguf.*[A-Z]:\\/i
];

async function main() {
  log(context, `runDir=${context.runDir}`);
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    const { pet } = await startApp();

    const initial = await measurePet(pet, "initial");
    observations.initial = summarizePlacement(initial);
    const initialMetrics = calculatePlacementMetrics(initial);
    checks.initialRightMargin = isApproximately(
      initialMetrics.rightMarginPx,
      PET_INITIAL_RIGHT_MARGIN_PX,
      GEOMETRY_TOLERANCE_PX
    );
    checks.initialWaistOverhang = isApproximately(
      initialMetrics.waistOffsetFromWorkAreaBottomPx,
      PET_WAIST_BOTTOM_OVERHANG_PX,
      GEOMETRY_TOLERANCE_PX
    );
    checks.initialHalfBodyOffscreen = initialMetrics.bottomOverWorkAreaPx > 48;
    checks.initialVisibleRegionSafe = isVisibleRegionWithinAllowedArea(initialMetrics);

    const dragResults = {};
    dragResults.left = await dragAndMeasure(pet, "left-edge", 410, [[-900, 0], [-1_800, 0], [-3_000, 0]]);
    checks.leftVisibleEdgeTouches = isApproximately(
      calculatePlacementMetrics(dragResults.left).visibleLeftGapPx,
      0,
      GEOMETRY_TOLERANCE_PX
    );

    dragResults.right = await dragAndMeasure(pet, "right-edge", 420, [[900, 0], [1_800, 0], [3_000, 0]]);
    checks.rightVisibleEdgeTouches = isApproximately(
      calculatePlacementMetrics(dragResults.right).rightMarginPx,
      0,
      GEOMETRY_TOLERANCE_PX
    );

    dragResults.top = await dragAndMeasure(pet, "top-edge", 430, [[0, -900], [0, -1_800], [0, -3_000]]);
    checks.topVisibleEdgeTouches = isApproximately(
      calculatePlacementMetrics(dragResults.top).visibleTopGapPx,
      0,
      GEOMETRY_TOLERANCE_PX
    );

    await sleep(1_200);
    const beforeBottomIndex = lastTelemetryIndex();
    dragResults.bottom = await dragAndMeasure(pet, "bottom-overhang", 440, [[0, 900], [0, 1_800], [0, 3_000]]);
    const bottomMetrics = calculatePlacementMetrics(dragResults.bottom);
    checks.bottomWaistOverhang = isApproximately(
      bottomMetrics.waistOffsetFromWorkAreaBottomPx,
      PET_WAIST_BOTTOM_OVERHANG_PX,
      GEOMETRY_TOLERANCE_PX
    );
    checks.bottomHalfBodyOffscreen = bottomMetrics.bottomOverWorkAreaPx > 48;
    const bottomEdgeAction = await waitForAction({
      actionType: "edgeGlance",
      reason: "pet_edge_settled",
      stateId: "edge",
      timeoutMs: 8_000,
      afterIndex: beforeBottomIndex
    });
    checks.bottomEdgeActionObserved = Boolean(bottomEdgeAction);

    observations.dragResults = Object.fromEntries(
      Object.entries(dragResults).map(([key, value]) => [key, summarizePlacement(value)])
    );
    observations.bottomEdgeAction = summarizeAction(bottomEdgeAction);
    checks.dragKeepsStableSize = Object.values(dragResults).every((measurement) => (
      Math.abs(measurement.viewport.innerWidth - initial.viewport.innerWidth) <= 2 &&
      Math.abs(measurement.viewport.innerHeight - initial.viewport.innerHeight) <= 2
    ));

    const chat = await openChatFromPet(pet);
    await evaluate(chat, "window.petPresentationApi.setPetLocked(true)", true);
    await sleep(600);
    const beforeLockedDrag = await measurePet(pet, "before-locked-drag");
    await dragWithOffsets(pet, 450, [[160, 0], [-160, 0], [160, 0], [-160, 0]], 60);
    const afterLockedDrag = await measurePet(pet, "after-locked-drag");
    checks.lockedDragDoesNotMove = (
      Math.abs(afterLockedDrag.screen.x - beforeLockedDrag.screen.x) <= 2 &&
      Math.abs(afterLockedDrag.screen.y - beforeLockedDrag.screen.y) <= 2
    );
    observations.lockedDrag = {
      before: summarizePlacement(beforeLockedDrag),
      after: summarizePlacement(afterLockedDrag)
    };
    await evaluate(chat, "window.petPresentationApi.setPetLocked(false)", true);

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]);
    checks.noForbiddenText = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
    checks.telemetrySafeSummary = !/"content":|"prompt":|"providerRequestBody":|"factCardBody":|"apiKey":/.test(privacyText);
    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidueBeforeCleanup = residueBeforeCleanup.length === 0;

    const summary = {
      ok: Object.values(checks).every(Boolean),
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      expected: {
        initialRightMarginPx: PET_INITIAL_RIGHT_MARGIN_PX,
        waistBottomOverhangPx: PET_WAIST_BOTTOM_OVERHANG_PX,
        geometryTolerancePx: GEOMETRY_TOLERANCE_PX
      },
      checks,
      observations
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      checks,
      observations,
      failureCategory: classifyError(error),
      error: error instanceof Error ? error.message : String(error)
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_25B_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitFor(pet, "Boolean(document.querySelector('#pet-canvas'))");
  await waitForFirstFrame();
  await sleep(2_000);
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(window.petPresentationApi)");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  return chat;
}

async function measurePet(pet, label) {
  return evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("Missing pet canvas");
      const rect = canvas.getBoundingClientRect();
      const availLeft = Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0;
      const availTop = Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0;
      return {
        label: ${JSON.stringify(label)},
        screen: {
          x: Math.round(window.screenX),
          y: Math.round(window.screenY)
        },
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio
        },
        canvasCss: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        workArea: {
          x: Math.round(availLeft),
          y: Math.round(availTop),
          width: Math.round(window.screen.availWidth),
          height: Math.round(window.screen.availHeight)
        }
      };
    })()
  `);
}

async function dragAndMeasure(pet, label, pointerId, offsets) {
  await dragWithOffsets(pet, pointerId, offsets, 80);
  await sleep(650);
  return measurePet(pet, label);
}

async function dragWithOffsets(pet, pointerId, offsets, delayMs) {
  await dispatchPointerDown(pet, pointerId);
  for (const [offsetX, offsetY] of offsets) {
    await dispatchPointerMove(pet, pointerId, offsetX, offsetY);
    await sleep(delayMs);
  }
  const [lastX, lastY] = offsets.at(-1) ?? [0, 0];
  await dispatchPointerUp(pet, pointerId, lastX, lastY);
  await sleep(500);
}

async function dispatchPointerDown(pet, pointerId) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      window.__p225bDragBase = {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: window.__p225bDragBase.screenX,
        screenY: window.__p225bDragBase.screenY,
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function dispatchPointerMove(pet, pointerId, offsetX, offsetY) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      const base = window.__p225bDragBase ?? {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x + ${offsetX},
        clientY: y + ${offsetY},
        screenX: base.screenX + ${offsetX},
        screenY: base.screenY + ${offsetY},
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function dispatchPointerUp(pet, pointerId, offsetX, offsetY) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      const base = window.__p225bDragBase ?? {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x + ${offsetX},
        clientY: y + ${offsetY},
        screenX: base.screenX + ${offsetX},
        screenY: base.screenY + ${offsetY},
        bubbles: true
      }));
    })()
  `);
}

function calculateVisibleRegion(measurement) {
  const width = measurement.viewport.innerWidth;
  const height = measurement.viewport.innerHeight;
  const visibleLeft = width * PET_VISIBLE_INSET_RATIO;
  const visibleRight = width * (1 - PET_VISIBLE_INSET_RATIO);
  const visibleTop = height * PET_VISIBLE_INSET_RATIO;
  const visibleBottom = height * (1 - PET_VISIBLE_INSET_RATIO);

  return {
    visibleLeft,
    visibleRight,
    visibleTop,
    visibleBottom,
    waistY: visibleTop + (visibleBottom - visibleTop) * PET_WAIST_RATIO
  };
}

function calculatePlacementMetrics(measurement) {
  const region = calculateVisibleRegion(measurement);
  const workAreaRight = measurement.workArea.x + measurement.workArea.width;
  const workAreaBottom = measurement.workArea.y + measurement.workArea.height;
  const visibleLeftScreen = measurement.screen.x + region.visibleLeft;
  const visibleRightScreen = measurement.screen.x + region.visibleRight;
  const visibleTopScreen = measurement.screen.y + region.visibleTop;
  const waistScreen = measurement.screen.y + region.waistY;
  const bottomScreen = measurement.screen.y + measurement.viewport.innerHeight;

  return {
    visibleLeftGapPx: Math.round(visibleLeftScreen - measurement.workArea.x),
    rightMarginPx: Math.round(workAreaRight - visibleRightScreen),
    visibleTopGapPx: Math.round(visibleTopScreen - measurement.workArea.y),
    waistOffsetFromWorkAreaBottomPx: Math.round(waistScreen - workAreaBottom),
    bottomOverWorkAreaPx: Math.round(bottomScreen - workAreaBottom),
    visibleLeftScreen: Math.round(visibleLeftScreen),
    visibleRightScreen: Math.round(visibleRightScreen),
    visibleTopScreen: Math.round(visibleTopScreen),
    waistScreen: Math.round(waistScreen),
    bottomScreen: Math.round(bottomScreen)
  };
}

function isVisibleRegionWithinAllowedArea(metrics) {
  return (
    metrics.visibleLeftGapPx >= -GEOMETRY_TOLERANCE_PX &&
    metrics.rightMarginPx >= -GEOMETRY_TOLERANCE_PX &&
    metrics.visibleTopGapPx >= -GEOMETRY_TOLERANCE_PX &&
    metrics.waistOffsetFromWorkAreaBottomPx <= PET_WAIST_BOTTOM_OVERHANG_PX + GEOMETRY_TOLERANCE_PX
  );
}

function summarizePlacement(measurement) {
  return {
    label: measurement.label,
    screen: measurement.screen,
    viewport: measurement.viewport,
    workArea: measurement.workArea,
    metrics: calculatePlacementMetrics(measurement)
  };
}

function isApproximately(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

function readTelemetryEvents() {
  const logDirectory = join(context.appDataDir, "logs");
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

function lastTelemetryIndex() {
  return readTelemetryEvents().length - 1;
}

async function waitForFirstFrame() {
  const event = await waitForTelemetry((candidate) => candidate.type === "first_frame", 30_000);
  if (!event) {
    throw new Error("Timed out waiting for first_frame telemetry");
  }
}

async function waitForAction({
  actionType,
  reason,
  stateId,
  timeoutMs,
  afterIndex = -1
}) {
  return waitForTelemetry((event) => (
    event.type === "pet_interaction_action_started" &&
    event.__index > afterIndex &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason &&
    (stateId === undefined || event.payload?.stateId === stateId)
  ), timeoutMs);
}

async function waitForTelemetry(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = readTelemetryEvents().find(predicate);
    if (event) {
      return event;
    }
    await sleep(150);
  }

  return null;
}

function summarizeAction(event) {
  if (!event) {
    return null;
  }

  return {
    index: event.__index,
    type: event.payload?.type,
    reason: event.payload?.reason,
    stateId: event.payload?.stateId,
    durationMs: event.payload?.durationMs
  };
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out/i.test(message)) {
    return "timeout";
  }
  if (/Screenshot residue/i.test(message)) {
    return "screenshot_residue";
  }
  return "script_failed";
}

await main();
