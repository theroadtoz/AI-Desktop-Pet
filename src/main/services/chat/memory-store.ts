import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  MEMORY_STORAGE_VERSION,
  containsSensitiveMemoryMaterial,
  isMemoryId,
  parseMemoryCardDraft,
  parseMemoryCardUpdate,
  parseMemoryStorage,
  type MemoryCard,
  type MemoryCardDraft,
  type MemoryCreateResult,
  type MemoryCompressionState,
  type MemoryForgetResult,
  type MemoryImportance,
  type MemoryCardUpdate,
  type MemorySummary,
  type MemoryInjection,
  type MemoryReviewCandidate,
  type MemorySettings,
  type MemorySourceType,
  type MemorySuppression,
  type MemorySuppressionView,
  type MemoryStorage
} from "../../../shared/chat-memory";
import { parseUserProfile } from "../../../shared/user-profile";

export const MEMORY_CONTEXT_COMPRESSION_THRESHOLD = 8;
export const MEMORY_INJECTION_BUDGET = 8;

export type AutoMemoryCaptureInput = {
  conversationId: string;
  messageId: string;
  content: string;
};

export type AutoMemoryCaptureSummary = {
  enabled: boolean;
  skippedReason: "disabled" | "sensitive" | "no_candidate" | "suppressed" | null;
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
  canWrite(): boolean;
  getSettings(): MemorySettings;
  getSummary(): MemorySummary;
  setEnabled(enabled: boolean): MemorySettings;
  listCards(): MemoryCard[];
  getCard(id: string): MemoryCard | null;
  createCard(draft: MemoryCardDraft): MemoryCreateResult;
  captureAutoMemoriesFromLatestUserMessage(input: AutoMemoryCaptureInput): AutoMemoryCaptureSummary;
  confirmReviewedCandidate(candidate: MemoryReviewCandidate): { status: "created" | "disabled" | "blocked" };
  updateCard(id: string, update: MemoryCardUpdate): MemoryCard | null;
  deleteCard(id: string): boolean;
  forgetCard(id: string): MemoryForgetResult;
  clearCards(): void;
  listSuppressions(): MemorySuppressionView[];
  allowSuppression(id: string): boolean;
  clearSuppressions(): void;
  createInjection(): MemoryInjection;
  getMemoryPath(): string;
};

type MemorySourceState = "missing" | "valid-current" | "valid-legacy" | "invalid" | "future-version" | "sensitive";
type MemoryReadOutcome = { storage: MemoryStorage; canWrite: boolean; sourceState: MemorySourceState; profile?: UserProfile };
type UserProfile = ReturnType<typeof parseUserProfile>;
const MEMORY_STORE_ERROR = "Memory storage unavailable";

