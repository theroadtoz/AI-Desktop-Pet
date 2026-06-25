import type { ChatRole } from "./chat";

export type HistoryMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: HistoryMessage[];
};

export type ConversationSummary = Omit<Conversation, "messages"> & {
  messageCount: number;
};

export const HISTORY_STORAGE_VERSION = 1;

export type HistoryStorage = {
  version: typeof HISTORY_STORAGE_VERSION;
  conversations: Conversation[];
};

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isHistoryId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isHistoryMessage(value: unknown): value is HistoryMessage {
  const message = value as Partial<HistoryMessage> | null;

  return Boolean(
    message &&
    isHistoryId(message.id) &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    typeof message.createdAt === "number" &&
    Number.isSafeInteger(message.createdAt) &&
    message.createdAt > 0
  );
}

export function parseHistoryStorage(value: unknown): HistoryStorage | null {
  const storage = value as Partial<HistoryStorage> | null;

  if (!storage || storage.version !== HISTORY_STORAGE_VERSION || !Array.isArray(storage.conversations)) {
    return null;
  }

  const conversations = storage.conversations.map(parseConversation);

  if (conversations.some((conversation) => conversation === null)) {
    return null;
  }

  return {
    version: HISTORY_STORAGE_VERSION,
    conversations: conversations as Conversation[]
  };
}

export function toConversationSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  };
}

function parseConversation(value: unknown): Conversation | null {
  const conversation = value as Partial<Conversation> | null;

  if (
    !conversation ||
    !isHistoryId(conversation.id) ||
    typeof conversation.title !== "string" ||
    conversation.title.trim().length === 0 ||
    typeof conversation.createdAt !== "number" ||
    !Number.isSafeInteger(conversation.createdAt) ||
    conversation.createdAt <= 0 ||
    typeof conversation.updatedAt !== "number" ||
    !Number.isSafeInteger(conversation.updatedAt) ||
    conversation.updatedAt < conversation.createdAt ||
    !Array.isArray(conversation.messages) ||
    !conversation.messages.every(isHistoryMessage)
  ) {
    return null;
  }

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages
  };
}
