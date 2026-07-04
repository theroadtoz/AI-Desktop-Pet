export type MemoryImportance = "key" | "general";
export type MemorySourceType = "manual-chat" | "auto-local-heuristic" | "auto-local-model";
export type MemoryCompressionState = "raw" | "merged" | "deduplicated" | "budgeted";

export type MemoryCard = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sourceConversationId: string;
  sourceType: MemorySourceType;
  namespace: string;
  key: string;
  importance: MemoryImportance;
  category: string;
  confidence: number;
  sourceMessageId: string | null;
  observedCount: number;
  lastObservedAt: number;
  compressionState: MemoryCompressionState;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  lastInjectedAt: number | null;
  injectionCount: number;
};

export type MemoryCardDraft = {
  title: string;
  content: string;
  tags: string[];
  sourceConversationId: string;
};

export type MemoryCardUpdate = Partial<Pick<MemoryCard, "title" | "content" | "tags" | "enabled">>;

export type MemorySettings = {
  enabled: boolean;
};

export type MemorySummary = {
  enabled: boolean;
  totalCards: number;
  enabledCards: number;
  disabledCards: number;
  injectableCount: number;
  injectionBudget: number;
  compressionThreshold: number;
  sourceTypeCounts: Record<MemorySourceType, number>;
  importanceCounts: Record<MemoryImportance, number>;
  compressionStateCounts: Record<MemoryCompressionState, number>;
  categoryCounts: Record<string, number>;
};

export type MemoryInjection = {
  count: number;
  cards: Array<Pick<MemoryCard, "id" | "title" | "content" | "tags">>;
};

export const MEMORY_STORAGE_VERSION = 3;

export type MemoryStorage = {
  version: typeof MEMORY_STORAGE_VERSION;
  enabled: boolean;
  cards: MemoryCard[];
};

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 80;
const MAX_CONTENT_LENGTH = 800;
const MAX_TAG_LENGTH = 24;
const MAX_TAGS = 8;
const MAX_NAMESPACE_LENGTH = 32;
const MAX_KEY_LENGTH = 48;
const MAX_CATEGORY_LENGTH = 32;
const DEFAULT_MEMORY_NAMESPACE = "personal";
const DEFAULT_MEMORY_SOURCE_TYPE = "manual-chat";
const DEFAULT_MEMORY_IMPORTANCE: MemoryImportance = "key";
const DEFAULT_MEMORY_CATEGORY = "manual";
const DEFAULT_MEMORY_CONFIDENCE = 1;
const DEFAULT_MEMORY_OBSERVED_COUNT = 1;
const DEFAULT_MEMORY_COMPRESSION_STATE: MemoryCompressionState = "raw";

const memorySourceTypes = ["manual-chat", "auto-local-heuristic", "auto-local-model"] as const;
const memoryImportanceValues = ["key", "general"] as const;
const memoryCompressionStates = ["raw", "merged", "deduplicated", "budgeted"] as const;

export function isMemoryId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function normalizeMemoryText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

export function normalizeMemoryTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const tags: string[] = [];

  for (const item of value) {
    const tag = normalizeMemoryText(item, MAX_TAG_LENGTH);

    if (!tag || tags.includes(tag)) {
      continue;
    }

    tags.push(tag);

    if (tags.length >= MAX_TAGS) {
      break;
    }
  }

  return tags;
}

function normalizeMemoryNamespace(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, MAX_NAMESPACE_LENGTH);

  return normalized && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function normalizeMemoryKey(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, MAX_KEY_LENGTH);

  return normalized && /^[a-z0-9][a-z0-9:_-]{0,47}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function normalizeMemoryCategory(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, MAX_CATEGORY_LENGTH);

  return normalized && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function parseMemorySourceType(value: unknown): MemorySourceType | null {
  return memorySourceTypes.includes(value as MemorySourceType) ? value as MemorySourceType : null;
}

function parseMemoryImportance(value: unknown): MemoryImportance | null {
  return memoryImportanceValues.includes(value as MemoryImportance) ? value as MemoryImportance : null;
}

function parseMemoryCompressionState(value: unknown): MemoryCompressionState | null {
  return memoryCompressionStates.includes(value as MemoryCompressionState) ? value as MemoryCompressionState : null;
}

function parseMemoryConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function createDefaultMemoryKey(id: string): string {
  return `manual-${id.slice(0, 8).toLowerCase()}`;
}

export function parseMemoryCardDraft(value: unknown): MemoryCardDraft | null {
  const draft = value as Partial<MemoryCardDraft> | null;
  const title = normalizeMemoryText(draft?.title, MAX_TITLE_LENGTH);
  const content = normalizeMemoryText(draft?.content, MAX_CONTENT_LENGTH);
  const tags = normalizeMemoryTags(draft?.tags);

  if (!draft || !title || !content || !tags || !isMemoryId(draft.sourceConversationId)) {
    return null;
  }

  return {
    title,
    content,
    tags,
    sourceConversationId: draft.sourceConversationId
  };
}

