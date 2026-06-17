import { contextBridge, ipcRenderer } from "electron";

type RenderHealth = {
  framesPerSecond: number;
  isContextLost: boolean;
  timestamp: number;
};

type PetApi = {
  reportFirstFrame(): void;
  reportRenderHealth(state: RenderHealth): void;
  openChat(): void;
};

const api: PetApi = {
  reportFirstFrame() {
    ipcRenderer.send("pet:first-frame");
  },
  reportRenderHealth(state: RenderHealth) {
    ipcRenderer.send("pet:health", state);
  },
  openChat() {
    void ipcRenderer.invoke("chat:open");
  }
};

contextBridge.exposeInMainWorld("petApi", api);
