import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatApi,
  ChatSendRequest,
  ChatStreamDeltaPayload,
  ChatStreamDonePayload,
  ChatStreamErrorPayload,
  ConfigApi,
  ConfigApiKeyRequest,
  ConfigSetApiKeyRequest
} from "../shared/ipc-contract";
import type { EmotionTag } from "../shared/emotion";
import type { ProviderConfig } from "../shared/provider-config";

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

function isProviderConfig(value: unknown): value is ProviderConfig {
  const config = value as Partial<ProviderConfig> | null;

  if (!config || typeof config !== "object") {
    return false;
  }

  if (config.providerId === "fake") {
    return typeof config.displayName === "string" && config.displayName.length > 0;
  }

  if (config.providerId === "openai-compatible") {
    return (
      typeof config.displayName === "string" &&
      config.displayName.length > 0 &&
      typeof config.baseURL === "string" &&
      config.baseURL.length > 0 &&
      typeof config.model === "string" &&
      config.model.length > 0 &&
      typeof config.apiKeyRef === "string" &&
      config.apiKeyRef.length > 0 &&
      typeof config.temperature === "number" &&
      Number.isFinite(config.temperature) &&
      typeof config.maxTokens === "number" &&
      Number.isInteger(config.maxTokens) &&
      config.maxTokens > 0 &&
      typeof config.timeoutMs === "number" &&
      Number.isInteger(config.timeoutMs) &&
      config.timeoutMs > 0
    );
  }

  return false;
}

function isConfigApiKeyRequest(value: unknown): value is ConfigApiKeyRequest {
  const request = value as Partial<ConfigApiKeyRequest> | null;

  return Boolean(request && typeof request.apiKeyRef === "string" && request.apiKeyRef.length > 0);
}

function isConfigSetApiKeyRequest(value: unknown): value is ConfigSetApiKeyRequest {
  const request = value as Partial<ConfigSetApiKeyRequest> | null;

  return Boolean(
    request &&
    typeof request.apiKeyRef === "string" &&
    request.apiKeyRef.length > 0 &&
    typeof request.apiKey === "string" &&
    request.apiKey.length > 0
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

const configApi: ConfigApi = {
  async getProvider() {
    const config = await ipcRenderer.invoke("config:get-provider");

    if (!isProviderConfig(config)) {
      throw new Error("Invalid provider config response");
    }

    return config;
  },
  async setProvider(config) {
    if (!isProviderConfig(config)) {
      throw new Error("Invalid provider config");
    }

    const savedConfig = await ipcRenderer.invoke("config:set-provider", config);

    if (!isProviderConfig(savedConfig)) {
      throw new Error("Invalid provider config response");
    }

    return savedConfig;
  },
  async hasApiKey(request) {
    if (!isConfigApiKeyRequest(request)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("config:has-api-key", request));
  },
  async setApiKey(request) {
    if (!isConfigSetApiKeyRequest(request)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("config:set-api-key", request));
  },
  async deleteApiKey(request) {
    if (!isConfigApiKeyRequest(request)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("config:delete-api-key", request));
  }
};

ipcRenderer.on("chat:focus-input", () => {
  window.dispatchEvent(new CustomEvent("chat:focus-input"));
});

contextBridge.exposeInMainWorld("chatApi", api);
contextBridge.exposeInMainWorld("configApi", configApi);
