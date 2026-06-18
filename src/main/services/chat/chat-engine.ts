import type {
  ChatProvider,
  ChatProviderId,
  ChatProviderResult,
  ChatRequest,
  ChatStreamDelta
} from "../../../shared/chat-provider";
import { createFakeChatProvider } from "./fake-provider";

export class ChatEngineBusyError extends Error {
  constructor() {
    super("Chat stream already active");
    this.name = "ChatEngineBusyError";
  }
}

export type ChatEngine = {
  getProviderId(): ChatProviderId;
  hasActiveStream(): boolean;
  abortActiveStream(): boolean;
  startChatStream(
    request: ChatRequest,
    options: {
      onDelta(delta: ChatStreamDelta): void;
    }
  ): Promise<ChatProviderResult>;
};

export function createChatEngine(provider: ChatProvider = createFakeChatProvider()): ChatEngine {
  let activeAbortController: AbortController | null = null;

  return {
    getProviderId() {
      return provider.id;
    },
    hasActiveStream() {
      return activeAbortController !== null;
    },
    abortActiveStream() {
      if (!activeAbortController) {
        return false;
      }

      activeAbortController.abort();
      return true;
    },
    async startChatStream(request, options) {
      if (activeAbortController) {
        throw new ChatEngineBusyError();
      }

      const abortController = new AbortController();
      activeAbortController = abortController;

      try {
        return await provider.streamReply(request, {
          signal: abortController.signal,
          onDelta: options.onDelta
        });
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      }
    }
  };
}
