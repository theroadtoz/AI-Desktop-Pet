import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const providerId = "local-openai-compatible";
const baseURL = "http://localhost:11434/v1";
const model = "qwen2.5:3b-instruct";
const baseURLHost = new URL(baseURL).host;
const sendTimeoutMs = Number(process.env.P2_20E_SEND_TIMEOUT_MS || 90_000);

const context = createRealUiRunContext({
  runName: "p2-20e-local-provider-context-memory-boundary-real-ui",
  port: Number(process.env.P2_20E_CDP_PORT || 9594),
  env: {
    AI_DESKTOP_PET_PROVIDER: providerId,
    AI_DESKTOP_PET_BASE_URL: baseURL,
    AI_DESKTOP_PET_MODEL: model,
    AI_DESKTOP_PET_TEMPERATURE: "0.2",
    AI_DESKTOP_PET_MAX_TOKENS: "80",
    AI_DESKTOP_PET_API_KEY: "",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
  }
});

async function main() {
  const startedAt = Date.now();
  const caseResults = [];
  const privateTexts = [];
  const historyRequestSummary = {};
  const captureSummary = {};
  const injectionSummary = {};
  let providerReady = null;
  let providerStatus = null;
  let finalSummary = null;

  try {
    log(context, "run_started safeSummaryOnly=true");
    providerReady = await checkLocalProviderReady();

    if (providerReady.status !== "ready") {
      addCase(caseResults, {
        caseId: "provider-ready",
        category: "provider",
        passed: false,
        detail: { status: providerReady.status, reason: providerReady.reason ?? null }
      });
      finalSummary = createSummary({
        ok: false,
        durationMs: Date.now() - startedAt,
        caseResults,
        providerReady,
        providerStatus,
        historyRequestSummary,
        captureSummary,
        injectionSummary,
        storageSummary: summarizeMemoryStorage(),
        failureCategory: providerReady.status
      });
      finalSummary = writeSafeSummary(finalSummary, privateTexts);
      process.exitCode = 1;
      return;
    }

    const { chat } = await startApp();
    providerStatus = await waitForLocalProviderStatus(chat);
    const providerMatches = providerStatus?.providerId === providerId &&
      providerStatus?.model === model &&
      providerStatus?.baseURLHost === baseURLHost &&
      providerStatus?.isFallback === false;
    addCase(caseResults, {
      caseId: "provider-ready",
      category: "provider",
      passed: providerMatches,
      detail: {
        providerReady: providerReady.status === "ready",
        providerStatusMatches: providerMatches,
        noFakeProvider: providerStatus?.providerId !== "fake"
      }
    });

    const seedHistoryMessage = "2+2 等于几？";
    privateTexts.push(seedHistoryMessage);
    await sendMessage(chat, seedHistoryMessage);

    await restoreLatestHistory(chat, false);
    const localOnlyMessage = "只验证打开历史后的下一发。";
    privateTexts.push(localOnlyMessage);
    const localOnlySend = await sendMessage(chat, localOnlyMessage);
    historyRequestSummary.openLocalOnly = summarizeRequestAndInjection(localOnlySend);
    addCase(caseResults, {
      caseId: "history-open-local-only",
      category: "history",
      passed: localOnlySend.requestEvent?.messageCount === 1 &&
        localOnlySend.requestEvent?.hasHistoryContext === false,
      detail: {
        messageCount: localOnlySend.requestEvent?.messageCount ?? null,
        hasHistoryContext: localOnlySend.requestEvent?.hasHistoryContext ?? null,
        roleCounts: localOnlySend.requestEvent?.roleCounts ?? null
      }
    });

    await restoreLatestHistory(chat, true);
    const continueMessage = "继续历史时请简短确认。";
    privateTexts.push(continueMessage);
    const continueSend = await sendMessage(chat, continueMessage);
    historyRequestSummary.continueProviderContext = summarizeRequestAndInjection(continueSend);
    addCase(caseResults, {
      caseId: "history-continue-provider-context",
      category: "history",
      passed: Number(continueSend.requestEvent?.messageCount) > 1 &&
        continueSend.requestEvent?.hasHistoryContext === true &&
        Number(continueSend.requestEvent?.roleCounts?.assistant) >= 1,
      detail: {
        messageCount: continueSend.requestEvent?.messageCount ?? null,
        hasHistoryContext: continueSend.requestEvent?.hasHistoryContext ?? null,
        roleCounts: continueSend.requestEvent?.roleCounts ?? null
      }
    });

    await openChatPage(chat);
    await click(chat, "#new-conversation-button");
    await waitFor(chat, "document.querySelector('#chat-session-note')?.textContent.includes('携带当前会话上下文')");

    await setMemoryEnabled(chat, false);
    await openChatPage(chat);
    const disabledBefore = summarizeMemoryStorage();
    const disabledLowRiskMessage = "以后请叫我P220E小夏";
    privateTexts.push(disabledLowRiskMessage);
    const disabledSend = await sendMessage(chat, disabledLowRiskMessage);
    await sleep(300);
    const disabledAfter = summarizeMemoryStorage();
    captureSummary.disabledLowRisk = {
      beforeCardCount: disabledBefore.cardCount,
      afterCardCount: disabledAfter.cardCount,
      afterAutoCount: disabledAfter.autoCount,
      injectionCount: disabledSend.memoryEvent?.count ?? null,
      generatedAutoMemory: disabledAfter.autoCount > disabledBefore.autoCount
    };
    injectionSummary.disabledLowRisk = summarizeMemoryEvent(disabledSend.memoryEvent);
    addCase(caseResults, {
      caseId: "memory-disabled-no-auto-capture",
      category: "memory",
      passed: disabledAfter.autoCount === disabledBefore.autoCount &&
        disabledAfter.cardCount === disabledBefore.cardCount &&
        disabledSend.memoryEvent?.count === 0,
      detail: captureSummary.disabledLowRisk
    });

    await setMemoryEnabled(chat, true);
    await openChatPage(chat);
    const enabledBefore = summarizeMemoryStorage();
    const enabledLowRiskMessage = "请用简体中文回复我";
    privateTexts.push(enabledLowRiskMessage);
    const enabledSend = await sendMessage(chat, enabledLowRiskMessage);
    await waitForMemoryStorage(
      (summary) => summary.autoCount >= enabledBefore.autoCount + 1,
      "low risk auto memory"
    );
    const enabledAfter = summarizeMemoryStorage();
    captureSummary.enabledLowRisk = {
      beforeAutoCount: enabledBefore.autoCount,
      afterAutoCount: enabledAfter.autoCount,
      generatedAutoMemoryCount: Math.max(0, enabledAfter.autoCount - enabledBefore.autoCount),
      injectionCount: enabledSend.memoryEvent?.count ?? null,
      categories: enabledAfter.categories,
      sourceTypes: enabledAfter.sourceTypes,
      storageContainsForbiddenPattern: enabledAfter.containsForbiddenPattern
    };
    injectionSummary.enabledLowRisk = summarizeMemoryEvent(enabledSend.memoryEvent);
    addCase(caseResults, {
      caseId: "memory-enabled-low-risk-auto-capture",
      category: "memory",
      passed: enabledAfter.autoCount >= enabledBefore.autoCount + 1 &&
        enabledAfter.cardCount >= enabledBefore.cardCount + 1 &&
        enabledAfter.containsForbiddenPattern === false,
      detail: captureSummary.enabledLowRisk
    });

    await openChatPage(chat);
    const injectionCheckMessage = "检查记忆注入数量。";
    privateTexts.push(injectionCheckMessage);
    const injectionSend = await sendMessage(chat, injectionCheckMessage);
    const memoryPrivateTexts = readMemoryCardPrivateTexts();
    const safeUi = await readSafeMemoryUiState(chat, memoryPrivateTexts);
    injectionSummary.followUp = {
      ...summarizeMemoryEvent(injectionSend.memoryEvent),
      uiState: safeUi
    };
    addCase(caseResults, {
      caseId: "memory-injection-safe-summary",
      category: "memory",
      passed: Number(injectionSend.memoryEvent?.count) >= 1 &&
        safeUi.memoryStatusHasAllowedCount === true &&
        safeUi.containsForbiddenPattern === false,
      detail: injectionSummary.followUp
    });

    const sensitiveBefore = summarizeMemoryStorage();
    const sensitiveMessages = createSensitiveMessages();
    for (const item of sensitiveMessages) {
      privateTexts.push(item.input);
    }
    const sensitiveSends = [];
    for (const item of sensitiveMessages) {
      sensitiveSends.push({
        label: item.label,
        result: await sendMessage(chat, item.input)
      });
      await sleep(200);
    }
    const sensitiveAfter = summarizeMemoryStorage();
    captureSummary.sensitive = {
      beforeCardCount: sensitiveBefore.cardCount,
      afterCardCount: sensitiveAfter.cardCount,
      beforeAutoCount: sensitiveBefore.autoCount,
      afterAutoCount: sensitiveAfter.autoCount,
      sensitiveModeCount: sensitiveMessages.length,
      skippedAsSensitiveCount: sensitiveSends.filter((item) => item.result.autoCapture?.skippedReason === "sensitive").length,
      storageContainsForbiddenPattern: sensitiveAfter.containsForbiddenPattern
    };
    addCase(caseResults, {
      caseId: "memory-sensitive-bank-skipped",
      category: "memory",
      passed: sensitiveAfter.cardCount === sensitiveBefore.cardCount &&
        sensitiveAfter.autoCount === sensitiveBefore.autoCount &&
        sensitiveAfter.containsForbiddenPattern === false &&
        captureSummary.sensitive.skippedAsSensitiveCount === sensitiveMessages.length,
      detail: captureSummary.sensitive
    });

    const screenshotResidue = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    const checks = {
      localProviderReady: providerReady.status === "ready",
      providerStatusMatches: providerMatches,
      noFakeProvider: providerStatus?.providerId !== "fake",
      requiredCasesPassed: caseResults.every((result) => result.status === "passed"),
      noScreenshotResidueBeforeCleanup: screenshotResidue.length === 0
    };
    finalSummary = createSummary({
      ok: Object.values(checks).every(Boolean),
      durationMs: Date.now() - startedAt,
      caseResults,
      providerReady,
      providerStatus,
      checks,
      historyRequestSummary,
      captureSummary,
      injectionSummary,
      storageSummary: summarizeMemoryStorage(),
      failureCategory: Object.values(checks).every(Boolean) ? undefined : firstFailedCheck(checks)
    });
    finalSummary = writeSafeSummary(finalSummary, privateTexts);

    if (!finalSummary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const failureCategory = classifyError(error);
    finalSummary = createSummary({
      ok: false,
      durationMs: Date.now() - startedAt,
      caseResults,
      providerReady,
      providerStatus,
      historyRequestSummary,
      captureSummary,
      injectionSummary,
      storageSummary: summarizeMemoryStorage(),
      failureCategory
    });
    finalSummary = writeSafeSummary(finalSummary, privateTexts);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_20E_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_000);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.configApi?.getProviderStatus)");
  await waitFor(chat, "!document.querySelector('#provider-status')?.textContent.includes('Fake Provider')", { timeoutMs: 10_000 });
  await installProbes(chat);
  return { pet, chat };
}

