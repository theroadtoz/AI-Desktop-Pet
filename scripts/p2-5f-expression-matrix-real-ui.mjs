import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-5f-expression-matrix-real-ui", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_5F_CDP_PORT || 9355);

mkdirSync(runDir, { recursive: true });

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
      await sleep(400);
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
    await sleep(400);
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
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  return result.result?.value;
}

function readTelemetryEvents() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return [];
  }

  return readTelemetryFiles(logDirectory);
}

function readTelemetryFiles(logDirectory) {
  const files = [];
  const stack = [logDirectory];

  while (stack.length > 0) {
    const directory = stack.pop();
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        stack.push(path);
      } else if (name.startsWith("telemetry-") && name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  }

  const events = [];
  for (const file of files.sort()) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore partial lines while Electron is still exiting.
      }
    }
  }
  return events;
}

async function waitForTelemetryEvent(predicate, timeoutMs, afterIndex = 0) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const events = readTelemetryEvents();
    const event = events.slice(afterIndex).find(predicate);
    if (event) {
      return { event, index: events.indexOf(event), events };
    }
    await sleep(250);
  }

  return null;
}

async function doubleClickPet(cdp) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new MouseEvent("dblclick", {
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
}

async function clickPet(cdp, hitArea = "body") {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * ${hitArea === "head" ? "0.2" : "0.48"};
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 51, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 51, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true }));
    })()
  `);
  await sleep(300);
}

async function dragAndScalePet(cdp) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 52, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 52, pointerType: "mouse", clientX: x + 28, clientY: y + 8, screenX: x + 28, screenY: y + 8, buttons: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 52, pointerType: "mouse", clientX: x + 28, clientY: y + 8, screenX: x + 28, screenY: y + 8, bubbles: true }));
      canvas.dispatchEvent(new WheelEvent("wheel", { clientX: x, clientY: y, deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
    })()
  `);
  await sleep(700);
}

async function sendChat(chatCdp, message) {
  const beforeIndex = readTelemetryEvents().length;
  await evaluate(chatCdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    })()
  `);

  const completed = await waitForTelemetryEvent(
    (event) => event.type === "chat_stream_completed",
    8_000,
    beforeIndex
  );
  if (!completed) {
    throw new Error("Timed out waiting for chat_stream_completed");
  }
  const applied = await waitForTelemetryEvent(
    (event) => (
      event.type === "pet_presentation_intent_applied" &&
      event.payload?.emotion === completed.event.payload.emotion &&
      event.payload?.intensity === completed.event.payload.intensity &&
      event.payload?.mode === completed.event.payload.presentationMode &&
      event.payload?.requestVersion === null
    ),
    5_000,
    completed.index
  );
  await sleep(250);
  return { completed: completed.event.payload, applied: applied?.event?.payload ?? null };
}

async function readPetPresentation(cdp) {
  return evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      return {
        emotion: canvas?.dataset.expressionEmotion ?? null,
        intensity: canvas?.dataset.expressionIntensity ?? null,
        mode: canvas?.dataset.expressionMode ?? null,
        roleState: canvas?.dataset.roleState ?? null,
        workStatus: canvas?.dataset.workStatus ?? null
      };
    })()
  `);
}

const matrix = [
  { emotion: "happy", intensity: "low", message: "我今天很开心" },
  { emotion: "happy", intensity: "medium", message: "这也太好了" },
  { emotion: "happy", intensity: "high", message: "我太开心了" },
  { emotion: "confused", intensity: "low", message: "我有点不懂" },
  { emotion: "confused", intensity: "medium", message: "这是为什么" },
  { emotion: "confused", intensity: "high", message: "我完全不懂" },
  { emotion: "sad", intensity: "low", message: "有点难过" },
  { emotion: "sad", intensity: "medium", message: "最近压力很大" },
  { emotion: "sad", intensity: "high", message: "我快崩溃了" },
  { emotion: "angry", intensity: "low", message: "我有点生气" },
  { emotion: "angry", intensity: "medium", message: "这也太离谱了" },
  { emotion: "angry", intensity: "high", message: "这太气人了" },
  { emotion: "surprised", intensity: "low", message: "有点没想到" },
  { emotion: "surprised", intensity: "medium", message: "真的假的" },
  { emotion: "surprised", intensity: "high", message: "这太震惊了" },
  { emotion: "neutral", intensity: "low", message: "今天天气晴朗" }
];

