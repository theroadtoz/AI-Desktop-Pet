import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runParentDir = join(root, ".tmp", "p2-11c-chat-ui-hierarchical-restructure-real-ui");
const runDir = join(runParentDir, stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_11C_CDP_PORT || 9531);
const userSentinel = "P2-11C 用户正文哨兵";
const memorySentinel = "P2-11C 事实卡正文哨兵";
const apiKeySentinel = "sk-p2-11c";
const forbiddenTexts = [
  userSentinel,
  memorySentinel,
  apiKeySentinel,
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

async function saveWelcomeProfile(cdp, displayName, preferredName) {
  await evaluate(cdp, `
    (() => {
      document.querySelector("#welcome-user-display-name").value = ${JSON.stringify(displayName)};
      document.querySelector("#welcome-user-preferred-name").value = ${JSON.stringify(preferredName)};
      document.querySelector("#welcome-save-user-profile-button").click();
    })()
  `);
  await waitFor(cdp, "document.querySelector('#user-welcome-panel')?.hidden === true");
}

async function setMode(cdp, modeId) {
  await click(cdp, `.mode-button[data-mode-id="${modeId}"]`);
  await waitFor(cdp, `document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

async function sendMessage(cdp, message) {
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()
  `);
  await waitFor(cdp, "document.querySelector('#memory-session-status')?.textContent.includes('正在回复')");
  await waitFor(cdp, "document.querySelector('#send-button')?.disabled === false", 20_000);
}

async function checkNarrowLayout(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
  const ok = await evaluate(cdp, `
    (() => {
      const selectors = [
        ".partner-status-band",
        "#dialogue-mode-controls",
        "#chat-form",
        "#settings-panel"
      ];
      return selectors.every((selector) => {
        const node = document.querySelector(selector);
        if (!node || node.hidden) return true;
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0 && rect.height > 0;
      }) &&
      [...document.querySelectorAll(".mode-button, #chat-form button")].every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.height > 0;
      });
    })()
  `);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
  return ok;
}

function readTextFiles(directory, recursive = true) {
  if (!existsSync(directory)) {
    return [];
  }

  const texts = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory() && recursive) {
      texts.push(...readTextFiles(fullPath, recursive));
      continue;
    }

    if (/\.(json|jsonl|log)$/i.test(entry.name)) {
      texts.push(readFileSync(fullPath, "utf8"));
    }
  }

  return texts;
}

function readPrivacyCheckText() {
  const telemetryDir = join(appDataDir, "logs");
  const texts = readTextFiles(telemetryDir);

  for (const fileName of ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]) {
    const filePath = join(runDir, fileName);
    if (existsSync(filePath)) {
      texts.push(readFileSync(filePath, "utf8"));
    }
  }

  return texts.join("\n");
}

