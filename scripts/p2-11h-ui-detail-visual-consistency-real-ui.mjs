import { writeFileSync } from "node:fs";
import {
  checkLayout,
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  openSettingsPage,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-11h-ui-detail-visual-consistency-real-ui",
  port: Number(process.env.P2_11H_CDP_PORT || 9605)
});

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /Provider 请求正文|provider request body|完整 prompt|system prompt|用户全文|AI 全文|fact card|fact card body|完整模型路径|model path/i
];

const settingsPages = ["basic", "memory", "history", "appearance", "model", "advanced"];
const viewports = [
  { width: 420, height: 640 },
  { width: 360, height: 720 }
];

const layoutSelectors = [
  ".settings-nav .subpage-tab",
  ".settings-page:not([hidden]) .status-box",
  ".settings-page:not([hidden]) .selection-note",
  "#companion-control-shelf",
  ".settings-page:not([hidden]) .partner-status-band"
];

async function main() {
  log(context, "start");
  const checks = {};
  const observations = {
    bubble: null,
    cssRules: null,
    layouts: []
  };

  try {
    const pet = await startApp();

    observations.bubble = await inspectBubbleVisual(pet);
    checks.bubbleVisible = observations.bubble.stateVisible;
    checks.bubblePointerEventsNone = observations.bubble.pointerEventsNone;
    checks.bubbleTopLeft = observations.bubble.topLeft;
    checks.bubbleShortText = observations.bubble.shortText;
    checks.bubbleParchmentStyle = observations.bubble.parchmentBackground &&
      observations.bubble.lightBorder &&
      observations.bubble.warmText;
    checks.bubbleNoHeavyEffects = observations.bubble.noGradient && observations.bubble.lightShadow;

    const chat = await openChat(pet);
    observations.cssRules = await inspectChatCssRules(chat);
    checks.focusVisibleRulesExist = observations.cssRules.focusVisibleExists;
    checks.letterSpacingNonNegative = observations.cssRules.negativeLetterSpacingLength === 0 &&
      observations.bubble.letterSpacingNonNegative;
    checks.buttonDangerBaseline = observations.cssRules.buttonDangerRuleFontInherit &&
      observations.cssRules.buttonDangerRuleWhiteSpaceNormal &&
      observations.cssRules.buttonDangerComputedFontMatches &&
      observations.cssRules.buttonDangerComputedWhiteSpaceNormal;

    for (const pageName of settingsPages) {
      await openSettingsPage(chat, pageName);
      for (const viewport of viewports) {
        observations.layouts.push(await inspectSettingsLayout(chat, pageName, viewport));
      }
    }

    checks.settingsLayoutsStable = observations.layouts.every((entry) => entry.ok);

    const residue = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidueBeforeCleanup = residue.length === 0;

    const result = {
      ok: false,
      safeSummaryOnly: true,
      checks,
      observations: {
        bubble: observations.bubble,
        cssRules: observations.cssRules,
        layoutLength: observations.layouts.length,
        failingLayouts: observations.layouts.filter((entry) => !entry.ok)
      },
      residueLength: residue.length
    };

    const privacyText = `${readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"])}\n${JSON.stringify(result)}`;
    checks.noForbiddenOutput = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
    result.ok = Object.values(checks).every(Boolean);

    writeFileSync(context.resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: result.ok,
      safeSummaryOnly: true,
      checks,
      layoutLength: observations.layouts.length,
      failingLayoutLength: result.observations.failingLayouts.length,
      residueLength: residue.length
    }, null, 2));

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const result = {
      ok: false,
      safeSummaryOnly: true,
      checks,
      observations: {
        bubble: observations.bubble,
        cssRules: observations.cssRules,
        layoutLength: observations.layouts.length,
        failingLayouts: observations.layouts.filter((entry) => !entry.ok)
      },
      failureCategory: classifyError(error)
    };
    writeFileSync(context.resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: false,
      safeSummaryOnly: true,
      checks,
      failureCategory: result.failureCategory
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_11H_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await waitFor(pet, "document.querySelector('#proactive-speech-bubble')?.dataset.state === 'visible'", { timeoutMs: 10_000 });
  return pet;
}

async function openChat(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#settings-button'))");
  await sleep(300);
  return chat;
}

