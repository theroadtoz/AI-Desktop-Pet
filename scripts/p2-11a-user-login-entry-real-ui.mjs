import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-11a-user-login-entry-real-ui", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_11A_CDP_PORT || 9531);

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
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  return child;
}

async function stopElectron(child, handles) {
  handles.pet?.cdp.close();
  handles.chat?.cdp.close();
  child?.kill();
  await sleep(1_000);
}

async function openChatWindow(child, handles) {
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
  handles.pet = await connectTarget("renderer/pet/index.html");
  await sleep(800);
  await evaluate(handles.pet.cdp, "window.petApi?.openChat()");
  handles.chat = await connectTarget("renderer/chat/index.html");
  return handles.chat.cdp;
}

async function uiSnapshot(cdp) {
  return evaluate(cdp, `(() => ({
    welcomeHidden: document.querySelector("#user-welcome-panel")?.hidden === true,
    chatFormHidden: document.querySelector("#chat-form")?.hidden === true,
    chatNoteHidden: document.querySelector("#chat-session-note")?.hidden === true,
    welcomeFeedback: document.querySelector("#user-welcome-feedback")?.textContent ?? "",
    partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
    profileSummary: document.querySelector("#user-profile-summary")?.textContent ?? "",
    providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
    modeLabels: [...document.querySelectorAll("#dialogue-mode-controls button")].map((button) => button.textContent),
    settingsTitles: [...document.querySelectorAll(".settings-section-title")].map((title) => title.textContent),
    shortcutRows: document.querySelectorAll(".shortcut-row").length,
    activeTab: document.querySelector(".subpage-tab.is-active")?.textContent ?? ""
  }))()`);
}

async function click(cdp, selector) {
  await evaluate(cdp, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing selector: ${selector}");
      element.click();
    })()
  `);
  await sleep(200);
}

async function fill(cdp, selector, value) {
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error("Missing selector: ${selector}");
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
}

async function runFirstLaunch(checks) {
  const child = launchElectron();
  const handles = {};

  try {
    const chat = await openChatWindow(child, handles);
    await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
    let snapshot = await uiSnapshot(chat);
    checks.firstLaunchWelcomeVisible = !snapshot.welcomeHidden && snapshot.chatFormHidden && snapshot.partnerStatus.includes("等待本地身份");
    checks.initialUiNotDebug = snapshot.welcomeFeedback === "" && snapshot.providerStatus.includes("Fake Provider");

    await fill(chat, "#welcome-user-display-name", "小夏");
    await fill(chat, "#welcome-user-preferred-name", "夏夏");
    await click(chat, "#welcome-save-user-profile-button");
    await waitFor(chat, "document.querySelector('#user-welcome-panel')?.hidden === true");
    snapshot = await uiSnapshot(chat);
    checks.welcomeSaveEntersChat = snapshot.welcomeHidden && !snapshot.chatFormHidden && snapshot.partnerStatus.includes("夏夏");

    await click(chat, "#settings-button");
    snapshot = await uiSnapshot(chat);
    checks.settingsProfileSection = snapshot.settingsTitles.includes("本地身份") && snapshot.profileSummary.includes("小夏") && snapshot.profileSummary.includes("夏夏");
    checks.providerModeShortcutStillPresent = snapshot.settingsTitles.includes("Provider") &&
      snapshot.settingsTitles.includes("快捷键") &&
      snapshot.modeLabels.includes("工作") &&
      snapshot.shortcutRows > 0;

    await fill(chat, "#settings-user-display-name", "小林");
    await fill(chat, "#settings-user-preferred-name", "林林");
    await click(chat, "#save-user-profile-button");
    await waitFor(chat, "document.querySelector('#partner-status')?.textContent.includes('林林')");
    snapshot = await uiSnapshot(chat);
    checks.settingsEditUpdatesIdentity = snapshot.profileSummary.includes("小林") && snapshot.profileSummary.includes("林林");

    const stored = await evaluate(chat, "window.userProfileApi?.getUserProfile()");
    checks.profileApiReturnsNoPath = stored?.displayName === "小林" && stored?.preferredName === "林林" && !("profilePath" in stored);
  } finally {
    await stopElectron(child, handles);
  }
}

async function runSecondLaunch(checks) {
  const child = launchElectron();
  const handles = {};

  try {
    const chat = await openChatWindow(child, handles);
    await waitFor(chat, "document.querySelector('#partner-status')?.textContent.includes('林林')");
    let snapshot = await uiSnapshot(chat);
    checks.restartPersistsIdentity = snapshot.welcomeHidden && !snapshot.chatFormHidden && snapshot.partnerStatus.includes("林林");

    await click(chat, "#settings-button");
    await click(chat, "#clear-user-profile-button");
    await waitFor(chat, "document.querySelector('#user-welcome-panel')?.hidden === false");
    snapshot = await uiSnapshot(chat);
    checks.clearReturnsToWelcome = !snapshot.welcomeHidden && snapshot.chatFormHidden && snapshot.profileSummary.includes("尚未设置");
  } finally {
    await stopElectron(child, handles);
  }
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const checks = {};

  try {
    await runFirstLaunch(checks);
    await runSecondLaunch(checks);

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      port,
      checks
    };
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    process.exitCode = 1;
    const result = {
      ok: false,
      runDir,
      appDataDir,
      port,
      checks,
      error: error instanceof Error ? error.stack : String(error)
    };
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    log(result.error);
  } finally {
    if (process.env.P2_11A_KEEP_TMP !== "1" && existsSync(runDir)) {
      rmSync(runDir, { recursive: true, force: true });
    }
  }
}

await main();
