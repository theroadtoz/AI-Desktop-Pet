import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  log,
  openChatPage,
  openMemorySettings,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-14c-memory-auto-v1-real-ui",
  port: Number(process.env.P2_14C_CDP_PORT || 9484)
});

const rawUserSentinel = "P2-14C_RAW_USER_SENTINEL_SHOULD_NOT_APPEAR";
const secretSentinel = "sk-p214c-secret-should-not-appear";

function readMemoryStorage() {
  const memoryPath = join(context.appDataDir, "memory", "facts.json");
  if (!existsSync(memoryPath)) {
    return { memoryPath, raw: "", storage: null };
  }

  const raw = readFileSync(memoryPath, "utf8");
  return { memoryPath, raw, storage: JSON.parse(raw) };
}

function summarizeMemoryStorage() {
  const storage = readMemoryStorage().storage;
  const cards = Array.isArray(storage?.cards) ? storage.cards : [];
  return {
    exists: Boolean(storage),
    version: storage?.version ?? null,
    enabled: storage?.enabled ?? null,
    cardCount: cards.length,
    autoCount: cards.filter((card) => card.sourceType === "auto-local-heuristic").length,
    keyCount: cards.filter((card) => card.importance === "key").length,
    generalCount: cards.filter((card) => card.importance === "general").length,
    categories: [...new Set(cards.map((card) => card.category).filter(Boolean))].sort(),
    maxObservedCount: Math.max(0, ...cards.map((card) => Number(card.observedCount) || 0)),
    compressionStates: [...new Set(cards.map((card) => card.compressionState).filter(Boolean))].sort()
  };
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_500);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
  await waitFor(chat, "Boolean(window.chatApi?.sendMessage && window.memoryApi?.getSettings && window.configApi?.getProviderStatus)");
  await installMemoryProbe(chat);
  return { pet, chat };
}

async function installMemoryProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p214cMemoryEvents = [];
      if (!window.__p214cMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p214cMemoryEvents.push({ requestVersion: payload.requestVersion, count: payload.count });
        });
        window.__p214cMemoryProbeInstalled = true;
      }
    })()
  `);
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "window.__p214cMemoryEvents.length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const state = await readSendState(page);
    if (!state.inputDisabled && state.memoryEventCount > before) {
      return state.lastMemoryEvent;
    }
    await sleep(150);
  }

  throw new Error(`Send did not settle: ${JSON.stringify(await readSendState(page))}`);
}

async function readSendState(page) {
  return evaluate(page, `
    (() => {
      const input = document.querySelector("#chat-input");
      const send = document.querySelector("#send-button");
      const events = window.__p214cMemoryEvents ?? [];
      return {
        inputDisabled: Boolean(input?.disabled),
        sendText: send?.textContent ?? "",
        messageCount: document.querySelectorAll(".message").length,
        memoryEventCount: events.length,
        lastMemoryEvent: events.at(-1) ?? null,
        sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? "",
        memoryRibbonState: document.querySelector("#memory-session-status")?.dataset.state ?? ""
      };
    })()
  `);
}

async function safeMemorySnapshot(page) {
  return evaluate(page, `
    (() => {
      const cards = [...document.querySelectorAll(".memory-card")];
      const firstMeta = cards[0]?.querySelector(".memory-card-meta")?.textContent ?? "";
      const detailMeta = document.querySelector("#memory-detail .selection-note")?.textContent ?? "";
      return {
        cardCount: cards.length,
        memoryButton: document.querySelector("#enable-memory-button")?.textContent ?? "",
        nextStatus: document.querySelector("#memory-next-injection-status")?.textContent ?? "",
        firstMetaHasAutoSource: firstMeta.includes("来源：本地启发式自动提取"),
        firstMetaHasImportance: firstMeta.includes("重要性："),
        firstMetaHasKeyImportance: firstMeta.includes("重要性：关键"),
        firstMetaHasCategory: firstMeta.includes("分类："),
        firstMetaHasConfidence: firstMeta.includes("置信度："),
        firstMetaHasObserved: firstMeta.includes("观察："),
        firstMetaHasCompression: firstMeta.includes("压缩："),
        detailHasSource: detailMeta.includes("本地启发式自动提取"),
        detailHasConfidence: detailMeta.includes("置信度"),
        detailHasObserved: detailMeta.includes("观察"),
        detailHasCompression: detailMeta.includes("压缩")
      };
    })()
  `);
}

async function captureScreenshot(page, name) {
  const result = await page.cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  const screenshotPath = join(context.runDir, name);
  const bytes = Buffer.from(result.data, "base64");
  writeFileSync(screenshotPath, bytes);
  return { name, path: screenshotPath, bytes: bytes.length };
}

async function createBudgetCards(page, count) {
  await evaluate(page, `
    (async () => {
      for (let index = 0; index < ${JSON.stringify(count)}; index += 1) {
        await window.memoryApi.createCard({
          title: "P2-14C budget fact " + index,
          content: "P2-14C budget content " + index,
          tags: ["budget"],
          sourceConversationId: crypto.randomUUID()
        });
      }
      return true;
    })()
  `);
}

async function waitForStorage(predicate, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate(readMemoryStorage().storage)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for storage: ${description}`);
}

