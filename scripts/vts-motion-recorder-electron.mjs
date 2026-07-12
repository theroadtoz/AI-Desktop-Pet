import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runVtsMotionRecorderCli } from "./vts-motion-recorder.mjs";

const TOKEN_FILE_NAME = "vts-motion-recorder-token.json";
const TOKEN_SCHEMA_VERSION = 1;
const OVERLAY_WIDTH = 320;
const OVERLAY_HEIGHT = 190;
const OVERLAY_MARGIN = 40;
const RECORDING_CUE_DELAY_MS = 400;

const OVERLAY_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;user-select:none}
  body{display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif}
  #cue{color:#fff;font-size:132px;font-weight:900;line-height:1;letter-spacing:0;text-align:center;-webkit-text-stroke:3px #111;text-shadow:0 3px 0 #111,0 0 14px rgba(0,0,0,.95)}
  #cue.recording{align-self:flex-start;margin-top:18px;font-size:34px;-webkit-text-stroke:1px #111;text-shadow:0 2px 0 #111,0 0 8px rgba(0,0,0,.9)}
</style>
</head>
<body><div id="cue" aria-live="assertive"></div>
<script>window.setCue=(text,recording)=>{const cue=document.getElementById('cue');cue.textContent=text;cue.className=recording?'recording':''}</script>
</body>
</html>`;

function overlayBounds(workArea) {
  const width = Math.max(1, Math.min(OVERLAY_WIDTH, workArea.width));
  const height = Math.max(1, Math.min(OVERLAY_HEIGHT, workArea.height));
  return {
    x: workArea.x + Math.min(OVERLAY_MARGIN, Math.max(0, workArea.width - width)),
    y: workArea.y + Math.min(OVERLAY_MARGIN, Math.max(0, workArea.height - height)),
    width,
    height
  };
}

export function createCountdownOverlayController({
  BrowserWindow,
  screen,
  beep,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let window;
  let recordingTimer;
  let hideTimer;
  let destroyed = false;
  let countdownStartBeeped = false;

  const playBeep = async () => {
    try {
      await beep?.();
    } catch {
      // Audio cues are best-effort and must never block recording.
    }
  };

  const ensureWindow = async () => {
    if (destroyed) return undefined;
    if (window && !window.isDestroyed?.()) return window;
    const bounds = overlayBounds(screen.getPrimaryDisplay().workArea);
    const createdWindow = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    window = createdWindow;
    createdWindow.setAlwaysOnTop(true, "screen-saver", 1);
    createdWindow.setIgnoreMouseEvents(true, { forward: false });
    await createdWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
    if (destroyed || createdWindow.isDestroyed?.()) {
      if (!createdWindow.isDestroyed?.()) createdWindow.destroy();
      return undefined;
    }
    return createdWindow;
  };

  const setCue = async (text, recording = false) => {
    const overlay = await ensureWindow();
    if (!overlay) return false;
    await overlay.webContents.executeJavaScript(`window.setCue(${JSON.stringify(text)},${recording})`);
    if (destroyed || overlay.isDestroyed?.()) return false;
    overlay.moveTop();
    if (destroyed || overlay.isDestroyed?.()) return false;
    overlay.showInactive();
    if (destroyed || overlay.isDestroyed?.()) return false;
    overlay.moveTop();
    return true;
  };

  return {
    async showCountdown(cue) {
      if (![3, 2, 1, "开始"].includes(cue)) return;
      if (destroyed) return;
      if (recordingTimer !== undefined) clearTimer(recordingTimer);
      if (hideTimer !== undefined) clearTimer(hideTimer);
      recordingTimer = undefined;
      hideTimer = undefined;
      if (cue === 3 && !countdownStartBeeped) {
        countdownStartBeeped = true;
        await playBeep();
      } else if (cue === "开始") {
        await playBeep();
      }
      await setCue(String(cue));
    },

    showRecording() {
      if (destroyed) return;
      if (recordingTimer !== undefined) clearTimer(recordingTimer);
      recordingTimer = setTimer(async () => {
        recordingTimer = undefined;
        try {
          if (!await setCue("录制中", true)) return;
          hideTimer = setTimer(() => {
            hideTimer = undefined;
            if (window && !window.isDestroyed?.()) window.hide();
          }, 900);
        } catch {
          // Delayed overlay updates are best-effort and must not create unhandled rejections.
        }
      }, RECORDING_CUE_DELAY_MS);
    },

    destroy() {
      destroyed = true;
      if (recordingTimer !== undefined) clearTimer(recordingTimer);
      if (hideTimer !== undefined) clearTimer(hideTimer);
      recordingTimer = undefined;
      hideTimer = undefined;
      if (window && !window.isDestroyed?.()) window.destroy();
      window = undefined;
    }
  };
}

function validToken(token) {
  return typeof token === "string" && token.length > 0 && token.length <= 4_096 &&
    token.trim() === token && !/[\u0000-\u001f\u007f]/.test(token);
}

function parseEncryptedTokenFile(serialized) {
  if (serialized.length > 65_536) return undefined;
  const value = JSON.parse(serialized);
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 2 || value.version !== TOKEN_SCHEMA_VERSION ||
    typeof value.encryptedToken !== "string" || value.encryptedToken.length === 0
  ) {
    return undefined;
  }
  const encrypted = Buffer.from(value.encryptedToken, "base64");
  if (encrypted.length === 0 || encrypted.toString("base64") !== value.encryptedToken) return undefined;
  return encrypted;
}

export function createSafeStorageTokenStore(userDataPath, safeStorage) {
  const secretsPath = join(userDataPath, "secrets");
  const tokenPath = join(secretsPath, TOKEN_FILE_NAME);
  let memoryToken;

  const encryptionAvailable = () => {
    try {
      return safeStorage?.isEncryptionAvailable?.() === true;
    } catch {
      return false;
    }
  };

  const removeDiskToken = async () => {
    try {
      await rm(tokenPath, { force: true });
    } catch {
      // Token cleanup is best-effort and intentionally silent.
    }
  };

  return {
    async load() {
      if (memoryToken !== undefined) return memoryToken;
      if (!encryptionAvailable()) return undefined;
      try {
        const encrypted = parseEncryptedTokenFile(await readFile(tokenPath, "utf8"));
        if (!encrypted) throw new Error("invalid-token-file");
        const token = safeStorage.decryptString(encrypted);
        if (!validToken(token)) throw new Error("invalid-token");
        memoryToken = token;
        return token;
      } catch {
        await removeDiskToken();
        return undefined;
      }
    },

    async save(token) {
      if (!validToken(token)) return;
      memoryToken = token;
      if (!encryptionAvailable()) return;

      let encrypted;
      try {
        encrypted = safeStorage.encryptString(token);
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error("encryption-failed");
      } catch {
        await removeDiskToken();
        return;
      }

      let temporaryPath;
      try {
        const serialized = JSON.stringify({
          version: TOKEN_SCHEMA_VERSION,
          encryptedToken: encrypted.toString("base64")
        });
        await mkdir(secretsPath, { recursive: true });
        temporaryPath = join(secretsPath, `.${TOKEN_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
        await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporaryPath, tokenPath);
        temporaryPath = undefined;
      } catch {
        if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => {});
      }
    },

    async remove() {
      memoryToken = undefined;
      await removeDiskToken();
    }
  };
}

