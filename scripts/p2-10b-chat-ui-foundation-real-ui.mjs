import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-10b-chat-ui-foundation-real-ui", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_10B_CDP_PORT || 9520);
const userSentinel = "P2-10B 用户正文哨兵";
const memorySentinel = "P2-10B 事实卡正文哨兵";
const forbiddenTelemetryTexts = [
  userSentinel,
  memorySentinel,
  "sk-p2-10b",
  "provider request body",
  "AI_DESKTOP_PET_API_KEY"
];
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

async function stopElectron(child, handles) {
  handles.pet?.cdp.close();
  handles.chat?.cdp.close();
  child?.kill();
  await sleep(1_000);
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

async function sendMessage(cdp, message) {
  const before = await evaluate(cdp, "window.__p210bMemoryEvents.length");
  const buttonState = await evaluate(cdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return {
        sendShowsStop: document.querySelector("#send-button")?.textContent.includes("停止") &&
          document.querySelector("#send-button")?.disabled === false,
        abortHidden: document.querySelector("#abort-button")?.hidden === true
      };
    })()
  `);
  await waitFor(cdp, `window.__p210bMemoryEvents.length > ${before}`, 5_000);
  await waitFor(cdp, "document.querySelector('#chat-input')?.disabled === false", 20_000);
  const events = await evaluate(cdp, "window.__p210bMemoryEvents");
  const finalButtonState = await evaluate(cdp, `({
    sendRestored: document.querySelector("#send-button")?.textContent.includes("发送") &&
      document.querySelector("#send-button")?.disabled === false,
    abortHidden: document.querySelector("#abort-button")?.hidden === true
  })`);
  return { event: events.at(-1), buttonState, finalButtonState };
}

async function installMemoryProbe(cdp) {
  await evaluate(cdp, `
    (() => {
      window.__p210bMemoryEvents = [];
      if (!window.__p210bMemoryProbeInstalled) {
        window.chatApi?.onMemoryInjection((payload) => {
          window.__p210bMemoryEvents.push({ requestVersion: payload.requestVersion, count: payload.count });
        });
        window.__p210bMemoryProbeInstalled = true;
      }
    })()
  `);
}

async function uiSnapshot(cdp) {
  return evaluate(cdp, `
    (() => ({
      partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
      providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
      memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? "",
      chatNote: document.querySelector("#chat-session-note")?.textContent ?? "",
      settingsTabs: [...document.querySelectorAll(".settings-nav .subpage-tab")].map((node) => node.textContent?.trim()),
      connectionHidden: document.querySelector("#connection-safe-section")?.hidden === true,
      activeTab: document.querySelector(".settings-nav .subpage-tab.is-active")?.textContent ?? "",
      chatHidden: document.querySelector("#chat-page")?.hidden === true,
      historyHidden: document.querySelector("#history-page")?.hidden === true,
      memoryHidden: document.querySelector("#memory-page")?.hidden === true,
      historyFeedback: document.querySelector("#history-feedback")?.textContent ?? "",
      memoryFeedback: document.querySelector("#memory-feedback")?.textContent ?? "",
      visibleText: document.body.innerText
    }))()
  `);
}

async function checkNarrowStatusBand(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
  const ok = await evaluate(cdp, `
    (() => {
      const boxes = [...document.querySelectorAll(".partner-status-band .status-box")];
      const rects = boxes.map((box) => box.getBoundingClientRect());
      const nonEmpty = boxes.every((box) => box.textContent.trim().length > 0);
      const noHorizontalOverflow = rects.every((rect) => rect.left >= 0 && rect.right <= window.innerWidth + 1);
      const noOverlap = rects.every((rect, index) => index === 0 || rect.top >= rects[index - 1].bottom - 1);
      return nonEmpty && noHorizontalOverflow && noOverlap;
    })()
  `);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
  return ok;
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
  let eventCount = 0;
  let containsForbiddenText = false;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    containsForbiddenText ||= forbiddenTelemetryTexts.some((item) => text.includes(item));
    eventCount += text.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  return { logDirectory, files, eventCount, containsForbiddenText };
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
  const handles = {};
  const checks = {};

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    handles.pet = await connectTarget("renderer/pet/index.html");
    await sleep(1_000);
    await evaluate(handles.pet.cdp, "window.petApi?.openChat()");
    handles.chat = await connectTarget("renderer/chat/index.html");
    const chat = handles.chat.cdp;
    await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
    await installMemoryProbe(chat);

    let snapshot = await uiSnapshot(chat);
    checks.partnerStatusBandExists = snapshot.partnerStatus.includes("桌面伙伴") && snapshot.partnerStatus.includes("默认陪伴");
    checks.fakeProviderVisible = snapshot.providerStatus.includes("Fake Provider");
    checks.initialMemoryStatus = snapshot.memoryStatus.includes(zeroMemoryStatusText);
    checks.chatSessionNoteStillVisible = snapshot.chatNote.includes("新会话") && snapshot.chatNote.includes("本地保存");

    await click(chat, "#settings-button");
    snapshot = await uiSnapshot(chat);
    checks.settingsGroupsPresent = ["基础", "记忆", "历史", "外观", "模型", "高级"].every((title) => snapshot.settingsTabs.includes(title));
    checks.connectionSafetyHiddenForFake = snapshot.connectionHidden === true;
    await click(chat, "#settings-model-tab");
    await click(chat, "#settings-model-detail-button");
    await evaluate(chat, `
      (() => {
        const provider = document.querySelector("#provider-id");
        provider.value = "openai-compatible";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
      })()
    `);
    await waitFor(chat, "document.querySelector('#connection-safe-section')?.hidden === false");
    checks.connectionSafetyVisibleForOpenAI = true;
    await click(chat, "#settings-close-button");

    await click(chat, "#history-tab");
    snapshot = await uiSnapshot(chat);
    checks.historyTabSwitches = snapshot.activeTab === "历史" && snapshot.chatHidden && !snapshot.historyHidden;
    checks.historyCopyClear = snapshot.historyFeedback.includes("本机") && snapshot.historyFeedback.includes("不会自动发送给 Provider");

    await click(chat, "#memory-tab");
    snapshot = await uiSnapshot(chat);
    checks.memoryTabSwitches = snapshot.activeTab === "记忆" && snapshot.chatHidden && !snapshot.memoryHidden;
    checks.memoryCopyClear = snapshot.memoryFeedback.includes("记忆默认关闭") && snapshot.memoryFeedback.includes("不会自动生成事实卡");

    await click(chat, "#chat-tab");
    const zeroSend = await sendMessage(chat, `${userSentinel}，检查 0 条记忆。`);
    snapshot = await uiSnapshot(chat);
    checks.zeroMemoryCount = zeroSend.event?.count === 0;
    checks.zeroMemoryStatusText = snapshot.memoryStatus.includes(zeroMemoryStatusText);
    checks.memoryStatusDoesNotOverwriteSessionNote = !snapshot.chatNote.includes(zeroMemoryStatusText);
    checks.sendAndAbortButtonState = zeroSend.buttonState.sendShowsStop &&
      zeroSend.buttonState.abortHidden &&
      zeroSend.finalButtonState.sendRestored &&
      zeroSend.finalButtonState.abortHidden;

    const oneCount = await evaluate(chat, `
      (async () => {
        await window.memoryApi.setEnabled(true);
        await window.memoryApi.createCard({
          title: "P2-10B 验收事实卡",
          content: ${JSON.stringify(memorySentinel)},
          tags: ["p2-10b"],
          sourceConversationId: crypto.randomUUID()
        });
        return true;
      })()
    `);
    checks.memoryCardCreated = oneCount === true;
    const oneSend = await sendMessage(chat, "检查 1 条记忆状态带。");
    snapshot = await uiSnapshot(chat);
    checks.oneMemoryCount = oneSend.event?.count === 1;
    checks.oneMemoryStatusText = snapshot.memoryStatus.includes(oneMemoryStatusText);
    checks.memoryStatusHidesFactContent = !snapshot.memoryStatus.includes(memorySentinel) && !snapshot.chatNote.includes(memorySentinel);
    checks.noLegacyMemoryStatusLanguage = legacyMemoryStatusTexts.every((text) => !snapshot.visibleText.includes(text));

    checks.narrowStatusBand = await checkNarrowStatusBand(chat);
    checks.inputFocus = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        input.focus();
        return document.activeElement === input;
      })()
    `);

    const telemetry = readTelemetrySummary();
    checks.telemetryPrivacy = telemetry.containsForbiddenText === false;
    checks.noScreenshotResidue = findScreenshotResidue(root).length === 0;

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      provider: "fake",
      port,
      checks,
      finalUi: {
        partnerStatus: snapshot.partnerStatus,
        providerStatus: snapshot.providerStatus,
        memoryStatus: snapshot.memoryStatus,
        chatNote: snapshot.chatNote
      },
      injectionEvents: await evaluate(chat, "window.__p210bMemoryEvents"),
      telemetry: {
        logDirectory: telemetry.logDirectory,
        fileCount: telemetry.files.length,
        eventCount: telemetry.eventCount,
        containsForbiddenText: telemetry.containsForbiddenText
      },
      screenshotResidue: findScreenshotResidue(root)
    };

    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`result=${resultPath}`);

    if (!result.ok) {
      throw new Error(`P2-10B real UI checks failed: ${JSON.stringify(checks)}`);
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
    telemetry: readTelemetrySummary(),
    screenshotResidue: findScreenshotResidue(root)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(result.error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_10B_KEEP_TMP !== "1") {
    rmSync(runDir, { recursive: true, force: true });
  }
});
