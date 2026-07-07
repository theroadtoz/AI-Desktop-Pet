import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  saveWelcomeProfile,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const seededConversationId = crypto.randomUUID();
const seededConversationTitle = "P2-30 seeded long context";

const context = createRealUiRunContext({
  runName: "p2-30-daily-companion-contextual-rhythm-real-ui",
  port: Number(process.env.P2_30_CDP_PORT || 9630),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_30_IDLE_INTERVAL_MS || "900"
  }
});

const privateTexts = [
  "P2-30_RAW_USER_SENTINEL",
  "P2-30_SENSITIVE_SENTINEL",
  "P2-30_LONG_HISTORY_SENTINEL",
  "sk-p230-secret-should-not-appear"
];

function prepareSeededHistory() {
  const historyDirectory = join(context.appDataDir, "history");
  mkdirSync(historyDirectory, { recursive: true });

  const now = Date.now();
  const messages = Array.from({ length: 12 }, (_, index) => {
    const content = `P2-30_SEEDED_PRIVATE_SENTINEL_${String(index + 1).padStart(2, "0")}`;
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
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi && document.querySelector('#proactive-speech-bubble'))");
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.chatApi?.onMemoryActivity && window.chatApi?.onContextTransparency)");
  await saveWelcomeProfile(chat, { displayName: "P2-30", preferredName: "P2-30" });
  await installProbe(chat);
  return chat;
}

async function installProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p230ContextTransparencyEvents = [];
      window.__p230MemoryActivityEvents = [];
      if (!window.__p230RhythmProbeInstalled) {
        window.chatApi?.onContextTransparency((payload) => {
          window.__p230ContextTransparencyEvents.push({
            payload,
            note: document.querySelector("#chat-session-note")?.textContent ?? "",
            state: document.querySelector("#chat-session-note")?.dataset.state ?? ""
          });
        });
        window.chatApi?.onMemoryActivity((payload) => {
          window.__p230MemoryActivityEvents.push({
            payload,
            note: document.querySelector("#chat-session-note")?.textContent ?? "",
            state: document.querySelector("#chat-session-note")?.dataset.state ?? ""
          });
        });
        window.__p230RhythmProbeInstalled = true;
      }
    })()
  `);
}

async function sendMessage(page, message) {
  const before = await evaluate(page, `({
    context: window.__p230ContextTransparencyEvents?.length ?? 0,
    memory: window.__p230MemoryActivityEvents?.length ?? 0
  })`);

  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const contextEvents = window.__p230ContextTransparencyEvents ?? [];
        const memoryEvents = window.__p230MemoryActivityEvents ?? [];
        return {
          inputDisabled: Boolean(document.querySelector("#chat-input")?.disabled),
          contextCount: contextEvents.length,
          memoryCount: memoryEvents.length,
          lastContext: contextEvents.at(-1) ?? null,
          lastMemory: memoryEvents.at(-1) ?? null,
          finalNote: document.querySelector("#chat-session-note")?.textContent ?? "",
          finalNoteState: document.querySelector("#chat-session-note")?.dataset.state ?? ""
        };
      })()
    `);

    if (!state.inputDisabled && state.contextCount > before.context && state.memoryCount > before.memory) {
      return state;
    }

    await sleep(150);
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

