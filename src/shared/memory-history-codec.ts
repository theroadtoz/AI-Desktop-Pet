import {
  isHistoryId,
  isHistoryRetentionLimit,
  type Conversation,
  type ConversationSummary,
  type HistoryMessage,
  type HistoryRetentionLimit
} from "./chat-history";
import {
  isMemoryId,
  MAX_CONTENT_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  memoryCompressionStates,
  memoryImportanceValues,
  memorySourceTypes,
  normalizeMemoryCategory,
  normalizeMemoryKey,
  normalizeMemoryNamespace,
  normalizeMemoryText,
  parseMemoryCompressionState,
  parseMemoryConfidence,
  parseMemoryImportance,
  parseMemoryReviewDecisionDraft as parseStoredMemoryReviewDecisionDraft,
  parseMemorySourceType,
  parseMemoryCardDraft as parseStoredMemoryCardDraft,
  parseMemoryCardUpdate as parseStoredMemoryCardUpdate,
  type MemoryCard,
  type MemoryCardDraft,
  type MemoryCardUpdate,
  type MemoryCreateResult,
  type MemoryForgetResult,
  type MemoryReviewCandidate,
  type MemoryReviewDecisionDraft,
  type MemoryReviewDecisionResult,
  type MemorySettings,
  type MemorySummary,
  type MemorySuppressionView
} from "./chat-memory";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return false;
  const actual = (ownKeys as string[]).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]) &&
    actual.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor && descriptor.enumerable && "value" in descriptor);
    });
}

function hasAllowedKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length === 0 || keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && descriptor.enumerable && "value" in descriptor);
  });
}

function isOrdinaryArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  const expected = Array.from({ length: value.length }, (_, index) => String(index));
  expected.push("length");
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && "value" in descriptor && (key === "length" ? !descriptor.enumerable : descriptor.enumerable));
  });
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseMemoryRequestText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length > maxLength) return null;
  const normalized = normalizeMemoryText(value, maxLength);
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function parseMemoryResponseText(value: unknown, maxLength: number): string | null {
  const normalized = parseMemoryRequestText(value, maxLength);
  return normalized === value ? normalized : null;
}

function parseMemoryTags(value: unknown, response: boolean): string[] | null {
  if (!isOrdinaryArray(value) || value.length > MAX_TAGS) return null;
  const tags: string[] = [];
  for (const item of value) {
    const tag = response ? parseMemoryResponseText(item, MAX_TAG_LENGTH) : parseMemoryRequestText(item, MAX_TAG_LENGTH);
    if (!tag || tags.includes(tag)) return null;
    tags.push(tag);
  }
  return tags;
}

function parseMemoryResponseSlug(value: unknown, normalizer: (candidate: unknown) => string | null): string | null {
  const normalized = normalizer(value);
  return normalized === value ? normalized : null;
}

function parseHistoryMessage(value: unknown): HistoryMessage | null {
  if (!hasExactKeys(value, ["id", "role", "content", "createdAt"])) return null;
  const message = value as HistoryMessage;
  return isHistoryId(message.id) &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" && message.content.trim().length > 0 &&
    parsePositiveInteger(message.createdAt) !== null
    ? message
    : null;
}

export function parseHistoryConversation(value: unknown): Conversation | null {
  if (!hasExactKeys(value, ["id", "title", "createdAt", "updatedAt", "messages"])) return null;
  const conversation = value as Conversation;
  const createdAt = parsePositiveInteger(conversation.createdAt);
  const updatedAt = parsePositiveInteger(conversation.updatedAt);
  if (!isHistoryId(conversation.id) || typeof conversation.title !== "string" || conversation.title.trim().length === 0 ||
    createdAt === null || updatedAt === null || updatedAt < createdAt || !isOrdinaryArray(conversation.messages)) return null;
  const messages = conversation.messages.map(parseHistoryMessage);
  return messages.some((message) => message === null) ? null : conversation;
}

function parseHistoryConversationSummary(value: unknown): ConversationSummary | null {
  if (!hasExactKeys(value, ["id", "title", "createdAt", "updatedAt", "messageCount"])) return null;
  const summary = value as ConversationSummary;
  const createdAt = parsePositiveInteger(summary.createdAt);
  const updatedAt = parsePositiveInteger(summary.updatedAt);
  return isHistoryId(summary.id) && typeof summary.title === "string" && summary.title.trim().length > 0 &&
    createdAt !== null && updatedAt !== null && updatedAt >= createdAt && parseNonNegativeInteger(summary.messageCount) !== null
    ? summary
    : null;
}

