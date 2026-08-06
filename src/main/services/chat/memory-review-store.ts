import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  containsSensitiveMemoryMaterial,
  isMemoryId,
  parseMemoryReviewCandidateDraft,
  parseMemoryReviewDecisionDraft,
  type MemoryReviewCandidate,
  type MemoryReviewCandidateDraft,
  type MemoryReviewDecisionDraft,
  type MemoryReviewStatus
} from "../../../shared/chat-memory";

type MemoryReviewStorage = {
  version: 1;
  candidates: MemoryReviewCandidate[];
};

const PENDING_REVIEW_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type MemoryReviewStore = {
  canWrite(): boolean;
  enqueue(draft: MemoryReviewCandidateDraft, status?: Extract<MemoryReviewStatus, "pending-review" | "blocked">): MemoryReviewCandidate;
  listCandidates(): MemoryReviewCandidate[];
  getCandidate(id: string): MemoryReviewCandidate | null;
  updatePendingCandidate(id: string, update: MemoryReviewDecisionDraft): MemoryReviewCandidate | null;
  setStatus(id: string, status: Exclude<MemoryReviewStatus, "pending-review">): MemoryReviewCandidate | null;
  pruneExpiredPendingCandidates(now?: number): number;
  clearPendingCandidates(): number;
  getReviewPath(): string;
};

type MemoryReviewSourceState = "missing" | "valid-current" | "valid-legacy" | "invalid" | "future-version" | "sensitive";
type MemoryReviewReadOutcome = { storage: MemoryReviewStorage; canWrite: boolean; sourceState: MemoryReviewSourceState };
const MEMORY_REVIEW_STORE_ERROR = "Memory review storage unavailable";

export function createMemoryReviewStore(options: { userDataPath?: string } = {}): MemoryReviewStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const reviewPath = join(userDataPath, "memory", "reviews.json");

  function inspectStorage(): MemoryReviewReadOutcome {
    if (!existsSync(reviewPath)) return { storage: emptyStorage(), canWrite: true, sourceState: "missing" };
    try {
      const raw = JSON.parse(readFileSync(reviewPath, "utf8"));
      const storage = parseMemoryReviewStorage(raw);
      if (!storage) return unsafeOutcome(getSafeOwnVersion(raw) !== undefined && getSafeOwnVersion(raw)! > 1 ? "future-version" : "invalid");
      if (storage.candidates.some((candidate) => containsSensitiveMemoryMaterial([
        candidate.title, candidate.content, ...candidate.tags, candidate.namespace, candidate.key, candidate.category
      ].join("\n")))) {
        return unsafeOutcome("sensitive");
      }
      return { storage, canWrite: true, sourceState: "valid-current" };
    } catch {
      return unsafeOutcome("invalid");
    }
  }

  function readStorage(): MemoryReviewReadOutcome {
    return inspectStorage();
  }

  function emptyStorage(): MemoryReviewStorage {
    return { version: 1, candidates: [] };
  }

  function unsafeOutcome(sourceState: Extract<MemoryReviewSourceState, "invalid" | "future-version" | "sensitive">): MemoryReviewReadOutcome {
    return { storage: emptyStorage(), canWrite: false, sourceState };
  }

  function getSafeOwnVersion(value: unknown): number | undefined {
    if (!isPlainObject(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "version");
    return descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor && typeof descriptor.value === "number"
      ? descriptor.value
      : undefined;
  }

  function requireWritableStorage(): MemoryReviewStorage {
    const outcome = readStorage();
    if (!outcome.canWrite) throw new Error(MEMORY_REVIEW_STORE_ERROR);
    return outcome.storage;
  }

  function writeStorage(storage: MemoryReviewStorage): void {
    const temporaryPath = `${reviewPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      mkdirSync(dirname(reviewPath), { recursive: true });
      writeFileSync(temporaryPath, `${JSON.stringify(storage, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, reviewPath);
    } catch {
      throw new Error(MEMORY_REVIEW_STORE_ERROR);
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

  return {
    canWrite() {
      return inspectStorage().canWrite;
    },
    enqueue(draft, status = "pending-review") {
      const storage = requireWritableStorage();
      const parsed = parseMemoryReviewCandidateDraft(draft);
      if (!parsed || parsed.action === "ignore") throw new Error("Invalid memory review candidate");
      if (containsSensitiveMemoryMaterial([
        parsed.title, parsed.content, ...parsed.tags, parsed.namespace, parsed.key, parsed.category
      ].join("\n"))) {
        throw new Error("Invalid memory review candidate");
      }
      const now = Date.now();
      const candidate: MemoryReviewCandidate = {
        ...parsed,
        id: crypto.randomUUID(),
        status,
        createdAt: now,
        updatedAt: now
      };
      storage.candidates.push(candidate);
      writeStorage(storage);
      return candidate;
    },
    listCandidates() {
      const outcome = readStorage();
      const storage = outcome.storage;
      if (!outcome.canWrite) throw new Error(MEMORY_REVIEW_STORE_ERROR);
      const removed = removeExpiredPendingCandidates(storage, Date.now());
      if (removed > 0) writeStorage(storage);
      return storage.candidates.sort((left, right) => right.updatedAt - left.updatedAt);
    },
    getCandidate(id) {
      const outcome = readStorage();
      const storage = outcome.storage;
      if (!outcome.canWrite) throw new Error(MEMORY_REVIEW_STORE_ERROR);
      if (!isMemoryId(id)) return null;
      const removed = removeExpiredPendingCandidates(storage, Date.now());
      if (removed > 0) writeStorage(storage);
      return storage.candidates.find((candidate) => candidate.id === id) ?? null;
    },
    updatePendingCandidate(id, update) {
      const storage = requireWritableStorage();
      const parsed = parseMemoryReviewDecisionDraft(update);
      if (!isMemoryId(id) || !parsed) return null;
      const removed = removeExpiredPendingCandidates(storage, Date.now());
      const candidate = storage.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status !== "pending-review") {
        if (removed > 0) writeStorage(storage);
        return null;
      }
      const nextTitle = parsed.title ?? candidate.title;
      const nextContent = parsed.content ?? candidate.content;
      const nextTags = parsed.tags ?? candidate.tags;
      if (containsSensitiveMemoryMaterial(`${nextTitle}\n${nextContent}\n${nextTags.join("\n")}`)) {
        if (removed > 0) writeStorage(storage);
        return null;
      }
      Object.assign(candidate, parsed, { updatedAt: Date.now() });
      writeStorage(storage);
      return candidate;
    },
    setStatus(id, status) {
      const storage = requireWritableStorage();
      if (!isMemoryId(id)) return null;
      const removed = removeExpiredPendingCandidates(storage, Date.now());
      const candidate = storage.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status !== "pending-review") {
        if (removed > 0) writeStorage(storage);
        return null;
      }
      candidate.status = status;
      candidate.updatedAt = Date.now();
      writeStorage(storage);
      return candidate;
    },
    pruneExpiredPendingCandidates(now = Date.now()) {
      const storage = requireWritableStorage();
      if (!Number.isSafeInteger(now) || now <= 0) return 0;
      const removed = removeExpiredPendingCandidates(storage, now);
      if (removed > 0) {
        writeStorage(storage);
      }
      return removed;
    },
    clearPendingCandidates() {
      const storage = requireWritableStorage();
      const nextCandidates = storage.candidates.filter((candidate) => candidate.status !== "pending-review");
      const removed = storage.candidates.length - nextCandidates.length;
      if (removed > 0) {
        storage.candidates = nextCandidates;
        writeStorage(storage);
      }
      return removed;
    },
    getReviewPath() {
      return reviewPath;
    }
  };
}

