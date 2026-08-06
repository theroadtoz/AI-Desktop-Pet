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
  managedByUser: boolean;
  lastInjectedAt: number | null;
  injectionCount: number;
};

export type MemoryCardDraft = {
  title: string;
  content: string;
  tags: string[];
  sourceConversationId: string;
};

export type MemoryCardUpdate = Partial<Pick<MemoryCard, "title" | "content" | "tags" | "importance" | "enabled">>;

export type MemoryCreateResult =
  | { status: "created"; card: MemoryCard }
  | { status: "disabled" };

export type MemorySuppression = {
  namespace: string;
  key: string;
  category: string;
  createdAt: number;
};

export type MemorySuppressionView = {
  id: string;
  category: string;
  createdAt: number;
};

export type MemoryForgetResult =
  | { status: "forgotten" }
  | { status: "manual" | "not_found" };

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
  cards: Array<Pick<MemoryCard, "id" | "title" | "content" | "tags" | "importance" | "sourceType" | "managedByUser">>;
};

export type MemoryReviewAction = "create" | "update-suggestion" | "revoke-suggestion" | "ignore";
export type MemoryReviewStatus = "pending-review" | "confirmed" | "rejected" | "blocked";

export type MemoryReviewCandidateDraft = {
  action: MemoryReviewAction;
  title: string;
  content: string;
  tags: string[];
  namespace: string;
  key: string;
  importance: MemoryImportance;
  category: string;
  confidence: number;
  sourceConversationId: string;
  sourceMessageId: string;
};

export type MemoryReviewCandidate = MemoryReviewCandidateDraft & {
  id: string;
  status: MemoryReviewStatus;
  createdAt: number;
  updatedAt: number;
};

export type MemoryReviewDecisionDraft = Partial<Pick<MemoryReviewCandidateDraft, "title" | "content" | "tags" | "importance">>;

export type MemoryReviewDecisionResult = {
  status: "confirmed" | "rejected" | "blocked" | "disabled" | "not_found";
};

export const MEMORY_STORAGE_VERSION = 4;

export type MemoryStorage = {
  version: typeof MEMORY_STORAGE_VERSION;
  enabled: boolean;
  cards: MemoryCard[];
  suppressions: MemorySuppression[];
};

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_TITLE_LENGTH = 80;
export const MAX_CONTENT_LENGTH = 800;
export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS = 8;
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

export const memorySourceTypes = ["manual-chat", "auto-local-heuristic", "auto-local-model"] as const;
export const memoryImportanceValues = ["key", "general"] as const;
export const memoryCompressionStates = ["raw", "merged", "deduplicated", "budgeted"] as const;

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

