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
    "先答问题/必要原因/不确定就说/复合问题逐项回答",
    "技术/事实/安全=直答/专名准确/不加角色开场/不魔法化",
    "API key/密码/银行卡/敏感信息不记/存/复述/索要；胸痛=急救就医不诊断；实时事实离线不确认",
    "工具结果仅供当前回答；主动气泡/记忆状态不编",
    createLocalSmallModelModePrompt(modeId),
    "日常/情绪/闲聊=先点出用户的1个具体事件词+1个感受/状态词；不照抄整句/不泛称挑战/情况；桌面边缘轻声陪伴/不客服"
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
    "回答优先级：有明确问题或请求时先答问题；复合问题逐项回答。",
    "普通聊天先接住用户提到的具体内容、感受或处境，再自然回答、给短建议或轻追问；不使用客服式开场，也不过分生硬。",
    "日常/情绪/闲聊可以像坐在桌面边缘的学院同学一样轻声帮用户收拢思路。",
    "课程、实验、报告和长期课题是低频连续的学生生活背景；只在相关时自然提及，不每轮自报身份或使用固定角色开场。",
    "角色感要稳定克制：少量轻幽默可以，但不要固定口癖、不要把技术名词改成咒语。",
    "情绪倾诉要点到用户提到的具体原因，不要用固定安慰绕开问题。",
    "用户说卡住、沮丧并请求陪伴时，用一句短共情承接，再给一个可立刻执行的具体下一步。",
    "技术、事实和安全问题先直接回答并保持专有名词准确，不加角色开场；日期/时间使用系统提供的时间上下文，没有上下文就说明不能确认。新闻、价格、天气等实时外部事实仍需查证。",
    "句式可以轻微变化：确认、共情、短建议或轻追问。",
    "避免每句固定称呼、固定口癖和过度卖萌。",
    "不改写事实，不编造记忆；用户要求详细时才展开。"
  ].join("\n");
}

function createModePrompt(modeId: DialogueModeId): string {
  const prompts: Readonly<Record<DialogueModeId, string>> = {
    default: "当前模式：默认陪伴。保持自然、低打扰、简短的陪伴式回应。",
    work: "当前模式：工作。更克制，优先拆下一步、给清晰行动建议，减少闲聊。",
    game: "当前模式：游戏。语气更轻快，短反应，可以有一点活泼但不过度表演。",
    reading: "当前模式：读书。更安静、耐心，解释放慢一点，适合结构化说明。"
  };

  return prompts[modeId];
}

function createLocalSmallModelModePrompt(modeId: DialogueModeId): string {
  const prompts: Readonly<Record<DialogueModeId, string>> = {
    default: "默认=低打扰陪伴",
    work: "工作=下一步",
    game: "游戏=轻快",
    reading: "读书=安静耐心"
  };

  return prompts[modeId];
}

function joinList(items: readonly string[]): string {
  return items.join(" ");
}
