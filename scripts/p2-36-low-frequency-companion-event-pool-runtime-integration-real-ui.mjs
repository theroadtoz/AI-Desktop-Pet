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
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-36-low-frequency-companion-event-pool-runtime-integration-real-ui",
  port: Number(process.env.P2_36_CDP_PORT || 9566),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_36_IDLE_INTERVAL_MS || "900",
    AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
      process.env.P2_36_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "8000"
  }
});

const runtimeAllowedEventIds = new Set([
  "idle-presence-check",
  "context-settle",
  "mode-presence-echo"
]);

const forbiddenRuntimeEventIds = new Set([
  "memory-safe-pulse",
  "search-citation-pulse"
]);

const allowedBubbleReasons = new Set([
  "startup_presence",
  "idle_presence",
  "mode_presence"
]);

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

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/i,
  /\.env/i,
  /Provider request body|providerRequestBody|requestBody/i,
  /complete prompt|system prompt|prompt/i,
  /userMessage|assistantMessage|messageText|bubbleText/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /search query|search result|safeQuery|snippet|domain|url|title/i,
  /memory-safe-pulse|search-citation-pulse/i,
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
    checks.startupBubbleAppears = startupBubble.reason === "startup_presence" &&
      inspectBubbleSafety(startupBubble);
    observations.startupBubble = summarizeBubble(startupBubble);

    const startupCleared = await waitForBubbleHidden(pet, 10_000);
    checks.startupBubbleClearsBeforeIdle = startupCleared.state === "hidden" &&
      startupCleared.textLength === 0;

    const beforeIdleIndex = lastTelemetryIndex();
    const idleBubble = await waitForBubbleVisible(pet, {
      timeoutMs: 10_000
    });
    const firstLowFrequencyEvent = await waitForLowFrequencyEvent({
      status: "shown",
      afterIndex: beforeIdleIndex,
      timeoutMs: 3_000
    });
    const firstProactiveBubble = await waitForProactiveBubble({
      status: "shown",
      afterIndex: beforeIdleIndex,
      timeoutMs: 1_500
    });
    checks.idleTriggersLowFrequencyEventShown = Boolean(firstLowFrequencyEvent) &&
      summarizeLowFrequencyEvent(firstLowFrequencyEvent).runtimeAllowed &&
      !summarizeLowFrequencyEvent(firstLowFrequencyEvent).runtimeForbidden;
    checks.idleTriggersProactiveBubbleShown = Boolean(firstProactiveBubble) &&
      firstProactiveBubble.payload?.reason === firstLowFrequencyEvent?.payload?.reason;
    checks.rendererPayloadNoEventIdLeak = inspectBubbleSafety(idleBubble) &&
      idleBubble.hasEventIdKey === false &&
      idleBubble.hasForbiddenEventIdLeak === false;
    observations.idle = {
      bubble: summarizeBubble(idleBubble),
      lowFrequencyEvent: summarizeLowFrequencyEvent(firstLowFrequencyEvent),
      proactiveBubble: summarizeProactiveBubble(firstProactiveBubble)
    };

    const afterFirstLowFrequencyEventIndex = firstLowFrequencyEvent?.__index ?? lastTelemetryIndex();
    await sleep(Number(process.env.P2_36_MINIMUM_INTERVAL_OBSERVE_MS || 6200));
    const secondShownInsideMinimumInterval = countLowFrequencyEvents({
      afterIndex: afterFirstLowFrequencyEventIndex,
      status: "shown"
    });
    const skippedMinimumInterval = countLowFrequencyEvents({
      afterIndex: afterFirstLowFrequencyEventIndex,
      status: "skipped",
      skipReason: "minimum_interval"
    });
    checks.minimumIntervalNoSecondShown = secondShownInsideMinimumInterval === 0 &&
      skippedMinimumInterval > 0;
    observations.minimumInterval = {
      secondShownInsideWindow: secondShownInsideMinimumInterval,
      skippedMinimumInterval
    };

    const beforeChatOpenIndex = lastTelemetryIndex();
    const chat = await openChatFromPet(pet);
    const chatCleared = await waitForBubbleHidden(pet, 6_000);
    await sleep(Number(process.env.P2_36_CHAT_SUPPRESSION_WINDOW_MS || 2600));
    const lowFrequencyShownDuringChat = countLowFrequencyEvents({
      afterIndex: beforeChatOpenIndex,
      status: "shown"
    });
    const proactiveShownDuringChat = countProactiveBubbles({
      afterIndex: beforeChatOpenIndex,
      status: "shown"
    });
    checks.chatSuppressesNewShownEvents = lowFrequencyShownDuringChat === 0 &&
      proactiveShownDuringChat === 0;
    observations.chatSuppression = {
      bubble: summarizeBubble(chatCleared),
      lowFrequencyShownDuringChat,
      proactiveShownDuringChat
    };

    const beforeSleepIndex = lastTelemetryIndex();
    await setPresenceMode(chat, "sleep");
    const sleepSurface = await readPresenceSurface(chat);
    await closeChat(chat);
    const sleepBubble = await waitForBubbleHidden(pet, 5_000);
    await sleep(Number(process.env.P2_36_SLEEP_SUPPRESSION_WINDOW_MS || 2600));
    const lowFrequencyShownDuringSleep = countLowFrequencyEvents({
      afterIndex: beforeSleepIndex,
      status: "shown"
    });
    const proactiveShownDuringSleep = countProactiveBubbles({
      afterIndex: beforeSleepIndex,
      status: "shown"
    });
    checks.sleepModeActive = sleepSurface.presenceModeId === "sleep";
    checks.sleepSuppressesNewShownEvents = lowFrequencyShownDuringSleep === 0 &&
      proactiveShownDuringSleep === 0;
    observations.sleepSuppression = {
      surface: sleepSurface,
      bubble: summarizeBubble(sleepBubble),
      lowFrequencyShownDuringSleep,
      proactiveShownDuringSleep
    };

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
      durationMs: Date.now() - startedAt,
      failureCategory: classifyError(error),
      errorName: error instanceof Error ? error.name : "Error"
    });
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_36_KEEP_TMP !== "1") {
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
  await waitFor(chat, "Boolean(window.presenceModeApi)");
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

  await waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'visible'${reasonCheck};
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
      const eventIds = ${JSON.stringify([...runtimeAllowedEventIds, ...forbiddenRuntimeEventIds])};
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute('aria-hidden'),
        datasetKeys: Object.keys(dataset).sort(),
        hasEventIdKey: Object.hasOwn(dataset, 'eventId'),
        hasForbiddenEventIdLeak: eventIds.some((eventId) => (
          text.includes(eventId) ||
          Object.keys(dataset).includes(eventId) ||
          Object.values(dataset).includes(eventId)
        ))
      };
    })()
  `);
}

async function readPresenceSurface(chat) {
  return evaluate(chat, `
    (() => {
      return {
        presenceModeId: document.querySelector('#presence-mode-controls .mode-button.is-active')?.dataset.modeId ?? '',
        partnerTextLength: [...(document.querySelector('#partner-status')?.textContent ?? '')].length
      };
    })()
  `);
}

function inspectBubbleSafety(info) {
  return info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    (info.state === "hidden" || allowedLineIds.has(info.lineId)) &&
    (info.state === "hidden" || allowedBubbleReasons.has(info.reason)) &&
    info.textLength >= 0 &&
    info.textLength <= 16;
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    textLength: info.textLength,
    ariaHidden: info.ariaHidden,
    datasetKeys: info.datasetKeys,
    hasEventIdKey: info.hasEventIdKey,
    hasForbiddenEventIdLeak: info.hasForbiddenEventIdLeak
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

async function waitForProactiveBubble({ status, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === status
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

function countLowFrequencyEvents({ afterIndex, status, skipReason }) {
  return readTelemetryEvents()
    .filter((event) => event.__index > afterIndex)
    .filter((event) => event.type === "low_frequency_companion_event")
    .filter((event) => event.payload?.status === status)
    .filter((event) => !skipReason || event.payload?.skipReason === skipReason)
    .length;
}

function countProactiveBubbles({ afterIndex, status }) {
  return readTelemetryEvents()
    .filter((event) => event.__index > afterIndex)
    .filter((event) => event.type === "proactive_speech_bubble")
    .filter((event) => event.payload?.status === status)
    .length;
}

function summarizeLowFrequencyEvent(event) {
  if (!event) {
    return {
      status: "missing",
      runtimeAllowed: false,
      runtimeForbidden: false
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
    runtimeAllowed: runtimeAllowedEventIds.has(payload.eventId),
    runtimeForbidden: forbiddenRuntimeEventIds.has(payload.eventId)
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
