import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createChatWindow(): BrowserWindow {
  const preload = join(__dirname, "../../preload/chat-preload.js");
  const window = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    title: "Desktop Pet Chat",
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.loadFile(join(__dirname, "../../renderer/chat/index.html"));

  window.on("close", (event) => {
    event.preventDefault();
    window.hide();
  });

  return window;
}

export function showChatWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }

  window.setAlwaysOnTop(true, "floating");
  window.show();
  window.moveTop();
  window.focus();
}

export function focusChatInput(window: BrowserWindow): void {
  window.webContents.send("chat:focus-input");
}
