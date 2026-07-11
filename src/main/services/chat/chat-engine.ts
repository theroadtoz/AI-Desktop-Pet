import type {
  ChatProvider,
  ChatProviderId,
  ChatProviderResult,
  ChatRequest,
  ChatStreamDelta
} from "../../../shared/chat-provider";
import {
  createAssistantReplyPrivacyStreamGuard,
  sanitizeAssistantReplyForDisplay
} from "./assistant-reply-privacy";
import { createFakeChatProvider } from "./fake-provider";

export class ChatEngineBusyError extends Error {
  constructor() {
    super("Chat stream already active");
    this.name = "ChatEngineBusyError";
  }
}

export type ChatEngine = {
  getProviderId(): ChatProviderId;
  setProvider(provider: ChatProvider): void;
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
    setProvider(nextProvider) {
      provider = nextProvider;
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
        const streamGuard = createAssistantReplyPrivacyStreamGuard((text) => {
          options.onDelta({ text });
        });
        const result = await provider.streamReply(request, {
          signal: abortController.signal,
          onDelta(delta) {
            streamGuard.push(delta.text);
          }
        });
        if (abortController.signal.aborted) {
          throw new DOMException("Chat reply aborted", "AbortError");
        }
        streamGuard.flush();

        return {
          ...result,
          text: sanitizeAssistantReplyForDisplay(result.text)
        };
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      }
    }
  };
}
