import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  openChatPage,
  openHistorySettings,
  openMemorySettings,
  readPrivacyCheckText,
  saveWelcomeProfile,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runName = "p2-30b-real-local-daily-companion-rhythm-real-ui";
const defaultPackRoot = join(root, ".tmp", "p2-23c-qwen25-15b-local-llm");
const packRoot = resolve(
  process.env.P2_30B_LOCAL_LLM_PACK_ROOT ||
  process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ||
  process.env.AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT ||
  defaultPackRoot
);
const port = readPositiveInteger(process.env.P2_30B_CDP_PORT) ?? 9631;
const providerTimeoutMs = readPositiveInteger(process.env.P2_30B_PROVIDER_TIMEOUT_MS) ?? 180_000;
const sendTimeoutMs = readPositiveInteger(process.env.P2_30B_SEND_TIMEOUT_MS) ?? 180_000;
const telemetryTimeoutMs = readPositiveInteger(process.env.P2_30B_TELEMETRY_TIMEOUT_MS) ?? 180_000;
const seededConversationId = crypto.randomUUID();
const seededConversationTitle = "P2-30B seeded long context";

const context = createRealUiRunContext({
  runName,
  port,
  env: {
    AI_DESKTOP_PET_PROVIDER: "",
    AI_DESKTOP_PET_API_KEY: "",
    AI_DESKTOP_PET_BASE_URL: "",
    AI_DESKTOP_PET_MODEL: "",
    AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: packRoot,
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_30_IDLE_INTERVAL_MS || "900"
  },
  tmpResiduePatterns: [
    new RegExp(`^${escapeRegExp(runName)}$`, "i")
  ]
});

const privateTexts = [
  "P2-30B_RAW_USER_SENTINEL",
  "P2-30B_SENSITIVE_SENTINEL",
  "P2-30B_LONG_HISTORY_SENTINEL",
  "sk-p230b-secret-should-not-appear"
];
const replySummaries = [];

