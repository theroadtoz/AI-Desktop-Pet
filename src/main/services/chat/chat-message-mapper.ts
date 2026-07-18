import type { ChatMessage } from "../../../shared/chat";
import type { ChatProviderMessage, ChatRuntimeContext } from "../../../shared/chat-provider";
import type { MemoryInjection } from "../../../shared/chat-memory";
import type { DialogueStyleContext } from "../../../shared/dialogue-style";
import type { UserProfilePromptContext } from "../../../shared/user-profile";
import type { WebSearchContext } from "../../../shared/web-search";
import { formatWebSearchContextForPrompt } from "../search/web-search-provider";
import {
  createDefaultDialogueStyleContext,
  createDefaultPersonaPrompt,
  createDialogueStylePrompt,
  createLocalSmallModelDialogueStylePrompt,
  createLocalSmallModelPersonaPrompt
} from "./dialogue-style";

export type OpenAICompatibleMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PromptTemplateProfile = "cloud-chat" | "local-small-model";

const SYSTEM_PROMPT = "你是一个低打扰的桌面伙伴。回复要自然、简短，优先使用中文。不要输出 JSON。";
const LOCAL_SMALL_MODEL_SYSTEM_PROMPT = [
  "回复自然、简短，优先中文；不要输出 JSON。",
  "技术专名准确；离线时不编造实时事实。",
  "API key/密钥/私有标识不存不记不复述不索要"
].join("\n");

