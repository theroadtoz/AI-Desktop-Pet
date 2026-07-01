import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
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

const providerId = "local-openai-compatible";
const baseURL = "http://localhost:11434/v1";
const model = "qwen2.5:3b-instruct";
const baseURLHost = new URL(baseURL).host;
const sendTimeoutMs = Number(process.env.P2_20F_SEND_TIMEOUT_MS || 90_000);
const seededConversationId = crypto.randomUUID();

const context = createRealUiRunContext({
  runName: "p2-20f-local-memory-context-compression-real-ui",
  port: Number(process.env.P2_20F_CDP_PORT || 9595),
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
  const privateTexts = [];
  const caseResults = [];
  let providerReady = null;
  let providerStatus = null;
  let sendSummary = null;
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
        providerReady,
        providerStatus,
        caseResults,
        sendSummary,
        storageSummary: summarizeMemoryStorage(),
        failureCategory: providerReady.status
      });
      finalSummary = writeSafeSummary(finalSummary, privateTexts);
      process.exitCode = 1;
      return;
    }

    const seededTexts = prepareSeededHistory();
    privateTexts.push(...seededTexts);
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
        ready: providerReady.status === "ready",
        statusMatches: providerMatches,
        noFakeProvider: providerStatus?.providerId !== "fake"
      }
    });

    const memoryPrivateTexts = await seedMemoryCards(chat);
    privateTexts.push(...memoryPrivateTexts);
    await restoreSeededHistoryWithProviderContext(chat);

    const finalQuestion = "continue with the local context budget check";
    privateTexts.push(finalQuestion);
    sendSummary = await sendMessage(chat, finalQuestion);
    const storageSummary = summarizeMemoryStorage();
    const screenshotResidue = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));

    addCase(caseResults, {
      caseId: "context-budget-telemetry",
      category: "context",
      passed: sendSummary.contextBudget.compressed === true &&
        sendSummary.contextBudget.originalMessageCount > sendSummary.contextBudget.providerMessageCount &&
        sendSummary.contextBudget.summaryMessageCount === 1 &&
        sendSummary.contextBudget.summarizedMessageCount > 0 &&
        sendSummary.contextBudget.recentMessageCount <= 8,
      detail: sendSummary.contextBudget
    });
    addCase(caseResults, {
      caseId: "memory-budget",
      category: "memory",
      passed: sendSummary.contextBudget.memoryInjectionCount <= 8 &&
        sendSummary.memoryEventCount <= 8 &&
        storageSummary.compressionStates.budgeted >= 8,
      detail: {
        telemetryMemoryInjectionCount: sendSummary.contextBudget.memoryInjectionCount,
        uiMemoryEventCount: sendSummary.memoryEventCount,
        budgetedCount: storageSummary.compressionStates.budgeted ?? 0
      }
    });
    addCase(caseResults, {
      caseId: "tmp-residue-before-cleanup",
      category: "cleanup",
      passed: screenshotResidue.length === 0,
      detail: { residueCount: screenshotResidue.length }
    });

    const checks = {
      localProviderReady: providerReady.status === "ready",
      providerStatusMatches: providerMatches,
      noFakeProvider: providerStatus?.providerId !== "fake",
      contextCompressed: sendSummary.contextBudget.compressed === true,
      providerMessagesReduced: sendSummary.contextBudget.originalMessageCount > sendSummary.contextBudget.providerMessageCount,
      summaryMessageCreated: sendSummary.contextBudget.summaryMessageCount === 1,
      memoryInjectionBudgeted: sendSummary.contextBudget.memoryInjectionCount <= 8,
      memoryStorageBudgeted: storageSummary.compressionStates.budgeted >= 8,
      noScreenshotResidueBeforeCleanup: screenshotResidue.length === 0
    };

    finalSummary = createSummary({
      ok: Object.values(checks).every(Boolean) && caseResults.every((result) => result.status === "passed"),
      durationMs: Date.now() - startedAt,
      providerReady,
      providerStatus,
      checks,
      caseResults,
      sendSummary,
      storageSummary,
      failureCategory: Object.values(checks).every(Boolean) ? undefined : firstFailedCheck(checks)
    });
    finalSummary = writeSafeSummary(finalSummary, privateTexts);

    if (!finalSummary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    finalSummary = createSummary({
      ok: false,
      durationMs: Date.now() - startedAt,
      providerReady,
      providerStatus,
      caseResults,
      sendSummary,
      storageSummary: summarizeMemoryStorage(),
      failureCategory: classifyError(error)
    });
    finalSummary = writeSafeSummary(finalSummary, privateTexts);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_20F_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
}

