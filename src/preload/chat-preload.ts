import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatApi,
  ChatSendRequest,
  ChatStreamDeltaPayload,
  ChatStreamDonePayload,
  ChatStreamErrorPayload
} from "../shared/ipc-contract";
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

function isChatMessage(value: unknown): boolean {
  const message = value as Partial<ChatSendRequest["messages"][number]> | null;

  return Boolean(
    message &&
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

function isChatSendRequest(value: unknown): value is ChatSendRequest {
  const request = value as Partial<ChatSendRequest> | null;

  return Boolean(
    request &&
    typeof request.conversationId === "string" &&
    Array.isArray(request.messages) &&
    request.messages.every(isChatMessage)
  );
}

function isChatStreamDeltaPayload(value: unknown): value is ChatStreamDeltaPayload {
  const delta = value as Partial<ChatStreamDeltaPayload> | null;

  return Boolean(delta && typeof delta.text === "string");
}

function isChatStreamDonePayload(value: unknown): value is ChatStreamDonePayload {
  const result = value as Partial<ChatStreamDonePayload> | null;

  return Boolean(
    result &&
    typeof result.text === "string" &&
    isEmotionTag(result.emotion)
  );
}

function isChatStreamErrorPayload(value: unknown): value is ChatStreamErrorPayload {
  const error = value as Partial<ChatStreamErrorPayload> | null;

  return Boolean(
    error &&
    typeof error.message === "string" &&
    (error.errorType === "aborted" || error.errorType === "busy" || error.errorType === "failed")
  );
}

const api: ChatApi = {
  focusInput() {
    ipcRenderer.once("chat:focus-input", () => {
      window.dispatchEvent(new CustomEvent("chat:focus-input"));
    });
  },
  sendMessage(request: ChatSendRequest) {
    if (!isChatSendRequest(request)) {
      return;
    }

    ipcRenderer.send("chat:send", request);
  },
  abortReply() {
    ipcRenderer.send("chat:abort");
  },
  onReplyDelta(handler) {
    const listener = (_event: Electron.IpcRendererEvent, delta: unknown): void => {
      if (isChatStreamDeltaPayload(delta)) {
        handler(delta);
      }
    };

    ipcRenderer.on("chat:stream-delta", listener);
    return () => {
      ipcRenderer.removeListener("chat:stream-delta", listener);
    };
  },
  onReplyDone(handler) {
    const listener = (_event: Electron.IpcRendererEvent, result: unknown): void => {
      if (isChatStreamDonePayload(result)) {
        handler(result);
      }
    };

    ipcRenderer.on("chat:stream-done", listener);
    return () => {
      ipcRenderer.removeListener("chat:stream-done", listener);
    };
  },
  onReplyError(handler) {
    const listener = (_event: Electron.IpcRendererEvent, error: unknown): void => {
      if (isChatStreamErrorPayload(error)) {
        handler(error);
      }
    };

    ipcRenderer.on("chat:stream-error", listener);
    return () => {
      ipcRenderer.removeListener("chat:stream-error", listener);
    };
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
