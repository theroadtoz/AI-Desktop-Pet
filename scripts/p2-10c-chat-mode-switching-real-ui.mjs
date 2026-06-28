import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PET_BODY_POOL_ACTION_TYPES } from "./support/pet-action-semantic-constants.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-10c-chat-mode-switching-real-ui", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_10C_CDP_PORT || 9521);
const userSentinel = "P2-10C 用户正文哨兵";
const memorySentinel = "P2-10C 事实卡正文哨兵";
const apiKeySentinel = "sk-p2-10c";
const forbiddenTelemetryTexts = [
  userSentinel,
  memorySentinel,
  apiKeySentinel,
  "provider request body",
  "表达风格：低打扰桌面伙伴"
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
      document.querySelector("#welcome-user-display-name").value = "P2-10C 验收用户";
      document.querySelector("#welcome-user-preferred-name").value = "馆长";
      document.querySelector("#welcome-save-user-profile-button").click();
    })()
  `);
  await waitFor(cdp, "document.querySelector('#user-welcome-panel')?.hidden === true");
}

async function setMode(cdp, modeId) {
  await click(cdp, `#dialogue-mode-controls .mode-button[data-mode-id="${modeId}"]`);
  await waitFor(cdp, `document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

async function sendMessage(cdp, message) {
  const before = await evaluate(cdp, "document.querySelectorAll('.message-pet').length");
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()
  `);
  await waitFor(cdp, `document.querySelector('#chat-input')?.disabled === false`, 20_000);
  return evaluate(cdp, `
    (() => {
      const replies = [...document.querySelectorAll(".message-pet .message-content")].map((node) => node.textContent ?? "");
      return replies.slice(${before});
    })()
  `);
}

async function checkNarrowModeLayout(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
  const ok = await evaluate(cdp, `
    (() => {
      const visible = (node) => {
        if (!node || node.hidden || node.closest("[hidden]")) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const withinViewport = (node) => {
        if (!visible(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0 && rect.height > 0;
      };
      document.querySelector("#settings-button").click();
      document.querySelector("#settings-basic-tab").click();
      const controls = document.querySelector("#dialogue-mode-controls");
      const buttons = [...document.querySelectorAll("#dialogue-mode-controls .mode-button")];
      const checkedNodes = [
        controls,
        ...buttons
      ];
      return buttons.length === 4 &&
        checkedNodes.every(withinViewport);
    })()
  `);
  await evaluate(cdp, "document.querySelector('#settings-close-button')?.click()");
  await waitFor(cdp, "document.querySelector('#chat-page')?.hidden === false", 5_000);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
  return ok;
}

function readTelemetrySummary() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return { logDirectory, files: [], eventCount: 0, containsForbiddenText: false, changedEvents: [] };
  }

  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();
  let eventCount = 0;
  let containsForbiddenText = false;
  const changedEvents = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    containsForbiddenText ||= forbiddenTelemetryTexts.some((item) => text.includes(item));
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      eventCount += 1;
      const event = JSON.parse(line);
      if (event.type === "dialogue_mode_changed") {
        changedEvents.push(event.payload);
      }
    }
  }

  return { logDirectory, files, eventCount, containsForbiddenText, changedEvents };
}

function readTelemetryEvents() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return [];
  }

  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();
  const events = [];

  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      events.push(JSON.parse(line));
    }
  }

  return events;
}

async function clickPet(cdp, randomValue, hitArea = "body") {
  await evaluate(cdp, `Math.random = () => ${randomValue}`);
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * ${hitArea === "head" ? "0.2" : "0.48"};
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 18,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 18,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
  await sleep(260);
}

async function waitForTelemetryEvent(predicate, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = readTelemetryEvents().find(predicate);
    if (event) {
      return event;
    }
    await sleep(200);
  }

  return null;
}

