import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  type WebSearchSettings,
  type WebSearchStatus
} from "../../../shared/web-search";

type StoreFile = Partial<WebSearchSettings>;

const MAX_COMMAND_LENGTH = 260;
const MAX_ARG_LENGTH = 260;
const MAX_ARGS = 12;
const MAX_TOOL_NAME_LENGTH = 80;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_RESULTS = 1;
const MAX_RESULTS = 5;

export type WebSearchSettingsStore = {
  getSettings(): WebSearchSettings;
  getStatus(): WebSearchStatus;
  saveSettings(update: unknown): WebSearchSettings;
};

export function createWebSearchSettingsStore(options: { userDataPath: string }): WebSearchSettingsStore {
  const settingsPath = join(options.userDataPath, "config", "web-search-settings.json");
  let settings = normalizeSettings(readSettingsFile(settingsPath), existsSync(settingsPath));

  function save(): void {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  return {
    getSettings() {
      return cloneSettings(settings);
    },
    getStatus() {
      return createStatus(settings);
    },
    saveSettings(update) {
      settings = normalizeSettings(update, true);
      save();
      return cloneSettings(settings);
    }
  };
}

export function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  return normalizeSettings(value, true);
}

function readSettingsFile(settingsPath: string): StoreFile {
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? parsed as StoreFile : {};
  } catch {
    return {};
  }
}

function normalizeSettings(value: unknown, hasSettingsFile: boolean): WebSearchSettings {
  const input = value as StoreFile | null;
  const command = normalizeCommand(input?.command);
  const shouldUseDefaultPreset = shouldUseDefaultWebSearchPreset(input, hasSettingsFile, command);
  const normalizedCommand = shouldUseDefaultPreset ? DEFAULT_WEB_SEARCH_SETTINGS.command : command;

  return {
    enabled: shouldUseDefaultPreset ? DEFAULT_WEB_SEARCH_SETTINGS.enabled : input?.enabled === true && normalizedCommand.length > 0,
    command: normalizedCommand,
    args: shouldUseDefaultPreset ? [...DEFAULT_WEB_SEARCH_SETTINGS.args] : normalizeArgs(input?.args),
    toolName: shouldUseDefaultPreset ? DEFAULT_WEB_SEARCH_SETTINGS.toolName : normalizeToolName(input?.toolName),
    timeoutMs: shouldUseDefaultPreset
      ? DEFAULT_WEB_SEARCH_SETTINGS.timeoutMs
      : normalizeInteger(input?.timeoutMs, DEFAULT_WEB_SEARCH_SETTINGS.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxResults: shouldUseDefaultPreset
      ? DEFAULT_WEB_SEARCH_SETTINGS.maxResults
      : normalizeInteger(input?.maxResults, DEFAULT_WEB_SEARCH_SETTINGS.maxResults, MIN_RESULTS, MAX_RESULTS)
  };
}

function shouldUseDefaultWebSearchPreset(input: StoreFile | null, hasSettingsFile: boolean, command: string): boolean {
  if (command.length > 0) {
    return false;
  }

  if (!hasSettingsFile) {
    return true;
  }

  return Boolean(
    input &&
    input.enabled !== false &&
    (input.command === undefined || input.command === "") &&
    (input.args === undefined || Array.isArray(input.args) && input.args.length === 0) &&
    (input.toolName === undefined || input.toolName === "" || input.toolName === "brave_web_search")
  );
}

function cloneSettings(settings: WebSearchSettings): WebSearchSettings {
  return {
    ...settings,
    args: [...settings.args]
  };
}

function createStatus(settings: WebSearchSettings): WebSearchStatus {
  return {
    enabled: settings.enabled,
    commandConfigured: settings.command.length > 0,
    ...(settings.command ? { commandName: basename(settings.command) } : {}),
    argsCount: settings.args.length,
    toolName: settings.toolName,
    timeoutMs: settings.timeoutMs,
    maxResults: settings.maxResults
  };
}

function normalizeCommand(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  if (trimmed.length > MAX_COMMAND_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((arg): arg is string => typeof arg === "string")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0 && arg.length <= MAX_ARG_LENGTH && !/[\u0000-\u001f\u007f]/.test(arg))
    .slice(0, MAX_ARGS);
}

function normalizeToolName(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_WEB_SEARCH_SETTINGS.toolName;
  }

  const trimmed = value.trim();

  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed) || trimmed.length > MAX_TOOL_NAME_LENGTH) {
    return DEFAULT_WEB_SEARCH_SETTINGS.toolName;
  }

  return trimmed;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}