main().catch((error) => {
  const summary = createSummary({
    ok: false,
    durationMs: 0,
    validation: null,
    providerStatus: null,
    telemetry: null,
    checks: {},
    observations: {},
    failureCategory: classifyError(error)
  });
  writeSafeSummary(summary);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  const checks = {};
  const observations = {};
  let validation = null;
  let providerStatus = null;
  let telemetry = null;
  let finalSummary = null;

  try {
    validation = validateLocalLlmPack(packRoot);
    if (!validation.ok) {
      finalSummary = createSummary({
        ok: false,
        durationMs: Date.now() - startedAt,
        validation,
        providerStatus,
        telemetry,
        checks: { localLlmPackReady: false },
        observations,
        status: "blocked",
        failureCategory: validation.status ?? "validator_nonzero"
      });
      writeSafeSummary(finalSummary);
      process.exitCode = 1;
      return;
    }

    log(context, "run_started safeSummaryOnly=true provider=embedded-local-llama-cpp");
    const { pet } = await startApp();

    const startupBubble = await waitForBubbleVisible(pet);
    observations.idleProactiveBubble = summarizeBubble(startupBubble);
    checks.idleProactiveRhythmSafe = startupBubble.state === "visible" &&
      ["startup_presence", "idle_presence"].includes(startupBubble.reason) &&
      startupBubble.textLength > 0 &&
      startupBubble.textLength <= 16;
    checks.proactiveBubbleStateObserved = readTelemetryEntries().some((event) =>
      (event.type === "pet_interaction_action_started" || event.type === "pet_interaction_action_skipped") &&
      event.payload?.reason === "state_proactive_bubble_visible" &&
      event.payload?.stateId === "proactive-bubble-visible"
    );

    const chat = await openChatFromPet(pet);
    telemetry = await waitForEmbeddedHandoffTelemetry(validation);
    providerStatus = await waitForEmbeddedProviderStatus(chat, telemetry.handoff);
    await openChatPage(chat);
    const hiddenBubble = await waitForBubbleHidden(pet);
    const chatOpenSnapshot = await safeUiSnapshot(chat);
    checks.chatOpenClearsAndListen = hiddenBubble.state === "hidden" &&
      chatOpenSnapshot.chatNoteClass.includes("selection-note") &&
      readTelemetryEntries().some((event) =>
        (event.type === "pet_interaction_action_started" || event.type === "pet_interaction_action_skipped") &&
        (event.payload?.reason === "chat_opened" || event.payload?.reason === "chat_input_focus") &&
        event.payload?.stateId === "listen"
      );

    const short = await sendMessage(chat, "短上下文节奏检查 P2-30B_RAW_USER_SENTINEL");
    checks.shortContextTransparentLowNoise = short.lastContext?.payload?.contextBudget?.compressed === false &&
      short.lastContext?.payload?.memory?.injectionCount === 0 &&
      short.lastContext?.payload?.webSearch?.included === false &&
      /她刚说完|她在想怎么说/.test(short.finalNote) &&
      !/当前短上下文|不需要安全摘要|没有带入联网搜索引用|requestVersion|providerMessages|P2-30B_RAW_USER_SENTINEL/.test(short.finalNote);

    await openMemorySettings(chat);
    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    await openChatPage(chat);
    const captured = await sendMessage(chat, "以后请叫我P230B小夏，记忆节奏检查");
    const injected = await sendMessage(chat, "继续检查 P2-30B 记忆注入节奏");
    await openMemorySettings(chat);
    const memorySnapshot = await safeUiSnapshot(chat);
    checks.memoryCaptureAndInjectionRhythm = captured.lastMemory?.payload?.autoCapture?.capturedCount > 0 &&
      /她刚整理了记忆|她带上了已允许的记忆/.test(captured.finalNote) &&
      injected.lastMemory?.payload?.injection?.count > 0 &&
      /她带上了已允许的记忆|长会话已收束/.test(injected.finalNote) &&
      /最近活动：/.test(memorySnapshot.memoryFeedback) &&
      !/capturedCount|injectionCount|P230B小夏/.test([captured.finalNote, injected.finalNote, memorySnapshot.memoryFeedback].join("\n"));

    await openChatPage(chat);
    const sensitive = await sendMessage(chat, "我的 API Key 是 sk-p230b-secret-should-not-appear P2-30B_SENSITIVE_SENTINEL");
    checks.sensitiveMemorySkipLowNoise = sensitive.lastMemory?.payload?.autoCapture?.skippedReason === "sensitive" &&
      sensitive.finalNote === "她跳过了敏感内容" &&
      !/sk-p230b|P2-30B_SENSITIVE_SENTINEL|skippedReason/.test(sensitive.finalNote);

    const historyState = await selectSeededHistory(chat);
    checks.historyLocalBoundaryKept = /不会自动发送|本机/.test(historyState.feedback + " " + historyState.preview) &&
      historyState.previewClass.includes("status-box") &&
      !/P2-30B_SEEDED_PRIVATE_SENTINEL/.test(historyState.preview);
    await continueSeededHistory(chat);
    const compressed = await sendMessage(chat, "继续历史上下文节奏检查 P2-30B_LONG_HISTORY_SENTINEL");
    checks.historyContinueCompressedRhythm = compressed.lastContext?.payload?.contextBudget?.compressed === true &&
      /长会话已收束，保留近期上下文/.test(compressed.finalNote) &&
      !/P2-30B_LONG_HISTORY_SENTINEL|P2-30B_SEEDED_PRIVATE_SENTINEL|providerMessages|originalMessageCount/.test(compressed.finalNote);

    const ui = await safeUiSnapshot(chat);
    checks.existingUiSystem = ui.statusBoxCount > 0 &&
      ui.selectionNoteCount > 0 &&
      ui.debugPanelCount === 0;
    checks.noDebugFieldsInUi = !/(requestVersion|providerMessages|originalMessageCount|capturedCount|skippedReason|safeQuery|snippet|prompt|API Key)/iu.test([
      short.finalNote,
      captured.finalNote,
      injected.finalNote,
      sensitive.finalNote,
      compressed.finalNote,
      memorySnapshot.memoryFeedback,
      historyState.preview,
      ui.chatNote
    ].join("\n"));

    const eventCounts = await evaluate(chat, `({
      context: window.__p230bContextTransparencyEvents?.length ?? 0,
      memory: window.__p230bMemoryActivityEvents?.length ?? 0
    })`);
    checks.contextAndMemoryEventsObserved = eventCounts.context >= 5 && eventCounts.memory >= 5;
    checks.realRepliesSafe = replySummaries.length >= 6 &&
      replySummaries.every((item) => item.replyLength > 0 && !item.thinkLeak && !item.privateLeak);

    telemetry = summarizeTelemetry(readTelemetryEntries());
    Object.assign(checks, createProviderChecks({ validation, providerStatus, telemetry, requiredReplyCount: replySummaries.length }));

    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

    finalSummary = createSummary({
      ok: Object.values(checks).every(Boolean),
      durationMs: Date.now() - startedAt,
      validation,
      providerStatus,
      telemetry,
      checks,
      observations: {
        ...observations,
        eventCounts,
        replySummaries,
        shortContext: sanitizeContext(short.lastContext?.payload),
        compressedContext: sanitizeContext(compressed.lastContext?.payload),
        memoryRhythm: {
          captured: sanitizeMemoryActivity(captured.lastMemory?.payload),
          injected: sanitizeMemoryActivity(injected.lastMemory?.payload),
          sensitive: sanitizeMemoryActivity(sensitive.lastMemory?.payload)
        },
        historyPreview: {
          className: historyState.previewClass,
          state: historyState.previewState,
          textLength: historyState.preview.length
        },
        residueBeforeCleanup: residueBeforeCleanup.length
      },
      failureCategory: firstFailedCheck(checks)
    });
    writeSafeSummary(finalSummary);

    if (!finalSummary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    telemetry = summarizeTelemetry(readTelemetryEntries());
    finalSummary = createSummary({
      ok: false,
      durationMs: Date.now() - startedAt,
      validation,
      providerStatus,
      telemetry,
      checks,
      observations,
      failureCategory: classifyError(error)
    });
    writeSafeSummary(finalSummary);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_30B_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
}

function prepareSeededHistory() {
  const historyDirectory = join(context.appDataDir, "history");
  mkdirSync(historyDirectory, { recursive: true });

  const now = Date.now();
  const messages = Array.from({ length: 12 }, (_, index) => {
    const content = `P2-30B_SEEDED_PRIVATE_SENTINEL_${String(index + 1).padStart(2, "0")}`;
    privateTexts.push(content);
    return {
      id: crypto.randomUUID(),
      role: index % 2 === 0 ? "user" : "assistant",
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

async function startApp() {
  prepareSeededHistory();
  startElectron(context);
  await connectToElectron(context, 45_000);
  const pet = await waitForWindow(context, "renderer/pet/index.html", 45_000);
  await waitFor(pet, "Boolean(window.petApi && document.querySelector('#proactive-speech-bubble'))", { timeoutMs: 30_000 });
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html", 45_000);
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.chatApi?.onMemoryActivity && window.chatApi?.onContextTransparency && window.configApi?.getProviderStatus)", {
    timeoutMs: 30_000
  });
  await saveWelcomeProfile(chat, { displayName: "P2-30B", preferredName: "P2-30B" });
  await installProbe(chat);
  return chat;
}

async function installProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p230bContextTransparencyEvents = [];
      window.__p230bMemoryActivityEvents = [];
      if (!window.__p230bRhythmProbeInstalled) {
        window.chatApi?.onContextTransparency((payload) => {
          window.__p230bContextTransparencyEvents.push({
            payload,
            note: document.querySelector("#chat-session-note")?.textContent ?? "",
            state: document.querySelector("#chat-session-note")?.dataset.state ?? ""
          });
        });
        window.chatApi?.onMemoryActivity((payload) => {
          window.__p230bMemoryActivityEvents.push({
            payload,
            note: document.querySelector("#chat-session-note")?.textContent ?? "",
            state: document.querySelector("#chat-session-note")?.dataset.state ?? ""
          });
        });
        window.__p230bRhythmProbeInstalled = true;
      }
    })()
  `);
}

async function waitForEmbeddedProviderStatus(page, handoff) {
  return waitFor(page, `
    window.configApi?.getProviderStatus().then((status) => {
      if (
        status?.providerId === "local-openai-compatible" &&
        status?.model === ${JSON.stringify(handoff.alias)} &&
        status?.baseURLHost === ${JSON.stringify(handoff.baseURLHost)} &&
        status?.isFallback === false
      ) {
        return {
          providerId: status.providerId,
          model: status.model,
          baseURLHost: status.baseURLHost,
          isFallback: status.isFallback
        };
      }
      return null;
    })
  `, { timeoutMs: providerTimeoutMs, intervalMs: 500 });
}

async function waitForEmbeddedHandoffTelemetry(validation) {
  const deadline = Date.now() + telemetryTimeoutMs;
  while (Date.now() < deadline) {
    const telemetry = summarizeTelemetry(readTelemetryEntries());
    const handoff = telemetry.handoff;
    const runtimeReady = telemetry.runtimeReady;

    if (
      runtimeReady?.status === "ready" &&
      handoff?.providerId === "local-openai-compatible" &&
      handoff?.localPresetId === "embedded-llama-cpp" &&
      handoff?.alias === validation.alias &&
      handoff?.baseURLHost &&
      !isKnownExternalHost(handoff.baseURLHost)
    ) {
      return telemetry;
    }

    await sleep(500);
  }

  throw new Error("embedded_handoff_timeout");
}

async function sendMessage(page, message) {
  const before = await evaluate(page, `({
    reply: document.querySelectorAll(".message-pet .message-content").length,
    context: window.__p230bContextTransparencyEvents?.length ?? 0,
    memory: window.__p230bMemoryActivityEvents?.length ?? 0
  })`);

  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + sendTimeoutMs;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const input = document.querySelector("#chat-input");
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        const lastReply = replies.at(-1)?.textContent?.trim() ?? "";
        const sessionNote = document.querySelector("#chat-session-note");
        const contextEvents = window.__p230bContextTransparencyEvents ?? [];
        const memoryEvents = window.__p230bMemoryActivityEvents ?? [];
        return {
          inputDisabled: Boolean(input?.disabled),
          replyCount: replies.length,
          lastReply,
          lastReplyLength: lastReply.length,
          sessionState: sessionNote?.dataset.state ?? "",
          contextCount: contextEvents.length,
          memoryCount: memoryEvents.length,
          lastContext: contextEvents.at(-1) ?? null,
          lastMemory: memoryEvents.at(-1) ?? null,
          finalNote: sessionNote?.textContent ?? "",
          finalNoteState: sessionNote?.dataset.state ?? ""
        };
      })()
    `);

    if (
      state.replyCount > before.reply &&
      state.lastReplyLength > 0 &&
      !state.inputDisabled &&
      state.contextCount > before.context &&
      state.memoryCount > before.memory
    ) {
      const privateLeak = privateTexts.some((text) => state.lastReply.includes(text)) ||
        /sk-p230b-secret-should-not-appear|Bearer\s+\S+|AI_DESKTOP_PET_API_KEY/i.test(state.lastReply);
      replySummaries.push({
        replyLength: state.lastReplyLength,
        thinkLeak: hasThinkLeak(state.lastReply),
        privateLeak
      });
      return {
        lastContext: state.lastContext,
        lastMemory: state.lastMemory,
        finalNote: state.finalNote,
        finalNoteState: state.finalNoteState,
        replyLength: state.lastReplyLength
      };
    }

    if (state.replyCount <= before.reply && !state.inputDisabled && state.sessionState === "error") {
      throw new Error("provider_chat_failed");
    }

    await sleep(300);
  }

  throw new Error("send_timeout");
}

