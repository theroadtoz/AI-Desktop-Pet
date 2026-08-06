import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import {
  containsSensitiveMemoryMaterial,
  MEMORY_STORAGE_VERSION,
  parseMemoryStorage,
  type MemoryStorage
} from "../../../shared/chat-memory";
import { parseUserProfile } from "../../../shared/user-profile";
import { parseMemoryReviewStorage } from "./memory-review-store";

export type MemoryClearParticipant = "reviews" | "facts" | "profile";
export type MemoryClearPhase = "prepared" | "reviews-committed" | "facts-committed" | "cleanup" | "recovery_required";
export type MemoryClearReason =
  | "prepared"
  | "missing"
  | "committed"
  | "cleanup-pending"
  | "prepare-failed"
  | "forward-failed"
  | "fingerprint-conflict"
  | "invalid-schema"
  | "future-version"
  | "sensitive"
  | "write-failed"
  | "rollback-failed";

export type MemoryClearResult =
  | { status: "cleared" }
  | { status: "recovery_required"; reason: MemoryClearReason };

export type MemoryClearRecoveryResult =
  | { status: "clean" }
  | { status: "recovered" }
  | { status: "recovery_required"; reason: MemoryClearReason };

type Snapshot = {
  exists: boolean;
  bytes: Buffer | null;
  mtimeNs: string | null;
  fingerprint: string;
  targetBytes: Buffer | null;
  targetFingerprint: string;
  targetExists: boolean;
};

type JournalParticipant = {
  participant: MemoryClearParticipant;
  sourceFingerprint: string;
  targetFingerprint: string;
};

type Journal = {
  version: 1;
  phase: MemoryClearPhase;
  participants: JournalParticipant[];
  reason: MemoryClearReason;
};

type Prepared = {
  userDataPath: string;
  root: string;
  nextRoot: string;
  backupRoot: string;
  journalPath: string;
  snapshots: Record<MemoryClearParticipant, Snapshot>;
};

export type MemoryClearFaultOperation = "journal" | "next" | "backup" | "commit" | "commit-after-backup" | "rollback" | "cleanup" | "cleanup-after-next";
export type MemoryClearOptions = {
  userDataPath: string;
  fault?: (operation: MemoryClearFaultOperation, participant?: MemoryClearParticipant) => void;
};

const PARTICIPANTS: readonly MemoryClearParticipant[] = ["reviews", "facts", "profile"];
const RECOVERY_ROOT_NAME = "memory-clear-transaction";
const PHASES: readonly MemoryClearPhase[] = ["prepared", "reviews-committed", "facts-committed", "cleanup", "recovery_required"];
const REASONS: readonly MemoryClearReason[] = ["prepared", "missing", "committed", "cleanup-pending", "prepare-failed", "forward-failed", "fingerprint-conflict", "invalid-schema", "future-version", "sensitive", "write-failed", "rollback-failed"];
const MISSING_FINGERPRINT = createHash("sha256").update("memory-clear-identity-v1\0absent", "utf8").digest("hex");

function paths(userDataPath: string) {
  const root = join(userDataPath, "memory", RECOVERY_ROOT_NAME);
  return {
    root,
    nextRoot: join(root, "next"),
    backupRoot: join(root, "backup"),
    journalPath: join(root, "journal.json"),
    files: {
      facts: join(userDataPath, "memory", "facts.json"),
      reviews: join(userDataPath, "memory", "reviews.json"),
      profile: join(userDataPath, "config", "user-profile.json")
    } satisfies Record<MemoryClearParticipant, string>
  };
}

function fingerprint(snapshot: { bytes: Buffer | null; mtimeNs: string | null }): string {
  if (snapshot.bytes === null) return MISSING_FINGERPRINT;
  return createHash("sha256")
    .update("memory-clear-identity-v1\0present\0", "utf8")
    .update(snapshot.mtimeNs ?? "invalid-mtime", "utf8")
    .update("\0", "utf8")
    .update(snapshot.bytes)
    .digest("hex");
}