async function waitForLocalProviderStatus(chat) {
  return waitFor(chat, `
    window.configApi?.getProviderStatus().then((status) => {
      if (
        status?.providerId === ${JSON.stringify(providerId)} &&
        status?.model === ${JSON.stringify(model)} &&
        status?.baseURLHost === ${JSON.stringify(baseURLHost)} &&
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
  `, { timeoutMs: 15_000 });
}

async function installProbes(page) {
  await waitFor(page, "Boolean(window.chatApi?.onMemoryInjection)");
  await evaluate(page, String.raw`
    (() => {
      window.__p220eMemoryEvents = [];

      if (!window.__p220eMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p220eMemoryEvents.push({
            requestVersion: payload.requestVersion,
            count: payload.count
          });
        });
        window.__p220eMemoryProbeInstalled = true;
      }
    })()
  `);
}

async function sendMessage(page, message) {
  const before = await readSendState(page);
  const telemetryCursor = readTelemetryCursor();
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + sendTimeoutMs;
  let lastState = before;

  while (Date.now() < deadline) {
    const state = await readSendState(page);
    lastState = state;
    const telemetry = readTelemetrySince(telemetryCursor);

    if (
      state.memoryEventCount > before.memoryEventCount &&
      state.replyCount > before.replyCount &&
      !state.inputDisabled &&
      state.lastReplyLength > 0
    ) {
      const memoryEvent = await readMemoryEvent(page, before.memoryEventCount);
      const requestEvent = withAuthorizedMemoryContext(telemetry.started, memoryEvent);
      return {
        requestEvent: sanitizeRequestEvent(requestEvent),
        memoryEvent: sanitizeMemoryEvent(memoryEvent),
        autoCapture: sanitizeAutoCapture(telemetry.autoCapture),
        replyLength: state.lastReplyLength,
        durationMs: Date.now() - before.timestamp
      };
    }

    if (
      !state.inputDisabled &&
      (state.sessionState === "error" || telemetry.failed)
    ) {
      throw new Error("provider_chat_failed");
    }

    await sleep(250);
  }

  const telemetry = readTelemetrySince(telemetryCursor);
  throw new Error(`send_timeout:${JSON.stringify({
    memoryEventDelta: Math.max(0, lastState.memoryEventCount - before.memoryEventCount),
    replyDelta: Math.max(0, lastState.replyCount - before.replyCount),
    inputDisabled: Boolean(lastState.inputDisabled),
    lastReplyLength: lastState.lastReplyLength,
    sessionState: lastState.sessionState,
    startedMessageCount: telemetry.started?.messageCount ?? null,
    completed: telemetry.completed,
    failed: telemetry.failed
  })}`);
}

