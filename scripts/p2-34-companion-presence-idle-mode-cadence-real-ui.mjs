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
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { settleActiveRunSteps } from "./support/runner-step-settlement.mjs";

const context = createRealUiRunContext({
  runName: "p2-34-companion-presence-idle-mode-cadence-real-ui",
  port: Number(process.env.P2_34_CDP_PORT || 9564),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_34_IDLE_INTERVAL_MS || "850",
    AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
      process.env.P2_34_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "250"
  }
});
const RUNNER_TOTAL_TIMEOUT_MS = 120_000;
const RUN_STEP_SETTLE_TIMEOUT_MS = 5_000;
const REENABLE_NO_REPLAY_WINDOW_MS = 500;
const runnerAbortController = new AbortController();
const activeRunSteps = new Set();
let hasWrittenResult = false;
let startupReadinessDiagnostic = {
  phase: "not_started",
  appearanceLifecycle: "not_observed",
  candidateLifecycle: "not_observed"
};

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
  "idle_presence_history_summary",
  "idle_presence_memory_safe",
  "idle_presence_search_citation",
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

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider request body|Provider 请求正文|完整 prompt|system prompt/i,
  /用户全文|AI 全文|fact card|memory card|search query|raw result|snippet/i,
  /bubbleText|textContent|messageText|promptText/i,
  /\bprompt\b/i,
  /apiKey|Authorization/i,
  /expressionName|motion path|motionPath|partId|resourcePath/i,
  /https?:\/\/\S+/i,
  /\b[A-Za-z]:[\\/]/
];
const electronSecurityWarningBlock = [
  "[pet:console] %cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold; This renderer process has either no Content Security",
  "  Policy set or a policy with \"unsafe-eval\" enabled. This exposes users of",
  "  this app to unnecessary security risks.",
  "",
  "For more information and help, consult",
  "https://electronjs.org/docs/tutorial/security.",
  "This warning will not show up",
  "once the app is packaged."
];

const debugSurfacePattern =
  /requestVersion|providerMessages|contextBudget|capturedCount|skippedReason|injectionCount|originalMessageCount|recentMessageCount|summaryMessageCount|safeQuery|snippet|prompt|expressionName|motion path|partId/iu;

