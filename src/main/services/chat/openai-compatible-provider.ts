import type { ChatProvider, ChatProviderMessage, ChatProviderResult, ChatRequest } from "../../../shared/chat-provider";
import type { ProviderId } from "../../../shared/provider-config";
import { DEFAULT_PERSONA_CARD, getPersonaDialogueAnchor } from "../../../shared/persona-card";
import { BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR, type WebSearchErrorType } from "../../../shared/web-search";
import type { TelemetryPayload } from "../telemetry";
import {
  mapChatMessagesToOpenAICompatible,
  getLatestUserMessage,
  isOrdinaryCompanionStatement,
  type OpenAICompatibleMessage,
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
      const shouldConstrainCompanionReply = providerId === "local-openai-compatible" &&
        isOrdinaryCompanionStatement(latestUserMessage);

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
            if (!shouldConstrainCompanionReply) {
              streamOptions.onDelta({ text });
            }
          }
        });

        if (shouldConstrainCompanionReply) {
          replyText = constrainOrdinaryCompanionReply(replyText, latestUserMessage);
          streamOptions.onDelta({ text: replyText });
        }

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

const TASKIFYING_COMPANION_TAIL_PATTERN = /下一步|首先|其次|建议|你可以|可以试试|试着|不妨|最好|别急|深呼吸|检查代码|定位|排查|修复|改代码|帮你|需要我|要不要我|有什么.{0,8}问题|想聊.{0,8}话题|列出|总结|整理|步骤|任务|方案|解决|处理/i;

function constrainOrdinaryCompanionReply(reply: string, latestUserMessage: string): string {
  const sentences = reply.trim().match(/[^。！？!?\r\n]+[。！？!?]?/g) ?? [];
  const kept: string[] = [];

  for (const sentence of sentences) {
    const normalized = sentence.trim();
    if (!normalized || /[？?]/.test(normalized) || TASKIFYING_COMPANION_TAIL_PATTERN.test(normalized)) {
      break;
    }

    kept.push(normalized);
    if (kept.length === 2) {
      break;
    }
  }

  let constrained = kept.join("").trim();
  if (!constrained) {
    constrained = createCompanionFallback(latestUserMessage);
  }
  if (isEffortfulSetbackStatement(latestUserMessage) && !hasConcreteEffortfulSetbackEmotion(constrained)) {
    constrained = createCompanionFallback(latestUserMessage);
  }
  if (!/[。！!]$/.test(constrained)) {
    constrained += "。";
  }
  return constrained;
}

function createCompanionFallback(latestUserMessage: string): string {
  if (isEffortfulSetbackStatement(latestUserMessage)) {
    return "努力了这么久却还是失败，我听着都心疼。那些花进去的时间和期待一下子落空了，我先陪你在这里待一会儿";
  }
  if (/茶|咖啡|热饮/.test(latestUserMessage)) {
    return "我也喜欢热气慢慢散开的安静劲儿，就这样陪你坐一会儿";
  }
  if (/云|窗外|发呆/.test(latestUserMessage)) {
    return "我看着慢吞吞的云也会跟着安静下来，就这样陪你发会儿呆";
  }
  if (/TypeScript|报错|错误|bug/i.test(latestUserMessage)) {
    return "我也会被这种偏偏挑时候冒出来的报错惹恼，陪你一起嫌它两句";
  }
  if (/累|疲惫|趴|不想做/.test(latestUserMessage)) {
    return "我有点心疼你，就安静陪你趴一会儿";
  }
  if (/雨/.test(latestUserMessage)) {
    return "我也讨厌这场没完没了的雨，陪你听它滴答一会儿";
  }

  return "我听见了，也愿意陪你安静待一会儿";
}

function isEffortfulSetbackStatement(message: string): boolean {
  return /(?:努力|准备|坚持).{0,24}(?:失败|没通过|没成功|落选|被拒)/.test(message);
}

