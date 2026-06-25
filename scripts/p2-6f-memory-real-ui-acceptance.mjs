import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-6f-memory-real-ui-acceptance", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_6F_CDP_PORT || 9466);

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

async function listTargets() {
  return waitForJson(`http://127.0.0.1:${port}/json/list`, 30_000);
}

async function connectTarget(partialUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await listTargets();
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

function readMemoryStorage() {
  const memoryPath = join(appDataDir, "memory", "facts.json");
  if (!existsSync(memoryPath)) {
    return { memoryPath, storage: null, raw: "" };
  }
  const raw = readFileSync(memoryPath, "utf8");
  return { memoryPath, storage: JSON.parse(raw), raw };
}

function readTelemetrySummary() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return { logDirectory, files: [], eventCount: 0, containsForbiddenText: false };
  }

  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();
  const forbidden = ["P2-6F deleted sentinel", "sk-p2-6f", "provider request body"];
  let eventCount = 0;
  let containsForbiddenText = false;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    containsForbiddenText ||= forbidden.some((item) => text.includes(item));
    eventCount += text.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  return { logDirectory, files, eventCount, containsForbiddenText };
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

async function stopElectron(child, handles) {
  handles.pet?.cdp.close();
  handles.chat?.cdp.close();
  handles.browser?.close();
  child?.kill();
  await sleep(1_000);
}

