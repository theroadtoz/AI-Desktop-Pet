import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  HISTORY_STORAGE_VERSION,
  DEFAULT_HISTORY_RETENTION_LIMIT,
  isHistoryId,
  isHistoryMessage,
  isHistoryRetentionLimit,
  isSafeHistorySemanticSummary,
  migrateHistoryStorage,
  parseHistoryStorage,
  toConversationSummary,
  type Conversation,
  type ConversationSummary,
  type HistoryRetentionLimit,
  type HistoryMessage,
  type HistoryStorage
} from "../../../shared/chat-history";

export type HistoryStore = {
  listConversations(): ConversationSummary[];
  getConversation(id: string): Conversation | null;
  appendMessage(conversationId: string, message: HistoryMessage): boolean;
  deleteConversation(id: string): boolean;
  clearConversations(): boolean;
  getRetentionLimit(): HistoryRetentionLimit;
  setRetentionLimit(limit: HistoryRetentionLimit): HistoryRetentionLimit | null;
  getSemanticSummary(conversationId: string, sourceMessageIds: readonly string[]): string | null;
  saveSemanticSummary(conversationId: string, sourceMessageIds: readonly string[], content: string): boolean;
  getHistoryPath(): string;
};

export function createHistoryStore(options: { userDataPath?: string; writeFileSync?: typeof writeFileSync } = {}): HistoryStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const historyPath = join(userDataPath, "history", "conversations.json");
  const writeHistoryFile = options.writeFileSync ?? writeFileSync;

  function readStorage(): { storage: HistoryStorage; canWrite: boolean } {
    if (!existsSync(historyPath)) {
      return { storage: emptyStorage(), canWrite: true };
    }

    try {
      const parsed = parseHistoryStorage(JSON.parse(readFileSync(historyPath, "utf8")));
      return parsed
        ? { storage: migrateHistoryStorage(parsed), canWrite: true }
        : { storage: emptyStorage(), canWrite: false };
    } catch {
      return { storage: emptyStorage(), canWrite: false };
    }
  }

  function writeStorage(storage: HistoryStorage): void {
    mkdirSync(dirname(historyPath), { recursive: true });
    const temporaryPath = `${historyPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      writeHistoryFile(temporaryPath, `${JSON.stringify(storage, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, historyPath);
    } finally {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
    }
  }

  return {
    listConversations() {
      return readStorage().storage.conversations
        .map(toConversationSummary)
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },
    getConversation(id) {
      if (!isHistoryId(id)) {
        return null;
      }

      return readStorage().storage.conversations.find((conversation) => conversation.id === id) ?? null;
    },
    appendMessage(conversationId, message) {
      if (!isHistoryId(conversationId) || !isHistoryMessage(message)) {
        throw new Error("Invalid history message");
      }

      const read = readStorage();
      if (!read.canWrite) return false;
      const storage = read.storage;
      const existingConversation = storage.conversations.find((conversation) => conversation.id === conversationId);

      if (existingConversation) {
        if (existingConversation.messages.some((existingMessage) => existingMessage.id === message.id)) {
          return false;
        }

        existingConversation.messages.push(message);
        existingConversation.updatedAt = message.createdAt;
      } else {
        storage.conversations.push({
          id: conversationId,
          title: createConversationTitle(message),
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
          messages: [message]
        });
      }

      applyRetention(storage);
      return tryWriteStorage(storage);
    },
    deleteConversation(id) {
      if (!isHistoryId(id)) {
        return false;
      }

      const read = readStorage();
      if (!read.canWrite) return false;
      const storage = read.storage;
      const nextConversations = storage.conversations.filter((conversation) => conversation.id !== id);

      if (nextConversations.length === storage.conversations.length) {
        return false;
      }

      storage.conversations = nextConversations;
      storage.semanticSummaries = storage.semanticSummaries.filter((summary) => summary.conversationId !== id);
      return tryWriteStorage(storage);
    },
    clearConversations() {
      const read = readStorage();
      return read.canWrite && tryWriteStorage({
        ...emptyStorage(),
        retentionLimit: read.storage.retentionLimit
      });
    },
    getRetentionLimit() {
      return readStorage().storage.retentionLimit;
    },
    setRetentionLimit(limit) {
      if (!isHistoryRetentionLimit(limit)) {
        return readStorage().storage.retentionLimit;
      }

      const read = readStorage();
      if (!read.canWrite) return null;
      const storage = read.storage;
      storage.retentionLimit = limit;
      applyRetention(storage);
      return tryWriteStorage(storage) ? storage.retentionLimit : null;
    },
    getSemanticSummary(conversationId, sourceMessageIds) {
      if (!isHistoryId(conversationId) || !isValidMessageIdList(sourceMessageIds)) {
        return null;
      }

      const summary = readStorage().storage.semanticSummaries.find((candidate) =>
        candidate.conversationId === conversationId && sameIds(candidate.sourceMessageIds, sourceMessageIds)
      );
      return summary?.content ?? null;
    },
    saveSemanticSummary(conversationId, sourceMessageIds, content) {
      if (!isHistoryId(conversationId) || !isValidMessageIdList(sourceMessageIds) || !isSafeHistorySemanticSummary(content)) {
        return false;
      }

      const read = readStorage();
      if (!read.canWrite) return false;
      const storage = read.storage;
      const conversation = storage.conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation || !sourceMessageIds.every((id) => conversation.messages.some((message) => message.id === id))) {
        return false;
      }

      storage.semanticSummaries = storage.semanticSummaries.filter((summary) => summary.conversationId !== conversationId);
      storage.semanticSummaries.push({
        conversationId,
        sourceMessageIds: [...sourceMessageIds],
        content,
        updatedAt: Date.now()
      });
      return tryWriteStorage(storage);
    },
    getHistoryPath() {
      return historyPath;
    }
  };

  function tryWriteStorage(storage: HistoryStorage): boolean {
    try {
      writeStorage(storage);
      return true;
    } catch {
      return false;
    }
  }
}

function emptyStorage(): HistoryStorage {
  return {
    version: HISTORY_STORAGE_VERSION,
    retentionLimit: DEFAULT_HISTORY_RETENTION_LIMIT,
    conversations: [],
    semanticSummaries: []
  };
}

function applyRetention(storage: HistoryStorage): void {
  const excess = storage.conversations.length - storage.retentionLimit;
  if (excess <= 0) return;

  const expiredIds = new Set(storage.conversations
    .slice()
    .sort((left, right) => left.updatedAt - right.updatedAt || left.createdAt - right.createdAt)
    .slice(0, excess)
    .map((conversation) => conversation.id));
  storage.conversations = storage.conversations.filter((conversation) => !expiredIds.has(conversation.id));
  storage.semanticSummaries = storage.semanticSummaries.filter((summary) => !expiredIds.has(summary.conversationId));
}

function isValidMessageIdList(value: readonly string[]): boolean {
  return value.length > 0 && value.every(isHistoryId) && new Set(value).size === value.length;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createConversationTitle(message: HistoryMessage): string {
  const source = message.role === "user" ? message.content : "新会话";
  const title = source.trim().replace(/\s+/g, " ");

  return title.slice(0, 36) || "新会话";
}
