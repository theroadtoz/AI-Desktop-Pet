import type { ChatProvider } from "../../../shared/chat-provider";
import type { ProviderConfig, ProviderId } from "../../../shared/provider-config";
import {
  toPersistentTelemetryEvent,
  type PersistentTelemetryLogger,
  type TelemetryEventType
} from "../../../shared/telemetry-contract";
import { createFakeChatProvider } from "./fake-provider";
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions
} from "./openai-compatible-provider";

type RealProviderId = Extract<ProviderId, "openai-compatible" | "local-openai-compatible">;
type UnavailableProviderReason = "missing_api_key" | "invalid_config";

export function createChatProviderFromConfig(options: {
  config: ProviderConfig;
  getApiKey(apiKeyRef: string): string | null;
  logTelemetry?: PersistentTelemetryLogger;
}): ChatProvider {
  if (options.config.providerId === "fake") {
    logProviderEvent(options.logTelemetry, "provider_selected");
    return createFakeChatProvider();
  }

  if (options.config.providerId === "local-openai-compatible") {
    try {
      logProviderEvent(options.logTelemetry, "provider_selected");

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
      logUnavailable(options.logTelemetry);
      return createUnavailableChatProvider({
        providerId: "local-openai-compatible",
        reason: "invalid_config",
        logTelemetry: options.logTelemetry
      });
    }
  }

  logUnavailable(options.logTelemetry);
  return createUnavailableChatProvider({
    providerId: "openai-compatible",
    reason: "invalid_config",
    logTelemetry: options.logTelemetry
  });
}

function createUnavailableChatProvider(options: {
  providerId: RealProviderId;
  reason: UnavailableProviderReason;
  logTelemetry?: PersistentTelemetryLogger | undefined;
}): ChatProvider {
  return {
    id: options.providerId,
    async streamReply() {
      logProviderEvent(options.logTelemetry, "provider_unavailable_reply_blocked");
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
  logTelemetry: PersistentTelemetryLogger | undefined
): void {
  logProviderEvent(logTelemetry, "provider_unavailable");
}

function logProviderEvent(logTelemetry: PersistentTelemetryLogger | undefined, type: TelemetryEventType): void {
  const event = toPersistentTelemetryEvent(type, {});
  if (event) logTelemetry?.(event);
}
