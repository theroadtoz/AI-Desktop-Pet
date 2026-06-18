import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import type { PetDragDelta, PetPointerHitState } from "../shared/ipc-contract";
import { emotionTags, type EmotionTag } from "../shared/emotion";
import { registerModelAssetProtocol } from "./services/model-asset-protocol";
import { createPointerController, type PointerController } from "./services/pointer-controller";
import { createChatWindow, focusChatInput, showChatWindow } from "./windows/chat-window";
import { createPetWindow } from "./windows/pet-window";

let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let pointerController: PointerController | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "pet-model",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true
    }
  }
]);

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
  registerModelAssetProtocol();

  petWindow = createPetWindow();
  pointerController = createPointerController(petWindow);
  chatWindow = createChatWindow();

  function openChatWindow(): void {
    if (!chatWindow) {
      chatWindow = createChatWindow();
    }

    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
  }

  function isPetSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(petWindow && event.sender === petWindow.webContents);
  }

  function isChatSender(event: IpcMainEvent): boolean {
    return Boolean(chatWindow && event.sender === chatWindow.webContents);
  }

  function isEmotionTag(value: unknown): value is EmotionTag {
    return typeof value === "string" && emotionTags.includes(value as EmotionTag);
  }

  ipcMain.handle("pet:open-chat", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    openChatWindow();
  });

  ipcMain.on("pet:pointer-hit-change", (event, state: PetPointerHitState) => {
    if (!isPetSender(event) || typeof state?.isHit !== "boolean") {
      return;
    }

    pointerController?.setPointerHit(state.isHit);
  });

  ipcMain.on("pet:drag-start", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    pointerController?.startDrag();
  });

  ipcMain.on("pet:drag-move", (event, delta: PetDragDelta) => {
    if (
      !isPetSender(event) ||
      typeof delta?.deltaX !== "number" ||
      typeof delta.deltaY !== "number"
    ) {
      return;
    }

    pointerController?.moveDrag(delta);
  });

  ipcMain.on("pet:drag-end", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    pointerController?.endDrag();
  });

  ipcMain.on("pet:first-frame", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    // Phase 0 telemetry hook. P0-6 will replace this with structured logging.
    console.info("[pet] first frame reported");
  });

  ipcMain.on("pet:health", (event, state) => {
    if (!isPetSender(event)) {
      return;
    }

    console.info("[pet] health", state);
  });

  ipcMain.on("chat:reply-emotion", (event, emotion: unknown) => {
    if (!isChatSender(event) || !isEmotionTag(emotion) || !petWindow || petWindow.isDestroyed()) {
      return;
    }

    petWindow.webContents.send("pet:apply-emotion", emotion);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!petWindow || petWindow.isDestroyed()) {
    pointerController?.dispose();
    petWindow = createPetWindow();
    pointerController = createPointerController(petWindow);
  }
});
