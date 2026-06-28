import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-6g-memory-productization-review", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_6G_CDP_PORT || 9467);
const zeroMemoryStatusText = "这轮没有带入记忆";
const oneMemoryStatusText = "她带上了 1 条已允许的记忆";
const legacyMemoryStatusTexts = ["本次未使用记忆", "本次使用 1 条记忆"];

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
  const forbidden = ["P2-6G edited content sentinel", "P2-6G clear content sentinel", "sk-p2-6g", "provider request body"];
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
  await saveWelcomeProfile(handles.chat.cdp);
  await installMemoryProbe(handles.chat.cdp);
  return { child, handles };
}

async function saveWelcomeProfile(cdp) {
  const needsProfile = await evaluate(cdp, "document.querySelector('#user-welcome-panel')?.hidden === false");

  if (!needsProfile) {
    return;
  }

  await fill(cdp, "#welcome-user-display-name", "P2-6G");
  await fill(cdp, "#welcome-user-preferred-name", "P2-6G");
  await click(cdp, "#welcome-save-user-profile-button");
  await waitFor(cdp, "document.querySelector('#user-welcome-panel')?.hidden === true");
}

async function installMemoryProbe(cdp) {
  await evaluate(cdp, `
    (() => {
      window.__p26gMemoryEvents = [];
      if (!window.__p26gMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p26gMemoryEvents.push({ requestVersion: payload.requestVersion, count: payload.count });
        });
        window.__p26gMemoryProbeInstalled = true;
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

async function openChatPage(cdp) {
  await click(cdp, "#chat-tab");
  await waitFor(cdp, `
    document.querySelector("#chat-page")?.hidden === false &&
      document.querySelector("#settings-panel")?.hidden === true &&
      document.querySelector("#chat-input")?.disabled === false
  `);
}

async function openMemoryPage(cdp) {
  await click(cdp, "#memory-tab");
  await waitFor(cdp, `
    document.querySelector("#memory-page")?.hidden === false &&
      Boolean(document.querySelector("#enable-memory-button")?.textContent)
  `);
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
  await openChatPage(cdp);
  const before = await evaluate(cdp, "window.__p26gMemoryEvents.length");
  const beforeMessages = await evaluate(cdp, "document.querySelectorAll('.message-user').length");
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()
  `);
  try {
    await waitFor(cdp, `document.querySelectorAll('.message-user').length > ${beforeMessages}`, 2_000);
  } catch {
    await click(cdp, "#send-button");
    await waitFor(cdp, `document.querySelectorAll('.message-user').length > ${beforeMessages}`, 5_000);
  }
  await waitFor(cdp, "document.querySelector('#send-button')?.disabled === false", 15_000);
  try {
    await waitFor(cdp, `window.__p26gMemoryEvents.length > ${before}`, 2_000);
  } catch {
    // Older windows can miss the probe after a renderer reload; the visible ribbon is the stable contract.
  }
  const events = await evaluate(cdp, "window.__p26gMemoryEvents");
  const event = events.at(-1);

  if (event) {
    return event;
  }

  const status = await evaluate(cdp, "document.querySelector('#memory-session-status')?.textContent ?? ''");
  return {
    count: status.includes(oneMemoryStatusText)
      ? 1
      : status.includes(zeroMemoryStatusText)
        ? 0
        : null
  };
}

async function createMemoryCard(cdp, draft) {
  return evaluate(cdp, `
    window.memoryApi.createCard(${JSON.stringify(draft)})
  `);
}

async function setFirstMemoryCardEnabled(cdp, enabled) {
  return evaluate(cdp, `
    (async () => {
      const cards = await window.memoryApi.listCards();
      const card = cards[0];
      if (!card) return false;
      await window.memoryApi.updateCard(card.id, { enabled: ${JSON.stringify(enabled)} });
      return true;
    })()
  `);
}

async function deleteFirstMemoryCard(cdp) {
  return evaluate(cdp, `
    (async () => {
      const cards = await window.memoryApi.listCards();
      const card = cards[0];
      if (!card) return false;
      return window.memoryApi.deleteCard(card.id);
    })()
  `);
}

async function clearMemoryCards(cdp) {
  return evaluate(cdp, "window.memoryApi.clearCards()");
}

