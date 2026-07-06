import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const context = createRealUiRunContext({
  runName: "p2-27-memory-activity-rhythm-companion-feedback-real-ui",
  port: Number(process.env.P2_27_CDP_PORT || 9627)
});

const privateTexts = [
  "P2-27_RAW_USER_SENTINEL",
  "P2-27_LONG_PRIVATE_SENTINEL",
  "P2-27完整原文不能出现在活动反馈",
  "sk-p227-secret-should-not-appear",
  "P2-27 fact card body sentinel"
];

function readMemoryStorage() {
  const memoryPath = join(context.appDataDir, "memory", "facts.json");
  if (!existsSync(memoryPath)) {
    return { exists: false, storage: null };
  }

  return { exists: true, storage: JSON.parse(readFileSync(memoryPath, "utf8")) };
}

function summarizeMemoryStorage() {
  const storage = readMemoryStorage().storage;
  const cards = Array.isArray(storage?.cards) ? storage.cards : [];

  return {
    exists: Boolean(storage),
    enabled: typeof storage?.enabled === "boolean" ? storage.enabled : null,
    totalCards: cards.length,
    enabledCards: cards.filter((card) => card.enabled === true).length,
    keyCount: cards.filter((card) => card.importance === "key").length,
    generalCount: cards.filter((card) => card.importance === "general").length
  };
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_200);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.chatApi?.onMemoryActivity && window.memoryApi?.getSummary)");
  await saveWelcomeProfile(chat, { displayName: "P2-27", preferredName: "P2-27" });
  await installMemoryActivityProbe(chat);
  return { pet, chat };
}

async function installMemoryActivityProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p227MemoryActivityEvents = [];
      window.__p227MemoryInjectionEvents = [];
      if (!window.__p227MemoryActivityProbeInstalled) {
        window.chatApi?.onMemoryActivity((payload) => {
          window.__p227MemoryActivityEvents.push(payload);
        });
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p227MemoryInjectionEvents.push(payload);
        });
        window.__p227MemoryActivityProbeInstalled = true;
      }
    })()
  `);
}

async function sendMessage(page, message) {
  const before = await evaluate(page, `({
    activity: window.__p227MemoryActivityEvents?.length ?? 0,
    injection: window.__p227MemoryInjectionEvents?.length ?? 0
  })`);
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const input = document.querySelector("#chat-input");
        const activityEvents = window.__p227MemoryActivityEvents ?? [];
        const injectionEvents = window.__p227MemoryInjectionEvents ?? [];
        return {
          inputDisabled: Boolean(input?.disabled),
          activityCount: activityEvents.length,
          injectionCount: injectionEvents.length,
          lastActivity: activityEvents.at(-1) ?? null,
          lastInjection: injectionEvents.at(-1) ?? null,
          chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
          memorySession: document.querySelector("#memory-session-status")?.textContent ?? ""
        };
      })()
    `);

    if (!state.inputDisabled && state.activityCount > before.activity && state.injectionCount > before.injection) {
      return {
        activity: state.lastActivity,
        injection: state.lastInjection,
        chatNote: state.chatNote,
        memorySession: state.memorySession
      };
    }

    await sleep(150);
  }

  throw new Error("send_timeout");
}

async function safeUiSnapshot(page) {
  return evaluate(page, `
    (() => ({
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      memoryFeedback: document.querySelector("#memory-feedback")?.textContent ?? "",
      memoryFeedbackState: document.querySelector("#memory-feedback")?.dataset.state ?? "",
      memoryOverview: document.querySelector("#memory-overview-status")?.textContent ?? "",
      memoryNextInjection: document.querySelector("#memory-next-injection-status")?.textContent ?? "",
      memorySession: document.querySelector("#memory-session-status")?.textContent ?? "",
      memorySessionClass: document.querySelector("#memory-session-status")?.className ?? "",
      chatNoteClass: document.querySelector("#chat-session-note")?.className ?? "",
      largeActivityCards: document.querySelectorAll(".memory-activity-card, .activity-dashboard, .memory-activity-panel").length,
      statusBoxCount: document.querySelectorAll(".status-box").length,
      selectionNoteCount: document.querySelectorAll(".selection-note").length
    }))()
  `);
}

async function waitForCompressedActivity(page) {
  for (let index = 0; index < 5; index += 1) {
    const result = await sendMessage(page, `长会话安全摘要检查 ${index} P2-27_LONG_PRIVATE_SENTINEL`);
    if (result.activity?.contextBudget?.compressed === true) {
      return result;
    }
  }

  throw new Error("compressed_activity_timeout");
}