function readSnapshot(path: string): { bytes: Buffer | null; mtimeNs: string | null } {
  if (!existsSync(path)) return { bytes: null, mtimeNs: null };
  const bytes = readFileSync(path);
  return { bytes, mtimeNs: statSync(path, { bigint: true }).mtimeNs.toString() };
}

function writeAtomic(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, bytes);
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) {
      try { unlinkSync(temporaryPath); } catch { /* preserve the primary failure */ }
    }
  }
}

function removePath(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true, recursive: true });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isValidPhaseReason(phase: MemoryClearPhase, reason: MemoryClearReason): boolean {
  if (phase === "prepared") return reason === "prepared";
  if (phase === "reviews-committed" || phase === "facts-committed") return reason === "committed";
  if (phase === "cleanup") return reason === "committed" || reason === "cleanup-pending";
  return reason === "prepare-failed" || reason === "forward-failed" || reason === "fingerprint-conflict" || reason === "rollback-failed";
}

function parseStrictLegacyProfile(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const profile = value as Record<string, unknown>;
  const keys = Object.getOwnPropertyNames(profile).sort();
  const expected = keys.length === 2 ? ["completedAt", "displayName"] : keys.length === 3 ? ["completedAt", "displayName", "preferredName"] : [];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  if (!keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(profile, key);
    return Boolean(descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable && "value" in descriptor);
  })) return false;
  const parsed = parseUserProfile(profile);
  return Boolean(parsed && parsed.displayName === profile.displayName && parsed.preferredName === profile.preferredName && typeof profile.completedAt === "string");
}

function classifyParticipant(participant: MemoryClearParticipant, bytes: Buffer | null): { targetBytes: Buffer | null; reason: MemoryClearReason } {
  if (bytes === null) return { targetBytes: null, reason: "missing" };
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { targetBytes: null, reason: "invalid-schema" };
  }
  if (participant === "facts") {
    const rawVersion = value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).version
      : undefined;
    const version = typeof rawVersion === "number" ? rawVersion : undefined;
    const storage = parseMemoryStorage(value);
    if (!storage) return { targetBytes: null, reason: version !== undefined && version > MEMORY_STORAGE_VERSION ? "future-version" : "invalid-schema" };
    if (
      storage.cards.some((card) => containsSensitiveMemoryMaterial([
        card.title,
        card.content,
        ...card.tags,
        card.namespace,
        card.key,
        card.category
      ].join("\n"))) ||
      storage.suppressions.some((suppression) => containsSensitiveMemoryMaterial([
        suppression.namespace,
        suppression.key,
        suppression.category
      ].join("\n")))
    ) return { targetBytes: null, reason: "sensitive" };
    const target: MemoryStorage = { version: MEMORY_STORAGE_VERSION, enabled: storage.enabled, cards: [], suppressions: storage.suppressions };
    return { targetBytes: Buffer.from(`${JSON.stringify(target, null, 2)}\n`, "utf8"), reason: "prepared" };
  }
  if (participant === "reviews") {
    const rawVersion = value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).version
      : undefined;
    const version = typeof rawVersion === "number" ? rawVersion : undefined;
    const reviews = parseMemoryReviewStorage(value);
    if (!reviews) return { targetBytes: null, reason: version !== undefined && version > 1 ? "future-version" : "invalid-schema" };
    if (reviews.candidates.some((candidate) => containsSensitiveMemoryMaterial([candidate.title, candidate.content, ...candidate.tags, candidate.namespace, candidate.key, candidate.category].join("\n")))) return { targetBytes: null, reason: "sensitive" };
    const target = { version: 1, candidates: reviews.candidates.filter((candidate) => candidate.status !== "pending-review") };
    return { targetBytes: Buffer.from(`${JSON.stringify(target, null, 2)}\n`, "utf8"), reason: "prepared" };
  }
  if (!parseStrictLegacyProfile(value)) return { targetBytes: null, reason: "invalid-schema" };
  const profile = value as Record<string, unknown>;
  if (containsSensitiveMemoryMaterial(`${profile.displayName}\n${profile.preferredName ?? ""}`)) return { targetBytes: null, reason: "sensitive" };
  return { targetBytes: null, reason: "prepared" };
}

