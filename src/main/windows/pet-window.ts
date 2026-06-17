import { BrowserWindow } from "electron";
import { join } from "node:path";

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

  window.setAlwaysOnTop(true, "floating");
  window.setIgnoreMouseEvents(true, { forward: true });

  window.once("ready-to-show", () => {
    window.showInactive();
  });

  window.loadFile(join(__dirname, "../../renderer/pet/index.html"));

  return window;
}
