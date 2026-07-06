import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
  closeSettingsPage,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  openAdvancedSettings,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";

const RUN_NAME = "p2-31e2-expression-state-future-safe-states-real-ui";
const PROVIDER_SCENARIOS = ["local-openai-compatible", "fake", "fake-search", "proactive-bubble"];
const runContexts = [];
let context = null;

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /providerRequestBody/i,
  /factCardBody/i,
  /memoryContext\.cards/i,
  /rawSearchResult/i,
  /bubbleText/i,
  /futureLlmText/i,
  /"messages"\s*:|messages\s*:/i,
  /"content"\s*:|content\s*:/i,
  /prompt/i,
  /apiKey/i,
  /expressionName/i,
  /expressionPath/i,
  /resourcePath/i,
  /partId/i,
  /\.motion3\.json/i,
  /\.exp3\.json/i,
  /\b[A-Za-z]:[\\/]/
];

const telemetryAllowedFields = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const cases = [];
  const privateSeeds = [];
  let telemetryEvents = [];
  let unsafeTelemetryFields = [];

  try {
    const localResult = await runLocalProviderBusyScenario(cases);
    const fakeMemoryResult = await runFakeProviderMemoryScenario(cases, privateSeeds);
    const fakeSearchResult = await runFakeProviderSearchCitationScenario(cases, privateSeeds);
    const proactiveResult = await runProactiveBubbleScenario(cases, privateSeeds);

    telemetryEvents = [
      ...localResult.telemetryEvents,
      ...fakeMemoryResult.telemetryEvents,
      ...fakeSearchResult.telemetryEvents,
      ...proactiveResult.telemetryEvents
    ];
    unsafeTelemetryFields = [
      ...localResult.unsafeTelemetryFields,
      ...fakeMemoryResult.unsafeTelemetryFields,
      ...fakeSearchResult.unsafeTelemetryFields,
      ...proactiveResult.unsafeTelemetryFields
    ];

    checks.telemetryPayloadAllowlist = unsafeTelemetryFields.length === 0;
    checks.requiredCasesPassed = cases.filter((item) => item.required).every((item) => item.status === "passed");
    checks.expressionPresetTelemetrySafe = cases.every((item) => expressionPresetMatchesExpectation(item));
    checks.localProviderDoesNotUseGenericWaitingReason = localResult.noGenericWaitingReason;
    checks.fakeProviderMemoryStatesObserved = fakeMemoryResult.memoryInjectedObserved && fakeMemoryResult.memorySkippedObserved;
    checks.fakeProviderSearchStateObserved = fakeSearchResult.searchCitedObserved;
    checks.proactiveBubbleStateObserved = proactiveResult.proactiveBubbleObserved;

    const privacyText = stripKnownInternalRuntimeTelemetry(runContexts
      .map((item) => readPrivacyCheckText(item, ["progress.log", "electron.stdout.log", "electron.stderr.log"]))
      .join("\n"));
    checks.noForbiddenText = !containsForbiddenOutput(privacyText, privateSeeds);

    for (const item of runContexts) {
      assertNoScreenshotResidue(item);
    }
    const residueBeforeCleanup = runContexts.flatMap((item) => (
      findScreenshotResidue(item).filter((path) => !path.includes(item.runParentDir))
    ));
    checks.noScreenshotResidueBeforeCleanup = residueBeforeCleanup.length === 0;

    const summary = {
      ok: Object.values(checks).every(Boolean),
      safeSummaryOnly: true,
      providerScenarios: PROVIDER_SCENARIOS,
      localModelChatQualityClaim: false,
      localProviderReachabilityRequired: false,
      memorySeedOutput: false,
      searchQueryOutput: false,
      searchCitationDetailOutput: false,
      proactiveBubbleBodyOutput: false,
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      unsafeTelemetryFieldCount: unsafeTelemetryFields.length,
      privateSeedCount: privateSeeds.length,
      counts: countActionStarts(telemetryEvents)
    };
    checks.safeSummaryHasNoForbiddenText = isSafeSummary(summary, privateSeeds);
    summary.ok = Object.values(checks).every(Boolean);
    writeResult(summary);

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeResult({
      ok: false,
      safeSummaryOnly: true,
      providerScenarios: PROVIDER_SCENARIOS,
      localModelChatQualityClaim: false,
      memorySeedOutput: false,
      searchQueryOutput: false,
      searchCitationDetailOutput: false,
      proactiveBubbleBodyOutput: false,
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      failureCategory: classifyError(error)
    });
    process.exitCode = 1;
  } finally {
    for (const item of runContexts) {
      await stopElectron(item);
    }
    if (process.env.P2_31E2_KEEP_TMP !== "1") {
      const cleaned = new Set();
      for (const item of runContexts) {
        if (cleaned.has(item.runParentDir)) {
          continue;
        }
        cleanupRealUiRun(item);
        cleaned.add(item.runParentDir);
      }
    }
  }
}

