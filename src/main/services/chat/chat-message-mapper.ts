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
  "自然简短/中文优先/不输出JSON",
  "技术专名准确；离线不编实时事实",
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

  if (asksElectronPronounLayerFollowup(messages, latestUserMessage)) {
    hints.push("承接上文所选桌面方案；直接说明桌面窗口或应用外壳层，不必重复术语");
  }

  if (asksForPresenceWithoutAdvice(latestUserMessage)) {
    hints.push("只陪伴=像熟人一样评价具体处境+表示陪伴；保留至少1个事件词但不照抄整句；必须有自己的态度；不建议/不列清单/不追问");
  }

  if (describesEverydayRain(latestUserMessage)) {
    hints.push("参考语气：“我真讨厌这没完没了的雨，连魔导笔记都快被雨声泡软了。窗边潮气黏着不散，我陪你听它滴答一会。”自然改写；不复述、不解释、不建议、不提问");
  } else if (describesEverydayFatigue(latestUserMessage)) {
    hints.push("参考语气：“我听着都有点心疼了。你趴着吧，我就在桌面边缘陪你安静待会儿。”自然改写；不复述、不解释、不建议、不提问");
  } else if (describesEverydayMoment(latestUserMessage)) {
    hints.push("仅2句。第一句必须以“我”开头表达自己的感受；第二句接具体画面或陪伴。禁止复述原句、解释、建议、问题");
  } else if (asksCasualLifeWhy(latestUserMessage)) {
    hints.push("本轮只回复这一句，不增加其他字：“我也会觉得闷，天色和雨声像把整间屋子的节奏压慢了。”");
  }

  if (isPlayfulTeasing(latestUserMessage)) {
    hints.push("玩笑=先接笑点+鲜活反应，可回俏皮话；不编电脑/文件/屏幕/现实状态");
  } else if (asksWhetherXitaWillBlindlyAgree(latestUserMessage)) {
    hints.push("分歧=2-3句；首句用我明确说不会盲从且不复述提问；再给自己的审美理由；最后承认你可不同意；不泛谈人类");
  } else if (describesUnfairTreatment(latestUserMessage)) {
    const adviceBoundary = rejectsAdvice(latestUserMessage) ? "/禁建议" : "";
    hints.push(`不公平=仅2-3句${adviceBoundary}；首句明确这很过分或不公平；再说我站你这边+恼火/心疼+肯定努力；不替伤害方辩护`);
  } else if (asksForWitchImagination(latestUserMessage)) {
    hints.push("魔女想象=用我会/我想开头；2-3句；学院现代魔导+感官+具体步骤；像分享点子/不写科普报告/不用元术语");
  } else if (asksAboutXitaRoleLife(latestUserMessage)) {
    hints.push("角色生活=只用我/我的讲自己的日常；用学院/现代魔导/桌面边缘的具体画面；不写西塔/她/不照抄人设/不编长期记忆");
  } else if (asksForOwnTechnicalJudgment(latestUserMessage)) {
    hints.push("技术判断=仅3句；首句我赞成或我觉得合理；理由=本地隐私与离线+实时资料按需搜索；不触发搜索/不说作为AI");
  } else if (asksWhetherCharacterCanFeelEmotion(latestUserMessage)) {
    hints.push("情感题=先明确我会/我有；2-3句且每句有新信息；用当轮细节+具体触动；禁身份说明/编经历/虚拟·AI·机器人·没有情感·不会感动/清单");
  } else if (asksAboutOwnSubjectiveView(latestUserMessage)) {
    hints.push("主观题=明确喜欢/不喜欢/赞成/反对；2-3句且每句有新信息；理由取感官/学院生活/现代魔导/朋友立场；不讲人类整体/不折中/不列清单/不编经历");
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

function describesEverydayMoment(text: string): boolean {
  if (!text || /[？?]|为什么|怎么|如何|(?:请|帮我|替我|给我).{0,8}(?:回答|解释|分析|搜索|查询|查找|列出)/.test(text)) {
    return false;
  }

  const hasEverydayContext = /(今天|今晚|今早|刚才|这会儿|最近|外面|窗外)/.test(text);
  const hasEverydayExperience = /(雨|雪|刮风|风吹|阴天|天阴|冷|热|闷|潮|累|困|饿|没睡好|睡不着|什么都不想做|只想.{0,8}(?:趴|躺|睡)|加班|下班)/.test(text);

  return hasEverydayContext && hasEverydayExperience;
}

function asksElectronPronounLayerFollowup(
  messages: readonly ChatProviderMessage[],
  latestUserMessage: string
): boolean {
  const asksAboutPronounLayer = /(?:那)?它.{0,8}(?:负责|属于|在哪).{0,8}(?:哪一层|什么层)/.test(latestUserMessage);
  const priorUserMentionedElectron = messages.some(
    (message) => message.role === "user" && message.content !== latestUserMessage && /Electron/i.test(message.content)
  );
  return asksAboutPronounLayer && priorUserMentionedElectron;
}

function describesEverydayRain(text: string): boolean {
  const expressesPositiveRainFeeling = /(喜欢|舒服|惬意|好听|安静|开心|高兴|浪漫|真好|不错)/.test(text);
  return describesEverydayMoment(text) && /(下雨|雨下|雨天|雨声|这场雨)/.test(text) && !expressesPositiveRainFeeling;
}

function describesEverydayFatigue(text: string): boolean {
  return describesEverydayMoment(text) && /(累|困|没睡好|睡不着|什么都不想做|只想.{0,8}(?:趴|躺|睡))/.test(text);
}

function asksCasualLifeWhy(text: string): boolean {
  const asksWhy = /为什么|怎么会/.test(text);
  const hasRainContext = /(下雨|雨天|雨声|阴雨|这场雨)/.test(text);
  const asksAboutFeltEffect = /(提不起精神|没精神|心情|压抑|烦躁|难受|困|疲惫|想睡|低落|不开心)/.test(text);
  const hasTechnicalContext = /(API|接口|字段|null|undefined|代码|程序|数据|请求|响应|报错|错误)/i.test(text);
  return asksWhy && hasRainContext && asksAboutFeltEffect && !hasTechnicalContext;
}

function rejectsAdvice(text: string): boolean {
  return /(?:不要|不用|别).{0,12}(?:建议|办法|清单|下一步)/.test(text);
}

function asksForPersonaRoleSummary(text: string): boolean {
  return /身份/.test(text) && /专业(?:方向)?/.test(text) && /桌面(?:应用)?(?:里|中)?的?(?:角色|同伴)/.test(text);
}

function asksAboutOwnPreference(text: string): boolean {
  const asksCharacterPreference = /(?:西塔[，,、\s]*)?你(?:自己|本人)?(?:更喜欢|喜欢哪|喜欢.{0,8}(?:什么|哪种|哪类)|偏好|偏爱|会选|怎么选)|(?:你自己的|你的|西塔的)(?:偏好|喜好)|西塔.{0,8}(?:更喜欢|喜欢哪|偏好|偏爱|会选|怎么选)/.test(text);

  return asksCharacterPreference && isQuestion(text);
}

function asksAboutOwnSubjectiveView(text: string): boolean {
  if (!isQuestion(text) || asksAboutTechnicalChoice(text)) {
    return false;
  }

  if (asksAboutOwnPreference(text)) {
    return true;
  }

  const asksCharacterView = /(?:西塔[，,、\s]*)?你(?:自己|本人)?(?:觉得|认为|怎么看|如何看)|(?:你自己的|你的|西塔的)(?:看法|观点|感受|想法|态度)/.test(text);
  const asksCharacterFeeling = /(?:西塔[，,、\s]*)?你(?:自己|本人)?.{0,12}(?:感动|开心|难过|害怕|安心|烦闷|孤独|生气|恼火|心疼)/.test(text);
  const asksAboutUserPreference = /你觉得我.{0,20}(?:喜欢|偏好|会选)/.test(text);

  return !asksAboutUserPreference && (asksCharacterView || asksCharacterFeeling);
}

function asksAboutTechnicalChoice(text: string): boolean {
  return /\b(?:provider|mcp|api|live2d|gguf|ollama)\b|llama\.?cpp|lm studio|本地模型|代码|脚本|运行时|端口|技术方案/i.test(text);
}

function asksWhetherCharacterCanFeelEmotion(text: string): boolean {
  if (!isQuestion(text) || asksAboutTechnicalChoice(text)) {
    return false;
  }

  return /(?:西塔[，,、\s]*)?你.{0,16}(?:会|能|有).{0,12}(?:感动|情感|感情|开心|难过|害怕|生气|心疼)/.test(text);
}

function isPlayfulTeasing(text: string): boolean {
  return !/(?:不是|并非|没(?:有)?|不)(?:在)?(?:开玩笑|逗你(?:的)?|骗你的|闹着玩|说笑)/.test(text) &&
    /开玩笑|逗你(?:的)?|骗你的|闹着玩|说笑/.test(text);
}

function asksWhetherXitaWillBlindlyAgree(text: string): boolean {
  return /顺着我说|附和我|总会赞同|不同意我|和我意见不一样|反驳我/.test(text) && isQuestion(text);
}

function describesUnfairTreatment(text: string): boolean {
  return /推卸责任|责任.{0,8}(?:推|甩)|一文不值|贬低|不公平|抢功|甩锅/.test(text);
}

function asksForWitchImagination(text: string): boolean {
  return /如果|假如|想象|要是/.test(text) &&
    /现代魔导|魔法|晚霞|月光|星光/.test(text) &&
    isQuestion(text);
}

function asksAboutXitaRoleLife(text: string): boolean {
  return /(?:你|西塔)/.test(text) &&
    /(?:桌面边缘|一个人|平时|通常).{0,16}(?:喜欢做什么|做什么|会做|怎么过)/.test(text) &&
    isQuestion(text);
}

function asksForOwnTechnicalJudgment(text: string): boolean {
  return asksAboutTechnicalChoice(text) &&
    /(?:西塔[，,、\s]*)?你(?:自己|本人)?(?:觉得|认为|怎么看|如何看)|(?:你自己的|你的|西塔的)(?:看法|观点|态度)/.test(text) &&
    isQuestion(text);
}

function isQuestion(text: string): boolean {
  return /[？?]|什么|如何|怎么|怎样|是否|是不是|区别|负责|解释|介绍|讲讲/.test(text);
}
