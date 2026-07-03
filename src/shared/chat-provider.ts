import type { ChatMessage, ChatRole } from "./chat";
import type { MemoryInjection } from "./chat-memory";
import type { DialogueStyleContext } from "./dialogue-style";
import type { EmotionClassification } from "./emotion";
import type { ProviderId } from "./provider-config";
import type { UserProfilePromptContext } from "./user-profile";
import type { WebSearchContext } from "./web-search";

export type ChatProviderId = ProviderId;

export type ChatRuntimeContext = {
  isoTime: string;
  localDate: string;
  localTime: string;
  weekday: string;
  timezone: string;
  locale: string;
};

export type ChatProviderMessage = {
  id?: string;
  role: ChatRole | "system";
  content: string;
};

export type ChatContextBudgetSummary = {
  originalMessageCount: number;
  providerMessageCount: number;
  compressed: boolean;
  summaryMessageCount: number;
  summarizedMessageCount: number;
  recentMessageCount: number;
};

export type ChatRequest = {
  requestVersion: number;
  conversationId: string;
  messages: ChatMessage[];
  providerMessages?: ChatProviderMessage[];
  contextBudget?: ChatContextBudgetSummary;
  memoryContext?: MemoryInjection;
  dialogueStyleContext?: DialogueStyleContext;
  userProfileContext?: UserProfilePromptContext;
  runtimeContext?: ChatRuntimeContext;
  webSearchContext?: WebSearchContext;
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
