import {
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
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
  runName: "p2-87b-memory-sovereignty-real-ui",
  port: Number(process.env.P2_87B_CDP_PORT || 9787)
});

const privateTexts = [
  "P287B private title sentinel",
  "P287B private content sentinel",
  "p287b-private-tag"
];

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await sleep(1_000);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.memoryApi?.getSummary)");
  await saveWelcomeProfile(chat, { displayName: "P287B", preferredName: "P287B" });
  return chat;
}

async function memoryState(page) {
  return evaluate(page, `
    Promise.all([
      window.memoryApi.getSettings(),
      window.memoryApi.getSummary(),
      window.memoryApi.listCards(),
      window.memoryApi.listSuppressions()
    ]).then(([settings, summary, cards, suppressions]) => ({
      enabled: settings.enabled,
      totalCards: summary.totalCards,
      injectableCount: summary.injectableCount,
      cardCount: cards.length,
      suppressionCount: suppressions.length,
      suppressionShapeSafe: suppressions.every((item) =>
        Object.keys(item).sort().join(',') === 'category,createdAt,id' &&
        !Object.prototype.hasOwnProperty.call(item, 'namespace') &&
        !Object.prototype.hasOwnProperty.call(item, 'key')
      ),
      newDisabled: Boolean(document.querySelector('#new-memory-button')?.disabled),
      createNoteLength: document.querySelector('#memory-create-note')?.textContent?.length ?? 0,
      feedbackLength: document.querySelector('#memory-feedback')?.textContent?.length ?? 0,
      manualForgetButtonVisible: [...document.querySelectorAll('.memory-card')]
        .some((card) => card.textContent?.includes('手动从聊天保存') && card.textContent?.includes('忘记此类')),
      autoForgetButtonVisible: [...document.querySelectorAll('.memory-card')]
        .some((card) => card.textContent?.includes('本地启发式自动提取') && card.textContent?.includes('忘记此类'))
    }))
  `);
}

async function createManualCard(page) {
  await click(page, "#new-memory-button");
  await waitFor(page, "document.querySelector('#memory-draft-panel')?.hidden === false");
  await typeText(page, "#memory-draft-title", "P287B private title sentinel");
  await typeText(page, "#memory-draft-content", "P287B private content sentinel");
  await typeText(page, "#memory-draft-tags", "p287b-private-tag");
  await click(page, "#save-memory-draft-button");
  await waitFor(page, "document.querySelector('#memory-draft-panel')?.hidden === true");
}

async function sendForAutomaticCapture(page) {
  await openChatPage(page);
  await typeText(page, "#chat-input", "请用简体中文回复我");
  await click(page, "#send-button");
  await waitFor(page, "document.querySelector('#chat-input')?.disabled === false", 20_000);
  await openMemorySettings(page);
  await waitFor(page, "window.memoryApi.listCards().then((cards) => cards.some((card) => card.sourceType === 'auto-local-heuristic'))");
}

async function clickAutoAction(page, label) {
  await evaluate(page, `
    (() => {
      const card = [...document.querySelectorAll('.memory-card')]
        .find((item) => item.textContent?.includes('本地启发式自动提取'));
      const action = [...(card?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent === ${JSON.stringify(label)});
      if (!action) throw new Error('missing_auto_action');
      action.click();
    })()
  `);
  await sleep(250);
}

async function main() {
  const checks = {};
  let finalSummary = null;

  try {
    const chat = await startApp();
    await openMemorySettings(chat);
    let state = await memoryState(chat);
    checks.defaultOffHardGate = state.enabled === false && state.totalCards === 0 && state.injectableCount === 0 && state.newDisabled && state.createNoteLength > 0;
    checks.disabledCreateClosed = (await evaluate(chat, `window.memoryApi.createCard({
      title: 'P287B private title sentinel',
      content: 'P287B private content sentinel',
      tags: ['p287b-private-tag'],
      sourceConversationId: crypto.randomUUID()
    })`)).status === "disabled";

    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#new-memory-button')?.disabled === false");
    await createManualCard(chat);
    state = await memoryState(chat);
    checks.manualCreateAndNoManualForget = state.cardCount === 1 && !state.newDisabled && !state.manualForgetButtonVisible;

    await typeText(chat, ".memory-card select", "general");
    await evaluate(chat, `
      (() => {
        const card = [...document.querySelectorAll('.memory-card')]
          .find((item) => item.textContent?.includes('手动从聊天保存'));
        const save = [...(card?.querySelectorAll('button') ?? [])].find((item) => item.textContent === '保存');
        if (!save) throw new Error('missing_manual_save');
        save.click();
      })()
    `);
    await waitFor(chat, "window.memoryApi.listCards().then((cards) => cards.some((card) => card.sourceType === 'manual-chat' && card.importance === 'general' && card.managedByUser))");
    checks.classificationEditable = true;

    await sendForAutomaticCapture(chat);
    state = await memoryState(chat);
    checks.autoForgetAvailable = state.autoForgetButtonVisible;
    await clickAutoAction(chat, "忘记此类");
    await clickAutoAction(chat, "确认忘记");
    await waitFor(chat, "window.memoryApi.listSuppressions().then((items) => items.length === 1)");
    state = await memoryState(chat);
    checks.forgetSeparatesFromCards = state.suppressionCount === 1 && state.cardCount === 1;
    checks.rendererSuppressionOpaque = state.suppressionShapeSafe;

    await click(chat, "#memory-suppressions .button-light");
    await waitFor(chat, "window.memoryApi.listSuppressions().then((items) => items.length === 0)");
    checks.reallowWorks = true;

    await sendForAutomaticCapture(chat);
    await clickAutoAction(chat, "忘记此类");
    await clickAutoAction(chat, "确认忘记");
    await waitFor(chat, "window.memoryApi.listSuppressions().then((items) => items.length === 1)");
    await click(chat, "#clear-memory-suppressions-button");
    await click(chat, "#confirm-clear-memory-suppressions-button");
    await waitFor(chat, "window.memoryApi.listSuppressions().then((items) => items.length === 0)");
    state = await memoryState(chat);
    checks.clearScopesSeparated = state.cardCount === 1 && state.suppressionCount === 0;

    const publicText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    const result = {
      provider: "fake",
      checks,
      ui: {
        finalCardCount: state.cardCount,
        finalSuppressionCount: state.suppressionCount,
        finalInjectionCount: state.injectableCount,
        feedbackVisible: state.feedbackLength > 0
      },
      screenshotResidue: findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir)).length
    };
    const serialized = JSON.stringify(result);
    checks.privacyOutputSafe = privateTexts.every((text) => !serialized.includes(text) && !publicText.includes(text));
    checks.noScreenshotResidue = result.screenshotResidue === 0;
    finalSummary = { ...result, ok: Object.values(checks).every(Boolean) };
  } catch (error) {
    finalSummary = {
      provider: "fake",
      checks,
      ok: false,
      failure: error instanceof Error ? error.name : "unknown_error"
    };
  } finally {
    await stopElectron(context);
    if (finalSummary?.ok) {
      cleanupRealUiRun(context);
    }
  }

  console.log(JSON.stringify(finalSummary));
  if (!finalSummary.ok) process.exitCode = 1;
}

await main();
