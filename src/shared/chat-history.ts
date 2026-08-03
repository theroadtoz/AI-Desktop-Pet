import type { ChatRole } from "./chat";
import { containsSensitiveMemoryMaterial } from "./chat-memory";
import {
  DEFAULT_HISTORY_RETENTION_LIMIT,
  HISTORY_RETENTION_LIMITS,
  isHistoryRetentionLimit,
  normalizeStoredHistoryRetentionLimit,
  type HistoryRetentionLimit
} from "./history-retention";

export {
  DEFAULT_HISTORY_RETENTION_LIMIT,
  HISTORY_RETENTION_LIMITS,
  isHistoryRetentionLimit,
  normalizeStoredHistoryRetentionLimit,
  type HistoryRetentionLimit
} from "./history-retention";

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

export const HISTORY_STORAGE_VERSION = 2;
export const HISTORY_STORAGE_V1 = 1;

export type HistorySemanticSummary = {
  conversationId: string;
  sourceMessageIds: string[];
  content: string;
  updatedAt: number;
};

export type HistoryStorageV1 = {
  version: typeof HISTORY_STORAGE_V1;
  conversations: Conversation[];
};

export type HistoryStorage = {
  version: typeof HISTORY_STORAGE_VERSION;
  retentionLimit: HistoryRetentionLimit;
  conversations: Conversation[];
  semanticSummaries: HistorySemanticSummary[];
};

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isHistoryId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isHistoryMessage(value: unknown): value is HistoryMessage {
  const message = value as Partial<HistoryMessage> | null;

  return Boolean(
    message &&
    !Array.isArray(message) &&
    hasExactKeys(message, ["id", "role", "content", "createdAt"]) &&
    isHistoryId(message.id) &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    typeof message.createdAt === "number" &&
    Number.isSafeInteger(message.createdAt) &&
    message.createdAt > 0
  );
}

export function parseHistoryStorage(value: unknown): HistoryStorage | HistoryStorageV1 | null {
  const storage = value as (Partial<HistoryStorage> | Partial<HistoryStorageV1>) | null;

  if (!storage || Array.isArray(storage) || !Array.isArray(storage.conversations)) {
    return null;
  }

  const conversations = storage.conversations.map(parseConversation);

  if (conversations.some((conversation) => conversation === null)) {
    return null;
  }

  if (storage.version === HISTORY_STORAGE_V1 && hasExactKeys(storage, ["version", "conversations"])) {
    return { version: HISTORY_STORAGE_V1, conversations: conversations as Conversation[] };
  }

  const retentionLimit = "retentionLimit" in storage
    ? normalizeStoredHistoryRetentionLimit(storage.retentionLimit)
    : null;

  if (
    storage.version !== HISTORY_STORAGE_VERSION ||
    !hasExactKeys(storage, ["version", "retentionLimit", "conversations", "semanticSummaries"]) ||
    retentionLimit === null ||
    !Array.isArray(storage.semanticSummaries)
  ) {
    return null;
  }

  const semanticSummaries = storage.semanticSummaries.map(parseHistorySemanticSummary);
  if (semanticSummaries.some((summary) => summary === null)) {
    return null;
  }
  const conversationsById = new Map((conversations as Conversation[]).map((conversation) => [conversation.id, conversation]));
  if (!(semanticSummaries as HistorySemanticSummary[]).every((summary) => {
    const conversation = conversationsById.get(summary.conversationId);
    return conversation && summary.sourceMessageIds.every((id) => conversation.messages.some((message) => message.id === id));
  })) {
    return null;
  }

  return {
    version: HISTORY_STORAGE_VERSION,
    retentionLimit,
    conversations: conversations as Conversation[],
    semanticSummaries: semanticSummaries as HistorySemanticSummary[]
  };
}

export function migrateHistoryStorage(storage: HistoryStorage | HistoryStorageV1): HistoryStorage {
  if (storage.version === HISTORY_STORAGE_VERSION) {
    return storage;
  }

  return {
    version: HISTORY_STORAGE_VERSION,
    retentionLimit: DEFAULT_HISTORY_RETENTION_LIMIT,
    conversations: storage.conversations,
    semanticSummaries: []
  };
}

export function isSafeHistorySemanticSummary(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 600 &&
    !/[\u0000-\u001f]/.test(value) &&
    !containsSensitiveMemoryMaterial(value) &&
    !/(?:https?:\/\/|[a-z]:\\)/i.test(value);
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
    Array.isArray(conversation) ||
    !hasExactKeys(conversation, ["id", "title", "createdAt", "updatedAt", "messages"]) ||
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

function parseHistorySemanticSummary(value: unknown): HistorySemanticSummary | null {
  const summary = value as Partial<HistorySemanticSummary> | null;

  if (
    !summary ||
    Array.isArray(summary) ||
    !hasExactKeys(summary, ["conversationId", "sourceMessageIds", "content", "updatedAt"]) ||
    !isHistoryId(summary.conversationId) ||
    !Array.isArray(summary.sourceMessageIds) ||
    summary.sourceMessageIds.length === 0 ||
    !summary.sourceMessageIds.every(isHistoryId) ||
    new Set(summary.sourceMessageIds).size !== summary.sourceMessageIds.length ||
    !isSafeHistorySemanticSummary(summary.content) ||
    typeof summary.updatedAt !== "number" ||
    !Number.isSafeInteger(summary.updatedAt) ||
    summary.updatedAt <= 0
  ) {
    return null;
  }

  return {
    conversationId: summary.conversationId,
    sourceMessageIds: summary.sourceMessageIds,
    content: summary.content,
    updatedAt: summary.updatedAt
  };
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected.slice().sort()[index]);
}