function participantPath(prepared: Prepared, participant: MemoryClearParticipant): string {
  return paths(prepared.userDataPath).files[participant];
}

function artifactPath(prepared: Prepared, kind: "next" | "backup", participant: MemoryClearParticipant): string {
  return join(kind === "next" ? prepared.nextRoot : prepared.backupRoot, `${participant}.bin`);
}

function journalFor(prepared: Prepared, phase: MemoryClearPhase, reason: MemoryClearReason): Journal {
  return {
    version: 1,
    phase,
    reason,
    participants: PARTICIPANTS.map((participant) => {
      const snapshot = prepared.snapshots[participant];
      return {
        participant,
        sourceFingerprint: snapshot.fingerprint,
        targetFingerprint: snapshot.targetFingerprint
      };
    })
  };
}

function serializeJournal(journal: Journal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

function writeJournal(prepared: Prepared, phase: MemoryClearPhase, reason: MemoryClearReason, fault?: MemoryClearOptions["fault"]): void {
  fault?.("journal");
  writeAtomic(prepared.journalPath, Buffer.from(serializeJournal(journalFor(prepared, phase, reason)), "utf8"));
}

function hasClosedArtifacts(resolved: ReturnType<typeof paths>): boolean {
  const allowedRoot = new Set(["backup", "journal.json", "next"]);
  if (readdirSync(resolved.root).some((name) => !allowedRoot.has(name))) return false;
  const allowedParticipantFiles = new Set(PARTICIPANTS.map((participant) => `${participant}.bin`));
  for (const artifactRoot of [resolved.nextRoot, resolved.backupRoot]) {
    if (existsSync(artifactRoot) && readdirSync(artifactRoot).some((name) => !allowedParticipantFiles.has(name))) return false;
  }
  return true;
}

function readJournal(userDataPath: string): { journal: Journal; prepared: Prepared } | null {
  const resolved = paths(userDataPath);
  if (!existsSync(resolved.journalPath)) return null;
  let raw: string;
  let value: unknown;
  try {
    raw = readFileSync(resolved.journalPath, "utf8");
    value = JSON.parse(raw);
    if (!hasClosedArtifacts(resolved)) return null;
  } catch { return null; }
  if (!isPlainRecord(value) || !hasExactKeys(value, ["version", "phase", "reason", "participants"])) return null;
  if (value.version !== 1 || !PHASES.includes(value.phase as MemoryClearPhase) || !REASONS.includes(value.reason as MemoryClearReason) || !Array.isArray(value.participants) || value.participants.length !== PARTICIPANTS.length) return null;
  if (!isValidPhaseReason(value.phase as MemoryClearPhase, value.reason as MemoryClearReason)) return null;
  const participants: JournalParticipant[] = [];
  for (let index = 0; index < PARTICIPANTS.length; index += 1) {
    const entry = value.participants[index];
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ["participant", "sourceFingerprint", "targetFingerprint"])) return null;
    if (entry.participant !== PARTICIPANTS[index] || !isFingerprint(entry.sourceFingerprint) || !isFingerprint(entry.targetFingerprint)) return null;
    participants.push({
      participant: PARTICIPANTS[index]!,
      sourceFingerprint: entry.sourceFingerprint,
      targetFingerprint: entry.targetFingerprint
    });
  }
  const journal: Journal = {
    version: 1,
    phase: value.phase as MemoryClearPhase,
    reason: value.reason as MemoryClearReason,
    participants
  };
  if (raw !== serializeJournal(journal)) return null;
  const snapshots = {} as Record<MemoryClearParticipant, Snapshot>;
  try {
    for (const participant of PARTICIPANTS) {
      const entry = journal.participants.find((candidate) => candidate.participant === participant)!;
      const targetPath = join(resolved.nextRoot, `${participant}.bin`);
      const target = readSnapshot(targetPath);
      const backupPath = join(resolved.backupRoot, `${participant}.bin`);
      const backup = readSnapshot(backupPath);
      snapshots[participant] = {
        exists: entry.sourceFingerprint !== MISSING_FINGERPRINT,
        bytes: backup.bytes,
        mtimeNs: backup.mtimeNs,
        fingerprint: entry.sourceFingerprint,
        targetBytes: target.bytes,
        targetFingerprint: entry.targetFingerprint,
        targetExists: entry.targetFingerprint !== MISSING_FINGERPRINT
      };
    }
  } catch { return null; }
  return { journal, prepared: { userDataPath, root: resolved.root, nextRoot: resolved.nextRoot, backupRoot: resolved.backupRoot, journalPath: resolved.journalPath, snapshots } };
}

