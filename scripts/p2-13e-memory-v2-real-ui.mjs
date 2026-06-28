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
  saveWelcomeProfile,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-13e-memory-v2-real-ui",
  port: Number(process.env.P2_13E_CDP_PORT || 9473)
});

const forbiddenFactBodies = [
  "P2-13E legacy body sentinel",
  "P2-13E edited body sentinel",
  "P2-13E clear body sentinel A",
  "P2-13E clear body sentinel B"
];

function createLegacyCard() {
  return {
    id: crypto.randomUUID(),
    title: "P2-13E legacy fact",
    content: forbiddenFactBodies[0],
    tags: ["p2-13e", "legacy"],
    sourceConversationId: crypto.randomUUID(),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    enabled: true
  };
}

function seedLegacyMemoryStorage() {
  const memoryDirectory = join(context.appDataDir, "memory");
  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(join(memoryDirectory, "facts.json"), `${JSON.stringify({
    version: 1,
    enabled: false,
    cards: [createLegacyCard()]
  }, null, 2)}\n`, "utf8");
}

function readMemoryStorage() {
  const memoryPath = join(context.appDataDir, "memory", "facts.json");
  if (!existsSync(memoryPath)) {
    return { memoryPath, raw: "", storage: null };
  }

  const raw = readFileSync(memoryPath, "utf8");
  return { memoryPath, raw, storage: JSON.parse(raw) };
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_500);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  await saveWelcomeProfile(chat, { displayName: "P2-13E", preferredName: "P2-13E" });
  await installMemoryProbe(chat);
  return { pet, chat };
}

async function installMemoryProbe(page) {
  await evaluate(page, `
    (() => {
      window.__p213eMemoryEvents = [];
      if (!window.__p213eMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p213eMemoryEvents.push({ requestVersion: payload.requestVersion, count: payload.count });
        });
        window.__p213eMemoryProbeInstalled = true;
      }
    })()
  `);
}

async function clickLastUserRemember(page) {
  await evaluate(page, `
    (() => {
      const buttons = [...document.querySelectorAll(".message-user .message-action")];
      const button = buttons.at(-1);
      if (!button) throw new Error("Missing last user remember button");
      button.click();
    })()
  `);
  await sleep(250);
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "window.__p213eMemoryEvents.length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  await waitFor(page, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });
  await waitFor(page, `window.__p213eMemoryEvents.length > ${before}`, { timeoutMs: 5_000 });
  const events = await evaluate(page, "window.__p213eMemoryEvents");
  return events.at(-1);
}

async function safeMemorySnapshot(page) {
  return evaluate(page, `
    (() => {
      const cards = [...document.querySelectorAll(".memory-card")];
      const firstMeta = cards[0]?.querySelector(".memory-card-meta")?.textContent ?? "";
      return {
        cardCount: cards.length,
        nextStatus: document.querySelector("#memory-next-injection-status")?.textContent ?? "",
        nextStatusState: document.querySelector("#memory-next-injection-status")?.dataset.state ?? "",
        memoryButton: document.querySelector("#enable-memory-button")?.textContent ?? "",
        cardMetaHasSource: firstMeta.includes("来源："),
        cardMetaHasCategory: firstMeta.includes("分类："),
        cardMetaHasCreated: firstMeta.includes("创建："),
        cardMetaHasUpdated: firstMeta.includes("更新："),
        cardMetaHasUsage: firstMeta.includes("使用："),
        cardMetaHasStatus: firstMeta.includes("状态：")
      };
    })()
  `);
}

async function createCardThroughBridge(page, title, content, tag) {
  await evaluate(page, `
    window.memoryApi.createCard({
      title: ${JSON.stringify(title)},
      content: ${JSON.stringify(content)},
      tags: [${JSON.stringify(tag)}],
      sourceConversationId: crypto.randomUUID()
    })
  `);
}

