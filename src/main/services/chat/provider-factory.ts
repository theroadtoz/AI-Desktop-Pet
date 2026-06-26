import type { ChatProvider } from "../../../shared/chat-provider";
import type { ProviderConfig } from "../../../shared/provider-config";
import type { TelemetryPayload } from "../telemetry";
import { createFakeChatProvider } from "./fake-provider";
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions
} from "./openai-compatible-provider";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

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
        baseURLHost
      });

      const providerOptions: OpenAICompatibleProviderOptions = {
        providerId: "local-openai-compatible",
        baseURL: options.config.baseURL,
        model: options.config.model,
        apiKey: "ollama-local-placeholder",
        temperature: options.config.temperature,
        maxTokens: options.config.maxTokens,
        timeoutMs: options.config.timeoutMs
      };

      if (options.logTelemetry) {
        providerOptions.logTelemetry = options.logTelemetry;
      }

      return createOpenAICompatibleProvider(providerOptions);
    } catch {
      logFallback(options.logTelemetry, {
        providerId: "local-openai-compatible",
        model: options.config.model,
        baseURLHost,
        errorType: "provider_config_invalid"
      });
      return createFakeChatProvider();
    }
  }

  try {
    const apiKey = options.getApiKey(options.config.apiKeyRef);

    if (!apiKey) {
      logFallback(options.logTelemetry, {
        providerId: "openai-compatible",
        model: options.config.model,
        baseURLHost,
        errorType: "missing_api_key"
      });
      return createFakeChatProvider();
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
    logFallback(options.logTelemetry, {
      providerId: "openai-compatible",
      model: options.config.model,
      baseURLHost,
      errorType: "provider_config_invalid"
    });
    return createFakeChatProvider();
  }
}

function logFallback(
  logTelemetry: TelemetryLogger | undefined,
  payload: TelemetryPayload
): void {
  logTelemetry?.("provider_fallback_to_fake", {
    ...payload
  });
  logTelemetry?.("provider_selected", { providerId: "fake" });
}

function readBaseURLHost(baseURL: string): string | undefined {
  try {
    return new URL(baseURL).host;
  } catch {
    return undefined;
  }
}
