import type { FakeReply } from "../../shared/chat";
import type { EmotionTag } from "../../shared/emotion";

const REPLIES: Readonly<Record<EmotionTag, string>> = {
  neutral: "我听到了。先陪你把这件事慢慢理清楚。",
  happy: "听起来很不错，我也跟着开心起来了。",
  sad: "我在这里。难过的时候可以先慢一点说。",
  surprised: "这听起来有点突然，我会认真听你讲。",
  confused: "我有点没完全理解，我们可以一步一步来。",
  angry: "我明白这让人很窝火，先深呼吸一下。"
};

const KEYWORD_RULES: readonly {
  emotion: EmotionTag;
  keywords: readonly string[];
}[] = [
  { emotion: "happy", keywords: ["开心", "好", "喜欢", "棒", "谢谢"] },
  { emotion: "sad", keywords: ["难过", "哭", "伤心", "累", "不开心"] },
  { emotion: "angry", keywords: ["生气", "烦", "讨厌", "火", "气死"] }
];

type StreamFakeReplyOptions = {
  signal?: AbortSignal;
  onDelta(chunk: string): void;
};

export function createFakeReply(input: string): FakeReply {
  const emotion = detectEmotion(input);
  return {
    text: REPLIES[emotion],
    emotion
  };
}

export async function streamFakeReply(
  input: string,
  options: StreamFakeReplyOptions
): Promise<FakeReply> {
  const reply = createFakeReply(input);

  for (const chunk of chunkText(reply.text)) {
    await delay(randomDelayMs(), options.signal);
    throwIfAborted(options.signal);
    options.onDelta(chunk);
  }

  return reply;
}

function detectEmotion(input: string): EmotionTag {
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => input.includes(keyword))) {
      return rule.emotion;
    }
  }

  return "neutral";
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

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    function abort(): void {
      window.clearTimeout(timeoutId);
      reject(createAbortError());
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): DOMException {
  return new DOMException("Fake reply aborted", "AbortError");
}