async function inspectBubble(pet) {
  return evaluate(pet, `
    (() => {
      const bubble = document.querySelector("#proactive-speech-bubble");
      if (!bubble) throw new Error("Missing proactive speech bubble");
      const rect = bubble.getBoundingClientRect();
      const text = bubble.textContent ?? "";
      const style = getComputedStyle(bubble);
      return {
        state: bubble.dataset.state ?? "",
        lineId: bubble.dataset.lineId ?? "",
        reason: bubble.dataset.reason ?? "",
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute("aria-hidden"),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        style: {
          pointerEvents: style.pointerEvents,
          borderRadius: style.borderRadius,
          letterSpacing: style.letterSpacing
        }
      };
    })()
  `);
}

async function waitForBubbleVisible(pet, timeoutMs = 10_000) {
  await waitFor(pet, "document.querySelector('#proactive-speech-bubble')?.dataset.state === 'visible'", { timeoutMs });
  return inspectBubble(pet);
}

async function waitForBubbleHidden(pet, timeoutMs = 5_000) {
  await waitFor(pet, "document.querySelector('#proactive-speech-bubble')?.dataset.state === 'hidden'", { timeoutMs });
  return inspectBubble(pet);
}

async function selectSeededHistory(page) {
  await openHistorySettings(page);
  await waitFor(page, "document.querySelectorAll('.conversation-select').length > 0", { timeoutMs: 10_000 });
  await evaluate(page, `
    (() => {
      const button = [...document.querySelectorAll(".conversation-select")]
        .find((item) => item.textContent?.includes(${JSON.stringify(seededConversationTitle)}));
      if (!button) throw new Error("Missing seeded history conversation");
      button.click();
    })()
  `);
  await waitFor(page, "document.querySelector('#settings-history-detail-page')?.hidden === false");
  return evaluate(page, `
    (() => ({
      feedback: document.querySelector("#history-feedback")?.textContent ?? "",
      preview: document.querySelector("#history-context-preview")?.textContent ?? "",
      previewClass: document.querySelector("#history-context-preview")?.className ?? "",
      previewState: document.querySelector("#history-context-preview")?.dataset.state ?? ""
    }))()
  `);
}

