import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
const RUNNER_TOTAL_TIMEOUT_MS = 180_000;
const contexts = [];
const cleanedContexts = new Set();
let context = createScenarioContext("off-cadence", Number(process.env.P2_46_OFF_CDP_PORT || process.env.P2_46_CDP_PORT || 9594));
const bundledServerPath = join(context.root, "dist", "main", "services", "search", "baidu-search-mcp-server.js");
let bundledServerBackup = null;
let bundledFixtureInstalled = false;
let currentStep = "bootstrap";
let runnerSignal = null;

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
    runName: `p2-46-proactive-bubble-frequency-user-control-${caseId}-real-ui`,
    port,
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_46_IDLE_INTERVAL_MS || "650",
      AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
        process.env.P2_46_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "700",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: "evening"
    },
    tmpResiduePatterns: [/^p2-46-proactive-bubble-frequency-user-control-no-tmp-residue$/i]
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
    observations.offCadence = await runOffCadenceCase();
    checks.offCadenceLoaded = observations.offCadence.settingsCadence === "off";
    checks.offStartupBubbleSuppressed = observations.offCadence.startupBubbleState === "hidden";
    checks.offStartupCandidateSuppressed = observations.offCadence.startupCandidateCount === 0;
    checks.offNoBubbleShown = observations.offCadence.shownBubbleCount === 0;
    checks.settingsUiVisible = observations.offCadence.settingsUiVisible;
    checks.quietCadenceSavedFromUi = observations.offCadence.savedCadence === "quiet";

    await cleanupScenario(context);

    context = createScenarioContext("source-disabled", Number(process.env.P2_46_SOURCE_CDP_PORT || 9595));
    installBundledSearchFixture();
    observations.sourceDisabled = await runSourceToggleCase();
    checks.runtimeOffClearsVisibleBubble = observations.sourceDisabled.runtimeOffBubbleState === "hidden";
    checks.runtimeOffClearsPendingCandidates = observations.sourceDisabled.runtimeOffOpenCandidateCount === 0;
    checks.runtimeOffShowsNothingAfterClear = observations.sourceDisabled.runtimeOffShownCountAfter === 0;
    checks.memoryStillWorks = observations.sourceDisabled.memoryInjectionCount > 0;
    checks.searchStillWorks = observations.sourceDisabled.citationCount > 0;
    checks.memorySourceBubbleSuppressed = observations.sourceDisabled.memoryCandidateEventCount === 0 &&
      observations.sourceDisabled.memorySourceShownCount === 0;
    checks.searchSourceBubbleSuppressed = observations.sourceDisabled.searchCandidateEventCount === 0 &&
      observations.sourceDisabled.searchSourceShownCount === 0;
    checks.rendererDomDatasetNoForbiddenKeys = observations.sourceDisabled.forbiddenDatasetKeys.length === 0;
    checks.rendererDomDatasetSafeShape = observations.sourceDisabled.unexpectedDatasetKeys.length === 0;

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
    const privacyScans = contexts.map((runContext) => scanScenarioPrivacyArtifacts(runContext));
    checks.privacyOutputSafe = isSafeOutput(summary) && privacyScans.every((scan) => scan.safe);
    if (!checks.privacyOutputSafe) {
      observations.privacyDiagnostic = privacyScans.map((scan) => scan.diagnostic);
    }
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
      failureStep: currentStep,
      errorName: error instanceof Error ? error.name : "Error",
      diagnostic: buildSafeDiagnostic(checks)
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

async function runOffCadenceCase() {
  currentStep = "off:write-settings";
  writeProactiveCompanionSettings(context, {
    cadence: "off",
    memorySourceBubbles: true,
    searchSourceBubbles: true
  });
  currentStep = "off:start-app";
  const { pet } = await startApp();
  currentStep = "off:wait-first-frame";
  await waitForFirstFrame(20_000);
  currentStep = "off:observe-suppression";
  const observationStartIndex = lastTelemetryIndex();
  await sleep(5_000);
  const bubble = await inspectBubble(pet);
  const startupCandidateCount = countCoordinatorCandidateEventsAfter(observationStartIndex, "startup_daily");
  const shownBubbleCount = countProactiveBubbleShownAfter(observationStartIndex);
  currentStep = "off:open-chat";
  const chat = await openChatFromPet(pet);
  currentStep = "off:wait-settings-api";
  await waitFor(chat, "Boolean(window.proactiveCompanionApi?.getSettings)");
  currentStep = "off:read-settings";
  const settingsCadence = await evaluate(chat, "window.proactiveCompanionApi.getSettings().then((settings) => settings.cadence)");
  currentStep = "off:save-quiet-ui";
  const uiResult = await saveQuietCadenceThroughSettingsUi(chat);

  return {
    settingsCadence,
    startupBubbleState: bubble.state,
    startupCandidateCount,
    shownBubbleCount,
    settingsUiVisible: uiResult.settingsUiVisible,
    savedCadence: uiResult.savedCadence,
    statusState: uiResult.statusState
  };
}

