import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-4i-modifier-wheel-scale", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_4I_CDP_PORT || 9341);

mkdirSync(dirname(resultPath), { recursive: true });
mkdirSync(join(appDataDir, "config"), { recursive: true });
writeFileSync(join(appDataDir, "config", "pet-presentation.json"), `${JSON.stringify({ petScale: 1 }, null, 2)}\n`, "utf8");

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
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
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
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
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }

  return result.result?.value;
}

async function readViewport(cdp) {
  return evaluate(cdp, `
    (() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      canvas: (() => {
        const rect = document.querySelector("#pet-canvas").getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      })()
    }))()
  `);
}

async function dispatchWheel(cdp, options) {
  const {
    deltaY,
    ctrlKey = true,
    shiftKey = true,
    altKey = false,
    metaKey = false,
    xRatio = 0.5,
    yRatio = 0.48,
    repeat = 1,
    delayMs = 80
  } = options;

  for (let index = 0; index < repeat; index += 1) {
    await evaluate(cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * ${xRatio};
        const y = rect.top + rect.height * ${yRatio};
        canvas.dispatchEvent(new WheelEvent("wheel", {
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          deltaY: ${deltaY},
          deltaMode: 0,
          ctrlKey: ${ctrlKey},
          shiftKey: ${shiftKey},
          altKey: ${altKey},
          metaKey: ${metaKey},
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await sleep(delayMs);
  }
  await sleep(350);
}

async function pointerDown(cdp) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 24,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function pointerUp(cdp) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 24,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
  await sleep(350);
}

function readStoredScale() {
  const preferencesPath = join(appDataDir, "config", "pet-presentation.json");
  if (!existsSync(preferencesPath)) {
    return null;
  }
  return JSON.parse(readFileSync(preferencesPath, "utf8")).petScale;
}

function expectedSize(scale) {
  return {
    width: Math.round(420 * scale),
    height: Math.round(600 * scale)
  };
}

function viewportMatches(viewport, scale) {
  const expected = expectedSize(scale);
  return Math.abs(viewport.width - expected.width) <= 4 &&
    Math.abs(viewport.height - expected.height) <= 4 &&
    Math.abs(viewport.canvas.width - expected.width) <= 4 &&
    Math.abs(viewport.canvas.height - expected.height) <= 4;
}

async function assertViewportScale(checks, cdp, name, scale) {
  const viewport = await readViewport(cdp);
  checks.push({
    name,
    ok: viewportMatches(viewport, scale),
    expected: { scale, ...expectedSize(scale) },
    actual: viewport
  });
}

async function main() {
  log(`runDir=${runDir}`);

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

  const checks = [];
  let pet;
  let chat;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    await sleep(2_000);
    await assertViewportScale(checks, pet.cdp, "startsAtDefaultScale", 1);

    await dispatchWheel(pet.cdp, { deltaY: -120 });
    await assertViewportScale(checks, pet.cdp, "ctrlShiftWheelUpInHitAreaScalesUpOneStep", 1.05);

    await dispatchWheel(pet.cdp, { deltaY: 120 });
    await assertViewportScale(checks, pet.cdp, "ctrlShiftWheelDownInHitAreaScalesDownOneStep", 1);

    const invalidCases = [
      ["plainWheelIgnored", { deltaY: -120, ctrlKey: false, shiftKey: false }],
      ["ctrlOnlyIgnored", { deltaY: -120, ctrlKey: true, shiftKey: false }],
      ["shiftOnlyIgnored", { deltaY: -120, ctrlKey: false, shiftKey: true }],
      ["altWithCtrlShiftIgnored", { deltaY: -120, ctrlKey: true, shiftKey: true, altKey: true }],
      ["outsideHitAreaIgnored", { deltaY: -120, xRatio: 0.08, yRatio: 0.92 }]
    ];

    for (const [name, options] of invalidCases) {
      await dispatchWheel(pet.cdp, options);
      await assertViewportScale(checks, pet.cdp, name, 1);
    }

    await pointerDown(pet.cdp);
    await dispatchWheel(pet.cdp, { deltaY: -120 });
    await pointerUp(pet.cdp);
    await assertViewportScale(checks, pet.cdp, "wheelSuppressedWhilePointerDown", 1);

    await dispatchWheel(pet.cdp, { deltaY: -25, repeat: 4, delayMs: 80 });
    await assertViewportScale(checks, pet.cdp, "highResolutionDeltasAccumulateToOneStep", 1.05);

    await dispatchWheel(pet.cdp, { deltaY: -120, repeat: 12, delayMs: 80 });
    await assertViewportScale(checks, pet.cdp, "upperBoundStopsAt135", 1.35);

    await dispatchWheel(pet.cdp, { deltaY: 120, repeat: 20, delayMs: 80 });
    await assertViewportScale(checks, pet.cdp, "lowerBoundStopsAt070", 0.7);

    await evaluate(pet.cdp, "window.petApi?.openChat()");
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(500);
    await evaluate(chat.cdp, "document.querySelector('#chat-input')?.focus()");
    await sleep(250);
    await dispatchWheel(pet.cdp, { deltaY: -120 });
    await assertViewportScale(checks, pet.cdp, "chatInputFocusBlocksScaleInMainProcess", 0.7);

    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(500);
    const settingsScale = await evaluate(chat.cdp, "document.querySelector('#pet-scale')?.value ?? null");
    checks.push({
      name: "settingsPanelReadsSameScale",
      ok: Number(settingsScale) === 0.7,
      actual: settingsScale
    });

    await sleep(350);
    checks.push({
      name: "finalScalePersisted",
      ok: readStoredScale() === 0.7,
      actual: readStoredScale()
    });

    const result = {
      ok: checks.every((check) => check.ok),
      inputMethod: "CDP-dispatched DOM WheelEvent inside the real Electron renderer; this is not a real OS mouse wheel.",
      runDir,
      appDataDir,
      checks
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    log(`result=${resultPath}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      inputMethod: "CDP-dispatched DOM WheelEvent inside the real Electron renderer; this is not a real OS mouse wheel.",
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack : String(error),
      checks
    }, null, 2), "utf8");
    log(`failed=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    pet?.cdp.close();
    chat?.cdp.close();
    child.kill();
    await sleep(1_000);
  }
}

await main();

if (process.env.P2_4I_CLEAN_ARTIFACTS === "1" && existsSync(runDir)) {
  rmSync(runDir, { recursive: true, force: true });
}