async function runLocalProviderBusyScenario(cases) {
  context = createScenarioContext({
    port: Number(process.env.P2_31E2_CDP_PORT || 9633),
    env: {
      AI_DESKTOP_PET_PROVIDER: "local-openai-compatible",
      AI_DESKTOP_PET_BASE_URL: "http://127.0.0.1:9/v1",
      AI_DESKTOP_PET_MODEL: "p2-31e2-local-model-busy",
      AI_DESKTOP_PET_TIMEOUT_MS: "1000",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31E2_IDLE_INTERVAL_MS || "60000"
    }
  });
  log(context, "scenario=local-provider-busy");

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    await sleep(4_000);

    const afterIndex = lastTelemetryIndex();
    await sendChatTurn(chat, "p2-31e2 local provider safe state check");

    const event = await waitForAction({
      actionType: "replyThinking",
      reason: "state_local_model_busy",
      stateId: "local-model-busy",
      expressionPresetId: "dark",
      afterIndex,
      timeoutMs: 8_000
    });

    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });

    cases.push(buildCaseResult({
      caseId: "local-provider-request-local-model-busy-dark",
      required: true,
      status: event ? "passed" : "failed",
      event,
      expected: {
        providerId: "local-openai-compatible",
        stateId: "local-model-busy",
        reason: "state_local_model_busy",
        actionType: "replyThinking",
        expressionPresetId: "dark"
      }
    }));

    const telemetryEvents = readTelemetryEvents();
    return {
      telemetryEvents,
      unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents),
      noGenericWaitingReason: telemetryEvents
        .filter((candidate) => candidate.__index > afterIndex)
        .every((candidate) => (
          candidate.type !== "pet_interaction_action_started" ||
          candidate.payload?.reason !== "chat_reply_waiting"
        ))
    };
  } finally {
    await stopElectron(context);
  }
}