async function continueSeededHistory(page) {
  await evaluate(page, `
    (() => {
      const button = document.querySelector("#history-detail .history-detail-actions button.button");
      if (!button) throw new Error("Missing continue history button");
      button.click();
    })()
  `);
  await waitFor(page, "document.querySelector('#chat-page')?.hidden === false");
}

async function safeUiSnapshot(page) {
  return evaluate(page, `
    (() => ({
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      chatNoteClass: document.querySelector("#chat-session-note")?.className ?? "",
      memoryFeedback: document.querySelector("#memory-feedback")?.textContent ?? "",
      memoryFeedbackState: document.querySelector("#memory-feedback")?.dataset.state ?? "",
      historyPreviewClass: document.querySelector("#history-context-preview")?.className ?? "",
      statusBoxCount: document.querySelectorAll(".status-box").length,
      selectionNoteCount: document.querySelectorAll(".selection-note").length,
      debugPanelCount: document.querySelectorAll(".context-debug-panel, .provider-message-dump, .activity-dashboard, .daily-rhythm-dashboard").length
    }))()
  `);
}

function validateLocalLlmPack(resourceRoot) {
  const validation = spawnSync(process.execPath, ["scripts/p2-20h-validate-local-llm-resources.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: resourceRoot,
      AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: ""
    },
    encoding: "utf8",
    windowsHide: true
  });
  const summary = parseJson(validation.stdout?.trim()) ?? {};
  return removeUndefined({
    ok: validation.status === 0 && summary.ok === true,
    status: summary.status ?? (validation.error ? "validator_failed" : "validator_nonzero"),
    runtime: summary.runtime,
    safeSummaryOnly: true,
    resourceSource: summary.resourceSource,
    resourceRootName: summary.resourceRootName ?? basename(resourceRoot),
    manifestFound: summary.manifestFound,
    executableName: summary.executableName,
    modelName: summary.modelName,
    alias: summary.alias,
    ctxSize: summary.ctxSize,
    runtimeIntegrity: summarizeIntegrity(summary.runtimeIntegrity),
    modelIntegrity: summarizeIntegrity(summary.modelIntegrity),
    licenseNotices: summary.licenseNotices,
    reason: summary.reason,
    stderrLength: validation.stderr?.length || undefined
  });
}

