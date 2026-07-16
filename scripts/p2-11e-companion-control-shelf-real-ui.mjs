import { writeFileSync } from "node:fs";
import {
  checkLayout,
  cleanupRealUiRun,
  click,
  closeSettingsPage,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  getPageByUrlPart,
  log as logRun,
  openAdvancedSettings,
  openAppearanceSettings,
  readPrivacyCheckText,
  saveWelcomeProfile as saveWelcomeProfileWithHarness,
  setDialogueMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor
} from "./support/real-ui-harness.mjs";
import {
  PET_WINDOW_SHAKE_FEEDBACK_REASON,
  PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE,
  getPetInteractionActionSafeEchoMessage
} from "./support/pet-action-semantic-constants.mjs";

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
const ACCESSORY_CLASS_COUNT_PATTERN = /已选\s*(\d+)\s*类/u;
const MODEL_DETAIL_LEAK_PATTERN = /\b(?:Param[A-Za-z0-9_]*|Part[A-Za-z0-9_]*|PartOpacity)\b/u;
const HEAD_PAT_ACTION_TYPE = "headPat";
const HEAD_PAT_SAFE_ECHO_MESSAGE = getPetInteractionActionSafeEchoMessage(HEAD_PAT_ACTION_TYPE);

function log(message) {
  logRun(context, message);
}

function countSelectedAccessoryClasses(text) {
  const match = text.match(ACCESSORY_CLASS_COUNT_PATTERN);
  return match ? Number(match[1]) : null;
}

function hasModelDetailLeak(text) {
  return MODEL_DETAIL_LEAK_PATTERN.test(text);
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
    preferredName: "领长"
  });
}

async function setMode(cdp, modeId) {
  await setDialogueMode(cdp, modeId);
}

async function readAccessoryEntryState(page) {
  return await evaluate(page, `
    (() => {
      const groups = [...document.querySelectorAll("#pet-accessory-groups .pet-accessory-group")].map((fieldset) => {
        const legend = fieldset.querySelector("legend")?.textContent?.trim() ?? "";
        const radios = [...fieldset.querySelectorAll('input[type="radio"]')].map((input) => {
          const label = input.closest("label")?.querySelector("span")?.textContent?.trim() ?? "";
          return {
            name: input.name,
            value: input.value,
            checked: input.checked,
            label
          };
        });
        return {
          legend,
          optionCount: radios.length,
          hasNoneOption: radios.some((radio) => radio.value === "none"),
          checkedValue: radios.find((radio) => radio.checked)?.value ?? null,
          checkedLabel: radios.find((radio) => radio.checked)?.label ?? null,
          firstSelectable: radios.find((radio) => radio.value !== "none") ?? null
        };
      });

      const selectedAccessory = groups
        .map((group) => group.firstSelectable && ({
          legend: group.legend,
          name: group.firstSelectable.name,
          value: group.firstSelectable.value,
          label: group.firstSelectable.label
        }))
        .find(Boolean) ?? null;

      const visibleText = [
        document.querySelector("#settings-appearance-page")?.textContent ?? "",
        document.querySelector("#pet-accessory-status")?.textContent ?? "",
        document.querySelector("#companion-control-shelf")?.textContent ?? ""
      ].join("\\n");

      return {
        pageVisible: document.querySelector("#settings-appearance-page")?.hidden === false,
        groupCount: groups.length,
        groups,
        selectedAccessory,
        visibleText
      };
    })()
  `);
}

async function selectAccessory(page, selectedAccessory) {
  return await evaluate(page, `
    (() => {
      const target = [...document.querySelectorAll('#pet-accessory-groups input[type="radio"]')].find((input) => (
        input.name === ${JSON.stringify(selectedAccessory.name)} &&
        input.value === ${JSON.stringify(selectedAccessory.value)}
      ));

      if (!target) {
        return null;
      }

      target.click();
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        name: target.name,
        value: target.value
      };
    })()
  `);
}

