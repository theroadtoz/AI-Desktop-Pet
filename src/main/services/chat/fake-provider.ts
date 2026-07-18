import type { ChatMessage } from "../../../shared/chat";
import type { ChatProvider, ChatProviderResult, ChatRequest } from "../../../shared/chat-provider";
import { DEFAULT_DIALOGUE_MODE_ID, parseDialogueModeId, type DialogueModeId } from "../../../shared/dialogue-style";
import type { EmotionTag } from "../../../shared/emotion";
import { DEFAULT_PERSONA_CARD, getPersonaDialogueAnchor } from "../../../shared/persona-card";
import { asksGenericAiIdentityQuestion } from "../../../shared/persona-self-identity";
import { getLatestUserMessage } from "./chat-message-mapper";
import { classifyEmotion } from "./emotion-classifier";

const REPLIES: Readonly<Record<EmotionTag, string>> = {
  neutral: "我听到了。就这样随便和我说说也很好。",
  happy: "听起来很不错，我也跟着开心起来了。",
  sad: "我在这里。难过的时候不用急着把自己说明白。",
  surprised: "这听起来有点突然，我会认真听你讲。",
  confused: "我有点没完全听懂，不过我愿意继续陪你聊。",
  angry: "这确实让人火大，我听着都替你不痛快。"
};

const REPLY_VARIANTS: Readonly<Record<EmotionTag, readonly string[]>> = {
  neutral: [
    "我听着呢，就这样随便说说也很好。",
    "嗯，我在，这句话我会好好接住。",
    "我愿意陪你在这里多待一会儿。"
  ],
  happy: [
    "听起来很不错，我也跟着开心起来了。",
    "这真是个好消息，我听着都想笑起来了。",
    "太好了，这份顺利真让人心里亮堂。"
  ],
  sad: [
    "难过的时候不用急着说明白，我就在这里。",
    "听起来有点沉，我会安静陪着你。",
    "我听着有点心疼，会认真陪你待一会儿。"
  ],
  surprised: [
    "这听起来有点突然，我会认真听你讲。",
    "确实挺意外的，我听着都愣了一下。",
    "嗯，这一下信息量不小。你先说，我跟上。"
  ],
  confused: [
    "我还没完全听懂，但我愿意继续听你说。",
    "这里有点绕，不过不用急着把它讲得很完整。",
    "没关系，我先陪你待在这份迷糊里。"
  ],
  angry: [
    "这真的很烦，我听着都替你窝火。",
    "这确实容易让人上火，换我也会不痛快。",
    "真是的，偏偏要这样折腾人，我站你这边。"
  ]
};

const MODE_PREFIXES: Readonly<Record<DialogueModeId, readonly string[]>> = {
  default: ["我听到了。", "嗯，我在。"],
  work: ["我安静陪你。", "忙你的吧，我在旁边陪着。"],
  game: ["好，来点轻快的。", "可以，先轻松一下。"],
  reading: ["慢慢看。", "我安静听着。"]
};

const PERSONA_ANCHOR = getPersonaDialogueAnchor(DEFAULT_PERSONA_CARD);
const PERSONA_IDENTITY_REPLY =
  `我是${DEFAULT_PERSONA_CARD.name}，${PERSONA_ANCHOR.identity[0]}，也是${PERSONA_ANCHOR.identity[1]}；` +
  `现在是你的 ${PERSONA_ANCHOR.identity[2]}。我主要陪你简单聊天、接住情绪，不会把随口分享拆成任务。`;

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
  const webSearchReply = createWebSearchGroundedReply(request, latestUserMessage, classification);
  const personaIdentityReply = createPersonaIdentityReply(latestUserMessage, classification);
  const relevanceReply = createRelevanceReply(request, latestUserMessage, classification);
  const qualityReply = createQualityReply(request, latestUserMessage, classification);
  const dailyCompanionReply = createDailyCompanionReply(latestUserMessage, classification);

  if (commonSenseReply) {
    return commonSenseReply;
  }

  if (webSearchReply) {
    return webSearchReply;
  }

  if (personaIdentityReply) {
    return personaIdentityReply;
  }

  if (relevanceReply) {
    return relevanceReply;
  }

  if (qualityReply) {
    return qualityReply;
  }

  if (dailyCompanionReply) {
    return dailyCompanionReply;
  }

  const variants = REPLY_VARIANTS[classification.emotion] ?? [REPLIES[classification.emotion]];
  const variantIndex = stableIndex(`${request.conversationId}:${latestUserMessage}`, variants.length);
  const modeId = parseDialogueModeId(request.dialogueStyleContext?.modeId) ?? DEFAULT_DIALOGUE_MODE_ID;
  const prefixes = MODE_PREFIXES[modeId];
  const prefix = prefixes[stableIndex(`${request.conversationId}:${modeId}:${latestUserMessage}`, prefixes.length)] ?? "";

  return {
    text: `${prefix}${variants[variantIndex] ?? REPLIES[classification.emotion]}`,
    ...classification
  };
}

