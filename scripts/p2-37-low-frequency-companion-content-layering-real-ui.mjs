import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  readPrivacyCheckText,
  setDialogueMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const requestedTimeBand =
  process.env.P2_37_PROACTIVE_SPEECH_BUBBLE_TIME_BAND ||
  process.env.P2_37_COMPANION_TIME_BAND ||
  "evening";
const contentLayeringPlans = {
  morning: {
    defaultIdleLineId: "idle_presence_morning",
    dialogueModeId: "work",
    modePresenceLineId: "mode_presence_work",
    layeredIdleLineId: "idle_presence_work_morning"
  },
  afternoon: {
    defaultIdleLineId: "idle_presence_afternoon",
    dialogueModeId: "work",
    modePresenceLineId: "mode_presence_work",
    layeredIdleLineId: "idle_presence_work_afternoon"
  },
  evening: {
    defaultIdleLineId: "idle_presence_evening",
    dialogueModeId: "game",
    modePresenceLineId: "mode_presence_game",
    layeredIdleLineId: "idle_presence_game_evening"
  },
  night: {
    defaultIdleLineId: "idle_presence_night",
    dialogueModeId: "reading",
    modePresenceLineId: "mode_presence_reading",
    layeredIdleLineId: "idle_presence_reading_night"
  }
};
const selectedPlan = contentLayeringPlans[requestedTimeBand] ?? contentLayeringPlans.evening;

const context = createRealUiRunContext({
  runName: "p2-37-low-frequency-companion-content-layering-real-ui",
  port: Number(process.env.P2_37_CDP_PORT || 9567),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_37_IDLE_INTERVAL_MS || "850",
    AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
      process.env.P2_37_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "900",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: requestedTimeBand
  }
});

const allowedLineIds = new Set([
  "startup_presence_ready",
  "startup_presence_soft",
  "startup_presence_focus",
  "idle_presence_soft",
  "idle_presence_default",
  "idle_presence_focus",
  "idle_presence_quiet",
  "idle_presence_work",
  "idle_presence_game",
  "idle_presence_reading",
  "idle_presence_morning",
  "idle_presence_afternoon",
  "idle_presence_evening",
  "idle_presence_night",
  "idle_presence_work_morning",
  "idle_presence_work_afternoon",
  "idle_presence_reading_evening",
  "idle_presence_reading_night",
  "idle_presence_game_evening",
  "idle_presence_context_settle",
  "idle_presence_memory_safe",
  "idle_presence_search_citation",
  "mode_presence_focus",
  "mode_presence_work",
  "mode_presence_game",
  "mode_presence_reading"
]);

const allowedBubbleReasons = new Set([
  "startup_presence",
  "idle_presence",
  "mode_presence"
]);

const allowedLowFrequencyEventIds = new Set([
  "idle-presence-check",
  "context-settle",
  "mode-presence-echo"
]);

