import { app, BrowserWindow, ipcMain } from "electron";
import { createChatWindow, focusChatInput, showChatWindow } from "./windows/chat-window";
import { createPetWindow } from "./windows/pet-window";

let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (chatWindow) {
    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
  }
});

app.whenReady().then(async () => {
  petWindow = createPetWindow();
  chatWindow = createChatWindow();

  ipcMain.handle("chat:open", () => {
    if (!chatWindow) {
      chatWindow = createChatWindow();
    }

    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
  });

  ipcMain.on("pet:first-frame", () => {
    // Phase 0 telemetry hook. P0-6 will replace this with structured logging.
    console.info("[pet] first frame reported");
  });

  ipcMain.on("pet:health", (_event, state) => {
    console.info("[pet] health", state);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow();
  }
});
