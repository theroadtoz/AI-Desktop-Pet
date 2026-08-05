import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  truncateSync,
  writeSync
} from "node:fs";
import { join, resolve } from "node:path";
import { isPetInteractionActionType } from "../../shared/interaction-action-catalog.ts";
import { isPetActionTriggerReason } from "../../shared/pet-action-trigger.ts";

export type AcceptanceEvidenceSuite = "p2-85" | "p2-88b";

type AcceptanceEvidenceFileSystem = {
  closeSync: typeof closeSync;
  existsSync: typeof existsSync;
  fsyncSync: typeof fsyncSync;
  mkdirSync: typeof mkdirSync;
  openSync: typeof openSync;
  readFileSync: typeof readFileSync;
  readdirSync: typeof readdirSync;
  statSync: typeof statSync;
  truncateSync: typeof truncateSync;
  writeSync: typeof writeSync;
};

const defaultFileSystem: AcceptanceEvidenceFileSystem = {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, statSync, truncateSync, writeSync
};

const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAIN_REQUEST_ID = /^[a-f0-9]{32}$/u;
const ACTION_INSTANCE_ID = /^renderer_action_[1-9][0-9]{0,9}$/u;
const TERMINAL_STATUSES = new Set(["completed", "interrupted", "timed_out", "failed"]);
const SKIP_REASONS = new Set([
  "active_action", "global_cooldown", "head_pat_cooldown",
  "same_action_cooldown", "window_shake_feedback_cooldown"
]);
const INTERACTION_REASONS = new Set([
  "startup_first_visible_frame", "click_head", "click_body", "window_shake_feedback",
  "chat_opened", "chat_input_focus", "chat_reply_waiting", "pet_edge_settled",
  "rapid_touch_combo", "chat_reply_sustain", "chat_reply_completed",
  "state_music_playing_stable", "state_game_presence_stable", "return_from_idle",
  "evening_companion_tick", "long_work_session_complete", "state_idle", "state_greet",
  "state_listen", "state_think", "state_reply_sustain", "state_sleep", "state_work",
  "state_game", "state_read", "state_edge", "state_flustered", "state_local_model_busy",
  "state_memory_injected", "state_memory_skipped", "state_search_cited",
  "state_proactive_bubble_visible"
]);
const P285_SCENARIO_IDS = new Set([
  "chat_opened_replace_active", "reply_visible_generic_once",
  "explicit_game_single_presentation", "proactive_suppress_single_defer"
]);
const P285_REJECTION_REASONS = new Set([
  "pending_observation", "baseline_pending", "baseline_not_closed", "baseline_reset_failed",
  "state_listen_rejected", "chat_open_failed", "chat_open_replacement_missing",
  "affect_not_suppressed", "reply_not_allowed", "reply_dispatch_rejected",
  "explicit_game_fixture_disabled", "controller_unavailable", "controller_threw"
]);
const P285_PROACTIVE_STATES = new Set(["queued", "attempted", "shown", "skipped", "expired"]);
const P288_GATE_REASONS = new Set(["allowed", "presentation_busy"]);
const DISPATCH_REASONS = new Set([
  "accepted", "busy", "invalid_policy", "unsafe_request_id", "duplicate_request_id",
  "request_id_failed", "send_failed"
]);
const FORBIDDEN_KEY = /(?:body|prompt|path|host|model|key|metadata|raw|error|conversation|timestamp)/iu;

type EvidenceRoot = {
  runId: string;
  suite: AcceptanceEvidenceSuite;
  type: string;
  payload: Record<string, unknown>;
};

export type AcceptanceEvidenceReadResult =
  | { ok: true; events: EvidenceRoot[] }
  | { ok: false; reason: "invalid_run_id" | "foreign_entry" | "corrupt_evidence" | "read_failed" };

export function isCanonicalAcceptanceRunId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_V4.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasNoForbiddenKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => !FORBIDDEN_KEY.test(key));
}

function isKnownInteractionReason(value: unknown): value is string {
  return typeof value === "string" && INTERACTION_REASONS.has(value);
}

