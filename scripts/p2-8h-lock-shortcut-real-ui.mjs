import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-8h-lock-shortcut", stamp);
const appDataDir = join(runDir, "user-data");
const progressPath = join(runDir, "progress.log");
const resultPath = join(runDir, "result.json");
const port = Number(process.env.P2_8H_CDP_PORT || 9368);

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

async function sendGlobalTab0() {
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
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(runDir, "electron.pid"), String(child.pid ?? ""));

  const checks = [];
  let pet;
  let chat;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
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
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(800);
    await evaluate(chat.cdp, "document.querySelector('#settings-button')?.click()");
    await sleep(500);

    const initialState = await evaluate(chat.cdp, "window.petPresentationApi.getPetLockState()", true);
    checks.push({ name: "defaultUnlocked", ok: initialState?.isLocked === false, detail: initialState });

    await evaluate(chat.cdp, "window.blur()");
    await sendGlobalTab0();
    const lockedState = await waitForLockState(chat.cdp, true, 5_000);
    const lockedUi = await evaluate(chat.cdp, `(() => ({
      status: document.querySelector("#pet-lock-status")?.textContent ?? "",
      button: document.querySelector("#toggle-pet-lock-button")?.textContent ?? ""
    }))()`);
    checks.push({ name: "globalTab0LocksPet", ok: lockedState?.isLocked === true, detail: lockedState });
    checks.push({
      name: "chatSettingsReflectLockedShortcutState",
      ok: lockedUi.status.includes("已锁定") && lockedUi.button.includes("解除"),
      detail: lockedUi
    });

    await sendGlobalTab0();
    const unlockedState = await waitForLockState(chat.cdp, false, 5_000);
    const unlockedUi = await evaluate(chat.cdp, `(() => ({
      status: document.querySelector("#pet-lock-status")?.textContent ?? "",
      button: document.querySelector("#toggle-pet-lock-button")?.textContent ?? ""
    }))()`);
    checks.push({ name: "globalTab0UnlocksPet", ok: unlockedState?.isLocked === false, detail: unlockedState });
    checks.push({
      name: "chatSettingsReflectUnlockedShortcutState",
      ok: unlockedUi.status.includes("未锁定") && unlockedUi.button.includes("锁定"),
      detail: unlockedUi
    });

    await evaluate(chat.cdp, `
      (() => {
        const input = document.querySelector("#chat-input");
        input.focus();
        input.value = "";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
        input.value = "0l";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    const inputState = await evaluate(chat.cdp, `(() => ({
      activeElement: document.activeElement?.id ?? "",
      value: document.querySelector("#chat-input")?.value ?? ""
    }))()`);
    checks.push({
      name: "ordinaryChatInputKeysStillWork",
      ok: inputState.activeElement === "chat-input" && inputState.value === "0l",
      detail: inputState
    });

    const telemetry = readTelemetryEvents();
    const shortcutRegistration = telemetry.filter((event) => event.type === "pet_lock_shortcut_registration").map((event) => event.payload);
    const shortcutTriggers = telemetry.filter((event) => event.type === "pet_lock_shortcut_triggered").map((event) => event.payload);
    checks.push({
      name: "shortcutTelemetryRecorded",
      ok: shortcutRegistration.some((event) => event?.registered === true) && shortcutTriggers.length >= 2,
      detail: { shortcutRegistration, shortcutTriggers }
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