async function runSourceToggleCase() {
  currentStep = "source:start-app";
  const { pet } = await startApp();
  currentStep = "source:wait-production-startup";
  await waitForProductionStartupBubble(pet);
  currentStep = "source:disable-visible-bubble";
  const hiddenChat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(hiddenChat, "Boolean(window.proactiveCompanionApi?.setSettings)");
  const beforeRuntimeOffIndex = lastTelemetryIndex();
  await evaluate(hiddenChat, `
    window.proactiveCompanionApi.setSettings({
      cadence: "off",
      memorySourceBubbles: true,
      searchSourceBubbles: true
    }).then((settings) => settings.cadence === "off")
  `);
  await waitForBubbleHidden(pet, 5_000);
  const runtimeOffBubble = await inspectBubble(pet);
  await sleep(750);
  const runtimeOffOpenCandidateCount = countOpenCoordinatorCandidates();
  const runtimeOffShownCountAfter = countProactiveBubbleShownAfter(beforeRuntimeOffIndex);
  await evaluate(hiddenChat, `
    window.proactiveCompanionApi.setSettings({
      cadence: "normal",
      memorySourceBubbles: false,
      searchSourceBubbles: false
    }).then((settings) => settings.cadence === "normal")
  `);
  currentStep = "source:wait-startup-hidden";
  await waitForBubbleHidden(pet, 10_000);

  currentStep = "source:open-chat";
  const chat = await openChatFromPet(pet);
  currentStep = "source:wait-chat-apis";
  await waitFor(chat, "Boolean(window.proactiveCompanionApi?.setSettings) && Boolean(window.memoryApi?.setEnabled)");
  currentStep = "source:disable-source-bubbles";
  await evaluate(chat, `
    window.proactiveCompanionApi.setSettings({
      cadence: "normal",
      memorySourceBubbles: false,
      searchSourceBubbles: false
    }).then((settings) => settings.memorySourceBubbles === false && settings.searchSourceBubbles === false)
  `);
  currentStep = "source:install-memory-probe";
  await installMemoryInjectionProbe(chat);
  currentStep = "source:enable-memory";
  await evaluate(chat, "window.memoryApi.setEnabled(true).then((settings) => settings.enabled === true)");
  currentStep = "source:create-memory-seed";
  await createSafeMemorySeed(chat);
  const sourceStartIndex = lastTelemetryIndex();
  currentStep = "source:send-memory-chat";
  await sendChatTurnAndWait(chat, "请继续保持温和、准确的桌面陪伴状态。", {
    waitForMemoryInjection: true
  });
  const memoryInjectionCount = await evaluate(chat, "(window.__p246MemoryEvents ?? []).at(-1)?.count ?? 0");

  currentStep = "source:configure-search";
  await configureSearch(chat);
  const beforeCitationCount = await evaluate(chat, "document.querySelectorAll('.message-citations').length");
  currentStep = "source:send-search-chat";
  await sendChatTurnAndWait(chat, "请联网搜索 P2-46 主动气泡频率控制验收。");
  await waitFor(chat, `document.querySelectorAll('.message-citations').length > ${beforeCitationCount}`, {
    timeoutMs: 20_000
  });
  const citationCount = await evaluate(chat, "document.querySelectorAll('.message-citations').length");
  const beforeCloseIndex = lastTelemetryIndex();
  currentStep = "source:close-chat";
  await closeChat(chat);
  currentStep = "source:wait-no-source-bubbles";
  await sleep(6_500);

  const sourceCounts = countSourceShownEventsAfter(beforeCloseIndex);
  const memoryCandidateEventCount = countCoordinatorCandidateEventsAfter(sourceStartIndex, "memory_safe");
  const searchCandidateEventCount = countCoordinatorCandidateEventsAfter(sourceStartIndex, "search_citation_safe");
  const bubble = await inspectBubble(pet);
  return {
    runtimeOffBubbleState: runtimeOffBubble.state,
    runtimeOffOpenCandidateCount,
    runtimeOffShownCountAfter,
    memoryInjectionCount,
    citationCount,
    memorySourceShownCount: sourceCounts.memory,
    searchSourceShownCount: sourceCounts.search,
    memoryCandidateEventCount,
    searchCandidateEventCount,
    finalBubbleLineId: bubble.lineId === memoryLineId || bubble.lineId === searchLineId ? bubble.lineId : "",
    forbiddenDatasetKeys: bubble.forbiddenDatasetKeys,
    unexpectedDatasetKeys: bubble.unexpectedDatasetKeys
  };
}

