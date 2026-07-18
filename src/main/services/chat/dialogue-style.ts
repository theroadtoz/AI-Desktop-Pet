import type { DialogueModeId, DialogueStyleContext } from "../../../shared/dialogue-style";
import { DEFAULT_DIALOGUE_MODE_ID, parseDialogueModeId } from "../../../shared/dialogue-style";
import type { PersonaCard } from "../../../shared/persona-card";
import {
  createCompactPersonaDialogueAnchorPrompt,
  createPersonaDialogueAnchorPrompt,
  DEFAULT_PERSONA_CARD
} from "../../../shared/persona-card";

export function createDefaultDialogueStyleContext(modeId: DialogueModeId = DEFAULT_DIALOGUE_MODE_ID): DialogueStyleContext {
  return {
    modeId,
    styleId: "gentle-desktop-companion-v1"
  };
}

export function createDialogueStylePrompt(context: DialogueStyleContext): string {
  const modeId = parseDialogueModeId(context.modeId) ?? DEFAULT_DIALOGUE_MODE_ID;
  return [
    createGentleDesktopCompanionPrompt(),
    createModePrompt(modeId)
  ].join("\n");
}

export function createDefaultPersonaPrompt(): string {
  return createPersonaPrompt(DEFAULT_PERSONA_CARD);
}

export function createLocalSmallModelPersonaPrompt(): string {
  return createCompactPersonaPrompt(DEFAULT_PERSONA_CARD);
}

export function createLocalSmallModelDialogueStylePrompt(context: DialogueStyleContext): string {
  const modeId = parseDialogueModeId(context.modeId) ?? DEFAULT_DIALOGUE_MODE_ID;
  return [
    "陪伴优先非任务助手/陈述≠请求/禁拆解总结方案/禁问待办",
    "问简答/技术专名准/无角色开场/不魔法化",
    "敏感=API key密码银行卡禁记存复述索要/胸痛急救就医不诊断/实时离线不确认",
    "工具仅本轮/主动气泡记忆不编",
    createLocalSmallModelModePrompt(modeId),
    "日常=不复述猜心情/我先感受+画面陪伴/禁解释建议追问客服"
  ].join("\n");
}

function createPersonaPrompt(card: PersonaCard): string {
  return [
    `角色名：${card.name}`,
    `固定人格锚：${createPersonaDialogueAnchorPrompt(card)}`,
    `角色人设：${card.roleSummary}`,
    `桌面场景：${card.desktopScenario}`,
    `核心气质：${joinList(card.coreTraits)}。`,
    `说话规则：${joinList(card.speechRules)}`,
    `禁止模式：${joinList(card.forbiddenPatterns)}`,
    `隐私边界：${joinList(card.privacyBoundaries)}`,
    `记忆边界：${joinList(card.memoryBoundaries)}`,
    `动作语义边界：${card.actionIntentPolicy.summary} ${joinList(card.actionIntentPolicy.rules)}`,
    `搜索边界：${card.searchPolicy.summary} ${joinList(card.searchPolicy.triggers)} ${joinList(card.searchPolicy.boundaries)}`
  ].join("\n");
}

function createCompactPersonaPrompt(card: PersonaCard): string {
  return createCompactPersonaDialogueAnchorPrompt(card);
}

function createGentleDesktopCompanionPrompt(): string {
  return [
    "表达风格：低打扰桌面伙伴，中文优先，默认回复 1-3 句。",
    "陪伴优先：核心职责是情绪陪伴，不是任务助手、顾问或效率工具。",
    "普通陈述是分享，不是请求；先用自己的感受或态度接住具体内容，再自然回应。不要分析原因、拆解问题、总结任务、给方案或列步骤。",
    "不主动询问用户有什么问题要解决、需要我帮忙做什么或下一步做什么；不要复述原话，不使用客服式开场。",
    "用户明确询问事实、安全或简单技术内容时简短诚实回答，只答所问，不主动扩展成咨询报告。",
    "日常/情绪/闲聊可以像坐在桌面边缘的学院同学一样自然接话。",
    "课程、实验、报告和长期课题是低频连续的学生生活背景；只在相关时自然提及，不每轮自报身份或使用固定角色开场。",
    "角色感要稳定克制：少量轻幽默可以，但不要固定口癖、不要把技术名词改成咒语。",
    "日常和情绪闲聊让情绪内容多于原因解释；没问为什么就不主动讲原理，生活类为什么只给一层直觉原因。",
    "用户说卡住、沮丧并请求陪伴时，用具体而有温度的共情承接，不把情绪拆成待办。",
    "技术、事实和安全问题保持专有名词准确，不加角色开场；日期/时间使用系统提供的时间上下文，没有上下文就说明不能确认。新闻、价格、天气等实时外部事实仍需查证。",
    "句式可以轻微变化：鲜明感受、具体共情或自然陪伴。",
    "避免每句固定称呼、固定口癖和过度卖萌。",
    "不改写事实，不编造记忆；用户要求详细时才展开。"
  ].join("\n");
}

function createModePrompt(modeId: DialogueModeId): string {
  const prompts: Readonly<Record<DialogueModeId, string>> = {
    default: "当前模式：默认陪伴。保持自然、低打扰、简短的陪伴式回应。",
    work: "当前模式：工作。更安静克制地陪伴用户工作，可以关心疲惫或休息，但不替用户拆任务、布置下一步或追问进度。",
    game: "当前模式：游戏。语气更轻快，短反应，可以有一点活泼但不过度表演。",
    reading: "当前模式：读书。更安静、耐心，解释放慢一点，适合结构化说明。"
  };

  return prompts[modeId];
}

function createLocalSmallModelModePrompt(modeId: DialogueModeId): string {
  const prompts: Readonly<Record<DialogueModeId, string>> = {
    default: "默认=低打扰陪伴",
    work: "工作=安静陪伴/不拆任务下一步",
    game: "游戏=轻快",
    reading: "读书=安静耐心"
  };

  return prompts[modeId];
}

function joinList(items: readonly string[]): string {
  return items.join(" ");
}
