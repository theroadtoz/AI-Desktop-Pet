export const HISTORY_RETENTION_LIMITS = [2_048] as const;
export const DEFAULT_HISTORY_RETENTION_LIMIT = 2_048;

export type HistoryRetentionLimit = (typeof HISTORY_RETENTION_LIMITS)[number];

export function isHistoryRetentionLimit(value: unknown): value is HistoryRetentionLimit {
  return value === DEFAULT_HISTORY_RETENTION_LIMIT;
}

export function normalizeStoredHistoryRetentionLimit(value: unknown): HistoryRetentionLimit | null {
  return value === 100 || value === 500 || value === 1_000 || value === DEFAULT_HISTORY_RETENTION_LIMIT
    ? DEFAULT_HISTORY_RETENTION_LIMIT
    : null;
}
