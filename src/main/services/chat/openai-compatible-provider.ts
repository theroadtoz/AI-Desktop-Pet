import type { ChatProvider, ChatProviderResult, ChatRequest } from "../../../shared/chat-provider";
import type { ProviderId } from "../../../shared/provider-config";
import type { TelemetryPayload } from "../telemetry";
import {
  mapChatMessagesToOpenAICompatible,
  getLatestUserMessage,
  type PromptTemplateProfile
} from "./chat-message-mapper";
import { classifyEmotion } from "./emotion-classifier";

type ProviderErrorType =
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_server_error"
  | "provider_timeout"
  | "provider_model_missing"
  | "provider_incompatible_response"
  | "provider_network_error";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type OpenAICompatibleProviderOptions = {
  providerId?: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">;
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  logTelemetry?: TelemetryLogger;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
};

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions
): ChatProvider {
  const baseURL = new URL(options.baseURL);
  const baseURLHost = baseURL.host;
  const providerId = options.providerId ?? "openai-compatible";
  const promptTemplateProfile = getPromptTemplateProfile(providerId);

  return {
    id: providerId,
    async streamReply(request, streamOptions) {
      const startedAt = Date.now();
      let replyText = "";

      log(options, "provider_request_started", {
        providerId,
        model: options.model,
        baseURLHost,
        promptTemplateProfile,
        messageCount: request.messages.length
      });

      try {
        replyText = await streamChatCompletions({
          request,
          options,
          signal: streamOptions.signal,
          onDelta(text) {
            replyText += text;
            streamOptions.onDelta({ text });
          }
        });

        const classification = classifyEmotion({
          latestUserMessage: getLatestUserMessage(request.messages),
          assistantReply: replyText
        });
        const result: ChatProviderResult = {
          text: replyText,
          ...classification
        };

        log(options, "provider_request_completed", {
          providerId,
          model: options.model,
          baseURLHost,
          promptTemplateProfile,
          messageCount: request.messages.length,
          replyLength: replyText.length,
          durationMs: Date.now() - startedAt
        });

        return result;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw error;
        }

        log(options, "provider_request_failed", {
          providerId,
          model: options.model,
          baseURLHost,
          promptTemplateProfile,
          messageCount: request.messages.length,
          replyLength: replyText.length,
          durationMs: Date.now() - startedAt,
          errorType: getProviderErrorType(error)
        });

        throw error;
      }
    }
  };
}

async function streamChatCompletions(input: {
  request: ChatRequest;
  options: OpenAICompatibleProviderOptions;
  signal: AbortSignal;
  onDelta(text: string): void;
}): Promise<string> {
  const controller = new AbortController();
  let timeoutReached = false;
  const timeoutId = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, input.options.timeoutMs);

  function abort(): void {
    controller.abort();
  }

  input.signal.addEventListener("abort", abort, { once: true });

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    const providerId = input.options.providerId ?? "openai-compatible";

    if (input.options.apiKey) {
      headers.Authorization = `Bearer ${input.options.apiKey}`;
    }

    const response = await fetch(createChatCompletionsURL(input.options.baseURL), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.options.model,
        messages: mapChatMessagesToOpenAICompatible(
          input.request.messages,
          input.request.memoryContext,
          input.request.dialogueStyleContext,
          input.request.userProfileContext,
          getPromptTemplateProfile(providerId),
          input.request.runtimeContext
        ),
        temperature: input.options.temperature,
        max_tokens: input.options.maxTokens,
        stream: true,
        ...(providerId === "local-openai-compatible" && isLocalOllamaOpenAICompatibleEndpoint(input.options.baseURL)
          ? { reasoning_effort: "none" }
          : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw createProviderError(classifyHttpStatus(response.status));
    }

    if (!response.body) {
      throw createProviderError("provider_incompatible_response");
    }

    return await readSseStream(response.body, input.onDelta, input.signal);
  } catch (error: unknown) {
    if (input.signal.aborted) {
      throw createAbortError();
    }

    if (timeoutReached) {
      throw createProviderError("provider_timeout");
    }

    if (isProviderError(error)) {
      throw error;
    }

    throw createProviderError("provider_network_error");
  } finally {
    clearTimeout(timeoutId);
    input.signal.removeEventListener("abort", abort);
  }
}

function getPromptTemplateProfile(providerId: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">): PromptTemplateProfile {
  return providerId === "local-openai-compatible" ? "local-small-model" : "cloud-chat";
}

export function createChatCompletionsURL(baseURL: string): URL {
  const url = new URL(baseURL);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function isLocalOllamaOpenAICompatibleEndpoint(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    return url.port === "11434" && (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  signal: AbortSignal
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let done = false;
  let sawOpenAIEvent = false;

  try {
    while (!done) {
      throwIfAborted(signal);
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const delta = parseSseLine(line);

        if (delta === null) {
          continue;
        }

        if ("invalid" in delta) {
          throw createProviderError("provider_incompatible_response");
        }

        sawOpenAIEvent = true;

        if (delta.done) {
          done = true;
          break;
        }

        if (delta.text.length > 0) {
          reply += delta.text;
          onDelta(delta.text);
        }
      }
    }

    if (!sawOpenAIEvent) {
      throw createProviderError("provider_incompatible_response");
    }

    return reply;
  } finally {
    reader.releaseLock();
  }
}

function parseSseLine(line: string): { done: true } | { done: false; text: string } | { invalid: true } | null {
  const trimmed = line.trim();

  if (!trimmed.startsWith("data:")) {
    return null;
  }

  const data = trimmed.slice("data:".length).trim();

  if (data === "[DONE]") {
    return { done: true };
  }

  try {
    const parsed = JSON.parse(data) as ChatCompletionChunk;
    return {
      done: false,
      text: parsed.choices?.[0]?.delta?.content ?? ""
    };
  } catch {
    return { invalid: true };
  }
}

function classifyHttpStatus(status: number): ProviderErrorType {
  if (status === 401 || status === 403) {
    return "provider_auth_failed";
  }

  if (status === 429) {
    return "provider_rate_limited";
  }

  if (status >= 500) {
    return "provider_server_error";
  }

  if (status === 404) {
    return "provider_model_missing";
  }

  return "provider_network_error";
}

function createProviderError(type: ProviderErrorType): Error {
  const error = new Error(type);
  error.name = type;
  return error;
}

function isProviderError(error: unknown): error is Error {
  return error instanceof Error && getProviderErrorType(error) !== "provider_network_error";
}

function getProviderErrorType(error: unknown): ProviderErrorType {
  if (error instanceof Error) {
    if (
      error.name === "provider_auth_failed" ||
      error.name === "provider_rate_limited" ||
      error.name === "provider_server_error" ||
      error.name === "provider_timeout" ||
      error.name === "provider_model_missing" ||
      error.name === "provider_incompatible_response" ||
      error.name === "provider_network_error"
    ) {
      return error.name;
    }
  }

  return "provider_network_error";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): DOMException {
  return new DOMException("OpenAI-compatible reply aborted", "AbortError");
}

function log(
  options: OpenAICompatibleProviderOptions,
  type: string,
  payload: TelemetryPayload
): void {
  options.logTelemetry?.(type, payload);
}
