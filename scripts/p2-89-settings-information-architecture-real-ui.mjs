import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkLayout,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-89-settings-information-architecture-real-ui",
  port: Number(process.env.P2_89_CDP_PORT || 9689),
  env: {
    AI_DESKTOP_PET_PROVIDER: "local-openai-compatible",
    AI_DESKTOP_PET_BASE_URL: "http://127.0.0.1:8080/v1",
    AI_DESKTOP_PET_MODEL: "bundled-local-model"
  }
});

const checks = {};

const historyDirectory = join(context.appDataDir, "history");
mkdirSync(historyDirectory, { recursive: true });
writeFileSync(join(historyDirectory, "conversations.json"), `${JSON.stringify({
  version: 2,
  retentionLimit: 2_048,
  conversations: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "推荐一首日式 acg 歌曲",
      createdAt: 1_753_635_420_000,
      updatedAt: 1_753_635_540_000,
      messages: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          role: "user",
          content: "推荐一首日式 acg 歌曲",
          createdAt: 1_753_635_420_000
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          role: "assistant",
          content: "推荐《Kimi no Na wa》的纯音乐版。旋律舒缓，很适合午后或傍晚听。",
          createdAt: 1_753_635_540_000
        }
      ]
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "第二段用于滚动验证的历史对话",
      createdAt: 1_753_721_820_000,
      updatedAt: 1_753_721_940_000,
      messages: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          role: "user",
          content: "这是一条较长的测试消息，用来确认历史页面仍可滚动且不会与列表重叠。",
          createdAt: 1_753_721_820_000
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          role: "assistant",
          content: "收到，这段内容只用于真实界面的布局、滚动与动画验收。",
          createdAt: 1_753_721_940_000
        }
      ]
    }
  ],
  semanticSummaries: []
}, null, 2)}\n`, "utf8");

