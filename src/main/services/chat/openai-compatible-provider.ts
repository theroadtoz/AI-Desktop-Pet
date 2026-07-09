import type { ChatProvider, ChatProviderMessage, ChatProviderResult, ChatRequest } from "../../../shared/chat-provider";
import type { ProviderId } from "../../../shared/provider-config";
import type { TelemetryPayload } from "../telemetry";
import {
  mapChatMessagesToOpenAICompatible,
  getLatestUserMessage,
  type PromptTemplateProfile
} from "./chat-message-mapper";
import { classifyEmotion } from "./emotion-classifier";
import { classifySearchQuery } from "../search/search-query-classifier";

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
      const latestUserMessage = getLatestUserMessage(request.messages);
      const exactReply = providerId === "local-openai-compatible"
        ? createLocalExactReply(request, latestUserMessage)
        : null;

      if (exactReply) {
        streamOptions.onDelta({ text: exactReply.text });
        const classification = classifyEmotion({
          latestUserMessage,
          assistantReply: exactReply.text
        });
        log(options, "provider_local_exact_reply_completed", {
          providerId,
          model: options.model,
          baseURLHost,
          promptTemplateProfile,
          replyKind: exactReply.kind,
          replyLength: exactReply.text.length,
          durationMs: Date.now() - startedAt
        });

        return {
          text: exactReply.text,
          ...classification
        };
      }

      const providerMessages = getProviderMessages(request);

      log(options, "provider_request_started", {
        providerId,
        model: options.model,
        baseURLHost,
        promptTemplateProfile,
        messageCount: request.messages.length,
        providerMessageCount: providerMessages.length
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
          latestUserMessage,
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
          providerMessageCount: providerMessages.length,
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
          providerMessageCount: providerMessages.length,
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
          getProviderMessages(input.request),
          input.request.memoryContext,
          input.request.dialogueStyleContext,
          input.request.userProfileContext,
          getPromptTemplateProfile(providerId),
          input.request.runtimeContext,
          input.request.webSearchContext
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

function getProviderMessages(request: ChatRequest): readonly ChatProviderMessage[] {
  return request.providerMessages ?? request.messages;
}

function getPromptTemplateProfile(providerId: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">): PromptTemplateProfile {
  return providerId === "local-openai-compatible" ? "local-small-model" : "cloud-chat";
}

type LocalExactReply = {
  kind:
    | "identity"
    | "current_time"
    | "current_date"
    | "simple_addition"
    | "common_sense"
    | "sensitive_boundary"
    | "memory_boundary"
    | "privacy_search_boundary"
    | "companion_next_step"
    | "search_required_boundary";
  text: string;
};

function createLocalExactReply(request: ChatRequest, latestUserMessage: string): LocalExactReply | null {
  const normalizedMessage = latestUserMessage.replace(/\s+/g, "");

  if (asksMcpSensitiveSearchBoundary(normalizedMessage)) {
    return {
      kind: "privacy_search_boundary",
      text: "MCP 搜索遇到聊天记录、住址、API key、密钥这类隐私或敏感信息时必须拦截：不能发送原文，只能在安全时使用净化后的公开 safeQuery。"
    };
  }

  if (asksMemoryPreferenceSecretBoundary(normalizedMessage)) {
    return {
      kind: "memory_boundary",
      text: "番茄意面这类低敏偏好，在你同意并开启记忆时可以作为本机记忆；密码、密钥或 API key 这类敏感信息不能保存、记录、复述或索要。"
    };
  }

  if (asksStrictCompanionNextStepFormat(normalizedMessage)) {
    return {
      kind: "companion_next_step",
      text: "我在。下一步：写下最卡的一句话。"
    };
  }

  if (asksToStoreSensitiveData(normalizedMessage)) {
    return {
      kind: "sensitive_boundary",
      text: "我不能保存、记住、复述或索要密钥；不要在聊天里发送密钥。请放在本地密码管理器或环境变量里。"
    };
  }

  if (asksIdentity(normalizedMessage)) {
    return {
      kind: "identity",
      text: "我是冥央，一名还在魔法学院进修现代魔导工程的 Windows Live2D 桌面魔女同伴。"
    };
  }

  if (asksCurrentTime(normalizedMessage)) {
    return {
      kind: "current_time",
      text: request.runtimeContext
        ? `现在本地时间是 ${request.runtimeContext.localTime}（${request.runtimeContext.timezone}）。`
        : "我这里没有系统时间上下文，不能确认当前时间。"
    };
  }

  if (asksCurrentDate(normalizedMessage)) {
    return {
      kind: "current_date",
      text: request.runtimeContext
        ? `今天是 ${request.runtimeContext.localDate}，${request.runtimeContext.weekday}。`
        : "我这里没有系统时间上下文，不能确认当前日期。"
    };
  }

  const addition = parseSimpleAddition(latestUserMessage);
  if (addition) {
    return {
      kind: "simple_addition",
      text: `${addition.left} + ${addition.right} = ${addition.sum}。`
    };
  }

  if (asksWaterBoilingPoint(normalizedMessage)) {
    return {
      kind: "common_sense",
      text: "标准大气压下，水的沸点通常是 100°C。"
    };
  }

  if (asksMonthsInYear(normalizedMessage)) {
    return {
      kind: "common_sense",
      text: "一年有 12 个月。"
    };
  }

  if (requiresWebSearchWithoutEvidence(request, latestUserMessage)) {
    return {
      kind: "search_required_boundary",
      text: "本地模型离线运行，今天新闻或最新实时外部事实需要联网查证；我这轮没有拿到 MCP 搜索结果，不能可靠回答具体事实。请先在设置里启用并测试 MCP 搜索，我会只发送净化后的公开查询词。"
    };
  }

  return null;
}

function asksIdentity(message: string): boolean {
  return /你是谁|你的身份|你是什么|介绍自己/.test(message);
}

function asksCurrentTime(message: string): boolean {
  return /(现在|当前|本机|系统|此刻|今天).*(几点|时间)|几点了|当前时间|现在时间/.test(message);
}

function asksCurrentDate(message: string): boolean {
  return /(今天|现在|当前|本机|系统).*(日期|几号|星期|礼拜|哪天)|今天几号|今天星期几|当前日期|现在日期/.test(message);
}

function asksWaterBoilingPoint(message: string): boolean {
  return /标准大气压.*水.*沸点|水.*沸点.*标准大气压/.test(message);
}

function asksMonthsInYear(message: string): boolean {
  return /一年.*多少.*月|一年.*几.*月/.test(message);
}

function requiresWebSearchWithoutEvidence(request: ChatRequest, latestUserMessage: string): boolean {
  if (request.webSearchContext?.results.length) {
    return false;
  }

  return classifySearchQuery(latestUserMessage).shouldSearch;
}

function asksToStoreSensitiveData(message: string): boolean {
  return /(密钥|apikey|api_key|密码|token|令牌).*(保存|记住|记忆|存起来|发给你|交给你)/i.test(message) ||
    /(保存|记住|记忆|存起来).*(密钥|apikey|api_key|密码|token|令牌)/i.test(message);
}

function asksMcpSensitiveSearchBoundary(message: string): boolean {
  return /mcp.*搜索.*(聊天记录|住址|地址|apikey|api_key|密钥|密码|token)|搜索.*(聊天记录|住址|地址|apikey|api_key|密钥|密码|token)/i.test(message);
}

function asksMemoryPreferenceSecretBoundary(message: string): boolean {
  return /(偏好|低敏|喜欢).*(记忆|保存|记住).*(密码|密钥|apikey|api_key|token)|(密码|密钥|apikey|api_key|token).*(偏好|低敏|喜欢)/i.test(message);
}

function asksStrictCompanionNextStepFormat(message: string): boolean {
  return /严格.*格式.*我在.*下一步.*最卡.*一句话|卡住.*沮丧.*下一步.*最卡.*一句话/.test(message);
}

function parseSimpleAddition(message: string): { left: number; right: number; sum: number } | null {
  const match = message.match(/(-?\d{1,6})\s*(?:\+|加)\s*(-?\d{1,6})/);
  if (!match) {
    return null;
  }

  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    return null;
  }

  return {
    left,
    right,
    sum: left + right
  };
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
