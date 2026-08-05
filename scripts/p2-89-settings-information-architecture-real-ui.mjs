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

const electronArgs = ["--force-device-scale-factor=1"];

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
const timing = { sendPromptTiming: null };
let dpr = null;
let referenceBaseline = false;
let failureStage = "starting_electron";

const historyDirectory = join(context.appDataDir, "history");
mkdirSync(historyDirectory, { recursive: true });
writeFileSync(join(historyDirectory, "conversations.json"), `${JSON.stringify({
  version: 2,
  retentionLimit: 500,
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
  context.electronArgs = electronArgs;
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  checks.proactiveBubbleMatchesPetMessageStyle = await evaluate(pet, `
    (() => {
      const bubble = document.querySelector("#proactive-speech-bubble");
      const style = getComputedStyle(bubble);
      const before = getComputedStyle(bubble, "::before");
      const after = getComputedStyle(bubble, "::after");
      return style.backgroundColor === "rgb(231, 224, 250)" &&
        style.color === "rgb(0, 0, 0)" &&
        style.borderTopWidth === "0px" &&
        style.maxWidth === "262.4px" &&
        style.borderRadius === "27.2px" &&
        style.padding === "14.4px 16px" &&
        style.minHeight === "46.4px" &&
        style.fontSize === "16px" &&
        style.lineHeight === "21.6px" &&
        style.boxShadow === "none" &&
        before.content.includes("✦") &&
        after.content.includes("✦") &&
        before.color === "rgb(215, 171, 82)" &&
        after.color === "rgb(215, 171, 82)";
    })()
  `);
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#settings-button'))");

  const charm = await waitForWindow(context, "renderer/phone-charm/index.html");
  await waitFor(charm, "Boolean(document.querySelector('#charm-pendant'))");
  const rendererDevicePixelRatio = {
    pet: await evaluate(pet, "window.devicePixelRatio"),
    chat: await evaluate(chat, "window.devicePixelRatio"),
    charm: await evaluate(charm, "window.devicePixelRatio")
  };
  dpr = rendererDevicePixelRatio;
  referenceBaseline = Object.values(rendererDevicePixelRatio).every((devicePixelRatio) => devicePixelRatio === 1);
  checks.referenceBaseline = referenceBaseline;
  await new Promise((resolve) => setTimeout(resolve, 100));
  const observedPhoneCharm = await evaluate(charm, `
    (() => {
      const stage = document.querySelector("#charm-stage");
      const pendant = document.querySelector("#charm-pendant");
      const stageRect = stage.getBoundingClientRect();
      const pendantRect = pendant.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        stage: { width: stageRect.width, height: stageRect.height },
        pendant: { left: pendantRect.left, top: pendantRect.top, right: pendantRect.right, bottom: pendantRect.bottom }
      };
    })()
  `);
  checks.phoneCharmViewport = observedPhoneCharm.innerWidth >= 420 &&
    observedPhoneCharm.innerHeight >= 330 &&
    observedPhoneCharm.scrollWidth === observedPhoneCharm.innerWidth &&
    observedPhoneCharm.scrollHeight === observedPhoneCharm.innerHeight &&
    observedPhoneCharm.stage.width === observedPhoneCharm.innerWidth &&
    observedPhoneCharm.stage.height === observedPhoneCharm.innerHeight &&
    observedPhoneCharm.pendant.left >= 0 &&
    observedPhoneCharm.pendant.top >= 0 &&
    observedPhoneCharm.pendant.right <= observedPhoneCharm.innerWidth &&
    observedPhoneCharm.pendant.bottom <= observedPhoneCharm.innerHeight;

  checks.memoryFixtureCreated = await evaluate(chat, `
    (async () => {
      await window.memoryApi.setEnabled(true);
      const result = await window.memoryApi.createCard({
        title: "Final acceptance memory",
        content: "Used to verify that memory selection can be checked and unchecked.",
        tags: ["acceptance"],
        sourceConversationId: "77777777-7777-4777-8777-777777777777"
      });
      return result.status === "created";
    })()
  `);

  checks.mcpErrorLightIsRed = await evaluate(chat, `
    (() => {
      const light = document.querySelector("#figma-mcp-light");
      light.dataset.connection = "error";
      const isRed = getComputedStyle(light).backgroundColor === "rgb(214, 66, 66)";
      light.dataset.connection = "disabled";
      return isRed;
    })()
  `);

  checks.chatInputStability = await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      const baseline = input.getBoundingClientRect();
      const baselineFont = getComputedStyle(input).fontSize;
      input.value = "Short input";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const shortRect = input.getBoundingClientRect();
      input.value = "This is a deliberately long input used to verify textarea wrapping without changing its width or font size. ".repeat(8);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const longRect = input.getBoundingClientRect();
      const longValuePreserved = input.value.endsWith("font size. ");
      const fontStable = getComputedStyle(input).fontSize === baselineFont;
      input.value = "Figma motion acceptance";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return Math.abs(shortRect.width - baseline.width) < 1 &&
        Math.abs(longRect.width - baseline.width) < 1 &&
        shortRect.height === 45 &&
        longRect.height > shortRect.height &&
        longRect.height <= 129 &&
        longValuePreserved &&
        fontStable;
    })()
  `);

  const sendPromptTiming = await evaluate(chat, `
    (async () => {
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
      const form = document.querySelector("#chat-form");
      const sampleTargets = [0, 50, 100.874, 140, 200];
      const samples = [];
      let submitBaseline = 0;
      let animationStartOffsetMs = null;
      const toMilliseconds = (value) => {
        const firstValue = value.split(",")[0].trim();
        const amount = Number.parseFloat(firstValue);
        return firstValue.endsWith("ms") ? amount : amount * 1000;
      };
      const onAnimationStart = (event) => {
        if (
          event.animationName === "figma-send-placeholder-opacity" &&
          event.pseudoElement === "::placeholder" &&
          animationStartOffsetMs === null
        ) {
          animationStartOffsetMs = performance.now() - submitBaseline;
        }
      };
      input.addEventListener("animationstart", onAnimationStart);
      try {
        submitBaseline = performance.now();
        form.requestSubmit();
        for (const targetOffsetMs of sampleTargets) {
          const remainingMs = targetOffsetMs - (performance.now() - submitBaseline);
          if (remainingMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, remainingMs));
          }
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          const placeholderStyle = getComputedStyle(input, "::placeholder");
          samples.push({
            targetOffsetMs,
            actualOffsetMs: performance.now() - submitBaseline,
            animationStartOffsetMs,
            classIsSending: form.classList.contains("is-sending"),
            animationName: placeholderStyle.animationName,
            animationDurationMs: toMilliseconds(placeholderStyle.animationDuration),
            animationDelayMs: toMilliseconds(placeholderStyle.animationDelay),
            animationPlayState: placeholderStyle.animationPlayState,
            placeholderOpacity: Number.parseFloat(placeholderStyle.opacity)
          });
        }
        return {
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          visibilityState: document.visibilityState,
          samples: samples
        };
      } finally {
        input.removeEventListener("animationstart", onAnimationStart);
      }
    })()
  `);
  timing.sendPromptTiming = sendPromptTiming;
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
  checks.sendPromptFadesQuickly = timing.sendPromptTiming.samples
    .find((sample) => sample.targetOffsetMs === 140)?.placeholderOpacity <= 0.05;
  await new Promise((resolve) => setTimeout(resolve, 1260));
  checks.sendMotionFinishes = await evaluate(chat, `
    document.querySelector("#chat-form")?.classList.contains("is-sending") === false &&
    document.querySelector("#messages")?.classList.contains("is-sending") === false &&
    document.querySelector("#messages").scrollTop > 0 &&
    (() => {
      const user = [...document.querySelectorAll("#messages > .message-user")].at(-1);
      const previousRect = user.previousElementSibling.getBoundingClientRect();
      const userRect = user.getBoundingClientRect();
      return Math.abs(userRect.top - previousRect.bottom - 116) < 1;
    })()
  `);
  checks.messageBubbleSizing = await evaluate(chat, `
    (() => {
      const shortBubble = [...document.querySelectorAll("#messages > .message-user")].at(-1);
      const shortContent = shortBubble.querySelector(".message-content");
      const shortRect = shortBubble.getBoundingClientRect();
      const shortContentRect = shortContent.getBoundingClientRect();
      const longBubble = document.createElement("p");
      longBubble.className = "message message-user";
      const longContent = document.createElement("span");
      longContent.className = "message-content";
      longContent.textContent = "A long message should wrap only after reaching the configured maximum bubble width. ".repeat(5);
      longBubble.append(longContent);
      document.querySelector("#messages").append(longBubble);
      const longRect = longBubble.getBoundingClientRect();
      const longContentRect = longContent.getBoundingClientRect();
      return shortRect.width < 323 &&
        shortContentRect.height <= 22 &&
        longRect.width <= 323 &&
        longRect.width > 280 &&
        longContentRect.height > 22 &&
        Math.abs(longRect.top - shortRect.bottom - 116) < 1;
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
  await waitFor(chat, "Boolean(document.querySelector('#memory-list input[type=checkbox]'))");
  checks.memorySelectionCanToggle = await evaluate(chat, `
    (() => {
      const checkbox = document.querySelector("#memory-list input[type=checkbox]");
      const deleteButton = document.querySelector("#memory-delete-selected-button");
      const forgetButton = document.querySelector("#memory-forget-selected-button");
      const initiallyClear = checkbox.checked === false && deleteButton.disabled && forgetButton.disabled;
      checkbox.click();
      const selected = checkbox.checked === true && !deleteButton.disabled && !forgetButton.disabled;
      checkbox.click();
      const clearedAgain = checkbox.checked === false && deleteButton.disabled && forgetButton.disabled;
      return initiallyClear && selected && clearedAgain;
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 270));
  await evaluate(chat, "document.querySelector('#memory-cancel-manage-button').click()");
  checks.memoryManagementCollapseMotion = await evaluate(chat, `
    getComputedStyle(document.querySelector("#memory-page")).animationName === "settings-management-collapse" &&
    getComputedStyle(document.querySelector("#memory-page")).animationDuration === "0.22s"
  `);
  // Failure-stage label only; the existing close condition and timeout remain unchanged.
  failureStage = "memory_management_close";
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
  checks.historyControlsAndConversations = await evaluate(chat, `
    document.querySelector("#history-settings-group")?.open === true &&
    Boolean(document.querySelector("#conversation-list")) &&
    !document.querySelector("#history-page .history-detail-actions button") &&
    document.querySelector("#history-retention-limit")?.value === "500" &&
    document.querySelectorAll("#history-retention-limit option").length === 3 &&
    Boolean(document.querySelector("#clear-history-button.button-danger"))
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
  checks.historyDetailScrollableWithoutOverlap = await evaluate(chat, `
    (() => {
      const scroller = document.querySelector("#settings-form");
      const messages = [...document.querySelectorAll("#history-detail .history-message")];
      const rects = messages.map((message) => message.getBoundingClientRect());
      const noOverlap = rects.every((rect, index) => index === 0 || rect.top >= rects[index - 1].bottom);
      const maximumScrollTop = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = maximumScrollTop;
      return noOverlap && maximumScrollTop > 0 && Math.abs(scroller.scrollTop - maximumScrollTop) < 1;
    })()
  `);
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

  await evaluate(chat, "document.querySelector('#settings-basic-tab').click()");
  await waitFor(chat, "document.querySelector('#settings-basic-page')?.hidden === false");
  checks.returnToBasicCrossfade = await evaluate(chat, `
    document.querySelector("#settings-data-page")?.hidden === false &&
    getComputedStyle(document.querySelector("#settings-data-page")).animationName === "settings-page-fade-out" &&
    getComputedStyle(document.querySelector("#settings-basic-page")).animationName === "settings-page-fade-in"
  `);
  await new Promise((resolve) => setTimeout(resolve, 330));
  checks.appearanceStillInteractiveAfterReturn = await evaluate(chat, `
    (() => {
      const group = document.querySelector("#appearance-settings-group");
      const field = document.querySelector("#pet-scale");
      group.open = true;
      field.value = "1.75";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return document.querySelector("#pet-scale-value")?.value === "175%" &&
        getComputedStyle(field).pointerEvents !== "none";
    })()
  `);
  await waitFor(chat, "window.petPresentationApi.getPreferences().then((preferences) => preferences.petScale === 1.75)");
  checks.scalePersistsAfterReturn = true;
  const initialLockState = await evaluate(chat, "document.querySelector('#toggle-pet-lock-button').getAttribute('aria-checked')");
  await evaluate(chat, "document.querySelector('#toggle-pet-lock-button').click()");
  await waitFor(chat, `document.querySelector("#toggle-pet-lock-button").getAttribute("aria-checked") !== ${JSON.stringify(initialLockState)}`);
  checks.lockSwitchMatchesAndFades = await evaluate(chat, `
    (() => {
      const button = document.querySelector("#toggle-pet-lock-button");
      const display = button.querySelector(".figma-switch-display");
      const labels = [...button.querySelectorAll(".pet-lock-toggle-label > span")];
      return getComputedStyle(display).borderRadius === "16px" &&
        labels.every((label) => getComputedStyle(label).transitionDuration === "0.2s") &&
        labels.filter((label) => getComputedStyle(label).opacity === "1").length === 1;
    })()
  `);
  await evaluate(chat, "document.querySelector('#toggle-pet-lock-button').click()");
  await waitFor(chat, `document.querySelector("#toggle-pet-lock-button").getAttribute("aria-checked") === ${JSON.stringify(initialLockState)}`);
  checks.lockSwitchCanRestore = true;

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

  failureStage = "complete";
  const result = { ok: Object.values(checks).every(Boolean), checks, dpr, referenceBaseline, observedPhoneCharm, observedFlatFigmaSurface, observedSettingsTabMotion, observedHistoryDetail, timing, stage: failureStage };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify({ ok: false, checks, dpr, referenceBaseline, timing, stage: failureStage }, null, 2));
  process.exitCode = 1;
} finally {
  await stopElectron(context);
  if (process.env.P2_89_KEEP_TMP !== "1") {
    cleanupRealUiRun(context);
  }
}
