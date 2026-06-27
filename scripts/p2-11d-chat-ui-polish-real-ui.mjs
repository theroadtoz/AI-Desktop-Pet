import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runParentDir = join(root, ".tmp", "p2-11d-chat-ui-polish-real-ui");
const runDir = join(runParentDir, stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_11D_CDP_PORT || 9532);
const userSentinel = "P2-11D 用户正文哨兵";
const memorySentinel = "P2-11D 事实卡正文哨兵";
const forbiddenTexts = [
  userSentinel,
  memorySentinel,
  "API Key sk-",
  "provider request body",
  "system prompt",
  "完整 prompt"
];

mkdirSync(runDir, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(progressPath, `${line}\n`, { flag: "a" });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(300);
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));

    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 15_000).unref();
    });
  }

  close() {
    this.socket?.close();
  }
}

async function connectTarget(partialUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 10_000);
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(partialUrl));
    if (target) {
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return { target, cdp };
    }
    await sleep(300);
  }
  throw new Error(`Target not found: ${partialUrl}`);
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }

  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, expression);
    if (value) {
      return value;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function launchElectron() {
  const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
  const electronCmd = existsSync(electronExe) ? electronExe : join(root, "node_modules", ".bin", "electron.cmd");
  const child = spawn(electronCmd, [".", `--remote-debugging-port=${port}`], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: appDataDir,
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(runDir, "electron.pid"), String(child.pid ?? ""));
  return child;
}

async function openChat() {
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
  const pet = await connectTarget("renderer/pet/index.html");
  await sleep(800);
  await evaluate(pet.cdp, "window.petApi?.openChat()");
  const chat = await connectTarget("renderer/chat/index.html");
  await waitFor(chat.cdp, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  return { pet, chat };
}

async function stopElectron(child, handles) {
  handles?.pet?.cdp.close();
  handles?.chat?.cdp.close();
  child?.kill();
  await sleep(1_000);
}

async function click(cdp, selector) {
  await evaluate(cdp, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.click();
    })()
  `);
  await sleep(250);
}

async function saveWelcomeProfile(cdp) {
  await evaluate(cdp, `
    (() => {
      document.querySelector("#welcome-user-display-name").value = "验收用户";
      document.querySelector("#welcome-user-preferred-name").value = "馆长";
      document.querySelector("#welcome-save-user-profile-button").click();
    })()
  `);
  await waitFor(cdp, "document.querySelector('#user-welcome-panel')?.hidden === true");
}

async function setMode(cdp, modeId) {
  await click(cdp, `.mode-button[data-mode-id="${modeId}"]`);
  await waitFor(cdp, `document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

async function sendMessage(cdp, message, abort = false) {
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()
  `);
  await waitFor(cdp, "document.querySelector('#send-button')?.disabled === true");

  if (abort) {
    await click(cdp, "#abort-button");
  }

  await waitFor(cdp, "document.querySelector('#send-button')?.disabled === false", 20_000);
}

async function setViewport(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
}

async function checkLayout(cdp, width, height) {
  await setViewport(cdp, width, height);
  const result = await evaluate(cdp, `
    (() => {
      const visible = (node) => {
        if (!node || node.hidden) return false;
        if (node.closest("[hidden]")) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const selectors = [
        ".chat-shell",
        ".subpage-nav",
        ".partner-status-band",
        "#dialogue-mode-controls",
        "#chat-session-note",
        "#messages",
        "#chat-form",
        "#settings-panel"
      ];
      const overflowing = [];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.width <= 0 || rect.height <= 0) {
          overflowing.push(selector);
        }
      }
      const controlOverflow = [...document.querySelectorAll("button, input, select, textarea")]
        .filter(visible)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1 || rect.height <= 0;
        })
        .map((node) => node.id || node.className || node.tagName);
      return { ok: overflowing.length === 0 && controlOverflow.length === 0, overflowing, controlOverflow };
    })()
  `);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
  return result;
}

function readTextFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const texts = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      texts.push(...readTextFiles(fullPath));
      continue;
    }
    if (/\.(json|jsonl|log)$/i.test(entry.name)) {
      texts.push(readFileSync(fullPath, "utf8"));
    }
  }
  return texts;
}

function readPrivacyCheckText() {
  const texts = readTextFiles(join(appDataDir, "logs"));
  for (const fileName of ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]) {
    const filePath = join(runDir, fileName);
    if (existsSync(filePath)) {
      texts.push(readFileSync(filePath, "utf8"));
    }
  }
  return texts.join("\n");
}

function findResidue(directory) {
  const ignored = new Set([".git", "node_modules", "dist"]);
  const matches = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (/^p2-11d-/.test(entry.name) && fullPath.includes(`${join(root, ".tmp")}`)) {
        matches.push(fullPath);
      } else {
        matches.push(...findResidue(fullPath));
      }
      continue;
    }

    if (/^(screenshot.*|screen|p2-11d-.*)\.png$/i.test(entry.name)) {
      matches.push(fullPath);
    }
  }

  return matches;
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const child = launchElectron();
  let handles = {};
  const checks = {};
  let snapshot = {};

  try {
    handles = await openChat();
    const chat = handles.chat.cdp;

    checks.firstLaunchWelcomeVisible = await evaluate(chat, "document.querySelector('#user-welcome-panel')?.hidden === false");
    checks.emptyChatStateVisible = await evaluate(chat, `
      getComputedStyle(document.querySelector("#messages"), "::before").content.includes("还没有消息")
    `);

    await saveWelcomeProfile(chat);
    checks.chatMainPathVisible = await evaluate(chat, `
      (() => !document.querySelector("#chat-form")?.hidden &&
        !document.querySelector("#messages")?.hidden &&
        document.querySelector("#partner-status")?.textContent.includes("馆长"))()
    `);

    for (const modeId of ["work", "game", "reading", "default"]) {
      await setMode(chat, modeId);
    }
    checks.modeSwitchSyncsRibbon = await evaluate(chat, `
      (() => document.querySelector("#partner-status")?.textContent.includes("默认陪伴") &&
        document.querySelector("#dialogue-mode-controls .mode-button.is-active")?.dataset.modeId === "default")()
    `);

    await click(chat, "#settings-button");
    checks.settingsSectionsOrdered = await evaluate(chat, `
      (() => [...document.querySelectorAll(".settings-section-title")].map((node) => node.textContent).join("|"))()
    `) === "伙伴外观|本地身份|对话模式|Provider / 模型|连接安全|操作方式";
    checks.providerAndSafetySections = await evaluate(chat, `
      (() => {
        const provider = document.querySelector("#provider-id");
        const openaiFields = document.querySelector("#openai-fields");
        const security = document.querySelector("#connection-safe-section");
        provider.value = "openai-compatible";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        const cloud = openaiFields.hidden === false && security.hidden === false;
        provider.value = "local-openai-compatible";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        const local = openaiFields.hidden === false && security.hidden === true &&
          document.querySelector("#local-provider-note")?.hidden === false;
        provider.value = "fake";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        return cloud && local && openaiFields.hidden === true;
      })()
    `);
    checks.settingsLongTextWraps = await evaluate(chat, `
      (() => {
        document.querySelector("#provider-display-name").value = "VeryLongProviderNameWithoutSpaces-P2-11D-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        document.querySelector("#provider-model").value = "VeryLongModelNameWithoutSpaces-P2-11D-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        return true;
      })()
    `);

    const desktopLayoutWithSettings = await checkLayout(chat, 420, 640);
    checks.desktopLayoutWithSettings = desktopLayoutWithSettings.ok;
    await click(chat, "#settings-close-button");

    await evaluate(chat, `
      (async () => {
        await window.memoryApi.setEnabled(true);
        await window.memoryApi.createCard({
          title: "P2-11D 验收事实卡",
          content: ${JSON.stringify(memorySentinel)},
          tags: ["p2-11d"],
          sourceConversationId: crypto.randomUUID()
        });
      })()
    `);

    await sendMessage(chat, userSentinel);
    checks.sendingAndCompleteStates = await evaluate(chat, `
      (() => {
        const note = document.querySelector("#chat-session-note")?.textContent ?? "";
        const memory = document.querySelector("#memory-session-status")?.textContent ?? "";
        const messages = [...document.querySelectorAll(".message")];
        return note.includes("回复完成") &&
          memory.includes("本次使用 1 条记忆") &&
          messages.some((node) => node.classList.contains("message-user")) &&
          messages.some((node) => node.classList.contains("message-pet"));
      })()
    `);
    checks.ribbonHidesPrivateContent = await evaluate(chat, `
      (() => {
        const ribbon = [
          document.querySelector("#partner-status")?.textContent ?? "",
          document.querySelector("#provider-status")?.textContent ?? "",
          document.querySelector("#memory-session-status")?.textContent ?? ""
        ].join("\\n");
        return !ribbon.includes(${JSON.stringify(userSentinel)}) &&
          !ribbon.includes(${JSON.stringify(memorySentinel)}) &&
          !ribbon.includes("完整 prompt");
      })()
    `);

    await sendMessage(chat, "请用稍长一点的回复方便中断状态验收", true);
    checks.abortOrCompleteState = await evaluate(chat, `
      (() => {
        const note = document.querySelector("#chat-session-note")?.textContent ?? "";
        return note.includes("回复已中断") || note.includes("回复完成");
      })()
    `);

    await click(chat, "#memory-tab");
    checks.memoryPageAccessible = await evaluate(chat, "document.querySelector('#memory-page')?.hidden === false && document.querySelector('#memory-feedback')?.textContent.includes('Provider 请求')");
    await click(chat, "#history-tab");
    checks.historyPageAccessible = await evaluate(chat, "document.querySelector('#history-page')?.hidden === false && document.querySelector('#history-feedback')?.textContent.includes('不会自动发送给 Provider')");
    await click(chat, "#chat-tab");

    const desktopLayout = await checkLayout(chat, 420, 640);
    const narrowLayout = await checkLayout(chat, 360, 720);
    checks.desktopLayout = desktopLayout.ok;
    checks.narrowLayout = narrowLayout.ok;
    checks.focusVisibleRulesPresent = await evaluate(chat, `
      [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.selectorText?.includes(":focus-visible")))
    `);
    checks.noNegativeLetterSpacing = await evaluate(chat, `
      [...document.querySelectorAll("*")].every((node) => Number.parseFloat(getComputedStyle(node).letterSpacing || "0") >= 0 || getComputedStyle(node).letterSpacing === "normal")
    `);

    snapshot = await evaluate(chat, `
      (() => ({
        partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
        providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
        memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? "",
        chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
        visibleMessageCount: document.querySelectorAll(".message").length
      }))()
    `);

    const textOutput = readPrivacyCheckText();
    checks.resultPrivacy = forbiddenTexts.every((text) => !textOutput.includes(text));
    checks.noScreenshotResidueBeforeCleanup = findResidue(root).filter((path) => !path.includes(runParentDir)).length === 0;

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      provider: "fake",
      port,
      checks,
      layout: { desktopLayout, desktopLayoutWithSettings, narrowLayout },
      finalUi: snapshot,
      residue: findResidue(root)
    };
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`checks=${JSON.stringify(checks)}`);
    log(`finalUi=${JSON.stringify(snapshot)}`);
    log(`result=${JSON.stringify(result)}`);

    if (!result.ok) {
      throw new Error(`P2-11D real UI checks failed: ${JSON.stringify(checks)}`);
    }
  } finally {
    await stopElectron(child, handles);
  }
}

main().catch((error) => {
  const result = {
    ok: false,
    runDir,
    appDataDir,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    residue: findResidue(root)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(result.error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_11D_KEEP_TMP !== "1") {
    rmSync(runParentDir, { recursive: true, force: true });
  }
});