function unreadableJournalReason(userDataPath: string): MemoryClearReason | null {
  const resolved = paths(userDataPath);
  const journalPath = resolved.journalPath;
  if (!existsSync(journalPath)) {
    if (!existsSync(resolved.root)) return null;
    try {
      return readdirSync(resolved.root).length === 0 ? null : "invalid-schema";
    } catch {
      return "invalid-schema";
    }
  }
  try {
    const value = JSON.parse(readFileSync(journalPath, "utf8"));
    if (isPlainRecord(value) && typeof value.version === "number" && value.version > 1) return "future-version";
  } catch { /* invalid JSON is an invalid closed schema */ }
  return "invalid-schema";
}

function currentFingerprint(path: string): string {
  return fingerprint(readSnapshot(path));
}

function applyParticipant(prepared: Prepared, participant: MemoryClearParticipant, fault?: MemoryClearOptions["fault"]): void {
  const snapshot = prepared.snapshots[participant];
  const path = participantPath(prepared, participant);
  const current = currentFingerprint(path);
  if (current !== snapshot.fingerprint && current !== snapshot.targetFingerprint) {
    throw new Error("fingerprint-conflict");
  }
  if (current === snapshot.targetFingerprint) return;
  if (snapshot.targetExists && fingerprint(readSnapshot(artifactPath(prepared, "next", participant))) !== snapshot.targetFingerprint) {
    throw new Error("fingerprint-conflict");
  }
  fault?.("commit", participant);
  if (snapshot.exists) {
    const backupPath = artifactPath(prepared, "backup", participant);
    removePath(backupPath);
    renameSync(path, backupPath);
    fault?.("commit-after-backup", participant);
  }
  if (snapshot.targetExists) {
    renameSync(artifactPath(prepared, "next", participant), path);
  }
}

function restoreParticipant(prepared: Prepared, participant: MemoryClearParticipant, fault?: MemoryClearOptions["fault"]): void {
  const snapshot = prepared.snapshots[participant];
  const path = participantPath(prepared, participant);
  const current = currentFingerprint(path);
  if (current === snapshot.fingerprint) return;
  const backupPath = artifactPath(prepared, "backup", participant);
  if (!snapshot.exists) {
    if (current !== snapshot.targetFingerprint) throw new Error("fingerprint-conflict");
    fault?.("rollback", participant);
    removePath(path);
    return;
  }
  if (fingerprint(readSnapshot(backupPath)) !== snapshot.fingerprint) throw new Error("fingerprint-conflict");
  if (current !== snapshot.targetFingerprint && !(current === MISSING_FINGERPRINT && snapshot.targetExists)) {
    throw new Error("fingerprint-conflict");
  }
  fault?.("rollback", participant);
  removePath(path);
  renameSync(backupPath, path);
}

function cleanup(prepared: Prepared, fault?: MemoryClearOptions["fault"]): void {
  fault?.("cleanup");
  removePath(prepared.nextRoot);
  fault?.("cleanup-after-next");
  removePath(prepared.backupRoot);
  if (existsSync(prepared.journalPath)) unlinkSync(prepared.journalPath);
  removePath(prepared.root);
}

