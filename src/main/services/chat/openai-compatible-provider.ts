import type { ChatProvider, ChatProviderResult, ChatRequest } from "../../../shared/chat-provider";
import type { TelemetryPayload } from "../telemetry";
import { mapChatMessagesToOpenAICompatible, getLatestUserMessage } from "./chat-message-mapper";
import { classifyEmotion } from "./emotion-classifier";

type ProviderErrorType =
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_server_error"
  | "provider_network_error";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type OpenAICompatibleProviderOptions = {
  baseURL: string;
  model: string;
  apiKey: string;
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

  return {
    id: "openai-compatible",
    async streamReply(request, streamOptions) {
      const startedAt = Date.now();
      let replyText = "";

      log(options, "provider_request_started", {
        providerId: "openai-compatible",
        model: options.model,
        baseURLHost,
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
          providerId: "openai-compatible",
          model: options.model,
          baseURLHost,
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
          providerId: "openai-compatible",
          model: options.model,
          baseURLHost,
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
  const timeoutId = setTimeout(() => controller.abort(), input.options.timeoutMs);

  function abort(): void {
    controller.abort();
  }

  input.signal.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(new URL("/chat/completions", input.options.baseURL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.options.model,
        messages: mapChatMessagesToOpenAICompatible(input.request.messages, input.request.memoryContext),
        temperature: input.options.temperature,
        max_tokens: input.options.maxTokens,
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw createProviderError(classifyHttpStatus(response.status));
    }

    if (!response.body) {
      throw createProviderError("provider_network_error");
    }

    return await readSseStream(response.body, input.onDelta, input.signal);
  } catch (error: unknown) {
    if (input.signal.aborted) {
      throw createAbortError();
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

    return reply;
  } finally {
    reader.releaseLock();
  }
}

function parseSseLine(line: string): { done: true } | { done: false; text: string } | null {
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
    return null;
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