async function main() {
  log(context, "run_started safeSummaryOnly=true provider=fake");
  const checks = {};
  const observations = {};
  let finalSummary = null;

  try {
    const { pet } = await startApp();

    const startupBubble = await waitForBubbleVisible(pet);
    observations.idleProactiveBubble = summarizeBubble(startupBubble);
    checks.idleProactiveRhythmSafe = startupBubble.state === "visible" &&
      ["startup_presence", "idle_presence"].includes(startupBubble.reason) &&
      startupBubble.textLength > 0 &&
      startupBubble.textLength <= 16;
    checks.proactiveBubbleStateObserved = readTelemetryEvents().some((event) =>
      (event.type === "pet_interaction_action_started" || event.type === "pet_interaction_action_skipped") &&
      event.payload?.reason === "state_proactive_bubble_visible" &&
      event.payload?.stateId === "proactive-bubble-visible"
    );

    const chat = await openChatFromPet(pet);
    await openChatPage(chat);
    const hiddenBubble = await waitForBubbleHidden(pet);
    const chatOpenSnapshot = await safeUiSnapshot(chat);
    const telemetryAfterChatOpen = readTelemetryEvents();
    checks.chatOpenClearsAndListen = hiddenBubble.state === "hidden" &&
      chatOpenSnapshot.chatNoteClass.includes("selection-note") &&
      telemetryAfterChatOpen.some((event) =>
        (event.type === "pet_interaction_action_started" || event.type === "pet_interaction_action_skipped") &&
        (event.payload?.reason === "chat_opened" || event.payload?.reason === "chat_input_focus") &&
        event.payload?.stateId === "listen"
      );

    const short = await sendMessage(chat, "短上下文节奏检查 P2-30_RAW_USER_SENTINEL");
    checks.shortContextTransparentLowNoise = short.lastContext?.payload?.contextBudget?.compressed === false &&
      short.lastContext?.payload?.memory?.injectionCount === 0 &&
      short.lastContext?.payload?.webSearch?.included === false &&
      /她刚说完|她在想怎么说/.test(short.finalNote) &&
      !/当前短上下文|不需要安全摘要|没有带入联网搜索引用|requestVersion|providerMessages|P2-30_RAW_USER_SENTINEL/.test(short.finalNote);

    await openMemorySettings(chat);
    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    await openChatPage(chat);
    const captured = await sendMessage(chat, "以后请叫我P230小夏，记忆节奏检查");
    const injected = await sendMessage(chat, "继续检查 P2-30 记忆注入节奏");
    await openMemorySettings(chat);
    const memorySnapshot = await safeUiSnapshot(chat);
    checks.memoryCaptureAndInjectionRhythm = captured.lastMemory?.payload?.autoCapture?.capturedCount > 0 &&
      /她把记忆轻轻归好|她带着已允许的记忆靠近/.test(captured.finalNote) &&
      injected.lastMemory?.payload?.injection?.count > 0 &&
      /她带着已允许的记忆靠近|她把长聊收拢成轻便脉络/.test(injected.finalNote) &&
      /最近活动：/.test(memorySnapshot.memoryFeedback) &&
      !/capturedCount|injectionCount|P230小夏/.test([captured.finalNote, injected.finalNote, memorySnapshot.memoryFeedback].join("\n"));

    await openChatPage(chat);
    const sensitive = await sendMessage(chat, "我的 API Key 是 sk-p230-secret-should-not-appear P2-30_SENSITIVE_SENTINEL");
    checks.sensitiveMemorySkipLowNoise = sensitive.lastMemory?.payload?.autoCapture?.skippedReason === "sensitive" &&
      sensitive.finalNote === "她把敏感部分先放下" &&
      !/sk-p230|P2-30_SENSITIVE_SENTINEL|skippedReason/.test(sensitive.finalNote);

    const historyState = await selectSeededHistory(chat);
    checks.historyLocalBoundaryKept = /不会自动发送|本机/.test(historyState.feedback + " " + historyState.preview) &&
      historyState.previewClass.includes("status-box") &&
      !/P2-30_SEEDED_PRIVATE_SENTINEL/.test(historyState.preview);
    await continueSeededHistory(chat);
    const compressed = await sendMessage(chat, "继续历史上下文节奏检查 P2-30_LONG_HISTORY_SENTINEL");
    checks.historyContinueCompressedRhythm = compressed.lastContext?.payload?.contextBudget?.compressed === true &&
      /她把长聊收拢成轻便脉络/.test(compressed.finalNote) &&
      !/P2-30_LONG_HISTORY_SENTINEL|P2-30_SEEDED_PRIVATE_SENTINEL|providerMessages|originalMessageCount/.test(compressed.finalNote);

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
      context: window.__p230ContextTransparencyEvents?.length ?? 0,
      memory: window.__p230MemoryActivityEvents?.length ?? 0
    })`);
    checks.contextAndMemoryEventsObserved = eventCounts.context >= 5 && eventCounts.memory >= 5;

    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

    const safeResultBody = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      checks,
      eventCounts,
      observations,
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
    };
    const privacy = checkPrivacy(JSON.stringify(safeResultBody), readPrivacyCheckText(context, [
      "progress.log",
      "electron.stdout.log",
      "electron.stderr.log"
    ]));
    checks.privacyOutputSafe = privacy.ok;

    finalSummary = {
      ...safeResultBody,
      ok: Object.values(checks).every(Boolean),
      checks,
      privacyChecks: privacy.checks
    };
    writeResult(finalSummary);

    if (!finalSummary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    finalSummary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      error: error instanceof Error ? error.message : String(error),
      checks
    };
    writeResult(finalSummary);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_30_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
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
      }
    }
  }

  return events;
}

function checkPrivacy(serializedSummary, publicText) {
  const output = `${publicText}\n${serializedSummary}`;
  const checks = {
    noPrivateExactTextInOutput: privateTexts.every((text) => !output.includes(text)),
    noRawRequestOrSystemText: !/(provider request body|request body|full prompt|system prompt|messages"\s*:|"content"\s*:)/iu.test(output),
    noFactContentLabels: !/(fact card body|fact card content|事实卡正文)/iu.test(output),
    noMcpQueryOrResults: !/(safeQuery|MCP query|MCP result|search query|search result snippet|result body|url"\s*:|title"\s*:|snippet"\s*:|domain"\s*:)/iu.test(output),
    noEnvOrAuthValue: !/(\.env\.local|Authorization|Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,})/iu.test(output),
    noLocalModelAbsolutePath: !/[A-Za-z]:\\[^\r\n]*(?:\.gguf|\\model\\)/iu.test(output)
  };

  return { ok: Object.values(checks).every(Boolean), checks };
}

function writeResult(summary) {
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  writeFileSync(context.resultPath, serialized, "utf8");
  console.log(serialized.trimEnd());
  log(context, "result_written");
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

await main();
