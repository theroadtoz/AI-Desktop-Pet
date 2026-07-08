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
  setDialogueMode,
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";

const RUN_NAME = "p2-50-expression-preset-visual-qa-state-priority-real-ui";
const PROVIDER_SCENARIOS = ["fake", "local-openai-compatible"];
const runContexts = [];
let context = null;

const requiredCaseIds = new Set([
  "fake-default-think-dark",
  "fake-focus-think-presentation-only",
  "fake-focus-work-glasses",
  "fake-focus-read-glasses",
  "fake-focus-search-glasses",
  "fake-quiet-listen-presentation-only",
  "fake-sleep-state-presentation-only",
  "local-focus-local-model-busy-presentation-only"
]);

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /providerRequestBody/i,
  /factCardBody/i,
  /memoryContext\.cards/i,
  /rawSearchResult/i,
  /search query|safeQuery|snippet|domain|\burl\b|\btitle\b/i,
  /bubbleText|futureLlmText|messageText|textContent/i,
  /"messages"\s*:|messages\s*:/i,
  /"content"\s*:|content\s*:/i,
  /prompt/i,
  /apiKey|Authorization/i,
  /expressionName/i,
  /expressionPath/i,
  /motionPath/i,
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
    const fakeResult = await runFakeProviderPriorityScenario(cases, privateSeeds);
    const localResult = await runLocalBusyFocusGuardScenario(cases);

    telemetryEvents = [
      ...fakeResult.telemetryEvents,
      ...localResult.telemetryEvents
    ];
    unsafeTelemetryFields = [
      ...fakeResult.unsafeTelemetryFields,
      ...localResult.unsafeTelemetryFields
    ];

    checks.requiredCasesPassed = cases
      .filter((item) => item.required)
      .every((item) => item.status === "passed");
    checks.expressionPresetTelemetrySafe = cases.every((item) => expressionPresetMatchesExpectation(item));
    checks.fakeProviderStatePriorityObserved = fakeResult.defaultThinkObserved &&
      fakeResult.focusThinkObserved &&
      fakeResult.focusWorkObserved &&
      fakeResult.focusReadObserved &&
      fakeResult.focusSearchObserved &&
      fakeResult.quietListenObserved &&
      fakeResult.sleepStateObserved;
    checks.localBusyFocusGuardObserved = localResult.localBusyObserved;
    checks.telemetryPayloadAllowlist = unsafeTelemetryFields.length === 0;

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
      ok: false,
      safeSummaryOnly: true,
      providerFixture: "FakeProvider",
      providerScenarios: PROVIDER_SCENARIOS,
      visualQaClaim: "telemetry-only-no-screenshot",
      screenshotOutput: false,
      outputPathsPrinted: false,
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      unsafeTelemetryFieldCount: unsafeTelemetryFields.length,
      privateSeedCount: privateSeeds.length,
      counts: countActionStarts(telemetryEvents)
    };
    checks.privacyOutputSafe = isSafeSummary(summary, privateSeeds);
    summary.ok = Object.values(checks).every(Boolean);
    writeResult(summary);

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeResult({
      ok: false,
      safeSummaryOnly: true,
      providerFixture: "FakeProvider",
      providerScenarios: PROVIDER_SCENARIOS,
      visualQaClaim: "telemetry-only-no-screenshot",
      screenshotOutput: false,
      outputPathsPrinted: false,
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      failureCategory: classifyError(error),
      errorName: error instanceof Error ? error.name : "Error"
    });
    process.exitCode = 1;
  } finally {
    for (const item of runContexts) {
      await stopElectron(item);
    }
    if (process.env.P2_50_KEEP_TMP !== "1") {
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

async function runFakeProviderPriorityScenario(cases, privateSeeds) {
  context = createScenarioContext({
    port: Number(process.env.P2_50_CDP_PORT || 9650),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_50_IDLE_INTERVAL_MS || "60000"
    }
  });
  log(context, "scenario=fake-provider-expression-state-priority provider=FakeProvider");

  const fakeServerPath = join(context.runDir, "fake-mcp-search-server.mjs");
  const privateSearchSeed = `P250S${Date.now().toString(36)}`;
  const privateTitleSeed = `P250T${Date.now().toString(36)}`;
  const privateSnippetSeed = `P250N${Date.now().toString(36)}`;
  const privateUrlSeed = ["https", "://", `example.test/p2-50-${Date.now().toString(36)}`].join("");
  privateSeeds.push(privateSearchSeed, privateTitleSeed, privateSnippetSeed, privateUrlSeed);
  writeFileSync(fakeServerPath, createFakeMcpSearchServerSource({
    title: privateTitleSeed,
    snippet: privateSnippetSeed,
    url: privateUrlSeed
  }), "utf8");

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    const canvasSummary = await summarizeCanvasWithoutScreenshot(pet);
    await settleInteractionWindow(chat);

    const defaultThink = await runCase({
      caseId: "fake-default-think-dark",
      providerId: "fake",
      reason: "chat_reply_waiting",
      stateId: "think",
      actionType: "replyThinking",
      modeId: "default",
      presenceModeId: "default",
      expressionPresetId: "dark",
      timeoutMs: 8_000,
      trigger: () => sendChatTurn(chat, "p2-50 default think visual risk regression")
    });
    cases.push(defaultThink);
    await settleInteractionWindow(chat);

    await applyPresenceMode(chat, "focus");
    await settleInteractionWindow(chat);
    const focusThink = await runCase({
      caseId: "fake-focus-think-presentation-only",
      providerId: "fake",
      reason: "chat_reply_waiting",
      stateId: "think",
      actionType: "replyThinking",
      modeId: "default",
      presenceModeId: "focus",
      expressionPresetId: null,
      timeoutMs: 8_000,
      trigger: () => sendChatTurn(chat, "p2-50 focus think blocks visual check preset")
    });
    cases.push(focusThink);
    await settleInteractionWindow(chat);

    const focusWork = await runCase({
      caseId: "fake-focus-work-glasses",
      providerId: "fake",
      reason: "state_work",
      stateId: "work",
      actionType: "workFocus",
      modeId: "work",
      presenceModeId: "focus",
      expressionPresetId: "glasses",
      timeoutMs: 8_000,
      trigger: () => applyDialogueMode(chat, "work")
    });
    cases.push(focusWork);
    await settleInteractionWindow(chat);

    await applyDialogueMode(chat, "default");
    await settleModeResetWindow(chat);
    const focusRead = await runCase({
      caseId: "fake-focus-read-glasses",
      providerId: "fake",
      reason: "state_read",
      stateId: "read",
      actionType: "readingIdle",
      modeId: "reading",
      presenceModeId: "focus",
      expressionPresetId: "glasses",
      timeoutMs: 8_000,
      trigger: () => applyDialogueMode(chat, "reading")
    });
    cases.push(focusRead);
    await settleInteractionWindow(chat);

    await applyDialogueMode(chat, "default");
    await settleModeResetWindow(chat);
    await configureSearch(chat, {
      command: process.execPath,
      args: fakeServerPath,
      toolName: "web_search",
      timeoutMs: "5000",
      maxResults: "2",
      enabled: true
    });
    await closeSettingsPage(chat);
    await settleInteractionWindow(chat);
    const focusSearch = await runCase({
      caseId: "fake-focus-search-glasses",
      providerId: "fake",
      reason: "state_search_cited",
      stateId: "search-cited",
      actionType: "readingIdle",
      modeId: "default",
      presenceModeId: "focus",
      expressionPresetId: "glasses",
      timeoutMs: 15_000,
      trigger: () => sendChatTurn(chat, `请搜索 ${privateSearchSeed}`)
    });
    cases.push(focusSearch);
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
    await settleInteractionWindow(chat);

    await applyPresenceMode(chat, "quiet");
    await applyDialogueMode(chat, "default");
    await settleModeResetWindow(chat);
    const quietListen = await runCase({
      caseId: "fake-quiet-listen-presentation-only",
      providerId: "fake",
      reason: "chat_input_focus",
      stateId: "listen",
      actionType: "listen",
      modeId: "default",
      presenceModeId: "quiet",
      expressionPresetId: null,
      timeoutMs: 8_000,
      trigger: () => focusChatInput(chat)
    });
    cases.push(quietListen);
    await settleInteractionWindow(chat);

    const sleepState = await runCase({
      caseId: "fake-sleep-state-presentation-only",
      providerId: "fake",
      reason: "state_sleep",
      stateId: "sleep",
      actionType: "doze",
      modeId: "default",
      presenceModeId: "sleep",
      expressionPresetId: null,
      timeoutMs: 8_000,
      trigger: () => applyPresenceMode(chat, "sleep")
    });
    cases.push(sleepState);

    const telemetryEvents = readTelemetryEvents(context);
    return {
      telemetryEvents,
      unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents),
      canvasSummary,
      defaultThinkObserved: defaultThink.status === "passed",
      focusThinkObserved: focusThink.status === "passed",
      focusWorkObserved: focusWork.status === "passed",
      focusReadObserved: focusRead.status === "passed",
      focusSearchObserved: focusSearch.status === "passed",
      quietListenObserved: quietListen.status === "passed",
      sleepStateObserved: sleepState.status === "passed"
    };
  } finally {
    await stopElectron(context);
  }
}