export function containsSensitiveMemoryMaterial(value: string): boolean {
  return [
    /sk-[A-Za-z0-9_-]{8,}/u,
    /(api[-_\s]?key|密钥|token|password|密码|secret)/iu,
    /\b(?:\d[ -]*?){13,19}\b/u,
    /\b1[3-9]\d{9}\b/u,
    /\b\d{15}(?:\d{2}[0-9xX])?\b/u,
    /(?:身份证|银行卡|手机号|住址|详细地址|家庭住址|医疗|诊断|病历|法律咨询|投资建议|财务状况)/u,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu,
    /(```|完整\s*prompt|系统提示词|请求正文|provider request body)/iu
  ].some((pattern) => pattern.test(value));
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

export function normalizeMemoryNamespace(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, MAX_NAMESPACE_LENGTH);

  return normalized && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

export function normalizeMemoryKey(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, MAX_KEY_LENGTH);

  return normalized && /^[a-z0-9][a-z0-9:_-]{0,47}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

export function normalizeMemoryCategory(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, MAX_CATEGORY_LENGTH);

  return normalized && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

export function parseMemorySourceType(value: unknown): MemorySourceType | null {
  return memorySourceTypes.includes(value as MemorySourceType) ? value as MemorySourceType : null;
}

export function parseMemoryImportance(value: unknown): MemoryImportance | null {
  return memoryImportanceValues.includes(value as MemoryImportance) ? value as MemoryImportance : null;
}

export function parseMemoryCompressionState(value: unknown): MemoryCompressionState | null {
  return memoryCompressionStates.includes(value as MemoryCompressionState) ? value as MemoryCompressionState : null;
}

export function parseMemoryConfidence(value: unknown): number | null {
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

  if ("importance" in update) {
    const importance = parseMemoryImportance(update.importance);

    if (!importance) {
      return null;
    }

    parsed.importance = importance;
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

export function parseMemoryReviewCandidateDraft(value: unknown): MemoryReviewCandidateDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<MemoryReviewCandidateDraft>;
  const keys = Object.keys(candidate).sort();
  const title = normalizeMemoryText(candidate.title, MAX_TITLE_LENGTH);
  const content = normalizeMemoryText(candidate.content, MAX_CONTENT_LENGTH);
  const tags = normalizeMemoryTags(candidate.tags);
  const namespace = normalizeMemoryNamespace(candidate.namespace);
  const key = normalizeMemoryKey(candidate.key);
  const importance = parseMemoryImportance(candidate.importance);
  const category = normalizeMemoryCategory(candidate.category);
  const confidence = parseMemoryConfidence(candidate.confidence);
  const action = candidate.action === "create" ||
    candidate.action === "update-suggestion" ||
    candidate.action === "revoke-suggestion" ||
    candidate.action === "ignore"
    ? candidate.action
    : null;

  if (
    keys.join(",") !== "action,category,confidence,content,importance,key,namespace,sourceConversationId,sourceMessageId,tags,title" ||
    !action ||
    !title ||
    !content ||
    !tags ||
    !namespace ||
    !key ||
    !importance ||
    !category ||
    confidence === null ||
    confidence < 0.7 ||
    !isMemoryId(candidate.sourceConversationId) ||
    !isMemoryId(candidate.sourceMessageId)
  ) {
    return null;
  }

  return {
    action,
    title,
    content,
    tags,
    namespace,
    key,
    importance,
    category,
    confidence,
    sourceConversationId: candidate.sourceConversationId,
    sourceMessageId: candidate.sourceMessageId
  };
}

export function parseMemoryReviewDecisionDraft(value: unknown): MemoryReviewDecisionDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const update = value as MemoryReviewDecisionDraft;
  const parsed: MemoryReviewDecisionDraft = {};

  if ("title" in update) {
    const title = normalizeMemoryText(update.title, MAX_TITLE_LENGTH);
    if (!title) return null;
    parsed.title = title;
  }
  if ("content" in update) {
    const content = normalizeMemoryText(update.content, MAX_CONTENT_LENGTH);
    if (!content) return null;
    parsed.content = content;
  }
  if ("tags" in update) {
    const tags = normalizeMemoryTags(update.tags);
    if (!tags) return null;
    parsed.tags = tags;
  }
  if ("importance" in update) {
    const importance = parseMemoryImportance(update.importance);
    if (!importance) return null;
    parsed.importance = importance;
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

export function parseMemoryStorage(value: unknown): MemoryStorage | null {
  if (!isPlainObject(value)) return null;
  if (!hasOnlyOwnDataDescriptors(value)) return null;

  const storage = value as Record<string, unknown>;
  const version = storage.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== MEMORY_STORAGE_VERSION) return null;
  const rootKeys = version === MEMORY_STORAGE_VERSION
    ? ["version", "enabled", "cards", "suppressions"]
    : ["version", "enabled", "cards"];
  if (!hasExactDataKeys(storage, rootKeys) || typeof storage.enabled !== "boolean" || !isDenseArray(storage.cards)) return null;

  const cards = storage.cards.map((card) => parseDiskMemoryCard(card, version));
  if (cards.some((card) => card === null) || hasDuplicate(cards as MemoryCard[], (card) => card.id)) return null;

  const suppressions = version === MEMORY_STORAGE_VERSION
    ? parseDiskSuppressions(storage.suppressions)
    : [];
  if (!suppressions) return null;

  return { version: MEMORY_STORAGE_VERSION, enabled: storage.enabled, cards: cards as MemoryCard[], suppressions };
}

function parseDiskMemoryCard(value: unknown, version: 1 | 2 | 3 | typeof MEMORY_STORAGE_VERSION): MemoryCard | null {
  if (!isPlainObject(value)) return null;
  const card = value as Record<string, unknown>;
  const v1Keys = ["id", "title", "content", "tags", "sourceConversationId", "createdAt", "updatedAt", "enabled"];
  const v2Keys = [...v1Keys, "sourceType", "namespace", "key", "lastInjectedAt", "injectionCount"];
  const v4Keys = [
    "id", "title", "content", "tags", "sourceConversationId", "sourceType", "namespace", "key", "importance", "category",
    "confidence", "sourceMessageId", "observedCount", "lastObservedAt", "compressionState", "createdAt", "updatedAt", "enabled",
    "managedByUser", "lastInjectedAt", "injectionCount"
  ];
  const expected = version === 1 ? v1Keys : version === 2 ? v2Keys : version === 3 ? v4Keys.filter((key) => key !== "managedByUser") : v4Keys;
  if (!hasExactDataKeys(card, expected)) return null;

  const title = canonicalMemoryText(card.title, MAX_TITLE_LENGTH);
  const content = canonicalMemoryText(card.content, MAX_CONTENT_LENGTH);
  const tags = canonicalMemoryTags(card.tags);
  if (!isMemoryId(card.id) || !title || !content || !tags || !isMemoryId(card.sourceConversationId) ||
      !isPositiveTimestamp(card.createdAt) || !isPositiveTimestamp(card.updatedAt) || card.updatedAt < card.createdAt ||
      typeof card.enabled !== "boolean") return null;

  const createdAt = card.createdAt;
  const updatedAt = card.updatedAt;
  const sourceType = version === 1 ? DEFAULT_MEMORY_SOURCE_TYPE : parseMemorySourceType(card.sourceType);
  const namespace = version === 1 ? DEFAULT_MEMORY_NAMESPACE : canonicalMemoryNamespace(card.namespace);
  const key = version === 1 ? createDefaultMemoryKey(card.id) : canonicalMemoryKey(card.key);
  const lastInjectedAt = version <= 1 ? null : parseDiskNullableTimestamp(card.lastInjectedAt);
  const injectionCount = version <= 1 ? 0 : card.injectionCount;
  if (!sourceType || !namespace || !key || lastInjectedAt === undefined ||
      !isNonnegativeSafeInteger(injectionCount) ||
      (version === 2 && sourceType !== "manual-chat")) return null;

  const importance = version <= 2 ? DEFAULT_MEMORY_IMPORTANCE : parseMemoryImportance(card.importance);
  const category = version <= 2 ? DEFAULT_MEMORY_CATEGORY : canonicalMemoryCategory(card.category);
  const confidence = version <= 2 ? DEFAULT_MEMORY_CONFIDENCE : canonicalMemoryConfidence(card.confidence);
  const sourceMessageId = version <= 2 ? null : card.sourceMessageId;
  const observedCount = version <= 2 ? DEFAULT_MEMORY_OBSERVED_COUNT : card.observedCount;
  const lastObservedAt = version <= 2 ? updatedAt : card.lastObservedAt;
  const compressionState = version <= 2 ? DEFAULT_MEMORY_COMPRESSION_STATE : parseMemoryCompressionState(card.compressionState);
  const managedByUser = version === MEMORY_STORAGE_VERSION ? card.managedByUser : sourceType === "manual-chat";
  if (!importance || !category || confidence === null || sourceMessageId !== null && !isMemoryId(sourceMessageId) ||
      !isPositiveTimestamp(observedCount) || !isPositiveTimestamp(lastObservedAt) || lastObservedAt < card.createdAt ||
      !compressionState || typeof managedByUser !== "boolean") return null;

  return {
    id: card.id, title, content, tags, sourceConversationId: card.sourceConversationId, sourceType, namespace, key,
    importance, category, confidence, sourceMessageId, observedCount: observedCount as number, lastObservedAt: lastObservedAt as number, compressionState,
    createdAt, updatedAt, enabled: card.enabled, managedByUser, lastInjectedAt,
    injectionCount: injectionCount as number
  };
}

function parseDiskSuppressions(value: unknown): MemorySuppression[] | null {
  if (!isDenseArray(value)) return null;
  const suppressions = value.map((item) => {
    if (!isPlainObject(item) || !hasExactDataKeys(item, ["namespace", "key", "category", "createdAt"])) return null;
    const raw = item as Record<string, unknown>;
    const namespace = canonicalMemoryNamespace(raw.namespace);
    const key = canonicalMemoryKey(raw.key);
    const category = canonicalMemoryCategory(raw.category);
    return namespace && key && category && isPositiveTimestamp(raw.createdAt)
      ? { namespace, key, category, createdAt: raw.createdAt }
      : null;
  });
  return suppressions.some((item) => item === null) || hasDuplicate(suppressions as MemorySuppression[], (item) => JSON.stringify([item.namespace, item.key, item.category, item.createdAt]))
    ? null
    : suppressions as MemorySuppression[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0;
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || lengthDescriptor.enumerable || lengthDescriptor.configurable || !lengthDescriptor.writable ||
      !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      names.length !== lengthDescriptor.value + 1 || !names.includes("length")) return false;
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) return false;
  }
  return true;
}

function hasExactDataKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const names = Object.getOwnPropertyNames(value).sort();
  if (names.length !== expected.length || names.some((key, index) => key !== [...expected].sort()[index])) return false;
  return names.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor);
  });
}

function hasOnlyOwnDataDescriptors(value: Record<string, unknown>): boolean {
  return Object.getOwnPropertyNames(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor);
  });
}

function canonicalMemoryText(value: unknown, maxLength: number): string | null {
  const parsed = normalizeMemoryText(value, maxLength);
  return parsed === value ? parsed : null;
}

function canonicalMemoryTags(value: unknown): string[] | null {
  if (!isDenseArray(value)) return null;
  const parsed = normalizeMemoryTags(value);
  return parsed && parsed.length === value.length && parsed.every((item, index) => item === value[index]) ? parsed : null;
}

function canonicalMemoryNamespace(value: unknown): string | null {
  const parsed = normalizeMemoryNamespace(value);
  return parsed === value ? parsed : null;
}

function canonicalMemoryKey(value: unknown): string | null {
  const parsed = normalizeMemoryKey(value);
  return parsed === value ? parsed : null;
}

function canonicalMemoryCategory(value: unknown): string | null {
  const parsed = normalizeMemoryCategory(value);
  return parsed === value ? parsed : null;
}

function canonicalMemoryConfidence(value: unknown): number | null {
  const parsed = parseMemoryConfidence(value);
  return parsed === value ? parsed : null;
}

function isPositiveTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseDiskNullableTimestamp(value: unknown): number | null | undefined {
  return value === null ? null : isPositiveTimestamp(value) ? value : undefined;
}

function hasDuplicate<T>(values: T[], key: (value: T) => string): boolean {
  const seen = new Set<string>();
  return values.some((value) => seen.has(key(value)) || !seen.add(key(value)));
}

export function parseMemorySuppression(value: unknown): MemorySuppression | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const suppression = value as Partial<MemorySuppression>;
  const keys = Object.keys(suppression).sort();
  const namespace = normalizeMemoryNamespace(suppression.namespace);
  const key = normalizeMemoryKey(suppression.key);
  const category = normalizeMemoryCategory(suppression.category);

  if (
    keys.join(",") !== "category,createdAt,key,namespace" ||
    !namespace ||
    !key ||
    !category ||
    typeof suppression.createdAt !== "number" ||
    !Number.isSafeInteger(suppression.createdAt) ||
    suppression.createdAt <= 0
  ) {
    return null;
  }

  return { namespace, key, category, createdAt: suppression.createdAt };
}

export function parseMemoryCard(value: unknown, allowLegacyDefaults = false): MemoryCard | null {
  const card = value as Partial<MemoryCard> | null;
  const title = normalizeMemoryText(card?.title, MAX_TITLE_LENGTH);
  const content = normalizeMemoryText(card?.content, MAX_CONTENT_LENGTH);
  const tags = normalizeMemoryTags(card?.tags);
  const namespace = card?.namespace === undefined && allowLegacyDefaults
    ? DEFAULT_MEMORY_NAMESPACE
    : normalizeMemoryNamespace(card?.namespace);
  const sourceType = parseMemorySourceType(card?.sourceType) ?? (
    card?.sourceType === undefined && allowLegacyDefaults ? DEFAULT_MEMORY_SOURCE_TYPE : null
  );
  const key = isMemoryId(card?.id)
    ? (
      card?.key === undefined && allowLegacyDefaults
        ? createDefaultMemoryKey(card.id)
        : normalizeMemoryKey(card?.key)
    )
    : null;
  const importance = card?.importance === undefined && allowLegacyDefaults
    ? DEFAULT_MEMORY_IMPORTANCE
    : parseMemoryImportance(card?.importance);
  const category = card?.category === undefined && allowLegacyDefaults
    ? DEFAULT_MEMORY_CATEGORY
    : normalizeMemoryCategory(card?.category);
  const confidence = card?.confidence === undefined
    ? (allowLegacyDefaults ? DEFAULT_MEMORY_CONFIDENCE : null)
    : parseMemoryConfidence(card.confidence);
  const sourceMessageId = card?.sourceMessageId === undefined
    ? (allowLegacyDefaults ? null : undefined)
    : card.sourceMessageId;
  const observedCount = card?.observedCount === undefined
    ? (allowLegacyDefaults ? DEFAULT_MEMORY_OBSERVED_COUNT : undefined)
    : card.observedCount;
  const lastObservedAt = card?.lastObservedAt === undefined
    ? (allowLegacyDefaults ? card?.updatedAt : undefined)
    : card.lastObservedAt;
  const parsedObservedCount = parsePositiveInteger(observedCount);
  const parsedLastObservedAt = parsePositiveInteger(lastObservedAt);
  const compressionState = card?.compressionState === undefined && allowLegacyDefaults
    ? DEFAULT_MEMORY_COMPRESSION_STATE
    : parseMemoryCompressionState(card?.compressionState);
  const lastInjectedAt = card?.lastInjectedAt === undefined
    ? (allowLegacyDefaults ? null : undefined)
    : card.lastInjectedAt;
  const injectionCount = card?.injectionCount === undefined
    ? (allowLegacyDefaults ? 0 : undefined)
    : card.injectionCount;
  const managedByUser = card?.managedByUser === undefined
    ? (allowLegacyDefaults ? sourceType === "manual-chat" : undefined)
    : card.managedByUser;

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
    !compressionState ||
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
    typeof managedByUser !== "boolean" ||
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
    managedByUser,
    lastInjectedAt,
    injectionCount
  };
}
