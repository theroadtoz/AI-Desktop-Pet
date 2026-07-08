import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  chatUiSelectors,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  openHistorySettings,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const historyLineId = "idle_presence_history_summary";
const historyLowFrequencyId = "history-summary-pulse";
const expectedSafeSummaryLabel = "context compression pulse";
const expectedAction = {
  reason: "state_proactive_bubble_visible",
  type: "softSmile",
  stateId: "proactive-bubble-visible",
  expressionPresetId: "happy"
};
const seededConversationId = crypto.randomUUID();
const seededConversationTitle = "P2-49 seeded compressed context";

const context = createRealUiRunContext({
  runName: "p2-49-expression-state-linkage-safe-extension-and-regression-real-ui",
  port: Number(process.env.P2_49_CDP_PORT || 9649),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
      process.env.P2_49_IDLE_INTERVAL_MS || "650",
    AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
      process.env.P2_49_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "700",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: "evening"
  },
  tmpResiduePatterns: [/^p2-49-expression-state-linkage-safe-extension-and-regression-no-tmp-residue$/i]
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
  historyLineId,
  "idle_presence_memory_safe",
  "idle_presence_search_citation",
  "mode_presence_focus",
  "mode_presence_work",
  "mode_presence_game",
  "mode_presence_reading"
]);

const allowedDomDatasetKeys = new Set([
  "lineId",
  "reason",
  "state"
]);

const forbiddenDomDatasetKeys = new Set([
  "eventId",
  "timeBand",
  "safeContextTag",
  "contextTag"
]);

const forbiddenOutputPatterns = [
  /\beventId\b/i,
  /safeContextTag|contextTag/i,
  /history summary|historySummary/i,
  /summary body|summaryBody|summary text|summaryText|summary content|summaryContent/i,
  /\bbody\b|bodyText|messageBody/i,
  /providerMessages|messages\W*:/i,
  /userMessage|assistantMessage|messageText|bubbleText|textContent|futureLlmText/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /memory title|memory content|raw memory/i,
  /search content|search query|search result|raw search|safeQuery|snippet|domain|url|title/i,
  /raw path|rawPath|raw MCP|rawMcp/i,
  /apiKey|Authorization/i,
  /sk-[A-Za-z0-9]/i,
  /motion path|motionPath|expressionName|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];

const privateTexts = [
  "P2-49_RAW_USER_SENTINEL short context check",
  "P2-49_FINAL_USER_SENTINEL compressed context check",
  "sk-p249-secret-should-not-appear"
];