function expectedMode(emotion, intensity) {
  if (emotion === "neutral") {
    return "neutral";
  }
  return intensity === "high" && ["happy", "sad", "angry", "surprised"].includes(emotion)
    ? "emphasis"
    : "micro";
}

async function main() {
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
      AI_DESKTOP_PET_MODEL: ""
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(runDir, "electron.pid"), String(child.pid ?? ""));

  let pet;
  let chat;
  let browser;
  let result;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    const browserVersion = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browser = new CdpClient(browserVersion.webSocketDebuggerUrl);
    await browser.open();

    const firstFrame = await waitForTelemetryEvent(
      (event) => event.type === "first_frame" && event.payload?.renderer === "live2d",
      10_000
    );
    await waitForTelemetryEvent(
      (event) => event.type === "pet_interaction_action_finished" && event.payload?.type === "appearance",
      6_000
    );

    await doubleClickPet(pet.cdp);
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(800);

    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(300);
    const settingsOpened = await evaluate(chat.cdp, "!document.querySelector('#settings-panel')?.hidden");
    const providerValue = await evaluate(chat.cdp, "document.querySelector('#provider-id')?.value");
    await evaluate(chat.cdp, "document.querySelector('#settings-close-button')?.click()");

    const matrixResults = [];
    for (const item of matrix) {
      const chatResult = await sendChat(chat.cdp, item.message);
      const petPresentation = await readPetPresentation(pet.cdp);
      matrixResults.push({
        emotion: item.emotion,
        intensity: item.intensity,
        expectedMode: expectedMode(item.emotion, item.intensity),
        actual: {
          emotion: chatResult.completed.emotion,
          intensity: chatResult.completed.intensity,
          mode: chatResult.completed.presentationMode,
          emphasisExpressionTriggered: chatResult.completed.emphasisExpressionTriggered,
          petPresentation: chatResult.applied ?? petPresentation
        }
      });
    }

    await clickPet(pet.cdp, "body");
    const actionAfterIndex = readTelemetryEvents().length;
    await sleep(2_100);
    const afterAction = await sendChat(chat.cdp, "我太开心了");

    const dragScaleBeforeIndex = readTelemetryEvents().length;
    await dragAndScalePet(pet.cdp);
    const dragScaleEvents = readTelemetryEvents().slice(dragScaleBeforeIndex);
    const afterDragScale = await sendChat(chat.cdp, "有点没想到");

    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(300);
    await evaluate(chat.cdp, "document.querySelector('#toggle-pet-lock-button')?.click()");
    await sleep(500);
    const lockedState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);
    const afterLock = await sendChat(chat.cdp, "今天天气晴朗");
    await evaluate(chat.cdp, "document.querySelector('#toggle-pet-lock-button')?.click()");
    await sleep(500);
    const unlockedState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);

    const telemetry = readTelemetryEvents();
    const checks = [
      { name: "live2dFirstFrame", ok: Boolean(firstFrame), detail: firstFrame?.event?.payload ?? null },
      { name: "settingsPanelOpened", ok: settingsOpened === true, detail: { settingsOpened } },
      { name: "fakeProviderActive", ok: providerValue === "fake", detail: { providerValue } },
      {
        name: "matrixPresentationPolicy",
        ok: matrixResults.every((entry) => (
          entry.actual.emotion === entry.emotion &&
          entry.actual.intensity === entry.intensity &&
          entry.actual.mode === entry.expectedMode &&
          entry.actual.petPresentation.mode === entry.expectedMode
        )),
        detail: matrixResults
      },
      {
        name: "lowAndMediumStayMicro",
        ok: matrixResults
          .filter((entry) => entry.emotion !== "neutral" && entry.intensity !== "high")
          .every((entry) => entry.actual.emphasisExpressionTriggered === false && entry.actual.mode === "micro"),
        detail: matrixResults.filter((entry) => entry.intensity !== "high")
      },
      {
        name: "highWhitelistUsesEmphasis",
        ok: matrixResults
          .filter((entry) => ["happy", "sad", "angry", "surprised"].includes(entry.emotion) && entry.intensity === "high")
          .every((entry) => entry.actual.emphasisExpressionTriggered === true && entry.actual.mode === "emphasis"),
        detail: matrixResults.filter((entry) => entry.intensity === "high")
      },
      {
        name: "confusedDoesNotUseDarkEmphasis",
        ok: matrixResults
          .filter((entry) => entry.emotion === "confused")
          .every((entry) => entry.actual.emphasisExpressionTriggered === false && entry.actual.mode === "micro"),
        detail: matrixResults.filter((entry) => entry.emotion === "confused")
      },
      {
        name: "neutralClearsPresentation",
        ok: matrixResults.find((entry) => entry.emotion === "neutral")?.actual.mode === "neutral",
        detail: matrixResults.find((entry) => entry.emotion === "neutral") ?? null
      },
      {
        name: "actionThenChatRestoresPresentation",
        ok: afterAction.completed.emotion === "happy" && afterAction.completed.intensity === "high" && afterAction.completed.presentationMode === "emphasis" &&
          telemetry.slice(actionAfterIndex).some((event) => event.type === "pet_interaction_action_finished"),
        detail: { afterAction }
      },
      {
        name: "dragScaleDoesNotTriggerActionsAndChatStillWorks",
        ok: !dragScaleEvents.some((event) => event.type === "pet_interaction_action_started") &&
          afterDragScale.completed.emotion === "surprised" &&
          afterDragScale.completed.presentationMode === "micro",
        detail: { afterDragScale }
      },
      {
        name: "lockToggleThenNeutralStillWorks",
        ok: lockedState?.isLocked === true && unlockedState?.isLocked === false &&
          afterLock.completed.emotion === "neutral" &&
          afterLock.completed.presentationMode === "neutral",
        detail: { lockedState, unlockedState, afterLock }
      },
      {
        name: "rendererStable",
        ok: telemetry.filter((event) => event.type === "renderer_process_gone").length === 0 &&
          telemetry.filter((event) => event.type === "child_process_gone").length === 0 &&
          telemetry.filter((event) => event.type === "webgl_context_lost").length === 0,
        detail: {
          rendererGoneCount: telemetry.filter((event) => event.type === "renderer_process_gone").length,
          childProcessGoneCount: telemetry.filter((event) => event.type === "child_process_gone").length,
          webglContextLostCount: telemetry.filter((event) => event.type === "webgl_context_lost").length
        }
      }
    ];

    result = {
      ok: checks.every((check) => check.ok),
      runDir,
      appDataDir,
      matrixResults,
      checks,
      telemetry: {
        eventCount: telemetry.length,
        rendererGoneCount: telemetry.filter((event) => event.type === "renderer_process_gone").length,
        childProcessGoneCount: telemetry.filter((event) => event.type === "child_process_gone").length,
        webglContextLostCount: telemetry.filter((event) => event.type === "webgl_context_lost").length
      }
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    result = {
      ok: false,
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack : String(error),
      telemetry: { eventCount: readTelemetryEvents().length }
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    pet?.cdp.close();
    chat?.cdp.close();
    browser?.close();
    child.kill();
    await sleep(1_000);
    console.log(JSON.stringify(result, null, 2));
    rmSync(runDir, { recursive: true, force: true });
  }
}

await main();
