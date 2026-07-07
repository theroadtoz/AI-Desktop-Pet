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
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-34-companion-presence-idle-mode-cadence-real-ui",
  port: Number(process.env.P2_34_CDP_PORT || 9564),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_34_IDLE_INTERVAL_MS || "850"
  }
});

const safeLineIds = new Set([
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
  "mode_presence_focus",
  "mode_presence_work",
  "mode_presence_game",
  "mode_presence_reading"
]);

const startupLineIds = new Set([
  "startup_presence_ready",
  "startup_presence_soft",
  "startup_presence_focus"
]);

const expectedDialogueCases = [
  {
    modeId: "work",
    lineId: "mode_presence_work",
    actionType: "workFocus",
    reason: "state_work",
    stateId: "work"
  },
  {
    modeId: "game",
    lineId: "mode_presence_game",
    actionType: "gameReady",
    reason: "state_game",
    stateId: "game"
  },
  {
    modeId: "reading",
    lineId: "mode_presence_reading",
    actionType: "readingIdle",
    reason: "state_read",
    stateId: "read"
  }
];

const expectedPresenceCases = [
  { presenceModeId: "focus", lineId: "mode_presence_focus" },
  { presenceModeId: "quiet", lineId: "mode_presence_focus" }
];

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider request body|Provider 请求正文|完整 prompt|system prompt/i,
  /用户全文|AI 全文|fact card|memory card|search query|raw result|snippet/i,
  /bubbleText|textContent|messageText|promptText/i,
  /apiKey|Authorization/i,
  /expressionName|motion path|motionPath|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];