async function main(signal) {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    const { pet } = await startApp(signal);

    const startupOutcome = await waitForProductionStartupReadiness(signal);
    const startupCadence = inspectCandidateActionFirst(
      "startup_daily",
      startupOutcome.appearanceTerminalIndex,
      "state_greet"
    );
    const startupBubble = startupOutcome.terminalStatus === "shown"
      ? await waitForBubbleVisible(signal, pet, { reason: "startup_presence", timeoutMs: 5_000 })
      : await inspectBubble(signal, pet);
    const startupShownActionFirst = startupOutcome.terminalStatus === "shown" &&
      startupCadence.passed && startupBubble.reason === "startup_presence" &&
      startupLineIds.has(startupBubble.lineId) && inspectBubbleSafety(startupBubble);
    const startupSuppressedSafely = startupOutcome.terminalStatus === "skipped" &&
      ["engagement_blocked", "interruptibility_not_allowed", "system_unavailable"].includes(startupOutcome.skipReason) &&
      startupBubble.state === "hidden" && startupBubble.textLength === 0;
    checks.startupCadenceOutcomeSafe = startupShownActionFirst || startupSuppressedSafely;
    checks.startupUsesCoordinatorActionFirst = startupShownActionFirst || startupSuppressedSafely;
    observations.startupBubble = summarizeBubble(startupBubble);
    observations.startupCadence = {
      ...startupCadence,
      terminalStatus: startupOutcome.terminalStatus,
      skipReason: startupOutcome.skipReason
    };
    observations.startupReadiness = { ...startupReadinessDiagnostic };

    const startupCleared = startupOutcome.terminalStatus === "shown"
      ? await waitForBubbleHidden(signal, pet, 10_000)
      : startupBubble;
    checks.startupBubbleClears = startupCleared.state === "hidden" && startupCleared.textLength === 0;

    const idleStartIndex = lastTelemetryIndex();
    const idleDecision = await waitForLowFrequencyQueuedDecision(signal, idleStartIndex, 9_000);
    const idleOutcome = await waitForCandidateTerminal(signal, "idle_presence", idleStartIndex, 9_000);
    const idleCadence = inspectCandidateActionFirst("idle_presence", idleStartIndex);
    const idleBubble = await inspectBubble(signal, pet);
    const idleSuppressedSafely = idleOutcome.terminalStatus === "skipped" &&
      ["engagement_blocked", "interruptibility_not_allowed", "system_unavailable"].includes(idleOutcome.skipReason) &&
      idleBubble.state === "hidden" && idleBubble.textLength === 0;
    const idleShownActionFirst = idleOutcome.terminalStatus === "shown" &&
      idleCadence.passed && idleBubble.reason === "idle_presence" &&
      safeLineIds.has(idleBubble.lineId) && inspectBubbleSafety(idleBubble);
    checks.idleLowFrequencyDecisionQueued = idleDecision.status === "queued";
    checks.idleCadenceRespectsCoordinator = idleShownActionFirst || idleSuppressedSafely;
    observations.idleBubble = summarizeBubble(idleBubble);
    observations.idleCadence = {
      decision: idleDecision,
      ...idleCadence,
      terminalStatus: idleOutcome.terminalStatus,
      skipReason: idleOutcome.skipReason
    };

    const beforeChatOpenIndex = lastTelemetryIndex();
    let chat = await openChatFromPet(signal, pet);
    const chatCleared = await waitForBubbleHidden(signal, pet, 5_000);
    let chatOpenedAction = await waitForChatListenAction({
      signal,
      afterIndex: beforeChatOpenIndex,
      timeoutMs: 5_000
    });
    if (!chatOpenedAction) {
      await runStep(signal, () => sleep(1_900));
      const beforeFocusIndex = lastTelemetryIndex();
      await refocusChatInput(signal, chat);
      chatOpenedAction = await waitForChatListenAction({
        signal,
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

    const initialSurface = await readCompanionSurface(signal, chat);
    const automaticSituation = await readAutomaticSituation(signal, pet);
    checks.manualModeControlsStayAbsent = initialSurface.manualModeControlsAbsent;
    checks.manualModeApisStayAbsent = initialSurface.manualModeApisAbsent;
    checks.automaticSituationIsReadOnlyClosedSet = automaticSituation.closedSet && automaticSituation.readOnly;
    checks.shelfEchoNoDebugFields = initialSurface.shelfEchoSafe;
    observations.initialSurface = summarizeSurface(initialSurface);
    observations.automaticSituation = automaticSituation.summary;

    const beforeOffIndex = lastTelemetryIndex();
    const offSettings = await setProactiveCadenceOff(signal, chat);
    await closeChat(signal, chat);
    await runStep(signal, () => sleep(Number(process.env.P2_34_SLEEP_SUPPRESSION_WINDOW_MS || 2_400)));
    const offBubble = await inspectBubble(signal, pet);
    const shownAfterOff = countProactiveBubbleTelemetry({
      afterIndex: beforeOffIndex,
      status: "shown"
    });
    checks.offCadenceUsesSupportedSettings = offSettings.cadence === "off";
    checks.offCadenceSuppressesBubbles = offBubble.state === "hidden" &&
      offBubble.textLength === 0 &&
      shownAfterOff === 0;
    checks.offCadenceClearsPendingCandidates = countOpenCoordinatorCandidates() === 0;
    observations.offCadence = {
      cadence: offSettings.cadence,
      bubble: summarizeBubble(offBubble),
      shownBubbleCountAfterOff: shownAfterOff,
      openCandidateCount: countOpenCoordinatorCandidates()
    };

    chat = await openChatFromPet(signal, pet);
    const beforeReenableIndex = lastTelemetryIndex();
    const normalSettings = await setProactiveCadence(signal, chat, "normal");
    await closeChat(signal, chat);
    await runStep(signal, () => sleep(REENABLE_NO_REPLAY_WINDOW_MS));
    const reenableCandidateFlow = inspectFreshCandidateFlow(beforeReenableIndex);
    checks.reenableDoesNotReplayOldCandidates = normalSettings.cadence === "normal" &&
      reenableCandidateFlow.hasOnlyFreshAttempts;
    observations.reenable = {
      cadence: normalSettings.cadence,
      shownBubbleCount: reenableCandidateFlow.shownCount,
      freshCandidateCount: reenableCandidateFlow.freshCandidateCount
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
      durationMs: Date.now() - startedAt,
      checks,
      observations
    };
    checks.privacyOutputSafe = isSafeOutput(summary) &&
      isSafeOutput(stripKnownInternalRuntimeTelemetry(normalizeKnownElectronSecurityWarning(readPrivacyCheckText(context, [
        "progress.log",
        "electron.stdout.log",
        "electron.stderr.log",
        "result.json"
      ])), context.appDataDir));
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
      errorName: error instanceof Error ? error.name : "Error",
      startupReadiness: { ...startupReadinessDiagnostic }
    });
    process.exitCode = 1;
  } finally {
    await settleRunSteps(RUN_STEP_SETTLE_TIMEOUT_MS);
    await stopElectron(context);
    if (process.env.P2_34_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp(signal) {
  await runStep(signal, () => startElectron(context));
  await runStep(signal, () => connectToElectron(context));
  const pet = await runStep(signal, () => waitForWindow(context, "renderer/pet/index.html"));
  await runStep(signal, () => waitFor(pet, "Boolean(window.petApi)"));
  await runStep(signal, () => waitFor(pet, "Boolean(document.querySelector('#proactive-speech-bubble'))"));
  return { pet };
}

async function waitForProductionStartupReadiness(signal) {
  startupReadinessDiagnostic = {
    phase: "waiting_first_frame",
    appearanceLifecycle: "not_observed",
    candidateLifecycle: "not_observed"
  };
  const firstFrame = await waitForTelemetry(signal, (event) => event.type === "first_frame", 20_000);
  if (!firstFrame) {
    throw new Error("first_frame_timeout");
  }

  startupReadinessDiagnostic.phase = "waiting_appearance_lifecycle";
  const appearanceFirstEvent = await waitForTelemetry(signal, (event) =>
    event.__index > firstFrame.__index &&
    event.payload?.reason === "startup_first_visible_frame" &&
    [
      "pet_interaction_action_started",
      "pet_interaction_action_finished",
      "pet_interaction_action_skipped"
    ].includes(event.type), 20_000);
  if (!appearanceFirstEvent) {
    throw new Error("startup_appearance_lifecycle_timeout");
  }

  let appearanceTerminal;
  if (appearanceFirstEvent.type === "pet_interaction_action_started") {
    startupReadinessDiagnostic.appearanceLifecycle = "started";
    appearanceTerminal = await waitForTelemetry(signal, (event) =>
      event.__index > appearanceFirstEvent.__index &&
      (event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped") &&
      event.payload?.reason === "startup_first_visible_frame", 15_000);
    if (!appearanceTerminal) {
      throw new Error("startup_appearance_terminal_timeout");
    }
  } else if (appearanceFirstEvent.type === "pet_interaction_action_skipped") {
    appearanceTerminal = appearanceFirstEvent;
  } else {
    startupReadinessDiagnostic.appearanceLifecycle = "invalid_direct_finished";
    throw new Error("startup_appearance_invalid_direct_finished");
  }

  startupReadinessDiagnostic.appearanceLifecycle = appearanceTerminal.type === "pet_interaction_action_finished"
    ? "finished"
    : "skipped";
  startupReadinessDiagnostic.phase = "waiting_startup_candidate";
  const startupOutcome = await waitForCandidateTerminal(
    signal,
    "startup_daily",
    appearanceTerminal.__index,
    15_000
  );
  if (!startupOutcome) {
    throw new Error("startup_candidate_timeout");
  }
  startupReadinessDiagnostic.phase = "ready";
  startupReadinessDiagnostic.candidateLifecycle = startupOutcome.terminalStatus;
  return {
    ...startupOutcome,
    appearanceTerminalIndex: appearanceTerminal.__index
  };
}

async function openChatFromPet(signal, pet) {
  await runStep(signal, () => evaluate(pet, "window.petApi?.openChat()"));
  const chat = await runStep(signal, () => waitForWindow(context, "renderer/chat/index.html"));
  await runStep(signal, () => waitFor(chat, "Boolean(window.proactiveCompanionApi)"));
  await runStep(signal, () => waitFor(chat, "Boolean(document.querySelector('#chat-page'))"));
  return chat;
}

async function readAutomaticSituation(signal, pet) {
  return runStep(signal, () => evaluate(pet, `(async () => {
    const api = window.petApi;
    const snapshot = await api?.getAutomaticSituation();
    const closedSet = ["default", "work", "game", "reading"].includes(snapshot?.conversationContextId) &&
      ["default", "focus", "quiet", "sleep"].includes(snapshot?.presenceStateId);
    return {
      closedSet,
      readOnly: typeof api?.getAutomaticSituation === "function" && !("setAutomaticSituation" in api),
      summary: {
        conversationContextId: closedSet ? snapshot.conversationContextId : "invalid",
        presenceStateId: closedSet ? snapshot.presenceStateId : "invalid"
      }
    };
  })()`));
}

async function setProactiveCadenceOff(signal, chat) {
  return setProactiveCadence(signal, chat, "off");
}

async function setProactiveCadence(signal, chat, cadence) {
  return runStep(signal, () => evaluate(chat, `(async () => {
    const settings = await window.proactiveCompanionApi?.setSettings({ cadence: ${JSON.stringify(cadence)} });
    return { cadence: settings?.cadence ?? "invalid" };
  })()`));
}

async function closeChat(signal, chat) {
  await runStep(signal, () => chat.cdp.send("Page.close"));
  await runStep(signal, () => sleep(750));
}

async function refocusChatInput(signal, chat) {
  await runStep(signal, () => evaluate(chat, `
    (() => {
      const input = document.querySelector('#chat-input');
      if (!input) throw new Error('missing-chat-input');
      input.blur();
      window.setTimeout(() => input.focus(), 50);
      return true;
    })()
  `));
  await runStep(signal, () => sleep(150));
}

async function waitForBubbleVisible(signal, pet, options) {
  const reasonCheck = options.reason
    ? ` && bubble.dataset.reason === ${JSON.stringify(options.reason)}`
    : "";
  const lineCheck = options.lineId
    ? ` && bubble.dataset.lineId === ${JSON.stringify(options.lineId)}`
    : "";

  await runStep(signal, () => waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'visible'${reasonCheck}${lineCheck};
    })()
  `, { timeoutMs: options.timeoutMs ?? 10_000 }));
  return inspectBubble(signal, pet);
}

async function waitForBubbleHidden(signal, pet, timeoutMs) {
  await runStep(signal, () => waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'hidden' && (bubble.textContent ?? '').length === 0;
    })()
  `, { timeoutMs }));
  return inspectBubble(signal, pet);
}

async function inspectBubble(signal, pet) {
  return runStep(signal, () => evaluate(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      if (!bubble) throw new Error('missing-bubble-node');
      const text = bubble.textContent ?? '';
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute('aria-hidden'),
        datasetKeysSafe: Object.keys(bubble.dataset).every((key) => ["state", "lineId", "reason"].includes(key))
      };
    })()
  `));
}

async function readCompanionSurface(signal, chat) {
  return runStep(signal, () => evaluate(chat, `
    (() => {
      const shelfEcho = document.querySelector('#shelf-action-echo')?.textContent ?? '';
      return {
        manualModeControlsAbsent: !document.querySelector('#dialogue-mode-controls') &&
          !document.querySelector('#presence-mode-controls'),
        manualModeApisAbsent: !("dialogueModeApi" in window) && !("presenceModeApi" in window),
        shelfEchoTextLength: [...shelfEcho].length,
        shelfEchoState: document.querySelector('#shelf-action-echo')?.dataset.state ?? '',
        shelfEchoSafe: !${debugSurfacePattern}.test(shelfEcho)
      };
    })()
  `));
}

function inspectBubbleSafety(info) {
  return info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    info.datasetKeysSafe === true &&
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
    ariaHidden: info.ariaHidden,
    datasetKeysSafe: info.datasetKeysSafe
  };
}

function summarizeSurface(surface) {
  return {
    manualModeControlsAbsent: surface.manualModeControlsAbsent,
    manualModeApisAbsent: surface.manualModeApisAbsent,
    shelfEchoTextLength: surface.shelfEchoTextLength,
    shelfEchoState: surface.shelfEchoState,
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

async function waitForChatListenAction({ signal, afterIndex, timeoutMs }) {
  return waitForTelemetry(signal, (event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    ["dialogueOpenWelcome", "listen"].includes(event.payload?.type) &&
    event.payload?.stateId === "listen" &&
    (event.payload?.reason === "chat_opened" || event.payload?.reason === "chat_input_focus")
  ), timeoutMs);
}

async function waitForTelemetry(signal, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const event = readTelemetryEvents().find(predicate);
    if (event) {
      return event;
    }
    await runStep(signal, () => sleep(150));
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

function countOpenCoordinatorCandidates() {
  const openCandidates = new Set();
  for (const event of readTelemetryEvents()) {
    if (event.type !== "proactive_bubble_candidate") continue;
    const candidateId = event.payload?.candidateId;
    if (typeof candidateId !== "string") continue;
    if (event.payload?.status === "queued" || event.payload?.status === "attempted") {
      openCandidates.add(candidateId);
    } else if (["shown", "skipped", "expired"].includes(event.payload?.status)) {
      openCandidates.delete(candidateId);
    }
  }
  return openCandidates.size;
}

function inspectFreshCandidateFlow(afterIndex) {
  const freshQueuedCandidates = new Set();
  let freshCandidateCount = 0;
  let shownCount = 0;
  let hasOnlyFreshAttempts = true;

  for (const event of readTelemetryEvents()) {
    if (event.__index <= afterIndex || event.type !== "proactive_bubble_candidate") continue;
    const candidateId = event.payload?.candidateId;
    if (typeof candidateId !== "string") continue;
    const status = event.payload?.status;
    if (status === "queued") {
      freshQueuedCandidates.add(candidateId);
      freshCandidateCount += 1;
      continue;
    }
    if (status === "attempted" || status === "shown") {
      hasOnlyFreshAttempts &&= freshQueuedCandidates.has(candidateId);
      if (status === "shown") shownCount += 1;
    }
    if (["shown", "skipped", "expired"].includes(status)) {
      freshQueuedCandidates.delete(candidateId);
    }
  }

  return { hasOnlyFreshAttempts, shownCount, freshCandidateCount };
}

async function waitForCandidateTerminal(signal, candidateId, afterIndex, timeoutMs) {
  const event = await waitForTelemetry(signal, (candidateEvent) =>
    candidateEvent.__index > afterIndex &&
    candidateEvent.type === "proactive_bubble_candidate" &&
    candidateEvent.payload?.candidateId === candidateId &&
    ["shown", "skipped", "expired"].includes(candidateEvent.payload?.status), timeoutMs);
  if (!event) throw new Error("Timed out waiting for candidate terminal");
  return {
    terminalStatus: event.payload?.status,
    skipReason: ["engagement_blocked", "interruptibility_not_allowed", "system_unavailable"].includes(event.payload?.skipReason)
      ? event.payload.skipReason
      : null
  };
}

async function waitForLowFrequencyQueuedDecision(signal, afterIndex, timeoutMs) {
  const event = await waitForTelemetry(signal, (decisionEvent) =>
    decisionEvent.__index > afterIndex &&
    decisionEvent.type === "low_frequency_companion_event" &&
    decisionEvent.payload?.reason === "idle_presence" &&
    decisionEvent.payload?.status === "queued", timeoutMs);
  if (!event) throw new Error("Timed out waiting for low-frequency queued decision");
  return {
    status: "queued",
    reason: "idle_presence",
    eventId: typeof event.payload?.eventId === "string" ? event.payload.eventId : null,
    stateId: typeof event.payload?.stateId === "string" ? event.payload.stateId : null
  };
}

function inspectCandidateActionFirst(candidateId, afterIndex, expectedActionReason) {
  const events = readTelemetryEvents().filter((event) => event.__index > afterIndex);
  const candidateEvents = events.filter((event) =>
    event.type === "proactive_bubble_candidate" && event.payload?.candidateId === candidateId);
  const indexForStatus = (status) => candidateEvents.find((event) => event.payload?.status === status)?.__index ?? -1;
  const queuedIndex = indexForStatus("queued");
  const attemptedIndex = indexForStatus("attempted");
  const shownIndex = indexForStatus("shown");
  const actionIndex = events.find((event) =>
    event.type === "pet_interaction_action_started" &&
    event.__index > attemptedIndex && event.__index < shownIndex &&
    (!expectedActionReason || event.payload?.reason === expectedActionReason))?.__index ?? -1;
  const statuses = candidateEvents
    .map((event) => event.payload?.status)
    .filter((status) => ["queued", "attempted", "shown", "skipped", "expired"].includes(status));
  return {
    candidateId,
    statuses,
    actionObserved: actionIndex >= 0,
    passed: queuedIndex >= 0 && attemptedIndex > queuedIndex &&
      actionIndex > attemptedIndex && shownIndex > actionIndex
  };
}

function isSafeOutput(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return !forbiddenOutputPatterns.some((pattern) => pattern.test(text));
}

function normalizeKnownElectronSecurityWarning(text) {
  const lines = text.split(/\r?\n/);
  const normalized = [];
  for (let index = 0; index < lines.length;) {
    const isFixedSecurityWarning = electronSecurityWarningBlock.every(
      (line, offset) => lines[index + offset] === line
    );
    if (isFixedSecurityWarning) {
      normalized.push(...electronSecurityWarningBlock.map((line) =>
        line === "https://electronjs.org/docs/tutorial/security."
          ? "[electron-security-docs]"
          : line));
      index += electronSecurityWarningBlock.length;
      continue;
    }
    normalized.push(lines[index]);
    index += 1;
  }
  return normalized.join("\n");
}

function stripKnownInternalRuntimeTelemetry(text, runnerUserDataPath) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      try {
        const event = JSON.parse(line);
        const recordedPath = event?.type === "startup" && event.payload?.userDataPath;
        const normalizePath = (value) => typeof value === "string"
          ? value.trim().replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase()
          : "";
        if (!runnerUserDataPath || normalizePath(recordedPath) !== normalizePath(runnerUserDataPath)) {
          return line;
        }
        return JSON.stringify({
          ...event,
          payload: {
            ...event.payload,
            userDataPath: "[runner-user-data]"
          }
        });
      } catch {
        return line;
      }
    })
    .join("\n");
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out|timeout/i.test(message)) {
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
  if (hasWrittenResult) return;
  hasWrittenResult = true;
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

async function runWithHardTimeout() {
  const timeoutHandle = setTimeout(() => {
    runnerAbortController.abort(new Error("Runner total timeout"));
  }, RUNNER_TOTAL_TIMEOUT_MS);
  timeoutHandle.unref?.();
  try {
    await main(runnerAbortController.signal);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runStep(signal, operation) {
  throwIfAborted(signal);
  const operationPromise = Promise.resolve().then(() => {
    throwIfAborted(signal);
    return operation();
  });
  activeRunSteps.add(operationPromise);
  operationPromise.then(
    () => activeRunSteps.delete(operationPromise),
    () => activeRunSteps.delete(operationPromise)
  );
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Runner total timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    operationPromise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function settleRunSteps(timeoutMs) {
  return settleActiveRunSteps(activeRunSteps, timeoutMs);
}

function throwIfAborted(signal) {
  if (signal.aborted) throw signal.reason ?? new Error("Runner total timeout");
}

await runWithHardTimeout();