export function createMemoryStore(options: { userDataPath?: string } = {}): MemoryStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const memoryPath = join(userDataPath, "memory", "facts.json");
  const legacyProfilePath = join(userDataPath, "config", "user-profile.json");
  const suppressionIdsByTuple = new Map<string, string>();
  const suppressionsById = new Map<string, MemorySuppression>();

  function getSuppressionTupleKey(suppression: MemorySuppression): string {
    return JSON.stringify([
      suppression.namespace,
      suppression.key,
      suppression.category,
      suppression.createdAt
    ]);
  }

  function unsafeOutcome(sourceState: Extract<MemorySourceState, "invalid" | "future-version" | "sensitive">): MemoryReadOutcome {
    return { storage: emptyStorage(), canWrite: false, sourceState };
  }

  function containsSensitiveStorageMaterial(storage: MemoryStorage): boolean {
    return storage.cards.some((card) => containsSensitiveMemoryMaterial([
      card.title, card.content, ...card.tags, card.namespace, card.key, card.category
    ].join("\n"))) || storage.suppressions.some((suppression) => containsSensitiveMemoryMaterial([
      suppression.namespace, suppression.key, suppression.category
    ].join("\n")));
  }

  function parseExactLegacyProfile(value: unknown): NonNullable<UserProfile> | null {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
      return null;
    }
    const profile = value as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(profile).sort();
    const expected = names.length === 2
      ? ["completedAt", "displayName"]
      : names.length === 3
        ? ["completedAt", "displayName", "preferredName"]
        : [];
    if (names.length !== expected.length || names.some((key, index) => key !== expected[index])) return null;
    if (!names.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(profile, key);
      return Boolean(descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor);
    })) return null;
    const parsed = parseUserProfile(profile);
    if (!parsed || parsed.displayName !== profile.displayName || parsed.preferredName !== profile.preferredName ||
        typeof profile.completedAt !== "string") return null;
    return parsed;
  }

  function getSafeOwnVersion(value: unknown): number | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "version");
    return descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor && typeof descriptor.value === "number"
      ? descriptor.value
      : undefined;
  }

  function inspectStorage(): MemoryReadOutcome {
    if (!existsSync(memoryPath)) {
      return inspectLegacyProfile(emptyStorage(), "missing");
    }
    try {
      const rawStorage = JSON.parse(readFileSync(memoryPath, "utf8"));
      const declaredVersion = getSafeOwnVersion(rawStorage);
      const storage = parseMemoryStorage(rawStorage);
      if (!storage) return unsafeOutcome(declaredVersion !== undefined && declaredVersion > MEMORY_STORAGE_VERSION ? "future-version" : "invalid");
      if (containsSensitiveStorageMaterial(storage)) return unsafeOutcome("sensitive");
      return inspectLegacyProfile(storage, rawStorage.version === MEMORY_STORAGE_VERSION ? "valid-current" : "valid-legacy");
    } catch {
      return unsafeOutcome("invalid");
    }
  }

  function readStorage(): MemoryReadOutcome {
    const outcome = inspectStorage();
    if (!outcome.canWrite) return outcome;
    try {
      const projection = outcome.profile ? projectLegacyUserProfile(outcome.storage, outcome.profile) : { storage: outcome.storage, changed: false };
      if (outcome.sourceState === "valid-legacy" || projection.changed) writeStorage(projection.storage);
      return outcome.profile
        ? finalizeLegacyProfile({ ...outcome, storage: projection.storage, sourceState: "valid-current" })
        : { ...outcome, storage: projection.storage, sourceState: outcome.sourceState === "valid-legacy" ? "valid-current" : outcome.sourceState };
    } catch {
      throw new Error(MEMORY_STORE_ERROR);
    }
  }

  function writeStorage(storage: MemoryStorage): void {
    const temporaryPath = `${memoryPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      mkdirSync(dirname(memoryPath), { recursive: true });
      writeFileSync(temporaryPath, `${JSON.stringify(storage, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, memoryPath);
    } catch {
      throw new Error(MEMORY_STORE_ERROR);
    } finally {
      if (existsSync(temporaryPath)) {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // The generic mutation error remains authoritative; no retry is attempted.
        }
      }
    }
  }

  function inspectLegacyProfile(storage: MemoryStorage, sourceState: MemorySourceState): MemoryReadOutcome {
    if (!existsSync(legacyProfilePath)) return { storage, canWrite: true, sourceState };
    try {
      const rawProfile = JSON.parse(readFileSync(legacyProfilePath, "utf8"));
      const profile = parseExactLegacyProfile(rawProfile);
      if (!profile) return unsafeOutcome("invalid");
      if (containsSensitiveMemoryMaterial(`${profile.displayName}\n${profile.preferredName ?? ""}`)) return unsafeOutcome("sensitive");
      return { storage, canWrite: true, sourceState, profile };
    } catch {
      return unsafeOutcome("invalid");
    }
  }

  function projectLegacyUserProfile(storage: MemoryStorage, profile: NonNullable<UserProfile>): { storage: MemoryStorage; changed: boolean } {
    if (!storage.cards.some((card) => card.namespace === "personal" && card.key === "preferred-name")) {
      const preferredName = profile.preferredName ?? profile.displayName;
      const now = Date.now();
      return { changed: true, storage: { ...storage, cards: [...storage.cards, {
          id: crypto.randomUUID(),
          title: "用户称呼",
          content: `用户希望被称为${preferredName}。`,
          tags: [],
          sourceConversationId: crypto.randomUUID(),
          sourceType: "auto-local-heuristic",
          namespace: "personal",
          key: "preferred-name",
          importance: "key",
          category: "addressing",
          confidence: 1,
          sourceMessageId: null,
          observedCount: 1,
          lastObservedAt: now,
          compressionState: "raw",
          createdAt: now,
          updatedAt: now,
          enabled: true,
          managedByUser: false,
          lastInjectedAt: null,
          injectionCount: 0
      }] } };
    }
    return { storage, changed: false };
  }

  function finalizeLegacyProfile(outcome: MemoryReadOutcome): MemoryReadOutcome {
    try {
      unlinkSync(legacyProfilePath);
    } catch {
      return { ...outcome, canWrite: true, sourceState: "valid-current" };
    }
    const { profile: _profile, ...rest } = outcome;
    return { ...rest, canWrite: true, sourceState: "valid-current" };
  }

  function requireWritableStorage(): MemoryStorage {
    const outcome = readStorage();
    if (!outcome.canWrite) throw new Error(MEMORY_STORE_ERROR);
    return outcome.storage;
  }

  return {
    canWrite() {
      return inspectStorage().canWrite;
    },
    getSettings() {
      return { enabled: readStorage().storage.enabled };
    },
    getSummary() {
      return createMemorySummary(readStorage().storage);
    },
    setEnabled(enabled) {
      const storage = requireWritableStorage();
      storage.enabled = enabled;
      writeStorage(storage);
      return { enabled };
    },
    listCards() {
      return readStorage().storage.cards.sort((left, right) => right.updatedAt - left.updatedAt);
    },
    getCard(id) {
      const outcome = readStorage();
      if (!isMemoryId(id)) {
        return null;
      }

      return outcome.storage.cards.find((card) => card.id === id) ?? null;
    },
    createCard(draft) {
      const storage = requireWritableStorage();
      const parsedDraft = parseMemoryCardDraft(draft);

      if (!parsedDraft) {
        throw new Error("Invalid memory draft");
      }
      if (containsSensitiveMemoryMaterial([parsedDraft.title, parsedDraft.content, ...parsedDraft.tags].join("\n"))) {
        throw new Error("Invalid memory draft");
      }

      if (!storage.enabled) {
        return { status: "disabled" };
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
        managedByUser: true,
        lastInjectedAt: null,
        injectionCount: 0
      };
      storage.cards.push(card);
      writeStorage(storage);
      return { status: "created", card };
    },
    captureAutoMemoriesFromLatestUserMessage(input) {
      const storage = readStorage().storage;
      const baseSummary = createAutoMemoryCaptureSummary(storage.enabled, storage.cards.length);

      if (!storage.enabled) {
        return { ...baseSummary, skippedReason: "disabled" };
      }

      if (containsSensitiveMemoryMaterial(input.content)) {
        return { ...baseSummary, skippedReason: "sensitive" };
      }
      return { ...baseSummary, skippedReason: "no_candidate" };
    },
    confirmReviewedCandidate(candidate) {
      const storage = requireWritableStorage();
      if (!storage.enabled) return { status: "disabled" };
      const existingCard = storage.cards.find(
        (card) => card.namespace === candidate.namespace && card.key === candidate.key
      ) ?? (
        candidate.category === "addressing"
          ? storage.cards.find(
              (card) => card.namespace === candidate.namespace &&
                card.category === "addressing" &&
                !card.managedByUser
            )
          : undefined
      );
      if (
        candidate.status !== "pending-review" ||
        candidate.action !== "create" ||
        containsSensitiveMemoryMaterial([
          candidate.title, candidate.content, ...candidate.tags, candidate.namespace, candidate.key, candidate.category
        ].join("\n")) ||
        isSuppressed(storage, candidate) ||
        (existingCard && (
          candidate.category !== "addressing" ||
          existingCard.category !== "addressing" ||
          existingCard.managedByUser
        ))
      ) {
        return { status: "blocked" };
      }

      const now = Date.now();
      if (existingCard) {
        Object.assign(existingCard, {
          title: candidate.title,
          content: candidate.content,
          tags: candidate.tags,
          confidence: candidate.confidence,
          sourceConversationId: candidate.sourceConversationId,
          sourceMessageId: candidate.sourceMessageId,
          observedCount: existingCard.observedCount + 1,
          lastObservedAt: now,
          compressionState: "merged" as const,
          updatedAt: now,
          enabled: true
        });
        writeStorage(storage);
        return { status: "created" };
      }

      storage.cards.push({
        id: crypto.randomUUID(),
        title: candidate.title,
        content: candidate.content,
        tags: candidate.tags,
        sourceConversationId: candidate.sourceConversationId,
        sourceType: "auto-local-model",
        namespace: candidate.namespace,
        key: candidate.key,
        importance: candidate.importance,
        category: candidate.category,
        confidence: candidate.confidence,
        sourceMessageId: candidate.sourceMessageId,
        observedCount: 1,
        lastObservedAt: now,
        compressionState: "raw",
        createdAt: now,
        updatedAt: now,
        enabled: true,
        managedByUser: candidate.category !== "addressing",
        lastInjectedAt: null,
        injectionCount: 0
      });
      writeStorage(storage);
      return { status: "created" };
    },
    updateCard(id, update) {
      const storage = requireWritableStorage();
      if (!isMemoryId(id)) {
        return null;
      }

      const parsedUpdate = parseMemoryCardUpdate(update);

      if (!parsedUpdate) {
        return null;
      }

      const card = storage.cards.find((storedCard) => storedCard.id === id);

      if (!card) {
        return null;
      }
      if (containsSensitiveMemoryMaterial([
        parsedUpdate.title ?? card.title,
        parsedUpdate.content ?? card.content,
        ...(parsedUpdate.tags ?? card.tags)
      ].join("\n"))) {
        return null;
      }

      Object.assign(card, parsedUpdate, { managedByUser: true, updatedAt: Date.now() });
      writeStorage(storage);
      return card;
    },
    deleteCard(id) {
      const storage = requireWritableStorage();
      if (!isMemoryId(id)) {
        return false;
      }

      const nextCards = storage.cards.filter((card) => card.id !== id);

      if (nextCards.length === storage.cards.length) {
        return false;
      }

      storage.cards = nextCards;
      writeStorage(storage);
      return true;
    },
    forgetCard(id) {
      const storage = requireWritableStorage();
      if (!isMemoryId(id)) {
        return { status: "not_found" };
      }

      const card = storage.cards.find((storedCard) => storedCard.id === id);

      if (!card) {
        return { status: "not_found" };
      }

      if (card.sourceType === "manual-chat") {
        return { status: "manual" };
      }

      const suppression: MemorySuppression = {
        namespace: card.namespace,
        key: card.key,
        category: card.category,
        createdAt: Date.now()
      };
      storage.cards = storage.cards.filter((storedCard) => storedCard.id !== id);
      storage.suppressions = storage.suppressions.filter((item) => !(item.namespace === suppression.namespace && item.key === suppression.key));
      storage.suppressions.push(suppression);
      writeStorage(storage);
      return { status: "forgotten" };
    },
    clearCards() {
      const storage = requireWritableStorage();
      storage.cards = [];
      writeStorage(storage);
    },
    listSuppressions() {
      const suppressions = [...readStorage().storage.suppressions].sort((left, right) => right.createdAt - left.createdAt);
      const activeTupleKeys = new Set(suppressions.map(getSuppressionTupleKey));

      for (const [tupleKey, id] of suppressionIdsByTuple) {
        if (!activeTupleKeys.has(tupleKey)) {
          suppressionIdsByTuple.delete(tupleKey);
          suppressionsById.delete(id);
        }
      }

      return suppressions.map((suppression) => {
        const tupleKey = getSuppressionTupleKey(suppression);
        const id = suppressionIdsByTuple.get(tupleKey) ?? crypto.randomUUID();
        suppressionIdsByTuple.set(tupleKey, id);
        suppressionsById.set(id, suppression);
        return {
          id,
          category: suppression.category,
          createdAt: suppression.createdAt
        };
      });
    },
    allowSuppression(id) {
      const storage = requireWritableStorage();
      const parsedSuppression = isMemoryId(id) ? suppressionsById.get(id) : undefined;

      if (!parsedSuppression) {
        return false;
      }

      const nextSuppressions = storage.suppressions.filter((item) => !(
        item.namespace === parsedSuppression.namespace &&
        item.key === parsedSuppression.key &&
        item.category === parsedSuppression.category &&
        item.createdAt === parsedSuppression.createdAt
      ));

      if (nextSuppressions.length === storage.suppressions.length) {
        return false;
      }

      storage.suppressions = nextSuppressions;
      writeStorage(storage);
      suppressionIdsByTuple.delete(getSuppressionTupleKey(parsedSuppression));
      suppressionsById.delete(id);
      return true;
    },
    clearSuppressions() {
      const storage = requireWritableStorage();
      storage.suppressions = [];
      writeStorage(storage);
      suppressionIdsByTuple.clear();
      suppressionsById.clear();
    },
    createInjection() {
      const outcome = readStorage();
      if (!outcome.canWrite) return { count: 0, cards: [] };
      const storage = outcome.storage;
      const compactResult = compactMemoryStorage(storage);
      const enabledCards = storage.enabled
        ? rankCardsForInjection(storage.cards.filter((card) => card.enabled))
        : [];
      const cards = enabledCards
        .slice(0, MEMORY_INJECTION_BUDGET)
        .map(({ id, title, content, tags, importance, sourceType, managedByUser }) => ({
          id,
          title,
          content,
          tags,
          importance,
          sourceType,
          managedByUser
        }));

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
    cards: [],
    suppressions: []
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

function isSuppressed(storage: MemoryStorage, candidate: Pick<MemoryReviewCandidate, "namespace" | "key">): boolean {
  return storage.suppressions.some((suppression) => (
    suppression.namespace === candidate.namespace && suppression.key === candidate.key
  ));
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

  if (target.managedByUser) {
    target.observedCount += incoming.observedCount;
    target.lastObservedAt = Math.max(target.lastObservedAt, incoming.lastObservedAt);

    return sameContent
      ? { mergedCount: 0, deduplicatedCount: 1 }
      : { mergedCount: 1, deduplicatedCount: 0 };
  }

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
