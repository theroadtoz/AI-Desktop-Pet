import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  setDialogueMode,
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import {
  captureVisiblePageFrame,
  waitForVisibleRendererFrame
} from "./p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-63c-2-yawn-runtime-state-conflict-real-ui";
const MANIFEST_RELATIVE_PATH = "resources/models/witch/model-manifest.json";
const YAWN_RELATIVE_PATH = "resources/models/witch/motions/yawn-once.motion3.json";
const YAWN_PRESET_ID = "yawn-once";
const YAWN_SHA256 = "eca4ad06bb4665c3d4ae2a619a1d6528360044935508d08b06310ea3125b52b4";
const P2_63C_2_YAWN_SAMPLE_COUNT = 5;
const P2_63C_2_YAWN_SAMPLE_INTERVAL_MS = 250;
const INTERRUPTED_TARGETS = [
  { scenarioKey: "sleepToWork", checkKey: "sleepToWorkInterrupted", modeId: "work", actionType: "workFocus", reason: "state_work", stateId: "work" },
  { scenarioKey: "sleepToReading", checkKey: "sleepToReadingInterrupted", modeId: "reading", actionType: "readingIdle", reason: "state_read", stateId: "read" },
  { scenarioKey: "sleepToGame", checkKey: "sleepToGameInterrupted", modeId: "game", actionType: "gameReady", reason: "state_game", stateId: "game" }
];

function isYawnStart(event) {
  return event.type === "pet_interaction_action_started" &&
    event.payload?.type === "doze" &&
    event.payload?.reason === "state_sleep" &&
    event.payload?.stateId === "sleep" &&
    event.payload?.motionPresetId === YAWN_PRESET_ID;
}

function isYawnFinish(event, terminalStatus) {
  return event.type === "pet_interaction_action_finished" &&
    event.payload?.type === "doze" &&
    event.payload?.reason === "state_sleep" &&
    event.payload?.motionPresetId === YAWN_PRESET_ID &&
    event.payload?.terminalStatus === terminalStatus;
}

export function evaluateNaturalCompletedScenario(events, afterIndex = -1) {
  const scoped = events.filter((event) => event.__index > afterIndex);
  const starts = scoped.filter(isYawnStart);
  const observedFinishes = scoped.filter((event) => (
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === "doze" &&
    event.payload?.reason === "state_sleep" &&
    event.payload?.motionPresetId === YAWN_PRESET_ID
  ));
  const finishes = scoped.filter((event) => isYawnFinish(event, "completed"));
  const startIndex = starts[0]?.__index ?? null;
  const finishIndex = finishes[0]?.__index ?? null;
  const strictOrder = startIndex !== null && finishIndex !== null && startIndex < finishIndex;

  return {
    passed: starts.length === 1 && finishes.length === 1 && strictOrder,
    yawnStartedCount: starts.length,
    restoreMarkerCount: finishes.length,
    observedRestoreMarkerCount: observedFinishes.length,
    observedTerminalStatus: observedFinishes[0]?.payload?.terminalStatus ?? null,
    terminalStatus: finishes[0]?.payload?.terminalStatus ?? null,
    motionPresetId: finishes[0]?.payload?.motionPresetId ?? null,
    strictOrder,
    startIndex,
    finishIndex
  };
}

export function evaluateInterruptedStateScenario(events, target, afterIndex = -1) {
  const scoped = events.filter((event) => event.__index > afterIndex);
  const starts = scoped.filter(isYawnStart);
  const finishes = scoped.filter((event) => isYawnFinish(event, "interrupted"));
  const targets = scoped.filter((event) => (
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === target.actionType &&
    event.payload?.reason === target.reason &&
    event.payload?.stateId === target.stateId
  ));
  const activeActionSkips = scoped.filter((event) => (
    event.type === "pet_interaction_action_skipped" &&
    event.payload?.reason === target.reason &&
    event.payload?.stateId === target.stateId &&
    event.payload?.skipReason === "active_action"
  ));
  const startIndex = starts[0]?.__index ?? null;
  const finishIndex = finishes[0]?.__index ?? null;
  const targetIndex = targets[0]?.__index ?? null;
  const strictOrder = startIndex !== null && finishIndex !== null && targetIndex !== null &&
    startIndex < finishIndex && finishIndex < targetIndex;

  return {
    passed: starts.length === 1 && finishes.length === 1 && targets.length === 1 &&
      activeActionSkips.length === 0 && strictOrder,
    yawnStartedCount: starts.length,
    restoreMarkerCount: finishes.length,
    targetStartedCount: targets.length,
    activeActionSkipCount: activeActionSkips.length,
    terminalStatus: finishes[0]?.payload?.terminalStatus ?? null,
    motionPresetId: finishes[0]?.payload?.motionPresetId ?? null,
    strictOrder,
    startIndex,
    finishIndex,
    targetIndex
  };
}

