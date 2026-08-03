import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { getWindowIconPath } from "./app-icon";
import { showChatWindowAbovePet, TOPMOST_WINDOW_LEVEL } from "./topmost-policy";
import { installTrustedWindowPolicy } from "./trusted-window-policy";
import { shouldHideChatWindowOnClose } from "../lifecycle/app-shutdown-coordinator";
import {
  PHONE_CHARM_ANCHOR_X,
  PHONE_CHARM_ANCHOR_Y,
  PHONE_CHARM_MOTION_SAMPLE_INTERVAL_MS,
  PHONE_CHARM_STAGE_HEIGHT,
  PHONE_CHARM_STAGE_WIDTH,
  type PhoneCharmWindowMotion
} from "../../shared/phone-charm-motion";

type ChatWindowOptions = {
  shouldClose?: () => boolean;
};

const CHAT_WINDOW_WIDTH = 438;
const CHAT_WINDOW_HEIGHT = 910;
const CHAT_WINDOW_MIN_WIDTH = 329;
const CHAT_WINDOW_MIN_HEIGHT = 683;
const CHAT_WINDOW_ASPECT_RATIO = CHAT_WINDOW_WIDTH / CHAT_WINDOW_HEIGHT;
const PHONE_SHELL_RIGHT_INSET = 18;
const PHONE_SHELL_BOTTOM_INSET = 18;
const PHONE_CHARM_BOTTOM_OFFSET = 175;

function attachPhoneCharmWindow(parent: BrowserWindow): BrowserWindow {
  const preload = join(__dirname, "../../preload/phone-charm-preload.js");
  const charm = new BrowserWindow({
    width: PHONE_CHARM_STAGE_WIDTH,
    height: PHONE_CHARM_STAGE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    parent,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  charm.setAlwaysOnTop(true, TOPMOST_WINDOW_LEVEL);
  charm.setIgnoreMouseEvents(true, { forward: false });
  charm.loadFile(join(__dirname, "../../renderer/phone-charm/index.html"));

  let rendererReady = false;
  let lastParentBounds = parent.getBounds();
  let lastMoveAtMs = Date.now();
  let motionPollTimer: NodeJS.Timeout | null = null;

  function positionCharm(emitMotion: boolean, forcePosition = false): void {
    if (parent.isDestroyed() || charm.isDestroyed()) {
      return;
    }

    const bounds = parent.getBounds();
    const deltaX = bounds.x - lastParentBounds.x;
    const deltaY = bounds.y - lastParentBounds.y;
    if (forcePosition || deltaX !== 0 || deltaY !== 0) {
      charm.setPosition(
        bounds.x + bounds.width - PHONE_SHELL_RIGHT_INSET - PHONE_CHARM_ANCHOR_X,
        bounds.y + bounds.height - PHONE_SHELL_BOTTOM_INSET - PHONE_CHARM_BOTTOM_OFFSET - PHONE_CHARM_ANCHOR_Y,
        false
      );
    }

    const nowMs = Date.now();
    if (emitMotion && rendererReady && (deltaX !== 0 || deltaY !== 0)) {
      const elapsedSeconds = Math.max((nowMs - lastMoveAtMs) / 1_000, 1 / 240);
      const motion: PhoneCharmWindowMotion = {
        velocityX: deltaX / elapsedSeconds,
        velocityY: deltaY / elapsedSeconds,
        timestampMs: nowMs
      };
      charm.webContents.send("phone-charm:window-motion", motion);
    }

    lastMoveAtMs = nowMs;
    lastParentBounds = bounds;
  }

  function startMotionPolling(): void {
    if (motionPollTimer || charm.isDestroyed()) {
      return;
    }
    lastParentBounds = parent.getBounds();
    lastMoveAtMs = Date.now();
    motionPollTimer = setInterval(() => positionCharm(true), PHONE_CHARM_MOTION_SAMPLE_INTERVAL_MS);
    motionPollTimer.unref();
  }

  function stopMotionPolling(): void {
    if (!motionPollTimer) {
      return;
    }
    clearInterval(motionPollTimer);
    motionPollTimer = null;
  }

  function showCharm(): void {
    if (!rendererReady || !parent.isVisible() || parent.isMinimized() || charm.isDestroyed()) {
      return;
    }

    positionCharm(false, true);
    charm.showInactive();
    charm.moveTop();
    startMotionPolling();
  }

  charm.webContents.on("did-finish-load", () => {
    rendererReady = true;
    showCharm();
  });
  parent.on("resize", () => positionCharm(false, true));
  parent.on("show", showCharm);
  parent.on("restore", showCharm);
  parent.on("hide", () => {
    stopMotionPolling();
    if (!charm.isDestroyed()) {
      charm.hide();
    }
  });
  parent.on("minimize", () => {
    stopMotionPolling();
    if (!charm.isDestroyed()) {
      charm.hide();
    }
  });
  parent.on("closed", () => {
    stopMotionPolling();
    if (!charm.isDestroyed()) {
      charm.destroy();
    }
  });

  return charm;
}

export function createChatWindow(options: ChatWindowOptions = {}): BrowserWindow {
  const preload = join(__dirname, "../../preload/chat-preload.js");
  const window = new BrowserWindow({
    width: CHAT_WINDOW_WIDTH,
    height: CHAT_WINDOW_HEIGHT,
    minWidth: CHAT_WINDOW_MIN_WIDTH,
    minHeight: CHAT_WINDOW_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: "#00000000",
    title: "Desktop Pet Chat",
    icon: getWindowIconPath(),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  window.setAspectRatio(CHAT_WINDOW_ASPECT_RATIO);

  installTrustedWindowPolicy(window.webContents, (url) => shell.openExternal(url));
  window.loadFile(join(__dirname, "../../renderer/chat/index.html"));
  attachPhoneCharmWindow(window);

  window.on("close", (event) => {
    if (!shouldHideChatWindowOnClose(options.shouldClose?.() === true)) {
      return;
    }

    event.preventDefault();
    window.hide();
  });

  return window;
}

export function showChatWindow(window: BrowserWindow): void {
  showChatWindowAbovePet(window);
}

export function focusChatInput(window: BrowserWindow): void {
  window.webContents.send("chat:focus-input");
}
