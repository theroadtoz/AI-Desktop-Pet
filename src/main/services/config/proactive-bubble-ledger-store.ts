import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  isProactiveSpeechBubbleLineId,
  type ProactiveSpeechBubbleLineId
} from "../../../shared/proactive-speech-bubble";
import type { ProactiveCompanionCadence } from "../../../shared/proactive-companion-settings";

export const PROACTIVE_BUBBLE_LEDGER_SCHEMA_VERSION = 1 as const;

export const PROACTIVE_BUBBLE_CANDIDATE_CLASSES = [
  "startup",
  "environment",
  "silence",
  "source"
] as const;

export type ProactiveBubbleCandidateClass = typeof PROACTIVE_BUBBLE_CANDIDATE_CLASSES[number];
export type ProactiveBubbleBudgetSkipReason =
  | "global_cooldown"
  | "class_cooldown"
  | "line_cooldown"
  | "daily_total_limit"
  | "daily_class_limit"
  | "startup_daily_limit";

type ProactiveBubbleLedger = {
  schemaVersion: typeof PROACTIVE_BUBBLE_LEDGER_SCHEMA_VERSION;
  dateKey: string;
  dailyTotal: number;
  dailyClassCounts: Partial<Record<ProactiveBubbleCandidateClass, number>>;
  lastShownAtMs: number | null;
  lastClassShownAtMs: Partial<Record<ProactiveBubbleCandidateClass, number>>;
  lastLineShownAtMs: Partial<Record<ProactiveSpeechBubbleLineId, number>>;
  startupDateKey: string | null;
};

export type ProactiveBubbleLedgerStore = {
  canShow(input: {
    cadence: Exclude<ProactiveCompanionCadence, "off">;
    candidateClass: ProactiveBubbleCandidateClass;
    lineId: ProactiveSpeechBubbleLineId;
    nowMs: number;
    dateKey: string;
  }): ProactiveBubbleBudgetSkipReason | null;
  recordShown(input: {
    candidateClass: ProactiveBubbleCandidateClass;
    lineId: ProactiveSpeechBubbleLineId;
    nowMs: number;
    dateKey: string;
  }): void;
  getLedgerPath(): string;
};

const BUDGETS = {
  normal: {
    globalCooldownMs: 30 * 60_000,
    classCooldownMs: { environment: 4 * 60 * 60_000, silence: 6 * 60 * 60_000, source: 60 * 60_000 },
    lineCooldownMs: 24 * 60 * 60_000,
    dailyTotal: 4,
    dailyClass: { environment: 2, silence: 1, source: 2 }
  },
  quiet: {
    globalCooldownMs: 90 * 60_000,
    classCooldownMs: { environment: 12 * 60 * 60_000, silence: 18 * 60 * 60_000, source: 3 * 60 * 60_000 },
    lineCooldownMs: 48 * 60 * 60_000,
    dailyTotal: 2,
    dailyClass: { environment: 1, silence: 1, source: 1 }
  }
} as const;

export function createProactiveBubbleLedgerStore(
  options: { userDataPath?: string } = {}
): ProactiveBubbleLedgerStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const ledgerPath = join(userDataPath, "config", "proactive-bubble-ledger.json");
  let ledger = readLedger(ledgerPath);

  function rollDate(dateKey: string): void {
    if (ledger.dateKey === dateKey) {
      return;
    }
    ledger = {
      ...ledger,
      dateKey,
      dailyTotal: 0,
      dailyClassCounts: {}
    };
  }

  function save(): void {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  }

  return {
    canShow(input) {
      rollDate(input.dateKey);
      if (input.candidateClass === "startup") {
        return ledger.startupDateKey === input.dateKey ? "startup_daily_limit" : null;
      }

      const budget = BUDGETS[input.cadence];
      if (ledger.dailyTotal >= budget.dailyTotal) {
        return "daily_total_limit";
      }
      const classLimit = budget.dailyClass[input.candidateClass];
      if ((ledger.dailyClassCounts[input.candidateClass] ?? 0) >= classLimit) {
        return "daily_class_limit";
      }
      if (isWithinCooldown(input.nowMs, ledger.lastShownAtMs, budget.globalCooldownMs)) {
        return "global_cooldown";
      }
      if (isWithinCooldown(
        input.nowMs,
        ledger.lastClassShownAtMs[input.candidateClass] ?? null,
        budget.classCooldownMs[input.candidateClass]
      )) {
        return "class_cooldown";
      }
      if (isWithinCooldown(
        input.nowMs,
        ledger.lastLineShownAtMs[input.lineId] ?? null,
        budget.lineCooldownMs
      )) {
        return "line_cooldown";
      }
      return null;
    },
    recordShown(input) {
      rollDate(input.dateKey);
      if (input.candidateClass === "startup") {
        ledger.startupDateKey = input.dateKey;
      } else {
        ledger.dailyTotal += 1;
        ledger.dailyClassCounts[input.candidateClass] =
          (ledger.dailyClassCounts[input.candidateClass] ?? 0) + 1;
        ledger.lastShownAtMs = input.nowMs;
        ledger.lastClassShownAtMs[input.candidateClass] = input.nowMs;
      }
      ledger.lastLineShownAtMs[input.lineId] = input.nowMs;
      save();
    },
    getLedgerPath() {
      return ledgerPath;
    }
  };
}

