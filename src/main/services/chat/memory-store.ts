import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  MEMORY_STORAGE_VERSION,
  isMemoryId,
  parseMemoryCardDraft,
  parseMemoryCardUpdate,
  parseMemoryStorage,
  type MemoryCard,
  type MemoryCardDraft,
  type MemoryCardUpdate,
  type MemoryInjection,
  type MemorySettings,
  type MemoryStorage
} from "../../../shared/chat-memory";

export type MemoryStore = {
  getSettings(): MemorySettings;
  setEnabled(enabled: boolean): MemorySettings;
  listCards(): MemoryCard[];
  getCard(id: string): MemoryCard | null;
  createCard(draft: MemoryCardDraft): MemoryCard;
  updateCard(id: string, update: MemoryCardUpdate): MemoryCard | null;
  deleteCard(id: string): boolean;
  clearCards(): void;
  createInjection(): MemoryInjection;
  getMemoryPath(): string;
};

export function createMemoryStore(options: { userDataPath?: string } = {}): MemoryStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const memoryPath = join(userDataPath, "memory", "facts.json");

  function readStorage(): MemoryStorage {
    if (!existsSync(memoryPath)) {
      return emptyStorage();
    }

    try {
      const rawStorage = JSON.parse(readFileSync(memoryPath, "utf8"));
      const storage = parseMemoryStorage(rawStorage);

      if (!storage) {
        return emptyStorage();
      }

      if (rawStorage?.version !== MEMORY_STORAGE_VERSION) {
        try {
          writeStorage(storage);
        } catch {
          // Keep compatible reads available even if a migration write cannot be persisted yet.
        }
      }

      return storage;
    } catch {
      return emptyStorage();
    }
  }

  function writeStorage(storage: MemoryStorage): void {
    mkdirSync(dirname(memoryPath), { recursive: true });
    const temporaryPath = `${memoryPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(storage, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, memoryPath);
    } finally {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
    }
  }

  return {
    getSettings() {
      return { enabled: readStorage().enabled };
    },
    setEnabled(enabled) {
      const storage = readStorage();
      storage.enabled = enabled;
      writeStorage(storage);
      return { enabled };
    },
    listCards() {
      return readStorage().cards.sort((left, right) => right.updatedAt - left.updatedAt);
    },
    getCard(id) {
      if (!isMemoryId(id)) {
        return null;
      }

      return readStorage().cards.find((card) => card.id === id) ?? null;
    },
    createCard(draft) {
      const parsedDraft = parseMemoryCardDraft(draft);

      if (!parsedDraft) {
        throw new Error("Invalid memory draft");
      }

      const now = Date.now();
      const id = crypto.randomUUID();
      const card: MemoryCard = {
        id,
        ...parsedDraft,
        sourceType: "manual-chat",
        namespace: "personal",
        key: `manual-${id.slice(0, 8).toLowerCase()}`,
        createdAt: now,
        updatedAt: now,
        enabled: true,
        lastInjectedAt: null,
        injectionCount: 0
      };
      const storage = readStorage();
      storage.cards.push(card);
      writeStorage(storage);
      return card;
    },
    updateCard(id, update) {
      if (!isMemoryId(id)) {
        return null;
      }

      const parsedUpdate = parseMemoryCardUpdate(update);

      if (!parsedUpdate) {
        return null;
      }

      const storage = readStorage();
      const card = storage.cards.find((storedCard) => storedCard.id === id);

      if (!card) {
        return null;
      }

      Object.assign(card, parsedUpdate, { updatedAt: Date.now() });
      writeStorage(storage);
      return card;
    },
    deleteCard(id) {
      if (!isMemoryId(id)) {
        return false;
      }

      const storage = readStorage();
      const nextCards = storage.cards.filter((card) => card.id !== id);

      if (nextCards.length === storage.cards.length) {
        return false;
      }

      storage.cards = nextCards;
      writeStorage(storage);
      return true;
    },
    clearCards() {
      const storage = readStorage();
      storage.cards = [];
      writeStorage(storage);
    },
    createInjection() {
      const storage = readStorage();
      const enabledCards = storage.enabled
        ? storage.cards.filter((card) => card.enabled)
        : [];
      const cards = enabledCards.map(({ id, title, content, tags }) => ({ id, title, content, tags }));

      if (enabledCards.length > 0) {
        const now = Date.now();
        const injectedIds = new Set(enabledCards.map((card) => card.id));
        storage.cards = storage.cards.map((card) => injectedIds.has(card.id)
          ? {
            ...card,
            lastInjectedAt: now,
            injectionCount: card.injectionCount + 1
          }
          : card);
        writeStorage(storage);
      }

      return {
        count: cards.length,
        cards
      };
    },
    getMemoryPath() {
      return memoryPath;
    }
  };
}

function emptyStorage(): MemoryStorage {
  return {
    version: MEMORY_STORAGE_VERSION,
    enabled: false,
    cards: []
  };
}
