import type { ChatMessage } from "../../../shared/chat";
import type { ChatContextBudgetSummary, ChatProviderMessage } from "../../../shared/chat-provider";

export const CHAT_CONTEXT_RECENT_MESSAGE_BUDGET = 8;
export const CHAT_CONTEXT_SUMMARY_TRIGGER = 12;

export type ChatContextBudgetOptions = {
  recentMessageBudget?: number;
  summaryTrigger?: number;
};

export type ChatContextBudgetResult = {
  providerMessages: ChatProviderMessage[];
  summary: ChatContextBudgetSummary;
};

type RoleCounts = {
  user: number;
  assistant: number;
};

export function budgetChatContext(
  messages: readonly ChatMessage[],
  options: ChatContextBudgetOptions = {}
): ChatContextBudgetResult {
  const recentMessageBudget = normalizePositiveInteger(
    options.recentMessageBudget,
    CHAT_CONTEXT_RECENT_MESSAGE_BUDGET
  );
  const summaryTrigger = normalizePositiveInteger(
    options.summaryTrigger,
    CHAT_CONTEXT_SUMMARY_TRIGGER
  );

  if (messages.length <= summaryTrigger) {
    const providerMessages = messages.map(toProviderMessage);

    return {
      providerMessages,
      summary: {
        originalMessageCount: messages.length,
        providerMessageCount: providerMessages.length,
        compressed: false,
        summaryMessageCount: 0,
        summarizedMessageCount: 0,
        recentMessageCount: providerMessages.length
      }
    };
  }

  const recentMessages = messages.slice(-recentMessageBudget);
  const summarizedMessages = messages.slice(0, Math.max(0, messages.length - recentMessages.length));
  const summaryMessage = createSafeSummaryMessage(summarizedMessages);
  const providerMessages = [
    summaryMessage,
    ...recentMessages.map(toProviderMessage)
  ];

  return {
    providerMessages,
    summary: {
      originalMessageCount: messages.length,
      providerMessageCount: providerMessages.length,
      compressed: true,
      summaryMessageCount: 1,
      summarizedMessageCount: summarizedMessages.length,
      recentMessageCount: recentMessages.length
    }
  };
}

function createSafeSummaryMessage(messages: readonly ChatMessage[]): ChatProviderMessage {
  const counts = countRoles(messages);

  return {
    role: "system",
    content: [
      "context_summary_kind=earlier_history_counts",
      `summarizedMessageCount=${messages.length}`,
      `summarizedUserMessageCount=${counts.user}`,
      `summarizedAssistantMessageCount=${counts.assistant}`
    ].join("\n")
  };
}

function countRoles(messages: readonly ChatMessage[]): RoleCounts {
  return messages.reduce<RoleCounts>((counts, message) => {
    counts[message.role] += 1;
    return counts;
  }, {
    user: 0,
    assistant: 0
  });
}

function toProviderMessage(message: ChatMessage): ChatProviderMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
