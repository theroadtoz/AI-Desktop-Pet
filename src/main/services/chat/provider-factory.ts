import type { ChatProvider } from "../../../shared/chat-provider";
import type { LocalProviderPresetId, ProviderConfig, ProviderId } from "../../../shared/provider-config";
import type { TelemetryPayload } from "../telemetry";
import { createFakeChatProvider } from "./fake-provider";
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions
} from "./openai-compatible-provider";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;
type RealProviderId = Extract<ProviderId, "openai-compatible" | "local-openai-compatible">;
type UnavailableProviderReason = "missing_api_key" | "invalid_config";

export function createChatProviderFromConfig(options: {
  config: ProviderConfig;
  getApiKey(apiKeyRef: string): string | null;
  logTelemetry?: TelemetryLogger;
}): ChatProvider {
  if (options.config.providerId === "fake") {
    options.logTelemetry?.("provider_selected", { providerId: "fake" });
    return createFakeChatProvider();
  }

  const baseURLHost = readBaseURLHost(options.config.baseURL);

  if (options.config.providerId === "local-openai-compatible") {
    try {
      options.logTelemetry?.("provider_selected", {
        providerId: "local-openai-compatible",
        model: options.config.model,
        baseURLHost,
        localPresetId: options.config.localPresetId
      });

      const providerOptions: OpenAICompatibleProviderOptions = {
        providerId: "local-openai-compatible",
        baseURL: options.config.baseURL,
        model: options.config.model,
        temperature: options.config.temperature,
        maxTokens: options.config.maxTokens,
        timeoutMs: options.config.timeoutMs
      };

      if (options.logTelemetry) {
        providerOptions.logTelemetry = options.logTelemetry;
      }

      return createOpenAICompatibleProvider(providerOptions);
    } catch {
      logUnavailable(options.logTelemetry, {
        providerId: "local-openai-compatible",
        model: options.config.model,
        baseURLHost,
        localPresetId: options.config.localPresetId,
        errorType: "invalid_config"
      });
      return createUnavailableChatProvider({
        providerId: "local-openai-compatible",
        model: options.config.model,
        baseURLHost,
        localPresetId: options.config.localPresetId,
        reason: "invalid_config",
        logTelemetry: options.logTelemetry
      });
    }
  }

  try {
    const apiKey = options.getApiKey(options.config.apiKeyRef);

    if (!apiKey) {
      logUnavailable(options.logTelemetry, {
        providerId: "openai-compatible",
        model: options.config.model,
        baseURLHost,
        errorType: "missing_api_key"
      });
      return createUnavailableChatProvider({
        providerId: "openai-compatible",
        model: options.config.model,
        baseURLHost,
        reason: "missing_api_key",
        logTelemetry: options.logTelemetry
      });
    }

    options.logTelemetry?.("provider_selected", {
      providerId: "openai-compatible",
      model: options.config.model,
      baseURLHost
    });

    const providerOptions: OpenAICompatibleProviderOptions = {
      baseURL: options.config.baseURL,
      model: options.config.model,
      apiKey,
      temperature: options.config.temperature,
      maxTokens: options.config.maxTokens,
      timeoutMs: options.config.timeoutMs
    };

    if (options.logTelemetry) {
      providerOptions.logTelemetry = options.logTelemetry;
    }

    return createOpenAICompatibleProvider(providerOptions);
  } catch {
    logUnavailable(options.logTelemetry, {
      providerId: "openai-compatible",
      model: options.config.model,
      baseURLHost,
      errorType: "invalid_config"
    });
    return createUnavailableChatProvider({
      providerId: "openai-compatible",
      model: options.config.model,
      baseURLHost,
      reason: "invalid_config",
      logTelemetry: options.logTelemetry
    });
  }
}

function createUnavailableChatProvider(options: {
  providerId: RealProviderId;
  model: string;
  baseURLHost?: string | undefined;
  localPresetId?: LocalProviderPresetId | undefined;
  reason: UnavailableProviderReason;
  logTelemetry?: TelemetryLogger | undefined;
}): ChatProvider {
  return {
    id: options.providerId,
    async streamReply() {
      options.logTelemetry?.("provider_unavailable_reply_blocked", {
        providerId: options.providerId,
        model: options.model,
        baseURLHost: options.baseURLHost,
        localPresetId: options.localPresetId,
        errorType: options.reason
      });
      throw createUnavailableProviderError(options.reason);
    }
  };
}

function createUnavailableProviderError(reason: UnavailableProviderReason): Error {
  const error = new Error(reason);
  error.name = reason === "missing_api_key" ? "provider_missing_api_key" : "provider_invalid_config";
  return error;
}

function logUnavailable(
  logTelemetry: TelemetryLogger | undefined,
  payload: TelemetryPayload
): void {
  logTelemetry?.("provider_unavailable", {
    ...payload
  });
}

function readBaseURLHost(baseURL: string): string | undefined {
  try {
    return new URL(baseURL).host;
  } catch {
    return undefined;
  }
}