async function runFakeProviderMemoryScenario(cases, privateSeeds) {
  context = createScenarioContext({
    port: Number(process.env.P2_31E2_MEMORY_CDP_PORT || 9634),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31E2_IDLE_INTERVAL_MS || "60000"
    }
  });
  log(context, "scenario=fake-provider-memory-safe-states");

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    await waitFor(chat, "Boolean(window.memoryApi?.setEnabled)");
    await evaluate(chat, "window.memoryApi.setEnabled(true).then((settings) => settings.enabled === true)");
    await waitFor(chat, "window.memoryApi.getSettings().then((settings) => settings.enabled === true)");
    const privateMemorySeed = `M${Date.now().toString(36)}`;
    privateSeeds.push(privateMemorySeed);
    await createPrivateMemorySeed(chat, privateMemorySeed);
    await sleep(4_000);

    const afterInjectedIndex = lastTelemetryIndex();
    await sendChatTurn(chat, "p2-31e2 memory injected state check");

    const injectedEvent = await waitForAction({
      actionType: "quietNod",
      reason: "state_memory_injected",
      stateId: "memory-injected",
      expressionPresetId: "happy",
      afterIndex: afterInjectedIndex,
      timeoutMs: 8_000
    });
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });

    cases.push(buildCaseResult({
      caseId: "fake-provider-memory-injected-happy",
      required: true,
      status: injectedEvent ? "passed" : "failed",
      event: injectedEvent,
      expected: {
        providerId: "fake",
        stateId: "memory-injected",
        reason: "state_memory_injected",
        actionType: "quietNod",
        expressionPresetId: "happy"
      }
    }));

    await sleep(2_200);
    const afterSkippedIndex = lastTelemetryIndex();
    const sensitiveSeed = ["sk", "-p231e2-", Date.now().toString(36)].join("");
    privateSeeds.push(sensitiveSeed);
    await sendChatTurn(chat, `我的 ${["API", "Key"].join(" ")} 是 ${sensitiveSeed}`);

    const skippedEvent = await waitForAction({
      actionType: "quietNod",
      reason: "state_memory_skipped",
      stateId: "memory-skipped",
      afterIndex: afterSkippedIndex,
      timeoutMs: 8_000
    });
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });

    cases.push(buildCaseResult({
      caseId: "fake-provider-memory-skipped-presentation-only",
      required: true,
      status: skippedEvent ? "passed" : "failed",
      event: skippedEvent,
      expected: {
        providerId: "fake",
        stateId: "memory-skipped",
        reason: "state_memory_skipped",
        actionType: "quietNod"
      }
    }));

    const telemetryEvents = readTelemetryEvents();
    return {
      telemetryEvents,
      unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents),
      memoryInjectedObserved: Boolean(injectedEvent),
      memorySkippedObserved: Boolean(skippedEvent)
    };
  } finally {
    await stopElectron(context);
  }
}

async function runFakeProviderSearchCitationScenario(cases, privateSeeds) {
  context = createScenarioContext({
    port: Number(process.env.P2_31E2_SEARCH_CDP_PORT || 9635),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31E2_IDLE_INTERVAL_MS || "60000"
    }
  });
  log(context, "scenario=fake-provider-search-cited-state");

  const fakeServerPath = join(context.runDir, "fake-mcp-search-server.mjs");
  const privateSearchSeed = `S${Date.now().toString(36)}`;
  const privateTitleSeed = `T${Date.now().toString(36)}`;
  const privateSnippetSeed = `N${Date.now().toString(36)}`;
  const privateUrlSeed = ["https", "://", `example.test/p2-31e2-${Date.now().toString(36)}`].join("");
  privateSeeds.push(privateSearchSeed, privateTitleSeed, privateSnippetSeed, privateUrlSeed);
  writeFileSync(fakeServerPath, createFakeMcpSearchServerSource({
    title: privateTitleSeed,
    snippet: privateSnippetSeed,
    url: privateUrlSeed
  }), "utf8");

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    await configureSearch(chat, {
      command: process.execPath,
      args: fakeServerPath,
      toolName: "web_search",
      timeoutMs: "5000",
      maxResults: "2",
      enabled: true
    });
    await closeSettingsPage(chat);
    await sleep(2_000);

    const afterIndex = lastTelemetryIndex();
    await sendChatTurn(chat, `请联网搜索 ${privateSearchSeed}`);

    const searchEvent = await waitForAction({
      actionType: "readingIdle",
      reason: "state_search_cited",
      stateId: "search-cited",
      expressionPresetId: "glasses",
      afterIndex,
      timeoutMs: 15_000
    });
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });

    cases.push(buildCaseResult({
      caseId: "fake-provider-search-cited-glasses",
      required: true,
      status: searchEvent ? "passed" : "failed",
      event: searchEvent,
      expected: {
        providerId: "fake",
        stateId: "search-cited",
        reason: "state_search_cited",
        actionType: "readingIdle",
        expressionPresetId: "glasses"
      }
    }));

    const telemetryEvents = readTelemetryEvents();
    return {
      telemetryEvents,
      unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents),
      searchCitedObserved: Boolean(searchEvent)
    };
  } finally {
    await stopElectron(context);
  }
}

