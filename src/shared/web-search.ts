export type WebSearchPrivacyStatus = "allowed" | "blocked" | "redacted";

export type WebSearchReasonCode =
  | "explicit_search_request"
  | "freshness_required"
  | "no_search_needed"
  | "search_disabled"
  | "empty_query"
  | "sensitive_secret"
  | "personal_identifier"
  | "local_path"
  | "private_memory_request"
  | "redacted_sensitive_data"
  | "redacted_local_path"
  | "redacted_personal_identifier";

export type WebSearchPrivacyDecision = {
  status: WebSearchPrivacyStatus;
  safeQuery: string;
  reasonCodes: WebSearchReasonCode[];
  redactionSummary: string;
};

export type WebSearchResult = {
  title: string;
  snippet: string;
  url?: string;
};

export type WebSearchContext = {
  query: string;
  results: WebSearchResult[];
  provider: "mcp";
  toolName: string;
  generatedAt: string;
};

export type WebSearchSettings = {
  enabled: boolean;
  command: string;
  args: string[];
  toolName: string;
  timeoutMs: number;
  maxResults: number;
};

export type WebSearchStatus = {
  enabled: boolean;
  commandConfigured: boolean;
  commandName?: string;
  argsCount: number;
  toolName: string;
  timeoutMs: number;
  maxResults: number;
};

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  enabled: false,
  command: "",
  args: [],
  toolName: "search",
  timeoutMs: 10_000,
  maxResults: 3
};

export function isWebSearchSettings(value: unknown): value is WebSearchSettings {
  const settings = value as Partial<WebSearchSettings> | null;

  return Boolean(
    settings &&
    typeof settings.enabled === "boolean" &&
    typeof settings.command === "string" &&
    Array.isArray(settings.args) &&
    settings.args.every((arg) => typeof arg === "string") &&
    typeof settings.toolName === "string" &&
    typeof settings.timeoutMs === "number" &&
    Number.isSafeInteger(settings.timeoutMs) &&
    typeof settings.maxResults === "number" &&
    Number.isSafeInteger(settings.maxResults)
  );
}

export function isWebSearchStatus(value: unknown): value is WebSearchStatus {
  const status = value as Partial<WebSearchStatus> | null;

  return Boolean(
    status &&
    typeof status.enabled === "boolean" &&
    typeof status.commandConfigured === "boolean" &&
    (status.commandName === undefined || typeof status.commandName === "string") &&
    typeof status.argsCount === "number" &&
    Number.isSafeInteger(status.argsCount) &&
    typeof status.toolName === "string" &&
    typeof status.timeoutMs === "number" &&
    Number.isSafeInteger(status.timeoutMs) &&
    typeof status.maxResults === "number" &&
    Number.isSafeInteger(status.maxResults)
  );
}