export function parseHistoryConversationList(value: unknown): ConversationSummary[] | null {
  if (!isOrdinaryArray(value)) return null;
  const summaries = value.map(parseHistoryConversationSummary);
  return summaries.some((summary) => summary === null) ? null : summaries as ConversationSummary[];
}

export function parseHistoryRetentionLimit(value: unknown): HistoryRetentionLimit | null {
  return isHistoryRetentionLimit(value) ? value : null;
}

export { isHistoryId, isMemoryId };

export function parseHistoryIdRequest(value: unknown): { id: string } | null {
  return hasExactKeys(value, ["id"]) && isHistoryId(value.id) ? { id: value.id } : null;
}

export function parseHistoryRetentionRequest(value: unknown): { limit: HistoryRetentionLimit } | null {
  const limit = hasExactKeys(value, ["limit"]) ? parseHistoryRetentionLimit(value.limit) : null;
  return limit === null ? null : { limit };
}

export function parseNullableHistoryConversation(value: unknown): { value: Conversation | null } | null {
  if (value === null) return { value: null };
  const conversation = parseHistoryConversation(value);
  return conversation ? { value: conversation } : null;
}

export function parseMemoryIdRequest(value: unknown): { id: string } | null {
  return hasExactKeys(value, ["id"]) && isMemoryId(value.id) ? { id: value.id } : null;
}

export function parseMemoryEnabledRequest(value: unknown): { enabled: boolean } | null {
  return hasExactKeys(value, ["enabled"]) && typeof value.enabled === "boolean" ? { enabled: value.enabled } : null;
}

export function parseMemoryCardDraftRequest(value: unknown): { draft: MemoryCardDraft } | null {
  if (!hasExactKeys(value, ["draft"])) return null;
  const draft = parseMemoryCardDraft(value.draft);
  return draft ? { draft } : null;
}

export function parseMemoryCardUpdateRequest(value: unknown): { id: string; update: MemoryCardUpdate } | null {
  if (!hasExactKeys(value, ["id", "update"]) || !isMemoryId(value.id)) return null;
  const update = parseMemoryCardUpdate(value.update);
  return update ? { id: value.id, update } : null;
}

export function parseMemoryReviewDecisionRequest(value: unknown): { id: string; update: MemoryReviewDecisionDraft | undefined } | null {
  if (!hasExactKeys(value, ["id", "update"]) || !isMemoryId(value.id)) return null;
  if (value.update === undefined) return { id: value.id, update: undefined };
  const update = parseMemoryReviewDecisionDraft(value.update);
  return update ? { id: value.id, update } : null;
}

export function parseBooleanResponse(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseVoidResponse(value: unknown): undefined | null {
  return value === undefined ? undefined : null;
}

export function parseMemorySettings(value: unknown): MemorySettings | null {
  return hasExactKeys(value, ["enabled"]) && typeof value.enabled === "boolean" ? { enabled: value.enabled } : null;
}

function parseCountMap(
  value: unknown,
  expectedKeys?: readonly string[],
  normalizeKey?: (candidate: unknown) => string | null
): Record<string, number> | null {
  if (!isPlainRecord(value)) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return null;
  const keys = ownKeys as string[];
  if (keys.some((key) => ["__proto__", "prototype", "constructor"].includes(key))) return null;
  if (normalizeKey && keys.some((key) => normalizeKey(key) !== key)) return null;
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !descriptor.enumerable || !("value" in descriptor);
  })) return null;
  keys.sort();
  if (expectedKeys) {
    const expected = [...expectedKeys].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  }
  for (const key of keys) {
    if (parseNonNegativeInteger(value[key]) === null) return null;
  }
  return value as Record<string, number>;
}

export function parseMemorySummary(value: unknown): MemorySummary | null {
  const keys = ["enabled", "totalCards", "enabledCards", "disabledCards", "injectableCount", "injectionBudget", "compressionThreshold", "sourceTypeCounts", "importanceCounts", "compressionStateCounts", "categoryCounts"];
  if (!hasExactKeys(value, keys)) return null;
  const summary = value as MemorySummary;
  const sourceTypeCounts = parseCountMap(summary.sourceTypeCounts, memorySourceTypes);
  const importanceCounts = parseCountMap(summary.importanceCounts, memoryImportanceValues);
  const compressionStateCounts = parseCountMap(summary.compressionStateCounts, memoryCompressionStates);
  const categoryCounts = parseCountMap(summary.categoryCounts, undefined, normalizeMemoryCategory);
  if (typeof summary.enabled !== "boolean" || parseNonNegativeInteger(summary.totalCards) === null ||
    parseNonNegativeInteger(summary.enabledCards) === null || parseNonNegativeInteger(summary.disabledCards) === null ||
    parseNonNegativeInteger(summary.injectableCount) === null || parseNonNegativeInteger(summary.injectionBudget) === null ||
    parseNonNegativeInteger(summary.compressionThreshold) === null || !sourceTypeCounts || !importanceCounts || !compressionStateCounts || !categoryCounts) return null;
  return summary;
}