function prepareSeededHistory() {
  const historyDirectory = join(context.appDataDir, "history");
  mkdirSync(historyDirectory, { recursive: true });

  const now = Date.now();
  const messages = Array.from({ length: 12 }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const content = `P2-49_SEEDED_PRIVATE_SENTINEL_${String(index + 1).padStart(2, "0")}`;
    privateTexts.push(content);
    return {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: now - 12_000 + index * 1_000
    };
  });

  writeFileSync(join(historyDirectory, "conversations.json"), `${JSON.stringify({
    version: 1,
    conversations: [{
      id: seededConversationId,
      title: seededConversationTitle,
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt,
      messages
    }]
  }, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    log(context, "run_started p2-49 compressed-context-action-linkage provider=fake");
    const { pet } = await startApp();

    const startupBubble = await waitForBubbleVisible(pet, {
      reason: "startup_presence",
      lineId: "startup_presence_ready",
      timeoutMs: 10_000
    });
    checks.startupBubbleSafe = inspectBubbleSafety(startupBubble);
    await waitForBubbleHidden(pet, 10_000);

    const chat = await openChatFromPet(pet);
    const short = await sendMessage(chat, privateTexts[0]);
    checks.shortContextObserved = short.contextBudget.compressed === false &&
      short.contextBudget.providerMessageCount === 1;

    const selected = await selectSeededHistory(chat);
    checks.seededPreviewSafe = selected.previewClass.includes("status-box") &&
      /不会自动发送|较早消息/.test(selected.preview) &&
      privateTexts.every((item) => !selected.preview.includes(item)) &&
      !/providerMessages|prompt|requestVersion/.test(selected.preview);

    await continueSeededHistory(chat);
    const beforeIndex = lastTelemetryIndex();
    const compressed = await sendMessage(chat, privateTexts[1]);
    checks.compressedContextObserved = compressed.contextBudget.compressed === true &&
      compressed.contextBudget.summaryMessageCount === 1 &&
      compressed.contextBudget.summarizedMessageCount > 0 &&
      compressed.contextBudget.recentMessageCount <= 8;

    await closeChat(chat);
    const linked = await waitForCompressedContextActionLinkage({
      afterIndex: beforeIndex
    });
    observations.case = {
      bubble: omitRaw(linked.bubble),
      lowFrequency: linked.lowFrequency,
      proactiveBubble: linked.proactiveBubble,
      action: linked.action
    };
    observations.contextBudget = compressed.contextBudget;
    observations.counts = countSafeTelemetry();

    checks.fixedLowFrequencyLinked = linked.lowFrequency.status === "shown" &&
      linked.lowFrequency.matched === true &&
      linked.lowFrequency.stateId === expectedAction.stateId &&
      linked.lowFrequency.actionType === expectedAction.type;
    checks.bubbleLineShown = linked.bubble.lineId === historyLineId &&
      linked.bubble.reason === "idle_presence";
    checks.bubbleMatchesTelemetry = linked.proactiveBubble?.lineId === linked.bubble.lineId &&
      linked.proactiveBubble?.reason === linked.bubble.reason;
    checks.actionExpressionLinked = linked.action.status === "started" &&
      linked.action.reason === expectedAction.reason &&
      linked.action.type === expectedAction.type &&
      linked.action.stateId === expectedAction.stateId &&
      linked.action.expressionPresetId === expectedAction.expressionPresetId;
    checks.bubbleSafe = linked.bubble.safe;

    const inspectedBubbles = [
      startupBubble,
      linked.bubble.raw
    ];
    checks.rendererDomDatasetNoForbiddenKeys = inspectedBubbles.every((bubble) =>
      bubble.forbiddenDatasetKeys.length === 0
    );
    checks.rendererDomDatasetOnlySafeKeys = inspectedBubbles.every((bubble) =>
      bubble.unexpectedDatasetKeys.length === 0 &&
      bubble.datasetKeys.every((key) => allowedDomDatasetKeys.has(key))
    );

    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((item) => !item.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      providerFixture: "FakeProvider",
      fixedAction: expectedAction.type,
      fixedExpressionPresetId: expectedAction.expressionPresetId,
      durationMs: Date.now() - startedAt,
      checks,
      observations
    };
    checks.privacyOutputSafe = isSafeOutput(summary) &&
      isSafeOutput(redactKnownInternalRuntimeTelemetry(readPrivacyCheckText(context, [
        "progress.log",
        "electron.stdout.log",
        "electron.stderr.log"
      ]))) &&
      privateTexts.every((item) => !JSON.stringify(summary).includes(item));
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
    if (process.env.P2_49_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  prepareSeededHistory();
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
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.chatApi?.onContextTransparency)");
  await installContextTransparencyProbe(chat);
  return chat;
}

async function installContextTransparencyProbe(chat) {
  await evaluate(chat, `
    (() => {
      window.__p249ContextTransparencyEvents = [];
      if (!window.__p249ContextProbeInstalled) {
        window.chatApi?.onContextTransparency((payload) => {
          const contextBudget = payload?.contextBudget ?? {};
          window.__p249ContextTransparencyEvents.push({
            contextBudget: {
              originalMessageCount: contextBudget.originalMessageCount,
              providerMessageCount: contextBudget.providerMessageCount,
              compressed: contextBudget.compressed,
              summaryMessageCount: contextBudget.summaryMessageCount,
              summarizedMessageCount: contextBudget.summarizedMessageCount,
              recentMessageCount: contextBudget.recentMessageCount
            }
          });
        });
        window.__p249ContextProbeInstalled = true;
      }
      return true;
    })()
  `);
}

async function sendMessage(chat, message) {
  const beforeCount = await evaluate(chat, "window.__p249ContextTransparencyEvents?.length ?? 0");
  await typeText(chat, chatUiSelectors.chat.input, message);
  await click(chat, chatUiSelectors.chat.send);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        const events = window.__p249ContextTransparencyEvents ?? [];
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        return {
          inputDisabled: Boolean(input?.disabled),
          eventCount: events.length,
          lastEvent: events.at(-1) ?? null,
          replyCount: replies.length,
          lastReplyLength: replies.at(-1)?.textContent?.trim().length ?? 0,
          sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? ""
        };
      })()
    `);
    const contextReady = state.eventCount > beforeCount && state.lastEvent?.contextBudget;
    const replySettled = !state.inputDisabled && state.replyCount > 0 && state.lastReplyLength > 0;
    if (contextReady && replySettled) {
      return state.lastEvent;
    }
    if (!state.inputDisabled && state.sessionState === "error") {
      throw new Error("chat_failed");
    }
    await sleep(150);
  }

  throw new Error("chat_timeout");
}