async function uiSnapshot(cdp) {
  return evaluate(cdp, `
    (() => ({
      providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      memorySessionStatus: document.querySelector("#memory-session-status")?.textContent ?? "",
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

    await openMemoryPage(chat);
    let snapshot = await uiSnapshot(chat);
    checks.defaultOff = snapshot.memoryButton === "开启记忆" && snapshot.memoryFeedback.includes("记忆默认关闭");

    await sendMessage(chat, "P2-6G disabled save attempt");
    checks.noForcedRememberAction = await evaluate(chat, "document.querySelectorAll('.message-user .message-action').length === 0");
    checks.disabledSaveBlocked = (readMemoryStorage().storage?.cards?.length ?? 0) === 0;

    await openMemoryPage(chat);
    await evaluate(chat, "window.memoryApi.setEnabled(true)");
    checks.enabledBeforeRestart = readMemoryStorage().storage?.enabled === true;

    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    let restartedChat = handles.chat.cdp;
    await openMemoryPage(restartedChat);
    await waitFor(restartedChat, "document.querySelector('#enable-memory-button')?.textContent === '关闭记忆'");
    checks.enabledRestoredAfterRestart = readMemoryStorage().storage?.enabled === true;
    snapshot = await uiSnapshot(restartedChat);
    checks.enabledEmptyStateClear = snapshot.memoryFeedback.includes("当前没有已启用事实卡") && snapshot.memoryFeedback.includes("不会加入记忆");

    await sendMessage(restartedChat, "P2-6G source message for saved memory");
    await createMemoryCard(restartedChat, {
      title: "P2-6G enabled fact",
      content: "P2-6G enabled content sentinel",
      tags: ["p2-6g", "review"],
      sourceConversationId: crypto.randomUUID()
    });
    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    restartedChat = handles.chat.cdp;

    await openMemoryPage(restartedChat);
    await waitFor(restartedChat, "document.querySelectorAll('.memory-card').length === 1");
    snapshot = await uiSnapshot(restartedChat);
    checks.savedCardVisible = snapshot.memoryCards.length === 1 && snapshot.memoryCards[0].title === "P2-6G enabled fact";

    await fill(restartedChat, "#memory-search", "review");
    await waitFor(restartedChat, "document.querySelectorAll('.memory-card').length === 1");
    await fill(restartedChat, "#memory-search", "no-match-p2-6g");
    await waitFor(restartedChat, "document.querySelector('#memory-list')?.textContent.includes('没有匹配')");
    checks.searchWorks = true;
    await fill(restartedChat, "#memory-search", "");

    await fill(restartedChat, ".memory-card .memory-title-input", "P2-6G edited fact");
    await fill(restartedChat, ".memory-card textarea", "P2-6G edited content sentinel");
    await fill(restartedChat, ".memory-card input:nth-of-type(2)", "p2-6g,edited");
    await click(restartedChat, ".memory-card .button");
    await waitFor(restartedChat, "document.querySelector('.memory-card .memory-title-input')?.value === 'P2-6G edited fact'");
    checks.editSaved = readMemoryStorage().storage?.cards?.[0]?.title === "P2-6G edited fact";

    const enabledEvent = await sendMessage(restartedChat, "P2-6G provider injection enabled check");
    injectionResults.enabledCard = enabledEvent?.count;
    await waitFor(restartedChat, `document.querySelector('#memory-session-status')?.textContent.includes(${JSON.stringify(oneMemoryStatusText)})`);
    checks.enabledInjectionCount = enabledEvent?.count === 1;
    checks.enabledInjectionUiText = (await uiSnapshot(restartedChat)).memorySessionStatus.includes(oneMemoryStatusText);

    await openMemoryPage(restartedChat);
    await setFirstMemoryCardEnabled(restartedChat, false);
    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    restartedChat = handles.chat.cdp;
    await openMemoryPage(restartedChat);
    await waitFor(restartedChat, "document.querySelector('.memory-card button.button-light')?.textContent === '启用'");
    checks.disabledCardStillVisible = readMemoryStorage().storage?.cards?.[0]?.enabled === false;

    const disabledEvent = await sendMessage(restartedChat, "P2-6G provider injection disabled-card check");
    injectionResults.disabledCard = disabledEvent?.count;
    checks.disabledInjectionCount = disabledEvent?.count === 0;
    checks.zeroInjectionUiTextAfterDisable = (await uiSnapshot(restartedChat)).memorySessionStatus.includes(zeroMemoryStatusText);

    await openMemoryPage(restartedChat);
    await setFirstMemoryCardEnabled(restartedChat, true);
    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    restartedChat = handles.chat.cdp;
    await openMemoryPage(restartedChat);
    await waitFor(restartedChat, "document.querySelector('.memory-card button.button-light')?.textContent === '停用'");
    checks.reenabledCard = readMemoryStorage().storage?.cards?.[0]?.enabled === true;

    const reenabledEvent = await sendMessage(restartedChat, "P2-6G provider injection reenabled check");
    injectionResults.reenabledCard = reenabledEvent?.count;
    checks.reenabledInjectionCount = reenabledEvent?.count === 1;

    await openMemoryPage(restartedChat);
    await deleteFirstMemoryCard(restartedChat);
    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    restartedChat = handles.chat.cdp;
    await openMemoryPage(restartedChat);
    await waitFor(restartedChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.deleteRemovesCard = readMemoryStorage().storage?.cards?.length === 0;

    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    let afterDeleteChat = handles.chat.cdp;
    await openMemoryPage(afterDeleteChat);
    await waitFor(afterDeleteChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.deleteSurvivesRestart = readMemoryStorage().storage?.cards?.length === 0;

    await sendMessage(afterDeleteChat, "P2-6G clear source A");
    await createMemoryCard(afterDeleteChat, {
      title: "P2-6G clear fact A",
      content: "P2-6G clear content sentinel A",
      tags: ["clear"],
      sourceConversationId: crypto.randomUUID()
    });
    await sendMessage(afterDeleteChat, "P2-6G clear source B");
    await createMemoryCard(afterDeleteChat, {
      title: "P2-6G clear fact B",
      content: "P2-6G clear content sentinel B",
      tags: ["clear"],
      sourceConversationId: crypto.randomUUID()
    });
    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    afterDeleteChat = handles.chat.cdp;

    await openMemoryPage(afterDeleteChat);
    await waitFor(afterDeleteChat, "document.querySelectorAll('.memory-card').length === 2");
    await clearMemoryCards(afterDeleteChat);
    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    afterDeleteChat = handles.chat.cdp;
    await openMemoryPage(afterDeleteChat);
    await waitFor(afterDeleteChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.clearRemovesAll = readMemoryStorage().storage?.cards?.length === 0;

    await stopElectron(child, handles);
    ({ child, handles } = await startApp());
    const afterClearChat = handles.chat.cdp;
    await openMemoryPage(afterClearChat);
    await waitFor(afterClearChat, "document.querySelectorAll('.memory-card').length === 0");
    checks.clearSurvivesRestart = readMemoryStorage().storage?.cards?.length === 0;

    const clearedEvent = await sendMessage(afterClearChat, "P2-6G provider injection cleared check");
    injectionResults.clearedMemory = clearedEvent?.count;
    checks.clearedInjectionCount = clearedEvent?.count === 0;
    checks.zeroInjectionUiTextAfterClear = (await uiSnapshot(afterClearChat)).memorySessionStatus.includes(zeroMemoryStatusText);

    const finalUi = await uiSnapshot(afterClearChat);
    const finalMemory = readMemoryStorage();
    const telemetry = readTelemetrySummary();
    const forbiddenUiFragments = ["sk-p2-6g", "AI_DESKTOP_PET_API_KEY", appDataDir, "provider request body"];
    checks.privacyUi = !forbiddenUiFragments.some((fragment) => finalUi.visibleText.includes(fragment));
    checks.privacyTelemetry = telemetry.containsForbiddenText === false;
    checks.noLegacyMemoryStatusLanguage = legacyMemoryStatusTexts.every((text) => !finalUi.visibleText.includes(text));
    checks.profileIsolated = finalMemory.memoryPath.startsWith(appDataDir);
    checks.deletedContentAbsent = !finalMemory.raw.includes("P2-6G edited content sentinel") && !finalMemory.raw.includes("P2-6G clear content sentinel");
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
      injectionEvents: await evaluate(afterClearChat, "window.__p26gMemoryEvents"),
      finalUi: {
        providerStatus: finalUi.providerStatus,
        chatNote: finalUi.chatNote,
        memorySessionStatus: finalUi.memorySessionStatus,
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

if (process.env.P2_6G_CLEANUP_ON_SUCCESS === "1") {
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.ok) {
    rmSync(runDir, { recursive: true, force: true });
  }
}