async function saveQuietCadenceThroughSettingsUi(chat) {
  await evaluate(chat, "document.querySelector('#settings-button')?.click()");
  await waitFor(chat, "document.querySelector('#settings-panel')?.hidden === false");
  await waitFor(chat, "Boolean(document.querySelector('#proactive-cadence-controls [data-cadence=\"quiet\"]'))");
  await evaluate(chat, "document.querySelector('#proactive-cadence-controls [data-cadence=\"quiet\"]')?.click()");
  await evaluate(chat, "document.querySelector('#save-proactive-companion-settings-button')?.click()");
  await waitFor(chat, "window.proactiveCompanionApi.getSettings().then((settings) => settings.cadence === 'quiet')", {
    timeoutMs: 5_000
  });
  const result = await evaluate(chat, `
    Promise.resolve().then(async () => {
      const settings = await window.proactiveCompanionApi.getSettings();
      const status = document.querySelector('#proactive-companion-status');
      return {
        settingsUiVisible: Boolean(document.querySelector('#proactive-companion-settings-title')),
        savedCadence: settings.cadence,
        statusState: status?.dataset.state ?? ""
      };
    })
  `);
  return result;
}

async function startApp() {
  throwIfRunnerAborted();
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitFor(pet, "Boolean(document.querySelector('#proactive-speech-bubble'))");
  return { pet };
}

async function waitForFirstFrame(timeoutMs) {
  const event = await waitForTelemetry((candidate) => candidate.type === "first_frame", timeoutMs);
  if (!event) throw new Error("first_frame_timeout");
  return event;
}

async function waitForProductionStartupBubble(pet) {
  await waitForFirstFrame(20_000);
  const appearanceStarted = await waitForTelemetry((event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === "startup_first_visible_frame", 3_000);
  if (appearanceStarted) {
    const terminal = await waitForTelemetry((event) =>
      event.__index > appearanceStarted.__index &&
      (event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped") &&
      event.payload?.reason === "startup_first_visible_frame", 10_000);
    if (!terminal) throw new Error("startup_appearance_terminal_timeout");
  }
  const startupTerminal = await waitForTelemetry((event) =>
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === "startup_daily" &&
    ["shown", "skipped", "expired"].includes(event.payload?.status), 15_000);
  if (startupTerminal?.payload?.status !== "shown") throw new Error("startup_candidate_not_shown");
  return waitForBubbleVisible(pet, {
    reason: "startup_presence",
    lineId: "startup_presence_ready",
    timeoutMs: 5_000
  });
}

function writeProactiveCompanionSettings(runContext, settings) {
  const settingsPath = join(runContext.appDataDir, "config", "proactive-companion-settings.json");
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
      window.__p246MemoryEvents = [];
      if (!window.__p246MemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p246MemoryEvents.push({
            requestVersion: payload.requestVersion,
            count: payload.count
          });
        });
        window.__p246MemoryProbeInstalled = true;
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
        title: "p2-46 safe memory seed",
        [bodyKey]: "stable acceptance preference",
        tags: ["p2-46"],
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
  const beforeMemoryEventCount = await evaluate(chat, "(window.__p246MemoryEvents ?? []).length");
  await setChatInputValueWithoutFocus(chat, text);
  await submitChatForm(chat);
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        const events = window.__p246MemoryEvents ?? [];
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
      const dataset = { ...bubble.dataset };
      const allowedKeys = ["lineId", "reason", "state"];
      const forbiddenKeys = ["eventId", "timeBand", "safeContextTag", "contextTag"];
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        ariaHidden: bubble.getAttribute('aria-hidden'),
        datasetKeys: Object.keys(dataset).sort(),
        forbiddenDatasetKeys: Object.keys(dataset).filter((key) => forbiddenKeys.includes(key)).sort(),
        unexpectedDatasetKeys: Object.keys(dataset).filter((key) => !allowedKeys.includes(key)).sort()
      };
    })()
  `);
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

function countCoordinatorCandidateEventsAfter(afterIndex, candidateId) {
  return readTelemetryEvents().filter((event) =>
    event.__index > afterIndex &&
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === candidateId
  ).length;
}

function countProactiveBubbleShownAfter(afterIndex) {
  return readTelemetryEvents().filter((event) =>
    event.__index > afterIndex &&
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === "shown"
  ).length;
}

function countOpenCoordinatorCandidates() {
  const states = new Map();
  for (const event of readTelemetryEvents()) {
    if (event.type !== "proactive_bubble_candidate" || typeof event.payload?.candidateId !== "string") continue;
    states.set(event.payload.candidateId, event.payload.status);
  }
  return [...states.values()].filter((status) => status === "queued" || status === "attempted").length;
}

function countSourceShownEventsAfter(afterIndex) {
  const counts = { memory: 0, search: 0 };
  for (const event of readTelemetryEvents()) {
    if (event.__index <= afterIndex || event.type !== "low_frequency_companion_event") {
      continue;
    }
    if (event.payload?.status !== "shown") {
      continue;
    }
    if (event.payload?.eventId === "memory-safe-pulse") {
      counts.memory += 1;
    }
    if (event.payload?.eventId === "search-citation-pulse") {
      counts.search += 1;
    }
  }
  return counts;
}

function readScenarioPrivacyCheckText(files) {
  return contexts
    .map((runContext) => sanitizeElectronInfrastructureOutput(
      sanitizeRunnerInfrastructurePaths(readPrivacyCheckText(runContext, files), runContext)
    ))
    .join("\n");
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
    if (!artifact.authoritative) continue;
    matches.push(...(artifact.source === "telemetry"
      ? inspectTelemetryPrivacy(sanitizedText, runContext)
      : inspectElectronOutputPrivacy(artifact.text, artifact.source, runContext)));
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

function sanitizeRunnerInfrastructurePaths(text, runContext) {
  const ownedPaths = [
    { pathValue: runContext.runDir, allowDescendants: true },
    { pathValue: runContext.appDataDir, allowDescendants: true },
    { pathValue: bundledServerPath, allowDescendants: false }
  ]
    .filter(({ pathValue }) => typeof pathValue === "string" && pathValue.length > 0)
    .sort((left, right) => right.pathValue.length - left.pathValue.length);
  return ownedPaths.reduce((safeText, ownedPath) =>
    replaceOwnedPathValue(safeText, ownedPath), text);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function createBundledMcpSearchFixtureSource() {
  return `