export function evaluateInterruptedWorkScenario(events, afterIndex = -1) {
  return evaluateInterruptedStateScenario(events, INTERRUPTED_TARGETS[0], afterIndex);
}

export function evaluateActiveYawnInteractionScenario(events, afterIndex = -1) {
  const scoped = events.filter((event) => event.__index > afterIndex);
  const starts = scoped.filter(isYawnStart);
  const isActiveYawnSkip = (event, reason) => (
    event.type === "pet_interaction_action_skipped" &&
    event.payload?.reason === reason &&
    event.payload?.skipReason === "active_action" &&
    event.payload?.activeType === "doze" &&
    event.payload?.motionPresetId === YAWN_PRESET_ID
  );
  const headSkips = scoped.filter((event) => isActiveYawnSkip(event, "click_head"));
  const bodySkips = scoped.filter((event) => isActiveYawnSkip(event, "click_body"));
  const overrides = scoped.filter((event) => (
    event.type === "pet_interaction_action_started" && !isYawnStart(event)
  ));

  return {
    passed: starts.length === 1 && headSkips.length === 1 && bodySkips.length === 1 && overrides.length === 0,
    yawnStartedCount: starts.length,
    headSkipCount: headSkips.length,
    bodySkipCount: bodySkips.length,
    overrideStartedCount: overrides.length
  };
}

export function evaluateCanvasContinuity(frames) {
  const nonemptyFrames = frames.filter((frame) => (
    frame?.nonTransparentPixels > 1_000 &&
    frame?.contextLost === false &&
    frame?.width > 0 &&
    frame?.height > 0
  ));
  const hashes = new Set(nonemptyFrames.map((frame) => frame.frameHash).filter((hash) => typeof hash === "string"));

  return {
    passed: frames.length >= P2_63C_2_YAWN_SAMPLE_COUNT && nonemptyFrames.length >= 3 && hashes.size >= 2,
    sampleCount: frames.length,
    nonemptyFrameCount: nonemptyFrames.length,
    distinctFrameHashes: hashes.size
  };
}

export function evaluateStartedActionEchoScenario(observer) {
  return {
    passed: observer?.activeTransitions === 1 && typeof observer?.activeText === "string" && observer.activeText.startsWith("小动作："),
    activeTransitions: observer?.activeTransitions ?? 0,
    activeText: typeof observer?.activeText === "string" ? observer.activeText : null
  };
}

export function evaluateTerminalTelemetrySafety(events, afterIndex = -1) {
  const terminals = events.filter((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === "doze" &&
    event.payload?.reason === "state_sleep" &&
    event.payload?.motionPresetId === YAWN_PRESET_ID
  ));
  const unsafeTerminal = terminals.find((event) => (
    !["completed", "interrupted"].includes(event.payload?.terminalStatus) ||
    ["error", "message", "stack", "cause"].some((key) => Object.hasOwn(event.payload ?? {}, key))
  ));

  return {
    passed: terminals.length > 0 && !unsafeTerminal,
    terminalCount: terminals.length,
    terminalStatuses: terminals.map((event) => event.payload?.terminalStatus ?? null),
    unsafeTerminalObserved: Boolean(unsafeTerminal)
  };
}