try {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#settings-button'))");

  await evaluate(chat, `
    (() => {
      const messages = document.querySelector("#messages");
      for (let index = 0; index < 6; index += 1) {
        const item = document.createElement("p");
        item.className = "message message-pet";
        item.textContent = "滚动基准消息 " + (index + 1);
        messages.append(item);
      }
      const input = document.querySelector("#chat-input");
      input.value = "Figma 动画验收";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#chat-form").requestSubmit();
    })()
  `);
  checks.sendMotionStarts = await evaluate(chat, `
    document.querySelector("#chat-form")?.classList.contains("is-sending") === true &&
    document.querySelector("#messages")?.classList.contains("is-sending") === true &&
    getComputedStyle(document.querySelector("#chat-input")).animationDuration === "1.26092s" &&
    getComputedStyle(document.querySelector(".message-user")).animationName === "message-user-enter"
  `);
  checks.sendComposerTracks = await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      const button = document.querySelector("#send-button");
      const inputStyle = getComputedStyle(input);
      const placeholderStyle = getComputedStyle(input, "::placeholder");
      const buttonStyle = getComputedStyle(button);
      return inputStyle.animationName === "figma-send-field-width" &&
        inputStyle.animationDuration === "1.26092s" &&
        placeholderStyle.animationName === "figma-send-placeholder-opacity" &&
        placeholderStyle.animationDuration === "1.26092s" &&
        buttonStyle.animationName === "figma-send-button-scale" &&
        buttonStyle.animationDuration === "1.26092s";
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  checks.sendMotionFinishes = await evaluate(chat, `
    document.querySelector("#chat-form")?.classList.contains("is-sending") === false &&
    document.querySelector("#messages")?.classList.contains("is-sending") === false &&
    Math.abs(document.querySelector("#messages").scrollTop - 126) < 1 &&
    (() => {
      const items = [...document.querySelectorAll("#messages > .message")];
      const previousRect = items.at(-2).getBoundingClientRect();
      const userRect = items.at(-1).getBoundingClientRect();
      return Math.abs(userRect.top - previousRect.bottom - 116) < 1;
    })()
  `);

  await evaluate(chat, "document.querySelector('#settings-button').click()");
  await waitFor(chat, "document.querySelector('#settings-panel')?.hidden === false");
  checks.settingsEntryMotion = await evaluate(chat, `
    getComputedStyle(document.querySelector("#settings-panel")).animationName === "settings-slide-in" &&
    getComputedStyle(document.querySelector("#settings-panel")).animationDuration === "0.52s"
  `);
  await new Promise((resolve) => setTimeout(resolve, 540));
  const observedFlatFigmaSurface = await evaluate(chat, `
    (() => {
      const panelStyle = getComputedStyle(document.querySelector("#settings-panel"));
      const moduleStyle = getComputedStyle(document.querySelector("#general-settings-group"));
      return {
        panelRadius: panelStyle.borderRadius,
        moduleRadius: moduleStyle.borderRadius,
        moduleBackground: moduleStyle.backgroundColor,
        moduleBorderWidth: moduleStyle.borderBottomWidth,
        moduleBorderColor: moduleStyle.borderBottomColor
      };
    })()
  `);
  checks.settingsFlatFigmaSurface =
    observedFlatFigmaSurface.panelRadius === "34px" &&
    observedFlatFigmaSurface.moduleRadius === "0px" &&
    observedFlatFigmaSurface.moduleBackground === "rgba(0, 0, 0, 0)" &&
    Number.parseFloat(observedFlatFigmaSurface.moduleBorderWidth) >= 0.5 &&
    observedFlatFigmaSurface.moduleBorderColor === "rgb(215, 211, 223)";
  if (process.env.P2_89_CAPTURE_BASELINE === "1") {
    const screenshot = await chat.cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const screenshotPath = join(context.runDir, "p2-89-settings-basic-baseline.png");
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`BASELINE_SCREENSHOT_PATH=${screenshotPath}`);
  }
  checks.twoTaskHubs = await evaluate(chat, `
    JSON.stringify([...document.querySelectorAll(".settings-nav [data-settings-page]")].map((node) => node.textContent.trim())) ===
      JSON.stringify(["基础设置", "记忆和历史"])
  `);
  checks.basicExpansionDefaults = await evaluate(chat, `
    document.querySelector("#general-settings-group")?.open === true &&
    document.querySelector("#appearance-settings-group")?.open === false &&
    document.querySelector("#model-settings-group")?.open === false
  `);
  checks.basicOnlyHasRequestedControls = await evaluate(chat, `
    Boolean(document.querySelector("#proactive-companion-enabled")) &&
    Boolean(document.querySelector("#new-conversation-button")) &&
    !document.querySelector("#settings-basic-page [id*='environment']") &&
    !document.querySelector("#settings-basic-page [id*='affect']") &&
    !document.querySelector("#settings-basic-page [id*='profile']")
  `);

  await evaluate(chat, "document.querySelector('#appearance-settings-group > summary').click()");
  checks.appearanceExpandsInline = await evaluate(chat, `
    document.querySelector("#appearance-settings-group")?.open === true &&
    Boolean(document.querySelector("#appearance-settings-group #pet-scale")) &&
    Boolean(document.querySelector("#appearance-settings-group #toggle-pet-lock-button"))
  `);
  await evaluate(chat, `
    (() => {
      const field = document.querySelector("#pet-scale");
      field.value = "1.50";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
  checks.scaleMotion = await evaluate(chat, `
    document.querySelector("#pet-scale-value")?.value === "150%" &&
    getComputedStyle(document.querySelector(".figma-scale-handle")).transitionDuration === "0.15s" &&
    getComputedStyle(document.querySelector(".figma-scale-fill")).transitionTimingFunction === "ease-out"
  `);

  await evaluate(chat, "document.querySelector('#model-settings-group > summary').click()");
  checks.modelExpandsInline = await evaluate(chat, `
    document.querySelector("#model-settings-group")?.open === true &&
    Boolean(document.querySelector("#model-settings-group #local-provider-preset")) &&
    Boolean(document.querySelector("#model-settings-group #web-search-timeout")) &&
    !document.querySelector("#web-search-enabled")
  `);
  checks.modelHasTwoConnectionModes = await evaluate(chat, `
    JSON.stringify([...document.querySelectorAll("#local-provider-preset option")].map((option) => option.value)) ===
      JSON.stringify(["embedded-llama-cpp", "custom-local"]) &&
    !document.querySelector("#local-model-diagnostic-section") &&
    !document.querySelector("#llama-cpp-runtime-section")
  `);
  await evaluate(chat, `
    (() => {
      const field = document.querySelector("#local-provider-preset");
      field.value = "custom-local";
      field.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  checks.externalConnectionFieldsOpen = await evaluate(chat, `
    document.querySelector("#external-provider-settings")?.hidden === false &&
    Boolean(document.querySelector("#external-provider-settings #provider-api-key"))
  `);

  await evaluate(chat, "document.querySelector('#settings-data-tab').click()");
  await waitFor(chat, "document.querySelector('#settings-data-page')?.hidden === false");
  checks.settingsCrossfadeMotion = await evaluate(chat, `
    document.querySelector("#settings-basic-page")?.hidden === false &&
    getComputedStyle(document.querySelector("#settings-basic-page")).animationName === "settings-page-fade-out" &&
    getComputedStyle(document.querySelector("#settings-data-page")).animationName === "settings-page-fade-in" &&
    getComputedStyle(document.querySelector("#settings-data-page")).animationDuration === "0.3s"
  `);
  const observedSettingsTabMotion = await evaluate(chat, `
    (() => {
      const basicStyle = getComputedStyle(document.querySelector("#settings-basic-tab"));
      const dataStyle = getComputedStyle(document.querySelector("#settings-data-tab"));
      const lineStyle = getComputedStyle(document.querySelector(".settings-nav"), "::after");
      return {
        basicName: basicStyle.animationName,
        dataName: dataStyle.animationName,
        dataDuration: dataStyle.animationDuration,
        lineDuration: lineStyle.transitionDuration
      };
    })()
  `);
  checks.settingsTabMotion =
    observedSettingsTabMotion.basicName === "figma-settings-tab-deactivate" &&
    observedSettingsTabMotion.dataName === "figma-settings-tab-activate" &&
    observedSettingsTabMotion.dataDuration === "0.3s" &&
    observedSettingsTabMotion.lineDuration.split(", ").every((duration) => duration === "0.3s");
  await new Promise((resolve) => setTimeout(resolve, 330));
  checks.dataExpansionDefaults = await evaluate(chat, `
    document.querySelector("#memory-settings-group")?.open === true &&
    document.querySelector("#history-settings-group")?.open === false
  `);
  checks.memoryStructure = await evaluate(chat, `
    Boolean(document.querySelector("#memory-enabled")) &&
    Boolean(document.querySelector("#memory-search")) &&
    Boolean(document.querySelector("#memory-list")?.closest("#memory-settings-group")) &&
    !document.querySelector("#memory-page [data-memory-filter]") &&
    !document.querySelector("#memory-page #memory-reviews")
  `);
  checks.memoryManagementHiddenByDefault = await evaluate(chat, `
    document.querySelector("#memory-management-actions")?.hidden === true &&
    document.querySelector("#memory-delete-selected-button")?.offsetParent === null &&
    document.querySelector("#memory-forget-selected-button")?.offsetParent === null
  `);
  await evaluate(chat, "document.querySelector('#memory-manage-button').click()");
  checks.memoryManagementExpandMotion = await evaluate(chat, `
    getComputedStyle(document.querySelector("#memory-page")).animationName === "settings-management-expand" &&
    getComputedStyle(document.querySelector("#memory-page")).animationDuration === "0.24s"
  `);
  checks.memoryManagementOpens = await evaluate(chat, `
    document.querySelector("#memory-management-actions")?.hidden === false &&
    document.querySelector("#memory-manage-button")?.hidden === true &&
    document.querySelector("#memory-delete-selected-button")?.disabled === true &&
    document.querySelector("#memory-forget-selected-button")?.disabled === true
  `);
  await new Promise((resolve) => setTimeout(resolve, 270));
  await evaluate(chat, "document.querySelector('#memory-cancel-manage-button').click()");
  checks.memoryManagementCollapseMotion = await evaluate(chat, `
    getComputedStyle(document.querySelector("#memory-page")).animationName === "settings-management-collapse" &&
    getComputedStyle(document.querySelector("#memory-page")).animationDuration === "0.22s"
  `);
  await waitFor(chat, `
    document.querySelector("#memory-management-actions")?.hidden === true &&
    document.querySelector("#memory-manage-button")?.hidden === false
  `);
  checks.memoryManagementCloses = await evaluate(chat, `
    document.querySelector("#memory-management-actions")?.hidden === true &&
    document.querySelector("#memory-manage-button")?.hidden === false
  `);

  await evaluate(chat, "document.querySelector('#history-settings-group > summary').click()");
  checks.historyManagementExpandMotion = await evaluate(chat, `
    getComputedStyle(document.querySelector("#history-page")).animationName === "settings-management-expand" &&
    getComputedStyle(document.querySelector("#history-page")).animationDuration === "0.24s"
  `);
  await new Promise((resolve) => setTimeout(resolve, 270));
  checks.historyOnlyListsConversations = await evaluate(chat, `
    document.querySelector("#history-settings-group")?.open === true &&
    Boolean(document.querySelector("#conversation-list")) &&
    !document.querySelector("#history-page .history-detail-actions button") &&
    !document.querySelector("#history-page select")
  `);
  await evaluate(chat, `
    [...document.querySelectorAll("#conversation-list .conversation-select")]
      .find((button) => button.textContent.includes("第二段用于滚动验证"))
      .click()
  `);
  await waitFor(chat, `
    document.querySelector("#history-page")?.classList.contains("is-detail-open") === true &&
    document.querySelector("#history-detail .history-detail-back")
  `);
  const observedHistoryDetail = await evaluate(chat, `
    (() => {
      const page = document.querySelector("#history-page");
      const list = document.querySelector("#conversation-list");
      const detail = document.querySelector("#history-detail");
      const style = getComputedStyle(detail);
      return {
        detailOpen: page?.classList.contains("is-detail-open") === true,
        listDisplay: getComputedStyle(list).display,
        detailDisplay: style.display,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        hasBack: Boolean(detail.querySelector(".history-detail-back")),
        messageCount: detail.querySelectorAll(".history-message").length
      };
    })()
  `);
  checks.historyDetailExpandMotion = observedHistoryDetail.detailOpen &&
    observedHistoryDetail.listDisplay === "none" &&
    observedHistoryDetail.detailDisplay === "flex" &&
    observedHistoryDetail.animationName === "settings-management-expand" &&
    observedHistoryDetail.animationDuration === "0.24s" &&
    observedHistoryDetail.hasBack &&
    observedHistoryDetail.messageCount === 2;
  checks.managementMotionDirection = await evaluate(chat, `
    (() => {
      const rules = [...document.styleSheets].flatMap((sheet) => {
        try { return [...sheet.cssRules]; } catch { return []; }
      });
      const expand = rules.find((rule) => rule.name === "settings-management-expand");
      const collapse = rules.find((rule) => rule.name === "settings-management-collapse");
      return expand?.cssRules?.[0]?.style.clipPath === "inset(0px 0px 100%)" &&
        expand?.cssRules?.[0]?.style.transform === "scaleY(0.92)" &&
        expand?.cssRules?.[1]?.style.clipPath === "inset(0px)" &&
        expand?.cssRules?.[1]?.style.transform === "scaleY(1)" &&
        collapse?.cssRules?.[0]?.style.clipPath === "inset(0px)" &&
        collapse?.cssRules?.[0]?.style.transform === "scaleY(1)" &&
        collapse?.cssRules?.[1]?.style.clipPath === "inset(0px 0px 100%)" &&
        collapse?.cssRules?.[1]?.style.transform === "scaleY(0.92)";
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 270));
  if (process.env.P2_89_CAPTURE_HISTORY_DETAIL === "1") {
    const screenshot = await chat.cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const screenshotPath = join(context.runDir, "p2-89-history-detail.png");
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`HISTORY_DETAIL_SCREENSHOT_PATH=${screenshotPath}`);
  }
  await evaluate(chat, "document.querySelector('#history-detail .history-detail-back').click()");
  checks.historyDetailCollapseMotion = await evaluate(chat, `
    getComputedStyle(document.querySelector("#history-detail")).animationName === "settings-management-collapse" &&
    getComputedStyle(document.querySelector("#history-detail")).animationDuration === "0.22s"
  `);
  await waitFor(chat, `
    document.querySelector("#history-page")?.classList.contains("is-detail-open") === false &&
    getComputedStyle(document.querySelector("#conversation-list")).display !== "none" &&
    getComputedStyle(document.querySelector("#history-detail")).display === "none"
  `);
  checks.historyDetailReturnsToList = true;

  checks.settingsDragAndScaleContract = await evaluate(chat, `
    (() => {
      const bodyStyle = getComputedStyle(document.body);
      const shellStyle = getComputedStyle(document.querySelector(".chat-shell"));
      const panelStyle = getComputedStyle(document.querySelector("#settings-panel"));
      return bodyStyle.webkitAppRegion === "drag" &&
        shellStyle.webkitAppRegion === "drag" &&
        panelStyle.webkitAppRegion === "no-drag" &&
        getComputedStyle(document.documentElement).getPropertyValue("--chat-ui-scale").trim() === "1";
    })()
  `);

  const layoutSelectors = [
    ".chat-shell",
    "#settings-panel",
    ".settings-nav",
    "#settings-data-page",
    "#memory-settings-group",
    "#history-settings-group"
  ];
  checks.desktopLayout = (await checkLayout(chat, 420, 640, {
    selectors: layoutSelectors,
    controlSelector: "#settings-panel button, #settings-panel input, #settings-panel select"
  })).ok;
  checks.narrowLayout = (await checkLayout(chat, 360, 720, {
    selectors: layoutSelectors,
    controlSelector: "#settings-panel button, #settings-panel input, #settings-panel select"
  })).ok;

  if (process.env.P2_89_CAPTURE_SCREENSHOT === "1") {
    const screenshot = await chat.cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const screenshotPath = join(context.runDir, "p2-89-settings-two-hub.png");
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`SCREENSHOT_PATH=${screenshotPath}`);
  }

  await evaluate(chat, "document.querySelector('#settings-close-button').click()");
  checks.settingsExitMotion = await evaluate(chat, `
    document.querySelector("#settings-panel")?.classList.contains("is-exiting") === true &&
    getComputedStyle(document.querySelector("#settings-panel")).animationName === "settings-slide-out" &&
    getComputedStyle(document.querySelector("#settings-panel")).animationDuration === "0.48s"
  `);
  await waitFor(chat, "document.querySelector('#settings-panel')?.hidden === true");
  checks.settingsExitCompletes = await evaluate(chat, `
    document.querySelector("#settings-panel")?.hidden === true &&
    document.querySelector("#settings-panel")?.classList.contains("is-exiting") === false
  `);

  const result = { ok: Object.values(checks).every(Boolean), checks, observedFlatFigmaSurface, observedSettingsTabMotion, observedHistoryDetail };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  await stopElectron(context);
  if (process.env.P2_89_KEEP_TMP !== "1") {
    cleanupRealUiRun(context);
  }
}
