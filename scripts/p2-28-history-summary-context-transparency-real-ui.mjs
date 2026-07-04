import { mkdirSync, writeFileSync } from "node:fs";
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
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const seededConversationId = crypto.randomUUID();
const seededConversationTitle = "P2-28 seeded long context";

const context = createRealUiRunContext({
  runName: "p2-28-history-summary-context-transparency-real-ui",
  port: Number(process.env.P2_28_CDP_PORT || 9628),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake"
  }
});

const privateTexts = [
  "P2-28_RAW_USER_SENTINEL 当前短上下文检查",
  "P2-28_FINAL_USER_SENTINEL 继续历史上下文检查",
  "sk-p228-secret-should-not-appear"
];

function prepareSeededHistory() {
  const historyDirectory = join(context.appDataDir, "history");
  mkdirSync(historyDirectory, { recursive: true });

  const now = Date.now();
  const messages = Array.from({ length: 12 }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const content = `P2-28_SEEDED_PRIVATE_SENTINEL_${String(index + 1).padStart(2, "0")}`;
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

async function startApp() {
  prepareSeededHistory();
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_000);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.chatApi?.onContextTransparency && window.chatApi?.onMemoryActivity)");
  await installTransparencyProbe(chat);
  return { pet, chat };
}

async function installTransparencyProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p228ContextTransparencyEvents = [];
      window.__p228MemoryActivityEvents = [];
      if (!window.__p228TransparencyProbeInstalled) {
        window.chatApi?.onContextTransparency((payload) => {
          window.__p228ContextTransparencyEvents.push({
            payload,
            note: document.querySelector("#chat-session-note")?.textContent ?? "",
            noteClass: document.querySelector("#chat-session-note")?.className ?? ""
          });
        });
        window.chatApi?.onMemoryActivity((payload) => {
          window.__p228MemoryActivityEvents.push({
            payload,
            note: document.querySelector("#chat-session-note")?.textContent ?? ""
          });
        });
        window.__p228TransparencyProbeInstalled = true;
      }
    })()
  `);
}

async function sendMessage(page, message) {
  const before = await evaluate(page, `({
    transparency: window.__p228ContextTransparencyEvents?.length ?? 0,
    activity: window.__p228MemoryActivityEvents?.length ?? 0
  })`);

  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const input = document.querySelector("#chat-input");
        const transparencyEvents = window.__p228ContextTransparencyEvents ?? [];
        const activityEvents = window.__p228MemoryActivityEvents ?? [];
        return {
          inputDisabled: Boolean(input?.disabled),
          transparencyCount: transparencyEvents.length,
          activityCount: activityEvents.length,
          lastTransparency: transparencyEvents.at(-1) ?? null,
          lastActivity: activityEvents.at(-1) ?? null,
          chatNote: document.querySelector("#chat-session-note")?.textContent ?? ""
        };
      })()
    `);

    if (!state.inputDisabled && state.transparencyCount > before.transparency) {
      return {
        context: state.lastTransparency,
        activity: state.activityCount > before.activity ? state.lastActivity : null,
        finalChatNote: state.chatNote
      };
    }

    await sleep(150);
  }

  throw new Error("send_timeout");
}

async function selectSeededHistory(page) {
  await openHistorySettings(page);
  await waitFor(page, "document.querySelectorAll('.conversation-select').length > 0", { timeoutMs: 10_000 });
  await evaluate(page, `
    (() => {
      const button = [...document.querySelectorAll(".conversation-select")]
        .find((item) => item.textContent?.includes(${JSON.stringify(seededConversationTitle)}));
      if (!button) {
        throw new Error("Missing seeded history conversation");
      }
      button.click();
    })()
  `);
  await waitFor(page, "document.querySelector('#settings-history-detail-page')?.hidden === false");
  await waitFor(page, "Boolean(document.querySelector('#history-context-preview'))");
  return evaluate(page, `
    (() => ({
      feedback: document.querySelector("#history-feedback")?.textContent ?? "",
      preview: document.querySelector("#history-context-preview")?.textContent ?? "",
      previewClass: document.querySelector("#history-context-preview")?.className ?? "",
      previewState: document.querySelector("#history-context-preview")?.dataset.state ?? "",
      detailText: document.querySelector("#history-detail")?.textContent ?? ""
    }))()
  `);
}

