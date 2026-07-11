import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { getWindowIconPath } from "./app-icon";
import { showChatWindowAbovePet } from "./topmost-policy";
import { installTrustedWindowPolicy } from "./trusted-window-policy";
import { shouldHideChatWindowOnClose } from "../lifecycle/app-shutdown-coordinator";

type ChatWindowOptions = {
  shouldClose?: () => boolean;
};

export function createChatWindow(options: ChatWindowOptions = {}): BrowserWindow {
  const preload = join(__dirname, "../../preload/chat-preload.js");
  const window = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    title: "Desktop Pet Chat",
    icon: getWindowIconPath(),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  installTrustedWindowPolicy(window.webContents, (url) => shell.openExternal(url));
  window.loadFile(join(__dirname, "../../renderer/chat/index.html"));

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