async function readSendState(page) {
  return evaluate(page, `
    (() => {
      const input = document.querySelector("#chat-input");
      const replies = [...document.querySelectorAll(".message-pet .message-content")];
      const lastReply = replies.at(-1)?.textContent?.trim() ?? "";
      const sessionNote = document.querySelector("#chat-session-note");
      return {
        timestamp: Date.now(),
        inputDisabled: Boolean(input?.disabled),
        replyCount: replies.length,
        lastReplyLength: lastReply.length,
        memoryEventCount: window.__p220eMemoryEvents?.length ?? 0,
        sessionState: sessionNote?.dataset.state ?? ""
      };
    })()
  `);
}

async function readMemoryEvent(page, index) {
  return evaluate(page, `window.__p220eMemoryEvents?.[${JSON.stringify(index)}] ?? null`);
}

async function restoreLatestHistory(page, includeProviderContext) {
  await openHistorySettings(page);
  await waitFor(page, "document.querySelectorAll('.conversation-select').length > 0", { timeoutMs: 10_000 });
  await evaluate(page, "document.querySelector('.conversation-select')?.click()");
  await waitFor(page, "document.querySelector('#settings-history-detail-page')?.hidden === false");
  await waitFor(page, "document.querySelectorAll('#history-detail .history-message').length > 0");
  const label = includeProviderContext ? "继续发送给当前 Provider" : "打开历史";
  await evaluate(page, `
    (() => {
      const button = [...document.querySelectorAll("#history-detail .history-detail-actions button")]
        .find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
      if (!button) {
        throw new Error("Missing history restore action");
      }
      button.click();
    })()
  `);
  await waitFor(page, "document.querySelector('#chat-page')?.hidden === false");
  await waitFor(page, includeProviderContext
    ? "document.querySelector('#chat-session-note')?.textContent.includes('携带当前会话上下文')"
    : "document.querySelector('#chat-session-note')?.textContent.includes('不会自动发送历史内容')");
}

