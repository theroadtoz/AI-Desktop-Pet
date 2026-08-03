export const HISTORY_RETENTION_LIMITS = [100, 500, 1_000] as const;
export const DEFAULT_HISTORY_RETENTION_LIMIT = 500;

export type HistoryRetentionLimit = (typeof HISTORY_RETENTION_LIMITS)[number];

export function isHistoryRetentionLimit(value: unknown): value is HistoryRetentionLimit {
  return value === 100 || value === 500 || value === 1_000;
}

export function normalizeStoredHistoryRetentionLimit(value: unknown): HistoryRetentionLimit | null {
  return isHistoryRetentionLimit(value) ? value : value === 2_048 ? DEFAULT_HISTORY_RETENTION_LIMIT : null;
}
