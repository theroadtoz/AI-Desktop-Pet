import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-4k-os-modifier-wheel-scale", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const sendInputScript = join(root, "scripts", "p2-4k-sendinput-wheel.ps1");
const port = Number(process.env.P2_4K_CDP_PORT || 9342);

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

async function connectTargetOnPort(targetPort, partialUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`http://127.0.0.1:${targetPort}/json/list`);
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

async function connectTarget(partialUrl) {
  return connectTargetOnPort(port, partialUrl);
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
      screenX: window.screenX,
      screenY: window.screenY,
      devicePixelRatio: window.devicePixelRatio,
      canvas: (() => {
        const rect = document.querySelector("#pet-canvas").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: Math.round(rect.width), height: Math.round(rect.height) };
      })()
    }))()
  `);
}

async function readScreenPoint(cdp, xRatio = 0.5, yRatio = 0.48) {
  return evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round(window.screenX + rect.left + rect.width * ${xRatio}),
        y: Math.round(window.screenY + rect.top + rect.height * ${yRatio}),
        ratio: { x: ${xRatio}, y: ${yRatio} },
        screenX: window.screenX,
        screenY: window.screenY,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      };
    })()
  `);
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

async function readScaleFromViewport(cdp) {
  const viewport = await readViewport(cdp);
  return Number((viewport.width / 420).toFixed(2));
}

async function returnToScale(cdp, scale) {
  for (let index = 0; index < 20; index += 1) {
    const currentScale = await readScaleFromViewport(cdp);
    if (Math.abs(currentScale - scale) <= 0.01) {
      return;
    }

    const point = await readScreenPoint(cdp);
    await sendInputWheel(point, {
      ctrl: true,
      shift: true,
      wheelDelta: currentScale > scale ? -120 : 120
    });
  }
}

async function sendInputWheel(point, options = {}) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    sendInputScript,
    "-X",
    String(point.x),
    "-Y",
    String(point.y),
    "-WheelDelta",
    String(options.wheelDelta ?? 120)
  ];

  if (options.ctrl) {
    args.push("-Ctrl");
  }
  if (options.shift) {
    args.push("-Shift");
  }
  if (options.alt) {
    args.push("-Alt");
  }
  if (options.mouseDown) {
    args.push("-MouseDown");
  }

  await new Promise((resolveSend, rejectSend) => {
    const child = spawn("powershell.exe", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        writeFileSync(join(runDir, "sendinput.log"), stdout.trim() ? `${stdout.trim()}\n` : "", { flag: "a" });
        resolveSend();
        return;
      }
      rejectSend(new Error(stderr.trim() || stdout.trim() || `powershell exited ${code}`));
    });
  });

  await sleep(350);
}

function readStoredScale() {
  const preferencesPath = join(appDataDir, "config", "pet-presentation.json");
  if (!existsSync(preferencesPath)) {
    return null;
  }
  return JSON.parse(readFileSync(preferencesPath, "utf8")).petScale;
}

function readTelemetryEvents() {
  const logsDir = join(appDataDir, "logs");
  if (!existsSync(logsDir)) {
    return [];
  }

  return readdirSync(logsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(logsDir, name), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line)));
}

