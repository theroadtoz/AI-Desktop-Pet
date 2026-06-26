import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-7d-runtime-resource-optimization", stamp);
const appDataDir = join(runDir, "user-data");
const progressPath = join(runDir, "progress.log");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_7D_CDP_PORT || 9367);
const full = process.env.P2_7D_FULL === "1";

const durations = full ? {
  coldStartupMs: 60_000,
  idleMs: 300_000,
  actionBurstMs: 120_000,
  emotionChatMs: 180_000,
  chatOpenIdleMs: 180_000,
  dragScaleMs: 90_000,
  lockClickThroughMs: 120_000,
  minimizedMs: 180_000,
  restoredVisibleMs: 60_000,
  postInteractionMs: 20_000
} : {
  coldStartupMs: 20_000,
  idleMs: 45_000,
  actionBurstMs: 35_000,
  emotionChatMs: 45_000,
  chatOpenIdleMs: 45_000,
  dragScaleMs: 35_000,
  lockClickThroughMs: 35_000,
  minimizedMs: 45_000,
  restoredVisibleMs: 15_000,
  postInteractionMs: 8_000
};

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
        // Ignore partial lines while Electron is still exiting.
      }
    }
  }

  return { logDirectory, files, events };
}

function values(items, key) {
  return items.map((item) => item[key]).filter((value) => typeof value === "number" && Number.isFinite(value));
}

function avg(items) {
  return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function percentile(items, p) {
  if (items.length === 0) {
    return null;
  }
  const sorted = [...items].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function count(events, type) {
  return events.filter((event) => event.type === type).length;
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
    cpuAvg: round(avg(bucket.cpu)),
    cpuP95: round(percentile(bucket.cpu, 0.95)),
    cpuMax: round(Math.max(0, ...bucket.cpu)),
    memoryMaxMb: round(Math.max(0, ...bucket.memoryMb))
  }]));

  return {
    ...item,
    eventCount: inRange.length,
    heartbeatCount: heartbeats.length,
    petPerformanceSampleCount: samples.length,
    processMetrics,
    renderer: {
      modes: [...new Set(samples.map((sample) => sample.mode).filter(Boolean))],
      targetFpsLatest: values(samples, "targetFramesPerSecond").at(-1) ?? null,
      rafFpsAvg: round(avg(values(samples, "rafFramesPerSecond"))),
      renderedFpsAvg: round(avg(values(samples, "renderedFramesPerSecond"))),
      renderedFpsMax: round(Math.max(0, ...values(samples, "renderedFramesPerSecond"))),
      skippedFpsAvg: round(avg(values(samples, "skippedFramesPerSecond"))),
      live2DUpdateFpsAvg: round(avg(values(samples, "live2DUpdatesPerSecond"))),
      physicsUpdateFpsAvg: round(avg(values(samples, "physicsUpdatesPerSecond"))),
      breathUpdateFpsAvg: round(avg(values(samples, "breathUpdatesPerSecond")))
    },
    telemetryCounts: {
      actionStarted: count(inRange, "pet_interaction_action_started"),
      actionSkipped: count(inRange, "pet_interaction_action_skipped"),
      actionFinished: count(inRange, "pet_interaction_action_finished"),
      presentationApplied: count(inRange, "pet_presentation_intent_applied")
    }
  };
}

