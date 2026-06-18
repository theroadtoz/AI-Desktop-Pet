import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProviderConfig } from "../../../shared/provider-config";
import type { TelemetryPayload } from "../telemetry";

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  providerId: "fake",
  displayName: "Fake Provider"
};

type ConfigSource = "file" | "default";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type ProviderConfigStore = {
  getConfig(): ProviderConfig;
  saveConfig(config: unknown): ProviderConfig;
  getConfigPath(): string;
};

export function createProviderConfigStore(options: {
  userDataPath?: string;
  logTelemetry?: TelemetryLogger;
} = {}): ProviderConfigStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const configPath = join(userDataPath, "config", "provider-config.json");

  function log(type: string, payload?: TelemetryPayload): void {
    options.logTelemetry?.(type, payload);
  }

  function logLoaded(config: ProviderConfig, source: ConfigSource): void {
    log("provider_config_loaded", createProviderTelemetryPayload(config, source));
  }

  return {
    getConfig() {
      if (!existsSync(configPath)) {
        logLoaded(DEFAULT_PROVIDER_CONFIG, "default");
        return DEFAULT_PROVIDER_CONFIG;
      }

      try {
        const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
        const config = parseProviderConfig(parsed);

        if (!config) {
          log("provider_config_invalid", { source: "file", errorType: "validation" });
          logLoaded(DEFAULT_PROVIDER_CONFIG, "default");
          return DEFAULT_PROVIDER_CONFIG;
        }

        logLoaded(config, "file");
        return config;
      } catch (error: unknown) {
        log("provider_config_invalid", {
          source: "file",
          errorType: error instanceof SyntaxError ? "parse" : "read"
        });
        logLoaded(DEFAULT_PROVIDER_CONFIG, "default");
        return DEFAULT_PROVIDER_CONFIG;
      }
    },
    saveConfig(config) {
      const parsed = parseProviderConfig(config);

      if (!parsed) {
        log("provider_config_invalid", { source: "file", errorType: "validation" });
        throw new Error("Invalid provider config");
      }

      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      log("provider_config_saved", createProviderTelemetryPayload(parsed, "file"));
      return parsed;
    },
    getConfigPath() {
      return configPath;
    }
  };
}

export function parseProviderConfig(value: unknown): ProviderConfig | null {
  const config = value as Partial<ProviderConfig> | null;

  if (!config || typeof config !== "object") {
    return null;
  }

  if (config.providerId === "fake") {
    if (!isNonEmptyString(config.displayName)) {
      return null;
    }

    return {
      providerId: "fake",
      displayName: config.displayName
    };
  }

  if (config.providerId === "openai-compatible") {
    if (
      !isNonEmptyString(config.displayName) ||
      !isNonEmptyString(config.baseURL) ||
      !isNonEmptyString(config.model) ||
      !isNonEmptyString(config.apiKeyRef) ||
      !isFiniteNumber(config.temperature) ||
      !isPositiveInteger(config.maxTokens) ||
      !isPositiveInteger(config.timeoutMs)
    ) {
      return null;
    }

    return {
      providerId: "openai-compatible",
      displayName: config.displayName,
      baseURL: config.baseURL,
      model: config.model,
      apiKeyRef: config.apiKeyRef,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs
    };
  }

  return null;
}

export function createProviderTelemetryPayload(
  config: ProviderConfig,
  source: "file" | "env" | "default"
): TelemetryPayload {
  return {
    providerId: config.providerId,
    apiKeyRef: config.providerId === "openai-compatible" ? config.apiKeyRef : undefined,
    source
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