function validateRestoreParticipant(prepared: Prepared, participant: MemoryClearParticipant): void {
  const snapshot = prepared.snapshots[participant];
  const current = currentFingerprint(participantPath(prepared, participant));
  if (current === snapshot.fingerprint) return;
  if (!snapshot.exists) {
    if (current !== snapshot.targetFingerprint) throw new Error("fingerprint-conflict");
    return;
  }
  if (fingerprint(readSnapshot(artifactPath(prepared, "backup", participant))) !== snapshot.fingerprint) {
    throw new Error("fingerprint-conflict");
  }
  if (current !== snapshot.targetFingerprint && !(current === MISSING_FINGERPRINT && snapshot.targetExists)) {
    throw new Error("fingerprint-conflict");
  }
}

function rollback(prepared: Prepared, fault?: MemoryClearOptions["fault"]): void {
  for (const participant of [...PARTICIPANTS].reverse()) validateRestoreParticipant(prepared, participant);
  for (const participant of [...PARTICIPANTS].reverse()) restoreParticipant(prepared, participant, fault);
}

export function isMemoryClearRecoveryRequired(options: { userDataPath: string }): boolean {
  const journal = readJournal(options.userDataPath);
  return journal?.journal.phase === "recovery_required" || unreadableJournalReason(options.userDataPath) !== null;
}

export function prepareMemoryClear(options: MemoryClearOptions): Prepared {
  const resolved = paths(options.userDataPath);
  if (existsSync(resolved.root)) throw new Error("Memory clear recovery required");
  const prepared: Prepared = {
    userDataPath: options.userDataPath,
    root: resolved.root,
    nextRoot: resolved.nextRoot,
    backupRoot: resolved.backupRoot,
    journalPath: resolved.journalPath,
    snapshots: {} as Record<MemoryClearParticipant, Snapshot>
  };
  for (const participant of PARTICIPANTS) {
    const source = readSnapshot(resolved.files[participant]);
    const classified = classifyParticipant(participant, source.bytes);
    if (classified.reason !== "prepared" && classified.reason !== "missing") throw new Error(`Memory clear unavailable: ${classified.reason}`);
    prepared.snapshots[participant] = {
      exists: source.bytes !== null,
      bytes: source.bytes,
      mtimeNs: source.mtimeNs,
      fingerprint: fingerprint(source),
      targetBytes: classified.targetBytes,
      targetFingerprint: MISSING_FINGERPRINT,
      targetExists: classified.targetBytes !== null
    };
  }
  try {
    mkdirSync(prepared.nextRoot, { recursive: true });
    mkdirSync(prepared.backupRoot, { recursive: true });
    for (const participant of PARTICIPANTS) {
      const snapshot = prepared.snapshots[participant];
      const nextPath = artifactPath(prepared, "next", participant);
      const backupPath = artifactPath(prepared, "backup", participant);
      removePath(nextPath);
      removePath(backupPath);
      if (snapshot.targetBytes !== null) {
        options.fault?.("next", participant);
        writeAtomic(nextPath, snapshot.targetBytes);
        snapshot.targetFingerprint = fingerprint(readSnapshot(nextPath));
      }
      if (snapshot.bytes !== null) { options.fault?.("backup", participant); writeAtomic(backupPath, snapshot.bytes); }
    }
    writeJournal(prepared, "prepared", "prepared", options.fault);
    return prepared;
  } catch (error) {
    try {
      cleanup(prepared, options.fault);
    } catch {
      try { writeJournal(prepared, "recovery_required", "prepare-failed"); } catch { /* retain the closed residue */ }
      throw new Error("memory-clear-recovery:prepare-failed");
    }
    throw error;
  }
}