function sampleOsGpuCounters(label) {
  if (process.platform !== "win32") {
    return { label, ok: false, reason: "not_windows" };
  }

  const script = `
    $ErrorActionPreference = 'Stop'
    $samples = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 3 |
      Select-Object -ExpandProperty CounterSamples |
      Where-Object { $_.CookedValue -gt 0 } |
      Select-Object -First 25 -Property Path, InstanceName, CookedValue
    $samples | ConvertTo-Json -Depth 3
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000
  });

  if (result.status !== 0) {
    return {
      label,
      ok: false,
      reason: "counter_failed",
      error: (result.stderr || result.stdout).trim()
    };
  }

  const text = result.stdout.trim();
  if (!text) {
    return { label, ok: true, counterCount: 0, samples: [] };
  }

  try {
    const parsed = JSON.parse(text);
    const samples = Array.isArray(parsed) ? parsed : [parsed];
    return {
      label,
      ok: true,
      counterCount: samples.length,
      samples: samples.map((sample) => ({
        instanceName: sample.InstanceName,
        cookedValue: round(sample.CookedValue)
      }))
    };
  } catch (error) {
    return {
      label,
      ok: false,
      reason: "counter_parse_failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function setDesktopPetWindow(minimized) {
  if (process.platform !== "win32") {
    return { ok: false, reason: "not_windows" };
  }

  const command = `
    Add-Type @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public class WinApi {
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      [StructLayout(LayoutKind.Sequential)]
      public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
      [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
      [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
      [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    }
"@
    $electronPids = @(Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    $windows = New-Object System.Collections.Generic.List[object]
    $callback = [WinApi+EnumWindowsProc]{
      param([IntPtr]$hwnd, [IntPtr]$lparam)
      if (-not [WinApi]::IsWindowVisible($hwnd)) { return $true }
      $ownerPid = 0
      [WinApi]::GetWindowThreadProcessId($hwnd, [ref]$ownerPid) | Out-Null
      if ($electronPids -notcontains $ownerPid) { return $true }
      $rect = New-Object WinApi+RECT
      [WinApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      if ($width -le 100 -or $height -le 100) { return $true }
      $windows.Add([pscustomobject]@{ Handle = $hwnd; Pid = $ownerPid; Width = $width; Height = $height; Area = $width * $height }) | Out-Null
      return $true
    }
    [WinApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    $window = $windows | Sort-Object @{ Expression = { [Math]::Abs($_.Width - 420) + [Math]::Abs($_.Height - 600) } }, Area | Select-Object -First 1
    if (-not $window) { throw 'Electron pet window not found' }
    [WinApi]::ShowWindowAsync($window.Handle, ${minimized ? 6 : 9}) | Out-Null
    [pscustomobject]@{ pid = $window.Pid; width = $window.Width; height = $window.Height; minimized = ${minimized ? "$true" : "$false"} } | ConvertTo-Json -Compress
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    timeout: 10_000
  });

  if (result.status !== 0) {
    return {
      ok: false,
      reason: "window_command_failed",
      error: (result.stderr || result.stdout).trim()
    };
  }

  return {
    ok: true,
    window: JSON.parse(result.stdout.trim())
  };
}

async function readPetSurface(cdp, label) {
  return evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const gl = canvas.getContext("webgl2");
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      let nonTransparentPixels = 0;
      let opaqueBlackPixels = 0;
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        if (alpha > 8) {
          nonTransparentPixels += 1;
        }
        if (alpha > 240 && red < 5 && green < 5 && blue < 5) {
          opaqueBlackPixels += 1;
        }
      }
      return {
        label: ${JSON.stringify(label)},
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        nonTransparentPixels,
        opaqueBlackPixels,
        contextLost: gl.isContextLost()
      };
    })()
  `);
}

async function clickPet(cdp, hitArea, pointerId) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * ${hitArea === "head" ? "0.2" : "0.5"};
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: ${pointerId}, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: ${pointerId}, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true }));
    })()
  `);
}

