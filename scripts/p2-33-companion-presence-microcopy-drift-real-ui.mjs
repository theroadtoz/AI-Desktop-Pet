import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  chatUiSelectors,
  cleanupRealUiRun,
  click,
  closeSettingsPage,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  getPageByUrlPart,
  openAdvancedSettings,
  openHistorySettings,
  openMemorySettings,
  openModelSettings,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-33-companion-presence-microcopy-drift-real-ui",
  port: Number(process.env.P2_33_CDP_PORT || 9563),
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake",
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
  }
});

const privateSentinel = "P2-33_PRIVATE_SENTINEL";
const sensitiveSecret = "sk-p233-secret-should-not-appear";

const companionForbiddenPattern =
  /requestVersion|providerMessages|contextBudget|capturedCount|skippedReason|injectionCount|originalMessageCount|recentMessageCount|summaryMessageCount|safeQuery|snippet|raw result|Provider 请求|Fake Provider|注入 0 条|安全摘要|完整 prompt|system prompt|memoryContext|fact card|expressionName|motion path|partId/iu;

const privacyForbiddenPattern =
  /P2-33_PRIVATE_SENTINEL|sk-p233-secret-should-not-appear|providerMessages|memoryContext|safeQuery|snippet|raw result|expressionName|motion path|partId/iu;

function textLength(value) {
  return typeof value === "string" ? value.length : 0;
}

function hasNoCompanionDrift(...values) {
  return !companionForbiddenPattern.test(values.filter(Boolean).join("\n"));
}

function hasNoPrivateOutput(value) {
  return !privacyForbiddenPattern.test(String(value ?? ""));
}

function summarizeText(value) {
  return {
    textLength: textLength(value),
    noCompanionDrift: hasNoCompanionDrift(value)
  };
}

