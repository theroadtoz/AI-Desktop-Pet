import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-8c-real-ui-review", stamp);
const appDataDir = join(runDir, "user-data");
const artifactsDir = join(runDir, "artifacts");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_8C_CDP_PORT || 9348);

mkdirSync(artifactsDir, { recursive: true });

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
      await sleep(500);
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
    await sleep(500);
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

async function screenshot(cdp, name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = join(artifactsDir, name);
  writeFileSync(path, Buffer.from(result.data, "base64"));
  return path;
}

function readTelemetryEvents() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return { logDirectory, files: [], events: [] };
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
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore partial log lines from a running app.
      }
    }
  }

  return { logDirectory, files, events };
}

async function waitForTelemetryEvent(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const telemetry = readTelemetryEvents();
    const event = telemetry.events.find(predicate);

    if (event) {
      return event;
    }

    await sleep(250);
  }

  return null;
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
        pointerId: 8,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 8,
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

async function triggerAction(cdp, action) {
  await screenshot(cdp, `${action.type}-before.png`);
  await clickPet(cdp, action.random, action.hitArea);
  await sleep(action.captureDelayMs);
  await screenshot(cdp, `${action.type}-active.png`);
  await sleep(action.durationMs + 450);
  await screenshot(cdp, `${action.type}-after.png`);
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

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

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
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(runDir, "electron.pid"), String(child.pid ?? ""));

  let pet;
  let chat;
  let browser;

  const checks = [];
  const actions = [
    { type: "headPat", random: 0.2, hitArea: "head", durationMs: 1_500, captureDelayMs: 650 },
    { type: "greeting", random: 0.05, hitArea: "body", durationMs: 1_400, captureDelayMs: 650 },
    { type: "thinking", random: 0.55, hitArea: "body", durationMs: 1_800, captureDelayMs: 750 },
    { type: "playGame", random: 0.8, hitArea: "body", durationMs: 1_700, captureDelayMs: 700 },
    { type: "reading", random: 0.9, hitArea: "body", durationMs: 1_900, captureDelayMs: 800 },
    { type: "focus", random: 0.98, hitArea: "body", durationMs: 1_700, captureDelayMs: 700 }
  ];
  let headBurstSummary = null;
  let bodyBurstSummary = null;
  let dragScaleSummary = null;
  let lockSummary = null;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    const browserVersion = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browser = new CdpClient(browserVersion.webSocketDebuggerUrl);
    await browser.open();

    const appearanceStarted = await waitForTelemetryEvent((event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.type === "appearance" &&
      event.payload?.reason === "startup_first_visible_frame"
    ), 8_000);
    await screenshot(pet.cdp, "startup-appearance-observed.png");
    const appearanceFinished = await waitForTelemetryEvent((event) => (
      event.type === "pet_interaction_action_finished" &&
      event.payload?.type === "appearance" &&
      event.payload?.reason === "startup_first_visible_frame"
    ), 4_000);
    checks.push({
      name: "startupAppearanceOnce",
      ok: Boolean(appearanceStarted && appearanceFinished),
      detail: { started: appearanceStarted?.payload ?? null, finished: appearanceFinished?.payload ?? null }
    });
    await sleep(400);
    await screenshot(pet.cdp, "cold-start-after-appearance.png");

    for (const action of actions) {
      log(`action:${action.type}`);
      await triggerAction(pet.cdp, action);
    }

    log("burst:head:10");
    const headBurstStartIndex = readTelemetryEvents().events.length;
    for (let index = 0; index < 10; index += 1) {
      await clickPet(pet.cdp, 0.2, "head");
      await sleep(80);
    }
    await sleep(2_300);
    await screenshot(pet.cdp, "head-burst-10-after.png");
    const headBurstEvents = readTelemetryEvents().events.slice(headBurstStartIndex);
    headBurstSummary = {
      started: headBurstEvents.filter((event) => event.type === "pet_interaction_action_started" && event.payload?.reason === "click_head").map((event) => event.payload),
      skipped: headBurstEvents.filter((event) => event.type === "pet_interaction_action_skipped" && event.payload?.reason === "click_head").map((event) => event.payload)
    };

    log("repeat:greeting");
    for (let index = 0; index < 5; index += 1) {
      await clickPet(pet.cdp, 0.05);
      await sleep(1_650);
    }
    await screenshot(pet.cdp, "greeting-repeat-after.png");

    log("repeat:playGame");
    for (let index = 0; index < 5; index += 1) {
      await clickPet(pet.cdp, 0.8);
      await sleep(1_950);
    }
    await screenshot(pet.cdp, "playGame-repeat-after.png");

    log("repeat:reading");
    for (let index = 0; index < 5; index += 1) {
      await clickPet(pet.cdp, 0.94);
      await sleep(2_150);
    }
    await screenshot(pet.cdp, "reading-repeat-after.png");

    log("mixed:20");
    const bodyBurstStartIndex = readTelemetryEvents().events.length;
    const mixed = [0.05, 0.2, 0.55, 0.8, 0.9, 0.98, 0.05, 0.55, 0.8, 0.9, 0.05, 0.55, 0.2, 0.05, 0.8, 0.98, 0.55, 0.2, 0.05, 0.9];
    for (const value of mixed) {
      await clickPet(pet.cdp, value);
      await sleep(160);
    }
    await sleep(2_500);
    await screenshot(pet.cdp, "mixed-20-after.png");
    const bodyBurstEvents = readTelemetryEvents().events.slice(bodyBurstStartIndex);
    bodyBurstSummary = {
      started: bodyBurstEvents.filter((event) => event.type === "pet_interaction_action_started" && event.payload?.reason === "click_body").map((event) => event.payload),
      skipped: bodyBurstEvents.filter((event) => event.type === "pet_interaction_action_skipped" && event.payload?.reason === "click_body").map((event) => event.payload)
    };

    log("regression:drag-scale-chat");
    const dragScaleStartIndex = readTelemetryEvents().events.length;
    await evaluate(pet.cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.5;
        const y = rect.top + rect.height * 0.48;
        canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, pointerType: "mouse", clientX: x + 24, clientY: y + 8, screenX: x + 24, screenY: y + 8, buttons: 1, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, pointerType: "mouse", clientX: x + 24, clientY: y + 8, screenX: x + 24, screenY: y + 8, bubbles: true }));
        canvas.dispatchEvent(new WheelEvent("wheel", { clientX: x, clientY: y, deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
      })()
    `);
    await sleep(1_000);
    const dragScaleEvents = readTelemetryEvents().events.slice(dragScaleStartIndex);
    dragScaleSummary = {
      started: dragScaleEvents.filter((event) => event.type === "pet_interaction_action_started").map((event) => event.payload),
      skipped: dragScaleEvents.filter((event) => event.type === "pet_interaction_action_skipped").map((event) => event.payload)
    };
    await doubleClickPet(pet.cdp);
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(1_000);
    await screenshot(chat.cdp, "chat-open.png");
    await screenshot(pet.cdp, "after-regression.png");
    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(500);
    await evaluate(chat.cdp, "document.querySelector('#toggle-pet-lock-button')?.click()");
    await sleep(700);
    const lockedState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);
    await evaluate(chat.cdp, "document.querySelector('#toggle-pet-lock-button')?.click()");
    await sleep(700);
    const unlockedState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);
    lockSummary = { lockedState, unlockedState };

    const telemetry = readTelemetryEvents();
    const startedActions = telemetry.events
      .filter((event) => event.type === "pet_interaction_action_started")
      .map((event) => event.payload);
    const finishedActions = telemetry.events
      .filter((event) => event.type === "pet_interaction_action_finished")
      .map((event) => event.payload);
    const startupAppearanceStarts = startedActions.filter((event) => (
      event.type === "appearance" && event.reason === "startup_first_visible_frame"
    ));
    const clickHeadPatStarts = startedActions.filter((event) => (
      event.type === "headPat" && event.reason === "click_head"
    ));
    const bodyActionTypes = new Set(startedActions
      .filter((event) => event.reason === "click_body")
      .map((event) => event.type));

    checks.push({
      name: "startupAppearanceNotRepeated",
      ok: startupAppearanceStarts.length === 1,
      detail: startupAppearanceStarts
    });
    checks.push({
      name: "headClickTriggersHeadPat",
      ok: clickHeadPatStarts.length >= 1,
      detail: clickHeadPatStarts
    });
    checks.push({
      name: "bodyClickUsesOrdinaryPool",
      ok: ["greeting", "thinking", "playGame", "reading", "focus"].every((type) => bodyActionTypes.has(type)) &&
        !startedActions.some((event) => event.reason === "click_body" && (event.type === "appearance" || event.type === "headPat")),
      detail: [...bodyActionTypes]
    });
    checks.push({
      name: "headBurst10DoesNotStack",
      ok: (headBurstSummary?.started.length ?? 0) <= 2 &&
        (headBurstSummary?.skipped ?? []).some((event) => event.skipReason === "active_action" || event.skipReason === "head_pat_cooldown"),
      detail: headBurstSummary
    });
    checks.push({
      name: "bodyBurst20UsesCooldownSkips",
      ok: (bodyBurstSummary?.started ?? []).every((event) => (
        ["greeting", "thinking", "playGame", "reading", "focus"].includes(event.type)
      )) &&
        !(bodyBurstSummary?.started ?? []).some((event) => event.type === "appearance" || event.type === "headPat") &&
        (bodyBurstSummary?.skipped ?? []).some((event) => event.skipReason === "active_action" || event.skipReason === "global_cooldown"),
      detail: bodyBurstSummary
    });
    checks.push({
      name: "strongAccessoryActionsDoNotRepeatImmediately",
      ok: telemetry.events.some((event) => (
        event.type === "pet_interaction_action_skipped" &&
        (event.payload?.type === "playGame" || event.payload?.type === "reading") &&
        event.payload?.skipReason === "same_action_cooldown"
      )),
      detail: telemetry.events
        .filter((event) => event.type === "pet_interaction_action_skipped" && (event.payload?.type === "playGame" || event.payload?.type === "reading"))
        .map((event) => event.payload)
    });
    checks.push({
      name: "dragAndScaleDoNotTriggerActions",
      ok: (dragScaleSummary?.started.length ?? 0) === 0,
      detail: dragScaleSummary
    });
    checks.push({
      name: "temporaryActionsFinish",
      ok: ["appearance", "headPat", "greeting", "thinking", "playGame", "reading", "focus"].every((type) => (
        finishedActions.some((event) => event.type === type)
      )),
      detail: finishedActions
    });
    checks.push({
      name: "chatOpenedAfterDoubleClickAlternative",
      ok: Boolean(chat?.target?.url?.includes("renderer/chat/index.html")),
      detail: chat?.target?.url ?? null
    });
    checks.push({
      name: "lockToggleStillWorks",
      ok: lockSummary?.lockedState?.isLocked === true && lockSummary?.unlockedState?.isLocked === false,
      detail: lockSummary
    });
    checks.push({
      name: "rendererStable",
      ok: telemetry.events.filter((event) => event.type === "renderer_process_gone").length === 0 &&
        telemetry.events.filter((event) => event.type === "child_process_gone").length === 0 &&
        telemetry.events.filter((event) => event.type === "webgl_context_lost").length === 0,
      detail: {
        rendererGoneCount: telemetry.events.filter((event) => event.type === "renderer_process_gone").length,
        childProcessGoneCount: telemetry.events.filter((event) => event.type === "child_process_gone").length,
        webglContextLostCount: telemetry.events.filter((event) => event.type === "webgl_context_lost").length
      }
    });
    const ok = checks.every((check) => check.ok);
    const result = {
      ok,
      runDir,
      appDataDir,
      artifactsDir,
      actions: actions.map((action) => action.type),
      headBurstSummary,
      bodyBurstSummary,
      dragScaleSummary,
      lockSummary,
      checks,
      telemetry: {
        logDirectory: telemetry.logDirectory,
        files: telemetry.files,
        eventCount: telemetry.events.length,
        startupCount: telemetry.events.filter((event) => event.type === "startup").length,
        firstFrameEvents: telemetry.events.filter((event) => event.type === "first_frame").map((event) => event.payload),
        providerEvents: telemetry.events.filter((event) => event.type.startsWith("provider_")).map((event) => event.payload),
        rendererGoneCount: telemetry.events.filter((event) => event.type === "renderer_process_gone").length,
        childProcessGoneCount: telemetry.events.filter((event) => event.type === "child_process_gone").length,
        webglContextLostCount: telemetry.events.filter((event) => event.type === "webgl_context_lost").length
      }
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`result=${resultPath}`);
    if (!ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const telemetry = readTelemetryEvents();
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack : String(error),
      telemetry: {
        logDirectory: telemetry.logDirectory,
        files: telemetry.files,
        eventCount: telemetry.events.length
      }
    }, null, 2));
    log(`failed=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    pet?.cdp.close();
    chat?.cdp.close();
    browser?.close();
    child.kill();
    await sleep(1_000);
  }
}

await main();
