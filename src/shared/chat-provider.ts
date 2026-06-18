import type { ChatMessage } from "./chat";
import type { EmotionTag } from "./emotion";

export type ChatProviderId = "fake";

export type ChatRequest = {
  conversationId: string;
  messages: ChatMessage[];
};

export type ChatStreamDelta = {
  text: string;
};

export type ChatProviderResult = {
  text: string;
  emotion: EmotionTag;
};

export type ChatProvider = {
  id: ChatProviderId;
  streamReply(
    request: ChatRequest,
    options: {
      signal: AbortSignal;
      onDelta(delta: ChatStreamDelta): void;
    }
  ): Promise<ChatProviderResult>;
};