function hasExactLifecycleIdentity(payload: Record<string, unknown>): boolean {
  const hasRequestId = Object.hasOwn(payload, "requestId");
  const hasActionInstanceId = Object.hasOwn(payload, "actionInstanceId");
  if (hasRequestId === hasActionInstanceId) return false;
  return hasRequestId
    ? typeof payload.requestId === "string" && MAIN_REQUEST_ID.test(payload.requestId)
    : typeof payload.actionInstanceId === "string" && ACTION_INSTANCE_ID.test(payload.actionInstanceId as string);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isP285Observation(payload: Record<string, unknown>): boolean {
  const scenarioId = payload.scenarioId;
  if (scenarioId === "chat_opened_replace_active") {
    return hasExactKeys(payload, [
      "scenarioId", "runtimeBoundary", "actionAttempted", "requestId", "replacedRequestId",
      "replacementAccepted", "lateLifecycleIgnored", "terminalObserved"
    ]) && payload.runtimeBoundary === "live_renderer_chain" && typeof payload.actionAttempted === "boolean" &&
      typeof payload.requestId === "string" && MAIN_REQUEST_ID.test(payload.requestId) &&
      typeof payload.replacedRequestId === "string" && MAIN_REQUEST_ID.test(payload.replacedRequestId) &&
      typeof payload.replacementAccepted === "boolean" && typeof payload.lateLifecycleIgnored === "boolean" &&
      typeof payload.terminalObserved === "boolean";
  }
  if (scenarioId === "reply_visible_generic_once") {
    return hasExactKeys(payload, [
      "scenarioId", "runtimeBoundary", "actionAttempted", "requestId", "terminalObserved",
      "affectActionAttempted", "genericReplyActionAttempted", "actionRequestCount", "streamCompleted"
    ]) && payload.runtimeBoundary === "live_renderer_chain" && typeof payload.actionAttempted === "boolean" &&
      typeof payload.requestId === "string" && MAIN_REQUEST_ID.test(payload.requestId) &&
      typeof payload.terminalObserved === "boolean" && typeof payload.affectActionAttempted === "boolean" &&
      typeof payload.genericReplyActionAttempted === "boolean" && isNonNegativeInteger(payload.actionRequestCount) &&
      typeof payload.streamCompleted === "boolean";
  }
  if (scenarioId === "explicit_game_single_presentation") {
    return hasExactKeys(payload, [
      "scenarioId", "runtimeBoundary", "actionAttempted", "proactiveCandidateId",
      "proactiveCandidateCount", "proactiveCandidateOutcome", "automaticModeActionCount"
    ]) && payload.runtimeBoundary === "live_global_p2_83a_fixture" && typeof payload.actionAttempted === "boolean" &&
      payload.proactiveCandidateId === "explicit_game_started" && isNonNegativeInteger(payload.proactiveCandidateCount) &&
      P285_PROACTIVE_STATES.has(payload.proactiveCandidateOutcome as string) &&
      isNonNegativeInteger(payload.automaticModeActionCount);
  }
  if (scenarioId !== "proactive_suppress_single_defer") return false;
  const hasTerminalAt = Object.hasOwn(payload, "terminalAtMs");
  return hasExactKeys(payload, hasTerminalAt
    ? [
        "scenarioId", "runtimeBoundary", "actionAttempted", "suppressedTerminal", "deferredOnce",
        "deferredReplayed", "ttlExtended", "deferQueuedAtMs", "originalExpiresAtMs",
        "firstBeyondOriginalTtlTickAtMs", "terminalAtMs", "tickCount"
      ]
    : [
        "scenarioId", "runtimeBoundary", "actionAttempted", "suppressedTerminal", "deferredOnce",
        "deferredReplayed", "ttlExtended", "deferQueuedAtMs", "originalExpiresAtMs",
        "firstBeyondOriginalTtlTickAtMs", "tickCount"
      ]) && payload.runtimeBoundary === "deterministic_main_module_contract" &&
    typeof payload.actionAttempted === "boolean" && typeof payload.suppressedTerminal === "boolean" &&
    typeof payload.deferredOnce === "boolean" && typeof payload.deferredReplayed === "boolean" &&
    typeof payload.ttlExtended === "boolean" && isNonNegativeInteger(payload.deferQueuedAtMs) &&
    isNonNegativeInteger(payload.originalExpiresAtMs) && isNonNegativeInteger(payload.firstBeyondOriginalTtlTickAtMs) &&
    (!hasTerminalAt || isNonNegativeInteger(payload.terminalAtMs)) && isNonNegativeInteger(payload.tickCount);
}

function isLifecyclePayload(type: string, payload: Record<string, unknown>): boolean {
  const terminalKey = type === "pet_interaction_action_finished" ? "terminalStatus"
    : type === "pet_interaction_action_skipped" ? "skipReason" : null;
  const identityKey = Object.hasOwn(payload, "requestId") ? "requestId" : "actionInstanceId";
  const expectedKeys = terminalKey
    ? ["actionType", "reason", identityKey, terminalKey]
    : ["actionType", "reason", identityKey];
  if (!hasExactKeys(payload, expectedKeys) || !hasExactLifecycleIdentity(payload)) return false;
  if (!isPetInteractionActionType(payload.actionType) || !isKnownInteractionReason(payload.reason)) return false;
  if (terminalKey === "terminalStatus") return TERMINAL_STATUSES.has(payload.terminalStatus as string);
  if (terminalKey === "skipReason") return SKIP_REASONS.has(payload.skipReason as string);
  return true;
}

function isP285Payload(type: string, payload: Record<string, unknown>): boolean {
  if (type === "p2_85_acceptance_observation") return isP285Observation(payload);
  if (type === "p2_85_acceptance_rejection") {
    return hasExactKeys(payload, ["scenarioId", "rejectionReason"]) &&
      P285_SCENARIO_IDS.has(payload.scenarioId as string) &&
      P285_REJECTION_REASONS.has(payload.rejectionReason as string);
  }
  return ["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(type) &&
    isLifecyclePayload(type, payload);
}

function isP288Payload(type: string, payload: Record<string, unknown>): boolean {
  if (type === "p2_88b_affect_reply_action_gate") {
    return hasExactKeys(payload, ["decision", "reason", "activeMainReason", "localBusyReason"]) &&
      (payload.decision === "allow" || payload.decision === "suppress") &&
      P288_GATE_REASONS.has(payload.reason as string) &&
      (payload.activeMainReason === null || isPetActionTriggerReason(payload.activeMainReason)) &&
      (payload.localBusyReason === null || isKnownInteractionReason(payload.localBusyReason));
  }
  if (type === "dialogue_affect_action_dispatch") {
    if (payload.status === "accepted") {
      return hasExactKeys(payload, ["status", "reason", "requestId"]) &&
        payload.reason === "accepted" && typeof payload.requestId === "string" && MAIN_REQUEST_ID.test(payload.requestId);
    }
    return payload.status === "rejected" && hasExactKeys(payload, ["status", "reason"]) &&
      DISPATCH_REASONS.has(payload.reason as string) && payload.reason !== "accepted";
  }
  return ["pet_interaction_action_started", "pet_interaction_action_finished", "pet_interaction_action_skipped"].includes(type) &&
    isLifecyclePayload(type, payload);
}

export function parseAcceptanceEvidenceEvent(value: unknown, expected?: { runId: string; suite: AcceptanceEvidenceSuite }): EvidenceRoot | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["runId", "suite", "type", "payload"])) return null;
  if (!isCanonicalAcceptanceRunId(value.runId) || (value.suite !== "p2-85" && value.suite !== "p2-88b")) return null;
  if (expected && (value.runId !== expected.runId || value.suite !== expected.suite)) return null;
  if (typeof value.type !== "string" || !isPlainRecord(value.payload) || !hasNoForbiddenKeys(value.payload)) return null;
  const payloadOk = value.suite === "p2-85"
    ? isP285Payload(value.type, value.payload)
    : isP288Payload(value.type, value.payload);
  return payloadOk ? value as EvidenceRoot : null;
}

