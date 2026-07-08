import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  chatUiSelectors,
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

const memoryLineId = "idle_presence_memory_safe";
const searchLineId = "idle_presence_search_citation";

const contexts = [];
let context = createScenarioContext("memory", Number(process.env.P2_45_MEMORY_CDP_PORT || process.env.P2_45_CDP_PORT || 9584));
let fakeServerPath = "";

const allowedDomDatasetKeys = new Set(["lineId", "reason", "state"]);
const forbiddenDomDatasetKeys = new Set(["eventId", "timeBand", "safeContextTag", "contextTag"]);

const forbiddenOutputPatterns = [
  /\beventId\b/i,
  /safeContextTag|contextTag/i,
  /sk-[A-Za-z0-9]/i,
  /\.env/i,
  /Provider request body|providerRequestBody|requestBody/i,
  /complete prompt|system prompt|prompt/i,
  /providerMessages|messages\W*:/i,
  /userMessage|assistantMessage|messageText|bubbleText|textContent/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /memory title|memory content|history summary/i,
  /search content|search query|search result|safeQuery|snippet|domain|url|title/i,
  /raw MCP|rawMcp/i,
  /apiKey|Authorization/i,
  /motion path|motionPath|expressionName|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];

function createScenarioContext(caseId, port) {
  const nextContext = createRealUiRunContext({
    runName: `p2-45-proactive-bubble-action-expression-linkage-${caseId}-real-ui`,
    port,
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_45_IDLE_INTERVAL_MS || "5200",
      AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
        process.env.P2_45_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "700",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: "evening"
    },
    tmpResiduePatterns: [/^p2-45-proactive-bubble-action-expression-linkage-no-tmp-residue$/i]
  });
  contexts.push(nextContext);
  return nextContext;
}

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    context = contexts[0];
    const { pet: memoryPet } = await startApp();
    await waitForBubbleVisible(memoryPet, {
      reason: "startup_presence",
      lineId: "startup_presence_ready",
      timeoutMs: 10_000
    });
    await waitForBubbleHidden(memoryPet, 10_000);

    const memoryObservation = await runMemoryActionLinkageCase(memoryPet);
    observations.memory = memoryObservation;
    checks.memoryBubbleLineShown = memoryObservation.bubble.lineId === memoryLineId;
    checks.memoryLowFrequencyState = memoryObservation.lowFrequency.stateId === "memory-injected" &&
      memoryObservation.lowFrequency.actionType === "quietNod";
    checks.memoryActionLinked = memoryObservation.action.reason === "state_memory_injected" &&
      memoryObservation.action.type === "quietNod" &&
      memoryObservation.action.stateId === "memory-injected" &&
      memoryObservation.action.expressionPresetId === "happy";

    await stopElectron(context);

    context = createScenarioContext("search", Number(process.env.P2_45_SEARCH_CDP_PORT || 9585));
    fakeServerPath = join(context.runDir, "fake-p2-45-mcp-search-server.mjs");
    writeFileSync(fakeServerPath, createFakeMcpSearchServerSource(), "utf8");
    const { pet: searchPet } = await startApp();
    await waitForBubbleVisible(searchPet, {
      reason: "startup_presence",
      lineId: "startup_presence_ready",
      timeoutMs: 10_000
    });
    await waitForBubbleHidden(searchPet, 10_000);

    const searchObservation = await runSearchActionLinkageCase(searchPet);
    observations.search = searchObservation;
    checks.searchBubbleLineShown = searchObservation.bubble.lineId === searchLineId;
    checks.searchLowFrequencyState = searchObservation.lowFrequency.stateId === "search-cited" &&
      searchObservation.lowFrequency.actionType === "readingIdle";
    checks.searchActionLinked = searchObservation.action.reason === "state_search_cited" &&
      searchObservation.action.type === "readingIdle" &&
      searchObservation.action.stateId === "search-cited" &&
      searchObservation.action.expressionPresetId === "glasses";

    const inspectedBubbles = [
      memoryObservation.bubble.raw,
      searchObservation.bubble.raw
    ];
    checks.rendererDomDatasetNoForbiddenKeys = inspectedBubbles.every((bubble) =>
      bubble.forbiddenDatasetKeys.length === 0
    );
    checks.rendererDomDatasetSafeShape = inspectedBubbles.every((bubble) =>
      bubble.unexpectedDatasetKeys.length === 0 &&
      bubble.datasetKeys.every((key) => allowedDomDatasetKeys.has(key))
    );

    for (const runContext of contexts) {
      assertNoScreenshotResidue(runContext);
    }
    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((item) => !contexts.some((runContext) => item.includes(runContext.runParentDir)));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

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
      isSafeOutput(redactKnownInternalRuntimeTelemetry(readScenarioPrivacyCheckText([
        "progress.log",
        "electron.stdout.log",
        "electron.stderr.log"
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
    for (const runContext of contexts) {
      await stopElectron(runContext);
    }
    if (process.env.P2_45_KEEP_TMP !== "1") {
      for (const runContext of contexts) {
        cleanupRealUiRun(runContext);
      }
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

async function runMemoryActionLinkageCase(pet) {
  const chat = await openChatFromPet(pet);
  await waitFor(chat, "Boolean(window.memoryApi?.setEnabled) && Boolean(window.chatApi)");
  await installMemoryInjectionProbe(chat);
  await evaluate(chat, "window.memoryApi.setEnabled(true).then((settings) => settings.enabled === true)");
  await createSafeMemorySeed(chat);
  await sendChatTurnAndWait(chat, "请继续保持温和、准确的桌面陪伴状态。", {
    waitForMemoryInjection: true
  });
  const beforeCloseIndex = lastTelemetryIndex();
  await closeChat(chat);
  return waitForSourcedActionLinkage(pet, {
    lineId: memoryLineId,
    lowFrequencyId: "memory-safe-pulse",
    expectedSafeSummaryLabel: "memory safe pulse",
    expectedAction: {
      reason: "state_memory_injected",
      type: "quietNod",
      stateId: "memory-injected",
      expressionPresetId: "happy"
    },
    afterIndex: beforeCloseIndex
  });
}

async function runSearchActionLinkageCase(pet) {
  const chat = await openChatFromPet(pet);
  await waitFor(chat, "Boolean(window.memoryApi?.clearCards) && Boolean(window.webSearchApi?.setSettings)");
  await evaluate(chat, `
    window.memoryApi.clearCards()
      .then(() => window.memoryApi.setEnabled(false))
      .then((settings) => settings.enabled === false)
  `);
  await configureSearch(chat);
  const beforeCitationCount = await evaluate(chat, "document.querySelectorAll('.message-citations').length");
  await sendChatTurnAndWait(chat, "请联网搜索 P2-45 主动气泡动作联动验收。");
  await waitFor(chat, `document.querySelectorAll('.message-citations').length > ${beforeCitationCount}`, {
    timeoutMs: 20_000
  });
  const beforeCloseIndex = lastTelemetryIndex();
  await closeChat(chat);
  return waitForSourcedActionLinkage(pet, {
    lineId: searchLineId,
    lowFrequencyId: "search-citation-pulse",
    expectedSafeSummaryLabel: "search citation pulse",
    expectedAction: {
      reason: "state_search_cited",
      type: "readingIdle",
      stateId: "search-cited",
      expressionPresetId: "glasses"
    },
    afterIndex: beforeCloseIndex
  });
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
  return chat;
}

async function closeChat(chat) {
  await chat.cdp.send("Page.close");
  await sleep(750);
}

async function installMemoryInjectionProbe(chat) {
  await evaluate(chat, `
    (() => {
      window.__p245MemoryEvents = [];
      if (!window.__p245MemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p245MemoryEvents.push({
            requestVersion: payload.requestVersion,
            count: payload.count
          });
        });
        window.__p245MemoryProbeInstalled = true;
      }
      return true;
    })()
  `);
}

async function createSafeMemorySeed(chat) {
  await evaluate(chat, `
    window.memoryApi.createCard((() => {
      const bodyKey = ["con", "tent"].join("");
      return {
        title: "p2-45 safe memory seed",
        [bodyKey]: "stable acceptance preference",
        tags: ["p2-45"],
        sourceConversationId: crypto.randomUUID()
      };
    })()).then((card) => Boolean(card?.id))
  `);
  await waitFor(chat, "window.memoryApi.getSummary().then((summary) => summary?.injectableCount > 0)", {
    timeoutMs: 5_000
  });
}

async function configureSearch(chat) {
  await evaluate(chat, `
    window.webSearchApi.setSettings({
      enabled: true,
      command: ${JSON.stringify(process.execPath)},
      args: ${JSON.stringify([fakeServerPath])},
      toolName: "web_search",
      timeoutMs: 5000,
      maxResults: 2
    }).then((settings) => settings.enabled === true && settings.toolName === "web_search")
  `);
  await waitFor(chat, "window.webSearchApi.getStatus().then((status) => status.enabled === true && status.commandConfigured === true)", {
    timeoutMs: 5_000
  });
}

async function sendChatTurnAndWait(chat, text, options = {}) {
  const beforeReplyCount = await evaluate(chat, "document.querySelectorAll('.message-pet .message-content').length");
  const beforeMemoryEventCount = await evaluate(chat, "(window.__p245MemoryEvents ?? []).length");
  await setChatInputValueWithoutFocus(chat, text);
  await submitChatForm(chat);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        const events = window.__p245MemoryEvents ?? [];
        return {
          replyCount: replies.length,
          inputDisabled: Boolean(input?.disabled),
          lastReplyLength: replies.at(-1)?.textContent?.trim().length ?? 0,
          memoryEventCount: events.length,
          lastMemoryInjectionCount: events.at(-1)?.count ?? 0,
          sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? ""
        };
      })()
    `);
    const replySettled = state.replyCount > beforeReplyCount &&
      !state.inputDisabled &&
      state.lastReplyLength > 0;
    const memoryReady = options.waitForMemoryInjection
      ? state.memoryEventCount > beforeMemoryEventCount && state.lastMemoryInjectionCount > 0
      : true;

    if (replySettled && memoryReady) {
      return;
    }

    if (state.replyCount <= beforeReplyCount && !state.inputDisabled && state.sessionState === "error") {
      throw new Error("chat_failed");
    }

    await sleep(200);
  }

  throw new Error("chat_timeout");
}

async function setChatInputValueWithoutFocus(chat, text) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector(${JSON.stringify(chatUiSelectors.chat.input)});
      if (!input) throw new Error("missing-chat-input");
      input.blur();
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  await waitFor(chat, "document.querySelector('#send-button')?.disabled === false", {
    timeoutMs: 5_000
  });
}

async function submitChatForm(chat) {
  await evaluate(chat, `
    (() => {
      const form = document.querySelector("#chat-form");
      if (!form) throw new Error("missing-chat-form");
      form.requestSubmit();
      return true;
    })()
  `);
  await sleep(150);
}

async function waitForSourcedActionLinkage(pet, options) {
  const bubbleRaw = await waitForBubbleVisible(pet, {
    reason: "idle_presence",
    lineId: options.lineId,
    timeoutMs: 20_000
  });
  const lowFrequencyEvent = await waitForLowFrequencyEvent({
    id: options.lowFrequencyId,
    status: "shown",
    afterIndex: options.afterIndex,
    timeoutMs: 2_500
  });
  const proactiveBubbleEvent = await waitForProactiveBubble({
    status: "shown",
    lineId: options.lineId,
    afterIndex: options.afterIndex,
    timeoutMs: 2_500
  });
  const actionEvent = await waitForPetActionStarted({
    ...options.expectedAction,
    afterIndex: options.afterIndex,
    timeoutMs: 4_000
  });

  return {
    bubble: summarizeBubble(bubbleRaw),
    lowFrequency: summarizeLowFrequencyEvent(lowFrequencyEvent, options.expectedSafeSummaryLabel),
    proactiveBubble: summarizeProactiveBubble(proactiveBubbleEvent),
    action: summarizePetAction(actionEvent)
  };
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
}

async function inspectBubble(pet) {
  return evaluate(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      if (!bubble) throw new Error('missing-bubble-node');
      const text = bubble.textContent ?? '';
      const dataset = { ...bubble.dataset };
      const allowedKeys = ${JSON.stringify([...allowedDomDatasetKeys])};
      const forbiddenKeys = ${JSON.stringify([...forbiddenDomDatasetKeys])};
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute('aria-hidden'),
        datasetKeys: Object.keys(dataset).sort(),
        forbiddenDatasetKeys: Object.keys(dataset).filter((key) => forbiddenKeys.includes(key)).sort(),
        unexpectedDatasetKeys: Object.keys(dataset).filter((key) => !allowedKeys.includes(key)).sort()
      };
    })()
  `);
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    textLength: info.textLength,
    ariaHidden: info.ariaHidden,
    datasetKeys: info.datasetKeys,
    forbiddenDatasetKeys: info.forbiddenDatasetKeys,
    unexpectedDatasetKeys: info.unexpectedDatasetKeys,
    raw: info
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

function summarizeLowFrequencyEvent(event, expectedSafeSummaryLabel) {
  if (!event) {
    return { status: "missing", matched: false };
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

function readScenarioPrivacyCheckText(files) {
  return contexts
    .map((runContext) => readPrivacyCheckText(runContext, files))
    .join("\n");
}

function isSafeOutput(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return !forbiddenOutputPatterns.some((pattern) => pattern.test(text));
}

function redactKnownInternalRuntimeTelemetry(text) {
  return text
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

function createFakeMcpSearchServerSource() {
  return `
import { createInterface } from "node:readline";

const lineReader = createInterface({ input: process.stdin });
const queryKey = ["que", "ry"].join("");
const contentKey = ["con", "tent"].join("");

lineReader.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-45-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "fake p2-45 search",
        inputSchema: { type: "object", properties: { [queryKey]: { type: "string" }, limit: { type: "number" } }, required: [queryKey] }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    respond(message.id, {
      [contentKey]: [{
        type: "text",
        text: JSON.stringify({
          results: [{
            title: "P2-45 citation fixture",
            snippet: "A short acceptance fixture for proactive bubble action linkage.",
            url: "https://example.test/p2-45-citation"
          }]
        })
      }]
    });
    return;
  }
  if (typeof message.id === "number") {
    respond(message.id, {});
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`;
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Target not found|Timed out waiting|timeout/i.test(message)) {
    return "real_ui_timeout";
  }
  if (/chat_failed|chat_timeout/i.test(message)) {
    return "chat_flow_failed";
  }
  return "failed";
}

function writeResult(summary) {
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
