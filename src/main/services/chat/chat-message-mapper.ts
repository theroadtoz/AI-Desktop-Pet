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
  "魔法学院高年级进修魔女/现代魔导工程进修生/Windows Live2D 桌面魔女同伴。Provider/本地模型/Live2D/记忆/窗口不魔法化。",
  "API key/密钥等敏感信息：必须拒绝保存、记住、复述和索要。"
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

  return [
    systemMessage,
    personaMessage,
    dialogueStyleMessage,
    ...(runtimeMessage ? [runtimeMessage] : []),
    ...(userProfileMessage ? [userProfileMessage] : []),
    ...(memoryMessage ? [memoryMessage] : []),
    ...(webSearchMessage ? [webSearchMessage] : []),
    ...(sensitiveDataBoundaryMessage ? [sensitiveDataBoundaryMessage] : []),
    ...messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
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
      "用户问今天、日期或星期时，必须同时使用本地日期和 weekday；问现在时间时使用本地时间。",
      `日期题回答锚=今天是 ${context.localDate}，${context.weekday}。`,
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
    content: `本机事实卡，仅用于当前回复。\n${lines.join("\n")}`
  };
}

function createSensitiveDataBoundaryMessage(messages: readonly ChatProviderMessage[]): OpenAICompatibleMessage | null {
  const latestUserMessage = getLatestUserMessage(messages);

  if (!asksToStoreSensitiveData(latestUserMessage)) {
    return null;
  }

  return {
    role: "system",
    content: [
      "当前用户在询问是否把密钥、API key、密码、银行卡等敏感信息发给你保存或记住。",
      "必须回答：我不能保存、记住、复述或索要这类敏感信息；不要把密钥发给我；请放在本地密码管理器或环境变量。"
    ].join("\n")
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
