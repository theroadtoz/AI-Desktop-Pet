import { contextBridge, ipcRenderer } from "electron";
import type { PetApi, RenderHealth, PetDragDelta } from "../shared/ipc-contract";

const api: PetApi = {
  reportFirstFrame() {
    ipcRenderer.send("pet:first-frame");
  },
  reportRenderHealth(state: RenderHealth) {
    ipcRenderer.send("pet:health", state);
  },
  setPointerHit(isHit: boolean) {
    ipcRenderer.send("pet:pointer-hit-change", { isHit });
  },
  openChat() {
    void ipcRenderer.invoke("pet:open-chat");
  },
  startDrag() {
    ipcRenderer.send("pet:drag-start");
  },
  moveDrag(delta: PetDragDelta) {
    ipcRenderer.send("pet:drag-move", delta);
  },
  endDrag() {
    ipcRenderer.send("pet:drag-end");
  }
};

contextBridge.exposeInMainWorld("petApi", api);
