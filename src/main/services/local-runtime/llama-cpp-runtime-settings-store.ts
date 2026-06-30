import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  LlamaCppRuntimeSafeSummary,
  LlamaCppRuntimeSettingsUpdate
} from "../../../shared/llama-cpp-runtime";
import type {
  LlamaCppRuntimeConfig,
  LlamaCppRuntimeSummary
} from "./llama-cpp-runtime";

export type LlamaCppRuntimeSettings = {
  enabled: boolean;
  executablePath?: string;
  modelPath?: string;
  host: string;
  port?: number;
  ctxSize: number;
  alias: string;
  startupTimeoutMs: number;
  stopTimeoutMs: number;
  healthPollIntervalMs: number;
};

export type LlamaCppRuntimeSettingsStore = {
  getSettings(): LlamaCppRuntimeSettings;
  getRuntimeConfig(): LlamaCppRuntimeConfig;
  getSafeSettingsView(summary?: LlamaCppRuntimeSummary | null): LlamaCppRuntimeSafeSummary;
  updateSettings(update: LlamaCppRuntimeSettingsUpdate): LlamaCppRuntimeSafeSummary;
  setExecutablePath(executablePath: string | null): LlamaCppRuntimeSafeSummary;
  setModelPath(modelPath: string | null): LlamaCppRuntimeSafeSummary;
};

type StoreFile = Partial<Omit<LlamaCppRuntimeSettings, "port" | "ctxSize">> & {
  port?: number | null;
  ctxSize?: number | null;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CTX_SIZE = 2048;
const DEFAULT_ALIAS = "ai-desktop-pet-local";
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 200;
const MAX_ALIAS_LENGTH = 128;
const MAX_HOST_LENGTH = 253;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_CTX_SIZE = 262_144;

export function createLlamaCppRuntimeSettingsStore(options: {
  userDataPath: string;
}): LlamaCppRuntimeSettingsStore {
  const configDir = join(options.userDataPath, "config");
  const settingsPath = join(configDir, "llama-cpp-runtime.json");

  let settings = normalizeSettings(readSettingsFile(settingsPath));

  function save(): void {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  function getSafeSettingsView(summary?: LlamaCppRuntimeSummary | null): LlamaCppRuntimeSafeSummary {
    const view: LlamaCppRuntimeSafeSummary = {
      runtime: "llama.cpp",
      enabled: settings.enabled,
      status: summary?.status ?? "disabled",
      safeSummaryOnly: true,
      executableConfigured: Boolean(settings.executablePath),
      modelConfigured: Boolean(settings.modelPath),
      host: settings.host,
      ctxSize: settings.ctxSize,
      alias: settings.alias,
      startupTimeoutMs: settings.startupTimeoutMs,
      stopTimeoutMs: settings.stopTimeoutMs,
      healthPollIntervalMs: settings.healthPollIntervalMs
    };

    if (typeof settings.port === "number") {
      view.port = settings.port;
    }
    if (settings.executablePath) {
      view.executableName = basename(settings.executablePath);
    }
    if (settings.modelPath) {
      view.modelName = basename(settings.modelPath);
    }
    if (summary?.baseURLHost) {
      view.baseURLHost = summary.baseURLHost;
    }
    if (typeof summary?.durationMs === "number") {
      view.durationMs = summary.durationMs;
    }
    if (typeof summary?.startupMs === "number") {
      view.startupMs = summary.startupMs;
    }
    if (typeof summary?.exitCode !== "undefined") {
      view.exitCode = summary.exitCode;
    }
    if (typeof summary?.signal !== "undefined") {
      view.signal = summary.signal;
    }
    if (typeof summary?.stdoutBytes === "number") {
      view.stdoutBytes = summary.stdoutBytes;
    }
    if (typeof summary?.stderrBytes === "number") {
      view.stderrBytes = summary.stderrBytes;
    }
    if (summary?.reason) {
      view.reason = summary.reason;
    }

    return view;
  }

  function updateSettings(update: LlamaCppRuntimeSettingsUpdate): LlamaCppRuntimeSafeSummary {
    settings = normalizeSettings({
      ...settings,
      ...update
    });
    save();
    return getSafeSettingsView();
  }

  function setExecutablePath(executablePath: string | null): LlamaCppRuntimeSafeSummary {
    const nextSettings: StoreFile = { ...settings };
    const normalizedPath = normalizeOptionalPath(executablePath);
    if (normalizedPath) {
      nextSettings.executablePath = normalizedPath;
    } else {
      delete nextSettings.executablePath;
    }
    settings = normalizeSettings(nextSettings);
    save();
    return getSafeSettingsView();
  }

  function setModelPath(modelPath: string | null): LlamaCppRuntimeSafeSummary {
    const nextSettings: StoreFile = { ...settings };
    const normalizedPath = normalizeOptionalPath(modelPath);
    if (normalizedPath) {
      nextSettings.modelPath = normalizedPath;
    } else {
      delete nextSettings.modelPath;
    }
    settings = normalizeSettings(nextSettings);
    save();
    return getSafeSettingsView();
  }

  return {
    getSettings() {
      return { ...settings };
    },
    getRuntimeConfig() {
      return { ...settings };
    },
    getSafeSettingsView,
    updateSettings,
    setExecutablePath,
    setModelPath
  };
}

function readSettingsFile(settingsPath: string): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? parsed as StoreFile : {};
  } catch {
    return {};
  }
}

function normalizeSettings(value: StoreFile): LlamaCppRuntimeSettings {
  const executablePath = normalizeOptionalPath(value.executablePath);
  const modelPath = normalizeOptionalPath(value.modelPath);
  const port = normalizePort(value.port);

  return {
    enabled: value.enabled === true,
    ...(executablePath ? { executablePath } : {}),
    ...(modelPath ? { modelPath } : {}),
    host: normalizeHost(value.host),
    ...(port ? { port } : {}),
    ctxSize: normalizeInteger(value.ctxSize, DEFAULT_CTX_SIZE, MAX_CTX_SIZE),
    alias: normalizeAlias(value.alias),
    startupTimeoutMs: normalizeInteger(value.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, MAX_TIMEOUT_MS),
    stopTimeoutMs: normalizeInteger(value.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS, MAX_TIMEOUT_MS),
    healthPollIntervalMs: normalizeInteger(value.healthPollIntervalMs, DEFAULT_HEALTH_POLL_INTERVAL_MS, MAX_TIMEOUT_MS)
  };
}

function normalizeOptionalPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHost(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_HOST;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_HOST_LENGTH ||
    /[\u0000-\u001f\u007f/:\\\s]/.test(trimmed)
  ) {
    return DEFAULT_HOST;
  }

  return trimmed;
}

function normalizePort(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
    ? value
    : undefined;
}

function normalizeInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : fallback;
}

function normalizeAlias(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_ALIAS;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_ALIAS_LENGTH ||
    /^[A-Za-z]:/.test(trimmed) ||
    /[\u0000-\u001f\u007f\\/]/.test(trimmed)
  ) {
    return DEFAULT_ALIAS;
  }

  return trimmed;
}