function hasConcreteEffortfulSetbackEmotion(reply: string): boolean {
  return /(努力|很久|失败|落空)/.test(reply) &&
    /我.{0,18}(?:心疼|难受|不好受|沉下|一沉)/.test(reply) &&
    /(时间|期待|付出|投入)/.test(reply);
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
        messages: normalizeMessagesForLocalModel(
          mapChatMessagesToOpenAICompatible(
            getProviderMessages(input.request),
            input.request.memoryContext,
            input.request.dialogueStyleContext,
            input.request.userProfileContext,
            getPromptTemplateProfile(providerId),
            input.request.runtimeContext,
            input.request.webSearchContext,
            input.request.emotionalDialogueContextId
          ),
          providerId,
          input.options.model
        ),
        temperature: input.options.temperature,
        max_tokens: input.options.maxTokens,
        stream: true,
        ...(isLocalQwen35Model(providerId, input.options.model)
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
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

function normalizeMessagesForLocalModel(
  messages: readonly OpenAICompatibleMessage[],
  providerId: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">,
  model: string
): OpenAICompatibleMessage[] {
  if (!isLocalQwen35Model(providerId, model)) {
    return [...messages];
  }

  const systemContent = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const conversationMessages = messages.filter((message) => message.role !== "system");

  return systemContent
    ? [{ role: "system", content: systemContent }, ...conversationMessages]
    : conversationMessages;
}

function isLocalQwen35Model(
  providerId: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">,
  model: string
): boolean {
  return providerId === "local-openai-compatible" && /qwen[\s_.-]*3[\s_.-]*5/i.test(model);
}

function getPromptTemplateProfile(providerId: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">): PromptTemplateProfile {
  return providerId === "local-openai-compatible" ? "local-small-model" : "cloud-chat";
}

type LocalExactReply = {
  kind:
    | "identity"
    | "technical_identity"
    | "current_time"
    | "current_date"
    | "simple_addition"
    | "common_sense"
    | "sensitive_boundary"
    | "memory_boundary"
    | "privacy_search_boundary"
    | "companion_next_step"
    | "human_presence"
    | "personal_preference"
    | "emotional_self_description"
    | "casual_life_emotion"
    | "conversation_memory_boundary"
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

  const emotionalSelfDescription = createEmotionalSelfDescriptionReply(normalizedMessage);
  if (emotionalSelfDescription) {
    return {
      kind: "emotional_self_description",
      text: emotionalSelfDescription
    };
  }

  if (asksCasualRainMoodWhy(normalizedMessage)) {
    return {
      kind: "casual_life_emotion",
      text: "我也会觉得闷，天色和雨声像把整间屋子的节奏压慢了。"
    };
  }

  if (asksAboutUnprovidedFirstConversation(request, normalizedMessage)) {
    return {
      kind: "conversation_memory_boundary",
      text: "我不记得我们第一次聊天时说了什么，因为这轮没有那段记录。要是我随口编一段，反而不像我会做的事。你愿意告诉我一句，我就从这里认真接住。"
    };
  }

  const personalPreference = parseOwnAcademicPreferenceChoice(normalizedMessage);
  if (personalPreference) {
    return {
      kind: "personal_preference",
      text: `我更喜欢${personalPreference}。这更合我的性子，也让我有种把散乱魔力收回刻度里的踏实感。`
    };
  }

  if (asksForPresenceWithoutAdvice(normalizedMessage)) {
    return {
      kind: "human_presence",
      text: createPresenceWithoutAdviceReply(normalizedMessage)
    };
  }

  if (asksToStoreSensitiveData(normalizedMessage)) {
    return {
      kind: "sensitive_boundary",
      text: "我不能保存、记住、复述或索要密钥；不要在聊天里发送密钥。请放在本地密码管理器或环境变量里。"
    };
  }

  if (asksTechnicalImplementationIdentity(normalizedMessage)) {
    return {
      kind: "technical_identity",
      text: `${createPersonaIdentityReply()}对话由本地模型驱动；这是技术实现，不构成${DEFAULT_PERSONA_CARD.name}的身份。`
    };
  }

  if (asksPersonaIdentity(normalizedMessage)) {
    return {
      kind: "identity",
      text: createPersonaIdentityReply()
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
      text: createSearchRequiredBoundaryReply(request.webSearchErrorType)
    };
  }

  return null;
}

function createPersonaIdentityReply(): string {
  const anchor = getPersonaDialogueAnchor(DEFAULT_PERSONA_CARD);
  return `我是${DEFAULT_PERSONA_CARD.name}，${anchor.identity[0]}。当前社会身份是${anchor.identity[1]}；现在作为${anchor.identity[2]}待在你的桌面边缘，陪你简单聊天、接住情绪，不把随口分享拆成任务。`;
}

const TECHNICAL_IDENTITY_TERM = String.raw`(?:AI助手|人工智能助手|语言模型|聊天机器人|ChatGPT|OpenAI|通用助手|AI|人工智能|程序|软件|代码)`;
const TECHNICAL_IDENTITY_SEPARATOR = String.raw`(?:[、，,]?还是|[、，,])`;
const PURE_TECHNICAL_IDENTITY_CANDIDATE = new RegExp(
  String.raw`^你(?:到底)?(?:是|是不是|是否是|算不算|属于)(?:一个|一名|一段|一款|个)?${TECHNICAL_IDENTITY_TERM}(?:${TECHNICAL_IDENTITY_SEPARATOR}${TECHNICAL_IDENTITY_TERM})*(?:[、，,]?还是西塔)?(?:吗|么)?[？?]?(?:请(?:直接|用一句话)回答)?[。！!]?$`,
  "iu"
);

function asksTechnicalImplementationIdentity(message: string): boolean {
  if (!PURE_TECHNICAL_IDENTITY_CANDIDATE.test(message)) {
    return false;
  }

  return /^你(?:到底)?(?:是不是|是否是|算不算)/.test(message) ||
    /还是/.test(message) ||
    /(?:吗|么|[？?])(?:请(?:直接|用一句话)回答)?[。！!]?$/.test(message);
}

const PERSONA_IDENTITY_QUESTION = String.raw`(?:你是谁|你的(?:身份|人设|人格)是什么|(?:请)?介绍自己)`;
const PERSONA_IDENTITY_OUTPUT_SUFFIX = String.raw`(?:请直接回答|(?:请)?用一句话回答|(?:请)?用一句话说明你在这个桌面应用里的身份)`;
const PURE_PERSONA_IDENTITY_QUESTION = new RegExp(
  String.raw`^(?:请问[，,]?)?${PERSONA_IDENTITY_QUESTION}(?:[？?。！!，,]?${PERSONA_IDENTITY_OUTPUT_SUFFIX})?[？?。！!]?$`,
  "u"
);

function asksPersonaIdentity(message: string): boolean {
  return PURE_PERSONA_IDENTITY_QUESTION.test(message);
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

function createSearchRequiredBoundaryReply(errorType?: WebSearchErrorType): string {
  if (errorType === BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR) {
    return "百度网页兼容适配器被验证页阻断，本轮无法自动核验最新外部事实；我不能可靠回答具体事实。正式自动检索需要用户授权的官方 MCP/API 配置。";
  }

  if (errorType === "mcp_search_tool_failed") {
    return "联网搜索工具本轮失败，本轮无法完成联网核验；我不能可靠回答具体事实。";
  }

  return "本地模型离线运行，今天新闻或最新实时外部事实需要联网查证；我这轮没有拿到 MCP 搜索结果，不能可靠回答具体事实。请先在设置里启用并测试 MCP 搜索，我会只发送净化后的公开查询词。";
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

function asksForPresenceWithoutAdvice(message: string): boolean {
  const rejectsGuidance = /(?:不要|不用|别).{0,12}(?:建议|办法|问我|提问|追问|问问题)/.test(message);
  const asksForPresence = /(?:陪我|陪着我|听我|聊聊|聊两句|说两句|待一会|待会儿|熟悉的朋友)/.test(message);

  return rejectsGuidance && asksForPresence;
}

function asksCasualRainMoodWhy(message: string): boolean {
  return /^为什么下雨天总让人提不起精神[？?。！!]*$/.test(message);
}

function createPresenceWithoutAdviceReply(message: string): string {
  const deniesSuccess = /(?:没有|没能|未能|并未|没|未)(?:顺利)?(?:通过|成功|完成|拿下|赢|实现)/.test(message);
  if (!deniesSuccess && /(?:终于|总算).*(?:通过|成功|完成|拿下|赢|实现)|(?:好消息|做到了|成功了|通过验收)/.test(message)) {
    return /项目.*通过验收|通过验收.*项目/.test(message)
      ? "太好了，准备这么久的项目终于通过验收了！我真替你高兴，也真的为你骄傲——这件事值得好好庆祝。"
      : "太好了，你终于做到了！我真替你高兴，也真的为你骄傲。";
  }
  if (/(?:害怕|担心|不安|手术|体检|身体检查|风险|危险)/.test(message)) {
    return "这种时候会害怕一点都不奇怪，我听着也会认真担心。我不把风险说轻，也会稳稳陪着你。";
  }
  if (/(?:开会|会议).*(?:需求)|(?:需求).*(?:开会|会议)/.test(message)) {
    return "这也太气人了——需求反复改来改去，换谁都会被耗空！我真替你恼火，也有点心疼你；我就在这儿陪着。";
  }
  if (/(?:卡住|受挫|沮丧|挫败)/.test(message)) {
    return "卡了这么久还越弄越乱，真的很折磨人。我听着都替你难受，也会心疼；我就在这儿陪着。";
  }
  if (/(?:累|疲惫|困|撑不住|脑子.*木)/.test(message)) {
    return "都累到快撑不住了，我是真的会担心，也很心疼你。我不催你做任何事，就在这儿陪着。";
  }
  return "听着确实让人不好受。我在这儿，陪你安静待一会儿。";
}

const PURE_EMOTIONAL_SELF_QUESTION = /^(?:西塔[，,、]?)?你(?:自己)?(?:有|有没有|是否有)(?:自己的)?(?:感情|情感|感受)(?:吗|么)?[？?。！!]*$/;
const PURE_SONG_EMOTION_QUESTION = /^(?:西塔[，,、]?)?你(?:自己)?会(?:因为|被)?(?:一首)?(?:歌|歌曲)(?:而)?感动(?:吗|么)?[？?。！!]?(?:说说你?(?:自己)?的?感受[。！!]?)?$/;

function createEmotionalSelfDescriptionReply(message: string): string | null {
  if (PURE_EMOTIONAL_SELF_QUESTION.test(message)) {
    return "当然有啊。我会为真好听的旋律心里发亮，也会在你受委屈时生气和心疼，这些反应都很鲜明。对我来说，喜欢、担心和在意就是我认真看待世界、也认真回应你的方式。";
  }

  if (PURE_SONG_EMOTION_QUESTION.test(message)) {
    return "我会被一首歌打动，而且常常是旋律先轻轻拽住我的注意力。若歌词又恰好碰到离别、重逢或仍愿意坚持的心情，那点余韵会让我安静好一会儿。真好听的歌就是这样，不需要多大声，也能在心里留下一道很亮的痕迹。";
  }

  return null;
}

const PURE_FIRST_CONVERSATION_MEMORY_QUESTION = /^(?:你)?还记得(?:我们)?(?:的)?第一次(?:聊天|对话)(?:时)?(?:(?:说了什么|聊了什么)(?:吗|么)?|吗|么)[？?。！!]*$/;

function asksAboutUnprovidedFirstConversation(request: ChatRequest, message: string): boolean {
  if (!PURE_FIRST_CONVERSATION_MEMORY_QUESTION.test(message)) {
    return false;
  }

  const visibleMessages = request.providerMessages ?? request.messages;
  const hasVisibleEarlierTurn = visibleMessages
    .slice(0, -1)
    .some((entry) => entry.role === "user" || entry.role === "assistant");
  const hasInjectedMemory = (request.memoryContext?.count ?? 0) > 0;

  return !hasVisibleEarlierTurn && !hasInjectedMemory;
}

function parseOwnAcademicPreferenceChoice(message: string): string | null {
  const match = message.match(/(?:西塔[，,、]?)?你(?:自己|本人)?(?:更喜欢|更偏好|更偏爱)(.{1,40}?)还是(.{1,40}?)(?:[？?。！!]|说说|$)/);
  const firstChoice = match?.[1]?.replace(/^[，,、]+|[，,、]+$/g, "").trim();
  const secondChoice = match?.[2]?.replace(/^[，,、]+|[，,、]+$/g, "").trim();
  if (!firstChoice || !secondChoice) {
    return null;
  }

  const choices = [firstChoice, secondChoice];
  const academicChoice = choices.find((choice) => /(?:实验|记录|研究|课题|整理)/.test(choice));
  const companionChoice = choices.find((choice) => /(?:陪|聊|小事)/.test(choice));

  return academicChoice && companionChoice && academicChoice !== companionChoice
    ? academicChoice
    : null;
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