function removeExpiredPendingCandidates(storage: MemoryReviewStorage, now: number): number {
  const nextCandidates = storage.candidates.filter((candidate) =>
    candidate.status !== "pending-review" || now - candidate.createdAt <= PENDING_REVIEW_RETENTION_MS
  );
  const removed = storage.candidates.length - nextCandidates.length;
  storage.candidates = nextCandidates;
  return removed;
}

export function parseMemoryReviewStorage(value: unknown): MemoryReviewStorage | null {
  if (!isPlainObject(value) || !hasExactDataKeys(value, ["version", "candidates"])) return null;
  const storage = value as Record<string, unknown>;
  if (storage.version !== 1 || !isDenseArray(storage.candidates)) return null;
  const candidates = storage.candidates.map(parseCandidate);
  return candidates.some((candidate) => candidate === null) || hasDuplicate(candidates as MemoryReviewCandidate[], (candidate) => candidate.id)
    ? null
    : { version: 1, candidates: candidates as MemoryReviewCandidate[] };
}

function parseCandidate(value: unknown): MemoryReviewCandidate | null {
  if (!isPlainObject(value) || !hasExactDataKeys(value, [
    "action", "category", "confidence", "content", "createdAt", "id", "importance", "key", "namespace",
    "sourceConversationId", "sourceMessageId", "status", "tags", "title", "updatedAt"
  ])) return null;
  const candidate = value as Record<string, unknown>;
  if (!isDenseArray(candidate.tags)) return null;
  const draft = parseMemoryReviewCandidateDraft({
    action: candidate.action,
    title: candidate.title,
    content: candidate.content,
    tags: candidate.tags,
    namespace: candidate.namespace,
    key: candidate.key,
    importance: candidate.importance,
    category: candidate.category,
    confidence: candidate.confidence,
    sourceConversationId: candidate.sourceConversationId,
    sourceMessageId: candidate.sourceMessageId
  });
  if (
    !draft ||
    draft.action === "ignore" ||
    !isMemoryId(candidate.id) ||
    !isReviewStatus(candidate.status) ||
    !isTimestamp(candidate.createdAt) ||
    !isTimestamp(candidate.updatedAt) ||
    candidate.updatedAt < candidate.createdAt ||
    !isCanonicalCandidate(candidate, draft)
  ) return null;
  return { ...draft, id: candidate.id, status: candidate.status, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt };
}

function isCanonicalCandidate(candidate: Record<string, unknown>, draft: MemoryReviewCandidateDraft): boolean {
  return candidate.action === draft.action && candidate.title === draft.title && candidate.content === draft.content &&
    candidate.namespace === draft.namespace && candidate.key === draft.key && candidate.importance === draft.importance &&
    candidate.category === draft.category && candidate.confidence === draft.confidence &&
    candidate.sourceConversationId === draft.sourceConversationId && candidate.sourceMessageId === draft.sourceMessageId &&
    isDenseArray(candidate.tags) && candidate.tags.length === draft.tags.length && candidate.tags.every((tag, index) => tag === draft.tags[index]);
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
  return names.length === expected.length && names.every((key, index) => key === [...expected].sort()[index] && (() => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor);
  })());
}

function hasDuplicate<T>(values: T[], key: (value: T) => string): boolean {
  const seen = new Set<string>();
  return values.some((value) => seen.has(key(value)) || !seen.add(key(value)));
}

function isReviewStatus(value: unknown): value is MemoryReviewStatus {
  return value === "pending-review" || value === "confirmed" || value === "rejected" || value === "blocked";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