async function selectSeededHistory(chat) {
  await openHistorySettings(chat);
  await waitFor(chat, "document.querySelectorAll('.conversation-select').length > 0", {
    timeoutMs: 10_000
  });
  await evaluate(chat, `
    (() => {
      const button = [...document.querySelectorAll(".conversation-select")]
        .find((item) => item.textContent?.includes(${JSON.stringify(seededConversationTitle)}));
      if (!button) {
        throw new Error("Missing seeded conversation");
      }
      button.click();
    })()
  `);
  await waitFor(chat, "document.querySelector('#settings-history-detail-page')?.hidden === false");
  await waitFor(chat, "Boolean(document.querySelector('#history-context-preview'))");
  return evaluate(chat, `
    (() => ({
      preview: document.querySelector("#history-context-preview")?.textContent ?? "",
      previewClass: document.querySelector("#history-context-preview")?.className ?? "",
      previewState: document.querySelector("#history-context-preview")?.dataset.state ?? ""
    }))()
  `);
}

async function continueSeededHistory(chat) {
  await evaluate(chat, `
    (() => {
      const button = document.querySelector("#history-detail .history-detail-actions button.button");
      if (!button) {
        throw new Error("Missing continue button");
      }
      button.click();
    })()
  `);
  await waitFor(chat, "document.querySelector('#chat-page')?.hidden === false");
}

async function closeChat(chat) {
  await chat.cdp.send("Page.close");
  await sleep(750);
}

async function waitForCompressedContextActionLinkage({ afterIndex }) {
  const bubbleRaw = await waitForBubbleVisible(null, {
    reason: "idle_presence",
    lineId: historyLineId,
    timeoutMs: 20_000
  });
  const lowFrequencyEvent = await waitForLowFrequencyEvent({
    id: historyLowFrequencyId,
    status: "shown",
    afterIndex,
    timeoutMs: 2_500
  });
  const proactiveBubbleEvent = await waitForProactiveBubble({
    status: "shown",
    lineId: historyLineId,
    afterIndex,
    timeoutMs: 2_500
  });
  const actionEvent = await waitForPetActionStarted({
    ...expectedAction,
    afterIndex,
    timeoutMs: 4_000
  });

  return {
    bubble: summarizeBubble(bubbleRaw),
    lowFrequency: summarizeLowFrequencyEvent(lowFrequencyEvent),
    proactiveBubble: summarizeProactiveBubble(proactiveBubbleEvent),
    action: summarizePetAction(actionEvent)
  };
}

async function waitForBubbleVisible(pet, options = {}) {
  const targetPet = pet ?? await waitForWindow(context, "renderer/pet/index.html");
  const reasonCheck = options.reason
    ? ` && bubble.dataset.reason === ${JSON.stringify(options.reason)}`
    : "";
  const lineCheck = options.lineId
    ? ` && bubble.dataset.lineId === ${JSON.stringify(options.lineId)}`
    : "";

  await waitFor(targetPet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'visible'${reasonCheck}${lineCheck};
    })()
  `, { timeoutMs: options.timeoutMs ?? 10_000 });
  return inspectBubble(targetPet);
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
      const content = bubble.textContent ?? '';
      const dataset = { ...bubble.dataset };
      const allowedKeys = ${JSON.stringify([...allowedDomDatasetKeys])};
      const forbiddenKeys = ${JSON.stringify([...forbiddenDomDatasetKeys])};
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        glyphCount: [...content].length,
        ariaHidden: bubble.getAttribute('aria-hidden'),
        datasetKeys: Object.keys(dataset).sort(),
        forbiddenDatasetKeys: Object.keys(dataset).filter((key) => forbiddenKeys.includes(key)).sort(),
        unexpectedDatasetKeys: Object.keys(dataset).filter((key) => !allowedKeys.includes(key)).sort()
      };
    })()
  `);
}