async function runProactiveBubbleScenario(cases, privateSeeds) {
  context = createScenarioContext({
    port: Number(process.env.P2_31E2_PROACTIVE_CDP_PORT || 9636),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31E2_PROACTIVE_IDLE_INTERVAL_MS || "1200"
    }
  });
  log(context, "scenario=proactive-bubble-visible-state");
  privateSeeds.push(
    "我在这里，慢慢来。",
    "准备好了，陪你一会儿。",
    "我在旁边，陪你一会儿。",
    "需要时叫我就好。"
  );

  try {
    await startApp();
    const afterIndex = lastTelemetryIndex();
    const proactiveEvent = await waitForAction({
      actionType: "softSmile",
      reason: "state_proactive_bubble_visible",
      stateId: "proactive-bubble-visible",
      expressionPresetId: "happy",
      afterIndex,
      timeoutMs: 14_000
    });

    cases.push(buildCaseResult({
      caseId: "proactive-bubble-visible-happy",
      required: true,
      status: proactiveEvent ? "passed" : "failed",
      event: proactiveEvent,
      expected: {
        stateId: "proactive-bubble-visible",
        reason: "state_proactive_bubble_visible",
        actionType: "softSmile",
        expressionPresetId: "happy"
      }
    }));

    const telemetryEvents = readTelemetryEvents();
    return {
      telemetryEvents,
      unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents),
      proactiveBubbleObserved: Boolean(proactiveEvent)
    };
  } finally {
    await stopElectron(context);
  }
}

function createScenarioContext({ port, env }) {
  const nextContext = createRealUiRunContext({
    runName: RUN_NAME,
    port,
    env
  });
  runContexts.push(nextContext);
  return nextContext;
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await sleep(4_200);
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
  return chat;
}

async function sendChatTurn(chat, text) {
  await setChatInputValueWithoutFocus(chat, text);
  await click(chat, "#send-button");
}

async function createPrivateMemorySeed(chat, privateSeed) {
  await evaluate(chat, `
    window.memoryApi.createCard((() => {
      const bodyKey = ["con", "tent"].join("");
      return {
        title: "p2-31e2 safe memory seed",
        [bodyKey]: ${JSON.stringify(privateSeed)},
        tags: ["p2-31e2"],
        sourceConversationId: crypto.randomUUID()
      };
    })()).then((card) => Boolean(card?.id))
  `);
  await waitFor(chat, "window.memoryApi.getSummary().then((summary) => summary?.injectableCount > 0)");
}