function readTelemetryEntries() {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) {
    return [];
  }

  return readdirSync(logDir)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDir, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
    .flatMap((filePath) => readTelemetryFile(filePath));
}

function readTelemetryFile(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJson(line))
    .filter((entry) => entry && typeof entry === "object");
}

function summarizeTelemetry(entries) {
  const runtimeResolved = latestPayload(entries, "bundled_llama_cpp_runtime_resolved");
  const runtimeReady = latestPayload(entries, "bundled_llama_cpp_runtime_status", (payload) => payload?.status === "ready");
  const handoff = latestPayload(entries, "bundled_llama_cpp_provider_handoff");
  const providerSelected = latestPayload(entries, "provider_selected", (payload) =>
    payload?.providerId === "local-openai-compatible"
  );
  const providerRequests = entries
    .filter((entry) => entry.type === "provider_request_completed" || entry.type === "provider_request_started")
    .map((entry) => summarizeProviderRequest(entry));
  const completedRequests = providerRequests.filter((entry) => entry.type === "provider_request_completed");
  const chatCompleted = entries
    .filter((entry) => entry.type === "chat_stream_completed")
    .map((entry) => summarizeChatCompleted(entry.payload));
  const failures = entries.filter((entry) =>
    entry.type === "provider_request_failed" ||
    entry.type === "provider_unavailable" ||
    entry.type === "chat_stream_failed"
  );

  return removeUndefined({
    safeSummaryOnly: true,
    runtimeResolved: summarizeRuntime(runtimeResolved),
    runtimeReady: summarizeRuntime(runtimeReady),
    handoff: summarizeHandoff(handoff),
    providerSelected: summarizeProviderSelected(providerSelected),
    providerRequestCount: providerRequests.length,
    providerRequestStartedCount: providerRequests.filter((entry) => entry.type === "provider_request_started").length,
    providerRequestCompletedCount: completedRequests.length,
    providerRequests,
    chatCompletedCount: chatCompleted.length,
    chatCompleted,
    failureCount: failures.length,
    telemetryTypeCounts: countTelemetryTypes(entries),
    externalHostSeen: providerRequests.some((entry) => isKnownExternalHost(entry.baseURLHost)) ||
      isKnownExternalHost(handoff?.baseURLHost)
  });
}

