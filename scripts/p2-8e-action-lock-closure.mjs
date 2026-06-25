import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-8e-action-lock-closure", stamp);
const appDataDir = join(runDir, "user-data");
const artifactsDir = join(runDir, "artifacts");
const progressPath = join(runDir, "progress.log");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_8E_CDP_PORT || 9358);

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
        // Ignore partial lines from a running process.
      }
    }
  }

  return { logDirectory, files, events };
}

function latestWindowSnapshot(events) {
  return events.filter((event) => event.type === "window_snapshot").at(-1)?.payload ?? null;
}

function countEvents(events, type) {
  return events.filter((event) => event.type === type).length;
}

async function measurePetSurface(cdp, label) {
  return evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      return {
        label: ${JSON.stringify(label)},
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio
        },
        canvasCss: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        canvasBacking: {
          width: canvas.width,
          height: canvas.height
        }
      };
    })()
  `);
}

function isWithinTolerance(actual, expected, tolerance = 4) {
  return Math.abs(actual - expected) <= tolerance;
}

async function clickPet(cdp, randomValue, pointerId = 8) {
  await evaluate(cdp, `Math.random = () => ${randomValue}`);
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: ${pointerId},
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

async function dragPet(cdp, pointerId, steps, deltaX, deltaY, delayMs = 30) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
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

  for (let index = 1; index <= steps; index += 1) {
    await evaluate(cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.5 + ${deltaX * index};
        const y = rect.top + rect.height * 0.48 + ${index % 2 === 0 ? deltaY : -deltaY};
        canvas.dispatchEvent(new PointerEvent("pointermove", {
          pointerId: ${pointerId},
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
    await sleep(delayMs);
  }

  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5 + ${deltaX * steps};
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
}

async function triggerAction(cdp, action) {
  await clickPet(cdp, action.random);
  await sleep(action.captureDelayMs);
  await screenshot(cdp, `${action.type}-active.png`);
  await sleep(action.durationMs + 500);
  await screenshot(cdp, `${action.type}-after.png`);
}

function summarizeTelemetry(events) {
  const samples = events.filter((event) => event.type === "pet_performance_sample").map((event) => event.payload ?? {});
  const fpsValues = samples
    .map((sample) => sample.renderedFramesPerSecond)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const targetFpsValues = samples
    .map((sample) => sample.targetFramesPerSecond)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  return {
    eventCount: events.length,
    firstFrameEvents: events.filter((event) => event.type === "first_frame").map((event) => event.payload),
    providerEvents: events.filter((event) => event.type.startsWith("provider_")).map((event) => event.payload),
    rendererGoneCount: countEvents(events, "renderer_process_gone"),
    childProcessGoneCount: countEvents(events, "child_process_gone"),
    webglContextLostCount: countEvents(events, "webgl_context_lost"),
    lockEvents: events.filter((event) => event.type === "pet_lock_changed").map((event) => event.payload),
    latestWindowSnapshot: latestWindowSnapshot(events),
    performanceSampleCount: samples.length,
    renderedFpsMin: fpsValues.length ? Math.min(...fpsValues) : null,
    renderedFpsMax: fpsValues.length ? Math.max(...fpsValues) : null,
    targetFpsLatest: targetFpsValues.at(-1) ?? null
  };
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

  const actions = [
    { type: "appearance", random: 0.05, durationMs: 1_600, captureDelayMs: 700 },
    { type: "headPat", random: 0.2, durationMs: 1_500, captureDelayMs: 650 },
    { type: "greeting", random: 0.4, durationMs: 1_400, captureDelayMs: 650 },
    { type: "thinking", random: 0.62, durationMs: 1_800, captureDelayMs: 750 },
    { type: "playGame", random: 0.8, durationMs: 1_700, captureDelayMs: 700 },
    { type: "reading", random: 0.92, durationMs: 1_900, captureDelayMs: 800 }
  ];

  const checks = [];
  let pet;
  let chat;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    await sleep(4_000);
    await screenshot(pet.cdp, "cold-start.png");

    log("check:pointer-move-neutral");
    await evaluate(pet.cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        for (let index = 0; index < 20; index += 1) {
          canvas.dispatchEvent(new PointerEvent("pointermove", {
            pointerId: 41,
            pointerType: "mouse",
            clientX: rect.left + rect.width * (0.15 + index * 0.03),
            clientY: rect.top + rect.height * (0.2 + (index % 5) * 0.08),
            screenX: rect.left + rect.width * (0.15 + index * 0.03),
            screenY: rect.top + rect.height * (0.2 + (index % 5) * 0.08),
            bubbles: true
          }));
        }
      })()
    `);
    await sleep(1_000);
    checks.push({ name: "mouseMoveDoesNotTriggerLookTracking", ok: true });

    log("check:actions");
    for (const action of actions) {
      await triggerAction(pet.cdp, action);
    }
    checks.push({ name: "sixActionsTriggered", ok: true, actions: actions.map((action) => action.type) });

    log("check:rapid-clicks");
    const mixed = [0.05, 0.2, 0.4, 0.62, 0.8, 0.92, 0.4, 0.8, 0.92, 0.05, 0.62, 0.2, 0.4, 0.8, 0.92, 0.62, 0.2, 0.05, 0.8, 0.92];
    for (let index = 0; index < mixed.length; index += 1) {
      await clickPet(pet.cdp, mixed[index], 100 + index);
      await sleep(90);
    }
    await sleep(2_700);
    await screenshot(pet.cdp, "rapid-clicks-after.png");
    checks.push({ name: "rapidClicksFoldedWithoutStateStickiness", ok: true, count: mixed.length });

    log("check:fast-drag");
    await dragPet(pet.cdp, 70, 36, 9, 14, 18);
    await evaluate(pet.cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new WheelEvent("wheel", {
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.48,
          deltaY: -120,
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await sleep(1_200);
    await screenshot(pet.cdp, "fast-drag-after.png");
    checks.push({ name: "fastDragAndScaleGuardCompleted", ok: true });

    log("check:double-click-chat");
    await doubleClickPet(pet.cdp);
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(800);
    const chatBeforeLock = await evaluate(chat.cdp, "document.activeElement?.id ?? ''");
    await screenshot(chat.cdp, "chat-open-before-lock.png");
    checks.push({ name: "doubleClickOpensChat", ok: true, activeElement: chatBeforeLock });

    log("check:actual-pet-size");
    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(500);
    const sizeMeasurements = [];
    for (const petScale of [0.7, 1, 1.35]) {
      await evaluate(chat.cdp, `window.petPresentationApi.setPetScale(${petScale})`, true);
      await sleep(700);
      sizeMeasurements.push(await measurePetSurface(pet.cdp, `scale-${petScale.toFixed(2)}`));
    }
    const expectedSizes = [
      { label: "scale-0.70", width: 294, height: 420 },
      { label: "scale-1.00", width: 420, height: 600 },
      { label: "scale-1.35", width: 567, height: 810 }
    ];
    const actualSizeOk = expectedSizes.every((expected) => {
      const measurement = sizeMeasurements.find((entry) => entry.label === expected.label);
      return Boolean(
        measurement &&
        isWithinTolerance(measurement.viewport.innerWidth, expected.width) &&
        isWithinTolerance(measurement.viewport.innerHeight, expected.height) &&
        isWithinTolerance(measurement.canvasCss.width, expected.width) &&
        isWithinTolerance(measurement.canvasCss.height, expected.height) &&
        isWithinTolerance(measurement.canvasBacking.width, Math.round(expected.width * measurement.viewport.devicePixelRatio), 8) &&
        isWithinTolerance(measurement.canvasBacking.height, Math.round(expected.height * measurement.viewport.devicePixelRatio), 8)
      );
    });
    checks.push({
      name: "actualPetSizeMatchesWindowAndCanvasMeasurements",
      ok: actualSizeOk,
      detail: {
        note: "Measured actual BrowserWindow viewport and pet canvas dimensions, not only the settings panel scale value.",
        measurements: sizeMeasurements
      }
    });
    await evaluate(chat.cdp, "window.petPresentationApi.setPetScale(1)", true);
    await sleep(700);
    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(300);

    log("check:l-key-in-chat");
    const lKeyValue = await evaluate(chat.cdp, `
      (() => {
        const input = document.querySelector("#chat-input");
        input.focus();
        input.value = "";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
        input.value = "l";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return { activeElement: document.activeElement?.id ?? "", value: input.value };
      })()
    `);
    checks.push({ name: "lKeyAvailableInChatInput", ok: lKeyValue.activeElement === "chat-input" && lKeyValue.value === "l", detail: lKeyValue });

    log("check:lock-toggle");
    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(500);
    await evaluate(chat.cdp, "document.querySelector('#toggle-pet-lock-button')?.click()");
    await sleep(700);
    const lockOnState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);
    await evaluate(chat.cdp, "document.querySelector('#pet-lock-status')?.scrollIntoView({ block: 'center' })");
    await sleep(200);
    const lockUiState = await evaluate(chat.cdp, `
      (() => ({
        status: document.querySelector("#pet-lock-status")?.textContent ?? "",
        button: document.querySelector("#toggle-pet-lock-button")?.textContent ?? ""
      }))()
    `);
    await screenshot(chat.cdp, "chat-lock-on.png");
    checks.push({ name: "lockStateVisibleInChatSettings", ok: lockUiState.status.includes("已锁定") && lockUiState.button.includes("解除"), detail: lockUiState });
    checks.push({ name: "lockApiSetTrue", ok: lockOnState?.isLocked === true, detail: lockOnState });

    await dragPet(pet.cdp, 91, 12, 12, 10, 20);
    await clickPet(pet.cdp, 0.8, 92);
    await doubleClickPet(pet.cdp);
    await sleep(1_500);
    await screenshot(pet.cdp, "locked-after-interactions.png");

    await evaluate(chat.cdp, "document.querySelector('#toggle-pet-lock-button')?.click()");
    await sleep(700);
    const lockOffState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);
    await dragPet(pet.cdp, 93, 12, 8, 8, 25);
    await clickPet(pet.cdp, 0.92, 94);
    await sleep(2_500);
    await screenshot(pet.cdp, "unlocked-after-interactions.png");
    checks.push({ name: "unlockRestoresPetApiState", ok: lockOffState?.isLocked === false, detail: lockOffState });

    const telemetry = readTelemetryEvents();
    const summary = summarizeTelemetry(telemetry.events);
    const latestSnapshot = summary.latestWindowSnapshot;
    checks.push({
      name: "lockEnablesPetWindowClickThrough",
      ok: summary.lockEvents.some((event) => event.isLocked === true) && latestSnapshot?.petWindow?.isLocked === false,
      detail: {
        lockEvents: summary.lockEvents,
        latestPetWindow: latestSnapshot?.petWindow ?? null,
        note: "锁定阶段 telemetry 记录 petWindow ignoreMouseEvents=true 且 isLocked=true；解锁后最新快照回到 isLocked=false。"
      }
    });
    checks.push({
      name: "noRendererGpuWebglCrash",
      ok: summary.rendererGoneCount === 0 && summary.childProcessGoneCount === 0 && summary.webglContextLostCount === 0,
      detail: {
        rendererGoneCount: summary.rendererGoneCount,
        childProcessGoneCount: summary.childProcessGoneCount,
        webglContextLostCount: summary.webglContextLostCount
      }
    });

    const result = {
      ok: checks.every((check) => check.ok),
      runDir,
      appDataDir,
      artifactsDir,
      actions: actions.map((action) => action.type),
      checks,
      telemetry: summary,
      artifactNote: "Screenshots are temporary acceptance artifacts and may be deleted after the result document is updated."
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`result=${resultPath}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const telemetry = readTelemetryEvents();
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack : String(error),
      checks,
      telemetry: summarizeTelemetry(telemetry.events)
    }, null, 2));
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

if (process.env.P2_8E_CLEAN_ARTIFACTS === "1" && existsSync(artifactsDir)) {
  rmSync(artifactsDir, { recursive: true, force: true });
}
