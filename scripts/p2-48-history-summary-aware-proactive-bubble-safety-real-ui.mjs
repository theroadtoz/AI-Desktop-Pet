import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
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
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import {
  isSameOwnedProcessIdentity,
  isTaskkillFailureIdempotent,
  mergeOwnedProcessIdentities,
  parseOwnedProcessIdentities,
  selectInitialOwnedRootIdentity,
  summarizeOwnedProcessSurvivors
} from "./support/p2-83a-owned-process-identity.mjs";

const historyLineId = "idle_presence_history_summary";
const historyLowFrequencyId = "history-summary-pulse";
const expectedSafeSummaryLabel = "context compression pulse";
const seededConversationId = crypto.randomUUID();
const seededConversationTitle = "P2-48 seeded compressed context";
const ACTION_STABLE_MS = 350;
const RUNNER_TOTAL_TIMEOUT_MS = Math.min(
  240_000,
  Math.max(90_000, Number(process.env.P2_48_TOTAL_TIMEOUT_MS || 180_000))
);
const runnerAbortController = new AbortController();
const activeRunSteps = new Set();
let currentStage = "bootstrap";
let hasWrittenResult = false;
let cleanupComplete = false;
let ownedRootIdentity = null;
let ownedIdentities = [];
let ownedIdentityFile = null;
let processIdentityState = "not_started";
let cleanupDiagnostic = { survivorCount: 0, rootAlive: false, descendantAliveCount: 0 };

