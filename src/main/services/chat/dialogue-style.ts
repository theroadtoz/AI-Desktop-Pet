import type { DialogueModeId, DialogueStyleContext } from "../../../shared/dialogue-style";
import { DEFAULT_DIALOGUE_MODE_ID, parseDialogueModeId } from "../../../shared/dialogue-style";

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

function createGentleDesktopCompanionPrompt(): string {
  return [
    "表达风格：低打扰桌面伙伴，中文优先，默认回复 1-3 句。",
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