async function dragAndScale(cdp, durationMs) {
  const startedAt = Date.now();
  let step = 0;
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.5;
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 771, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, bubbles: true }));
    })()
  `);
  while (Date.now() - startedAt < durationMs) {
    await evaluate(cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.5 + ${(step % 10) * 8};
        const y = rect.top + rect.height * 0.5 + ${(step % 2 === 0) ? 10 : -10};
        canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 771, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, bubbles: true }));
        if (${step % 8 === 0}) {
          canvas.dispatchEvent(new WheelEvent("wheel", { clientX: x, clientY: y, deltaY: ${step % 16 === 0 ? -120 : 120}, ctrlKey: true, bubbles: true, cancelable: true }));
        }
      })()
    `);
    step += 1;
    await sleep(250);
  }
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.55;
      const y = rect.top + rect.height * 0.5;
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 771, pointerType: "mouse", clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true }));
    })()
  `);
}

async function sendFakeMessage(chatCdp, text) {
  await evaluate(chatCdp, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()
  `);
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
  const osGpuSamples = [];
  const surfaces = [];
  let pet;
  let chat;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");

    log("scenario:cold-start begin");
    let start = Date.now();
    await sleep(durations.coldStartupMs);
    surfaces.push(await readPetSurface(pet.cdp, "cold-start"));
    osGpuSamples.push(sampleOsGpuCounters("cold-start"));
    scenarios.push(scenario("cold-start-idle", start, Date.now(), "startup settle"));

    log("scenario:idle begin");
    start = Date.now();
    await sleep(durations.idleMs);
    surfaces.push(await readPetSurface(pet.cdp, "idle"));
    osGpuSamples.push(sampleOsGpuCounters("idle"));
    scenarios.push(scenario("visible-idle-breathing", start, Date.now(), "visible idle breathing"));

    log("scenario:action-burst begin");
    start = Date.now();
    let pointerId = 1000;
    while (Date.now() - start < durations.actionBurstMs) {
      await clickPet(pet.cdp, pointerId % 3 === 0 ? "head" : "body", pointerId);
      pointerId += 1;
      await sleep(650);
    }
    await sleep(durations.postInteractionMs);
    surfaces.push(await readPetSurface(pet.cdp, "action-burst"));
    scenarios.push(scenario("head-body-action-burst", start, Date.now(), "continuous head/body clicks with cooldowns"));

    log("scenario:chat-open begin");
    await evaluate(pet.cdp, "window.petApi?.openChat()");
    chat = await connectTarget("renderer/chat/index.html");
    start = Date.now();
    await sleep(durations.chatOpenIdleMs);
    surfaces.push(await readPetSurface(pet.cdp, "chat-open-idle"));
    scenarios.push(scenario("chat-window-open-idle", start, Date.now(), "chat window open without input"));

    log("scenario:emotion-chat begin");
    start = Date.now();
    const messages = [
      "performance check happy low",
      "performance check surprised high",
      "performance check confused medium",
      "performance check neutral"
    ];
    let index = 0;
    while (Date.now() - start < durations.emotionChatMs) {
      await sendFakeMessage(chat.cdp, messages[index % messages.length]);
      index += 1;
      await sleep(full ? 18_000 : 10_000);
    }
    await sleep(durations.postInteractionMs);
    surfaces.push(await readPetSurface(pet.cdp, "emotion-chat"));
    scenarios.push(scenario("emotion-matrix-fake-chat", start, Date.now(), "Fake Provider messages for expression and micro-expression load"));

    log("scenario:drag-scale begin");
    start = Date.now();
    await dragAndScale(pet.cdp, durations.dragScaleMs);
    await sleep(durations.postInteractionMs);
    surfaces.push(await readPetSurface(pet.cdp, "drag-scale"));
    scenarios.push(scenario("drag-scale-interaction", start, Date.now(), "synthetic drag and ctrl-wheel scale"));

    log("scenario:lock-click-through begin");
    start = Date.now();
    const locked = await evaluate(chat.cdp, "window.petPresentationApi?.setPetLocked(true)");
    await sleep(durations.lockClickThroughMs);
    const unlocked = await evaluate(chat.cdp, "window.petPresentationApi?.setPetLocked(false)");
    await sleep(durations.postInteractionMs);
    surfaces.push(await readPetSurface(pet.cdp, "lock-click-through"));
    scenarios.push(scenario("lock-click-through", start, Date.now(), `locked=${JSON.stringify(locked)} unlocked=${JSON.stringify(unlocked)}`));

    log("scenario:minimize begin");
    start = Date.now();
    const minimizeResult = setDesktopPetWindow(true);
    await sleep(durations.minimizedMs);
    const restoreResult = setDesktopPetWindow(false);
    await sleep(durations.restoredVisibleMs);
    surfaces.push(await readPetSurface(pet.cdp, "after-minimize-restore"));
    osGpuSamples.push(sampleOsGpuCounters("after-minimize-restore"));
    scenarios.push(scenario("minimize-restore", start, Date.now(), `minimize=${JSON.stringify(minimizeResult)} restore=${JSON.stringify(restoreResult)}`));

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
      surfaces,
      telemetry: {
        logDirectory: telemetry.logDirectory,
        files: telemetry.files,
        eventCount: telemetry.events.length,
        startupCount: count(telemetry.events, "startup"),
        firstFrameEvents: telemetry.events.filter((event) => event.type === "first_frame").map((event) => event.payload),
        providerEvents: telemetry.events.filter((event) => event.type.startsWith("provider_")).map((event) => event.payload),
        rendererGoneCount: count(telemetry.events, "renderer_process_gone"),
        childProcessGoneCount: count(telemetry.events, "child_process_gone"),
        webglContextLostCount: count(telemetry.events, "webgl_context_lost"),
        actionStartedCount: count(telemetry.events, "pet_interaction_action_started"),
        actionSkippedCount: count(telemetry.events, "pet_interaction_action_skipped"),
        actionFinishedCount: count(telemetry.events, "pet_interaction_action_finished"),
        presentationAppliedCount: count(telemetry.events, "pet_presentation_intent_applied")
      },
      scenarios: summarizedScenarios,
      osGpuSamples,
      privacy: {
        fakeProviderOnly: telemetry.events
          .filter((event) => event.type.startsWith("provider_"))
          .every((event) => event.payload?.providerId === "fake" || event.payload?.provider === "fake" || event.payload?.displayName === "Fake Provider"),
        resultOmitsChatText: true
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
      mode: full ? "full-duration" : "accelerated",
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
    child.kill();
    await sleep(1_000);
  }
}

main();
