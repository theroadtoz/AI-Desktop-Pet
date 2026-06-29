import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderConfig } from "../../../shared/provider-config";
import { DEFAULT_PROVIDER_CONFIG, FAKE_PROVIDER_CONFIG } from "./provider-config-store";

export type EnvProviderConfig = {
  providerConfig: ProviderConfig;
  apiKey: string | null;
  apiKeyRef: string | null;
};

const DEFAULT_ENV_API_KEY_REF = "openai-compatible-default";

export function readEnvProviderConfig(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readDotEnvLocal?: boolean;
} = {}): EnvProviderConfig | null {
  const cwd = options.cwd ?? process.cwd();
  const env = {
    ...(options.readDotEnvLocal === true ? readDotEnvLocal(join(cwd, ".env.local")) : {}),
    ...(options.env ?? process.env)
  };
  const provider = env.AI_DESKTOP_PET_PROVIDER;

  if (!provider) {
    return null;
  }

  if (provider === "fake") {
    return {
      providerConfig: FAKE_PROVIDER_CONFIG,
      apiKey: null,
      apiKeyRef: null
    };
  }

  if (provider === "local-openai-compatible") {
    return {
      providerConfig: {
        ...DEFAULT_PROVIDER_CONFIG,
        baseURL: readNonEmpty(env.AI_DESKTOP_PET_BASE_URL) ?? DEFAULT_PROVIDER_CONFIG.baseURL,
        model: readNonEmpty(env.AI_DESKTOP_PET_MODEL) ?? DEFAULT_PROVIDER_CONFIG.model,
        temperature: readNumber(env.AI_DESKTOP_PET_TEMPERATURE, DEFAULT_PROVIDER_CONFIG.temperature),
        maxTokens: readInteger(env.AI_DESKTOP_PET_MAX_TOKENS, DEFAULT_PROVIDER_CONFIG.maxTokens),
        timeoutMs: readInteger(env.AI_DESKTOP_PET_TIMEOUT_MS, DEFAULT_PROVIDER_CONFIG.timeoutMs)
      },
      apiKey: null,
      apiKeyRef: null
    };
  }

  if (provider !== "openai-compatible") {
    return null;
  }

  const baseURL = readNonEmpty(env.AI_DESKTOP_PET_BASE_URL);
  const model = readNonEmpty(env.AI_DESKTOP_PET_MODEL);

  if (!baseURL || !model) {
    return null;
  }

  return {
    providerConfig: {
      providerId: "openai-compatible",
      displayName: "OpenAI Compatible",
      baseURL,
      model,
      apiKeyRef: DEFAULT_ENV_API_KEY_REF,
      temperature: readNumber(env.AI_DESKTOP_PET_TEMPERATURE, 0.7),
      maxTokens: readInteger(env.AI_DESKTOP_PET_MAX_TOKENS, 1024),
      timeoutMs: readInteger(env.AI_DESKTOP_PET_TIMEOUT_MS, 60_000)
    },
    apiKey: readNonEmpty(env.AI_DESKTOP_PET_API_KEY),
    apiKeyRef: DEFAULT_ENV_API_KEY_REF
  };
}

function readDotEnvLocal(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const values: Record<string, string> = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    values[key] = unquoteValue(rawValue);
  }

  return values;
}

function unquoteValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readNonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInteger(value: unknown, fallback: number): number {
  const parsed = readNumber(value, fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