async function main() {
  log(`runDir=${runDir}`);
  log("input=Windows SetCursorPos + SendInput keyboard modifiers and mouse wheel");

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
  let restartChild;
  let restartedPet;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    await sleep(2_500);
    await assertViewportScale(checks, pet.cdp, "startsAtDefaultScale", 1);

    let point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "sendInputCtrlShiftWheelUpScalesUpOneStep", 1.05);

    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: -120 });
    await assertViewportScale(checks, pet.cdp, "sendInputCtrlShiftWheelDownScalesDownOneStep", 1);

    const invalidCases = [
      ["plainWheelIgnored", { wheelDelta: 120 }, 0.5, 0.48],
      ["ctrlOnlyIgnored", { ctrl: true, wheelDelta: 120 }, 0.5, 0.48],
      ["shiftOnlyIgnored", { shift: true, wheelDelta: 120 }, 0.5, 0.48],
      ["altWithCtrlShiftIgnored", { ctrl: true, shift: true, alt: true, wheelDelta: 120 }, 0.5, 0.48],
      ["outsideHitAreaIgnored", { ctrl: true, shift: true, wheelDelta: 120 }, 0.08, 0.92]
    ];

    for (const [name, options, xRatio, yRatio] of invalidCases) {
      await returnToScale(pet.cdp, 1);
      point = await readScreenPoint(pet.cdp, xRatio, yRatio);
      await sendInputWheel(point, options);
      await assertViewportScale(checks, pet.cdp, name, 1);
    }

    await returnToScale(pet.cdp, 1);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120, mouseDown: true });
    await assertViewportScale(checks, pet.cdp, "wheelSuppressedWhileMouseDown", 1);

    for (let index = 0; index < 7; index += 1) {
      point = await readScreenPoint(pet.cdp);
      await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    }
    await assertViewportScale(checks, pet.cdp, "upperBoundStopsAt135", 1.35);

    for (let index = 0; index < 20; index += 1) {
      point = await readScreenPoint(pet.cdp);
      await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: -120 });
    }
    await assertViewportScale(checks, pet.cdp, "lowerBoundStopsAt070", 0.7);

    await evaluate(pet.cdp, "window.petApi?.openChat()");
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(500);
    await evaluate(chat.cdp, "document.querySelector('#chat-input')?.focus()");
    await sleep(250);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "chatInputFocusBlocksScaleInMainProcess", 0.7);

    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(500);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "settingsPanelInteractionBlocksScaleInMainProcess", 0.7);

    const settingsScale = await evaluate(chat.cdp, "document.querySelector('#pet-scale')?.value ?? null");
    checks.push({
      name: "settingsPanelReadsSameScale",
      ok: Number(settingsScale) === 0.7,
      actual: settingsScale
    });

    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(true)", true);
    await sleep(500);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "lockedClickThroughBlocksScale", 0.7);
    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(false)", true);

    checks.push({
      name: "finalScalePersisted",
      ok: readStoredScale() === 0.7,
      actual: readStoredScale()
    });

    pet.cdp.close();
    chat.cdp.close();
    child.kill();
    await sleep(1_200);

    restartChild = spawn(electronCmd, [".", `--remote-debugging-port=${port + 1}`], {
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
    restartChild.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.restart.stdout.log"), chunk, { flag: "a" }));
    restartChild.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.restart.stderr.log"), chunk, { flag: "a" }));
    await waitForJson(`http://127.0.0.1:${port + 1}/json/version`, 30_000);
    restartedPet = await connectTargetOnPort(port + 1, "renderer/pet/index.html");
    await sleep(2_000);
    await assertViewportScale(checks, restartedPet.cdp, "restartRestoresFinalScale", 0.7);

    const telemetryTypes = readTelemetryEvents().map((event) => event.type);
    checks.push({
      name: "noRendererGpuWebglFailureTelemetry",
      ok: !telemetryTypes.some((type) => type === "webgl_context_lost" || type === "recovery_failed"),
      actual: telemetryTypes.filter((type) => type === "webgl_context_lost" || type === "recovery_failed")
    });

    const result = {
      ok: checks.every((check) => check.ok),
      inputMethod: "Windows SetCursorPos + SendInput key down/up for Ctrl/Shift/Alt and MOUSEEVENTF_WHEEL at the pet canvas screen coordinate.",
      runDir,
      appDataDir,
      checks
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    log(`result=${resultPath}`);
    log(`checks=${JSON.stringify(checks.map((check) => ({ name: check.name, ok: check.ok })))}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      inputMethod: "Windows SetCursorPos + SendInput key down/up for Ctrl/Shift/Alt and MOUSEEVENTF_WHEEL at the pet canvas screen coordinate.",
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
    restartedPet?.cdp.close();
    child.kill();
    restartChild?.kill();
    await sleep(1_000);
  }
}

await main();

if (process.env.P2_4K_CLEAN_ARTIFACTS === "1" && existsSync(runDir)) {
  rmSync(runDir, { recursive: true, force: true });
}
