import { contextBridge, ipcRenderer } from "electron";
import type { PetApi, RenderHealth, PetDragDelta } from "../shared/ipc-contract";
import type { EmotionTag } from "../shared/emotion";

const emotionTags = [
  "neutral",
  "happy",
  "sad",
  "surprised",
  "confused",
  "angry"
] as const;

function isEmotionTag(value: unknown): value is EmotionTag {
  return typeof value === "string" && emotionTags.includes(value as EmotionTag);
}

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
  onApplyEmotion(handler: (emotion: EmotionTag) => void) {
    const listener = (_event: Electron.IpcRendererEvent, emotion: unknown): void => {
      if (isEmotionTag(emotion)) {
        handler(emotion);
      }
    };

    ipcRenderer.on("pet:apply-emotion", listener);

    return () => {
      ipcRenderer.removeListener("pet:apply-emotion", listener);
    };
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