async function setMemoryEnabled(page, enabled) {
  await openMemorySettings(page);
  await waitFor(page, "Boolean(document.querySelector('#enable-memory-button'))");
  const isEnabled = await evaluate(page, "document.querySelector('#enable-memory-button')?.textContent.includes('关闭记忆')");

  if (isEnabled === enabled) {
    return;
  }

  await click(page, "#enable-memory-button");
  await waitFor(page, enabled
    ? "document.querySelector('#enable-memory-button')?.textContent.includes('关闭记忆')"
    : "document.querySelector('#enable-memory-button')?.textContent.includes('开启记忆')");
}

async function readSafeMemoryUiState(page, forbiddenTexts) {
  return evaluate(page, String.raw`
    (() => {
      const forbiddenTexts = ${JSON.stringify(forbiddenTexts)};
      const checkedText = [
        document.querySelector("#memory-session-status")?.textContent ?? "",
        document.querySelector("#chat-session-note")?.textContent ?? "",
        document.querySelector("#partner-status-band")?.textContent ?? "",
        document.querySelector(".partner-status-band")?.textContent ?? "",
        document.querySelector("#companion-control-shelf")?.textContent ?? ""
      ].join("\n");
      const memoryStatus = document.querySelector("#memory-session-status")?.textContent ?? "";
      const match = /她带上了\s*(\d+)\s*条已允许的记忆/.exec(memoryStatus);
      const forbiddenPatterns = [
        /sk-[A-Za-z0-9_-]{8,}/u,
        /\b\d{12,19}\b/u,
        /(api[-_\s]?key|密钥|token|password|密码|secret|银行卡)/iu
      ];

      return {
        memoryStatusHasAllowedCount: Boolean(match),
        memoryStatusCount: match ? Number(match[1]) : 0,
        containsForbiddenPattern: forbiddenTexts.some((text) => text && checkedText.includes(text)) ||
          forbiddenPatterns.some((pattern) => pattern.test(checkedText)),
        checkedNodeCount: 5
      };
    })()
  `);
}