export function parseMemoryCard(value: unknown): MemoryCard | null {
  const keys = ["id", "title", "content", "tags", "sourceConversationId", "sourceType", "namespace", "key", "importance", "category", "confidence", "sourceMessageId", "observedCount", "lastObservedAt", "compressionState", "createdAt", "updatedAt", "enabled", "managedByUser", "lastInjectedAt", "injectionCount"];
  if (!hasExactKeys(value, keys)) return null;
  const card = value as MemoryCard;
  const title = parseMemoryResponseText(card.title, MAX_TITLE_LENGTH);
  const content = parseMemoryResponseText(card.content, MAX_CONTENT_LENGTH);
  const tags = parseMemoryTags(card.tags, true);
  const namespace = parseMemoryResponseSlug(card.namespace, normalizeMemoryNamespace);
  const key = parseMemoryResponseSlug(card.key, normalizeMemoryKey);
  const category = parseMemoryResponseSlug(card.category, normalizeMemoryCategory);
  const sourceType = parseMemorySourceType(card.sourceType);
  const importance = parseMemoryImportance(card.importance);
  const compressionState = parseMemoryCompressionState(card.compressionState);
  const confidence = parseMemoryConfidence(card.confidence);
  const createdAt = parsePositiveInteger(card.createdAt);
  const updatedAt = parsePositiveInteger(card.updatedAt);
  const observedCount = parsePositiveInteger(card.observedCount);
  const lastObservedAt = parsePositiveInteger(card.lastObservedAt);
  const injectionCount = parseNonNegativeInteger(card.injectionCount);
  const lastInjectedAt = card.lastInjectedAt === null ? null : parsePositiveInteger(card.lastInjectedAt);
  if (!isMemoryId(card.id) || !title || !content || !tags || !isMemoryId(card.sourceConversationId) || !sourceType || !namespace || !key || !importance || !category || confidence === null || confidence !== card.confidence ||
    !(card.sourceMessageId === null || isMemoryId(card.sourceMessageId)) || !compressionState || createdAt === null || updatedAt === null || updatedAt < createdAt ||
    observedCount === null || lastObservedAt === null || lastObservedAt < createdAt || typeof card.enabled !== "boolean" || typeof card.managedByUser !== "boolean" ||
    lastInjectedAt === null && card.lastInjectedAt !== null || injectionCount === null) return null;
  return { ...card, title, content, tags, namespace, key, category, sourceType, importance, compressionState, confidence };
}

export function parseMemoryCards(value: unknown): MemoryCard[] | null {
  if (!isOrdinaryArray(value)) return null;
  const cards = value.map(parseMemoryCard);
  return cards.some((card) => card === null) ? null : cards as MemoryCard[];
}

export function parseNullableMemoryCard(value: unknown): { value: MemoryCard | null } | null {
  if (value === null) return { value: null };
  const card = parseMemoryCard(value);
  return card ? { value: card } : null;
}

export function parseMemoryCardDraft(value: unknown): MemoryCardDraft | null {
  if (!hasExactKeys(value, ["title", "content", "tags", "sourceConversationId"])) return null;
  const raw = value as MemoryCardDraft;
  if (typeof raw.title !== "string" || raw.title.length > MAX_TITLE_LENGTH ||
    typeof raw.content !== "string" || raw.content.length > MAX_CONTENT_LENGTH ||
    !parseMemoryTags(raw.tags, false)) return null;
  return parseStoredMemoryCardDraft(value);
}

export function parseMemoryCardUpdate(value: unknown): MemoryCardUpdate | null {
  const allowed = ["title", "content", "tags", "importance", "enabled"];
  if (!hasAllowedKeys(value, allowed)) return null;
  if ("title" in value && (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH)) return null;
  if ("content" in value && (typeof value.content !== "string" || value.content.length > MAX_CONTENT_LENGTH)) return null;
  if ("tags" in value && !parseMemoryTags(value.tags, false)) return null;
  return parseStoredMemoryCardUpdate(value);
}

