import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  listDailyStateOrchestrationRules,
  selectLowFrequencyCompanionEvent
} from "../src/shared/daily-state-orchestration.ts";
import { DIALOGUE_MODE_VIEWS } from "../src/shared/dialogue-style.ts";
import { getPetActionState } from "../src/shared/pet-action-state-machine.ts";
import { PRESENCE_MODE_VIEWS } from "../src/shared/presence-mode.ts";
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
  runName: "p2-35-daily-state-orchestration-rule-table-real-ui",
  port: Number(process.env.P2_35_CDP_PORT || 9565),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_35_IDLE_INTERVAL_MS || "900"
  }
});

const expectedPresenceModeIds = ["default", "focus", "quiet", "sleep"];
const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/i,
  /\.env/i,
  /Provider request body|providerRequestBody|requestBody/i,
  /完整 prompt|system prompt|prompt/i,
  /userMessage|assistantMessage|messageText|bubbleText/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /search query|search result|safeQuery|snippet|domain|url|title/i,
  /apiKey|Authorization/i,
  /motion path|motionPath|expressionName|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    checks.catalogCoversModes = catalogCoversModes();
    const catalogSelections = summarizeCatalogSelections();
    checks.defaultAllowsLowFrequencyEvent = Boolean(catalogSelections.default?.eventId);
    checks.focusQuietOnlyLowInterruption = catalogSelections.focus?.status === "low-interruption" &&
      catalogSelections.quiet?.status === "low-interruption";
    checks.sleepSuppressesLowFrequencyEvents = catalogSelections.sleep?.status === "suppressed";
    observations.catalog = catalogSelections;

    const { pet } = await startApp();
    const beforeChatIndex = lastTelemetryIndex();
    const chat = await openChatFromPet(pet);
    const chatListenAction = await waitForAction({
      actionType: "listen",
      stateId: "listen",
      afterIndex: beforeChatIndex,
      timeoutMs: 5_500
    });
    checks.chatOpenTriggersListen = Boolean(chatListenAction);
    observations.chatOpen = summarizeAction(chatListenAction);

    const modeObservations = [];
    for (const presenceModeId of expectedPresenceModeIds) {
      const beforeModeIndex = lastTelemetryIndex();
      await setPresenceMode(chat, presenceModeId);
      const surface = await readModeSurface(chat);
      const action = presenceModeId === "sleep"
        ? await waitForAction({
          actionType: "doze",
          stateId: "sleep",
          afterIndex: beforeModeIndex,
          timeoutMs: 6_500
        })
        : await waitForAnyAction({ afterIndex: beforeModeIndex, timeoutMs: 1_800 });
      modeObservations.push({
        modeId: surface.modeId,
        presenceModeId: surface.presenceModeId,
        status: surface.presenceModeId === presenceModeId ? "active" : "mismatch",
        count: countLowFrequencyEventsForPresence(presenceModeId),
        action: summarizeAction(action)
      });
    }
    checks.sleepTriggersDoze = modeObservations.some((item) => (
      item.presenceModeId === "sleep" &&
      item.action?.actionType === "doze" &&
      item.action?.stateId === "sleep"
    ));
    observations.modes = modeObservations;

    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((item) => !item.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

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
    if (process.env.P2_35_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

function catalogCoversModes() {
  const rules = listDailyStateOrchestrationRules();
  const ruleIds = new Set(rules.map((rule) => rule.ruleId));

  return DIALOGUE_MODE_VIEWS.every((dialogueMode) => (
    PRESENCE_MODE_VIEWS.every((presenceMode) => (
      ruleIds.has(`daily-state:${dialogueMode.id}:${presenceMode.id}`)
    ))
  ));
}

function summarizeCatalogSelections() {
  const elapsedSinceLastEventMs = Number.MAX_SAFE_INTEGER;
  return {
    default: summarizeLowFrequencyEvent(selectLowFrequencyCompanionEvent({
      dialogueModeId: "default",
      presenceModeId: "default",
      tick: 0,
      elapsedSinceLastEventMs
    })),
    focus: summarizeLowFrequencyEvent(selectLowFrequencyCompanionEvent({
      dialogueModeId: "work",
      presenceModeId: "focus",
      tick: 0,
      elapsedSinceLastEventMs
    })),
    quiet: summarizeLowFrequencyEvent(selectLowFrequencyCompanionEvent({
      dialogueModeId: "work",
      presenceModeId: "quiet",
      tick: 0,
      elapsedSinceLastEventMs
    })),
    sleep: summarizeLowFrequencyEvent(selectLowFrequencyCompanionEvent({
      dialogueModeId: "default",
      presenceModeId: "sleep",
      tick: 0,
      elapsedSinceLastEventMs
    }))
  };
}

function summarizeLowFrequencyEvent(event) {
  if (!event) {
    return {
      status: "suppressed",
      count: 0
    };
  }

  return {
    eventId: event.eventId,
    reason: event.bubbleReason,
    stateId: event.actionStateId,
    actionType: getPetActionState(event.actionStateId).actionType,
    status: event.interruptPolicy,
    count: 1,
    durationMs: event.minimumIntervalMs
  };
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

async function readModeSurface(chat) {
  return evaluate(chat, `
    (() => {
      const modeId = document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId ?? '';
      const presenceModeId = document.querySelector('#presence-mode-controls .mode-button.is-active')?.dataset.modeId ?? '';
      const partner = document.querySelector('#partner-status')?.textContent ?? '';
      return {
        modeId,
        presenceModeId,
        status: presenceModeId ? 'active' : 'missing',
        textLength: [...partner].length
      };
    })()
  `);
}

function countLowFrequencyEventsForPresence(presenceModeId) {
  return listDailyStateOrchestrationRules()
    .filter((rule) => rule.presenceModeId === presenceModeId)
    .reduce((count, rule) => count + rule.lowFrequencyEventIds.length, 0);
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
  stateId,
  afterIndex,
  timeoutMs
}) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === actionType &&
    event.payload?.stateId === stateId
  ), timeoutMs);
}

async function waitForAnyAction({ afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started"
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
    actionType: payload.type,
    reason: payload.reason,
    stateId: payload.stateId,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    durationMs: payload.durationMs
  };
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