const context = createRealUiRunContext({
  runName: "p2-48-history-summary-aware-proactive-bubble-safety-real-ui",
  port: Number(process.env.P2_48_CDP_PORT || 9648),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS:
      process.env.P2_48_IDLE_INTERVAL_MS || "60000",
    AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS:
      process.env.P2_48_LOW_FREQUENCY_MINIMUM_INTERVAL_MS || "700",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND: "evening"
  },
  tmpResiduePatterns: [/^p2-48-history-summary-aware-proactive-bubble-safety-no-tmp-residue$/i]
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
  /sk-[A-Za-z0-9]/i,
  /\.env/i,
  /Provider request body|providerRequestBody|requestBody/i,
  /complete prompt|system prompt|["']prompt["']\s*:/i,
  /["'](?:providerMessages|messages)["']\s*:/i,
  /summary body|summary text|summary content|history summary/i,
  /userMessage|assistantMessage|messageText|bubbleText|textContent/i,
  /fact card|memory card|factCardBody|memoryCardBody/i,
  /memory title|memory content/i,
  /search content|search query|search result|["'](?:safeQuery|snippet|domain|url|title)["']\s*:/i,
  /https?:\/\/\S+/i,
  /raw MCP|rawMcp/i,
  /apiKey|Authorization/i,
  /motion path|motionPath|expressionName|partId|resourcePath/i,
  /\b[A-Za-z]:[\\/]/
];
const privacyRuleIds = [
  "event_identifier_key", "context_tag_key", "credential_value", "environment_file_value",
  "provider_request_payload", "prompt_payload", "message_collection_payload", "summary_payload",
  "message_text_payload", "memory_body_payload", "memory_summary_payload", "search_payload",
  "network_location_value", "raw_mcp_payload", "authorization_payload", "model_resource_payload",
  "local_path_value"
];
const forbiddenStructuredFieldRules = {
  prompt: "prompt_payload", providerMessages: "message_collection_payload", messages: "message_collection_payload",
  summaryBody: "summary_payload", summaryText: "summary_payload", summaryContent: "summary_payload",
  userMessage: "message_text_payload", assistantMessage: "message_text_payload", messageText: "message_text_payload",
  bubbleText: "message_text_payload", textContent: "message_text_payload", factCardBody: "memory_body_payload",
  memoryCardBody: "memory_body_payload", safeQuery: "search_payload", snippet: "search_payload",
  domain: "search_payload", url: "search_payload", title: "search_payload",
  providerRequestBody: "provider_request_payload", requestBody: "provider_request_payload",
  apiKey: "authorization_payload", apiKeyRef: "authorization_payload", Authorization: "authorization_payload",
  expressionName: "model_resource_payload", partId: "model_resource_payload",
  resourcePath: "model_resource_payload", motionPath: "model_resource_payload"
};
const forbiddenStructuredValuePatterns = [
  { ruleId: "credential_value", pattern: /sk-[A-Za-z0-9]/i },
  { ruleId: "environment_file_value", pattern: /\.env/i },
  { ruleId: "provider_request_payload", pattern: /Provider request body/i },
  { ruleId: "prompt_payload", pattern: /complete prompt|system prompt/i },
  { ruleId: "summary_payload", pattern: /summary body|summary text|summary content|history summary/i },
  { ruleId: "memory_body_payload", pattern: /fact card|memory card/i },
  { ruleId: "memory_summary_payload", pattern: /memory title|memory content/i },
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

const privateTexts = [
  "P2-48_RAW_USER_SENTINEL short context check",
  "P2-48_FINAL_USER_SENTINEL compressed context check",
  "sk-p248-secret-should-not-appear"
];

function prepareSeededHistory() {
  const historyDirectory = join(context.appDataDir, "history");
  mkdirSync(historyDirectory, { recursive: true });

  const now = Date.now();
  const messages = Array.from({ length: 12 }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const content = `P2-48_SEEDED_PRIVATE_SENTINEL_${String(index + 1).padStart(2, "0")}`;
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

async function main(signal) {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    log(context, "run_started safeSummaryOnly=true provider=fake compressed-context-bubble");
    setStage("startup_launch");
    const { pet } = await startApp(signal);

    setStage("startup_coordinator_readiness");
    const startupBubble = await waitForProductionStartupReadiness(signal, pet);
    checks.startupBubbleSafe = inspectBubbleSafety(startupBubble);

    setStage("chat_open");
    const chat = await openChatFromPet(signal, pet);
    setStage("short_context_send");
    const short = await sendMessage(signal, chat, privateTexts[0]);
    checks.shortContextObserved = short.contextBudget.compressed === false &&
      short.contextBudget.providerMessageCount === 1;

    setStage("history_select");
    const historyState = await selectSeededHistory(signal, chat);
    checks.historyPreviewSafe = historyState.previewClass.includes("status-box") &&
      /不会自动发送|较早消息/.test(historyState.preview) &&
      privateTexts.every((text) => !historyState.preview.includes(text)) &&
      !/providerMessages|prompt|requestVersion/.test(historyState.preview);

    setStage("history_continue");
    await continueSeededHistory(signal, chat);
    const beforeIndex = lastTelemetryIndex();
    setStage("compressed_context_send");
    const compressed = await sendMessage(signal, chat, privateTexts[1]);
    checks.compressedContextObserved = compressed.contextBudget.compressed === true &&
      compressed.contextBudget.summaryMessageCount === 1 &&
      compressed.contextBudget.summarizedMessageCount > 0 &&
      compressed.contextBudget.recentMessageCount <= 8;

    setStage("compressed_reply_action_settle");
    await waitForHighPriorityActionsSettled(signal, 12_000);
    const releaseIndex = lastTelemetryIndex();
    setStage("chat_close_release");
    await closeChat(signal, chat);
    setStage("history_candidate_action_first");
    const sourced = await waitForCompressedContextBubble(signal, {
      afterIndex: beforeIndex,
      releaseIndex
    });
    observations.bubble = sourced.bubble;
    observations.proactiveBubble = sourced.proactiveBubble;
    observations.coordinator = sourced.coordinator;

    checks.historyLowFrequencyDefinitionSafe = expectedSafeSummaryLabel === "context compression pulse";
    checks.historyCoordinatorSourceShown = sourced.coordinator.terminalStatus === "shown" &&
      sourced.coordinator.statuses.join(",") === "queued,attempted,shown";
    checks.unrelatedIdleBubbleDidNotConsumeLedger = countShownIdleCandidatesBetween(
      sourced.coordinator.afterIndex,
      sourced.coordinator.terminalIndex
    ) === 0;
    checks.historyBubbleLineShown = sourced.bubble.lineId === historyLineId &&
      sourced.bubble.reason === "source_presence";
    checks.historyBubbleMatchesTelemetry = sourced.proactiveBubble?.lineId === sourced.bubble.lineId &&
      sourced.proactiveBubble?.reason === sourced.bubble.reason;
    checks.historyCoordinatorActionFirst = sourced.coordinator.actionFirst;
    checks.historyBubbleSafe = sourced.bubble.safe;

    const inspectedBubbles = [
      startupBubble,
      sourced.bubble.raw
    ];
    checks.rendererDomDatasetNoForbiddenKeys = inspectedBubbles.every((bubble) =>
      bubble.forbiddenDatasetKeys.length === 0
    );
    checks.rendererDomDatasetSafeShape = inspectedBubbles.every((bubble) =>
      bubble.unexpectedDatasetKeys.length === 0 &&
      bubble.datasetKeys.every((key) => allowedDomDatasetKeys.has(key))
    );

    const residueBeforeCleanup = findScreenshotResidue(context)
      .filter((item) => !item.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;
    observations.contextBudget = compressed.contextBudget;
    observations.counts = countSafeTelemetry();

    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      providerFixture: "FakeProvider",
      durationMs: Date.now() - startedAt,
      checks,
      observations
    };
    const privacyScan = scanScenarioPrivacyArtifacts();
    checks.privacyOutputSafe = isSafeOutput(summary) && privacyScan.safe &&
      privateTexts.every((text) => !JSON.stringify(summary).includes(text));
    if (!checks.privacyOutputSafe) observations.privacyDiagnostic = privacyScan.diagnostic;
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
      errorName: error instanceof Error ? error.name : "Error",
      diagnostic: buildSafeDiagnostic(checks)
    });
    process.exitCode = 1;
  } finally {
    await settleRunSteps();
    try {
      await stopAndCleanupContext();
    } catch {
      process.exitCode = 1;
      const cleanupFailure = {
        ok: false,
        safeSummaryOnly: true,
        failureCategory: "cleanup_failed",
        diagnostic: buildSafeDiagnostic(checks)
      };
      if (hasWrittenResult) console.error(JSON.stringify(cleanupFailure));
      else writeResult(cleanupFailure);
    }
  }
}

async function startApp(signal) {
  prepareSeededHistory();
  const child = await runStep(signal, () => startElectron(context));
  try {
    const initialIdentities = captureOwnedProcessTree(child.pid, process.pid, "electron.exe");
    ownedRootIdentity = selectInitialOwnedRootIdentity({ pid: child.pid, identities: initialIdentities });
    if (!ownedRootIdentity) throw new Error("owned_root_identity_capture_failed");
    ownedIdentities = initialIdentities;
    ownedIdentityFile = writeOwnedProcessIdentityFile(ownedIdentities);
    processIdentityState = "captured";
  } catch (error) {
    processIdentityState = "capture_failed";
    throw error;
  }
  await runStep(signal, () => connectToElectron(context));
  const pet = await runStep(signal, () => waitForWindow(context, "renderer/pet/index.html"));
  await runStep(signal, () => waitFor(pet, "Boolean(window.petApi)"));
  await runStep(signal, () => waitFor(pet, "Boolean(document.querySelector('#proactive-speech-bubble'))"));
  return { pet };
}

async function openChatFromPet(signal, pet) {
  await runStep(signal, () => evaluate(pet, "window.petApi?.openChat()"));
  const chat = await runStep(signal, () => waitForWindow(context, "renderer/chat/index.html"));
  await runStep(signal, () => waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.chatApi?.onContextTransparency)"));
  await runStep(signal, () => installContextTransparencyProbe(chat));
  return chat;
}

async function waitForProductionStartupReadiness(signal, pet) {
  const firstFrame = await waitForTelemetry(signal, (event) => event.type === "first_frame", 20_000);
  if (!firstFrame) throw new Error("first_frame_timeout");
  const appearanceStarted = await waitForTelemetry(signal, (event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === "startup_first_visible_frame", 3_000);
  if (appearanceStarted) {
    const terminal = await waitForTelemetry(signal, (event) =>
      event.__index > appearanceStarted.__index &&
      (event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped") &&
      event.payload?.reason === "startup_first_visible_frame", 12_000);
    if (!terminal) throw new Error("startup_appearance_terminal_timeout");
  }
  const startupCandidate = await waitForCandidateTerminal(signal, {
    candidateId: "startup_daily",
    afterIndex: -1,
    timeoutMs: 20_000
  });
  if (startupCandidate?.payload?.status !== "shown") throw new Error("startup_candidate_not_shown");
  const bubble = await waitForBubbleVisible(signal, pet, {
    reason: "startup_presence",
    lineId: "startup_presence_ready",
    timeoutMs: 5_000
  });
  await waitForBubbleHidden(signal, pet, 10_000);
  return bubble;
}

async function installContextTransparencyProbe(chat) {
  await evaluate(chat, `
    (() => {
      window.__p248ContextTransparencyEvents = [];
      if (!window.__p248ContextProbeInstalled) {
        window.chatApi?.onContextTransparency((payload) => {
          const contextBudget = payload?.contextBudget ?? {};
          window.__p248ContextTransparencyEvents.push({
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
        window.__p248ContextProbeInstalled = true;
      }
      return true;
    })()
  `);
}

async function sendMessage(signal, chat, message) {
  const beforeCount = await runStep(signal, () => evaluate(chat, "window.__p248ContextTransparencyEvents?.length ?? 0"));
  await runStep(signal, () => typeText(chat, chatUiSelectors.chat.input, message));
  await runStep(signal, () => click(chat, chatUiSelectors.chat.send));
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const state = await runStep(signal, () => evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        const events = window.__p248ContextTransparencyEvents ?? [];
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
    `));
    const contextReady = state.eventCount > beforeCount && state.lastEvent?.contextBudget;
    const replySettled = !state.inputDisabled && state.replyCount > 0 && state.lastReplyLength > 0;
    if (contextReady && replySettled) {
      return state.lastEvent;
    }
    if (!state.inputDisabled && state.sessionState === "error") {
      throw new Error("chat_failed");
    }
    await runStep(signal, () => sleep(150));
  }

  throw new Error("chat_timeout");
}

async function selectSeededHistory(signal, chat) {
  await runStep(signal, () => openHistorySettings(chat));
  await runStep(signal, () => waitFor(chat, "document.querySelectorAll('.conversation-select').length > 0", {
    timeoutMs: 10_000
  }));
  await runStep(signal, () => evaluate(chat, `
    (() => {
      const button = [...document.querySelectorAll(".conversation-select")]
        .find((item) => item.textContent?.includes(${JSON.stringify(seededConversationTitle)}));
      if (!button) {
        throw new Error("Missing seeded conversation");
      }
      button.click();
    })()
  `));
  await runStep(signal, () => waitFor(chat, "document.querySelector('#settings-history-detail-page')?.hidden === false"));
  await runStep(signal, () => waitFor(chat, "Boolean(document.querySelector('#history-context-preview'))"));
  return runStep(signal, () => evaluate(chat, `
    (() => ({
      preview: document.querySelector("#history-context-preview")?.textContent ?? "",
      previewClass: document.querySelector("#history-context-preview")?.className ?? "",
      previewState: document.querySelector("#history-context-preview")?.dataset.state ?? ""
    }))()
  `));
}

async function continueSeededHistory(signal, chat) {
  await runStep(signal, () => evaluate(chat, `
    (() => {
      const button = document.querySelector("#history-detail .history-detail-actions button.button");
      if (!button) {
        throw new Error("Missing continue button");
      }
      button.click();
    })()
  `));
  await runStep(signal, () => waitFor(chat, "document.querySelector('#chat-page')?.hidden === false"));
}

async function closeChat(signal, chat) {
  await runStep(signal, () => chat.cdp.send("Page.close"));
  await runStep(signal, () => sleep(750));
}

async function waitForCompressedContextBubble(signal, { afterIndex, releaseIndex }) {
  const candidateTerminalEvent = await waitForCandidateTerminal(signal, {
    candidateId: "history_summary_safe",
    afterIndex,
    timeoutMs: 30_000
  });
  if (candidateTerminalEvent?.payload?.status !== "shown") throw new Error("history_candidate_not_shown");
  const bubbleRaw = await waitForBubbleVisible(signal, null, {
    reason: "source_presence",
    lineId: historyLineId,
    timeoutMs: 5_000
  });
  const proactiveBubbleEvent = await waitForProactiveBubble(signal, {
    status: "shown",
    lineId: historyLineId,
    afterIndex,
    timeoutMs: 2_500
  });

  return {
    bubble: summarizeBubble(bubbleRaw),
    proactiveBubble: summarizeProactiveBubble(proactiveBubbleEvent),
    coordinator: inspectCandidateActionFirst({ afterIndex, releaseIndex, candidateTerminalEvent })
  };
}

async function waitForBubbleVisible(signal, pet, options = {}) {
  const targetPet = pet ?? await runStep(signal, () => waitForWindow(context, "renderer/pet/index.html"));
  const reasonCheck = options.reason
    ? ` && bubble.dataset.reason === ${JSON.stringify(options.reason)}`
    : "";
  const lineCheck = options.lineId
    ? ` && bubble.dataset.lineId === ${JSON.stringify(options.lineId)}`
    : "";

  await runStep(signal, () => waitFor(targetPet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'visible'${reasonCheck}${lineCheck};
    })()
  `, { timeoutMs: options.timeoutMs ?? 10_000 }));
  return runStep(signal, () => inspectBubble(targetPet));
}

async function waitForBubbleHidden(signal, pet, timeoutMs) {
  await runStep(signal, () => waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'hidden' && (bubble.textContent ?? '').length === 0;
    })()
  `, { timeoutMs }));
  return runStep(signal, () => inspectBubble(pet));
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
    (info.state === "hidden" || info.reason === "startup_presence" || info.reason === "idle_presence" || info.reason === "mode_presence" || info.reason === "source_presence") &&
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

async function waitForCandidateTerminal(signal, { candidateId, afterIndex, timeoutMs }) {
  return waitForTelemetry(signal, (event) => (
    event.__index > afterIndex &&
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === candidateId &&
    ["shown", "skipped", "expired"].includes(event.payload?.status)
  ), timeoutMs);
}

async function waitForProactiveBubble(signal, { status, lineId, afterIndex, timeoutMs }) {
  return waitForTelemetry(signal, (event) => (
    event.__index > afterIndex &&
    event.type === "proactive_speech_bubble" &&
    event.payload?.status === status &&
    event.payload?.lineId === lineId
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

function inspectCandidateActionFirst({ afterIndex, releaseIndex, candidateTerminalEvent }) {
  const events = readTelemetryEvents().filter((event) => event.__index > afterIndex);
  const candidates = events.filter((event) =>
    event.type === "proactive_bubble_candidate" && event.payload?.candidateId === "history_summary_safe");
  const statusIndex = (status) => candidates.find((event) => event.payload?.status === status)?.__index ?? -1;
  const queuedIndex = statusIndex("queued");
  const attemptedIndex = statusIndex("attempted");
  const shownIndex = statusIndex("shown");
  const actionIndex = events.find((event) =>
    event.type === "pet_interaction_action_started" &&
    event.payload?.reason === "state_proactive_bubble_visible" &&
    event.__index > Math.max(attemptedIndex, releaseIndex) && event.__index < shownIndex)?.__index ?? -1;
  return {
    statuses: candidates.map((event) => event.payload?.status)
      .filter((status) => ["queued", "attempted", "shown", "skipped", "expired"].includes(status)),
    terminalStatus: candidateTerminalEvent?.payload?.status ?? "missing",
    afterIndex,
    terminalIndex: candidateTerminalEvent?.__index ?? -1,
    actionFirst: queuedIndex >= 0 && attemptedIndex > queuedIndex && actionIndex > attemptedIndex && shownIndex > actionIndex
  };
}

function countShownIdleCandidatesBetween(afterIndex, terminalIndex) {
  return readTelemetryEvents().filter((event) =>
    event.__index > afterIndex && event.__index < terminalIndex &&
    event.type === "proactive_bubble_candidate" &&
    event.payload?.candidateId === "idle_presence" &&
    event.payload?.status === "shown"
  ).length;
}

async function waitForHighPriorityActionsSettled(signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const activeReasons = new Set();
    for (const event of readTelemetryEvents()) {
      if (!["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(event.type)) continue;
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
    await runStep(signal, () => sleep(100));
  }
  throw new Error("action_terminal_timeout");
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

function scanScenarioPrivacyArtifacts() {
  const matches = [];
  const legacyText = sanitizeRunnerInfrastructurePaths(readPrivacyCheckText(context, [
    "progress.log", "electron.stdout.log", "electron.stderr.log"
  ]));
  const legacyMatches = inspectPrivacyText(redactKnownInternalRuntimeTelemetry(legacyText), "legacy_diagnostic");
  for (const artifact of collectScenarioPrivacyArtifacts()) {
    const sanitizedText = sanitizeRunnerInfrastructurePaths(artifact.text);
    if (artifact.source === "telemetry") {
      matches.push(...inspectTelemetryPrivacy(sanitizedText));
    } else if (artifact.source === "electron_stdout" || artifact.source === "electron_stderr") {
      matches.push(...inspectElectronOutputPrivacy(artifact.text, artifact.source));
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

function collectScenarioPrivacyArtifacts() {
  const artifacts = [];
  const logDirectory = join(context.appDataDir, "logs");
  if (existsSync(logDirectory)) {
    const telemetryText = readdirSync(logDirectory)
      .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
      .sort()
      .map((name) => readFileSync(join(logDirectory, name), "utf8"))
      .join("\n");
    artifacts.push({ source: "telemetry", text: telemetryText });
  }
  const stdoutPath = join(context.runDir, "electron.stdout.log");
  if (existsSync(stdoutPath)) artifacts.push({ source: "electron_stdout", text: readFileSync(stdoutPath, "utf8") });
  const stderrPath = join(context.runDir, "electron.stderr.log");
  if (existsSync(stderrPath)) artifacts.push({ source: "electron_stderr", text: readFileSync(stderrPath, "utf8") });
  return artifacts;
}

function inspectTelemetryPrivacy(text) {
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      inspectStructuredPrivacyValue(JSON.parse(line), "telemetry", matches);
    } catch {
      matches.push(...inspectPrivacyText(line, "telemetry_unparsed"));
    }
  }
  return matches;
}

function inspectStructuredPrivacyValue(value, source, matches) {
  if (typeof value === "string") {
    const inspectedValue = sanitizeRunnerInfrastructurePaths(value);
    for (const rule of forbiddenStructuredValuePatterns) {
      if (rule.pattern.test(inspectedValue)) matches.push({ source, ruleId: rule.ruleId, fieldClass: "string_value" });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectStructuredPrivacyValue(item, source, matches);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nestedValue] of Object.entries(value)) {
    const ruleId = forbiddenStructuredFieldRules[key];
    if (ruleId) matches.push({ source, ruleId, fieldClass: "structured_key" });
    inspectStructuredPrivacyValue(nestedValue, source, matches);
  }
}

function sanitizeRunnerInfrastructurePaths(text, runContext = context) {
  const ownedPaths = [
    { pathValue: runContext.runDir, allowDescendants: true },
    { pathValue: runContext.appDataDir, allowDescendants: true }
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
    const isFixedWarning = electronSecurityWarningBlock.every((line, offset) => lines[index + offset] === line);
    if (isFixedWarning) {
      index += electronSecurityWarningBlock.length;
      continue;
    }
    sanitized.push(lines[index]);
    index += 1;
  }
  return sanitized.join("\n");
}

function inspectElectronOutputPrivacy(text, source) {
  const sanitizedText = sanitizeRunnerInfrastructurePaths(text);
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

function setStage(stage) {
  currentStage = stage;
}

function buildSafeDiagnostic(checks) {
  const events = readTelemetryEvents();
  const survivors = safeProbeOwnedProcessIdentities();
  const candidateEvents = events.filter((event) =>
    event.type === "proactive_bubble_candidate" &&
    ["startup_daily", "history_summary_safe"].includes(event.payload?.candidateId));
  const lastSourceCandidate = candidateEvents
    .filter((event) => event.payload?.candidateId === "history_summary_safe")
    .at(-1);
  return {
    stage: currentStage,
    recentTelemetry: events.slice(-8).map(summarizeSafeTelemetry).filter(Boolean),
    startupStatuses: candidateEvents
      .filter((event) => event.payload?.candidateId === "startup_daily")
      .map((event) => normalizeCandidateStatus(event.payload?.status)),
    sourceStatuses: candidateEvents
      .filter((event) => event.payload?.candidateId === "history_summary_safe")
      .map((event) => normalizeCandidateStatus(event.payload?.status)),
    sourceSkipReason: normalizeSkipReason(lastSourceCandidate?.payload?.skipReason),
    processIdentity: {
      state: processIdentityState,
      ...summarizeOwnedProcessSurvivors(survivors)
    },
    completedChecksPassed: Object.values(checks).every(Boolean)
  };
}

function summarizeSafeTelemetry(event) {
  if (event.type === "first_frame") return { type: "first_frame" };
  if (event.type === "proactive_bubble_candidate") {
    return {
      type: "candidate",
      source: ["startup_daily", "history_summary_safe"].includes(event.payload?.candidateId)
        ? event.payload.candidateId
        : "other",
      status: normalizeCandidateStatus(event.payload?.status),
      skipReason: normalizeSkipReason(event.payload?.skipReason)
    };
  }
  if (["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(event.type)) {
    return {
      type: "action",
      lifecycle: event.type === "pet_interaction_action_started" ? "started" :
        event.type === "pet_interaction_action_finished" ? "finished" : "skipped",
      reason: [
        "startup_first_visible_frame", "state_proactive_bubble_visible",
        "chat_reply_waiting", "chat_reply_completed"
      ].includes(event.payload?.reason)
        ? event.payload.reason
        : "other",
      skipReason: normalizeActionSkipReason(event.payload?.skipReason)
    };
  }
  if (event.type === "proactive_speech_bubble") {
    return {
      type: "bubble",
      status: ["shown", "hidden", "skipped"].includes(event.payload?.status) ? event.payload.status : "other",
      reason: ["startup_presence", "source_presence"].includes(event.payload?.reason) ? event.payload.reason : "other",
      line: ["startup_presence_ready", historyLineId].includes(event.payload?.lineId) ? event.payload.lineId : "other"
    };
  }
  if (event.type === "low_frequency_companion_event") {
    return {
      type: "low_frequency",
      source: event.payload?.eventId === historyLowFrequencyId ? "history_summary_safe" : "other",
      status: ["shown", "skipped"].includes(event.payload?.status) ? event.payload.status : "other",
      skipReason: normalizeSkipReason(event.payload?.skipReason)
    };
  }
  return null;
}

function normalizeCandidateStatus(value) {
  return ["queued", "attempted", "shown", "skipped", "expired"].includes(value) ? value : "missing";
}

function normalizeSkipReason(value) {
  return [
    "action_handshake_timeout", "action_request_rejected", "action_skipped", "bubble_visible",
    "chat_interaction_active", "chat_visible", "class_cooldown", "cleared", "daily_class_limit",
    "daily_total_limit", "engagement_blocked", "global_cooldown",
    "high_priority_action_active", "interruptibility_not_allowed", "model_busy", "pet_not_ready",
    "pet_window_missing", "proactive_bubbles_off", "line_cooldown", "same_class_attempt_in_progress",
    "source_disabled", "startup_daily_limit", "system_unavailable", "ttl_expired"
  ].includes(value) ? value : "none";
}

function normalizeActionSkipReason(value) {
  return [
    "active_action", "global_cooldown", "same_action_cooldown", "window_shake_feedback_cooldown"
  ].includes(value) ? value : "none";
}

async function runStep(signal, operation) {
  throwIfAborted(signal);
  const operationPromise = Promise.resolve().then(() => {
    throwIfAborted(signal);
    return operation();
  });
  activeRunSteps.add(operationPromise);
  operationPromise.finally(() => activeRunSteps.delete(operationPromise)).catch(() => {});
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("runner_total_timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    operationPromise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function settleRunSteps() {
  while (activeRunSteps.size > 0) await Promise.allSettled([...activeRunSteps]);
}

function throwIfAborted(signal) {
  if (signal.aborted) throw signal.reason ?? new Error("runner_total_timeout");
}

function captureOwnedProcessTree(rootPid, expectedParentPid, expectedRootName) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-capture-process-tree.ps1"),
    "-RootPid", String(rootPid),
    "-ExpectedParentPid", String(expectedParentPid),
    "-ExpectedRootName", expectedRootName
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.error || result.status !== 0) throw new Error("owned_process_tree_capture_failed");
  return parseOwnedProcessIdentities(JSON.parse(result.stdout));
}

function writeOwnedProcessIdentityFile(identities) {
  mkdirSync(context.runDir, { recursive: true });
  const path = join(context.runDir, "owned-process-identities.json");
  writeFileSync(path, `${JSON.stringify(identities)}\n`, "utf8");
  return path;
}

function probeOwnedProcessIdentities() {
  if (!ownedIdentityFile) return [];
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-probe-owned-process-identities.ps1"),
    "-IdentityFile", ownedIdentityFile
  ], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  if (result.error || result.status !== 0) throw new Error("owned_process_probe_failed");
  return parseOwnedProcessIdentities(JSON.parse(result.stdout));
}

function safeProbeOwnedProcessIdentities() {
  try {
    return probeOwnedProcessIdentities();
  } catch {
    return [];
  }
}

function waitForOwnedProcessTreeExit(timeoutMilliseconds, throwOnTimeout) {
  if (!ownedIdentityFile) return true;
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", join(process.cwd(), "scripts", "p2-83a-wait-owned-exit.ps1"),
    "-IdentityFile", ownedIdentityFile,
    "-TimeoutMilliseconds", String(timeoutMilliseconds)
  ], { windowsHide: true, encoding: "utf8", timeout: Math.max(10_000, timeoutMilliseconds + 2_000) });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (throwOnTimeout) throw new Error("owned_process_tree_exit_timeout");
  return false;
}

function killOwnedElectronTree() {
  for (let round = 0; round < 3; round += 1) {
    const survivors = probeOwnedProcessIdentities();
    if (survivors.length === 0) break;
    const ordered = [...survivors].sort((left, right) => Number(left.role === "root") - Number(right.role === "root"));
    for (const identity of ordered) {
      const stillMatching = probeOwnedProcessIdentities().some((current) => isSameOwnedProcessIdentity(identity, current));
      if (!stillMatching) continue;
      const result = spawnSync("taskkill.exe", ["/PID", String(identity.pid), "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 10_000
      });
      if (result.error) throw result.error;
      if (result.status !== 0 && !isTaskkillFailureIdempotent(identity, probeOwnedProcessIdentities())) {
        throw new Error("owned_process_kill_failed");
      }
    }
    if (waitForOwnedProcessTreeExit(350, false)) break;
  }
  const survivors = probeOwnedProcessIdentities();
  cleanupDiagnostic = summarizeOwnedProcessSurvivors(survivors);
  if (survivors.length > 0) throw new Error("owned_process_kill_failed");
}

function closeContextConnections() {
  const seen = new Set();
  for (const page of context.pages ?? []) {
    if (!page?.cdp || seen.has(page.cdp)) continue;
    seen.add(page.cdp);
    page.cdp.close();
  }
  context.pages = [];
}

async function stopAndCleanupContext() {
  if (cleanupComplete) return;
  const ownedChild = context.child;
  setStage("cleanup_connection_close");
  closeContextConnections();
  if (ownedRootIdentity && ownedIdentityFile) {
    setStage("cleanup_identity_validate");
    const currentRoot = probeOwnedProcessIdentities().find((identity) => identity.role === "root");
    if (isSameOwnedProcessIdentity(ownedRootIdentity, currentRoot)) {
      processIdentityState = "validated";
      const captured = captureOwnedProcessTree(ownedRootIdentity.pid, process.pid, "electron.exe");
      const capturedRoot = captured.find((identity) => identity.role === "root");
      if (!isSameOwnedProcessIdentity(ownedRootIdentity, capturedRoot)) {
        processIdentityState = "mismatch";
        throw new Error("owned_root_identity_changed");
      }
      ownedIdentities = mergeOwnedProcessIdentities(ownedIdentities, captured);
      ownedIdentityFile = writeOwnedProcessIdentityFile(ownedIdentities);
      setStage("cleanup_owned_process_kill");
      killOwnedElectronTree();
      waitForOwnedProcessTreeExit(8_000, true);
      processIdentityState = "exited";
    } else {
      processIdentityState = currentRoot ? "mismatch" : "already_exited";
    }
  }
  if (!ownedRootIdentity && ownedChild?.exitCode === null) ownedChild.kill();
  context.child = null;
  for (const stream of [ownedChild?.stdout, ownedChild?.stderr]) stream?.destroy();
  setStage("cleanup_user_data");
  if (process.env.P2_48_KEEP_TMP !== "1") cleanupRealUiRun(context);
  cleanupComplete = true;
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
  const timeout = setTimeout(() => {
    runnerAbortController.abort(new Error("runner_total_timeout"));
  }, RUNNER_TOTAL_TIMEOUT_MS);
  timeout.unref?.();
  try {
    await main(runnerAbortController.signal);
  } finally {
    clearTimeout(timeout);
  }
}

await runWithHardTimeout();