export async function runElectronVtsMotionRecorder(argv, dependencies) {
  const { app, safeStorage } = dependencies;
  let exitCode = 1;
  let overlay;
  const destroyOverlay = () => overlay?.destroy();
  try {
    await app.whenReady();
    const userDataPath = app.getPath("userData");
    const tokenStore = createSafeStorageTokenStore(userDataPath, safeStorage);
    const allowedDraftRoot = join(userDataPath, "motion-drafts");
    const defaultDraftRoot = join(allowedDraftRoot, "vts-drafts");
    if (argv[0] === "record" && dependencies.BrowserWindow && dependencies.screen) {
      overlay = createCountdownOverlayController({
        BrowserWindow: dependencies.BrowserWindow,
        screen: dependencies.screen,
        beep: dependencies.beep ?? dependencies.shell?.beep?.bind(dependencies.shell)
      });
      app.once?.("before-quit", destroyOverlay);
    }
    try {
      exitCode = await (dependencies.runCli ?? runVtsMotionRecorderCli)(argv, {
        tokenStore,
        overlay,
        defaultDraftRoot,
        allowedDraftRoot
      });
    } catch {
      exitCode = 1;
    }
    return exitCode;
  } finally {
    app.removeListener?.("before-quit", destroyOverlay);
    destroyOverlay();
    app.quit();
    dependencies.exit?.(exitCode);
  }
}

if (process.versions.electron) {
  const electron = await import("electron");
  const { app, BrowserWindow, safeStorage, screen, shell } = electron.default ?? electron;
  void runElectronVtsMotionRecorder(process.argv.slice(2), {
    app,
    BrowserWindow,
    safeStorage,
    screen,
    shell,
    exit: (exitCode) => { app.exit(exitCode); }
  })
    .catch(() => {
      process.exitCode = 1;
      app.quit();
    });
}