async function main() {
  const context = createRealUiRunContext({
    runName: RUN_NAME,
    port: Number(process.env.P2_63C_2_CDP_PORT || 9664),
    env: {
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: "60000"
    },
    tmpResiduePatterns: [/^p2-63c-2-/i]
  });
  const startedAt = Date.now();
  const checks = {};
  const scenarios = {};
  const cleanup = {
    electronStopped: false,
    screenshotResidue: [],
    tmpRemoved: false
  };
  let electronPid = null;
  let failure = null;
  let diagnostics = [];

  try {
    checks.productionAsset = verifyProductionYawn();
    startElectron(context);
    electronPid = context.child?.pid ?? null;
    await connectToElectron(context, 40_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitForTelemetry(context, (event) => (
      event.type === "pet_interaction_action_finished" && event.payload?.type === "appearance"
    ), 12_000);

    await evaluate(pet, "window.petApi?.openChat()");
    const chat = await waitForWindow(context, "renderer/chat/index.html", 20_000);
    await waitFor(chat, "Boolean(document.querySelector('#chat-page'))", { timeoutMs: 15_000 });
    await setDialogueMode(chat, "default");
    await setPresenceMode(chat, "default");

    await observeStartedActionEcho(chat);
    const naturalStartIndex = lastTelemetryIndex(context);
    await setPresenceMode(chat, "sleep");
    await requireTelemetry(context, (event) => event.__index > naturalStartIndex && isYawnStart(event), 8_000, "natural-yawn-native-start");
    await setPresenceMode(chat, "sleep");
    await sleep(500);
    checks.naturalRepeatedSleepDidNotStack = countEventsAfter(context, naturalStartIndex, isYawnStart) === 1;
    scenarios.canvasContinuity = evaluateCanvasContinuity(
      await captureNaturalYawnFrames(pet, context, naturalStartIndex)
    );
    await requireTelemetry(context, (event) => (
      event.__index > naturalStartIndex &&
      event.type === "pet_interaction_action_finished" &&
      event.payload?.type === "doze" &&
      event.payload?.motionPresetId === YAWN_PRESET_ID
    ), 8_000, "natural-yawn-terminal");
    scenarios.naturalCompleted = evaluateNaturalCompletedScenario(readTelemetryEvents(context), naturalStartIndex);
    scenarios.startedActionEcho = evaluateStartedActionEchoScenario(await readStartedActionEcho(chat));

    for (const target of INTERRUPTED_TARGETS) {
      await setPresenceMode(chat, "default");
      await setDialogueMode(chat, "default");
      await sleep(600);

      const interruptedStartIndex = lastTelemetryIndex(context);
      await setPresenceMode(chat, "sleep");
      await requireTelemetry(context, (event) => event.__index > interruptedStartIndex && isYawnStart(event), 8_000, `${target.modeId}-yawn-native-start`);
      await setPresenceMode(chat, "default");
      await setDialogueMode(chat, target.modeId);
      await requireTelemetry(
        context,
        (event) => event.__index > interruptedStartIndex && isYawnFinish(event, "interrupted"),
        4_000,
        `${target.modeId}-yawn-interrupted`
      );
      await requireTelemetry(context, (event) => (
        event.__index > interruptedStartIndex &&
        event.type === "pet_interaction_action_started" &&
        event.payload?.type === target.actionType &&
        event.payload?.reason === target.reason &&
        event.payload?.stateId === target.stateId
      ), 8_000, `${target.modeId}-target-started`);
      scenarios[target.scenarioKey] = evaluateInterruptedStateScenario(readTelemetryEvents(context), target, interruptedStartIndex);
      checks[target.checkKey] = scenarios[target.scenarioKey].passed;
    }

    await setPresenceMode(chat, "default");
    await setDialogueMode(chat, "default");
    await sleep(600);
    const interactionStartIndex = lastTelemetryIndex(context);
    await setPresenceMode(chat, "sleep");
    await requireTelemetry(context, (event) => event.__index > interactionStartIndex && isYawnStart(event), 8_000, "interaction-yawn-native-start");
    await clickPet(pet, "head");
    await requireTelemetry(context, (event) => (
      event.__index > interactionStartIndex &&
      event.type === "pet_interaction_action_skipped" &&
      event.payload?.reason === "click_head" &&
      event.payload?.skipReason === "active_action" &&
      event.payload?.activeType === "doze" &&
      event.payload?.motionPresetId === YAWN_PRESET_ID
    ), 4_000, "head-active-yawn-skip");
    await clickPet(pet, "body");
    await requireTelemetry(context, (event) => (
      event.__index > interactionStartIndex &&
      event.type === "pet_interaction_action_skipped" &&
      event.payload?.reason === "click_body" &&
      event.payload?.skipReason === "active_action" &&
      event.payload?.activeType === "doze" &&
      event.payload?.motionPresetId === YAWN_PRESET_ID
    ), 4_000, "body-active-yawn-skip");
    scenarios.activeYawnInteraction = evaluateActiveYawnInteractionScenario(readTelemetryEvents(context), interactionStartIndex);
    await setPresenceMode(chat, "default");
    await requireTelemetry(context, (event) => (
      event.__index > interactionStartIndex && isYawnFinish(event, "interrupted")
    ), 4_000, "interaction-yawn-interrupted");

    scenarios.terminalTelemetrySafety = evaluateTerminalTelemetrySafety(readTelemetryEvents(context));

    checks.naturalCompleted = scenarios.naturalCompleted.passed;
    checks.canvasContinuous = scenarios.canvasContinuity.passed;
    checks.startedActionEchoOnce = scenarios.startedActionEcho.passed;
    checks.activeYawnInteractionSkipped = scenarios.activeYawnInteraction.passed;
    checks.terminalTelemetrySafe = scenarios.terminalTelemetrySafety.passed;
    checks.safeMotionTelemetry = [
      scenarios.naturalCompleted,
      ...INTERRUPTED_TARGETS.map((target) => scenarios[target.scenarioKey])
    ].every((scenario) => (
      scenario.motionPresetId === YAWN_PRESET_ID &&
      ["completed", "interrupted"].includes(scenario.terminalStatus)
    ));
  } catch (error) {
    failure = sanitizeError(error);
    diagnostics = readTelemetryEvents(context)
      .filter((event) => event.payload?.type === "doze" || event.payload?.motionPresetId === YAWN_PRESET_ID)
      .map(summarizeTelemetryEvent);
  } finally {
    writeFileSync(context.resultPath, `${JSON.stringify({ checks, scenarios, failure }, null, 2)}\n`, "utf8");
    await stopElectron(context);
    cleanup.electronStopped = await waitForElectronStopped(context.port, electronPid);
    cleanup.screenshotResidue = findScreenshotResidue(context)
      .filter((path) => !path.includes(context.runParentDir));
    cleanupRealUiRun(context);
    cleanup.tmpRemoved = !existsSync(context.runParentDir);
  }

  checks.noScreenshotResidue = cleanup.screenshotResidue.length === 0;
  checks.electronStopped = cleanup.electronStopped;
  checks.tmpRemoved = cleanup.tmpRemoved;
  const summary = {
    ok: failure === null && Object.values(checks).every(Boolean),
    safeSummaryOnly: true,
    productionApp: true,
    sourceInjection: false,
    fakeMotionTerminal: false,
    durationMs: Date.now() - startedAt,
    checks,
    scenarios,
    diagnostics,
    cleanup,
    failure
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

function verifyProductionYawn() {
  const manifestPath = join(ROOT, ...MANIFEST_RELATIVE_PATH.split("/"));
  const motionPath = join(ROOT, ...YAWN_RELATIVE_PATH.split("/"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const preset = manifest.motionPresets?.find((candidate) => candidate.id === YAWN_PRESET_ID);
  const hash = createHash("sha256").update(readFileSync(motionPath)).digest("hex");
  if (!preset || preset.path !== "motions/yawn-once.motion3.json" || preset.loop !== false || hash !== YAWN_SHA256) {
    throw new Error("production-yawn-registration-invalid");
  }
  return true;
}

function readTelemetryEvents(context) {
  const logDirectory = join(context.appDataDir, "logs");
  if (!existsSync(logDirectory)) return [];
  const events = [];
  for (const name of readdirSync(logDirectory).filter((entry) => entry.startsWith("telemetry-") && entry.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(logDirectory, name), "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events.map((event, index) => ({ ...event, __index: index }));
}

function lastTelemetryIndex(context) {
  return readTelemetryEvents(context).length - 1;
}

function countEventsAfter(context, afterIndex, predicate) {
  return readTelemetryEvents(context).filter((event) => event.__index > afterIndex && predicate(event)).length;
}

async function waitForTelemetry(context, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readTelemetryEvents(context).find(predicate);
    if (match) return match;
    await sleep(150);
  }
  return null;
}

async function requireTelemetry(context, predicate, timeoutMs, label) {
  const event = await waitForTelemetry(context, predicate, timeoutMs);
  if (!event) throw new Error(`telemetry-timeout:${label}`);
  return event;
}

async function clickPet(pet, hitArea) {
  const yRatio = hitArea === "head" ? 0.2 : 0.48;
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("missing-pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * ${yRatio};
      for (const type of ["pointerdown", "pointerup"]) {
        canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: 63,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          buttons: type === "pointerdown" ? 1 : 0,
          bubbles: true
        }));
      }
    })()
  `);
  await sleep(250);
}

async function captureNaturalYawnFrames(pet, context, afterIndex) {
  const frames = [];
  for (let index = 0; index < P2_63C_2_YAWN_SAMPLE_COUNT; index += 1) {
    assertNaturalYawnStillActive(context, afterIndex);
    const frame = await captureVisiblePageFrame({
      waitForVisibleFrame: () => waitForVisibleRendererFrame(pet),
      capturePageScreenshot: async () => {
        const result = await pet.cdp.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false
        });
        return Buffer.from(result.data, "base64");
      }
    });
    assertNaturalYawnStillActive(context, afterIndex);
    frames.push({
      width: frame.width,
      height: frame.height,
      contextLost: frame.rendererContextLost,
      nonTransparentPixels: frame.pngNonTransparentPixels,
      rendererNonTransparentPixels: frame.rendererNonTransparentPixels,
      frameHash: createHash("sha256").update(frame.data).digest("hex").slice(0, 16)
    });
    if (index < P2_63C_2_YAWN_SAMPLE_COUNT - 1) {
      await sleep(P2_63C_2_YAWN_SAMPLE_INTERVAL_MS);
    }
  }
  return frames;
}

function assertNaturalYawnStillActive(context, afterIndex) {
  const terminal = readTelemetryEvents(context).find((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === "doze" &&
    event.payload?.reason === "state_sleep" &&
    event.payload?.motionPresetId === YAWN_PRESET_ID
  ));
  if (terminal) throw new Error("natural-yawn-ended-before-visual-sampling-completed");
}

async function observeStartedActionEcho(chat) {
  await evaluate(chat, `
    (() => {
      const key = "__P2_63C_2_ACTION_ECHO_OBSERVER__";
      globalThis[key]?.observer?.disconnect();
      const echo = document.querySelector("#shelf-action-echo");
      if (!echo) throw new Error("missing-shelf-action-echo");
      const summary = {
        activeTransitions: 0,
        activeText: null,
        lastState: echo.dataset.state ?? "",
        lastText: echo.textContent ?? ""
      };
      const observe = () => {
        const state = echo.dataset.state ?? "";
        const text = echo.textContent ?? "";
        if (state === "active" && (state !== summary.lastState || text !== summary.lastText)) {
          summary.activeTransitions += 1;
          summary.activeText = text;
        }
        summary.lastState = state;
        summary.lastText = text;
      };
      const observer = new MutationObserver(observe);
      observer.observe(echo, {
        attributes: true,
        attributeFilter: ["data-state"],
        childList: true,
        characterData: true,
        subtree: true
      });
      globalThis[key] = { observer, summary };
    })()
  `);
}

async function readStartedActionEcho(chat) {
  return evaluate(chat, `
    (() => {
      const summary = globalThis.__P2_63C_2_ACTION_ECHO_OBSERVER__?.summary;
      return summary
        ? { activeTransitions: summary.activeTransitions, activeText: summary.activeText }
        : null;
    })()
  `);
}

async function waitForElectronStopped(port, pid) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    const endpointClosed = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(() => false)
      .catch(() => true);
    let processStopped = true;
    if (pid) {
      try {
        process.kill(pid, 0);
        processStopped = false;
      } catch {}
    }
    if (endpointClosed && processStopped) return true;
    await sleep(200);
  }
  return false;
}

function sanitizeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: String(error instanceof Error ? error.message : error).slice(0, 500)
  };
}

function summarizeTelemetryEvent(event) {
  return {
    index: event.__index,
    type: event.type,
    actionType: event.payload?.type ?? null,
    reason: event.payload?.reason ?? null,
    stateId: event.payload?.stateId ?? null,
    skipReason: event.payload?.skipReason ?? null,
    activeType: event.payload?.activeType ?? null,
    motionPresetId: event.payload?.motionPresetId ?? null,
    terminalStatus: event.payload?.terminalStatus ?? null
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