async function main() {
  log(context, `runDir=${context.runDir}`);
  const checks = {};
  const injectionResults = {};
  const screenshots = [];

  try {
    const { chat } = await startApp();

    await openMemorySettings(chat);
    let snapshot = await safeMemorySnapshot(chat);
    checks.defaultMemoryOff = snapshot.memoryButton.includes("开启记忆");

    await openChatPage(chat);
    const disabledEvent = await sendMessage(chat, `以后请叫我P214C小夏 ${rawUserSentinel}`);
    injectionResults.disabled = disabledEvent?.count ?? null;
    checks.disabledDoesNotAutoGenerate = disabledEvent?.count === 0 && summarizeMemoryStorage().cardCount === 0;

    await openMemorySettings(chat);
    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    checks.enableToggleWorks = true;

    await openChatPage(chat);
    await sendMessage(chat, "以后请叫我P214C小夏");
    await waitForStorage((storage) => (storage?.cards?.length ?? 0) >= 1, "auto addressing card");
    await openMemorySettings(chat);
    await waitFor(chat, "document.querySelectorAll('.memory-card').length >= 1");
    snapshot = await safeMemorySnapshot(chat);
    checks.autoCardSafeMetaVisible = Boolean(
      snapshot.firstMetaHasAutoSource &&
      snapshot.firstMetaHasImportance &&
      snapshot.firstMetaHasKeyImportance &&
      snapshot.firstMetaHasCategory &&
      snapshot.firstMetaHasConfidence &&
      snapshot.firstMetaHasObserved &&
      snapshot.firstMetaHasCompression
    );
    screenshots.push(await captureScreenshot(chat, "p2-14c-memory-settings.png"));

    await openMemorySettings(chat, { detail: true });
    snapshot = await safeMemorySnapshot(chat);
    checks.memoryDetailSafeMetaVisible = Boolean(
      snapshot.detailHasSource &&
      snapshot.detailHasConfidence &&
      snapshot.detailHasObserved &&
      snapshot.detailHasCompression
    );
    screenshots.push(await captureScreenshot(chat, "p2-14c-memory-detail.png"));
    checks.screenshotsCaptured = screenshots.length === 2 && screenshots.every((item) => item.bytes > 1_000);

    await openChatPage(chat);
    await sendMessage(chat, "请用简体中文回复我");
    await sendMessage(chat, "我希望桌宠贴近屏幕右侧");
    await waitForStorage((storage) => {
      const cards = storage?.cards ?? [];
      return cards.some((card) => card.importance === "key" && card.category === "language") &&
        cards.some((card) => card.importance === "general" && card.category === "pet_presentation");
    }, "key and general cards");
    const afterImportance = summarizeMemoryStorage();
    checks.keyAndGeneralDistinguished = afterImportance.keyCount >= 2 && afterImportance.generalCount >= 1;

    const countBeforeDuplicate = afterImportance.cardCount;
    await sendMessage(chat, "以后请用简体中文回复我");
    await waitForStorage((storage) => {
      const cards = storage?.cards ?? [];
      return cards.length === countBeforeDuplicate &&
        cards.some((card) => card.category === "language" && card.observedCount >= 2);
    }, "deduplicated language card");
    const afterDuplicate = summarizeMemoryStorage();
    checks.dedupMergePathTriggered = afterDuplicate.cardCount === countBeforeDuplicate &&
      afterDuplicate.maxObservedCount >= 2 &&
      afterDuplicate.compressionStates.includes("deduplicated");

    await openMemorySettings(chat);
    await createBudgetCards(chat, 10);
    await openChatPage(chat);
    const budgetEvent = await sendMessage(chat, "P2-14C budget trigger");
    injectionResults.budgeted = budgetEvent?.count ?? null;
    await waitForStorage((storage) => (storage?.cards ?? []).some((card) => card.compressionState === "budgeted"), "budget compression state");
    const afterBudget = summarizeMemoryStorage();
    checks.compressionBudgetPathTriggered = budgetEvent?.count === 8 && afterBudget.compressionStates.includes("budgeted");

    await sendMessage(chat, `我的 API Key 是 ${secretSentinel}`);
    await sleep(500);
    const memoryRaw = readMemoryStorage().raw;
    checks.noForbiddenTextInMemoryStore = !memoryRaw.includes(rawUserSentinel) && !memoryRaw.includes(secretSentinel);
    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    checks.noForbiddenTextInTelemetry = !privacyText.includes(rawUserSentinel) && !privacyText.includes(secretSentinel);
    checks.providerIsFake = await evaluate(chat, "window.configApi?.getProviderStatus().then((status) => status?.providerId === 'fake')");

    const result = {
      ok: Object.values(checks).every(Boolean),
      provider: "fake",
      checks,
      injectionResults,
      screenshots: screenshots.map((item) => ({ name: item.name, bytes: item.bytes })),
      memorySummary: summarizeMemoryStorage()
    };

    writeFileSync(context.resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    log(context, `result=${context.resultPath}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeFileSync(context.resultPath, `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      checks,
      injectionResults,
      memorySummary: summarizeMemoryStorage()
    }, null, 2)}\n`, "utf8");
    log(context, `failed=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
  }
}

await main();