async function inspectBubbleVisual(pet) {
  return evaluate(pet, `
    (() => {
      const bubble = document.querySelector("#proactive-speech-bubble");
      if (!bubble) throw new Error("Missing proactive speech bubble");

      const style = getComputedStyle(bubble);
      const rect = bubble.getBoundingClientRect();
      const textLength = [...(bubble.textContent ?? "")].length;
      const backgroundImage = style.backgroundImage;
      const boxShadow = style.boxShadow;
      const letterSpacing = style.letterSpacing;
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      const rgbNear = (value, target) => {
        const parts = value.match(/\\d+(?:\\.\\d+)?/g)?.slice(0, 3).map(Number) ?? [];
        return parts.length === 3 && parts.every((part, index) => Math.abs(part - target[index]) <= 3);
      };

      const shadowIsLight = (value) => {
        if (!value || value === "none") return true;
        const pxValues = (value.match(/-?\\d+(?:\\.\\d+)?px/g) ?? [])
          .map((item) => Math.abs(Number(item.replace("px", ""))));
        const alphaValues = [...value.matchAll(/rgba?\\([^)]*,\\s*([0-9.]+)\\)/g)]
          .map((match) => Number(match[1]))
          .filter((item) => !Number.isNaN(item));
        const maxPx = pxValues.length > 0 ? Math.max(...pxValues) : 0;
        const maxAlpha = alphaValues.length > 0 ? Math.max(...alphaValues) : 1;
        return maxPx <= 8 && maxAlpha <= 0.12;
      };

      const roundedRect = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };

      return {
        selector: "#proactive-speech-bubble",
        stateVisible: bubble.dataset.state === "visible",
        pointerEventsNone: style.pointerEvents === "none",
        topLeft: rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.left <= viewport.width * 0.35 &&
          rect.top <= viewport.height * 0.24 &&
          rect.right <= viewport.width * 0.68 &&
          rect.bottom <= viewport.height * 0.36,
        shortText: textLength > 0 && textLength <= 16,
        parchmentBackground: rgbNear(style.backgroundColor, [255, 250, 240]),
        lightBorder: parseFloat(style.borderTopWidth) <= 1.5 && rgbNear(style.borderTopColor, [231, 220, 203]),
        warmText: rgbNear(style.color, [75, 57, 40]),
        noGradient: backgroundImage === "none" || !/gradient/i.test(backgroundImage),
        lightShadow: shadowIsLight(boxShadow),
        letterSpacingNonNegative: letterSpacing === "normal" || !letterSpacing.trim().startsWith("-"),
        textLength,
        backgroundImageLength: backgroundImage === "none" ? 0 : backgroundImage.length,
        boxShadowLength: boxShadow === "none" ? 0 : boxShadow.length,
        rect: roundedRect,
        viewport
      };
    })()
  `);
}

async function inspectChatCssRules(chat) {
  return evaluate(chat, `
    (() => {
      const ruleSummaries = [];
      for (const sheet of document.styleSheets) {
        let rules = [];
        try {
          rules = [...sheet.cssRules];
        } catch {
          continue;
        }

        for (const rule of rules) {
          if (!rule.selectorText || !rule.style) continue;
          ruleSummaries.push({
            selector: rule.selectorText,
            font: rule.style.font,
            whiteSpace: rule.style.whiteSpace,
            letterSpacing: rule.style.letterSpacing
          });
        }
      }

      const focusVisibleRules = ruleSummaries.filter((rule) => rule.selector.includes(":focus-visible"));
      const buttonDangerRule = ruleSummaries.find((rule) => rule.selector.split(",").map((part) => part.trim()).includes(".button-danger"));
      const negativeLetterSpacing = ruleSummaries.filter((rule) => {
        const value = rule.letterSpacing?.trim();
        return value && value !== "normal" && /^-/.test(value);
      });

      const danger = document.querySelector(".button-danger");
      const baseline = document.querySelector(".button");
      const dangerStyle = danger ? getComputedStyle(danger) : null;
      const baselineStyle = baseline ? getComputedStyle(baseline) : null;
      const computedFontMatches = Boolean(dangerStyle && baselineStyle &&
        dangerStyle.fontFamily === baselineStyle.fontFamily &&
        dangerStyle.fontSize === baselineStyle.fontSize &&
        dangerStyle.lineHeight === baselineStyle.lineHeight);

      return {
        focusVisibleExists: focusVisibleRules.length > 0,
        focusVisibleLength: focusVisibleRules.length,
        focusVisibleSelectors: focusVisibleRules.slice(0, 8).map((rule) => ({ selector: rule.selector })),
        negativeLetterSpacingLength: negativeLetterSpacing.length,
        negativeLetterSpacingSelectors: negativeLetterSpacing.slice(0, 8).map((rule) => ({ selector: rule.selector })),
        buttonDangerSelector: ".button-danger",
        buttonDangerRuleFontInherit: buttonDangerRule?.font === "inherit",
        buttonDangerRuleWhiteSpaceNormal: buttonDangerRule?.whiteSpace === "normal",
        buttonDangerComputedFontMatches: computedFontMatches,
        buttonDangerComputedWhiteSpaceNormal: dangerStyle?.whiteSpace === "normal"
      };
    })()
  `);
}

