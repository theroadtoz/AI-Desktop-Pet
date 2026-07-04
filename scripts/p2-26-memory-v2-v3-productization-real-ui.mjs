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
  runName: "p2-26-memory-v2-v3-productization-real-ui",
  port: Number(process.env.P2_26_CDP_PORT || 9626)
});

const privateTexts = [
  "P2-26 manual title sentinel",
  "P2-26 manual body sentinel",
  "p2-26-private-tag",
  "P2-26_RAW_USER_SENTINEL",
  "sk-p226-secret-should-not-appear"
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
    disabledCards: cards.filter((card) => card.enabled === false).length,
    keyCount: cards.filter((card) => card.importance === "key").length,
    generalCount: cards.filter((card) => card.importance === "general").length,
    autoCount: cards.filter((card) => card.sourceType === "auto-local-heuristic" || card.sourceType === "auto-local-model").length,
    manualCount: cards.filter((card) => card.sourceType === "manual-chat").length,
    budgetedCount: cards.filter((card) => card.compressionState === "budgeted").length
  };
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_200);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.memoryApi?.getSummary)");
  await saveWelcomeProfile(chat, { displayName: "P2-26", preferredName: "P2-26" });
  await installMemoryProbe(chat);
  return { pet, chat };
}

async function installMemoryProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p226MemoryEvents = [];
      if (!window.__p226MemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p226MemoryEvents.push({ requestVersion: payload.requestVersion, count: payload.count });
        });
        window.__p226MemoryProbeInstalled = true;
      }
    })()
  `);
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "window.__p226MemoryEvents.length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const input = document.querySelector("#chat-input");
        const events = window.__p226MemoryEvents ?? [];
        return {
          inputDisabled: Boolean(input?.disabled),
          memoryEventCount: events.length,
          lastMemoryEvent: events.at(-1) ?? null
        };
      })()
    `);

    if (!state.inputDisabled && state.memoryEventCount > before) {
      return state.lastMemoryEvent;
    }

    await sleep(150);
  }

  throw new Error("send_timeout");
}

async function createManualCard(page) {
  return evaluate(page, `
    window.memoryApi.createCard({
      title: "P2-26 manual title sentinel",
      content: "P2-26 manual body sentinel",
      tags: ["p2-26-private-tag"],
      sourceConversationId: crypto.randomUUID()
    })
  `);
}

async function safeUiSnapshot(page) {
  return evaluate(page, `
    (() => {
      const summary = window.memoryApi.getSummary();
      const cardCount = document.querySelectorAll(".memory-card").length;
      const overview = document.querySelector("#memory-overview-status");
      const nextStatus = document.querySelector("#memory-next-injection-status");
      const stats = document.querySelector("#memory-safe-stats");
      return Promise.resolve(summary).then((memorySummary) => ({
        memorySummary,
        cardCount,
        overviewState: overview?.dataset.state ?? "",
        overviewTextLength: overview?.textContent?.length ?? 0,
        nextStatusState: nextStatus?.dataset.state ?? "",
        nextStatusTextLength: nextStatus?.textContent?.length ?? 0,
        statsText: stats?.textContent ?? "",
        activeFilter: document.querySelector("#memory-filter-nav .is-active")?.dataset.memoryFilter ?? "",
        emptyText: document.querySelector("#memory-list .selection-note")?.textContent ?? ""
      }));
    })()
  `);
}

async function setMemoryFilter(page, filter) {
  await click(page, `[data-memory-filter="${filter}"]`);
  return safeUiSnapshot(page);
}

async function waitForStorage(predicate, description) {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const summary = summarizeMemoryStorage();
    if (predicate(summary)) {
      return summary;
    }
    await sleep(150);
  }

  throw new Error(`memory_storage_timeout:${description}`);
}