function prepareSeededHistory() {
  const historyDirectory = join(context.appDataDir, "history");
  mkdirSync(historyDirectory, { recursive: true });

  const now = Date.now();
  const messages = Array.from({ length: 12 }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    return {
      id: crypto.randomUUID(),
      role,
      content: `p2-20f seed ${role} ${String(index + 1).padStart(2, "0")}`,
      createdAt: now - 12_000 + index * 1_000
    };
  });
  const storage = {
    version: 1,
    conversations: [{
      id: seededConversationId,
      title: "p2-20f seeded long context",
      createdAt: messages[0].createdAt,
      updatedAt: messages[messages.length - 1].createdAt,
      messages
    }]
  };

  writeFileSync(join(historyDirectory, "conversations.json"), `${JSON.stringify(storage, null, 2)}\n`, "utf8");
  return messages.map((message) => message.content);
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
      window.__p220fMemoryEvents = [];

      if (!window.__p220fMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p220fMemoryEvents.push({
            requestVersion: payload.requestVersion,
            count: payload.count
          });
        });
        window.__p220fMemoryProbeInstalled = true;
      }
    })()
  `);
}

async function seedMemoryCards(page) {
  const memoryTexts = [];

  await waitFor(page, "Boolean(window.memoryApi?.setEnabled && window.memoryApi?.createCard)");
  await evaluate(page, "window.memoryApi?.setEnabled(true)");
  await evaluate(page, "window.memoryApi?.clearCards?.()");

  for (let index = 0; index < 10; index += 1) {
    const title = `p2-20f memory title ${index}`;
    const content = `p2-20f memory content ${index}`;
    memoryTexts.push(title, content);
    await evaluate(page, `
      window.memoryApi?.createCard({
        title: ${JSON.stringify(title)},
        content: ${JSON.stringify(content)},
        tags: ["p2-20f"],
        sourceConversationId: ${JSON.stringify(seededConversationId)}
      })
    `);
  }

  await waitForMemoryStorage((summary) => summary.cardCount >= 10, "seed memory cards");
  return memoryTexts;
}

async function restoreSeededHistoryWithProviderContext(page) {
  await openHistorySettings(page);
  await waitFor(page, "document.querySelectorAll('.conversation-select').length > 0", { timeoutMs: 10_000 });
  await evaluate(page, "document.querySelector('.conversation-select')?.click()");
  await waitFor(page, "document.querySelector('#settings-history-detail-page')?.hidden === false");
  await waitFor(page, "document.querySelectorAll('#history-detail .history-message').length >= 12");
  await evaluate(page, `
    (() => {
      const button = document.querySelector("#history-detail .history-detail-actions button.button");
      if (!button) {
        throw new Error("Missing continue history button");
      }
      button.click();
    })()
  `);
  await waitFor(page, "document.querySelector('#chat-page')?.hidden === false");
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
      state.lastReplyLength > 0 &&
      telemetry.started
    ) {
      const memoryEvent = await readMemoryEvent(page, before.memoryEventCount);
      return {
        contextBudget: telemetry.started,
        memoryEventCount: Number.isSafeInteger(memoryEvent?.count) ? memoryEvent.count : 0,
        replyLength: state.lastReplyLength,
        durationMs: Date.now() - before.timestamp
      };
    }

    if (!state.inputDisabled && (state.sessionState === "error" || telemetry.failed)) {
      throw new Error("provider_chat_failed");
    }

    await sleep(250);
  }

  const telemetry = readTelemetrySince(telemetryCursor);
  throw new Error(`send_timeout:${JSON.stringify({
    memoryEventDelta: Math.max(0, lastState.memoryEventCount - before.memoryEventCount),
    replyDelta: Math.max(0, lastState.replyCount - before.replyCount),
    inputDisabled: Boolean(lastState.inputDisabled),
    sessionState: lastState.sessionState,
    started: Boolean(telemetry.started)
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
        memoryEventCount: window.__p220fMemoryEvents?.length ?? 0,
        sessionState: sessionNote?.dataset.state ?? ""
      };
    })()
  `);
}

async function readMemoryEvent(page, index) {
  return evaluate(page, `window.__p220fMemoryEvents?.[${JSON.stringify(index)}] ?? null`);
}

function readTelemetryCursor() {
  return readTelemetryEvents().length;
}

function readTelemetrySince(cursor) {
  const events = readTelemetryEvents().slice(cursor);
  const started = events
    .filter((event) => event.type === "chat_stream_started")
    .map((event) => sanitizeContextBudgetTelemetry(event.payload))
    .find(Boolean) ?? null;

  return {
    started,
    failed: events.some((event) => event.type === "chat_stream_failed")
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

function sanitizeContextBudgetTelemetry(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    originalMessageCount: safeInteger(payload.originalMessageCount),
    providerMessageCount: safeInteger(payload.providerMessageCount),
    compressed: Boolean(payload.compressed),
    summaryMessageCount: safeInteger(payload.summaryMessageCount),
    summarizedMessageCount: safeInteger(payload.summarizedMessageCount),
    recentMessageCount: safeInteger(payload.recentMessageCount),
    memoryInjectionCount: safeInteger(payload.memoryInjectionCount)
  };
}

function summarizeMemoryStorage() {
  const memoryPath = join(context.appDataDir, "memory", "facts.json");

  if (!existsSync(memoryPath)) {
    return {
      exists: false,
      enabled: null,
      cardCount: 0,
      enabledCount: 0,
      compressionStates: {},
      injectionBudgetExceeded: false
    };
  }

  const storage = parseJson(readFileSync(memoryPath, "utf8"));
  const cards = Array.isArray(storage?.cards) ? storage.cards : [];
  const injectionCounts = cards
    .map((card) => Number(card.injectionCount))
    .filter((count) => Number.isSafeInteger(count));

  return {
    exists: Boolean(storage),
    enabled: typeof storage?.enabled === "boolean" ? storage.enabled : null,
    cardCount: cards.length,
    enabledCount: cards.filter((card) => card.enabled).length,
    compressionStates: countBy(cards.map((card) => card.compressionState).filter(Boolean)),
    injectedCount: cards.filter((card) => Number(card.injectionCount) > 0).length,
    maxInjectionCount: injectionCounts.length > 0 ? Math.max(...injectionCounts) : 0,
    injectionBudgetExceeded: cards.filter((card) => Number(card.injectionCount) > 0).length > 8
  };
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

function createSummary({
  ok,
  durationMs,
  providerReady,
  providerStatus,
  checks,
  caseResults,
  sendSummary,
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
    sendSummary,
    storageSummary,
    failureCategory
  });
}

function writeSafeSummary(summary, privateTexts) {
  const serialized = JSON.stringify(summary, null, 2);
  const privacyCheck = checkPrivacy(serialized, privateTexts);
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
  const finalPrivacyCheck = checkPrivacy(finalSerialized, privateTexts);
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
    readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]),
    serializedSummary
  ].join("\n");
  const exactPrivateTexts = privateTexts
    .filter((item) => typeof item === "string" && item.trim().length >= 4);
  const checks = {
    noPrivateExactTextInOutput: exactPrivateTexts.every((item) => !publicOutputText.includes(item)),
    noRawRequestOrSystemText: !/(provider request body|request body|full prompt|system prompt|messages"\s*:|"content"\s*:)/iu.test(publicOutputText),
    noFactContentLabels: !/(fact card body|fact card content)/iu.test(publicOutputText),
    noEnvOrAuthValue: !/(\.env\.local|Authorization|Bearer\s+\S+)/iu.test(publicOutputText),
    noLocalModelAbsolutePath: !/[A-Za-z]:\\[^\r\n]*(?:\.gguf|\\model\\)/iu.test(publicOutputText)
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks
  };
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

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : 0;
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

  if (/Target not found|Timed out waiting|Missing selector|Missing continue history button/.test(message)) {
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