async function inspectSettingsLayout(chat, pageName, viewport) {
  const harnessResult = await checkLayout(chat, viewport.width, viewport.height, {
    selectors: [
      ".chat-shell",
      "#settings-panel",
      ".settings-nav",
      ".settings-page:not([hidden]) .status-box",
      ".settings-page:not([hidden]) .selection-note",
      "#companion-control-shelf",
      ".settings-page:not([hidden]) .partner-status-band"
    ],
    controlSelector: "#settings-panel button, #settings-panel input, #settings-panel select, #settings-panel textarea"
  });

  await setViewport(chat, viewport);
  const detail = await evaluate(chat, `
    (() => {
      document.scrollingElement?.scrollTo(0, 0);
      document.querySelector("#settings-panel")?.scrollTo(0, 0);

      const selectors = ${JSON.stringify(layoutSelectors)};
      const visible = (node) => {
        if (!node || node.hidden || node.closest("[hidden]")) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const rectOf = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      };
      const intersectsViewport = (rect) => (
        rect.right >= 0 &&
        rect.left <= window.innerWidth &&
        rect.bottom >= 0 &&
        rect.top <= window.innerHeight
      );

      const nodes = [];
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          if (!visible(node)) continue;
          const rect = rectOf(node);
          nodes.push({
            node,
            selector: node.id ? "#" + node.id : selector,
            length: [...(node.textContent ?? "")].length,
            rect
          });
        }
      }

      const overflowing = nodes
        .filter((entry) => entry.rect.left < -1 || entry.rect.right > window.innerWidth + 1 || entry.rect.width <= 0 || entry.rect.height <= 0)
        .map(({ selector, length, rect }) => ({ selector, length, rect }));

      const overlapping = [];
      for (let index = 0; index < nodes.length; index += 1) {
        for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
          const left = nodes[index];
          const right = nodes[nextIndex];
          if (left.node.contains(right.node) || right.node.contains(left.node)) continue;
          if (!intersectsViewport(left.rect) || !intersectsViewport(right.rect)) continue;

          const xOverlap = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
          const yOverlap = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
          if (xOverlap > 1 && yOverlap > 1) {
            overlapping.push({
              selector: left.selector,
              otherSelector: right.selector,
              length: left.length + right.length,
              rect: {
                left: Math.round(Math.max(left.rect.left, right.rect.left)),
                top: Math.round(Math.max(left.rect.top, right.rect.top)),
                right: Math.round(Math.min(left.rect.right, right.rect.right)),
                bottom: Math.round(Math.min(left.rect.bottom, right.rect.bottom)),
                width: Math.round(xOverlap),
                height: Math.round(yOverlap)
              }
            });
          }
        }
      }

      return {
        selectorLength: nodes.length,
        overflowing,
        overlapping
      };
    })()
  `);
  await clearViewport(chat);

  return {
    safeSummaryOnly: true,
    pageName,
    viewport,
    ok: Boolean(harnessResult.ok && detail.overflowing.length === 0 && detail.overlapping.length === 0),
    harness: {
      ok: Boolean(harnessResult.ok),
      overflowingLength: harnessResult.overflowing.length,
      controlsLength: harnessResult.controls.length
    },
    selectorLength: detail.selectorLength,
    overflowing: detail.overflowing,
    overlapping: detail.overlapping
  };
}

async function setViewport(page, viewport) {
  await page.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
}

async function clearViewport(page) {
  await page.cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
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