export function commitMemoryClear(prepared: Prepared, options: Pick<MemoryClearOptions, "fault"> = {}): MemoryClearResult {
  try {
    applyParticipant(prepared, "reviews", options.fault);
    writeJournal(prepared, "reviews-committed", "committed", options.fault);
    applyParticipant(prepared, "facts", options.fault);
    applyParticipant(prepared, "profile", options.fault);
    writeJournal(prepared, "facts-committed", "committed", options.fault);
    writeJournal(prepared, "cleanup", "committed", options.fault);
    try {
      cleanup(prepared, options.fault);
    } catch {
      try { writeJournal(prepared, "cleanup", "cleanup-pending"); } catch { /* retain the committed cleanup journal */ }
      return { status: "recovery_required", reason: "cleanup-pending" };
    }
    return { status: "cleared" };
  } catch (error) {
    const reason: MemoryClearReason = error instanceof Error && error.message === "fingerprint-conflict" ? "fingerprint-conflict" : "write-failed";
    if (reason === "fingerprint-conflict") {
      try { writeJournal(prepared, "recovery_required", reason); } catch { /* retain existing durable journal */ }
      return { status: "recovery_required", reason };
    }
    try {
      rollback(prepared, options.fault);
      cleanup(prepared, options.fault);
    } catch (rollbackError) {
      const recoveryReason: MemoryClearReason = rollbackError instanceof Error && rollbackError.message === "fingerprint-conflict"
        ? "fingerprint-conflict"
        : "rollback-failed";
      try { writeJournal(prepared, "recovery_required", recoveryReason); } catch { /* retain existing durable journal */ }
      return { status: "recovery_required", reason: recoveryReason };
    }
    throw new Error("Memory clear failed");
  }
}

export function clearMemoryTransaction(options: MemoryClearOptions): MemoryClearResult {
  const existing = readJournal(options.userDataPath);
  if (existing?.journal.phase === "recovery_required") return { status: "recovery_required", reason: existing.journal.reason };
  const unreadableReason = unreadableJournalReason(options.userDataPath);
  if (!existing && unreadableReason) return { status: "recovery_required", reason: unreadableReason };
  if (!existing && existsSync(paths(options.userDataPath).root)) removePath(paths(options.userDataPath).root);
  let prepared: Prepared;
  try {
    prepared = prepareMemoryClear(options);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Memory clear unavailable: ")) throw error;
    if (error instanceof Error && error.message === "memory-clear-recovery:prepare-failed") {
      return { status: "recovery_required", reason: "prepare-failed" };
    }
    throw new Error("Memory clear failed");
  }
  return commitMemoryClear(prepared, options);
}

function allAt(prepared: Prepared, fingerprints: "source" | "target"): boolean {
  return PARTICIPANTS.every((participant) => currentFingerprint(participantPath(prepared, participant)) === prepared.snapshots[participant][fingerprints === "source" ? "fingerprint" : "targetFingerprint"]);
}

function validateNextArtifacts(prepared: Prepared): void {
  for (const participant of PARTICIPANTS) {
    const snapshot = prepared.snapshots[participant];
    const current = currentFingerprint(participantPath(prepared, participant));
    const next = fingerprint(readSnapshot(artifactPath(prepared, "next", participant)));
    if (current === snapshot.targetFingerprint) {
      if (next !== MISSING_FINGERPRINT) throw new Error("fingerprint-conflict");
      continue;
    }
    if (current === snapshot.fingerprint || (current === MISSING_FINGERPRINT && snapshot.exists && snapshot.targetExists)) {
      if (next !== snapshot.targetFingerprint) throw new Error("fingerprint-conflict");
      continue;
    }
    throw new Error("fingerprint-conflict");
  }
}