const debugSurfacePattern =
  /requestVersion|providerMessages|contextBudget|capturedCount|skippedReason|injectionCount|originalMessageCount|recentMessageCount|summaryMessageCount|safeQuery|snippet|prompt|expressionName|motion path|partId/iu;

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};
  const dialogueCases = [];
  const presenceCases = [];

  try {
    const { pet } = await startApp();

    const startupBubble = await waitForBubbleVisible(pet, {
      reason: "startup_presence",
      timeoutMs: 10_000
    });
    checks.startupBubbleAppears = startupBubble.reason === "startup_presence" &&
      startupLineIds.has(startupBubble.lineId) &&
      inspectBubbleSafety(startupBubble);
    observations.startupBubble = summarizeBubble(startupBubble);

    const startupCleared = await waitForBubbleHidden(pet, 10_000);
    checks.startupBubbleClears = startupCleared.state === "hidden" && startupCleared.textLength === 0;

    const idleBubble = await waitForBubbleVisible(pet, {
      reason: "idle_presence",
      timeoutMs: 9_000
    });
    checks.idleBubbleAppears = idleBubble.reason === "idle_presence" &&
      safeLineIds.has(idleBubble.lineId) &&
      inspectBubbleSafety(idleBubble);
    observations.idleBubble = summarizeBubble(idleBubble);

    const beforeChatOpenIndex = lastTelemetryIndex();
    let chat = await openChatFromPet(pet);
    const chatCleared = await waitForBubbleHidden(pet, 5_000);
    let chatOpenedAction = await waitForChatListenAction({
      afterIndex: beforeChatOpenIndex,
      timeoutMs: 5_000
    });
    if (!chatOpenedAction) {
      await sleep(1_900);
      const beforeFocusIndex = lastTelemetryIndex();
      await refocusChatInput(chat);
      chatOpenedAction = await waitForChatListenAction({
        afterIndex: beforeFocusIndex,
        timeoutMs: 5_000
      });
    }
    checks.chatOpenClearsBubble = chatCleared.state === "hidden" && chatCleared.textLength === 0;
    checks.chatOpenTriggersListen = Boolean(chatOpenedAction);
    observations.chatOpen = {
      bubble: summarizeBubble(chatCleared),
      action: summarizeAction(chatOpenedAction)
    };

    const initialSurface = await readCompanionSurface(chat);
    checks.partnerStatusShowsInitialModes = initialSurface.dialogueModeId === "default" &&
      initialSurface.presenceModeId === "default" &&
      initialSurface.partnerHasMode &&
      initialSurface.partnerHasPresence;
    checks.shelfEchoNoDebugFields = initialSurface.shelfEchoSafe;
    observations.initialSurface = summarizeSurface(initialSurface);

    for (const expected of expectedDialogueCases) {
      const beforeModeIndex = lastTelemetryIndex();
      await setDialogueMode(chat, expected.modeId);
      const action = await waitForAction({
        actionType: expected.actionType,
        reason: expected.reason,
        stateId: expected.stateId,
        afterIndex: beforeModeIndex,
        timeoutMs: 6_500
      });
      await closeChat(chat);
      const modeBubble = await waitForBubbleVisible(pet, {
        reason: "mode_presence",
        lineId: expected.lineId,
        timeoutMs: 8_000
      });
      const caseResult = {
        modeId: expected.modeId,
        expectedLineId: expected.lineId,
        bubble: summarizeBubble(modeBubble),
        action: summarizeAction(action),
        passed: Boolean(action) &&
          modeBubble.reason === "mode_presence" &&
          modeBubble.lineId === expected.lineId &&
          inspectBubbleSafety(modeBubble)
      };
      dialogueCases.push(caseResult);
      chat = await openChatFromPet(pet);
      await waitForBubbleHidden(pet, 5_000);
    }
    checks.dialogueModeActionsAndBubbles = dialogueCases.every((item) => item.passed);

    for (const expected of expectedPresenceCases) {
      await setPresenceMode(chat, expected.presenceModeId);
      await closeChat(chat);
      const modeBubble = await waitForBubbleVisible(pet, {
        reason: "mode_presence",
        lineId: expected.lineId,
        timeoutMs: 8_000
      });
      const caseResult = {
        presenceModeId: expected.presenceModeId,
        expectedLineId: expected.lineId,
        bubble: summarizeBubble(modeBubble),
        passed: modeBubble.reason === "mode_presence" &&
          modeBubble.lineId === expected.lineId &&
          inspectBubbleSafety(modeBubble)
      };
      presenceCases.push(caseResult);
      chat = await openChatFromPet(pet);
      await waitForBubbleHidden(pet, 5_000);
    }
    checks.focusQuietModePresenceBubbles = presenceCases.every((item) => item.passed);

    const beforeSleepIndex = lastTelemetryIndex();
    await setPresenceMode(chat, "sleep");
    const sleepSurface = await readCompanionSurface(chat);
    const sleepAction = await waitForAction({
      actionType: "doze",
      reason: "state_sleep",
      stateId: "sleep",
      afterIndex: beforeSleepIndex,
      timeoutMs: 6_500
    });
    await closeChat(chat);
    await sleep(Number(process.env.P2_34_SLEEP_SUPPRESSION_WINDOW_MS || 2_400));
    const sleepBubble = await inspectBubble(pet);
    const shownAfterSleep = countProactiveBubbleTelemetry({
      afterIndex: beforeSleepIndex,
      status: "shown"
    });
    checks.sleepModeSurfaceAndAction = sleepSurface.presenceModeId === "sleep" &&
      sleepSurface.partnerHasPresence &&
      Boolean(sleepAction);
    checks.sleepSuppressesBubbles = sleepBubble.state === "hidden" &&
      sleepBubble.textLength === 0 &&
      shownAfterSleep === 0;
    observations.sleep = {
      surface: summarizeSurface(sleepSurface),
      action: summarizeAction(sleepAction),
      bubble: summarizeBubble(sleepBubble),
      shownBubbleCountAfterSleep: shownAfterSleep
    };

    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((item) => !item.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

    observations.dialogueCases = dialogueCases;
    observations.presenceCases = presenceCases;
    observations.counts = countSafeTelemetry();

    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
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
      durationMs: Date.now() - startedAt,
      failureCategory: classifyError(error),
      errorName: error instanceof Error ? error.name : "Error"
    });
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_34_KEEP_TMP !== "1") {
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
  await waitFor(chat, "Boolean(window.dialogueModeApi) && Boolean(window.presenceModeApi)");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  return chat;
}

