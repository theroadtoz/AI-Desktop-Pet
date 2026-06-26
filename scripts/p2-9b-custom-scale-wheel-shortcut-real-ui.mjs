import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-9b-custom-scale-wheel-shortcut", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const sendInputScript = join(root, "scripts", "p2-4k-sendinput-wheel.ps1");
const port = Number(process.env.P2_9B_CDP_PORT || 9384);

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

function electronCommand() {
  const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
  return existsSync(electronExe) ? electronExe : join(root, "node_modules", ".bin", "electron.cmd");
}

function spawnApp(label, targetPort = port, telemetry = true) {
  const child = spawn(electronCommand(), [".", `--remote-debugging-port=${targetPort}`], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: appDataDir,
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: telemetry ? "1" : ""
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, `${label}.stdout.log`), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, `${label}.stderr.log`), chunk, { flag: "a" }));
  writeFileSync(join(runDir, `${label}.pid`), String(child.pid ?? ""));
  return child;
}

async function readViewport(cdp) {
  return evaluate(cdp, `
    (() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      canvas: (() => {
        const rect = document.querySelector("#pet-canvas").getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
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
        y: Math.round(window.screenY + rect.top + rect.height * ${yRatio})
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

async function returnToScale(cdp, scale, modifiers = { ctrl: true, shift: true }) {
  for (let index = 0; index < 20; index += 1) {
    const currentScale = await readScaleFromViewport(cdp);
    if (Math.abs(currentScale - scale) <= 0.01) {
      return;
    }

    const point = await readScreenPoint(cdp);
    await sendInputWheel(point, {
      ...modifiers,
      wheelDelta: currentScale > scale ? -120 : 120
    });
  }
}

async function sendGlobalTab0() {
  await new Promise((resolveSend, rejectSend) => {
    const script = `
      $signature = 'using System; using System.Runtime.InteropServices; public static class KeyboardInput { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'
      Add-Type -TypeDefinition $signature
      [KeyboardInput]::keybd_event(0x09, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [KeyboardInput]::keybd_event(0x30, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [KeyboardInput]::keybd_event(0x30, 0, 2, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [KeyboardInput]::keybd_event(0x09, 0, 2, [UIntPtr]::Zero)
    `;
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolveSend();
        return;
      }
      rejectSend(new Error(stderr.trim() || `powershell exited ${code}`));
    });
  });
}

async function waitForLockState(cdp, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;

  while (Date.now() < deadline) {
    latest = await evaluate(cdp, "window.petPresentationApi.getPetLockState()", true);
    if (latest?.isLocked === expected) {
      return latest;
    }
    await sleep(250);
  }

  return latest;
}

async function openChatSettings(pet) {
  await evaluate(pet.cdp, "window.petApi?.openChat()");
  const chat = await connectTarget("renderer/chat/index.html");
  await sleep(700);
  await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
  await sleep(700);
  return chat;
}

async function openSettings(chat) {
  await evaluate(chat.cdp, `
    (() => {
      const panel = document.querySelector("#settings-panel");
      if (panel?.hidden) {
        document.querySelector("#settings-button")?.click();
      }
    })()
  `);
  await sleep(700);
}

async function closeSettings(chat) {
  await evaluate(chat.cdp, `
    (() => {
      const panel = document.querySelector("#settings-panel");
      if (panel && !panel.hidden) {
        document.querySelector("#settings-close-button")?.click();
      }
    })()
  `);
  await sleep(700);
}

async function showChatFromPet(pet) {
  await evaluate(pet.cdp, "window.petApi?.openChat()");
  await sleep(700);
}

async function hideChat(chat) {
  await closeSettings(chat);
  await evaluate(chat.cdp, "window.moveTo(20, 20)");
  await sleep(900);
}

async function recordWheelModifierInSettings(chat, modifier) {
  await evaluate(chat.cdp, `
    (() => {
      const row = Array.from(document.querySelectorAll(".shortcut-row"))
        .find((entry) => entry.textContent?.includes("滚轮调整桌宠大小"));
      const button = Array.from(row?.querySelectorAll(".button-light") ?? [])
        .find((entry) => entry.textContent?.includes("录入"));
      button?.click();
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "${modifier.includes("Alt") ? "Alt" : "Control"}",
        code: "${modifier.includes("Alt") ? "AltLeft" : "ControlLeft"}",
        ctrlKey: ${modifier.includes("Ctrl")},
        altKey: ${modifier.includes("Alt")},
        shiftKey: ${modifier.includes("Shift")},
        metaKey: ${modifier.includes("Meta")},
        bubbles: true,
        cancelable: true
      }));
    })()
  `);
  await sleep(1_000);
}

async function resetWheelModifierInSettings(chat) {
  await evaluate(chat.cdp, `
    (() => {
      const row = Array.from(document.querySelectorAll(".shortcut-row"))
        .find((entry) => entry.textContent?.includes("滚轮调整桌宠大小"));
      const button = Array.from(row?.querySelectorAll(".button-light") ?? [])
        .find((entry) => entry.textContent?.includes("恢复默认"));
      button?.click();
    })()
  `);
  await sleep(700);
}

function readStoredShortcutPreferences() {
  const preferencesPath = join(appDataDir, "config", "shortcut-preferences.json");
  if (!existsSync(preferencesPath)) {
    return null;
  }
  return JSON.parse(readFileSync(preferencesPath, "utf8"));
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
  log(`appDataDir=${appDataDir}`);

  const checks = [];
  let child = spawnApp("first");
  let pet;
  let chat;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    await sleep(2_500);
    chat = await openChatSettings(pet);

    const initialShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    const initialWheel = initialShortcuts?.find((shortcut) => shortcut.id === "adjustPetScaleWithWheel");
    checks.push({
      name: "defaultWheelShortcutVisible",
      ok: initialWheel?.kind === "wheelModifier" && initialWheel?.accelerator === "Ctrl+Shift",
      detail: initialShortcuts
    });

    await hideChat(chat);
    let point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "defaultCtrlShiftWheelScales", 1.05);

    await showChatFromPet(pet);
    await openSettings(chat);
    await recordWheelModifierInSettings(chat, "Ctrl+Alt");
    const changedShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    const changedWheel = changedShortcuts?.find((shortcut) => shortcut.id === "adjustPetScaleWithWheel");
    const changedUiText = await evaluate(chat.cdp, `
      Array.from(document.querySelectorAll(".shortcut-row"))
        .find((entry) => entry.textContent?.includes("滚轮调整桌宠大小"))
        ?.textContent ?? ""
    `);
    checks.push({
      name: "wheelShortcutChangedThroughSettingsUi",
      ok: changedWheel?.accelerator === "Ctrl+Alt" && changedUiText.includes("Ctrl+Alt+Wheel"),
      detail: { changedWheel, changedUiText }
    });

    await hideChat(chat);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "oldCtrlShiftWheelIgnoredAfterChange", 1.05);

    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, alt: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "newCtrlAltWheelScalesImmediately", 1.1);

    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(false)", true);
    await evaluate(chat.cdp, "window.blur()");
    await sendGlobalTab0();
    const lockedState = await waitForLockState(chat.cdp, true, 5_000);
    checks.push({ name: "lockShortcutCoexistsWithWheelModifier", ok: lockedState?.isLocked === true, detail: lockedState });
    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(false)", true);

    pet.cdp.close();
    chat.cdp.close();
    child.kill();
    await sleep(1_500);

    child = spawnApp("second");
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    await sleep(2_000);
    chat = await openChatSettings(pet);

    const restartedShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    const restartedWheel = restartedShortcuts?.find((shortcut) => shortcut.id === "adjustPetScaleWithWheel");
    checks.push({
      name: "customWheelShortcutRestoredAfterRestart",
      ok: restartedWheel?.accelerator === "Ctrl+Alt",
      detail: restartedShortcuts
    });

    await hideChat(chat);
    await returnToScale(pet.cdp, 1.1, { ctrl: true, alt: true });
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "restartOldCtrlShiftWheelStillIgnored", 1.1);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, alt: true, wheelDelta: -120 });
    await assertViewportScale(checks, pet.cdp, "restartCustomCtrlAltWheelStillWorks", 1.05);

    await showChatFromPet(pet);
    await openSettings(chat);
    await resetWheelModifierInSettings(chat);
    const resetShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    const resetWheel = resetShortcuts?.find((shortcut) => shortcut.id === "adjustPetScaleWithWheel");
    checks.push({
      name: "resetWheelShortcutReturnsDefault",
      ok: resetWheel?.accelerator === "Ctrl+Shift" && resetWheel?.isDefault === true,
      detail: resetShortcuts
    });

    await hideChat(chat);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "defaultCtrlShiftWorksAfterReset", 1.1);

    await returnToScale(pet.cdp, 1, { ctrl: true, shift: true });
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120, mouseDown: true });
    await assertViewportScale(checks, pet.cdp, "wheelSuppressedWhileMouseDown", 1);

    await showChatFromPet(pet);
    await evaluate(chat.cdp, `
      (() => {
        const input = document.querySelector("#chat-input");
        input?.blur();
        input?.focus();
        input?.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      })()
    `);
    await sleep(250);
    const chatFocusScale = await readScaleFromViewport(pet.cdp);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "chatInputFocusBlocksScale", chatFocusScale);

    await evaluate(chat.cdp, `
      (() => {
        document.querySelector("#chat-input")?.blur();
        window.chatApi?.setInteractionActive(false);
      })()
    `);
    await sleep(300);
    await returnToScale(pet.cdp, 1, { ctrl: true, shift: true });
    await openSettings(chat);
    const settingsScale = await readScaleFromViewport(pet.cdp);
    point = await readScreenPoint(pet.cdp);
    await sendInputWheel(point, { ctrl: true, shift: true, wheelDelta: 120 });
    await assertViewportScale(checks, pet.cdp, "settingsPanelInteractionBlocksScale", settingsScale);

    const storedShortcuts = readStoredShortcutPreferences();
    checks.push({
      name: "storedShortcutPreferencesUseModifierOnly",
      ok: storedShortcuts?.shortcuts?.some((shortcut) => (
        shortcut.actionId === "adjustPetScaleWithWheel" &&
        shortcut.accelerator === "Ctrl+Shift"
      )) === true,
      detail: storedShortcuts
    });

    const telemetry = readTelemetryEvents();
    const scaleAdjustments = telemetry.filter((event) => event.type === "pet_scale_adjusted");
    checks.push({
      name: "scaleAdjustmentTelemetryRecorded",
      ok: scaleAdjustments.length >= 4,
      detail: scaleAdjustments.map((event) => event.payload)
    });

    const result = {
      ok: checks.every((check) => check.ok),
      runDir,
      appDataDir,
      screenshots: [],
      checks
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`result=${resultPath}`);
    log(`checks=${JSON.stringify(checks.map((check) => ({ name: check.name, ok: check.ok })))}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    pet?.cdp.close();
    chat?.cdp.close();
    child.kill();
    await sleep(1_000);
  }
}

main().catch((error) => {
  writeFileSync(resultPath, JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    runDir,
    appDataDir,
    screenshots: []
  }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
