export type MemoryCard = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sourceConversationId: string;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
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

export type MemoryInjection = {
  count: number;
  cards: Array<Pick<MemoryCard, "id" | "title" | "content" | "tags">>;
};

export const MEMORY_STORAGE_VERSION = 1;

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
  const storage = value as Partial<MemoryStorage> | null;

  if (!storage || storage.version !== MEMORY_STORAGE_VERSION || typeof storage.enabled !== "boolean" || !Array.isArray(storage.cards)) {
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

  if (
    !card ||
    !isMemoryId(card.id) ||
    !title ||
    !content ||
    !tags ||
    !isMemoryId(card.sourceConversationId) ||
    typeof card.createdAt !== "number" ||
    !Number.isSafeInteger(card.createdAt) ||
    card.createdAt <= 0 ||
    typeof card.updatedAt !== "number" ||
    !Number.isSafeInteger(card.updatedAt) ||
    card.updatedAt < card.createdAt ||
    typeof card.enabled !== "boolean"
  ) {
    return null;
  }

  return {
    id: card.id,
    title,
    content,
    tags,
    sourceConversationId: card.sourceConversationId,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    enabled: card.enabled
  };
}
