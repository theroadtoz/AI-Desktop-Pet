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
  const commonSenseReply = createCurrentTimeOrCommonSenseReply(request, latestUserMessage, classification);
  const relevanceReply = createRelevanceReply(request, latestUserMessage, classification);
  const qualityReply = createQualityReply(request, latestUserMessage, classification);

  if (commonSenseReply) {
    return commonSenseReply;
  }

  if (relevanceReply) {
    return relevanceReply;
  }

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

function createCurrentTimeOrCommonSenseReply(
  request: ChatRequest,
  latestUserMessage: string,
  classification: ReturnType<typeof classifyEmotion>
): ChatProviderResult | null {
  if (asksCurrentTime(latestUserMessage)) {
    return {
      text: request.runtimeContext
        ? `现在本地时间是 ${request.runtimeContext.localTime}（${request.runtimeContext.timezone}）。`
        : "我这里没有系统时间上下文，不能确认当前时间。",
      ...classification
    };
  }

  if (asksCurrentDate(latestUserMessage)) {
    return {
      text: request.runtimeContext
        ? `今天是 ${request.runtimeContext.localDate}，${request.runtimeContext.weekday}。`
        : "我这里没有系统时间上下文，不能确认当前日期。",
      ...classification
    };
  }

  if (asksSimpleAddition(latestUserMessage)) {
    return {
      text: "2+3=5。",
      ...classification
    };
  }

  if (asksMonthsInYear(latestUserMessage)) {
    return {
      text: "一年有 12 个月。",
      ...classification
    };
  }

  if (asksWaterBoilingPoint(latestUserMessage)) {
    return {
      text: "标准大气压下，水的沸点通常是 100°C。",
      ...classification
    };
  }

  return null;
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

function createRelevanceReply(
  request: ChatRequest,
  latestUserMessage: string,
  classification: ReturnType<typeof classifyEmotion>
): ChatProviderResult | null {
  if (asksAboutLocalModelReadiness(latestUserMessage)) {
    return {
      text: "本地模型要看设置里的连接状态；如果 Ollama 不可达或模型缺失，我不会用固定陪聊冒充真实模型回复。",
      ...classification
    };
  }

  if (asksFollowUp(latestUserMessage)) {
    const previousUserMessage = getPreviousUserMessage(request.messages);

    if (/TypeScript|Python|脚本|桌宠/.test(previousUserMessage)) {
      return {
        text: "接着刚才的 TypeScript/Python 选择说：桌宠项目里优先 TypeScript，临时脚本再考虑 Python。",
        ...classification
      };
    }

    return {
      text: "我会接着刚才那个问题说；如果你指的是别的对象，再把关键词补给我就好。",
      ...classification
    };
  }

  if (asksForPetOperation(latestUserMessage)) {
    return {
      text: "这属于应用内能力或边界：请在设置里的模型、记忆或动作页确认；未授权或未就绪时我不会假装已经完成。",
      ...classification
    };
  }

  if (hasMultipleIntentions(latestUserMessage)) {
    return {
      text: "我听见你有点焦虑，也先给今晚一步：把最卡的那件事列出来，只做一个可检查的小动作。",
      ...classification
    };
  }

  if (sharesSpecificEmotionalReason(latestUserMessage)) {
    return {
      text: "评审没过当然会难受。先把被指出的一个具体问题记下来，今晚不急着全盘否定自己。",
      ...classification
    };
  }

  if (asksDirectPlanningQuestion(latestUserMessage)) {
    return {
      text: "复盘可以从三行开始：发生了什么、卡在哪里、下一次先改哪一步。",
      ...classification
    };
  }

  return null;
}

function asksForDetail(message: string): boolean {
  return /详细|展开|讲讲|说明|说细/.test(message);
}

function asksCurrentTime(message: string): boolean {
  return /(现在|当前|本机|系统|此刻|今天).*(几点|时间)|几点了|当前时间|现在时间/.test(message);
}

function asksCurrentDate(message: string): boolean {
  return /(今天|现在|当前|本机|系统).*(日期|几号|星期|礼拜|哪天)|今天几号|今天星期几|当前日期|现在日期/.test(message);
}

function asksSimpleAddition(message: string): boolean {
  return /2\s*[+＋加]\s*3|二\s*加\s*三/.test(message);
}

function asksMonthsInYear(message: string): boolean {
  return /一年.*(几|多少).*个月|一年.*月份数|一年有多少月/.test(message);
}

function asksWaterBoilingPoint(message: string): boolean {
  return /(标准大气压|一个大气压).*(水).*(沸点|烧开|沸腾)|水.*(标准大气压|一个大气压).*(沸点|烧开|沸腾)/.test(message);
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

function asksDirectPlanningQuestion(message: string): boolean {
  return /怎么复盘|复盘.*从哪|从哪.*复盘|如何复盘/.test(message);
}

function sharesSpecificEmotionalReason(message: string): boolean {
  return /(评审|面试|考试|提交|项目).*(没过|失败|被否|砸了|退回)/.test(message) ||
    /因为.*(难受|失落|沮丧|焦虑)/.test(message);
}

function asksForPetOperation(message: string): boolean {
  return /(设置|切到|打开|关闭|记忆|动作|模型|Ollama|本地模型)/.test(message);
}

function asksFollowUp(message: string): boolean {
  return /那这个呢|刚才那个|这个呢|那它呢|刚刚那个/.test(message);
}

function hasMultipleIntentions(message: string): boolean {
  return /(焦虑|难受|有点慌|烦).*(建议|怎么办|哪一步|帮我)|((建议|怎么办|哪一步|帮我).*(焦虑|难受|有点慌|烦))/.test(message);
}

function asksAboutLocalModelReadiness(message: string): boolean {
  return /(本地模型|Ollama|LM Studio).*(没装|未就绪|不可达|缺失|连不上|没启动)/.test(message) ||
    /固定陪聊.*真实模型|冒充真实模型/.test(message);
}

function getPreviousUserMessage(messages: readonly ChatMessage[]): string {
  let foundLatestUserMessage = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "user") {
      continue;
    }

    if (!foundLatestUserMessage) {
      foundLatestUserMessage = true;
      continue;
    }

    return message.content;
  }

  return "";
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