async function readSelectedAccessorySummary(page) {
  return await evaluate(page, `
    (() => {
      const shelfText = document.querySelector("#shelf-accessory-button")?.textContent ?? "";
      const statusText = document.querySelector("#pet-accessory-status")?.textContent ?? "";
      const checkedNonNone = [...document.querySelectorAll('#pet-accessory-groups input[type="radio"]:checked')]
        .map((input) => ({ name: input.name, value: input.value }))
        .filter((input) => input.value !== "none");
      const visibleText = [
        document.querySelector("#settings-appearance-page")?.textContent ?? "",
        statusText,
        shelfText
      ].join("\\n");

      return {
        shelfText,
        statusText,
        checkedNonNone,
        visibleText
      };
    })()
  `);
}

async function runFirstSession(checks) {
  startElectron(context);

  try {
    const handles = await openChat();
    const chat = handles.chat;
    const pet = handles.pet;

    checks.welcomeVisibleBeforeProfile = await evaluate(chat, `
      document.querySelector('#user-welcome-panel')?.hidden === true &&
        document.querySelector('#chat-page')?.hidden === false &&
        document.querySelector('#chat-input')?.disabled === false
    `);

    await saveWelcomeProfile(chat);
    await openAppearanceSettings(chat);
    checks.shelfVisibleAfterProfile = await evaluate(chat, `
      Boolean(
        document.querySelector("#companion-control-shelf") &&
        document.querySelector("#shelf-accessory-button") &&
        document.querySelector("#shelf-scale-button") &&
        document.querySelector("#shelf-lock-button") &&
        document.querySelector("#shelf-action-echo")
      )
    `);

    await setMode(chat, "reading");
    checks.modeSyncsShelfAndRibbon = await evaluate(chat, `
      document.querySelector("#partner-status")?.textContent.includes("读书模式") &&
        document.querySelector("#dialogue-mode-controls .mode-button.is-active")?.dataset.modeId === "reading"
    `);

    await openAppearanceSettings(chat);
    await click(chat, "#shelf-accessory-button");
    const accessoryEntryState = await readAccessoryEntryState(chat);
    checks.accessoryEntryReachableAndGrouped = (
      accessoryEntryState.pageVisible &&
      accessoryEntryState.groupCount >= 2 &&
      accessoryEntryState.groups.every((group) => group.optionCount >= 2 && group.hasNoneOption) &&
      Boolean(accessoryEntryState.selectedAccessory)
    );
    checks.accessoryUiDoesNotLeakModelDetails = !hasModelDetailLeak(accessoryEntryState.visibleText);

    if (!accessoryEntryState.selectedAccessory) {
      throw new Error(`P2-11E accessory entry unavailable: ${JSON.stringify(accessoryEntryState)}`);
    }

    const selectedAccessory = accessoryEntryState.selectedAccessory;
    const selectionResult = await selectAccessory(chat, selectedAccessory);
    if (!selectionResult) {
      throw new Error(`P2-11E accessory selection failed: ${JSON.stringify(selectedAccessory)}`);
    }

    await click(chat, "#save-pet-accessory-button");
    await waitFor(chat, `
      (() => {
        const text = document.querySelector("#shelf-accessory-button")?.textContent ?? "";
        const match = text.match(/已选\\s*(\\d+)\\s*类/u);
        return Number(match?.[1] ?? 0) === 1;
      })()
    `);
    const selectedAccessorySummary = await readSelectedAccessorySummary(chat);
    checks.accessoryToggleSyncsShelf = (
      countSelectedAccessoryClasses(selectedAccessorySummary.shelfText) === 1 &&
      selectedAccessorySummary.statusText.includes(selectedAccessory.label) &&
      selectedAccessorySummary.checkedNonNone.length === 1 &&
      selectedAccessorySummary.checkedNonNone[0]?.name === selectedAccessory.name &&
      selectedAccessorySummary.checkedNonNone[0]?.value === selectedAccessory.value &&
      !hasModelDetailLeak(selectedAccessorySummary.visibleText)
    );

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
    await waitFor(chat, "document.querySelector('#shelf-lock-button')?.dataset.state === 'ready'");
    checks.lockToggleSyncsShelf = await evaluate(chat, `
      document.querySelector("#shelf-lock-button")?.dataset.state === "ready"
    `);

    await openAdvancedSettings(chat);
    checks.lockShortcutStillVisible = await evaluate(chat, `
      document.querySelector("#shortcut-list")?.textContent.includes("Tab+0")
    `);
    await click(chat, "#settings-close-button");

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_interaction_action_started", {
          type: ${JSON.stringify(HEAD_PAT_ACTION_TYPE)},
          reason: "p2_11e_acceptance",
          durationMs: 1
        });
      })()
    `);
    await waitFor(chat, `document.querySelector('#shelf-action-echo')?.textContent.includes(${JSON.stringify(HEAD_PAT_SAFE_ECHO_MESSAGE)})`);
    checks.actionEchoIsShortAndVisible = await evaluate(chat, `
      (() => {
        const text = document.querySelector("#shelf-action-echo")?.textContent ?? "";
        return text.includes(${JSON.stringify(HEAD_PAT_SAFE_ECHO_MESSAGE)}) &&
          document.querySelector("#shelf-action-echo")?.dataset.state === "active" &&
          !text.includes("p2_11e_acceptance") &&
          !text.includes("durationMs");
      })()
    `);

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_interaction_action_started", {
          type: ${JSON.stringify(HEAD_PAT_ACTION_TYPE)},
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
        return text === ${JSON.stringify(`小动作：${HEAD_PAT_SAFE_ECHO_MESSAGE}`)} &&
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
          echo.textContent.includes("在旁边陪着");
      })()
    `);

    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.dataset.state === 'idle'", 6_000);
    checks.actionEchoReturnsToIdle = await evaluate(chat, `
      document.querySelector("#shelf-action-echo")?.textContent === "小动作：她安静待着"
    `);

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_window_motion_feedback", {
          eventType: "window_shake_candidate",
          reason: ${JSON.stringify(PET_WINDOW_SHAKE_FEEDBACK_REASON)},
          feedbackType: "shake_light_feedback",
          result: "started"
        });
      })()
    `);
    await waitFor(chat, `document.querySelector('#shelf-action-echo')?.textContent.includes(${JSON.stringify(PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE)})`);
    checks.windowMotionEchoIsShort = await evaluate(chat, `
      document.querySelector("#shelf-action-echo")?.textContent.includes(${JSON.stringify(PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE)})
    `);

    await closeSettingsPage(chat);
    const desktopLayout = await checkLayout(chat, 420, 640);
    const narrowLayout = await checkLayout(chat, 360, 720);
    checks.desktopLayout = desktopLayout.ok;
    checks.narrowLayout = narrowLayout.ok;

    return { desktopLayout, narrowLayout, selectedAccessory };
  } finally {
    await stopElectron(context);
  }
}

async function runRestartSession(checks, expectedAccessory) {
  startElectron(context);

  try {
    const handles = await openChat();
    const chat = handles.chat;
    await waitFor(chat, "document.querySelector('#user-welcome-panel')?.hidden === true");
    await click(chat, "#shelf-accessory-button");
    const restartAccessorySummary = await readSelectedAccessorySummary(chat);
    checks.accessoryRestoresAfterRestart = (
      countSelectedAccessoryClasses(restartAccessorySummary.shelfText) === 1 &&
      restartAccessorySummary.checkedNonNone.length === 1 &&
      restartAccessorySummary.checkedNonNone[0]?.name === expectedAccessory.name &&
      restartAccessorySummary.checkedNonNone[0]?.value === expectedAccessory.value &&
      !hasModelDetailLeak(restartAccessorySummary.visibleText)
    );
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
  const finalUi = await runRestartSession(checks, layout.selectedAccessory);
  const textOutput = readPrivacyCheckText(context);
  checks.privacyOutput = forbiddenTexts.every((text) => !textOutput.includes(text)) && !hasModelDetailLeak(textOutput);
  checks.finalUiDoesNotLeakModelDetails = !hasModelDetailLeak(JSON.stringify(finalUi));
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
