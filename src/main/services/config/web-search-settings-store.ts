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
const HISTORICAL_GOOGLE_WEB_SEARCH_PRESET = {
  command: "npx.cmd",
  args: ["-y", "@mcp-server/google-search-mcp@latest"],
  toolName: "search",
  timeoutMs: 60_000,
  maxResults: 3
} as const;
const HISTORICAL_P2_56_WEB_SEARCH_PRESET = {
  command: "npx.cmd",
  args: ["-y", "open-websearch@latest"],
  toolName: "search",
  timeoutMs: 60_000,
  maxResults: 3
} as const;
const HISTORICAL_PINNED_OPEN_WEB_SEARCH_PRESET = {
  command: "npx.cmd",
  args: ["-y", "open-websearch@2.1.11"],
  toolName: "search",
  timeoutMs: 60_000,
  maxResults: 3
} as const;
const HISTORICAL_WEB_SEARCH_PRESETS = [
  HISTORICAL_GOOGLE_WEB_SEARCH_PRESET,
  HISTORICAL_P2_56_WEB_SEARCH_PRESET,
  HISTORICAL_PINNED_OPEN_WEB_SEARCH_PRESET
] as const;

export type WebSearchSettingsStore = {
  getSettings(): WebSearchSettings;
  getStatus(): WebSearchStatus;
  saveSettings(update: unknown): WebSearchSettings;
};

export function createWebSearchSettingsStore(options: { userDataPath: string }): WebSearchSettingsStore {
  const settingsPath = join(options.userDataPath, "config", "web-search-settings.json");
  let settings = normalizeSettings(readSettingsFile(settingsPath), existsSync(settingsPath), true);

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
      assertSupportedUpdate(update);
      const nextSettings = normalizeSettings(update, true);
      assertSupportedSettings(nextSettings);
      settings = nextSettings;
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

function normalizeSettings(value: unknown, hasSettingsFile: boolean, disableUnsupported = false): WebSearchSettings {
  const input = value as StoreFile | null;
  const command = normalizeCommand(input?.command);
  const shouldUseDefaultPreset = shouldUseDefaultWebSearchPreset(input, hasSettingsFile, command);
  const shouldMigrateHistoricalPreset = isHistoricalDefaultPreset(input);
  const shouldUseBundledPreset = shouldUseDefaultPreset || shouldMigrateHistoricalPreset;
  const normalizedCommand = shouldUseBundledPreset ? DEFAULT_WEB_SEARCH_SETTINGS.command : command;
  const normalizedArgs = shouldUseBundledPreset ? [...DEFAULT_WEB_SEARCH_SETTINGS.args] : normalizeArgs(input?.args);
  const shouldPinBundledToolName = isSupportedCommandProfile(normalizedCommand, normalizedArgs);

  return {
    enabled: shouldUseBundledPreset
      ? DEFAULT_WEB_SEARCH_SETTINGS.enabled
      : input?.enabled === true &&
        normalizedCommand.length > 0 &&
        (!disableUnsupported || isSupportedCommandProfile(normalizedCommand, normalizeArgs(input?.args))),
    command: normalizedCommand,
    args: normalizedArgs,
    toolName: shouldPinBundledToolName ? DEFAULT_WEB_SEARCH_SETTINGS.toolName : normalizeToolName(input?.toolName),
    timeoutMs: shouldUseBundledPreset
      ? DEFAULT_WEB_SEARCH_SETTINGS.timeoutMs
      : normalizeInteger(input?.timeoutMs, DEFAULT_WEB_SEARCH_SETTINGS.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxResults: shouldUseBundledPreset
      ? DEFAULT_WEB_SEARCH_SETTINGS.maxResults
      : normalizeInteger(input?.maxResults, DEFAULT_WEB_SEARCH_SETTINGS.maxResults, MIN_RESULTS, MAX_RESULTS)
  };
}

function assertSupportedUpdate(value: unknown): void {
  const input = value as StoreFile | null;
  assertSupportedProfile(
    normalizeCommand(input?.command),
    normalizeArgs(input?.args),
    normalizeToolName(input?.toolName)
  );
}

function assertSupportedSettings(settings: WebSearchSettings): void {
  assertSupportedProfile(settings.command, settings.args, settings.toolName);
}

function assertSupportedProfile(command: string, args: readonly string[], toolName: string): void {
  if (isSupportedCommandProfile(command, args) && toolName === DEFAULT_WEB_SEARCH_SETTINGS.toolName) {
    return;
  }
  const error = new Error("web_search_settings_not_supported");
  error.name = "web_search_settings_not_supported";
  throw error;
}

function isSupportedCommandProfile(command: string, args: readonly string[]): boolean {
  return command === DEFAULT_WEB_SEARCH_SETTINGS.command && args.length === 0;
}

function isHistoricalDefaultPreset(input: StoreFile | null): boolean {
  return Boolean(input && typeof input.enabled === "boolean" && HISTORICAL_WEB_SEARCH_PRESETS.some((preset) =>
    input.command === preset.command &&
    Array.isArray(input.args) &&
    input.args.length === preset.args.length &&
    input.args.every((arg, index) => arg === preset.args[index]) &&
    input.toolName === preset.toolName &&
    input.timeoutMs === preset.timeoutMs &&
    input.maxResults === preset.maxResults
  ));
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
