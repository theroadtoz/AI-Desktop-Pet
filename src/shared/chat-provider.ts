import type { ChatMessage } from "./chat";
import type { MemoryInjection } from "./chat-memory";
import type { DialogueStyleContext } from "./dialogue-style";
import type { EmotionClassification } from "./emotion";
import type { ProviderId } from "./provider-config";
import type { UserProfilePromptContext } from "./user-profile";

export type ChatProviderId = ProviderId;

export type ChatRequest = {
  requestVersion: number;
  conversationId: string;
  messages: ChatMessage[];
  memoryContext?: MemoryInjection;
  dialogueStyleContext?: DialogueStyleContext;
  userProfileContext?: UserProfilePromptContext;
};

export type ChatStreamDelta = {
  text: string;
};

export type ChatProviderResult = EmotionClassification & {
  text: string;
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