async function configureSearch(chat, settings) {
  await openAdvancedSettings(chat);
  await waitFor(chat, "document.querySelector('#web-search-status')?.innerText.length > 0");
  await typeText(chat, "#web-search-command", settings.command);
  await typeText(chat, "#web-search-args", settings.args);
  await typeText(chat, "#web-search-tool-name", settings.toolName);
  await typeText(chat, "#web-search-timeout", settings.timeoutMs);
  await typeText(chat, "#web-search-max-results", settings.maxResults);
  await evaluate(chat, `
    (() => {
      const enabled = document.querySelector('#web-search-enabled');
      enabled.checked = ${settings.enabled ? "true" : "false"};
      enabled.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await click(chat, "#web-search-save-button");
  await waitFor(chat, "document.querySelector('#web-search-status')?.innerText.includes('已启用')", {
    timeoutMs: 5_000
  });
}

async function setChatInputValueWithoutFocus(chat, text) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      if (!input) throw new Error("Missing chat input");
      input.blur();
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await waitFor(chat, "document.querySelector('#send-button')?.disabled === false");
}

function createFakeMcpSearchServerSource({ title, snippet, url }) {
  return `
import { createInterface } from "node:readline";

const lineReader = createInterface({ input: process.stdin });
const queryKey = ["que", "ry"].join("");
const itemsKey = ["con", "tent"].join("");

lineReader.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-31e2-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "fake p2-31e2 search",
        inputSchema: { type: "object", properties: { [queryKey]: { type: "string" }, limit: { type: "number" } }, required: [queryKey] }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    respond(message.id, {
      [itemsKey]: [{
        type: "text",
        text: JSON.stringify({
          results: [{
            title: ${JSON.stringify(title)},
            snippet: ${JSON.stringify(snippet)},
            url: ${JSON.stringify(url)}
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
  expressionPresetId,
  timeoutMs,
  afterIndex = -1
}) {
  return waitForTelemetry((event) => {
    const expressionMatches = expressionPresetId === undefined
      ? event.payload?.expressionPresetId === undefined
      : event.payload?.expressionPresetId === expressionPresetId;

    return (
      event.__index > afterIndex &&
      event.type === "pet_interaction_action_started" &&
      event.payload?.type === actionType &&
      event.payload?.reason === reason &&
      event.payload?.stateId === stateId &&
      expressionMatches
    );
  }, timeoutMs);
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

function buildCaseResult({ caseId, required, status, event, expected }) {
  return {
    caseId,
    required,
    covered: status === "passed",
    status,
    expected,
    observed: summarizeAction(event)
  };
}

function summarizeAction(event) {
  if (!event) {
    return null;
  }

  const payload = event.payload ?? {};
  const summary = {
    eventType: event.type === "pet_interaction_action_started" ? "started" : event.type,
    type: payload.type,
    reason: payload.reason,
    stateId: payload.stateId,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    durationMs: payload.durationMs,
    skipReason: payload.skipReason
  };
  if (payload.expressionPresetId !== undefined) {
    summary.expressionPresetId = payload.expressionPresetId;
  }
  return summary;
}

function expressionPresetMatchesExpectation(item) {
  const expectedHasPreset = Object.hasOwn(item.expected, "expressionPresetId");
  const observedHasPreset = item.observed !== null && Object.hasOwn(item.observed, "expressionPresetId");
  return expectedHasPreset
    ? observedHasPreset && item.observed.expressionPresetId === item.expected.expressionPresetId
    : !observedHasPreset;
}

function findUnsafeInteractionTelemetryFields(events) {
  const unsafe = new Set();
  for (const event of events) {
    if (!String(event.type).startsWith("pet_interaction_action_") || !event.payload) {
      continue;
    }
    for (const key of Object.keys(event.payload)) {
      if (!telemetryAllowedFields.has(key)) {
        unsafe.add(key);
      }
    }
  }
  return [...unsafe].sort();
}

function countActionStarts(events) {
  const counts = {};
  for (const event of events) {
    if (event.type !== "pet_interaction_action_started") {
      continue;
    }
    const expression = event.payload?.expressionPresetId ?? "none";
    const key = `${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId ?? "none"}:${expression}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function isSafeSummary(value, privateSeeds) {
  return !containsForbiddenOutput(JSON.stringify(value), privateSeeds);
}

function containsForbiddenOutput(text, privateSeeds) {
  return [...forbiddenOutputPatterns, ...privateSeeds.map((seed) => new RegExp(escapeRegExp(seed), "i"))]
    .some((pattern) => pattern.test(text));
}

function stripKnownInternalRuntimeTelemetry(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !(line.includes('"type":"startup"') && line.includes('"userDataPath"')))
    .filter((line) => !(line.includes('"type":"provider_request_') && line.includes('"promptTemplateProfile"')))
    .join("\n");
}

function writeResult(summary) {
  if (context) {
    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await main();
