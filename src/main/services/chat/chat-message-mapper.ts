import type { ChatMessage } from "../../../shared/chat";
import type { MemoryInjection } from "../../../shared/chat-memory";
import type { DialogueStyleContext } from "../../../shared/dialogue-style";
import type { UserProfilePromptContext } from "../../../shared/user-profile";
import { createDefaultDialogueStyleContext, createDialogueStylePrompt } from "./dialogue-style";

export type OpenAICompatibleMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = "你是一个低打扰的桌面伙伴。回复要自然、简短，优先使用中文。不要输出 JSON。";

export function mapChatMessagesToOpenAICompatible(
  messages: ChatMessage[],
  memoryContext?: MemoryInjection,
  dialogueStyleContext: DialogueStyleContext = createDefaultDialogueStyleContext(),
  userProfileContext?: UserProfilePromptContext
): OpenAICompatibleMessage[] {
  const dialogueStyleMessage = createDialogueStyleMessage(dialogueStyleContext);
  const userProfileMessage = createUserProfileMessage(userProfileContext);
  const memoryMessage = createMemoryMessage(memoryContext);

  return [
    { role: "system", content: SYSTEM_PROMPT },
    dialogueStyleMessage,
    ...(userProfileMessage ? [userProfileMessage] : []),
    ...(memoryMessage ? [memoryMessage] : []),
    ...messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
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

function createDialogueStyleMessage(context: DialogueStyleContext): OpenAICompatibleMessage {
  return {
    role: "system",
    content: createDialogueStylePrompt(context)
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
    content: `以下是用户明确授权保存在本机的事实卡，仅用于当前回复，不要声称拥有其他记忆。\n${lines.join("\n")}`
  };
}

export function getLatestUserMessage(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "user") {
      return message.content;
    }
  }

  return "";
}