async function main() {
  log(context, "run_started safeSummaryOnly=true");
  const checks = {};
  const filters = {};
  let sendSummary = null;
  let finalSummary = null;

  try {
    const { chat } = await startApp();

    await openMemorySettings(chat);
    let snapshot = await safeUiSnapshot(chat);
    checks.defaultOffSummary = snapshot.memorySummary.enabled === false &&
      snapshot.memorySummary.totalCards === 0 &&
      snapshot.memorySummary.injectableCount === 0 &&
      snapshot.overviewState === "fallback";

    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    snapshot = await safeUiSnapshot(chat);
    checks.enabledEmptyState = snapshot.memorySummary.enabled === true &&
      snapshot.memorySummary.totalCards === 0 &&
      snapshot.memorySummary.injectableCount === 0;

    const manualCard = await createManualCard(chat);
    await openChatPage(chat);
    await sendMessage(chat, "请用简体中文回复我 P2-26_RAW_USER_SENTINEL");
    await sendMessage(chat, "回复短一点");
    const beforeSensitive = await waitForStorage((summary) => summary.totalCards >= 3, "auto cards");
    await sendMessage(chat, "我的 API Key 是 sk-p226-secret-should-not-appear");
    await sleep(500);
    const afterSensitive = summarizeMemoryStorage();
    checks.sensitiveSkipped = afterSensitive.totalCards === beforeSensitive.totalCards;

    await evaluate(chat, `window.memoryApi.updateCard(${JSON.stringify(manualCard.id)}, { enabled: false })`);
    await openMemorySettings(chat);
    snapshot = await safeUiSnapshot(chat);
    checks.summaryCounts = snapshot.memorySummary.totalCards === 3 &&
      snapshot.memorySummary.enabledCards === 2 &&
      snapshot.memorySummary.disabledCards === 1 &&
      snapshot.memorySummary.injectableCount === 2 &&
      snapshot.memorySummary.injectableCount <= snapshot.memorySummary.injectionBudget &&
      snapshot.memorySummary.importanceCounts.key >= 1 &&
      snapshot.memorySummary.importanceCounts.general >= 1 &&
      snapshot.memorySummary.sourceTypeCounts["manual-chat"] === 1 &&
      snapshot.memorySummary.sourceTypeCounts["auto-local-heuristic"] === 2;
    checks.safeStatsVisible = snapshot.statsText.includes("关键") &&
      snapshot.statsText.includes("一般") &&
      snapshot.statsText.includes("自动") &&
      snapshot.statsText.includes("手动") &&
      snapshot.statsText.includes("已停用") &&
      snapshot.statsText.includes("预算排序");

    filters.all = (await setMemoryFilter(chat, "all")).cardCount;
    filters.key = (await setMemoryFilter(chat, "key")).cardCount;
    filters.general = (await setMemoryFilter(chat, "general")).cardCount;
    filters.auto = (await setMemoryFilter(chat, "auto")).cardCount;
    filters.manual = (await setMemoryFilter(chat, "manual")).cardCount;
    filters.disabled = (await setMemoryFilter(chat, "disabled")).cardCount;
    checks.filtersWork = filters.all === 3 &&
      filters.key >= 1 &&
      filters.general >= 1 &&
      filters.auto === 2 &&
      filters.manual === 1 &&
      filters.disabled === 1;

    await setMemoryFilter(chat, "all");
    await typeText(chat, "#memory-search", "missing-p2-26-filter");
    snapshot = await safeUiSnapshot(chat);
    checks.searchEmptyState = snapshot.cardCount === 0 && snapshot.emptyText.includes("没有匹配");
    await typeText(chat, "#memory-search", "");

    await openMemorySettings(chat, { detail: true });
    const detailSummary = await evaluate(chat, `
      (() => ({
        contentLength: document.querySelector("#memory-detail .status-box")?.textContent?.length ?? 0,
        metaLength: document.querySelector("#memory-detail .selection-note")?.textContent?.length ?? 0
      }))()
    `);
    checks.detailCanViewFactBody = detailSummary.contentLength > 0 && detailSummary.metaLength > 0;

    await openChatPage(chat);
    const finalEvent = await sendMessage(chat, "继续检查 P2-26 记忆总览");
    sendSummary = {
      memoryEventCount: Number.isSafeInteger(finalEvent?.count) ? finalEvent.count : 0
    };
    await openMemorySettings(chat);
    snapshot = await safeUiSnapshot(chat);
    checks.sendInjectionMatchesSummary = sendSummary.memoryEventCount === 2 &&
      snapshot.memorySummary.injectableCount === 2 &&
      sendSummary.memoryEventCount <= snapshot.memorySummary.injectionBudget;

    const publicText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    const resultBody = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      checks,
      filters,
      sendSummary,
      storageSummary: summarizeMemoryStorage(),
      residueBeforeCleanup: findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir)).length
    };
    const privacy = checkPrivacy(JSON.stringify(resultBody), publicText);
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
      filters,
      sendSummary,
      storageSummary: summarizeMemoryStorage()
    };
    writeResult(finalSummary);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_26_KEEP_TMP !== "1" && finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }
}

function checkPrivacy(serializedSummary, publicText) {
  const output = `${publicText}\n${serializedSummary}`;
  const checks = {
    noPrivateExactTextInOutput: privateTexts.every((text) => !output.includes(text)),
    noRawRequestOrSystemText: !/(provider request body|request body|full prompt|system prompt|messages"\s*:|"content"\s*:)/iu.test(output),
    noFactContentLabels: !/(fact card body|fact card content|事实卡正文)/iu.test(output),
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
