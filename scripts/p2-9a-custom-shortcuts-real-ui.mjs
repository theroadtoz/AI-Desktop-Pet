import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-9a-custom-shortcuts", stamp);
const appDataDir = join(runDir, "user-data");
const progressPath = join(runDir, "progress.log");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_9A_CDP_PORT || 9379);

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

async function sendKeyboardScript(script) {
  await new Promise((resolveSend, rejectSend) => {
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

async function sendGlobalCtrlShift0() {
  await sendKeyboardScript(`
    $signature = 'using System; using System.Runtime.InteropServices; public static class KeyboardInput { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'
    Add-Type -TypeDefinition $signature
    [KeyboardInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [KeyboardInput]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [KeyboardInput]::keybd_event(0x30, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [KeyboardInput]::keybd_event(0x30, 0, 2, [UIntPtr]::Zero)
    [KeyboardInput]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)
    [KeyboardInput]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  `);
}

async function sendGlobalTab0() {
  await sendKeyboardScript(`
    $signature = 'using System; using System.Runtime.InteropServices; public static class KeyboardInput { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'
    Add-Type -TypeDefinition $signature
    [KeyboardInput]::keybd_event(0x09, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [KeyboardInput]::keybd_event(0x30, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [KeyboardInput]::keybd_event(0x30, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [KeyboardInput]::keybd_event(0x09, 0, 2, [UIntPtr]::Zero)
  `);
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

function spawnApp(label) {
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

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, `${label}.stdout.log`), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, `${label}.stderr.log`), chunk, { flag: "a" }));
  writeFileSync(join(runDir, `${label}.pid`), String(child.pid ?? ""));
  return child;
}

async function openChatSettings() {
  const pet = await connectTarget("renderer/pet/index.html");
  await sleep(3_500);
  await evaluate(pet.cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent("dblclick", {
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height * 0.48,
        screenX: rect.left + rect.width * 0.5,
        screenY: rect.top + rect.height * 0.48,
        bubbles: true
      }));
    })()
  `);
  const chat = await connectTarget("renderer/chat/index.html");
  await sleep(800);
  await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
  await sleep(500);
  return { pet, chat };
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
    ({ pet, chat } = await openChatSettings());

    const initialShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    checks.push({
      name: "defaultShortcutVisible",
      ok: initialShortcuts?.[0]?.id === "togglePetLock" && initialShortcuts?.[0]?.accelerator === "Tab+0",
      detail: initialShortcuts
    });

    await evaluate(chat.cdp, `
      (() => {
        const button = Array.from(document.querySelectorAll(".shortcut-actions .button-light"))
          .find((entry) => entry.textContent?.includes("录入"));
        button?.click();
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "0",
          code: "Digit0",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await sleep(800);

    const changedShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    checks.push({
      name: "shortcutChangedThroughSettingsUi",
      ok: changedShortcuts?.[0]?.accelerator === "Ctrl+Shift+0",
      detail: changedShortcuts
    });

    await evaluate(chat.cdp, "window.blur()");
    await sendGlobalCtrlShift0();
    const lockedState = await waitForLockState(chat.cdp, true, 5_000);
    checks.push({ name: "customShortcutLocksPet", ok: lockedState?.isLocked === true, detail: lockedState });

    pet.cdp.close();
    chat.cdp.close();
    child.kill();
    await sleep(1_500);

    child = spawnApp("second");
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    ({ pet, chat } = await openChatSettings());

    const restartedShortcuts = await evaluate(chat.cdp, "window.shortcutApi.listShortcuts()", true);
    checks.push({
      name: "customShortcutRestoredAfterRestart",
      ok: restartedShortcuts?.[0]?.accelerator === "Ctrl+Shift+0",
      detail: restartedShortcuts
    });

    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(false)", true);
    await sendGlobalCtrlShift0();
    const restartedLockedState = await waitForLockState(chat.cdp, true, 5_000);
    checks.push({ name: "restoredShortcutStillTriggers", ok: restartedLockedState?.isLocked === true, detail: restartedLockedState });

    const resetResult = await evaluate(chat.cdp, "window.shortcutApi.resetShortcut('togglePetLock')", true);
    checks.push({
      name: "resetShortcutReturnsDefault",
      ok: resetResult?.ok === true && resetResult.shortcuts?.[0]?.accelerator === "Tab+0",
      detail: resetResult
    });

    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(false)", true);
    await sendGlobalTab0();
    const defaultLockedState = await waitForLockState(chat.cdp, true, 5_000);
    checks.push({ name: "defaultShortcutWorksAfterReset", ok: defaultLockedState?.isLocked === true, detail: defaultLockedState });

    const telemetry = readTelemetryEvents();
    const registrations = telemetry.filter((event) => event.type === "pet_lock_shortcut_registration").map((event) => event.payload);
    const triggers = telemetry.filter((event) => event.type === "pet_lock_shortcut_triggered").map((event) => event.payload);
    checks.push({
      name: "registrationAndTriggerTelemetryRecorded",
      ok: registrations.some((event) => event?.accelerator === "Ctrl+Shift+0" && event?.registered === true) &&
        registrations.some((event) => event?.accelerator === "Tab+0" && event?.registered === true) &&
        triggers.length >= 3,
      detail: { registrations, triggers }
    });

    const result = {
      ok: checks.every((check) => check.ok),
      runDir,
      appDataDir,
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
    appDataDir
  }, null, 2));
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  rmSync(runDir, { recursive: true, force: true });
});