function createProviderChecks({ validation, providerStatus, telemetry, requiredReplyCount }) {
  const handoff = telemetry?.handoff;
  const providerStatusEmbedded = providerStatus?.providerId === "local-openai-compatible" &&
    providerStatus?.model === handoff?.alias &&
    providerStatus?.baseURLHost === handoff?.baseURLHost &&
    providerStatus?.isFallback === false;
  const providerRequestsEmbedded = (telemetry?.providerRequests ?? [])
    .filter((item) => item.type === "provider_request_completed")
    .every((item) =>
      item.providerId === "local-openai-compatible" &&
      item.model === handoff?.alias &&
      item.baseURLHost === handoff?.baseURLHost
    );

  return {
    localLlmPackReady: validation?.ok === true,
    runtimeReady: telemetry?.runtimeReady?.status === "ready",
    embeddedProviderHandoff: handoff?.providerId === "local-openai-compatible" &&
      handoff?.localPresetId === "embedded-llama-cpp" &&
      !isKnownExternalHost(handoff?.baseURLHost),
    providerStatusEmbedded,
    providerRequestsEmbedded,
    providerRequestsCompleted: (telemetry?.providerRequestCompletedCount ?? 0) >= requiredReplyCount,
    chatStreamsCompleted: (telemetry?.chatCompletedCount ?? 0) >= requiredReplyCount,
    noTelemetryFailures: (telemetry?.failureCount ?? 0) === 0,
    noExternalModelHost: telemetry?.externalHostSeen === false
  };
}

function createSummary({
  ok,
  durationMs,
  validation,
  providerStatus,
  telemetry,
  checks,
  observations,
  status,
  failureCategory
}) {
  return removeUndefined({
    ok,
    safeSummaryOnly: true,
    runName,
    durationMs,
    status: ok ? "passed" : status,
    resourceRootName: basename(packRoot),
    validation,
    providerStatus: summarizeProviderStatus(providerStatus),
    telemetry: summarizePublicTelemetry(telemetry),
    checks,
    observations,
    failureCategory: ok ? undefined : failureCategory
  });
}