async function startApp() {
  const child = launchElectron();
  const handles = {};
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
  handles.pet = await connectTarget("renderer/pet/index.html");
  const browserVersion = await fetchJson(`http://127.0.0.1:${port}/json/version`);
  handles.browser = new CdpClient(browserVersion.webSocketDebuggerUrl);
  await handles.browser.open();
  await sleep(1_500);
  await evaluate(handles.pet.cdp, "window.petApi?.openChat()");
  handles.chat = await connectTarget("renderer/chat/index.html");
  await waitFor(handles.chat.cdp, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  await installMemoryProbe(handles.chat.cdp);
  return { child, handles };
}

async function installMemoryProbe(cdp) {
  await evaluate(cdp, `
    (() => {
      window.__p26fMemoryEvents = [];
      if (!window.__p26fMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p26fMemoryEvents.push({ requestVersion: payload.requestVersion, count: payload.count });
        });
        window.__p26fMemoryProbeInstalled = true;
      }
    })()
  `);
}

async function click(cdp, selector) {
  await evaluate(cdp, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing selector: ${selector}");
      element.click();
    })()
  `);
  await sleep(250);
}

async function clickLastUserRemember(cdp) {
  await evaluate(cdp, `
    (() => {
      const buttons = [...document.querySelectorAll(".message-user .message-action")];
      const button = buttons.at(-1);
      if (!button) throw new Error("Missing last user remember button");
      button.click();
    })()
  `);
  await sleep(250);
}

async function fill(cdp, selector, value) {
  await evaluate(cdp, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing selector: ${selector}");
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await sleep(100);
}

async function sendMessage(cdp, message) {
  const before = await evaluate(cdp, "window.__p26fMemoryEvents.length");
  await fill(cdp, "#chat-input", message);
  await click(cdp, "#send-button");
  await waitFor(cdp, "document.querySelector('#send-button')?.disabled === false", 15_000);
  await waitFor(cdp, `window.__p26fMemoryEvents.length > ${before}`, 5_000);
  const events = await evaluate(cdp, "window.__p26fMemoryEvents");
  return events.at(-1);
}

async function uiSnapshot(cdp) {
  return evaluate(cdp, `
    (() => ({
      providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      memoryFeedback: document.querySelector("#memory-feedback")?.textContent ?? "",
      memoryButton: document.querySelector("#enable-memory-button")?.textContent ?? "",
      memoryCards: [...document.querySelectorAll(".memory-card")].map((card) => ({
        title: card.querySelector(".memory-title-input")?.value ?? "",
        content: card.querySelector("textarea")?.value ?? "",
        tags: card.querySelector("input:nth-of-type(2)")?.value ?? "",
        meta: card.querySelector(".selection-note")?.textContent ?? "",
        actions: [...card.querySelectorAll("button")].map((button) => button.textContent)
      })),
      visibleText: document.body.innerText
    }))()
  `);
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  let child;
  let handles = {};
  const checks = {};
  const injectionResults = {};

  try {
    ({ child, handles } = await startApp());
    const chat = handles.chat.cdp;

    await click(chat, "#memory-tab");
    await waitFor(chat, "document.querySelector('#memory-page')?.hidden === false");
    let snapshot = await uiSnapshot(chat);
    checks.defaultOff = snapshot.memoryButton === "开启记忆" && snapshot.memoryFeedback.includes("记忆默认关闭");

    await click(chat, "#chat-tab");
    await sendMessage(chat, "P2-6F disabled save attempt");
    await clickLastUserRemember(chat);
    await fill(chat, "#memory-draft-title", "P2-6F disabled draft");
    await fill(chat, "#memory-draft-content", "P2-6F disabled draft content");
    await fill(chat, "#memory-draft-tags", "p2-6f");
    await click(chat, "#save-memory-draft-button");
    await waitFor(chat, "document.querySelector('#chat-session-note')?.textContent.includes('记忆未开启')");
    checks.disabledSaveBlocked = (readMemoryStorage().storage?.cards?.length ?? 0) === 0;

    await click(chat, "#memory-tab");
    await click(chat, "#enable-memory-button");
    await waitFor(chat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    checks.enabledBeforeRestart = readMemoryStorage().storage?.enabled === true;

    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    const restartedChat = handles.chat.cdp;
    await click(restartedChat, "#memory-tab");
    await waitFor(restartedChat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    checks.enabledRestoredAfterRestart = readMemoryStorage().storage?.enabled === true;

    await click(restartedChat, "#chat-tab");
    await sendMessage(restartedChat, "P2-6F source message for saved memory");
    await clickLastUserRemember(restartedChat);
    await fill(restartedChat, "#memory-draft-title", "P2-6F enabled fact");
    await fill(restartedChat, "#memory-draft-content", "P2-6F enabled content sentinel");
    await fill(restartedChat, "#memory-draft-tags", "p2-6f,acceptance");
    await click(restartedChat, "#save-memory-draft-button");
    await waitFor(restartedChat, "document.querySelector('#chat-session-note')?.textContent.includes('事实卡已保存')");

    await click(restartedChat, "#memory-tab");
    await waitFor(restartedChat, "document.querySelectorAll('.memory-card').length === 1");
    snapshot = await uiSnapshot(restartedChat);
    checks.savedCardVisible = snapshot.memoryCards.length === 1 && snapshot.memoryCards[0].title === "P2-6F enabled fact";

    await fill(restartedChat, "#memory-search", "acceptance");
    await waitFor(restartedChat, "document.querySelectorAll('.memory-card').length === 1");
    await fill(restartedChat, "#memory-search", "no-match-p2-6f");
    await waitFor(restartedChat, "document.querySelector('#memory-list')?.textContent.includes('没有匹配')");
    checks.searchWorks = true;
    await fill(restartedChat, "#memory-search", "");

    await fill(restartedChat, ".memory-card .memory-title-input", "P2-6F edited fact");
    await fill(restartedChat, ".memory-card textarea", "P2-6F edited content sentinel");
    await fill(restartedChat, ".memory-card input:nth-of-type(2)", "p2-6f,edited");
    await click(restartedChat, ".memory-card .button");
    await waitFor(restartedChat, "document.querySelector('.memory-card .memory-title-input')?.value === 'P2-6F edited fact'");
    checks.editSaved = readMemoryStorage().storage?.cards?.[0]?.title === "P2-6F edited fact";

    await click(restartedChat, "#chat-tab");
    const enabledEvent = await sendMessage(restartedChat, "P2-6F provider injection enabled check");
    injectionResults.enabledCard = enabledEvent?.count;
    await waitFor(restartedChat, "document.querySelector('#chat-session-note')?.textContent.includes('本次将使用 1 条已启用记忆')");
    checks.enabledInjectionCount = enabledEvent?.count === 1;
    checks.enabledInjectionUiText = (await uiSnapshot(restartedChat)).chatNote.includes("本次将使用 1 条已启用记忆");

    await click(restartedChat, "#memory-tab");
    await click(restartedChat, ".memory-card .button-light");
    await waitFor(restartedChat, "document.querySelector('.memory-card .selection-note')?.textContent.includes('已停用')");
    checks.disabledCardStillVisible = (await uiSnapshot(restartedChat)).memoryCards[0]?.meta.includes("已停用");

    await click(restartedChat, "#chat-tab");
    const disabledEvent = await sendMessage(restartedChat, "P2-6F provider injection disabled-card check");
    injectionResults.disabledCard = disabledEvent?.count;
    checks.disabledInjectionCount = disabledEvent?.count === 0;

    await click(restartedChat, "#memory-tab");
    await click(restartedChat, ".memory-card .button-light");
    await waitFor(restartedChat, "document.querySelector('.memory-card .selection-note')?.textContent.includes('已启用')");
    checks.reenabledCard = true;

    await click(restartedChat, "#chat-tab");
    const reenabledEvent = await sendMessage(restartedChat, "P2-6F provider injection reenabled check");
    injectionResults.reenabledCard = reenabledEvent?.count;
    checks.reenabledInjectionCount = reenabledEvent?.count === 1;

    await click(restartedChat, "#memory-tab");
    await click(restartedChat, ".memory-card .button-danger");
    await waitFor(restartedChat, "document.querySelector('.memory-card .delete-confirmation')?.hidden === false");
    await click(restartedChat, ".memory-card .delete-confirmation .button-danger");
    await waitFor(restartedChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.deleteRemovesCard = readMemoryStorage().storage?.cards?.length === 0;

    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    const afterDeleteChat = handles.chat.cdp;
    await click(afterDeleteChat, "#memory-tab");
    await waitFor(afterDeleteChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.deleteSurvivesRestart = readMemoryStorage().storage?.cards?.length === 0;

    await click(afterDeleteChat, "#chat-tab");
    await sendMessage(afterDeleteChat, "P2-6F clear source A");
    await clickLastUserRemember(afterDeleteChat);
    await fill(afterDeleteChat, "#memory-draft-title", "P2-6F clear fact A");
    await fill(afterDeleteChat, "#memory-draft-content", "P2-6F clear content sentinel A");
    await fill(afterDeleteChat, "#memory-draft-tags", "clear");
    await click(afterDeleteChat, "#save-memory-draft-button");
    await waitFor(afterDeleteChat, "document.querySelector('#chat-session-note')?.textContent.includes('事实卡已保存')");
    await sendMessage(afterDeleteChat, "P2-6F clear source B");
    await clickLastUserRemember(afterDeleteChat);
    await fill(afterDeleteChat, "#memory-draft-title", "P2-6F clear fact B");
    await fill(afterDeleteChat, "#memory-draft-content", "P2-6F clear content sentinel B");
    await fill(afterDeleteChat, "#memory-draft-tags", "clear");
    await click(afterDeleteChat, "#save-memory-draft-button");
    await waitFor(afterDeleteChat, "document.querySelector('#chat-session-note')?.textContent.includes('事实卡已保存')");

    await click(afterDeleteChat, "#memory-tab");
    await waitFor(afterDeleteChat, "document.querySelectorAll('.memory-card').length === 2");
    await click(afterDeleteChat, "#clear-memory-button");
    await waitFor(afterDeleteChat, "document.querySelector('#clear-memory-confirmation')?.hidden === false");
    await click(afterDeleteChat, "#confirm-clear-memory-button");
    await waitFor(afterDeleteChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.clearRemovesAll = readMemoryStorage().storage?.cards?.length === 0;

    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    const afterClearChat = handles.chat.cdp;
    await click(afterClearChat, "#memory-tab");
    await waitFor(afterClearChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.clearSurvivesRestart = readMemoryStorage().storage?.cards?.length === 0;

    await click(afterClearChat, "#chat-tab");
    const clearedEvent = await sendMessage(afterClearChat, "P2-6F provider injection cleared check");
    injectionResults.clearedMemory = clearedEvent?.count;
    checks.clearedInjectionCount = clearedEvent?.count === 0;

    const finalUi = await uiSnapshot(afterClearChat);
    const finalMemory = readMemoryStorage();
    const telemetry = readTelemetrySummary();
    const forbiddenUiFragments = ["sk-p2-6f", "AI_DESKTOP_PET_API_KEY", appDataDir, "provider request body"];
    checks.privacyUi = !forbiddenUiFragments.some((fragment) => finalUi.visibleText.includes(fragment));
    checks.privacyTelemetry = telemetry.containsForbiddenText === false;
    checks.profileIsolated = finalMemory.memoryPath.startsWith(appDataDir);
    checks.deletedContentAbsent = !finalMemory.raw.includes("P2-6F edited content sentinel") && !finalMemory.raw.includes("P2-6F clear content sentinel");
    checks.styleClassesPresent = await evaluate(afterClearChat, `
      Boolean(
        document.querySelector(".subpage-nav .subpage-tab") &&
        document.querySelector("#memory-page.content-stack") &&
        document.querySelector(".selection-note") &&
        document.querySelector(".button") &&
        document.querySelector(".button-light") &&
        document.querySelector(".button-danger")
      )
    `);

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      provider: "fake",
      port,
      checks,
      injectionResults,
      injectionEvents: await evaluate(afterClearChat, "window.__p26fMemoryEvents"),
      finalUi: {
        providerStatus: finalUi.providerStatus,
        chatNote: finalUi.chatNote,
        memoryFeedback: finalUi.memoryFeedback,
        memoryButton: finalUi.memoryButton,
        memoryCardCount: finalUi.memoryCards.length
      },
      memoryFile: {
        path: finalMemory.memoryPath,
        exists: existsSync(finalMemory.memoryPath),
        enabled: finalMemory.storage?.enabled ?? null,
        cardCount: finalMemory.storage?.cards?.length ?? 0
      },
      telemetry: {
        logDirectory: telemetry.logDirectory,
        fileCount: telemetry.files.length,
        eventCount: telemetry.eventCount,
        containsForbiddenText: telemetry.containsForbiddenText
      }
    };

    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`result=${resultPath}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack : String(error),
      checks,
      injectionResults,
      telemetry: readTelemetrySummary()
    }, null, 2));
    log(`failed=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await stopElectron(child, handles);
  }
}

await main();

if (process.env.P2_6F_CLEANUP_ON_SUCCESS === "1") {
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.ok) {
    rmSync(runDir, { recursive: true, force: true });
  }
}
