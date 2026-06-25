import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  HISTORY_STORAGE_VERSION,
  isHistoryId,
  isHistoryMessage,
  parseHistoryStorage,
  toConversationSummary,
  type Conversation,
  type ConversationSummary,
  type HistoryMessage,
  type HistoryStorage
} from "../../../shared/chat-history";

export type HistoryStore = {
  listConversations(): ConversationSummary[];
  getConversation(id: string): Conversation | null;
  appendMessage(conversationId: string, message: HistoryMessage): boolean;
  deleteConversation(id: string): boolean;
  clearConversations(): void;
  getHistoryPath(): string;
};

export function createHistoryStore(options: { userDataPath?: string } = {}): HistoryStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const historyPath = join(userDataPath, "history", "conversations.json");

  function readStorage(): HistoryStorage {
    if (!existsSync(historyPath)) {
      return emptyStorage();
    }

    try {
      return parseHistoryStorage(JSON.parse(readFileSync(historyPath, "utf8"))) ?? emptyStorage();
    } catch {
      return emptyStorage();
    }
  }

  function writeStorage(storage: HistoryStorage): void {
    mkdirSync(dirname(historyPath), { recursive: true });
    const temporaryPath = `${historyPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(storage, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, historyPath);
    } finally {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
    }
  }

  return {
    listConversations() {
      return readStorage().conversations
        .map(toConversationSummary)
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },
    getConversation(id) {
      if (!isHistoryId(id)) {
        return null;
      }

      return readStorage().conversations.find((conversation) => conversation.id === id) ?? null;
    },
    appendMessage(conversationId, message) {
      if (!isHistoryId(conversationId) || !isHistoryMessage(message)) {
        throw new Error("Invalid history message");
      }

      const storage = readStorage();
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

      writeStorage(storage);
      return true;
    },
    deleteConversation(id) {
      if (!isHistoryId(id)) {
        return false;
      }

      const storage = readStorage();
      const nextConversations = storage.conversations.filter((conversation) => conversation.id !== id);

      if (nextConversations.length === storage.conversations.length) {
        return false;
      }

      storage.conversations = nextConversations;
      writeStorage(storage);
      return true;
    },
    clearConversations() {
      writeStorage(emptyStorage());
    },
    getHistoryPath() {
      return historyPath;
    }
  };
}

function emptyStorage(): HistoryStorage {
  return { version: HISTORY_STORAGE_VERSION, conversations: [] };
}

function createConversationTitle(message: HistoryMessage): string {
  const source = message.role === "user" ? message.content : "新会话";
  const title = source.trim().replace(/\s+/g, " ");

  return title.slice(0, 36) || "新会话";
}