async function runLocalBusyFocusGuardScenario(cases) {
  context = createScenarioContext({
    port: Number(process.env.P2_50_LOCAL_CDP_PORT || 9651),
    env: {
      AI_DESKTOP_PET_PROVIDER: "local-openai-compatible",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_BASE_URL: "http://127.0.0.1:9/v1",
      AI_DESKTOP_PET_MODEL: "p2-50-local-model-busy-focus-guard",
      AI_DESKTOP_PET_TIMEOUT_MS: "1000",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
        process.env.P2_50_IDLE_INTERVAL_MS || "60000"
    }
  });
  log(context, "scenario=local-model-busy-focus-guard");

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    await applyPresenceMode(chat, "focus");
    await settleInteractionWindow(chat);

    const localBusy = await runCase({
      caseId: "local-focus-local-model-busy-presentation-only",
      providerId: "local-openai-compatible",
      reason: "state_local_model_busy",
      stateId: "local-model-busy",
      actionType: "replyThinking",
      modeId: "default",
      presenceModeId: "focus",
      expressionPresetId: null,
      timeoutMs: 8_000,
      trigger: () => sendChatTurn(chat, "p2-50 local provider busy focus guard")
    });
    cases.push(localBusy);
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });

    const telemetryEvents = readTelemetryEvents(context);
    return {
      telemetryEvents,
      unsafeTelemetryFields: findUnsafeInteractionTelemetryFields(telemetryEvents),
      localBusyObserved: localBusy.status === "passed"
    };
  } finally {
    await stopElectron(context);
  }
}