const { createInterface } = require("node:readline");

const lineReader = createInterface({ input: process.stdin });
const queryKey = ["que", "ry"].join("");
const contentKey = ["con", "tent"].join("");

lineReader.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-46-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "search",
        description: "fake p2-46 search",
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
            title: "P2-46 citation fixture",
            snippet: "A short acceptance fixture for proactive bubble user control.",
            url: "https://example.test/p2-46-citation"
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

function buildSafeDiagnostic(checks) {
  const events = readTelemetryEvents();
  const summarizeCandidate = (candidateId) => events
    .filter((event) => event.type === "proactive_bubble_candidate" && event.payload?.candidateId === candidateId)
    .map((event) => event.payload?.status)
    .filter((status) => ["queued", "attempted", "shown", "skipped", "expired"].includes(status));
  const summarizeSkipReason = (candidateId) => {
    const reason = events.findLast((event) =>
      event.type === "proactive_bubble_candidate" &&
      event.payload?.candidateId === candidateId &&
      event.payload?.status === "skipped")?.payload?.skipReason;
    return [
      "engagement_blocked",
      "interruptibility_not_allowed",
      "system_unavailable",
      "cadence_off",
      "source_disabled",
      "cooldown_active",
      "active_action"
    ].includes(reason) ? reason : reason ? "other" : "none";
  };
  return {
    step: currentStep,
    startupStatuses: summarizeCandidate("startup_daily"),
    startupSkipReason: summarizeSkipReason("startup_daily"),
    memoryStatuses: summarizeCandidate("memory_safe"),
    searchStatuses: summarizeCandidate("search_citation_safe"),
    openCandidateCount: countOpenCoordinatorCandidates(),
    completedChecksPassed: Object.values(checks).every(Boolean)
  };
}

async function cleanupScenario(runContext) {
  if (cleanedContexts.has(runContext)) return;
  await stopElectron(runContext);
  if (process.env.P2_46_KEEP_TMP !== "1") cleanupRealUiRun(runContext);
  cleanedContexts.add(runContext);
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
  if (runnerSignal?.aborted) throw runnerSignal.reason ?? new Error("runner_total_timeout");
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
