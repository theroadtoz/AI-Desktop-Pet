import type { ChatMessage } from "../../../shared/chat";
import type { ChatProvider, ChatProviderResult } from "../../../shared/chat-provider";
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

function createFakeReply(request: { conversationId: string; messages: ChatMessage[] }): ChatProviderResult {
  const latestUserMessage = getLatestUserMessage(request.messages);
  const classification = classifyEmotion({ latestUserMessage });
  const variants = REPLY_VARIANTS[classification.emotion] ?? [REPLIES[classification.emotion]];
  const variantIndex = stableIndex(`${request.conversationId}:${latestUserMessage.length}`, variants.length);

  return {
    text: variants[variantIndex] ?? REPLIES[classification.emotion],
    ...classification
  };
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
