import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const isP27C = process.env.P2_7C === "1";
const runDir = join(root, ".tmp", isP27C ? "p2-7c-runtime-performance-long-run" : "p2-7b-real-ui-acceptance", stamp);
const appDataDir = join(runDir, "user-data");
const artifactsDir = join(runDir, "artifacts");
const progressPath = join(runDir, "progress.log");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_7B_CDP_PORT || 9337);
const full = process.env.P2_7B_FULL === "1" || isP27C;
const useExternalMinimize = process.env.P2_7B_EXTERNAL_MINIMIZE === "1" || isP27C;

const durations = full ? {
  coldStartupMs: 60_000,
  idleMs: 300_000,
  dragMs: 60_000,
  chatOpenMs: 180_000,
  afterChatMs: isP27C ? 60_000 : 45_000,
  minimizedMs: 180_000,
  postInteractionMs: 35_000,
  restoredVisibleMs: isP27C ? 60_000 : 5_000
} : {
  coldStartupMs: 20_000,
  idleMs: 60_000,
  dragMs: 20_000,
  chatOpenMs: 45_000,
  afterChatMs: 20_000,
  minimizedMs: 45_000,
  postInteractionMs: 20_000,
  restoredVisibleMs: 5_000
};

mkdirSync(artifactsDir, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(progressPath, `${line}\n`, { flag: "a" });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return true;
    }
    await sleep(500);
  }
  return false;
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
    const payload = JSON.stringify({ id, method, params });
    this.socket.send(payload);

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

async function findTarget(partialUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await listTargets();
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(partialUrl));
    if (target) {
      return target;
    }
    await sleep(500);
  }
  throw new Error(`Target not found: ${partialUrl}`);
}

