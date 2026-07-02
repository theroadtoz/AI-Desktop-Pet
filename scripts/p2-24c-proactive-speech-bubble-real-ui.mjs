import { writeFileSync } from "node:fs";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-24c-proactive-speech-bubble-real-ui",
  port: Number(process.env.P2_24C_CDP_PORT || 9604)
});

const safeLines = new Set([
  "我在这里，慢慢来。",
  "准备好了，陪你一会儿。",
  "先把呼吸放慢一点。"
]);

const safeLineIds = new Set([
  "startup_presence_ready",
  "startup_presence_soft",
  "startup_presence_focus"
]);

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider 请求正文|完整 prompt|fact card|用户全文|AI 全文/i,
  /p2-24c-private/i
];

async function main() {
  log(context, `runDir=${context.runDir}`);
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    const firstRun = await startApp();
    const firstBubble = await waitForBubbleVisible(firstRun.pet);
    const firstSafety = inspectBubbleSafety(firstBubble);
    const firstPosition = inspectBubblePosition(firstBubble);

    checks.bubbleAppeared = firstBubble.state === "visible";
    checks.textShortAndSafe = firstSafety.ok;
    checks.positionTopLeft = firstPosition.ok;
    observations.firstBubble = {
      lineId: firstBubble.lineId,
      reason: firstBubble.reason,
      textLength: firstBubble.textLength,
      rect: firstPosition.rect,
      viewport: firstPosition.viewport
    };

    await evaluate(firstRun.pet, "window.petApi?.openChat()");
    await waitForWindow(context, "renderer/chat/index.html");
    const chatCleared = await waitForBubbleHidden(firstRun.pet, 5_000);
    checks.chatOpenClears = chatCleared.state === "hidden" && chatCleared.textLength === 0;
    observations.chatClear = {
      state: chatCleared.state,
      textLength: chatCleared.textLength
    };

    await stopElectron(context);
    await sleep(1_200);

    const secondRun = await startApp();
    const secondBubble = await waitForBubbleVisible(secondRun.pet);
    const timeoutCleared = await waitForBubbleHidden(secondRun.pet, 10_000);
    checks.timeoutClears = secondBubble.state === "visible" &&
      timeoutCleared.state === "hidden" &&
      timeoutCleared.textLength === 0;
    observations.timeoutClear = {
      lineId: secondBubble.lineId,
      visibleTextLength: secondBubble.textLength,
      finalState: timeoutCleared.state,
      finalTextLength: timeoutCleared.textLength
    };

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]);
    checks.noForbiddenText = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidueBeforeCleanup = residueBeforeCleanup.length === 0;

    const summary = {
      ok: Object.values(checks).every(Boolean),
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      checks,
      observations
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const summary = {
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      checks,
      observations,
      failureCategory: classifyError(error)
    };

    writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_24C_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitFor(pet, "Boolean(document.querySelector('#proactive-speech-bubble'))");
  return { pet };
}

async function waitForBubbleVisible(pet, timeoutMs = 10_000) {
  await waitFor(pet, "document.querySelector('#proactive-speech-bubble')?.dataset.state === 'visible'", { timeoutMs });
  return inspectBubble(pet);
}

async function waitForBubbleHidden(pet, timeoutMs = 10_000) {
  await waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'hidden' && (bubble.textContent ?? '').length === 0;
    })()
  `, { timeoutMs });
  return inspectBubble(pet);
}

async function inspectBubble(pet) {
  return evaluate(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      if (!bubble) throw new Error('Missing proactive speech bubble');
      const rect = bubble.getBoundingClientRect();
      const text = bubble.textContent ?? '';
      return {
        state: bubble.dataset.state ?? '',
        lineId: bubble.dataset.lineId ?? '',
        reason: bubble.dataset.reason ?? '',
        text,
        textLength: [...text].length,
        ariaHidden: bubble.getAttribute('aria-hidden'),
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      };
    })()
  `);
}

function inspectBubbleSafety(info) {
  const ok = (
    info.state === "visible" &&
    info.ariaHidden === "false" &&
    info.reason === "startup_presence" &&
    safeLineIds.has(info.lineId) &&
    safeLines.has(info.text) &&
    info.textLength > 0 &&
    info.textLength <= 16 &&
    !forbiddenOutputPatterns.some((pattern) => pattern.test(info.text))
  );

  return { ok };
}

function inspectBubblePosition(info) {
  const rect = info.rect;
  const viewport = info.viewport;
  const ok = (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.left <= viewport.width * 0.35 &&
    rect.top <= viewport.height * 0.24 &&
    rect.right <= viewport.width * 0.68 &&
    rect.bottom <= viewport.height * 0.36
  );

  return {
    ok,
    rect: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    viewport
  };
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out/i.test(message)) {
    return "timeout";
  }
  if (/Screenshot residue/i.test(message)) {
    return "screenshot_residue";
  }
  return "script_failed";
}

await main();
