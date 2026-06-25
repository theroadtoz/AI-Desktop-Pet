import { BrowserWindow } from "electron";
import { join } from "node:path";
import { restorePetWindowOnTop } from "./topmost-policy";

export function createPetWindow(): BrowserWindow {
  const preload = join(__dirname, "../../preload/pet-preload.js");
  const window = new BrowserWindow({
    width: 420,
    height: 600,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.setIgnoreMouseEvents(true, { forward: true });

  window.once("ready-to-show", () => {
    restorePetWindowOnTop(window);
  });

  window.webContents.on("console-message", (event) => {
    console.info("[pet:console]", event.message);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.warn("[pet] render process gone", details);
  });

  window.loadFile(join(__dirname, "../../renderer/pet/index.html"));

  return window;
}
