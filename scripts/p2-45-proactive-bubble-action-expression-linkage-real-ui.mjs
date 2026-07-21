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
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const memoryLineId = "idle_presence_memory_safe";
const searchLineId = "idle_presence_search_citation";
const ACTION_STABLE_MS = 350;
const RUNNER_TOTAL_TIMEOUT_MS = 180_000;

const contexts = [];
const cleanedContexts = new Set();
let context = createScenarioContext("memory", Number(process.env.P2_45_MEMORY_CDP_PORT || process.env.P2_45_CDP_PORT || 9584));
const bundledServerPath = join(context.root, "dist", "main", "services", "search", "baidu-search-mcp-server.js");
let bundledServerBackup = null;
let bundledFixtureInstalled = false;
let currentCaseId = "memory";
let currentStage = "memory_startup";
let runnerSignal = null;
let scenarioStartedAtMs = Date.now();

const allowedDomDatasetKeys = new Set(["lineId", "reason", "state"]);
const forbiddenDomDatasetKeys = new Set(["eventId", "timeBand", "safeContextTag", "contextTag"]);

const forbiddenOutputPatterns = [
  /\beventId\b/i,
  /safeContextTag|contextTag/i,
  /sk-[A-Za-z0-9]/i,
  /\.env/i,
  /Provider request body|providerRequestBody|requestBody/i,
  /complete prompt|system prompt|["']prompt["']\s*:/i,
  /["'](?:providerMessages|messages)["']\s*:/i,
  /userMessage|assistantMessage|messageText|bubbleText|textContent/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /memory title|memory content|history summary/i,
  /search content|search query|search result|["'](?:safeQuery|snippet|domain|url|title)["']\s*:/i,
  /https?:\/\/\S+/i,
  /raw MCP|rawMcp/i,
  /apiKey|Authorization/i,
  /motion path|motionPath|expressionName|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];
const privacyRuleIds = [
  "event_identifier_key",
  "context_tag_key",
  "credential_value",
  "environment_file_value",
  "provider_request_payload",
  "prompt_payload",
  "message_collection_payload",
  "message_text_payload",
  "memory_body_payload",
  "memory_summary_payload",
  "search_payload",
  "network_location_value",
  "raw_mcp_payload",
  "authorization_payload",
  "model_resource_payload",
  "local_path_value"
];
const forbiddenStructuredFieldRules = {
  prompt: "prompt_payload",
  providerMessages: "message_collection_payload",
  messages: "message_collection_payload",
  userMessage: "message_text_payload",
  assistantMessage: "message_text_payload",
  messageText: "message_text_payload",
  bubbleText: "message_text_payload",
  textContent: "message_text_payload",
  factCardBody: "memory_body_payload",
  memoryCardBody: "memory_body_payload",
  safeQuery: "search_payload",
  snippet: "search_payload",
  domain: "search_payload",
  url: "search_payload",
  title: "search_payload",
  providerRequestBody: "provider_request_payload",
  requestBody: "provider_request_payload",
  apiKey: "authorization_payload",
  apiKeyRef: "authorization_payload",
  Authorization: "authorization_payload",
  expressionName: "model_resource_payload",
  partId: "model_resource_payload",
  resourcePath: "model_resource_payload",
  motionPath: "model_resource_payload"
};
const forbiddenStructuredValuePatterns = [
  { ruleId: "credential_value", pattern: /sk-[A-Za-z0-9]/i },
  { ruleId: "environment_file_value", pattern: /\.env/i },
  { ruleId: "provider_request_payload", pattern: /Provider request body/i },
  { ruleId: "prompt_payload", pattern: /complete prompt|system prompt/i },
  { ruleId: "memory_body_payload", pattern: /fact card|memory card/i },
  { ruleId: "memory_summary_payload", pattern: /memory title|memory content|history summary/i },
  { ruleId: "search_payload", pattern: /search content|search query|search result/i },
  { ruleId: "network_location_value", pattern: /https?:\/\/\S+/i },
  { ruleId: "raw_mcp_payload", pattern: /raw MCP/i },
  { ruleId: "authorization_payload", pattern: /Authorization/i },
  { ruleId: "model_resource_payload", pattern: /motion path/i },
  { ruleId: "local_path_value", pattern: /\b[A-Za-z]:[\\/]/ }
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

function createScenarioContext(caseId, port) {
  const nextContext = createRealUiRunContext({
    runName: `p2-45-proactive-bubble-action-expression-linkage-${caseId}-real-ui`,
    port,
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_45_IDLE_INTERVAL_MS || "60000",
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
    const memoryResult = await runIsolatedScenario("memory");
    const memoryObservation = memoryResult.observation;
    observations.memory = memoryObservation;
    Object.assign(checks, prefixChecks("memory", memoryResult.checks));
    await cleanupScenario(context);

    setDiagnosticStage("search", "search_startup");
    context = createScenarioContext("search", Number(process.env.P2_45_SEARCH_CDP_PORT || 9585));
    installBundledSearchFixture();
    const searchResult = await runIsolatedScenario("search");
    const searchObservation = searchResult.observation;
    observations.search = searchObservation;
    Object.assign(checks, prefixChecks("search", searchResult.checks));
    checks.noScreenshotResidue = memoryResult.noScreenshotResidue && searchResult.noScreenshotResidue;
    const resultPrivacyScan = inspectStructuredPrivacyValue({
      provider: "fake",
      providerFixture: "FakeProvider",
      environmentFixture: "safe-active",
      observations
    }, "result_payload");
    checks.privacyOutputSafe = memoryResult.privacyScan.safe &&
      searchResult.privacyScan.safe &&
      resultPrivacyScan.matches.length === 0;

    setDiagnosticStage("search", "complete");
    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      providerFixture: "FakeProvider",
      environmentFixture: "safe-active",
      durationMs: Date.now() - startedAt,
      diagnostic: buildSafeDiagnostic(checks),
      privacyDiagnostic: {
        memory: memoryResult.privacyScan.diagnostic,
        search: searchResult.privacyScan.diagnostic,
        result: toPrivacyDiagnostic(resultPrivacyScan)
      },
      checks,
      observations
    };
    summary.ok = Object.values(checks).every(Boolean);

    writeResult(summary);
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const diagnostic = buildSafeDiagnostic(checks);
    writeResult({
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      providerFixture: "FakeProvider",
      environmentFixture: "safe-active",
      durationMs: Date.now() - startedAt,
      failureCategory: classifyError(error),
      errorName: error instanceof Error ? error.name : "Error",
      diagnostic,
      checks: diagnostic.assertions
    });
    process.exitCode = 1;
  } finally {
    await cleanupScenariosAndRestore(contexts, cleanupScenario, restoreBundledSearchFixture);
  }
}

async function cleanupScenariosAndRestore(runContexts, cleanup, restore) {
  let firstCleanupError = null;
  try {
    for (const runContext of runContexts) {
      try {
        await cleanup(runContext);
      } catch (error) {
        firstCleanupError ??= error;
      }
    }
    if (firstCleanupError) throw firstCleanupError;
  } finally {
    restore();
  }
}

async function runIsolatedScenario(caseId) {
  throwIfRunnerAborted();
  scenarioStartedAtMs = Date.now();
  setDiagnosticStage(caseId, `${caseId}_startup`);
  const { pet } = await startApp();
  throwIfRunnerAborted();
  await waitForProductionStartupReadiness(pet);
  await waitForHighPriorityActionsSettled(10_000);
  setDiagnosticStage(caseId, `${caseId}_prepare`);
  const observation = caseId === "memory"
    ? await runMemoryActionLinkageCase(pet)
    : await runSearchActionLinkageCase(pet);
  throwIfRunnerAborted();
  const checks = buildScenarioChecks(caseId, observation);
  assertNoScreenshotResidue(context);
  const noScreenshotResidue = findScreenshotResidue(context)
    .filter((item) => !item.includes(context.runParentDir)).length === 0;
  const privacyScan = scanScenarioPrivacyArtifacts(context);
  return { observation, checks, noScreenshotResidue, privacyScan };
}

async function waitForProductionStartupReadiness(pet) {
  const firstFrame = await waitForTelemetry((event) => event.type === "first_frame", 15_000);
  if (!firstFrame) throw new Error("first_frame_timeout");
  const appearanceStarted = await waitForTelemetry((event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === "startup_first_visible_frame", 3_000);
  if (appearanceStarted) {
    const appearanceTerminal = await waitForTelemetry((event) =>
      event.__index > appearanceStarted.__index &&
      (event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped") &&
      event.payload?.reason === "startup_first_visible_frame", 10_000);
    if (!appearanceTerminal) throw new Error("startup_appearance_terminal_timeout");
  }
  const startupCandidate = await waitForCandidateTerminal({
    candidateId: "startup_daily",
    afterIndex: -1,
    timeoutMs: 15_000
  });
  if (!startupCandidate) throw new Error("startup_candidate_timeout");
  if (startupCandidate.payload?.status === "shown") {
    await waitForBubbleVisible(pet, { reason: "startup_presence", timeoutMs: 5_000 });
    await waitForBubbleHidden(pet, 10_000);
  }
}

function buildScenarioChecks(caseId, observation) {
  const expected = caseId === "memory"
    ? { lineId: memoryLineId, reason: "state_memory_injected", type: "quietNod", stateId: "memory-injected", expressionPresetId: "happy" }
    : { lineId: searchLineId, reason: "state_search_cited", type: "searchNoteSettle", stateId: "search-cited", expressionPresetId: "glasses" };
  const bubble = observation.bubble.raw;
  return {
    bubbleLineShown: observation.bubble.lineId === expected.lineId && observation.bubble.reason === "source_presence",
    coordinatorActionFirst: observation.coordinator.actionFirst,
    actionLinked: observation.action.reason === expected.reason &&
      observation.action.type === expected.type &&
      observation.action.stateId === expected.stateId &&
      observation.action.expressionPresetId === expected.expressionPresetId,
    actionTerminalObserved: observation.actionTerminal.terminalStatus === "finished",
    rendererDomDatasetNoForbiddenKeys: bubble.forbiddenDatasetKeys.length === 0,
    rendererDomDatasetSafeShape: bubble.unexpectedDatasetKeys.length === 0 &&
      bubble.datasetKeys.every((key) => allowedDomDatasetKeys.has(key))
  };
}

function prefixChecks(caseId, checks) {
  return Object.fromEntries(Object.entries(checks).map(([key, value]) => [
    `${caseId}${key[0].toUpperCase()}${key.slice(1)}`,
    value
  ]));
}

async function cleanupScenario(runContext) {
  if (cleanedContexts.has(runContext)) return;
  await stopElectron(runContext);
  if (process.env.P2_45_KEEP_TMP !== "1") cleanupRealUiRun(runContext);
  cleanedContexts.add(runContext);
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
  await waitForHighPriorityActionsSettled(10_000);
  await waitFor(chat, "Boolean(window.memoryApi?.setEnabled) && Boolean(window.chatApi)");
  await installMemoryInjectionProbe(chat);
  await evaluate(chat, "window.memoryApi.setEnabled(true).then((settings) => settings.enabled === true)");
  await createSafeMemorySeed(chat);
  await waitForHighPriorityActionsSettled(5_000);
  const sourceStartIndex = lastTelemetryIndex();
  setDiagnosticStage("memory", "memory_trigger");
  await sendChatTurnAndWait(chat, "请继续保持温和、准确的桌面陪伴状态。", {
    waitForMemoryInjection: true
  });
  setDiagnosticStage("memory", "memory_settle");
  await waitForHighPriorityActionsSettled(10_000);
  const releaseIndex = lastTelemetryIndex();
  setDiagnosticStage("memory", "memory_release");
  await closeChat(chat);
  setDiagnosticStage("memory", "memory_verify");
  return waitForSourcedActionLinkage(pet, {
    candidateId: "memory_safe",
    lineId: memoryLineId,
    expectedAction: {
      reason: "state_memory_injected",
      type: "quietNod",
      stateId: "memory-injected",
      expressionPresetId: "happy"
    },
    sourceStartIndex,
    releaseIndex
  });
}

async function runSearchActionLinkageCase(pet) {
  const chat = await openChatFromPet(pet);
  await waitForHighPriorityActionsSettled(10_000);
  await waitFor(chat, "Boolean(window.memoryApi?.clearCards) && Boolean(window.webSearchApi?.setSettings)");
  await evaluate(chat, `
    window.memoryApi.clearCards()
      .then(() => window.memoryApi.setEnabled(false))
      .then((settings) => settings.enabled === false)
  `);
  setDiagnosticStage("search", "search_profile");
  await configureSearch(chat);
  const beforeCitationCount = await evaluate(chat, "document.querySelectorAll('.message-citations').length");
  await waitForHighPriorityActionsSettled(5_000);
  const sourceStartIndex = lastTelemetryIndex();
  setDiagnosticStage("search", "search_trigger");
  await sendChatTurnAndWait(chat, "请联网搜索 P2-45 主动气泡动作联动验收。");
  await waitFor(chat, `document.querySelectorAll('.message-citations').length > ${beforeCitationCount}`, {
    timeoutMs: 20_000
  });
  setDiagnosticStage("search", "search_settle");
  await waitForHighPriorityActionsSettled(10_000);
  const releaseIndex = lastTelemetryIndex();
  setDiagnosticStage("search", "search_release");
  await closeChat(chat);
  setDiagnosticStage("search", "search_verify");
  return waitForSourcedActionLinkage(pet, {
    candidateId: "search_citation_safe",
    lineId: searchLineId,
    expectedAction: {
      reason: "state_search_cited",
      type: "searchNoteSettle",
      stateId: "search-cited",
      expressionPresetId: "glasses"
    },
    sourceStartIndex,
    releaseIndex
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
      command: "bundled-baidu-search",
      args: [],
      toolName: "search",
      timeoutMs: 5000,
      maxResults: 2
    }).then((settings) => settings.enabled === true && settings.toolName === "search")
  `);
  await waitFor(chat, "window.webSearchApi.getStatus().then((status) => status.enabled === true && status.commandName === 'bundled-baidu-search' && status.toolName === 'search')", {
    timeoutMs: 5_000
  });
}

function installBundledSearchFixture() {
  if (bundledFixtureInstalled) return;
  bundledServerBackup = readFileSync(bundledServerPath);
  writeFileSync(bundledServerPath, createBundledMcpSearchFixtureSource(), "utf8");
  bundledFixtureInstalled = true;
}

function restoreBundledSearchFixture() {
  if (!bundledFixtureInstalled || !bundledServerBackup) return;
  writeFileSync(bundledServerPath, bundledServerBackup);
  bundledFixtureInstalled = false;
  bundledServerBackup = null;
}

async function sendChatTurnAndWait(chat, text, options = {}) {
  const beforeReplyCount = await evaluate(chat, "document.querySelectorAll('.message-pet .message-content').length");
  const beforeMemoryEventCount = await evaluate(chat, "(window.__p245MemoryEvents ?? []).length");
  await setChatInputValueWithoutFocus(chat, text);
  await submitChatForm(chat);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    throwIfRunnerAborted();
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
  const candidateTerminalEvent = await waitForCandidateTerminal({
    candidateId: options.candidateId,
    afterIndex: options.sourceStartIndex,
    timeoutMs: 20_000
  });
  if (candidateTerminalEvent?.payload?.status !== "shown") {
    throw new Error("candidate_not_shown");
  }
  const bubbleRaw = await waitForBubbleVisible(pet, {
    reason: "source_presence",
    lineId: options.lineId,
    timeoutMs: 20_000
  });
  const proactiveBubbleEvent = await waitForProactiveBubble({
    status: "shown",
    lineId: options.lineId,
    afterIndex: options.releaseIndex,
    timeoutMs: 2_500
  });
  const actionEvent = await waitForPetActionStarted({
    ...options.expectedAction,
    afterIndex: options.releaseIndex,
    timeoutMs: 4_000
  });
  const actionTerminalEvent = await waitForPetActionTerminal({
    reason: options.expectedAction.reason,
    afterIndex: actionEvent?.__index ?? options.releaseIndex,
    timeoutMs: 8_000
  });

  return {
    bubble: summarizeBubble(bubbleRaw),
    coordinator: inspectCandidateActionFirst({
      candidateId: options.candidateId,
      afterIndex: options.sourceStartIndex,
      actionReason: options.expectedAction.reason,
      candidateTerminalEvent,
      actionTerminalEvent
    }),
    proactiveBubble: summarizeProactiveBubble(proactiveBubbleEvent),
    action: summarizePetAction(actionEvent),
    actionTerminal: summarizePetActionTerminal(actionTerminalEvent)
  };
}

async function waitForHighPriorityActionsSettled(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    throwIfRunnerAborted();
    const activeReasons = new Set();
    for (const event of readTelemetryEvents()) {
      if (!["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(event.type)) {
        continue;
      }
      const reason = event.payload?.reason;
      if (typeof reason !== "string") continue;
      if (event.type === "pet_interaction_action_started") activeReasons.add(reason);
      else activeReasons.delete(reason);
    }
    if (activeReasons.size === 0) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= ACTION_STABLE_MS) return;
    } else {
      stableSince = null;
    }
    await sleep(100);
  }
  throw new Error("action_terminal_timeout");
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

async function waitForCandidateTerminal({ candidateId, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === candidateId &&
    ["shown", "skipped", "expired"].includes(event.payload?.status)
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

async function waitForPetActionTerminal({ reason, afterIndex, timeoutMs }) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    (event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped") &&
    event.payload?.reason === reason
  ), timeoutMs);
}

async function waitForTelemetry(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfRunnerAborted();
    const event = readTelemetryEvents().find(predicate);
    if (event) {
      return event;
    }
    await sleep(150);
  }

  return null;
}

function inspectCandidateActionFirst({ candidateId, afterIndex, actionReason, candidateTerminalEvent, actionTerminalEvent }) {
  const events = readTelemetryEvents().filter((event) => event.__index > afterIndex);
  const candidateEvents = events.filter((event) =>
    event.type === "proactive_bubble_candidate" && event.payload?.candidateId === candidateId);
  const indexForStatus = (status) => candidateEvents.find((event) => event.payload?.status === status)?.__index ?? -1;
  const queuedIndex = indexForStatus("queued");
  const attemptedIndex = indexForStatus("attempted");
  const shownIndex = indexForStatus("shown");
  const actionIndex = events.find((event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === actionReason &&
    event.__index > attemptedIndex && event.__index < shownIndex)?.__index ?? -1;
  const actionTerminalIndex = actionTerminalEvent?.__index ?? -1;
  return {
    candidateId,
    statuses: candidateEvents.map((event) => event.payload?.status)
      .filter((status) => ["queued", "attempted", "shown", "skipped", "expired"].includes(status)),
    terminalStatus: candidateTerminalEvent?.payload?.status ?? "missing",
    actionFirst: queuedIndex >= 0 && attemptedIndex > queuedIndex &&
      actionIndex > attemptedIndex && shownIndex > actionIndex && actionTerminalIndex > shownIndex
  };
}

function setDiagnosticStage(caseId, stage) {
  currentCaseId = caseId;
  currentStage = stage;
}

function buildSafeDiagnostic(checks) {
  const candidateId = currentCaseId === "search" ? "search_citation_safe" : "memory_safe";
  const actionReason = currentCaseId === "search" ? "state_search_cited" : "state_memory_injected";
  const events = readTelemetryEvents();
  const firstFrameEvent = events.find((event) => event.type === "first_frame");
  const startupCandidateEvents = events.filter((event) =>
    event.type === "proactive_bubble_candidate" && event.payload?.candidateId === "startup_daily");
  const startupAppearanceEvents = events.filter((event) =>
    ["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(event.type) &&
    event.payload?.reason === "startup_first_visible_frame");
  const startupBubbleEvent = events.find((event) =>
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === "shown" &&
    event.payload?.reason === "startup_presence");
  const candidateEvents = events.filter((event) =>
    event.type === "proactive_bubble_candidate" && event.payload?.candidateId === candidateId);
  const actionEvents = events.filter((event) =>
    ["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(event.type) &&
    event.payload?.reason === actionReason);
  const bubbleEvents = events.filter((event) =>
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === "shown" &&
    event.payload?.reason === "source_presence");
  const lastCandidate = candidateEvents.at(-1);
  const lastAction = actionEvents.at(-1);
  const lastBubble = bubbleEvents.at(-1);
  const candidateStatus = normalizeCandidateStatus(lastCandidate?.payload?.status);
  const actionLifecycle = normalizeActionLifecycle(lastAction?.type);
  const terminalStatus = actionLifecycle === "finished" || actionLifecycle === "skipped"
    ? actionLifecycle
    : "none";
  const assertions = {
    candidateQueued: candidateEvents.some((event) => event.payload?.status === "queued"),
    candidateAttempted: candidateEvents.some((event) => event.payload?.status === "attempted"),
    actionStarted: actionEvents.some((event) => event.type === "pet_interaction_action_started"),
    actionTerminalObserved: actionEvents.some((event) =>
      event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped"),
    bubbleShown: Boolean(lastBubble),
    candidateShown: candidateEvents.some((event) => event.payload?.status === "shown"),
    candidateNotSkipped: !candidateEvents.some((event) =>
      event.payload?.status === "skipped" || event.payload?.status === "expired"),
    completedChecksPassed: Object.values(checks).every(Boolean)
  };
  const lastStartupCandidate = startupCandidateEvents.at(-1);
  const lastStartupAppearance = startupAppearanceEvents.at(-1);
  const firstFrameAtMs = parseTelemetryTimestamp(firstFrameEvent?.timestamp);
  const startupCandidateAtMs = parseTelemetryTimestamp(startupCandidateEvents[0]?.timestamp);
  return {
    stage: currentStage,
    caseId: currentCaseId,
    candidateStatus,
    skipReason: normalizeCandidateSkipReason(lastCandidate?.payload?.skipReason),
    actionLifecycle,
    terminalStatus,
    bubbleReason: normalizeBubbleReason(lastBubble?.payload?.reason),
    startupCandidateStatus: normalizeCandidateStatus(lastStartupCandidate?.payload?.status),
    startupSkipReason: normalizeCandidateSkipReason(lastStartupCandidate?.payload?.skipReason),
    startupAppearanceLifecycle: normalizeActionLifecycle(lastStartupAppearance?.type),
    startupTerminalStatus: ["finished", "skipped"].includes(normalizeActionLifecycle(lastStartupAppearance?.type))
      ? normalizeActionLifecycle(lastStartupAppearance?.type)
      : "none",
    startupBubbleReason: normalizeBubbleReason(startupBubbleEvent?.payload?.reason),
    startupReadiness: {
      firstFrameObserved: Boolean(firstFrameEvent),
      appearanceStarted: startupAppearanceEvents.some((event) => event.type === "pet_interaction_action_started"),
      appearanceTerminalObserved: startupAppearanceEvents.some((event) =>
        event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped"),
      startupCandidateQueued: startupCandidateEvents.some((event) => event.payload?.status === "queued"),
      startupCandidateTerminal: startupCandidateEvents.some((event) =>
        ["shown", "skipped", "expired"].includes(event.payload?.status)),
      startupBubbleShown: Boolean(startupBubbleEvent)
    },
    timing: {
      scenarioElapsedMs: Math.max(0, Math.min(RUNNER_TOTAL_TIMEOUT_MS, Date.now() - scenarioStartedAtMs)),
      firstFrameToCandidateMs: firstFrameAtMs !== null && startupCandidateAtMs !== null
        ? Math.max(0, Math.min(60_000, startupCandidateAtMs - firstFrameAtMs))
        : null
    },
    assertions
  };
}

function parseTelemetryTimestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCandidateStatus(value) {
  return ["queued", "attempted", "shown", "skipped", "expired"].includes(value) ? value : "missing";
}

function normalizeCandidateSkipReason(value) {
  return [
    "action_handshake_timeout",
    "action_request_rejected",
    "action_skipped",
    "bubble_show_failed",
    "bubble_visible",
    "chat_interaction_active",
    "chat_visible",
    "cleared",
    "engagement_blocked",
    "high_priority_action_active",
    "interruptibility_not_allowed",
    "model_busy",
    "pet_not_ready",
    "pet_window_missing",
    "proactive_bubbles_off",
    "same_class_attempt_in_progress",
    "source_disabled",
    "system_unavailable",
    "ttl_expired"
  ].includes(value) ? value : "none";
}

function normalizeActionLifecycle(value) {
  if (value === "pet_interaction_action_started") return "started";
  if (value === "pet_interaction_action_finished") return "finished";
  if (value === "pet_interaction_action_skipped") return "skipped";
  return "not_started";
}

function normalizeBubbleReason(value) {
  return ["source_presence", "startup_presence", "idle_presence", "mode_presence"].includes(value)
    ? value
    : "none";
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

function summarizePetActionTerminal(event) {
  if (!event) return { terminalStatus: "missing" };
  return {
    terminalStatus: event.type === "pet_interaction_action_finished" ? "finished" : "skipped",
    reason: event.payload?.reason,
    type: event.payload?.type,
    stateId: event.payload?.stateId
  };
}

function scanScenarioPrivacyArtifacts(runContext) {
  const matches = [];
  const legacyMatches = [];
  for (const artifact of collectScenarioPrivacyArtifacts(runContext)) {
    const sanitizedText = sanitizeRunnerInfrastructurePaths(artifact.text, runContext);
    legacyMatches.push(...inspectPrivacyText(
      artifact.source === "telemetry" ? redactKnownInternalRuntimeTelemetry(sanitizedText) : sanitizedText,
      artifact.source
    ));
    if (artifact.authoritative) {
      matches.push(...(artifact.source === "telemetry"
      ? inspectTelemetryPrivacy(sanitizedText, runContext)
        : inspectElectronOutputPrivacy(artifact.text, artifact.source, runContext)));
    }
  }
  const uniqueMatches = dedupePrivacyMatches(matches);
  return {
    safe: uniqueMatches.length === 0,
    diagnostic: {
      verificationSources: ["telemetry", "electron_stdout", "electron_stderr"],
      matches: uniqueMatches,
      legacyMatches: dedupePrivacyMatches(legacyMatches)
    }
  };
}

function collectScenarioPrivacyArtifacts(runContext) {
  const artifacts = [];
  const logDirectory = join(runContext.appDataDir, "logs");
  if (existsSync(logDirectory)) {
    const telemetryText = readdirSync(logDirectory)
      .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
      .sort()
      .map((name) => readFileSync(join(logDirectory, name), "utf8"))
      .join("\n");
    artifacts.push({ source: "telemetry", text: telemetryText, authoritative: true });
  }
  for (const [source, fileName, authoritative] of [
    ["runner_progress", "progress.log", false],
    ["electron_stdout", "electron.stdout.log", true],
    ["electron_stderr", "electron.stderr.log", true]
  ]) {
    const filePath = join(runContext.runDir, fileName);
    if (existsSync(filePath)) artifacts.push({ source, text: readFileSync(filePath, "utf8"), authoritative });
  }
  return artifacts;
}

function inspectTelemetryPrivacy(text, runContext) {
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      matches.push(...inspectStructuredPrivacyValue(event, "telemetry", [], runContext).matches);
    } catch {
      matches.push(...inspectPrivacyText(line, "telemetry_unparsed"));
    }
  }
  return matches;
}

function inspectStructuredPrivacyValue(value, source, matches = [], runContext = null) {
  if (typeof value === "string") {
    const inspectedValue = runContext ? sanitizeRunnerInfrastructurePaths(value, runContext) : value;
    for (const rule of forbiddenStructuredValuePatterns) {
      if (rule.pattern.test(inspectedValue)) matches.push({ source, ruleId: rule.ruleId, fieldClass: "string_value" });
    }
    return { matches };
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectStructuredPrivacyValue(item, source, matches, runContext);
    return { matches };
  }
  if (!value || typeof value !== "object") return { matches };
  for (const [key, nestedValue] of Object.entries(value)) {
    const ruleId = forbiddenStructuredFieldRules[key];
    if (ruleId) matches.push({ source, ruleId, fieldClass: "structured_key" });
    inspectStructuredPrivacyValue(nestedValue, source, matches, runContext);
  }
  return { matches };
}

function sanitizeElectronInfrastructureOutput(text) {
  const lines = text.split(/\r?\n/);
  const sanitized = [];
  for (let index = 0; index < lines.length;) {
    const isFixedSecurityWarning = electronSecurityWarningBlock.every(
      (line, offset) => lines[index + offset] === line
    );
    if (isFixedSecurityWarning) {
      index += electronSecurityWarningBlock.length;
      continue;
    }
    sanitized.push(lines[index]);
    index += 1;
  }
  return sanitized.join("\n");
}

function inspectElectronOutputPrivacy(text, source, runContext) {
  const sanitizedText = sanitizeRunnerInfrastructurePaths(text, runContext);
  return inspectPrivacyText(sanitizeElectronInfrastructureOutput(sanitizedText), source);
}

function inspectPrivacyText(text, source) {
  return forbiddenOutputPatterns.flatMap((pattern, index) => pattern.test(text)
    ? [{ source, ruleId: privacyRuleIds[index], fieldClass: "raw_text" }]
    : []);
}

function dedupePrivacyMatches(matches) {
  return [...new Map(matches.map((match) => [
    `${match.source}:${match.ruleId}:${match.fieldClass}`,
    match
  ])).values()];
}

function toPrivacyDiagnostic(scan) {
  return {
    verificationSources: ["result_payload"],
    matches: dedupePrivacyMatches(scan.matches),
    legacyMatches: []
  };
}

function sanitizeRunnerInfrastructurePaths(text, runContext) {
  const ownedPaths = [
    { pathValue: runContext.runDir, allowDescendants: true },
    { pathValue: runContext.appDataDir, allowDescendants: true },
    { pathValue: bundledServerPath, allowDescendants: false }
  ]
    .filter(({ pathValue }) => typeof pathValue === "string" && pathValue.length > 0)
    .sort((left, right) => right.pathValue.length - left.pathValue.length);

  return ownedPaths.reduce((safeText, ownedPath) => (
    replaceOwnedPathValue(safeText, ownedPath)
  ), text);
}

function replaceOwnedPathValue(text, { pathValue, allowDescendants }) {
  const lowerText = text.toLowerCase();
  const lowerPath = pathValue.toLowerCase();
  let cursor = 0;
  let result = "";

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerPath, cursor);
    if (index < 0) return result + text.slice(cursor);
    const before = index > 0 ? text[index - 1] : "";
    const afterIndex = index + pathValue.length;
    const after = afterIndex < text.length ? text[afterIndex] : "";
    const validEnd = isPathValueBoundary(after) || (allowDescendants && /[\\/]/.test(after));
    if (isPathValueBoundary(before) && validEnd) {
      result += text.slice(cursor, index) + "[runner-path]";
      cursor = afterIndex;
      continue;
    }
    result += text.slice(cursor, index + 1);
    cursor = index + 1;
  }
  return result;
}

function isPathValueBoundary(character) {
  return character === "" || !/[A-Za-z0-9_.~\\/:+-]/.test(character);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function createBundledMcpSearchFixtureSource() {
  return `
const { createInterface } = require("node:readline");

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
        name: "search",
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

function throwIfRunnerAborted() {
  if (runnerSignal?.aborted) {
    throw runnerSignal.reason ?? new Error("runner_total_timeout");
  }
}

async function runWithTotalTimeout() {
  const controller = new AbortController();
  runnerSignal = controller.signal;
  const timeout = setTimeout(() => controller.abort(new Error("runner_total_timeout")), RUNNER_TOTAL_TIMEOUT_MS);
  timeout.unref?.();
  try {
    await main();
  } finally {
    clearTimeout(timeout);
  }
}

await runWithTotalTimeout();
