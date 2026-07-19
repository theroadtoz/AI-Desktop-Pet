import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
const actionDiagnostics = {};
const MODE_REPLY_PREFIXES = {
  work: ["我安静陪你。", "忙你的吧，我在旁边陪着。"],
  game: ["好，来点轻快的。", "可以，先轻松一下。"],
  reading: ["慢慢看。", "我安静听着。"]
};

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
  await waitFor(chat.cdp, "(document.querySelector('#provider-status')?.textContent ?? '') !== '正在读取模型状态...'");
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

async function checkNarrowChatLayout(cdp) {
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
      return [
        document.querySelector(".chat-shell"),
        document.querySelector("#messages"),
        document.querySelector("#chat-form"),
        document.querySelector("#chat-input"),
        document.querySelector("#send-button")
      ].every(withinViewport);
    })()
  `);
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

  return events.map((event, index) => ({ ...event, __index: index }));
}

function lastTelemetryIndex() {
  return readTelemetryEvents().length - 1;
}

export function findTelemetryEventAfter(events, afterIndex, predicate) {
  return events.find((event) => event.__index > afterIndex && predicate(event)) ?? null;
}

export function findActionFinishedAfter(events, startedEvent) {
  if (!startedEvent) {
    return null;
  }

  return findTelemetryEventAfter(events, startedEvent.__index, (event) => (
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === startedEvent.payload?.type &&
    event.payload?.reason === startedEvent.payload?.reason
  ));
}

export function findHeadActionOutcomeAfter(events, afterIndex) {
  return findTelemetryEventAfter(events, afterIndex, (event) => (
    (event.type === "pet_interaction_action_started" || event.type === "pet_interaction_action_skipped") &&
    event.payload?.reason === "click_head" &&
    event.payload?.type === "headPat"
  ));
}

export function summarizeHeadActionOutcome(event) {
  if (!event) {
    return { eventType: "not_observed" };
  }

  if (event.type === "pet_interaction_action_skipped") {
    return {
      eventType: "skipped",
      skipReason: event.payload?.skipReason ?? null,
      activeType: event.payload?.activeType ?? null
    };
  }

  return { eventType: "started" };
}

function hasCompletedMatchingAction(bodyAction) {
  const started = bodyAction?.started;
  const finished = bodyAction?.finished;
  const startedType = started?.payload?.type;
  const startedReason = started?.payload?.reason;

  return (
    started?.type === "pet_interaction_action_started" &&
    finished?.type === "pet_interaction_action_finished" &&
    finished.__index > started.__index &&
    typeof startedType === "string" &&
    typeof startedReason === "string" &&
    finished.payload?.type === startedType &&
    finished.payload?.reason === startedReason
  );
}

export function isExpectedModeReply(modeId, reply) {
  return typeof reply === "string" &&
    (MODE_REPLY_PREFIXES[modeId] ?? []).some((prefix) => reply.startsWith(prefix));
}

export async function runHeadCheckAfterBodyAction({
  runBodyAction,
  sleep: sleepForCooldown,
  captureBaseline,
  clickHead,
  waitForHeadOutcome
}) {
  const bodyAction = await runBodyAction();
  if (!hasCompletedMatchingAction(bodyAction)) {
    return {
      bodyAction,
      bodyActionCompleted: false,
      headAction: null,
      diagnostic: {
        eventType: "not_attempted",
        reason: "body_action_incomplete"
      }
    };
  }

  await sleepForCooldown(550);
  const headAfterIndex = captureBaseline();
  await clickHead();
  const headAction = await waitForHeadOutcome(headAfterIndex);

  return {
    bodyAction,
    bodyActionCompleted: true,
    headAction,
    diagnostic: summarizeHeadActionOutcome(headAction)
  };
}

export function isModeActionStarted(event, { modeId, actionTypes, reasons }) {
  return (
    event.type === "pet_interaction_action_started" &&
    event.payload?.modeId === modeId &&
    actionTypes.includes(event.payload?.selectedActionType) &&
    reasons.includes(event.payload?.reason)
  );
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

async function waitForTelemetryEvent(predicate, timeoutMs = 6_000, afterIndex = -1) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = findTelemetryEventAfter(readTelemetryEvents(), afterIndex, predicate);
    if (event) {
      return event;
    }
    await sleep(200);
  }

  return null;
}

async function waitForHeadActionOutcome(afterIndex, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = findHeadActionOutcomeAfter(readTelemetryEvents(), afterIndex);
    if (event) {
      return event;
    }
    await sleep(200);
  }

  return null;
}

async function waitForActionFinished(startedEvent, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = findActionFinishedAfter(readTelemetryEvents(), startedEvent);
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
  const finishTimeoutMs = options.finishTimeoutMs ?? 8_000;
  const pauseMs = options.pauseMs ?? 700;
  const cooldownMs = options.cooldownMs ?? 550;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const afterIndex = lastTelemetryIndex();
    await clickPet(cdp, randomValue, hitArea);
    const started = await waitForTelemetryEvent(predicate, timeoutMs, afterIndex);

    if (started) {
      const finished = await waitForActionFinished(started, finishTimeoutMs);
      if (!finished) {
        return null;
      }
      if (cooldownMs > 0) {
        await sleep(cooldownMs);
      }
      return { started, finished };
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
  mkdirSync(runDir, { recursive: true });
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

    // P2-77 startup and welcome motions can overlap initial chat readiness.
    await sleep(6_500);

    checks.manualModeControlsAbsent = await evaluate(chat, `
      ![...document.querySelectorAll("button, input, select")]
        .some((node) => /对话模式|存在模式/.test(node.textContent ?? ""))
    `);
    checks.automaticSituationIsReadOnly = await evaluate(handles.pet.cdp, `
      typeof window.petApi?.getAutomaticSituation === "function" &&
        typeof window.petApi?.getAutomaticSituation().then === "function"
    `);
    const replies = await sendMessage(chat, `${userSentinel} 请帮我完成今天的开发任务。`);
    checks.replyDoesNotLeakSituationLabels = !/\b(default|work|game|reading|focus|quiet|sleep)\b/i.test(replies.at(-1) ?? "");

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
    await waitFor(chat, `document.querySelector("#memory-session-status")?.textContent.includes("她带着 1 条已允许的记忆靠近")`, 10_000);
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
        return memoryStatus.includes("她带着 1 条已允许的记忆靠近") &&
          !checkedText.includes(${JSON.stringify(memorySentinel)});
      })()
    `);

    checks.narrowChatLayout = await checkNarrowChatLayout(chat);
    checks.chatInputStillWorks = await evaluate(chat, `
      (() => {
        const input = document.querySelector("#chat-input");
        input.focus();
        return document.activeElement === input && document.querySelector("#send-button")?.disabled === false;
      })()
    `);

    const defaultHeadCheck = await runHeadCheckAfterBodyAction({
      runBodyAction: () => clickPetUntilTelemetry(handles.pet.cdp, 0.05, (event) => (
        event.type === "pet_interaction_action_started" &&
        event.payload?.reason === "click_body" &&
        event.payload?.selectedActionType === "bodyAttentionTurn" &&
        Array.isArray(event.payload?.candidateActionTypes) &&
        event.payload.candidateActionTypes.length === 1 &&
        event.payload.candidateActionTypes[0] === "bodyAttentionTurn"
      ), { attempts: 4, cooldownMs: 0 }),
      sleep,
      captureBaseline: lastTelemetryIndex,
      clickHead: () => clickPet(handles.pet.cdp, 0.2, "head"),
      waitForHeadOutcome: (afterIndex) => waitForHeadActionOutcome(afterIndex, 6_000)
    });
    const { bodyAction: defaultAction, headAction } = defaultHeadCheck;
    checks.defaultModeFixedBodyAttentionTurn = defaultHeadCheck.bodyActionCompleted;
    actionDiagnostics.headClick = defaultHeadCheck.diagnostic;
    checks.headClickStillTriggersHeadPat = headAction?.type === "pet_interaction_action_started";
    finalSnapshot = await evaluate(chat, `
      (() => ({
        partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
        providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
        memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? ""
      }))()
    `);

    const telemetry = readTelemetrySummary();
    checks.telemetryPrivacy = telemetry.containsForbiddenText === false;
    checks.telemetryDoesNotClaimManualMode = telemetry.changedEvents.every((event) => event?.reason !== "chat_ui");
    checks.noScreenshotResidue = findScreenshotResidue(root).length === 0;

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      provider: "fake",
      port,
      checks,
      actionDiagnostics,
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

const scriptPath = resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    const result = {
      ok: false,
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      actionDiagnostics,
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
}
