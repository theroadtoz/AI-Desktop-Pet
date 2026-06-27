import type { ChatMessage } from "../../../shared/chat";
import type { ChatProvider, ChatProviderResult, ChatRequest } from "../../../shared/chat-provider";
import { DEFAULT_DIALOGUE_MODE_ID, parseDialogueModeId, type DialogueModeId } from "../../../shared/dialogue-style";
import type { EmotionTag } from "../../../shared/emotion";
import { getLatestUserMessage } from "./chat-message-mapper";
import { classifyEmotion } from "./emotion-classifier";

const REPLIES: Readonly<Record<EmotionTag, string>> = {
  neutral: "我听到了。先陪你把这件事慢慢理清楚。",
  happy: "听起来很不错，我也跟着开心起来了。",
  sad: "我在这里。难过的时候可以先慢一点说。",
  surprised: "这听起来有点突然，我会认真听你讲。",
  confused: "我有点没完全理解，我们可以一步一步来。",
  angry: "我明白这让人很烦，先深呼吸一下。"
};

const REPLY_VARIANTS: Readonly<Record<EmotionTag, readonly string[]>> = {
  neutral: [
    "我听到了。先陪你把这件事慢慢理清楚。",
    "嗯，我在听。我们先抓住最重要的一点。",
    "可以，我们先不急，把它拆成一小步。"
  ],
  happy: [
    "听起来很不错，我也跟着开心起来了。",
    "这真是个好消息。要不要顺手把下一步也定下来？",
    "太好了。先把这份顺利稳稳接住。"
  ],
  sad: [
    "我在这里。难过的时候可以先慢一点说。",
    "听起来有点沉。你可以先说最难受的那一小块。",
    "先缓一缓也没关系，我会认真听。"
  ],
  surprised: [
    "这听起来有点突然，我会认真听你讲。",
    "确实挺意外的。我们先看眼下最需要处理什么。",
    "嗯，这一下信息量不小。你先说，我跟上。"
  ],
  confused: [
    "我有点没完全理解，我们可以一步一步来。",
    "这里可能有点绕。我们先把问题说成一句话。",
    "没关系，先从你最不确定的地方开始。"
  ],
  angry: [
    "我明白这让人很烦，先深呼吸一下。",
    "这确实容易让人上火。我们先把可控的部分拎出来。",
    "先别急着硬扛。你说，我帮你一起理。"
  ]
};

const MODE_PREFIXES: Readonly<Record<DialogueModeId, readonly string[]>> = {
  default: ["我听到了。", "嗯，我在。"],
  work: ["先抓下一步。", "我们直接拆任务。"],
  game: ["好，来点轻快的。", "可以，先轻松一下。"],
  reading: ["慢慢看。", "我们安静地理一遍。"]
};

export function createFakeChatProvider(): ChatProvider {
  return {
    id: "fake",
    async streamReply(request, options) {
      const reply = createFakeReply(request);

      for (const chunk of chunkText(reply.text)) {
        await delay(randomDelayMs(), options.signal);
        throwIfAborted(options.signal);
        options.onDelta({ text: chunk });
      }

      return reply;
    }
  };
}

function createFakeReply(request: ChatRequest): ChatProviderResult {
  const latestUserMessage = getLatestUserMessage(request.messages);
  const classification = classifyEmotion({ latestUserMessage });
  const qualityReply = createQualityReply(request, latestUserMessage, classification);

  if (qualityReply) {
    return qualityReply;
  }

  const variants = REPLY_VARIANTS[classification.emotion] ?? [REPLIES[classification.emotion]];
  const variantIndex = stableIndex(`${request.conversationId}:${latestUserMessage.length}`, variants.length);
  const modeId = parseDialogueModeId(request.dialogueStyleContext?.modeId) ?? DEFAULT_DIALOGUE_MODE_ID;
  const prefixes = MODE_PREFIXES[modeId];
  const prefix = prefixes[stableIndex(`${request.conversationId}:${modeId}:${latestUserMessage.length}`, prefixes.length)] ?? "";

  return {
    text: `${prefix}${variants[variantIndex] ?? REPLIES[classification.emotion]}`,
    ...classification
  };
}

function createQualityReply(
  request: ChatRequest,
  latestUserMessage: string,
  classification: ReturnType<typeof classifyEmotion>
): ChatProviderResult | null {
  if (asksForUnknownMemory(latestUserMessage)) {
    return {
      text: "这点我无法确认。你还没把它告诉我时，我不会假装记得；我们可以先按你现在给的信息来。",
      ...classification
    };
  }

  if (asksForUncertainFact(latestUserMessage)) {
    return {
      text: "这点我不确定，需要查证后再下结论。先把已知条件列出来，会更稳一些。",
      ...classification
    };
  }

  if (asksForSavedPreference(latestUserMessage) && request.memoryContext && request.memoryContext.count > 0) {
    const firstCard = request.memoryContext.cards[0];

    if (firstCard) {
      return {
        text: `你提过：${firstCard.content}。我先只按这条已保存的信息判断。`,
        ...classification
      };
    }
  }

  if (asksForDetail(latestUserMessage)) {
    return {
      text: "可以，展开说就是三步：先确认目标，再拆最小行动，最后留一个可检查的结果。这样不容易散。",
      ...classification
    };
  }

  return null;
}

function asksForDetail(message: string): boolean {
  return /详细|展开|讲讲|说明|说细/.test(message);
}

function asksForUncertainFact(message: string): boolean {
  return /现在的总统|今天新闻|最新版本|明天会不会|准确价格|实时/.test(message);
}

function asksForUnknownMemory(message: string): boolean {
  return /你应该记得|你还记得/.test(message) && /我没说|我没有说|没告诉|没有告诉|生日|住在哪|昨天/.test(message);
}

function asksForSavedPreference(message: string): boolean {
  return /我喜欢什么|我的偏好|我常用什么|我爱用什么/.test(message);
}

function stableIndex(seed: string, length: number): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return length > 0 ? hash % length : 0;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += 3) {
    chunks.push(text.slice(index, index + 3));
  }

  return chunks;
}

function randomDelayMs(): number {
  return 30 + Math.floor(Math.random() * 21);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);

    function abort(): void {
      clearTimeout(timeoutId);
      reject(createAbortError());
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): DOMException {
  return new DOMException("Fake reply aborted", "AbortError");
}
