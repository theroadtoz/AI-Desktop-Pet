import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function createRealUiRunContext({
  runName,
  appDataDir,
  port = 9534,
  env = {},
  screenshotPatterns,
  tmpResiduePatterns
}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runParentDir = join(root, ".tmp", runName);
  const runDir = join(runParentDir, stamp);
  const resolvedAppDataDir = appDataDir ?? join(runDir, "user-data");
  const prefix = runName.split("-").slice(0, 2).join("-");

  mkdirSync(runDir, { recursive: true });

  return {
    root,
    runName,
    stamp,
    runParentDir,
    runDir,
    appDataDir: resolvedAppDataDir,
    resultPath: join(runDir, "result.json"),
    progressPath: join(runDir, "progress.log"),
    port,
    env,
    child: null,
    pages: [],
    screenshotPatterns: screenshotPatterns ?? [
      /^(screenshot.*|screen)\.png$/i,
      new RegExp(`^${escapeRegExp(prefix)}-.*\\.png$`, "i")
    ],
    tmpResiduePatterns: tmpResiduePatterns ?? [
      new RegExp(`^${escapeRegExp(prefix)}-`, "i")
    ]
  };
}

export function log(context, message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(context.progressPath, `${line}\n`, { flag: "a" });
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

function asCdp(page) {
  return page?.cdp ?? page;
}

export function startElectron(context) {
  const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
  const electronCmd = existsSync(electronExe) ? electronExe : join(root, "node_modules", ".bin", "electron.cmd");
  const child = spawn(electronCmd, [".", `--remote-debugging-port=${context.port}`], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: context.appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: context.appDataDir,
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      ...context.env
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(context.runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(context.runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(context.runDir, "electron.pid"), String(child.pid ?? ""));
  context.child = child;
  return child;
}

export async function connectToElectron(context, timeoutMs = 30_000) {
  return waitForJson(`http://127.0.0.1:${context.port}/json/version`, timeoutMs);
}

export async function getPageByUrlPart(context, urlPart, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await waitForJson(`http://127.0.0.1:${context.port}/json/list`, 10_000);
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(urlPart));
    if (target) {
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      const page = { target, cdp };
      context.pages.push(page);
      return page;
    }
    await sleep(300);
  }
  throw new Error(`Target not found: ${urlPart}`);
}

export const waitForWindow = getPageByUrlPart;

export async function evaluate(page, expression, awaitPromise = true) {
  const result = await asCdp(page).send("Runtime.evaluate", {
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

export async function waitFor(page, expression, options = {}) {
  const timeoutMs = typeof options === "number" ? options : options.timeoutMs ?? 10_000;
  const intervalMs = typeof options === "number" ? 150 : options.intervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(page, expression);
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

export async function click(page, selector) {
  await evaluate(page, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.click();
    })()
  `);
  await sleep(250);
}

export async function typeText(page, selector, text) {
  await evaluate(page, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.focus();
      element.value = ${JSON.stringify(text)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await sleep(150);
}

export const chatUiSelectors = {
  chat: {
    page: "#chat-page",
    messages: "#messages",
    input: "#chat-input",
    send: "#send-button",
    settings: "#settings-button"
  },
  settings: {
    panel: "#settings-panel",
    close: "#settings-close-button",
    basicTab: "#settings-basic-tab",
    memoryTab: "#settings-memory-tab",
    historyTab: "#settings-history-tab",
    appearanceTab: "#settings-appearance-tab",
    modelTab: "#settings-model-tab",
    advancedTab: "#settings-advanced-tab",
    basicPage: "#settings-basic-page",
    memoryPage: "#memory-page",
    historyPage: "#history-page",
    appearancePage: "#settings-appearance-page",
    modelPage: "#settings-model-page",
    advancedPage: "#settings-advanced-page",
    memoryDetailPage: "#settings-memory-detail-page",
    historyDetailPage: "#settings-history-detail-page",
    modelDetailPage: "#settings-model-detail-page",
    modelDetailButton: "#settings-model-detail-button"
  },
  profile: {
    displayName: "#settings-user-display-name",
    preferredName: "#settings-user-preferred-name",
    save: "#save-user-profile-button",
    summary: "#user-profile-summary"
  },
  modes: {
    dialogueControls: "#dialogue-mode-controls",
    presenceControls: "#presence-mode-controls"
  },
  model: {
    providerId: "#provider-id",
    localPreset: "#local-provider-preset",
    baseURL: "#provider-base-url",
    model: "#provider-model",
    healthCheck: "#provider-health-check-button",
    healthStatus: "#provider-health-status"
  }
};

const settingsTabByPage = {
  basic: chatUiSelectors.settings.basicTab,
  memory: chatUiSelectors.settings.memoryTab,
  history: chatUiSelectors.settings.historyTab,
  appearance: chatUiSelectors.settings.appearanceTab,
  model: chatUiSelectors.settings.modelTab,
  advanced: chatUiSelectors.settings.advancedTab
};

const settingsPageByPage = {
  basic: chatUiSelectors.settings.basicPage,
  memory: chatUiSelectors.settings.memoryPage,
  history: chatUiSelectors.settings.historyPage,
  appearance: chatUiSelectors.settings.appearancePage,
  model: chatUiSelectors.settings.modelPage,
  advanced: chatUiSelectors.settings.advancedPage
};

export async function openSettingsPage(page, settingsPage = "basic") {
  const tab = settingsTabByPage[settingsPage];
  const pageSelector = settingsPageByPage[settingsPage];

  if (!tab || !pageSelector) {
    throw new Error(`Unknown settings page: ${settingsPage}`);
  }

  const isOpen = await evaluate(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.panel)})?.hidden === false`);
  if (!isOpen) {
    await click(page, chatUiSelectors.chat.settings);
  }

  await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.panel)})?.hidden === false`);
  await click(page, tab);
  await waitFor(page, `document.querySelector(${JSON.stringify(pageSelector)})?.hidden === false`);
}

export async function openModelSettings(page, options = {}) {
  await openSettingsPage(page, "model");

  if (options.detail !== false) {
    await click(page, chatUiSelectors.settings.modelDetailButton);
    await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.modelDetailPage)})?.hidden === false`);
  }
}

