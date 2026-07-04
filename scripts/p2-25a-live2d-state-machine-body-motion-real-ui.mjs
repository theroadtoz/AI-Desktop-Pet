import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
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
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-25a-live2d-state-machine-body-motion-real-ui",
  port: Number(process.env.P2_25A_CDP_PORT || 9625),
  env: {
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_25A_IDLE_INTERVAL_MS || "60000"
  }
});

const modeStateExpectations = [
  { modeId: "work", actionType: "workFocus", reason: "state_work", stateId: "work" },
  { modeId: "game", actionType: "gameReady", reason: "state_game", stateId: "game" },
  { modeId: "reading", actionType: "readingIdle", reason: "state_read", stateId: "read" }
];

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider 请求正文|完整 prompt|fact card|用户全文|AI 全文|request body/i,
  /p2-25a-private-input/i,
  /model\.gguf.*[A-Z]:\\/i
];

async function main() {
  log(context, `runDir=${context.runDir}`);
  const startedAt = Date.now();
  const checks = {};
  const observations = {
    modeActions: [],
    chatActions: []
  };

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);

    const chatOpened = await waitForAction({
      actionType: "listen",
      reason: "chat_opened",
      stateId: "listen",
      timeoutMs: 6_000
    });
    checks.chatOpenedListenCompat = Boolean(chatOpened);
    observations.chatActions.push(summarizeAction(chatOpened));
    await sleep(1_800);

    await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
    await sleep(250);
    const focusStartIndex = lastTelemetryIndex();
    await evaluate(chat, "document.querySelector('#chat-input')?.focus()");
    const inputFocus = await waitForAction({
      actionType: "listen",
      reason: "chat_input_focus",
      stateId: "listen",
      timeoutMs: 6_000,
      afterIndex: focusStartIndex
    });
    checks.inputFocusListenCompat = Boolean(inputFocus);
    observations.chatActions.push(summarizeAction(inputFocus));
    await sleep(1_800);

    const beforeSendIndex = lastTelemetryIndex();
    await typeText(chat, "#chat-input", "p2-25a-private-input");
    await click(chat, "#send-button");
    const replyThinking = await waitForAction({
      actionType: "replyThinking",
      reason: "chat_reply_waiting",
      stateId: "think",
      timeoutMs: 8_000,
      afterIndex: beforeSendIndex
    });
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
    checks.chatReplyWaitingThinkCompat = Boolean(replyThinking);
    observations.chatActions.push(summarizeAction(replyThinking));
    await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
    await sleep(2_300);

    for (const expected of modeStateExpectations) {
      const beforeModeIndex = lastTelemetryIndex();
      await setDialogueMode(chat, expected.modeId);
      const modeAction = await waitForAction({
        actionType: expected.actionType,
        reason: expected.reason,
        stateId: expected.stateId,
        timeoutMs: 6_000,
        afterIndex: beforeModeIndex
      });
      checks[`${expected.stateId}ModeStateAction`] = Boolean(modeAction);
      observations.modeActions.push(summarizeAction(modeAction));
      await sleep(2_000);
    }

    const beforeSleepIndex = lastTelemetryIndex();
    await setPresenceMode(chat, "sleep");
    const sleepAction = await waitForAction({
      actionType: "doze",
      reason: "state_sleep",
      stateId: "sleep",
      timeoutMs: 6_000,
      afterIndex: beforeSleepIndex
    });
    checks.sleepPresenceStateAction = Boolean(sleepAction);
    observations.modeActions.push(summarizeAction(sleepAction));

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]);
    checks.noForbiddenText = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
    checks.telemetrySafeSummary = readTelemetryEvents().some((event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "state_work" &&
      event.payload?.stateId === "work" &&
      event.payload?.type === "workFocus"
    )) && !/"content":|"prompt":|"providerRequestBody":|"factCardBody":|"apiKey":/.test(privacyText);
    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidueBeforeCleanup = residueBeforeCleanup.length === 0;

    const summary = {
      ok: Object.values(checks).every(Boolean),
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      checks,
      observations,
      counts: countActionStarts(readTelemetryEvents())
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
      failureCategory: classifyError(error)
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_25A_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitForAction({
    actionType: "appearance",
    reason: "startup_first_visible_frame",
    timeoutMs: 12_000
  });
  await sleep(4_200);
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  return chat;
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
    modeId: event.payload?.modeId,
    presenceModeId: event.payload?.presenceModeId,
    durationMs: event.payload?.durationMs
  };
}

function countActionStarts(events) {
  const counts = {};
  for (const event of events) {
    if (event.type !== "pet_interaction_action_started") {
      continue;
    }
    const key = `${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId ?? "none"}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
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
