import { contextBridge, ipcRenderer } from "electron";
import type { ChatApi } from "../shared/ipc-contract";
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

const api: ChatApi = {
  focusInput() {
    ipcRenderer.once("chat:focus-input", () => {
      window.dispatchEvent(new CustomEvent("chat:focus-input"));
    });
  },
  reportReplyEmotion(emotion: EmotionTag) {
    if (!isEmotionTag(emotion)) {
      return;
    }

    ipcRenderer.send("chat:reply-emotion", emotion);
  }
};

ipcRenderer.on("chat:focus-input", () => {
  window.dispatchEvent(new CustomEvent("chat:focus-input"));
});

contextBridge.exposeInMainWorld("chatApi", api);