const forbiddenDomDatasetKeys = new Set([
  "eventId",
  "timeBand"
]);

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/i,
  /\.env/i,
  /Provider request body|providerRequestBody|requestBody/i,
  /complete prompt|system prompt|prompt/i,
  /userMessage|assistantMessage|messageText|bubbleText|textContent/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /memory content|search content|search query|search result|safeQuery|snippet|domain|url|title/i,
  /apiKey|Authorization/i,
  /motion path|motionPath|expressionName|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    const { pet } = await startApp();

    const startupBubble = await waitForBubbleVisible(pet, {
      reason: "startup_presence",
      timeoutMs: 10_000
    });
    checks.startupBubbleSafe = inspectBubbleSafety(startupBubble);
    observations.startupBubble = summarizeBubble(startupBubble);

    await waitForBubbleHidden(pet, 10_000);

    const beforeDefaultIdleIndex = lastTelemetryIndex();
    const defaultIdleBubble = await waitForBubbleVisible(pet, {
      reason: "idle_presence",
      lineId: selectedPlan.defaultIdleLineId,
      timeoutMs: 10_000
    });
    const defaultIdleEvent = await waitForLowFrequencyEvent({
      status: "shown",
      afterIndex: beforeDefaultIdleIndex,
      timeoutMs: 2_500
    });
    const defaultIdleTelemetry = await waitForProactiveBubble({
      status: "shown",
      lineId: selectedPlan.defaultIdleLineId,
      afterIndex: beforeDefaultIdleIndex,
      timeoutMs: 1_500
    });
    checks.defaultTimeBandIdleLineShown = defaultIdleBubble.lineId === selectedPlan.defaultIdleLineId &&
      defaultIdleBubble.reason === "idle_presence" &&
      inspectBubbleSafety(defaultIdleBubble);
    checks.defaultIdleLowFrequencyEventShown = isRuntimeAllowedLowFrequencyEvent(defaultIdleEvent);
    checks.defaultIdleBubbleMatchesTelemetry = Boolean(defaultIdleTelemetry) &&
      defaultIdleTelemetry.payload?.reason === defaultIdleEvent?.payload?.reason &&
      defaultIdleTelemetry.payload?.lineId === defaultIdleBubble.lineId;
    observations.defaultIdle = {
      bubble: summarizeBubble(defaultIdleBubble),
      lowFrequencyEvent: summarizeLowFrequencyEvent(defaultIdleEvent),
      proactiveBubble: summarizeProactiveBubble(defaultIdleTelemetry)
    };

    await waitForBubbleHidden(pet, 10_000);

    const chat = await openChatFromPet(pet);
    await setDialogueMode(chat, selectedPlan.dialogueModeId);
    await closeChat(chat);

    const modeBubble = await waitForBubbleVisible(pet, {
      reason: "mode_presence",
      lineId: selectedPlan.modePresenceLineId,
      timeoutMs: 9_000
    });
    checks.modePresenceBubbleSafe = modeBubble.lineId === selectedPlan.modePresenceLineId &&
      inspectBubbleSafety(modeBubble);
    observations.modePresence = summarizeBubble(modeBubble);

    await waitForBubbleHidden(pet, 10_000);
    const beforeGameIdleIndex = lastTelemetryIndex();
    const gameModeEchoBubble = await waitForBubbleVisible(pet, {
      reason: "mode_presence",
      lineId: selectedPlan.modePresenceLineId,
      timeoutMs: 10_000
    });
    const gameModeEchoEvent = await waitForLowFrequencyEvent({
      status: "shown",
      afterIndex: beforeGameIdleIndex,
      timeoutMs: 2_500
    });
    checks.modeEchoLowFrequencyEventShown = isRuntimeAllowedLowFrequencyEvent(gameModeEchoEvent);
    checks.modeEchoBubbleSafe = gameModeEchoBubble.lineId === selectedPlan.modePresenceLineId &&
      inspectBubbleSafety(gameModeEchoBubble);
    observations.lowFrequencyModeEcho = {
      bubble: summarizeBubble(gameModeEchoBubble),
      lowFrequencyEvent: summarizeLowFrequencyEvent(gameModeEchoEvent)
    };

    await waitForBubbleHidden(pet, 10_000);
    const beforeGameLayeredIdleIndex = lastTelemetryIndex();
    const gameIdleBubble = await waitForBubbleVisible(pet, {
      reason: "idle_presence",
      lineId: selectedPlan.layeredIdleLineId,
      timeoutMs: 10_000
    });
    const gameIdleEvent = await waitForLowFrequencyEvent({
      status: "shown",
      afterIndex: beforeGameLayeredIdleIndex,
      timeoutMs: 2_500
    });
    const gameIdleTelemetry = await waitForProactiveBubble({
      status: "shown",
      lineId: selectedPlan.layeredIdleLineId,
      afterIndex: beforeGameLayeredIdleIndex,
      timeoutMs: 1_500
    });
    checks.modeAwareTimeBandIdleLineShown = gameIdleBubble.lineId === selectedPlan.layeredIdleLineId &&
      gameIdleBubble.reason === "idle_presence" &&
      inspectBubbleSafety(gameIdleBubble);
    checks.modeAwareLowFrequencyEventShown = isRuntimeAllowedLowFrequencyEvent(gameIdleEvent);
    checks.modeAwareBubbleMatchesTelemetry = Boolean(gameIdleTelemetry) &&
      gameIdleTelemetry.payload?.reason === gameIdleEvent?.payload?.reason &&
      gameIdleTelemetry.payload?.lineId === gameIdleBubble.lineId;
    observations.modeAwareIdle = {
      bubble: summarizeBubble(gameIdleBubble),
      lowFrequencyEvent: summarizeLowFrequencyEvent(gameIdleEvent),
      proactiveBubble: summarizeProactiveBubble(gameIdleTelemetry)
    };

    const inspectedBubbles = [startupBubble, defaultIdleBubble, modeBubble, gameModeEchoBubble, gameIdleBubble];
    checks.rendererDomDatasetNoEventIdOrTimeBand = inspectedBubbles.every((bubble) =>
      bubble.forbiddenDatasetKeys.length === 0
    );
    checks.rendererDomDatasetSafeShape = inspectedBubbles.every((bubble) =>
      bubble.datasetKeys.every((key) => ["lineId", "reason", "state"].includes(key))
    );

    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((item) => !item.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

    observations.counts = countSafeTelemetry();

    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      providerFixture: "FakeProvider",
      requestedTimeBand,
      selectedPlan,
      durationMs: Date.now() - startedAt,
      checks,
      observations
    };
    checks.privacyOutputSafe = isSafeOutput(summary) &&
      isSafeOutput(stripKnownInternalRuntimeTelemetry(readPrivacyCheckText(context, [
        "progress.log",
        "electron.stdout.log",
        "electron.stderr.log",
        "result.json"
      ])));
    summary.ok = Object.values(checks).every(Boolean);

    writeResult(summary);
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeResult({
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      providerFixture: "FakeProvider",
      requestedTimeBand,
      durationMs: Date.now() - startedAt,
      failureCategory: classifyError(error),
      errorName: error instanceof Error ? error.name : "Error"
    });
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_37_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitFor(pet, "Boolean(document.querySelector('#proactive-speech-bubble'))");
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(window.dialogueModeApi)");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  return chat;
}