function readTelemetryEvents() {
  const telemetryPath = `${context.appDataDir}\\logs\\renderer-telemetry.jsonl`;
  if (!existsSync(telemetryPath)) {
    return [];
  }

  return readFileSync(telemetryPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function openChat() {
  startElectron(context);
  await connectToElectron(context, 30_000);
  const pet = await getPageByUrlPart(context, "renderer/pet/index.html", 30_000);
  await waitFor(pet, "Boolean(window.petApi)", { timeoutMs: 10_000 });
  await sleep(800);
  const bubble = await evaluate(pet, `
    (() => {
      const node = document.querySelector("#proactive-speech-bubble");
      const text = node?.textContent ?? "";
      return {
        state: node?.dataset.state ?? "",
        reason: node?.dataset.reason ?? "",
        textLength: text.length,
        visible: Boolean(node) && node.hidden === false
      };
    })()
  `);
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await getPageByUrlPart(context, "renderer/chat/index.html", 30_000);
  await waitFor(chat, "Boolean(window.chatApi)", { timeoutMs: 10_000 });
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.length > 0", { timeoutMs: 10_000 });
  return { pet, chat, bubble };
}

async function sendMessage(chat, text) {
  await closeSettingsPage(chat);
  await typeText(chat, chatUiSelectors.chat.input, text);
  await click(chat, chatUiSelectors.chat.send);
  await waitFor(chat, "document.querySelector('#send-button')?.textContent !== '停止'", { timeoutMs: 20_000 });
  await sleep(300);
  return evaluate(chat, `
    (() => ({
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      memoryRibbon: document.querySelector("#memory-session-status")?.textContent ?? "",
      messageCount: document.querySelectorAll(".message").length
    }))()
  `);
}

async function readCoreSurfaces(chat) {
  return evaluate(chat, `
    (() => ({
      partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      memoryRibbon: document.querySelector("#memory-session-status")?.textContent ?? "",
      shelfEcho: document.querySelector("#shelf-action-echo")?.textContent ?? "",
      shelfEchoState: document.querySelector("#shelf-action-echo")?.dataset.state ?? "",
      statusBoxCount: document.querySelectorAll(".status-box").length,
      selectionNoteCount: document.querySelectorAll(".selection-note").length
    }))()
  `);
}

async function readMemorySurfaces(chat) {
  await openMemorySettings(chat);
  return evaluate(chat, `
    (() => ({
      feedback: document.querySelector("#memory-feedback")?.textContent ?? "",
      overview: document.querySelector("#memory-overview-status")?.textContent ?? "",
      nextInjection: document.querySelector("#memory-next-injection-status")?.textContent ?? "",
      safeStats: document.querySelector("#memory-safe-stats")?.textContent ?? "",
      ribbon: document.querySelector("#memory-session-status")?.textContent ?? "",
      statusBoxCount: document.querySelectorAll("#memory-page .status-box").length,
      selectionNoteCount: document.querySelectorAll("#memory-page .selection-note").length
    }))()
  `);
}

async function readHistorySurfaces(chat) {
  await openHistorySettings(chat);
  return evaluate(chat, `
    (() => ({
      feedback: document.querySelector("#history-feedback")?.textContent ?? "",
      preview: document.querySelector("#history-context-preview")?.textContent ?? "",
      statusBoxCount: document.querySelectorAll("#history-page .status-box").length,
      selectionNoteCount: document.querySelectorAll("#history-page .selection-note").length
    }))()
  `);
}

async function readTechnicalSurfaces(chat) {
  await openModelSettings(chat, { detail: false });
  const model = await evaluate(chat, `
    (() => ({
      title: document.querySelector("#provider-settings-title")?.textContent ?? "",
      providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
      partnerStatus: document.querySelector("#partner-status")?.textContent ?? ""
    }))()
  `);

  await openAdvancedSettings(chat);
  const advanced = await evaluate(chat, `
    (() => ({
      webSearchTitle: document.querySelector("#web-search-title")?.textContent ?? "",
      webSearchStatus: document.querySelector("#web-search-status")?.textContent ?? "",
      diagnosticNote: [...document.querySelectorAll("#settings-advanced-page .status-box, #settings-advanced-page .selection-note")]
        .map((node) => node.textContent ?? "")
        .join("\\n")
    }))()
  `);

  return { model, advanced };
}

function summarizeCompanionSurface(surface) {
  return Object.fromEntries(Object.entries(surface).map(([key, value]) => {
    if (typeof value !== "string") {
      return [key, value];
    }
    return [key, summarizeText(value)];
  }));
}

function surfaceText(surface) {
  return Object.values(surface).filter((value) => typeof value === "string").join("\n");
}

function summarizeTechnicalSurface(technical) {
  const joined = `${surfaceText(technical.model)}\n${surfaceText(technical.advanced)}`;
  return {
    modelTextLength: textLength(surfaceText(technical.model)),
    advancedTextLength: textLength(surfaceText(technical.advanced)),
    keepsAccurateTerms: /Provider|MCP|API Key|llama\.cpp|本地模型|诊断/u.test(joined),
    noPrivateOutput: hasNoPrivateOutput(joined)
  };
}

try {
  console.log("run_started safeSummaryOnly=true provider=fake");
  const { pet, chat, bubble } = await openChat();
  const checks = {};
  const observations = {};

  observations.startupBubble = {
    state: bubble.state,
    reason: bubble.reason,
    textLength: bubble.textLength,
    visible: bubble.visible
  };
  checks.proactiveBubbleSafe = (
    bubble.state === "hidden" ||
    (bubble.textLength > 0 && bubble.textLength <= 24)
  ) &&
    hasNoPrivateOutput(JSON.stringify(observations.startupBubble));

  const initial = await readCoreSurfaces(chat);
  checks.initialCompanionSurfacesLowNoise = hasNoCompanionDrift(
    initial.partnerStatus,
    initial.chatNote,
    initial.memoryRibbon,
    initial.shelfEcho
  ) && initial.statusBoxCount > 0 && initial.selectionNoteCount > 0;

  await openMemorySettings(chat);
  await click(chat, "#enable-memory-button");
  await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'", { timeoutMs: 10_000 });
  const captured = await sendMessage(chat, `以后请叫我 P233馆长，${privateSentinel}`);
  const injected = await sendMessage(chat, "继续检查 P2-33 记忆和状态线");
  const sensitive = await sendMessage(chat, `我的 API Key 是 ${sensitiveSecret}，只用于 P2-33 敏感跳过检查`);

  checks.chatRhythmUsesCompanionMicrocopy =
    /她把记忆轻轻归好|她带着已允许的记忆靠近|她带着 1 条已允许的记忆靠近/.test(captured.chatNote + captured.memoryRibbon) &&
    /她带着已允许的记忆靠近|她带着 1 条已允许的记忆靠近|她把长聊收拢成轻便脉络/.test(injected.chatNote + injected.memoryRibbon) &&
    /她把敏感部分先放下/.test(sensitive.chatNote + sensitive.memoryRibbon);
  checks.chatRhythmNoDebugFields = hasNoCompanionDrift(
    captured.chatNote,
    captured.memoryRibbon,
    injected.chatNote,
    injected.memoryRibbon,
    sensitive.chatNote,
    sensitive.memoryRibbon
  );

  const memory = await readMemorySurfaces(chat);
  checks.memorySurfacesCompanionSafe = hasNoCompanionDrift(
    memory.feedback,
    memory.overview,
    memory.nextInjection,
    memory.ribbon
  ) && memory.statusBoxCount > 0 && memory.selectionNoteCount > 0;
  checks.memorySurfaceKeepsReadableCounts = /\d+|没有|不会|轻装|记忆/u.test(surfaceText(memory));

  const history = await readHistorySurfaces(chat);
  checks.historySurfacesCompanionSafe = hasNoCompanionDrift(history.feedback, history.preview) &&
    history.statusBoxCount > 0 &&
    /本机|不会自动发送|轻便脉络|短聊天/u.test(surfaceText(history));

  const technical = await readTechnicalSurfaces(chat);
  checks.technicalSurfacesKeepAccurateTerms = summarizeTechnicalSurface(technical).keepsAccurateTerms;
  checks.technicalSurfacesNoPrivateOutput = summarizeTechnicalSurface(technical).noPrivateOutput;

  await evaluate(pet, `
    (() => {
      window.petApi?.reportTelemetry("pet_interaction_action_started", {
        type: "headPat",
        reason: "p2_33_microcopy_drift",
        durationMs: 1
      });
    })()
  `);
  await waitFor(chat, "document.querySelector('#shelf-action-echo')?.textContent.includes('小动作：')", { timeoutMs: 8_000 });
  const shelfActive = await readCoreSurfaces(chat);
  checks.shelfEchoCompanionSafe = /小动作：/.test(shelfActive.shelfEcho) &&
    !/p2_33_microcopy_drift|durationMs|reason|type|expressionName|motion|partId/.test(shelfActive.shelfEcho);

  const telemetryEvents = readTelemetryEvents();
  checks.telemetrySummarySafe = !/expressionName|motionPath|partId|P2-33_PRIVATE_SENTINEL|sk-p233-secret/iu.test(JSON.stringify(telemetryEvents));

  const residueBeforeCleanup = findScreenshotResidue(context).filter((item) => !item.includes(context.runParentDir));
  checks.noScreenshotResidue = residueBeforeCleanup.length === 0;

  const safeBody = {
    ok: false,
    safeSummaryOnly: true,
    provider: "fake",
    checks,
    observations,
    surfaces: {
      initial: summarizeCompanionSurface(initial),
      captured: {
        chatNote: summarizeText(captured.chatNote),
        memoryRibbon: summarizeText(captured.memoryRibbon),
        messageCount: captured.messageCount
      },
      injected: {
        chatNote: summarizeText(injected.chatNote),
        memoryRibbon: summarizeText(injected.memoryRibbon),
        messageCount: injected.messageCount
      },
      sensitive: {
        chatNote: summarizeText(sensitive.chatNote),
        memoryRibbon: summarizeText(sensitive.memoryRibbon),
        messageCount: sensitive.messageCount
      },
      memory: summarizeCompanionSurface(memory),
      history: summarizeCompanionSurface(history),
      shelfActive: summarizeCompanionSurface({
        shelfEcho: shelfActive.shelfEcho,
        shelfEchoState: shelfActive.shelfEchoState
      }),
      technical: summarizeTechnicalSurface(technical)
    },
    residueBeforeCleanup: residueBeforeCleanup.length,
    telemetryEventCount: telemetryEvents.length
  };

  const privacyText = readPrivacyCheckText(context);
  const resultText = JSON.stringify(safeBody);
  checks.privacyOutputSafe = hasNoPrivateOutput(resultText) && hasNoPrivateOutput(privacyText);
  safeBody.ok = Object.values(checks).every(Boolean);

  writeFileSync(context.resultPath, `${JSON.stringify(safeBody, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(safeBody, null, 2));

  if (!safeBody.ok) {
    throw new Error(`P2-33 microcopy drift checks failed: ${JSON.stringify(checks)}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(context.resultPath, `${JSON.stringify({
    ok: false,
    safeSummaryOnly: true,
    errorName: error instanceof Error ? error.name : "Error",
    errorLength: message.length
  }, null, 2)}\n`, "utf8");
  console.error(message);
  process.exitCode = 1;
} finally {
  await stopElectron(context);
  if (process.env.P2_33_KEEP_TMP !== "1") {
    cleanupRealUiRun(context);
  }
}