export async function openMemorySettings(page, options = {}) {
  await openSettingsPage(page, "memory");

  if (options.detail === true) {
    await waitFor(page, "document.querySelector('.memory-card .button-light')");
    await evaluate(page, `
      (() => {
        const button = [...document.querySelectorAll(".memory-card .button-light")]
          .find((item) => item.textContent?.includes("查看内容"));
        if (!button) throw new Error("Missing memory detail button");
        button.click();
      })()
    `);
    await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.memoryDetailPage)})?.hidden === false`);
  }
}

export async function openHistorySettings(page) {
  await openSettingsPage(page, "history");
}

export async function openAppearanceSettings(page) {
  await openSettingsPage(page, "appearance");
}

export async function openAdvancedSettings(page) {
  await openSettingsPage(page, "advanced");
}

export async function closeSettingsPage(page) {
  const isOpen = await evaluate(page, `document.querySelector(${JSON.stringify(chatUiSelectors.settings.panel)})?.hidden === false`);
  if (isOpen) {
    await click(page, chatUiSelectors.settings.close);
  }
  await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.chat.page)})?.hidden === false`);
}

export async function openChatPage(page) {
  await closeSettingsPage(page);
}

export async function setDialogueMode(page, modeId) {
  await openSettingsPage(page, "basic");
  await click(page, `${chatUiSelectors.modes.dialogueControls} .mode-button[data-mode-id="${modeId}"]`);
  await waitFor(page, `document.querySelector('${chatUiSelectors.modes.dialogueControls} .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

export async function setPresenceMode(page, modeId) {
  await openSettingsPage(page, "basic");
  await click(page, `${chatUiSelectors.modes.presenceControls} .mode-button[data-mode-id="${modeId}"]`);
  await waitFor(page, `document.querySelector('${chatUiSelectors.modes.presenceControls} .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

export async function saveWelcomeProfile(page, profile) {
  await openSettingsPage(page, "basic");
  await typeText(page, chatUiSelectors.profile.displayName, profile.displayName);
  await typeText(page, chatUiSelectors.profile.preferredName, profile.preferredName ?? "");
  await click(page, chatUiSelectors.profile.save);
  await waitFor(page, `document.querySelector(${JSON.stringify(chatUiSelectors.profile.summary)})?.textContent.includes(${JSON.stringify(profile.displayName)})`);
  await closeSettingsPage(page);
}

async function setViewport(page, width, height) {
  await asCdp(page).send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
}

export async function checkLayout(page, width, height, options = {}) {
  const selectors = options.selectors ?? [
    ".chat-shell",
    "#messages",
    "#chat-form"
  ];
  const controlSelector = options.controlSelector ?? "#chat-form button, #chat-form input";

  await setViewport(page, width, height);
  const result = await evaluate(page, `
    (() => {
      const visible = (node) => {
        if (!node || node.hidden || node.closest("[hidden]")) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const selectors = ${JSON.stringify(selectors)};
      const overflowing = [];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.width <= 0 || rect.height <= 0) {
          overflowing.push(selector);
        }
      }
      const controls = [...document.querySelectorAll(${JSON.stringify(controlSelector)})]
        .filter(visible)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1 || rect.height <= 0;
        })
        .map((node) => node.id || node.textContent);
      return { ok: overflowing.length === 0 && controls.length === 0, overflowing, controls };
    })()
  `);
  await asCdp(page).send("Emulation.clearDeviceMetricsOverride");
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

export function readPrivacyCheckText(context, files = ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]) {
  const texts = readTextFiles(join(context.appDataDir, "logs"));
  for (const fileName of files) {
    const filePath = join(context.runDir, fileName);
    if (existsSync(filePath)) {
      texts.push(readFileSync(filePath, "utf8"));
    }
  }
  return texts.join("\n");
}

export function findScreenshotResidue(context, directory = root, matches = []) {
  const ignored = new Set([".git", "node_modules", "dist", "dist-renderer"]);

  if (!existsSync(directory)) {
    return matches;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isInside(fullPath, join(root, ".tmp")) && context.tmpResiduePatterns.some((pattern) => pattern.test(entry.name))) {
        matches.push(fullPath);
      } else {
        findScreenshotResidue(context, fullPath, matches);
      }
      continue;
    }

    if (context.screenshotPatterns.some((pattern) => pattern.test(entry.name))) {
      matches.push(fullPath);
    }
  }

  return matches;
}

export function assertNoScreenshotResidue(context) {
  const residue = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
  if (residue.length > 0) {
    throw new Error(`Screenshot residue found: ${JSON.stringify(residue)}`);
  }
}

export function cleanupRunDir(context) {
  cleanupRealUiRun(context);
}

export function cleanupRealUiRun(context) {
  const tmpRoot = join(root, ".tmp");
  if (!isInside(context.runParentDir, tmpRoot)) {
    throw new Error(`Refusing to clean outside .tmp: ${context.runParentDir}`);
  }
  rmSync(context.runParentDir, { recursive: true, force: true });
}

export async function stopElectron(context) {
  const seen = new Set();
  for (const page of context.pages) {
    if (!page?.cdp || seen.has(page.cdp)) {
      continue;
    }
    seen.add(page.cdp);
    page.cdp.close();
  }
  context.child?.kill();
  context.child = null;
  context.pages = [];
  await sleep(1_000);
}

function isInside(targetPath, parentPath) {
  const target = resolve(targetPath).toLowerCase();
  const parent = resolve(parentPath).toLowerCase();
  return target === parent || target.startsWith(`${parent}\\`) || target.startsWith(`${parent}/`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