function createEmptyLedger(): ProactiveBubbleLedger {
  return {
    schemaVersion: PROACTIVE_BUBBLE_LEDGER_SCHEMA_VERSION,
    dateKey: "",
    dailyTotal: 0,
    dailyClassCounts: {},
    lastShownAtMs: null,
    lastClassShownAtMs: {},
    lastLineShownAtMs: {},
    startupDateKey: null
  };
}

function readLedger(path: string): ProactiveBubbleLedger {
  if (!existsSync(path)) {
    return createEmptyLedger();
  }
  try {
    return normalizeLedger(JSON.parse(readFileSync(path, "utf8"))) ?? createEmptyLedger();
  } catch {
    return createEmptyLedger();
  }
}

function normalizeLedger(value: unknown): ProactiveBubbleLedger | null {
  if (!isRecord(value) || value.schemaVersion !== PROACTIVE_BUBBLE_LEDGER_SCHEMA_VERSION) {
    return null;
  }
  if (!isDateKey(value.dateKey) || !isCount(value.dailyTotal) ||
    !isSafeTimestamp(value.lastShownAtMs) || !isNullableDateKey(value.startupDateKey)) {
    return null;
  }
  const dailyClassCounts = parseClassRecord(value.dailyClassCounts, isCount);
  const lastClassShownAtMs = parseClassRecord(value.lastClassShownAtMs, isTimestamp);
  const lastLineShownAtMs = parseLineRecord(value.lastLineShownAtMs);
  if (!dailyClassCounts || !lastClassShownAtMs || !lastLineShownAtMs) {
    return null;
  }
  return {
    schemaVersion: PROACTIVE_BUBBLE_LEDGER_SCHEMA_VERSION,
    dateKey: value.dateKey,
    dailyTotal: value.dailyTotal,
    dailyClassCounts,
    lastShownAtMs: value.lastShownAtMs,
    lastClassShownAtMs,
    lastLineShownAtMs,
    startupDateKey: value.startupDateKey
  };
}

function parseClassRecord<T extends number>(
  value: unknown,
  validate: (candidate: unknown) => candidate is T
): Partial<Record<ProactiveBubbleCandidateClass, T>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !PROACTIVE_BUBBLE_CANDIDATE_CLASSES.includes(key as ProactiveBubbleCandidateClass))) {
    return null;
  }
  const result: Partial<Record<ProactiveBubbleCandidateClass, T>> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!validate(candidate)) {
      return null;
    }
    result[key as ProactiveBubbleCandidateClass] = candidate;
  }
  return result;
}

function parseLineRecord(value: unknown): Partial<Record<ProactiveSpeechBubbleLineId, number>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Partial<Record<ProactiveSpeechBubbleLineId, number>> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isProactiveSpeechBubbleLineId(key) || !isTimestamp(candidate)) {
      return null;
    }
    result[key] = candidate;
  }
  return result;
}

function isWithinCooldown(nowMs: number, lastMs: number | null, cooldownMs: number): boolean {
  return lastMs !== null && nowMs >= lastMs && nowMs - lastMs < cooldownMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/u.test(value));
}

function isNullableDateKey(value: unknown): value is string | null {
  return value === null || isDateKey(value);
}
