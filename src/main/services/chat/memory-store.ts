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
  type MemoryCompressionState,
  type MemoryImportance,
  type MemoryCardUpdate,
  type MemorySummary,
  type MemoryInjection,
  type MemorySettings,
  type MemorySourceType,
  type MemoryStorage
} from "../../../shared/chat-memory";

export const MEMORY_CONTEXT_COMPRESSION_THRESHOLD = 8;
export const MEMORY_INJECTION_BUDGET = 8;

type AutoMemoryCandidate = {
  title: string;
  content: string;
  tags: string[];
  namespace: string;
  key: string;
  importance: MemoryImportance;
  category: string;
  confidence: number;
};

export type AutoMemoryCaptureInput = {
  conversationId: string;
  messageId: string;
  content: string;
};

export type AutoMemoryCaptureSummary = {
  enabled: boolean;
  skippedReason: "disabled" | "sensitive" | "no_candidate" | null;
  capturedCount: number;
  keyCount: number;
  generalCount: number;
  mergedCount: number;
  deduplicatedCount: number;
  compressionTriggered: boolean;
  totalCards: number;
  injectionBudget: number;
  safeCategories: string[];
};

export type MemoryStore = {
  getSettings(): MemorySettings;
  getSummary(): MemorySummary;
  setEnabled(enabled: boolean): MemorySettings;
  listCards(): MemoryCard[];
  getCard(id: string): MemoryCard | null;
  createCard(draft: MemoryCardDraft): MemoryCard;
  captureAutoMemoriesFromLatestUserMessage(input: AutoMemoryCaptureInput): AutoMemoryCaptureSummary;
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
    getSummary() {
      return createMemorySummary(readStorage());
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
        importance: "key",
        category: "manual",
        confidence: 1,
        sourceMessageId: null,
        observedCount: 1,
        lastObservedAt: now,
        compressionState: "raw",
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
    captureAutoMemoriesFromLatestUserMessage(input) {
      const storage = readStorage();
      const baseSummary = createAutoMemoryCaptureSummary(storage.enabled, storage.cards.length);

      if (!storage.enabled) {
        return { ...baseSummary, skippedReason: "disabled" };
      }

      const extraction = extractAutoMemoryCandidates(input.content);

      if (extraction.sensitive) {
        return { ...baseSummary, skippedReason: "sensitive" };
      }

      if (extraction.candidates.length === 0) {
        return { ...baseSummary, skippedReason: "no_candidate" };
      }

      const now = Date.now();
      const sourceMessageId = isMemoryId(input.messageId) ? input.messageId : null;
      let capturedCount = 0;
      let mergedCount = 0;
      let deduplicatedCount = 0;
      const safeCategories = new Set<string>();

      for (const candidate of extraction.candidates) {
        safeCategories.add(candidate.category);
        const existing = storage.cards.find((card) => card.namespace === candidate.namespace && card.key === candidate.key);

        if (existing) {
          const result = mergeMemoryCard(existing, createAutoMemoryCard(candidate, input.conversationId, sourceMessageId, now), now);
          mergedCount += result.mergedCount;
          deduplicatedCount += result.deduplicatedCount;
          continue;
        }

        storage.cards.push(createAutoMemoryCard(candidate, input.conversationId, sourceMessageId, now));
        capturedCount += 1;
      }

      const compactResult = compactMemoryStorage(storage);
      mergedCount += compactResult.mergedCount;
      deduplicatedCount += compactResult.deduplicatedCount;
      writeStorage(storage);

      return {
        enabled: true,
        skippedReason: null,
        capturedCount,
        keyCount: extraction.candidates.filter((candidate) => candidate.importance === "key").length,
        generalCount: extraction.candidates.filter((candidate) => candidate.importance === "general").length,
        mergedCount,
        deduplicatedCount,
        compressionTriggered: compactResult.compressionTriggered,
        totalCards: storage.cards.length,
        injectionBudget: MEMORY_INJECTION_BUDGET,
        safeCategories: [...safeCategories].sort()
      };
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
      const compactResult = compactMemoryStorage(storage);
      const enabledCards = storage.enabled
        ? rankCardsForInjection(storage.cards.filter((card) => card.enabled))
        : [];
      const cards = enabledCards
        .slice(0, MEMORY_INJECTION_BUDGET)
        .map(({ id, title, content, tags }) => ({ id, title, content, tags }));

      if (cards.length > 0 || compactResult.changed) {
        const now = Date.now();
        const injectedIds = new Set(cards.map((card) => card.id));
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

function createAutoMemoryCaptureSummary(enabled: boolean, totalCards: number): AutoMemoryCaptureSummary {
  return {
    enabled,
    skippedReason: null,
    capturedCount: 0,
    keyCount: 0,
    generalCount: 0,
    mergedCount: 0,
    deduplicatedCount: 0,
    compressionTriggered: false,
    totalCards,
    injectionBudget: MEMORY_INJECTION_BUDGET,
    safeCategories: []
  };
}

function createMemorySummary(storage: MemoryStorage): MemorySummary {
  const enabledCards = storage.cards.filter((card) => card.enabled);
  const injectableCount = storage.enabled
    ? Math.min(rankCardsForInjection(enabledCards).length, MEMORY_INJECTION_BUDGET)
    : 0;

  return {
    enabled: storage.enabled,
    totalCards: storage.cards.length,
    enabledCards: enabledCards.length,
    disabledCards: storage.cards.length - enabledCards.length,
    injectableCount,
    injectionBudget: MEMORY_INJECTION_BUDGET,
    compressionThreshold: MEMORY_CONTEXT_COMPRESSION_THRESHOLD,
    sourceTypeCounts: countKnownValues(storage.cards, ["manual-chat", "auto-local-heuristic", "auto-local-model"], "sourceType"),
    importanceCounts: countKnownValues(storage.cards, ["key", "general"], "importance"),
    compressionStateCounts: countKnownValues(storage.cards, ["raw", "merged", "deduplicated", "budgeted"], "compressionState"),
    categoryCounts: countStringValues(storage.cards.map((card) => card.category))
  };
}

function countKnownValues<T extends string, K extends keyof MemoryCard>(
  cards: MemoryCard[],
  values: readonly T[],
  key: K
): Record<T, number> {
  const counts = Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;

  for (const card of cards) {
    const value = card[key];
    if (typeof value === "string" && values.includes(value as unknown as T)) {
      counts[value as unknown as T] += 1;
    }
  }

  return counts;
}

function countStringValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function createAutoMemoryCard(
  candidate: AutoMemoryCandidate,
  sourceConversationId: string,
  sourceMessageId: string | null,
  now: number
): MemoryCard {
  return {
    id: crypto.randomUUID(),
    title: candidate.title,
    content: candidate.content,
    tags: candidate.tags,
    sourceConversationId,
    sourceType: "auto-local-heuristic",
    namespace: candidate.namespace,
    key: candidate.key,
    importance: candidate.importance,
    category: candidate.category,
    confidence: candidate.confidence,
    sourceMessageId,
    observedCount: 1,
    lastObservedAt: now,
    compressionState: "raw",
    createdAt: now,
    updatedAt: now,
    enabled: true,
    lastInjectedAt: null,
    injectionCount: 0
  };
}

function extractAutoMemoryCandidates(content: string): { candidates: AutoMemoryCandidate[]; sensitive: boolean } {
  const text = normalizeUserMessageForHeuristics(content);

  if (!text) {
    return { candidates: [], sensitive: false };
  }

  if (containsSensitiveMemoryMaterial(text)) {
    return { candidates: [], sensitive: true };
  }

  const candidates: AutoMemoryCandidate[] = [];
  const addCandidate = (candidate: AutoMemoryCandidate): void => {
    if (!candidates.some((item) => item.namespace === candidate.namespace && item.key === candidate.key)) {
      candidates.push(candidate);
    }
  };

  const preferredName = extractPreferredName(text);
  if (preferredName) {
    addCandidate({
      title: "称呼偏好",
      content: `用户喜欢被称呼为${preferredName}。`,
      tags: ["称呼", "偏好"],
      namespace: "preference",
      key: "addressing:preferred-name",
      importance: "key",
      category: "addressing",
      confidence: 0.95
    });
  }

  const languagePreference = extractLanguagePreference(text);
  if (languagePreference) {
    addCandidate({
      title: "语言偏好",
      content: languagePreference === "english"
        ? "用户偏好使用英文交流。"
        : "用户偏好使用简体中文交流。",
      tags: ["语言", "偏好"],
      namespace: "preference",
      key: "language:reply",
      importance: "key",
      category: "language",
      confidence: 0.94
    });
  }

  if (/(低打扰|少打扰|安静|别频繁打扰|不要频繁打扰)/u.test(text)) {
    addCandidate({
      title: "互动偏好",
      content: "用户偏好低打扰陪伴。",
      tags: ["互动", "低打扰"],
      namespace: "preference",
      key: "interaction:low-interruption",
      importance: "general",
      category: "interaction",
      confidence: 0.88
    });
  }

  if (/(回复|回答|说话).*(短一点|简短|少说|不要太长)|(?:短一点|简短).*(回复|回答|说话)/u.test(text)) {
    addCandidate({
      title: "回复长度偏好",
      content: "用户偏好更简短的回复。",
      tags: ["回复", "偏好"],
      namespace: "preference",
      key: "interaction:short-replies",
      importance: "general",
      category: "interaction",
      confidence: 0.86
    });
  }

  if (/(桌宠|角色|模型).*(右侧|右边|右下|贴边|屏幕边缘)/u.test(text)) {
    addCandidate({
      title: "桌宠位置偏好",
      content: "用户偏好桌宠贴近屏幕右侧或边缘。",
      tags: ["桌宠", "位置"],
      namespace: "preference",
      key: "pet:presentation-position",
      importance: "general",
      category: "pet_presentation",
      confidence: 0.87
    });
  }

  if (/(桌宠|角色|模型).*(大一点|放大|小一点|缩小|尺寸|大小)/u.test(text)) {
    addCandidate({
      title: "桌宠大小偏好",
      content: "用户关注桌宠显示大小体验。",
      tags: ["桌宠", "大小"],
      namespace: "preference",
      key: "pet:presentation-size",
      importance: "general",
      category: "pet_presentation",
      confidence: 0.82
    });
  }

  if (/(本地模型|本地记忆|离线运行|离线可用|隐私边界|隐私优先)/u.test(text)) {
    addCandidate({
      title: "项目本地化偏好",
      content: "用户重视本地化运行和隐私边界。",
      tags: ["本地化", "隐私"],
      namespace: "preference",
      key: "project:local-first",
      importance: "key",
      category: "project_preference",
      confidence: 0.9
    });
  }

  return { candidates, sensitive: false };
}

function normalizeUserMessageForHeuristics(content: string): string {
  return content.trim().replace(/\s+/g, " ").slice(0, 500);
}

function containsSensitiveMemoryMaterial(text: string): boolean {
  return [
    /sk-[A-Za-z0-9_-]{8,}/u,
    /(api[-_\s]?key|密钥|token|password|密码|secret)/iu,
    /\b1[3-9]\d{9}\b/u,
    /\b\d{15}(\d{2}[0-9xX])?\b/u,
    /\b\d{12,19}\b/u,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
    /(身份证|银行卡|住址|家庭住址|医疗|诊断|病历|法律咨询|投资建议|财务状况)/u,
    /(```|完整\s*prompt|系统提示词|请求正文|provider request body)/iu
  ].some((pattern) => pattern.test(text));
}

function extractPreferredName(text: string): string | null {
  const patterns = [
    /(?:以后|之后)?(?:请)?(?:叫我|喊我|称呼我(?:为)?)[：:\s]*(?<value>[\p{Script=Han}A-Za-z0-9_-]{1,16})/u,
    /(?:我的昵称|我的称呼)(?:是|叫)[：:\s]*(?<value>[\p{Script=Han}A-Za-z0-9_-]{1,16})/u
  ];

  for (const pattern of patterns) {
    const value = pattern.exec(text)?.groups?.value;
    const normalized = normalizeShortPreferenceValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeShortPreferenceValue(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/[，。,.!！?？].*$/u, "") ?? "";

  if (
    normalized.length === 0 ||
    normalized.length > 16 ||
    containsSensitiveMemoryMaterial(normalized) ||
    /^(我|你|她|他|它|这个|那个)$/u.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function extractLanguagePreference(text: string): "simplified-chinese" | "english" | null {
  if (/(简体中文|中文|汉语).*(回复|回答|交流|说话)|(?:用|使用)(简体中文|中文|汉语)/u.test(text)) {
    return "simplified-chinese";
  }

  if (/(英文|英语|English).*(回复|回答|交流|说话)|(?:用|使用)(英文|英语|English)/iu.test(text)) {
    return "english";
  }

  return null;
}

function compactMemoryStorage(storage: MemoryStorage): {
  changed: boolean;
  mergedCount: number;
  deduplicatedCount: number;
  compressionTriggered: boolean;
} {
  const mergedCards: MemoryCard[] = [];
  let changed = false;
  let mergedCount = 0;
  let deduplicatedCount = 0;

  for (const card of storage.cards) {
    const existing = mergedCards.find((item) => item.namespace === card.namespace && item.key === card.key);

    if (!existing) {
      mergedCards.push(card);
      continue;
    }

    const result = mergeMemoryCard(existing, card, Date.now());
    mergedCount += result.mergedCount;
    deduplicatedCount += result.deduplicatedCount;
    changed = true;
  }

  if (changed) {
    storage.cards = mergedCards;
  }

  const enabledCards = storage.enabled ? storage.cards.filter((card) => card.enabled) : [];
  const compressionTriggered = enabledCards.length >= MEMORY_CONTEXT_COMPRESSION_THRESHOLD;

  if (compressionTriggered) {
    const prioritizedIds = new Set(rankCardsForInjection(enabledCards).slice(0, MEMORY_INJECTION_BUDGET).map((card) => card.id));
    storage.cards = storage.cards.map((card) => {
      if (!card.enabled || card.compressionState === "merged" || card.compressionState === "deduplicated") {
        return card;
      }

      const nextState: MemoryCompressionState = prioritizedIds.has(card.id) ? "budgeted" : "budgeted";
      if (card.compressionState === nextState) {
        return card;
      }
      changed = true;
      return { ...card, compressionState: nextState };
    });
  }

  return { changed, mergedCount, deduplicatedCount, compressionTriggered };
}

function mergeMemoryCard(target: MemoryCard, incoming: MemoryCard, now: number): { mergedCount: number; deduplicatedCount: number } {
  const sameContent = target.content === incoming.content;
  const incomingIsNewer = incoming.updatedAt >= target.updatedAt;

  if (incomingIsNewer) {
    target.title = incoming.title;
    target.content = incoming.content;
    target.tags = [...new Set([...incoming.tags, ...target.tags])].slice(0, 8);
  } else {
    target.tags = [...new Set([...target.tags, ...incoming.tags])].slice(0, 8);
  }

  target.importance = target.importance === "key" || incoming.importance === "key" ? "key" : "general";
  target.category = incoming.category || target.category;
  target.confidence = Math.max(target.confidence, incoming.confidence);
  target.sourceMessageId = incoming.sourceMessageId ?? target.sourceMessageId;
  target.observedCount += incoming.observedCount;
  target.lastObservedAt = Math.max(target.lastObservedAt, incoming.lastObservedAt);
  target.updatedAt = Math.max(now, target.updatedAt, incoming.updatedAt);
  target.enabled = target.enabled || incoming.enabled;
  target.compressionState = sameContent ? "deduplicated" : "merged";

  return sameContent
    ? { mergedCount: 0, deduplicatedCount: 1 }
    : { mergedCount: 1, deduplicatedCount: 0 };
}

function rankCardsForInjection(cards: MemoryCard[]): MemoryCard[] {
  return [...cards].sort((left, right) => (
    importanceScore(right.importance) - importanceScore(left.importance) ||
    right.confidence - left.confidence ||
    right.observedCount - left.observedCount ||
    right.lastObservedAt - left.lastObservedAt ||
    right.updatedAt - left.updatedAt ||
    left.key.localeCompare(right.key)
  ));
}

function importanceScore(importance: MemoryImportance): number {
  return importance === "key" ? 1 : 0;
}