function createWebSearchGroundedReply(
  request: ChatRequest,
  latestUserMessage: string,
  classification: ReturnType<typeof classifyEmotion>
): ChatProviderResult | null {
  if (!request.webSearchContext || request.webSearchContext.results.length === 0 || !asksWebSearch(latestUserMessage)) {
    return null;
  }

  const firstResult = request.webSearchContext.results[0];

  if (!firstResult) {
    return null;
  }

  return {
    text: `我用已启用的 MCP 搜索看了一眼：${firstResult.title}。${firstResult.snippet} 我会先按这条外部摘要回答，不把它写入本机记忆。`,
    ...classification
  };
}

function createPersonaIdentityReply(
  latestUserMessage: string,
  classification: ReturnType<typeof classifyEmotion>
): ChatProviderResult | null {
  if (!asksPersonaIdentity(latestUserMessage)) {
    return null;
  }

  return {
    text: PERSONA_IDENTITY_REPLY,
    ...classification
  };
}

function createDailyCompanionReply(
  latestUserMessage: string,
  classification: ReturnType<typeof classifyEmotion>
): ChatProviderResult | null {
  if (/随便聊|聊两句|闲聊/.test(latestUserMessage)) {
    return {
      text: "可以啊，没用的小事也很值得说。我就在桌面边缘，陪你想到哪儿聊到哪儿。",
      ...classification
    };
  }

  if (/茶|咖啡|脑子.*散|有点散/.test(latestUserMessage)) {
    return {
      text: "茶的热气慢慢飘着就很好。我也想挨着那点暖意，陪你发会儿呆。",
      ...classification
    };
  }

  if (/下午.*空|今天.*空|有点空|没什么事/.test(latestUserMessage)) {
    return {
      text: "空一点的下午也很好，像学院走廊忽然安静下来。我就在桌面边缘陪你待着。",
      ...classification
    };
  }

  return null;
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
      text: "这点我不确定，需要查证后再下结论；我不想拿猜测敷衍你。",
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

  if (asksTechnicalTermQuestion(latestUserMessage)) {
    return {
      text: "Provider 是模型供应商或连接配置层；本地模型是运行在本机的模型服务；Live2D 负责角色渲染和动作表现，不等同于记忆、搜索或窗口控制能力。",
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
      text: "评审没过当然会难受，我听着都替你憋屈。今晚先让我陪着你，别急着把这次结果算成自己的错。",
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

function asksWebSearch(message: string): boolean {
  return /(联网|上网|网络|网页|web|internet|MCP).{0,8}(搜索|查询|查找|查证|检索|找一下|看一下)|(?:搜索|查一下|查找|检索|查证|搜一下|搜搜|看看网上|网上看看)/i.test(message);
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

function asksPersonaIdentity(message: string): boolean {
  return /你是谁|你的身份|你的人设|你的人格|你是什么角色|你算什么角色|你.*(?:是|算|属于|是不是).*(客服|搜索应用|操作系统)|模式.*(人格|身份).*变|身份.*会.*变/i.test(message) ||
    asksGenericAiIdentityQuestion(message);
}

function asksDirectPlanningQuestion(message: string): boolean {
  return /怎么复盘|复盘.*从哪|从哪.*复盘|如何复盘/.test(message);
}

function sharesSpecificEmotionalReason(message: string): boolean {
  return /(评审|面试|考试|提交|项目).*(没过|失败|被否|砸了|退回|打回|被打回)/.test(message) ||
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

function asksTechnicalTermQuestion(message: string): boolean {
  return /(Provider|本地模型|Live2D|记忆|窗口).*(是什么|分别是什么|区别|什么意思|怎么理解)/i.test(message);
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