function readMemoryStorage() {
  const memoryPath = join(context.appDataDir, "memory", "facts.json");

  if (!existsSync(memoryPath)) {
    return { raw: "", storage: null };
  }

  try {
    const raw = readFileSync(memoryPath, "utf8");
    return { raw, storage: JSON.parse(raw) };
  } catch {
    return { raw: "", storage: null };
  }
}

function summarizeMemoryStorage() {
  const { raw, storage } = readMemoryStorage();
  const cards = Array.isArray(storage?.cards) ? storage.cards : [];
  const sourceTypes = countBy(cards.map((card) => card.sourceType).filter(Boolean));
  const categories = [...new Set(cards.map((card) => card.category).filter(Boolean))].sort();

  return {
    exists: Boolean(storage),
    version: storage?.version ?? null,
    enabled: storage?.enabled ?? null,
    cardCount: cards.length,
    enabledCount: cards.filter((card) => card.enabled).length,
    autoCount: cards.filter((card) => card.sourceType === "auto-local-heuristic").length,
    keyCount: cards.filter((card) => card.importance === "key").length,
    generalCount: cards.filter((card) => card.importance === "general").length,
    sourceTypes,
    categories,
    containsForbiddenPattern: containsForbiddenPattern(raw)
  };
}

function readMemoryCardPrivateTexts() {
  const storage = readMemoryStorage().storage;
  const cards = Array.isArray(storage?.cards) ? storage.cards : [];
  return cards.flatMap((card) => [card.title, card.content])
    .filter((text) => typeof text === "string" && text.length > 0);
}

function readTelemetryCursor() {
  return readTelemetryEvents().length;
}

function readTelemetrySince(cursor) {
  const events = readTelemetryEvents().slice(cursor);
  const started = events
    .filter((event) => event.type === "chat_stream_started")
    .map((event) => sanitizeChatStartedTelemetry(event.payload))
    .find(Boolean) ?? null;
  const autoCapture = events
    .filter((event) => event.type === "memory_auto_capture")
    .map((event) => sanitizeAutoCapture(event.payload))
    .find(Boolean) ?? null;
  const completed = events.some((event) => event.type === "chat_stream_completed");
  const failed = events.some((event) => event.type === "chat_stream_failed");

  return {
    started,
    autoCapture,
    completed,
    failed
  };
}

function readTelemetryEvents() {
  const logsDir = join(context.appDataDir, "logs");

  if (!existsSync(logsDir)) {
    return [];
  }

  const events = [];
  for (const filePath of listLogFiles(logsDir)) {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseJson(line.trim());
      if (parsed && typeof parsed.type === "string") {
        events.push(parsed);
      }
    }
  }

  return events;
}

function listLogFiles(directory, matches = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      listLogFiles(fullPath, matches);
      continue;
    }
    if (/\.(json|jsonl|log)$/i.test(entry.name)) {
      matches.push(fullPath);
    }
  }
  return matches;
}

async function waitForMemoryStorage(predicate, description) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const summary = summarizeMemoryStorage();
    if (predicate(summary)) {
      return summary;
    }
    await sleep(100);
  }

  throw new Error(`memory_storage_timeout:${description}`);
}

async function checkLocalProviderReady() {
  const startedAt = Date.now();
  const modelsCheck = await checkModels();

  if (modelsCheck.status !== "ready") {
    return removeUndefined({
      status: modelsCheck.status,
      providerId,
      model,
      baseURLHost,
      durationMs: Date.now() - startedAt,
      modelsCheckMs: modelsCheck.durationMs,
      modelCount: modelsCheck.modelCount,
      reason: modelsCheck.reason
    });
  }

  const chatCheck = await checkChat();
  return removeUndefined({
    status: chatCheck.status,
    providerId,
    model,
    baseURLHost,
    durationMs: Date.now() - startedAt,
    modelsCheckMs: modelsCheck.durationMs,
    chatCheckMs: chatCheck.durationMs,
    modelCount: modelsCheck.modelCount,
    firstTokenMs: chatCheck.firstTokenMs,
    replyLength: chatCheck.replyLength,
    reason: chatCheck.reason
  });
}

