import { contextBridge, ipcRenderer } from "electron";
import type { PetApi, RenderHealth, PetDragDelta, PetFirstFrameInfo } from "../shared/ipc-contract";
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
  reportFirstFrame(info: PetFirstFrameInfo) {
    ipcRenderer.send("pet:first-frame", info);
  },
  reportRenderHealth(state: RenderHealth) {
    ipcRenderer.send("pet:health", state);
  },
  reportTelemetry(type: string, payload?: Record<string, unknown>) {
    ipcRenderer.send("pet:telemetry", { type, payload });
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
  onInjectWebGLContextLoss(handler: () => void) {
    const listener = (): void => {
      handler();
    };

    ipcRenderer.on("pet:inject-webgl-context-loss", listener);

    return () => {
      ipcRenderer.removeListener("pet:inject-webgl-context-loss", listener);
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
