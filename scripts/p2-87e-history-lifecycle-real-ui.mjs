import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-87e-history-lifecycle-real-ui",
  port: Number(process.env.P2_87E_CDP_PORT || 9798)
});

let result = { ok: false, checks: {} };
try {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#history-retention-limit') && window.historyApi?.getRetentionLimit)");
  const checks = await evaluate(chat, `
    (async () => {
      const select = document.querySelector('#history-retention-limit');
      const save = document.querySelector('#save-history-retention-button');
      select.value = '100';
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const saved = await window.historyApi.getRetentionLimit();
      select.value = '500';
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const restored = await window.historyApi.getRetentionLimit();
      return {
        retentionControlVisible: document.querySelector('#history-retention-limit')?.value === '500',
        historyApiTrusted: saved === 100 && restored === 500,
        clearScopeVisible: document.querySelector('#clear-history-confirmation')?.textContent?.includes('事实卡、待复核候选或已忘记类型') === true,
        noSummaryBodyExposed: !document.body.textContent.includes('context_summary_kind=bundled_semantic_v1')
      };
    })()
  `);
  result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    screenshotResidue: findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir)).length
  };
  result.ok &&= result.screenshotResidue === 0;
} catch (error) {
  result = { ok: false, checks: {}, failure: error instanceof Error ? error.name : "unknown" };
} finally {
  await stopElectron(context);
  if (result.ok) cleanupRealUiRun(context);
}

console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