function summarizePublicTelemetry(telemetry) {
  if (!telemetry) {
    return undefined;
  }

  return removeUndefined({
    safeSummaryOnly: true,
    runtimeResolved: telemetry.runtimeResolved,
    runtimeReady: telemetry.runtimeReady,
    handoff: telemetry.handoff,
    providerSelected: telemetry.providerSelected,
    providerRequestCount: telemetry.providerRequestCount,
    providerRequestStartedCount: telemetry.providerRequestStartedCount,
    providerRequestCompletedCount: telemetry.providerRequestCompletedCount,
    providerRequests: telemetry.providerRequests,
    chatCompletedCount: telemetry.chatCompletedCount,
    chatCompleted: telemetry.chatCompleted,
    failureCount: telemetry.failureCount,
    telemetryTypeCounts: telemetry.telemetryTypeCounts,
    externalHostSeen: telemetry.externalHostSeen
  });
}

function writeSafeSummary(summary) {
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  const privacy = checkPrivacy(serialized, readPrivacyCheckText(context, [
    "progress.log",
    "electron.stdout.log",
    "electron.stderr.log"
  ]));
  const finalSummary = privacy.ok
    ? {
        ...summary,
        privacyChecks: privacy.checks
      }
    : {
        ...summary,
        ok: false,
        checks: {
          ...(summary.checks ?? {}),
          privacyOutputSafe: false
        },
        privacyChecks: privacy.checks,
        failureCategory: "privacy_output_failed"
      };
  const finalSerialized = `${JSON.stringify(finalSummary, null, 2)}\n`;

  writeFileSync(context.resultPath, finalSerialized, "utf8");
  console.log(finalSerialized.trimEnd());
  log(context, "result_written");
  return finalSummary;
}

function checkPrivacy(serializedSummary, publicText) {
  const output = `${publicText}\n${serializedSummary}`;
  const checks = {
    noPrivateExactTextInOutput: privateTexts.every((text) => !output.includes(text)),
    noRawRequestOrSystemText: !/(provider request body|request body|requestBody|full prompt|完整 prompt|system prompt|providerMessages|"messages"\s*:|"content"\s*:)/iu.test(output),
    noFactContentLabels: !/(fact card body|fact card content|事实卡正文|memory cards?|气泡正文)/iu.test(output),
    noMcpQueryOrResults: !/(safeQuery|MCP query|MCP result|search query|search result snippet|result body|url"\s*:|title"\s*:|snippet"\s*:|domain"\s*:)/iu.test(output),
    noEnvOrAuthValue: !/(\.env\.local|Authorization|Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|AI_DESKTOP_PET_API_KEY\s*=)/iu.test(output),
    noLocalModelAbsolutePath: !(/[A-Za-z]:\\[^\r\n]*(?:\.gguf|\\model\\|\\models\\)/iu.test(output) || output.includes(packRoot))
  };

  return { ok: Object.values(checks).every(Boolean), checks };
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    textLength: info.textLength,
    ariaHidden: info.ariaHidden,
    rect: info.rect,
    style: info.style
  };
}

function sanitizeContext(payload) {
  if (!payload) {
    return null;
  }

  return {
    contextBudget: {
      compressed: Boolean(payload.contextBudget?.compressed),
      summaryMessageCount: safeInteger(payload.contextBudget?.summaryMessageCount),
      summarizedMessageCount: safeInteger(payload.contextBudget?.summarizedMessageCount),
      recentMessageCount: safeInteger(payload.contextBudget?.recentMessageCount)
    },
    memory: {
      injectionCount: safeInteger(payload.memory?.injectionCount)
    },
    webSearch: {
      included: Boolean(payload.webSearch?.included),
      citationCount: safeInteger(payload.webSearch?.citationCount)
    }
  };
}

function sanitizeMemoryActivity(payload) {
  if (!payload) {
    return null;
  }

  return {
    autoCapture: {
      enabled: Boolean(payload.autoCapture?.enabled),
      skippedReason: payload.autoCapture?.skippedReason ?? null,
      capturedCount: safeInteger(payload.autoCapture?.capturedCount),
      mergedCount: safeInteger(payload.autoCapture?.mergedCount),
      deduplicatedCount: safeInteger(payload.autoCapture?.deduplicatedCount),
      compressionTriggered: Boolean(payload.autoCapture?.compressionTriggered)
    },
    injection: {
      count: safeInteger(payload.injection?.count)
    },
    contextBudget: {
      compressed: Boolean(payload.contextBudget?.compressed)
    }
  };
}