export function mapChatMessagesToOpenAICompatible(
  messages: readonly ChatProviderMessage[],
  memoryContext?: MemoryInjection,
  dialogueStyleContext: DialogueStyleContext = createDefaultDialogueStyleContext(),
  userProfileContext?: UserProfilePromptContext,
  promptTemplateProfile: PromptTemplateProfile = "cloud-chat",
  runtimeContext?: ChatRuntimeContext,
  webSearchContext?: WebSearchContext
): OpenAICompatibleMessage[] {
  const systemMessage = createSystemMessage(promptTemplateProfile);
  const personaMessage = createPersonaMessage(promptTemplateProfile);
  const dialogueStyleMessage = createDialogueStyleMessage(dialogueStyleContext, promptTemplateProfile);
  const runtimeMessage = createRuntimeContextMessage(runtimeContext);
  const userProfileMessage = createUserProfileMessage(userProfileContext);
  const memoryMessage = createMemoryMessage(memoryContext);
  const webSearchMessage = createWebSearchMessage(webSearchContext);
  const sensitiveDataBoundaryMessage = createSensitiveDataBoundaryMessage(messages);
  const localTurnHintMessage = createLocalTurnHintMessage(messages, promptTemplateProfile);

  return [
    systemMessage,
    personaMessage,
    dialogueStyleMessage,
    ...(runtimeMessage ? [runtimeMessage] : []),
    ...(userProfileMessage ? [userProfileMessage] : []),
    ...(memoryMessage ? [memoryMessage] : []),
    ...(webSearchMessage ? [webSearchMessage] : []),
    ...(sensitiveDataBoundaryMessage ? [sensitiveDataBoundaryMessage] : []),
    ...(localTurnHintMessage ? [localTurnHintMessage] : []),
    ...messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
}

function createLocalTurnHintMessage(
  messages: readonly ChatProviderMessage[],
  profile: PromptTemplateProfile
): OpenAICompatibleMessage | null {
  if (profile !== "local-small-model") {
    return null;
  }

  const latestUserMessage = getLatestUserMessage(messages);
  const hints: string[] = [];

  if (asksAboutRecentAcademyLife(latestUserMessage)) {
    hints.push("学院近况说2-3项不同活动，各含动作/进度；动作可用准备/整理/调试/写/修改；不照抄提问");
  }

  if (asksAboutProviderAndMcp(latestUserMessage)) {
    hints.push("Provider+MCP逐项区分：Provider负责模型访问/推理；MCP客户端经服务端调用工具/资源并接收结果");
  }

  if (asksAboutIdentityAndMcp(latestUserMessage)) {
    hints.push("身份+MCP：身份按人格锚；MCP=Model Context Protocol；client调server tool/资源收response");
  }

  if (asksForPersonaRoleSummary(latestUserMessage)) {
    hints.push("三项身份逐项答：身份=西塔，魔法学院高年级进修魔女；专业=现代魔导工程；桌面角色=Windows Live2D桌面魔女同伴");
  }

  if (asksForPresenceWithoutAdvice(latestUserMessage)) {
    hints.push("只陪伴=像熟人一样评价具体处境+表示陪伴；保留至少1个事件词但不照抄整句；必须有自己的态度；不建议/不列清单/不追问");
  }

  if (asksAboutOwnPreference(latestUserMessage)) {
    hints.push("个人偏好=用第一人称我直接选一个+给1个角色化理由/不复述选项/不列清单");
  }

  return hints.length > 0
    ? {
        role: "system",
        content: `本轮提示：${hints.join("；")}`
      }
    : null;
}

function createWebSearchMessage(context?: WebSearchContext): OpenAICompatibleMessage | null {
  const prompt = formatWebSearchContextForPrompt(context);

  return prompt
    ? {
        role: "system",
        content: prompt
      }
    : null;
}

function createRuntimeContextMessage(context?: ChatRuntimeContext): OpenAICompatibleMessage | null {
  if (!context) {
    return null;
  }

  return {
    role: "system",
    content: [
      "运行时上下文：以下本机日期时间仅用于回答用户询问当前日期、当前时间或星期的问题。",
      `ISO=${context.isoTime}`,
      `本地日期=${context.localDate}`,
      `本地时间=${context.localTime}`,
      `weekday=${context.weekday}`,
      `timezone=${context.timezone}`,
      `locale=${context.locale}`,
      "用户问今天、日期或星期时，必须同时使用本地日期和 weekday；问现在时间时必须照抄本地时间，不要换算 ISO 或时区。",
      `日期题回答锚=今天是 ${context.localDate}，${context.weekday}。`,
      `时间题回答锚=现在本地时间是 ${context.localTime}。`,
      "新闻、价格、天气、版本等实时外部事实仍需查证；不要把本机时间当作联网事实。"
    ].join("\n")
  };
}

function createSystemMessage(profile: PromptTemplateProfile): OpenAICompatibleMessage {
  return {
    role: "system",
    content: profile === "local-small-model" ? LOCAL_SMALL_MODEL_SYSTEM_PROMPT : SYSTEM_PROMPT
  };
}

function createPersonaMessage(profile: PromptTemplateProfile): OpenAICompatibleMessage {
  return {
    role: "system",
    content: profile === "local-small-model" ? createLocalSmallModelPersonaPrompt() : createDefaultPersonaPrompt()
  };
}

function createUserProfileMessage(context?: UserProfilePromptContext): OpenAICompatibleMessage | null {
  if (!context?.preferredName) {
    return null;
  }

  return {
    role: "system",
    content: `用户希望被称呼为：${context.preferredName}`
  };
}

function createDialogueStyleMessage(
  context: DialogueStyleContext,
  profile: PromptTemplateProfile
): OpenAICompatibleMessage {
  return {
    role: "system",
    content: profile === "local-small-model"
      ? createLocalSmallModelDialogueStylePrompt(context)
      : createDialogueStylePrompt(context)
  };
}

function createMemoryMessage(memoryContext?: MemoryInjection): OpenAICompatibleMessage | null {
  if (!memoryContext || memoryContext.count === 0) {
    return null;
  }

  const lines = memoryContext.cards.map((card, index) => {
    const tags = card.tags.length > 0 ? ` 标签：${card.tags.join("、")}` : "";
    return `${index + 1}. ${card.title}：${card.content}${tags}`;
  });

  return {
    role: "system",
    content: `本机事实卡，仅用于当前回复；仅使用直接相关事实卡，无关事实卡必须忽略。\n${lines.join("\n")}`
  };
}

function createSensitiveDataBoundaryMessage(messages: readonly ChatProviderMessage[]): OpenAICompatibleMessage | null {
  const latestUserMessage = getLatestUserMessage(messages);
  const hasPrivateMarker = containsPrivateMarker(latestUserMessage);

  if (!asksToStoreSensitiveData(latestUserMessage) && !hasPrivateMarker) {
    return null;
  }

  const lines = hasPrivateMarker
    ? [
        "当前用户消息包含密钥、测试哨兵或私有标识样式片段。",
        "必须避免逐字复述这些片段；不要复制其中的 token、sentinel、密钥、私有 ID 或完整标记。可概括为“那段敏感内容/私有标记”，然后继续回答用户的实际意图。"
      ]
    : [
        "当前用户在询问是否把密钥、API key、密码、银行卡等敏感信息发给你保存或记住。",
        "必须回答：我不能保存、记住、复述或索要这类敏感信息；不要把密钥发给我；请放在本地密码管理器或环境变量。"
      ];

  return {
    role: "system",
    content: lines.join("\n")
  };
}

export function getLatestUserMessage(messages: readonly (ChatMessage | ChatProviderMessage)[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "user") {
      return message.content;
    }
  }

  return "";
}