function createScenarioContext({ port, env }) {
  const nextContext = createRealUiRunContext({
    runName: RUN_NAME,
    port,
    env,
    tmpResiduePatterns: [/^p2-50-expression-preset-visual-qa-state-priority-no-tmp-residue$/i]
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

async function applyDialogueMode(chat, modeId) {
  await setDialogueMode(chat, modeId);
  await closeSettingsPage(chat);
  await sleep(700);
}

async function applyPresenceMode(chat, modeId) {
  await setPresenceMode(chat, modeId);
  await closeSettingsPage(chat);
  await sleep(700);
}

async function sendChatTurn(chat, text) {
  await setChatInputValueWithoutFocus(chat, text);
  await click(chat, "#send-button");
  await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
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

async function focusChatInput(chat) {
  await closeSettingsPage(chat);
  await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
  await sleep(250);
  await evaluate(chat, "document.querySelector('#chat-input')?.focus()");
}

async function settleInteractionWindow(chat) {
  await closeSettingsPage(chat);
  await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
  await sleep(2_650);
}

async function settleModeResetWindow(chat) {
  await closeSettingsPage(chat);
  await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
  await sleep(4_200);
}

async function configureSearch(chat, settings) {
  await openAdvancedSettings(chat);
  await waitFor(chat, "document.querySelector('#web-search-status')?.innerText.length > 0");
  await setFieldValue(chat, "#web-search-command", settings.command);
  await setFieldValue(chat, "#web-search-args", settings.args);
  await setFieldValue(chat, "#web-search-tool-name", settings.toolName);
  await setFieldValue(chat, "#web-search-timeout", settings.timeoutMs);
  await setFieldValue(chat, "#web-search-max-results", settings.maxResults);
  await evaluate(chat, `
    (() => {
      const enabled = document.querySelector('#web-search-enabled');
      if (!enabled) throw new Error('Missing web search enabled checkbox');
      enabled.checked = ${settings.enabled ? "true" : "false"};
      enabled.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await click(chat, "#web-search-save-button");
  await waitFor(chat, "document.querySelector('#web-search-status')?.innerText.includes('已启用')", {
    timeoutMs: 5_000
  });
}

async function setFieldValue(page, selector, value) {
  await evaluate(page, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await sleep(120);
}

async function runCase(definition) {
  const afterIndex = lastTelemetryIndex(context);
  try {
    await definition.trigger();
  } catch {
    return buildCaseResult({
      ...definition,
      afterIndex,
      status: "failed",
      skipReason: "trigger-error"
    });
  }

  const event = await waitForAction({
    ...definition,
    afterIndex
  });

  return buildCaseResult({
    ...definition,
    afterIndex,
    event,
    status: event ? "passed" : "failed",
    skipReason: event ? undefined : "not-observed"
  });
}

async function waitForAction({
  actionType,
  reason,
  stateId,
  modeId,
  presenceModeId,
  expressionPresetId,
  afterIndex,
  timeoutMs
}) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason &&
    event.payload?.stateId === stateId &&
    event.payload?.modeId === modeId &&
    event.payload?.presenceModeId === presenceModeId &&
    expressionPresetMatchesEvent(event, expressionPresetId)
  ), timeoutMs);
}

function expressionPresetMatchesEvent(event, expressionPresetId) {
  return expressionPresetId === null
    ? event.payload?.expressionPresetId === undefined
    : event.payload?.expressionPresetId === expressionPresetId;
}

async function waitForTelemetry(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = readTelemetryEvents(context).find(predicate);
    if (event) {
      return event;
    }
    await sleep(150);
  }

  return null;
}

function readTelemetryEvents(targetContext) {
  const logDirectory = join(targetContext.appDataDir, "logs");
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

function lastTelemetryIndex(targetContext) {
  return readTelemetryEvents(targetContext).length - 1;
}

function buildCaseResult(definition) {
  const required = definition.required ?? requiredCaseIds.has(definition.caseId);
  const eventIndex = definition.event?.__index ?? null;

  return {
    caseId: definition.caseId,
    required,
    covered: definition.status === "passed",
    status: definition.status,
    ...(definition.skipReason ? { skipReason: definition.skipReason } : {}),
    expected: {
      providerId: definition.providerId,
      stateId: definition.stateId,
      reason: definition.reason,
      actionType: definition.actionType,
      modeId: definition.modeId,
      presenceModeId: definition.presenceModeId,
      expressionPresetId: definition.expressionPresetId
    },
    observed: summarizeAction(definition.event),
    telemetryWindow: {
      afterIndex: definition.afterIndex,
      eventIndex,
      eventAfterIndex: typeof eventIndex === "number" && eventIndex > definition.afterIndex
    }
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
    selectedActionType: payload.selectedActionType,
    candidateActionTypes: payload.candidateActionTypes,
    durationMs: payload.durationMs,
    skipReason: payload.skipReason
  };
  if (payload.expressionPresetId !== undefined) {
    summary.expressionPresetId = payload.expressionPresetId;
  }
  return summary;
}

function expressionPresetMatchesExpectation(item) {
  if (item.observed === null) {
    return false;
  }
  if (item.telemetryWindow.eventAfterIndex !== true) {
    return false;
  }

  return item.expected.expressionPresetId === null
    ? !Object.hasOwn(item.observed, "expressionPresetId")
    : item.observed.expressionPresetId === item.expected.expressionPresetId;
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

async function summarizeCanvasWithoutScreenshot(pet) {
  return evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) {
        return { status: "missing", nonZeroSize: false };
      }
      const rect = canvas.getBoundingClientRect();
      return {
        status: "layout-only",
        nonZeroSize: rect.width > 0 && rect.height > 0,
        widthBucket: rect.width > 300 ? "wide" : "narrow",
        heightBucket: rect.height > 300 ? "tall" : "short"
      };
    })()
  `);
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
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-50-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "fake p2-50 search",
        inputSchema: { type: "object", properties: { [queryKey]: { type: "string" }, limit: { type: "number" } }, required: [queryKey] }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
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
  if (runContexts[0]) {
    writeFileSync(runContexts[0].resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await main();