async function closeChat(chat) {
  await chat.cdp.send("Page.close");
  await sleep(750);
}

async function refocusChatInput(chat) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector('#chat-input');
      if (!input) throw new Error('missing-chat-input');
      input.blur();
      window.setTimeout(() => input.focus(), 50);
      return true;
    })()
  `);
  await sleep(150);
}

async function waitForBubbleVisible(pet, options) {
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
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute('aria-hidden')
      };
    })()
  `);
}

async function readCompanionSurface(chat) {
  return evaluate(chat, `
    (() => {
      const activeDialogue = document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId ?? '';
      const activePresence = document.querySelector('#presence-mode-controls .mode-button.is-active')?.dataset.modeId ?? '';
      const partner = document.querySelector('#partner-status')?.textContent ?? '';
      const shelfEcho = document.querySelector('#shelf-action-echo')?.textContent ?? '';
      const modeLabels = {
        default: '默认陪伴',
        work: '工作模式',
        game: '游戏模式',
        reading: '读书模式'
      };
      const presenceLabels = {
        default: '默认陪伴',
        focus: '专注陪伴',
        quiet: '安静陪伴',
        sleep: '睡眠待机'
      };
      return {
        dialogueModeId: activeDialogue,
        presenceModeId: activePresence,
        partnerTextLength: [...partner].length,
        shelfEchoTextLength: [...shelfEcho].length,
        shelfEchoState: document.querySelector('#shelf-action-echo')?.dataset.state ?? '',
        partnerHasMode: partner.includes(modeLabels[activeDialogue] ?? ''),
        partnerHasPresence: partner.includes(presenceLabels[activePresence] ?? ''),
        shelfEchoSafe: !${debugSurfacePattern}.test(shelfEcho)
      };
    })()
  `);
}

function inspectBubbleSafety(info) {
  return info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    safeLineIds.has(info.lineId) &&
    ["startup_presence", "idle_presence", "mode_presence"].includes(info.reason) &&
    info.textLength > 0 &&
    info.textLength <= 16;
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    textLength: info.textLength,
    ariaHidden: info.ariaHidden
  };
}

function summarizeSurface(surface) {
  return {
    dialogueModeId: surface.dialogueModeId,
    presenceModeId: surface.presenceModeId,
    partnerTextLength: surface.partnerTextLength,
    shelfEchoTextLength: surface.shelfEchoTextLength,
    shelfEchoState: surface.shelfEchoState,
    partnerHasMode: surface.partnerHasMode,
    partnerHasPresence: surface.partnerHasPresence,
    shelfEchoSafe: surface.shelfEchoSafe
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

async function waitForAction({
  actionType,
  reason,
  stateId,
  afterIndex,
  timeoutMs
}) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason &&
    event.payload?.stateId === stateId
  ), timeoutMs);
}

async function waitForChatListenAction({ afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === "listen" &&
    event.payload?.stateId === "listen" &&
    (event.payload?.reason === "chat_opened" || event.payload?.reason === "chat_input_focus")
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

  const payload = event.payload ?? {};
  return {
    type: payload.type,
    reason: payload.reason,
    stateId: payload.stateId,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    durationMs: payload.durationMs
  };
}

function countProactiveBubbleTelemetry({ afterIndex, status }) {
  return readTelemetryEvents()
    .filter((event) => event.__index > afterIndex)
    .filter((event) => event.type === "proactive_speech_bubble")
    .filter((event) => event.payload?.status === status)
    .length;
}

function countSafeTelemetry() {
  const counts = {};
  for (const event of readTelemetryEvents()) {
    if (event.type === "pet_interaction_action_started") {
      const key = `${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId}`;
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