function inspectBubbleSafety(info) {
  return info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    (info.state === "hidden" || allowedLineIds.has(info.lineId)) &&
    (info.state === "hidden" || info.reason === "startup_presence" || info.reason === "idle_presence" || info.reason === "mode_presence") &&
    (info.state === "hidden" || info.glyphCount > 0) &&
    info.glyphCount <= 16 &&
    info.forbiddenDatasetKeys.length === 0 &&
    info.unexpectedDatasetKeys.length === 0;
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    glyphCount: info.glyphCount,
    ariaHidden: info.ariaHidden,
    datasetKeys: info.datasetKeys,
    forbiddenDatasetKeys: info.forbiddenDatasetKeys,
    unexpectedDatasetKeys: info.unexpectedDatasetKeys,
    safe: inspectBubbleSafety(info),
    raw: info
  };
}

function omitRaw(value) {
  const { raw, ...safeValue } = value;
  return safeValue;
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

async function waitForLowFrequencyEvent({ id, status, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "low_frequency_companion_event" &&
    event.payload?.eventId === id &&
    event.payload?.status === status
  ), timeoutMs);
}

async function waitForProactiveBubble({ status, lineId, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === status &&
    event.payload?.lineId === lineId
  ), timeoutMs);
}

async function waitForPetActionStarted({ reason, type, stateId, expressionPresetId, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === reason &&
    event.payload?.type === type &&
    event.payload?.stateId === stateId &&
    event.payload?.expressionPresetId === expressionPresetId
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

function summarizeLowFrequencyEvent(event) {
  if (!event) {
    return {
      status: "missing",
      matched: false
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
    safeSummaryLabel: payload.safeSummaryLabel,
    interruptPolicy: payload.interruptPolicy,
    durationMs: payload.durationMs,
    matched: payload.safeSummaryLabel === expectedSafeSummaryLabel &&
      payload.status === "shown" &&
      payload.reason === "idle_presence"
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

function summarizePetAction(event) {
  if (!event) {
    return { status: "missing" };
  }

  const payload = event.payload ?? {};
  return {
    status: "started",
    type: payload.type,
    reason: payload.reason,
    stateId: payload.stateId,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    expressionPresetId: payload.expressionPresetId,
    selectedActionType: payload.selectedActionType,
    candidateActionTypes: payload.candidateActionTypes,
    durationMs: payload.durationMs
  };
}

function countSafeTelemetry() {
  const counts = {};
  for (const event of readTelemetryEvents()) {
    if (event.type === "low_frequency_companion_event") {
      const payload = event.payload ?? {};
      const key = `low_frequency:${payload.status}:${payload.reason}:${payload.safeSummaryLabel ?? "none"}:${payload.stateId ?? "none"}:${payload.actionType ?? "none"}`;
      counts[key] = (counts[key] ?? 0) + 1;
      continue;
    }
    if (event.type === "proactive_speech_bubble") {
      const key = `bubble:${event.payload?.status}:${event.payload?.reason}:${event.payload?.lineId}`;
      counts[key] = (counts[key] ?? 0) + 1;
      continue;
    }
    if (event.type === "pet_interaction_action_started") {
      const key = `action:${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId ?? "none"}:${event.payload?.expressionPresetId ?? "none"}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

function isSafeOutput(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  return !forbiddenOutputPatterns.some((pattern) => pattern.test(output));
}

function redactKnownInternalRuntimeTelemetry(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      try {
        const event = JSON.parse(line);
        if (event?.type === "startup" && event.payload && typeof event.payload === "object") {
          const payload = { ...event.payload };
          delete payload.userDataPath;
          return JSON.stringify({ ...event, payload });
        }
        if (event?.type === "low_frequency_companion_event" && event.payload && typeof event.payload === "object") {
          const payload = { ...event.payload };
          delete payload.eventId;
          return JSON.stringify({ ...event, payload });
        }
      } catch {
        return line;
      }

      return line;
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
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
