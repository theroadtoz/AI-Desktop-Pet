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
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-16b-action-trigger-daily-loop-real-ui",
  port: Number(process.env.P2_16B_CDP_PORT || 9588)
});

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/,
  /Provider 请求正文|完整 prompt|fact card/i,
  /p2-16b-private-input/i
];

async function main() {
  log(context, `runDir=${context.runDir}`);
  const startedAt = Date.now();
  const checks = {};
  const observations = {
    actions: [],
    eventOrder: []
  };

  try {
    const { pet } = await startApp();

    const edgeEvent = await waitForAction("edgeGlance", "pet_edge_settled", 9_000);
    checks.edgeGlanceTriggered = Boolean(edgeEvent);
    observations.actions.push(summarizeAction(edgeEvent));

    await sleep(1_700);
    await evaluate(pet, "window.petApi?.openChat()");
    const chat = await openChatWindow();
    await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
    const openListen = await waitForAction("listen", "chat_opened", 5_000);
    checks.chatOpenListenTriggered = Boolean(openListen);
    observations.actions.push(summarizeAction(openListen));

    await sleep(1_700);
    await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
    await sleep(250);
    await evaluate(chat, "document.querySelector('#chat-input')?.focus()");
    const focusListen = await waitForAction("listen", "chat_input_focus", 5_000);
    checks.inputFocusListenTriggered = Boolean(focusListen);
    observations.actions.push(summarizeAction(focusListen));

    await sleep(1_700);
    const beforeSendIndex = readTelemetryEvents().length - 1;
    await typeText(chat, "#chat-input", "p2-16b-private-input");
    await click(chat, "#send-button");
    const replyThinking = await waitForAction("replyThinking", "chat_reply_waiting", 5_000, beforeSendIndex);
    const firstDelta = await waitForTelemetry((event) => (
      event.type === "pet_role_transition" &&
      event.payload?.event === "reply:delta"
    ), 12_000, beforeSendIndex);
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });

    checks.replyThinkingTriggered = Boolean(replyThinking);
    checks.replyThinkingBeforeFirstDelta = Boolean(replyThinking && firstDelta && eventIndex(replyThinking) < eventIndex(firstDelta));
    observations.actions.push(summarizeAction(replyThinking));
    observations.eventOrder = summarizeEventOrder([edgeEvent, openListen, focusListen, replyThinking, firstDelta]);

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    checks.noForbiddenText = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
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
    if (process.env.P2_16B_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitForAction("appearance", "startup_first_visible_frame", 12_000);
  await sleep(2_400);
  return { pet };
}

async function openChatWindow() {
  const chat = await waitForWindow(context, "renderer/chat/index.html");
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
      events.push(JSON.parse(line));
    }
  }

  return events.map((event, index) => ({ ...event, __index: index }));
}

async function waitForAction(type, reason, timeoutMs, afterIndex = -1) {
  return waitForTelemetry((event) => (
    event.type === "pet_interaction_action_started" &&
    event.__index > afterIndex &&
    event.payload?.type === type &&
    event.payload?.reason === reason
  ), timeoutMs, afterIndex);
}

async function waitForTelemetry(predicate, timeoutMs, afterIndex = -1) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = readTelemetryEvents().find((item) => item.__index > afterIndex && predicate(item));
    if (event) {
      return event;
    }
    await sleep(150);
  }

  return null;
}

function eventIndex(event) {
  return typeof event?.__index === "number" ? event.__index : Number.POSITIVE_INFINITY;
}

function summarizeAction(event) {
  if (!event) {
    return null;
  }

  return {
    index: event.__index,
    type: event.payload?.type,
    reason: event.payload?.reason,
    durationMs: event.payload?.durationMs
  };
}

function summarizeEventOrder(events) {
  return events
    .filter(Boolean)
    .map((event) => ({
      index: event.__index,
      eventType: event.type,
      actionType: event.payload?.type,
      reason: event.payload?.reason,
      roleEvent: event.payload?.event
    }));
}

function countActionStarts(events) {
  const counts = {};
  for (const event of events) {
    if (event.type !== "pet_interaction_action_started") {
      continue;
    }
    const key = `${event.payload?.type}:${event.payload?.reason}`;
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
