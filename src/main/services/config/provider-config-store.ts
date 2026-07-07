import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FAKE_PROVIDER_CONFIG,
  RECOMMENDED_LOCAL_PROVIDER_CONFIG,
  type LocalOpenAICompatibleConfig,
  type LocalProviderPresetId,
  type ProviderConfig
} from "../../../shared/provider-config";
import type { TelemetryPayload } from "../telemetry";

export const DEFAULT_PROVIDER_CONFIG: LocalOpenAICompatibleConfig = RECOMMENDED_LOCAL_PROVIDER_CONFIG;
export { FAKE_PROVIDER_CONFIG };

type ConfigSource = "file" | "default";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type ProviderConfigStore = {
  getConfig(): ProviderConfig;
  hasConfig(): boolean;
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
        const parsedConfig = parseProviderConfig(parsed);

        if (!parsedConfig) {
          log("provider_config_invalid", { source: "file", errorType: "validation" });
          logLoaded(DEFAULT_PROVIDER_CONFIG, "default");
          return DEFAULT_PROVIDER_CONFIG;
        }

        const config = migrateLegacyProviderConfig(parsedConfig);

        if (config !== parsedConfig) {
          const migrationReason = isLegacyDeepSeekDefaultConfig(parsedConfig)
            ? "legacy_deepseek_default"
            : "external_model_disabled";
          log("provider_config_migrated", {
            source: "file",
            reason: migrationReason,
            fromProviderId: parsedConfig.providerId,
            toProviderId: config.providerId,
            baseURLHost: parsedConfig.providerId === "fake" ? undefined : readBaseURLHost(parsedConfig.baseURL),
            modelCategory: parsedConfig.providerId === "fake" ? undefined : migrationReason
          });
          logLoaded(config, "default");
          return config;
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
    hasConfig() {
      return existsSync(configPath);
    },
    saveConfig(config) {
      const parsed = parseProviderConfig(config);

      if (!parsed) {
        log("provider_config_invalid", { source: "file", errorType: "validation" });
        throw new Error("Invalid provider config");
      }

      const configToSave = migrateLegacyProviderConfig(parsed);

      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, `${JSON.stringify(configToSave, null, 2)}\n`, "utf8");

      if (configToSave !== parsed) {
        const migrationReason = isLegacyDeepSeekDefaultConfig(parsed)
          ? "legacy_deepseek_default"
          : "external_model_disabled";
        log("provider_config_migrated", {
          source: "file",
          reason: migrationReason,
          fromProviderId: parsed.providerId,
          toProviderId: configToSave.providerId,
          baseURLHost: parsed.providerId === "fake" ? undefined : readBaseURLHost(parsed.baseURL),
          modelCategory: parsed.providerId === "fake" ? undefined : migrationReason
        });
      }

      log("provider_config_saved", createProviderTelemetryPayload(configToSave, "file"));
      return configToSave;
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

  if (config.providerId === "local-openai-compatible") {
    const localPresetId = parseLocalProviderPresetId(config.localPresetId);

    if (
      !isNonEmptyString(config.displayName) ||
      !isNonEmptyString(config.baseURL) ||
      !isNonEmptyString(config.model) ||
      !isFiniteNumber(config.temperature) ||
      !isPositiveInteger(config.maxTokens) ||
      !isPositiveInteger(config.timeoutMs)
    ) {
      return null;
    }

    return {
      providerId: "local-openai-compatible",
      displayName: config.displayName,
      baseURL: config.baseURL,
      model: config.model,
      ...(localPresetId ? { localPresetId } : {}),
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs
    };
  }

  return null;
}

function migrateLegacyProviderConfig(config: ProviderConfig): ProviderConfig {
  if (config.providerId === "openai-compatible") {
    return DEFAULT_PROVIDER_CONFIG;
  }

  return config;
}

function isLegacyDeepSeekDefaultConfig(config: ProviderConfig): boolean {
  if (config.providerId !== "openai-compatible") {
    return false;
  }

  return readBaseURLHost(config.baseURL)?.toLowerCase() === "api.deepseek.com" ||
    config.model.trim().toLowerCase() === "deepseek-v4-flash";
}

export function createProviderTelemetryPayload(
  config: ProviderConfig,
  source: "file" | "env" | "default"
): TelemetryPayload {
  return {
    providerId: config.providerId,
    apiKeyRef: config.providerId === "openai-compatible" ? config.apiKeyRef : undefined,
    localPresetId: config.providerId === "local-openai-compatible" ? config.localPresetId : undefined,
    baseURLHost: config.providerId === "fake" ? undefined : readBaseURLHost(config.baseURL),
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

function parseLocalProviderPresetId(value: unknown): LocalProviderPresetId | null {
  return value === "embedded-llama-cpp" ||
    value === "ollama" ||
    value === "lm-studio" ||
    value === "custom-local"
    ? value
    : null;
}

function readBaseURLHost(baseURL: string): string | undefined {
  try {
    return new URL(baseURL).host;
  } catch {
    return undefined;
  }
}
