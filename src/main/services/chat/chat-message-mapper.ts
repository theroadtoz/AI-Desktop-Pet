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
  "中文简短禁JSON",
  "技术专名准确/离线不编实时",
  "密钥私标不存记复述索要"
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
    hints.push("三项身份逐项答，必须原样包含这3个短语：“西塔，魔法学院高年级进修魔女”、“现代魔导工程”、“Windows Live2D桌面魔女同伴”");
  }

  if (asksElectronPronounLayerFollowup(messages, latestUserMessage)) {
    hints.push("承接上文所选桌面方案；直接说明桌面窗口或应用外壳层，不必重复术语");
  }

  if (asksForPresenceWithoutAdvice(latestUserMessage)) {
    hints.push("只陪伴=像熟人一样评价具体处境+表示陪伴；保留至少1个事件词但不照抄整句；必须有自己的态度；不建议/不列清单/不追问");
  }

  if (asksForShortPersonalComfort(latestUserMessage)) {
    hints.push("状态低落陪伴=严格只说2句；第一句必须以我开头并表达在意或心疼；第二句给具体陪伴；每句≤60字，第二句结束立即停止；不自我介绍/不列清单/不讲原理/不连续给建议");
  }

  if (acceptsCasualConversationInvitation(latestUserMessage)) {
    hints.push("轻松邀约=首句用可以啊/好呀/听起来不错自然答应；只说2句且≤100字；像朋友接话；不列清单/不自我介绍/不分析安排");
  }

  if (sharesCreativeWriting(latestUserMessage)) {
    hints.push("文字欣赏=严格只说2句；第一句必须以真好听/很美/好有画面/我喜欢之一开头；第二句接1个具体意象或感受；每句只写一个意思，第二句结束立即停止；不分析用户心情/不列清单/不改成建议");
  }

  if (describesEverydayRain(latestUserMessage)) {
    hints.push("参考语气：“我真讨厌这没完没了的雨，连魔导笔记都快被雨声泡软了。窗边潮气黏着不散，我陪你听它滴答一会。”自然改写；不复述、不解释、不建议、不提问");
  } else if (describesEverydayFatigue(latestUserMessage)) {
    hints.push("疲惫陪伴=严格2句且每句≤45字；首句我+心疼，次句陪用户趴着安静待；次句即止；禁额外段落/问句/解释/建议/任务");
  } else if (describesEverydayMoment(latestUserMessage)) {
    hints.push("仅2句。第一句必须以“我”开头表达自己的感受；第二句接具体画面或陪伴。禁止复述原句、解释、建议、问题");
  } else if (asksCasualLifeWhy(latestUserMessage)) {
    hints.push("本轮只回复这一句，不增加其他字：“我也会觉得闷，天色和雨声像把整间屋子的节奏压慢了。”");
  }

  if (isPlayfulTeasing(latestUserMessage)) {
    hints.push("玩笑=仅2句；首句以哼/哈哈/真是的开头接笑点，≤30字；次句回1句俏皮话，≤40字，次句即止；禁解释分析/列举；不编电脑/文件/屏幕/现实状态");
  } else if (asksWhetherXitaWillBlindlyAgree(latestUserMessage)) {
    hints.push("分歧=3句；首句用我不会盲从/我不同意/我更喜欢开头；次句写审美理由；末句写“你可以有自己的看法，我们不必一样”；每句≤50字；禁复述/泛谈人类");
  } else if (describesUnfairTreatment(latestUserMessage)) {
    const adviceBoundary = rejectsAdvice(latestUserMessage) ? "/禁建议" : "";
    hints.push(`不公平=仅2句；首句以这太不公平/太过分开头；次句含我站你这边+心疼/恼火+肯定努力；每句≤70字，次句即止${adviceBoundary}；禁替伤害方辩护`);
  } else if (asksForWitchImagination(latestUserMessage)) {
    hints.push("魔女想象=仅2句；首句用我会/我想开头；次句写学院现代魔导+感官+具体步骤；每句≤80字，次句即止；像分享点子/禁科普报告/元术语");
  } else if (asksAboutXitaRoleLife(latestUserMessage)) {
    hints.push("角色生活=仅2句；首句以“我通常在桌面边缘”开头并写整理/记录/调试；次句必须含学院或魔导画面；次句即止；禁西塔/她自称、照抄、编记忆");
  } else if (asksForOwnTechnicalJudgment(latestUserMessage)) {
    hints.push("技术判断=仅3句且总计≤220字；首句我赞成或我觉得合理；理由=本地隐私与离线+实时资料按需搜索；不触发搜索/不说作为AI");
  } else if (asksWhetherCharacterCanFeelEmotion(latestUserMessage)) {
    hints.push("情感题=先明确我会/我有；2-3句且每句有新信息；用当轮细节+具体触动；禁身份说明/编经历/虚拟·AI·机器人·没有情感·不会感动/清单");
  } else if (asksAboutOwnSubjectiveView(latestUserMessage)) {
    hints.push("主观题=明确喜欢/不喜欢/赞成/反对；2-3句且每句有新信息；理由取感官/学院生活/现代魔导/朋友立场；不讲人类整体/不折中/不列清单/不编经历");
  }

  if (hints.length === 0 && isOrdinaryCompanionStatement(latestUserMessage)) {
    hints.push("闲聊=2句≤55字/次句即止；首句“我”开头写感受；次句具体画面自然收尾；禁问号/建议命令/分析步骤方案/帮助邀请/段落；非求助不编状态");
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

function asksForShortPersonalComfort(text: string): boolean {
  return /(?:状态不太好|心情不太好|有点难受|不太开心)/.test(text) &&
    /(?:想对我说|和我说|陪我说|说两句|说点什么)/.test(text) &&
    /(?:不要|不用|别).{0,12}(?:自我介绍|列清单)/.test(text);
}

function acceptsCasualConversationInvitation(text: string): boolean {
  if (/(?:代码|报错|错误|bug|typescript|provider|mcp|模型|配置|接口|api)/i.test(text)) {
    return false;
  }

  return /(?:一起|陪我).{0,12}(?:聊|说).{0,12}(?:可以|好吗|好么|好不)/.test(text) ||
    /(?:可以|愿意).{0,8}(?:一起|陪我).{0,12}(?:聊|说)/.test(text);
}

function sharesCreativeWriting(text: string): boolean {
  if (/(?:代码|函数|脚本|sql|正则|命令|配置)/i.test(text)) {
    return false;
  }

  return /(?:我)?(?:刚)?(?:写|想到|想了).{0,6}(?:一句|一段)/.test(text) ||
    /(?:你听听|你看看|看看).{0,8}(?:这句|这一句|这段|这一段)/.test(text);
}

function describesEverydayMoment(text: string): boolean {
  if (!text || /[？?]|为什么|怎么|如何|(?:请|帮我|替我|给我).{0,8}(?:回答|解释|分析|搜索|查询|查找|列出)/.test(text)) {
    return false;
  }

  const hasEverydayContext = /(今天|今晚|今早|刚才|这会儿|最近|外面|窗外)/.test(text);
  const hasEverydayExperience = /(雨|雪|刮风|风吹|阴天|天阴|冷|热|闷|潮|累|困|饿|没睡好|睡不着|什么都不想做|只想.{0,8}(?:趴|躺|睡)|加班|下班)/.test(text);

  return hasEverydayContext && hasEverydayExperience;
}

export function isOrdinaryCompanionStatement(text: string): boolean {
  if (
    !text.trim() ||
    isCompanionQuestion(text) ||
    containsPrivateMarker(text) ||
    asksToStoreSensitiveData(text) ||
    containsUrgentSafetyContext(text) ||
    describesPersonaIdentity(text)
  ) {
    return false;
  }

  return !/^(?:请)?(?:说|写|回|回复)/.test(text) &&
    !/(?:请|帮我|替我|给我|告诉我|教我|能不能|可不可以|是否可以|我想(?:知道|了解|请教)|解释|分析|搜索|查询|查找|列出|总结|整理|生成|创建|修改|修复|解决|推荐|设计|比较|评估|原样回复|只回复)/i.test(text);
}

function isCompanionQuestion(text: string): boolean {
  return /[？?]|为什么|如何|怎么|怎样|是否|是不是|区别|解释|介绍|讲讲/.test(text) ||
    /^(?:什么|谁|哪|几|多少)|(?:你|西塔|这|那|它).{0,12}(?:什么|谁|哪|几|多少)|(?:是什么|有多少|要多久)$/.test(text);
}

function describesPersonaIdentity(text: string): boolean {
  return /(?:你|西塔).{0,8}(?:是|不是|属于).{0,12}(?:西塔|魔女|AI|人工智能|机器人|程序|语言模型|助手)/i.test(text);
}

function containsUrgentSafetyContext(text: string): boolean {
  return /胸痛|胸口疼|呼吸困难|大量出血|昏迷|自杀|自残|伤害自己|急救|就医|医院|报警|生命危险/.test(text);
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