function evidencePaths(userDataPath: string, runId: string) {
  const parent = resolve(userDataPath, "acceptance-evidence");
  const filePath = resolve(parent, `${runId}.ndjson`);
  if (filePath !== join(parent, `${runId}.ndjson`)) return null;
  return { parent, filePath };
}

export function readAcceptanceEvidence(options: {
  userDataPath: string;
  runId: unknown;
  expectedSuite: AcceptanceEvidenceSuite;
  fileSystem?: AcceptanceEvidenceFileSystem;
}): AcceptanceEvidenceReadResult {
  if (!isCanonicalAcceptanceRunId(options.runId)) return { ok: false, reason: "invalid_run_id" };
  const paths = evidencePaths(options.userDataPath, options.runId);
  if (!paths) return { ok: false, reason: "invalid_run_id" };
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  try {
    if (!fileSystem.existsSync(paths.parent)) return { ok: true, events: [] };
    const entries = fileSystem.readdirSync(paths.parent);
    if (entries.some((name) => name !== `${options.runId}.ndjson`)) return { ok: false, reason: "foreign_entry" };
    if (!fileSystem.existsSync(paths.filePath)) return { ok: true, events: [] };
    const buffer = fileSystem.readFileSync(paths.filePath);
    if (buffer.length === 0) return { ok: true, events: [] };
    const raw = buffer.toString("utf8");
    if (raw.includes("\uFFFD") || !raw.endsWith("\n")) return { ok: false, reason: "corrupt_evidence" };
    const events: EvidenceRoot[] = [];
    for (const line of raw.slice(0, -1).split("\n")) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { return { ok: false, reason: "corrupt_evidence" }; }
      const event = parseAcceptanceEvidenceEvent(parsed, { runId: options.runId, suite: options.expectedSuite });
      if (!event) return { ok: false, reason: "corrupt_evidence" };
      events.push(event);
    }
    return { ok: true, events };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

export function createAcceptanceEvidenceService(options: {
  userDataPath: string;
  isPackaged: boolean;
  acceptanceTelemetryEnabled: boolean;
  runId?: unknown;
  p285ObservationEnabled?: boolean;
  p285FixtureEnabled?: boolean;
  p288bFixtureEnabled?: boolean;
  fileSystem?: AcceptanceEvidenceFileSystem;
}) {
  const p285Enabled = options.p285ObservationEnabled === true && options.p285FixtureEnabled === true;
  const p288Enabled = options.p288bFixtureEnabled === true;
  const suite: AcceptanceEvidenceSuite | null = p285Enabled !== p288Enabled
    ? p285Enabled ? "p2-85" : "p2-88b"
    : null;
  const enabled = options.isPackaged === false && options.acceptanceTelemetryEnabled === true &&
    isCanonicalAcceptanceRunId(options.runId) && suite !== null;
  const paths = enabled ? evidencePaths(options.userDataPath, options.runId as string) : null;
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  let failed = false;

  return {
    enabled,
    filePath: paths?.filePath ?? null,
    report(event: unknown): boolean {
      if (!enabled || !paths || !suite || failed || !isPlainRecord(event) || !hasExactKeys(event, ["type", "payload"])) return false;
      const root = parseAcceptanceEvidenceEvent({
        runId: options.runId,
        suite,
        type: event.type,
        payload: event.payload
      }, { runId: options.runId as string, suite });
      if (!root) return false;
      let descriptor: number | null = null;
      let previousSize = 0;
      try {
        if (!fileSystem.existsSync(paths.parent)) fileSystem.mkdirSync(paths.parent, { recursive: true });
        const existing = readAcceptanceEvidence({
          userDataPath: options.userDataPath,
          runId: options.runId,
          expectedSuite: suite,
          fileSystem
        });
        if (!existing.ok) throw new Error(existing.reason);
        previousSize = fileSystem.existsSync(paths.filePath) ? fileSystem.statSync(paths.filePath).size : 0;
        const line = `${JSON.stringify(root)}\n`;
        descriptor = fileSystem.openSync(paths.filePath, "a");
        const written = fileSystem.writeSync(descriptor, line, null, "utf8");
        if (written !== Buffer.byteLength(line)) throw new Error("short_write");
        fileSystem.fsyncSync(descriptor);
        fileSystem.closeSync(descriptor);
        descriptor = null;
        return true;
      } catch {
        if (descriptor !== null) {
          try { fileSystem.closeSync(descriptor); } catch { /* fail closed below */ }
        }
        try {
          if (fileSystem.existsSync(paths.filePath)) fileSystem.truncateSync(paths.filePath, previousSize);
        } catch { /* retained failed state */ }
        failed = true;
        return false;
      }
    },
    close(): boolean {
      return enabled && !failed;
    }
  };
}
