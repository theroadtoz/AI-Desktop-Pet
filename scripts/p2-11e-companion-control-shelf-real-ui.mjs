import { writeFileSync } from "node:fs";
import {
  checkLayout,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  getPageByUrlPart,
  log as logRun,
  readPrivacyCheckText,
  saveWelcomeProfile as saveWelcomeProfileWithHarness,
  sleep,
  startElectron,
  stopElectron,
  waitFor
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-11e-companion-control-shelf-real-ui",
  port: Number(process.env.P2_11E_CDP_PORT || 9534)
});
const { runParentDir, runDir, appDataDir, resultPath, port } = context;
const forbiddenTexts = [
  "sk-",
  "provider request body",
  "system prompt",
  "完整 prompt",
  ".env.local",
  "原始鼠标轨迹"
];

function log(message) {
  logRun(context, message);
}

async function openChat() {
  await connectToElectron(context);
  const pet = await getPageByUrlPart(context, "renderer/pet/index.html");
  await sleep(800);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await getPageByUrlPart(context, "renderer/chat/index.html");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  return { pet, chat };
}

async function saveWelcomeProfile(page) {
  await saveWelcomeProfileWithHarness(page, {
    displayName: "P2-11E 验收用户",
    preferredName: "馆长"
  });
}

async function setMode(cdp, modeId) {
  await click(cdp, `.mode-button[data-mode-id="${modeId}"]`);
  await waitFor(cdp, `document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

async function runFirstSession(checks) {
  startElectron(context);

  try {
    const handles = await openChat();
    const chat = handles.chat;
    const pet = handles.pet;

    checks.welcomeVisibleBeforeProfile = await evaluate(chat, "document.querySelector('#user-welcome-panel')?.hidden === false");
    await saveWelcomeProfile(chat);
    checks.shelfVisibleAfterProfile = await evaluate(chat, `
      (() => {
        const shelf = document.querySelector("#companion-control-shelf");
        return shelf?.hidden === false &&
          shelf.textContent.includes("模式") &&
          shelf.textContent.includes("配件：无配件") &&
          shelf.textContent.includes("大小：100%") &&
          shelf.textContent.includes("锁定：未锁定") &&
          shelf.textContent.includes("最近动作：等待中") &&
          document.querySelector("#shelf-action-echo")?.dataset.state === "idle";
      })()
    `);

    await setMode(chat, "reading");
    checks.modeSyncsShelfAndRibbon = await evaluate(chat, `
      (() => document.querySelector("#partner-status")?.textContent.includes("读书模式") &&
        document.querySelector("#dialogue-mode-controls .mode-button.is-active")?.dataset.modeId === "reading")()
    `);

    await click(chat, "#shelf-accessory-button");
    await waitFor(chat, "document.querySelector('#shelf-accessory-button')?.textContent.includes('眼镜')");
    checks.accessoryToggleSyncsShelf = await evaluate(chat, `
      document.querySelector("#shelf-accessory-button")?.textContent.includes("眼镜")
    `);

    await click(chat, "#shelf-scale-button");
    await evaluate(chat, `
      (() => {
        const input = document.querySelector("#pet-scale");
        input.value = "1.10";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#save-pet-scale-button").click();
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-scale-button')?.textContent.includes('110%')");
    checks.scaleSummaryUsesSettingsPath = await evaluate(chat, `
      document.querySelector("#pet-scale-value")?.textContent.includes("1.10") ||
        document.querySelector("#pet-scale-value")?.value.includes("1.10")
    `);
    await click(chat, "#settings-close-button");

    await click(chat, "#shelf-lock-button");
    await waitFor(chat, "document.querySelector('#shelf-lock-button')?.textContent.includes('已锁定')");
    checks.lockToggleSyncsShelf = await evaluate(chat, `
      document.querySelector("#shelf-lock-button")?.textContent.includes("已锁定")
    `);

    await click(chat, "#settings-button");
    checks.lockShortcutStillVisible = await evaluate(chat, `
      document.querySelector("#shortcut-list")?.textContent.includes("Tab+0")
    `);
    await click(chat, "#settings-close-button");

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_interaction_action_started", {
          type: "headPat",
          reason: "p2_11e_acceptance",
          durationMs: 1
        });
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.textContent.includes('刚刚摸头')");
    checks.actionEchoIsShortAndVisible = await evaluate(chat, `
      (() => {
        const text = document.querySelector("#shelf-action-echo")?.textContent ?? "";
        return text.includes("刚刚摸头") &&
          document.querySelector("#shelf-action-echo")?.dataset.state === "active" &&
          !text.includes("p2_11e_acceptance") &&
          !text.includes("durationMs");
      })()
    `);
    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_interaction_action_started", {
          type: "headPat",
          reason: "p2_11e_duplicate_acceptance",
          durationMs: 99
        });
      })()
    `);
    await sleep(400);
    checks.duplicateActionEchoIsStable = await evaluate(chat, `
      (() => {
        const echo = document.querySelector("#shelf-action-echo");
        const text = echo?.textContent ?? "";
        return text === "最近动作：刚刚摸头" &&
          echo?.dataset.state === "active" &&
          !text.includes("p2_11e_duplicate_acceptance") &&
          !text.includes("durationMs");
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.dataset.state === 'fading'", 7_000);
    checks.actionEchoFadesNaturally = await evaluate(chat, `
      (() => {
        const echo = document.querySelector("#shelf-action-echo");
        return echo?.dataset.state === "fading" &&
          echo.textContent.includes("安静陪伴中");
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.dataset.state === 'idle'", 6_000);
    checks.actionEchoReturnsToIdle = await evaluate(chat, `
      document.querySelector("#shelf-action-echo")?.textContent === "最近动作：等待中"
    `);

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_window_motion_feedback", {
          eventType: "window_shake_candidate",
          reason: "window_shake_feedback",
          feedbackType: "shake_light_feedback",
          result: "started"
        });
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.textContent.includes('刚刚被晃了一下')");
    checks.windowMotionEchoIsShort = await evaluate(chat, `
      document.querySelector("#shelf-action-echo")?.textContent.includes("刚刚被晃了一下")
    `);

    const desktopLayout = await checkLayout(chat, 420, 640);
    const narrowLayout = await checkLayout(chat, 360, 720);
    checks.desktopLayout = desktopLayout.ok;
    checks.narrowLayout = narrowLayout.ok;
    return { desktopLayout, narrowLayout };
  } finally {
    await stopElectron(context);
  }
}

async function runRestartSession(checks) {
  startElectron(context);

  try {
    const handles = await openChat();
    const chat = handles.chat;
    await waitFor(chat, "document.querySelector('#user-welcome-panel')?.hidden === true");
    checks.accessoryRestoresAfterRestart = await evaluate(chat, `
      document.querySelector("#shelf-accessory-button")?.textContent.includes("眼镜")
    `);
    checks.scaleRestoresAfterRestart = await evaluate(chat, `
      document.querySelector("#shelf-scale-button")?.textContent.includes("110%")
    `);
    return await evaluate(chat, `
      (() => ({
        partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
        shelfText: document.querySelector("#companion-control-shelf")?.textContent ?? "",
        providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
        memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? ""
      }))()
    `);
  } finally {
    await stopElectron(context);
  }
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const checks = {};
  const layout = await runFirstSession(checks);
  await sleep(800);
  const finalUi = await runRestartSession(checks);
  const textOutput = readPrivacyCheckText(context);
  checks.privacyOutput = forbiddenTexts.every((text) => !textOutput.includes(text));
  checks.noScreenshotResidueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(runParentDir)).length === 0;

  const result = {
    ok: Object.values(checks).every(Boolean),
    runDir,
    appDataDir,
    provider: "fake",
    port,
    checks,
    layout,
    finalUi,
    residue: findScreenshotResidue(context)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  log(`checks=${JSON.stringify(checks)}`);
  log(`finalUi=${JSON.stringify(finalUi)}`);
  log(`result=${JSON.stringify(result)}`);

  if (!result.ok) {
    throw new Error(`P2-11E real UI checks failed: ${JSON.stringify(checks)}`);
  }
}

main().catch((error) => {
  const result = {
    ok: false,
    runDir,
    appDataDir,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    residue: findScreenshotResidue(context)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(result.error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_11E_KEEP_TMP !== "1") {
    cleanupRealUiRun(context);
  }
});