async function checkModels() {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createModelsURL(baseURL), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 5_000);

    if (!response.ok) {
      return {
        status: "not_ready",
        durationMs: Date.now() - startedAt,
        reason: `models_http_${response.status}`
      };
    }

    const modelIds = parseModelIds(await response.json());

    if (!modelIds) {
      return {
        status: "not_ready",
        durationMs: Date.now() - startedAt,
        reason: "models_response_incompatible"
      };
    }

    return {
      status: modelIds.includes(model) ? "ready" : "model_missing",
      durationMs: Date.now() - startedAt,
      modelCount: modelIds.length
    };
  } catch (error) {
    return {
      status: "not_ready",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function checkChat() {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createChatCompletionsURL(baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        temperature: 0.2,
        max_tokens: 32,
        stream: true,
        reasoning_effort: "none"
      })
    }, 60_000);

    if (!response.ok || !response.body) {
      return {
        status: "chat_failed",
        durationMs: Date.now() - startedAt,
        reason: `chat_http_${response.status}`
      };
    }

    const stream = await readSseSummary(response.body, startedAt);

    if (stream.replyLength <= 0) {
      return {
        status: "chat_failed",
        durationMs: Date.now() - startedAt,
        firstTokenMs: stream.firstTokenMs,
        replyLength: stream.replyLength,
        reason: stream.sawEvent ? "empty_chat_stream" : "incompatible_chat_stream"
      };
    }

    return {
      status: "ready",
      durationMs: Date.now() - startedAt,
      firstTokenMs: stream.firstTokenMs,
      replyLength: stream.replyLength
    };
  } catch (error) {
    return {
      status: "chat_failed",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readSseSummary(body, startedAt) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenMs;
  let replyLength = 0;
  let sawEvent = false;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice("data:".length).trim();

        if (data === "[DONE]") {
          return { firstTokenMs, replyLength, sawEvent: true };
        }

        sawEvent = true;
        const parsed = parseJson(data);
        const text = parsed?.choices?.[0]?.delta?.content;

        if (typeof text === "string" && text.length > 0) {
          firstTokenMs ??= Date.now() - startedAt;
          replyLength += text.length;
        }
      }
    }

    return { firstTokenMs, replyLength, sawEvent };
  } finally {
    reader.releaseLock();
  }
}

function createModelsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function createChatCompletionsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function parseModelIds(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.data)) {
    return null;
  }

  const ids = [];

  for (const item of value.data) {
    const id = item && typeof item === "object"
      ? item.id ?? item.model ?? item.name
      : null;

    if (typeof id !== "string" || id.length === 0) {
      return null;
    }

    ids.push(id);
  }

  return ids;
}

function createSensitiveMessages() {
  const bankValue = ["622202", "000000", "0000000"].join("");
  const apiKeyValue = ["sk", "-p220e", "-local", "-sensitive", "-probe"].join("");
  const passwordValue = ["P220E", "-local", "-pass", "-probe"].join("");

  return [
    { label: "card_number", input: `请不要保存这个银行卡号 ${bankValue}` },
    { label: "credential_key", input: `请不要保存这个 API Key ${apiKeyValue}` },
    { label: "credential_pass", input: `请不要保存这个密码 ${passwordValue}` }
  ];
}

function createSummary({
  ok,
  durationMs,
  caseResults,
  providerReady,
  providerStatus,
  checks,
  historyRequestSummary,
  captureSummary,
  injectionSummary,
  storageSummary,
  failureCategory
}) {
  return removeUndefined({
    ok,
    safeSummaryOnly: true,
    providerId,
    baseURLHost,
    model,
    durationMs,
    providerReady: providerReady ? summarizeProviderReady(providerReady) : undefined,
    providerStatus: providerStatus ? summarizeProviderStatus(providerStatus) : undefined,
    checks,
    cases: caseResults,
    historyRequestSummary,
    captureSummary,
    injectionSummary,
    storageSummary,
    failureCategory
  });
}

