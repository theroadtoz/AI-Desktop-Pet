import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  openMemorySettings,
  saveWelcomeProfile,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-87d-memory-review-real-ui",
  port: Number(process.env.P2_87D_CDP_PORT || 9797)
});

let result = { ok: false, checks: {} };
try {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#memory-reviews') && window.memoryApi?.listReviews)");
  await saveWelcomeProfile(chat, { displayName: "P287D", preferredName: "P287D" });
  await openMemorySettings(chat);
  const checks = await evaluate(chat, `
    window.memoryApi.listReviews().then((reviews) => ({
      reviewEntryVisible: Boolean(document.querySelector('#memory-reviews')),
      reviewApiTrusted: Array.isArray(reviews),
      noReviewTextInStatus: !document.querySelector('#memory-reviews')?.textContent?.includes('sk-')
    }))
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