async function main() {
  log(context, "run_started safeSummaryOnly=true");
  const checks = {};
  let finalSummary = null;
  let activityEventCount = 0;
  let injectionEventCount = 0;

  try {
    const { chat } = await startApp();

    await openChatPage(chat);
    const defaultOff = await sendMessage(chat, "默认关闭记忆检查 P2-27_RAW_USER_SENTINEL");
    checks.defaultOffFeedback = defaultOff.activity?.autoCapture?.skippedReason === "disabled" &&
      defaultOff.activity?.injection?.count === 0 &&
      /不会替你保存|没有带入记忆|她刚说完|她安静待着|她在旁边陪着/.test(defaultOff.chatNote);

    await openMemorySettings(chat);
    let snapshot = await safeUiSnapshot(chat);
    checks.settingsRecentDefaultOff = snapshot.memoryFeedback.includes("最近活动") &&
      /不会替你保存|没有带入记忆/.test(snapshot.memoryFeedback);

    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    await openChatPage(chat);
    const captured = await sendMessage(chat, "以后请叫我P227小夏，P2-27完整原文不能出现在活动反馈");
    checks.captureFeedback = captured.activity?.autoCapture?.capturedCount >= 1 &&
      /她刚记下|她整理了|她刚整理了记忆|她带上了已允许的记忆/.test(captured.chatNote) &&
      !captured.chatNote.includes("P2-27完整原文不能出现在活动反馈");

    const beforeSensitive = summarizeMemoryStorage().totalCards;
    const sensitive = await sendMessage(chat, "我的 API Key 是 sk-p227-secret-should-not-appear");
    const afterSensitive = summarizeMemoryStorage().totalCards;
    checks.sensitiveSkipFeedback = sensitive.activity?.autoCapture?.skippedReason === "sensitive" &&
      afterSensitive === beforeSensitive &&
      sensitive.chatNote.includes("她跳过了敏感内容") &&
      !sensitive.chatNote.includes("sk-p227-secret-should-not-appear");

    const injected = await sendMessage(chat, "继续检查 P2-27 记忆注入节奏");
    checks.injectionAligned = injected.activity?.injection?.count > 0 &&
      injected.injection?.count === injected.activity?.injection?.count &&
      (
        injected.chatNote.includes(`她这轮带上了 ${injected.activity.injection.count} 条已允许的记忆`) ||
        injected.chatNote.includes("她带上了已允许的记忆")
      );

    const compressed = await waitForCompressedActivity(chat);
    checks.compressedFeedback = compressed.activity?.contextBudget?.compressed === true &&
      /安全摘要|收束/.test(compressed.chatNote) &&
      !compressed.chatNote.includes("P2-27_LONG_PRIVATE_SENTINEL");

    await openMemorySettings(chat);
    snapshot = await safeUiSnapshot(chat);
    checks.settingsRecentActivity = snapshot.memoryFeedback.includes("最近活动") &&
      /她|安全摘要|收束|带上了/.test(snapshot.memoryFeedback);
    checks.existingUiSystem = snapshot.memorySessionClass.includes("status-box") &&
      snapshot.chatNoteClass.includes("selection-note") &&
      snapshot.statusBoxCount > 0 &&
      snapshot.selectionNoteCount > 0 &&
      snapshot.largeActivityCards === 0;

    const statusText = [
      snapshot.chatNote,
      snapshot.memoryFeedback,
      snapshot.memoryOverview,
      snapshot.memoryNextInjection,
      snapshot.memorySession
    ].join("\n");
    checks.noDebugFieldsInUi = !/(capturedCount|skippedReason|memoryContext|providerMessages|requestVersion|prompt|API Key|sk-p227|P2-27_RAW_USER_SENTINEL|P2-27_LONG_PRIVATE_SENTINEL|P2-27完整原文不能出现在活动反馈)/iu.test(statusText);

    const eventCounts = await evaluate(chat, `({
      activity: window.__p227MemoryActivityEvents?.length ?? 0,
      injection: window.__p227MemoryInjectionEvents?.length ?? 0
    })`);
    activityEventCount = eventCounts.activity;
    injectionEventCount = eventCounts.injection;
    checks.activityEventsObserved = activityEventCount >= 5 && injectionEventCount >= 5;

    const resultBody = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      checks,
      eventCounts: {
        activity: activityEventCount,
        injection: injectionEventCount
      },
      storageSummary: summarizeMemoryStorage(),
      residueBeforeCleanup: findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir)).length
    };
    const privacy = checkPrivacy(JSON.stringify(resultBody), readPrivacyCheckText(context, [
      "progress.log",
      "electron.stdout.log",
      "electron.stderr.log"
    ]));
    checks.privacyOutputSafe = privacy.ok;
    checks.noScreenshotResidue = resultBody.residueBeforeCleanup === 0;

    finalSummary = {
      ...resultBody,
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
      error: error instanceof Error ? error.message : String(error),
      checks,
      eventCounts: {
        activity: activityEventCount,
        injection: injectionEventCount
      },
      storageSummary: summarizeMemoryStorage()
    };
    writeResult(finalSummary);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_27_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
}

function checkPrivacy(serializedSummary, publicText) {
  const output = `${publicText}\n${serializedSummary}`;
  const checks = {
    noPrivateExactTextInOutput: privateTexts.every((text) => !output.includes(text)),
    noRawRequestOrSystemText: !/(provider request body|request body|full prompt|system prompt|messages"\s*:|"content"\s*:)/iu.test(output),
    noFactContentLabels: !/(fact card body|fact card content|事实卡正文|P2-27 fact card body sentinel)/iu.test(output),
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

await main();