function writeSafeSummary(summary, privateTexts) {
  const memoryPrivateTexts = readMemoryCardPrivateTexts();
  const firstPass = JSON.stringify(summary, null, 2);
  const privacyCheck = checkPrivacy(firstPass, [...privateTexts, ...memoryPrivateTexts]);
  const cases = summary.cases.filter((item) => item.caseId !== "privacy-output-sanitized");
  cases.push({
    caseId: "privacy-output-sanitized",
    category: "privacy",
    status: privacyCheck.ok ? "passed" : "failed",
    checks: privacyCheck.checks
  });
  const finalSummary = {
    ...summary,
    ok: summary.ok && privacyCheck.ok,
    cases,
    privacyChecks: privacyCheck.checks,
    failureCategory: summary.ok && !privacyCheck.ok
      ? "privacy_output_failed"
      : summary.failureCategory
  };
  const finalSerialized = `${JSON.stringify(finalSummary, null, 2)}\n`;
  const finalPrivacyCheck = checkPrivacy(finalSerialized, [...privateTexts, ...memoryPrivateTexts]);
  const checkedSummary = finalPrivacyCheck.ok
    ? finalSummary
    : {
        ...finalSummary,
        ok: false,
        cases: finalSummary.cases.map((item) => item.caseId === "privacy-output-sanitized"
          ? { ...item, status: "failed", checks: finalPrivacyCheck.checks }
          : item),
        privacyChecks: finalPrivacyCheck.checks,
        failureCategory: finalSummary.failureCategory ?? "privacy_output_failed"
      };

  const checkedSerialized = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  writeFileSync(context.resultPath, checkedSerialized, "utf8");
  console.log(checkedSerialized.trimEnd());
  return checkedSummary;
}

function checkPrivacy(serializedSummary, privateTexts) {
  const publicOutputText = [
    readPrivacyCheckText(context, ["progress.log"]),
    serializedSummary
  ].join("\n");
  const auxiliaryLogText = readPrivacyCheckText(context, ["electron.stdout.log", "electron.stderr.log"]);
  const exactPrivateTexts = privateTexts
    .filter((item) => typeof item === "string" && item.trim().length >= 4);
  const privateSensitiveFragments = extractSensitiveFragments(exactPrivateTexts);
  const checks = {
    noPrivateExactTextInOutput: exactPrivateTexts.every((item) => !publicOutputText.includes(item)),
    noPrivateExactTextInAuxLogs: exactPrivateTexts.every((item) => !auxiliaryLogText.includes(item)),
    noPrivateSensitiveFragmentInOutput: privateSensitiveFragments.every((item) => !publicOutputText.includes(item)),
    noPrivateSensitiveFragmentInAuxLogs: privateSensitiveFragments.every((item) => !auxiliaryLogText.includes(item)),
    noRawRequestOrSystemText: !/(provider request body|Provider 请求正文|request body|完整 prompt|system prompt|系统提示词|messages"\s*:|"content"\s*:)/iu.test(publicOutputText),
    noFactContentLabels: !/(fact card body|事实卡正文|fact card content|事实卡内容)/iu.test(publicOutputText),
    noEnvOrAuthValue: !/(\.env\.local|Authorization|Bearer\s+\S+)/iu.test(publicOutputText),
    noLocalModelAbsolutePath: !/[A-Za-z]:\\[^\r\n]*(?:\.gguf|\\model\\)/iu.test(publicOutputText)
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks
  };
}

function extractSensitiveFragments(texts) {
  const fragments = [];
  for (const text of texts) {
    const matches = text.match(/sk-[A-Za-z0-9_-]{8,}|\b\d{12,19}\b|[A-Za-z0-9_-]*pass[A-Za-z0-9_-]*/giu) ?? [];
    fragments.push(...matches);
  }
  return [...new Set(fragments.filter((item) => item.length >= 4))];
}

function summarizeProviderReady(value) {
  return removeUndefined({
    status: value.status,
    providerId: value.providerId,
    baseURLHost: value.baseURLHost,
    model: value.model,
    durationMs: value.durationMs,
    modelsCheckMs: value.modelsCheckMs,
    chatCheckMs: value.chatCheckMs,
    modelCount: value.modelCount,
    firstTokenMs: value.firstTokenMs,
    replyLength: value.replyLength,
    reason: value.reason
  });
}

function summarizeProviderStatus(value) {
  return removeUndefined({
    providerId: value.providerId,
    baseURLHost: value.baseURLHost,
    model: value.model,
    isFallback: value.isFallback
  });
}

function summarizeRequestAndInjection(sendResult) {
  const request = sendResult.requestEvent;
  const memory = sendResult.memoryEvent;

  return removeUndefined({
    messageCount: request?.messageCount,
    roleCounts: request?.roleCounts,
    hasHistoryContext: request?.hasHistoryContext,
    hasAuthorizedMemoryContext: request?.hasAuthorizedMemoryContext,
    containsForbiddenPattern: request?.containsForbiddenPattern,
    autoCapture: sendResult.autoCapture,
    memoryInjectionCount: memory?.count,
    replyLength: sendResult.replyLength,
    durationMs: sendResult.durationMs
  });
}

function summarizeMemoryEvent(event) {
  return {
    count: Number.isSafeInteger(event?.count) ? event.count : null
  };
}

function sanitizeRequestEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return {
    messageCount: Number.isSafeInteger(event.messageCount) ? event.messageCount : null,
    roleCounts: {
      user: Number.isSafeInteger(event.roleCounts?.user) ? event.roleCounts.user : 0,
      assistant: Number.isSafeInteger(event.roleCounts?.assistant) ? event.roleCounts.assistant : 0
    },
    hasHistoryContext: Boolean(event.hasHistoryContext),
    hasAuthorizedMemoryContext: Boolean(event.hasAuthorizedMemoryContext),
    containsForbiddenPattern: Boolean(event.containsForbiddenPattern)
  };
}