async function closeChat(chat) {
  await chat.cdp.send("Page.close");
  await sleep(750);
}

async function waitForBubbleVisible(pet, options = {}) {
  const reasonCheck = options.reason
    ? ` && bubble.dataset.reason === ${JSON.stringify(options.reason)}`
    : "";
  const lineCheck = options.lineId
    ? ` && bubble.dataset.lineId === ${JSON.stringify(options.lineId)}`
    : "";

  await waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'visible'${reasonCheck}${lineCheck};
    })()
  `, { timeoutMs: options.timeoutMs ?? 10_000 });
  return inspectBubble(pet);
}

async function waitForBubbleHidden(pet, timeoutMs) {
  await waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'hidden' && (bubble.textContent ?? '').length === 0;
    })()
  `, { timeoutMs });
  return inspectBubble(pet);
}

async function inspectBubble(pet) {
  return evaluate(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      if (!bubble) throw new Error('missing-bubble-node');
      const text = bubble.textContent ?? '';
      const dataset = { ...bubble.dataset };
      const forbiddenDatasetKeys = ${JSON.stringify([...forbiddenDomDatasetKeys])};
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute('aria-hidden'),
        datasetKeys: Object.keys(dataset).sort(),
        forbiddenDatasetKeys: Object.keys(dataset).filter((key) => forbiddenDatasetKeys.includes(key)).sort()
      };
    })()
  `);
}

function inspectBubbleSafety(info) {
  return info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    (info.state === "hidden" || allowedLineIds.has(info.lineId)) &&
    (info.state === "hidden" || allowedBubbleReasons.has(info.reason)) &&
    info.textLength >= 0 &&
    info.textLength <= 16 &&
    info.forbiddenDatasetKeys.length === 0;
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    textLength: info.textLength,
    ariaHidden: info.ariaHidden,
    datasetKeys: info.datasetKeys,
    forbiddenDatasetKeys: info.forbiddenDatasetKeys
  };
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

async function waitForLowFrequencyEvent({ status, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "low_frequency_companion_event" &&
    event.payload?.status === status
  ), timeoutMs);
}

async function waitForProactiveBubble({ status, lineId, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === status &&
    (!lineId || event.payload?.lineId === lineId)
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

function isRuntimeAllowedLowFrequencyEvent(event) {
  return Boolean(event) &&
    event.type === "low_frequency_companion_event" &&
    event.payload?.status === "shown" &&
    allowedLowFrequencyEventIds.has(event.payload?.eventId);
}

function summarizeLowFrequencyEvent(event) {
  if (!event) {
    return {
      status: "missing",
      runtimeAllowed: false
    };
  }

  const payload = event.payload ?? {};
  return {
    status: payload.status,
    reason: payload.reason,
    stateId: payload.stateId,
    actionType: payload.actionType,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    skipReason: payload.skipReason,
    safeSummaryLabel: payload.safeSummaryLabel,
    interruptPolicy: payload.interruptPolicy,
    durationMs: payload.durationMs,
    minimumIntervalMs: payload.minimumIntervalMs,
    elapsedSinceLastEventMs: payload.elapsedSinceLastEventMs,
    runtimeAllowed: allowedLowFrequencyEventIds.has(payload.eventId)
  };
}

function summarizeProactiveBubble(event) {
  if (!event) {
    return null;
  }

  const payload = event.payload ?? {};
  return {
    status: payload.status,
    lineId: payload.lineId,
    reason: payload.reason,
    durationMs: payload.durationMs,
    modeId: payload.dialogueModeId,
    presenceModeId: payload.presenceModeId
  };
}

function countSafeTelemetry() {
  const counts = {};
  for (const event of readTelemetryEvents()) {
    if (event.type === "low_frequency_companion_event") {
      const key = `low_frequency:${event.payload?.status}:${event.payload?.reason}:${event.payload?.skipReason ?? "none"}`;
      counts[key] = (counts[key] ?? 0) + 1;
      continue;
    }
    if (event.type === "proactive_speech_bubble") {
      const key = `bubble:${event.payload?.status}:${event.payload?.reason}:${event.payload?.lineId}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

function isSafeOutput(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return !forbiddenOutputPatterns.some((pattern) => pattern.test(text));
}

function stripKnownInternalRuntimeTelemetry(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !(line.includes('"type":"startup"') && line.includes('"userDataPath"')))
    .join("\n");
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out/i.test(message)) {
    return "timeout";
  }
  if (/Screenshot residue/i.test(message)) {
    return "screenshot_residue";
  }
  if (/CDP timeout|WebSocket/i.test(message)) {
    return "browser_control";
  }
  return "script_failed";
}

function writeResult(summary) {
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