async function clickPetUntilTelemetry(cdp, randomValue, predicate, options = {}) {
  const attempts = options.attempts ?? 3;
  const hitArea = options.hitArea ?? "body";
  const timeoutMs = options.timeoutMs ?? 2_500;
  const pauseMs = options.pauseMs ?? 700;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await clickPet(cdp, randomValue, hitArea);
    const event = await waitForTelemetryEvent(predicate, timeoutMs);

    if (event) {
      return event;
    }

    await sleep(pauseMs);
  }

  return null;
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

  let child = launchElectron();
  let handles = {};
  const checks = {};
  let finalSnapshot = {};

  try {
    handles = await openChat();
    const chat = handles.chat.cdp;
    await saveWelcomeProfile(chat);

    checks.initialDefaultMode = await evaluate(chat, "document.querySelector('#partner-status')?.textContent.includes('默认陪伴')");
    checks.modeButtonsVisible = await evaluate(chat, "document.querySelectorAll('#dialogue-mode-controls .mode-button').length === 4");

    await setMode(chat, "work");
    checks.workModeVisible = await evaluate(chat, "document.querySelector('#partner-status')?.textContent.includes('工作')");
    const workAction = await clickPetUntilTelemetry(handles.pet.cdp, 0.8, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" &&
      event.payload?.modeId === "work" &&
      event.payload?.selectedActionType === "workFocus" &&
      Array.isArray(event.payload?.candidateActionTypes) &&
      event.payload.candidateActionTypes.includes("workFocus")
    ), { attempts: 4 });
    checks.workModePetActionCanTriggerFocus = Boolean(workAction);
    await sleep(2_100);
    const workReply = await sendMessage(chat, `${userSentinel} 工作模式回复`);
    checks.workReplyDiffers = workReply.at(-1)?.startsWith("先抓下一步。") || workReply.at(-1)?.startsWith("我们直接拆任务。");

    await setMode(chat, "game");
    checks.gameModeVisible = await evaluate(chat, "document.querySelector('#partner-status')?.textContent.includes('游戏')");
    const gameAction = await clickPetUntilTelemetry(handles.pet.cdp, 0.6, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" &&
      event.payload?.modeId === "game" &&
      event.payload?.selectedActionType === "playGame"
    ), { attempts: 3 });
    checks.gameModePetActionPrefersPlayGame = Boolean(gameAction);
    await sleep(2_100);
    const gameReply = await sendMessage(chat, "游戏模式回复");
    checks.gameReplyDiffers = gameReply.at(-1)?.startsWith("好，来点轻快的。") || gameReply.at(-1)?.startsWith("可以，先轻松一下。");

    await setMode(chat, "reading");
    checks.readingModeVisible = await evaluate(chat, "document.querySelector('#partner-status')?.textContent.includes('读书')");
    const readingAction = await clickPetUntilTelemetry(handles.pet.cdp, 0.7, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" &&
      event.payload?.modeId === "reading" &&
      ["reading", "readingIdle"].includes(event.payload?.selectedActionType)
    ), { attempts: 3 });
    checks.readingModePetActionPrefersReading = Boolean(readingAction);
    await sleep(2_300);
    const readingReply = await sendMessage(chat, "读书模式回复");
    checks.readingReplyDiffers = readingReply.at(-1)?.startsWith("慢慢看。") || readingReply.at(-1)?.startsWith("我们安静地理一遍。");

    checks.memoryBoundary = await evaluate(chat, `
      (async () => {
        await window.memoryApi.setEnabled(true);
        await window.memoryApi.createCard({
          title: "P2-10C 验收事实卡",
          content: ${JSON.stringify(memorySentinel)},
          tags: ["p2-10c"],
          sourceConversationId: crypto.randomUUID()
        });
        return true;
      })()
    `);
    await sendMessage(chat, "检查记忆状态");
    await waitFor(chat, `document.querySelector("#memory-session-status")?.textContent.includes("她带上了 1 条已允许的记忆")`, 10_000);
    checks.memoryStatusHidesFactContent = await evaluate(chat, `
      (() => {
        const checkedText = [
          document.querySelector("#memory-session-status")?.textContent ?? "",
          document.querySelector("#chat-session-note")?.textContent ?? "",
          document.querySelector("#partner-status-band")?.textContent ?? "",
          document.querySelector(".partner-status-band")?.textContent ?? "",
          document.querySelector("#companion-control-shelf")?.textContent ?? ""
        ].join("\\n");
        const memoryStatus = document.querySelector("#memory-session-status")?.textContent ?? "";
        return memoryStatus.includes("她带上了 1 条已允许的记忆") &&
          !checkedText.includes(${JSON.stringify(memorySentinel)});
      })()
    `);

    checks.narrowModeLayout = await checkNarrowModeLayout(chat);
    checks.chatInputStillWorks = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        input.focus();
        return document.activeElement === input && document.querySelector("#send-button")?.disabled === false;
      })()
    `);

    await setMode(chat, "default");
    checks.defaultModeVisibleAfterSwitch = await evaluate(chat, "document.querySelector('#partner-status')?.textContent.includes('默认陪伴')");
    const defaultAction = await clickPetUntilTelemetry(handles.pet.cdp, 0.05, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" &&
      event.payload?.modeId === "default" &&
      Array.isArray(event.payload?.candidateActionTypes) &&
      PET_BODY_POOL_ACTION_TYPES.every((type) => event.payload.candidateActionTypes.includes(type)) &&
      !event.payload.candidateActionTypes.includes("appearance") &&
      !event.payload.candidateActionTypes.includes("headPat")
    ), { attempts: 4 });
    checks.defaultModePetActionPoolSummary = Boolean(defaultAction);
    await sleep(2_400);
    await clickPet(handles.pet.cdp, 0.2, "head");
    const headAction = await waitForTelemetryEvent((event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_head" &&
      event.payload?.type === "headPat"
    ));
    checks.headClickStillTriggersHeadPat = Boolean(headAction);
    await setMode(chat, "reading");

    await stopElectron(child, handles);
    handles = {};
    child = launchElectron();
    handles = await openChat();
    const restartedChat = handles.chat.cdp;
    checks.restartRestoresMode = await waitFor(restartedChat, "document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId === 'reading'", 10_000);

    finalSnapshot = await evaluate(restartedChat, `
      (() => ({
        partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
        providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
        memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? "",
        activeMode: document.querySelector("#dialogue-mode-controls .mode-button.is-active")?.textContent ?? ""
      }))()
    `);

    const telemetry = readTelemetrySummary();
    checks.telemetryPrivacy = telemetry.containsForbiddenText === false;
    checks.telemetryModeSummary = telemetry.changedEvents.some((event) => (
      event?.previousModeId === "default" && event?.nextModeId === "work" && event?.reason === "chat_ui"
    ));
    checks.noScreenshotResidue = findScreenshotResidue(root).length === 0;

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      provider: "fake",
      port,
      checks,
      finalUi: finalSnapshot,
      telemetry: {
        logDirectory: telemetry.logDirectory,
        fileCount: telemetry.files.length,
        eventCount: telemetry.eventCount,
        changedEvents: telemetry.changedEvents,
        containsForbiddenText: telemetry.containsForbiddenText
      },
      screenshotResidue: findScreenshotResidue(root)
    };

    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`result=${resultPath}`);

    if (!result.ok) {
      throw new Error(`P2-10C real UI checks failed: ${JSON.stringify(checks)}`);
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
  if (process.env.P2_10C_KEEP_TMP !== "1") {
    rmSync(runDir, { recursive: true, force: true });
  }
});
