import {
  RECOMMENDED_LOCAL_PROVIDER_CONFIG,
  type LocalOpenAICompatibleConfig
} from "../../../shared/provider-config";
import type { LlamaCppRuntimeSummary } from "./llama-cpp-runtime";

export type LlamaCppProviderHandoffSafeSummary = {
  runtime: "llama.cpp";
  enabled: boolean;
  status: "ready";
  safeSummaryOnly: true;
  executableConfigured: boolean;
  modelConfigured: boolean;
  providerId: "local-openai-compatible";
  localPresetId: "embedded-llama-cpp" | "custom-local";
  baseURLHost: string;
  alias: string;
};

export type LlamaCppProviderHandoff = {
  providerConfig: LocalOpenAICompatibleConfig;
  safeSummary: LlamaCppProviderHandoffSafeSummary;
};

type NormalizedBaseURL = {
  value: string;
  host: string;
};

const MANAGED_LLAMA_CPP_DISPLAY_NAME = "llama.cpp 本地模型";
const MANAGED_LLAMA_CPP_LOCAL_PRESET_ID = "custom-local";

export function createLlamaCppProviderHandoff(
  summary: LlamaCppRuntimeSummary,
  baseURL: string | null | undefined,
  options: {
    displayName?: string;
    localPresetId?: "embedded-llama-cpp" | "custom-local";
  } = {}
): LlamaCppProviderHandoff | null {
  if (summary.status !== "ready") {
    return null;
  }

  const normalizedBaseURL = normalizeBaseURL(baseURL);
  const alias = normalizeAlias(summary.alias);

  if (!normalizedBaseURL || !alias) {
    return null;
  }

  return {
    providerConfig: {
      providerId: "local-openai-compatible",
      displayName: options.displayName ?? MANAGED_LLAMA_CPP_DISPLAY_NAME,
      baseURL: normalizedBaseURL.value,
      model: alias,
      localPresetId: options.localPresetId ?? MANAGED_LLAMA_CPP_LOCAL_PRESET_ID,
      temperature: RECOMMENDED_LOCAL_PROVIDER_CONFIG.temperature,
      maxTokens: RECOMMENDED_LOCAL_PROVIDER_CONFIG.maxTokens,
      timeoutMs: RECOMMENDED_LOCAL_PROVIDER_CONFIG.timeoutMs
    },
    safeSummary: {
      runtime: "llama.cpp",
      enabled: summary.enabled,
      status: "ready",
      safeSummaryOnly: true,
      executableConfigured: summary.executableConfigured,
      modelConfigured: summary.modelConfigured,
      providerId: "local-openai-compatible",
      localPresetId: options.localPresetId ?? MANAGED_LLAMA_CPP_LOCAL_PRESET_ID,
      baseURLHost: normalizedBaseURL.host,
      alias
    }
  };
}

function normalizeBaseURL(baseURL: string | null | undefined): NormalizedBaseURL | null {
  const rawBaseURL = typeof baseURL === "string" ? baseURL.trim() : "";

  if (!rawBaseURL) {
    return null;
  }

  try {
    const url = new URL(rawBaseURL);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.host ||
      url.username ||
      url.password
    ) {
      return null;
    }

    url.search = "";
    url.hash = "";

    return {
      value: url.toString(),
      host: url.host
    };
  } catch {
    return null;
  }
}

function normalizeAlias(alias: unknown): string | null {
  if (typeof alias !== "string") {
    return null;
  }

  const trimmed = alias.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > 128 ||
    /^[A-Za-z]:/.test(trimmed) ||
    /[\u0000-\u001f\u007f\\/]/.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}
