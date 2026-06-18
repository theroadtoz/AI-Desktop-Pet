import type { ChatMessage } from "./chat";
import type { EmotionTag } from "./emotion";
import type { ProviderId } from "./provider-config";

export type ChatProviderId = ProviderId;

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