function validateBackupArtifacts(prepared: Prepared, phase: MemoryClearPhase): void {
  for (const participant of PARTICIPANTS) {
    const snapshot = prepared.snapshots[participant];
    const currentSnapshot = readSnapshot(participantPath(prepared, participant));
    const current = fingerprint(currentSnapshot);
    const backupSnapshot = readSnapshot(artifactPath(prepared, "backup", participant));
    const backup = fingerprint(backupSnapshot);
    if (!snapshot.exists) {
      if (backup !== MISSING_FINGERPRINT) throw new Error("fingerprint-conflict");
      continue;
    }
    if (current === snapshot.fingerprint) {
      if (currentSnapshot.bytes === null || backupSnapshot.bytes === null || !currentSnapshot.bytes.equals(backupSnapshot.bytes)) {
        throw new Error("fingerprint-conflict");
      }
      continue;
    }
    if (current === snapshot.targetFingerprint || (current === MISSING_FINGERPRINT && snapshot.targetExists)) {
      if (backup === snapshot.fingerprint || (phase === "cleanup" && backup === MISSING_FINGERPRINT)) continue;
    }
    throw new Error("fingerprint-conflict");
  }
}

export function recoverMemoryClearTransactions(options: MemoryClearOptions): MemoryClearRecoveryResult {
  const entry = readJournal(options.userDataPath);
  if (!entry) {
    const unreadableReason = unreadableJournalReason(options.userDataPath);
    if (unreadableReason) return { status: "recovery_required", reason: unreadableReason };
    const resolved = paths(options.userDataPath);
    if (existsSync(resolved.root)) {
      removePath(resolved.root);
      return { status: "recovered" };
    }
    return { status: "clean" };
  }
  const { journal, prepared } = entry;
  if (journal.phase === "recovery_required") return { status: "recovery_required", reason: journal.reason };
  let action: "validate" | "forward" | "rollback" | "cleanup-prepared" | "cleanup-committed" = "validate";
  try {
    validateNextArtifacts(prepared);
    validateBackupArtifacts(prepared, journal.phase);
    if (journal.phase === "prepared" && (allAt(prepared, "source") || allAt(prepared, "target"))) {
      action = allAt(prepared, "target") ? "cleanup-committed" : "cleanup-prepared";
      cleanup(prepared, options.fault);
      return { status: "recovered" };
    }
    if (journal.phase === "reviews-committed") {
      const reviewAtTarget = currentFingerprint(participantPath(prepared, "reviews")) === prepared.snapshots.reviews.targetFingerprint;
      const factsAtSource = currentFingerprint(participantPath(prepared, "facts")) === prepared.snapshots.facts.fingerprint;
      const profileAtSource = currentFingerprint(participantPath(prepared, "profile")) === prepared.snapshots.profile.fingerprint;
      if (reviewAtTarget && factsAtSource && profileAtSource) {
        action = "forward";
        applyParticipant(prepared, "facts", options.fault);
        applyParticipant(prepared, "profile", options.fault);
        writeJournal(prepared, "facts-committed", "committed", options.fault);
        action = "cleanup-committed";
        cleanup(prepared, options.fault);
        return { status: "recovered" };
      }
    }
    if (journal.phase === "facts-committed") {
      if (!allAt(prepared, "target")) throw new Error("fingerprint-conflict");
      action = "cleanup-committed";
      cleanup(prepared, options.fault);
      return { status: "recovered" };
    }
    if (journal.phase === "cleanup") {
      if (!allAt(prepared, "target")) throw new Error("fingerprint-conflict");
      action = "cleanup-committed";
      cleanup(prepared, options.fault);
      return { status: "recovered" };
    }
    action = "rollback";
    rollback(prepared, options.fault);
    action = "cleanup-prepared";
    cleanup(prepared, options.fault);
    return { status: "recovered" };
  } catch (error) {
    let reason: MemoryClearReason;
    if (error instanceof Error && error.message === "fingerprint-conflict") reason = "fingerprint-conflict";
    else if (action === "forward") reason = "forward-failed";
    else if (action === "rollback") reason = "rollback-failed";
    else if (action === "cleanup-committed") reason = "cleanup-pending";
    else reason = "prepare-failed";
    try {
      if (reason === "cleanup-pending") writeJournal(prepared, "cleanup", reason);
      else writeJournal(prepared, "recovery_required", reason);
    } catch { /* keep durable state */ }
    return { status: "recovery_required", reason };
  }
}