export function parseMemorySuppressionView(value: unknown): MemorySuppressionView | null {
  if (!hasExactKeys(value, ["id", "category", "createdAt"])) return null;
  const suppression = value as MemorySuppressionView;
  const category = parseMemoryResponseSlug(suppression.category, normalizeMemoryCategory);
  return isMemoryId(suppression.id) && category && parsePositiveInteger(suppression.createdAt) !== null
    ? { ...suppression, category }
    : null;
}

export function parseMemorySuppressionViews(value: unknown): MemorySuppressionView[] | null {
  if (!isOrdinaryArray(value)) return null;
  const suppressions = value.map(parseMemorySuppressionView);
  return suppressions.some((suppression) => suppression === null) ? null : suppressions as MemorySuppressionView[];
}

export function parseMemoryCreateResult(value: unknown): MemoryCreateResult | null {
  if (hasExactKeys(value, ["status"]) && value.status === "disabled") return { status: "disabled" };
  if (hasExactKeys(value, ["status", "card"]) && value.status === "created") {
    const card = parseMemoryCard(value.card);
    return card ? { status: "created", card } : null;
  }
  return null;
}

export function parseMemoryForgetResult(value: unknown): MemoryForgetResult | null {
  return hasExactKeys(value, ["status"]) && (value.status === "forgotten" || value.status === "manual" || value.status === "not_found")
    ? { status: value.status }
    : null;
}

export function parseMemoryReviewCandidate(value: unknown): MemoryReviewCandidate | null {
  const keys = ["id", "action", "title", "content", "tags", "namespace", "key", "importance", "category", "confidence", "sourceConversationId", "sourceMessageId", "status", "createdAt", "updatedAt"];
  if (!hasExactKeys(value, keys)) return null;
  const candidate = value as MemoryReviewCandidate;
  const title = parseMemoryResponseText(candidate.title, MAX_TITLE_LENGTH);
  const content = parseMemoryResponseText(candidate.content, MAX_CONTENT_LENGTH);
  const tags = parseMemoryTags(candidate.tags, true);
  const namespace = parseMemoryResponseSlug(candidate.namespace, normalizeMemoryNamespace);
  const key = parseMemoryResponseSlug(candidate.key, normalizeMemoryKey);
  const category = parseMemoryResponseSlug(candidate.category, normalizeMemoryCategory);
  const importance = parseMemoryImportance(candidate.importance);
  const confidence = parseMemoryConfidence(candidate.confidence);
  const createdAt = parsePositiveInteger(candidate.createdAt);
  const updatedAt = parsePositiveInteger(candidate.updatedAt);
  if (!isMemoryId(candidate.id) || !title || !content || !tags || !namespace || !key || !importance || !category || confidence === null || confidence !== candidate.confidence || confidence < 0.7 ||
    !isMemoryId(candidate.sourceConversationId) || !isMemoryId(candidate.sourceMessageId) || createdAt === null || updatedAt === null || updatedAt < createdAt ||
    !(candidate.action === "create" || candidate.action === "update-suggestion" || candidate.action === "revoke-suggestion" || candidate.action === "ignore") ||
    !(candidate.status === "pending-review" || candidate.status === "confirmed" || candidate.status === "rejected" || candidate.status === "blocked")) return null;
  return { ...candidate, title, content, tags, namespace, key, importance, category, confidence };
}

export function parseMemoryReviewCandidates(value: unknown): MemoryReviewCandidate[] | null {
  if (!isOrdinaryArray(value)) return null;
  const reviews = value.map(parseMemoryReviewCandidate);
  return reviews.some((review) => review === null) ? null : reviews as MemoryReviewCandidate[];
}

export function parseMemoryReviewConfirmationResult(
  value: unknown
): { status: "created" | "disabled" | "blocked" } | null {
  return hasExactKeys(value, ["status"]) &&
    (value.status === "created" || value.status === "disabled" || value.status === "blocked")
    ? { status: value.status }
    : null;
}

export function parseMemoryReviewDecisionDraft(value: unknown): MemoryReviewDecisionDraft | null {
  const allowed = ["title", "content", "tags", "importance"];
  if (!hasAllowedKeys(value, allowed)) return null;
  if ("title" in value && (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH)) return null;
  if ("content" in value && (typeof value.content !== "string" || value.content.length > MAX_CONTENT_LENGTH)) return null;
  if ("tags" in value && !parseMemoryTags(value.tags, false)) return null;
  return parseStoredMemoryReviewDecisionDraft(value);
}

export function parseMemoryReviewDecisionResult(value: unknown): MemoryReviewDecisionResult | null {
  return hasExactKeys(value, ["status"]) && (value.status === "confirmed" || value.status === "rejected" || value.status === "blocked" || value.status === "disabled" || value.status === "not_found")
    ? { status: value.status }
    : null;
}
