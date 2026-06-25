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

async function clickPet(cdp, randomValue) {
  await evaluate(cdp, `Math.random = () => ${randomValue}`);
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
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
  await clickPet(cdp, action.random);
  await sleep(action.captureDelayMs);
  await screenshot(cdp, `${action.type}-active.png`);
  await sleep(action.durationMs + 450);
  await screenshot(cdp, `${action.type}-after.png`);
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

  const actions = [
    { type: "appearance", random: 0.05, durationMs: 1_600, captureDelayMs: 700 },
    { type: "headPat", random: 0.2, durationMs: 1_500, captureDelayMs: 650 },
    { type: "greeting", random: 0.4, durationMs: 1_400, captureDelayMs: 650 },
    { type: "thinking", random: 0.62, durationMs: 1_800, captureDelayMs: 750 },
    { type: "playGame", random: 0.8, durationMs: 1_700, captureDelayMs: 700 },
    { type: "reading", random: 0.92, durationMs: 1_900, captureDelayMs: 800 }
  ];

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    const browserVersion = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browser = new CdpClient(browserVersion.webSocketDebuggerUrl);
    await browser.open();

    await sleep(4_000);
    await screenshot(pet.cdp, "cold-start.png");

    for (const action of actions) {
      log(`action:${action.type}`);
      await triggerAction(pet.cdp, action);
    }

    log("repeat:greeting");
    for (let index = 0; index < 5; index += 1) {
      await clickPet(pet.cdp, 0.4);
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
      await clickPet(pet.cdp, 0.92);
      await sleep(2_150);
    }
    await screenshot(pet.cdp, "reading-repeat-after.png");

    log("mixed:20");
    const mixed = [0.05, 0.2, 0.4, 0.62, 0.8, 0.92, 0.4, 0.8, 0.92, 0.05, 0.62, 0.2, 0.4, 0.8, 0.92, 0.62, 0.2, 0.05, 0.8, 0.92];
    for (const value of mixed) {
      await clickPet(pet.cdp, value);
      await sleep(160);
    }
    await sleep(2_500);
    await screenshot(pet.cdp, "mixed-20-after.png");

    log("regression:drag-scale-chat");
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
    await evaluate(pet.cdp, "window.petApi?.openChat()");
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(1_000);
    await screenshot(chat.cdp, "chat-open.png");
    await screenshot(pet.cdp, "after-regression.png");

    const telemetry = readTelemetryEvents();
    const result = {
      ok: true,
      runDir,
      appDataDir,
      artifactsDir,
      actions: actions.map((action) => action.type),
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