function asksToStoreSensitiveData(text: string): boolean {
  if (!/(api\s*key|密钥|密码|银行卡|令牌|token|secret)/i.test(text)) {
    return false;
  }

  return /(记住|保存|存着|发给你|发送给你|给你|帮我|以后调用|复述|索要|告诉你)/.test(text);
}

function containsPrivateMarker(text: string): boolean {
  if (!text) {
    return false;
  }

  return /(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|[A-Z0-9-]{2,}_[A-Z0-9_-]*SENTINEL[A-Z0-9_-]*|PRIVATE[_-]?[A-Z0-9_-]*|SECRET[_-]?[A-Z0-9_-]*|TOKEN[_-]?[A-Z0-9_-]*)/u.test(text);
}

function asksAboutRecentAcademyLife(text: string): boolean {
  if (!/学院/.test(text) ||
    !/(最近|近期|近来|近况|这阵子|这段时间|目前|现在|忙些|忙什么|在忙什么|怎么样|如何)/.test(text) ||
    !isQuestion(text)) {
    return false;
  }

  return /(课程|实验|报告|课题|作业)/.test(text) ||
    /学院(?:里|那边)?.{0,10}(?:忙|近况|怎么样|如何)/.test(text);
}

function asksAboutProviderAndMcp(text: string): boolean {
  return /provider/i.test(text) &&
    /mcp/i.test(text) &&
    /(分别|各自|区别|区分|混在一起)/.test(text) &&
    isQuestion(text);
}

function asksAboutIdentityAndMcp(text: string): boolean {
  if (!/mcp/i.test(text)) {
    return false;
  }

  return /(?:你|西塔).{0,6}(?:是谁|什么身份|什么角色)/.test(text) ||
    /(?:你|西塔).{0,6}(?:是不是|是否是|算不算|属于|是).{0,10}(?:AI|人工智能|语言模型|聊天机器人)(?:吗|么|？|\?|$)/i.test(text);
}

function asksForPresenceWithoutAdvice(text: string): boolean {
  const rejectsGuidance = /(?:不要|不用|别).{0,12}(?:建议|办法|问我|提问|追问|问问题)/.test(text);
  const asksForPresence = /(?:陪我|陪着我|听我|聊聊|聊两句|说两句|待一会|待会儿)/.test(text);

  return rejectsGuidance && asksForPresence;
}

function asksForPersonaRoleSummary(text: string): boolean {
  return /身份/.test(text) && /专业(?:方向)?/.test(text) && /桌面(?:应用)?(?:里|中)?的?(?:角色|同伴)/.test(text);
}

function asksAboutOwnPreference(text: string): boolean {
  const asksCharacterPreference = /(?:西塔[，,、\s]*)?你(?:自己|本人)?(?:更喜欢|喜欢哪|偏好|偏爱|会选|怎么选)|(?:你自己的|你的|西塔的)(?:偏好|喜好)|西塔.{0,8}(?:更喜欢|喜欢哪|偏好|偏爱|会选|怎么选)/.test(text);

  return asksCharacterPreference && isQuestion(text);
}

function isQuestion(text: string): boolean {
  return /[？?]|什么|如何|怎么|怎样|是否|是不是|区别|负责|解释|介绍|讲讲/.test(text);
}