function sanitizeChatStartedTelemetry(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const messageCount = Number.isSafeInteger(payload.messageCount) ? payload.messageCount : null;
  const assistantCount = messageCount && messageCount > 1 ? Math.floor(messageCount / 2) : 0;

  return {
    messageCount,
    roleCounts: {
      user: messageCount ? Math.ceil(messageCount / 2) : 0,
      assistant: assistantCount
    },
    hasHistoryContext: Number(messageCount) > 1,
    hasAuthorizedMemoryContext: false,
    containsForbiddenPattern: false
  };
}

function sanitizeAutoCapture(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return removeUndefined({
    enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
    skippedReason: typeof payload.skippedReason === "string" ? payload.skippedReason : undefined,
    capturedCount: Number.isSafeInteger(payload.capturedCount) ? payload.capturedCount : undefined,
    keyCount: Number.isSafeInteger(payload.keyCount) ? payload.keyCount : undefined,
    generalCount: Number.isSafeInteger(payload.generalCount) ? payload.generalCount : undefined,
    mergedCount: Number.isSafeInteger(payload.mergedCount) ? payload.mergedCount : undefined,
    deduplicatedCount: Number.isSafeInteger(payload.deduplicatedCount) ? payload.deduplicatedCount : undefined,
    compressionTriggered: typeof payload.compressionTriggered === "boolean" ? payload.compressionTriggered : undefined,
    totalCards: Number.isSafeInteger(payload.totalCards) ? payload.totalCards : undefined,
    injectionBudget: Number.isSafeInteger(payload.injectionBudget) ? payload.injectionBudget : undefined,
    safeCategories: Array.isArray(payload.safeCategories)
      ? payload.safeCategories.filter((item) => typeof item === "string").sort()
      : undefined
  });
}

function withAuthorizedMemoryContext(requestEvent, memoryEvent) {
  if (!requestEvent || typeof requestEvent !== "object") {
    return requestEvent;
  }

  return {
    ...requestEvent,
    hasAuthorizedMemoryContext: Number(memoryEvent?.count) > 0
  };
}

function sanitizeMemoryEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return {
    count: Number.isSafeInteger(event.count) ? event.count : null
  };
}

function addCase(caseResults, { caseId, category, passed, detail }) {
  const result = removeUndefined({
    caseId,
    category,
    status: passed ? "passed" : "failed",
    ...detail
  });
  caseResults.push(result);
  log(context, `case=${caseId} status=${result.status} category=${category}`);
  return result;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function containsForbiddenPattern(text) {
  if (!text) {
    return false;
  }

  return [
    /(^|[^A-Za-z])sk-[A-Za-z0-9_-]{8,}/u,
    /(api[-_\s]?key|密钥|token|password|密码|secret)/iu,
    /(银行卡|完整\s*prompt|系统提示词|请求正文|provider request body)/iu
  ].some((pattern) => pattern.test(text));
}

function firstFailedCheck(checks) {
  return Object.entries(checks).find(([, value]) => !value)?.[0] ?? "check_failed";
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith("send_timeout")) {
    return "send_timeout";
  }

  if (message === "provider_chat_failed") {
    return "provider_chat_failed";
  }

  if (message.startsWith("memory_storage_timeout")) {
    return "memory_storage_timeout";
  }

  if (/Target not found|Timed out waiting|Missing selector|Missing history restore action/.test(message)) {
    return "ui_not_ready";
  }

  if (/CDP timeout/.test(message)) {
    return "cdp_timeout";
  }

  return "script_failed";
}

function classifyFetchError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }

  return "network_or_runtime_unreachable";
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

await main();