function storageCardCount() {
  return readMemoryStorage().storage?.cards?.length ?? 0;
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
  seedLegacyMemoryStorage();

  const checks = {};
  const injectionResults = {};

  try {
    const { chat } = await startApp();

    await openMemorySettings(chat);
    await waitFor(chat, "document.querySelector('#memory-page')?.hidden === false");
    await waitFor(chat, "document.querySelectorAll('.memory-card').length === 1");
    let snapshot = await safeMemorySnapshot(chat);
    const migratedStorage = readMemoryStorage();
    checks.v1CardVisibleAfterMigration = snapshot.cardCount === 1;
    checks.v1MigratedToV2 = migratedStorage.storage?.version === 2 && storageCardCount() === 1;
    checks.metadataVisible = Boolean(
      snapshot.cardMetaHasSource &&
      snapshot.cardMetaHasCategory &&
      snapshot.cardMetaHasCreated &&
      snapshot.cardMetaHasUpdated &&
      snapshot.cardMetaHasUsage &&
      snapshot.cardMetaHasStatus
    );
    checks.defaultOffNextInjectionZero = snapshot.nextStatus.includes("注入 0 条") && snapshot.nextStatusState === "fallback";

    await typeText(chat, "#memory-search", "p2-13e");
    await waitFor(chat, "document.querySelectorAll('.memory-card').length === 1");
    await typeText(chat, "#memory-search", "missing-p2-13e");
    await waitFor(chat, "document.querySelectorAll('.memory-card').length === 0");
    checks.searchStillWorks = true;
    await typeText(chat, "#memory-search", "");

    await typeText(chat, ".memory-card .memory-title-input", "P2-13E edited fact");
    await typeText(chat, ".memory-card textarea", forbiddenFactBodies[1]);
    await typeText(chat, ".memory-card input:nth-of-type(2)", "p2-13e,edited");
    await click(chat, ".memory-card .button");
    await waitForStorage((storage) => storage?.cards?.[0]?.tags?.includes("edited") === true, "edited card");
    checks.editStillWorks = readMemoryStorage().storage?.cards?.[0]?.tags?.includes("edited") === true;

    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    snapshot = await safeMemorySnapshot(chat);
    checks.enabledNextInjectionOne = snapshot.nextStatus.includes("注入 1 条") && snapshot.nextStatusState === "ready";

    await openChatPage(chat);
    const enabledEvent = await sendMessage(chat, "P2-13E enabled injection check");
    injectionResults.enabled = enabledEvent?.count ?? null;
    const injectedCard = readMemoryStorage().storage?.cards?.[0];
    checks.injectionCountUpdated = enabledEvent?.count === 1 && injectedCard?.injectionCount === 1 && typeof injectedCard?.lastInjectedAt === "number";

    await openMemorySettings(chat);
    await waitFor(chat, "document.querySelector('.memory-card-meta')?.textContent.includes('1 次')");
    checks.usageMetadataVisibleAfterSend = true;

    await click(chat, ".memory-card .button-light");
    await waitFor(chat, "document.querySelector('.memory-card-meta')?.textContent.includes('已停用')");
    snapshot = await safeMemorySnapshot(chat);
    checks.disabledNextInjectionZero = snapshot.nextStatus.includes("注入 0 条") && snapshot.nextStatusState === "fallback";

    await openChatPage(chat);
    const disabledEvent = await sendMessage(chat, "P2-13E disabled injection check");
    injectionResults.disabled = disabledEvent?.count ?? null;
    checks.disabledDoesNotIncrement = disabledEvent?.count === 0 && readMemoryStorage().storage?.cards?.[0]?.injectionCount === 1;

    await openMemorySettings(chat);
    await click(chat, ".memory-card .button-danger");
    await waitFor(chat, "document.querySelector('.memory-card .delete-confirmation')?.hidden === false");
    await click(chat, ".memory-card .delete-confirmation .button-danger");
    await waitFor(chat, "document.querySelectorAll('.memory-card').length === 0");
    checks.deleteRemovesContentAndMetadata = storageCardCount() === 0 && !forbiddenFactBodies.some((body) => readMemoryStorage().raw.includes(body));

    await createCardThroughBridge(chat, "P2-13E clear fact A", forbiddenFactBodies[2], "clear");
    await createCardThroughBridge(chat, "P2-13E clear fact B", forbiddenFactBodies[3], "clear");
    await openMemorySettings(chat);
    await waitFor(chat, "document.querySelectorAll('.memory-card').length === 2");
    await click(chat, "#clear-memory-button");
    await waitFor(chat, "document.querySelector('#clear-memory-confirmation')?.hidden === false");
    await click(chat, "#confirm-clear-memory-button");
    await waitFor(chat, "document.querySelectorAll('.memory-card').length === 0");
    checks.clearRemovesContentAndMetadata = storageCardCount() === 0 && !forbiddenFactBodies.some((body) => readMemoryStorage().raw.includes(body));

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    checks.noForbiddenBodiesInLogs = !forbiddenFactBodies.some((body) => privacyText.includes(body));
    checks.providerIsFake = await evaluate(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
    checks.profileIsIsolated = readMemoryStorage().memoryPath.startsWith(context.appDataDir);

    const result = {
      ok: Object.values(checks).every(Boolean),
      provider: "fake",
      checks,
      injectionResults,
      memoryFile: {
        exists: existsSync(readMemoryStorage().memoryPath),
        version: readMemoryStorage().storage?.version ?? null,
        enabled: readMemoryStorage().storage?.enabled ?? null,
        cardCount: storageCardCount()
      }
    };

    writeFileSync(context.resultPath, JSON.stringify(result, null, 2));
    log(context, `result=${context.resultPath}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeFileSync(context.resultPath, JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      checks,
      injectionResults
    }, null, 2));
    log(context, `failed=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
  }
}

await main();