function summarizeRuntime(payload) {
  if (!payload) {
    return undefined;
  }

  return removeUndefined({
    runtime: payload.runtime,
    bundled: payload.bundled,
    status: payload.status,
    safeSummaryOnly: true,
    resourceSource: payload.resourceSource,
    resourceRootName: payload.resourceRootName,
    manifestFound: payload.manifestFound,
    executableConfigured: payload.executableConfigured,
    modelConfigured: payload.modelConfigured,
    executableName: payload.executableName,
    modelName: payload.modelName,
    host: payload.host,
    port: payload.port,
    ctxSize: payload.ctxSize,
    alias: payload.alias,
    baseURLHost: payload.baseURLHost,
    durationMs: payload.durationMs,
    startupMs: payload.startupMs,
    reason: payload.reason
  });
}

function summarizeHandoff(payload) {
  if (!payload) {
    return undefined;
  }

  return removeUndefined({
    runtime: payload.runtime,
    enabled: payload.enabled,
    status: payload.status,
    safeSummaryOnly: true,
    executableConfigured: payload.executableConfigured,
    modelConfigured: payload.modelConfigured,
    providerId: payload.providerId,
    localPresetId: payload.localPresetId,
    baseURLHost: payload.baseURLHost,
    alias: payload.alias
  });
}

function summarizeProviderSelected(payload) {
  if (!payload) {
    return undefined;
  }

  return removeUndefined({
    providerId: payload.providerId,
    model: payload.model,
    baseURLHost: payload.baseURLHost,
    localPresetId: payload.localPresetId
  });
}

function summarizeProviderRequest(entry) {
  const payload = entry.payload ?? {};
  return removeUndefined({
    type: entry.type,
    providerId: payload.providerId,
    model: payload.model,
    baseURLHost: payload.baseURLHost,
    messageCount: payload.messageCount,
    replyLength: payload.replyLength,
    durationMs: payload.durationMs
  });
}

function summarizeChatCompleted(payload) {
  return removeUndefined({
    providerId: payload?.providerId,
    messageCount: payload?.messageCount,
    replyLength: payload?.replyLength,
    durationMs: payload?.durationMs,
    emotion: payload?.emotion,
    presentationMode: payload?.presentationMode
  });
}

function summarizeProviderStatus(value) {
  if (!value) {
    return undefined;
  }

  return removeUndefined({
    providerId: value.providerId,
    model: value.model,
    baseURLHost: value.baseURLHost,
    isFallback: value.isFallback
  });
}

function summarizeIntegrity(value) {
  if (!value) {
    return undefined;
  }

  return removeUndefined({
    status: value.status,
    sizeStatus: value.sizeStatus,
    sha256Status: value.sha256Status,
    reason: value.reason
  });
}

function latestPayload(entries, type, predicate = () => true) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === type && predicate(entry.payload ?? {})) {
      return entry.payload ?? {};
    }
  }
  return null;
}

function countTelemetryTypes(entries) {
  const counts = {};
  for (const entry of entries) {
    if (typeof entry.type !== "string") {
      continue;
    }
    counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  }
  return counts;
}

function hasThinkLeak(text) {
  return /<think>|<\/think>|reasoning/i.test(text);
}

function isKnownExternalHost(host) {
  return typeof host === "string" && (/localhost:11434|127\.0\.0\.1:11434|localhost:1234|127\.0\.0\.1:1234/.test(host));
}

function firstFailedCheck(checks) {
  return Object.entries(checks).find(([, value]) => !value)?.[0] ?? "check_failed";
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "send_timeout") {
    return "send_timeout";
  }
  if (message === "provider_chat_failed") {
    return "provider_chat_failed";
  }
  if (message === "embedded_handoff_timeout") {
    return "embedded_handoff_timeout";
  }
  if (/Target not found|Timed out waiting/.test(message)) {
    return "ui_not_ready";
  }
  if (/CDP timeout/.test(message)) {
    return "cdp_timeout";
  }
  return "script_failed";
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function readPositiveInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
