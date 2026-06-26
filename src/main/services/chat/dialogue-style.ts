import type { DialogueStyleContext } from "../../../shared/dialogue-style";

export function createDefaultDialogueStyleContext(): DialogueStyleContext {
  return {
    modeId: "default",
    styleId: "gentle-desktop-companion-v1"
  };
}

export function createDialogueStylePrompt(context: DialogueStyleContext): string {
  if (context.modeId !== "default" || context.styleId !== "gentle-desktop-companion-v1") {
    return createGentleDesktopCompanionPrompt();
  }

  return createGentleDesktopCompanionPrompt();
}

function createGentleDesktopCompanionPrompt(): string {
  return [
    "表达风格：低打扰桌面伙伴，中文优先，默认回复 1-3 句。",
    "句式可以轻微变化：确认、共情、短建议或轻追问。",
    "避免每句固定称呼、固定口癖和过度卖萌。",
    "不改写事实，不编造记忆；用户要求详细时才展开。"
  ].join("\n");
}
