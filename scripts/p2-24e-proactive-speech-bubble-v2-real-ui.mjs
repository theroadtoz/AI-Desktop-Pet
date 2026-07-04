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
  setDialogueMode,
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-24e-proactive-speech-bubble-v2-real-ui",
  port: Number(process.env.P2_24E_CDP_PORT || 9606),
  env: {
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_24E_IDLE_INTERVAL_MS || "900"
  }
});

const safeLineIds = new Set([
  "startup_presence_ready",
  "startup_presence_soft",
  "startup_presence_focus",
  "idle_presence_soft",
  "idle_presence_default",
  "idle_presence_focus",
  "idle_presence_quiet",
  "idle_presence_work",
  "idle_presence_game",
  "idle_presence_reading",
  "mode_presence_focus",
  "mode_presence_work",
  "mode_presence_game",
  "mode_presence_reading"
]);

const startupLineIds = new Set([
  "startup_presence_ready",
  "startup_presence_soft",
  "startup_presence_focus"
]);

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider 请求正文|完整 prompt|fact card|用户全文|AI 全文/i,
  /p2-24e-private/i,
  /model\.gguf.*[A-Z]:\\/i
];

async function main() {
  log(context, `runDir=${context.runDir}`);
  const startedAt = Date.now();
  const checks = {};
  const observations = {};

  try {
    const { pet } = await startApp();

    const startupBubble = await waitForBubbleVisible(pet, {
      reason: "startup_presence",
      timeoutMs: 10_000
    });
    checks.startupBubbleAppears = startupBubble.state === "visible" &&
      startupBubble.reason === "startup_presence" &&
      startupLineIds.has(startupBubble.lineId);
    checks.startupTextSafe = inspectBubbleSafety(startupBubble).ok;
    checks.visualStyleConsistent = inspectBubbleVisualStyle(startupBubble).ok;
    checks.positionTopLeft = inspectBubblePosition(startupBubble).ok;
    observations.startupBubble = summarizeBubble(startupBubble);

    const startupCleared = await waitForBubbleHidden(pet, 10_000);
    checks.startupTimeoutClears = startupCleared.state === "hidden" && startupCleared.textLength === 0;

    const idleBubble = await waitForBubbleVisible(pet, {
      reason: "idle_presence",
      timeoutMs: 8_000
    });
    checks.idleBubbleAppears = idleBubble.reason === "idle_presence" &&
      safeLineIds.has(idleBubble.lineId) &&
      inspectBubbleSafety(idleBubble).ok;
    observations.idleBubble = summarizeBubble(idleBubble);

    const chat = await openChatFromPet(pet);
    const chatCleared = await waitForBubbleHidden(pet, 5_000);
    checks.chatOpenClears = chatCleared.state === "hidden" && chatCleared.textLength === 0;

    await setDialogueMode(chat, "reading");
    await hideChat(chat);

    const modeBubble = await waitForBubbleVisible(pet, {
      reason: "mode_presence",
      lineId: "mode_presence_reading",
      timeoutMs: 9_000
    });
    checks.modeAwareBubbleAppears = modeBubble.reason === "mode_presence" &&
      modeBubble.lineId === "mode_presence_reading" &&
      inspectBubbleSafety(modeBubble).ok;
    observations.modeBubble = summarizeBubble(modeBubble);

    const sleepChat = await openChatFromPet(pet);
    await setPresenceMode(sleepChat, "sleep");
    await hideChat(sleepChat);
    await sleep(2_200);
    const sleepState = await inspectBubble(pet);
    checks.sleepModeSuppresses = sleepState.state === "hidden" && sleepState.textLength === 0;
    observations.sleepState = summarizeBubble(sleepState);

    const privacyText = readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]);
    checks.noForbiddenText = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
    checks.telemetrySafeSummary = /"type":"proactive_speech_bubble"/.test(privacyText) &&
      /"lineId":/.test(privacyText) &&
      /"reason":/.test(privacyText) &&
      !/"text":|"message":|"content":/.test(privacyText);
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
    if (process.env.P2_24E_KEEP_TMP !== "1") {
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

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  return chat;
}

async function hideChat(chat) {
  await chat.cdp.send("Page.close");
  await sleep(750);
}

async function waitForBubbleVisible(pet, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const reasonCheck = options.reason
    ? ` && bubble.dataset.reason === ${JSON.stringify(options.reason)}`
    : "";
  const lineCheck = options.lineId
    ? ` && bubble.dataset.lineId === ${JSON.stringify(options.lineId)}`
    : "";

  await waitFor(pet, `
    (() => {
      const bubble = document.querySelector('#proactive-speech-bubble');
      return bubble?.dataset.state === 'visible'${reasonCheck}${lineCheck};
    })()
  `, { timeoutMs });
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
      const style = getComputedStyle(bubble);
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
        },
        style: {
          backgroundColor: style.backgroundColor,
          color: style.color,
          borderColor: style.borderColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          letterSpacing: style.letterSpacing,
          pointerEvents: style.pointerEvents
        }
      };
    })()
  `);
}

function inspectBubbleSafety(info) {
  const ok = (
    info.ariaHidden === (info.state === "visible" ? "false" : "true") &&
    safeLineIds.has(info.lineId) &&
    ["startup_presence", "idle_presence", "mode_presence"].includes(info.reason) &&
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
    rect: summarizeRect(rect),
    viewport
  };
}

function inspectBubbleVisualStyle(info) {
  const style = info.style;
  const letterSpacing = style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing);
  const ok = (
    style.pointerEvents === "none" &&
    style.backgroundColor === "rgb(255, 250, 240)" &&
    style.color === "rgb(75, 57, 40)" &&
    style.borderColor === "rgb(231, 220, 203)" &&
    Number.parseFloat(style.borderRadius) <= 8 &&
    Number.isFinite(letterSpacing) &&
    letterSpacing >= 0 &&
    !/gradient/i.test(style.backgroundColor)
  );

  return { ok };
}

function summarizeBubble(info) {
  return {
    state: info.state,
    lineId: info.lineId,
    reason: info.reason,
    textLength: info.textLength,
    ariaHidden: info.ariaHidden,
    rect: summarizeRect(info.rect),
    style: {
      pointerEvents: info.style.pointerEvents,
      borderRadius: info.style.borderRadius,
      letterSpacing: info.style.letterSpacing
    }
  };
}

function summarizeRect(rect) {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
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

main();