function findScreenshotResidue(directory) {
  const ignored = new Set([".git", "node_modules", "dist"]);
  const matches = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findScreenshotResidue(fullPath));
      continue;
    }

    if (/^(screenshot.*|screen)\.png$/i.test(entry.name)) {
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
    checks.ribbonAfterWelcomeInChatFlow = await evaluate(chat, `
      (() => {
        const welcome = document.querySelector("#user-welcome-panel");
        const ribbon = document.querySelector(".partner-status-band");
        return Boolean(welcome && ribbon && (welcome.compareDocumentPosition(ribbon) & Node.DOCUMENT_POSITION_FOLLOWING));
      })()
    `);

    await saveWelcomeProfile(chat, "验收用户", "店长");
    checks.ribbonShowsIdentityAndDefaultMode = await evaluate(chat, `
      (() => {
        const text = document.querySelector("#partner-status")?.textContent ?? "";
        return text.includes("店长") && text.includes("默认陪伴");
      })()
    `);

    for (const modeId of ["work", "game", "reading", "default"]) {
      await setMode(chat, modeId);
    }
    checks.modeSwitchSyncsRibbon = await evaluate(chat, `
      (() => {
        const text = document.querySelector("#partner-status")?.textContent ?? "";
        return text.includes("默认陪伴") && document.querySelector("#dialogue-mode-controls .mode-button.is-active")?.dataset.modeId === "default";
      })()
    `);

    await click(chat, "#settings-button");
    checks.settingsEntryRenamed = await evaluate(chat, `
      (() => {
        return document.querySelector("#settings-button")?.getAttribute("aria-label")?.includes("伙伴与对话设置") &&
          document.querySelector("#settings-panel")?.getAttribute("aria-label") === "伙伴与对话设置" &&
          document.querySelector(".settings-header h2")?.textContent === "伙伴与对话设置";
      })()
    `);
    checks.settingsSectionsOrdered = await evaluate(chat, `
      (() => [...document.querySelectorAll(".settings-section-title")].map((node) => node.textContent).join("|"))()
    `) === "伙伴外观|本地身份|对话模式|Provider / 模型|连接安全|操作方式";
    checks.settingsModeSummaryVisible = await evaluate(chat, "document.querySelector('#settings-dialogue-mode-summary')?.textContent.includes('默认陪伴')");

    checks.providerOptionsStillSwitchable = await evaluate(chat, `
      (() => {
        const provider = document.querySelector("#provider-id");
        const openaiFields = document.querySelector("#openai-fields");
        const security = document.querySelector("#connection-safe-section");
        const options = [...provider.options].map((option) => option.value).join("|");
        provider.value = "openai-compatible";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        const cloudShowsFields = openaiFields.hidden === false && security.hidden === false;
        provider.value = "local-openai-compatible";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        const localShowsModelOnly = openaiFields.hidden === false && security.hidden === true;
        provider.value = "fake";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        return options === "fake|openai-compatible|local-openai-compatible" &&
          cloudShowsFields &&
          localShowsModelOnly &&
          openaiFields.hidden === true;
      })()
    `);

    await evaluate(chat, `
      (() => {
        document.querySelector("#settings-user-display-name").value = "修改后用户";
        document.querySelector("#settings-user-preferred-name").value = "馆长";
        document.querySelector("#save-user-profile-button").click();
      })()
    `);
    await waitFor(chat, "document.querySelector('#partner-status')?.textContent.includes('馆长')");
    checks.settingsProfileCanModify = true;
    checks.shortcutSettingsVisible = await evaluate(chat, "document.querySelector('#shortcut-title')?.textContent === '操作方式' && Boolean(document.querySelector('#shortcut-list'))");
    await click(chat, "#settings-close-button");

    await evaluate(chat, `
      (async () => {
        await window.memoryApi.setEnabled(true);
        await window.memoryApi.createCard({
          title: "P2-11C 验收事实卡",
          content: ${JSON.stringify(memorySentinel)},
          tags: ["p2-11c"],
          sourceConversationId: crypto.randomUUID()
        });
      })()
    `);
    await sendMessage(chat, userSentinel);
    checks.ribbonShowsMemoryCountWithoutContent = await evaluate(chat, `
      (() => {
        const ribbon = document.querySelector("#memory-session-status")?.textContent ?? "";
        const note = document.querySelector("#chat-session-note")?.textContent ?? "";
        return ribbon.includes("本次使用 1 条记忆") &&
          !ribbon.includes(${JSON.stringify(memorySentinel)}) &&
          !note.includes(${JSON.stringify(memorySentinel)}) &&
          !ribbon.includes(${JSON.stringify(userSentinel)});
      })()
    `);

    await click(chat, "#memory-tab");
    checks.memoryPageStillAccessible = await evaluate(chat, "document.querySelector('#memory-page')?.hidden === false && document.querySelector('#memory-feedback')?.textContent.includes('Provider 请求')");
    await click(chat, "#history-tab");
    checks.historyPageStillAccessible = await evaluate(chat, "document.querySelector('#history-page')?.hidden === false && document.querySelector('#history-feedback')?.textContent.includes('不会自动发送给 Provider')");
    await click(chat, "#chat-tab");
    await click(chat, "#settings-button");
    checks.narrowLayout = await checkNarrowLayout(chat);

    await evaluate(chat, "document.querySelector('#clear-user-profile-button').click()");
    await waitFor(chat, "document.querySelector('#user-welcome-panel')?.hidden === false");
    checks.settingsProfileCanClear = await evaluate(chat, "document.querySelector('#partner-status')?.textContent.includes('等待本地身份')");

    snapshot = await evaluate(chat, `
      (() => ({
        partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
        providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
        memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? "",
        settingsTitle: document.querySelector(".settings-header h2")?.textContent ?? "",
        modeSummary: document.querySelector("#settings-dialogue-mode-summary")?.textContent ?? ""
      }))()
    `);

    const textOutput = readPrivacyCheckText();
    checks.resultPrivacy = forbiddenTexts.every((text) => !textOutput.includes(text));
    checks.noScreenshotResidue = findScreenshotResidue(root).length === 0;

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      provider: "fake",
      port,
      checks,
      finalUi: snapshot,
      screenshotResidue: findScreenshotResidue(root)
    };
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`checks=${JSON.stringify(checks)}`);
    log(`result=${resultPath}`);

    if (!result.ok) {
      throw new Error(`P2-11C real UI checks failed: ${JSON.stringify(checks)}`);
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
    screenshotResidue: findScreenshotResidue(root)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(result.error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_11C_KEEP_TMP !== "1") {
    rmSync(runDir, { recursive: true, force: true });
    if (existsSync(runParentDir) && readdirSync(runParentDir).length === 0) {
      rmSync(runParentDir, { recursive: true, force: true });
    }
  }
});