async function connectTarget(partialUrl) {
  const target = await findTarget(partialUrl);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return { target, cdp };
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
  try {
    const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const path = join(artifactsDir, name);
    writeFileSync(path, Buffer.from(result.data, "base64"));
    return { ok: true, path };
  } catch (error) {
    return {
      ok: false,
      name,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function scenario(name, startedAt, endedAt, note = "") {
  return {
    name,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt,
    note
  };
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

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function summarizeScenario(events, item) {
  const start = Date.parse(item.startedAt);
  const end = Date.parse(item.endedAt);
  const inRange = events.filter((event) => {
    const time = Date.parse(event.timestamp);
    return time >= start && time <= end;
  });
  const heartbeats = inRange.filter((event) => event.type === "performance_heartbeat");
  const samples = inRange.filter((event) => event.type === "pet_performance_sample").map((event) => event.payload ?? {});
  const metricsByType = {};

  for (const event of heartbeats) {
    for (const metric of event.payload?.processMetrics ?? []) {
      const type = metric?.type ?? "unknown";
      const bucket = metricsByType[type] ?? { cpu: [], memoryMb: [] };
      const cpu = metric?.cpu?.percentCPUUsage;
      const memoryKb = metric?.memory?.workingSetSize;
      if (typeof cpu === "number" && Number.isFinite(cpu)) {
        bucket.cpu.push(cpu);
      }
      if (typeof memoryKb === "number" && Number.isFinite(memoryKb)) {
        bucket.memoryMb.push(memoryKb / 1024);
      }
      metricsByType[type] = bucket;
    }
  }

  const processMetrics = Object.fromEntries(Object.entries(metricsByType).map(([type, bucket]) => [type, {
    cpuAvg: round(bucket.cpu.reduce((sum, value) => sum + value, 0) / Math.max(1, bucket.cpu.length)),
    cpuP95: round(percentile(bucket.cpu, 0.95)),
    cpuMax: round(Math.max(0, ...bucket.cpu)),
    memoryMaxMb: round(Math.max(0, ...bucket.memoryMb))
  }]));

  const sampleNumbers = (key) => samples
    .map((sample) => sample[key])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const modes = [...new Set(samples.map((sample) => sample.mode).filter(Boolean))];

  return {
    ...item,
    eventCount: inRange.length,
    heartbeatCount: heartbeats.length,
    petPerformanceSampleCount: samples.length,
    processMetrics,
    renderer: {
      modes,
      targetFpsLatest: sampleNumbers("targetFramesPerSecond").at(-1) ?? null,
      rafFpsAvg: round(sampleNumbers("rafFramesPerSecond").reduce((sum, value) => sum + value, 0) / Math.max(1, sampleNumbers("rafFramesPerSecond").length)),
      renderedFpsAvg: round(sampleNumbers("renderedFramesPerSecond").reduce((sum, value) => sum + value, 0) / Math.max(1, sampleNumbers("renderedFramesPerSecond").length)),
      renderedFpsMax: round(Math.max(0, ...sampleNumbers("renderedFramesPerSecond"))),
      skippedFpsAvg: round(sampleNumbers("skippedFramesPerSecond").reduce((sum, value) => sum + value, 0) / Math.max(1, sampleNumbers("skippedFramesPerSecond").length)),
      live2DUpdateFpsAvg: round(sampleNumbers("live2DUpdatesPerSecond").reduce((sum, value) => sum + value, 0) / Math.max(1, sampleNumbers("live2DUpdatesPerSecond").length)),
      physicsUpdateFpsAvg: round(sampleNumbers("physicsUpdatesPerSecond").reduce((sum, value) => sum + value, 0) / Math.max(1, sampleNumbers("physicsUpdatesPerSecond").length)),
      breathUpdateFpsAvg: round(sampleNumbers("breathUpdatesPerSecond").reduce((sum, value) => sum + value, 0) / Math.max(1, sampleNumbers("breathUpdatesPerSecond").length))
    }
  };
}

async function main() {
  log(`runDir=${runDir}`);
  log(`mode=${full ? "full-duration" : "accelerated"} appDataDir=${appDataDir}`);

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

  const scenarios = [];
  const screenshots = [];
  let pet;
  let chat;
  let browser;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    const browserVersion = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browser = new CdpClient(browserVersion.webSocketDebuggerUrl);
    await browser.open();

    log("scenario:cold-start begin");
    let start = Date.now();
    await sleep(durations.coldStartupMs);
    screenshots.push(await screenshot(pet.cdp, "cold-start-pet.png"));
    scenarios.push(scenario("冷启动后静置", start, Date.now(), `启动后等待 ${durations.coldStartupMs / 1000}s`));

    log("scenario:idle begin");
    start = Date.now();
    await sleep(durations.idleMs);
    screenshots.push(await screenshot(pet.cdp, "idle-pet.png"));
    scenarios.push(scenario("空闲呼吸", start, Date.now(), `无交互 ${durations.idleMs / 1000}s`));

    log("scenario:drag begin");
    start = Date.now();
    await evaluate(pet.cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.5;
        const y = rect.top + rect.height * 0.48;
        canvas.dispatchEvent(new PointerEvent("pointerdown", {
          pointerId: 7,
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
    const dragUntil = Date.now() + durations.dragMs;
    let step = 0;
    while (Date.now() < dragUntil) {
      const offsetX = (step % 12) * 7;
      const offsetY = step % 2 === 0 ? 8 : -8;
      await evaluate(pet.cdp, `
        (() => {
          const canvas = document.querySelector("#pet-canvas");
          const rect = canvas.getBoundingClientRect();
          const x = rect.left + rect.width * 0.5 + ${offsetX};
          const y = rect.top + rect.height * 0.48 + ${offsetY};
          canvas.dispatchEvent(new PointerEvent("pointermove", {
            pointerId: 7,
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
      step += 1;
      await sleep(250);
    }
    await evaluate(pet.cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.55;
        const y = rect.top + rect.height * 0.48;
        canvas.dispatchEvent(new PointerEvent("pointerup", {
          pointerId: 7,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          bubbles: true
        }));
      })()
    `);
    await sleep(durations.postInteractionMs);
    screenshots.push(await screenshot(pet.cdp, "after-drag-pet.png"));
    scenarios.push(scenario("拖动角色", start, Date.now(), `模拟拖动 ${durations.dragMs / 1000}s，松手后观察 ${durations.postInteractionMs / 1000}s`));

    log("scenario:chat-open begin");
    start = Date.now();
    await evaluate(pet.cdp, "window.petApi?.openChat()");
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(durations.chatOpenMs);
    screenshots.push(await screenshot(chat.cdp, "chat-open.png"));
    scenarios.push(scenario("聊天窗口打开", start, Date.now(), `聊天窗口打开不输入 ${durations.chatOpenMs / 1000}s`));

    log("scenario:fake-provider begin");
    start = Date.now();
    for (const text of ["你好，做一次性能验收。", "现在切换到开心一点的状态。", "最后回到安静陪伴。"]) {
      await evaluate(chat.cdp, `
        (() => {
          const input = document.querySelector("#chat-input");
          const form = document.querySelector("#chat-form");
          input.value = ${JSON.stringify(text)};
          input.dispatchEvent(new Event("input", { bubbles: true }));
          form.requestSubmit();
        })()
      `);
      await sleep(12_000);
    }
    await sleep(durations.afterChatMs);
    screenshots.push(await screenshot(chat.cdp, "fake-provider-chat.png"));
    scenarios.push(scenario("Fake Provider 对话", start, Date.now(), `发送 3 轮 Fake Provider 消息，结束后观察 ${durations.afterChatMs / 1000}s`));

    log("scenario:minimize begin");
    start = Date.now();
    if (useExternalMinimize) {
      const readyPath = join(runDir, "external-minimize-ready.json");
      const minimizedPath = join(runDir, "external-minimized.txt");
      const restoreReadyPath = join(runDir, "external-restore-ready.json");
      const restoredPath = join(runDir, "external-restored.txt");
      writeFileSync(readyPath, JSON.stringify({
        title: "Desktop Pet",
        instruction: "Minimize or fully occlude the real Desktop Pet window, then create external-minimized.txt.",
        durationMs: durations.minimizedMs
      }, null, 2));
      log(`scenario:minimize waiting-external ${readyPath}`);
      const minimized = await waitForFile(minimizedPath, 240_000);
      if (!minimized) {
        throw new Error(`Timed out waiting for external minimize marker: ${minimizedPath}`);
      }
      const minimizedStart = Date.now();
      await sleep(durations.minimizedMs);
      writeFileSync(restoreReadyPath, JSON.stringify({
        title: "Desktop Pet",
        instruction: "Restore the real Desktop Pet window, then create external-restored.txt.",
        minimizedDurationMs: Date.now() - minimizedStart,
        restoreObservationMs: durations.restoredVisibleMs
      }, null, 2));
      log(`scenario:minimize waiting-restore ${restoreReadyPath}`);
      const restored = await waitForFile(restoredPath, 240_000);
      if (!restored) {
        throw new Error(`Timed out waiting for external restore marker: ${restoredPath}`);
      }
      await sleep(durations.restoredVisibleMs);
      screenshots.push(await screenshot(pet.cdp, "after-minimize-pet.png"));
      scenarios.push(scenario("窗口遮挡/最小化", start, Date.now(), `外部真实窗口操作，最小化/遮挡 ${durations.minimizedMs / 1000}s 后恢复并观察 ${durations.restoredVisibleMs / 1000}s`));
    } else {
      try {
      const windowInfo = await browser.send("Browser.getWindowForTarget", { targetId: pet.target.id });
      await browser.send("Browser.setWindowBounds", {
        windowId: windowInfo.windowId,
        bounds: { windowState: "minimized" }
      });
      await sleep(durations.minimizedMs);
      await browser.send("Browser.setWindowBounds", {
        windowId: windowInfo.windowId,
        bounds: { windowState: "normal" }
      });
      await sleep(durations.restoredVisibleMs);
      screenshots.push(await screenshot(pet.cdp, "after-minimize-pet.png"));
      scenarios.push(scenario("窗口遮挡/最小化", start, Date.now(), `最小化 ${durations.minimizedMs / 1000}s 后恢复`));
      } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`scenario:minimize skipped ${message}`);
      scenarios.push(scenario(
        "窗口遮挡/最小化",
        start,
        Date.now(),
        `未完成：当前 Electron DevTools 协议不支持自动化最小化窗口（${message}）`
      ));
      }
    }

    log("scenario:accessory-state begin");
    start = Date.now();
    const intents = ["happy", "thinking", "surprised", "sad", "neutral"];
    for (let index = 0; index < 10; index += 1) {
      const emotion = intents[index % intents.length];
      await evaluate(chat.cdp, `
        (() => {
          const input = document.querySelector("#chat-input");
          const form = document.querySelector("#chat-form");
          input.value = ${JSON.stringify(`状态切换验收 ${index + 1}：${emotion}`)};
          input.dispatchEvent(new Event("input", { bubbles: true }));
          form.requestSubmit();
        })()
      `);
      await sleep(5_500);
    }
    await sleep(durations.postInteractionMs);
    screenshots.push(await screenshot(pet.cdp, "after-state-switch-pet.png"));
    scenarios.push(scenario("配件/状态变化", start, Date.now(), "通过 10 次对话触发表情/状态变化并观察内存趋势"));

    const telemetry = readTelemetryEvents();
    const summarizedScenarios = scenarios.map((item) => summarizeScenario(telemetry.events, item));
    const result = {
      ok: true,
      runDir,
      appDataDir,
      mode: full ? "full-duration" : "accelerated",
      startedAt: scenarios[0]?.startedAt,
      endedAt: new Date().toISOString(),
      durations,
      screenshots,
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
      },
      scenarios: summarizedScenarios,
      gpu: {
        note: "Electron app.getAppMetrics() 提供 GPU 进程 CPU/内存指标；未使用 OS 级 GPU 利用率计数器。"
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
      },
      scenarios
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

main();
