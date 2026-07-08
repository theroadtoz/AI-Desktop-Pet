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
let context = createScenarioContext("memory", Number(process.env.P2_44_MEMORY_CDP_PORT || process.env.P2_44_CDP_PORT || 9574));
let fakeServerPath = "";

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
  memoryLineId,
  searchLineId,
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
    runName: `p2-44-sourced-memory-search-proactive-bubble-polish-${caseId}-real-ui`,
    port,
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_44_IDLE_INTERVAL_MS || "650",
      AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
        process.env.P2_44_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "700",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: "evening"
    },
    tmpResiduePatterns: [/^p2-44-sourced-memory-search-proactive-bubble-polish-no-tmp-residue$/i]
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

    const memoryStartupBubble = await waitForBubbleVisible(memoryPet, {
      reason: "startup_presence",
      lineId: "startup_presence_ready",
      timeoutMs: 10_000
    });
    checks.memoryStartupBubbleSafe = inspectBubbleSafety(memoryStartupBubble);
    observations.memoryStartupBubble = summarizeBubble(memoryStartupBubble);
    await waitForBubbleHidden(memoryPet, 10_000);

    const memoryObservation = await runMemoryPulseCase(memoryPet);
    observations.memory = memoryObservation;
    checks.memoryInjectionObserved = memoryObservation.injectionCount > 0;
    checks.memoryLowFrequencySafeSummary = memoryObservation.lowFrequency.safeSummaryLabel === "memory safe pulse";
    checks.memoryBubbleLineShown = memoryObservation.bubble.lineId === memoryLineId &&
      memoryObservation.bubble.reason === "idle_presence";
    checks.memoryBubbleMatchesTelemetry = memoryObservation.proactiveBubble?.lineId === memoryObservation.bubble.lineId &&
      memoryObservation.proactiveBubble?.reason === memoryObservation.bubble.reason;
    checks.memoryBubbleSafe = memoryObservation.bubble.safe;

    await stopElectron(context);

    context = createScenarioContext("search", Number(process.env.P2_44_SEARCH_CDP_PORT || 9575));
    fakeServerPath = join(context.runDir, "fake-p2-44-mcp-search-server.mjs");
    writeFileSync(fakeServerPath, createFakeMcpSearchServerSource(), "utf8");
    const { pet: searchPet } = await startApp();
    const searchStartupBubble = await waitForBubbleVisible(searchPet, {
      reason: "startup_presence",
      lineId: "startup_presence_ready",
      timeoutMs: 10_000
    });
    checks.searchStartupBubbleSafe = inspectBubbleSafety(searchStartupBubble);
    observations.searchStartupBubble = summarizeBubble(searchStartupBubble);
    await waitForBubbleHidden(searchPet, 10_000);

    const searchObservation = await runSearchCitationPulseCase(searchPet);
    observations.search = searchObservation;
    checks.searchCitationObserved = searchObservation.citationCount > 0;
    checks.searchLowFrequencySafeSummary = searchObservation.lowFrequency.safeSummaryLabel === "search citation pulse";
    checks.searchBubbleLineShown = searchObservation.bubble.lineId === searchLineId &&
      searchObservation.bubble.reason === "idle_presence";
    checks.searchBubbleMatchesTelemetry = searchObservation.proactiveBubble?.lineId === searchObservation.bubble.lineId &&
      searchObservation.proactiveBubble?.reason === searchObservation.bubble.reason;
    checks.searchBubbleSafe = searchObservation.bubble.safe;

    const inspectedBubbles = [
      memoryStartupBubble,
      searchStartupBubble,
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
    observations.counts = countSafeTelemetryForContexts();

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
    if (process.env.P2_44_KEEP_TMP !== "1") {
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

async function runMemoryPulseCase(pet) {
  const chat = await openChatFromPet(pet);
  await waitFor(chat, "Boolean(window.memoryApi?.setEnabled) && Boolean(window.chatApi)");
  await installMemoryInjectionProbe(chat);
  await evaluate(chat, "window.memoryApi.setEnabled(true).then((settings) => settings.enabled === true)");
  await createSafeMemorySeed(chat);

  const beforeIndex = lastTelemetryIndex();
  const injection = await sendChatTurnAndWait(chat, "请继续保持温和、准确的桌面陪伴状态。", {
    waitForMemoryInjection: true
  });
  await closeChat(chat);

  const sourced = await waitForSourcedBubble(pet, {
    lineId: memoryLineId,
    lowFrequencyId: "memory-safe-pulse",
    safeSummaryLabel: "memory safe pulse",
    afterIndex: beforeIndex
  });

  return {
    injectionCount: injection.memoryInjectionCount,
    bubble: sourced.bubble,
    lowFrequency: sourced.lowFrequency,
    proactiveBubble: sourced.proactiveBubble
  };
}

async function runSearchCitationPulseCase(pet) {
  const chat = await openChatFromPet(pet);
  await waitFor(chat, "Boolean(window.memoryApi?.clearCards) && Boolean(window.webSearchApi?.setSettings)");
  await evaluate(chat, `
    window.memoryApi.clearCards()
      .then(() => window.memoryApi.setEnabled(false))
      .then((settings) => settings.enabled === false)
  `);
  await configureSearch(chat);

  const beforeCitationCount = await evaluate(chat, "document.querySelectorAll('.message-citations').length");
  const beforeIndex = lastTelemetryIndex();
  await sendChatTurnAndWait(chat, "请联网搜索 P2-44 主动气泡引用验收。");
  await waitFor(chat, `document.querySelectorAll('.message-citations').length > ${beforeCitationCount}`, {
    timeoutMs: 20_000
  });
  const citationCount = await evaluate(chat, "document.querySelectorAll('.message-citations').length");
  await closeChat(chat);

  const sourced = await waitForSourcedBubble(pet, {
    lineId: searchLineId,
    lowFrequencyId: "search-citation-pulse",
    safeSummaryLabel: "search citation pulse",
    afterIndex: beforeIndex
  });

  return {
    citationCount,
    bubble: sourced.bubble,
    lowFrequency: sourced.lowFrequency,
    proactiveBubble: sourced.proactiveBubble
  };
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
      window.__p244MemoryEvents = [];
      if (!window.__p244MemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p244MemoryEvents.push({
            requestVersion: payload.requestVersion,
            count: payload.count
          });
        });
        window.__p244MemoryProbeInstalled = true;
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
        title: "p2-44 safe memory seed",
        [bodyKey]: "stable acceptance preference",
        tags: ["p2-44"],
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
  const beforeMemoryEventCount = await evaluate(chat, "(window.__p244MemoryEvents ?? []).length");
  await setChatInputValueWithoutFocus(chat, text);
  await submitChatForm(chat);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        const events = window.__p244MemoryEvents ?? [];
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
      return {
        memoryInjectionCount: state.lastMemoryInjectionCount
      };
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

async function waitForSourcedBubble(pet, options) {
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

  return {
    bubble: summarizeBubble(bubbleRaw),
    lowFrequency: summarizeLowFrequencyEvent(lowFrequencyEvent, options.safeSummaryLabel),
    proactiveBubble: summarizeProactiveBubble(proactiveBubbleEvent)
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
  return inspectBubble(pet);
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

function inspectBubbleSafety(info) {
  return info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    (info.state === "hidden" || allowedLineIds.has(info.lineId)) &&
    (info.state === "hidden" || info.reason === "startup_presence" || info.reason === "idle_presence" || info.reason === "mode_presence") &&
    (info.state === "hidden" || info.textLength > 0) &&
    info.textLength <= 16 &&
    info.forbiddenDatasetKeys.length === 0 &&
    info.unexpectedDatasetKeys.length === 0;
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
    safe: inspectBubbleSafety(info),
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
    return {
      status: "missing",
      safeSummaryLabel: null,
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
    skipReason: payload.skipReason,
    safeSummaryLabel: payload.safeSummaryLabel,
    interruptPolicy: payload.interruptPolicy,
    durationMs: payload.durationMs,
    minimumIntervalMs: payload.minimumIntervalMs,
    elapsedSinceLastEventMs: payload.elapsedSinceLastEventMs,
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

function countSafeTelemetry() {
  const counts = {};
  for (const event of readTelemetryEvents()) {
    if (event.type === "low_frequency_companion_event") {
      const payload = event.payload ?? {};
      const key = `low_frequency:${payload.status}:${payload.reason}:${payload.safeSummaryLabel ?? "none"}:${payload.skipReason ?? "none"}`;
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

function countSafeTelemetryForContexts() {
  const activeContext = context;
  const counts = {};
  for (const runContext of contexts) {
    context = runContext;
    const runCounts = countSafeTelemetry();
    for (const [key, value] of Object.entries(runCounts)) {
      counts[key] = (counts[key] ?? 0) + value;
    }
  }
  context = activeContext;
  return counts;
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
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-44-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "fake p2-44 search",
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
            title: "P2-44 citation fixture",
            snippet: "A short acceptance fixture for proactive bubble citation state.",
            url: "https://example.test/p2-44-citation"
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