async function continueSeededHistory(page) {
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

async function safeUiSnapshot(page) {
  return evaluate(page, `
    (() => ({
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      chatNoteClass: document.querySelector("#chat-session-note")?.className ?? "",
      historyPreviewClass: document.querySelector("#history-context-preview")?.className ?? "",
      statusBoxCount: document.querySelectorAll(".status-box").length,
      selectionNoteCount: document.querySelectorAll(".selection-note").length,
      debugPanelCount: document.querySelectorAll(".context-debug-panel, .provider-message-dump, .activity-dashboard").length
    }))()
  `);
}

async function main() {
  log(context, "run_started safeSummaryOnly=true provider=fake");
  const checks = {};
  let finalSummary = null;

  try {
    const { chat } = await startApp();

    await openChatPage(chat);
    const short = await sendMessage(chat, privateTexts[0]);
    checks.shortEventObserved = short.context?.payload?.contextBudget?.compressed === false &&
      short.context?.payload?.contextBudget?.originalMessageCount === 1 &&
      short.context?.payload?.contextBudget?.providerMessageCount === 1;
    checks.shortUiTransparent = /当前短上下文|不需要安全摘要/.test(short.context?.note ?? "") &&
      !String(short.context?.note ?? "").includes("P2-28_RAW_USER_SENTINEL");
    checks.webSearchSafeDefaults = short.context?.payload?.webSearch?.included === false &&
      short.context?.payload?.webSearch?.citationCount === 0;

    const historyState = await selectSeededHistory(chat);
    checks.historyLocalBoundary = /打开查看不会自动发送给 Provider|历史仅保存在本机/.test(historyState.feedback) &&
      /不会自动发送/.test(historyState.preview);
    checks.historyContextPreview = historyState.previewClass.includes("status-box") &&
      /12 条消息不会自动发送/.test(historyState.preview) &&
      /较早消息会先变成安全摘要|预计不需要安全摘要/.test(historyState.preview) &&
      !/P2-28_SEEDED_PRIVATE_SENTINEL|providerMessages|prompt|requestVersion/.test(historyState.preview);

    await continueSeededHistory(chat);
    const compressed = await sendMessage(chat, privateTexts[1]);
    checks.compressedEventObserved = compressed.context?.payload?.contextBudget?.compressed === true &&
      compressed.context?.payload?.contextBudget?.summaryMessageCount === 1 &&
      compressed.context?.payload?.contextBudget?.summarizedMessageCount > 0 &&
      compressed.context?.payload?.contextBudget?.recentMessageCount <= 8;
    checks.compressedUiTransparent = /较早消息变成安全摘要|保留最近/.test(compressed.context?.note ?? "") &&
      !String(compressed.context?.note ?? "").includes("P2-28_FINAL_USER_SENTINEL");
    checks.memoryCountSafe = Number.isSafeInteger(compressed.context?.payload?.memory?.injectionCount) &&
      compressed.context.payload.memory.injectionCount >= 0;

    const ui = await safeUiSnapshot(chat);
    checks.existingUiSystem = short.context?.noteClass?.includes("selection-note") &&
      historyState.previewClass.includes("status-box") &&
      ui.statusBoxCount > 0 &&
      ui.selectionNoteCount > 0 &&
      ui.debugPanelCount === 0;
    checks.noDebugFieldsInUi = !/(providerMessages|originalMessageCount|requestVersion|safeQuery|snippet|prompt|API Key|P2-28_RAW_USER_SENTINEL|P2-28_FINAL_USER_SENTINEL|P2-28_SEEDED_PRIVATE_SENTINEL)/iu.test([
      short.context?.note ?? "",
      compressed.context?.note ?? "",
      historyState.preview,
      ui.chatNote
    ].join("\n"));

    const eventCounts = await evaluate(chat, `({
      transparency: window.__p228ContextTransparencyEvents?.length ?? 0,
      activity: window.__p228MemoryActivityEvents?.length ?? 0
    })`);
    checks.contextEventsObserved = eventCounts.transparency >= 2;
    checks.memoryActivityStillObserved = eventCounts.activity >= 2;

    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

    const safeResultBody = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      checks,
      eventCounts,
      shortContext: sanitizeTransparencyEvent(short.context?.payload),
      compressedContext: sanitizeTransparencyEvent(compressed.context?.payload),
      historyPreview: {
        className: historyState.previewClass,
        state: historyState.previewState,
        text: historyState.preview
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
    if (process.env.P2_28_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
}

function sanitizeTransparencyEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    contextBudget: {
      originalMessageCount: safeInteger(payload.contextBudget?.originalMessageCount),
      providerMessageCount: safeInteger(payload.contextBudget?.providerMessageCount),
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

function checkPrivacy(serializedSummary, publicText) {
  const output = `${publicText}\n${serializedSummary}`;
  const checks = {
    noPrivateExactTextInOutput: privateTexts.every((text) => !output.includes(text)),
    noRawRequestOrSystemText: !/(provider request body|request body|full prompt|system prompt|messages"\s*:|"content"\s*:)/iu.test(output),
    noFactContentLabels: !/(fact card body|fact card content|事实卡正文)/iu.test(output),
    noMcpQueryOrResults: !/(safeQuery|MCP query|MCP result|search result snippet|result body)/iu.test(output),
    noEnvOrAuthValue: !/(\.env\.local|Authorization|Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,})/iu.test(output),
    noLocalModelAbsolutePath: !/[A-Za-z]:\\[^\r\n]*(?:\.gguf|\\model\\)/iu.test(output)
  };

  return { ok: Object.values(checks).every(Boolean), checks };
}

function writeResult(summary) {
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  writeFileSync(context.resultPath, serialized, "utf8");
  console.log(serialized.trimEnd());
  log(context, `result=${context.resultPath}`);
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

await main();
