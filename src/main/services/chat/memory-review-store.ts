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

export type MemoryReviewStore = {
  enqueue(draft: MemoryReviewCandidateDraft, status?: Extract<MemoryReviewStatus, "pending-review" | "blocked">): MemoryReviewCandidate;
  listCandidates(): MemoryReviewCandidate[];
  getCandidate(id: string): MemoryReviewCandidate | null;
  updatePendingCandidate(id: string, update: MemoryReviewDecisionDraft): MemoryReviewCandidate | null;
  setStatus(id: string, status: Exclude<MemoryReviewStatus, "pending-review">): MemoryReviewCandidate | null;
  getReviewPath(): string;
};

export function createMemoryReviewStore(options: { userDataPath?: string } = {}): MemoryReviewStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const reviewPath = join(userDataPath, "memory", "reviews.json");

  function readStorage(): MemoryReviewStorage {
    if (!existsSync(reviewPath)) return { version: 1, candidates: [] };
    try {
      const parsed = JSON.parse(readFileSync(reviewPath, "utf8"));
      return parseStorage(parsed) ?? { version: 1, candidates: [] };
    } catch {
      return { version: 1, candidates: [] };
    }
  }

  function writeStorage(storage: MemoryReviewStorage): void {
    mkdirSync(dirname(reviewPath), { recursive: true });
    const temporaryPath = `${reviewPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(storage, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, reviewPath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }

  return {
    enqueue(draft, status = "pending-review") {
      const parsed = parseMemoryReviewCandidateDraft(draft);
      if (!parsed || parsed.action === "ignore") throw new Error("Invalid memory review candidate");
      if (containsSensitiveMemoryMaterial(`${parsed.title}\n${parsed.content}\n${parsed.tags.join("\n")}`)) {
        throw new Error("Invalid memory review candidate");
      }
      const storage = readStorage();
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
      return readStorage().candidates.sort((left, right) => right.updatedAt - left.updatedAt);
    },
    getCandidate(id) {
      return isMemoryId(id) ? readStorage().candidates.find((candidate) => candidate.id === id) ?? null : null;
    },
    updatePendingCandidate(id, update) {
      const parsed = parseMemoryReviewDecisionDraft(update);
      if (!isMemoryId(id) || !parsed) return null;
      const storage = readStorage();
      const candidate = storage.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status !== "pending-review") return null;
      const nextTitle = parsed.title ?? candidate.title;
      const nextContent = parsed.content ?? candidate.content;
      const nextTags = parsed.tags ?? candidate.tags;
      if (containsSensitiveMemoryMaterial(`${nextTitle}\n${nextContent}\n${nextTags.join("\n")}`)) return null;
      Object.assign(candidate, parsed, { updatedAt: Date.now() });
      writeStorage(storage);
      return candidate;
    },
    setStatus(id, status) {
      if (!isMemoryId(id)) return null;
      const storage = readStorage();
      const candidate = storage.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status !== "pending-review") return null;
      candidate.status = status;
      candidate.updatedAt = Date.now();
      writeStorage(storage);
      return candidate;
    },
    getReviewPath() {
      return reviewPath;
    }
  };
}

function parseStorage(value: unknown): MemoryReviewStorage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const storage = value as Partial<MemoryReviewStorage>;
  if (storage.version !== 1 || !Array.isArray(storage.candidates)) return null;
  const candidates = storage.candidates.map(parseCandidate);
  return candidates.some((candidate) => candidate === null) ? null : { version: 1, candidates: candidates as MemoryReviewCandidate[] };
}

function parseCandidate(value: unknown): MemoryReviewCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<MemoryReviewCandidate>;
  const keys = Object.keys(candidate).sort();
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
    keys.join(",") !== "action,category,confidence,content,createdAt,id,importance,key,namespace,sourceConversationId,sourceMessageId,status,tags,title,updatedAt" ||
    !draft ||
    draft.action === "ignore" ||
    !isMemoryId(candidate.id) ||
    !isReviewStatus(candidate.status) ||
    !isTimestamp(candidate.createdAt) ||
    !isTimestamp(candidate.updatedAt) ||
    candidate.updatedAt < candidate.createdAt
  ) return null;
  return { ...draft, id: candidate.id, status: candidate.status, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt };
}

function isReviewStatus(value: unknown): value is MemoryReviewStatus {
  return value === "pending-review" || value === "confirmed" || value === "rejected" || value === "blocked";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