export function parseMemoryCardUpdate(value: unknown): MemoryCardUpdate | null {
  const update = value as Partial<MemoryCardUpdate> | null;

  if (!update || typeof update !== "object") {
    return null;
  }

  const parsed: MemoryCardUpdate = {};

  if ("title" in update) {
    const title = normalizeMemoryText(update.title, MAX_TITLE_LENGTH);

    if (!title) {
      return null;
    }

    parsed.title = title;
  }

  if ("content" in update) {
    const content = normalizeMemoryText(update.content, MAX_CONTENT_LENGTH);

    if (!content) {
      return null;
    }

    parsed.content = content;
  }

  if ("tags" in update) {
    const tags = normalizeMemoryTags(update.tags);

    if (!tags) {
      return null;
    }

    parsed.tags = tags;
  }

  if ("enabled" in update) {
    if (typeof update.enabled !== "boolean") {
      return null;
    }

    parsed.enabled = update.enabled;
  }

  return parsed;
}

export function parseMemoryStorage(value: unknown): MemoryStorage | null {
  const storage = value as (Partial<Omit<MemoryStorage, "version">> & { version?: unknown }) | null;

  if (
    !storage ||
    (storage.version !== 1 && storage.version !== 2 && storage.version !== MEMORY_STORAGE_VERSION) ||
    typeof storage.enabled !== "boolean" ||
    !Array.isArray(storage.cards)
  ) {
    return null;
  }

  const cards = storage.cards.map(parseMemoryCard);

  if (cards.some((card) => card === null)) {
    return null;
  }

  return {
    version: MEMORY_STORAGE_VERSION,
    enabled: storage.enabled,
    cards: cards as MemoryCard[]
  };
}

export function parseMemoryCard(value: unknown): MemoryCard | null {
  const card = value as Partial<MemoryCard> | null;
  const title = normalizeMemoryText(card?.title, MAX_TITLE_LENGTH);
  const content = normalizeMemoryText(card?.content, MAX_CONTENT_LENGTH);
  const tags = normalizeMemoryTags(card?.tags);
  const namespace = normalizeMemoryNamespace(card?.namespace) ?? DEFAULT_MEMORY_NAMESPACE;
  const sourceType = parseMemorySourceType(card?.sourceType) ?? (
    card?.sourceType === undefined ? DEFAULT_MEMORY_SOURCE_TYPE : null
  );
  const key = isMemoryId(card?.id)
    ? normalizeMemoryKey(card?.key) ?? createDefaultMemoryKey(card.id)
    : null;
  const importance = parseMemoryImportance(card?.importance) ?? DEFAULT_MEMORY_IMPORTANCE;
  const category = normalizeMemoryCategory(card?.category) ?? DEFAULT_MEMORY_CATEGORY;
  const confidence = card?.confidence === undefined
    ? DEFAULT_MEMORY_CONFIDENCE
    : parseMemoryConfidence(card.confidence);
  const sourceMessageId = card?.sourceMessageId === undefined
    ? null
    : card.sourceMessageId;
  const observedCount = card?.observedCount === undefined
    ? DEFAULT_MEMORY_OBSERVED_COUNT
    : card.observedCount;
  const lastObservedAt = card?.lastObservedAt === undefined
    ? card?.updatedAt
    : card.lastObservedAt;
  const parsedObservedCount = parsePositiveInteger(observedCount);
  const parsedLastObservedAt = parsePositiveInteger(lastObservedAt);
  const compressionState = parseMemoryCompressionState(card?.compressionState) ?? DEFAULT_MEMORY_COMPRESSION_STATE;
  const lastInjectedAt = card?.lastInjectedAt === undefined
    ? null
    : card.lastInjectedAt;
  const injectionCount = card?.injectionCount === undefined
    ? 0
    : card.injectionCount;

  if (
    !card ||
    !isMemoryId(card.id) ||
    !title ||
    !content ||
    !tags ||
    !sourceType ||
    !namespace ||
    !key ||
    !importance ||
    !category ||
    confidence === null ||
    !(sourceMessageId === null || isMemoryId(sourceMessageId)) ||
    !isMemoryId(card.sourceConversationId) ||
    typeof card.createdAt !== "number" ||
    !Number.isSafeInteger(card.createdAt) ||
    card.createdAt <= 0 ||
    typeof card.updatedAt !== "number" ||
    !Number.isSafeInteger(card.updatedAt) ||
    card.updatedAt < card.createdAt ||
    parsedObservedCount === null ||
    parsedLastObservedAt === null ||
    parsedLastObservedAt < card.createdAt ||
    typeof card.enabled !== "boolean" ||
    !(
      lastInjectedAt === null ||
      (
        typeof lastInjectedAt === "number" &&
        Number.isSafeInteger(lastInjectedAt) &&
        lastInjectedAt > 0
      )
    ) ||
    typeof injectionCount !== "number" ||
    !Number.isSafeInteger(injectionCount) ||
    injectionCount < 0
  ) {
    return null;
  }

  return {
    id: card.id,
    title,
    content,
    tags,
    sourceConversationId: card.sourceConversationId,
    sourceType,
    namespace,
    key,
    importance,
    category,
    confidence,
    sourceMessageId,
    observedCount: parsedObservedCount,
    lastObservedAt: parsedLastObservedAt,
    compressionState,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    enabled: card.enabled,
    lastInjectedAt,
    injectionCount
  };
}
